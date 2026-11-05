/**
 * Content-Usage: the shared AI usage preference signal.
 *
 * These tests pin the rules from draft-ietf-aipref-attach and
 * draft-ietf-aipref-vocab, including the worked robots.txt example. The signal
 * is voluntary, so the point is faithful parsing and precedence, not what any
 * provider does with it afterwards.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseContentUsageRule,
  parseUsageSignals,
  parseUsageValue,
  resolveUsage,
  describeUsage,
} from "../src/aipref.js";
import { parseRobots } from "../src/robots.js";
import { makePage as build } from "./build.js";

test("a single category=value pair parses", () => {
  assert.deepEqual(parseUsageSignals("train-ai=n"), {
    signals: [{ category: "train-ai", value: "n" }],
    malformed: [],
    unknownCategories: [],
    unknownValues: [],
  });
});

test("several members parse with OWS around commas, labels stay case sensitive", () => {
  const parsed = parseUsageSignals("train-ai=n,\tsearch=y");
  assert.deepEqual(parsed.signals, [
    { category: "train-ai", value: "n" },
    { category: "search", value: "y" },
  ]);
  assert.deepEqual(parsed.malformed, []);
});

test("an uppercase label is a parse failure, so every preference is unknown", () => {
  const parsed = parseUsageSignals("Train-AI=n");
  assert.deepEqual(parsed.signals, []);
  assert.deepEqual(parsed.malformed, ["Train-AI=n"]);
});

test("uppercase or non-token values are not explicit preferences", () => {
  for (const value of ["N", "u", "maybe", "yes"]) {
    const parsed = parseUsageSignals(`train-ai=${value}`);
    assert.deepEqual(parsed.signals, [], value);
    assert.deepEqual(parsed.malformed, [], `${value} is not a syntax error`);
    assert.deepEqual(parsed.unknownValues, ["train-ai"], value);
  }
});

test("parseUsageValue accepts exactly y and n, case sensitively", () => {
  assert.equal(parseUsageValue("y"), "y");
  assert.equal(parseUsageValue("n"), "n");
  assert.equal(parseUsageValue("N"), null);
  assert.equal(parseUsageValue("Y"), null);
  assert.equal(parseUsageValue("u"), null);
  assert.equal(parseUsageValue("yes"), null);
  assert.equal(parseUsageValue(""), null);
});

test("parameters are parsed and ignored", () => {
  const parsed = parseUsageSignals("train-ai=n;why=x, search=y;allow=x");
  assert.deepEqual(parsed.signals, [
    { category: "train-ai", value: "n" },
    { category: "search", value: "y" },
  ]);
  assert.deepEqual(parsed.malformed, []);
});

test("a parameterised bare key is replaced by the later duplicate", () => {
  // draft-ietf-aipref-vocab Section 6.3.2 example: the first member is boolean
  // true with a parameter, the second is the token y, so the statement allows.
  const parsed = parseUsageSignals("train-ai;allow=n, train-ai=y");
  assert.deepEqual(parsed.signals, [{ category: "train-ai", value: "y" }]);
  assert.deepEqual(parsed.malformed, []);
});

test("the last duplicate key wins inside one dictionary", () => {
  assert.equal(parseUsageSignals("train-ai=y, train-ai=n").signals[0]?.value, "n");
  assert.equal(parseUsageSignals("train-ai=n, train-ai=y").signals[0]?.value, "y");
});

test("a bare key is a boolean, not the token y", () => {
  const parsed = parseUsageSignals("train-ai");
  assert.deepEqual(parsed.signals, []);
  assert.deepEqual(parsed.malformed, []);
  assert.deepEqual(parsed.unknownValues, ["train-ai"]);
});

test("a quoted value is not a token and leaves the category unknown", () => {
  const parsed = parseUsageSignals('train-ai="n"');
  assert.deepEqual(parsed.signals, []);
  assert.deepEqual(parsed.unknownValues, ["train-ai"]);
});

test("the vocabulary example with repeated keys resolves to unknown", () => {
  // draft-ietf-aipref-vocab Section 6.3.1: the last values are a boolean and a
  // string, neither of which is the token y or n.
  const parsed = parseUsageSignals('train-ai=y, train-ai, search=n, search="n"');
  assert.deepEqual(parsed.signals, []);
  assert.deepEqual(parsed.unknownValues, ["train-ai", "search"]);
});

test("malformed dictionary syntax is reported rather than guessed", () => {
  for (const value of ["train-ai=", "train-ai = n", "train-ai=n,", ""]) {
    const parsed = parseUsageSignals(value);
    assert.deepEqual(parsed.signals, [], value);
    assert.deepEqual(parsed.malformed, [value], value);
  }
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

test("the optional path prefix is split from the preference", () => {
  const noPath = parseContentUsageRule("train-ai=n");
  assert.equal(noPath.path, "");
  assert.equal(noPath.specificity, 0);
  assert.deepEqual(noPath.signals, [{ category: "train-ai", value: "n" }]);

  const withPath = parseContentUsageRule("/ai-ok/  train-ai=y");
  assert.equal(withPath.path, "/ai-ok/");
  assert.equal(withPath.specificity, "/ai-ok/".length);
  assert.deepEqual(withPath.signals, [{ category: "train-ai", value: "y" }]);
});

test("a path without a preference is malformed", () => {
  const parsed = parseContentUsageRule("/ai-ok/");
  assert.deepEqual(parsed.signals, []);
  assert.deepEqual(parsed.malformed, ["/ai-ok/"]);
});

test("the draft worked example resolves per path and skips disallowed paths", () => {
  const groups = parseRobots(
    [
      "User-Agent: *",
      "Allow: /",
      "Disallow: /never/",
      "Content-Usage: train-ai=n",
      "Content-Usage: /ai-ok/ train-ai=y",
      "",
      "User-Agent: ExampleBot",
      "Allow: /",
      "Content-Usage: train-ai=y",
      "",
    ].join("\n"),
  );

  assert.equal(resolveUsage(groups, "/test", "GPTBot").trainAi, "n");
  assert.equal(resolveUsage(groups, "/never/test", "GPTBot").trainAi, null);
  assert.deepEqual(resolveUsage(groups, "/never/test", "GPTBot").signals, []);
  assert.equal(resolveUsage(groups, "/ai-ok/test", "GPTBot").trainAi, "y");

  // The crawler that names itself ExampleBot uses its own group, where there is
  // no Disallow and no path on the rule.
  assert.equal(resolveUsage(groups, "/never/test", "ExampleBot").trainAi, "y");
  assert.equal(resolveUsage(groups, "/anywhere", "ExampleBot").trainAi, "y");
});

test("the longest matching path prefix wins, regardless of file order", () => {
  const forward = parseRobots(
    "User-agent: *\nAllow: /\nContent-Usage: train-ai=n\nContent-Usage: /ai-ok/ train-ai=y\n",
  );
  const reversed = parseRobots(
    "User-agent: *\nAllow: /\nContent-Usage: /ai-ok/ train-ai=y\nContent-Usage: train-ai=n\n",
  );

  for (const groups of [forward, reversed]) {
    assert.equal(resolveUsage(groups, "/ai-ok/test", "GPTBot").trainAi, "y");
    assert.equal(resolveUsage(groups, "/test", "GPTBot").trainAi, "n");
  }

  const deeper = parseRobots(
    "User-agent: *\nAllow: /\nContent-Usage: /ai-ok/ train-ai=y\nContent-Usage: /ai-ok/deep/ train-ai=n\n",
  );
  assert.equal(resolveUsage(deeper, "/ai-ok/deep/post", "GPTBot").trainAi, "n");
  assert.equal(resolveUsage(deeper, "/ai-ok/post", "GPTBot").trainAi, "y");
});

test("conflicting preferences on an equal path combine most restrictively", () => {
  const allowFirst = parseRobots(
    "User-agent: *\nAllow: /\nContent-Usage: /ai-ok/ train-ai=y\nContent-Usage: /ai-ok/ train-ai=n\n",
  );
  const denyFirst = parseRobots(
    "User-agent: *\nAllow: /\nContent-Usage: /ai-ok/ train-ai=n\nContent-Usage: /ai-ok/ train-ai=y\n",
  );

  assert.equal(resolveUsage(allowFirst, "/ai-ok/test", "GPTBot").trainAi, "n");
  assert.equal(resolveUsage(denyFirst, "/ai-ok/test", "GPTBot").trainAi, "n");
});

test("conflicting groups for the same token also combine most restrictively", () => {
  const groups = parseRobots(
    "User-agent: *\nContent-Usage: train-ai=y\n\nUser-agent: *\nContent-Usage: train-ai=n\n",
  );
  assert.equal(resolveUsage(groups, "/", "GPTBot").trainAi, "n");
});

test("a disallowed path has no preference even when a rule names it", () => {
  const groups = parseRobots(
    "User-agent: *\nDisallow: /private\nContent-Usage: /private train-ai=y\nContent-Usage: train-ai=n\n",
  );
  const decision = resolveUsage(groups, "/private/page", "GPTBot");
  assert.equal(decision.trainAi, null);
  assert.deepEqual(decision.signals, []);
  assert.equal(decision.source, null);
});

test("a specific group's Disallow also suppresses its preferences, without falling back to *", () => {
  const groups = parseRobots(
    [
      "User-agent: GPTBot",
      "Disallow: /secret",
      "Content-Usage: train-ai=y",
      "",
      "User-agent: *",
      "Allow: /",
      "Content-Usage: train-ai=n",
      "",
    ].join("\n"),
  );
  assert.equal(resolveUsage(groups, "/secret", "GPTBot").trainAi, null);
  assert.equal(resolveUsage(groups, "/secret", "ClaudeBot").trainAi, "n");
});

test("robots path patterns use wildcards and the end anchor", () => {
  const wildcard = parseRobots(
    "User-agent: *\nAllow: /\nContent-Usage: /ai-*/deep/ train-ai=n\n",
  );
  assert.equal(resolveUsage(wildcard, "/ai-ok/deep/x", "GPTBot").trainAi, "n");
  assert.equal(resolveUsage(wildcard, "/ai-ok/shallow", "GPTBot").trainAi, null);

  const anchored = parseRobots(
    "User-agent: *\nAllow: /\nContent-Usage: /exact$ train-ai=y\n",
  );
  assert.equal(resolveUsage(anchored, "/exact", "GPTBot").trainAi, "y");
  assert.equal(resolveUsage(anchored, "/exact/more", "GPTBot").trainAi, null);
});

test("an exact user-agent group beats the wildcard", () => {
  const groups = parseRobots(
    "User-agent: *\nContent-Usage: train-ai=n\n\nUser-agent: GPTBot\nContent-Usage: train-ai=y\n",
  );
  assert.equal(resolveUsage(groups, "/article", "GPTBot").trainAi, "y");
  assert.equal(resolveUsage(groups, "/article", "ClaudeBot").trainAi, "n");
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
});

test("a category outside the vocabulary is reported, not treated as train-ai", () => {
  const groups = parseRobots("User-agent: *\nAllow: /\nContent-Usage: ai=n\n");
  const decision = resolveUsage(groups, "/", "GPTBot");
  assert.equal(decision.trainAi, null);
  assert.deepEqual(decision.signals, []);
  assert.deepEqual(decision.unknownCategories, ["ai"]);
});

test("u is unknown, not a request to ask permission", () => {
  const groups = parseRobots("User-agent: *\nAllow: /\nContent-Usage: train-ai=u\n");
  const decision = resolveUsage(groups, "/", "GPTBot");
  assert.equal(decision.trainAi, null);
  assert.deepEqual(decision.malformed, []);
  assert.deepEqual(decision.unknownValues, ["train-ai"]);
});

test("a malformed dictionary is reported without inventing a preference", () => {
  const groups = parseRobots("User-agent: *\nAllow: /\nContent-Usage: train-ai = n\n");
  const decision = resolveUsage(groups, "/", "GPTBot");
  assert.equal(decision.trainAi, null);
  assert.deepEqual(decision.malformed, ["train-ai = n"]);
});

test("declaring train-ai=n while crawlers may still fetch is not a contradiction", () => {
  const page = build({
    usage: {
      signals: [{ category: "train-ai", value: "n" }],
      trainAi: "n",
      source: "User-agent: *",
      malformed: [],
      unknownCategories: [],
      unknownValues: [],
    },
    verdicts: [
      ["GPTBot", "ok"],
      ["ClaudeBot", "ok"],
    ],
  });
  assert.deepEqual(
    page.advice.filter((line) => /train-ai|Content-Usage/.test(line)),
    [],
  );
});

test("declaring train-ai=y while a crawler is robots-blocked is not a contradiction", () => {
  const page = build({
    usage: {
      signals: [{ category: "train-ai", value: "y" }],
      trainAi: "y",
      source: "User-agent: *",
      malformed: [],
      unknownCategories: [],
      unknownValues: [],
    },
    verdicts: [["GPTBot", "robots-blocked"]],
  });
  assert.deepEqual(
    page.advice.filter((line) => /train-ai|Content-Usage/.test(line)),
    [],
  );
});

test("u produces no ask-permission advice", () => {
  const page = build({
    usage: {
      signals: [],
      trainAi: null,
      source: "User-agent: *",
      malformed: [],
      unknownCategories: [],
      unknownValues: ["train-ai"],
    },
  });
  assert.deepEqual(
    page.advice.filter((line) => /ask|check with you|train-ai/.test(line)),
    [],
  );
});

test("an unreadable Content-Usage value names y and n, not u", () => {
  const page = build({
    usage: {
      signals: [],
      trainAi: null,
      source: null,
      malformed: ["train-ai = n"],
      unknownCategories: [],
      unknownValues: [],
    },
  });
  const line = page.advice.find((entry) => entry.includes("cannot parse"));
  assert.ok(line);
  assert.match(line, /explicit y or n/);
  assert.doesNotMatch(line, /u\b/);
});
