import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords, decodeEntities, extractPage, htmlToText } from "../src/html.js";

test("script, style and noscript content never reaches the text", () => {
  const html = `<html><head><title>T</title><style>body{color:red}</style></head>
<body><p>Visible words.</p><script>var secret = "injected copy";</script>
<noscript>Enable JS</noscript><template><p>tpl</p></template></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /Visible words\./);
  assert.doesNotMatch(text, /color:red/);
  assert.doesNotMatch(text, /injected copy/);
  assert.doesNotMatch(text, /Enable JS/);
  assert.doesNotMatch(text, /tpl/);
});

test("block elements become line breaks so list items stay separate", () => {
  const text = htmlToText("<ul><li>one</li><li>two</li></ul>");
  assert.deepEqual(text.split("\n"), ["one", "two"]);
});

test("entities are decoded, including numeric ones", () => {
  assert.equal(decodeEntities("A &amp; B &#65; &#x42; &hellip;"), "A & B A B \u2026");
  assert.equal(decodeEntities("&unknown;"), "&unknown;");
});

test("title, description, canonical, lang and JSON-LD types are extracted", () => {
  const html = `<html lang="de"><head><title>  Ein Titel  </title>
<meta name="description" content="Eine Beschreibung.">
<link rel="canonical" href="https://example.com/canonical">
<script type="application/ld+json">{"@type":"Article"}</script>
<script type="application/ld+json">{"@graph":[{"@type":"BreadcrumbList"}]}</script>
</head><body><p>Text.</p></body></html>`;
  const page = extractPage(html);
  assert.equal(page.title, "Ein Titel");
  assert.equal(page.description, "Eine Beschreibung.");
  assert.equal(page.canonical, "https://example.com/canonical");
  assert.equal(page.lang, "de");
  assert.deepEqual(page.jsonLdTypes, ["Article", "BreadcrumbList"]);
});

test("word counts ignore extra whitespace", () => {
  assert.equal(countWords("  one   two\n\tthree  "), 3);
  assert.equal(countWords("   "), 0);
});
