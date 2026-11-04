import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunReport, countVerdicts, evaluateGate } from "../src/report/run.js";
import type { BotResult, PageReport, RunOptions, Verdict } from "../src/types.js";

function bot(name: string, verdict: Verdict): BotResult {
  return {
    bot: name,
    status: 200,
    finalUrl: "https://example.com/",
    redirects: [],
    durationMs: 5,
    htmlBytes: 10,
    title: "t",
    description: "",
    text: "text",
    wordCount: 1,
    robots: { available: false, allowed: true, rule: null, robotsUrl: "u", status: 404 },
    similarityToBaseline: 1,
    error: null,
  };
}

function page(url: string, verdicts: Array<[string, Verdict]>, jsRatio: number | null): PageReport {
  return {
    url,
    fetchedAt: "2026-11-03T10:00:00.000Z",
    httpStatus: 200,
    robotsUrl: "https://example.com/robots.txt",
    robotsStatus: 200,
    baseline: bot("baseline", "ok"),
    bots: verdicts.map(([name]) => bot(name, "ok")),
    render: jsRatio === null ? null : { ok: true, error: null, text: "", wordCount: 10, title: "" },
    jsOnly:
      jsRatio === null
        ? null
        : {
            renderedWords: 100,
            rawWords: 10,
            missingWords: Math.round(jsRatio * 100),
            ratio: jsRatio,
            sample: [],
          },
    verdicts: verdicts.map(([name, verdict]) => ({
      bot: name,
      verdict,
      reason: "test",
      confidence: "measured" as const,
    })),
    findings: [],
    usage: { signals: [], trainAi: null, source: null, malformed: [], unknownCategories: [] },
    advice: [],
  };
}

const options: RunOptions = {
  render: false,
  maxPages: 10,
  timeoutMs: 5000,
  concurrency: 1,
  checkRobots: true,
  failOn: [],
  maxJsOnly: null,
  bots: ["GPTBot"],
};

test("counts tally every verdict across pages", () => {
  const counts = countVerdicts([
    page("https://a/", [["GPTBot", "ok"], ["ClaudeBot", "js-dependent"]], null),
    page("https://b/", [["GPTBot", "ua-blocked"]], null),
  ]);
  assert.equal(counts.ok, 1);
  assert.equal(counts["js-dependent"], 1);
  assert.equal(counts["ua-blocked"], 1);
  assert.equal(counts.error, 0);
});

test("an empty fail-on list passes", () => {
  const gate = evaluateGate({ pages: [page("https://a/", [["GPTBot", "error"]], null)], failOn: [], maxJsOnly: null });
  assert.equal(gate.failed, false);
  assert.deepEqual(gate.reasons, []);
});

test("fail-on names the page and the bot", () => {
  const gate = evaluateGate({
    pages: [page("https://a/", [["GPTBot", "js-dependent"]], null)],
    failOn: ["js-dependent"],
    maxJsOnly: null,
  });
  assert.equal(gate.failed, true);
  assert.match(gate.reasons[0] ?? "", /https:\/\/a\/ — GPTBot: js-dependent/);
});

test("max-js-only compares the ratio, not the word count", () => {
  const under = evaluateGate({
    pages: [page("https://a/", [], 0.4)],
    failOn: [],
    maxJsOnly: 0.5,
  });
  assert.equal(under.failed, false);

  const over = evaluateGate({
    pages: [page("https://a/", [], 0.8)],
    failOn: [],
    maxJsOnly: 0.5,
  });
  assert.equal(over.failed, true);
  assert.match(over.reasons[0] ?? "", /80% of the rendered text is JavaScript-only/);
});

test("a page with no render cannot trip the js-only gate", () => {
  const gate = evaluateGate({
    pages: [page("https://a/", [], null)],
    failOn: [],
    maxJsOnly: 0.01,
  });
  assert.equal(gate.failed, false);
});

test("the run report carries tool, version, timestamps and gate", () => {
  const started = new Date("2026-11-03T10:00:00.000Z");
  const report = buildRunReport({
    pages: [page("https://a/", [["GPTBot", "ok"]], null)],
    options: { ...options, failOn: ["error"] },
    startedAt: started,
    finishedAt: new Date("2026-11-03T10:00:05.000Z"),
    warnings: ["one warning"],
  });
  assert.equal(report.tool, "botglass");
  assert.match(report.version, /^\d+\.\d+\.\d+$/);
  assert.equal(report.startedAt, "2026-11-03T10:00:00.000Z");
  assert.equal(report.finishedAt, "2026-11-03T10:00:05.000Z");
  assert.deepEqual(report.warnings, ["one warning"]);
  assert.equal(report.gate.failed, false);
});
