/**
 * AI Access Index: what the most-visited sites on the web actually tell AI crawlers.
 *
 * Two measurements per domain, both from the homepage's own robots.txt:
 *   1. may each crawler fetch "/"? (RFC 9309 as implemented in src/robots.ts)
 *   2. what does the site declare in Content-Usage? (src/aipref.ts)
 * plus one plain fetch of the homepage to see whether there is server-rendered text.
 *
 * Usage: node scripts/ai-access-index.mjs --domains /tmp/tranco.csv --limit 300 --out docs/ai-access-index
 * Writes <out>/ai-access-index.json and <out>/index.html. HTTP usage headers are not measured.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseRobots, isAllowed } from "../dist/src/robots.js";
import { resolveUsage } from "../dist/src/aipref.js";
import { BOTS, BASELINE } from "../dist/src/bots.js";
import { extractPage, countWords } from "../dist/src/html.js";

const VERSION = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const UA = `botglass/${VERSION} (AI access index; +https://github.com/yardworkdev/botglass)`;
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_000_000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const renderFrom = arg("render", "");
const domainsFile = arg("domains", "");
const limit = Number(arg("limit", "300"));
const outDir = arg("out", "docs/ai-access-index");
const concurrency = Number(arg("concurrency", "6"));

if (renderFrom) {
  const saved = JSON.parse(await readFile(renderFrom, "utf8"));
  const bots = [...BOTS, BASELINE].map((bot) => bot.name);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "index.html"), renderHtml(saved.summary, saved.rows, bots));
  console.error(`re-rendered ${outDir}/index.html from ${renderFrom}`);
  process.exit(0);
}

if (!domainsFile) {
  console.error("usage: node scripts/ai-access-index.mjs --domains <tranco.csv> [--limit 300] [--out docs/ai-access-index]");
  console.error("       node scripts/ai-access-index.mjs --render reports/ai-access-index.json [--out docs/ai-access-index]");
  process.exit(2);
}

const raw = await readFile(domainsFile, "utf8");
const domains = raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .slice(0, limit)
  .map((line) => {
    const [, host] = line.split(",");
    return (host ?? line).trim().toLowerCase();
  });

async function get(url, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept },
    });
    const buffer = await response.arrayBuffer();
    const body = Buffer.from(buffer.slice(0, MAX_BYTES)).toString("utf8");
    return { status: response.status, body, finalUrl: response.url };
  } catch (error) {
    return { status: null, body: "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function measure(domain) {
  const base = `https://${domain}`;
  const robots = await get(`${base}/robots.txt`, "text/plain");
  const home = await get(`${base}/`, "text/html");

  const result = {
    domain,
    robotsStatus: robots.status,
    homeStatus: home.status,
    words: 0,
    blocked: {},
    trainAi: null,
    signals: [],
    malformed: [],
    errors: [],
  };
  if (robots.status === null) result.errors.push(`robots: ${robots.error}`);
  if (home.status === null) result.errors.push(`home: ${home.error}`);

  if (home.status && home.status >= 200 && home.status < 300) {
    const page = extractPage(home.body);
    result.words = countWords(page.text);
    result.title = page.title;
  }

  if (robots.status && robots.status >= 200 && robots.status < 300 && robots.body.trim()) {
    const groups = parseRobots(robots.body);
    for (const bot of [...BOTS, BASELINE]) {
      const decision = isAllowed(groups, "/", bot.robotsToken);
      result.blocked[bot.name] = decision.allowed ? false : true;
    }
    result.rawDeclaresContentUsage = /^content-usage\s*:/im.test(robots.body);
    const usage = resolveUsage(groups, "/", BASELINE.robotsToken);
    result.trainAi = usage.trainAi;
    result.unknownCategories = usage.unknownCategories;
    result.signals = usage.signals.map((signal) => `${signal.category}=${signal.value}`);
    result.malformed = usage.malformed;
  }

  return result;
}

async function pool(items, worker, size) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
      if ((index + 1) % 25 === 0) console.error(`  ${index + 1}/${items.length}`);
    }
  });
  await Promise.all(workers);
  return results;
}

console.error(`measuring ${domains.length} domains, concurrency ${concurrency}`);
const started = Date.now();
const rows = await pool(domains, measure, concurrency);

const bots = [...BOTS, BASELINE].map((bot) => bot.name);
const aiBots = BOTS.filter((bot) => bot.robotsToken !== "Googlebot");

function share(count, total) {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

const answered = rows.filter((row) => row.robotsStatus && row.robotsStatus >= 200 && row.robotsStatus < 300);
const homeOk = rows.filter((row) => row.homeStatus && row.homeStatus >= 200 && row.homeStatus < 300);

const summary = {
  measurementScope: "robots.txt only; HTTP Content-Usage headers not measured",
  parserCorrected: true,
  generatedAt: new Date().toISOString(),
  tool: "botglass",
  version: VERSION,
  sample: {
    source: "Tranco list",
    domainsRequested: domains.length,
    robotsFound: answered.length,
    homepagesFetched: homeOk.length,
  },
  perBot: Object.fromEntries(
    aiBots.map((bot) => [
      bot.name,
      { blocked: rows.filter((row) => row.blocked[bot.name] === true).length },
    ]),
  ),
  anyAiBotBlocked: rows.filter((row) => aiBots.some((bot) => row.blocked[bot.name] === true)).length,
  allAiBotsBlocked: rows.filter((row) => aiBots.every((bot) => row.blocked[bot.name] === true)).length,
  googlebotBlocked: rows.filter((row) => row.blocked.Googlebot === true).length,
  contentUsage: {
    declared: rows.filter((row) => row.trainAi !== null).length,
    trainAiNo: rows.filter((row) => row.trainAi === "n").length,
    trainAiYes: rows.filter((row) => row.trainAi === "y").length,
    trainAiUnknown: rows.filter((row) => row.rawDeclaresContentUsage && row.trainAi === null).length,
    malformed: rows.filter((row) => row.malformed.length > 0).length,
    rawLinesSeen: rows.filter((row) => row.rawDeclaresContentUsage === true).length,
    unknownCategoryDomains: rows
      .filter((row) => (row.unknownCategories ?? []).length > 0)
      .map((row) => `${row.domain} (${(row.unknownCategories ?? []).join(", ")})`),
  },
  homepages: {
    medianWords: median(homeOk.map((row) => row.words)),
    under50Words: homeOk.filter((row) => row.words < 50).length,
    zeroWords: homeOk.filter((row) => row.words === 0).length,
  },
  durationSeconds: Math.round((Date.now() - started) / 1000),
};

summary.percentages = {
  anyAiBotBlocked: share(summary.anyAiBotBlocked, answered.length),
  allAiBotsBlocked: share(summary.allAiBotsBlocked, answered.length),
  contentUsageDeclared: share(summary.contentUsage.declared, answered.length),
  homepagesUnder50Words: share(summary.homepages.under50Words, homeOk.length),
};

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "ai-access-index.json"), JSON.stringify({ summary, rows }, null, 2));
await writeFile(join(outDir, "index.html"), renderHtml(summary, rows, bots));
console.log(JSON.stringify(summary, null, 2));

function esc(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

function renderHtml(sum, allRows, allBots) {
  const aiBots = BOTS.filter((bot) => bot.robotsToken !== "Googlebot");
  const blockedRows = allRows
    .filter((row) => row.robotsStatus && row.robotsStatus >= 200 && row.robotsStatus < 300)
    .sort((a, b) => {
      const countA = aiBots.filter((bot) => a.blocked[bot.name]).length;
      const countB = aiBots.filter((bot) => b.blocked[bot.name]).length;
      return countB - countA || a.domain.localeCompare(b.domain);
    });

  const botRows = aiBots
    .map((bot) => {
      const entry = sum.perBot[bot.name];
      const pct = share(entry.blocked, sum.sample.robotsFound);
      return `<tr><td>${esc(bot.name)}</td><td>${entry.blocked}</td><td>${pct}%</td><td><div class="bar"><span style="width:${pct}%"></span></div></td></tr>`;
    })
    .join("");

  const siteRows = blockedRows
    .map(
      (row) =>
        `<tr><td>${esc(row.domain)}</td><td>${aiBots.map((bot) => (row.blocked[bot.name] ? "✕" : "·")).join(" ")}</td><td>${row.trainAi ?? "—"}</td><td>${row.words}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AI Access Index — botglass</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--fg:#111;--dim:#666;--line:#e5e5e5;--bg:#fff;--accent:#0b6}
@media(prefers-color-scheme:dark){:root{--fg:#eee;--dim:#999;--line:#2a2a2a;--bg:#161616}}
body{font:16px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--fg);background:var(--bg);max-width:56rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
h1{font-size:1.9rem;margin:0 0 .25rem}h2{font-size:1.15rem;margin:2.5rem 0 .75rem}
p.lede{color:var(--dim);margin:0 0 2rem}
.big{display:flex;gap:2.5rem;flex-wrap:wrap;margin:1.5rem 0 2rem}
.big div{min-width:9rem}
.big b{display:block;font-size:2rem;line-height:1.1}
.big span{color:var(--dim);font-size:.85rem}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid var(--line)}
th{font-weight:600;color:var(--dim);font-size:.8rem;text-transform:uppercase;letter-spacing:.03em}
.bar{background:var(--line);height:.5rem;border-radius:.25rem;min-width:6rem}
.bar span{display:block;height:100%;background:var(--accent);border-radius:.25rem}
code{font-size:.9em}
footer{margin-top:3rem;color:var(--dim);font-size:.85rem}
.scroll{overflow-x:auto}
</style></head><body>
<h1>AI Access Index</h1>
<p class="lede">What the ${sum.sample.domainsRequested} most-visited domains on the web tell AI crawlers, measured on ${sum.generatedAt.slice(0, 10)}. Sample: Tranco, ${sum.sample.robotsFound} robots.txt files answered.</p>

<div class="big">
  <div><b>${sum.percentages.anyAiBotBlocked}%</b><span>of retrieved robots responses block at least one measured AI crawler</span></div>
  <div><b>${sum.percentages.allAiBotsBlocked}%</b><span>of retrieved robots responses block every measured AI crawler</span></div>
  <div><b>robots.txt only</b><span>HTTP usage headers were not measured</span></div>
  <div><b>${sum.percentages.homepagesUnder50Words}%</b><span>homepages under 50 words of text</span></div>
</div>

<h2>Blocked per crawler</h2>
<table><thead><tr><th>Crawler</th><th>Domains</th><th>Share</th><th></th></tr></thead><tbody>${botRows}</tbody></table>

<h2>Training preferences: robots.txt only</h2>
<p><strong>Correction:</strong> This edition checked robots.txt only, not HTTP <code>Content-Usage</code> response headers. Its original “0%” headline is not a measurement of overall adoption. ${sum.parserCorrected ? "This measurement uses the corrected parser but still measures robots.txt only." : "The saved results below were produced by the original parser; raw robots.txt bodies were not retained, so parser corrections cannot be applied retroactively without a new measurement."}</p>
<p>${sum.parserCorrected ? "The parser" : "The original parser"} recorded ${sum.contentUsage.declared} recognised <code>train-ai</code> preferences for <code>/</code> in ${sum.sample.robotsFound} retrieved robots.txt responses. ${sum.parserCorrected ? "This is a robots.txt-only result, not an overall adoption estimate." : "This is a historical result, not a corrected adoption estimate."} ${sum.contentUsage.rawLinesSeen ?? 0} responses contained a Content-Usage line; ${sum.contentUsage.unknownCategoryDomains?.length ? `unrecognised labels were recorded for ${esc(sum.contentUsage.unknownCategoryDomains.join("; "))}.` : ""}</p>
<p>Crawl permission and usage preference are separate: allowing retrieval while declining training is valid, not a contradiction. These observations do not establish whether a crawler follows a preference.</p>

<h2>How this was measured</h2>
<ul>
  <li>Sample: the first ${sum.sample.domainsRequested} domains of the Tranco list (${esc(sum.sample.source)}, ${esc(sum.generatedAt.slice(0, 10))}).</li>
  <li>One <code>GET /robots.txt</code> and one <code>GET /</code> per domain, ${esc(String(sum.durationSeconds))} seconds total, no JavaScript executed.</li>
  <li>A crawler counts as blocked when robots.txt disallows <code>/</code> for its token under the RFC 9309 rules botglass implements (longest match wins, <code>*</code> groups, crawl-delay ignored).</li>
  <li><code>Content-Usage</code> is read from the group that applies to a generic crawler for <code>/</code>, per the IETF <code>aipref</code> draft. Absent is not <code>n</code>.</li>
  <li>Word counts are the text in the raw HTML — what a crawler that does not run JavaScript receives.</li>
  <li>Limits: robots.txt can allow a crawler that never shows up, and can block one that ignores it. This measures declared access, not observed traffic. ${sum.sample.domainsRequested - sum.sample.robotsFound} domains did not return a successful robots.txt response; failures, denied requests and missing files are not evidence of absence.</li>
</ul>

<h2>Per domain</h2>
<div class="scroll"><table><thead><tr><th>Domain</th><th>${aiBots.map((bot) => esc(bot.name.slice(0, 4))).join(" ")}</th><th>train-ai</th><th>words</th></tr></thead><tbody>${siteRows}</tbody></table></div>

<footer>Measured with botglass ${esc(sum.version)} on ${esc(sum.generatedAt)}. ${sum.parserCorrected ? "robots.txt results evaluated for / by the corrected parser" : "historical robots.txt results evaluated for / by the original parser"}; Content-Usage read from the group that applies to a generic crawler. Homepage word counts come from the raw HTML, no JavaScript. Raw data: <a href="ai-access-index.json">ai-access-index.json</a> &middot; measured with <a href="https://github.com/yardworkdev/botglass">botglass</a>.</footer>
</body></html>`;
}
