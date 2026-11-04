import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASELINE_SCHEMA_VERSION,
  buildBaseline,
  compareBaseline,
  describeChange,
  parseBaseline,
} from "../src/baseline.js";
import { buildRunReport } from "../src/report/run.js";
import { makePage } from "./build.js";
import type { RunOptions } from "../src/types.js";

const options: RunOptions = {
  render: false,
  maxPages: 10,
  timeoutMs: 5000,
  concurrency: 1,
  checkRobots: true,
  failOn: [],
  maxJsOnly: null,
  bots: ["GPTBot", "ClaudeBot"],
};

function report(pages: ReturnType<typeof makePage>[], finishedAt = "2026-11-04T10:00:00.000Z") {
  return buildRunReport({
    pages,
    options,
    startedAt: new Date("2026-11-04T09:59:00.000Z"),
    finishedAt: new Date(finishedAt),
  });
}

test("a baseline keeps verdicts and word counts, never page text", () => {
  const baseline = buildBaseline(
    report([
      makePage({
        url: "https://example.com/a",
        verdicts: [
          ["GPTBot", "js-dependent"],
          ["ClaudeBot", "ok"],
        ],
      }),
    ]),
  );
  assert.equal(baseline.schemaVersion, BASELINE_SCHEMA_VERSION);
  assert.equal(baseline.tool, "botglass");
  assert.equal(baseline.pages.length, 1);
  const page = baseline.pages[0];
  assert.equal(page?.url, "https://example.com/a");
  assert.deepEqual(
    page?.bots.map((bot) => [bot.bot, bot.verdict]),
    [
      ["GPTBot", "js-dependent"],
      ["ClaudeBot", "ok"],
    ],
  );
  assert.ok(!JSON.stringify(baseline).includes("x x x"), "page text must not leak into the baseline");
});

test("an unchanged run reports no changes", () => {
  const before = buildBaseline(report([makePage({ verdicts: [["GPTBot", "ok"]] })]));
  const after = report([makePage({ verdicts: [["GPTBot", "ok"]] })], "2026-11-05T10:00:00.000Z");
  const diff = compareBaseline(before, after);
  assert.equal(diff.comparable, true);
  assert.deepEqual(diff.changes, []);
  assert.deepEqual(diff.newPages, []);
  assert.deepEqual(diff.missingPages, []);
});

test("a verdict regression is reported with the bot that changed", () => {
  const before = buildBaseline(report([makePage({ verdicts: [["ClaudeBot", "ok"]] })]));
  const after = report([makePage({ verdicts: [["ClaudeBot", "js-dependent"]] })], "2026-11-05T10:00:00.000Z");
  const diff = compareBaseline(before, after);
  const verdictChange = diff.changes.find((change) => change.field === "verdict");
  assert.ok(verdictChange);
  assert.equal(verdictChange?.bot, "ClaudeBot");
  assert.equal(verdictChange?.from, "ok");
  assert.equal(verdictChange?.to, "js-dependent");
});

test("a word-count drop and an HTTP change are both reported", () => {
  const before = buildBaseline(report([makePage({ verdicts: [["GPTBot", "ok"]], httpStatus: 200 })]));
  const after = report([
    makePage({ verdicts: [["GPTBot", "ok"]], httpStatus: 503, botStatuses: { GPTBot: 503 } }),
  ]);
  const diff = compareBaseline(before, after);
  const status = diff.changes.find((change) => change.field === "status");
  assert.equal(status?.from, "200");
  assert.equal(status?.to, "503");
});

test("new and missing pages are named, not silently ignored", () => {
  const before = buildBaseline(report([makePage({ url: "https://example.com/old" })]));
  const after = report([makePage({ url: "https://example.com/new" })]);
  const diff = compareBaseline(before, after);
  assert.deepEqual(diff.newPages, ["https://example.com/new"]);
  assert.deepEqual(diff.missingPages, ["https://example.com/old"]);
});

test("query strings and hashes do not break matching", () => {
  const before = buildBaseline(report([makePage({ url: "https://example.com/a?x=1" })]));
  const after = report([makePage({ url: "https://example.com/a?x=1#section" })]);
  assert.deepEqual(compareBaseline(before, after).changes, []);
});

test("a file that is not a baseline is rejected", () => {
  assert.throws(() => parseBaseline({ pages: [] }), /tool/);
  assert.throws(() => parseBaseline(null), /object/);
  assert.throws(() => parseBaseline({ tool: "botglass" }), /pages/);
});

test("changes read as a sentence a human or agent can act on", () => {
  assert.equal(
    describeChange({ url: "u", bot: "ClaudeBot", field: "verdict", from: "ok", to: "js-dependent" }),
    " ClaudeBot: ok → js-dependent",
  );
  assert.equal(describeChange({ url: "u", bot: "GPTBot", field: "words", from: "80", to: "3" }), " GPTBot: 80 → 3 words");
  assert.equal(describeChange({ url: "u", field: "status", from: "200", to: "503" }), "HTTP: 200 → 503");
});
