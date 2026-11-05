import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("saved index renders scoped correction without inventing new measurements", async () => {
  const out = await mkdtemp(join(tmpdir(), "botglass-index-"));
  const saved = "docs/ai-access-index/ai-access-index.json";
  const before = await readFile(saved, "utf8");
  try {
    execFileSync(process.execPath, ["scripts/ai-access-index.mjs", "--render", saved, "--out", out]);
    const html = await readFile(join(out, "index.html"), "utf8");
    assert.match(html, /not HTTP <code>Content-Usage<\/code> response headers/);
    assert.match(html, /not a measurement of overall adoption/);
    assert.match(html, /allowing retrieval while declining training is valid, not a contradiction/);
    assert.match(html, /raw robots.txt bodies were not retained/);
    assert.doesNotMatch(html, /<span>declare a Content-Usage preference<\/span>/);
    assert.doesNotMatch(html, /usually CDN or API hosts/);
    assert.equal(await readFile(saved, "utf8"), before, "rendering must not rewrite historical data");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
