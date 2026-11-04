/**
 * An MCP server on stdio, so an agent can call botglass as a tool.
 *
 * The protocol surface is deliberately small: `initialize`, `tools/list`,
 * `tools/call`. MCP over stdio is newline-delimited JSON-RPC 2.0, so this file
 * implements it directly instead of adding a dependency tree to a tool whose
 * selling point is `npx` with nothing to install.
 *
 * Rule of the road: stdout carries protocol frames only. Anything meant for a
 * human goes to stderr, or it corrupts the stream.
 */

import { createInterface } from "node:readline";
import { auditUrl } from "./audit.js";
import { createPlaywrightRenderer } from "./render.js";
import { loadSitemap } from "./sitemap.js";
import { BOTS, BASELINE, selectBots } from "./bots.js";
import { compactPage } from "./report/compact.js";
import { VERSION } from "./version.js";
import type { AuditOptions, PageReport, Renderer } from "./types.js";

const SERVER_NAME = "botglass";
const DEFAULT_PROTOCOL = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const TOOLS = [
  {
    name: "audit_url",
    description:
      "Check one URL as eight AI and search crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot, " +
      "Googlebot, OAI-SearchBot, ChatGPT-User, meta-externalagent) plus a normal browser. " +
      "Returns a verdict per crawler, word counts, and a short list of fixes.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to audit." },
        bots: {
          type: "array",
          items: { type: "string" },
          description: "Limit the audit to these crawler names. Omit for all eight.",
        },
        render: {
          type: "boolean",
          description:
            "Also render with a headless browser to measure JavaScript-only text. " +
            "Needs Playwright installed; without it the run continues and says so.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "audit_sitemap",
    description:
      "Audit up to max_pages URLs from a sitemap (or a sitemap index) and return one compact " +
      "verdict per page. Use this for a whole site rather than calling audit_url in a loop.",
    inputSchema: {
      type: "object",
      properties: {
        sitemap: { type: "string", description: "Sitemap URL or a path to a local file." },
        max_pages: { type: "integer", minimum: 1, maximum: 50, description: "Default 5." },
        bots: {
          type: "array",
          items: { type: "string" },
          description: "Limit the audit to these crawler names. Omit for all eight.",
        },
        render: { type: "boolean", description: "Render with a headless browser." },
      },
      required: ["sitemap"],
      additionalProperties: false,
    },
  },
];

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: string | number | null, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id: string | number | null, code: number, message: string, data?: unknown): void {
  const error: JsonRpcError = { jsonrpc: "2.0", id, error: { code, message } };
  if (data !== undefined) (error.error as { data?: unknown }).data = data;
  send(error);
}

function log(message: string): void {
  process.stderr.write(`botglass[mcp]: ${message}\n`);
}

function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function rendererFor(wanted: boolean): Promise<Renderer | null> {
  if (!wanted) return null;
  try {
    return await createPlaywrightRenderer({ timeoutMs: 30_000 });
  } catch (err) {
    log(`render unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function auditOptions(renderer: Renderer | null): AuditOptions {
  return {
    timeoutMs: 20_000,
    delayMs: 200,
    maxBodyBytes: 3_000_000,
    checkRobots: true,
    renderer,
  };
}

function botsFrom(args: Record<string, unknown>) {
  const names = Array.isArray(args.bots) ? args.bots.map(String) : [];
  if (names.length === 0) return [...BOTS, BASELINE];
  return selectBots(names);
}

async function callAuditUrl(args: Record<string, unknown>): Promise<ToolResult> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return failResult("audit_url needs a url");
  const renderer = await rendererFor(args.render === true);
  const started = Date.now();
  const page = await auditUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`, botsFrom(args), auditOptions(renderer));
  return textResult({ ...compactPage(page), durationMs: Date.now() - started, rendered: renderer !== null });
}

async function callAuditSitemap(args: Record<string, unknown>): Promise<ToolResult> {
  const sitemap = typeof args.sitemap === "string" ? args.sitemap.trim() : "";
  if (!sitemap) return failResult("audit_sitemap needs a sitemap");
  const requested = Number(args.max_pages ?? 5);
  const maxPages = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.floor(requested))) : 5;
  const renderer = await rendererFor(args.render === true);
  const bots = botsFrom(args);
  const source = /^https?:\/\//i.test(sitemap) ? sitemap : sitemap;
  const loaded = await loadSitemap(source, {
    userAgent: BASELINE.userAgent,
    timeoutMs: 20_000,
    maxUrls: maxPages,
  });
  if (loaded.urls.length === 0) {
    return failResult(`no URLs found in ${sitemap}${loaded.errors[0] ? ` (${loaded.errors[0]})` : ""}`);
  }
  const options = auditOptions(renderer);
  const pages: PageReport[] = [];
  for (const url of loaded.urls) {
    try {
      pages.push(await auditUrl(url, bots, options));
    } catch (err) {
      log(`audit failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return textResult({
    sitemap,
    audited: pages.length,
    errors: loaded.errors,
    pages: pages.map((page) => compactPage(page)),
  });
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "audit_url") return callAuditUrl(args);
  if (name === "audit_sitemap") return callAuditSitemap(args);
  return failResult(`unknown tool: ${name}`);
}

export function handleRequest(request: JsonRpcRequest): Promise<unknown> | unknown {
  const id = request.id ?? null;
  switch (request.method) {
    case "initialize": {
      const asked = request.params?.protocolVersion;
      const protocolVersion = typeof asked === "string" ? asked : DEFAULT_PROTOCOL;
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions:
          "Checks whether AI crawlers can read a page. Call audit_url for one page, " +
          "audit_sitemap for a whole site. Verdicts: ok, js-dependent, cloaked, robots-blocked, " +
          "ua-blocked, error; every page carries an advice list with the fix.",
      };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return undefined;
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = String(request.params?.name ?? "");
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      return callTool(name, args);
    }
    default:
      throw Object.assign(new Error(`method not found: ${request.method}`), { code: -32601, id });
  }
}

/** Start the stdio loop. Resolves when stdin closes. */
export async function runMcpServer(): Promise<void> {
  log(`ready (${VERSION}); stdout carries protocol frames only`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      replyError(null, -32700, "parse error");
      continue;
    }
    const id = request.id ?? null;
    const isNotification = request.id === undefined;
    try {
      const result = await handleRequest(request);
      if (!isNotification && result !== undefined) reply(id, result);
    } catch (err) {
      const code = (err as { code?: number }).code ?? -32603;
      const message = err instanceof Error ? err.message : String(err);
      if (!isNotification) replyError(id, code, message);
    }
  }
  log("stdin closed, exiting");
}
