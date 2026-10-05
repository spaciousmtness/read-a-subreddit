---
name: read-a-subreddit
description: Read what a Reddit community said over a time window and turn it into a short summary of voices, with a link to every thread, saved where asked. Use when someone says "what are people saying on r/X", "read r/X this week", "what did r/X talk about this month", "check the subreddit for X", or types /read-a-subreddit. Read only; never posts, votes or comments.
analytics: Summarize a subreddit's posts and comments over a time window into linked themes, saved to a chosen folder.
---

# Read a subreddit

Turns "what is r/something talking about lately?" into a short summary of what people said, with a link to every thread it draws on, saved where the person wants it. A script does the fetching. You do the reading and the writing, which is the part that needs judgment.

## How to trigger

- "What are people saying on r/eink this month?"
- "Read r/daylightcomputer for the past two weeks and save it into my notes."
- "What did r/ClaudeAI argue about this week?"
- `/read-a-subreddit r/eink this month, save it into Paragonday`

## What it needs

- **Node 18 or newer.**
- **OpenCLI**, the Reddit reader: `npm install -g @jackwener/opencli`. Agent Reach installs it too.
- **A Chrome that OpenCLI can use.** Either:
  - the OpenCLI extension in Chrome ([Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)), with Chrome open; or
  - `OPENCLI_CDP_ENDPOINT` pointing at a normal (windowed) Chrome started with `--remote-debugging-port`. On a Freedom machine this is the agent Chrome, and the script starts it behind your windows by itself.

No Reddit account is needed for public subreddits.

## Steps

1. **Get three things from the request.** The subreddit, the time window, and where to save it. Use what was said. Fill any gaps with defaults and say which ones in one line: the past 30 days, and the folder the person keeps notes in (their notes or documents folder; if there is none, ask once).
2. **Run the script** from this skill's base directory:
   ```bash
   node scripts/subreddit.mjs r/<name> --days <N> --threads 12
   ```
   It lists the month's (or week's) top 60 posts plus the newest 100, keeps those inside the window, and reads the most-discussed threads with their comments. It prints where it wrote `digest.md` and `bundle.json` (a temporary folder). If it stops with an error, the message says what to fix in plain words. Pass that on as written and do not retry blindly.
3. **Read `digest.md` in full.** It lists every post in the window, then each thread read, with comments indented under what they reply to. Usernames are left out on purpose.
4. **Write the summary.** Four to six themes. Each theme is a short bold line, one or two sentences, a short quote or two, and a link to every thread it draws on. Lead with what the community cared about most, judged by upvotes and how much discussion there was. Say up front how many posts, threads and members, and that these are voices, not numbers. If the person asked how it relates to their own work, add a final section saying so, labeled as your reading. If the script printed a coverage note, include it.
5. **Save it** as `YYYY-MM-DD-r-<name>-<window>.md` (for example `2026-10-05-r-eink-past-30-days.md`) in the folder you settled in step 1. If that folder is in a git repository, commit it. Push only if the person asked for it to go there, or saving there always means pushing.
6. **Show the summary in the chat** too, shorter, with a named link to the saved file.

## Output

- One markdown file at the destination: title with subreddit and dates, a line on size, the themes with quotes and links, and the optional "what this could mean" section.
- A shorter version in the chat, linking to the file.

## Quality bar

- **Every claim has a link** to the thread it came from.
- **Quotes are short**, a sentence at most, and in the speaker's own words.
- **No usernames, and no profile of any one person.** Summarize what was said, not who said it.
- **Voices, not numbers.** No percentages built from a dozen comments.
- **Scoped to the community.** For a topic rather than a community, find the right subreddit first; searching all of Reddit returns viral posts that only share a word.
- A great run reads like someone who sat in the community for the month and came back with what mattered. A mediocre one is a list of post titles.

## Principles

- **Read only.** OpenCLI can upvote, comment and subscribe. This skill never does.
- **Don't run headless.** Reddit serves headless Chrome a block page.
- **The window is the person's.** "This month" means the past 30 days unless they say a calendar month.
- **Say what was missed.** Threads that would not load are listed in the digest; mention them when they matter.
