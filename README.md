# Read a subreddit

A skill for [Claude Code](https://claude.com/claude-code) that reads what a Reddit community said over a stretch of time and writes you a short summary of what people said, with a link to every thread. Ask *"what are people saying on r/eink this week?"* and get back the themes, short quotes and links, saved where you keep notes.

It only reads. It never posts, votes or comments, and it leaves usernames out of everything it saves.

## Install

The quick way: paste this into Claude Code and let it do the rest.

```text
Install the skill at https://github.com/spaciousmtness/read-a-subreddit into my Claude skills folder and set up what it needs.
```

It can do every step below except adding the Chrome extension, which you do yourself.

### By hand (Mac)

1. **Node.** In Terminal, run `node --version`. If it says "command not found", install Node from [nodejs.org](https://nodejs.org).
2. **The skill.** Copy it into your Claude skills folder:

```bash
git clone https://github.com/spaciousmtness/read-a-subreddit ~/.claude/skills/read-a-subreddit
```

3. **The Reddit reader (OpenCLI).**

```bash
npm install -g @jackwener/opencli
```

4. **Its Chrome extension.** In Google Chrome, add [OpenCLI](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) and leave Chrome open while the skill runs. This lets OpenCLI read pages through your Chrome, so only add it if you're comfortable with that. Public subreddits don't need you to be signed in to Reddit.
5. **Try it.** Start a new Claude Code session and ask *"What are people saying on r/eink this week?"*, or type `/read-a-subreddit r/eink this week`.

Already use [Agent Reach](https://github.com/Panniantong/Agent-Reach)? It installs OpenCLI for you. If you run Chrome with a debugging port instead of the extension, set `OPENCLI_CDP_ENDPOINT` and the script uses that.

## Getting better answers

Say three things:

1. **The place.** `r/daylightcomputer` beats "Reddit".
2. **The window.** "This week", "this month", "since the launch". Without one it reads the past 30 days.
3. **Where to save it.** "Save it into my research notes."

## If it complains

- **"OpenCLI cannot reach Chrome":** Chrome is closed, or the extension is off.
- **"Reddit served a block page":** Reddit wants a human check in that Chrome. Open reddit.com there, pass the check or sign in, and run again. A hidden (headless) Chrome gets this every time, so use a normal one.
- **Check the script itself:** run `node --test scripts/subreddit.test.mjs` in this folder. Ten tests should pass.

## What's here

| File | What it is |
|---|---|
| `SKILL.md` | The instructions Claude follows |
| `HDSOP.md` | A map of the workflow: when it runs, where it branches, what stays human |
| `scripts/subreddit.mjs` | Fetches the posts and threads (`node scripts/subreddit.mjs r/eink --days 7`) |
| `scripts/subreddit.test.mjs` | Tests, run against real OpenCLI output with usernames removed |

MIT licensed.
