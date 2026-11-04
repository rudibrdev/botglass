import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml, escapeHtml } from "../src/report/html.js";
import { renderRunText, summarise } from "../src/report/text.js";
import { buildRunReport } from "../src/report/run.js";
import type { PageReport, RunOptions } from "../src/types.js";
import { VERSION } from "../src/version.js";

const options: RunOptions = {
  render: true,
  maxPages: 3,
  timeoutMs: 5000,
  concurrency: 1,
  checkRobots: true,
  failOn: [],
  maxJsOnly: null,
  bots: ["GPTBot", "ClaudeBot"],
};

function report() {
  const page: PageReport = {
    url: "https://example.com/a?x=1&y=<script>alert(1)</script>",
    fetchedAt: "2026-11-03T10:00:00.000Z",
    httpStatus: 200,
    robotsUrl: "https://example.com/robots.txt",
    robotsStatus: 200,
    baseline: {
      bot: "baseline",
      status: 200,
      finalUrl: "https://example.com/a",
      redirects: [],
      durationMs: 12,
      htmlBytes: 4000,
      title: "A page",
      description: "",
      text: "body text",
      wordCount: 2,
      robots: { available: true, allowed: true, rule: null, robotsUrl: "u", status: 200 },
      similarityToBaseline: null,
      error: null,
    },
    bots: [
      {
        bot: "GPTBot",
        status: 200,
        finalUrl: "https://example.com/a",
        redirects: [],
        durationMs: 15,
        htmlBytes: 4000,
        title: "A page",
        description: "",
        text: "body text",
        wordCount: 2,
        robots: { available: true, allowed: true, rule: null, robotsUrl: "u", status: 200 },
        similarityToBaseline: 1,
        error: null,
      },
    ],
    render: { ok: true, error: null, text: "rendered", wordCount: 30, title: "A page" },
    jsOnly: { renderedWords: 30, rawWords: 2, missingWords: 20, ratio: 0.66, sample: ["Only after JS."] },
    verdicts: [
      {
        bot: "GPTBot",
        verdict: "js-dependent",
        reason: "66% of the rendered words are missing from the raw HTML",
        confidence: "measured",
      },
    ],
    findings: [{ level: "warn", message: 'Found <img src=x onerror="alert(1)"> in a finding' }],
    usage: { signals: [], trainAi: null, source: null, malformed: [] },
    advice: ["Server-render the text in the HTML."],
  };
  return buildRunReport({ pages: [page], options, startedAt: new Date("2026-11-03T10:00:00.000Z") });
}

test("html escaping covers the five dangerous characters", () => {
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

test("the HTML report is standalone and escapes page content", () => {
  const html = renderHtml(report());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.match(html, /class="badge v-js-dependent"/);
  assert.match(html, /Only after JS\./);
  assert.doesNotMatch(html, /https?:\/\/[^"']+\.css/, "no external stylesheets");
});

test("the HTML report states the render status and gate result", () => {
  const html = renderHtml(report());
  assert.match(html, /render on/);
  assert.match(html, /Gate: passed/);
});

test("the text report shows one row per bot with its verdict", () => {
  const text = renderRunText(report(), { color: false, showSamples: true });
  assert.match(text, new RegExp(`botglass ${VERSION.replace(/\./g, "\\.")}`));
  assert.match(text, /GPTBot/);
  assert.match(text, /js-dependent/);
  assert.match(text, /Only after JS\./);
  assert.doesNotMatch(text, /\u001b\[/, "no escape codes when color is off");
});

test("the bot column widens for long crawler names", () => {
  const run = report();
  const page = run.pages[0];
  assert.ok(page);
  page.verdicts = [
    {
      bot: "meta-externalagent",
      verdict: "ok",
      reason: "server-rendered content, bot allowed",
      confidence: "measured",
    },
  ];
  const first = page.bots[0];
  assert.ok(first);
  page.bots = [{ ...first, bot: "meta-externalagent" }];
  const text = renderRunText(run, { color: false });
  assert.match(
    text,
    /meta-externalagent 200/,
    "an 18-character name must not run into the status column",
  );
});

test("summarise lists only verdicts that occurred", () => {
  assert.equal(summarise(report()), "1 js-dependent");
});
