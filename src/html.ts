/**
 * A deliberately small HTML reader.
 *
 * We do not want a full HTML parser here: the question is only "what readable
 * text would a crawler get out of this response", so we strip the parts no
 * crawler turns into text and collapse the rest. Being conservative beats being
 * clever: if we miss a tag, the worst case is a little extra whitespace.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  rsquo: "\u2019",
  lsquo: "\u2018",
  ldquo: "\u201c",
  rdquo: "\u201d",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  eacute: "\u00e9",
  egrave: "\u00e8",
  uml: "\u00a8",
  euro: "\u20ac",
  pound: "\u00a3",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Remove elements whose contents are never page text. */
function dropHidden(html: string): string {
  let out = html;
  for (const tag of ["script", "style", "noscript", "template", "svg", "canvas"]) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    // Unclosed tags at the end of a truncated body.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "gi"), " ");
  }
  // Comments, including conditional comments.
  out = out.replace(/<!--[\s\S]*?-->/g, " ");
  return out;
}

const BLOCK_TAGS =
  "p|div|section|article|header|footer|main|aside|nav|li|ul|ol|dl|dt|dd|h1|h2|h3|h4|h5|h6|br|tr|td|th|table|blockquote|pre|figure|figcaption|form|fieldset|hr";

/** Tags that end a line of text once they close. */
function addLineBreaks(html: string): string {
  return html
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]+>/g, " ");
}

export function htmlToText(html: string): string {
  const withoutHidden = dropHidden(html);
  const withBreaks = addLineBreaks(withoutHidden);
  const decoded = decodeEntities(withBreaks);
  return decoded
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function firstMatch(html: string, re: RegExp): string {
  const m = html.match(re);
  if (!m || !m[1]) return "";
  return decodeEntities(m[1]).replace(/\s+/g, " ").trim();
}

export interface ExtractedPage {
  title: string;
  description: string;
  canonical: string;
  lang: string;
  jsonLdTypes: string[];
  text: string;
  wordCount: number;
}

export interface ShellCheck {
  /** True when the HTML looks like a client-side app waiting for its bundle. */
  shell: boolean;
  /** The empty mount node we found, e.g. `<div id="root">`. */
  rootMarker: string | null;
  /** Bytes of inline script, a crude proxy for "there is an app in here". */
  inlineScriptBytes: number;
}

const ROOT_MARKER = /<div[^>]+id=["'](root|app|__next|__nuxt|react-root|svelte)["'][^>]*>/i;

/**
 * A guess, clearly labelled as one: a body with almost no text plus an empty
 * mount node (or a very large inline bundle) is an application shell. It is
 * only used when --render was not given, and the verdict says "heuristic".
 */
export function looksLikeSpaShell(html: string, wordCount: number): ShellCheck {
  const marker = html.match(ROOT_MARKER);
  let inlineScriptBytes = 0;
  const scriptRe = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    inlineScriptBytes += (m[1] ?? "").length;
  }
  const shell = wordCount < 30 && (marker !== null || inlineScriptBytes > 20_000);
  return {
    shell,
    rootMarker: marker ? (marker[0].split(">")[0] ?? null) : null,
    inlineScriptBytes,
  };
}

export function extractPage(html: string): ExtractedPage {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = firstMatch(
    html,
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
  ) || firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const lang = firstMatch(html, /<html[^>]+lang=["']([^"']+)["']/i);

  const jsonLdTypes: string[] = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  while ((ld = ldRe.exec(html)) !== null) {
    const body = ld[1] ?? "";
    const typeRe = /"@type"\s*:\s*"([^"]+)"/g;
    let t: RegExpExecArray | null;
    while ((t = typeRe.exec(body)) !== null) {
      const value = t[1];
      if (value && !jsonLdTypes.includes(value)) jsonLdTypes.push(value);
    }
  }

  const text = htmlToText(html);
  return { title, description, canonical, lang, jsonLdTypes, text, wordCount: countWords(text) };
}
