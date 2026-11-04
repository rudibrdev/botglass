/**
 * What to do about a finding.
 *
 * A verdict says what is wrong; advice says what to change, grouped by cause so
 * eight bots with the same problem produce one instruction, not eight. Agents
 * act on this list, so it stays short and every line names a change.
 */

import type { BotVerdict, PageReport, Verdict } from "./types.js";

const THIN_PAGE_WORDS = 50;

/** "GPTBot", "GPTBot and ClaudeBot", "4 bots". */
function listBots(bots: string[]): string {
  if (bots.length === 0) return "The crawlers";
  if (bots.length === 1) return bots[0] as string;
  if (bots.length === 2) return `${bots[0]} and ${bots[1]}`;
  if (bots.length <= 4) return `${bots.slice(0, -1).join(", ")} and ${bots[bots.length - 1]}`;
  return `${bots.length} crawlers`;
}

function groupByVerdict(verdicts: BotVerdict[]): Map<Verdict, string[]> {
  const groups = new Map<Verdict, string[]>();
  for (const verdict of verdicts) {
    if (verdict.verdict === "ok") continue;
    const list = groups.get(verdict.verdict) ?? [];
    list.push(verdict.bot);
    groups.set(verdict.verdict, list);
  }
  return groups;
}

function usageAdvice(page: PageReport): string[] {
  const usage = page.usage;
  if (!usage) return [];
  const out: string[] = [];
  const blocked = page.verdicts.filter((v) => v.verdict === "robots-blocked").map((v) => v.bot);

  if (usage.unknownCategories.length > 0) {
    out.push(
      `Content-Usage uses "${usage.unknownCategories[0]}=…", which is not in the draft vocabulary (train-ai, ai-use, search); crawlers may ignore it.`,
    );
  }

  if (usage.malformed.length > 0) {
    out.push(
      `robots.txt has a Content-Usage line we cannot read ("${usage.malformed[0]}"): the value must be one of y, n or u, written category=value.`,
    );
  }

  if (usage.trainAi === "y" && blocked.length > 0) {
    out.push(
      `This page says training is allowed (Content-Usage: train-ai=y) but robots.txt disallows ${listBots(blocked)}; crawlers that obey robots.txt will never see it.`,
    );
  } else if (usage.trainAi === "n") {
    const allowedBots = page.verdicts.filter((v) => v.verdict !== "robots-blocked").map((v) => v.bot);
    if (allowedBots.length > 0) {
      out.push(
        `You declare train-ai=n but robots.txt still lets ${listBots(allowedBots)} fetch this page; declaring the preference is not the same as blocking training, and the AI companies honouring it is voluntary.`,
      );
    }
  } else if (usage.trainAi === "u") {
    out.push(
      "Content-Usage: train-ai=u asks crawlers to check with you rather than deciding; make it explicit (y or n) if you want a reliable answer.",
    );
  }

  return out;
}

/** Page-level advice that is not tied to a single bot. */
function pageAdvice(page: PageReport, alreadyMentionsJs: boolean): string[] {
  const out: string[] = [];
  if (page.httpStatus !== null && page.httpStatus >= 400) {
    out.push(`The page itself returned HTTP ${page.httpStatus} to a normal browser.`);
  }
  const baselineWords = page.baseline.wordCount;
  if (page.httpStatus !== null && page.httpStatus < 400 && baselineWords < THIN_PAGE_WORDS) {
    out.push(
      `Only ${baselineWords} words of text in the HTML: put the page's main copy in the server response, not behind a script.`,
    );
  }
  if (!alreadyMentionsJs && page.jsOnly && page.jsOnly.ratio >= 0.5) {
    out.push(
      `${(page.jsOnly.ratio * 100).toFixed(0)}% of the rendered text is JavaScript-only; treat server rendering as the fix, not an optimisation.`,
    );
  }
  return out;
}

/** Deduplicated, ordered fix list for one page. Empty when every bot is fine. */
export function adviceForPage(page: PageReport): string[] {
  const groups = groupByVerdict(page.verdicts);
  const out: string[] = [];

  const errors = groups.get("error");
  if (errors) {
    out.push(`The request failed for ${listBots(errors)}; fix reachability, TLS or the redirect chain before judging crawler access.`);
  }
  const blocked = groups.get("ua-blocked");
  if (blocked) {
    const statuses = new Set(
      page.bots
        .filter((bot) => blocked.includes(bot.bot))
        .map((bot) => bot.status)
        .filter((status): status is number => typeof status === "number"),
    );
    const code = statuses.size === 1 ? ` with HTTP ${Array.from(statuses)[0]}` : "";
    out.push(
      `${listBots(blocked)} ${blocked.length === 1 ? "was" : "were"} refused${code}; check WAF/CDN bot rules, user-agent filtering and rate limits in front of the origin.`,
    );
  }
  const cloaked = groups.get("cloaked");
  if (cloaked) {
    out.push(
      `Serve ${listBots(cloaked)} the same text a browser gets; this looks like content switching by user agent.`,
    );
  }
  const robots = groups.get("robots-blocked");
  if (robots) {
    out.push(`Allow ${listBots(robots)} in robots.txt — the current rules disallow the URL you checked.`);
  }
  const js = groups.get("js-dependent");
  if (js) {
    out.push(
      `${listBots(js)} ${js.length === 1 ? "does" : "do"} not run JavaScript: server-render the page text (SSR, static generation or prerender).`,
    );
  }

  out.push(...pageAdvice(page, js !== undefined));
  out.push(...usageAdvice(page));
  return out.slice(0, 5);
}
