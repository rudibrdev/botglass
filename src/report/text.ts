/**
 * Terminal output: one block per page, one row per bot, then plain-language
 * findings. Kept narrow enough to read in a normal 100-column terminal.
 */

import type { PageReport, RunReport, Verdict } from "../types.js";

const COLORS: Record<Verdict, string> = {
  ok: "\u001b[32m",
  "js-dependent": "\u001b[33m",
  cloaked: "\u001b[33m",
  "robots-blocked": "\u001b[36m",
  "ua-blocked": "\u001b[31m",
  error: "\u001b[31m",
};
const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";

function paint(text: string, color: string | null, enabled: boolean): string {
  if (!enabled || !color) return text;
  return `${color}${text}${RESET}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}\u2026`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function statusLabel(page: PageReport): string {
  const status = page.httpStatus === null ? "no response" : `HTTP ${page.httpStatus}`;
  const words = page.baseline.wordCount;
  const rendered = page.render?.ok ? `, ${page.render.wordCount} words rendered` : "";
  return `${status}, ${words} words in raw HTML${rendered}`;
}

export interface TextReportOptions {
  color?: boolean;
  /** Show the raw sample sentences behind a js-dependent verdict. */
  showSamples?: boolean;
}

export function renderPageText(page: PageReport, options: TextReportOptions = {}): string {
  const color = options.color === true;
  const lines: string[] = [];
  lines.push(paint(page.url, BOLD, color));
  lines.push(`  ${statusLabel(page)}`);

  const header = `  ${pad("bot", 18)}${pad("status", 8)}${pad("words", 7)}${pad("verdict", 16)}note`;
  lines.push(paint(header, DIM, color));

  for (const verdict of page.verdicts) {
    const bot = page.bots.find((b) => b.bot === verdict.bot);
    const status = bot?.status === null || bot?.status === undefined ? "-" : String(bot.status);
    const words = bot ? String(bot.wordCount) : "-";
    lines.push(
      `  ${pad(verdict.bot, 18)}${pad(status, 8)}${pad(words, 7)}${paint(
        pad(verdict.verdict, 16),
        COLORS[verdict.verdict],
        color,
      )}${truncate(verdict.reason, 80)}`,
    );
  }

  if (options.showSamples && page.jsOnly && page.jsOnly.sample.length > 0) {
    lines.push("");
    lines.push(paint("  Content only present after JavaScript runs:", DIM, color));
    for (const sample of page.jsOnly.sample) {
      lines.push(`    - ${truncate(sample, 110)}`);
    }
  }

  if (page.findings.length > 0) {
    lines.push("");
    for (const finding of page.findings) {
      const prefix =
        finding.level === "error" ? "ERROR" : finding.level === "warn" ? "WARN " : "INFO ";
      const colorCode =
        finding.level === "error" ? "\u001b[31m" : finding.level === "warn" ? "\u001b[33m" : "\u001b[36m";
      lines.push(`  ${paint(prefix, colorCode, color)} ${finding.message}`);
    }
  }

  return lines.join("\n");
}

export function renderRunText(report: RunReport, options: TextReportOptions = {}): string {
  const color = options.color === true;
  const parts: string[] = [];
  const botCount = report.pages[0]?.bots.length ?? 0;
  parts.push(
    paint(
      `botglass ${report.version}  ${report.pages.length} page(s), ${botCount} bots, render ${report.options.render ? "on" : "off"}`,
      DIM,
      color,
    ),
  );
  for (const page of report.pages) {
    parts.push("");
    parts.push(renderPageText(page, options));
  }
  const counts = summarise(report);
  parts.push("");
  parts.push(paint(`Totals: ${counts}`, DIM, color));
  return parts.join("\n");
}

export function summarise(report: RunReport): string {
  const tally = new Map<string, number>();
  for (const page of report.pages) {
    for (const v of page.verdicts) tally.set(v.verdict, (tally.get(v.verdict) ?? 0) + 1);
  }
  const order: Verdict[] = ["ok", "js-dependent", "cloaked", "robots-blocked", "ua-blocked", "error"];
  return order
    .filter((v) => tally.has(v))
    .map((v) => `${tally.get(v)} ${v}`)
    .join(" \u00b7 ");
}

/** Bot verdicts that should make CI fail for the given thresholds. */
export function failingVerdicts(report: RunReport, failOn: Verdict[]): Array<{ url: string; bot: string; verdict: Verdict }> {
  const out: Array<{ url: string; bot: string; verdict: Verdict }> = [];
  if (failOn.length === 0) return out;
  for (const page of report.pages) {
    for (const v of page.verdicts) {
      if (failOn.includes(v.verdict)) {
        out.push({ url: page.url, bot: v.bot, verdict: v.verdict });
      }
    }
  }
  return out;
}
