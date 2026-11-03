/**
 * Driving the real binary the way a user does: a separate process, real argv,
 * real exit codes, real files on disk.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startFixture, type Fixture } from "./fixture.js";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

let fixture: Fixture;
let workdir: string;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function botglass(...args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], {
      cwd: workdir,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const error = err as { code?: number; stdout?: string; stderr?: string };
    return { code: error.code ?? -1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

before(async () => {
  fixture = await startFixture();
  workdir = await mkdtemp(join(tmpdir(), "botglass-cli-"));
});

after(async () => {
  await fixture.close();
});

test("a single URL prints a report and exits 0", async () => {
  const result = await botglass(`${fixture.base}/ssr`, "--bots", "GPTBot", "--delay", "0", "--no-color");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /botglass 0\.1\.0/);
  assert.match(result.stdout, /GPTBot/);
  assert.match(result.stdout, /\bok\b/);
  assert.match(result.stdout, /Totals: 1 ok/);
});

test("--json and --html write the files they promise", async () => {
  const json = join(workdir, "report.json");
  const html = join(workdir, "report.html");
  const result = await botglass(
    `${fixture.base}/ssr`,
    "--bots",
    "GPTBot,ClaudeBot",
    "--delay",
    "0",
    "--json",
    json,
    "--html",
    html,
    "--no-color",
  );
  assert.equal(result.code, 0, result.stderr);

  const parsed = JSON.parse(await readFile(json, "utf8")) as {
    tool: string;
    pages: Array<{ verdicts: Array<{ verdict: string }> }>;
  };
  assert.equal(parsed.tool, "botglass");
  assert.equal(parsed.pages.length, 1);
  assert.deepEqual(
    parsed.pages[0]?.verdicts.map((v) => v.verdict),
    ["ok", "ok"],
  );

  const page = await readFile(html, "utf8");
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /class="page"/);
});

test("--fail-on turns a verdict into exit code 1", async () => {
  const result = await botglass(
    `${fixture.base}/secret`,
    "--bots",
    "GPTBot",
    "--delay",
    "0",
    "--fail-on",
    "robots-blocked",
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /gate failed/);
  assert.match(result.stderr, /GPTBot: robots-blocked/);
});

test("clean pages do not fail a gate that only names other verdicts", async () => {
  const result = await botglass(
    `${fixture.base}/ssr`,
    "--bots",
    "GPTBot",
    "--delay",
    "0",
    "--fail-on",
    "ua-blocked,error",
    "--quiet",
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("--urls audits a file of pages", async () => {
  const list = join(workdir, "urls.txt");
  await writeFile(list, `# two pages\n${fixture.base}/ssr\n${fixture.base}/thin\n`, "utf8");
  const result = await botglass("--urls", list, "--bots", "GPTBot", "--delay", "0", "--no-color");
  assert.equal(result.code, 0, result.stderr);
  const rows = result.stdout.split("\n").filter((line) => line.includes("http://127.0.0.1"));
  assert.equal(rows.length, 2);
});

test("--sitemap discovers pages and respects --max-pages", async () => {
  const result = await botglass(
    "--sitemap",
    `${fixture.base}/sitemap.xml`,
    "--max-pages",
    "1",
    "--bots",
    "GPTBot",
    "--delay",
    "0",
    "--no-color",
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /1 page\(s\)/);
  assert.match(result.stdout, /\/ssr/);
});

test("--list-bots names the identities it can imitate", async () => {
  const result = await botglass("--list-bots");
  assert.equal(result.code, 0);
  for (const name of ["GPTBot", "ClaudeBot", "PerplexityBot", "Googlebot", "baseline"]) {
    assert.match(result.stdout, new RegExp(name));
  }
});

test("a usage mistake exits 2 with a message", async () => {
  const noUrl = await botglass("--bots", "GPTBot");
  assert.equal(noUrl.code, 2);
  assert.match(noUrl.stderr, /a URL, --sitemap or --urls is required/);

  const unknownBot = await botglass(`${fixture.base}/ssr`, "--bots", "NotABot");
  assert.equal(unknownBot.code, 2);
  assert.match(unknownBot.stderr, /Unknown bot/);

  const badVerdict = await botglass(`${fixture.base}/ssr`, "--fail-on", "everything");
  assert.equal(badVerdict.code, 2);
  assert.match(badVerdict.stderr, /unknown verdict/);
});
