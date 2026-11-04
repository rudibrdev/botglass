import assert from "node:assert/strict";
import { test } from "node:test";
import { compactRun, worstVerdict, COMPACT_SCHEMA_VERSION } from "../src/report/compact.js";
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

function run(pages: ReturnType<typeof makePage>[]) {
  return buildRunReport({
    pages,
    options,
    startedAt: new Date("2026-11-04T09:59:00.000Z"),
    finishedAt: new Date("2026-11-04T10:00:00.000Z"),
  });
}

test("the compact report carries no page text", () => {
  const report = run([
    makePage({
      url: "https://example.com/long",
      baselineWords: 400,
      verdicts: [
        ["GPTBot", "js-dependent"],
        ["ClaudeBot", "ok"],
      ],
    }),
  ]);
  const compact = compactRun(report);
  const serialised = JSON.stringify(compact);
  assert.ok(compact.pages[0]?.bots.every((bot) => !("text" in bot)));
  assert.ok(!serialised.includes("x x x"), "no page text in the compact projection");
  assert.ok(serialised.length < JSON.stringify(report).length / 4, "compact must be far smaller");
  assert.equal(compact.schemaVersion, COMPACT_SCHEMA_VERSION);
});

test("the compact report keeps what an agent acts on", () => {
  const report = run([
    makePage({
      url: "https://example.com/a",
      verdicts: [
        ["GPTBot", "js-dependent"],
        ["ClaudeBot", "js-dependent"],
      ],
    }),
  ]);
  const page = compactRun(report).pages[0];
  assert.equal(page?.worst, "js-dependent");
  assert.match(page?.advice[0] ?? "", /server-render/);
  assert.deepEqual(
    page?.bots.map((bot) => [bot.bot, bot.verdict, bot.words]),
    [
      ["GPTBot", "js-dependent", 3],
      ["ClaudeBot", "js-dependent", 3],
    ],
  );
});

test("worstVerdict picks the most serious, not the last", () => {
  assert.equal(worstVerdict(makePage({ verdicts: [["A", "ok"], ["B", "js-dependent"], ["C", "ok"]] })), "js-dependent");
  assert.equal(worstVerdict(makePage({ verdicts: [["A", "cloaked"], ["B", "error"]] })), "error");
  assert.equal(worstVerdict(makePage({ verdicts: [["A", "ok"]] })), "ok");
});

test("changes survive the projection", () => {
  const report = run([makePage({ url: "https://example.com/a" })]);
  report.changes = {
    createdAt: "2026-11-03T10:00:00.000Z",
    changes: [{ url: "https://example.com/a", bot: "GPTBot", field: "verdict", from: "ok", to: "cloaked" }],
    newPages: [],
    missingPages: [],
    comparable: true,
  };
  const compact = compactRun(report);
  assert.equal(compact.changes?.changes[0]?.to, "cloaked");
  assert.equal(compact.changes?.since, "2026-11-03T10:00:00.000Z");
});

test("the full report still carries a schema version", () => {
  assert.equal(run([makePage()]).schemaVersion, 1);
});
