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

### The queue is drained by a dispatcher, on one clock

**`trig_01WJkMVXGzUVGDcC1njNmaan`** fires into the **relay** session, whose only act is to spawn a
fresh **dispatcher** and exit; the dispatcher **hands each queued story — or each group of
colliding stories — to its own fresh session** rather than building anything itself. **The relay is
the one session in this design that is reused, and it decides nothing** — every board read and
every judgement belongs to a session an hour old at most (`queue-dispatch.md` STEP -1). **The procedure is
[`.claude/commands/queue-dispatch.md`](.claude/commands/queue-dispatch.md), and the child's is
[`.claude/commands/queue-pickup.md`](.claude/commands/queue-pickup.md); read them there.** The
trigger's prompt says little more than *read that file and follow it*, and the child's prompt —
written by `create_session`, not by a trigger — says the same plus the issue id. A prompt is
re-injected on every firing where a file is read once, and a file can be reviewed in a PR.

**Repointing that prompt is what activates a change to the procedure.** The dispatcher reads
whichever file the trigger names, so editing `queue-dispatch.md` does nothing until
`update_trigger` names it — and a trigger still pointing at `queue-pickup.md` makes the firing
read the *child* procedure, which opens by telling it the issue id is in its prompt when no id is
there.

**The hourly cron is the only clock, and nothing else may wake the queue.** Product owner,
2026-08-18: *"when the development ends, I dont want those new sessions to report back to the
routine. It will just pick up new stories on the next hourly run."* A child's last act used to be
`fire_trigger` on that same trigger, so the next batch started seconds after a slot freed;
`queue-pickup.md` STEP 5 bullet 6 now tells every child to send nothing at all. **A freed slot
waits for the top of the hour** — the accepted cost of one clock instead of two, and of an off
switch that stops every dispatch rather than only the heartbeat. It still does not stop a child
already building; that carve-out is below and is unchanged. **A parked story is the one thing a
child still reports**, by push notification straight to the owner, because the dispatcher's
`Needs help` clock does not alarm for three hours.

What has to be known outside those files:

- **Do not archive or abandon the relay session.** Archiving it stops the queue silently,
  with no error anywhere, and `update_trigger` has no `persistent_session_id` parameter — so
  recovery means a *third* trigger bound to a new session. **A Routine firing arriving in any other
  session is misrouted, not a work order**: check the session id before acting on one. What the
  relay itself spawns is disposable — a dispatcher tagged `queue-dispatch-run`, a child tagged
  `queue-dispatch` — and archiving either is fine.
- **Never delete `trig_01Gzy8eCiaXUUa1knvJnNpwy`** — the disabled fresh-session Routine, and the
  fallback. `create_trigger` refuses the `connectors` parameter for this organization, so its
  three hand-attached connectors (Supabase, Linear, Vercel) cannot be recreated from a session;
  `update_trigger enabled: true` restores it whole. **`…WJkMV` is cheap and `…Gzy8e` is
  irreplaceable** — keep the two straight in both directions. A disabled trigger's
  `list_triggers` row has **no `enabled` key at all** rather than `"enabled": false`, so read a
  disable back by checking the field is gone.
- **Connectors attach to a session, not to a trigger**, which is why the *relay* is a reused
  session and why no amount of procedure can make it otherwise. Switching that Routine to
  `create_new_session_on_fire` loses five things at once, none of which a session can restore: the
  repo (`session_context.sources`), the model, the effort level, the permission mode and the
  connectors. `create_trigger` still refuses `connectors` for this organization, re-measured
  2026-08-18.

  **A session spawned by another session is the exception, and it is what every other role runs
  on.** Probed 2026-08-16 and again 2026-08-18, itemised the second time: `permission_mode: auto`
  inherited, Linear, Supabase, Vercel, GitHub and the Claude Code Remote tools all callable, and a
  child spawning a grandchild of its own with its `tags` intact. That is a different path from a
  *trigger*-spawned session and carries none of its losses.
  `.claude/commands/queue-dispatch.md` §Why this shape has what remains unverifiable — whether the
  grants survive a container reclaim across an idle hour, which is observable only after the
  fact.
- **Hourly is a server minimum** — `create_trigger` rejects anything more frequent. The stored
  expression is `0 0-23 * * *` rather than `0 * * * *`, because an hourly cron at minute 0 is
  **rewritten server-side to the minute you submitted it**. **Any UI edit re-anchors it** (adding
  the repo silently rewrote it to `24 * * * *`), so re-read `cron_expression` after one. Read the
  response back on every write — a silently rewritten schedule looks exactly like a successful
  one. `next_run_at` carries a separate per-trigger constant offset that nothing can clear; it is
  not the schedule.
- **`Needs help` still parks the whole queue, deliberately.** The dispatcher builds a *batch*
  now, so the temptation to skip past a parked story and find workable ones is stronger than it
  was — and the reason not to is unchanged: it buries a story that needs the owner under three
  merged PRs. A batch is not a licence to route around a stop.
- **The batch is capped, and the caps are not style.** At most one *session* adding a migration
  and at most one touching a shared primitive may be in flight at once, and no two may expect to
  edit the same paths. `queue-dispatch.md` STEP 4 carries each cap with the silent failure it
  prevents — duplicate migration numbers, divergent implementations of one component, and a
  `reviewer` pass that reads a file the other branch is about to change.
- **Colliding stories are grouped into one session rather than deferred**, which is the same three
  caps read the other way round: each describes damage only two *different* sessions can do, and
  one session writing `060` then `061` has no ordering problem to have. A group is one branch, one
  PR and one `reviewer` pass, capped at three issues, and each issue is still claimed, commented
  and moved on its own. `queue-dispatch.md` STEP 4 has the partitioning and the ceiling.
- **Disabling the Routine stops the queue, and with the pokes gone it should do so on its own.**
  It is still enforced twice — the relay reads the trigger's `enabled` field before it spawns, and
  the dispatcher reads it again (`queue-dispatch.md` STEP -1 and STEP 1) — because a hand-typed
  `fire_trigger` is *accepted* against a disabled trigger rather than refused (measured
  2026-08-17), and because this Routine has been seen firing while disabled by something nothing
  in the repo can now account for. **It does not stop a child already building**: those are
  spawned rather than scheduled, so stopping them means archiving the sessions tagged
  `queue-dispatch` — plus any tagged `queue-dispatch-run`, a dispatcher that cleared the switch
  before it moved — and returning their issues to `Queued (AI)`.

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
dispatcher's scout pass checks `blockedBy` relations somebody wrote down. An owner action and a
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
- **A new owner action goes in Linear the moment it is found**, labelled `Owner only`.
- **A story's premise ages, and nothing marks it done except someone re-measuring.** Check it
  before building, not after — `.claude/commands/queue-dispatch.md` STEP 3 is the procedure, and
  it applies to a story picked up by hand just as much as to one a dispatch takes off the queue.
  **A stale story goes to `Needs decision` with the command and its output in a comment, never
  to `Needs help`** — that name is half the concurrency lock, so parking finished work there
  freezes the queue over nothing. **Only the owner cancels**; a session measures and reports.
