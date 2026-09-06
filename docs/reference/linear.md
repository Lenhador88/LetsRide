<!-- Moved out of CLAUDE.md so it is not auto-loaded into every session.
     CLAUDE.md keeps the heading as a signpost; this file is the content. -->

## The roadmap lives in Linear

Workspace **`lets-ride`**, team **Pedro & Dave (`PD`)**, project **Let's ride (AI)**. **Pass the
project id — `88f3f224-ecf0-46f0-a032-c86b7a12f81c`** — never the name: it contains a curly
apostrophe, and the straight-quote version silently fuzzy-matches the *deprecated* `Let's Ride`
project or drops the field entirely. `save_issue` returns a successful-looking payload either
way, so **read the field you set back off the response**.

**There is a second project called `Let's Ride` and it is deprecated** — 27 issues from 2024–2025
describing a Thunkable/Firebase build that no longer exists. Not a source of truth; no work is
planned there.

### Why this does not become the fifth planning system

> **Linear holds order, owner and status. The repo holds everything else, and Linear points at it.**

| Layer | Owns | Never holds |
|---|---|---|
| **Linear** | What is next, who can do it, what is blocked on what | Specs, negative cases, measured facts, commands |
| **`openspec/`** | The contract — every state and every negative case | Scheduling, priority, assignment |
| **`docs/HANDOFF.md`** | Current position, each claim beside the command that verifies it | The queue |

An issue body is a pointer and a reason. **A Linear issue that grows a specification is a bug** —
that belongs in a proposal, where `openspec/config.yaml`'s rules apply and a missing visibility
rule fails loudly rather than silently.

### The statuses — re-derive them, never type them from memory

The board's status names have changed twice without anything in the repo noticing, and a
`save_issue` naming a status that no longer exists comes back **looking successful with the field
silently dropped**. `.claude/commands/queue-pickup.md` §The status names carries the live table
and the two traps in its `Type` column; run this before the first status write of a session:

```
# via the Linear MCP: list_issue_statuses team=Pedro & Dave
```

Three rules that outlive any rename:

- **`Queued (AI)` is the only start signal.** Not priority, not the milestone, not a comment, not
  the `DEV` label, and **not `Todo AI`** — that name reads like permission and is not one. A
  session that picks its own work from another column has taken the one decision this board exists
  to give the owner.
- **`Development (AI)` is a per-issue claim; `Needs help` stops the whole queue.** They used to be
  one two-name lock, because one session built one story at a time. Now stories build in parallel
  sessions, so a `Development (AI)` row says *this story is taken* and nothing about the others,
  while a `Needs help` row still halts every dispatch — deliberately, so a story that needs the
  owner is not buried under three merged PRs.

  **Never widen either to "any `started` issue".** `Queued (AI)` and `Deployed to DEV` are typed
  `started` too, so that version is held by every queued and every shipped story: the queue
  freezes permanently while looking like a healthy job behind a busy column. Never park work in
  `Development (AI)` by hand — staged work belongs in `Todo AI`.
- **A session's unit of done is `Deployed to DEV`** — merged to `development`, green, live on DEV.
  That is where a *queue firing* ends, and a blocker counts as cleared there for the same reason.

  **But whoever promotes to `main` owns the status that says so — and when a session does the
  promotion, that is the session.** Product owner, 2026-08-10, after a session promoted three
  issues to production and left them on `Deployed to DEV` for them to finish: *"If you deployed to
  production, please update story statuses as well!! I don't have to tell you to do it."*

  So the rule is about **who did the deploy, not about what a session is allowed to write**.
  `Done (in production)` asserts riders have the feature; set it exactly when that is true and you
  are the one who made it true — promotion merged, production `READY` on that sha as a real
  rebuild. Verify rather than assume, because a promoted preview is not a deploy:

  ```
  # via the Vercel MCP: list_deployments -> state READY, target production, ref main, matching sha
  ```

  **The old rule was "no session ever sets it", and it inverted into a worse failure.** It was
  written when promotion was always the owner's manual step, so the status and the act had the
  same owner by construction. The day a session was asked to deploy, the rule stopped tracking
  reality and started producing a board that understated what had shipped — and it asked the owner
  to do bookkeeping for work they had already delegated. Leaving a promoted issue on
  `Deployed to DEV` is now the error.

Labels are the cross-cut: **`Owner only`** filters what no session can do; `App` / `Database` /
`Native shell` / `Design` / `Website` say where; `Chore` is the type `Bug`/`Feature`/`Improvement`
leaves out. Configuring statuses is an owner action — the MCP can list them and not write one.

### Sequencing — the queue order is not the order you dragged them in

**`Queued (AI)` is a set, not a list.** The Routine takes the highest priority and breaks ties by
**oldest `createdAt`**, which the board does not display and dragging does not change. Priority
means importance, not order: bending it into a sequence tells the owner an issue matters more than
it does, permanently.

> **Only queue what is buildable now.** `Queued (AI)` means *eligible today*, not *approved
> eventually* — so everything in it is order-independent by construction. Work that must wait
> waits in `Todo AI`, and the owner queues it when its blocker reaches `Deployed to DEV`.

- **Not everything you notice is a story.** Product owner, 2026-08-09: *"It seems we are creating
  too many stories. If it seems within the context of the build, and recommended, just do it."*
  So the first question about a finding is not which column it belongs in — it is whether the
  build in front of you can absorb it. In the context of what you are already building, and you
  would recommend it? **Build it.** The story was never the deliverable.

  One still earns its place when a session cannot do the work (`Owner only`), when it carries real
  domain rules and wants a proposal, or when it genuinely does not fit the open branch. Below that
  bar, **say it in the PR body and let it go** — filing costs the owner a row to read for ever,
  and a thought worth having twice will be had again by the session that trips over it.

  **Measure the board rather than sensing it**, because "too many" is invisible one issue at a
  time:

  ```
  list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  limit=250  fields=["status","createdAt"]
  ```

  **Open** is every status except `Done (in production)`, `Deployed to DEV`, `Canceled` and
  `Duplicate` — bucket on the *name*, since `Deployed to DEV` is typed `started` and a
  `statusType` split would score it as open. 2026-08-09: **51 open against 26 that ever reached
  DEV or production**, 16 of the 51 created that day. A board growing several times faster than
  it drains is an archive, not a queue. `.claude/commands/queue-pickup.md` STEP 4b is where a
  firing applies this.

- **One issue per deliverable — a thing that can be *delivered*, not a step toward one.** The
  unit is what somebody gets when it closes: *"rides show a map"*, *"the native shell builds"*.
  Provider choice, key procurement, terms review and the build are **one** story, not four.
  Split only when the halves ship **independently** — each mergeable on its own, in either
  order, neither leaving the other half-built. When a deliverable genuinely is too big, use
  **sub-issues of one parent** (`parentId` is both a `save_issue` parameter and a `list_issues`
  field). Siblings still have no order between them.

  Product owner, 2026-08-09: *"Unless it explicitly has substantial value to break into smaller
  stories, I would rather have stories with a more clear goal / value that can be delivered."*
  **The board drifted from this twice in the same way** — the map tile and the native shell each
  reached three issues — and the mechanism was always the same: a blocker *inside* a deliverable
  got filed as a *peer* of it. Filing is the moment to catch it, because a split is far cheaper
  to avoid than to undo.

  **It splits at CLOSING time too, and that half is easier to miss because the story was right.**
  A session builds the tractable part of a correct story, moves it to `Deployed to DEV`, and puts
  the rest in a comment or a new row. Every artifact then looks finished — green PR, closed issue,
  a follow-up filed — and the feature the owner asked for does not exist. Product owner,
  2026-08-24: *"New stories are created, but the main feature is not being developed in the main
  story we discussed about."*

  **So a story closes when the thing it names exists, not when the part you built does.** Re-read
  its title before the status write; the title is the deliverable in one line and the only part of
  the issue a board actually shows. Partly delivered means the issue **stays open** with a comment
  saying what shipped and what remains.

  **"The rest needs an owner action" is not a split.** PD-279 is the worked example — the story
  read *"country flag and town"*, the town shipped, and the flag was written off because it needed
  an Edge Function deploy. Deploying is an owner step on **every** change under
  `supabase/functions/`; if that justified a split, half this repo's stories would be two.
  `.claude/commands/queue-pickup.md` STEP 4b and STEP 5 bullet 4 are where a build session meets
  this.

- **A decision is never its own story.** When work stalls on a choice, write the choice into the
  story that needs it — what is being decided, the options, what each costs — and move **that**
  story to `Needs decision`. Do not open a second issue for the question. A decision issue cannot
  be delivered, so it closes with nothing shipped, and until it does it leaves the real story
  sitting in a build column looking ready while its answer lives somewhere else on the board.
  **An owner action inside a deliverable works the same way**: label the story `Owner only` and
  name the action in it, rather than splitting the story around the person who has to act.
- **When a split really is ordered, only the first part goes in `Queued (AI)`.**
- **`blockedBy` is readable, but only per issue** — `get_issue` with `includeRelations: true`
  returns `relations.blockedBy` / `.blocks` / `.relatedTo`; the flag is off by default, which is
  why this was once recorded as write-only. `list_issues` still cannot filter or return relations,
  so relations are a **backstop that catches a mistake**, never the mechanism that makes queuing
  blocked work safe. The column rule above is the mechanism.

### The queue is drained by one Routine, on one clock

**One owner-created Routine fires a FRESH session every hour with this repository and the Linear,
Supabase and Vercel connectors attached. That session reads
[`.claude/commands/queue-run.md`](.claude/commands/queue-run.md), takes at most one group of
queued stories into a free slot, and builds it itself with
[`.claude/commands/queue-pickup.md`](.claude/commands/queue-pickup.md) — one branch, one PR, one
`reviewer` pass, `Deployed to DEV` at the end.** Nothing persists between firings, nothing spawns a
session, and no session fires or messages another. The Routine's prompt says little more than
*read that file and follow it*, because a file is reviewed in a PR and a prompt is not — and
because every firing clones `development` fresh, **a merged edit to either file is live at the
next hour with nothing else to do.**

**Why this shape, measured 2026-09-02 (PD-241).** The previous design — the Routine fires into a
persistent *relay*, which spawns a fresh *dispatcher*, which spawns fresh *children* — needed the
fired session to call `create_session`. **Measured**: every relay since the 2026-08-18 rebind
answered its firing with 40–80 output tokens and spawned nothing, the only dispatchers that ever ran
were spawned by hand from the owner's session, and three "fixes" to the procedure in between could
not have changed that. **Inferred from it, still unconfirmed** (no session can read another's
transcript): a session the Routine mints for itself does not hold `create_session` — the
session-management tools are built-in tooling a session gets when a person or another session
starts it, not a connector anyone can attach. The new procedure's STEP 0 inventory measures it. It cost four silent outages in three weeks, about $1 per idle firing on a persistent
session, and every queued story being picked up by the owner opening a session by hand.
`queue-run.md` §Why this shape has the capability table this design is built on.

What has to be known outside those files:

- **The Routine is the owner's, in the Routines UI, and no session can create, fire, edit or
  delete one.** `create_trigger` with `connectors` was refused for this organization (2026-08-16,
  2026-08-18), and on 2026-09-02 the auto-mode classifier refused `create_trigger` and
  `fire_trigger` outright from an interactive session. What the Routine needs — fresh session per
  firing, this repository attached, the three connectors, hourly, push on completion, and the
  prompt — is listed in `queue-run.md` §Why this shape. **Reading** a Routine or a session is
  pre-authorized (`.claude/settings.json` `autoMode.allow`).
- **Every firing self-checks before it reads the board** — `queue-run.md` STEP 0: Linear,
  opening and merging a PR, and git push. A firing that has them builds; the first one that does also posts the
  full tool inventory on PD-241 for the record. One that lacks any of them posts what is missing
  and ends with `self-check failed — read PD-241`. The previous design assumed a tool it did not
  have; this one measures on every firing and needs nobody to flip anything.
- **The old Routine `trig_01WJkMVXGzUVGDcC1njNmaan` is retired, not repaired** — the owner disables
  it in the Routines UI. Its persistent relay session is then idle and can be archived from the UI.
  **The fresh-session fallback `trig_01Gzy8eCiaXUUa1knvJnNpwy` does not exist**: absent from
  `list_triggers` at `limit=100 include_completed=true` on 2026-08-16, 2026-08-18 and 2026-09-02
  (7, 27 and 30 rows respectively). The never-delete rule that used to sit in `CLAUDE.md` guarded a row that was already
  gone.
- **Hourly is a server minimum** — `create_trigger` rejects anything more frequent. An hourly cron
  at minute 0 is **rewritten server-side to the minute you submitted it**, and **any UI edit
  re-anchors it** (adding the repo once rewrote `0 0-23 * * *` to `24 * * * *`), so re-read
  `cron_expression` after one. `next_run_at` carries a separate per-trigger constant offset that
  nothing can clear; it is not the schedule.
- **`Needs help` still parks the whole queue, deliberately.** A parked story is waiting on the
  owner, and building past it buries it under the next merged PR. A firing that finds one takes
  nothing and says so.
- **Two labels are the concurrency cap, and the board is the whole lock.** `slot-1` and `slot-2`
  (created 2026-08-18) go on every issue a build session holds; a slot label present in
  `Development (AI)` means that session is live, so a firing counts free slots in the same call
  that reads the queue and never reads a session list — which a Routine-minted session cannot call
  anyway. **An issue moved into that column by hand carries no slot label and consumes no slot** —
  deliberate, so a hand-moved story cannot freeze the queue. **A firing takes ONE group into ONE
  free slot**; a second free slot is the next firing's.
- **Colliding stories are grouped into one session rather than deferred** — at most one migration
  and at most one shared-primitive change in flight across the two slots, and no two sessions
  expecting to edit the same paths. `queue-run.md` STEP 4 carries each cap with the silent failure
  it prevents, the partitioning and the ceiling (three issues, at most one `L`). A group is one
  branch, one PR and one `reviewer` pass, and each issue is still claimed, commented and moved on
  its own.
- **Disabling the Routine stops the queue, because the cron is the only thing that fires it. It
  does not stop a firing already building** — that session is a Routine-run session, and stopping
  it means the owner archiving it from the UI and returning its issues to `Queued (AI)`.
- **A parked story is the one thing a build still reports directly**, by push notification to the
  owner, because the queue's own stall clock does not alarm for three hours.

**What to check when the queue looks idle**, in this order, from an owner-directed session — a
firing cannot make these calls:

```
mcp__Claude_Code_Remote__list_triggers   # the queue Routine: next_run_at in the FUTURE = armed,
                                         # in the past = it has stopped firing (found twice, 08-14 and 08-18);
                                         # last_run.status + last_run.session_id = the last firing
mcp__Claude_Code_Remote__get_session  session_id=<last_run.session_id>
                                         # REQUIRES_ACTION = stalled on a permission prompt (PD-349); read pending_action
```

**Do not read a missing `enabled` key as a disable** — measured 2026-08-18, none of the account's
27 rows carried one, this Routine included, while it was firing. The key appears once explicitly
set and reports the flag, never whether anything is firing; `next_run_at` answers that. And **no
Routine field answers whether a firing DOES anything** — nine `SUCCEEDED` runs on 2026-08-28 and a
hundred more between 08-29 and 09-02 all spawned nothing. **The board does**: work in `Queued (AI)`
with a free slot, no `Needs help` row, and nothing new in `Development (AI)` across two hour
boundaries. Then open the last run's session and read its transcript, which the owner can and a
session cannot.

### Do not ask permission to touch Linear

Standing grant from the product owner, 2026-08-07, in their words: *"I dont want you to ask for
my permission to interact with linear"*. Reading, creating, updating, labelling and moving issues
between statuses are all pre-authorized, encoded in `.claude/settings.json` under both
`permissions.allow` and `permissions.autoMode.allow` — and note the dependency recorded in
§Working Principles: the `autoMode` half applies only while the session is in `AUTO`, which
`defaultMode` now pins.

**Closing an issue is included, and does not want a confirmation round.** Product owner,
2026-08-09: *"if you see these sort of situations, and you are sure about it feel free to wrap it
up/close it straight away, no need to confirm with me. Just add a short comment to the story or
so about it."* So when an issue is finished, superseded, or answered by something that already
landed, **close it and leave a comment saying which** — asking first costs a round trip to
confirm something already true.

Two things bound it. **"Sure" means measured, not inferred** — read the issue's own body before
closing it, because a satellite issue's status often lives in its parent and this has already
gone wrong once in the other direction, an owner action reported as outstanding that had been
answered in the parent hours earlier. And **`Done (in production)` follows the deploy rather than
the role** — set it when this session promoted the work to `main` and production is live on that
sha, and never as a guess about a promotion somebody else might have done. `Duplicate` (with
`duplicateOf`) closes a folded-in issue, `Canceled` closes one that should not be built, and both
are a session's to set.

The one thing this does **not** cover: deleting anything a human authored — an issue, a comment,
a document, or a label that is in use. Closing is reversible and leaves the record; deleting is
neither. Ask first.

### Creating an issue can be refused outright — the workspace is on Linear's free plan

**Measured 2026-09-03**: `save_issue` with no `id` answers `400 invalid_request — "You've
exceeded the free issue limit for this workspace. Please upgrade or contact sales@linear.app for
a free trial."` Reading, commenting and moving between statuses are unaffected; only *creation*
is. **There is no probe here on purpose** — the only caller that needs the answer is a session
about to file something, so attempt the create you already intended and read the `400`. A
standalone check would create a real issue on its success path, spending one of the slots the cap
is about, and deleting it is the one Linear operation a session may not do.

**What to do when it refuses, rather than dropping the finding.** Post the issue body as a
comment on an issue that stays **open and that the owner reads** — a standing `Todo Human` row —
opening with the refusal and the line *this wants its own row*. **Never on the story the session
is closing**, which is what "the nearest issue" resolves to at a wrap-up: that is §Sequencing's
closing-time split exactly, and a comment on a story moving to `Deployed to DEV` reads as handled
and is never opened again. `.claude/commands/queue-pickup.md` STEP 5 is where a firing meets
this, with the work already done.

Do **not** close or repurpose somebody else's issue to make room. Clearing the cap is the
owner's, and only one route is established: **upgrading**. Archiving closed rows might also do
it and is **untested** — nothing measured here says whether the limit counts live or lifetime
issues, so do not send the owner to archive the board on the strength of this line. Nor is the
count one call: `list_issues` caps at `limit=250` and answers `hasNextPage: true` today, and
every call in this file is project-scoped while the limit is workspace-wide.

### What an issue body opens with

Two owner requests, covering different moments — one is how *every* issue reads, the other is what
a **parked** issue owes. Neither has an automated gate and neither can have one: an issue body is
not a file, so nothing in CI or `docs:check` can see it. These hold because they are written down.

**Every issue a session creates or updates opens with the five-rating block.** Product owner,
PD-183: *"add the Recommended, rider value, complexity, etc. at the 'top' (whenever possible) of
the story. The same we use when listing choices. so there's a clear view on these values per
story."* Same five, same order, same format `CLAUDE.md` already specifies for a suggestion in
chat — including the **blank `>` line** between each score and its reason. That
separator is a paragraph break rather than a line break, and it is the half that silently renders
wrong in the owner's client without it.

It goes **above** the prose rather than under it, because the point is triage without opening
anything: a board is scanned far more often than any single issue is read.

**The fifth rating is `Ready` on an issue, and it is a different question rather than a renamed
one.** `This session` asks whether the session in front of it should pick this up *next*, which
means nothing on a row nobody is holding. `Ready` asks whether **any** session could start it
today — **Y**, or **N** plus the half-line of why not: an owner action, a recorded blocker, wants
a proposal.

**Recompute it; do not carry the value across.** For the most common way an issue gets created
here the two answers are *opposite*. `.claude/commands/queue-pickup.md` STEP 4b has a session
answer `This session` **N** precisely in order to file something — *"wants its own branch"*, *"an
owner action is filed whatever it rates"* — and STEP 5 then writes that item out as an issue. Most
of those are `Ready` **Y**: a session could start them today, they simply were not that branch's
work. Carrying the N across writes `Ready: N` onto nearly every follow-up this repo files, and the
backlog then reads as entirely unstartable.

Only the second of those three reasons has any automated backstop, and a weak one: the
firing checks `blockedBy` relations (`queue-run.md` STEP 3) somebody wrote down. An owner action and a
story wanting a proposal both sail straight through it.

**An issue parked in `Needs decision` or `Needs help` also owes a comparison table of the ways
forward.** Product owner, PD-182: *"give me a comparison table here in the linear story with your
best recommendations to move forward, with comparison columns scoring 0-10, also include a total
score order by it desc."*

One row per option, each column scored 0–10, **with a total, sorted by it descending** — the table
exists to be *chosen from*, and someone deciding between four options wants them pre-ordered.
Name the columns for whatever actually separates the options in *that* decision rather than
reusing a fixed set; a table whose columns do not discriminate is decoration with arithmetic on it.

**The total is right here and wrong in the block above, and that is not a contradiction.** They
are different artifacts answering different questions. The block rates **one** suggestion on five
deliberately uncorrelated axes, where summing destroys exactly the information the five exist to
carry — `CLAUDE.md` is explicit that a 1/10 complexity can be a 9/10 recommendation. The table
ranks **several** options against each other, where the total *is* the ranking. Do not add a total
to the block, and do not drop it from the table.

### Keep it current, or it rots like the docs did

- **Moving an issue is part of doing the work, not paperwork after it.** `Development (AI)` when
  you start, `Deployed to DEV` when the PR merges, in the same session.
- **Verify before you write.** An issue asserting a stale fact is worse than no issue, because a
  tracker reads as current by construction.
- **A new owner action goes in Linear the moment it is found**, labelled `Owner only` — unless
  creation is refused (§Creating an issue can be refused outright), in which case it goes in
  `docs/HANDOFF.md` under an **Owner action** heading, where the 2026-09-03 refusal itself is
  recorded. A comment carries no label and appears in no filter the owner uses.
- **A story's premise ages, and nothing marks it done except someone re-measuring.** Check it
  before building, not after — `.claude/commands/queue-pickup.md` STEP 3 is the procedure, and
  it applies to a story picked up by hand just as much as to one a dispatch takes off the queue.
  **A stale story goes to `Needs decision` with the command and its output in a comment, never
  to `Needs help`** — that name is half the concurrency lock, so parking finished work there
  freezes the queue over nothing. **Only the owner cancels**; a session measures and reports.
