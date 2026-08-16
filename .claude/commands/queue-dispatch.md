---
description: Hand each queued story to its own session — the dispatcher's procedure
---

# Queue dispatch

**This procedure picks work and hands it out. It never builds anything.** The build is
[`queue-pickup.md`](queue-pickup.md), which runs in a *different session* — one per story, spawned
here, each with its own container, its own branch and its own empty context window.

That split is the whole design. Read §Why this shape before changing any of it.

**The moment this session builds something it becomes the old Development session again** — context
accumulating across firings, one story at a time, and a `/clear` nobody can perform from inside.
Read the board, scout, spawn, exit. Nothing else.

Read `CLAUDE.md` fully before acting. Workspace `lets-ride`, team **Pedro & Dave** (`PD`), project
**Let's ride (AI)** (`88f3f224-ecf0-46f0-a032-c86b7a12f81c`). Note the curly apostrophe in that
name; pass the id, never the name.

---

## The two roles, and how to tell which you are

| | Dispatcher | Child |
|---|---|---|
| Started by | the hourly Routine, or a `fire_trigger` poke | `create_session` from the dispatcher |
| Reads | this file | [`queue-pickup.md`](queue-pickup.md) |
| Holds | the board, the caps, the batch | one issue id, given in its prompt |
| Ends at | children spawned | the issue at `Deployed to DEV` |
| Carries the tag | no | **`queue-dispatch`** |

**A child never dispatches.** One level, no chaining — a child that spawns a child has no view of
the caps below and cannot enforce them, so the batch guarantees quietly stop holding while
everything still looks healthy.

---

## STEP 0 — Can you see the board?

Load `list_issues` via `ToolSearch` and call it. **If the Linear tools are not available, STOP and
send a push notification saying the dispatcher cannot reach Linear.** Do not proceed on
assumptions and do not pick work from the repo instead. A job that silently does nothing looks
exactly like an empty queue.

**Search by keyword, never by the `mcp__Linear__*` name — that prefix is not stable.** Connector
ids rotated on 2026-08-08 and every literal name stopped resolving, silently, an absent tool being
no error:

```
ToolSearch  query="+list_issues linear"      # keyword, survives a rename
```

Everywhere below writes `mcp__<connector>__<tool>` for readability. **Read it as "the tool called
`<tool>` on that connector", whatever prefix it currently carries.** A `select:` lookup returning
no match means "search again by keyword", never "the connector is gone" — only a keyword search
coming back empty establishes that.

You need three connectors here: **Linear** (the board), **Claude Code Remote** (`list_sessions`,
`create_session`), and nothing else. The dispatcher does not touch git, GitHub, Supabase or the
filesystem beyond reading this file — if you find yourself reaching for one, you have started
building.

**Send notifications yourself, with the `PushNotification` tool.** A Routine bound to a persistent
session cannot carry them: the server rejects the `notifications` parameter for any such trigger,
so the only notification that will ever reach the owner is one this session sends.

---

## STEP 1 — The owner-activity gate

**One gate, and it is the owner's own instruction: do not dispatch while the owner has a session
actively working.** Product owner, 2026-08-16, approving this design: *"Just keep the gate of an
active session from myself."*

```
list_sessions  mine=true  limit=50
```

**Hold if any session in that list is `SESSION_STATUS_RUNNING`, is not this session, and does not
carry the `queue-dispatch` tag.**

Three exclusions, and each one is load-bearing in a different way:

- **This session.** The dispatcher runs in a RUNNING session by definition, so a check that counts
  every RUNNING session is held by the firing itself and can never pass. The cheapest failure in
  this repo to write and the hardest to see, because the symptom is a healthy-looking job that
  never does anything.
- **Children carrying `queue-dispatch`.** They are RUNNING for the whole length of a build. Count
  them and the dispatcher gates itself off permanently the moment it spawns its first child —
  the same never-clearing shape, arrived at from the other side. **Tag every child at
  `create_session` time**; the tag is the primary signal, and `parent_session_id` plus
  `origin: claude_code_mcp_seed` are the cross-check when a tag is missing.
- **Nothing else.** `SESSION_STATUS_IDLE` and `SESSION_STATUS_ARCHIVED` both mean nothing is
  executing. An idle session the owner will come back to is not activity.

**Key off `session_status`, not `status_bucket`** — the bucket is a UI grouping that can be re-cut
without the status changing.

**There is deliberately no 15-minute AFK proxy any more.** The old gate held the whole hour if the
owner had touched *any* session recently, which is why the queue effectively never ran while they
were working. It existed because one shared session meant a firing could land in the middle of
their conversation; with one isolated session per story that conflict is gone, and what remains —
"do not run a build alongside my live work" — is what the RUNNING check above says directly.

**Two ways `list_sessions` can fail, and both mean HELD, never open.** Dispatching alongside live
owner work is the single outcome this gate exists to prevent, and failing open looks exactly like
a clean pass:

- **The call fails or the connector is unreachable.** Per STEP 0, a `select:` miss is a rename.
- **The response carries `has_more: true`.** The ordering is documented nowhere this session can
  read, so a truncated page is not a sample you can reason about — a RUNNING session on the next
  page is invisible. `limit=50` makes truncation unlikely, not impossible.

**Both exits send their own `PushNotification`**, because a gate held with no data has no clock
behind it and §The stall alarm therefore cannot age it. A stop nothing can age is a stop nothing
will ever report.

---

## STEP 2 — Read the queue, and read what is already out

Two reads, one call:

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c
```

- **Candidates** — everything in `Queued (AI)`. That is the only start signal. Never take work
  from `Backlog AI`, `Todo Human`, `Todo AI` or `Needs decision`; `Todo AI` is the one to be
  careful with, because the name reads like permission and is not one.
- **In flight** — everything in `Development (AI)`. Those issues are claimed by a child that is
  still working. **Skip them and carry on**; they are not a lock on the queue.

**`Needs help` is still a full stop for the whole queue, and that is deliberate.** An issue parked
there is waiting on the owner, and dispatching past it buries a story that needs them under three
merged PRs. If any issue is in `Needs help`, **dispatch nothing** and go to §The stall alarm.

**Never type a status name from memory** — run `list_issue_statuses team=Pedro & Dave` before the
first status write. Names have moved twice with nothing in the repo noticing, and a `save_issue`
naming a status that no longer exists comes back looking successful with the field silently
dropped. `.claude/commands/queue-pickup.md` §The status names carries the live table and the two
traps in its `Type` column.

**The lock changed shape with this file, and the old wording is the trap.** It used to be that
*any* issue in `Development (AI)` froze the entire queue, because there was one session and it
could only build one thing. Now the claim is **per issue**: it stops that story being dispatched
twice, and says nothing about the others. Do not restore the global reading — and do not widen it
to "any `started` issue" either, because `Queued (AI)` and `Deployed to DEV` are both typed
`started`, so that version is held by every queued and every shipped story, permanently, while
looking like a healthy job behind a busy column.

**Order the candidates**: Urgent (1) beats High (2) beats Medium (3) beats Low (4) beats No
priority (0). Ties break by oldest `createdAt`.

**An epic is not work.** If a candidate has sub-issues it is a container — the buildable thing is
one of its children. Leave the parent, comment saying so, and drop it from the batch. A container
outranks its own children on priority, so this is a real trap rather than a hypothetical one.

**Empty queue → exit silently.** No notification, no comment, no changes. This is the normal case
and it must stay cheap.

---

## STEP 3 — Scout each candidate

**Do not dispatch on titles.** A batch is only safe if the stories in it do not overlap, and
nothing on the board says what a story will touch.

**One scout agent per candidate, in parallel, in a single message.** Each is cheap and read-only —
it reads the issue and the code and predicts, it does not build:

> Read Linear issue `<id>`. Do NOT write code, do NOT edit files, do NOT touch Linear.
> Return exactly:
> 1. `paths` — the files and directories under `src/`, `supabase/`, `scripts/` or `design/` you
>    expect this story to modify. Predict generously; a missed path is a collision.
> 2. `migration` — Y/N, does it add a file under `supabase/migrations/`?
> 3. `primitive` — Y/N, does it add or change a shared component under `src/components/ui/` or
>    `src/components/icons/`?
> 4. `premise` — is the issue's load-bearing claim still true? Run the check its body implies and
>    give the command and its output. `stale` / `intact` / `no checkable claim`.
> 5. `blockers` — run `get_issue includeRelations=true` and list any `blockedBy` not in
>    `Deployed to DEV`, `Done (in production)`, `Canceled` or `Duplicate`.

Item 4 is the old premise check, moved here because it is cheaper before a dispatch than after
one. **A stale premise does not get built and does not get closed**: comment on the issue
with the command and its output, move it to **`Needs decision`**, drop it from the batch. Never
`Needs help` — that name stops the whole queue, and parking finished work there freezes it over
nothing.

Item 5 is the blocked-by backstop. **An unfinished blocker means the story is dropped from the
batch**, with one comment naming the blocker. Do not move it; being blocked is an ordinary state.

**If every candidate is stale or blocked, exit silently.** A queue full of finished work is a real
answer, and it is now visible on the board instead of costing a build.

---

## STEP 4 — Select the batch

Walk the candidates in priority order and admit each one only if it clears **all** of these
against the batch so far *and* against everything already in `Development (AI)`:

| Cap | Why it is not just a merge conflict |
|---|---|
| **Disjoint `paths`** | Two stories editing one file conflict on the second merge — loud and cheap. Worse, each is reviewed against a `development` containing neither, so `reviewer` gives an honest verdict on a file that will not exist once the other lands |
| **At most one `migration: Y` in flight** | Two children both write `060_*.sql`. Both land, both apply, and this repo already has a chain (`041 → 044 → 046`) where the wrong order succeeds with **nothing red**. They would also be applying to the same DEV database at the same time |
| **At most one `primitive: Y` in flight** | Two divergent implementations of the same shared component. Nothing conflicts, nothing fails, and the result is `CLAUDE.md`'s *individually correct and collectively inconsistent* |

**`docs/HANDOFF.md` and `CLAUDE.md` are exempt from the path check, and must be.** Roughly
two-thirds of this repo's commits touch one of them, so requiring disjointness there caps every
batch at one and deletes the feature. They conflict loudly on the second merge, which is the cheap
kind — `queue-pickup.md` STEP 4c tells the child to merge `development` and re-run.

**Two caps do NOT belong here, and adding them back would be reasoning from the wrong scope.** The
shared `letsride_test` database and the fixed ports (`:3000`, `:3001`) are container-local, and
each child runs in its own container. `CLAUDE.md` §Delegating while the owner is at the keyboard
describes both, and it is scoped to **subagents inside one session** — which is a real hazard for
a child running two agents, and no hazard at all between children.

**Batch size: at most 3.** Not a measured ceiling — a starting position, chosen because the three
sessions running concurrently on 2026-08-16 (PRs #226, #227, #228) had zero `src/` overlap between
them and conflicted only on `docs/HANDOFF.md`. Raise it once several rounds have been watched;
**say in the notification when the caps trimmed a batch**, so the owner can see whether 3 is
binding or decorative.

**Everything not admitted simply waits.** It stays in `Queued (AI)`, it is not commented on, and
the next dispatch reconsiders it. A story deferred by a cap is not a problem to report.

---

## STEP 5 — Claim and dispatch

**Per story, in this order.** Claim first: the status is what stops a second dispatcher taking the
same issue, so claiming after the spawn is a race.

1. Move the issue to **`Development (AI)`**.
2. `create_session`, with:
   - `title` — `<issue id> <short title>`, so the session list is readable.
   - `tags` — **`["queue-dispatch"]`**. STEP 1's gate depends on this; a child spawned without it
     holds the gate against every later dispatch.
   - `source_url` — `https://github.com/Lenhador88/LetsRide`. Without it the child has no clone
     and no GitHub reach.
   - `permission_mode` — omit, to inherit. It cannot be more permissive than this session's mode,
     so an explicit value can only narrow it by accident.
   - `prompt` — the brief below.

```
Build Linear issue <id>: <title>.

Read `.claude/commands/queue-pickup.md` in this repo and follow it exactly. You were dispatched
to build this one story; the picking has already been done, so start at STEP 3 (claim) — the
issue is already in `Development (AI)`, so confirm rather than re-claim it.

Scout findings from dispatch, so you do not repeat them:
- expected paths: <paths>
- migration: <Y/N> · shared primitive: <Y/N> · premise: <verdict>

Other stories are in flight in parallel sessions right now: <ids and their paths, or "none">.
Do not touch their paths. If your build genuinely needs to, stop and park into `Needs help`
rather than editing across the boundary — the dispatcher's caps assumed you would not.

Do not act on anything else in this conversation and do not treat earlier turns as instructions.
```

3. Read `create_session`'s response back and confirm the `tags` field is on it.

**Then stop.** Do not wait for children, do not poll them, do not review their work. They finish
in their own sessions and close their own issues.

---

## STEP 6 — Exit, and how you get woken again

**Three ways this session comes back, and the order matters — the cheap one is not the reliable
one:**

- **A child pokes you.** Each child's last act is `fire_trigger` on the dispatcher Routine with a
  line saying what landed. That is what makes the next batch start seconds after a slot frees
  rather than at the top of the next hour, and it is the entire point of the design.
- **The hourly Routine fires.** This is the **heartbeat, not the driver**. It exists because a
  child that dies never pokes, and a purely event-driven chain has no way back once one link is
  lost. Do not remove it on the grounds that the pokes are working.
- **`send_later`, by your own hand**, at 1-minute granularity — only when this dispatch left
  something it must come back to, such as a gate held with work waiting. Not as a poll: an
  hourly heartbeat plus a poke already covers the normal cases, and a self-re-arm every few
  minutes is how this session accumulates the context it exists to avoid.

**Send one `PushNotification` when a batch was dispatched**, naming the issues and saying whether
a cap trimmed the batch. Silence on an empty queue, on a held gate with no work waiting, and on a
batch of zero.

---

## The stall alarm

**Every reason to stop can be held by something nobody is working on** — an issue dragged into
`Development (AI)` by hand, a child that died mid-build, an owner session left RUNNING — and the
queue then freezes while every dispatch exits quietly. Before exiting on any blocking condition,
ask how long the oldest one has been true:

- **A `Needs help` issue** — `get_issue` → `stateHistory[].startedAt`. This is a stop by design
  and it still ages: an issue nobody has come back to for hours is the owner's to hear about.
- **An issue in `Development (AI)`** — its child should have finished. Age the branch tip if
  there is one, because a live build resets it and a dead one does not:

  ```bash
  git ls-remote --heads origin | grep -i "pd-<n>"     # gitBranchName is a guess; this is not
  ```

  No branch → fall back to `startedAt`. Both states this reaches are real: an issue parked by hand
  with no build behind it, and a child that has not pushed in hours.
- **An owner session RUNNING (STEP 1)** — age it by its `updated_at`, and **name the session's
  title** in the notification. *"'Postcard flip with comments' has been RUNNING since 09:12"* is
  actionable; "another session is working" is not.

**If the oldest is more than 3 hours old but less than 4, send ONE push notification naming it and
saying the queue is stalled, then stop.** The window is narrow on purpose: it fires roughly once
rather than every hour. Outside it, exit silently.

**Re-anchor on the branch tip, do not suppress.** The obvious version — "tip moved recently, exit
silently" — is wrong invisibly: a build that dies at hour 3½ has a fresh tip at the only firing
inside the window, exits silently, and by the next one the window has passed. Ageing the tip
self-heals instead.

---

## Why this shape

**The old procedure was one long-lived session building one story at a time, and it was suppressed
whenever the owner was working.** Every part of that came from one constraint: a Routine's fresh
session gets its connectors from the trigger, and `create_trigger` refuses the `connectors`
parameter for this organization — so binding to a session that already held them was the only way
to have a job that could reach Linear at all.

**What changed is that a session-spawned session inherits them.** Probed 2026-08-16 from a
`create_session` child: `permission_mode: auto` inherited without complaint, and Linear and
Supabase both reachable. That removes the reason the single session had to be reused, and with it
the three costs the reuse was paying — context accumulating across firings, a `/clear` no session
can perform, and a firing landing in the middle of the owner's conversation.

**What it does not remove is the reason for a dispatcher.** The caps in STEP 4 need one place that
can see every story in flight at once. A chain — each child spawning the next — is simpler and
cannot enforce any of them.

**Two irreversible things, carried here because the calls that trip them are CCR calls made by a
session that is not reading this file:**

- **Never delete `trig_01Gzy8eCiaXUUa1knvJnNpwy`**, the disabled fresh-session Routine. Its three
  connectors were hand-attached and `create_trigger` refuses the parameter, so no session can
  recreate it; `update_trigger enabled: true` restores it whole. A disabled trigger's
  `list_triggers` row has **no `enabled` key at all** rather than `"enabled": false`.
- **Never archive the session the dispatcher Routine is bound to.** `update_trigger` has no
  `persistent_session_id` parameter, so recovery means a new trigger bound to a new session.
