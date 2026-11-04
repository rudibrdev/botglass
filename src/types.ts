/**
 * Shared types for botglass.
 *
 * A "bot" here is a crawler identity we can imitate with a User-Agent header.
 * A "verdict" is the single conclusion we draw for one bot on one URL.
 */

import type { BaselineDiff } from "./baseline.js";

export type Verdict =
  | "ok"
  | "js-dependent"
  | "cloaked"
  | "robots-blocked"
  | "ua-blocked"
  | "error";

export const VERDICTS: Verdict[] = [
  "ok",
  "js-dependent",
  "cloaked",
  "robots-blocked",
  "ua-blocked",
  "error",
];

export function isVerdict(value: string): value is Verdict {
  return (VERDICTS as string[]).includes(value);
}

export interface BotIdentity {
  /** Short name used on the command line and in reports. */
  name: string;
  /** The exact User-Agent header sent. */
  userAgent: string;
  /** Token used for robots.txt group matching. */
  robotsToken: string;
  /** Who runs it, for the report footer. */
  owner: string;
  /** Documentation URL for the current User-Agent string. */
  docs: string;
  /** True for the plain-browser baseline, not a crawler. */
  baseline?: boolean;
}

export interface Finding {
  level: "error" | "warn" | "info";
  /** One line, plain language, with the evidence inside it. */
  message: string;
}

export interface BotResult {
  bot: string;
  status: number | null;
  /** Final URL after redirects. */
  finalUrl: string | null;
  redirects: string[];
  durationMs: number;
  htmlBytes: number;
  title: string;
  description: string;
  text: string;
  wordCount: number;
  robots: RobotsVerdict;
  /** Jaccard similarity of 5-word shingles vs the baseline browser text, 0..1. */
  similarityToBaseline: number | null;
  error: string | null;
}

export interface RobotsVerdict {
  /** False when robots.txt is absent or unreachable. */
  available: boolean;
  allowed: boolean;
  /** The matched rule, e.g. "Disallow: /private". */
  rule: string | null;
  robotsUrl: string;
  /** HTTP status of robots.txt, or null when the request itself failed. */
  status: number | null;
}

export interface RenderResult {
  ok: boolean;
  error: string | null;
  text: string;
  wordCount: number;
  title: string;
}

export interface JsOnlyReport {
  renderedWords: number;
  rawWords: number;
  missingWords: number;
  /** Share of the rendered words that are not in the raw HTML, 0..1. */
  ratio: number;
  /** Up to five sentences only present after rendering. */
  sample: string[];
}

export interface BotVerdict {
  bot: string;
  verdict: Verdict;
  /** One line a human can act on. */
  reason: string;
  /** `measured` when decided from HTTP/rendered facts; `heuristic` otherwise. */
  confidence: "measured" | "heuristic";
}

export interface PageReport {
  url: string;
  fetchedAt: string;
  httpStatus: number | null;
  robotsUrl: string;
  robotsStatus: number | null;
  baseline: BotResult;
  bots: BotResult[];
  render: RenderResult | null;
  jsOnly: JsOnlyReport | null;
  verdicts: BotVerdict[];
  findings: Finding[];
  /** What to change, most useful first. Empty when every bot is fine. */
  advice: string[];
}

export interface AuditOptions {
  timeoutMs: number;
  /** Delay between requests to the same host, in milliseconds. */
  delayMs: number;
  maxBodyBytes: number;
  checkRobots: boolean;
  /** Optional renderer; when set, raw-vs-rendered diffing runs. */
  renderer?: Renderer | null;
  now?: () => Date;
}

export type Renderer = (url: string) => Promise<RenderResult>;

export interface RunOptions {
  render: boolean;
  maxPages: number;
  timeoutMs: number;
  concurrency: number;
  checkRobots: boolean;
  failOn: Verdict[];
  maxJsOnly: number | null;
  bots: string[];
}

export interface GateResult {
  failed: boolean;
  reasons: string[];
}

export interface RunReport {
  tool: "botglass";
  version: string;
  /** Bumped only when the JSON shape changes incompatibly. */
  schemaVersion: number;
  startedAt: string;
  finishedAt: string;
  pages: PageReport[];
  options: RunOptions;
  counts: Record<Verdict, number>;
  gate: GateResult;
  warnings: string[];
  /** Present only when the run was compared against a baseline file. */
  changes?: BaselineDiff | null;
}

export function emptyCounts(): Record<Verdict, number> {
  return {
    ok: 0,
    "js-dependent": 0,
    cloaked: 0,
    "robots-blocked": 0,
    "ua-blocked": 0,
    error: 0,
  };
}
