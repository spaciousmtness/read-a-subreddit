// node --test scripts/subreddit.test.mjs
// Fixtures are real OpenCLI output captured 2026-10-05 (usernames and post bodies stripped from
// the listing), including the YAML it prints on failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { topWindow, normalizeName, parseJson, parseError, explain, inWindow, pickThreads, renderDigest, run } from "./subreddit.mjs";

const fx = (f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", f), "utf8");
const listing = JSON.parse(fx("listing.json"));
const NOW = 1791211794 + 3600; // an hour after the newest post in the fixture (2026-10-05)

test("the top filter always covers the window", () => {
  assert.equal(topWindow(1), "day");
  assert.equal(topWindow(7), "week");
  assert.equal(topWindow(30), "month");
  assert.equal(topWindow(31), "month");
  assert.equal(topWindow(45), "year"); // "month" would silently drop the oldest two weeks
});

test("subreddit names: the forms people type, and nothing that is not a name", () => {
  for (const s of ["eink", "r/eink", "/r/eink/", "https://www.reddit.com/r/eink/top/"]) assert.equal(normalizeName(s), "eink");
  for (const s of ["", "e", "eink; rm -rf ~", "r/", "the eink sub"]) assert.equal(normalizeName(s), null);
});

test("JSON is found after noise, and a YAML failure is not mistaken for data", () => {
  assert.equal(parseJson("Warning: something\n" + fx("read.json"))[0].type, "POST");
  assert.equal(parseJson(fx("no-extension.txt")), null);
  assert.equal(parseJson(fx("read-missing.txt")), null);
});

test("failures are read from OpenCLI's YAML and explained in plain words", () => {
  assert.equal(parseError(fx("no-extension.txt")).code, "BROWSER_CONNECT");
  assert.match(explain(69, parseError(fx("no-extension.txt"))), /OpenCLI extension/);
  assert.match(explain(1, parseError(fx("no-browser.txt"))), /Nothing is listening/);
  assert.match(explain(66, parseError(fx("read-missing.txt"))), /returned nothing/);
  assert.match(explain(1, { message: '"<body class=..." is not valid JSON' }), /human check/);
  assert.match(explain(1, { message: '"<body class=..." is not valid JSON' }), /headless/);
});

test("the window keeps the last 30 days and drops everything older", () => {
  const kept = inWindow(listing, NOW, 30);
  const from = NOW - 30 * 86400;
  assert.equal(kept.length, 11); // matches the hand count of 2026-10-05
  assert.ok(kept.every((p) => p.created_utc >= from));
  assert.ok(kept.some((p) => p.id === "1wa4u7c")); // Diablo, 2026-09-07, inside
  assert.ok(listing.some((p) => p.created_utc < from)); // the fixture really has older posts to drop
  assert.equal(inWindow(listing, NOW, 1).length, 1);
  assert.deepEqual(inWindow([{ id: "future", created_utc: NOW + 600 }], NOW, 30), []);
});

test("threads to read: discussed ones only, most-commented first, capped", () => {
  const kept = inWindow(listing, NOW, 30);
  const picked = pickThreads(kept, 4);
  assert.equal(picked.length, 4);
  assert.ok(picked.every((p) => p.comments > 0));
  assert.ok(picked.some((p) => p.id === "1wsnco9")); // the launcher thread, 31 comments, most discussed
  assert.equal(pickThreads([{ id: "a", comments: 0, upvotes: 999 }], 5).length, 0);
});

test("the digest carries what was said and leaves out who said it", () => {
  const thread = JSON.parse(fx("read.json"));
  const b = { subreddit: "daylightcomputer", members: "2544", window: { from: "2026-09-05", to: "2026-10-05" },
    coverage: { note: "" }, inWindow: [{ id: "1wuzn9e", title: "Wifi disconnection", upvotes: 3, comments: 1, created_utc: 1791100000 }],
    threads: { "1wuzn9e": thread }, failed: {} };
  const md = renderDigest(b);
  assert.match(md, /every time the device sits idle/);
  assert.match(md, /About 2,544 members/);
  for (const c of thread) if (c.author) assert.doesNotMatch(md, new RegExp(c.author));
});

const fakeExec = (map) => (args) => {
  const key = args.slice(0, 4).join(" ");
  for (const [k, v] of Object.entries(map)) if (key.startsWith(k)) return v;
  return { status: 66, stdout: fx("read-missing.txt") };
};

test("no browser: the run stops with the fix, instead of writing an empty digest", async () => {
  const exec = () => ({ status: 69, stdout: fx("no-extension.txt") });
  await assert.rejects(run({ sub: "eink", nowSec: NOW, exec, ensureBrowser: () => {}, write: false }), /OpenCLI extension/);
});

test("a thread that will not load is reported, and the rest of the run still lands", async () => {
  const exec = fakeExec({
    "reddit subreddit daylightcomputer --sort": { status: 0, stdout: JSON.stringify(listing.map((p) => ({ ...p, author: "someone_" + p.id }))) },
    "reddit subreddit-info daylightcomputer": { status: 0, stdout: fx("info.json") },
    "reddit read 1wsnco9": { status: 0, stdout: fx("read.json") },
  });
  const b = await run({ sub: "r/daylightcomputer", nowSec: NOW, threads: 3, exec, ensureBrowser: () => {}, write: false });
  assert.equal(b.members, "2544");
  assert.equal(b.inWindow.length, 11);
  assert.ok(b.threads["1wsnco9"]);
  assert.ok(b.threads["1wsnco9"].every((c) => !("author" in c)), "usernames must not reach the saved bundle");
  assert.doesNotMatch(JSON.stringify(b), /someone_|"author"/, "usernames must not reach the saved bundle");
  assert.equal(Object.keys(b.failed).length, 2);
  assert.match(renderDigest(b), /Could not read: Reddit returned nothing/);
});

test("the CLI runs when reached through a symlink, as an installed skill is", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const link = join(mkdtempSync(join(tmpdir(), "ras-")), "subreddit.mjs");
  symlinkSync(join(here, "subreddit.mjs"), link);
  const r = spawnSync(process.execPath, [link], { encoding: "utf8" });
  assert.equal(r.status, 2, "no arguments must print usage and exit 2, not exit 0 having done nothing");
  assert.match(r.stderr, /usage: subreddit\.mjs/);
});
