---
description: One read-only session a day at 08:00 — where we stand, what needs the owner, what to consider now and later, and one idea from outside the box
---

# Morning brief — one firing, one read, no writes to the build

**A Routine fires a FRESH session at 08:00 Europe/Amsterdam, and that session reads the board,
the repository, the deploys and the two databases, then writes the owner a brief they can read in
two to five minutes.** It builds nothing, claims nothing, and moves nothing. It ends.

Standing request, product owner 2026-09-07: *"in the morning at 8 oclock, i would like to receive a
concise, 2-5 minute read about where are we standing, things needing human, things we should
consider doing now and in the future. And some thinking outside of the box about improvements or
other aspects we should consider?"* Those four are the brief's four sections, in that order, and
the fourth is the one that is easy to drop and the reason this exists rather than a status query.

Read `CLAUDE.md` fully first — it is auto-loaded and it is the contract. Workspace `lets-ride`,
team **Pedro & Dave** (`PD`), project **Let's ride (AI)**
(`88f3f224-ecf0-46f0-a032-c86b7a12f81c`); note the curly apostrophe in that name and pass the id.

**No section here is numbered `STEP n`** — `queue-run.md` and `queue-pickup.md` own that
namespace and `src/__tests__/agent-briefs.test.ts` resolves every citation against their headings
alone. Cite the sections here by name.

---

## This session changes nothing, and that is what makes it safe to fire beside the queue

**It runs at the same hour as a queue firing and may run beside a live build.** The collisions in
this repo are resources rather than files — one test database, the relay's `:3001`, the walk's
`:3000`, one working tree (`CLAUDE.md` §Delegating while the owner is at the keyboard, and
`docs/reference/constraints.md` §Two builds at once). A session that only reads touches none of
them, so the safety property is *read-only*, not *scheduled apart*.

Forbidden here, whatever the brief concludes:

- **No branch, no commit, no push, no PR, no merge.** A finding worth code is a proposal in the
  brief, not a diff.
- **No issue moved into `Queued (AI)`.** That column is the owner's start signal and hand-fed on
  purpose — a brief that queues its own suggestions has taken the decision the board exists to
  give them. Proposing is the whole job.
- **No slot label**, no `Development (AI)`, no status change on any issue at all.
- **No Routine created, fired, edited or deleted**, including this one — `CLAUDE.md` §What Not To
  Do. Reading Routines and sessions by id is pre-authorized and is all this needs.

**Exactly two writes are allowed**, both at the end and both outside the repository: the brief log
document, and the brief's own page republished to its one URL (§Delivery). Nothing else — and if
the read pass fails so completely that there is no brief, neither write happens either.

---

## The read pass

**Every line of the brief traces to one of these calls.** A claim with no call behind it does not
go in the brief: a claim about state needs the command that checks it. Where a call is unavailable, say so in the brief in one clause and carry on: **a
missing connector is a line in the brief, never a reason to send nothing.**

**Find each tool by what it does, not by the name written here.** MCP connector ids are not
stable — on 2026-08-08 every server re-registered under a UUID prefix and `mcp__Linear__*` stopped
resolving with no error, which for an unattended firing is the difference between a brief and
silence. If an exact name does not resolve, search for it by keyword (`ToolSearch`, e.g. `+linear
issues`, `+github pull request`) and call whatever is providing that capability this morning. Both
sibling procedures open the same way. If a capability is genuinely absent, that is a line in the
brief, not the end of it.

Read in this order. It is roughly cheapest-first, and the board answers most of the brief.

### The board — one pass, and it is most of the answer

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c limit=100
                          fields=["id","title","status","labels","updatedAt","url"]
```

**`id` is the field that returns `PD-434`. There is no `identifier` field** — passing one is not a
missing column, it is `Invalid arguments for tool list_issues` and the brief's largest read fails
outright, at 08:00, with nobody there to correct it. Measured 2026-09-07.

**That call answers the moving half of the board and cannot answer the still half.** The default
order is `updatedAt` descending, so `limit=100` is a *recency window* — about thirty hours on a
busy day — and the rows that matter most to the owner are the ones that have not moved in weeks.
Measured on 2026-09-07: 54 issues carry `Owner only` and 20 of them fell inside the top 100, and
four `Needs decision` issues had sat untouched since August. **A short window is not an error; it
is a silently shorter brief**, which is the worst shape for something nobody is watching.

So the two owner-facing rows get their own filtered calls, where the window cannot reach them:

```
mcp__Linear__list_issues  project=<id> label="Owner only" limit=250
mcp__Linear__list_issues  project=<id> state="Needs decision" limit=250
mcp__Linear__list_issues  project=<id> state="Needs help"     limit=250
```

**Check `hasNextPage` on every one of them.** It is the only signal that a list was cut short, and
a truncated `Owner only` list reads exactly like a shorter to-do list.

The statuses above are exact strings and **must not be typed from memory** —
`mcp__Linear__list_issue_statuses team=Pedro & Dave` is the list, and a status name that no longer
exists filters to nothing rather than erroring. What to pull out:

| For the brief | Where |
|---|---|
| What is being built right now | `Development (AI)`, with its `slot-1` / `slot-2` labels |
| What is waiting to be built | `Queued (AI)` — and whether a free slot exists |
| What landed since yesterday | `Deployed to DEV` and `Done (in production)` with `updatedAt` inside 24h |
| Parked, waiting on the owner | `Needs help`, `Needs decision` |
| The owner's own list | any status, label `Owner only` |
| The queue is stopped | a `Needs help` park comment carrying `<!-- halt-queue -->` — **and only that**; an ordinary park stops its own story |

**A `Queued (AI)` column with a free slot and nothing new in `Development (AI)` since yesterday's
brief is the queue-not-draining signal**, and it belongs under *Needs you* rather than *Where we
stand*. No Routine field answers it — `docs/reference/linear.md` §The queue is drained by one
Routine, on one clock is explicit that a hundred `SUCCEEDED` firings spawned nothing. The board is
what answers it.

### Shipping — what is in flight and what is stuck

```
mcp__github__list_pull_requests   owner=Lenhador88 repo=LetsRide state=open base=development
mcp__github__pull_request_read    ... method=status        # per open PR, for its checks
mcp__github__list_commits         owner=Lenhador88 repo=LetsRide sha=development   # since yesterday
```

An open PR older than a day, or one whose checks are red, is a *Needs you* line only when nobody
is building it; otherwise it is the session that owns it and belongs under *Where we stand*.
**Read the jobs, not the run** — a run whose real jobs all `skipped` tested nothing
(`docs/reference/ci.md`).

**`development` ahead of `main` is the steady state, not drift** — `main` moves only by
promotion, and the two are level only in the minutes after one.
It earns a line only when the gap has grown for several days, or when it carries something the
brief is otherwise recommending.

### Deploys

```
mcp__Vercel__list_deployments     # newest per target: is DEV green, is production green
```

A failed production deployment is the highest-priority line in the whole brief and goes first
under *Needs you*, above everything else.

### The two databases

```
mcp__Supabase__list_migrations  <DEV ref fpmrimzxadewsaiwpsel>
mcp__Supabase__list_migrations  <PROD ref zwprydcyryvudhurbnye>
mcp__Supabase__get_advisors     <each ref> type=security
mcp__Supabase__get_project      <each ref>
```

Four things come out of these and only the last two are usually worth a line:

- **The promotion gap** — files applied to DEV and not PROD. Report the *count and the direction*,
  never a bare number typed from a doc.
- **Drift the other way** — a migration applied to a project with *no file behind it*. That one is
  always a line: it cannot be fixed by applying anything and the next author silently takes the
  same number.
- **A paused project.** The free tier auto-pauses after about seven days idle and a paused project
  serves nothing with no alert. If `get_project` reports anything but active, it leads *Needs you*
  — second only to a failed production deploy, per the order in §2 — Needs you.
- **A security advisor that is not in the accounting** — `docs/reference/migrations.md`
  §Security advisors carries the per-migration table. An unexpected advisor is one not in it; a
  one-advisor difference between the two projects is almost always a pending promotion and is not
  news.

### Yesterday's brief

```
mcp__Linear__list_documents  query="Morning brief log" fields=["id","title","content","url"]
```

Read the header line and the top entry. The header carries `page: <url>`, the address today's
brief republishes to; the entries are what stop today repeating yesterday, and where the
outside-the-box rotation is recorded. §The log is what stops the brief repeating itself has the
rules.

---

## The shape of the brief

**Four sections, in the owner's order, preceded by the page's URL on a line of its own and
followed by nothing.** No preamble, no "here is your morning brief", no closing summary. The URL is
the one line above section 1 because the page is what the owner is meant to bookmark, and a page
whose address appears only in a Linear document is a page nobody opens. **Where there is no page**
— the tool was absent, or publishing failed — that line says so instead, in a clause, which is
where §Delivery's *no page is a line in the brief* lands. Around seventy rendered lines total, of which the rating blocks are
about half — this is a phone read before coffee, and the discipline is the one `CLAUDE.md`
already states: if a paragraph has no action in it, delete it.

### 1 — Where we stand

**Five lines, hard cap.** Each is one sentence and each traces to a call above. Building, waiting,
landed since yesterday, deploys, databases. If a line would say "unchanged", cut it — an unchanged
thing is not news, and a five-line section that is really two lines is the honest one.

### 2 — Needs you

**Every line is something no session can do**, with the click or the decision named. Ordered:
production down, then a paused project, then a decision blocking a build, then the rest.

Each is at most two lines: *what is stuck* and *what you do about it*, with the issue's short
title in front of any id — **never a bare `PD-nnn`**, which means something to whoever wrote it
and nothing to whoever reads it on a phone.

**"Nothing needed" is a valid and preferred answer, and must be written as one line rather than
padded out.** A brief that manufactures an owner action to look useful spends the credibility the
real ones need, which is the rule `CLAUDE.md` already gives for manufactured objections.

**Re-measure before quoting an `Owner only` item.** Two in a row have been found already-fixed,
and that is the shape rather than a coincidence: a dashboard setting has no file to change, so
nothing marks it done except someone re-measuring. `docs/ENVIRONMENTS.md` §The redirect allowlist
carries the credential-free probes.

### 3 — Consider doing

**Now, then later, as lettered options — at most three across both**, ordered by
`Recommendation` descending, each with its title on its own line, a short practical explanation in
its own paragraph, and the five-rating block in its own blockquote. The format is `CLAUDE.md`
§The debrief shape — Points, Proposals, Question, and the worked example there is the one to
copy, line breaks included.

Three is a ceiling that exists because the ratings are what make an option decidable and they cost
about ten lines each. Fewer is better. **An option that was proposed in a previous brief and not
acted on is not re-proposed** — see the log rules below.

### 4 — From outside the box

**One idea, every day, and it is not optional.** This is the section the owner asked for by name,
and it is the first thing that decays into a restatement of the board. Two rules keep it honest:

- **It comes from a lens, and the lens rotates by weekday**, so the brief cannot converge on one
  favourite theme: **Mon** the rider who has not installed anything yet · **Tue** what breaks at a
  thousand riders · **Wed** cost and the things nobody is paying attention to · **Thu** how we
  work — the queue, the gates, the squad · **Fri** positioning and what we may honestly claim ·
  **Sat/Sun** free, but not a repeat of the week's.
- **It may be something to delete, stop or simplify**, not only something to build. A brief that
  only ever adds is one half of a thought.

It carries a rating block only if it is a real proposal and it fits inside the three-option
ceiling; otherwise it is two or three sentences and an explicit *not proposing this yet*.

---

## The log is what stops the brief repeating itself

**No session can read another session's transcript**, so a brief that lives only in its own
session is invisible to tomorrow's. One Linear document is the memory.

- **Title `Morning brief log`.** Create it on the first firing if `list_documents` does not find
  it.
- **`save_document` writes the whole document, so compose it in one piece, in this order**: the
  header line `page: <url>`, then today's entry, then the previous thirteen. Nothing about this is
  a prepend, and reading it as one is the defect: new-content-then-old-content puts today's entry
  above the header, and rebuilding from "the last fourteen entries" drops the header altogether
  because the header is not an entry. Either way tomorrow's firing finds no `page:` line and forks
  a second page, leaving the owner's bookmark on a brief that has silently stopped updating. **Emit
  the header on every write, from the URL read at the start of the firing.**
- **The entry is the brief itself**, plus a first line of `YYYY-MM-DD · lens: <weekday lens>`.
- **Fourteen entries is the cap** — a working memory, not an archive. The header is not one of
  them and is never counted or trimmed.
- **Read the previous entries before writing sections 3 and 4.** An option proposed and not acted
  on gets **one** repeat, on the third day, in a single clause under *Where we stand* — "still
  open from Monday: the leaked-password toggle" — and then it is dropped. Nagging daily is how a
  brief gets skimmed past.
- **Say what changed against yesterday's entry** where it is genuinely news, and say nothing where
  it is not.

If the document cannot be written, **still deliver the brief** and say in one clause that the log
write failed. The brief is the deliverable; the log is how tomorrow's is better.

---

## Delivery

**The brief is this session's final message, always.** That needs no tool and cannot fail, and
everything below is layered on top of it rather than in place of it. A firing that publishes
nothing but writes a good final message has done its job.

### The page, at one address

**Publish the brief as an artifact, and republish it to the SAME URL every morning.** The point is
a single link the owner bookmarks once — the alternative is hunting for today's session in a list,
which is the actual problem this solves. Owner, 2026-09-07: *"So I could check that session every
morning to open that html?"* The answer is one page, not one session:

**Write the log entry BEFORE publishing**, because republishing destroys yesterday's page and the
log is the only durable copy of its text. Losing both to one failed write is free to avoid and the
ordering costs nothing.

- **The URL lives in the log document's header**, on a line reading `page: <url>`. Read it in
  §Yesterday's brief, before anything else.
- **With a URL**: read that artifact first, then publish to it. Title `LetsRide Morning Brief`,
  unchanged for ever; no favicon on a republish. **Yesterday's page is replaced**, which is why the
  log keeps the text.
- **Without one** — the first firing, or a header that went missing — **look for the page before
  making a second one.** List the account's artifacts and adopt one titled `LetsRide Morning
  Brief`; only publish new if there is none. This is the recovery path for the one gap the ordering
  cannot close: a firing that dies between publishing a new page and writing the header strands
  that page, and a stranded page is indistinguishable from no page the next morning. Whichever
  branch runs, **write `page: <url>` into the log header in the same firing.**
- **`artifact-design` is harness-provided, not a repo skill** — `.claude/skills/` holds only the
  OpenSpec ones. Load it if this firing has it, and if it does not, **write the page anyway**: one
  column, generous type, theme-aware tokens, no external fonts or scripts. It is a phone read at
  08:00, and its absence is not a reason to skip the page.

**Whether a Routine-minted session holds the artifact tool at all is UNMEASURED**, and so are the
three mechanics above — that a publish to a page this session has not read is refused, that the
title must stay stable, that a favicon is omitted on a redeploy. They are written from the tool's
own documentation and nothing in this repo has exercised them. It is the same class of unknown as
`create_session`, which the queue assumed for three weeks and did not have. **The first firing that
publishes records what it actually observed in the log header's line, and this file is corrected
from that** rather than from the documentation. Until then it fails soft in both directions: **no
page is a line in the brief, never a missing brief**, and the final message and the log are what
the owner reads that morning.

### Then

1. **The log document**, first, as above — the page's URL in its header, the brief itself as the
   entry.
2. **The page**, republished to its one URL.
3. **`PushNotification`**, last and one line, in the form `Morning brief — <the single most
   important thing>` followed by the page's URL if it fits in 200 characters. Not "your brief is
   ready": the notification is read on a lock screen and should carry the headline. If the tool is
   absent, skip it silently — the Routine's own completion notification still fires.

**Do not email, comment on an issue, or open a second page per day.** One address, one log and one
message is the whole surface, and every extra channel is a place the brief goes unread.

---

## What the owner sets up, once

**No session may create this Routine** — `CLAUDE.md` §What Not To Do, and the auto-mode classifier
refused `create_trigger` from an interactive session when it was last measured (2026-09-02). It is
made in the Routines UI, with these fields:

| Field | Value |
|---|---|
| Name | `Morning brief — LetsRide` |
| Schedule | `0 6 * * *` — cron is UTC, and 06:00 UTC is 08:00 in Amsterdam **while summer time is in force** |
| Session | a **fresh session per firing**, never a persistent one |
| Repository | `Lenhador88/LetsRide`, branch `development` |
| Connectors | Linear, GitHub, Supabase, Vercel |
| Notifications | push on; email on if the brief should also land in the inbox |
| Prompt | `Read .claude/commands/morning-brief.md in this repository and follow it exactly. It is the whole procedure.` |

**The clock does not follow the Netherlands, and this is the one maintenance item.** Cron is
evaluated in UTC with no daylight-saving handling, so `0 6 * * *` arrives at 08:00 local until
**2026-10-25** and at 07:00 local from that morning on. Changing it to `0 7 * * *` on or after that
date restores 08:00; the reverse edit is due when summer time returns. Verified with `zoneinfo`
for `Europe/Amsterdam` rather than assumed.

**A daily cron is stored verbatim**; only an *hourly* one is re-anchored server-side to the minute
it was submitted, and any UI edit re-anchors that one again — so re-read `cron_expression` after
editing the queue Routine, and expect this one to stay as typed.

**The prompt says little more than "read that file"** for the same reason the queue's does: a file
is reviewed in a PR and a prompt is not, and every firing clones `development` fresh, so a merged
edit to this file is live at the next morning with nothing else to do.

---

## Before ending

The session ends after the final message. It does not archive itself, does not schedule a
follow-up, and does not wake anyone. If the whole read pass failed — no connectors, no repository —
the brief is one line saying exactly that, which is the honest and useful thing to send.
