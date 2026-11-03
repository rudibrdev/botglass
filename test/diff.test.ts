import { test } from "node:test";
import assert from "node:assert/strict";
import { jsOnlyReport, missingSentences, sentences, similarity, words } from "../src/diff.js";

const RAW = `The audit fetches every page exactly as a crawler would.
It compares what came back with what a browser receives and prints a verdict per bot.`;

const RENDERED = `${RAW}
Everything inside the application shell is only visible once JavaScript has run.
This second paragraph exists nowhere in the HTML source at all, which is the point.`;

test("identical text scores 1, unrelated text scores 0", () => {
  assert.equal(similarity("one two three", "one two three"), 1);
  assert.equal(similarity("alpha beta gamma", "delta epsilon zeta"), 0);
});

test("similarity is a proportion, not a boolean", () => {
  const score = similarity("alpha beta gamma delta", "alpha beta gamma epsilon");
  assert.ok(score > 0.5 && score < 1, `expected partial similarity, got ${score}`);
  assert.equal(similarity("", ""), 1);
  assert.equal(similarity("alpha", ""), 0);
});

test("sentences split on punctuation and newlines", () => {
  assert.deepEqual(sentences("One sentence. Two sentences! Three?"), [
    "One sentence.",
    "Two sentences!",
    "Three?",
  ]);
});

test("only sentences missing from the raw HTML are reported", () => {
  const missing = missingSentences(RAW, RENDERED);
  assert.equal(missing.length, 2);
  assert.match(missing[0] ?? "", /application shell/);
  assert.match(missing[1] ?? "", /second paragraph/);
});

test("short fragments do not count as missing content", () => {
  const missing = missingSentences("Some raw text here.", "Some raw text here. Read more");
  assert.deepEqual(missing, []);
});

test("js-only report computes the missing share of the rendered page", () => {
  const report = jsOnlyReport(RAW, RENDERED);
  assert.equal(report.rawWords, words(RAW).length);
  assert.equal(report.renderedWords, words(RENDERED).length);
  assert.ok(report.missingWords > 0);
  assert.equal(
    Math.round(report.ratio * 100),
    Math.round((1 - report.rawWords / report.renderedWords) * 100),
    "ratio is the share of rendered words the raw HTML does not have, so it matches the report",
  );
  assert.ok(report.ratio > 0.3, `ratio was ${report.ratio}`);
  assert.equal(report.sample.length, 2);
});

test("a page that did not render has a zero ratio rather than a division error", () => {
  const report = jsOnlyReport("raw only", "");
  assert.equal(report.ratio, 0);
  assert.equal(report.renderedWords, 0);
});
