import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { loadSitemap, parseSitemap, parseUrlList } from "../src/sitemap.js";
import { startFixture, type Fixture } from "./fixture.js";

let fixture: Fixture;

before(async () => {
  fixture = await startFixture();
});

after(async () => {
  await fixture.close();
});

test("a urlset is read as a list of pages", () => {
  const parsed = parseSitemap(
    `<?xml version="1.0"?><urlset><url><loc>https://a.example/one</loc></url>
     <url><loc><![CDATA[https://a.example/two]]></loc></url></urlset>`,
  );
  assert.equal(parsed.kind, "urlset");
  assert.deepEqual(parsed.locs, ["https://a.example/one", "https://a.example/two"]);
});

test("a sitemapindex is read as a list of sitemaps", () => {
  const parsed = parseSitemap(
    `<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>`,
  );
  assert.equal(parsed.kind, "index");
  assert.deepEqual(parsed.locs, ["https://a.example/s1.xml"]);
});

test("HTML served instead of a sitemap is reported, not guessed at", () => {
  const parsed = parseSitemap("<html><body>not a sitemap</body></html>");
  assert.equal(parsed.kind, "unknown");
  assert.deepEqual(parsed.locs, []);
});

test("entity-escaped URLs are decoded", () => {
  const parsed = parseSitemap(`<urlset><url><loc>https://a.example/?a=1&amp;b=2</loc></url></urlset>`);
  assert.deepEqual(parsed.locs, ["https://a.example/?a=1&b=2"]);
});

test("a sitemap index is followed one level to its urlsets", async () => {
  const loaded = await loadSitemap(`${fixture.base}/sitemap-index.xml`, {
    userAgent: "botglass-test",
    timeoutMs: 5000,
    maxUrls: 10,
  });
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.urls, [`${fixture.base}/ssr`, `${fixture.base}/thin`]);
  assert.equal(loaded.sitemaps.length, 1);
});

test("maxUrls caps the result", async () => {
  const loaded = await loadSitemap(`${fixture.base}/sitemap.xml`, {
    userAgent: "botglass-test",
    timeoutMs: 5000,
    maxUrls: 1,
  });
  assert.equal(loaded.urls.length, 1);
});

test("a missing sitemap is an error string, not an exception", async () => {
  const loaded = await loadSitemap(`${fixture.base}/missing-sitemap.xml`, {
    userAgent: "botglass-test",
    timeoutMs: 5000,
    maxUrls: 5,
  });
  assert.deepEqual(loaded.urls, []);
  assert.equal(loaded.errors.length, 1);
  assert.match(loaded.errors[0] ?? "", /404/);
});

test("a URL list ignores blanks, comments, and adds https when missing", () => {
  const urls = parseUrlList(`
    # a comment
    example.com/one

    https://example.com/two
  `);
  assert.deepEqual(urls, ["https://example.com/one", "https://example.com/two"]);
});
