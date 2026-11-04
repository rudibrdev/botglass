#!/usr/bin/env node
/**
 * botglass — see your site exactly as AI crawlers see it.
 *
 * The CLI is thin on purpose: argument parsing, a bounded request pool, output
 * files and the exit code. All the reasoning lives in audit.ts and report/.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BASELINE, BOTS, selectBots } from "./bots.js";
import { auditUrl } from "./audit.js";
import { parseUrlList, loadSitemap } from "./sitemap.js";
import { createPlaywrightRenderer } from "./render.js";
import { renderRunText, renderCompactText, summarise } from "./report/text.js";
import { renderHtml } from "./report/html.js";
import { buildRunReport } from "./report/run.js";
import { compactRun } from "./report/compact.js";
import { buildBaseline, compareBaseline, parseBaseline, type BaselineDiff } from "./baseline.js";
import { isVerdict, VERDICTS } from "./types.js";
import type { AuditOptions, PageReport, Renderer, RunOptions, Verdict } from "./types.js";
import { VERSION } from "./version.js";

const USAGE = `
botglass ${VERSION} — see your site exactly as AI crawlers see it

  botglass <url...> [options]

What it does
  Fetches each URL as a normal browser and as each AI/search crawler, compares
  the text a crawler actually receives with what a browser gets, checks that
  crawler's robots.txt rule, and prints one verdict per bot.

Options
  --sitemap <url|file>   Audit every URL in a sitemap (index files are followed)
  --urls <file>          Audit a newline-separated URL list (# comments allowed)
  --max-pages <n>        Cap the number of pages audited (default 10)
  --bots <a,b>           Only these crawlers (default: all). See --list-bots
  --render               Also render with JavaScript (needs Playwright); unlocks
                         the js-dependent verdict and missing-text samples
  --samples              Print the first missing sentences for js-dependent pages
  --json <file>          Write the full report as JSON
  --html <file>          Write a standalone HTML report
  --compact              Small, agent-sized output: verdicts and fixes, no page text
  --baseline <file>      Compare against a saved baseline and list what changed
  --update-baseline      Overwrite the baseline file with this run
  --fail-on <verdicts>   Comma-separated verdicts that should exit 1
                         (e.g. js-dependent,ua-blocked,cloaked)
  --max-js-only <0..1>   Fail when more than this share of rendered text is
                         JavaScript-only (implies --render)
  --timeout <ms>         Per-request timeout (default 15000)
  --delay <ms>           Delay between requests to the same host (default 400)
  --concurrency <n>      Pages audited in parallel (default 1; be polite)
  --no-robots            Skip robots.txt (faster, less useful)
  --no-color             Plain output even on a TTY
  --quiet                Write no terminal report
  --list-bots            Print the crawler identities and exit
  --version, --help

Exit codes
  0 no failing verdicts   1 gate failed   2 usage or runtime error
`.trim();

function fail(message: string): never {
  process.stderr.write(`botglass: ${message}\n`);
  process.exit(2);
}

function numberOption(
  value: string | undefined,
  name: string,
  fallback: number,
  min = 1,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    fail(`--${name} needs a number${min > 0 ? " greater than zero" : " of zero or more"}`);
  }
  return parsed;
}

function parseFailOn(value: string | undefined): Verdict[] {
  if (!value) return [];
  const out: Verdict[] = [];
  for (const part of value.split(",").map((v) => v.trim()).filter(Boolean)) {
    if (!isVerdict(part)) {
      fail(`unknown verdict "${part}". Known: ${VERDICTS.join(", ")}`);
    }
    out.push(part);
  }
  return out;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readUrlList(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8").catch((err: unknown) => {
    fail(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  });
  const urls = parseUrlList(text);
  if (urls.length === 0) fail(`${path} contains no URLs`);
  return urls;
}

async function main(argv: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        sitemap: { type: "string" },
        urls: { type: "string" },
        "max-pages": { type: "string" },
        bots: { type: "string" },
        render: { type: "boolean" },
        samples: { type: "boolean" },
        json: { type: "string" },
        html: { type: "string" },
        baseline: { type: "string" },
        "update-baseline": { type: "boolean" },
        compact: { type: "boolean" },
        "fail-on": { type: "string" },
        "max-js-only": { type: "string" },
        timeout: { type: "string" },
        delay: { type: "string" },
        concurrency: { type: "string" },
        "no-robots": { type: "boolean" },
        "no-color": { type: "boolean" },
        quiet: { type: "boolean" },
        "list-bots": { type: "boolean" },
        version: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  }

  const raw = parsed.values as Record<string, unknown>;
  const positionals = parsed.positionals;
  const str = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === "string" ? value : undefined;
  };
  const flag = (key: string): boolean => raw[key] === true;

  if (flag("help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (flag("version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (flag("list-bots")) {
    for (const bot of [...BOTS, BASELINE]) {
      process.stdout.write(`${bot.name.padEnd(16)} ${bot.owner}\n`);
    }
    return;
  }

  const sitemapArg = str("sitemap");
  const urlsArg = str("urls");
  const sources = [positionals.length > 0, sitemapArg !== undefined, urlsArg !== undefined].filter(
    Boolean,
  ).length;
  if (sources === 0) fail(`a URL, --sitemap or --urls is required\n\n${USAGE}`);
  if (sources > 1) fail("use only one of: a URL argument, --sitemap, --urls");

  const maxPages = Math.floor(numberOption(str("max-pages"), "max-pages", 10));
  const timeoutMs = Math.floor(numberOption(str("timeout"), "timeout", 15000));
  const delayMs = Math.floor(numberOption(str("delay"), "delay", 400, 0));
  const concurrency = Math.floor(numberOption(str("concurrency"), "concurrency", 1));
  const maxJsOnlyRaw = str("max-js-only");
  const maxJsOnly = maxJsOnlyRaw === undefined ? null : Number(maxJsOnlyRaw);
  if (maxJsOnly !== null && (!Number.isFinite(maxJsOnly) || maxJsOnly < 0 || maxJsOnly > 1)) {
    fail("--max-js-only needs a number between 0 and 1");
  }

  const botsArg = str("bots");
  const botNames = botsArg ? botsArg.split(",").map((b) => b.trim()).filter(Boolean) : [];
  let bots;
  try {
    bots = selectBots(botNames);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const wantsRender = flag("render") || maxJsOnly !== null;
  const warnings: string[] = [];

  let renderer: Renderer | null = null;
  if (wantsRender) {
    try {
      renderer = await createPlaywrightRenderer({ timeoutMs: Math.max(timeoutMs, 30000) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(message);
      process.stderr.write(`botglass: ${message}\n`);
    }
  }

  const urls: string[] = [];
  if (sitemapArg) {
    const sitemapSource = /^https?:\/\//i.test(sitemapArg) ? sitemapArg : `https://${sitemapArg}`;
    const loaded = await loadSitemap(sitemapSource, {
      userAgent: BASELINE.userAgent,
      timeoutMs,
      maxUrls: maxPages,
    });
    urls.push(...loaded.urls);
    warnings.push(...loaded.errors);
    if (urls.length === 0) {
      const detail = loaded.errors.length > 0 ? ` (${loaded.errors[0]})` : "";
      fail(`no URLs found in ${sitemapSource}${detail}`);
    }
  } else if (urlsArg) {
    urls.push(...(await readUrlList(urlsArg)).slice(0, maxPages));
  } else {
    if (positionals.length === 0) fail("a URL is required");
    for (const positional of positionals) {
      urls.push(/^https?:\/\//i.test(positional) ? positional : `https://${positional}`);
    }
    if (urls.length > maxPages) {
      warnings.push(
        `${positionals.length} URLs given, auditing the first ${maxPages} (raise --max-pages for more)`,
      );
      urls.length = maxPages;
    }
  }

  const options: AuditOptions = {
    timeoutMs,
    delayMs,
    maxBodyBytes: 3_000_000,
    checkRobots: !flag("no-robots"),
    renderer,
  };

  const startedAt = new Date();
  const pages = await mapPool<string, PageReport>(urls, concurrency, (url) =>
    auditUrl(url, bots, options),
  );

  const runOptions: RunOptions = {
    render: renderer !== null,
    maxPages,
    timeoutMs,
    concurrency,
    checkRobots: options.checkRobots,
    failOn: parseFailOn(str("fail-on")),
    maxJsOnly,
    bots: bots.map((b) => b.name),
  };

  const report = buildRunReport({ pages, options: runOptions, startedAt, warnings });
  const compact = flag("compact");

  const baselinePath = str("baseline");
  const updateBaseline = flag("update-baseline");
  if (updateBaseline && !baselinePath) fail("--update-baseline needs --baseline <file>");

  if (baselinePath) {
    let diff: BaselineDiff | null = null;
    let existing = null as ReturnType<typeof parseBaseline> | null;
    try {
      existing = parseBaseline(JSON.parse(await readFile(baselinePath, "utf8")));
    } catch (err) {
      if (updateBaseline) {
        warnings.push(`replacing unusable baseline at ${baselinePath}`);
      } else {
        warnings.push(
          `no usable baseline at ${baselinePath} (${err instanceof Error ? err.message : String(err)}); writing a new one`,
        );
      }
    }
    if (existing) diff = compareBaseline(existing, report);
    if (diff) report.changes = diff;
    await writeFile(baselinePath, `${JSON.stringify(buildBaseline(report), null, 2)}\n`, "utf8");
    if (!flag("quiet")) {
      process.stdout.write(
        `${existing ? "baseline updated" : "baseline written"}: ${baselinePath}\n`,
      );
    }
  }

  if (!flag("quiet")) {
    const color = !flag("no-color") && process.stdout.isTTY === true;
    const text = compact
      ? renderCompactText(report, { color })
      : renderRunText(report, { color, showSamples: flag("samples") });
    process.stdout.write(`${text}\n`);
  }

  const jsonPath = str("json");
  if (jsonPath) {
    const payload = compact ? compactRun(report) : report;
    await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    if (!flag("quiet")) process.stdout.write(`JSON written to ${jsonPath}\n`);
  }
  const htmlPath = str("html");
  if (htmlPath) {
    await writeFile(htmlPath, renderHtml(report), "utf8");
    if (!flag("quiet")) process.stdout.write(`HTML written to ${htmlPath}\n`);
  }

  if (report.gate.failed) {
    process.stderr.write(`\nbotglass gate failed (${summarise(report)}):\n`);
    for (const reason of report.gate.reasons) process.stderr.write(`  - ${reason}\n`);
    process.exit(1);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`botglass: ${message}\n`);
  process.exit(2);
});
