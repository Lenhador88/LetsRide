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

- **Main thread, always:** STEPs 0–3, STEP 4b's triage decision, the Linear status moves, the
  PR open/merge (STEP 4c), and STEP 5. The triage is a decision, so it stays here; the work it
  decides to do goes to a subagent like any other build.
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

**A lock that is being worked is not a stall, and STEP 4b makes that distinction matter more.**
Folding work into a story lengthens a run, so a healthy firing can now legitimately hold the
lock for hours. **So when the locked issue has a branch, age that branch's tip in place of the
lock's own `startedAt`** — it is the same "how long has this been true" question asked of a
better clock, not a fifth entry in the list above and not an exemption from it.

The branch name is the locked issue's `gitBranchName` (STEP 4 uses it to branch), and it has to
be fetched before it can be aged — a stale remote ref reads as an ancient tip and fires the
alarm on a healthy build:

```bash
BR=$(...)                                        # the locked issue's gitBranchName
git fetch origin "$BR" --quiet 2>/dev/null \
  && git log -1 --format=%ct "origin/$BR"        # epoch seconds; compare against now
```

**`gitBranchName` is a guess, not a fact — check the remote for anything carrying the issue
id before concluding there is no branch.** This repo builds Linear issues on `claude/*` refs
(PR #103), which is not the name Linear suggests:

```bash
git ls-remote --heads origin | grep -i "pd-<n>"   # before trusting gitBranchName
```

**Still nothing → fall back to the lock's own `startedAt`.** Two different states land here and
the alarm is right in both:

- **An issue parked in `Development (AI)` by hand with no build behind it.** `PD-118` and
  `PD-125` sat exactly like this on 2026-08-07 with `git branch -r` showing only `main`,
  `development` and one unrelated branch. This is the state the alarm most needs to catch.
- **A live build that has not pushed in over three hours.** Not a false positive: STEP 5 treats
  a pushed branch as how a firing makes its work visible, and three hours of invisible work is
  worth surfacing whether or not the process behind it is alive.

**Re-anchoring, rather than suppressing, is the point.** The obvious version of this check is
"tip moved recently → exit silently", and it is wrong in a way that is invisible: a build that
*dies* at hour 3½ has a fresh tip at the only firing inside the window, exits silently, and by
the next firing the window has passed — so the alarm is lost for ever, on exactly the abandoned
branch it exists to catch. Ageing the tip self-heals instead: a live build keeps resetting it
so the alarm never fires, and a dead one stops resetting it and ages into its own window.

The alarm is for a condition **nobody is holding**, and a false "the queue is stalled" on a
working firing teaches the owner to ignore the one alarm that matters.

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

**STEP 4b qualifies that sentence in exactly one direction:** a firing may finish the story it
was given, including work that story is incomplete without. It may never *start* one it was not
given. If you find yourself reaching for 4b to justify building something in another column,
that is the failure 4b's relatedness test exists to catch — the answer is a story.

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

**If you got far enough into the build to have a STEP 4b triage list, file it before you
stop** — same rule as §If you get stuck. This exit is named there as one of the two that leave
without reaching STEP 5, and STEP 4b deliberately creates nothing, so a follow-up rated on the
way here is lost unless this step writes it out.

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
- Update `docs/HANDOFF.md` as part of landing the work, not as a separate task.

**This step stops short of the PR on purpose.** STEP 4b decides whether anything else is
travelling in it, and that decision has to be made while the branch is still open — so opening
and merging is STEP 4c, after the triage. An earlier draft put the triage after the merge and
still told it to use "the same PR", which is not executable in order; `reviewer` caught it
before this file shipped.

Per STEP 0.6, prefer a subagent for anything that reads widely. The main thread should end
this step holding a branch and a one-line result, not a diff.

---

## STEP 4b — Triage what the build turned up, before the PR opens

A build always surfaces more than it was asked for. **Two questions, and the order is the whole
design — relatedness first, rating second.** Skipping straight to the rating is how a firing
talks itself into a second story, because nothing in a rating block asks what you are building.

### First: is this the story done properly, or the next story started early?

**Only the first is eligible to travel.** Note what this gate does and does not decide: it
decides whether something *can be built now*, never whether it is worth doing. **Everything
gets rated** — a failed relatedness test sends an item straight to the filing table below,
which routes by rating, so an unrated item has nowhere to go. The test is not "is it good" or
"is the branch open"; it is whether the picked issue is genuinely unfinished without it:

- **Travels** — the test the new code needs, the caller the new function has to have, the type
  it must be added to, the doc line this change just made false, the obvious bug found *in the
  code this story touched*.
- **Filed** — anything else, however good, however cheap, however open the branch is. A defect
  in a neighbouring file, an improvement you noticed in passing, a refactor the story merely
  made visible. These are *new work*, and `Queued (AI)` is where the owner releases new work.

If you cannot say in one line why the picked issue is incomplete without it, it does not
travel. **That sentence goes in the PR body**, so the claim is on the record rather than in
your head.

### Second: rate it, and let the block decide

**Rate it with `CLAUDE.md` §Working Principles' four-line block** — the vocabulary already
exists and two of its four lines are this question:

| Relatedness | Rating | What happens |
|---|---|---|
| Travels | **Recommendation ≥ 7/10 *and* This session = Y** | **Build it now** — same branch, same PR, re-reviewed at STEP 4c |
| Travels | Anything else | Record it for filing |
| Filed | *(rate it anyway — the filing table routes by rating)* | Record it for filing |

**Read `This session` narrowly here, and note that this IS narrower than `CLAUDE.md`'s
definition.** There it answers "should *this* session pick it up **next**", judged partly on
what context is already loaded — and its worked **Y** example is a 3/10 two-minute fix. In a
firing it means something tighter: *on this branch, in this PR, before it merges.* The two
readings are compatible but not identical, and the difference is deliberate. An interactive
session with the owner watching can take a cheap 3/10 on an open branch; an unattended one
cannot, because nobody is there to say "not that".

**That is a real cost, and it is stated rather than hidden:** a genuinely trivial, genuinely
related 3/10 fix gets filed instead of made. The owner asked for *strong* recommendations to be
built straight away, and the threshold is what makes "strong" mean something a firing cannot
argue with at 3am.

**Both halves, never either.** A 9/10 recommendation with `This session` **N** is a story, not a
build — an ordinary pairing here rather than a contradiction, and `CLAUDE.md` illustrates it
with the leaked-password toggle: 9/10 and **N**, because nobody in a session can click it.
Reading a high recommendation *alone* as licence is how a firing starts choosing its own work.

**Answer `This session` N whenever any of these is true, however good the idea is:**

- **It has real domain rules** — visibility, membership, permissions. That is `openspec`'s, and
  §The Agent Squad is explicit that a proposal is the only artifact in this pipeline with *no*
  automated gate.
- **It needs a migration whose apply order relative to the deploy matters.** `021`/`025` is the
  worked example and getting that backwards is an instant outage, not a bug.
- **It is the owner's** — a dashboard toggle, a product decision, a design frame that does not
  exist, a credential. `Todo Human`, with the `Owner only` label.
- **It would grow the diff past what one `reviewer` pass can honestly cover.**

### The breadth cap — because "one level deep" does not bound how wide

Recursion and breadth are different problems and the first draft only closed one. Five items
each rated 8/Y pass every gate above individually while collectively tripling the diff.

- **At most two fold-ins per story.** A third means the story was under-specified; file them
  all and say so in the PR.
- **The fold-ins together must stay smaller than the story's own diff.** If the extras are the
  larger half, the PR is no longer the story you were asked to build.
- **Anything the folded-in work itself turns up is a story, always**, whatever it rates. One
  level deep, no chaining.

Over either bound, **file everything and build none of it.** Do not pick the best two — the
count is the signal that the triage has gone wrong, not a quota to spend.

### Where each one gets filed — decided here, written at STEP 5

**This step decides; it does not create issues.** Filing happens once, at STEP 5, or at
whichever exit path you take if you never reach it (§If you get stuck, STEP 2c). Creating them
here *and* at STEP 5 is how the same follow-up gets filed twice, which is worse than not filing
it: a duplicate in `Todo AI` reads as two pieces of work to the owner.

So end this step holding a short list — for each item, its relatedness verdict, its four
ratings, and the column below it belongs in. Carry that list to STEP 5.

Never `Queued (AI)` — that is the owner's column and the only start signal.

| Where | When |
|---|---|
| **`Todo AI`** | A session could build it, and you would recommend building it (≥ 4/10) |
| **`Todo Human`** + `Owner only` | Nobody in a session can do it |
| **`Backlog`** | You rated it below 4/10 — a real thought, not a triaged one |

**`Backlog` is not banned, and an earlier draft of this file banned it wrongly.** `Todo AI`
means *triaged*, and the owner reads it to choose work; filling it with 2/10 ideas devalues
exactly the column this change depends on.

**Use `parentId` when the follow-up belongs to the same feature as the story it came out of.**
§Sequencing's "one issue per feature" applies to work a firing files just as much as to work
the owner files, and a loose top-level story is the shape that rule exists to prevent.

The body is a pointer and a reason, per §The roadmap lives in Linear: one line on what and why,
the four-line rating block, **the relatedness verdict** — which for a filed item is the line
saying why it is *separate* work, not a justification for travel it never claimed — and the
issue or PR it came out of. **A story that grows a specification is a bug** — that belongs in
a proposal.

Pass the project id `88f3f224-ecf0-46f0-a032-c86b7a12f81c`, never the name, and **read
`save_issue`'s response back to confirm the field you set is actually on it.** A dropped
`project` returns a perfectly successful-looking payload; that has already happened four times
in one batch.

### Say it out loud, in both places

The owner did not get to make this call, so the call has to be visible without opening a diff:

- **The PR body** gets a `## Folded in` section — one heading per item with its relatedness
  sentence and its ratings, in the shape §Working Principles specifies: the letter and
  description *outside* the bar, the four ratings *inside* it.
- **The STEP 5 Linear comment** names what was folded in and links every story filed.

An unrated fold-in reads as advocacy and cannot be cheaply declined, which is the entire reason
the block exists.

**Unsure whether something should travel? Then it does not — file it.** That is the resolution,
*not* `Needs help`. An earlier draft sent this uncertainty to `Needs help`, which was wrong in
two ways: it parks a story that is built and green, and by this point it would hold the
concurrency lock over finished work. `Needs help` is for uncertainty about **the picked story**
— an ambiguous requirement, a visibility rule nobody wrote down. Uncertainty about an *extra*
has a cheap correct answer, and it is the conservative one.

---

## STEP 4c — Open the PR and merge it

Only now, with the triage done and anything travelling already committed. **In this order** —
the review comes before the merge, and putting it after is the same defect STEP 4 documents
itself as fixing, moved one step later and onto the bullet that decides whether fold-ins ship
reviewed at all:

1. **Re-run `reviewer` on the final diff, if anything was folded in after the STEP 4 pass.**
   That is the entire safety argument for building fold-ins unattended, so it is not optional
   and it is not "the review I already ran": code added after `reviewer` looked has not been
   reviewed. Nothing folded in → the STEP 4 pass still stands and this is a no-op.

   **Its prompt must carry the scope material, because it runs before the PR exists and so
   cannot read the PR body.** Pass: the issue being built, each fold-in with its one-line
   relatedness justification and its four ratings, and the two commit ranges — the story's own
   commits versus the fold-ins'. Without those, `reviewer.md`'s scope pass cannot check the
   breadth cap at all, and is briefed to report that rather than guess the boundary from the
   diff.
2. Open a PR against **`development`**, with the `## Folded in` section from STEP 4b in the
   body — or nothing there, if nothing travelled.
3. Drive CI to green and merge. Do not merge red. **Never push to `main` and never open a PR
   against `main`** — production promotion belongs to the owner.

---

## STEP 5 — Close the loop, and wrap the session up

**The run is not over when the PR merges.** Wrap-up is the last step of the work, not a
separate task, and STEP 4b's stories are part of it — a follow-up that was rated and then never
filed is worse than one that was never noticed, because the rating made it look handled.

**The order of the first two bullets is load-bearing.** A draft of this step wrote the `Done`
comment first and told it to name the stories, which cannot be done before they exist:

- **File every STEP 4b follow-up that did not get built.** First, because the next bullet links
  them.
- Merged → move the issue to **`Done`** and comment with the PR link, one line on what landed,
  what was folded in, and a link to each story just filed.
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

**File any follow-up you already rated before you stop — every exit path owes that, not just
STEP 5's.** STEP 4b decides where each one goes but deliberately creates nothing, so this path
and STEP 2c are the two that leave with a triage list and no STEP 5 to write it out. A
follow-up rated on the way to a `Needs help` would otherwise be lost precisely
when the story is parked longest. Rating something and then dropping it is worse than never
noticing it, because the rating is what made it look handled.

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

**This changed on 2026-08-07 at the product owner's request, and the old rule is the one you
probably remember.** In full, so the change is judged against what it actually said:

> Build the issue in front of you. Do not fold in adjacent improvements you notice, however
> tempting — raise them as new Linear issues in `Backlog` instead, or note them in the PR. A
> scheduled session is the worst possible place for scope creep.

Its instinct was right and its default was too blunt: **`Backlog` for everything** means the
test a new function needs, and the doc line the change just falsified, get filed as future work
rather than done — leaving the story merged and incomplete.

**Written as a failure the old default invites, not one anyone has watched happen.** The new
rule was written 2026-08-07 and nothing has run under it. Do not let a later revision promote
either half of this paragraph into history — a plausible illustration and an observed event are
not the same claim, and only the second earns the past tense.

The rule now has two halves, and **STEP 4b is where they are applied**:

- **Work that makes the picked story right travels with it** — when it passes the relatedness
  test *and* rates ≥ 7/10 with `This session` **Y**. Same branch, same PR, same `reviewer` pass.
- **Everything else becomes a story** in `Todo AI`, `Todo Human` or `Backlog`, and the owner
  decides when it gets built.

**What did NOT change: the story in front of you is still the scope**, and the old rule's last
sentence still stands unedited — *a scheduled session is the worst possible place for scope
creep*. The fold-in is for work that finishes *that* story properly. An improvement you merely
noticed along the way is a story however good it is and however open the branch is, because it
is a *new* piece of work, and `Queued (AI)` is where the owner releases those.

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
