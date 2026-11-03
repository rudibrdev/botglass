import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { auditUrl, decideVerdict } from "../src/audit.js";
import { BASELINE, BOTS, selectBots } from "../src/bots.js";
import type { BotResult, JsOnlyReport, RenderResult } from "../src/types.js";
import { startFixture, type Fixture } from "./fixture.js";

let fixture: Fixture;

before(async () => {
  fixture = await startFixture();
});

after(async () => {
  await fixture.close();
});

const options = {
  timeoutMs: 5000,
  delayMs: 0,
  maxBodyBytes: 2_000_000,
  checkRobots: true,
};

const one = (name: string) => selectBots([name]);

test("a server-rendered page is ok for every crawler", async () => {
  const report = await auditUrl(`${fixture.base}/ssr`, BOTS, options);
  assert.equal(report.httpStatus, 200);
  assert.equal(report.baseline.wordCount > 40, true);
  assert.equal(report.verdicts.length, 8);
  for (const verdict of report.verdicts) {
    assert.equal(verdict.verdict, "ok", `${verdict.bot}: ${verdict.reason}`);
  }
  assert.equal(report.jsOnly, null);
});

test("robots.txt is reported per bot and disallowed paths are flagged", async () => {
  const blocked = await auditUrl(`${fixture.base}/secret`, one("GPTBot"), options);
  assert.equal(blocked.verdicts[0]?.verdict, "robots-blocked");
  assert.match(blocked.verdicts[0]?.reason ?? "", /Disallow: \/secret/);
  assert.equal(blocked.httpStatus, 200, "the page still loads, robots is a separate question");

  const allowed = await auditUrl(`${fixture.base}/secret`, one("PerplexityBot"), options);
  assert.equal(allowed.verdicts[0]?.verdict, "ok");

  const wildcard = await auditUrl(`${fixture.base}/private`, one("CCBot"), options);
  assert.equal(wildcard.verdicts[0]?.verdict, "robots-blocked");
});

test("a bot-only 403 is ua-blocked, not a broken page", async () => {
  const report = await auditUrl(`${fixture.base}/blocked`, one("ClaudeBot"), options);
  assert.equal(report.httpStatus, 200);
  const verdict = report.verdicts[0];
  assert.equal(verdict?.verdict, "ua-blocked");
  assert.match(verdict?.reason ?? "", /HTTP 403/);
});

test("a page that fails for browsers too is an error, not a bot problem", async () => {
  const report = await auditUrl(`${fixture.base}/nope`, one("GPTBot"), options);
  assert.equal(report.httpStatus, 404);
  assert.equal(report.verdicts[0]?.verdict, "error");
  assert.match(report.verdicts[0]?.reason ?? "", /the URL itself fails/);
});

test("bot-specific content is flagged as cloaked", async () => {
  const report = await auditUrl(`${fixture.base}/cloaked`, one("GPTBot"), options);
  const verdict = report.verdicts[0];
  assert.equal(verdict?.verdict, "cloaked");
  assert.equal(verdict?.confidence, "heuristic");
  assert.match(verdict?.reason ?? "", /% similar/);

  const honest = await auditUrl(`${fixture.base}/cloaked`, one("PerplexityBot"), options);
  assert.equal(honest.verdicts[0]?.verdict, "ok");
});

test("a JavaScript shell plus a renderer produces js-dependent", async () => {
  const rendered: RenderResult = {
    ok: true,
    error: null,
    wordCount: 60,
    title: "App shell",
    text: "This application renders its copy in the browser after the bundle loads. " +
      "None of these words appear in the HTML source at all, which is exactly the problem. " +
      "A crawler that does not run JavaScript receives an empty shell and nothing else. " +
      "That is why this measurement exists in the first place, and why the verdict is js-dependent.",
  };
  const report = await auditUrl(`${fixture.base}/client-only`, one("GPTBot"), {
    ...options,
    renderer: async () => rendered,
  });
  assert.ok(report.jsOnly);
  assert.ok((report.jsOnly?.ratio ?? 0) > 0.9, `ratio was ${report.jsOnly?.ratio}`);
  assert.equal(report.verdicts[0]?.verdict, "js-dependent");
  assert.ok((report.jsOnly?.sample.length ?? 0) > 0);
});

test("without a renderer the shell is flagged as a heuristic js-dependent", async () => {
  const report = await auditUrl(`${fixture.base}/client-only`, one("GPTBot"), options);
  assert.equal(report.jsOnly, null);
  const verdict = report.verdicts[0];
  assert.equal(verdict?.verdict, "js-dependent");
  assert.equal(verdict?.confidence, "heuristic");
  assert.match(verdict?.reason ?? "", /application shell/);
  assert.ok(report.findings.some((f) => /Application|application shell/.test(f.message)));
});

test("a failing renderer is reported as a warning, not a crash", async () => {
  const report = await auditUrl(`${fixture.base}/ssr`, one("GPTBot"), {
    ...options,
    renderer: async () => ({
      ok: false,
      error: "browser closed unexpectedly",
      text: "",
      wordCount: 0,
      title: "",
    }),
  });
  assert.equal(report.jsOnly, null);
  assert.ok(report.findings.some((f) => f.message.includes("browser closed unexpectedly")));
});

test("redirects are followed and recorded", async () => {
  const report = await auditUrl(`${fixture.base}/redirect`, one("GPTBot"), options);
  assert.equal(report.httpStatus, 200);
  assert.equal(report.bots[0]?.finalUrl, `${fixture.base}/ssr`);
  assert.deepEqual(report.bots[0]?.redirects, [`${fixture.base}/ssr`]);
  assert.equal(report.verdicts[0]?.verdict, "ok");
});

test("--no-robots skips the robots lookup", async () => {
  const report = await auditUrl(`${fixture.base}/secret`, one("GPTBot"), {
    ...options,
    checkRobots: false,
  });
  assert.equal(report.robotsStatus, null);
  assert.equal(report.verdicts[0]?.verdict, "ok");
});

/** Verdict rules, pinned without any network. */
function fakeBot(overrides: Partial<BotResult> = {}): BotResult {
  return {
    bot: "GPTBot",
    status: 200,
    finalUrl: "https://example.com/p",
    redirects: [],
    durationMs: 10,
    htmlBytes: 1000,
    title: "Example",
    description: "",
    text: "words ".repeat(80).trim(),
    wordCount: 80,
    robots: { available: true, allowed: true, rule: null, robotsUrl: "https://example.com/robots.txt", status: 200 },
    similarityToBaseline: 0.99,
    error: null,
    ...overrides,
  };
}

const baseline = fakeBot({ bot: BASELINE.name, similarityToBaseline: null });
const noShell = { spaShell: false };

test("verdict priority: fetch error first", () => {
  const verdict = decideVerdict({
    bot: fakeBot({ status: null, error: "ENOTFOUND" }),
    baseline,
    jsOnly: null,
    ...noShell,
  });
  assert.equal(verdict.verdict, "error");
  assert.equal(verdict.confidence, "measured");
});

test("verdict priority: robots before http status", () => {
  const bot = fakeBot({
    status: 200,
    robots: { available: true, allowed: false, rule: "Disallow: /", robotsUrl: "u", status: 200 },
  });
  assert.equal(
    decideVerdict({ bot, baseline, jsOnly: null, ...noShell }).verdict,
    "robots-blocked",
  );
});

test("cloaking needs both pages to be substantial", () => {
  const smallBot = fakeBot({ similarityToBaseline: 0.2, wordCount: 20 });
  assert.equal(decideVerdict({ bot: smallBot, baseline, jsOnly: null, ...noShell }).verdict, "ok");
});

test("a bot that sees less text than the browser is cloaked when the scores diverge", () => {
  const cloaked = fakeBot({ similarityToBaseline: 0.2, wordCount: 60 });
  const verdict = decideVerdict({ bot: cloaked, baseline, jsOnly: null, ...noShell });
  assert.equal(verdict.verdict, "cloaked");
});

test("a bot that sees *more* text is not cloaked", () => {
  const richer = fakeBot({ similarityToBaseline: 0.2, wordCount: 200, text: "x" });
  const verdict = decideVerdict({ bot: richer, baseline, jsOnly: null, ...noShell });
  assert.equal(verdict.verdict, "ok");
});

test("js-dependent wins over ok but not over cloaking", () => {
  const jsOnly: JsOnlyReport = {
    renderedWords: 200,
    rawWords: 20,
    missingWords: 150,
    ratio: 0.75,
    sample: ["Only after JS."],
  };
  assert.equal(
    decideVerdict({ bot: fakeBot(), baseline, jsOnly, ...noShell }).verdict,
    "js-dependent",
  );
  const cloaked = fakeBot({ similarityToBaseline: 0.1, wordCount: 60 });
  assert.equal(decideVerdict({ bot: cloaked, baseline, jsOnly, ...noShell }).verdict, "cloaked");
});

test("the shell heuristic never overrides a measured render", () => {
  const ok = decideVerdict({ bot: fakeBot(), baseline, jsOnly: null, spaShell: true });
  assert.equal(ok.verdict, "js-dependent");
  assert.equal(ok.confidence, "heuristic");
});
