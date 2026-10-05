#!/usr/bin/env node
// Pull one subreddit's posts inside a time window and read its most-discussed threads, through
// OpenCLI's Reddit reader (the one Agent Reach installs). Writes a JSON bundle and a markdown
// digest for the agent to summarize. Read only: it never votes, comments, saves or subscribes.
//
//   node subreddit.mjs <subreddit> [--days 30] [--threads 12] [--out <dir>]
//
// Browser: OpenCLI reads Reddit through a real Chrome. If OPENCLI_CDP_ENDPOINT is set it uses that
// Chrome; otherwise it uses the OpenCLI extension in your own Chrome. If `agent-chrome-quiet` is on
// PATH (Freedom machines), it is run first so the agent browser is up and stays behind your windows.

import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86400;

/** Reddit's own "top" filter that covers the window. */
export function topWindow(days) {
  if (days <= 1) return "day";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  if (days <= 366) return "year";
  return "all";
}

/** "r/eink", "/r/eink/", "eink" or a reddit.com URL -> "eink". Null if it is not a subreddit name. */
export function normalizeName(input) {
  const s = String(input || "").trim();
  const m = s.match(/(?:reddit\.com)?\/?r\/([A-Za-z0-9_]+)/) || s.match(/^([A-Za-z0-9_]+)$/);
  const name = m && m[1];
  return name && /^[A-Za-z0-9_]{2,21}$/.test(name) ? name : null;
}

/** OpenCLI prints JSON on success; anything before the first bracket is noise. Null if no JSON. */
export function parseJson(stdout) {
  const s = String(stdout || "");
  const i = s.search(/^\s*[[{]/m);
  if (i < 0) return null;
  try { return JSON.parse(s.slice(i)); } catch { return null; }
}

/** OpenCLI prints failures as YAML (`code:` / `message:`) whatever -f says. */
export function parseError(stdout) {
  const s = String(stdout || "");
  const code = s.match(/^\s*code:\s*(\S+)/m)?.[1] || null;
  const message = s.match(/^\s*message:\s*(.+)$/m)?.[1]?.trim() || null;
  return code || message ? { code, message } : null;
}

/** What a failure means for the person running this, in words they can act on. */
export function explain(status, err) {
  const code = err?.code || "";
  const msg = err?.message || "";
  if (status === 69 || code === "BROWSER_CONNECT")
    return "OpenCLI cannot reach Chrome. Open Chrome with the OpenCLI extension enabled " +
      "(chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk), " +
      "or set OPENCLI_CDP_ENDPOINT to a Chrome started with --remote-debugging-port.";
  if (/ECONNREFUSED/.test(msg))
    return `Nothing is listening at OPENCLI_CDP_ENDPOINT (${process.env.OPENCLI_CDP_ENDPOINT || "unset"}). Start that Chrome first.`;
  if (status === 77 || code === "AUTH_REQUIRED")
    return "Reddit wants a sign-in in that Chrome. Sign in to reddit.com there once, then run again.";
  if (status === 75) return "Reddit took too long to answer. Run again in a minute.";
  if (status === 66 || code === "EMPTY_RESULT") return "Reddit returned nothing for this.";
  if (/<body|not valid JSON/.test(msg))
    return "Reddit served a block page. This happens with headless Chrome; use a normal (windowed) Chrome.";
  return msg || `opencli exited ${status}`;
}

export function mergePosts(...lists) {
  const seen = new Map();
  for (const list of lists) for (const p of list || []) if (p?.id && !seen.has(p.id)) seen.set(p.id, p);
  return [...seen.values()];
}

/** Posts created inside the last `days` days, newest first. */
export function inWindow(posts, nowSec, days) {
  const from = nowSec - days * DAY;
  return posts
    .filter((p) => { const t = Number(p.created_utc); return t >= from && t <= nowSec; })
    .sort((a, b) => Number(b.created_utc) - Number(a.created_utc));
}

/** The threads worth reading: most-commented first, then most-upvoted. Posts with no comments
 *  are skipped, since their whole text is already in the listing. */
export function pickThreads(posts, n) {
  const talked = posts.filter((p) => Number(p.comments) > 0);
  const byComments = [...talked].sort((a, b) => Number(b.comments) - Number(a.comments));
  const byUpvotes = [...talked].sort((a, b) => Number(b.upvotes) - Number(a.upvotes));
  const picked = new Map();
  for (const p of byComments.slice(0, Math.ceil(n / 2))) picked.set(p.id, p);
  for (const p of byUpvotes) { if (picked.size >= n) break; picked.set(p.id, p); }
  return [...picked.values()].sort((a, b) => Number(b.upvotes) - Number(a.upvotes));
}

const day = (sec) => new Date(Number(sec) * 1000).toISOString().slice(0, 10);
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** Markdown the agent summarizes from. Usernames are left out on purpose: the point is what
 *  people said, and a digest of names is the start of a profile. */
export function renderDigest(b) {
  const out = [
    `# r/${b.subreddit}: ${b.window.from} to ${b.window.to}`,
    "",
    `${b.members ? `About ${Number(b.members).toLocaleString("en-US")} members. ` : ""}` +
      `${b.inWindow.length} posts in the window; ${Object.keys(b.threads).length} threads read with comments.` +
      (b.coverage.note ? ` ${b.coverage.note}` : ""),
    "",
    "## Every post in the window",
    "",
    ...b.inWindow.map((p) => `- ${day(p.created_utc)} · ${p.upvotes ?? "?"} up · ${p.comments ?? 0} comments · [${clip(p.title, 110)}](https://www.reddit.com/r/${b.subreddit}/comments/${p.id}/)`),
    "",
    "## Threads read",
  ];
  for (const p of b.inWindow.filter((x) => b.threads[x.id] || b.failed[x.id])) {
    out.push("", `### [${clip(p.title, 140)}](https://www.reddit.com/r/${b.subreddit}/comments/${p.id}/)`,
      `${day(p.created_utc)} · ${p.upvotes ?? "?"} upvotes · ${p.comments ?? 0} comments`, "");
    if (b.failed[p.id]) { out.push(`Could not read: ${b.failed[p.id]}`); continue; }
    for (const c of b.threads[p.id]) {
      if (!c.text || /^\s*\[\+\d+ more/.test(c.text)) continue;
      if (c.type === "POST") { out.push(`> ${clip(c.text, 900)}`, ""); continue; }
      const depth = Number(String(c.type).replace(/\D/g, "")) || 0;
      out.push(`${"  ".repeat(depth)}- (${c.score ?? "?"}) ${clip(c.text.replace(/^\s*>\s*/gm, ""), 450)}`);
    }
  }
  return out.join("\n") + "\n";
}

function defaultExec(args) {
  const r = spawnSync("opencli", args, { encoding: "utf8", maxBuffer: 64 << 20, env: process.env });
  if (r.error) return { status: 127, stdout: String(r.error.message) };
  return { status: r.status, stdout: (r.stdout || "") + (r.stderr || "") };
}

function defaultEnsureBrowser() {
  const quiet = spawnSync("sh", ["-c", "command -v agent-chrome-quiet"], { encoding: "utf8" });
  if (quiet.status !== 0) return;
  if (!process.env.OPENCLI_CDP_ENDPOINT) process.env.OPENCLI_CDP_ENDPOINT = "http://127.0.0.1:9422";
  spawnSync("agent-chrome-quiet", [], { stdio: "ignore" });
}

/** The whole run, with the outside world passed in so a test can fake it. */
export async function run({ sub, days = 30, threads = 12, out, nowSec = Math.floor(Date.now() / 1000),
  exec = defaultExec, ensureBrowser = defaultEnsureBrowser, write = true } = {}) {
  const name = normalizeName(sub);
  if (!name) throw new Error(`"${sub}" is not a subreddit name (try r/eink or eink).`);
  ensureBrowser();

  const call = (args) => {
    const r = exec([...args, "-f", "json"]);
    const data = r.status === 0 ? parseJson(r.stdout) : null;
    return { ok: Array.isArray(data), data, status: r.status, err: parseError(r.stdout) };
  };

  const top = call(["reddit", "subreddit", name, "--sort", "top", "--time", topWindow(days), "--limit", "60"]);
  if (!top.ok) throw new Error(`Could not list r/${name}: ${explain(top.status, top.err)}`);
  const fresh = call(["reddit", "subreddit", name, "--sort", "new", "--limit", "100"]);
  const info = call(["reddit", "subreddit-info", name]);
  const members = info.ok ? info.data.find((f) => f.field === "Subscribers")?.value ?? null : null;

  // Usernames are dropped here, at the edge, so neither the bundle nor the digest can carry them.
  const posts = inWindow(mergePosts(top.data, fresh.ok ? fresh.data : []), nowSec, days).map(({ author, ...p }) => p);
  const oldestNew = fresh.ok && fresh.data.length ? Math.min(...fresh.data.map((p) => Number(p.created_utc))) : null;
  const coverage = {
    newestListed: fresh.ok ? fresh.data.length : 0,
    note: oldestNew && oldestNew > nowSec - days * DAY && fresh.data.length >= 100
      ? `The newest 100 posts only reach back to ${day(oldestNew)}; quieter posts before that appear only if they made the month's top 60.`
      : "",
  };

  const bundle = { subreddit: name, members, days, window: { from: day(nowSec - days * DAY), to: day(nowSec) },
    coverage, inWindow: posts, threads: {}, failed: {} };
  for (const p of pickThreads(posts, threads)) {
    const r = call(["reddit", "read", p.id, "--sort", "top", "--limit", "15", "--depth", "2", "--replies", "3", "--max-length", "700"]);
    if (r.ok) bundle.threads[p.id] = r.data.map(({ type, score, text }) => ({ type, score, text }));
    else bundle.failed[p.id] = explain(r.status, r.err);
  }

  if (write) {
    const dir = out || join(tmpdir(), "read-a-subreddit", `${name}-${bundle.window.to}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle, null, 2));
    writeFileSync(join(dir, "digest.md"), renderDigest(bundle));
    bundle.dir = dir;
  }
  return bundle;
}

// Compare REAL paths: run through a symlink (how an installed skill is reached), argv[1] is the
// link while import.meta.url is the target, and a plain comparison makes the CLI a silent no-op.
const invokedDirectly = (() => {
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1] || "")).href; } catch { return false; }
})();
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const sub = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  if (!sub) { console.error("usage: subreddit.mjs <subreddit> [--days 30] [--threads 12] [--out <dir>]"); process.exit(2); }
  try {
    const b = await run({ sub, days: Number(opt("days", 30)), threads: Number(opt("threads", 12)), out: opt("out") });
    console.log(`r/${b.subreddit}, ${b.window.from} to ${b.window.to}: ${b.inWindow.length} posts, ${Object.keys(b.threads).length} threads read` +
      (Object.keys(b.failed).length ? `, ${Object.keys(b.failed).length} could not be read` : ""));
    if (b.coverage.note) console.log(b.coverage.note);
    console.log(`digest: ${join(b.dir, "digest.md")}`);
    console.log(`bundle: ${join(b.dir, "bundle.json")}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
