---
description: Every hourly firing is the builder — read the board, take one group into a free slot, build it with queue-pickup.md
---

# Queue run — one firing, one group

**The Routine fires a FRESH session every hour, and that session does the whole job itself:** read
the board, take at most one group of stories into a free slot, build it end to end with
[`queue-pickup.md`](queue-pickup.md), and end. **Nothing persists between firings, nothing spawns
a session, and no session fires or messages another.** The next firing reads the board again.

**Why this replaced the relay → dispatcher → child design on 2026-09-02.** That design needed the
session the Routine fires into to *spawn* another (`create_session`). **What is measured**: every
relay since the 2026-08-18 rebind answered its firing with 40–80 output tokens and spawned nothing,
across three "fixes" to this procedure that could not have mattered, and the only dispatchers that
ever ran were spawned by hand from the owner's session. **What is inferred from that, and is still
unconfirmed** (PD-241, 2026-08-27 and 2026-09-02: no session can read another's transcript): that a
session the Routine mints for itself does not hold `create_session`. PD-241 reads that as *the
Claude Code Remote connector was never attached to the Routine*; the owner looked for that
connector in the Routines UI on 2026-09-02 and it was not offered, which reads as *built-in tooling
a session gets only when a person or another session starts it*. STEP 0's inventory is what tells
the two apart, which is why the setup below says to attach it if the UI ever offers it. Four silent
outages in three weeks, and a persistent session costing about $1 per idle firing. `docs/reference/linear.md` §The queue is drained by one
Routine, on one clock carries the measurements; PD-241 carries the record.

**What a Routine-minted session DOES hold, measured, and this file's board half uses nothing
else:** the repository checkout (so this file, `CLAUDE.md` and `.claude/settings.json` are read —
2026-08-17, a firing without one prompted for every call), the connectors attached to the Routine
(Linear, Supabase, Vercel — every relay's board reads answered), and auto mode (`get_session` on the
relay, 2026-09-02). **Whether it holds git push credentials, the GitHub tools (PR creation),
`PushNotification`, `get_session`, `archive_session`, `list_sessions` or `create_session` is
unknown until STEP 0's self-check reports it** — the previous design assumed a tool it did not
have, so every firing measures the three a build cannot do without before it touches the board,
and the first firing that passes writes the whole inventory to PD-241. Nobody flips a switch: a
firing that can build, builds; one that cannot says exactly what is missing and stops.

**The shape, as the owner stated it on 2026-08-18 and reaffirmed on 2026-09-02** — one firing an
hour, at most two build sessions in flight, a group of up to three colliding stories per session.
Concurrency is still the two slot labels: this firing takes one free slot; if a second story is
still queued an hour later and the first is still building, the next firing takes the other slot.
**Fewer than two in flight is the normal state, not a fault**, and a firing that finds nothing to
do ends silently.

## The board is the lock — read this before changing any step

**Everything this file knows, it reads off Linear in one pass.** Owner, 2026-08-18: *"we could
just see the stories are in development?"* So:

| Question | Where the answer is | What it is NOT |
|---|---|---|
| What may I take? | `Queued (AI)` | never `Todo AI`, which reads like permission |
| What is already being built? | `Development (AI)` | not a session list, not a comment thread |
| How many sessions are running? | the `slot-1` / `slot-2` labels on those issues | not `list_sessions`, which this session is not expected to hold — STEP 0's inventory says |
| What are they touching? | one `<!-- territory -->` comment per occupied slot | not a prediction |
| Is the queue stopped? | any issue in `Needs help` | not a Routine field |

**Two labels are the concurrency cap, and they are the whole of it.** `slot-1` and `slot-2` exist
on the `PD` team (created 2026-08-18) — check rather than trust that, because everything below
rests on it:

```
mcp__Linear__list_issue_labels  team=Pedro & Dave     # slot-1 and slot-2 must both be there
```

**A `list_issues label=slot-1` returning nothing does NOT establish they exist** — the empty
response is identical whether the label is missing or simply unused. Only the label listing answers
it. This firing puts one on every issue it takes; the build carries the same label onto anything
else it picks up. **A slot label present on an issue in `Development (AI)` means that slot is
occupied**, however many issues carry it — so the free-slot count is `2 −` the number of *distinct*
slot labels in that column, and it comes back in the same call as the board. Nothing else counts
sessions, and nothing may — not even if `list_sessions` turns out to be reachable, because it reads
state the board already carries at a cost the board does not have (~140k characters at `limit=100`,
measured 2026-08-18; 62k characters for 40 rows on 2026-09-02).

**An in-flight issue carrying NO slot label occupies no slot, and that is deliberate.** The
ordinary cause is a hand move — the owner does that — and freezing the queue over it is the
never-clearing shape this queue has been bitten by twice. A session that dies between the status
write and the label write leaves the same state; the accepted cost is one extra session in flight,
against a freeze on every hand move.

Read `CLAUDE.md` fully before acting — it is auto-loaded, and it is the contract. Workspace
`lets-ride`, team **Pedro & Dave** (`PD`), project **Let's ride (AI)**
(`88f3f224-ecf0-46f0-a032-c86b7a12f81c`). Note the curly apostrophe in that name; pass the id,
never the name.

---

## STEP 0 — Self-check, then the board

**Three things a build cannot do without, measured on every firing before the board is read.**
Each is a `ToolSearch` by keyword or one git command, and none touches the board:

1. **Linear** — `+list_issues linear` and `+save_issue linear` both resolve.
2. **A PR** — `+create_pull_request github` resolves.
3. **Push** — `git push --dry-run origin HEAD:refs/heads/claude/self-check-probe` exits 0. A dry
   run creates nothing on the remote.

**All three pass → carry on to the board check below.** Then, once only: `list_comments
issueId=PD-241`, and if no comment headed `**Inventory firing —` exists there at all, post the full
inventory (below) as that comment and carry on — the record gets the measured table without anyone
having to read it first.

**Any of the three fails → this firing cannot build, so it measures and stops:**

- `list_comments issueId=PD-241` first. If a comment headed `**Inventory firing —` is already there
  from the last 24 hours, **end with the line `self-check failed — read PD-241`** — never `idle`,
  which is the word for a healthy queue with nothing to do. A comment an hour is the shape STEP 6's
  stall marker exists to prevent. If Linear itself is the missing piece, that line is the whole of
  what this session can say; a fresh-session Routine carries its run's final message in the push
  notification it sends.
- Otherwise post ONE Linear comment on **PD-241** headed `**Inventory firing — <UTC date and
  time>**`, with the attribution footer `CLAUDE.md` requires, carrying the full inventory: which of
  the three failed, and one line per probe below — *resolved*, or *No matching deferred tools
  found* — plus every tool name you can see whose name starts with `mcp__`, verbatim, and the
  first line of the dry run's output.
  - `select:mcp__Claude_Code_Remote__create_session,mcp__Claude_Code_Remote__get_session,mcp__Claude_Code_Remote__archive_session,mcp__Claude_Code_Remote__list_triggers,mcp__Claude_Code_Remote__list_sessions`,
    and then each of the five by keyword (`+create_session claude code remote`, and so on) — only
    a keyword search coming back empty establishes absence, as the paragraph below says
  - `+create_pull_request github` and `+merge_pull_request github`
  - `+list_issues linear` and `+save_issue linear`
  - `+execute_sql supabase`
  - `+list_deployments vercel`
  - `select:PushNotification`
  - `get_session` with `session_id` omitted, **if** it resolved: the id and `permission_mode`
- **End with the line `self-check failed — read PD-241`.** Move nothing on the board, build
  nothing, spawn nothing.

**Why the gate is these three and not the whole list.** A firing that can read and write the
board, open a PR and push can finish a story; everything else on the list has a documented
fallback in `queue-pickup.md` — STEP 6 fails closed without `get_session`, STEP 7 keeps the session
without `archive_session`, STEP 5 bullet 5 ends with the notification line when
`PushNotification` is absent, and the deploy check says "unverified" without Vercel. Gating on
those would stop a queue that could have built.

**Can you see the board?** Load `list_issues` via `ToolSearch` and call it. A job that silently
does nothing looks exactly like an empty queue, which is why the self-check above stops loudly.

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

**`CLAUDE.md` §The Agent Squad's "a subagent cannot recover from inside itself" does NOT overrule
that.** You are a **main thread** and hold no `tools:` line, so nothing filters your search; that
paragraph describes a *subagent*, whose `ToolSearch` is filtered by its own allowlist before it
runs. Keyword search still recovers a rotated connector here — `PD-154`'s 2026-08-09 comment
records it — so run it before concluding anything is unreachable.

**A permission prompt has nobody to answer it.** A Routine-minted session runs unattended; a
classifier prompt on a pre-authorized call has stalled a firing before (PD-349, 2026-08-29, on a
Linear read granted twice over). Nothing in this file can prevent that. What it can do is keep the
number of calls before the first board read small, so a stall is cheap, and leave the board
untouched until STEP 5, so a stalled firing holds nothing.

---

## STEP 1 — Read the board, once

**Never type a status name from memory** — `list_issue_statuses team=Pedro & Dave` first, and use
the names it returns. Names have moved twice with nothing in the repo noticing, and a `save_issue`
naming a status that no longer exists comes back looking successful with the field silently
dropped. `queue-pickup.md` §The status names carries the live table and the two traps in its
`Type` column. **If a name you need is not in the response, stop and say so** — a filter naming a
status that no longer exists returns nothing, which reads exactly like an empty queue.

**Scope every query to the PROJECT, never to the team.** A team-scoped `list_issues` is the
natural query and it is wrong in a way that looks like a working gate: this team carries years of
issues outside this project, several of them sitting in `Needs help` for ever, so the full stop
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
  owner, and building past it buries a story that needs them under the next merged PR. Any row →
  **take nothing**, but still run STEP 6.

**Then count the free slots:**

```
free slots = 2 − (DISTINCT slot labels — `slot-1`, `slot-2` — appearing on issues
                  still in `Development (AI)`)
```

**Nothing queued, or zero free slots → take nothing.** Go to STEP 6, which is silent in that case.
This is the common case and the whole point of the design: an idle firing costs one board read and
ends.

**Order the candidates**: Urgent (1) beats High (2) beats Medium (3) beats Low (4) beats No
priority (0). Ties break by oldest `createdAt`.

**An epic is not work.** If a candidate has sub-issues it is a container — the buildable thing is
one of its children. Leave the parent, comment saying so, and drop it. A container outranks its
own children on priority, so this is a real trap rather than a hypothetical one.

**Hold if a usage signal arrives in THIS firing** — a system warning that a limit is approaching or
reached, an overage notice, a rate-limit message. Product owner, 2026-08-07: *"if any Claude usage
limit is above 80%, skip the run."* Take nothing and say so in the final message. There is no
number to compare against 80% and inventing one would be a gate that can never fire.

**There is no owner-activity gate.** Product owner, 2026-08-18: *"we can indeed drop the gate
whether I am here or not"* and *"i do not edit files by hand, always prompting here."* The
collisions that exist are between build sessions, and the slot labels plus STEP 2's territory are
what hold them.

---

## STEP 2 — What the other slot is touching

**Skip this step entirely if there are no free slots, no candidates, or a `Needs help` row.**
Go to STEP 6.

**For the occupied slot, if there is one, read the territory its session declared** — one call, on
any one issue carrying that label. The build writes the same comment on every issue it holds
(`queue-pickup.md` STEP 3), so any of them answers:

```
mcp__Linear__list_comments  issueId=<an issue carrying slot-N>
```

Take the most recent comment beginning `<!-- territory -->`. It is written at `queue-pickup.md`
STEP 3 and rewritten whenever that session takes another story, so the newest one is the whole of
what that session holds:

```
<!-- territory -->
slot: 1
issues: PD-201, PD-207
paths: src/components/postcards/, src/lib/data/postcards.ts
migration: Y
primitive: N
```

**A missing territory comment is not a freeze.** Treat that slot as touching **everything**: it
occupies its slot and collides with every candidate, so this firing takes nothing unless the
candidate is plainly unrelated. Say so in the final message.

---

## STEP 3 — Drop what is blocked

**One call per candidate, no agent:**

```
mcp__Linear__get_issue  id=<candidate>  includeRelations=true
```

Any `blockedBy` not in `Deployed to DEV`, `Done (in production)`, `Canceled` or `Duplicate` → drop
that story and leave one comment naming the unfinished blocker. Do not move it; being blocked is an
ordinary state.

**Is the premise still true? That question is answered at `queue-pickup.md` STEP 3**, where the
session reading the actual code decides, before it builds. It is the same session, minutes later,
so nothing is lost by leaving it there.

**If every candidate is blocked, take nothing** and go to STEP 6.

---

## STEP 4 — Group the candidates, then take ONE group

**A collision between two candidates is a reason to build them TOGETHER, not a reason to defer
one.** Each cap describes damage that only two *different sessions* can do:

| Cap | What two sessions do | What one session does |
|---|---|---|
| **`paths`** | Conflict on the second merge — loud and cheap. Worse, each is reviewed against a `development` containing neither, so `reviewer` gives an honest verdict on a file that will not exist once the other lands | Edits the file once, with both changes in front of it |
| **a migration each** | Both write `101_*.sql`. Both land, both apply, and this repo already has a chain (`041 → 044 → 046`) where the wrong order succeeds with **nothing red**. They also apply to the same DEV database, which unlike the test database and the dev-server ports **is** shared across containers | Writes `101`, then `102`. The ordering is by construction rather than by luck |
| **a shared primitive each** | Two divergent implementations of the same component under `src/components/ui/` or `src/components/icons/`. Nothing conflicts, nothing fails, and the result is `CLAUDE.md`'s *individually correct and collectively inconsistent* | Writes one implementation and uses it twice |

**Judge the collision from the board, not from a prediction.** You have each candidate's title,
description and labels, and you may read the issue itself (`get_issue`) — that is the whole budget
before the claim. Two stories collide when a careful reader would say they are the same area of the
app: the same route tree, the same table, both adding a migration, both touching a shared primitive.

**When you cannot tell, group them.** Grouping is the safe direction: its cost is a slightly bigger
diff in one review, and the cost of getting it wrong the other way is the three failures in the
table above.

**Drop anything colliding with the live slot's territory.** You cannot merge a candidate into a
branch another session is building, so it waits for a later firing. Where the collision is with a
missing territory comment, see STEP 2.

**The group ceiling — at most 3 issues, and at most one `L`.** Size a candidate from its issue:
**`S`** a copy fix, a doc line, a single component · **`M`** the ordinary story · **`L`** a new
route with its data layer, a migration plus the screens that read it, or anything you would expect
to touch more than ~10 files. A group holds at most **3** issues; at most **one** `L`; and a group
containing an `L` holds at most **2**. So two `L` stories never travel together even though two
issues clears the count. **The bound is the `reviewer` pass**: one group is one branch, one PR and
**one** review, and `queue-pickup.md` STEP 4b already refuses a fold-in that *"would grow the diff
past what one `reviewer` pass can honestly cover"*.

**Over either ceiling, take the highest-priority members that fit and leave the rest.** They are
not lost — they collide with the group just admitted, so the next firing sees them queued and the
territory comment holds them until this group merges.

**This firing takes exactly ONE group, into ONE free slot — the highest-priority group that clears
the caps against the live territory.** A second free slot is the next firing's. That is the price
of a design with no session that can spawn another, and it is the whole price: a story waits at
most an hour longer than it would have under the batch design, which never actually ran.

---

## STEP 5 — Claim it, then become the build session

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

   **If any of them did not take, move back the ones that did, take nothing, and say so in the
   final message naming the issue and which field failed.** A part-claimed group is a race with
   extra steps — and a silent rollback is worse than the race, because the label is the whole lock:
   if `slot-1` and `slot-2` were renamed or deleted, *every* claim drops its label, *every* group
   rolls back, and the queue exits quietly every hour against a full column. **That message is the
   only detector the lock has for its own failure.**

2. **Read the write back for a second claimer as well as your own fields.** Two firings cannot
   overlap on an hourly cron, but the owner may have moved something in the seconds between STEP 1
   and here. Confirm the status is `Development (AI)`, **your** slot label is on it, and the *other*
   slot's label is **not**. Any of those wrong → release it back to `Queued (AI)`, strip your
   label, and take nothing.

3. **You are now the build session.** Everything the old dispatcher put in a child's prompt, you
   already know: the issues, their order (by priority, ties by `createdAt`), your slot label, why
   the group travels together, and the other slot's territory from STEP 2. **Write those five things
   down in your own words before you open `queue-pickup.md`** — a one-paragraph note in your
   transcript, in the shape below — because that file reads "your prompt" for each of them and you
   are the one who has to answer.

   ```
   Building, in this order: <id>: <title> · <id>: <title>
   Slot label: slot-N — on every issue above, and on anything else I pick up.
   One group because: <the overlapping area, or "both add a migration", or "both change a
   shared primitive"> — or "a group of one".
   The other slot holds: <the territory read at STEP 2, verbatim — or "nothing">. I do not touch
   its paths; if the build genuinely needs to, I park into `Needs help` rather than editing across
   the boundary.
   Premise, blockers and territory: still to do at queue-pickup.md STEP 3.
   ```

   **Then run STEP 6 — the stall check — and only after it read [`queue-pickup.md`](queue-pickup.md)
   and follow it from STEP 3.** STEP 6 is the last thing this file does; nothing after the handover
   comes back here, so a claim that skips it leaves the queue's only self-detection unrun on exactly
   the firings that build. The stories are already in `Development (AI)` with your label, so confirm
   rather than re-claim. That file is the authority from there on, including its exits: `Needs help`
   with a comparison table when stuck, `Needs decision` on a stale premise, `Deployed to DEV` when
   the thing the title names exists — and its STEP 2c, *out of sequence mid-build*, still applies
   during its STEP 4 even though you never passed through it.

   **Three of its steps expect tools a Routine-minted session may not hold, and each already says
   what to do without them.** STEP 6's budget gate reads `get_session` and **fails closed** — no
   tool, no second story, end after this group, which is the expected shape now. STEP 7 reads
   `get_session` and `archive_session` and **fails open** — no tool, the session is kept, and a
   trigger-run session is not in the owner's ordinary session list, so that costs nothing. STEP 5
   bullet 5 sends `PushNotification` — if that tool is absent, **the final message of this session
   is the notification**: a fresh-session Routine pushes its run's closing message to the owner's
   phone, so end with the `Done ; ) <issue ids> <short title>` line that bullet would have sent.

---

## STEP 6 — The stall check, then end

**This step runs on EVERY firing that reached the board, whether or not anything was taken** — a
claimed issue with nobody behind it holds a slot, and the board is now the only place that can
notice. STEP 1 sends an idle firing here; STEP 5 bullet 3 sends a firing that claimed a group here
**before** it opens `queue-pickup.md`, because the build ends in that file and never returns.

Ask how long the oldest of these has been true:

- **An issue in `Development (AI)` carrying a slot label this firing did not just claim** — on an
  idle firing that is either label; after a claim it is the other one. Its session should have
  finished. Age the branch tip if there is one, because a live build keeps resetting it and a dead
  one does not:

  ```bash
  git ls-remote --heads origin | grep -i "pd-<n>"          # gitBranchName is a guess; this is not
  git fetch origin "<ref>" --quiet && git log -1 --format=%ct "origin/<ref>"
  ```

  **This repo's branches are `claude/<slug>` and usually carry no issue id**, so that grep
  legitimately finds nothing on a healthy build. Fall back to the issue's
  `stateHistory[].startedAt` — and read a no-branch result as *unknown*, not as *dead*.
- **A `Needs help` issue** — `get_issue` → `stateHistory[].startedAt`. It is a stop by design and
  it still ages: an issue nobody has come back to for hours is worth telling the owner about.

**If the oldest is more than 3 hours old, say so in the final message naming it — and record that
you did**, as a comment beginning `<!-- stall-alarm slot:<N> -->` on that issue, or
`<!-- stall-alarm slot:none -->` where there is no label. **Never alarm on an issue that already
carries one.** A slot holds several issues, so look for the marker across all of them and write it
on just one. **Fall through when the oldest subject is already alarmed**, rather than stopping:
take the next oldest that is not.

**A stalled slot is not cleared automatically, and the owner is the one who clears it.** They move
the issue back to `Queued (AI)` and strip the label, which frees the slot on the next firing. An
age-based reaper that returns a story a live session is still building is the one failure worse
than a held slot, and nothing here can tell those apart.

**Then: a group was claimed at STEP 5 → open `queue-pickup.md` at STEP 3. Nothing was claimed →
end**, with the final message below.

### What the final message says, and what it does not

**A fresh-session Routine pushes its run's final message to the owner**, so the last thing this
session says is the whole of its reporting. Keep it to one or two lines, in this shape:

- **A group was taken** → `Queue run: took PD-201 + PD-207 into slot-1` — then the build's own
  closing line, which `queue-pickup.md` STEP 5 bullet 5 specifies (`Done ; ) …`), is the last
  line of the session. If `PushNotification` resolved, that bullet sends it too; a duplicate is
  harmless and an absent one is not.
- **A stall or a hold that nothing ages** → one line naming it, once per condition.
- **Empty queue, every candidate blocked, no free slot, `Needs help` occupied** → **end with no
  message at all beyond a single word, `idle`**, so the notification the Routine sends is one the
  owner can dismiss without reading.
- **The self-check failed** → never `idle`: `self-check failed — read PD-241`, on the firing that
  wrote the inventory and on every firing after it until it passes. The queue is not running, and
  the notification must not read as if it were.

**No `fire_trigger`, no `send_later`, no `create_session`, no message to any session — ever.**
Product owner, 2026-08-18: *"when the development ends, I dont want those new sessions to report
back to the routine. It will just pick up new stories on the next hourly run."* The hourly Routine
is the only clock. **A freed slot waits for the top of the hour**, and that is the accepted cost of
one clock. A session that re-arms a check-in to watch something was measured on 2026-08-18 at 84.5M
cache-read tokens across 18 wakes, having built nothing since the first.

---

## Why this shape

**What a Routine-minted session can and cannot do here, with how each row is known — and the
design's board half uses only the rows marked measured.** STEP 0's self-check measures the three
a build needs on every firing, and the first firing that passes writes the whole table's answer to
PD-241.

| A Routine-minted session… | How it is known | Consequence |
|---|---|---|
| holds the repo checkout when the Routine attaches one | **Measured** 2026-08-17: a firing with no repo prompted for every Linear call — no `.claude/settings.json`, no grants | this file, `CLAUDE.md` and the grants load on every firing, fresh |
| holds the connectors attached to the Routine | **Measured** 2026-08-17 onwards: Linear, Supabase, Vercel answered every relay's board reads | the board, the database and the deploy check are reachable |
| does NOT hold `create_session` | **Inferred**, unconfirmed: every relay since 2026-08-18 answered with ~40–80 output tokens and no dispatcher was ever spawned by a firing (PD-241, 2026-08-27 and 2026-09-02). No session can read another's transcript, so the call itself was never observed | nothing here spawns a session; STEP 0 probes it |
| does NOT hold `get_session`, `archive_session`, `list_triggers`, `list_sessions` | **Extrapolated** from the row above — the same tool family, nothing measured | nothing here needs them; `queue-pickup.md` STEP 6 and STEP 7 say what to do without them, and STEP 0 probes each |
| holds git push credentials | **Unmeasured** — the relay's config carried an outcome branch, and no firing has ever pushed | STEP 0's dry run measures it before the first build |
| can be stalled by a permission prompt nobody answers | **Measured** 2026-08-29 (PD-349), and the account's other Routine on 2026-09-02 | STEP 0 keeps the calls before the first board read few, and STEP 5 is the first write |
| is a fresh checkout every time | by construction — a fresh session per firing | **an edit to this file arrives at the next firing.** No relay to archive, no clone to age |
| is excluded from the ordinary session list | **Measured** 2026-09-02: the relay carried `origin: scheduled_trigger` and the tags `config:routine-lineage-none`, `routine:agent-minted` on `get_session`, and was absent from a 40-row `list_sessions` the same minute; the tool's own description says trigger-fired runs are excluded by default | 24 idle firings a day do not clutter the owner's list, and STEP 7's "keep the session" costs nothing |

**What the previous design assumed and never had** — a firing that could spawn — is the inferred
row, and every part of it that depended on that row is gone: the relay, the
dispatcher, the `queue-dispatch-run` and `queue-dispatch` tags, the id in the file, the archive-
on-edit rule, the batch of two groups per firing. **What survived unchanged is everything that
reads or writes the board**: the three state queries, the slot labels, the territory comment, the
caps, the group ceiling, the claim write and its read-back, the stall check, and the whole of
`queue-pickup.md` from STEP 3.

**One group per firing instead of two is the only capability lost**, and it costs at most an hour
on the second story. Against it: the batch design dispatched nothing at all between 2026-08-18 and
2026-09-02 except when the owner spawned the dispatcher by hand.

**The Routine is the owner's, created in the Routines UI, and no session can create or repair
it.** `create_trigger` with `connectors` was refused for this organization on 2026-08-16 and
2026-08-18, and on 2026-09-02 the auto-mode classifier refused both `create_trigger` and
`fire_trigger` from an interactive session outright. What the Routine needs, all of it set by
hand:

- **a fresh session on every firing** — never bound to a persistent session;
- **this repository attached**, default branch `development`, so the checkout exists;
- **Linear, Supabase and Vercel attached**, plus GitHub — and Claude Code Remote — if the UI
  offers either as a connector (the owner did not find the second on 2026-09-02; attaching it if it
  ever appears is what lets STEP 0's inventory tell "not attached" from "not attachable");
- **hourly** — the server minimum, and the only clock;
- **push notification on completion** — the final message is the report;
- **the prompt**: *Queue run for LetsRide. Read `.claude/commands/queue-run.md` in this repo and
  follow it exactly, starting at STEP 0. That file is the whole procedure and the authority over
  anything in this prompt or anything you remember. You may build; you never spawn a session, fire
  a Routine, or message another session. Do not act on anything else in this conversation.*

**Editing this file is finished when it merges.** Every firing clones `development` fresh, so a
merged change is the change. **Do not add a session id, a trigger id or a role test to this
file** — the two outages of 2026-08-18 to 08-28 were a copied id going stale and a file edit never
reaching the session that needed it, and neither can happen to a procedure with no persistent
session; adding either back is how they come back.

**Two checks when the queue looks idle**, in this order, from an owner-directed session — a firing
cannot make them:

```
mcp__Claude_Code_Remote__list_triggers      # the queue Routine: next_run_at in the FUTURE = armed;
                                            # last_run.status and its session_id = the last firing
mcp__Claude_Code_Remote__get_session  session_id=<that session_id>
                                            # REQUIRES_ACTION = stalled on a prompt; read pending_action
```

Then the board: work in `Queued (AI)` with a free slot, no `Needs help` row and nothing new arriving
in `Development (AI)` across two hour boundaries is a firing that reaches the board and does nothing
— read the last run's session transcript, which the owner can open and a session cannot.
