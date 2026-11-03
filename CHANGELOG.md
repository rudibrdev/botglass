# Changelog

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
