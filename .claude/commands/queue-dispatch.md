---
description: Hand each queued story, or each group of colliding stories, to its own session
---

# Queue dispatch

**This procedure picks work and hands it out. It never builds anything.** The build is
[`queue-pickup.md`](queue-pickup.md), which runs in a *different session* — one per **group**,
spawned here, each with its own container, its own branch and its own empty context window.

**The moment this session builds something it becomes the old Development session again** — context
accumulating across firings, one story at a time, and a `/clear` nobody can perform from inside.
Read the board, spawn, exit. Nothing else.

**The shape, as the owner stated it on 2026-08-18** — check each half against the step that owns
it rather than trusting this paragraph, which is a map:

> *"every hour the routine runs, spawns a max of 2 sessions. Each session can pickup a group of
> stories if applicable. Sometimes it may not make sense to spawn the 2 sessions, for eg. if there
> are no stories that can be done in paralel, no stories available etc."*

One firing an hour (STEP -1), at most two build sessions in flight at once (STEP 1, counted off the
slot labels), a group of up to three colliding stories per session (STEP 4), and a session that may
take another story when it finishes (`queue-pickup.md` STEP 6). **Fewer than two is a normal firing, not a fault**, and a
firing that dispatches nothing is silent.

## The board is the lock — read this before changing any step

**Everything this file knows, it reads off Linear in one pass.** Owner, 2026-08-18: *"we could
just see the stories are in development?"* So:

| Question | Where the answer is | What it is NOT |
|---|---|---|
| What may I dispatch? | `Queued (AI)` | never `Todo AI`, which reads like permission |
| What is already being built? | `Development (AI)` | not a session list, not a comment thread |
| How many sessions are running? | the `slot-1` / `slot-2` labels on those issues | not `list_sessions` |
| What are they touching? | one `<!-- territory -->` comment per occupied slot | not a scout's prediction |
| Is the queue stopped? | any issue in `Needs help` | not a Routine field |

**Two labels are the concurrency cap, and they are the whole of it.** `slot-1` and `slot-2` exist
on the `PD` team (created 2026-08-18) — check rather than trust that, because everything below
rests on it:

```
mcp__Linear__list_issue_labels  team=Pedro & Dave     # slot-1 and slot-2 must both be there
```

**A `list_issues label=slot-1` returning nothing does NOT establish they exist**, which is the
trap: the empty response is identical whether the label is missing or simply unused. Only the
label listing answers it. The dispatcher puts one on every issue it hands to a
session; that session carries the same label onto anything else it picks up. **A slot label
present on an issue in `Development (AI)` means that slot is occupied**, however many issues carry
it — so the free-slot count is `2 −` the number of *distinct* slot labels in that column, and it
comes back in the same call as the board. Nothing else counts sessions, and nothing may.

**What this file no longer does, so nobody restores it as a repair:** it runs no scout agents, it
reads no `list_sessions`, it writes no dispatch record, and it does not check whether the Routine
is enabled. §Why this shape has the measurement behind each removal.

Read `CLAUDE.md` fully before acting — unless you are the relay, which reads only STEP -1.
Workspace `lets-ride`, team **Pedro & Dave** (`PD`), project **Let's ride (AI)**
(`88f3f224-ecf0-46f0-a032-c86b7a12f81c`). Note the curly apostrophe in that name; pass the id,
never the name.

---

## The three roles, and how to tell which you are

| | Relay | Dispatcher | Child |
|---|---|---|---|
| Started by | the hourly Routine — the only clock there is | `create_session` from the relay | `create_session` from the dispatcher |
| Reads | STEP -1, and nothing else in this file | this file, from STEP 0 | [`queue-pickup.md`](queue-pickup.md) |
| Holds | nothing — two state reads and one spawn | the board, the caps, the batch | its group's issue ids and its slot label |
| Ends at | one session spawned, or a silent exit | children spawned | every issue it holds at `Deployed to DEV` |
| Carries the tag | no — it **is** `session_01B2mxc642tG8vZ15wysQpqM` | **`queue-dispatch-run`** | **`queue-dispatch`** |

**A child never dispatches.** One level, no chaining — a child that spawns a child has no view of
the slot labels below and cannot enforce them, so the cap quietly stops holding while everything
still looks healthy. A child taking a *second story into its own slot* is not chaining; that is
`queue-pickup.md` STEP 6 and it consumes no new slot.

**Which of the three you are is decided by your own session id**, and STEP -1 is where you read
it. The relay is `session_01B2mxc642tG8vZ15wysQpqM` — the session the Routine is bound to, and the
only one this file names. The fallback if the Routine is ever rebound is that session's own
`Claude-Session: https://claude.ai/code/<id>` line, the one used for commit trailers.

---

## STEP -1 — Are you the relay?

**Read your own session id first** — `get_session` with `session_id` omitted describes the session
making the call, and it is the only tool here that answers the question. **The relay branch fires
on a positive match and on nothing else.** If the id cannot be read at all, decide by the prompt
instead: the dispatcher's prompt carries the line `Spawned by the relay.` verbatim and the
Routine's does not.

**Written that way round deliberately.** A default of "assume relay" is the one that can chain: a
dispatcher taking the relay branch spawns a dispatcher, which takes it again, and nothing in this
file bounds that. The Routine's own prompt calls its recipient the DISPATCHER — that wording
predates this step, no ordinary session can edit it, and **this file is the authority over it**.
Being handed that prompt is not a positive id match.

**If your session id is anything else, you are the dispatcher: go to STEP 0 and ignore the rest of
this step.** The Routine's prompt arriving in a session that is neither the relay nor a
`Spawned by the relay.` dispatcher is misrouted — stop, and say so.

### The relay's pre-check — the only thing standing between an empty queue and a whole session

**If you are `session_01B2mxc642tG8vZ15wysQpqM`, you are the relay: four small reads, then spawn
or exit.** **Read no code, run no other step of this file, and do not read `CLAUDE.md`** — the
instruction at the top belongs to the dispatcher. The relay's entire value is that its transcript
grows by a couple of thousand tokens a firing; reading 30k of process docs to make one call throws
that away while looking diligent.

**Why the relay reads the board at all, when the previous version of this step forbade it.** A
dispatcher costs a whole session — `CLAUDE.md` is auto-loaded into every one, so ~50k is spent
*before* it can discover the queue is empty. Measured 2026-08-18 from `list_sessions mine=true
limit=100`, counting rows tagged `queue-dispatch-run` against rows tagged `queue-dispatch`: six
dispatchers ran between 12:28 and 17:10 and produced one child. **That call is banned inside a
firing, not banned outright** — it is the ~140k read this rebuild removed from the hourly path, and
re-running it belongs in an owner-directed session where its cost is paid once. **The pre-check is two booleans, not a
judgement** — is there anything to take, and is there anywhere to put it. Which story, which
group, which caps: all of that stays in the dispatcher, and a relay that starts answering any of
it has become the thing STEP 0 costs 50k to do properly.

**Its transcript still grows, and that is survivable because the relay holds no state worth
losing.** When it eventually compacts, what is summarised away is a list of board reads that were
already acted on. Do not add a call to this step whose *output* you would mind losing.

1. **Read the status names back** — `list_issue_statuses team=Pedro & Dave`. Three names below are
   typed into a filter, and a status rename is a two-click change nothing in this repo can see. A
   filter naming a status that no longer exists returns **nothing**, which is indistinguishable
   from an empty queue — so the relay would exit silently, for ever, on a healthy board. If a name
   you need is not in the response, **spawn the dispatcher anyway** and let STEP 1 report it.
2. **Is anything queued?** `list_issues project=88f3f224-… state=<the `Queued (AI)` name>`.
   **Nothing → exit silently.** This is the common case and the whole point of the step.
3. **Is the queue stopped?** `list_issues project=… state=<the `Needs help` name>`. **Any row →
   exit silently.** A parked story stops every dispatch (STEP 1), so spawning a dispatcher to
   rediscover that is the same waste one step later.
4. **Is there a free slot?** `list_issues project=… state=<the `Development (AI)` name>` and read
   the `labels` on each row. **Both `slot-1` and `slot-2` present → exit silently.**

**Any of those four calls failing → spawn anyway.** A pre-check that cannot read the board has not
established that there is nothing to do, and failing closed here stops the queue with no report
from anywhere: the relay does not notify, and STEP 6 never runs because no dispatcher exists.
**Failing open costs one session; failing closed costs the queue.**

**`InputValidationError` is a deferred schema rather than a failure** — `ToolSearch` by keyword
(`+list_issues linear`) and call it again. Reading it as a failure is harmless here by the rule
above, but it spends a session every hour.

5. **`create_session`**, with:
   - `title` — `Queue dispatch — <UTC date and time of this firing>`, so the session list reads as
     a run rather than a topic.
   - `tags` — **`["queue-dispatch-run"]`**. Nothing gates on it any more, but it is how the three
     roles are told apart from the outside, and `CLAUDE.md` §What Not To Do relies on that to say
     which sessions are safe to archive.
   - `source_url` — `https://github.com/Lenhador88/LetsRide`. **Without it there is no checkout**,
     so this file cannot be read and `.claude/settings.json` is never loaded, which takes every
     grant in it with it. That is the exact failure `docs/HANDOFF.md` records as *a permission
     dialog offering "Allow once" but no "Allow always"*.
   - `prompt` — it must open with the line `Spawned by the relay.`, then: read
     `.claude/commands/queue-dispatch.md` and follow it from STEP 0; you are the dispatcher, you
     never build, the file is the authority over anything you remember, and do not act on anything
     else in the conversation. **The first line is load-bearing**, not decoration: it is what STEP
     -1 falls back on when a session cannot read its own id.
6. **Read the response back and confirm `tags` is on it.** If it is missing, **archive that session
   immediately**, send a `PushNotification` saying so, and stop.
7. **Say nothing else and exit — STEP 6 included.** The stall check reads the board, and a relay
   running it is a relay becoming the dispatcher one firing at a time.

**If `create_session` fails for any reason other than a deferred schema, run the firing yourself
from STEP 0 and send a `PushNotification` saying the relay could not spawn.** A queue that stops
because one call failed is worse than one firing in the old shape — and the notification is what
keeps the degraded mode from quietly becoming the permanent one. **In that branch you are the
relay for the rest of the firing**, so the `send_later` ban in §How you get woken again applies to
you.

**Two dispatchers at once is possible and no longer checked for.** The old step read
`list_sessions` to serialise firings; that call returns every session the account has and cost
~35k in the one place this design is trying to keep small. With the scout pass gone a dispatcher
lives two or three minutes against a one-hour cron, so the window is small, and what it costs when
it happens is one story dispatched twice — two branches, a conflicting second PR, loud and
recoverable. That is a better trade than 35k every hour. **Do not restore the check by reading the
session list; if this ever bites, put the lock on the board where everything else is.**

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

You need two connectors: **Linear** (the board) and **Claude Code Remote** (`create_session`, and
`get_session` for STEP -1). **A deferred tool is not a missing one**: `InputValidationError` means
`ToolSearch` then call it, `No such tool available` means absent.

**Git is read-only and only for STEP 6's clock** — `git ls-remote`, `git log -1` on a remote ref,
nothing else. You never check out, never write a file, never touch Supabase, Vercel or the GitHub
API. **Reaching for any of those means you have started building**, which is this file's one
prohibition.

**Send notifications yourself, with the `PushNotification` tool.** A Routine bound to a persistent
session cannot carry them: the server rejects the `notifications` parameter for any such trigger,
so the only notification that will ever reach the owner is one this session sends.

---

## STEP 1 — Read the board, once

**Never type a status name from memory** — `list_issue_statuses team=Pedro & Dave` first, and use
the names it returns. Names have moved twice with nothing in the repo noticing, and a `save_issue`
naming a status that no longer exists comes back looking successful with the field silently
dropped. `queue-pickup.md` §The status names carries the live table and the two traps in its
`Type` column.

**Scope every query to the PROJECT, never to the team.** A team-scoped `list_issues` is the
natural query and it is wrong in a way that looks like a working gate: this team carries years of
issues outside this project, several of them sitting in `Needs help` for ever, so the full-stop
below would hold the queue permanently against a healthy board.

**Query by state, never the whole project.** One unfiltered `list_issues` on this project returns
100 issues and ~35k tokens of description; the three state-filtered calls together are a fraction
of that:

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  state=<Queued (AI)>
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  state=<Development (AI)>
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  state=<Needs help>
```

- **Candidates** — everything in `Queued (AI)`. That is the only start signal. Never take work
  from `Backlog AI`, `Todo Human`, `Todo AI` or `Needs decision`; `Todo AI` is the one to be
  careful with, because the name reads like permission and is not one. The owner keeps it that way
  on purpose, 2026-08-18: *"I want to pickup only from Queued AI, as it allows me to prioritise and
  focus work on the features I want to deliver."*
- **In flight** — everything in `Development (AI)`, with its `labels`.
- **`Needs help` is a full stop for the whole queue.** An issue parked there is waiting on the
  owner, and dispatching past it buries a story that needs them under the next batch of merged
  PRs. Any row → **dispatch nothing**, but still run STEP 6.

**Then count the free slots:**

```
free slots = 2 − (DISTINCT slot labels — `slot-1`, `slot-2` — appearing on issues
                  still in `Development (AI)`)
```

**An in-flight issue carrying NO slot label occupies no slot, and that is deliberate.** The
ordinary cause is a hand move — the owner does that — and freezing the queue over it is the
never-clearing shape this file has been bitten by twice.

**The cause is not always benign, and that is the accepted cost rather than an oversight.** A live
session can end up unlabelled too: a dispatcher dying between the status write and its read-back, a
half-completed rollback, or a later `save_issue` replacing the label set from a stale read. In that
state the count reads one too high and a firing can put three sessions in flight against a cap of
two. The old file froze the whole queue on the equivalent state; this one takes fan-out over a
freeze, because a freeze is what a *hand move* would now trigger and the hand move is the common
case by a wide margin. **Say it in STEP 6's notification whenever a batch goes out alongside an
unlabelled in-flight issue** — that line is the only signal either cause gets.

**At zero free slots, dispatch nothing.** Go to STEP 6, which is silent in that case.

**Order the candidates**: Urgent (1) beats High (2) beats Medium (3) beats Low (4) beats No
priority (0). Ties break by oldest `createdAt`.

**An epic is not work.** If a candidate has sub-issues it is a container — the buildable thing is
one of its children. Leave the parent, comment saying so, and drop it from the batch. A container
outranks its own children on priority, so this is a real trap rather than a hypothetical one.

**Hold if a usage signal arrives in THIS firing** — a system warning that a limit is approaching or
reached, an overage notice, a rate-limit message. Product owner, 2026-08-07: *"if any Claude usage
limit is above 80%, skip the run."* Dispatch nothing and send a `PushNotification` saying so.
There is no number to compare against 80% and inventing one would be a gate that can never fire:
`claude --help` has no `usage` subcommand, `~/.claude` holds no usage file, and no environment
variable carries one.

**"This firing", never "anywhere in this conversation".** For a dispatcher the two coincide — its
conversation *is* one firing — but in STEP -1's failure branch the firing runs in the relay, whose
context accumulates and which no session can clear. Read as "anywhere in this conversation" there,
the first rate-limit message that session ever received disables the queue permanently.

**There is no owner-activity gate any more.** Product owner, 2026-08-18: *"we can indeed drop the
gate whether I am here or not"* and *"i do not edit files by hand, always prompting here."* The
gate existed because a firing could land in the owner's own session and because a hand edit could
collide with a child; one isolated session per story removed the first, and the second was never
how this repo is worked. **The collisions that remain are between children, and the slot labels
plus STEP 2's territory are what hold them.**

---

## STEP 2 — What the live sessions are touching

**Skip this step entirely if there are no free slots, no candidates, or a `Needs help` row.**
Go to STEP 6.

**For each occupied slot, read the territory its session declared** — one call per slot, at most
two, on any one issue carrying that label. The child writes the same comment on every issue it
holds (`queue-pickup.md` STEP 3), so any of them answers:

```
mcp__Linear__list_comments  issueId=<an issue carrying slot-N>
```

Take the most recent comment beginning `<!-- territory -->`. It is written by the child at
`queue-pickup.md` STEP 3 and rewritten whenever it takes another story, so the newest one is the
whole of what that session holds:

```
<!-- territory -->
slot: 1
issues: PD-201, PD-207
paths: src/components/postcards/, src/lib/data/postcards.ts
migration: Y
primitive: N
```

**A missing territory comment is not a freeze.** Treat that slot as touching **everything**: it
occupies its slot and collides with every candidate, so this firing dispatches nothing into the
other slot unless the candidate is plainly unrelated. Say so in STEP 6's notification. The old
version of this file froze the whole queue on a missing record and notified; that was correct when
the record was the *only* liveness signal and is overkill now that the label already holds the
slot.

**Why the child writes this and the dispatcher no longer predicts it.** Until 2026-08-18 a scout
agent per candidate guessed the paths a story would touch — `free slots + 2` fresh agents, each
re-paying `CLAUDE.md`, roughly 120k a firing, to produce a prediction. The session actually
building the story knows what it touched; a prediction made before the build is the weaker answer
and cost the most.

---

## STEP 3 — Drop what is blocked

**One call per candidate, no agent:**

```
mcp__Linear__get_issue  id=<candidate>  includeRelations=true
```

Any `blockedBy` not in `Deployed to DEV`, `Done (in production)`, `Canceled` or `Duplicate` → drop
that story from the batch and leave one comment naming the unfinished blocker. Do not move it;
being blocked is an ordinary state.

**Is the premise still true? That question moved to the child.** A scout agent used to answer it
here; it is now `queue-pickup.md` STEP 3, where the session reading the actual code decides, before
it builds. The bar and its three verdicts moved with it unchanged.

**If every candidate is blocked, dispatch nothing** and go to STEP 6.

---

## STEP 4 — Group the candidates, then select the batch

**A collision between two candidates is a reason to build them TOGETHER, not a reason to defer
one.** Each cap describes damage that only two *different sessions* can do:

| Cap | What two sessions do | What one session does |
|---|---|---|
| **`paths`** | Conflict on the second merge — loud and cheap. Worse, each is reviewed against a `development` containing neither, so `reviewer` gives an honest verdict on a file that will not exist once the other lands | Edits the file once, with both changes in front of it |
| **a migration each** | Both write `060_*.sql`. Both land, both apply, and this repo already has a chain (`041 → 044 → 046`) where the wrong order succeeds with **nothing red**. They also apply to the same DEV database, which unlike the test database and the dev-server ports **is** shared across containers | Writes `060`, then `061`. The ordering is by construction rather than by luck |
| **a shared primitive each** | Two divergent implementations of the same component under `src/components/ui/` or `src/components/icons/`. Nothing conflicts, nothing fails, and the result is `CLAUDE.md`'s *individually correct and collectively inconsistent* | Writes one implementation and uses it twice |

**Judge the collision from the board, not from a prediction.** You have each candidate's title,
description and labels, and you may read the issue itself (`get_issue`) — that is the whole budget.
Two stories collide when a careful reader would say they are the same area of the app: the same
route tree, the same table, both adding a migration, both touching a shared primitive.

**When you cannot tell, group them.** Grouping is the safe direction: its cost is a slightly bigger
diff in one review, and the cost of getting it wrong the other way is the three failures in the
table above. This replaces a scout pass whose predictions were themselves guesses.

**Drop anything colliding with a live slot's territory.** You cannot merge a candidate into a
branch another session is building, so it waits for a later firing. Where the collision is with a
missing territory comment, see STEP 2.

**The group ceiling — at most 3 issues, and at most one `L`.** Size a candidate from its issue:
**`S`** a copy fix, a doc line, a single component · **`M`** the ordinary story · **`L`** a new
route with its data layer, a migration plus the screens that read it, or anything you would expect
to touch more than ~10 files. A group holds at most **3** issues; at most **one** `L`; and a group
containing an `L` holds at most **2**. So two `L` stories never travel together even though two
issues clears the count — which is the case most likely to arise, since two `L` migration stories
collide whatever their paths. **The bound is the `reviewer` pass**: one group is one
branch, one PR and **one** review, and `queue-pickup.md` STEP 4b already refuses a fold-in that
*"would grow the diff past what one `reviewer` pass can honestly cover"*.

**Over either ceiling, take the highest-priority members that fit and leave the rest.** They are
not lost — they collide with the group just admitted, so the batch rule below holds them until a
later firing.

**The batch is one group per free slot.** A group is one session, so it costs one slot however many
stories are in it — a firing dispatching two groups of two is building four stories in two
sessions. Walk the groups in priority order (a group's priority is its highest-priority member,
ties by that member's `createdAt`) and admit each only if it clears the caps against every live
territory **and** against every group already admitted this firing.

---

## STEP 5 — Claim and dispatch

**Per group, in this order** — one session per group, however many stories are in it. Claim first:
the status is what stops a second dispatcher taking the same issue, so claiming after the spawn is
a race.

1. **Move every issue in the group to `Development (AI)` AND put the free slot label on it, in the
   same write** — then read each response back and confirm both fields actually took. A
   `save_issue` naming a status that no longer exists returns a successful-looking payload with the
   field silently dropped, and this is the write the entire concurrency story rests on.

   **`labels` REPLACES the whole set.** Read the issue's existing labels off STEP 1's response and
   pass them plus the slot label, or you will strip `App`, `Database` and everything else the owner
   filters on.

   ```
   mcp__Linear__save_issue  id=PD-201  state=<Development (AI)>  labels=["App", "Feature", "slot-1"]
   ```

   **If any of them did not take, move back the ones that did, dispatch nothing for this group,
   and send a `PushNotification` naming the issue and which field failed.** A part-claimed group is
   a race with extra steps — and a silent rollback is worse than the race, because the label is the
   whole lock: if `slot-1` and `slot-2` were renamed or deleted, *every* claim drops its label,
   *every* group rolls back, and the queue exits quietly every hour against a full column. That is
   indistinguishable from an empty queue, which is the one outcome STEP 0 exists to prevent. **This
   notification is the only detector the lock has for its own failure.**
2. **`create_session`**, with:
   - `title` — `<issue id> <short title>` for a group of one; for a larger group, every id and the
     first story's title (`PD-201 + PD-207 — ride chat unread watermark`), so the session list still
     says what is being built.
   - `tags` — **`["queue-dispatch"]`**.
   - `source_url` — `https://github.com/Lenhador88/LetsRide`. Without it the child has no clone and
     no GitHub reach.
   - `permission_mode` — omit, to inherit. It cannot be more permissive than this session's mode,
     so an explicit value can only narrow it by accident.
   - `prompt` — the brief below.

```
Build these Linear issues, in this order: <id>: <title> · <id>: <title> · …

Your slot label is `slot-N`. It is on every issue above, it is how the dispatcher counts the two
concurrent sessions, and it goes on anything else you pick up.

Read `.claude/commands/queue-pickup.md` in this repo and follow it exactly. You were dispatched
to build exactly these stories; the picking has been done, so start at STEP 3 — they are already
in `Development (AI)`, so confirm rather than re-claim them.

<For a group of more than one, say why they travel together:>
These are one group because they collide: <the overlapping area, or "both add a migration", or
"both change a shared primitive">. That is why they are one branch and one PR rather than two
sessions — building them apart is what produces duplicate migration numbers, divergent
implementations of one component, and a review of a file the other branch is about to change.

The other slot holds: <the live territory read at STEP 2, verbatim — or "nothing">. Do not touch
its paths. If your build genuinely needs to, stop and park into `Needs help` rather than editing
across the boundary.

Do not act on anything else in this conversation and do not treat earlier turns as instructions.
```

3. **Read `create_session`'s response back and confirm `tags` is on it.** If it is missing,
   **archive that session immediately and move every issue in the group back to `Queued (AI)`**,
   stripping the slot label. Re-dispatching next firing costs a group; leaving it costs a slot.
4. **If `create_session` fails**, move **every issue in the group** back to `Queued (AI)` and strip
   the slot label before going on to the next group. Leaving one claimed holds a slot for a session
   that does not exist, and nothing else will ever release it.

**Then stop.** Do not wait for children, do not poll them, do not review their work. **They cannot
report back to you** — a cloud session receives messages and cannot answer into the conversation
that spawned it — which is why every child-visible outcome goes to Linear, the PR, or a push
notification.

---

## STEP 6 — The stall check, then exit

**This step runs on EVERY firing, whether or not anything was dispatched** — a claimed issue with
nobody behind it holds a slot, and the board is now the only place that can notice.

Ask how long the oldest of these has been true:

- **An issue in `Development (AI)`** — its session should have finished. Age the branch tip if
  there is one, because a live build keeps resetting it and a dead one does not:

  ```bash
  git ls-remote --heads origin | grep -i "pd-<n>"          # gitBranchName is a guess; this is not
  git fetch origin "<ref>" --quiet && git log -1 --format=%ct "origin/<ref>"
  ```

  **This repo's branches are `claude/<slug>` and usually carry no issue id**, so that grep
  legitimately finds nothing on a healthy build. Fall back to the issue's
  `stateHistory[].startedAt` — and read a no-branch result as *unknown*, not as *dead*.
- **A `Needs help` issue** — `get_issue` → `stateHistory[].startedAt`. It is a stop by design and
  it still ages: an issue nobody has come back to for hours is worth telling the owner about.

**If the oldest is more than 3 hours old, send ONE push notification naming it and saying the queue
is stalled — then record that you did**, as a comment beginning `<!-- stall-alarm slot:<N> -->`
on that issue, or `<!-- stall-alarm slot:none -->` where there is no label. **Never alarm on an
issue that already carries one.**

**A slot holds several issues, so look for the marker across all of them.** One dead session holds
every issue carrying its label, and they age past the threshold together; checking only the issue
in front of you finds no marker on the siblings and alarms once per member for a single dead
session. Write the marker on just one of them.

**Fall through when the oldest subject is already alarmed**, rather than stopping: take the next
oldest that is not. Reading only the single oldest would let one permanently-alarmed story hide
every stalled one behind it.

**A stalled slot is not cleared automatically, and the owner is the one who clears it.** They move
the issue back to `Queued (AI)` and strip the label, which frees the slot on the next firing. That
is a deliberate limit rather than an oversight — an age-based reaper that returns a story a live
session is still building is the one failure worse than a held slot, and nothing here can tell
those apart now that the session list is not read.

### What else this step sends, and what it does not

- **A batch was dispatched** → one `PushNotification` naming the issues **grouped as dispatched**,
  which slot each took, whether a ceiling trimmed anything, and whether an in-flight issue carried
  no slot label or a slot carried no territory. `PD-201 + PD-207 in slot-1, PD-210 in slot-2` is
  the line; a flat list of three ids hides the shape entirely.
- **A hold that nothing ages** → notify, but **only once per condition**. Two qualify: the usage
  hold, and a `Needs help` row older than the threshold above.
- **Empty queue, every candidate blocked, no free slot, or a batch of zero** → silence.

### Your last act — archive yourself

**A dispatcher archives its own session once this step is done**, which releases the container and
keeps a queue that fires hourly from filling the owner's session list. It is best effort: if the
call refuses, say nothing and exit.

### How you get woken again

- **The hourly Routine fires. That is the only clock, and there is deliberately no other.**
  Product owner, 2026-08-18: *"when the development ends, I dont want those new sessions to report
  back to the routine. It will just pick up new stories on the next hourly run."*

  **A freed slot therefore waits for the top of the hour**, and that is the accepted cost rather
  than a gap to engineer around. **Do not reintroduce the poke** — not as an optimisation, not as a
  stall alarm, and not as "just for the parked case". A session that finishes early and still has
  budget does not need it: it takes its next story itself (`queue-pickup.md` STEP 6).
- **`send_later`** — **only for a condition that resolves on a clock you can name.** In STEP -1's
  failure branch that session is the relay, whose context must not accumulate and which no session
  can clear; outside that branch you are a dispatcher that should have archived itself a step ago.
  A session that re-arms an hourly check-in to watch something is the failure this design was
  rebuilt to remove — one was measured on 2026-08-18 at 84.5M cache-read tokens across 18 wakes,
  having built nothing since the first.

---

## Why this shape

**Everything here was measured on 2026-08-18, on a live queue.** The four removals below are the
whole of the change, and each has a number behind it rather than a preference.

- **The scout pass is gone.** It spawned `free slots + 2` fresh agents per firing, each re-paying
  `CLAUDE.md` (~30k), to predict which files a story would touch. That is ~120k a firing to produce
  a guess that the session doing the build could state as a fact. It is replaced by the child's
  `<!-- territory -->` comment plus the dispatcher's own reading of the board.
- **The session list is gone.** `list_sessions mine=true limit=100` returns ~140k characters and
  was read for two things: a liveness check on children, and the owner-activity gate. The slot
  labels replace the first and the owner dropped the second.
- **The dispatch record is gone**, replaced by the slot label. It cost one `list_comments` per
  in-flight issue on every firing plus one `save_comment` per issue on every dispatch, to carry a
  session id that only the session list could interpret.
- **The switch gate is gone, because absence of the field it read means nothing.** STEP 1 used to
  refuse to dispatch unless `trig_01WJkMVXGzUVGDcC1njNmaan` read `enabled: true`, on the documented
  rule that *a disabled row simply lacks the key*. Measured across all **27** triggers on this
  account at 20:05 that day: **not one carried an `enabled` key** — including this Routine, which
  had fired at 17:09. So a row that is on and a row that is off were indistinguishable, and the
  gate could only ever read "off": a silent exit on every firing, which is exactly the failure it
  was written to prevent.

  **The key does appear once it is explicitly set, and it persists.** An
  `update_trigger enabled: true` at 20:40Z came back carrying `"enabled": true`, and a *separate*
  `list_triggers` at 20:52Z still showed it — which is what distinguishes a stored field from an
  API echoing the parameter just written.

  **What that licenses is narrow, and the trap is reading it as "the queue is running".** The one
  row that has ever shown `enabled: true` was, at that moment, **two and a half hours past its due
  fire** — the same call revealed the stall below. So: **present-and-`true` is authoritative about
  the flag and says nothing about whether the Routine is firing.** Absent means unknown; never-set
  and off have never been told apart, because **no row known to be off has ever been read back**.
  The repo's one disabled Routine (`trig_01Gzy8eCiaXUUa1knvJnNpwy`) does not appear in
  `list_triggers` at all, which is equally consistent with *a disabled trigger is omitted from the
  listing* — a reading nothing here excludes, and one that would also mean the standing worry that
  it has been deleted is a misread disable.

  ```
  list_triggers limit=100 include_completed=true    # enabled:true = the flag is on, nothing more
  ```

  **The gate stays deleted for two reasons, and "the common case is unknown" is no longer one of
  them** — since 20:40Z this Routine's common case is present-and-true. What survives: **nobody has
  ever observed a disable's read-back**, so the gate cannot be shown to fire on the only condition
  it exists for without the owner deliberately disabling something; and **pausing already stops the
  queue**, because the cron is the only thing that fires it, which makes the gate redundant either
  way.

  **`next_run_at` is the field that answers the real question**, and it is the one to check when
  the queue seems quiet: in the future = armed, in the past = it has stopped firing. Measured the
  same evening — `next_run_at` sat at 18:05Z with the clock at 20:40Z and no fire since 17:09Z, the
  second time this Routine has been found silently stopped.

  **Re-arm `trig_01WJkMVXGzUVGDcC1njNmaan` — name the id, do not write "the trigger"** — with
  `update_trigger enabled: true`. That exact command is also the documented restore for the
  irreplaceable fallback `…Gzy8e`, so an unqualified "re-arm it" is one slip away from running two
  dispatch Routines against one board.

  **One observation, not a mechanism:** that call moved `next_run_at` to 21:05Z. Whether the
  `enabled` parameter did it, or any `update_trigger` write recomputes the next fire, is untested.
  What it does show is that **the schedule was not lost** — 21:05Z is the next `:05` boundary after
  20:40Z, so the stored cron was retained and recomputed, and `cron_expression` did not need
  re-sending.

**What did not change: one dispatcher, not a chain.** The caps need one place that can see every
story in flight at once. A chain — each child spawning the next — is simpler and cannot enforce any
of them.

**Spawning through `create_session` is what makes this work at all.** Probed 2026-08-18 from two
children: with no repo attached, `permission_mode: auto` inherited and Linear, Supabase, Vercel,
GitHub and the Claude Code Remote tools all answered; with `source_url` set, the repo checked out
and the child called `create_session` itself, the grandchild coming back with `parent_session_id`
set and its `tags` intact. **The one hop still inferred rather than measured is the exact one STEP
-1 performs** — a Routine-fired session spawning a child — because both probes were spawned from an
interactive session. STEP -1's `create_session` failure branch is the detector: it degrades to the
old shape and notifies rather than stopping.

**Two irreversible things, carried here because the calls that trip them are CCR calls made by a
session that is not reading this file:**

- **Never delete `trig_01Gzy8eCiaXUUa1knvJnNpwy`**, the disabled fresh-session Routine. Its three
  connectors were hand-attached and `create_trigger` refuses the parameter, so no session can
  recreate it. **It was not in `list_triggers` on 2026-08-16, and still was not on 2026-08-18** —
  27 triggers at `limit=100 include_completed=true`, and none is it. If it is gone the documented
  fallback is gone with it; STEP -1 is what makes that survivable, since a firing whose context is
  one hour old no longer needs a Routine to provide it.
- **Never archive the relay session** (`session_01B2mxc642tG8vZ15wysQpqM`). `update_trigger` has no
  `persistent_session_id` parameter, so recovery means a new trigger bound to a new session.
  **Everything the relay spawns is disposable** and archiving one is fine: a dispatcher carries
  `queue-dispatch-run` and a child carries `queue-dispatch`.
