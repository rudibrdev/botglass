import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowed, parseRobots, pathWithQueryOf } from "../src/robots.js";

const SAMPLE = `# comment
User-agent: *
Disallow: /private
Allow: /private/public

User-agent: GPTBot
Disallow: /gpt
Allow: /gpt/ok

User-agent: ClaudeBot
User-agent: anthropic-ai
Disallow: /*.pdf$
Crawl-delay: 2
`;

test("groups are parsed with their agents, rules and crawl delay", () => {
  const groups = parseRobots(SAMPLE);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0]?.agents, ["*"]);
  assert.equal(groups[0]?.rules.length, 2);
  assert.deepEqual(groups[2]?.agents, ["claudebot", "anthropic-ai"]);
  assert.equal(groups[2]?.crawlDelay, 2);
});

test("an empty Disallow means no restriction, not block everything", () => {
  const groups = parseRobots("User-agent: *\nDisallow:\n");
  assert.equal(isAllowed(groups, "/anything", "AnythingBot").allowed, true);
});

test("the longest matching rule wins", () => {
  const groups = parseRobots(SAMPLE);
  assert.equal(isAllowed(groups, "/private/report", "SomeBot").allowed, false);
  assert.equal(isAllowed(groups, "/private/public/page", "SomeBot").allowed, true);
});

test("Allow wins a tie of equal length", () => {
  const groups = parseRobots("User-agent: *\nDisallow: /page\nAllow: /page\n");
  assert.equal(isAllowed(groups, "/page", "SomeBot").allowed, true);
});

test("a specific group beats the wildcard group", () => {
  const groups = parseRobots(SAMPLE);
  // /private is disallowed for *, allowed for GPTBot (no matching rule there).
  assert.equal(isAllowed(groups, "/private", "GPTBot").allowed, true);
  assert.equal(isAllowed(groups, "/private", "Bingbot").allowed, false);
});

test("wildcards and end anchors are honoured", () => {
  const groups = parseRobots(SAMPLE);
  assert.equal(isAllowed(groups, "/docs/guide.pdf", "ClaudeBot").allowed, false);
  assert.equal(isAllowed(groups, "/docs/guide.pdf.html", "ClaudeBot").allowed, true);
  assert.equal(isAllowed(groups, "/gpt/ok/deep", "GPTBot").allowed, true);
  assert.equal(isAllowed(groups, "/gpt/other", "GPTBot").allowed, false);
});

test("no matching rule means allowed", () => {
  const groups = parseRobots(SAMPLE);
  const decision = isAllowed(groups, "/blog/post", "PerplexityBot");
  assert.equal(decision.allowed, true);
  assert.equal(decision.rule, null);
});

test("the matched rule is reported back verbatim", () => {
  const groups = parseRobots(SAMPLE);
  const decision = isAllowed(groups, "/private/report", "SomeBot");
  assert.equal(decision.rule, "Disallow: /private");
});

test("query strings are part of the path (whole URL helper)", () => {
  const groups = parseRobots("User-agent: *\nDisallow: /*?print=1\n");
  assert.equal(isAllowed(groups, "/post?print=1", "SomeBot").allowed, false);
  assert.equal(pathWithQueryOf("https://example.com/a/b?x=1"), "/a/b?x=1");
});
