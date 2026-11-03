# Changelog

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
