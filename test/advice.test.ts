import assert from "node:assert/strict";
import { test } from "node:test";
import { adviceForPage } from "../src/advice.js";
import { makePage } from "./build.js";

test("bots with the same cause share one instruction", () => {
  const page = makePage({
    verdicts: [
      ["GPTBot", "js-dependent"],
      ["ClaudeBot", "js-dependent"],
    ],
  });
  const advice = adviceForPage(page);
  assert.equal(advice.length, 1);
  assert.match(advice[0] as string, /GPTBot and ClaudeBot do not run JavaScript/);
  assert.match(advice[0] as string, /server-render/);
});

test("one bot reads as a singular sentence", () => {
  const page = makePage({ verdicts: [["ClaudeBot", "js-dependent"]] });
  assert.match(adviceForPage(page)[0] as string, /ClaudeBot does not run JavaScript/);
});

test("a robots block names the bot and the file to edit", () => {
  const page = makePage({ verdicts: [["CCBot", "robots-blocked"]] });
  const advice = adviceForPage(page);
  assert.match(advice[0] as string, /Allow CCBot in robots\.txt/);
});

test("a refusal carries the HTTP status the bot actually got", () => {
  const page = makePage({
    verdicts: [
      ["GPTBot", "ua-blocked"],
      ["ClaudeBot", "ua-blocked"],
    ],
    botStatuses: { GPTBot: 403, ClaudeBot: 403 },
  });
  const advice = adviceForPage(page);
  assert.match(advice[0] as string, /were refused with HTTP 403/);
  assert.match(advice[0] as string, /WAF/);
});

test("cloaking advice says to serve the same text", () => {
  const page = makePage({ verdicts: [["PerplexityBot", "cloaked"]] });
  assert.match(adviceForPage(page)[0] as string, /same text a browser gets/);
});

test("a healthy page has no advice", () => {
  const page = makePage({ verdicts: [["GPTBot", "ok"]] });
  assert.deepEqual(adviceForPage(page), []);
});

test("thin pages get page-level advice even when the verdict is ok", () => {
  const page = makePage({ verdicts: [["GPTBot", "ok"]], baselineWords: 3 });
  const advice = adviceForPage(page);
  assert.equal(advice.length, 1);
  assert.match(advice[0] as string, /Only 3 words of text/);
});

test("advice is capped at five lines so it stays readable", () => {
  const page = makePage({
    verdicts: [
      ["A", "js-dependent"],
      ["B", "robots-blocked"],
      ["C", "cloaked"],
      ["D", "ua-blocked"],
      ["E", "error"],
    ],
    baselineWords: 1,
    jsOnly: { renderedWords: 100, rawWords: 5, missingWords: 90, ratio: 0.9, sample: [] },
  });
  const advice = adviceForPage(page);
  assert.equal(advice.length, 5);
  assert.match(advice[0] as string, /request failed/);
  assert.match(advice[4] as string, /not run JavaScript/);
});

test("more than four bots collapse to a count", () => {
  const page = makePage({
    verdicts: [
      ["GPTBot", "js-dependent"],
      ["ClaudeBot", "js-dependent"],
      ["PerplexityBot", "js-dependent"],
      ["CCBot", "js-dependent"],
      ["Googlebot", "js-dependent"],
    ],
  });
  assert.match(adviceForPage(page)[0] as string, /^5 crawlers do not run JavaScript/);
});
