# Changelog

## 0.4.2 — 2026-11-05

- Separate crawl permission from usage preferences: allowing retrieval while declining
  training is valid, not a contradiction. Removed advice that implied otherwise.
- Correct robots.txt usage path resolution against the IETF attachment draft's examples;
  prefer matching Content-Usage paths rather than inheriting Allow/Disallow scope.
- Scope the index to robots.txt only; HTTP Content-Usage headers were not measured.
  Remove the overall-adoption headline and unsupported explanations for failed responses.
- Preserve the original November JSON measurements unchanged and label the re-rendered
  page as historical parser output, not a retrospective corrected measurement.

## 0.4.1 — 2026-11-04

- `Content-Usage` categories outside the draft vocabulary (`train-ai`, `ai-use`, `search`) are
  now reported instead of being silently ignored — launchpad.net writes `ai=n`, which looked
  exactly like no declaration at all.
- AI Access Index: `scripts/ai-access-index.mjs` measures any `rank,domain` list and writes a
  published page plus JSON. November 2026 edition at `/ai-access-index/`.
- `--render` re-renders a saved dataset without re-measuring it.

## 0.4.0 — 2026-11-04

- Reads `Content-Usage` in robots.txt, the shared AI usage preference Anthropic, OpenAI,
  Google and Microsoft backed in November 2026 (IETF `aipref` draft). The report shows what
  the page declares (`train-ai=n`, `training not allowed`) and which group declared it.
- Flags the two contradictions that matter: declaring training allowed while robots.txt
  blocks the crawlers, and declaring `train-ai=n` while still letting every crawler fetch
  the page. Unreadable values are reported, never guessed.
- `trainAi` in the compact report, so an agent sees the declared preference in one field.
- Content-Usage lines no longer get discarded with unknown robots.txt fields.
- 118 tests.

## 0.3.0 — 2026-11-04

- `botglass mcp`: a stdio MCP server, so agents call botglass as a tool instead of
  shelling out. Tools: `audit_url` and `audit_sitemap`, both returning the compact verdicts
  and fixes. Hand-rolled JSON-RPC, still zero dependencies; protocol frames are the only
  thing written to stdout.
- The MCP server is tested by a client that spawns the real binary and speaks JSON-RPC at it:
  initialize, tools/list, both tools, unknown tool, unknown method, missing arguments.
- 103 tests.

## 0.2.0 — 2026-11-04

- Every page ends in a `FIX` list: one instruction per cause, not per bot, so eight
  crawlers failing the same way produce one line ("GPTBot and ClaudeBot do not run
  JavaScript: server-render the page text").
- `--compact`: agent-sized output. One line per page plus its first fix, and a JSON
  projection (`--compact --json`) with the page text dropped — 23 KB became ~2 KB.
- `--baseline <file>` / `--update-baseline`: run once to diagnose, run again to prove the
  fix. The report gains a "Changes since …" section: verdict flips, word-count moves, HTTP
  changes, pages added or missing.
- `schemaVersion` in both the full and the compact JSON.
- The compact view shows rendered words from the same counter as the report (82 vs 80 is
  gone).
- 95 tests, including a real baseline round-trip and the CLI's compact output as a child
  process.

## 0.1.1 — 2026-11-03

- Several URLs on one command line are all audited instead of the extras being dropped.
- The `js-dependent` line and the page header quote the same word counts (the header used a
  second tokenizer, so it could say 82 rendered next to a note about 80).
- `--max-js-only` now measures the share of rendered words missing from the raw HTML, the
  same number the report prints, instead of a sentence-overlap score that said 56% while the
  report said 96%.
- A bot that gets an empty 200 while a browser gets text is now `cloaked` instead of `ok`.
- The Googlebot row says that Googlebot also renders JavaScript, so it is not mistaken for
  proof that Google cannot see the page.
- The crawler column widens for `meta-externalagent`; it no longer runs into the status column.
- 70 tests.

## 0.1.0 — 2026-11-03

First release.

- `botglass <url>`: fetch one URL as eight crawler identities plus a browser baseline.
- Verdicts per bot: `ok`, `js-dependent`, `cloaked`, `robots-blocked`, `ua-blocked`, `error`.
- robots.txt parsing with RFC 9309 matching (longest path, `Allow` wins ties, `*` groups).
- Cloaking detection by 5-word-shingle Jaccard similarity against a plain-browser fetch.
- Optional `--render` (Playwright) to measure JavaScript-only content, with missing-sentence
  samples; a labelled shell heuristic when Playwright is absent.
- Batch mode: `--sitemap`, `--urls`, `--max-pages`.
- Reports: terminal table, `--json`, standalone `--html`.
- CI gates: `--fail-on`, `--max-js-only`, exit codes 0/1/2.
- 65 tests including a local fixture server and the real CLI as a child process.
