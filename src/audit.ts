/**
 * The audit itself: fetch one URL as the baseline browser and as each crawler,
 * then turn the evidence into one verdict per bot.
 *
 * Everything that decides a verdict is a pure function so the tests can pin
 * each rule without a network.
 */

import { BASELINE, type BotIdentity } from "./bots.js";
import { extractPage, looksLikeSpaShell } from "./html.js";
import { fetchAs, originOf, sleep } from "./fetch.js";
import { isAllowed, parseRobots, pathWithQueryOf, type RobotsGroup } from "./robots.js";
import { resolveUsage } from "./aipref.js";
import { jsOnlyReport, similarity } from "./diff.js";
import { adviceForPage } from "./advice.js";
import type {
  AuditOptions,
  BotResult,
  BotVerdict,
  Finding,
  JsOnlyReport,
  PageReport,
  RobotsVerdict,
  Verdict,
} from "./types.js";

const UA_BLOCK_STATUSES = new Set([401, 403, 406, 429, 451]);

export interface RobotsCache {
  available: boolean;
  url: string;
  status: number | null;
  groups: RobotsGroup[];
  error: string | null;
}

export async function loadRobots(
  url: string,
  options: Pick<AuditOptions, "timeoutMs">,
): Promise<RobotsCache> {
  const robotsUrl = `${originOf(url)}/robots.txt`;
  const outcome = await fetchAs(robotsUrl, BASELINE.userAgent, { timeoutMs: options.timeoutMs });
  if (outcome.error) {
    return {
      available: false,
      url: robotsUrl,
      status: outcome.status,
      groups: [],
      error: outcome.error,
    };
  }
  if (outcome.status === 404 || outcome.status === 410) {
    return { available: false, url: robotsUrl, status: outcome.status, groups: [], error: null };
  }
  if (outcome.status === null || outcome.status >= 400) {
    return {
      available: false,
      url: robotsUrl,
      status: outcome.status,
      groups: [],
      error: `HTTP ${outcome.status} (treated as allow all)`,
    };
  }
  return {
    available: true,
    url: robotsUrl,
    status: outcome.status,
    groups: parseRobots(outcome.body),
    error: null,
  };
}

export function robotsVerdict(robots: RobotsCache, url: string, token: string): RobotsVerdict {
  if (!robots.available) {
    return {
      available: false,
      allowed: true,
      rule: null,
      robotsUrl: robots.url,
      status: robots.status,
    };
  }
  const decision = isAllowed(robots.groups, pathWithQueryOf(url), token);
  return {
    available: true,
    allowed: decision.allowed,
    rule: decision.rule,
    robotsUrl: robots.url,
    status: robots.status,
  };
}

export interface VerdictInput {
  bot: BotResult;
  baseline: BotResult;
  jsOnly: JsOnlyReport | null;
  /** True when the raw HTML looks like an application shell (near-empty body plus a root node). */
  spaShell: boolean;
}

/**
 * One verdict per bot, decided in priority order. The reason string is shown
 * verbatim in the report, so each branch names its evidence.
 */
export function decideVerdict(input: VerdictInput): BotVerdict {
  const { bot, baseline, jsOnly } = input;
  const name = bot.bot;

  if (bot.error !== null || bot.status === null) {
    return {
      bot: name,
      verdict: "error",
      reason: `fetch failed: ${bot.error ?? "no response"}`,
      confidence: "measured",
    };
  }

  if (!bot.robots.allowed) {
    return {
      bot: name,
      verdict: "robots-blocked",
      reason: `robots.txt ${bot.robots.rule ?? "rule"} disallows ${pathWithQueryOf(bot.finalUrl ?? "")}`,
      confidence: "measured",
    };
  }

  if (bot.status >= 400) {
    if (baseline.status !== null && baseline.status >= 400) {
      return {
        bot: name,
        verdict: "error",
        reason: `HTTP ${bot.status} for the bot and HTTP ${baseline.status} for a browser: the URL itself fails`,
        confidence: "measured",
      };
    }
    if (UA_BLOCK_STATUSES.has(bot.status)) {
      return {
        bot: name,
        verdict: "ua-blocked",
        reason: `HTTP ${bot.status} for the bot, HTTP ${baseline.status} for a browser`,
        confidence: "measured",
      };
    }
    return {
      bot: name,
      verdict: "error",
      reason: `HTTP ${bot.status}`,
      confidence: "measured",
    };
  }

  if (
    bot.similarityToBaseline !== null &&
    bot.similarityToBaseline < 0.5 &&
    bot.wordCount >= 30 &&
    baseline.wordCount >= 30 &&
    bot.wordCount < baseline.wordCount
  ) {
    return {
      bot: name,
      verdict: "cloaked",
      reason: `text only ${(bot.similarityToBaseline * 100).toFixed(0)}% similar to the browser version (${bot.wordCount} vs ${baseline.wordCount} words)`,
      confidence: "heuristic",
    };
  }

  if (
    baseline.status !== null &&
    baseline.status < 400 &&
    baseline.wordCount >= 30 &&
    bot.wordCount === 0
  ) {
    return {
      bot: name,
      verdict: "cloaked",
      reason: `HTTP ${bot.status} with no readable text, while a browser gets ${baseline.wordCount} words`,
      confidence: "measured",
    };
  }

  if (jsOnly && jsOnly.renderedWords >= 50 && bot.wordCount < jsOnly.renderedWords * 0.5) {
    const missing = Math.max(
      0,
      Math.round((1 - bot.wordCount / Math.max(1, jsOnly.renderedWords)) * 100),
    );
    return {
      bot: name,
      verdict: "js-dependent",
      reason: `raw HTML carries ${bot.wordCount} of the ${jsOnly.renderedWords} words a browser renders (${missing}% missing)`,
      confidence: "measured",
    };
  }

  if (input.spaShell) {
    return {
      bot: name,
      verdict: "js-dependent",
      reason: `the raw HTML is an application shell (${baseline.wordCount} words); repeat with --render to measure what JavaScript adds`,
      confidence: "heuristic",
    };
  }

  return {
    bot: name,
    verdict: "ok",
    reason: "server-rendered content, bot allowed",
    confidence: "measured",
  };
}

export function collectFindings(
  baseline: BotResult,
  verdicts: BotVerdict[],
  jsOnly: JsOnlyReport | null,
  renderError: string | null,
  spaShell = false,
): Finding[] {
  const findings: Finding[] = [];
  const byVerdict = new Map<Verdict, string[]>();
  for (const v of verdicts) {
    const list = byVerdict.get(v.verdict) ?? [];
    list.push(v.bot);
    byVerdict.set(v.verdict, list);
  }

  if (baseline.error) {
    findings.push({
      level: "error",
      message: `A browser cannot load this URL either (${baseline.error}). Fix that first.`,
    });
  } else if (baseline.status !== null && baseline.status >= 400) {
    findings.push({
      level: "error",
      message: `The URL returns HTTP ${baseline.status} for a normal browser. Nothing below is meaningful until that is fixed.`,
    });
  }

  const jsDependent = byVerdict.get("js-dependent");
  if (jsDependent && jsDependent.length > 0) {
    const detail = jsOnly && jsOnly.renderedWords > 0
      ? `${Math.max(0, Math.round((1 - baseline.wordCount / jsOnly.renderedWords) * 100))}% of the text a browser renders (${baseline.wordCount} of ${jsOnly.renderedWords} words) never reaches them`
      : "the raw HTML is an application shell, so they get almost nothing";
    findings.push({
      level: "warn",
      message: `JavaScript-only content for ${jsDependent.join(", ")}: ${detail}, because these crawlers do not run JavaScript.`,
    });
    const first = jsOnly?.sample[0];
    if (first) {
      findings.push({ level: "info", message: `First missing sentence: "${first}"` });
    }
    if (jsDependent.includes("Googlebot")) {
      findings.push({
        level: "info",
        message:
          "Googlebot is the exception: it renders JavaScript before indexing, so its row is a lower bound for Google. GPTBot, ClaudeBot, PerplexityBot and the other AI fetchers stop at the raw HTML.",
      });
    }
  }

  const cloaked = byVerdict.get("cloaked");
  if (cloaked && cloaked.length > 0) {
    findings.push({
      level: "warn",
      message: `${cloaked.join(", ")} receive materially different text than a browser for the same URL. That is either deliberate cloaking or bot-specific templating.`,
    });
  }

  const uaBlocked = byVerdict.get("ua-blocked");
  if (uaBlocked && uaBlocked.length > 0) {
    findings.push({
      level: "warn",
      message: `${uaBlocked.join(", ")} are refused by the server (403/406/429) while a browser gets the page. Check CDN/WAF bot rules, not robots.txt.`,
    });
  }

  const robotsBlocked = byVerdict.get("robots-blocked");
  if (robotsBlocked && robotsBlocked.length > 0) {
    findings.push({
      level: "info",
      message: `robots.txt asks ${robotsBlocked.join(", ")} not to crawl this URL. Compliant crawlers stop there, so the text they get does not matter.`,
    });
  }

  if (spaShell) {
    findings.push({
      level: "warn",
      message: `The raw HTML looks like an application shell (${baseline.wordCount} words of text plus an empty mount node). Add --render to measure exactly what JavaScript adds.`,
    });
  }

  if (baseline.error === null && baseline.wordCount === 0) {
    findings.push({
      level: "warn",
      message:
        "The raw HTML has no readable text at all. Either the page is a JavaScript shell or it is not HTML.",
    });
  } else if (baseline.wordCount > 0 && baseline.wordCount < 30) {
    findings.push({
      level: "info",
      message: `Only ${baseline.wordCount} words of text in the raw HTML. Thin pages are hard for any crawler to make sense of.`,
    });
  }

  if (renderError) {
    findings.push({ level: "info", message: `Rendered comparison skipped: ${renderError}` });
  }

  if (findings.length === 0) {
    findings.push({ level: "info", message: "No crawler-visible problem found on this URL." });
  }
  return findings;
}

function toBotResult(
  bot: BotIdentity,
  outcome: Awaited<ReturnType<typeof fetchAs>>,
  robots: RobotsVerdict,
  baselineText: string | null,
): BotResult {
  const page = extractPage(outcome.body);
  const hasText = page.text.length > 0;
  return {
    bot: bot.name,
    status: outcome.status,
    finalUrl: outcome.finalUrl,
    redirects: outcome.redirects,
    durationMs: outcome.durationMs,
    htmlBytes: outcome.bodyBytes,
    title: page.title,
    description: page.description,
    text: page.text,
    wordCount: page.wordCount,
    robots,
    similarityToBaseline:
      baselineText !== null && hasText ? similarity(page.text, baselineText) : null,
    error: outcome.error,
  };
}

export async function auditUrl(
  rawUrl: string,
  bots: BotIdentity[],
  options: AuditOptions,
): Promise<PageReport> {
  const url = new URL(rawUrl).toString();
  const now = options.now ?? (() => new Date());

  const robots = options.checkRobots
    ? await loadRobots(url, options)
    : {
        available: false,
        url: `${originOf(url)}/robots.txt`,
        status: null,
        groups: [],
        error: null,
      };
  const robotsForAll = robotsVerdict(robots, url, "*");

  const baselineOutcome = await fetchAs(url, BASELINE.userAgent, {
    timeoutMs: options.timeoutMs,
    maxBodyBytes: options.maxBodyBytes,
  });
  const baseline = toBotResult(BASELINE, baselineOutcome, robotsForAll, null);
  const baselineText = baseline.text.length > 0 ? baseline.text : null;
  const shellCheck = looksLikeSpaShell(baselineOutcome.body, baseline.wordCount);
  const spaShell = shellCheck.shell && !options.renderer;

  const results: BotResult[] = [];
  for (const bot of bots) {
    await sleep(options.delayMs);
    const outcome = await fetchAs(url, bot.userAgent, {
      timeoutMs: options.timeoutMs,
      maxBodyBytes: options.maxBodyBytes,
    });
    results.push(
      toBotResult(bot, outcome, robotsVerdict(robots, url, bot.robotsToken), baselineText),
    );
  }

  let render = null;
  let renderError: string | null = null;
  let jsOnly: JsOnlyReport | null = null;

  if (options.renderer) {
    try {
      const rendered = await options.renderer(url);
      render = rendered;
      if (rendered.ok) {
        jsOnly = jsOnlyReport(baseline.text, rendered.text);
      } else {
        renderError = rendered.error ?? "renderer failed";
      }
    } catch (err) {
      renderError = err instanceof Error ? err.message : String(err);
    }
  }

  const verdicts = results.map((bot) => decideVerdict({ bot, baseline, jsOnly, spaShell }));
  const findings = collectFindings(baseline, verdicts, jsOnly, renderError, spaShell);
  const usage = resolveUsage(robots.groups, pathWithQueryOf(url), BASELINE.robotsToken);

  const page = {
    url,
    fetchedAt: now().toISOString(),
    httpStatus: baseline.status,
    robotsUrl: robots.url,
    robotsStatus: robots.status,
    baseline,
    bots: results,
    render,
    jsOnly,
    verdicts,
    findings,
    usage,
  } as unknown as PageReport;

  return { ...page, advice: adviceForPage(page) };
}
