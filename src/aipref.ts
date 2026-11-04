/**
 * AI usage preferences: the `Content-Usage` line in robots.txt.
 *
 * On 2 Nov 2026 Anthropic, OpenAI, Google and Microsoft backed a shared signal for
 * saying "you may crawl this, but do not train on it" once instead of per crawler.
 * The IETF draft (draft-ietf-aipref-attach) puts it in robots.txt:
 *
 *   User-agent: *
 *   Allow: /
 *   Content-Usage: train-ai=n
 *
 * The vocabulary is a comma-separated list of `category=value` pairs: `y` (yes),
 * `n` (no), `u` (unknown/ask). Absent means the site said nothing, which is not
 * the same as "no".
 */

import type { RobotsGroup } from "./robots.js";

export type UsageValue = "y" | "n" | "u";

export interface UsageSignal {
  /** Lowercased category, e.g. `train-ai`, `search`, `ai-output`. */
  category: string;
  value: UsageValue;
}

export interface UsageDecision {
  /** Every category the site declared, as written. */
  signals: UsageSignal[];
  /** The value that applies to this path for `train-ai`, or null when undeclared. */
  trainAi: UsageValue | null;
  /** The robots.txt group that supplied it, e.g. `User-agent: *`. */
  source: string | null;
  /** Lines we could not parse, reported rather than silently dropped. */
  malformed: string[];
}

const KNOWN_VALUES = new Set(["y", "n", "u"]);

export function parseUsageValue(raw: string): UsageValue | null {
  const value = raw.trim().toLowerCase();
  return KNOWN_VALUES.has(value) ? (value as UsageValue) : null;
}

/** Parse one `Content-Usage` value, e.g. "train-ai=n,ai-output=y". */
export function parseUsageSignals(value: string): { signals: UsageSignal[]; malformed: string[] } {
  const signals: UsageSignal[] = [];
  const malformed: string[] = [];
  for (const part of value.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq <= 0) {
      malformed.push(piece);
      continue;
    }
    const category = piece.slice(0, eq).trim().toLowerCase();
    const parsed = parseUsageValue(piece.slice(eq + 1));
    if (!category || !parsed) {
      malformed.push(piece);
      continue;
    }
    signals.push({ category, value: parsed });
  }
  return { signals, malformed };
}

/**
 * Resolve the declared preference for a path: the most specific applicable group
 * wins (an exact user-agent group beats `*`), and the last `Content-Usage` line
 * in that group wins, so a later block can override an earlier one.
 */
export function resolveUsage(groups: RobotsGroup[], path: string, token: string): UsageDecision {
  const needle = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && needle.startsWith(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));

  const signals: UsageSignal[] = [];
  const malformed: string[] = [];
  let trainAi: UsageValue | null = null;
  let source: string | null = null;

  for (const group of chosen) {
    if (group.contentUsage.length === 0) continue;
    const applies = group.rules.length === 0 || group.rules.some((rule) => matchesPath(rule.pattern, path));
    if (!applies) continue;
    for (const raw of group.contentUsage) {
      const parsed = parseUsageSignals(raw);
      signals.push(...parsed.signals);
      malformed.push(...parsed.malformed);
      const train = parsed.signals.find((signal) => signal.category === "train-ai");
      if (train) {
        trainAi = train.value;
        source = `User-agent: ${group.agents.join(", ")}`;
      }
    }
  }

  return { signals, trainAi, source, malformed };
}

/** robots.txt pattern matching, minus the specificity ranking robots.ts handles. */
function matchesPath(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  try {
    return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path);
  } catch {
    return false;
  }
}

/** Human wording for a declared value. */
export function describeUsage(value: UsageValue): string {
  if (value === "y") return "training allowed";
  if (value === "n") return "training not allowed";
  return "training preference unspecified (ask)";
}
