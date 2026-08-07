---
description: Drain the top of the Linear Queued (AI) column — the hourly Routine's procedure
---

# Hourly queue pickup

This is the procedure the hourly Routine runs. It lives here rather than inside the
Routine's prompt for two reasons: a prompt is re-injected into the conversation on every
firing and this file is not, and a prompt cannot be reviewed in a PR while this file can.

**It runs in the Development session** — one long-lived session that is reused every hour,
rather than a fresh session per firing. That is deliberate and §Why this session is reused
below explains what it buys and what it costs. The practical consequence is the one that
changes how you read the rest of this file: **the conversation above you is not empty, and
some of it may be the owner mid-sentence.** Steps 0.5 and 0.6 exist for that.

Read `CLAUDE.md` fully before acting — it is the contract, and §The roadmap lives in Linear
defines this board.

Workspace `lets-ride`, team **Pedro & Dave** (`PD`), project **Let's ride (AI)**
(`88f3f224-ecf0-46f0-a032-c86b7a12f81c`). Note the curly apostrophe in that name; pass the
id, never the name.

---

## STEP 0 — Can you even see the board?

Try `mcp__Linear__list_issues` (load it via ToolSearch first). **If the Linear tools are not
available, STOP and send a push notification saying the scheduled pickup cannot reach
Linear.** Do not proceed on assumptions and do not pick work from the repo instead.

It must fail loudly — a job that silently does nothing looks exactly like an empty queue.

**Send it yourself, with the `PushNotification` tool.** A self-bound Routine cannot carry
completion notifications: the server rejects the `notifications` parameter for any trigger
bound to a persistent session, so the only notification that will ever reach the owner from
a firing is one this session sends. That is a change from the fresh-session Routine, which
had `notifications.push` set on the trigger itself.

---

## STEP 0.5 — Is this session idle? Gather, do not exit yet.

**New with the reused session, and the whole reason this step exists:** a fresh session was
idle by construction. This one is not. The firing message is queued behind whatever the
session is already doing and lands the moment that finishes — which may be the middle of a
conversation with the owner, or the middle of a build.

> **Gather the answers here; do NOT exit here.** Every reason to stop — this step's four and
> STEP 1's lock — is collected first and acted on together in **STEP 1.5**, which owns the
> only exit path. That ordering is load-bearing and it is not how this file was first
> written: an unconditional silent exit at STEP 0.5 sat *in front of* STEP 1's stall
> notification, so the one alarm built to detect a permanently frozen queue could never
> fire. Worse, it was self-reinforcing — the `Needs help` path deliberately leaves an open
> PR behind, which tripped this step for ever. Caught by `reviewer` before merge. **Never
> reintroduce an early return above STEP 1.5.**

**Record which of these is true.** They are reasons to stop, not instructions to stop yet.

1. **The owner has an unfinished request in this conversation.** You can see it; a fresh
   session could not. If the turns above you are the owner asking for something and that
   thing is not delivered and merged, the session is not idle. Their work wins — the queue
   waits an hour, which costs nothing.
2. **The working tree is dirty** — `git status --porcelain` is non-empty.
3. **A branch is in flight** — the current branch is neither `development` nor `main` and
   `git log --oneline origin/development..HEAD` is non-empty. Some earlier work has commits
   that have not landed.
4. **An open PR whose head is THE CURRENT BRANCH.** *Committed and pushed is not shipped*; a
   PR on the branch you are standing on is unfinished work you would be building on top of.

   **Scope it to the current branch, never repo-wide.** `list_pull_requests state=open`
   returns every open PR in the repository, including other sessions' — `#101` and `#102`
   came from `session_01WqnR4UC4vi3Zi8AZxt4ahc`, a different session on this repo, and
   concurrent sessions are normal here. A repo-wide check hands any other session a
   permanent veto over the queue. Checks (2) and (3) already cover local in-flight work, so
   this one only has to catch the case where the tree is clean because the work is pushed.

```bash
git status --porcelain                                   # (2) must be empty
BRANCH=$(git rev-parse --abbrev-ref HEAD)                # (3) expect development
git fetch origin development --quiet
git log --oneline origin/development..HEAD               # (3) must be empty
echo "$BRANCH"                                           # (4) match PR head to THIS
```

```
mcp__github__list_pull_requests  owner=Lenhador88 repo=letsride state=open
  -> keep only those whose head ref == $BRANCH
```

**Only (1) needs judgement, and it is the one that matters most.** The other three are the
backstop that catches what judgement misses — a session that died mid-build leaves a dirty
tree behind, and that is exactly the state where picking up a second story does damage.

**Do not "help" by finishing the in-flight work.** It was not queued to you, you do not know
whether the owner is still deciding something about it, and a scheduled unattended session
is the worst possible place to guess. Let the next hour try again.

---

## STEP 0.6 — Reduce the session before doing anything expensive

The session is reused, so every firing that reads files, greps the tree and reviews a diff
in the **main thread** leaves that behind for every later firing. Unchecked, the Development
session gets slower and dumber by the day. There is no tool available to a session that
clears its own context — `/clear` and `/compact` are CLI commands the owner types — so the
discipline below is the mechanism, not a nicety.

**Delegate the build. Keep the main thread to gates, decisions and the final summary.**

**The split is forced by what the squad can reach, not chosen — check before you redraw it.**
No agent in `.claude/agents/` holds a single `mcp__Linear__*` tool, none holds
`create_pull_request` or `merge_pull_request`, and **`gh` is not installed in this
container**. So the Linear moves, the PR and the merge **cannot** be delegated to the squad
and must stay in the main thread. They are cheap — a handful of calls — which is what makes
this split workable rather than a compromise. Re-derive rather than trust it:

```bash
grep -l "mcp__Linear__\|create_pull_request\|merge_pull_request" .claude/agents/*.md   # expect none
command -v gh                                                                          # expect nothing
```

- **Main thread, always:** STEPs 0–3, the Linear status moves, the PR open/merge, and STEP 5.
- **Subagents, always:** the actual building — `feature`, `data`, `design-system`, `media`,
  `realtime`, `test`, and the non-negotiable `reviewer` pass. Every one of those holds
  Read/Write/Edit/Bash, which is all a build needs. A subagent's file reads, greps and test
  output never enter this conversation; only its conclusion does.
- Do not read a large file into the main thread to "get oriented". Ask a subagent for the
  conclusion instead. `CLAUDE.md` §When to delegate: *the answer is a conclusion, not the
  files*.
- Never paste a full diff, a full test log or a full file into the main thread. A path and a
  line number is clickable and costs nothing.

**Do not "run the whole pickup in one subagent" to save more.** An earlier draft said to,
and it cannot work: the pickup has to move Linear statuses and open and merge a PR, and per
above nothing in `.claude/agents/` can do either. The only agent types that could are the
built-in `general-purpose` and `claude`, which inherit every tool — **but whether an
inherited MCP grant actually survives into a subagent here is untested**, and a pickup that
discovers it does not, halfway through, has already claimed the issue. Keep the split above.
If you want to test the inherited-grant question, do it deliberately in its own session and
write down what you find; do not find out during a firing.

**Tell the owner when a clear would help.** You cannot do it, they can, and they will not
know unless you say so. One line at the end of a firing is enough: *"this session is
carrying N firings of history and holds nothing in flight — `/clear` is safe whenever you
want it."* Only say it when STEP 5 finished cleanly, because a clear during in-flight work
would discard exactly the context that makes the reuse worth having.

---

## STEP 1 — The lock. Gather this too.

List the issues **of project `88f3f224-ecf0-46f0-a032-c86b7a12f81c`** and check their
statuses. **If ANY of them is in `Development (AI)` or `Needs help`, that is the lock and it
is held.** One story at a time is the rule — an issue in either status means a previous
firing is still in flight, or is blocked waiting on the owner. Carry the answer to STEP 1.5
rather than exiting here.

**Scope that query to the project, never to the team, and this is not a style preference.**
Measured 2026-08-07: `list_issues` filtered by team and `state: Development (AI)` returns
**`PD-82`, `PD-83` and `PD-41` as well** — issues from 2022–2025, two in the deprecated
`Let's Ride` project and one with no project at all, parked in that status for years and
never coming out. A team-scoped lock check is therefore held **permanently**, and the
symptom is indistinguishable from a healthy job with a busy queue: every firing exits
silently, for ever. `CLAUDE.md` §The roadmap lives in Linear already says the deprecated
project is not a source of truth; this is what that means operationally.

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c
```

Do not "help" by looking at the blocked issue. Do not pick a different story because the
blocked one looks stuck.

---

## STEP 1.5 — The only exit. Decide here, and never above here.

You now hold every reason to stop: STEP 0.5's four and STEP 1's lock. **If none is true, go
to STEP 2.** Otherwise stop — but run the stall check *before* you do, because this is the
one place that can see a queue which has frozen.

**The stall check, and it covers every blocking reason rather than only the lock.** That is
the fix for the bug this step exists to prevent: the alarm used to hang off the lock alone,
sitting behind an unconditional silent exit that could never reach it. Ask how long the
oldest blocking condition has been true:

- **The lock** — `mcp__Linear__get_issue` → `stateHistory[].startedAt` on each issue in
  `Development (AI)` or `Needs help`. Take the longest-held.
- **A branch in flight** — `git log -1 --format=%cr` on its tip.
- **An open PR on the current branch** — its `createdAt`.
- **The owner's unfinished request** — never stalls. It is a live human, not a stuck job.
  Exclude it; notifying someone about their own open conversation is noise.

**If the oldest is more than 3 hours old but less than 4, send ONE push notification naming
it and saying the queue is stalled, then stop.** The window is narrow on purpose: it fires
roughly once rather than every hour. Outside the window, exit silently.

**Send it with the `PushNotification` tool.** A self-bound Routine cannot carry notifications
of its own — the server rejects that parameter for a trigger bound to a persistent session —
so this is the only way the message reaches anyone.

This matters because every blocking condition here can be held by something nobody is working
on: an issue dragged into `Development (AI)` by hand, a branch left behind by a session that
died, a PR abandoned mid-review. Then the queue freezes for ever and every firing exits
quietly — which is the same failure STEP 0 exists to prevent, and the reason the exit is
funnelled through one place instead of scattered across the gates.

---

## STEP 2 — Take the top of the queue

Only if the gates passed. List issues with status **`Queued (AI)`**.

- **Empty queue → exit silently.** No notification, no comment, no changes. This is the
  normal case and must stay cheap.
- Otherwise take the **highest priority** issue: Urgent (1) beats High (2) beats Medium (3)
  beats Low (4) beats No priority (0). Ties break by oldest `createdAt`.

**Never take work from `Backlog`, `Todo Human`, `Todo AI` or `Needs decision`.**
`Queued (AI)` is the only start signal — it is how the owner chooses what gets built, and
picking from anywhere else takes that decision away from them. `Todo AI` is the one to be
careful with: the name reads like permission and it is not one.

**An epic or parent issue is not work.** If the issue you picked has sub-issues, it is a
container: the buildable thing is one of its children. Leave the parent where it is, comment
saying so, and take the next candidate instead. A container in the queue outranks its own
children on priority, so this is a real trap rather than a hypothetical one.

---

## STEP 2b — Check what it is blocked by, and skip it if the blocker is unfinished

`mcp__Linear__get_issue` takes an **`includeRelations: true`** flag, off by default, and
returns `relations.blockedBy` / `.blocks` / `.relatedTo`.

```
mcp__Linear__get_issue  id=<the issue>  includeRelations=true   ->   .relations.blockedBy
```

For each entry, look up its status. **If any blocker is not `Done` or `Canceled`, do not
build this issue.** Comment on it once naming the unfinished blocker, then go back to STEP 2
and take the next candidate by priority. Do **not** move it to `Needs help` — being blocked
is an ordinary state, not something the owner must clear, and parking the whole queue for it
would be worse than skipping one story.

If every candidate in the column is blocked, exit silently.

**This is a backstop, not the sequencing mechanism.** `CLAUDE.md` §Sequencing is still the
contract: only buildable work belongs in `Queued (AI)`, and work waiting on something else
waits in `Todo AI` until the owner queues it. `list_issues` cannot filter or return
relations, so you can only check *after* picking — which catches a mistake rather than
making it safe.

---

## STEP 2c — If it turns out to be out of sequence mid-build, stop

The check above only sees blockers somebody wrote down. If the issue you are building turns
out to need something another unfinished issue is meant to deliver — its columns, its
migration, its provider key, its design decision — and no relation says so, **do not build
it, and do not quietly swap to a different story.** Move it to `Needs help`, comment naming
the issue it is waiting on and why, and stop. Sequencing is the owner's to fix, and building
in the wrong order is expensive in a way a skipped hour is not.

Consider adding the missing `blockedBy` relation while you are there, so the next firing
catches it at STEP 2b instead.

---

## STEP 3 — Claim it

Move the issue to **`Development (AI)`** *before* starting work. That status is the
concurrency lock STEP 1 checks, so claiming late means two firings can start the same story.

---

## STEP 4 — Build it, in subagents

Follow `CLAUDE.md` exactly. In particular:

- Branch off `development`, never `main`. Use the issue's `gitBranchName` if it has one.
- Follow the squad order in §The Agent Squad. `openspec` first if the story has real domain
  rules — visibility, membership, permissions, or a schema change. Skip it for copy, styling
  or a dependency bump.
- **Always run the `reviewer` agent on the diff before merging, never after.** It is the one
  non-negotiable delegation. It has caught, in one session: a feature that shipped completely
  unreachable because an optional prop gated its only entry point, and an RLS leak that every
  other gate passed.
- Verify locally: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
  Run `PGPASSWORD=postgres npm test` if anything under `supabase/**` changed.
- A migration that changes a policy must add an assertion.
- Open a PR against **`development`**, drive CI to green, and merge it. Do not merge red.
  **Never push to `main` and never open a PR against `main`** — production promotion belongs
  to the owner.
- Update `docs/HANDOFF.md` as part of landing the work, not as a separate task.

Per STEP 0.6, prefer a subagent for anything that reads widely. The main thread should end
this step holding a PR number and a one-line result, not a diff.

---

## STEP 4b — Triage what the build turned up

A build always surfaces more than it was asked for. **Rate each one with `CLAUDE.md`
§Working Principles' four-line block, then let the block decide.** The vocabulary already
exists and two of its four lines are exactly this question, so nothing new has to be invented:

| Rating | What happens |
|---|---|
| **Recommendation ≥ 7/10 *and* This session = Y** | **Build it now** — same branch, same PR, same `reviewer` pass |
| Anything else | **File a story** and move on |

**Both halves, never either.** A 9/10 recommendation with `This session` **N** is a story, not
a build, and that pairing is ordinary rather than contradictory — `CLAUDE.md` says so in as
many words, using the leaked-password toggle as the example: 9/10 and **N**, because nobody in
a session can click it. Reading a high recommendation *alone* as licence to build is how a
firing quietly starts choosing its own work, which is the one decision `Queued (AI)` exists to
give the owner.

**Answer `This session` N whenever any of these is true, however good the idea is.** These are
the cases an unattended firing cannot honestly answer Y to:

- **It has real domain rules** — visibility, membership, permissions. That is `openspec`'s, and
  a proposal gets reviewed before it is built. §The Agent Squad: a proposal is the only artifact
  in this pipeline with no automated gate.
- **It needs a migration whose apply order relative to the deploy matters.** `021`/`025` is the
  worked example and getting it wrong is an instant outage, not a bug.
- **It is the owner's** — a dashboard toggle, a product decision, a design frame that does not
  exist, a credential. File it `Todo Human` with the `Owner only` label.
- **It would grow the diff past what one `reviewer` pass can honestly cover.** That review is
  the gate that makes unattended merging safe at all; work that outgrows it is two PRs.

**Why the fold-in is bounded to the same PR, and what that buys:** the extra work goes through
the *same* `reviewer` pass, the same CI and the same merge, so there is no path here that ships
anything unreviewed. If it cannot travel with the story — its own branch, its own migration,
its own review — that alone answers `This session` **N**.

### Filing the story

Never `Backlog`, which is untriaged by definition and where the old rule buried everything.
Never `Queued (AI)`, which is the owner's column and the only start signal.

- **`Todo AI`** — a session could build it.
- **`Todo Human`** plus the `Owner only` label — nobody in a session can.

The body is a pointer and a reason, per `CLAUDE.md` §The roadmap lives in Linear: one line on
what and why, the four-line rating block, and the issue or PR it came out of. **A story that
grows a specification is a bug** — that belongs in a proposal.

Pass the project id `88f3f224-ecf0-46f0-a032-c86b7a12f81c`, never the name, and **read
`save_issue`'s response back to confirm the field you set is on it.** A dropped `project`
returns a perfectly successful-looking payload; that has already happened four times in one
batch.

### One level deep — never recurse

Anything the folded-in work *itself* turns up is a **story, always**, whatever it rates.
Otherwise one firing chains build onto build and the PR never closes, which is scope creep
wearing a rating block.

### Say it out loud, in both places

The owner did not get to make this call, so the call has to be visible without opening a diff:

- **The PR body** gets a `## Folded in` section — one heading per item with its ratings, in the
  shape §Working Principles specifies: the letter and description *outside* the bar, the four
  ratings *inside* it.
- **The STEP 5 Linear comment** names what was folded in and links every story filed.

An unrated fold-in reads as advocacy and cannot be cheaply declined, which is the entire reason
the block exists.

**Still unsure whether to fold something in? That is `Needs help`, not "build it and find
out."** `CLAUDE.md` forbids letting an unlabelled guess pass as a known value, and a scheduled
unattended session is the worst place in this repo to guess.

---

## STEP 5 — Close the loop, and wrap the session up

**The run is not over when the PR merges.** Wrap-up is the last step of the work, not a
separate task, and STEP 4b's stories are part of it — a follow-up that was rated and then never
filed is worse than one that was never noticed, because the rating made it look handled.

- Merged → move the issue to **`Done`** and comment with the PR link and one line on what
  landed.
- **File every STEP 4b story that did not get built**, and name them in that same comment. Do
  this before the notification, so the notification is true when it is sent.
- Send one push notification with the `PushNotification` tool: `Done ; ) <issue id> <short
  title>`.
- **Leave the session idle**: branch back on `development`, clean tree, nothing in flight —
  so the next firing's STEP 0.5 passes. This is now part of finishing the work rather than
  housekeeping, because the next firing reads that state as its gate.

```bash
git checkout development && git pull origin development && git status --porcelain
```

- Then the one line from STEP 0.6 about `/clear` being safe.

---

## If you get stuck — this is expected and it is not a failure

Move the issue to **`Needs help`**, comment with *exactly* what you need from the owner, and
stop. Leave the branch and any PR open and say so in the comment.

Use it whenever you would otherwise guess: an ambiguous requirement, a visibility rule
nobody wrote down, a migration whose ordering you cannot verify, a design frame that does not
exist, CI red for a reason outside the story, or a decision that is the owner's to make.
`CLAUDE.md` §Working Principles forbids letting an unlabelled guess pass as a known value —
`Needs help` is where those go.

**Stopping into `Needs help` is always better than merging something you are not confident
in.** It also parks the queue until the owner clears it, which is the intended behaviour.

**Note the interaction with STEP 0.5, and note that it was a bug rather than a feature.**
Parking into `Needs help` leaves a branch and an open PR behind on purpose, so the next
firing trips STEP 0.5's in-flight checks *and* STEP 1's lock. An earlier draft of this file
called that "two gates agreeing" — it was not. STEP 0.5 exited silently before STEP 1 ran, so
the redundancy actively *suppressed* the stall notification, and the state that guarantees
the suppression is the very state `Needs help` creates. A story parked for the owner would
have gone unnoticed for ever.

STEP 1.5 is the fix: one exit, and it runs the stall check across every blocking reason
including the branch and the PR. **Anything that reintroduces an early return above STEP 1.5
brings the bug back** — including, tempting as it looks, "cheap checks first, so we can skip
the Linear round trip".

---

## Scope discipline

**This changed on 2026-08-07, and the old rule is the one you probably remember.** It read
*"Build the issue in front of you. Do not fold in adjacent improvements you notice, however
tempting — raise them as new Linear issues in `Backlog` instead."* Everything became a
`Backlog` issue, including the two-minute fix on a branch that was already open, already green
and already under review.

The rule now has two halves, and **STEP 4b is where they are applied**:

- **Work that makes the picked story right travels with it** — when it rates ≥ 7/10 with
  `This session` **Y**. Same branch, same PR, same `reviewer` pass.
- **Everything else becomes a story** in `Todo AI` or `Todo Human`, and the owner decides when
  it gets built.

**What did NOT change: the story in front of you is still the scope.** The fold-in is for work
that finishes *that* story properly — the test it needs, the caller the new function has to
have, the doc line the change just made false. An improvement you merely noticed along the way
is a story however good it is and however open the branch is, because it is a *new* piece of
work, and `Queued (AI)` is where the owner releases those.

The boundary is worth being able to say in one line, because everything above is downstream of
it: is this **the story, done properly** — or **the next story, started early?** The first
travels. The second is filed.

---

## Why this session is reused

A fresh session per firing was the original design and it failed on permissions. A session
spawned by a Routine gets its connectors from the trigger, and **`create_trigger` refuses the
`connectors` parameter for this organization** — measured 2026-08-07 and re-tested the same
day. The existing Routine only has Supabase, Linear and Vercel because the owner attached
them by hand in the claude.ai Routines UI, which is not something any session can do. So
every rebuild of that Routine was one bad call away from a permanently connector-less job.

Binding to a long-lived session moves the connector grant off the trigger entirely: the
session holds its own connections, and the firing is just a message arriving in a
conversation that can already reach Linear.

What it costs, and what each cost is paid with:

| Cost | Paid with |
|---|---|
| The session is not idle by construction | STEP 0.5 |
| Context accumulates across firings | STEP 0.6 |
| The trigger cannot carry push notifications | STEP 0 / STEP 5 send them from the session |
| A firing can land mid-conversation with the owner | STEP 0.5 (1) — their work wins |

And what it buys beyond the connectors: the session can see whether the owner is mid-request,
which is the only reliable idle signal there is, and no fresh session could ever have it.
