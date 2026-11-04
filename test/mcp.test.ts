/**
 * The MCP server, driven the way a client drives it: a real child process, real
 * JSON-RPC frames on stdin and stdout, nothing mocked.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startFixture, type Fixture } from "./fixture.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

let fixture: Fixture;

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

/** A tiny MCP client: writes one JSON line, waits for the response with that id. */
class Client {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending = new Map<number, Pending>();
  private notifications: string[] = [];
  readonly stdoutLines: string[] = [];

  constructor() {
    this.child = spawn(process.execPath, [cli, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", () => {
      /* stderr is for humans; ignore it here */
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    this.stdoutLines.push(line);
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.notifications.push(`NOT JSON: ${line}`);
      return;
    }
    const id = typeof message.id === "number" ? message.id : null;
    if (id === null) {
      this.notifications.push(line);
      return;
    }
    const waiter = this.pending.get(id);
    if (waiter) {
      this.pending.delete(id);
      waiter.resolve(message);
    }
  }

  request(id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout waiting for ${method}`));
      }, 30_000);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

before(async () => {
  fixture = await startFixture();
});

after(async () => {
  await fixture.close();
});

test("initialize answers with a protocol version and tool capability", async () => {
  const client = new Client();
  try {
    const response = await client.request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    const result = response.result as Record<string, unknown>;
    assert.equal(result.protocolVersion, "2025-06-18");
    assert.deepEqual((result.serverInfo as { name: string }).name, "botglass");
    assert.ok((result.capabilities as { tools?: unknown }).tools);
  } finally {
    client.close();
  }
});

test("only JSON reaches stdout, even though the server logs", async () => {
  const client = new Client();
  try {
    client.notify("notifications/initialized");
    await client.request(1, "tools/list");
    for (const line of client.stdoutLines) assert.doesNotThrow(() => JSON.parse(line));
    assert.equal(client.stdoutLines.length, 1, "a notification must not be answered");
  } finally {
    client.close();
  }
});

test("tools/list describes both tools with required arguments", async () => {
  const client = new Client();
  try {
    const response = await client.request(1, "tools/list");
    const tools = (response.result as { tools: Array<Record<string, unknown>> }).tools;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["audit_url", "audit_sitemap"],
    );
    for (const tool of tools) {
      const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };
      assert.equal(schema.required.length, 1);
      assert.ok(schema.properties[tool.name === "audit_url" ? "url" : "sitemap"]);
      assert.ok(String(tool.description).length > 40);
    }
  } finally {
    client.close();
  }
});

test("tools/call audit_url returns a verdict, a fix and no page text", async () => {
  const client = new Client();
  try {
    const response = await client.request(1, "tools/call", {
      name: "audit_url",
      arguments: { url: `${fixture.base}/client-only`, bots: ["GPTBot"] },
    });
    const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.ok(!result.isError);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
    assert.equal(payload.worst, "js-dependent");
    assert.match(String((payload.advice as string[])[0]), /server-render/);
    assert.equal(payload.rendered, false);
    const serialised = JSON.stringify(payload);
    assert.ok(serialised.length < 4000, "the tool result must stay small");
    assert.ok(!serialised.includes("x x x"), "page text must not be returned");
  } finally {
    client.close();
  }
});

test("tools/call audit_sitemap walks a sitemap and returns one entry per page", async () => {
  const client = new Client();
  try {
    const response = await client.request(1, "tools/call", {
      name: "audit_sitemap",
      arguments: { sitemap: `${fixture.base}/sitemap.xml`, max_pages: 2, bots: ["GPTBot"] },
    });
    const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.ok(!result.isError, result.content[0]?.text);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { pages: unknown[]; audited: number };
    assert.ok(payload.pages.length > 0);
    assert.equal(payload.audited, payload.pages.length);
    assert.ok(payload.pages.length <= 2);
  } finally {
    client.close();
  }
});

test("an unknown tool is an error result, not a crash", async () => {
  const client = new Client();
  try {
    const response = await client.request(1, "tools/call", { name: "nope", arguments: {} });
    const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", /unknown tool/);
  } finally {
    client.close();
  }
});

test("an unknown method comes back as JSON-RPC -32601 with the id", async () => {
  const client = new Client();
  try {
    const response = await client.request(7, "does/not/exist");
    const error = response.error as { code: number; message: string };
    assert.equal(response.id, 7);
    assert.equal(error.code, -32601);
    assert.match(error.message, /method not found/);
  } finally {
    client.close();
  }
});

test("missing arguments produce a readable failure", async () => {
  const client = new Client();
  try {
    const response = await client.request(1, "tools/call", { name: "audit_url", arguments: {} });
    const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", /needs a url/);
  } finally {
    client.close();
  }
});
