/**
 * Comparing two versions of a page's text.
 *
 * Two questions matter here:
 *  - "how much of the rendered page is missing from the raw HTML" (JS-only
 *    content), which is a set difference over sentences;
 *  - "does this bot get materially different text than a browser" (cloaking),
 *    which is a similarity score over words.
 *
 * Both are heuristics. The README says so, and the report always shows the
 * numbers behind a verdict so a reader can disagree with it.
 */

import type { JsOnlyReport } from "./types.js";

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/\u2019/g, "'")
    .trim();
}

export function words(text: string): string[] {
  const normalized = normalize(text).replace(/[^\p{L}\p{N}'\s]/gu, " ");
  return normalized.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Sorensen-Dice coefficient over word multisets: 0 means no shared words,
 * 1 means the same words in the same proportions. Used for short texts, where
 * shingles would have nothing to work with.
 */
export function wordSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);

  let shared = 0;
  for (const w of wb) {
    const n = counts.get(w);
    if (n && n > 0) {
      shared += 1;
      counts.set(w, n - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

function shingles(text: string, size: number): Set<string> {
  const ws = words(text);
  const out = new Set<string>();
  for (let i = 0; i + size <= ws.length; i += 1) {
    out.add(ws.slice(i, i + size).join(" "));
  }
  return out;
}

/**
 * Jaccard similarity over 5-word shingles.
 *
 * Shingles, not single words, because a page that keeps its navigation and only
 * swaps the article body still shares most of its vocabulary; word order is the
 * thing cloaking usually changes.
 */
export function shingleSimilarity(a: string, b: string, size = 5): number {
  const sa = shingles(a, size);
  const sb = shingles(b, size);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

/**
 * Similarity used by the cloaking verdict: shingle Jaccard for pages long
 * enough to have shingles, Dice over words for snippets.
 */
export function similarity(a: string, b: string): number {
  if (words(a).length >= 10 && words(b).length >= 10) return shingleSimilarity(a, b);
  return wordSimilarity(a, b);
}

/** Split into sentences, keeping list items and headings as their own units. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?\u3002])\s+(?=[A-Z0-9\u00c0-\u024f"'\u201c(])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function comparisonKey(sentence: string): string {
  return normalize(sentence).replace(/[^\p{L}\p{N}\s']/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * Sentences present in `rendered` but not in `raw`.
 *
 * A sentence counts as present when its normalised form appears as a substring
 * of the normalised raw text, so small punctuation or whitespace differences
 * do not create false positives.
 */
export function missingSentences(raw: string, rendered: string): string[] {
  const haystack = comparisonKey(raw);
  const out: string[] = [];
  for (const sentence of sentences(rendered)) {
    const key = comparisonKey(sentence);
    if (key.length === 0) continue;
    const wordCount = key.split(" ").length;
    if (wordCount < 5) continue;
    if (!haystack.includes(key)) out.push(sentence);
  }
  return out;
}

export function jsOnlyReport(rawText: string, renderedText: string): JsOnlyReport {
  const missing = missingSentences(rawText, renderedText);
  const missingWords = missing.reduce((sum, s) => sum + words(s).length, 0);
  const renderedWords = words(renderedText).length;
  const rawWords = words(rawText).length;
  const ratio =
    renderedWords === 0 ? 0 : Math.min(1, Math.max(0, 1 - rawWords / renderedWords));
  return {
    renderedWords,
    rawWords,
    missingWords,
    ratio,
    sample: missing.slice(0, 5),
  };
}
