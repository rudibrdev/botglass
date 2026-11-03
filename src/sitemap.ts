/**
 * Sitemap reading for batch mode.
 *
 * Handles a plain <urlset> or a nested <sitemapindex> one level deep, which is
 * what WordPress/Yoast, Next.js and most static generators emit. We deliberately
 * do not walk an entire site by following links: a sitemap is the list the site
 * itself declares, and it keeps the number of requests predictable.
 */

export interface SitemapFetch {
  urls: string[];
  sitemaps: string[];
  errors: string[];
}

const LOC_RE = /<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi;

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

export function parseSitemap(xml: string): { kind: "index" | "urlset" | "unknown"; locs: string[] } {
  const kind = /<sitemapindex\b/i.test(xml)
    ? "index"
    : /<urlset\b/i.test(xml)
      ? "urlset"
      : "unknown";
  const locs: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) {
    const value = decodeXml(m[1] ?? "");
    if (value) locs.push(value);
  }
  return { kind, locs };
}

export interface LoadSitemapOptions {
  userAgent: string;
  timeoutMs: number;
  maxUrls: number;
  maxChildSitemaps?: number;
}

export async function loadSitemap(
  sitemapUrl: string,
  options: LoadSitemapOptions,
): Promise<SitemapFetch> {
  const urls: string[] = [];
  const sitemaps: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [sitemapUrl];
  const maxChild = options.maxChildSitemaps ?? 10;

  while (queue.length > 0 && urls.length < options.maxUrls) {
    const next = queue.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    try {
      const res = await fetch(next, {
        headers: { "User-Agent": options.userAgent, Accept: "application/xml,text/xml,*/*" },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!res.ok) {
        errors.push(`${next} returned HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const parsed = parseSitemap(xml);
      if (parsed.kind === "index") {
        sitemaps.push(next);
        for (const child of parsed.locs.slice(0, maxChild)) {
          if (!seen.has(child)) queue.push(child);
        }
      } else if (parsed.kind === "urlset") {
        for (const loc of parsed.locs) {
          if (urls.length >= options.maxUrls) break;
          if (!urls.includes(loc)) urls.push(loc);
        }
      } else {
        errors.push(`${next} is not a sitemap (no <urlset> or <sitemapindex>)`);
      }
    } catch (err) {
      errors.push(`${next}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { urls: urls.slice(0, options.maxUrls), sitemaps, errors };
}

/** Read a newline-separated URL list, ignoring blanks and #comments. */
export function parseUrlList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => (/^https?:\/\//i.test(line) ? line : `https://${line}`));
}
