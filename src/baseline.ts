/**
 * Baselines: run once to diagnose, run again to prove the fix.
 *
 * A baseline is a tiny, stable summary of a previous run — verdicts and word
 * counts per bot, never the page text. Comparing is deliberately dumb: it
 * reports facts ("ClaudeBot ok → js-dependent, 80 → 3 words") and leaves the
 * interpretation to whoever reads it.
 */

import type { PageReport, RunReport, Verdict } from "./types.js";

export const BASELINE_SCHEMA_VERSION = 1;

export interface BaselineBot {
  bot: string;
  verdict: Verdict;
  words: number;
  status: number | null;
}

export interface BaselinePage {
  url: string;
  httpStatus: number | null;
  words: number;
  bots: BaselineBot[];
}

export interface Baseline {
  schemaVersion: number;
  tool: "botglass";
  createdAt: string;
  pages: BaselinePage[];
}

export interface BaselineChange {
  url: string;
  /** Which bot the change belongs to; absent for page-level changes. */
  bot?: string;
  field: "verdict" | "words" | "status";
  from: string;
  to: string;
}

export interface BaselineDiff {
  createdAt: string;
  changes: BaselineChange[];
  newPages: string[];
  missingPages: string[];
  /** False when the two runs measured nothing comparable. */
  comparable: boolean;
}

export function buildBaseline(report: RunReport, createdAt = report.finishedAt): Baseline {
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    tool: "botglass",
    createdAt,
    pages: report.pages.map((page) => ({
      url: page.url,
      httpStatus: page.httpStatus,
      words: page.baseline.wordCount,
      bots: page.bots.map((bot) => ({
        bot: bot.bot,
        verdict: page.verdicts.find((v) => v.bot === bot.bot)?.verdict ?? "error",
        words: bot.wordCount,
        status: bot.status,
      })),
    })),
  };
}

function normaliseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Parse a baseline file, rejecting anything that is not one. */
export function parseBaseline(raw: unknown): Baseline {
  if (typeof raw !== "object" || raw === null) throw new Error("baseline is not an object");
  const value = raw as Partial<Baseline>;
  if (value.tool !== "botglass") throw new Error('baseline is missing tool: "botglass"');
  if (!Array.isArray(value.pages)) throw new Error("baseline has no pages array");
  return {
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : 0,
    tool: "botglass",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    pages: value.pages.map((page) => ({
      url: String((page as BaselinePage).url ?? ""),
      httpStatus: (page as BaselinePage).httpStatus ?? null,
      words: Number((page as BaselinePage).words ?? 0),
      bots: Array.isArray((page as BaselinePage).bots) ? (page as BaselinePage).bots : [],
    })),
  };
}

export function compareBaseline(baseline: Baseline, report: RunReport): BaselineDiff {
  const changes: BaselineChange[] = [];
  const newPages: string[] = [];
  const missingPages: string[] = [];
  const before = new Map(baseline.pages.map((page) => [normaliseUrl(page.url), page]));
  const seen = new Set<string>();

  for (const page of report.pages) {
    const key = normaliseUrl(page.url);
    seen.add(key);
    const previous = before.get(key);
    if (!previous) {
      newPages.push(page.url);
      continue;
    }

    if (previous.httpStatus !== page.httpStatus) {
      changes.push({
        url: page.url,
        field: "status",
        from: String(previous.httpStatus),
        to: String(page.httpStatus),
      });
    }

    const previousBots = new Map(previous.bots.map((bot) => [bot.bot, bot]));
    for (const bot of page.bots) {
      const previousBot = previousBots.get(bot.bot);
      if (!previousBot) continue;
      const verdict = page.verdicts.find((v) => v.bot === bot.bot)?.verdict ?? "error";
      if (previousBot.verdict !== verdict) {
        changes.push({
          url: page.url,
          bot: bot.bot,
          field: "verdict",
          from: previousBot.verdict,
          to: verdict,
        });
      }
      if (previousBot.words !== bot.wordCount) {
        changes.push({
          url: page.url,
          bot: bot.bot,
          field: "words",
          from: String(previousBot.words),
          to: String(bot.wordCount),
        });
      }
    }
  }

  for (const [key, page] of Array.from(before)) {
    if (!seen.has(key)) missingPages.push(page.url);
  }

  return {
    createdAt: baseline.createdAt,
    changes,
    newPages,
    missingPages,
    comparable: report.pages.length > 0 && baseline.pages.length > 0,
  };
}

/** One line per change, in the order they were collected. */
export function describeChange(change: BaselineChange): string {
  const who = change.bot ? ` ${change.bot}` : "";
  if (change.field === "verdict") return `${who}: ${change.from} → ${change.to}`;
  if (change.field === "words") return `${who}: ${change.from} → ${change.to} words`;
  return `HTTP: ${change.from} → ${change.to}`;
}

export function pageForUrl(report: RunReport, url: string): PageReport | undefined {
  const key = normaliseUrl(url);
  return report.pages.find((page) => normaliseUrl(page.url) === key);
}
