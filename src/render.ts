/**
 * Optional JavaScript rendering, used only for the raw-vs-rendered diff.
 *
 * Playwright is not a dependency: it is imported at run time so a user who only
 * wants the per-bot fetch never downloads a browser. If it is missing, the CLI
 * explains how to add it and carries on with the rest of the audit.
 */

import type { Renderer, RenderResult } from "./types.js";

const NOT_INSTALLED =
  "Playwright is not installed. Run `npm i -D playwright && npx playwright install chromium` " +
  "in this project, then repeat with --render.";

interface PlaywrightModule {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<{
      newPage(options?: Record<string, unknown>): Promise<{
        goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
        title(): Promise<string>;
        evaluate<T>(fn: () => T): Promise<T>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
}

export interface PlaywrightRendererOptions {
  timeoutMs: number;
  /** Viewport width; wide screens get the desktop layout most crawlers see. */
  viewport?: { width: number; height: number };
  userAgent?: string;
}

export async function createPlaywrightRenderer(
  options: PlaywrightRendererOptions,
): Promise<Renderer> {
  let playwright: PlaywrightModule;
  try {
    // Keep the specifier opaque so TypeScript does not need playwright types.
    const specifier = "playwright";
    playwright = (await import(specifier)) as unknown as PlaywrightModule;
  } catch {
    throw new Error(NOT_INSTALLED);
  }

  return async (url: string): Promise<RenderResult> => {
    const browser = await playwright.chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
        viewport: options.viewport ?? { width: 1440, height: 900 },
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      });
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: options.timeoutMs,
      });
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      const title = await page.title();
      const words = text
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 0).length;
      await page.close();
      return { ok: true, error: null, text, wordCount: words, title };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        text: "",
        wordCount: 0,
        title: "",
      };
    } finally {
      await browser.close();
    }
  };
}
