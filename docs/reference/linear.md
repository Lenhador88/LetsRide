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
- **`Development (AI)` and `Needs help` are the concurrency lock — two *names*, never "any
  `started` issue".** `Queued (AI)` and `Deployed to DEV` are typed `started` too, so the wider
  version is held by every queued and every shipped story: the queue freezes permanently while
  looking like a healthy job behind a busy column. Never park work in `Development (AI)` by hand
  — staged work belongs in `Todo AI`.
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

### The queue is drained by a scheduled Routine

**`trig_01WJkMVXGzUVGDcC1njNmaan`**, hourly, firing into **`session_01B2mxc642tG8vZ15wysQpqM` —
the Development session** — rather than spawning a fresh one. **The procedure is
[`.claude/commands/queue-pickup.md`](.claude/commands/queue-pickup.md); read it there.** The
trigger's prompt says little more than *read that file and follow it*, because a prompt is
re-injected on every firing where a file is read once, and a file can be reviewed in a PR.

What has to be known outside that file:

- **Do not archive or abandon the Development session.** Archiving it stops the queue silently,
  with no error anywhere, and `update_trigger` has no `persistent_session_id` parameter — so
  recovery means a *third* trigger bound to a new session. **A queue-pickup message arriving in
  any other session is misrouted, not a work order**: check the session id before acting on one.
- **Never delete `trig_01Gzy8eCiaXUUa1knvJnNpwy`** — the disabled fresh-session Routine, and the
  fallback. `create_trigger` refuses the `connectors` parameter for this organization, so its
  three hand-attached connectors (Supabase, Linear, Vercel) cannot be recreated from a session;
  `update_trigger enabled: true` restores it whole. **`…WJkMV` is cheap and `…Gzy8e` is
  irreplaceable** — keep the two straight in both directions. A disabled trigger's
  `list_triggers` row has **no `enabled` key at all** rather than `"enabled": false`, so read a
  disable back by checking the field is gone.
- **Connectors attach to a session, not to a trigger**, which is the whole reason for the reuse.
  Switching the Routine back to `create_new_session_on_fire` loses five things at once, none of
  which a session can restore: the repo (`session_context.sources`), the model, the effort level,
  the permission mode and the connectors.
- **Hourly is a server minimum** — `create_trigger` rejects anything more frequent. The stored
  expression is `0 0-23 * * *` rather than `0 * * * *`, because an hourly cron at minute 0 is
  **rewritten server-side to the minute you submitted it**. **Any UI edit re-anchors it** (adding
  the repo silently rewrote it to `24 * * * *`), so re-read `cron_expression` after one. Read the
  response back on every write — a silently rewritten schedule looks exactly like a successful
  one. `next_run_at` carries a separate per-trigger constant offset that nothing can clear; it is
  not the schedule.
- **Do not "improve" the guard into a queue drainer.** One story per firing, and `Needs help`
  parks the queue *deliberately* — skipping past it to find workable stories buries a story that
  needs the owner under three merged PRs.

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

### Keep it current, or it rots like the docs did

- **Moving an issue is part of doing the work, not paperwork after it.** `Development (AI)` when
  you start, `Deployed to DEV` when the PR merges, in the same session.
- **Verify before you write.** An issue asserting a stale fact is worse than no issue, because a
  tracker reads as current by construction.
- **A new owner action goes in Linear the moment it is found**, labelled `Owner only`.
