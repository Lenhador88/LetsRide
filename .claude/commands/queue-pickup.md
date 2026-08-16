---
description: Build one dispatched Linear story end to end — the child session's procedure
---

# Queue pickup — build one story

**You were dispatched to build one named story, and its id is in your prompt.** The picking was
done by [`queue-dispatch.md`](queue-dispatch.md) in another session: the queue was read, the
premise checked, the blockers checked, and this story was chosen against a set of caps that
assumed what it would touch. **Do not pick different work, and do not pick more work.**

This procedure lives here rather than inside a prompt for two reasons: a prompt is re-injected
into the conversation on every firing and this file is not, and a prompt cannot be reviewed in a
PR while this file can.

**Your session is fresh and yours alone.** That is the change §Why this session is fresh records:
there is no owner conversation above you, no earlier build's context, and nothing else will run in
here. So there are no idle gates to clear — the owner-activity gate and the queue lock are the
dispatcher's now — and this file starts at "can you see the board".

**Other stories are being built in parallel sessions right now**, and your prompt names them and
the paths they expect to touch. **Stay inside your own paths.** If the story genuinely cannot be
finished without editing across that boundary, that is §If you get stuck, not a judgement call —
the dispatcher's caps were set on the assumption you would not.

**You cannot report back to the dispatcher, and nothing you say in this session reaches the
owner.** A cloud session receives messages and cannot answer into the conversation that spawned
it. Everything that must be seen goes on the record: the Linear issue, the PR, and the push
notification at STEP 5.

Read `CLAUDE.md` fully before acting — it is the contract, and §The roadmap lives in Linear
defines this board.

Workspace `lets-ride`, team **Pedro & Dave** (`PD`), project **Let's ride (AI)**
(`88f3f224-ecf0-46f0-a032-c86b7a12f81c`). Note the curly apostrophe in that name; pass the
id, never the name.

---

## The status names — re-derive them, never type them from memory

**Renaming a status is a two-click change nothing in the repo can see, and it has already
happened twice** — three names moved at once on 2026-08-08 and every file naming one went stale.
The live set as last read back off the board:

| Status | Type | Means | Who moves it |
|---|---|---|---|
| `Backlog AI` | backlog | Captured, not triaged. **Was `Backlog`** | Either |
| `Todo Human` | unstarted | Triaged; owner chores live here | Either |
| `Todo AI` | unstarted | Triaged, and a session could do it. **Not a start signal** | Either |
| `Needs decision` | unstarted | Blocked on a product answer or a proposal read | **Owner**, and the dispatcher's scout on a stale premise |
| `Queued (AI)` | started | **Approved to build. The only start signal** | **Owner** |
| `Development (AI)` | started | An agent has it *now*. **The concurrency lock** | Agent |
| `Needs help` | started | An agent stopped and needs the owner. **Also the lock** | Agent |
| **`Deployed to DEV`** | started | **Merged to `development`, green, live on DEV. Where a firing ends** | Agent |
| `Done (in production)` | completed | Promoted to `main` and live for riders. **Was `Done`** | **Whoever promoted** — never a firing |
| `Canceled` / `Duplicate` | canceled / duplicate | Closed without shipping. **Both clear a blocker** | Either |

`duplicate` really is what `list_issue_statuses` returns as `Duplicate`'s `type` — read back off
the board 2026-08-08, not inferred from Linear's published `WorkflowState.type` enum, which does
not list it. Do not "correct" it to `canceled`.

```
mcp__Linear__list_issue_statuses  team=Pedro & Dave
```

**Run that before the first status write of a firing.** A `save_issue` naming a status that no
longer exists is the failure this table exists to catch, and it is not loud — the call can come
back looking successful with the field silently dropped, which `CLAUDE.md` records happening
four times in one batch to the `project` field.

**Two traps live in the `Type` column, and both are the kind that fail silently:**

- **`Deployed to DEV` is typed `started`.** So is `Queued (AI)`. **Never widen the dispatcher's
  lock to "any issue whose statusType is `started`"** — that would count every queued story and
  every story already shipped to DEV as work in flight, and the queue would freeze permanently
  while looking perfectly healthy. `Needs help` is the one name that stops the queue, and a
  `Development (AI)` claim binds one issue only. (This is the same
  never-clearing-guard shape as the team-scoped lock and the buried stall alarm. It is a
  recurring failure here, not a numbered series — do not give it a sequence number, because
  hypotheticals and observed events end up sharing one.)
- **`Done (in production)` is the only `completed` status, and a FIRING never sets it** — because
  a firing never promotes, not because a session may not write it. **The status follows the
  deploy, not the role**: an owner-directed session that promotes to `main` itself sets it, and
  `CLAUDE.md` §The roadmap lives in Linear carries that instruction and its wording. A *firing*
  ends at `Deployed to DEV` and stops there (§STEP 5), so for this procedure the effect is
  unchanged — moving an issue there from a firing claims riders have the feature when they do not.

---

## STEP 0 — Can you even see the board?

Load `list_issues` via `ToolSearch` and call it. **If the Linear tools are not available, STOP
and send a push notification saying the scheduled pickup cannot reach Linear.** Do not proceed
on assumptions and do not pick work from the repo instead.

It must fail loudly — a job that silently does nothing looks exactly like an empty queue.

**Search for it by keyword, not by the `mcp__Linear__*` name — that prefix is not stable.**
Watched rotate mid-session on 2026-08-08: every connector's tools came back re-registered under
a **UUID** prefix (`mcp__a55a164a-…__list_issues`) and the `mcp__Linear__*` names stopped
resolving entirely. A `select:mcp__Linear__list_issues` lookup returns no match at that point,
which reads exactly like "the connector is gone" when it is right there under another name.
This is the same rotation that quietly broke the `mcp__Linear__*` entries in
`.claude/settings.json` and the squad's tool allowlists (`PD-154`).

```
ToolSearch  query="+list_issues linear"      # keyword, survives a rename
ToolSearch  query="select:mcp__Linear__list_issues"   # exact — fails the moment ids rotate
```

**This applies to every connector, not just Linear** — the rotation re-registered all of them at
once. So `mcp__github__create_pull_request` — STEP 4c, and the only route to a PR since `gh` is
absent — carries the same hazard. **It fails in the honest direction**: no PR opens and the run
stops visibly. The dangerous version of this now lives in the dispatcher, whose session gate
fails *open* if `list_sessions` cannot be reached, which is why that file makes an unreachable
connector a hold rather than a pass.

Everywhere below writes `mcp__<connector>__<tool>` for readability. **Read it as "the tool called
`<tool>` on that connector", whatever prefix it currently carries**, and reach it by keyword
search rather than by pasting the literal name. **A `select:` lookup that returns no match means
"search again by keyword", never "the connector is gone"** — only a keyword search coming back
empty establishes that.

**Send it yourself, with the `PushNotification` tool.** A self-bound Routine cannot carry
completion notifications: the server rejects the `notifications` parameter for any trigger
bound to a persistent session, so the only notification that will ever reach the owner from
a firing is one this session sends. That is a change from the fresh-session Routine, which
had `notifications.push` set on the trigger itself.

---

## STEP 2c — If it turns out to be out of sequence mid-build, stop

The dispatcher's scout pass only sees blockers somebody wrote down. If the issue you are building
turns out to need something another unfinished issue is meant to deliver — its columns, its
migration, its provider key, its design decision — and no relation says so, **do not build
it, and do not quietly swap to a different story.** Move it to `Needs help`, comment naming
the issue it is waiting on and why, and stop. Sequencing is the owner's to fix, and building
in the wrong order is expensive in a way a skipped hour is not.

Consider adding the missing `blockedBy` relation while you are there, so the next firing
catches it at the dispatcher's scout pass instead.

**If you got far enough into the build to have a STEP 4b triage list, file it before you
stop** — same rule as §If you get stuck. This exit is named there as one of the two that leave
without reaching STEP 5, and STEP 4b deliberately creates nothing, so a follow-up rated on the
way here is lost unless this step writes it out. **Put the sub-4 items in the `Needs help`
comment**, since there is no PR body here to hold them.

---

## STEP 3 — Confirm the claim

**The dispatcher already moved the issue to `Development (AI)` before spawning you** — it claims
first and spawns second, so the status is what stops a second dispatch handing the same story to
a second session. Read it back and confirm; do not re-write it.

**If it is in any other status, stop and do nothing.** Something has changed since you were
dispatched — the owner moved it, or a duplicate session is already on it — and building anyway is
how the same story ships twice. Say so in a `PushNotification` and end.

**That claim is per issue, not a lock on the queue.** Other stories are legitimately in
`Development (AI)` at the same time; they are other sessions' and none of your business.

---

## STEP 4 — Build it

Follow `CLAUDE.md` exactly. In particular:

- Branch off `development`, never `main`. Use the issue's `gitBranchName` if it has one.
- Follow the squad order in §The Agent Squad. `openspec` first if the story has real domain
  rules — visibility, membership, permissions, or a schema change. Skip it for copy, styling
  or a dependency bump.
- **The `reviewer` pass on the code happens once, at STEP 4c, on the final diff — not here.**
  It is still the one non-negotiable delegation, and still always *before* the merge and never
  after: it has caught, in one session, a feature that shipped completely unreachable because an
  optional prop gated its only entry point, and an RLS leak that every other gate passed.

  **A pass taken here is superseded the moment STEP 4b commits anything**, so running one here
  and another after the triage is the same diff read twice, minus the fold-ins, at full cost.
  **The honest bound is that one pass covers everything committed up to it, and nothing after** —
  never "impossible by construction", because CI fixes and fixes for `reviewer`'s own findings
  both land later. STEP 4c bullet 1 carries the rule for those.

  **The proposal pass is a different gate and it stays.** When `openspec` runs, `reviewer` reads
  the *proposal* — the only artifact in this pipeline with no automated gate at all, since
  `openspec/` runs zero CI jobs.
- Verify locally: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
  Run `PGPASSWORD=postgres npm test` if anything under `supabase/**` changed.
- A migration that changes a policy must add an assertion.
- Update `docs/HANDOFF.md` as part of landing the work, not as a separate task.

**This step stops short of the PR on purpose.** STEP 4b decides whether anything else is
travelling in it, and that decision has to be made while the branch is still open — so opening
and merging is STEP 4c, after the triage. Triage after the merge with instructions to use "the
same PR" is not executable in order.

**Build it in this session's own thread.** The rule used to be one build subagent per story, and
that existed for exactly one reason: the shared Development session could not clear itself, so a
subagent's fresh window was the closest achievable substitute. **Your session already is that
fresh window**, so the substitute has nothing left to buy — and paying it costs a full re-read of
`CLAUDE.md` plus a brief, and puts a report between you and your own build.

Two delegations survive on their own merits, and neither is about context hygiene:

- **A specialist, where the story wants one** — `data` for a migration, `media` for an upload,
  `realtime` for a subscription, `design-system` for a new primitive, `openspec` for real domain
  rules. Spawn them from this thread; a subagent cannot spawn one.
- **`reviewer`, always, at STEP 4c.** Its value is that it did not write the code, which is the
  one thing this session cannot do for itself at any price.

**Keep the commit range that is the story itself.** STEP 4c's scope pass needs it to tell the
story's own commits from the fold-ins', and it cannot be recovered from a combined diff.

---

## STEP 4b — Triage what the build turned up, before the PR opens

A build always surfaces more than it was asked for. **Two questions, and the order is the whole
design — relatedness first, rating second.** Skipping straight to the rating is how a firing
talks itself into a second story, because nothing in a rating block asks what you are building.

### First: is this build done properly, or the next build started early?

**Only the first is eligible to travel.** Note what this gate does and does not decide: it
decides whether something *belongs in this build*, never whether it is worth doing. **Everything
gets rated** — a failed relatedness test sends an item straight to the filing table below,
which routes by rating, so an unrated item has nowhere to go.

**The test is the context of the build, not the letter of the story.** Product owner,
2026-08-09: *"It seems we are creating too many stories. If it seems within the context of the
build, and recommended, just do it."* That deliberately widens this gate. The test used to be
whether the picked issue was *incomplete* without the item, which sent every cheap, obvious,
adjacent fix to the board — on a branch already open over the very file it lived in.

- **Travels** — anything inside the code this story touches: the test the new code needs, the
  caller the new function has to have, the type it must be added to, the doc line this change
  just made false, the obvious bug in a file the diff already opens, the tidy-up the story made
  both visible and trivial.
- **Filed** — a different subsystem, a different screen, a different table: work whose diff
  would not overlap this one's. That is *new work*, and `Queued (AI)` is where the owner
  releases new work.

If you cannot say in one line how the item sits inside the same build, it does not travel.
**That sentence goes in the PR body**, so the claim is on the record rather than in your head.

### Second: rate it, and let the block decide

**Rate it with `CLAUDE.md` §Working Principles' five-rating block** — the vocabulary already
exists and two of its five ratings are this question:

| Relatedness | Rating | What happens |
|---|---|---|
| Travels | **Recommendation ≥ 4/10 *and* This session = Y** | **Build it now** — same branch, same PR, reviewed at STEP 4c |
| Travels | Anything else | Record it for filing |
| Filed | *(rate it anyway — the filing table routes by rating)* | Record it for filing |

**`This session` means *on this branch, in this PR, before it merges*** — `CLAUDE.md`'s reading
of that axis, not a narrower one. **Do not re-narrow it on the grounds that a firing is
unattended**; what bounds an unattended build is the breadth cap below, not a higher bar on each
item.

**The bar is 4 because that is the number the filing table already uses**, and the two are
deliberately the same one. Below 4 a firing files nothing it could have built itself; at 4 and
above it files a row. So the rule is *if it would otherwise become a permanent row on the owner's
board, and you can do it on this branch, do it here* — one threshold with no band between them.
**Do not raise it back**: a higher bar recreates exactly that band, where an item is worth a row
for ever but not worth ten minutes on a branch already open over the file.

Both halves still have to clear. `CLAUDE.md` illustrates the axis with a two-minute 3/10 **Y** —
that example says what `This session` *means*, not what travels, and a 3/10 still does not
travel. One a session could do itself is not filed either — it is a line in the PR body. An
owner action is filed whatever it rates.

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

Recursion and breadth are different problems, and "one level deep" closes only the first. Five
items each rated 8/Y pass every gate above individually while collectively tripling the diff.

- **At most two fold-ins per story, and necessity ranks ahead of rating.** Fold every *necessary*
  one first — the item whose relatedness sentence says the story is broken without it — then fill
  any slot left by **Recommendation**, ties to the smaller diff, and file the rest. Ranking by
  rating alone would file a necessary item any time two discretionary ones outscored it, and the
  two are independent axes: that is the premise of the whole five-rating block. At a ≥ 4 bar a
  third eligible item is the ordinary shape of a triage, so this is a quota to spend rather than
  an alarm — which is coupled to that bar, and raising it should bring the old cliff back.
- **More than two *necessary* fold-ins is the cliff, and the real signal.** File them all and say
  so in the PR: a story that cannot be finished without three separate additions was
  under-specified, and that is the owner's to fix rather than yours to absorb.
- **The fold-ins together must stay smaller than the story's own diff.** If the extras are the
  larger half, the PR is no longer the story you were asked to build.
- **The *discretionary* ones are capped harder — together under a third of the story's diff.**
  Parity was sized against a gate that admitted only what the story was broken without, and those
  still travel at any size: a test the new code needs is not optional. An adjacent bug or a
  tidy-up is a **choice**, and two large ones clear "at most two, smaller than the story" while
  turning the PR into something else.
- **Anything the folded-in work itself turns up is a story, always**, whatever it rates. One
  level deep, no chaining.

**Two bounds have a partial remedy, and both are safe for the same one reason: their excess
cannot contain a necessary fold-in.** The discretionary third is scoped to the optional half by
construction; the count gets there by ranking necessity ahead of rating. Neither can drop
something the story is broken without — and a single over-large tidy-up resolves to "file it"
under the third.

**Parity stays a cliff**: over it, **file everything and build none of it.** Its excess is
neither scoped nor ranked, so it can contain anything, and when the extras outweigh the story
itself it is the triage rather than the ordering that went wrong.

### Where each one gets filed — decided here, written at STEP 5

**This step decides; it does not create issues.** Filing happens once, at STEP 5, or at
whichever exit path you take if you never reach it (§If you get stuck, STEP 2c) — creating them
here *and* there is how the same follow-up gets filed twice, and a duplicate reads to the owner
as two pieces of work. End this step holding a short list: for each item, its relatedness
verdict, its five ratings, and where the table below sends it — which for a sub-4 item a session
could have built itself is nowhere.

Never `Queued (AI)` — that is the owner's column and the only start signal.

| Where | When |
|---|---|
| **`Todo Human`** + `Owner only` | Nobody in a session can do it — **matched first, whatever it rates** |
| **`Todo AI`** | A session could build it, and you would recommend building it (**Recommendation** ≥ 4/10) |
| **Nowhere** | A session could have built it *and* you rated it below 4/10 — write it in the PR body and let it go |

An owner action can rate 2/10 and still has to be filed: `docs/reference/linear.md` §Keep it current requires a new
one in Linear *the moment it is found*, and nobody in a session will ever pick it up off a PR
body. Only work a session could have done itself is eligible to be dropped.

**Below 4/10 a firing files nothing it could have built itself**, where it used to open a
`Backlog AI` row — an owner action is out of that by the row above, whatever it rates. A sub-4
idea is a real thought and it is still not work, and a column of them is a large part of what the
owner means by too many stories. The PR body is a durable enough record: a thought worth having
twice gets had again by whichever session next opens that file, with better context than the row
would have carried. **`Backlog AI` stays the owner's to use** — they can park a real idea there;
a firing cannot.

**On the two exits that never reach a PR — STEP 2c and §If you get stuck — the `Needs help`
comment is the PR body's stand-in.** Both leave with a triage list and no PR to write it into, so
without this the sub-4 items go nowhere at all, which §If you get stuck rightly calls worse than
never having noticed them.

**The threshold reads `Recommendation` and nothing else.** There are two 0–10 axes now, and
**Customer value** is the wrong one to route on: it scores 0–2 for most correctness, migration
and tooling work, which is precisely what a firing files. Routing on it would drop every such
item — burying the findings this step exists to surface.

**Default to one filed story per build, and make a second argue for itself.** `docs/reference/linear.md` §Sequencing's *one
issue per deliverable* governs what a firing files just as much as what the owner files, so four
findings about one subsystem are one issue with four lines in it, not four issues. The board's
one-day clusters are what the alternative looks like — `PD-159`, `PD-160` and `PD-161` are three
Low `docs:check` follow-ups from a single build. A second issue needs its one-line reason, in the
PR body, saying what makes it independently deliverable.

### Search before you file — update an existing issue rather than opening a second one

The product owner's instruction: non-obvious improvements *"should lead to issues created **or
updated** in linear"*. The second half is the one a firing will skip, and a board carrying two
issues for one problem reads as two pieces of work. So for each item, **search first**:

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  query=<a few distinctive words>
```

- **Something already covers it** → update that issue instead. Add a comment with what this
  build learned, the five ratings and the PR it surfaced from; raise the priority or move the
  status only if this build genuinely changed the picture. **Never move an existing issue into
  `Queued (AI)`** — that is still the owner's column, and promoting one from inside a firing is
  the same overreach as picking work from it.
- **Nothing covers it** → create it, per the table above.
- **Say which you did** in the STEP 5 comment. "Updated `PD-xxx`" and "filed `PD-yyy`" are
  different facts and the owner is reading for both.

Search on the *symptom*, not on your own phrasing of the fix — the existing issue was almost
certainly written from a different angle, and a query built from your title will miss it.

**Use `parentId` when the follow-up belongs to the same feature as the story it came out of.**
`docs/reference/linear.md` §Sequencing's "one issue per feature" applies to work a firing files just as much as to work
the owner files, and a loose top-level story is the shape that rule exists to prevent.

The body is a pointer and a reason, per §The roadmap lives in Linear: one line on what and why,
the five-rating block, **the relatedness verdict** — which for a filed item is the line
saying why it is *separate* work, not a justification for travel it never claimed — and the
issue or PR it came out of. **The block goes at the top, above the prose**, and its fifth rating is
`Ready` rather than `This session` — a different question, **recomputed rather than carried
across**. This step answers `This session` **N** in order to file something at all, and most of
those are `Ready` **Y**: another session could start them, they just were not this branch's work.
`docs/reference/linear.md` §What an issue body opens with has the rest. **A story that grows a specification is a bug** — that belongs in
a proposal.

Pass the project id `88f3f224-ecf0-46f0-a032-c86b7a12f81c`, never the name, and **read
`save_issue`'s response back to confirm the field you set is actually on it.** A dropped
`project` returns a perfectly successful-looking payload; that has already happened four times
in one batch.

### Say it out loud, in both places

The owner did not get to make this call, so the call has to be visible without opening a diff:

- **The PR body** gets a `## Folded in` section — one heading per item with its relatedness
  sentence and its ratings, in the shape §Working Principles specifies: the letter and
  description *outside* the bar, the five ratings *inside* it.
- **The STEP 5 Linear comment** names what was folded in and links every story filed.

An unrated fold-in reads as advocacy and cannot be cheaply declined, which is the entire reason
the block exists.

**Unsure whether something should travel? Then it does not — file it.** That is the resolution,
*not* `Needs help`: sending it there parks a story that is built and green, and holds the
concurrency lock over finished work. `Needs help` is for uncertainty about **the picked story**
— an ambiguous requirement, a visibility rule nobody wrote down.

---

## STEP 4c — Open the PR and merge it

Only now, with the triage done and anything travelling already committed. **In this order** —
the review comes before the merge, and putting it after is the defect this repo has paid for
three times: PR #34, #46 and #94 each shipped and were then reviewed, and #46's finding was a
live RLS hole letting any signed-in rider post a ride into any club.

1. **Run `reviewer` on the final diff. Always, once, here.** This is the single code-review
   gate for the firing — STEP 4 runs none, so there is no earlier pass to fall back on and
   **no "nothing folded in, so this is a no-op" branch**. That branch is deliberately absent: it
   is the one path through this file that could reach a merge on a review predating the last
   commit. Because it always sees the whole branch, it is also the pass that reviews the
   fold-ins, which is the entire safety argument for building them unattended.

   **A commit made AFTER this pass is not covered by it, and two are routine here:** a CI fix
   at bullet 3, and any fix for `reviewer`'s own findings. The bound is *one pass covers
   everything up to it*, so — **re-run `reviewer` on the delta alone** (`git diff <reviewed
   sha> HEAD` — **two dots**, because a finding fixed by amending leaves a *sibling* of the
   reviewed commit, and `...` then silently widens the range to the whole branch) when what you
   added after it is non-trivial: anything touching `src/`,
   `supabase/`, a policy, a guard, a permission, **`.claude/agents/*.md`, `.claude/commands/*.md`
   or `CLAUDE.md`**. Those last three are on the list because `reviewer.md` calls them
   *executable process* whose only gate is this review — fixing a review finding by editing a
   brief or this very procedure is a routine way to land an unreviewed change, and `CLAUDE.md`
   is loaded into every future session. A lockfile bump, a typo, a formatting fix or a reworded
   comment does not need one. **When in doubt, re-run on the delta** — it is a small diff by
   definition, so the cheap call is the safe one.

   **Its prompt must carry a review packet, because it runs before the PR exists and so cannot
   read the PR body.** Build it immediately before spawning the agent, with one command, and
   paste the output verbatim:

   ```bash
   base=$(git merge-base origin/development HEAD)
   echo "base: $base"; git diff --name-only "$base" HEAD
   ```

   **The base is that sha, never the name `origin/development`**, and that is the half of the
   packet that earns its place. A branch name resolves when the reviewer reads it, so another
   firing merging in between silently widens the diff by work this session did not write —
   `reviewer.md` §Start here already refuses `main` as a base for exactly that reason, and a
   moving `development` is the same defect arriving later. A sha cannot move.

   Pass it with the rest of the scope material: the issue being built, each fold-in with its
   one-line relatedness justification and its five ratings, and the two commit ranges — the
   story's own commits versus the fold-ins'. Without those, `reviewer.md`'s scope pass cannot
   check the breadth cap at all, and is briefed to report that rather than guess the boundary
   from the diff.

   **Rebuild the packet whenever anything commits after you built it** — bullet 3's CI fix is the
   usual case, and a delta re-review above needs its own packet based on the reviewed sha rather
   than the merge base. `reviewer.md` re-derives the file list as a checksum and reports a stale
   packet rather than trusting it, so forgetting costs a line in the report instead of an
   unreviewed file — but it only reports what it can see, and a packet is not a substitute for
   rebuilding it.

   **Spawn it in the background, and stamp the spawn in the same turn.** Both are inputs to
   §Confirm the pass returned, which gates the merge at bullet 3 — a foreground spawn blocks the
   main thread inside the tool call, leaving no moment at which `ListAgents` can be called at
   all, and an unstamped spawn leaves that section's bound with no clock. **The stamp cannot be
   taken retroactively**, which is why it is here rather than beside the check that consumes it.

   ```bash
   date -u +%FT%TZ     # at spawn — and again at each check; the elapsed time is the bound's clock
   ```
2. **Push the branch — again, if STEP 4b built anything.** Then open a PR against
   **`development`**, with the `## Folded in` section from STEP 4b in the body, or nothing there
   if nothing travelled.

   **The push at the end of STEP 4 does not cover the fold-ins**, because STEP 4b commits after
   it. `create_pull_request` succeeds against whatever was last pushed, so skipping this leaves a
   PR that merges the story without the fold-in while the `## Folded in` section and the STEP 5
   comment both say it shipped — and STEP 5's `git checkout development` then strands those
   commits. Nothing in CI, the PR or the board would show it. Push unconditionally; it is a no-op
   when there is nothing new.

   ```bash
   git push -u origin HEAD
   git log --oneline "origin/$(git rev-parse --abbrev-ref HEAD)..HEAD"   # must be empty
   ```

   **`HEAD`, not a `$BRANCH` variable.** This file used to assign one while checking the session
   was idle, where it was *expected to be `development`* — and reusing that here pushes the story
   branch's commits straight onto `development`, which `CLAUDE.md` forbids outright, and then the
   must-be-empty guard fails and stalls the run with no PR open. The variable is gone with those
   gates; `HEAD` is written out so it does not come back. Unset, it fails in the honest direction:
   `fatal: invalid refspec ''`.
3. Drive CI to green and merge. Do not merge red, and **do not merge holding no review result** —
   run §Confirm the pass returned here, immediately before the merge. **Never push to `main`
   and never open a PR against `main`** — production promotion belongs to the owner.

### Confirm the pass returned — the gate bullet 3 runs

**The `reviewer` pass is a gate on the MERGE, and a missing result is a missing review rather
than a clean one.** Anchor it on bullet 3 and nowhere earlier. The push and the PR do not depend
on the review — they only start CI — so a gate at the push buys nothing and costs the thing that
matters: it asks the question at the one moment a still-listed agent is most likely to look
healthy, hours before the answer is needed. **Never merge holding no report.** That is the
reading that does the damage: it reaches a merge with no review at all — CI green, a PR merged
and a `Deployed to DEV` status all looking correct — which is the same outcome a build agent that
cannot spawn `reviewer` at all reaches by a different route.

*(`CLAUDE.md` §Delegating while the owner is at the keyboard reaches the same anchor — *"the
findings still land before the merge, which is the threshold that matters"* — but do **not** cite
it as governing here. That section is explicitly the **attended** mode, and the dispatcher's
owner-activity gate means a dispatched build is never in it; the rest of it — reply at once, keep
answering — is wrong unattended, and you have nobody to reply to. The argument above stands on
its own.)*

**A dead agent and a slow one are indistinguishable from the main thread**: no error, no
notification, nothing on the board. The signal is an *absence*, and every other gate here that
can fail silently already has a tripwire for one — `check.mjs` holds that a skip must never read
as a pass, `no-service-role-key` proves its own detector still matches. This is that tripwire,
and it is one call plus the stamp bullet 1 took at spawn:

```bash
date -u +%FT%TZ   # now, against bullet 1's spawn stamp — the elapsed time is the bound's clock
```

```
ListAgents     # listed -> alive, but read it WITH the elapsed time · not listed -> it died
```

The question each branch answers is **has this pass given you an answer, and is it still
plausibly going to** — so a hang and a death land in the same place, which is what keeps the
table total:

- **You hold a report** → covered. Merge when bullet 3's other conditions are met.
- **No report, still listed, spawned less than 30 minutes ago** → it is running. Do not re-spawn
  and do not idle — the completion re-invokes you, so do bullet 2 and drive CI. **Not the Linear
  writes**: STEP 5's are ordered behind the merge, and moving the issue to `Deployed to DEV`
  early releases the dispatcher's per-issue claim, so a later dispatch could hand this same story
  to a second session while you are still holding it. **Come back to this check before merging**;
  nothing else will bring you back, because neither a death nor a hang emits an event.
- **No report and it is not coming — not listed at all, or listed 30 minutes or more — and you
  have not re-run it yet** → **re-run it once**, with a freshly built packet, and re-enter this
  table with a fresh stamp.
- **Same again after the re-run** → **`Needs help`, and do not merge.** §If you get stuck.
- **`ListAgents` will not answer** — the call fails, or the tool is absent. It is a native tool
  rather than a connector's, so STEP 0's rotation hazard does not reach it; the plausible failure
  is a deferred schema, which `select:` fixes. If it genuinely will not answer: **this is not
  "not listed"**, and reading it as one re-runs a healthy pass and then parks it. **Fall back to
  the clock alone** — wait out the bound, then re-run once, then park. The table stays total
  without the tool; it just loses the early death signal.

**The bound is what makes those branches distinguishable, and losing it fails in both
directions.** Without it a hang has no exit at all: it cannot merge, and if it also cannot park
it holds its issue in `Development (AI)` for ever with nothing on the board — which the
dispatcher's stall alarm then has to catch hours later. Set too tight, it is the inverse: a re-run
spawned a minute ago has no report *yet*, and parking on that spends a `Needs help` — a lock
name — on a review that was working. **30 minutes is ~6× a measured pass**, and the multiplier is
deliberately generous because those two directions do not cost the same: setting it too long
merely delays a merge, while setting it too short is the `Needs help` in the sentence above.
Re-derive the ~5 minutes from a couple of recent passes rather than trusting it, and move the
bound with it.

Observed rather than feared — the `PD-151` firing, 2026-08-09; `PD-172` has the account.
**The delta re-review in bullet 1 is the same gate and gets the same check**: spawned the same
way, it can die the same way, and its triggers land after the push, so the merge is the only
anchor that covers it too.

---

## STEP 5 — Close the loop, and wrap the session up

**The run is not over when the PR merges.** Wrap-up is the last step of the work, not a
separate task, and STEP 4b's stories are part of it — a follow-up that was rated and then never
filed is worse than one that was never noticed, because the rating made it look handled.

**In this order — every bullet depends on the one above it.** The closing comment links stories
that must already exist, and the DEV-deploy check gates the status move rather than following it.
That is why they are numbered and cross-referenced by number.

1. **File or update every STEP 4b follow-up its table sent to a column** — a sub-4 item a session
   could have built itself goes nowhere and is already recorded in the PR body; a sub-4 *owner
   action* is still filed. First, because bullet 4 links them, and per STEP 4b's search rule some
   are updates to issues that already exist rather than new ones.
2. **Return to `development` and pull**, so bullet 3 has the merge commit to check against.

   ```bash
   git checkout development && git pull origin development && git status --porcelain
   git rev-parse origin/development     # the sha bullet 3 must match
   ```

3. **Check the DEV deploy** — see below. `ERROR` on *your* commit stops the run here and goes to
   `Needs help`; anything else continues.
4. **Move the issue to `Deployed to DEV`** and comment with the PR link, one line on what
   landed, what was folded in, a link to each story filed **or updated**, and the deploy state
   from bullet 3.
5. **Send one push notification** with the `PushNotification` tool: `Done ; ) <issue id> <short
   title>`. This is the only thing you send that reaches the owner directly.
6. **Poke the dispatcher, last.** Your slot is now free, and this is what starts the next batch
   in seconds instead of at the top of the next hour:

   ```
   mcp__Claude_Code_Remote__fire_trigger
     trigger_id=trig_01WJkMVXGzUVGDcC1njNmaan
     text="<issue id> merged to development. Slot free."
   ```

   **Send it even when you parked into `Needs help`, and say so in the text.** The dispatcher will
   refuse to dispatch while anything sits in `Needs help` — that is deliberate — but it can only
   run its stall alarm on a firing that actually happens, and a story that stopped is precisely
   the one worth waking it for.

   **Failing to poke is not a failure of the run.** The hourly Routine is the heartbeat behind
   this exactly because a child can die before reaching it. If `fire_trigger` errors, note it in
   the Linear comment and stop — do not retry in a loop, and do not fall back to editing the
   trigger.

**Bullet 3 failing means the PR is already merged**, so §If you get stuck's usual claim — that
parking into `Needs help` leaves a branch and an open PR for the next firing to trip over — does
**not** apply here. The lock is the only thing holding the queue, which is correct: a broken DEV
is exactly what should stop the next story from starting.

### `Deployed to DEV` is where a firing ends. Production is not yours.

**The owner promotes to production by hand, in their own session, at their own timing** —
stated 2026-08-08: *"Deployment to production is not automated, and I will do it on a different
session at my own will."* So:

- **A firing never moves an issue to `Done (in production)`**, never opens a PR against `main`,
  and never merges one. That status is a claim that riders have the feature, and only the
  promotion makes it true — so it belongs to whoever performs the promotion, which is never this
  procedure. (An owner-directed session that *is* asked to promote sets it, and must: see
  `CLAUDE.md` §The roadmap lives in Linear. The three-way split — a firing stops at DEV, a
  directed session that promotes closes the loop, the owner promotes on their own timing — is why
  this reads as "never a firing" rather than "never a session".)
- **`Deployed to DEV` is an honest end state, not a lesser one.** The work is merged, green and
  live on DEV. `CLAUDE.md` §Working Principles' *committed and pushed is not shipped* is
  satisfied by the merge — the queue's unit of done is a merged PR, and the release is a
  separate decision the owner owns.

**Check the DEV deploy once before you claim it, and do not poll.** The status says *deployed*,
so spending one call to avoid asserting something false is worth it — `CLAUDE.md`: *a claim
about state needs the command that checks it*.

```
list_deployments  teamId=team_LkthusCourobWuutI1HA8stg  projectId=prj_WPbeT9zuZY53g296XzOuzDH5HOCY
```

**Both ids are required and neither is in the repo** — no `.vercel/` directory exists, so
without them the check costs `list_teams` → `list_projects` → `list_deployments` every firing.
They are recorded here to keep it one call. The Vercel project is **`letsrideapp`** under team
**`Pedro's projects`**; re-derive with those two list calls if either id ever stops resolving.

**Match on the commit, not on "the newest `development` build" — otherwise the check is worse
than none.** There is no branch filter, so the response mixes feature-branch previews and the
`main` production build in with DEV. Entry `[0]` is not yours, and *neither is the newest
`development` entry*: called seconds after the merge, that is usually the **pre-merge** build.
Reading it green claims `Deployed to DEV` for a build that does not exist; reading a stale
`ERROR` sends a healthy story to `Needs help` and parks the queue on someone else's old failure.

**Find the entry whose `meta.githubCommitSha` equals `git rev-parse origin/development` from
bullet 2.** Then:

- `READY`, or still `BUILDING`/`QUEUED` → continue to bullet 4 and say which in the comment. A
  build in flight is the normal case; the merge is the commitment and waiting on Vercel would
  just burn the firing.
- **`ERROR` → stop.** That is a broken DEV, and it is what §If you get stuck is for:
  `Needs help`, with the deployment URL and the failure in the comment. Green CI and a failed
  deploy are different gates; CI passing does not cover this.
- **No entry matches your sha yet** → the deploy has not been created. Continue, and say
  "deploy not yet visible" in the comment. Do not poll for it.
- **The Vercel connector is missing or the call fails** → continue, and say the deploy was
  unverified. An unlabelled guess is the thing to avoid, not the missing check itself.

---

## If you get stuck — this is expected and it is not a failure

Move the issue to **`Needs help`**, comment with *exactly* what you need from the owner, and
stop. Leave the branch and any PR open and say so in the comment.

**Parking owes a comparison table of the ways forward** — one row per option, columns scored 0–10,
a total, sorted by it descending. `docs/reference/linear.md` §What an issue body opens with carries
the format and why a total is right there and wrong in the five-rating block. It applies to every
parking exit in this file: here and STEP 2c. **"Tell me what you need" and "here are your
options, ranked" are different messages**, and only the second is one the owner can act on
without reconstructing the problem first.

**File any follow-up you already rated before you stop — every exit path owes that, not just
STEP 5's.** STEP 4b decides where each one goes but deliberately creates nothing, so this path
and STEP 2c are the two that leave with a triage list and no STEP 5 to write it out. **Put the
sub-4 items in the `Needs help` comment**, since there is no PR body here to hold them. Rating
something and then dropping it is worse than never noticing it, because the rating is what made
it look handled.

Use it whenever you would otherwise guess: an ambiguous requirement, a visibility rule
nobody wrote down, a migration whose ordering you cannot verify, a design frame that does not
exist, CI red for a reason outside the story, a `reviewer` pass that will not return even on a
re-run (STEP 4c bullet 1), or a decision that is the owner's to make.
`CLAUDE.md` §Working Principles forbids letting an unlabelled guess pass as a known value —
`Needs help` is where those go.

**Stopping into `Needs help` is always better than merging something you are not confident
in.** It also parks the whole queue until the owner clears it, which is the intended behaviour —
`Needs help` is the one status the dispatcher refuses to dispatch past, precisely so a story
needing the owner does not get buried under three merged PRs.

**Leave the branch and any PR open, and say so in the comment.** Nothing else will pick this up:
your session ends here, and the next dispatch will not touch a story it can see is parked. **Still
send the STEP 5 poke**, with text saying you stopped — the dispatcher cannot run its stall alarm
on a firing that never happens.

---

## Scope discipline

**The story in front of you is the scope**, and *a scheduled session is the worst possible place
for scope creep*. The rule has two halves, and **STEP 4b is where they are applied**:

- **Work inside the context of the build travels with it** — when it passes the relatedness test
  *and* rates ≥ 4/10 with `This session` **Y**. Same branch, same PR, same `reviewer` pass.
- **Work outside it becomes a story** in `Todo AI` or `Todo Human` — or an update to the issue
  that already covers it, per STEP 4b's search rule — and the owner decides when it gets built.
  Below 4/10, work a session could have built itself becomes a line in the PR body and nothing
  else; an owner action is filed whatever it rates.

**Filing *everything* is the failure this shape avoids.** The product owner read the board on
2026-08-09 and said so: too many stories, build the ones that sit in the context of the work.
Both directions cost — a filed test the new code needed leaves the story merged and incomplete,
and a filed 2/10 thought leaves the owner a row to read for ever. **The merged-and-incomplete
cost is the one nobody has watched happen here; do not let a later revision promote it into
history.** The over-filing one has been watched.

The boundary is worth being able to say in one line, because everything above is downstream of
it: is this **this build, done properly** — or **the next build, started early?** The first
travels. The second is filed, or dropped.

---

## Why this session is fresh

**This file used to run in one long-lived session reused every hour, and every awkward thing about
it came from that.** A session spawned *by a Routine* gets its connectors from the trigger, and
`create_trigger` refuses the `connectors` parameter for this organization — so a fresh-session
Routine was one bad call away from a permanently connector-less job that only the owner could
repair by hand. Binding to a session that already held its connections was the only way to have a
job that could reach Linear at all.

**A session spawned by another *session* inherits them.** Probed 2026-08-16 from a
`create_session` child with the repo attached: `permission_mode: auto` inherited without
complaint, and Linear, Supabase and the GitHub tools all reachable. That is what made the
dispatcher possible, and it retires four costs at once:

| Cost of the reused session | How it is gone |
|---|---|
| The session was not idle by construction — a firing could land mid-conversation with the owner | Nothing else runs in here. The seven idle gates are deleted, not moved |
| Context accumulated across firings, and no session can `/clear` itself | This window starts empty and is discarded after one story |
| The build had to run in a subagent purely to stand in for that clear | STEP 4 — build in your own thread; only specialists and `reviewer` are delegated now |
| One story at a time, because one session could only build one thing | The claim is per issue; other stories build in parallel sessions |

**What did not change: the owner's gate, and `Needs help`.** The dispatcher still refuses to
dispatch while the owner has a session actively working, and still stops the whole queue when any
story is parked in `Needs help`. Both are in [`queue-dispatch.md`](queue-dispatch.md).

**Two things remain irreversible from inside a session**, and they are in `CLAUDE.md` §What Not To
Do because the calls that trip them are CCR calls made by a session that is not reading this file:

- **Never delete `trig_01Gzy8eCiaXUUa1knvJnNpwy`** — the *disabled* fresh-session Routine, and the
  fallback. Its three connectors were hand-attached and cannot be recreated from a session, so
  deleting it destroys the only recoverable path; `update_trigger enabled: true` restores it
  whole. **`…WJkMV` is the cheap hourly one and `…Gzy8e` is the irreplaceable one** — keep the two
  straight in both directions. A disabled trigger's `list_triggers` row has **no `enabled` key at
  all** rather than `"enabled": false`, so read a disable back by checking the field is gone.
- **Never archive the session the dispatcher Routine is bound to.** Archiving it stops the queue
  silently, with no error anywhere, and `update_trigger` has no `persistent_session_id`
  parameter — so recovery means a new trigger bound to a new session.

And what it buys beyond the connectors: the session can see whether the owner is mid-request,
which is the only reliable idle signal there is, and no fresh session could ever have it.
