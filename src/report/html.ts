/**
 * Static HTML report: one file, no external assets, no JavaScript.
 *
 * It has to survive being emailed, committed or dropped on a static host, so
 * everything is inline and every number shown is the one the verdict used.
 */

import type { PageReport, RunReport, Verdict } from "../types.js";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const VERDICT_COPY: Record<Verdict, { label: string; hint: string }> = {
  ok: { label: "ok", hint: "server-rendered and allowed" },
  "js-dependent": {
    label: "js-dependent",
    hint: "content needs JavaScript, which this crawler does not run",
  },
  cloaked: { label: "cloaked", hint: "different text than a browser gets" },
  "robots-blocked": { label: "robots-blocked", hint: "robots.txt asks it to stay away" },
  "ua-blocked": { label: "ua-blocked", hint: "server refuses the bot user agent" },
  error: { label: "error", hint: "fetch failed or the page itself fails" },
};

const CSS = `
:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#16181d;--muted:#5c6470;--line:#e3e4e8;--card:#fff;
--ok:#0f7b3f;--okbg:#e6f5ec;--warn:#8a5a00;--warnbg:#fdf1d8;--bad:#a3231d;--badbg:#fbe7e6;--info:#125c8a;--infobg:#e4f1fa}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e9eaee;--muted:#a2a9b6;--line:#2a2e37;--card:#1b1e24;
--ok:#57d68f;--okbg:#15301f;--warn:#f0c164;--warnbg:#33280f;--bad:#ff8b80;--badbg:#3a1c1a;--info:#7cc4ec;--infobg:#12293a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:18px;margin:0}
a{color:inherit}
.sub{color:var(--muted);margin:0 0 24px}
.counts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 28px;padding:0;list-style:none}
.counts li{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:4px 12px;font-size:13px}
.page{border:1px solid var(--line);background:var(--card);border-radius:12px;padding:18px 18px 6px;margin:0 0 20px}
.page h2{overflow-wrap:anywhere}
.meta{color:var(--muted);font-size:13px;margin:6px 0 14px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 14px}
th{text-align:left;font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;
border-bottom:1px solid var(--line);padding:0 8px 6px 0}
td{border-bottom:1px solid var(--line);padding:7px 8px 7px 0;vertical-align:top}
tr:last-child td{border-bottom:none}
.badge{display:inline-block;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:600;white-space:nowrap}
.v-ok{color:var(--ok);background:var(--okbg)}
.v-js-dependent,.v-cloaked{color:var(--warn);background:var(--warnbg)}
.v-robots-blocked{color:var(--info);background:var(--infobg)}
.v-ua-blocked,.v-error{color:var(--bad);background:var(--badbg)}
.reason{color:var(--muted);font-size:13px}
.findings{list-style:none;padding:0;margin:0 0 16px}
.findings li{padding:8px 12px;border-radius:8px;margin:0 0 6px;font-size:14px;background:var(--infobg);color:var(--info)}
.findings li.warn{background:var(--warnbg);color:var(--warn)}
.findings li.error{background:var(--badbg);color:var(--bad)}
details{margin:0 0 14px;font-size:14px}
summary{cursor:pointer;color:var(--muted)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;overflow-wrap:anywhere}
footer{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px;margin-top:8px}
`;

function verdictBadge(verdict: Verdict): string {
  const copy = VERDICT_COPY[verdict];
  return `<span class="badge v-${verdict}" title="${escapeHtml(copy.hint)}">${copy.label}</span>`;
}

function renderPage(page: PageReport): string {
  const rows = page.verdicts
    .map((verdict) => {
      const bot = page.bots.find((b) => b.bot === verdict.bot);
      const status = bot?.status ?? "-";
      const words = bot ? bot.wordCount : "-";
      return `<tr><td><code>${escapeHtml(verdict.bot)}</code></td><td>${status}</td><td>${words}</td><td>${verdictBadge(
        verdict.verdict,
      )}</td><td class="reason">${escapeHtml(verdict.reason)}</td></tr>`;
    })
    .join("\n");

  const findings = page.findings
    .map(
      (f) =>
        `<li class="${f.level === "info" ? "" : f.level}">${escapeHtml(f.message)}</li>`,
    )
    .join("\n");

  const samples =
    page.jsOnly && page.jsOnly.sample.length > 0
      ? `<details><summary>Text that only exists after JavaScript runs (${page.jsOnly.missingWords} words missing)</summary><ul>${page.jsOnly.sample
          .map((s) => `<li>${escapeHtml(s)}</li>`)
          .join("")}</ul></details>`
      : "";

  const robots = page.bots[0]?.robots;
  const robotsLine = robots
    ? robots.available
      ? `robots.txt <code>${escapeHtml(page.robotsUrl)}</code> (HTTP ${page.robotsStatus ?? "?"}) is read for each bot.`
      : `no robots.txt at <code>${escapeHtml(page.robotsUrl)}</code> (HTTP ${page.robotsStatus ?? "no response"}), so everything is allowed.`
    : "";

  const renderedWords = page.jsOnly?.renderedWords ?? page.render?.wordCount;
  const rendered = page.render?.ok && renderedWords !== undefined
    ? ` · rendered ${renderedWords} words`
    : "";

  return `<section class="page">
  <h2><a href="${escapeHtml(page.url)}">${escapeHtml(page.url)}</a></h2>
  <p class="meta">HTTP ${page.httpStatus ?? "no response"} · ${page.baseline.wordCount} words in the raw HTML${rendered} · checked ${escapeHtml(
    page.fetchedAt,
  )}</p>
  <table>
    <thead><tr><th>crawler</th><th>status</th><th>words</th><th>verdict</th><th>why</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <ul class="findings">
${findings}
  </ul>
  ${samples}
  <p class="meta">${robotsLine}</p>
</section>`;
}

export function renderHtml(report: RunReport): string {
  const counts = Object.entries(report.counts)
    .filter(([, n]) => n > 0)
    .map(([verdict, n]) => `<li>${n} × ${verdictBadge(verdict as Verdict)}</li>`)
    .join("");

  const gate = report.gate.failed
    ? `<ul class="findings">${report.gate.reasons
        .map((r) => `<li class="error">${escapeHtml(r)}</li>`)
        .join("")}</ul>`
    : `<p class="meta">Gate: passed (no failing verdicts).</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${report.tool} report — ${report.pages.length} page(s)</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${report.tool} ${escapeHtml(report.version)}</h1>
<p class="sub">${report.pages.length} page(s) fetched as a browser and as ${report.pages[0]?.bots.length ?? 0} crawlers · render ${
    report.options.render ? "on" : "off"
  } · ${escapeHtml(report.startedAt)}</p>
<ul class="counts">${counts}</ul>
${gate}
${report.pages.map(renderPage).join("\n")}
<footer>
Verdicts are heuristics unless marked otherwise: <strong>js-dependent</strong> compares the raw HTML with a
rendered DOM, <strong>cloaked</strong> compares word similarity against a plain-browser fetch. User-Agent strings
are published by each vendor and dated in the README. Generated ${escapeHtml(report.finishedAt)}.
</footer>
</main>
</body>
</html>
`;
}
