# botglass — spec (v0.1)

## Problem
AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, ...) fetch HTML and never run
JavaScript. Client-rendered sites can look empty to them. Existing checks are one-URL web
forms; nothing runs locally, over a sitemap, in CI, or compares bots against each other.

## Users
- SEO / content engineers checking AI visibility of a site.
- Devs who want a CI gate ("fail if GPTBot sees less than 60% of the page").
- Anyone curious what the same URL returns to eight different crawlers.

## V1 scope
- `botglass <url>` fetches the URL as 8 AI/search crawlers plus one browser baseline.
- `--sitemap <url>` / `--urls <file>` + `--max-pages N` batch mode.
- Optional `--render` (Playwright) to measure rendered text and real JS-only content.
- Verdicts: `ok | js-dependent | robots-blocked | ua-blocked | cloaked | error`.
- Outputs: terminal table, `--json`, `--html <path>` static report.
- Gates: `--fail-on <verdict,...>`, `--max-js-only <0..1>`.

## Non-goals (v1)
- No dashboard, no accounts, no API keys, no network service.
- Google-Extended/Applebot-Extended style opt-out tokens (they are not fetchers) are not
  fetched; they are covered by the robots.txt report for their parent crawler.
- No JS execution without Playwright installed; fallback is a documented heuristic.

## Stack
TypeScript, Node >= 20, ESM, zero runtime dependencies (global fetch, node:http for the test
fixture, node:test). Playwright is an optional dev/peer capability, loaded dynamically and
never required at install time.

## Verdict rules (priority order, first match wins)
1. `error` — network failure, timeout, 5xx, or a 4xx that the browser baseline also gets
   (site is broken/blocked for everyone, not a bot decision).
2. `robots-blocked` — robots.txt disallows the bot's UA on that path (RFC 9309 matching).
3. `ua-blocked` — bot gets 401/403/429/451 while the browser baseline gets 2xx.
4. `cloaked` — bot and browser both get 2xx, both have >= 30 words, 5-word-shingle Jaccard
   similarity < 0.5, and the bot sees less text than the browser (bot gets *more* is
   prerendering, reported as `ok` with a note).
5. `js-dependent` — raw text is thin compared with what a browser gets after JS:
   with `--render`, bot words < 50% of rendered words (rendered >= 50 words);
   without `--render`, a heuristic (near-empty body + SPA root / large script payload),
   flagged `confidence: "heuristic"`.
6. `ok` — everything else.

## Test plan
- Unit: robots matcher (wildcards, `$`, longest match, Allow tie, group specificity, 4xx/5xx
  fetch outcomes), HTML→text extraction, shingle similarity, verdict matrix, sitemap parsing,
  CLI argument parsing, HTML report escaping.
- Integration: local fixture server (SSR, SPA, per-UA cloak, robots block, 403-by-UA,
  redirect, 500) driven through the real CLI as a child process: JSON shape, verdicts,
  exit codes for `--fail-on` / `--max-js-only`, `--html` output.
- Install: clean clone, `npm ci && npm test`, and `npx github:rudibrdev/botglass --help`.

## Launch
Public MIT repo `rudibrdev/botglass`, v0.1.1 GitHub release, sample HTML report on GitHub
Pages. Nothing needed from Ves.
