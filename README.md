# botglass

See your site exactly as AI crawlers see it.

AI crawlers fetch your HTML and never run JavaScript. A React, Next.js or Vue page can
look finished to you and near-empty to GPTBot, ClaudeBot and PerplexityBot. `botglass`
fetches the same URL as a normal browser and as eight crawlers, compares the text each
one actually receives, checks robots.txt per bot, and prints one verdict per crawler.

No account, no API key, no dashboard, no telemetry. One command, plain HTTP.

## Quick start

```bash
npx github:rudibrdev/botglass https://example.com
```

Requires Node 20 or newer. From a clone:

```bash
git clone https://github.com/rudibrdev/botglass
cd botglass
npm install
npm test          # builds, then runs the whole suite
node dist/src/cli.js https://example.com
```

## What it prints

Real output, run against excalidraw.com and nextjs.org:

```
botglass 0.1.0  2 page(s), 8 bots, render on

https://excalidraw.com/
  HTTP 200, 3 words in raw HTML, 80 words rendered
  bot             status  words  verdict         note
  GPTBot          200     3      js-dependent    56% of the rendered text is missing from the raw HTML
  ClaudeBot       200     3      js-dependent    ...
```

The exit code stays 0 until you ask for a gate with `--fail-on` or `--max-js-only`.

## Verdicts

| verdict | meaning | how it is decided |
| --- | --- | --- |
| `ok` | the crawler gets the page | 2xx, robots allows it, text matches a browser |
| `js-dependent` | content arrives only after JavaScript | measured with `--render` (raw text under half of the rendered text, rendered page at least 50 words), otherwise a labelled heuristic (near-empty body plus an app mount node) |
| `cloaked` | the crawler gets different text than a browser | 5-word-shingle Jaccard similarity below 0.5, both versions at least 30 words, crawler sees less text |
| `robots-blocked` | robots.txt forbids this crawler here | RFC 9309 matching: longest path wins, `Allow` wins ties, `*` groups respected |
| `ua-blocked` | the server refuses the crawler | 401/403/406/429/451 for the bot while a browser gets 2xx |
| `error` | nothing useful to say about the content | fetch failure or the URL fails for a browser too |

Every verdict carries the numbers that produced it, and the JSON and HTML reports keep
`confidence: "measured"` or `"heuristic"` so a heuristic is never mistaken for a fact.

## Crawlers it imitates

GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, CCBot, Googlebot,
meta-externalagent — plus a plain Chrome baseline. `--list-bots` prints the set.
User-Agent strings come from each vendor's public documentation and the `docs` URL is in
`src/bots.ts`.

## Options

```
botglass <url> [options]

--sitemap <url|file>   Audit every URL in a sitemap (index files are followed)
--urls <file>          Audit a newline-separated URL list (# comments allowed)
--max-pages <n>        Cap the number of pages audited (default 10)
--bots <a,b>           Only these crawlers (default: all)
--render               Also render with JavaScript (needs Playwright)
--samples              Print the first missing sentences for js-dependent pages
--json <file>          Write the full report as JSON
--html <file>          Write a standalone HTML report
--fail-on <verdicts>   Comma-separated verdicts that should exit 1
--max-js-only <0..1>   Fail when more than this share of rendered text is JS-only
--timeout <ms>         Per-request timeout (default 15000)
--delay <ms>           Delay between requests to the same host (default 400)
--concurrency <n>      Pages audited in parallel (default 1)
--no-robots            Skip robots.txt
--no-color             Plain output even on a TTY
--quiet                Write no terminal report
--list-bots            Print the crawler identities and exit
```

## Batch mode

```bash
botglass --sitemap https://example.com/sitemap.xml --max-pages 50 --html report.html
botglass --urls pages.txt --bots GPTBot,ClaudeBot --json report.json
```

Requests go out one page at a time by default with a 400 ms gap, so a run does not look
like an attack. Raise `--concurrency` only when you own the site.

## Rendering once, measuring properly

`--render` uses Playwright to load the page in Chromium and compare the rendered text with
the raw HTML. It is not installed by default:

```bash
npm install --save-dev playwright
npx playwright install chromium
botglass https://example.com --render --samples
```

Without Playwright the tool still runs; `js-dependent` then comes from the shell heuristic
and says `confidence: "heuristic"`.

## CI

```yaml
- name: Crawler visibility gate
  run: npx github:rudibrdev/botglass https://example.com --fail-on ua-blocked,error,cloaked
```

Exit codes: `0` pass, `1` gate failed, `2` usage or runtime error. `--json` writes a
report you can archive; `--html` writes one a human can read without the tool.

## Limits (read these)

- **User-Agent is a claim, not a proof.** A site that blocks real GPTBot by IP range will
  still answer a request that merely says `User-Agent: GPTBot`. `botglass` tells you what
  the server does with that identity, which is what a crawler-visible content problem
  usually depends on.
- **robots.txt is parsed, not obeyed.** The tool fetches anyway, because seeing whether the
  server enforces its own rules is useful. A compliant crawler would stop at the block.
- **`cloaked` and shell-based `js-dependent` are heuristics.** They name the numbers behind
  them; if the numbers look wrong, the verdict is wrong. `--render` moves `js-dependent`
  from heuristic to measured.
- **One fetch is a snapshot.** CDNs, A/B tests and bot management change answers. The
  report prints the fetch time for that reason.
- **JavaScript-rendered text is not "visible to crawlers".** Googlebot renders JS; GPTBot,
  ClaudeBot and PerplexityBot do not. A green Googlebot row does not help the others.

## Development

```bash
npm install
npm test              # 65 tests: unit, fixture-server integration, real CLI subprocess
npm run build         # tsc -> dist/
```

The test suite starts a local fixture server with a server-rendered page, a client-only
shell, a page that cloaks per User-Agent, a bot-only 403, a robots-blocked path, a redirect
and a 404, then asserts every verdict and the CLI exit codes against it. No network access
is needed to run the tests.

Layout: `src/audit.ts` (verdict rules, pure), `src/robots.ts`, `src/html.ts`,
`src/diff.ts` (shingles and missing sentences), `src/report/` (text, HTML, gate),
`src/cli.ts` (arguments and exit codes).

## Sample report

[docs/index.html](docs/index.html) — two live pages, eight bots, rendering on.

## License

MIT. See [LICENSE](LICENSE).
