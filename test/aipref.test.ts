/**
 * Content-Usage: the shared AI usage preference signal.
 *
 * The standard is days old and voluntary, so the tests here pin the parsing and
 * the precedence rules rather than any provider's behaviour.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUsageSignals, parseUsageValue, resolveUsage, describeUsage } from "../src/aipref.js";
import { parseRobots } from "../src/robots.js";
import { makePage as build } from "./build.js";

test("a single category=value pair parses", () => {
  assert.deepEqual(parseUsageSignals("train-ai=n"), {
    signals: [{ category: "train-ai", value: "n" }],
    malformed: [],
  });
});

test("several categories in one line parse, whitespace and case ignored", () => {
  const parsed = parseUsageSignals(" Train-AI = N , search=Y ");
  assert.deepEqual(parsed.signals, [
    { category: "train-ai", value: "n" },
    { category: "search", value: "y" },
  ]);
  assert.deepEqual(parsed.malformed, []);
});

test("values other than y, n, u are reported, not guessed", () => {
  const parsed = parseUsageSignals("train-ai=maybe,broken,search=y,eval=x");
  assert.deepEqual(parsed.signals, [{ category: "search", value: "y" }]);
  assert.deepEqual(parsed.malformed, ["train-ai=maybe", "broken", "eval=x"]);
});

test("parseUsageValue only accepts the three documented values", () => {
  assert.equal(parseUsageValue("y"), "y");
  assert.equal(parseUsageValue("N"), "n");
  assert.equal(parseUsageValue("u"), "u");
  assert.equal(parseUsageValue("yes"), null);
  assert.equal(parseUsageValue(""), null);
});

test("Content-Usage is kept on its robots.txt group, not dropped as unknown", () => {
  const groups = parseRobots("User-agent: *\nAllow: /\nContent-Usage: train-ai=n\n");
  assert.deepEqual(groups[0]?.contentUsage, ["train-ai=n"]);
  assert.equal(groups[0]?.rules.length, 1);
});

test("a group that only declares Content-Usage still counts", () => {
  const groups = parseRobots("User-agent: *\nContent-Usage: train-ai=n\n");
  assert.equal(groups.length, 1, "a declaration without rules must not be discarded");
  assert.deepEqual(groups[0]?.agents, ["*"]);
});

test("an exact user-agent group beats the wildcard", () => {
  const groups = parseRobots(
    "User-agent: *\nContent-Usage: train-ai=n\n\nUser-agent: GPTBot\nContent-Usage: train-ai=y\n",
  );
  assert.equal(resolveUsage(groups, "/article", "GPTBot").trainAi, "y");
  assert.equal(resolveUsage(groups, "/article", "ClaudeBot").trainAi, "n");
});

test("the last Content-Usage line in a group wins", () => {
  const groups = parseRobots("User-agent: *\nContent-Usage: train-ai=y\nContent-Usage: train-ai=n\n");
  assert.equal(resolveUsage(groups, "/", "GPTBot").trainAi, "n");
});

test("a declaration scoped to a path does not leak to other paths", () => {
  const groups = parseRobots("User-agent: *\nDisallow: /archive\nContent-Usage: train-ai=n\n");
  assert.equal(resolveUsage(groups, "/archive/2019", "GPTBot").trainAi, "n");
  assert.equal(resolveUsage(groups, "/blog/post", "GPTBot").trainAi, null);
});

test("no declaration means null, which is not the same as n", () => {
  const groups = parseRobots("User-agent: *\nAllow: /\n");
  const decision = resolveUsage(groups, "/", "GPTBot");
  assert.equal(decision.trainAi, null);
  assert.equal(decision.source, null);
  assert.deepEqual(decision.signals, []);
});

test("the report names the group that supplied the preference", () => {
  const groups = parseRobots("User-agent: *\nContent-Usage: train-ai=n\n");
  assert.equal(resolveUsage(groups, "/", "GPTBot").source, "User-agent: *");
});

test("values read as words, not letters", () => {
  assert.equal(describeUsage("y"), "training allowed");
  assert.equal(describeUsage("n"), "training not allowed");
  assert.match(describeUsage("u"), /unspecified/);
});

test("a declared train-ai=n adds one fix, not a wall of text", () => {
  const page = build({
    usage: { signals: [{ category: "train-ai", value: "n" }], trainAi: "n", source: "User-agent: *", malformed: [] },
    verdicts: [
      ["GPTBot", "ok"],
      ["ClaudeBot", "ok"],
    ],
  });
  const advice = page.advice.filter((line) => line.includes("train-ai"));
  assert.equal(advice.length, 1);
  assert.match(advice[0] as string, /declaring the preference is not the same as blocking/);
});

test("declaring training allowed while blocking the crawler is flagged as a contradiction", () => {
  const page = build({
    usage: { signals: [{ category: "train-ai", value: "y" }], trainAi: "y", source: "User-agent: *", malformed: [] },
    verdicts: [["GPTBot", "robots-blocked"]],
  });
  const line = page.advice.find((entry) => entry.includes("train-ai=y"));
  assert.ok(line, "contradiction must be reported");
  assert.match(line, /will never see it/);
});

test("an unreadable Content-Usage value is reported with what to write instead", () => {
  const page = build({
    usage: { signals: [], trainAi: null, source: null, malformed: ["train-ai=maybe"] },
  });
  const line = page.advice.find((entry) => entry.includes("cannot read"));
  assert.ok(line);
  assert.match(line, /category=value/);
});
