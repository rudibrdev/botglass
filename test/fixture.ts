/**
 * A local site with every shape the audit claims to recognise.
 *
 * The point of these fixtures is that each verdict in the README is proven by
 * an assertion against a page built to trigger exactly that verdict, rather
 * than by pointing the tool at a live site and trusting the output.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const ARTICLE = `Crawler text extraction is a solved problem for server-rendered pages.
Every paragraph in this article is present in the HTML response, so any crawler that
fetches the page receives the whole thing without running a single line of JavaScript.
That is the property this fixture exists to prove: the audit should call this page ok
for all eight crawlers and should not invent a JavaScript dependency that is not there.
The article continues for a few more sentences so that word counts stay above the
threshold used by the cloaking heuristic, which needs at least forty words on both
sides before it is willing to compare two pages at all.
Freshness matters here too: a page that answers 200 today proves nothing about next
week, which is why the tool prints the fetch time next to every result.`;

const CLOAKED_FOR_BOT = `This page is served to crawlers with a completely different message.
It talks about cheap offers and limited time discounts instead of the article a human
would read in a normal browser. Words like sale, voucher and bargain appear repeatedly
here, while the browser version contains none of them at all. A comparison of the two
texts should come out far below the similarity threshold used for the cloaking verdict.`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="Fixture page for botglass tests.">
<link rel="canonical" href="/canonical">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"x"}</script>
</head><body><main><h1>${title}</h1>${body}</main></body></html>`;
}

function paragraphs(text: string): string {
  return text
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\s+/g, " ").trim()}</p>`)
    .join("\n");
}

const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App shell</title></head>
<body><div id="root"></div><noscript>You need JavaScript to view this app.</noscript>
<script src="/app.js"></script></body></html>`;

const ROBOTS = `# fixture robots
User-agent: GPTBot
Disallow: /secret

User-agent: ClaudeBot
Disallow: /claude-off

User-agent: *
Allow: /
Disallow: /private
Content-Usage: train-ai=n, search=y
Content-Usage: /ssr train-ai=y
Content-Usage: /private train-ai=y
`;

/** robots.txt that declares training allowed. */
const ROBOTS_ALLOW = `User-agent: *
Allow: /
Content-Usage: train-ai=y
`;

/** robots.txt with a broken Content-Usage value. */
const ROBOTS_BAD = `User-agent: *
Allow: /
Content-Usage: train-ai=maybe, , broken
`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>__BASE__/ssr</loc></url>
  <url><loc>__BASE__/thin</loc></url>
</urlset>`;

const SITEMAP_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>__BASE__/sitemap.xml</loc></sitemap>
</sitemapindex>`;

export interface Fixture {
  base: string;
  close(): Promise<void>;
}

export async function startFixture(): Promise<Fixture> {
  const hits: string[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture.local");
    const ua = req.headers["user-agent"] ?? "";
    hits.push(`${url.pathname} ${ua.slice(0, 40)}`);

    const send = (status: number, body: string, type = "text/html; charset=utf-8") => {
      res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
      res.end(body);
    };

    switch (url.pathname) {
      case "/robots.txt":
        return send(200, ROBOTS, "text/plain; charset=utf-8");
      case "/robots-allow.txt":
        return send(200, ROBOTS_ALLOW, "text/plain; charset=utf-8");
      case "/robots-bad.txt":
        return send(200, ROBOTS_BAD, "text/plain; charset=utf-8");
      case "/sitemap.xml":
        return send(200, SITEMAP.replace(/__BASE__/g, base), "application/xml");
      case "/sitemap-index.xml":
        return send(200, SITEMAP_INDEX.replace(/__BASE__/g, base), "application/xml");
      case "/ssr":
        return send(200, page("Server-rendered article", paragraphs(ARTICLE)));
      case "/thin":
        return send(200, page("Thin page", "<p>Almost no words here.</p>"));
      case "/client-only":
        return send(200, SHELL);
      case "/app.js":
        return send(200, "document.getElementById('root').textContent='app';", "text/javascript");
      case "/cloaked":
        return /GPTBot/i.test(ua)
          ? send(200, page("Special offer", paragraphs(CLOAKED_FOR_BOT)))
          : send(200, page("Server-rendered article", paragraphs(ARTICLE)));
      case "/blocked":
        return /bot|crawl|spider/i.test(ua)
          ? send(403, page("Forbidden", "<p>No bots.</p>"))
          : send(200, page("Server-rendered article", paragraphs(ARTICLE)));
      case "/secret":
        return send(200, page("Secret", paragraphs(ARTICLE)));
      case "/claude-off":
        return send(200, page("Claude off", paragraphs(ARTICLE)));
      case "/private":
        return send(200, page("Private", paragraphs(ARTICLE)));
      case "/redirect":
        res.writeHead(302, { location: "/ssr" });
        return res.end();
      default:
        return send(404, page("Not found", "<p>Nothing here.</p>"));
    }
  });

  let base = "";
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  return {
    base,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
