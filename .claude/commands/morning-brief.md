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

**No section of this file is numbered `STEP n`, deliberately.** `queue-run.md` and
`queue-pickup.md` own that namespace, `src/__tests__/agent-briefs.test.ts` resolves every
`STEP n` citation against *their* headings only, and a third file minting steps into the same
space is how a citation resolves to the wrong procedure with nothing red. Cite the sections here
by name.

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

**Exactly one write is allowed**, and only at the end: the brief log document (§The log is what
stops the brief repeating itself). If a read fails and there is no brief, there is no write either.

---

## The read pass

**Every line of the brief traces to one of these calls.** A claim with no call behind it does not
go in the brief — `CLAUDE.md` §Working Principles, *a claim about state needs the command that
checks it*. Where a call is unavailable, say so in the brief in one clause and carry on: **a
missing connector is a line in the brief, never a reason to send nothing.**

Read in this order. It is roughly cheapest-first, and the board answers most of the brief.

### The board — one pass, and it is most of the answer

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c limit=100
                          fields=["identifier","title","status","labels","updatedAt","url"]
```

One call, then read it locally. The statuses are exact strings and **must not be typed from
memory** in any later call — `mcp__Linear__list_issue_statuses team=Pedro & Dave` is the list, and
a `save_issue` naming a status that no longer exists returns a successful-looking payload with the
field silently dropped. What to pull out:

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

**`development` ahead of `main` is the steady state, not drift** (`docs/HANDOFF.md` §Branching).
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
  same number (`CLAUDE.md` §Working Principles).
- **A paused project.** The free tier auto-pauses after about seven days idle and a paused project
  serves nothing with no alert. If `get_project` reports anything but active, that is the first
  line of *Needs you*.
- **A security advisor that is not in the accounting** — `docs/reference/migrations.md`
  §Security advisors carries the per-migration table. An unexpected advisor is one not in it; a
  one-advisor difference between the two projects is almost always a pending promotion and is not
  news.

### Yesterday's brief

```
mcp__Linear__list_documents  query="Morning brief log" fields=["id","title","content","url"]
```

Read the top entry. It is what stops today's brief repeating yesterday's, and it is where the
outside-the-box rotation is recorded. §The log is what stops the brief repeating itself has the
rules.

---

## The shape of the brief

**Four sections, in the owner's order, and nothing else.** No preamble, no "here is your morning
brief", no closing summary. Around seventy rendered lines total, of which the rating blocks are
about half — this is a phone read before coffee, and the discipline is `CLAUDE.md` §Working
Principles: *if a paragraph has no action in it, delete it.*

### 1 — Where we stand

**Five lines, hard cap.** Each is one sentence and each traces to a call above. Building, waiting,
landed since yesterday, deploys, databases. If a line would say "unchanged", cut it — an unchanged
thing is not news, and a five-line section that is really two lines is the honest one.

### 2 — Needs you

**Every line is something no session can do**, with the click or the decision named. Ordered:
production down, then a paused project, then a decision blocking a build, then the rest.

Each is at most two lines: *what is stuck* and *what you do about it*, with the issue's short
title in front of any id — **never a bare `PD-nnn`**, which means something to whoever wrote it
and nothing to whoever reads it on a phone (`CLAUDE.md` §Working Principles).

**"Nothing needed" is a valid and preferred answer, and must be written as one line rather than
padded out.** A brief that manufactures an owner action to look useful spends the credibility the
real ones need — the same rule as `CLAUDE.md` §Working With the Product Owner on manufactured
objections.

**Re-measure before quoting an `Owner only` item.** Two in a row have been found already-fixed,
and that is the shape rather than a coincidence: a dashboard setting has no file to change, so
nothing marks it done except someone re-measuring. `docs/ENVIRONMENTS.md` §The redirect allowlist
carries the credential-free probes.

### 3 — Consider doing

**Now, then later, as lettered options — at most three across both**, ordered by
`Recommendation` descending, each with its title on its own line, a short practical explanation in
its own paragraph, and the five-rating block in its own blockquote. The format is `CLAUDE.md`
§Working Principles and the worked example there is the one to copy, line breaks included.

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
  it; afterwards **prepend** today's entry with `save_document`.
- **The entry is the brief itself**, plus a first line of `YYYY-MM-DD · lens: <weekday lens>`.
- **Trim to the last fourteen entries** on every write. It is a working memory, not an archive.
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

**The brief is this session's final message.** That always works and needs no tool.

Then, best-effort and in this order, each failing soft:

1. **`PushNotification`**, one line, in the form `Morning brief — <the single most important
   thing>`. Not "your brief is ready": the notification is read on a lock screen and should carry
   the headline. If the tool is absent, skip it silently — the Routine's own completion
   notification still fires.
2. **The log document**, as above.

**Do not email, comment on an issue, or open a document per day.** One durable log and one message
is the whole surface, and every extra channel is a place the brief goes unread.

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
