/**
 * The small report: what an agent reads.
 *
 * The full JSON keeps every fetched byte of text for debugging and for the HTML
 * report. That is the right shape for a human reading a report file and the
 * wrong shape for a model with a context budget, so this projection drops the
 * page text, the redirect chains and the per-bot blobs, and keeps the verdicts,
 * the counts and the fixes.
 */

import type { PageReport, RunReport, Verdict } from "../types.js";

export const COMPACT_SCHEMA_VERSION = 1;

export const VERDICT_SEVERITY: Record<Verdict, number> = {
  ok: 0,
  "js-dependent": 1,
  "robots-blocked": 2,
  cloaked: 3,
  "ua-blocked": 4,
  error: 5,
};

/** The most serious verdict on a page, or `ok` when every bot is fine. */
export function worstVerdict(page: PageReport): Verdict {
  let worst: Verdict = "ok";
  for (const verdict of page.verdicts) {
    if (VERDICT_SEVERITY[verdict.verdict] > VERDICT_SEVERITY[worst]) worst = verdict.verdict;
  }
  return worst;
}

export interface CompactPage {
  url: string;
  httpStatus: number | null;
  words: number;
  renderedWords: number | null;
  worst: Verdict;
  bots: Array<{ bot: string; verdict: Verdict; words: number; status: number | null }>;
  advice: string[];
}

export interface CompactReport {
  schemaVersion: number;
  tool: "botglass";
  version: string;
  finishedAt: string;
  totals: Record<Verdict, number>;
  gate: { failed: boolean; reasons: string[] };
  pages: CompactPage[];
  changes?: {
    since: string;
    changes: Array<{ url: string; bot?: string; field: string; from: string; to: string }>;
    newPages: string[];
    missingPages: string[];
  };
}

export function compactPage(page: PageReport): CompactPage {
  return {
    url: page.url,
    httpStatus: page.httpStatus,
    words: page.baseline.wordCount,
    renderedWords: page.jsOnly
      ? page.jsOnly.renderedWords
      : page.render?.ok
        ? page.render.wordCount
        : null,
    worst: worstVerdict(page),
    bots: page.bots.map((bot) => ({
      bot: bot.bot,
      verdict: page.verdicts.find((v) => v.bot === bot.bot)?.verdict ?? "error",
      words: bot.wordCount,
      status: bot.status,
    })),
    advice: page.advice,
  };
}

export function compactRun(report: RunReport): CompactReport {
  const out: CompactReport = {
    schemaVersion: COMPACT_SCHEMA_VERSION,
    tool: "botglass",
    version: report.version,
    finishedAt: report.finishedAt,
    totals: report.counts,
    gate: report.gate,
    pages: report.pages.map(compactPage),
  };
  if (report.changes) {
    out.changes = {
      since: report.changes.createdAt,
      changes: report.changes.changes.map((change) => ({
        url: change.url,
        bot: change.bot,
        field: change.field,
        from: change.from,
        to: change.to,
      })),
      newPages: report.changes.newPages,
      missingPages: report.changes.missingPages,
    };
  }
  return out;
}
