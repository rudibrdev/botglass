/**
 * Assembling a run: totals, and the CI gate decision.
 *
 * The gate is separate from the report so `--fail-on` behaves identically for
 * the terminal, the JSON file and the HTML report, and so the tests can check
 * exit-code logic without running an audit.
 */

import { TOOL, VERSION } from "../version.js";
import { emptyCounts } from "../types.js";
import type { GateResult, PageReport, RunOptions, RunReport, Verdict } from "../types.js";

export function countVerdicts(pages: PageReport[]): Record<Verdict, number> {
  const counts = emptyCounts();
  for (const page of pages) {
    for (const verdict of page.verdicts) {
      counts[verdict.verdict] += 1;
    }
  }
  return counts;
}

export interface GateInput {
  pages: PageReport[];
  failOn: Verdict[];
  maxJsOnly: number | null;
}

export function evaluateGate(input: GateInput): GateResult {
  const reasons: string[] = [];
  const failOn = new Set(input.failOn);

  for (const page of input.pages) {
    for (const verdict of page.verdicts) {
      if (failOn.has(verdict.verdict)) {
        reasons.push(`${page.url} — ${verdict.bot}: ${verdict.verdict}`);
      }
    }
    if (input.maxJsOnly !== null && page.jsOnly && page.jsOnly.ratio > input.maxJsOnly) {
      reasons.push(
        `${page.url} — ${(page.jsOnly.ratio * 100).toFixed(0)}% of the rendered text is JavaScript-only (limit ${(input.maxJsOnly * 100).toFixed(0)}%)`,
      );
    }
  }

  return { failed: reasons.length > 0, reasons };
}

export interface BuildRunInput {
  pages: PageReport[];
  options: RunOptions;
  startedAt: Date;
  finishedAt?: Date;
  warnings?: string[];
}

export function buildRunReport(input: BuildRunInput): RunReport {
  const finishedAt = input.finishedAt ?? new Date();
  const gate = evaluateGate({
    pages: input.pages,
    failOn: input.options.failOn,
    maxJsOnly: input.options.maxJsOnly,
  });
  return {
    tool: TOOL,
    version: VERSION,
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    pages: input.pages,
    options: input.options,
    counts: countVerdicts(input.pages),
    gate,
    warnings: input.warnings ?? [],
  };
}
