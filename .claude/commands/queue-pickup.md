---
description: Build one dispatched Linear group end to end — the child session's procedure
---

# Queue pickup — build one group

**You hold the stories named either by [`queue-run.md`](queue-run.md) STEP 5 — in this same
session, minutes ago — or by the prompt the owner handed you, and usually there is one.** The
picking is done: the queue was read, the blockers checked, and these were chosen against what the
other live session is touching. **Do not pick different work.**

**You hold a slot, and the slot is the concurrency cap.** `queue-run.md` STEP 5's note, or your
prompt, names it — `slot-1` or `slot-2` — and the label is on every issue you were given. Two
labels exist, so at most two build sessions run at once, and every firing counts them off the board
rather than off any session list. **Every issue you claim carries your label**, and nothing else may wear it.

**You MAY take another story when these are finished, and STEP 6 is the whole of that rule.** It
is bounded by a story count and a measured token budget, it never leaves your own slot, and it is
the cheapest work in this queue: a fresh session re-pays ~50k of process docs before it reads a
line of code, and you have already paid that.

**When your prompt names more than one, they are a *group*: stories that collide, which is why one
session builds them rather than two** — `queue-run.md` STEP 4 has the reasoning, and the note
written at its STEP 5 (or your prompt) names the specific collision. What follows from it here is one thing, at STEP 4: **build
them in the order given**, so the migration numbers and the shared component are written once, in
a decided sequence.

A group is **one branch, one PR and one `reviewer` pass** — never a branch per story. What stays
per story is the Linear bookkeeping: each one is claimed, commented and moved on its own.

This procedure lives here rather than inside a prompt for two reasons: a prompt is re-injected
into the conversation on every firing and this file is not, and a prompt cannot be reviewed in a
PR while this file can.

**Your session is fresh and yours alone.** That is the change §Why this session is fresh records:
there is no owner conversation above you, no earlier build's context, and nothing else will run in
here. So there are no idle gates to clear — the queue's own locks were read at `queue-run.md`
STEP 1 — and this file starts at "can you see the board".

**One other story may be building in a parallel session right now**, and your prompt names the
territory it declared. **Stay outside it.** If the story genuinely cannot be finished without
editing across that boundary, that is §If you get stuck, not a judgement call — your group was
admitted on the assumption you would not.

**Nothing you say mid-session reaches the owner; only the record and the final message do.** A
Routine-run session pushes its closing message to the owner's phone and nothing before it, and a
hand-spawned one is read hours later. Everything that must be seen goes on the record: the Linear
issue, the PR, and the push notification at STEP 5.

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
| `Needs decision` | unstarted | Blocked on a product answer or a proposal read | **Owner**, and a build session whose story fails STEP 3's premise check |
| `Queued (AI)` | started | **Approved to build. The only start signal** | **Owner** |
| `Development (AI)` | started | An agent has it *now*. **Claims one issue; not a lock on the queue** | Agent |
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

- **`Deployed to DEV` is typed `started`.** So is `Queued (AI)`. **Never widen the queue's
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

**Two Claude Code Remote tools are wanted too, and only at the end**: `get_session`, for STEP 6's
budget gate and for STEP 7's own id, and `archive_session`, which STEP 7 calls with that id. **A
Routine-minted session holds neither** (`queue-run.md` §Why this shape), and both steps say what
to do without them. Do not load either here — a build that never reaches those steps has no use for them, and their absence
must not stop a story that is otherwise buildable. Each step says what to do if its tool will not
answer, and the two answer differently on purpose — stated as outcomes, because "fails open" is
reversible on a step whose action is *archiving*: an unanswerable `get_session` at STEP 6 **ends**
the session, and an unanswerable tool at STEP 7 **keeps** it.

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
stops visibly. **Not every unreachable connector fails that way, so decide per call rather than by
habit** — `queue-run.md` STEP 0 stops the firing with a message when the board is unreadable,
while STEP 6's budget read below fails *closed* silently (a budget you cannot read is not a budget
you have cleared).

Everywhere below writes `mcp__<connector>__<tool>` for readability. **Read it as "the tool called
`<tool>` on that connector", whatever prefix it currently carries**, and reach it by keyword
search rather than by pasting the literal name. **A `select:` lookup that returns no match means
"search again by keyword", never "the connector is gone"** — only a keyword search coming back
empty establishes that.

**That still holds here, and `CLAUDE.md` §The Agent Squad's "there is no recovery" does NOT
overrule it — the two are about different things.** You are a **main thread**: you have no
`tools:` line, so nothing filters your search and the keyword lookup genuinely recovers a rotated
connector (`PD-154`'s 2026-08-09 comment records `+list_issues linear` doing it). That paragraph
is about a **subagent**, whose search is filtered by its own allowlist before it runs — which is
why the fix there was to put both spellings on the brief. **Do not skip the keyword search on the
strength of it**: a firing that reads a `select:` miss as a dead connector and sends the
cannot-reach-Linear push has stopped the queue over a recovery that works.

**Send it with the `PushNotification` tool if that tool resolves, and end the session with the
same line either way.** A fresh-session Routine pushes its run's final message to the owner
(`queue-run.md` STEP 6 §What the final message says), and a hand-spawned session holds the tool.
One of the two always reaches them; a duplicate is harmless and an absent one is not.

---

## STEP 2c — If it turns out to be out of sequence mid-build, stop

The blocker check at `queue-run.md` STEP 3 only sees blockers somebody wrote down. If the issue you are building
turns out to need something another unfinished issue is meant to deliver — its columns, its
migration, its provider key, its design decision — and no relation says so, **do not build
it, and do not quietly swap to a different story.** Move it to `Needs help`, comment naming
the issue it is waiting on and why, and stop — at STEP 7, which will keep this session rather
than archive it. Sequencing is the owner's to fix, and building
in the wrong order is expensive in a way a skipped hour is not.

Consider adding the missing `blockedBy` relation while you are there, so the next firing
catches it at `queue-run.md` STEP 3 instead.

**Send the push before you stop**, exactly as §If you get stuck requires and for the same reason:
`Done ; ) <issue id> parked, needs you — waiting on <issue id>`. This exit never reaches STEP 5
bullet 5, and the queue is frozen behind it.

**If you got far enough into the build to have a STEP 4b triage list, file it before you
stop** — same rule as §If you get stuck. This exit is named there as one of the three that leave
without reaching STEP 5, and STEP 4b deliberately creates nothing, so a follow-up rated on the
way here is lost unless this step writes it out. **Put the sub-4 items in the `Needs help`
comment**, since there is no PR body here to hold them.

**§The cost record goes in that same comment**, headed `parked (Needs help)`. This exit is usually
cheap — it is the one taken *before* building — and a short block saying so is exactly the datum
that separates an hour wasted from ten minutes spent correctly.

---

## STEP 3 — Confirm the claim

**Every issue in your group is already in `Development (AI)` with your slot label** —
`queue-run.md` STEP 5 claimed them before handing you here, or the owner did by hand, and the
status is what stops a later firing taking the same story. Read them back and confirm; do not
re-write them.

**If one is in any other status, drop that story and build the rest.** Something changed since you
were dispatched — most likely the owner moved it — and building it anyway is how work lands that
nobody asked for. Say which you dropped in a `PushNotification`, in the PR body, and in STEP 5's
comment on the stories that remain. **If none of them survives, stop and do nothing** — go to
STEP 7 and end there, holding no story.

**Dropping rather than stopping is deliberate, and it is the right way round even though the group
collides.** The stories were grouped because building them *apart* is unsafe; building *fewer* of
them never is — the collision only ever argued against a second session touching those paths, and
dropping one means nobody does. Stopping the whole group instead would park two healthy stories
over one issue the owner moved on purpose.

**This cannot detect a double dispatch, and do not write it as though it can.** Under a genuine
double dispatch both children read `Development (AI)`, the status they expect, and both build.
What prevents that is the claim at `queue-run.md` STEP 5 being read back before anything builds;
this check catches only a change made by someone else afterwards.

**That claim is per issue, not a lock on the queue.** Other stories are legitimately in
`Development (AI)` at the same time; they are other sessions' and none of your business.

**Confirm your slot label is on each of them too.** If one carries the status but not the label,
add it — read the issue's existing labels and pass them plus yours, because `labels` on
`save_issue` **replaces the whole set** and a bare `["slot-1"]` strips `App`, `Database` and
everything the owner filters on. An unlabelled in-flight issue occupies no slot for the next
firing, so leaving it bare invites a second session over the same work.

### Then declare your territory, before you write any code

**One comment, on EVERY issue you hold — the same body on each — and it is the only thing the next
firing can see about what you are touching.** It replaces the scout pass that used to predict
this from outside: you know what you are about to edit, and a prediction made by an agent that
never built it was both the weaker answer and the most expensive part of a firing.

**On every issue rather than on the first, because the next firing reads whichever one it happens
to pick.** It has your slot label on two or three rows and calls `list_comments` on one of them; a
comment sitting only on the first is a coin flip, and a miss makes it treat your slot as touching
*everything* and dispatch nothing into the other slot for as long as you run. Writing it three
times is three cheap calls against a whole firing's batch.

```
<!-- territory -->
slot: 1
issues: PD-201, PD-207
paths: src/components/postcards/, src/lib/data/postcards.ts
migration: Y
primitive: N
```

- **`paths`** — the directories and files under `src/`, `supabase/`, `scripts/` or `design/` you
  expect to modify. **Predict generously**; a missed path is a collision in another session.
  `docs/HANDOFF.md` and `CLAUDE.md` are exempt — every session touches them, so naming them would
  hold the whole queue.
- **`migration`** — Y if you will add a file under `supabase/migrations/`.
- **`primitive`** — Y if you will add or change a shared component under `src/components/ui/` or
  `src/components/icons/`.

**Rewrite it — same shape, new comment — whenever it stops being true**: when you fold something in
at STEP 4b, and whenever you take another story at STEP 6. The next firing reads the most recent
one and nothing else.

**A missing territory comment does not stop the queue, it stops the OTHER slot.** A firing
treats a slot with no territory as touching everything, so forgetting this costs the next firing
its whole batch while looking like a healthy build.

### Is the premise still true? Answer it here, before building

**This was a scout's verdict in the dispatcher until 2026-08-18.** It moved because the session
reading the actual code is better placed to answer it than an agent predicting from the issue text,
and because those agents were the single most expensive thing in a firing.

**Stale means one of exactly three things, each with a command behind it:** the code now does what
the issue asks (**already done**); a later decision or migration makes it moot (**superseded**); or
the thing it describes does not exist, typically a count that moved or a file that was deleted
(**void premise**).

**None of these is staleness:** disagreeing with the approach, thinking the priority is wrong,
finding the story hard, finding it bigger than it looked, or noticing it is old. **Age is not
evidence** — `PD-129` sat five days with its premise entirely intact.

**The asymmetry sets the bar.** Building something already done costs one build and ends in a PR
that changes nothing: loud, cheap, self-correcting. Parking a live story costs the owner a round
trip and sits in `Needs decision` until they happen to look. **So the bar is evidence, or build
it.** An ambiguous check is a build.

**Stale, with the command and its output in hand** → do not build it and do not close it. Comment
with the command, its output and which of the three rows it falls under, move it to
**`Needs decision`**, strip your slot label from it, and drop it from your group. **Never
`Needs help`** — that stops the whole queue over work nobody is doing. If every story in your group
is stale, say so in a `PushNotification` and end the session — via STEP 7, like every other
exit.

---

## STEP 4 — Build it

Follow `CLAUDE.md` exactly. In particular:

- Branch off `development`, never `main`. Use the issue's `gitBranchName` if it has one — for a
  group, the first story's, since there is one branch for all of them.
- **Build the stories in the order they were listed** (`queue-run.md` STEP 5 orders a group by
  priority), finishing and committing each before starting the next. The order matters most for
  the collision that grouped them: the migration numbers and the shared component get written once,
  in a decided sequence, which is the whole reason these are in one session.
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
  Run `PGPASSWORD=postgres npm test` if anything under `supabase/**` changed. **Time each one as
  you run it** — `s=$(date +%s); <gate>; echo "$(( $(date +%s) - s ))s"` — because §The cost record
  needs the durations and a gate is not re-run to measure it.
- A migration that changes a policy must add an assertion.
- Update `docs/HANDOFF.md` as part of landing the work, not as a separate task.
- **If it turns out mid-build that this story needs something another unfinished issue is meant to
  deliver, STEP 2c applies now** — a session arriving from `queue-run.md` STEP 5 never passed
  through it, and this is the step where that discovery is made.

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

**Keep the commit range that is each story itself.** STEP 4c's scope pass needs them to tell each
story's own commits from the fold-ins' — and, in a group, from each other's. None of it can be
recovered from a combined diff, and a group is precisely where the combined diff stops being
readable, so note each range as you finish the story rather than reconstructing them at the end.

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

**Neither answer is available to a part of the story you were given.** This gate sorts things the
build *turned up*. The half of the picked issue you did not build is not one of them: it does not
"travel" (it was never optional) and it must not be "filed" (that is the deliverable being split
after the fact). It has one route, and it is STEP 5 bullet 4 — the issue does not move to
`Deployed to DEV`.

**The tell is that the item is named in the issue's own title or body.** Check that before rating
anything: a rating block on the unbuilt half makes a split look like triage, which is exactly how
it gets through. 2026-08-24, PD-279 — the story read *"country flag and town"*, the town shipped,
and the flag was written off as a comment saying it "wants its own row"; the owner asked why the
main feature was not in the main story. The excuse was that the flag needed an Edge Function
deploy, which is an owner step on **every** change under `supabase/functions/` and is not a reason
to cut a deliverable in half.

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
- **In a group, run this triage once per story, and then check the branch as a whole.** Every bound
  above is per story and stays that way — but they were sized against a branch carrying one story,
  and two stories each spending their full quota is a PR the single `reviewer` pass at STEP 4c has
  to cover in one read. **The group's own diff is the budget the fold-ins spend against**: if the
  extras across all stories together approach the size of the stories themselves, stop folding in
  and file the rest. `queue-run.md` STEP 4 already spent this budget once when it capped the
  group at three issues, and it had no way to see what a triage would add.

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

**On the exits that never reach a merged PR — STEP 2c, STEP 4c's three-attempt CI bound, and
§If you get stuck — the `Needs help` comment is the PR body's stand-in.** Both leave with a triage list and no PR to write it into, so
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

   Pass it with the rest of the scope material: **every issue being built** — all of them, for a
   group — **each with its `size`, which you state from what you actually built** (`S` a copy fix,
   a doc line, a single component · `M` the ordinary story · `L` a new route with its data layer, a
   migration plus the screens that read it, or more than ~10 files) — each fold-in with its
   one-line relatedness justification and its five ratings, and the commit ranges: each story's own
   commits versus its fold-ins'. Without those, `reviewer.md`'s scope pass cannot check the breadth
   cap at all, and is briefed to report that rather than guess the boundary from the diff.

   **`size` is on this list because the reviewer's ceiling check is otherwise unenforceable.**
   `reviewer.md` is briefed that a group holds at most one `size: L` — a bound a count alone cannot
   see, since two `L` stories are two issues and clear the count. **You are the one who can say it
   honestly**: the scout that used to guess it before the build was removed on 2026-08-18, and
   Linear carries it nowhere, so the diff in front of you is the only remaining source.

   **For a group, say so and say why, or the scope pass reads the branch as scope creep.** A
   diff carrying three unrelated-looking stories is exactly the shape that pass exists to catch,
   and it has no way to tell a dispatched group from a session that picked up extra work. Name the
   collision that grouped them — the shared paths, the two migrations, the shared component — and
   give the per-story ranges so it can check each against its own issue.

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
2. **Push the branch.** Then open **one** PR against **`development`**, with the `## Folded in`
   section from STEP 4b in the body, or nothing there if nothing travelled — and §The cost record's
   **one line**, which every PR a firing opens carries.

   **A group gets one PR naming every issue in it**, with a heading per story and a line saying
   which collision put them together — that sentence is the only place a reader of the merged
   history learns why these shipped as one change. Link every issue so each closes against a real
   PR; `Deployed to DEV` at STEP 5 asserts a merge, and three issues pointing at one PR is exactly
   what happened.

   **Push unconditionally, and never on the assumption that STEP 4 already did it.** STEP 4b
   commits after the build, so anything it folded in is unpushed here.
   `create_pull_request` succeeds against whatever was last pushed, so skipping this leaves a
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

   **A conflict with `development` is yours to resolve, and it is NOT `§If you get stuck`.**
   Other stories merge while you build, so this is the expected case rather than an exception —
   and the territory's path caps deliberately exempt `docs/HANDOFF.md` and `CLAUDE.md`, whose
   conflicts it calls "the cheap kind" precisely because this bullet resolves them. **Parking a
   built, green story into `Needs help` over a docs conflict stops the entire queue**, which is
   the worst available outcome and the one this paragraph exists to prevent.

   ```bash
   git fetch origin development --quiet
   git merge origin/development          # then resolve, re-run the gates, push
   ```

   Resolve it, re-run every gate afterwards — the merge brings in other people's code, so a green
   run from before it proves nothing — and push. **Regenerate lockfiles and generated files rather
   than hand-merging them.** Park only if the conflict is genuinely ambiguous: both sides changed
   the same logic and picking either loses behaviour. A counter, a list entry or a doc line where
   `development`'s version is simply newer is not ambiguous — take theirs and move on.

   **First confirm CI actually started, and never read its absence as "still queued".** Opening
   the PR through `mcp__github__create_pull_request` is a **GitHub App** action, and a workflow
   run is *not* created for the `opened` event — measured on PR #230, 2026-08-16: the head sha was
   pushed at 23:36:03, the PR opened at 23:36:59, and no run existed for that sha at all. The next
   `git push` fired a `synchronize` event and the run appeared within seconds.

   **The ordering that leaves you with no CI is the natural one** — push, then open the PR — and
   it fails in the worst way: no red check, just no check, which is indistinguishable from a PR
   that had nothing to run. Vercel still posts its own status, so the PR looks alive.

   ```
   mcp__github__pull_request_read  method=get_check_runs  pullNumber=<n>
   ```

   **`total_count: 0` a minute after the PR opens means push something, not wait** — an empty
   commit is enough (`git commit --allow-empty`), though there is usually a real commit still to
   make. **Never merge on `total_count: 0`**: `CLAUDE.md` requires that whatever runs must pass,
   and a check that never reported has not passed.

   **Driving CI to green is bounded: three attempts, then park.** An *attempt* is one push that
   intends to fix a red or absent check. After the third one has been read back and is still not
   green, stop: move the group to `Needs help` with the failing check named, the log excerpt, and
   what you tried. **Do not open a fourth**, do not re-run a job hoping for a different answer, and
   above all **do not arm a check-in to come back to it later**.

   **Park properly — this is a §If you get stuck exit and owes everything that exit owes**: the
   push notification (`Done ; ) <ids> parked, needs you — CI red on <check>`), the STEP 4b
   triage list filed before you stop because STEP 5 will not run to file it, and §The cost record's
   block in the `Needs help` comment — **three CI attempts is the expensive way to reach this exit,
   so it is the one whose cost is most worth writing down**. A park with no push
   means the owner's first signal is the next firing's three-hour stall clock, with the whole queue
   stopped in the meantime.

   **One caveat worth naming, because it turns a bad day into a stopped queue:** *absent* counts as
   an attempt, so a workflow whose `on:` list no longer names this base branch reports nothing at
   all and parks every story that reaches it. If the third attempt is still `total_count: 0` rather
   than red, say **that** in the comment — the fault is CI configuration, not the story.

   **This bound exists because the alternative was measured.** On 2026-08-18 a session watching one
   PR re-armed an hourly `send_later` eighteen times across twenty hours — 84.5M cache-read tokens,
   343k output, nothing built after the first hour, and its issue holding a slot the whole time.
   A session that cannot get CI green in three tries has found something the owner needs to see,
   and every wake after that spends real money to say so more slowly. `Needs help` says it once.

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
it as governing here. That section is explicitly the **attended** mode, and a dispatched build is
never in it whether or not the owner is at their keyboard — nothing routes their questions here;
the rest of it — reply at once, keep answering — is wrong unattended, and you have nobody to reply
to. The argument above stands on
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
  early releases the per-issue claim, so a later firing could take this same story into a second
  session while you are still holding it. **Come back to this check before merging**;
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
next firing's stall alarm then has to catch hours later. Set too tight, it is the inverse: a re-run
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
4. **Re-read each issue's own title and body, and move it to `Deployed to DEV` only if the thing
   it names now exists** — except any story parked into `Needs help`, which stays parked. A story
   whose scope you delivered in part **stays open**: comment what shipped, say what remains and
   why, and leave it in a column the owner can see. Do not file the remainder as a new row and do
   not leave it in a comment on a closed issue — both read as "handled" on a board, which is the
   whole failure.

   **Read the title last and take it literally.** It is the shortest statement of the deliverable
   and the thing the owner scans; `Deployed to DEV` on a title naming something that does not exist
   is the board lying in the one place nobody re-checks. `docs/reference/linear.md` §Sequencing has
   why these are one issue rather than two.

   Then, on each issue that does move — its own comment: the PR link,
   one line on what landed **for that story**, what was folded into it, a link to each story filed
   **or updated**, and the deploy state from bullet 3. One shared comment pasted three times is
   worse than none — the owner reads an issue to find out what happened to *it*.

   **Then §The cost record's block, on the FIRST issue of the group only**, with the other issues'
   comments carrying its one-line summary and a pointer. It is a fact about the firing rather than
   about a story, so it is the one thing here that is deliberately not written per issue.
5. **Send one push notification** for the whole group with the `PushNotification` tool:
   `Done ; ) <issue ids> <short title>`. One session, one notification — three pushes for one
   merge is exactly the volume `CLAUDE.md` refuses, and they would all say the same thing. This is
   the only thing you send that reaches the owner directly.

   **Name only the issues that actually merged, and say if one is parked** — `Done ; ) PD-201
   merged · PD-207 parked, needs you`. This line is read on a phone hours later with nothing else
   open, so it is the worst of the three places to claim a story shipped when it did not: bullet 4
   has its carve-out for exactly that reason and this bullet needs the same one.
6. **Report to nobody.** Product owner, 2026-08-18: *"when the
   development ends, I dont want those new sessions to report back to the routine. It will just
   pick up new stories on the next hourly run."* So there is **no `fire_trigger`, no poke, and no
   message to any other session** — not on a merge, not on a park into `Needs help`, not on a
   failure. The board carries the outcome, and the next hourly firing reads the board.

   **This is the whole of your reporting duty and it is deliberately smaller than it looks.** The
   issue comments (bullet 4), the push notification (bullet 5) and the merged PR are the record.
   A queue that also messages itself has two records of the same fact, and the second one is the
   one that goes stale.

   **Then go to STEP 6 — unless you already ran it between bullets 3 and 4, which is where it
   belongs and where it sends you back here.** It decides whether you take another story or end,
   and when it ends it hands off to STEP 7, which decides whether this session is archived or left
   for the owner to read. **Never run it twice**: a second pass over a board that no longer holds
   the story you just claimed will claim a *different* one into the same slot, which is the
   "never take a second one while the first is still open" rule broken by bookkeeping.

   **When STEP 6 ends the run, those two steps are the only things that follow this bullet and
   neither sends anything to anyone. When it took another story, what follows this bullet is
   STEP 3 for that story** — STEP 6's tail says so, and this is the only place that says it
   forwards. Ending here instead strands the story you just claimed in `Development (AI)` wearing
   your slot label with nobody building it, which no firing can tell from a live build.

   **What a freed slot costs when you do end: it waits for the top of the hour.** Finish at 10:05
   and the next story starts at 11:00, not at 10:06 — unless STEP 6's gates let you take it
   yourself, which is exactly the case that cost is worth avoiding. It buys a queue with one clock:
   nothing to double-fire, and at most one firing an hour, so no two ever overlap. **Pausing the Routine still cannot stop a session already building**, yours included.

   **The Claude Code Remote tools you need are two, and neither is a messaging one — which is the
   point of this paragraph, rather than the count.** STEP 6 reads your own token spend through
   `get_session` (with `session_id` omitted) to decide whether to take another story, and STEP 7
   ends the run with `archive_session` on the id that same call returns. Both act on *this*
   session and nothing else. That is the whole of it: **no `fire_trigger`, no `send_later`, no
   `create_session`, no message to any session.** Reaching for one of those is a design change
   rather than a convenience — say so instead.

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

## STEP 6 — Take another story, or end

**Only after the merge and STEP 5's deploy check** — a session in the middle of a build has nothing
to decide here.

**Claim before you release, and this ordering is not cosmetic.** Run both gates — and, if they
pass, the collision check and the claim write — **between STEP 5's bullet 3 and bullet 4**, so your
slot label never leaves `Development (AI)`.

**Then go back and finish STEP 5 for the group you just merged — bullets 4, 5 AND 6 — before you
start anything new.** Not bullet 4 alone: bullet 5 is the push notification and bullet 6 carries
§The cost record's pointer, and a session that jumps straight from a claim into the next story
leaves the finished group with no notification and no record, which is the same loss the
fail-closed exit above is written to prevent. **This step is an interruption of STEP 5, not a
replacement for its tail.**

**What the natural order costs:** bullet 4 moves every issue you hold out of `Development (AI)`,
which takes your slot label with them, and the next firing counts that slot **free**. An hourly
firing landing in the seconds or minutes it then takes you to read the board, check a collision and
claim will dispatch a fresh session into *your* slot. Two live sessions wear one label, three
builds run against a cap of two, and the next firing reads whichever of the two territories it
happens to land on. **The slot is yours until you have either re-filled it or given it up.**

**Two gates, both hard, and you check them in this order. Either one failing ends the session.**

1. **Stories built this session, including folds-in: fewer than 3.**
2. **Your own output tokens: under 400k.** Read them off your own session — `get_session` with
   `session_id` omitted describes the caller:

   ```
   mcp__Claude_Code_Remote__get_session          # external_metadata.usage.output_tokens
   ```

   **Take that read before STEP 5's bullet 4 writes its comment, on every path — not only the
   path that takes another story.** STEP 6 runs either way, so the call is made either way; the
   only thing at stake is whether its answer arrives in time for §The cost record's two token rows,
   and taking it a few bullets early costs nothing and adds no call. A read taken after the comment
   is written is a row that says `not available` on a session that could have answered.

   **That early read CACHES the answer; it does not move the EXIT.** **The fail-closed exit never
   skips STEP 5's bullets 4, 5 and 6** — the record and the notification are written first,
   whichever way the gate goes, and only then does the session end via STEP 7.

   **Evaluate both gates between bullets 3 and 4, always** — the top of this step requires it
   unconditionally, and there is never a reason to do it later: gate 1 is
   self-knowledge needing no call, and gate 2's input is in hand from the read above. Deferring
   past bullet 4 cannot be chosen anyway, because which path you are on is not knowable until the
   gates have answered — and if they then pass, bullet 4 has already moved your issues out of
   `Development (AI)` and taken your slot label with them, which is the race lines above call *not
   cosmetic*.

   **Reading it as "the early read also decides early" ends the run before those bullets**, so the
   cost record is never written, no notification is sent, and this step's own *"STEP 5 already sent
   the notification and wrote the record"* becomes false. That is not a corner case: a
   Routine-minted firing does not hold `get_session` at all (PD-241's inventory), so the
   fail-closed branch is the *ordinary* path, and deciding on it early would silently strip the
   record off every firing the queue runs.

   **If that tool will not answer, end the session (via STEP 7) — this one fails CLOSED.** An
   `InputValidationError` is a deferred schema, so `ToolSearch` (`+get_session claude code
   remote`) and call it again; `No such tool available` after a keyword search means the connector
   is not on this session at all. **A budget you cannot read is not a budget you have cleared**,
   and the cost of failing closed here is one story waiting an hour — against a session with no
   bound at all on how much it spends taking more work.

**Where 400k comes from, so it can be re-derived rather than trusted.** Ten single-story children
measured 2026-08-17/18 spent between 9.8k and 377k output tokens each, most of them 120k–310k. So
one story is usually 150k–300k, and a 400k floor admits a second story exactly when the first was
cheap — a copy fix, a doc line, a migration with no screens. That is the case where a warm session
is worth reusing; a session that has already spent 300k is one that should hand the next story to a
fresh window. Those figures come from `list_sessions`, which is **not** yours to call — it is the
~140k read the 2026-08-18 rebuild took out of the hourly path, so moving this number is an
owner-directed session's job rather than a firing's.

**There is no way to clear a session's context from inside one** — `/clear` is interactive and no
tool exposes it, and the harness's own compaction is lossy summarisation you cannot trigger. **So
ending the session IS the clear**, and these two numbers are what decide when to spend one.

**If either gate fails, end the session — at STEP 7, not here.** Say nothing to anyone: STEP 5
sent the notification and wrote the record — after bullets 4, 5 and 6, which this exit never
skips — the leftover stories are still in `Queued (AI)`, and the next
hourly firing will dispatch them into a fresh window.

### If both gates pass, take the next story

**Everything below runs only in a session that holds `get_session`, which today means a
hand-spawned one.** The gate above fails closed and a Routine-minted firing does not hold the
connector at all (PD-241's inventory), so on every firing the queue actually runs this half is
unreachable and the run ends after one group. It is kept whole rather than trimmed because the
thing that makes it live again is a connector attachment rather than a code change — PD-241 is
where that would be recorded.

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  state=<Queued (AI)>
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  state=<Needs help>
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  state=<Development (AI)>
```

Take the highest-priority candidate (Urgent → High → Medium → Low → No priority, ties by oldest
`createdAt`) that clears **all** of these:

- **`Needs help` is empty.** A parked story stops the whole queue, and that applies to you exactly
  as it applies to `queue-run.md` STEP 1. Any row → end the session, via STEP 7.
- **It does not collide with the OTHER slot's territory.** Read that slot's `<!-- territory -->`
  comment the way `queue-run.md` STEP 2 does, and apply the same three caps: overlapping paths,
  both adding a migration, both touching a shared primitive. **You are the one session that cannot
  see the other's branch, so treat an uncertain overlap as a collision** — `queue-run.md` STEP 4
  groups on uncertainty because it can put both in one session, and you cannot.
- **It is not an epic** — a candidate with sub-issues is a container, not work.
- **It is not blocked** — `get_issue includeRelations=true`, any `blockedBy` outside
  `Deployed to DEV`, `Done (in production)`, `Canceled` or `Duplicate` disqualifies it.
- **Its premise is intact**, by the bar at STEP 3. You are about to build it, so the check is the
  same one and it happens now, not after the branch exists.

**Nothing qualifies → end the session, via STEP 7.** Leaving a story for the next firing is the ordinary
outcome, not a failure.

**Claiming it is one write and it must carry your label:**

```
mcp__Linear__save_issue  id=<issue>  state=<Development (AI)>  labels=[<its existing labels>, "slot-N"]
```

**Read the write back, and check it for a second claimer as well as for your own fields.** A
firing may be claiming on the same column right now — nothing serialises the two of you. So
confirm all three:

- the status is `Development (AI)`,
- **your** slot label is on it,
- and the *other* slot's label is **not**.

**Any of those wrong → release it back to `Queued (AI)`, strip your label, and end the session, via STEP 7.**
Losing a race costs one story an hour; winning one you should have lost costs two sessions building
one story on two branches, which nothing downstream can see — `queue-pickup.md` STEP 3 says plainly
that both children read the status they expect.

**Finish STEP 5's bullets 4, 5 and 6 for the merged group first** — see the top of this step. Only
then start the new story, clean, at STEP 3:

- **A new branch off the freshly-pulled `development`**, never a second commit on the merged one:
  `git checkout -B claude/<slug> origin/development`. Your previous PR is merged; stacking on it
  puts already-shipped commits into the next diff and makes `reviewer` read a branch that is not
  what it will merge.
- **Rewrite your `<!-- territory -->` comment** on the new issue, naming what this story touches
  rather than what the last one did. A stale territory is worse than none — the next firing
  trusts the newest comment.
- **One story, one branch, one PR, one `reviewer` pass, one push notification.** Nothing about the
  second story is shared with the first except the session.

**This is the one place a session picks its own work, and it stays inside one slot.** You never
spawn a session, never take a story into a slot that is not yours, and never take a second one
while the first is still open. `queue-run.md` §The board is the lock is what those rules
protect.

---

## STEP 7 — Archive yourself, or leave the session for the owner to read

**Every exit in this file arrives here, and this is the only place a run actually ends.** A park, a
stale premise, a budget gate, a clean merge — all of them. That is deliberate: the decision below
is about what the session *holds*, not about how it got here, so routing only the happy path would
have left every other exit deciding it by omission.

**Standing instruction, product owner 2026-08-28:** *"whenever an automatic build session closes a
bundle of stories, if there are no any further actions feel free to close the session and archive
it straight away. Only if there are relevant things I should read, questions, or anything needing
my attention please keep the session, so I can read it when I back."*

**The test is not "did it go well", it is "is anything here that is NOT already on the record".**
A firing writes to three durable places — the Linear comment, the merged PR, and the push
notification — and every one of them outlives this container. A transcript is worth keeping only
when it holds something those three could not: a question, a judgement call the owner has to make,
a thing you could not verify. **An ordinary green run holds nothing of the kind.**

**Archive when ALL of these are true:**

- you held at least one story, and every one of them is merged and sitting in `Deployed to DEV`;
- nothing of yours is in `Needs help` or `Needs decision`, and no story of yours was delivered only
  in part and left open;
- no PR you opened is still open;
- STEP 5's comment and push notification are both sent.

**Otherwise keep the session.** These are the cases that put something here the record cannot
carry, and the list is illustrative rather than a second test — the four conditions above are the
test, and anything failing one of them stays:

- **a story parked** into `Needs help`, or moved to `Needs decision` on a stale premise;
- **a story delivered in part** and left open at STEP 5 bullet 4. This is the one the owner most
  needs to read, because the board shows an open issue and only the transcript says what shipped;
- **a PR left open**, for any reason, including the three-attempt CI bound at STEP 4c;
- **a blocked capability** — a credential, a quota, a network policy, a dashboard toggle;
- **a question only the owner can answer**, or an option set you put to them;
- **anything inferred rather than measured** that they now have to weigh.

**Archiving is the LAST action of the run, after every write.** It ends the session, so anything
not already in Linear, the PR or the push is lost with it — including a report you were about to
give. Write first, archive second, and never the other way round.

**§The cost record is one of those writes, and it is the one this step can silently eat.** Every
figure in it lives in this transcript and nowhere else — the STEP 0 stamp, each subagent's
completion notification, each gate's `date` — so archiving before writing it destroys the only
copy. Confirm it is on the board before this step runs.

**Its two token rows are filled from STEP 6's budget read, not from this step's call.** That read
is taken before STEP 5's bullet 4 on every path (STEP 6 says so), so `external_metadata.usage` is
in hand before the comment is written and nothing here adds a call to get it. A session that does
not hold the tool wrote `not available` in those rows and nothing changes here.

```
mcp__<connector>__get_session                      # session_id omitted -> describes the caller
mcp__<connector>__archive_session  session_id=<the id that call returned>
```

**Pass the id `get_session` just returned and no other**, which is the whole of the safety story
here: the only session this step can reach is the one running it. There is no other session to
reach — the hourly Routine mints a fresh one per firing and is bound to none — so there is no id
comparison to make.

**Do not reach for `list_triggers` to check that.** A Routine-minted session does not hold it, and
it would answer a question that cannot arise.

**If either call will not answer, end the session WITHOUT archiving, and say so.** This one fails
**open**, which is the opposite of STEP 6's budget gate and for a reason worth stating: keeping a
session costs the owner one row in a list, and the harm this file guards against is losing a
transcript that had something in it. Tell the two failures apart the way STEP 0 does —
`InputValidationError` is a deferred schema, so `ToolSearch` by keyword and call it again;
`No such tool available` after a keyword search means the connector is not on this session.
**A permission prompt is the third case and it looks like neither**: the auto-mode classifier can
decline a session-management call, so an unattended firing can be stopped by an approval request
here. Treat all three the same — keep the session, and end.

**This changes no lock and reports to nobody.** Your slot label left `Development (AI)` at STEP 5
bullet 4, so the slot was already free before this step ran; and archiving is not a message, so
STEP 5 bullet 6 stands — the next hourly firing still reads the board and nothing else.

---

## If you get stuck — this is expected and it is not a failure

Move the issue to **`Needs help`**, comment with *exactly* what you need from the owner, and
stop — at STEP 7, which keeps this session for them to read. Leave the branch and any PR open and say so in the comment.

### In a group, park the story — not the group

**One story stalling must not hold its siblings' finished work hostage.** This is the cost
grouping adds and the only one that bites, so it gets an explicit remedy rather than a judgement
call:

- **The stalled story has nothing committed yet** → drop it. Finish, review and merge the rest of
  the group as an ordinary run, with the PR body and STEP 5's comments saying which story was left
  out and why. The queue still parks — `Needs help` is the lock — but it parks with two stories
  merged instead of two stories stranded.

  **Move the stalled issue to `Needs help` BEFORE STEP 5 bullet 4, not after the run.** The next
  firing reads the board as it stands, and it can arrive minutes after your last write: park
  afterwards and it sees nothing in `Needs help`, so the queue-wide lock does not hold and it
  dispatches into every free slot — burying the story that needs the owner under the merged PRs,
  which is the exact harm the lock exists to prevent. **The park is the only signal the queue
  gets** — the push in bullet 5 goes to the owner, not to the queue — and since bullet 6 no
  longer pokes anything, a late park is not late by seconds, it is simply missing when the hour
  turns.

  **Bullet 4 rather than bullet 6, because bullet 4 is the earlier hazard.** It moves *every* issue
  in the group to `Deployed to DEV` with a comment claiming a merge — so a park deferred past it
  marks the story you never built as shipped, and then contradicts itself two bullets later.
- **Its commits are already on the branch and separable** → drop them (`git revert`, or reset and
  recommit the others) and take the branch above. **Re-run `reviewer` on what you actually intend
  to merge**, since the reviewed diff has changed.
- **Its commits are entangled with a sibling's** — the shared component, the migration the next
  story builds on — → **park the whole group**, naming every issue in the `Needs help` comment and
  saying plainly that they are one branch. This is the case grouping was for, and unpicking it is
  worth less than the owner's answer.

**Park exactly one issue where you can**, and say in its comment which siblings merged. Moving all
three to `Needs help` for one story's question buries two answered stories in a column the owner
reads as blocked.

**Parking owes a comparison table of the ways forward** — one row per option, columns scored 0–10,
a total, sorted by it descending. `docs/reference/linear.md` §What an issue body opens with carries
the format and why a total is right there and wrong in the five-rating block. It applies to every
parking exit in this file: here and STEP 2c. **"Tell me what you need" and "here are your
options, ranked" are different messages**, and only the second is one the owner can act on
without reconstructing the problem first.

**Write §The cost record into the `Needs help` comment too.** This is the exit it exists for: a
firing that spent an hour and parked is the run whose cost the owner most needs to see, and it is
the run least likely to volunteer it. Same block, heading saying `parked (Needs help)` and why,
every row it has — there is no PR body here, so the comment carries the whole of it.

**File any follow-up you already rated before you stop — every exit path owes that, not just
STEP 5's.** STEP 4b decides where each one goes but deliberately creates nothing, so this path,
STEP 2c and STEP 4c's three-attempt CI bound are the three that leave with a triage list and no
STEP 5 to write it out. **Put the
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
`Needs help` is the one status a firing refuses to build past, precisely so a story
needing the owner does not get buried under the next batch of merged PRs.

**Leave the branch and any PR open, and say so in the comment.** Nothing else will pick this up:
your session ends here — at STEP 7, which keeps it — and the next dispatch will not touch a story
it can see is parked. **Send
nothing to the queue** — STEP 5 bullet 6 applies to a park exactly as it applies to a merge, and
the `Needs help` status is what the next hourly firing reads.

**Then send the push, because a park is the one exit where nothing else will.** `Done ; ) <issue
id> parked, needs you — <one line why>`. Parking freezes the whole queue and the next firing's
`Needs help` clock does not alarm until the story is over three hours old, so without this the
owner's first signal is three to four hours after everything stopped. **This is not the poke coming
back**: it goes to the owner, not to the queue, and it is the same `PushNotification` STEP 5 bullet
5 sends on the merge path — a path this exit never reaches.

---

## The cost record — where this firing's time and tokens went

**Standing instruction, product owner 2026-09-03** (PD-387): *"upgrading our routine, so that
sessions can keep track of the time they spent in developing, testing, using tools, etc."*

**Who owes one: any firing that CLAIMED a story, whichever way it then ended** — a merged group
(STEP 5 bullet 4), a park into `Needs help` (§If you get stuck, STEP 2c, STEP 4c's three-attempt
CI bound), a stale premise moved to `Needs decision`, a group where nothing survived STEP 3.
**A breakdown that only appears on the runs that went well is an advertisement, not an
instrument**: the number worth having is the one nobody wants to write down, which is an hour
spent producing nothing. Where there is no PR body, the record goes in the same comment that exit
already writes — no extra call.

An **idle** firing owes nothing: it writes no comment, its cost is uniform, and `queue-run.md`
§Why this shape already carries the measured ~$1 per idle firing.

### It must not become a reason to run longer

**Measuring a run is not permission to extend it.** Every figure below is either handed to you
already or is one `date` beside a command you were going to run anyway. **Nothing here authorises
an extra tool call, an extra gate run, a re-run to get a cleaner number, or a minute spent
reconstructing one.** A figure you did not capture at the time is written `not captured` — never
re-derived and never estimated to fill a row, because a row filled by guesswork is exactly the
thing §Measured, and self-reported exists to prevent.

The bounds that stop a run are unchanged by this section and are not negotiable against a better
record: STEP 4c's three CI attempts, STEP 6's two gates, and `CLAUDE.md`'s three-attempt PR bound.

### Measured, and self-reported — the line that must never blur

**Every row is labelled, because the failure mode is somebody tuning the queue on a narrated
figure believing it was counted.**

| Row | Where it comes from | Kind |
|---|---|---|
| Wall clock | `date -u` at `queue-run.md` STEP 0, and again at wrap-up. **From probe 3 onward** — the stamp shares probe 3's call, so session boot, `CLAUDE.md` loading and probes 1–2 are all before it. The figure under-reports the firing by that much and must not be read as "firing to wrap-up" | **Measured** |
| Per subagent — duration, tokens, tool calls | each agent's own completion notification | **Measured** |
| Gate durations | `date` either side of a command you already run | **Measured** |
| This session's output and cache-read tokens | `get_session`, `session_id` omitted | **Measured**, when the tool answers |
| Phase split | your own account of yourself | **SELF-REPORTED** |

**A Routine-minted firing does not hold `get_session`, so its token rows read `not available`, and
that is the expected shape rather than a fault.** PD-387's body lists that call among the numbers
"already in front of every session"; PD-241's measured inventory says no `mcp__Claude_Code_Remote__*`
tool exists in such a session at all. The inventory is the measurement and it wins. A hand-spawned
session holds the call and fills the rows in.

**There is no clock in the loop attributing wall time to activities**, so the phase split is
narration and is marked as such in the block itself — not merely here, because the block is what
gets read.

```bash
date -u +%FT%TZ                                    # at wrap-up, against STEP 0's stamp
s=$(date +%s); npm run test:unit; echo "test:unit $(( $(date +%s) - s ))s"
```

### The block, and where each half goes

**The full block goes in ONE Linear comment; the PR body gets one line.** A cost record is a fact
about the *firing*, not about a story, so pasting it onto all three issues in a group is the
duplication STEP 5 bullet 4 already refuses. Put it on the **first issue of the group** and give
the others the one-line summary plus a pointer to it.

**On a mixed exit — one story merged, another parked — it goes on the first issue that has a
comment being written at all**, and the other issues' comments carry the pointer. Otherwise the
rule collides with itself: STEP 5 bullet 4 writes only on issues that *move*, a parked issue does
not move, and a group whose first issue is the parked one would have two homes for a block there
is only ever one of.

Both shapes below use this file's standing example ids, `PD-201` and `PD-207` — **the figures are
illustrative and none of them is a default.** A row you cannot fill says `not captured`.

The PR body's line, under the `## Folded in` section or on its own where nothing travelled:

```
**Cost** 1h 23m wall · 1 subagent (6m, 84k tok, 41 calls) · gates 2m 54s · session tokens not
available · phase split self-reported — full record on PD-201.
```

The comment's block, opened with an HTML marker so a later firing can find it:

```markdown
<!-- cost -->
**Cost — PD-201 + PD-207, slot-1 · merged (#391)**

| Measured | |
|---|---|
| Wall clock | 21:42Z → 23:05Z, **1h 23m** |
| Session output tokens | not available — no `get_session` on this session |
| Session cache-read tokens | not available — same |

| Subagent | Duration | Tokens | Tool calls |
|---|---|---|---|
| `reviewer` | 6m 12s | 84k | 41 |
| **total (1)** | **6m 12s** | **84k** | **41** |

| Gate | Duration |
|---|---|
| `npm run test:unit` | 48s |
| `npm run build` | 2m 06s |
| `PGPASSWORD=postgres npm test` | not run — nothing under `supabase/` changed |

**Phases — SELF-REPORTED.** No clock attributes wall time to activities; this is the session's own
account of itself, and tuning the queue on it as though it were counted is the one thing it must
not be used for.

| Phase | Approx |
|---|---|
| Board, claim, territory | ~5m |
| Build | ~50m |
| Gates | ~10m |
| Review | ~10m |
| Wrap-up | ~8m |
```

**A session the owner started by hand takes its own stamp at its own STEP 0**, since
`queue-run.md` never ran for it — that is the session most likely to reach a second story and the
only one that can fill the token rows, so it is the worst one to have no clock. A run that took no
stamp writes `not captured` and does not reconstruct one.

**A second story taken at STEP 6 gets its own block on its own group**, with the wall clock read
from the same stamp — so the second block's figure is cumulative for the firing rather than a
measure of that story alone, and it says so. One block per group; never one block re-pasted, and
never a second group left with none.

**Name the three largest subagents individually and sum the rest** when a run spawned more than
three — the total is what bounds the firing and the three largest are what explain it.

**A parked run's block says so in its heading** — `parked (Needs help)`, `stale premise`, `CI red
after 3 attempts` — and fills every row it has. A short row set on a run that died early is the
honest answer and is more informative than a full one on a run that went fine.

**Where the numbers should ultimately surface, and what figure should stop a run, is deliberately
not decided here** — that is PD-388, and it is the owner's. This section ships the measurement with
the cheapest honest destination so it exists to be decided about.

---

## Scope discipline

**The stories in front of you are the scope** — the ones your prompt names, and nothing else — and
*a scheduled session is the worst possible place for scope creep*. **A group does not widen this
rule; it is `queue-run.md` STEP 4 having already decided the scope is two or three stories.** Picking up a
fourth because it touches the same files is the same overreach as picking one up when you were
given one. The rule has two halves, and **STEP 4b is where they are applied**:

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
it came from that.** A session spawned *by a Routine* gets its connectors from the trigger, so the
first design bound the Routine to a session that already held them — the shared `### Development
###` session — and paid for it with context that accumulated across firings and could never be
cleared. The second design (2026-08-18 to 2026-09-02) fired into a *relay* that was meant to spawn
a fresh dispatcher, which spawned fresh children running this file; it never ran, because a session
the Routine mints for itself holds no session-management tools, so the relay could not spawn
anything. `queue-run.md` §Why this shape has the measurements.

**Since 2026-09-02 the Routine fires a fresh session with the repo and its connectors attached,
and that session picks and builds itself.** It retires four costs at once, and a fifth the relay
design added:

| Cost of the reused session | How it is gone |
|---|---|
| The session was not idle by construction — a firing could land mid-conversation with the owner | Nothing else runs in here. The idle gates are deleted, not moved |
| Context accumulated across firings, and no session can `/clear` itself | This window starts empty and is discarded after one group |
| The build had to run in a subagent purely to stand in for that clear | STEP 4 — build in your own thread; only specialists and `reviewer` are delegated now |
| One story at a time, because one session could only build one thing | The claim is per issue; other stories build in parallel firings, and colliding ones build together in this one |
| A procedure edit never reached the persistent session that executed it | Every firing clones `development` fresh; a merged edit is live at the next hour |

**What holds the concurrency now is two Linear labels and the territory comment you write at
STEP 3.** `Needs help` is unchanged: any story parked there stops every firing, including the
second story you might take at STEP 6.

**Two things about this session are worth knowing before STEP 6 and STEP 7 — one measured, one
inferred and labelled as such:**

- **A Routine-minted session is not expected to hold the session-management tools** — no
  `get_session`, no `archive_session`, no `list_triggers`, no `create_session`. That is **inferred**
  from every relay's 40–80-token firings, not observed (`queue-run.md` §Why this shape has the
  table), and its STEP 0 inventory is what measures it. Either way STEP 6's budget gate fails
  closed (one group per firing, then end), and STEP 7 keeps the session, which costs nothing because
  trigger-run sessions are not in the owner's ordinary session list (measured 2026-09-02). A
  hand-spawned session holds all of them and both steps work as written.
- **A permission prompt has nobody to answer it.** The auto-mode classifier declined a
  pre-authorized Linear read on 2026-08-29 (PD-349) and two Routine writes on 2026-09-02. Nothing in
  this file can prevent it; what it does is keep every write on the record as it happens, so a
  stalled session loses nothing the board does not already show.
