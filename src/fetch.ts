/**
 * Fetching a URL as a given identity.
 *
 * We follow redirects by hand so the report can show the chain: a crawler that
 * is redirected to a login page or a different host is worth knowing about,
 * and `fetch`'s automatic follow hides that.
 */

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export interface FetchOptions {
  timeoutMs: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
}

export interface FetchOutcome {
  status: number | null;
  finalUrl: string | null;
  redirects: string[];
  body: string;
  bodyBytes: number;
  truncated: boolean;
  durationMs: number;
  error: string | null;
}

function headersFor(userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en;q=0.9,*;q=0.5",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

export async function fetchAs(
  url: string,
  userAgent: string,
  options: FetchOptions,
): Promise<FetchOutcome> {
  const started = Date.now();
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBodyBytes = options.maxBodyBytes ?? 3_000_000;
  const redirects: string[] = [];
  let current = url;
  let status: number | null = null;
  let finalUrl: string | null = null;

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await fetch(current, {
        redirect: "manual",
        headers: headersFor(userAgent),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      status = response.status;
      finalUrl = current;

      const location = response.headers.get("location");
      if (REDIRECT_CODES.has(response.status) && location) {
        const next = new URL(location, current).toString();
        redirects.push(next);
        current = next;
        // Drain the body so the socket is released.
        await response.arrayBuffer().catch(() => undefined);
        continue;
      }

      const buffer = await response.arrayBuffer();
      const truncated = buffer.byteLength > maxBodyBytes;
      const slice = truncated ? buffer.slice(0, maxBodyBytes) : buffer;
      const body = new TextDecoder("utf-8", { fatal: false }).decode(slice);
      return {
        status,
        finalUrl,
        redirects,
        body,
        bodyBytes: buffer.byteLength,
        truncated,
        durationMs: Date.now() - started,
        error: null,
      };
    }

    return {
      status,
      finalUrl,
      redirects,
      body: "",
      bodyBytes: 0,
      truncated: false,
      durationMs: Date.now() - started,
      error: `too many redirects (>${maxRedirects})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status,
      finalUrl,
      redirects,
      body: "",
      bodyBytes: 0,
      truncated: false,
      durationMs: Date.now() - started,
      error: message,
    };
  }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function originOf(url: string): string {
  return new URL(url).origin;
}
