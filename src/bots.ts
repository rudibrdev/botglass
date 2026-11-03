import type { BotIdentity } from "./types.js";

export type { BotIdentity };

/**
 * Crawler identities we imitate.
 *
 * The User-Agent strings are taken from each vendor's public documentation
 * (linked per entry). Vendors change versions; a stale version string is not
 * a correctness problem here because we are testing "does this site serve
 * content to a request that claims to be this crawler", but the docs links
 * let a reader check the current form.
 */
export const BOTS: BotIdentity[] = [
  {
    name: "GPTBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    robotsToken: "GPTBot",
    owner: "OpenAI (training)",
    docs: "https://platform.openai.com/docs/bots",
  },
  {
    name: "OAI-SearchBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
    robotsToken: "OAI-SearchBot",
    owner: "OpenAI (ChatGPT search index)",
    docs: "https://platform.openai.com/docs/bots",
  },
  {
    name: "ChatGPT-User",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
    robotsToken: "ChatGPT-User",
    owner: "OpenAI (user-triggered fetch)",
    docs: "https://platform.openai.com/docs/bots",
  },
  {
    name: "ClaudeBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    robotsToken: "ClaudeBot",
    owner: "Anthropic",
    docs: "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  {
    name: "PerplexityBot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    robotsToken: "PerplexityBot",
    owner: "Perplexity",
    docs: "https://docs.perplexity.ai/guides/bots",
  },
  {
    name: "CCBot",
    userAgent: "CCBot/2.0 (https://commoncrawl.org/faq/)",
    robotsToken: "CCBot",
    owner: "Common Crawl (open training corpus)",
    docs: "https://commoncrawl.org/ccbot",
  },
  {
    name: "Googlebot",
    userAgent:
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    robotsToken: "Googlebot",
    owner: "Google (renders JavaScript)",
    docs: "https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers",
  },
  {
    name: "meta-externalagent",
    userAgent:
      "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    robotsToken: "meta-externalagent",
    owner: "Meta (AI training)",
    docs: "https://developers.facebook.com/docs/sharing/webmasters/crawler",
  },
];

/** The plain-browser fetch used as the humans see it baseline. */
export const BASELINE: BotIdentity = {
  name: "baseline",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  robotsToken: "*",
  owner: "you, in a browser",
  docs: "",
  baseline: true,
};

export function findBot(name: string): BotIdentity | undefined {
  const needle = name.toLowerCase();
  if (needle === BASELINE.name) return BASELINE;
  return BOTS.find((b) => b.name.toLowerCase() === needle);
}

export function selectBots(names?: string[]): BotIdentity[] {
  if (!names || names.length === 0) return BOTS;
  const out: BotIdentity[] = [];
  for (const n of names) {
    const bot = findBot(n);
    if (!bot) {
      throw new Error(
        `Unknown bot "${n}". Known bots: ${[...BOTS, BASELINE].map((b) => b.name).join(", ")}`,
      );
    }
    if (!bot.baseline) out.push(bot);
  }
  return out;
}
