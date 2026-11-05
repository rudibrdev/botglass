/**
 * AI usage preferences: the `Content-Usage` rule in robots.txt.
 *
 * The rule is defined by draft-ietf-aipref-attach and the preference vocabulary
 * by draft-ietf-aipref-vocab (both read from ietf-wg-aipref/drafts, main):
 *
 *   User-agent: *
 *   Allow: /
 *   Content-Usage: train-ai=n
 *   Content-Usage: /ai-ok/ train-ai=y
 *
 * Each rule is an optional path prefix, one SP or HTAB, then a structured-field
 * dictionary (RFC 9651). Paths use the same prefix matching as Allow/Disallow:
 * the longest matching path prefix wins. Rules only apply to resources that are
 * crawlable; a disallowed resource has no usage preference at all.
 *
 * The vocabulary is case sensitive and currently defines exactly two explicit
 * preference tokens: `y` (allow) and `n` (disallow). Anything else — `u`,
 * `maybe`, a bare key, a string, a number — leaves that category unknown. It is
 * not an error and it is not a request to ask permission. Unknown categories and
 * unknown parameters are ignored, as the vocabulary requires.
 *
 * Parsing scope: there is no structured-field package in this project, so this
 * module implements the RFC 9651 dictionary subset the vocabulary uses, and is
 * deliberately strict about syntax. It accepts keys, token/string/number/
 * boolean/byte-sequence values, parameters and inner lists, and it rejects
 * uppercase keys, spaces around `=`, trailing commas and malformed quoting.
 * It does not enforce Integer/Decimal magnitude limits, duplicate parameter
 * rejection or every MUST-level restriction in RFC 9651 Section 4.2. This is
 * therefore an honest subset, not a claim of full RFC 9651 compliance.
 */

import { isAllowed, robotsPatternLength, robotsPatternMatches, type RobotsGroup } from "./robots.js";

export type UsageValue = "y" | "n";

export interface UsageSignal {
  /** Category label, exactly as written (labels are case sensitive). */
  category: string;
  value: UsageValue;
}

/** Categories in the draft vocabulary (draft-ietf-aipref-vocab). */
export const KNOWN_CATEGORIES = ["train-ai", "ai-use", "search"] as const;

export function isKnownCategory(category: string): boolean {
  return (KNOWN_CATEGORIES as readonly string[]).includes(category);
}

export interface UsageDecision {
  /**
   * Effective explicit preferences for this path, in vocabulary order. A
   * category that is absent is unknown, not disallowed.
   */
  signals: UsageSignal[];
  /** The effective `train-ai` preference for this path, or null when unknown. */
  trainAi: UsageValue | null;
  /** The robots.txt group that supplied the declaration, e.g. `User-agent: *`. */
  source: string | null;
  /** Preference strings we could not parse as a dictionary, reported verbatim. */
  malformed: string[];
  /** Dictionary labels outside the vocabulary; ignored for preferences. */
  unknownCategories: string[];
  /**
   * Known labels whose value is not the token `y` or `n` (for example `u`),
   * which leaves that category unknown. Reported for diagnosis, never guessed.
   * Optional so older serialized reports and callers keep the original shape.
   */
  unknownValues?: string[];
}

export interface ContentUsageRule {
  /** Path prefix as written, or "" when the rule has no path. */
  path: string;
  /** Literal octets in the path prefix; 0 for a rule with no path. */
  specificity: number;
  signals: UsageSignal[];
  malformed: string[];
  unknownCategories: string[];
  unknownValues: string[];
}

/**
 * A preference token is exactly `y` or `n`. Case matters: `Y` is not a
 * preference, and `u` is not a defined "ask" value (it is simply unknown).
 */
export function parseUsageValue(raw: string): UsageValue | null {
  const value = raw.replace(/^[ \t]+|[ \t]+$/g, "");
  return value === "y" || value === "n" ? value : null;
}

type SfItem =
  | { kind: "token"; value: string }
  | { kind: "boolean" | "string" | "number" | "binary" | "list"; value: string };

class DictionaryParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): { dictionary: Map<string, SfItem>; error: string | null } {
    const dictionary = new Map<string, SfItem>();
    this.skipOws();
    if (this.index >= this.input.length) return { dictionary, error: "empty dictionary" };

    for (;;) {
      const key = this.parseKey();
      if (key === null) return { dictionary, error: "invalid dictionary key" };
      this.skipOws();

      let item: SfItem;
      if (this.peek() === "=") {
        this.index += 1;
        if (this.peek() === " " || this.peek() === "\t") {
          return { dictionary, error: "space after =" };
        }
        const parsed = this.parseItem();
        if (parsed === null) return { dictionary, error: "invalid dictionary value" };
        item = parsed;
      } else {
        // A bare key is the boolean true in RFC 9651, never a token.
        item = { kind: "boolean", value: "true" };
        if (!this.parseParameters()) return { dictionary, error: "invalid parameters" };
      }

      // RFC 9651: the last occurrence of a key wins, parameters included.
      dictionary.set(key, item);

      this.skipOws();
      if (this.index >= this.input.length) break;
      if (this.peek() !== ",") return { dictionary, error: "expected comma" };
      this.index += 1;
      this.skipOws();
      if (this.index >= this.input.length) return { dictionary, error: "trailing comma" };
    }

    return { dictionary, error: null };
  }

  private peek(): string {
    return this.input[this.index] ?? "";
  }

  private skipOws(): void {
    while (this.peek() === " " || this.peek() === "\t") this.index += 1;
  }

  private parseKey(): string | null {
    const start = this.index;
    const first = this.peek();
    if (first !== "*" && !(first >= "a" && first <= "z")) return null;
    this.index += 1;
    while (this.index < this.input.length) {
      const ch = this.input[this.index] as string;
      if (
        ch === "*" ||
        (ch >= "a" && ch <= "z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "_" ||
        ch === "-" ||
        ch === "."
      ) {
        this.index += 1;
        continue;
      }
      break;
    }
    return this.input.slice(start, this.index);
  }

  private parseItem(): SfItem | null {
    const bare = this.parseBareItem();
    if (bare === null) return null;
    if (!this.parseParameters()) return null;
    return bare;
  }

  private parseParameters(): boolean {
    for (;;) {
      if (this.peek() !== ";") return true;
      this.index += 1;
      while (this.peek() === " ") this.index += 1;
      const key = this.parseKey();
      if (key === null) return false;
      if (this.peek() === "=") {
        this.index += 1;
        if (this.parseBareItem() === null) return false;
      }
    }
  }

  private parseBareItem(): SfItem | null {
    const ch = this.peek();
    if (ch === '"') return this.parseString();
    if (ch === ":") return this.parseByteSequence();
    if (ch === "(") return this.parseInnerList();
    if (ch === "?") {
      this.index += 1;
      const bit = this.peek();
      if (bit !== "0" && bit !== "1") return null;
      this.index += 1;
      return { kind: "boolean", value: bit };
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.parseNumber();
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "*") return this.parseToken();
    return null;
  }

  private parseToken(): SfItem | null {
    const start = this.index;
    const first = this.peek();
    if (first !== "*" && !(first >= "A" && first <= "Z") && !(first >= "a" && first <= "z")) return null;
    this.index += 1;
    while (this.index < this.input.length) {
      const ch = this.input[this.index] as string;
      // tchar plus ":" and "/", as allowed by RFC 9651 Section 3.3.4.
      if (/[A-Za-z0-9!#$%&'*+\-.^_`|~:/]/.test(ch)) {
        this.index += 1;
        continue;
      }
      break;
    }
    return { kind: "token", value: this.input.slice(start, this.index) };
  }

  private parseNumber(): SfItem | null {
    const start = this.index;
    if (this.peek() === "-") this.index += 1;
    const digitsStart = this.index;
    while (this.peek() >= "0" && this.peek() <= "9" && this.peek() !== "") this.index += 1;
    if (this.index === digitsStart) return null;
    if (this.peek() === ".") {
      this.index += 1;
      const fractionStart = this.index;
      while (this.peek() >= "0" && this.peek() <= "9" && this.peek() !== "") this.index += 1;
      if (this.index === fractionStart) return null;
    }
    return { kind: "number", value: this.input.slice(start, this.index) };
  }

  private parseString(): SfItem | null {
    this.index += 1; // opening quote
    let out = "";
    for (;;) {
      if (this.index >= this.input.length) return null;
      const ch = this.input[this.index] as string;
      this.index += 1;
      if (ch === '"') return { kind: "string", value: out };
      if (ch === "\\") {
        const escaped = this.peek();
        if (escaped !== '"' && escaped !== "\\") return null;
        out += escaped;
        this.index += 1;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code > 0x7e) return null;
      out += ch;
    }
  }

  private parseByteSequence(): SfItem | null {
    this.index += 1; // opening colon
    const start = this.index;
    while (this.index < this.input.length && this.input[this.index] !== ":") this.index += 1;
    if (this.index >= this.input.length) return null;
    const value = this.input.slice(start, this.index);
    if (value.length > 0 && !/^[A-Za-z0-9+/=]+$/.test(value)) return null;
    this.index += 1; // closing colon
    return { kind: "binary", value };
  }

  private parseInnerList(): SfItem | null {
    this.index += 1; // opening paren
    for (;;) {
      while (this.peek() === " ") this.index += 1;
      if (this.peek() === ")") {
        this.index += 1;
        return { kind: "list", value: "()" };
      }
      if (this.index >= this.input.length) return null;
      if (this.parseBareItem() === null) return null;
      if (!this.parseParameters()) return null;
      const next = this.peek();
      if (next !== " " && next !== ")") return null;
    }
  }
}

/**
 * Parse one preference dictionary, e.g. `train-ai=n, search=y`.
 *
 * Duplicate keys follow RFC 9651: the last value wins. Parameters are parsed
 * and discarded. A parse failure makes the whole statement unknown, which is
 * why the original string is returned in `malformed` rather than a guess.
 */
export function parseUsageSignals(value: string): {
  signals: UsageSignal[];
  malformed: string[];
  unknownCategories: string[];
  unknownValues: string[];
} {
  const trimmed = value.replace(/^[ \t]+|[ \t]+$/g, "");
  const { dictionary, error } = new DictionaryParser(trimmed).parse();
  if (error !== null) {
    return { signals: [], malformed: [trimmed], unknownCategories: [], unknownValues: [] };
  }

  const signals: UsageSignal[] = [];
  const unknownCategories: string[] = [];
  const unknownValues: string[] = [];

  for (const [label, item] of dictionary) {
    if (!isKnownCategory(label)) {
      unknownCategories.push(label);
      continue;
    }
    if (item.kind === "token" && (item.value === "y" || item.value === "n")) {
      signals.push({ category: label, value: item.value });
    } else {
      unknownValues.push(label);
    }
  }

  const rank = (label: string): number =>
    KNOWN_CATEGORIES.indexOf(label as (typeof KNOWN_CATEGORIES)[number]);

  signals.sort((a, b) => rank(a.category) - rank(b.category));
  unknownCategories.sort();
  unknownValues.sort((a, b) => rank(a) - rank(b));

  return { signals, malformed: [], unknownCategories, unknownValues };
}

/**
 * Split a robots.txt Content-Usage rule value into its optional path prefix and
 * preference dictionary, then parse the dictionary.
 */
export function parseContentUsageRule(value: string): ContentUsageRule {
  const raw = value.replace(/^[ \t]+|[ \t]+$/g, "");
  let path = "";
  let preference = raw;

  if (raw.startsWith("/")) {
    const separator = raw.search(/[ \t]/);
    if (separator === -1) {
      return {
        path: raw,
        specificity: robotsPatternLength(raw),
        signals: [],
        malformed: [raw],
        unknownCategories: [],
        unknownValues: [],
      };
    }
    path = raw.slice(0, separator);
    preference = raw.slice(separator).replace(/^[ \t]+|[ \t]+$/g, "");
  }

  if (!preference) {
    return {
      path,
      specificity: path ? robotsPatternLength(path) : 0,
      signals: [],
      malformed: [raw],
      unknownCategories: [],
      unknownValues: [],
    };
  }

  const parsed = parseUsageSignals(preference);
  return {
    path,
    specificity: path ? robotsPatternLength(path) : 0,
    ...parsed,
  };
}

/** Groups that apply to a robots token: exact product-token groups beat `*`. */
function applicableGroups(groups: RobotsGroup[], token: string): RobotsGroup[] {
  const needle = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && needle.startsWith(a)));
  if (specific.length > 0) return specific;
  return groups.filter((g) => g.agents.includes("*"));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function emptyDecision(): UsageDecision {
  return {
    signals: [],
    trainAi: null,
    source: null,
    malformed: [],
    unknownCategories: [],
    unknownValues: [],
  };
}

/**
 * Resolve the usage preference for one path and one robots token.
 *
 * 1. Pick the user-agent groups that apply (an exact token group beats `*`).
 * 2. If the path is not crawlable under Allow/Disallow, there is no preference.
 * 3. Among matching Content-Usage rules, keep only the longest path prefix.
 * 4. Combine preferences at that prefix per draft-ietf-aipref-vocab Section 7.1:
 *    any `n` wins, otherwise any `y`, otherwise unknown. Order never matters.
 */
export function resolveUsage(groups: RobotsGroup[], path: string, token: string): UsageDecision {
  const applicable = applicableGroups(groups, token);
  if (applicable.length === 0) return emptyDecision();

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!isAllowed(groups, normalizedPath, token).allowed) return emptyDecision();

  const rules: Array<{ parsed: ContentUsageRule; group: RobotsGroup }> = [];
  for (const group of applicable) {
    for (const raw of group.contentUsage) {
      rules.push({ parsed: parseContentUsageRule(raw), group });
    }
  }

  const malformed = unique(rules.flatMap((entry) => entry.parsed.malformed));

  const matched = rules.filter(
    (entry) => entry.parsed.path === "" || robotsPatternMatches(entry.parsed.path, normalizedPath),
  );
  if (matched.length === 0) {
    return { ...emptyDecision(), malformed };
  }

  const longest = Math.max(...matched.map((entry) => entry.parsed.specificity));
  const winners = matched.filter((entry) => entry.parsed.specificity === longest);

  // Most restrictive wins, so the result does not depend on file order.
  const effective = new Map<string, UsageValue>();
  for (const { parsed } of winners) {
    for (const signal of parsed.signals) {
      if (signal.value === "n" || !effective.has(signal.category)) {
        effective.set(signal.category, signal.value);
      }
    }
  }

  const signals: UsageSignal[] = [];
  for (const category of KNOWN_CATEGORIES) {
    const value = effective.get(category);
    if (value) signals.push({ category, value });
  }

  const sourceAgents = unique(winners.flatMap((entry) => entry.group.agents));
  return {
    signals,
    trainAi: effective.get("train-ai") ?? null,
    source: sourceAgents.length > 0 ? `User-agent: ${sourceAgents.join(", ")}` : null,
    malformed,
    unknownCategories: unique(winners.flatMap((entry) => entry.parsed.unknownCategories)).sort(),
    unknownValues: unique(winners.flatMap((entry) => entry.parsed.unknownValues)).sort(
      (a, b) =>
        KNOWN_CATEGORIES.indexOf(a as (typeof KNOWN_CATEGORIES)[number]) -
        KNOWN_CATEGORIES.indexOf(b as (typeof KNOWN_CATEGORIES)[number]),
    ),
  };
}

/** Human wording for an explicit preference. Unknown values have no wording. */
export function describeUsage(value: UsageValue): string {
  return value === "y" ? "training allowed" : "training not allowed";
}
