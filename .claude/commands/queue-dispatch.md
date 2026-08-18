---
description: Hand each queued story, or each group of colliding stories, to its own session
---

# Queue dispatch

**This procedure picks work and hands it out. It never builds anything.** The build is
[`queue-pickup.md`](queue-pickup.md), which runs in a *different session* — one per **group**,
spawned here, each with its own container, its own branch and its own empty context window. A
group is usually one story; it is more than one exactly when the stories collide, which STEP 4
explains.

That split is the whole design. Read §Why this shape before changing any of it.

**The moment this session builds something it becomes the old Development session again** — context
accumulating across firings, one story at a time, and a `/clear` nobody can perform from inside.
Read the board, scout, spawn, exit. Nothing else.

**The shape, as the owner stated it on 2026-08-18** — check each half against the step that owns
it rather than trusting this paragraph, which is a map:

> *"every hour the routine runs, spawns a max of 2 sessions. Each session can pickup a group of
> stories if applicable. Sometimes it may not make sense to spawn the 2 sessions, for eg. if there
> are no stories that can be done in paralel, no stories available etc."*

One firing an hour (STEP -1), at most two children in flight at once (STEP 4), a group of up to
three colliding stories per child (STEP 4), and every reason a firing dispatches fewer — a held
gate, a parked story, a cap, a collision, an empty queue, a stale candidate — is a step of its own.
**Fewer than two is a normal firing, not a fault**, and a firing that dispatches nothing is
silent.

Read `CLAUDE.md` fully before acting. Workspace `lets-ride`, team **Pedro & Dave** (`PD`), project
**Let's ride (AI)** (`88f3f224-ecf0-46f0-a032-c86b7a12f81c`). Note the curly apostrophe in that
name; pass the id, never the name.

---

## The three roles, and how to tell which you are

| | Relay | Dispatcher | Child |
|---|---|---|---|
| Started by | the hourly Routine — the only clock there is | `create_session` from the relay | `create_session` from the dispatcher |
| Reads | STEP -1, and nothing else in this file | this file, from STEP 0 | [`queue-pickup.md`](queue-pickup.md) |
| Holds | nothing — it decides nothing | the board, the caps, the batch | its group's issue ids, given in its prompt |
| Ends at | one session spawned | children spawned | every issue in its group at `Deployed to DEV` |
| Carries the tag | no — it **is** `session_01B2mxc642tG8vZ15wysQpqM` | **`queue-dispatch-run`** | **`queue-dispatch`** |

**A child never dispatches.** One level, no chaining — a child that spawns a child has no view of
the caps below and cannot enforce them, so the batch guarantees quietly stop holding while
everything still looks healthy.

**Which of the three you are is decided by your own session id**, and STEP -1 is where you read
it. The relay is `session_01B2mxc642tG8vZ15wysQpqM` — the session the Routine is bound to, and the
only one this file names. The fallback if the Routine is ever rebound is that session's own
`Claude-Session: https://claude.ai/code/<id>` line, the one used for commit trailers. STEP 1
cannot exclude the relay from its own gate without this, and a gate that counts the firing itself
never passes.

---

## The relay, and why the bound session decides nothing

**The Routine fires into one persistent session and always will.** `update_trigger` has no
`persistent_session_id` parameter, and switching that Routine to `create_new_session_on_fire`
loses five things at once that no session can restore — the repo, the model, the effort level, the
permission mode and the connectors. `create_trigger` still refuses the `connectors` parameter for
this organization, re-measured 2026-08-18 against a throwaway one-shot: *"the connectors parameter
is not available for this organization."*

**So the reuse is moved rather than removed.** The bound session spawns a fresh dispatcher and
exits. Every board read, every scout verdict, every cap decision and every question belongs to a
session that did not exist an hour ago, and the reused session holds two state reads and one
`create_session` call per firing.

**It reads state, never the board, and the line between them is the whole discipline.** Is the
Routine on, and is a dispatcher already in flight — two booleans, both about the queue's own
machinery. A relay that reads one issue has started deciding, and the step it is deciding instead
of is the one that costs 34k of process docs to do properly.

Product owner, 2026-08-18: *"i think our routine is reusing sessions from other topics... This
does not seem like a good practice."* It was reusing exactly one — the bound session, live since
2026-08-07 — and this step retires it from deciding anything.

**What that buys is the three costs the top of this file already names** — context accumulating
across firings, a `/clear` nobody can perform from inside, and a firing landing mid-conversation
with the owner. The relay pays none of them, because it reads nothing and decides nothing.

**What it costs is one extra session per firing, and less than it looks — but only because STEP -1
says the relay does not read `CLAUDE.md`.** Every firing already re-read `CLAUDE.md` and this file,
so the fresh dispatcher pays what the persistent one was paying anyway; the addition is one
session's own fixed overhead, and the subtraction is a transcript that had grown for eleven days.
Drop that one instruction and the arithmetic inverts — the relay reads 34k of process docs to make
one call, and the firing pays for it twice.

**Spawning through `create_session` is what makes this work at all**, and it is a different path
from a trigger-spawned session rather than the same thing at a different depth. §Why this shape
carries what was probed, what it does not cover, and why the gap is survivable.

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

**If you are `session_01B2mxc642tG8vZ15wysQpqM`, you are the relay.** Two checks, one call, then
exit. **Read no board, run no other step of this file, and do not read `CLAUDE.md`** — the
instruction at the top of this file to read it fully belongs to the dispatcher. The relay's entire
value is that its transcript grows by a few hundred tokens a firing, and reading 34k of process
docs to make one call throws that away while looking diligent.

1. **The switch — is the queue even on?** `list_triggers` and read
   `trig_01WJkMVXGzUVGDcC1njNmaan` exactly as STEP 1 does: `enabled: true` and nothing else is on,
   a disabled row simply lacks the key, and an `InputValidationError` is a deferred schema rather
   than a failure — `ToolSearch` and call it again. **Not on → exit silently, spawning nothing.**
   This check is here rather than only in STEP 1 because a `fire_trigger` against a disabled
   trigger is accepted rather than refused, so a hand-typed poke would otherwise still burn a
   session to discover the queue was stopped. **If the call cannot be made at all, spawn anyway** — STEP
   1 holds on an unreadable switch and notifies, and a switch you cannot read is not a licence to
   stop the queue silently.
2. **Is a dispatcher already in flight?** `list_sessions mine=true limit=100`, and look for a
   session tagged `queue-dispatch-run` whose `session_status` is RUNNING **or PENDING** — a
   just-spawned session is PENDING for its first seconds, which is exactly the window this check
   has to cover.
   - **One is in flight and its `updated_at` is inside the last 30 minutes → exit silently.** Two
     dispatchers reading the board at once both compute the same free slots and can claim the same
     issue: a status write is not compare-and-swap, and STEP 5's dispatch record is written *after*
     the spawn, so neither sees the other. Delivery into one persistent relay serialises the
     firings themselves — its turns run one at a time — and this check is what extends that
     serialisation across the sessions they spawn.
   - **Between 30 minutes and 3 hours old → hold, and send one `PushNotification` naming the
     session.** Spawning past a dispatcher that may still be working risks two children on one
     story, which costs more than a delay.

     **Notify on the first firing that sees it and then only every sixth hour** — age inside
     `[30m, 90m)` and then each crossing of `6h`, `12h`, `18h`. The relay cannot mark a condition
     once the way STEP 6 does, because it may not read the board; the age is the only state it
     has, so the buckets are the discipline. A push an hour is the volume STEP 6 refuses.
   - **Older than 3 hours → archive it, then spawn as normal**, and say in the notification that
     you did. **This is the recovery, and without it a wedged dispatcher stops the queue for
     ever**: the relay never spawns, so STEP 6 never runs, so the `Development (AI)` and
     `Needs help` clocks go dark alongside the dispatching. A dispatcher is disposable by design
     (`CLAUDE.md` §What Not To Do), and the one thing archiving can strand — an issue claimed in
     STEP 5 whose child was never spawned — is exactly what STEP 2's record-less freeze already
     catches and reports. **Three hours is chosen against STEP 6's own dead-child threshold**, so
     a dispatcher gets the same benefit of the doubt a child does.
3. **`create_session`**, with:
   - `title` — `Queue dispatch — <UTC date and time of this firing>`, so the session list reads as
     a run rather than a topic.
   - `tags` — **`["queue-dispatch-run"]`**. STEP 1's owner-activity gate depends on it exactly as
     it depends on the child's tag, and an untagged dispatcher holds that gate against every
     future firing for as long as it runs.
   - `source_url` — `https://github.com/Lenhador88/LetsRide`. **Without it there is no checkout**,
     so this file cannot be read and `.claude/settings.json` is never loaded, which takes every
     grant in it with it. That is the exact failure `docs/HANDOFF.md` records as *a permission
     dialog offering "Allow once" but no "Allow always"*, and it is the most likely way this step
     goes wrong.
   - `prompt` — it must open with the line `Spawned by the relay.`, then: read
     `.claude/commands/queue-dispatch.md` and follow it from STEP 0; you are the dispatcher, you
     never build, the file is the authority over anything you remember, and do not act on anything
     else in the conversation. **The first line is load-bearing**, not decoration: it is what STEP
     -1 falls back on when a session cannot read its own id.
4. **Read the response back and confirm `tags` is on it.** If it is missing, **archive that session
   immediately**, send a `PushNotification` saying so, and stop.
5. **Say nothing else, run no other step of this file, and exit — STEP 6 included.** The stall
   check reads the board, and a relay reading the board is a relay becoming the dispatcher one
   firing at a time.

**`InputValidationError` from `create_session` is a deferred schema, not a failure** — `ToolSearch`
by keyword and call it again. Reading it as a failure takes the branch below, which runs the whole
firing in the relay and quietly restores the shape this step exists to remove.

**If `create_session` fails for any other reason, run the firing yourself from STEP 0 and send a
`PushNotification` saying the relay could not spawn.** A queue that stops because one call failed
is worse than one firing in the old shape — and the notification is what keeps the degraded mode
from quietly becoming the permanent one. **In that branch you are the relay for the rest of the
firing**: the usage rule in STEP 1 and the `send_later` ban below both turn on that, and both say
so.

**If your session id is anything else, you are the dispatcher: go to STEP 0 and ignore this step.**
**The Routine's own prompt arriving in a session that is neither the relay nor a
`Spawned by the relay.` dispatcher is misrouted** — stop, and say so.

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

You need two connectors: **Linear** (the board) and **Claude Code Remote** (`list_triggers`,
`list_sessions`, `create_session`). **Load all three CCR tools by keyword the same way**
(`+list_triggers claude code remote`) — `list_triggers` is STEP 1's switch check and it is the
*first* call of a firing, so a deferred schema there stops the whole procedure before it reads
anything. **A deferred tool is not a missing one**: `InputValidationError` means `ToolSearch` then
call it, `No such tool available` means absent. STEP 1's failure branch depends on this
distinction and gets it wrong at your cost, not the tool's.

**Git is read-only and only for STEP 6's clock** — `git ls-remote`,
`git log -1` on a remote ref, nothing else. You never check out, never write a file, never touch
Supabase, Vercel or the GitHub API. **Reaching for any of those means you have started building**,
which is this file's one prohibition.

**Send notifications yourself, with the `PushNotification` tool.** A Routine bound to a persistent
session cannot carry them: the server rejects the `notifications` parameter for any such trigger,
so the only notification that will ever reach the owner is one this session sends.

---

## STEP 1 — Is the queue switched on, and is the owner working?

**Two gates, in this order, and they exit differently.** The switch is asked first because it is
the more decisive answer: a queue the owner has turned off has no board worth reading.

### The switch — does the Routine still read `enabled: true`?

**This Routine has been observed firing while disabled, and the explanation that fitted at the
time has since been removed from the design.** On 2026-08-17 `trig_01WJkMVXGzUVGDcC1njNmaan`
carried no `enabled` key — it was off — and its `last_fired_at` moved from `15:40:05` to `17:37:11`
inside a four-minute window while a session watched it. The hourly cron cannot explain that
(`next_run_at` was stale at `16:05`), and the completion poke that did explain it is gone:
`queue-pickup.md` STEP 5 bullet 6 now tells every child to send nothing at all.

**Both firings are explained by that poke, measured rather than inferred**: `origin/development`
carries #238 merged at `15:38:35Z` and #241 at `17:35:20Z` — one to two minutes before each
`last_fired_at`, which is the length of STEP 5's tail. So the cause is gone with the poke, and the
gate now stands on the *other* thing this section measured: a hand-typed `fire_trigger` is accepted
against a disabled trigger.

```bash
TZ=UTC git log --format='%cd %s' --date=iso-strict-local origin/development | grep '(#2'
```

The API half was probed the same day against a throwaway self-bound Routine, and agrees:
`update_trigger enabled=false` took — the `enabled` key *disappears* from the response, which is
how a disable is read back — and `fire_trigger` against it afterwards returned **success with an
execution session id**, indistinguishable from the same call against the same trigger enabled.
Nothing refused it.

**With the pokes gone the switch now stops every dispatch on its own, and this gate is what makes
that a fact rather than an expectation.** It used to be decorative while looking like a control —
the children handed the queue back to itself, so disabling the Routine stopped only the heartbeat.
Nothing hands it back now; what remains is a hand-typed `fire_trigger`, which is accepted rather
than refused, and reading the field is cheaper than trusting that nobody types one. **"Every
dispatch" is not "everything"** — see below: a child already building runs to completion whatever
the switch says.

```
list_triggers  limit=100
```

Find `trig_01WJkMVXGzUVGDcC1njNmaan` and read it:

- **`enabled: true`** → the queue is on. Go to the owner-activity gate below.
- **Anything else on a row that is present** → **off. Exit immediately: dispatch nothing, read no
  board, run no stall check, send nothing.** Write the test that way round rather than looking for
  `"enabled": false`, which never appears — a disabled row simply lacks the key. `ended_reason`
  and `suspension_reason` are the two other ways a row reads not-on, and treating all three alike
  is correct: none of them is a queue the owner expects to be running.
- **Absent from the response** → **not the same thing as off.** Page first with
  `cursor=<next_cursor>` before concluding it. Genuinely absent means the Routine this session
  runs on no longer exists, which is one `PushNotification` and no dispatch.
- **`InputValidationError`** → the schema arrived deferred. `ToolSearch` by keyword and **call it
  again**; this is not a failure and must not be read as one.
- **The call fails for any other reason** — the tool is absent, the connector is unreachable →
  **HELD, never open**, for the reason the `list_sessions` failures below are: a gate with no data
  has not passed. Fall through to the stall check, dispatch nothing, **and send a
  `PushNotification` saying the switch could not be read**, once per condition.

**The notification is not optional here**, for the reason the two `list_sessions` failures below
carry one: this is the first call of a firing, so if it will not resolve then *every* firing takes
this branch, and STEP 6 is silent with nothing in flight to age.

**The silent exit is the one place this file leaves without running STEP 6, and that is
deliberate.** An owner-activity hold is involuntary and temporary — the queue is meant to be
running, so its clocks still matter and a dead child must still age into view. A disable is
neither: the owner took the queue out of service on purpose, and alarming hourly about a queue
they stopped is a push an hour about a decision they already made.

**It does cost one real thing, and the cost is not the story they stopped — it is the child that
was already running.** A child dispatched minutes before the switch went off keeps building
(see below), and if it dies its issue sits in `Development (AI)` where nothing reaches it: every
later firing exits here, so neither STEP 6's age clock nor STEP 2's `ARCHIVED` → back-to-
`Queued (AI)` recovery ever runs. It self-heals the moment the queue is re-enabled, and the owner
has a manual path, so this is an accepted cost rather than an oversight — **do not reason from the
paragraph above that no story can be stranded here, because one can.**

**What the switch does not do: it cannot stop a child already building.** Children are spawned,
not scheduled, so nothing routes a running one back through this Routine — it finishes, merges its
PR and moves its issue however the switch is set. Stopping those too is the owner archiving the
sessions tagged `queue-dispatch` and moving their issues back to `Queued (AI)` — **and any session
tagged `queue-dispatch-run` with them**, since a dispatcher that passed this gate before the switch
went off will still claim and spawn. `CLAUDE.md` §What Not To Do permits archiving both and forbids
it only for the relay.

**The check belongs here, in the one chokepoint every spawn passes through** — the hourly firing
and any hand-typed `fire_trigger` alike. That was true when children poked too, and removing the
poke did not move it: a check on the way *out* of a build guards only that path.

### The owner-activity gate

**The owner's own instruction: do not dispatch while the owner has a session actively working.**
Product owner, 2026-08-16, approving this design: *"Just keep the gate of an active session from
myself."*

```
list_sessions  mine=true  limit=100
```

**A hold here means "dispatch nothing", never "stop" — go to STEP 2, read the board, and run
STEP 6.** Every stall clock in this file reads `Development (AI)` and `Needs help`, and STEP 2 is
the only place that reads them, so a firing that stops at this line has no way to notice a dead
child. That matters most exactly when this gate is held: the owner works a six-hour stretch, every
firing in it holds, and a child that died at the start ages straight through the alarm window
unseen. Read the board even when you will not act on it.

**Hold if any session in that list is `SESSION_STATUS_RUNNING` and is none of these four: this
session, the relay (`session_01B2mxc642tG8vZ15wysQpqM`), a session tagged `queue-dispatch-run`, or
one tagged `queue-dispatch`.** Read the tag and the id in the same pass — the tag is the primary
signal, and a row lacking it is queue machinery only if `origin` is `claude_code_mcp_seed` *and*
its `parent_session_id` is the relay or a session tagged `queue-dispatch-run`. **Apply that
cross-check inside the rule, not as a footnote**, or an untagged child holds the gate for its whole
build.

**That cross-check reads the relay's id and the run tag rather than "this session", and it has to.**
Every child alive when you run this step was spawned by an *earlier* firing's dispatcher, so a
version of the rule that matches `parent_session_id` against your own id can never match anything
and quietly becomes dead code — the untagged child then falls straight through to the permanent
hold below.

Both exclusions are load-bearing in different ways, and each is the cheapest failure in this repo
to write:

- **This session.** The dispatcher runs in a RUNNING session by definition, so a check counting
  every RUNNING session is held by the firing itself and can never pass.
- **The relay, and any other `queue-dispatch-run` session.** The relay is RUNNING for the moment it
  takes to spawn you, and both it and a still-finishing earlier dispatcher are the queue's own
  machinery rather than the owner working. Excluding them by tag is what keeps STEP -1 from
  gating every firing off at the step after it.
- **Children.** They are RUNNING for the whole length of a build, so counting them gates the
  dispatcher off permanently the moment it spawns its first child — the same never-clearing shape
  from the other side.

`SESSION_STATUS_IDLE` and `SESSION_STATUS_ARCHIVED` both mean nothing is executing; an idle
session the owner may come back to is not activity. **Key off `session_status`, not
`status_bucket`** — the bucket is a UI grouping that can be re-cut without the status changing.

**If a child is RUNNING but its tag is missing**, you cannot exclude it safely and you cannot
fix it from here. Hold, and send a `PushNotification` naming the session — an untagged child
suppresses every future dispatch, and unlike the other holds nothing ages it out.

**There is deliberately no 15-minute AFK proxy any more.** The old gate held the whole hour if the
owner had touched *any* session recently, which is why the queue effectively never ran while they
were working. It existed because one shared session meant a firing could land in the middle of
their conversation; with one isolated session per story that conflict is gone, and what remains —
"do not run a build alongside my live work" — is what the RUNNING check says directly.

**Claude usage headroom is the second half of that gate, and it survived the rewrite.** Product
owner, 2026-08-07: *"if any Claude usage limit is above 80%, skip the run."* **Hold if a usage
signal arrives in THIS firing** — a system warning that a limit is approaching or reached, an
overage notice, a rate-limit message — and send a `PushNotification` saying so.

**"This firing", never "anywhere in this conversation", and the distinction is the whole gate.**
For a dispatcher spawned by STEP -1 the two now coincide — its conversation *is* one firing — but
the rule stays and is not decoration: STEP -1's failure branch runs the firing in the relay, which
is a persistent session whose context accumulates and which no session can clear. Read as "anywhere
in this conversation" there, **the first rate-limit message that session ever received disables the
queue permanently**, and the `enabled=false/true` lever below does not clear it because pausing a
trigger does not touch a transcript. That is the never-clearing shape this very step warns about
twice, arriving through the one gate that reads history instead of state.

**There is no number to compare against 80%**, and inventing a threshold would be a gate that can
never fire. What was checked, so nobody re-derives it: `claude --help` has no `usage` subcommand,
`~/.claude` holds no usage file, and no environment variable carries one. **This matters more now
than it did**, not less: a firing used to start one build and can now start two children holding
several stories each, plus one scout
agent per candidate. The lever that works is the owner's:

```
update_trigger  trigger_id=trig_01WJkMVXGzUVGDcC1njNmaan  enabled=false   # pause
update_trigger  trigger_id=trig_01WJkMVXGzUVGDcC1njNmaan  enabled=true    # resume
```

**Two ways `list_sessions` can fail, and both mean HELD, never open.** Dispatching alongside live
owner work is the single outcome this gate exists to prevent, and failing open looks exactly like
a clean pass:

- **The call fails or the connector is unreachable.** Per STEP 0, a `select:` miss is a rename.
- **The page is too shallow to contain the owner's current work.** `has_more: true` is **not** that
  signal and must not be read as one: it is the norm and always has been. Measured 2026-08-18, one
  page at `limit=50` came back `has_more: true` with **28 of its 50 rows already ARCHIVED** —
  archived and idle sessions are returned alongside live ones, so the list only ever grows and a
  rule that holds on `has_more` holds for ever, on every firing, against a healthy queue.

  What actually matters is **how far back the page reaches**: rows come newest-first, so a page
  whose oldest row is younger than **48 hours** cannot be reasoned about — a RUNNING session on the
  next page is invisible. Read `created_at` on the last row; at `limit=100` today it reaches back
  about two weeks, which is why 48 hours is a tripwire rather than a routine hold. Hold and notify
  when it does not clear that floor.

**Both exits send their own `PushNotification`**, because a gate held with no data has no clock
behind it and STEP 6 therefore cannot age it. A stop nothing can age is a stop nothing reports.
**These two skip STEP 2's liveness check and go straight to STEP 6**, which is a narrower
consequence than stopping. The liveness check compares each dispatch record's `session` against
the session list, so without that list it cannot run — but STEP 6's issue-age and `Needs help`
clocks read only the board, and stopping short of them would reproduce the very gap this step's
"hold means dispatch nothing, not stop" rule exists to close. Read the board, run the clocks,
dispatch nothing.

---

## STEP 2 — Read the queue, and read what is already out

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c
```

- **Candidates** — everything in `Queued (AI)`. That is the only start signal. Never take work
  from `Backlog AI`, `Todo Human`, `Todo AI` or `Needs decision`; `Todo AI` is the one to be
  careful with, because the name reads like permission and is not one.
- **In flight** — everything in `Development (AI)`. Those are claimed by a child that is still
  working. **Do not dispatch them again, and do not treat them as a full stop on the queue the way
  `Needs help` is** — but you **must** read their dispatch records, because STEP 4's caps are
  evaluated against them and because **each live child occupies one of the two concurrency slots**
  — a child, not an issue, so several issues sharing one `session` are one slot. The count is
  below, after the liveness check that says which of them are real.

### The dispatch record — how a later firing knows what is in flight

**A firing that cannot see what an earlier firing dispatched cannot enforce any cap across
them**, and the caps are then worthless the moment the next hour turns while the first batch is
still building. So the record is written to the board, where it survives this
session ending:

```
mcp__Linear__list_comments  issueId=<each issue in Development (AI)>
```

Take the most recent comment beginning `<!-- dispatch-record -->` and read its `session`, `group`,
`paths`, `migration` and `primitive` fields. STEP 5 is what writes it.

**Several issues may name the same `session`, and that is a group rather than a fault.** Their
`paths`, `migration` and `primitive` are the group's union and identical across its members, so
the caps read correctly whether you evaluate them once per group or once per issue — and every
member independently carries the liveness check below, so an archived child returns all of its
issues without anything having to reason about the group at all.

**Check each record's `session` against the `list_sessions` response you already hold.**

- **`SESSION_STATUS_ARCHIVED` → the child is gone.** Move that issue back to `Queued (AI)`,
  comment saying the child ended without reaching `Deployed to DEV`, and **re-read the queue column
  before STEP 3 so it is a candidate in this firing**. Deferring it used to cost minutes, because a
  child's poke could be the next firing; with the cron as the only clock it costs an hour on top of
  however long the child took to die.
- **Absent from the list → freeze and notify**, exactly as for a record-less issue below. **Do
  not treat absence as death.** Nothing establishes that the list is complete for arbitrarily old
  sessions, and the plausible cause of absence — retention or pruning — bites hardest on the
  long-running child this check is meant to distinguish from a dead one. Unclaiming a *live*
  child's issue re-dispatches a story that is already being built, and STEP 3 of `queue-pickup.md`
  says plainly that nothing downstream can see it: both children read the status they expect.
  It would also retire that story's record from the in-flight set, so the migration cap would
  count zero and could admit two more writers of the same `060_*.sql`.
- **`SESSION_STATUS_IDLE` is not death either** — it is the ordinary state of a child between
  turns. Only `ARCHIVED` is positive evidence.

This is the one liveness signal that does not depend on a clock. STEP 6's age still works without
it, including with no branch to grep, so this is a faster detector rather than the only one.

**Now count the free slots**, because STEP 3's scout count and STEP 4's batch are both derived from
it rather than from a flat number:

```
free slots = 2 − (DISTINCT `session` ids among the dispatch records of issues
                  still in `Development (AI)` — after BOTH the liveness check
                  above and the record-less freeze below)
```

**Both, and the freeze is the one this formula cannot survive without.** An issue with no dispatch
record contributes no session id, so a live child whose record write failed is invisible here and
the count reads one too high — which is how three children end up in flight against a cap of two.
The freeze below is unconditional and stops the firing before any of that matters, so this is safe
today; it is written into the formula because a reader computing a number at this line and acting
on it has already gone wrong. **A `list_comments` call that fails for an in-flight issue is
indistinguishable from a record-less one, so treat it as the freeze too** rather than as a zero.

**Count children, not issues, and the distinction is load-bearing rather than pedantic.** The cap
the owner set is *"2 sessions in parallel max"*, and a group is one session holding two or three
issues — so counting issues would score a single child as two or three slots and starve the queue
by exactly the amount grouping was meant to win back. The `session` field on each dispatch record
is what makes the count possible, and its `group:` line is the cross-check: several issues naming
one session is one slot.

An issue you just returned to `Queued (AI)` because its child was `ARCHIVED` does not occupy a
slot; one whose session is `IDLE` does, that being the ordinary state of a child between turns.
**At zero free slots *or fewer*, dispatch nothing and skip STEP 3 as well** — scouting is the
expensive half
of a firing and there is no batch to scout for. Go to STEP 6, which is silent in that case.

**An in-flight issue with no dispatch record at all is a dispatch you cannot reason about**: it
was claimed by something that did not follow this file, or the record write failed between the
claim and the spawn. **Dispatch nothing this firing, and send a `PushNotification` naming the
issue.**

**That is a freeze, and it is deliberately stated as one rather than dressed up as a deferral.**
The alternative was to treat it as `migration: Y, primitive: Y` with "unknown paths" — which is
undefined at the path cap, and resolves either into this same freeze or into the path cap silently
not applying. A freeze that notifies immediately is better than either: it is visible in minutes,
and the owner clears it by moving one issue.

**Never widen the lock to "any issue whose statusType is `started`".** `Queued (AI)` and
`Deployed to DEV` are typed `started` too, so that version is held by every queued and every
shipped story: the queue freezes permanently while looking like a healthy job behind a busy
column.

**`Needs help` is a full stop for the whole queue, and that is deliberate.** An issue parked there
is waiting on the owner, and dispatching past it buries a story that needs them under the next
batch of merged PRs. If any issue is in `Needs help`, **dispatch nothing** — but still run STEP 6.

**Never type a status name from memory** — run `list_issue_statuses team=Pedro & Dave` before the
first status write. Names have moved twice with nothing in the repo noticing, and a `save_issue`
naming a status that no longer exists comes back looking successful with the field silently
dropped. `.claude/commands/queue-pickup.md` §The status names carries the live table and the two
traps in its `Type` column.

**Order the candidates**: Urgent (1) beats High (2) beats Medium (3) beats Low (4) beats No
priority (0). Ties break by oldest `createdAt`.

**An epic is not work.** If a candidate has sub-issues it is a container — the buildable thing is
one of its children. Leave the parent, comment saying so, and drop it from the batch. A container
outranks its own children on priority, so this is a real trap rather than a hypothetical one.

**Empty queue → no dispatch.** Go to STEP 6, which is silent in that case.

---

## STEP 3 — Scout the candidates

**If a hold from STEP 1 is in force, a freeze from STEP 2 is in force, or STEP 2 counted zero free
slots or fewer, skip this step and go straight to STEP 6.** *Or fewer* is not pedantry: children
dispatched under an older, larger cap can still be building, so a negative count is a state this
file reaches rather than a hypothetical — and read as "not zero" it scouts, writes to the board,
and dispatches nothing. Scouting is the expensive half of a firing —
`free slots + 2` agents, each re-paying `CLAUDE.md` — and it *writes to the board*, moving stale
candidates to `Needs decision`. A held firing that scouts anyway spends more than the usage gate
saves and mutates the board it was told not to act on.

**Do not dispatch on titles.** A batch is only safe if the stories in it do not overlap, and
nothing on the board says what a story will touch.

**Scout in priority order, and stop once you have enough.** Scout the first `free slots + 2`
candidates, never the whole column: each scout re-pays `CLAUDE.md` in a fresh window, and a
ten-deep queue would otherwise scout ten every hour to dispatch at most two. The `+ 2` is the margin for candidates the scout drops as stale or blocked.

**Grouping does not raise this budget, and must not.** STEP 4 re-partitions the candidates you
already scouted; it does not reach deeper into the queue to fill a group. So a group forms exactly
when the top few candidates collide — which is the only case where grouping was worth anything —
and the expensive half of a firing costs the same as it did when every story got its own session.

Spawn them in parallel, in a single message. Each is cheap and read-only:

> **First run `ToolSearch` for the Linear tools by keyword** (`+get_issue linear`), and call them
> only after their schemas load. A direct `mcp__Linear__*` call can fail with
> `InputValidationError`, which **looks exactly like a missing permission and is not one** — if
> you read it as "Linear is gone" the blocker check below silently returns nothing.
>
> Read Linear issue `<id>` and the code it concerns. **Do not write code, do not edit any file,
> and make no Linear call other than the two reads named here.** Return exactly:
> 1. `paths` — the files and directories under `src/`, `supabase/`, `scripts/` or `design/` you
>    expect this story to modify. Predict generously; a missed path is a collision.
> 2. `migration` — Y/N, does it add a file under `supabase/migrations/`?
> 3. `primitive` — Y/N, does it add or change a shared component under `src/components/ui/` or
>    `src/components/icons/`?
> 4. `size` — `S` / `M` / `L`, one line of basis. `S` is a copy fix, a doc line, a single
>    component. `L` is a new route with its data layer, a migration plus the screens that read it,
>    or anything you would expect to touch more than ~10 files. **Estimate the story only**, not
>    what a triage might fold into it.
> 5. `premise` — `stale` / `intact` / `no checkable claim`, **with the command you ran and its
>    output**. See the bar below; without a command there is no verdict.
> 6. `blockers` — `get_issue includeRelations=true`, then list any `blockedBy` not in
>    `Deployed to DEV`, `Done (in production)`, `Canceled` or `Duplicate`.

### The bar for `premise: stale`, which is narrower than it sounds

Brief the scout with this, because a fresh agent working from five lines will otherwise call a
story stale for the wrong reasons — and the cost of that lands on the owner, in a column nothing
drains on a schedule.

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

### Acting on the verdicts

- **`premise: stale`** → do not build it and do not close it. Comment with the command and its
  output plus the row it falls under, move it to **`Needs decision`**, drop it from the batch.
  **Never `Needs help`** — that stops the whole queue over work nobody is doing.
- **`blockers` non-empty** → drop it from the batch, one comment naming the unfinished blocker.
  Do not move it; being blocked is an ordinary state.

**If every candidate is stale or blocked, dispatch nothing** and go to STEP 6.

---

## STEP 4 — Group the candidates, then select the batch

**A collision between two candidates is a reason to build them TOGETHER, not a reason to defer
one.** Every one of the three caps describes damage that only two *different sessions* can do, so
the same three facts that used to reject a candidate now decide who it ships with:

| Cap | What two sessions do | What one session does |
|---|---|---|
| **`paths`** | Conflict on the second merge — loud and cheap. Worse, each is reviewed against a `development` containing neither, so `reviewer` gives an honest verdict on a file that will not exist once the other lands | Edits the file once, with both changes in front of it |
| **`migration: Y`** | Both write `060_*.sql`. Both land, both apply, and this repo already has a chain (`041 → 044 → 046`) where the wrong order succeeds with **nothing red**. They also apply to the same DEV database, which unlike the test database and the dev-server ports **is** shared across containers | Writes `060`, then `061`. The ordering is by construction rather than by luck |
| **`primitive: Y`** | Two divergent implementations of the same shared component. Nothing conflicts, nothing fails, and the result is `CLAUDE.md`'s *individually correct and collectively inconsistent* | Writes one implementation and uses it twice |

**The caps are unchanged; what changed is what they apply to** — a *group* rather than a story.
Nothing below weakens them, and the third column is why grouping is the stronger treatment rather
than a way around them.

### First: drop anything colliding with a story already in flight

**Grouping cannot reach a session that is already running.** You cannot merge a candidate into a
branch another child is building, so a candidate colliding with a dispatch record from STEP 2
waits exactly as it does today.

Drop it if, against **any** in-flight record, its `paths` intersect, or both carry
`migration: Y`, or both carry `primitive: Y`. It stays in `Queued (AI)`, it is not commented on,
and the next firing reconsiders it. **This is what makes "in flight" span firings** — a cap
evaluated against the current batch alone is satisfied by construction on the first story and
useless from the second firing onward.

### Then: partition what is left into groups

Two candidates join the same group when they collide with **each other** on any of the three, and
**collision is transitive**: if A collides with B and B with C, all three are one group even where
A and C do not touch. A candidate colliding with nothing is a group of one — the ordinary case,
and the exact shape this file shipped with.

A group's properties are its members' union: `paths` is the union, and the group is
`migration: Y` or `primitive: Y` if **any** member is. The in-flight caps above are then evaluated
against the group, which is what still holds the board to one migration and one shared primitive
at a time.

### The group ceiling — at most 3 issues, and at most one `L`

**Both halves bind, and the second is not implied by the first.** A group holds at most **3**
issues; it holds at most **one** `size: L`; and a group containing an `L` holds at most **2**.
So two `L` stories never travel together even though two issues clears the count — which is the
case the count alone would admit, and the one most likely to arise, since two `L` migration
stories collide on `migration: Y` whatever their paths.

**The bound is the `reviewer` pass**: one group is one branch, one PR and **one** review, and
`queue-pickup.md` STEP 4b already refuses a fold-in that *"would grow the diff past what one
`reviewer` pass can honestly cover"*. A group is that same diff arriving off the board instead of
out of a triage, and it earns the same ceiling.

**Over either ceiling, take the highest-priority members that fit and leave the rest.** They are
not lost. **Re-form the leftovers into their own group and walk it with the others** — they still
collide with each other, so they are a group rather than loose candidates, and the batch step below
is what holds them: it admits a group only if it clears the caps against every group already
admitted this firing, and it cannot, because they collide with the group that was just admitted.
So they wait, and regroup on a later firing.

**The in-flight check is *not* what holds them, and reasoning from it would be wrong** — that one
reads STEP 2's dispatch records, and the group being dispatched right now has none: STEP 5 writes
records after selection, not before. The batch check is the only thing standing between a trimmed
member and a second session over the same paths.

### The batch — one group per free slot

**A group is one child, so it costs one slot** however many stories are in it. The batch is
therefore `free slots` *groups*, and with the cap at 2 a firing dispatching two groups of two is
building four stories in two sessions. Walk the groups in priority order — a group's priority is
its highest-priority member, ties by that member's `createdAt` — and admit each only if it still
clears the in-flight caps against every STEP 2 record **and** against every group already admitted
this firing.

**Say in the notification when a group carries more than one story, and when the ceiling trimmed
one.** The batch's shape is the thing worth watching while grouping is new, and it is invisible on
the board — three issues moving to `Development (AI)` looks identical whether it is two sessions
or one.

**`docs/HANDOFF.md` and `CLAUDE.md` are exempt from the path check, and must be.** Roughly
two-thirds of this repo's commits touch one of them, and STEP 4 of the child procedure *requires*
every child to update the handoff — so applying the path check there caps every batch at one and
deletes the feature. They conflict loudly on the second merge, and `queue-pickup.md` STEP 4c
carries the resolution the child performs. **That remedy is what makes the exemption safe; do not
widen the exemption without checking it is still there.**

**Under grouping the exemption is more load-bearing, not less, and it fails in a new direction.**
Rejection deleted the feature by capping the batch at one; *merging* deletes it by collapsing the
board into a single group — every candidate touches the handoff, so every candidate collides with
every other, and the transitive rule above then sweeps all of them into one session that trips the
ceiling and dispatches three arbitrary stories on one branch. Same missing exemption, opposite
symptom, and this one looks like a working batch.

**Two caps do NOT belong here, and adding them would be reasoning from the wrong scope.** The
shared `letsride_test` database and the fixed ports (`:3000`, `:3001`) are container-local, and
each child runs in its own container. `CLAUDE.md` §Delegating while the owner is at the keyboard
describes both, and it is scoped to **subagents inside one session** — a real hazard for a child
running two agents, and no hazard between children. **The resource that genuinely is shared is the
DEV Supabase project**, whose dangerous half the migration cap covers. `WALK_FIXTURES=1` writes to
it are deliberately uncapped: they create a ride and a club through the app's own forms, which two
children can do concurrently without interfering.

**Concurrency cap: at most 2 children in flight at once.** Product owner, 2026-08-17: *"I want to
scale down our dispatcher to 2 sessions in parallel max."* So **this firing's batch is STEP 2's
`free slots`, never 2 flat**: one in flight means dispatch one, and two *or more* means dispatch
nothing — the count can exceed two after a cap change, which is why that half is not written as
"two".

**A slot is a CHILD, not a story** — so a group of three occupies one slot, exactly like a group of
one. That is the cap being read literally rather than stretched: the owner scaled down *sessions in
parallel*, and grouping does not add a session. It does mean a firing can now start more stories
inside the same two slots, which is the point — with only two slots, colliding stories that each
needed one are precisely the work that was starving.

**Read the cap as a total rather than a per-firing batch size, because the two come apart exactly
where it matters.** Children outlive the firing that spawned them, STEP 1 excludes them from its
gate by design, and STEP 2 says `Development (AI)` is no lock on the queue — so a per-batch reading
lets the next hourly firing add two more alongside two still building, and four run in parallel
with every rule in this file satisfied and nothing anywhere red.

**Moving either the slot cap or the group ceiling is the owner's call rather than a session's**,
and they bound different things: two slots of three issues is six stories in flight. **Say in the
notification when the caps trimmed a batch, how many slots were already taken, and when a group
carries more than one story**, so they can see whether either is binding or decorative.

**Everything not admitted simply waits.** It stays in `Queued (AI)`, it is not commented on, and
the next dispatch reconsiders it. A story deferred by a cap or a ceiling is not a problem to
report.

---

## STEP 5 — Claim and dispatch

**Per group, in this order** — one session per group, however many stories are in it. Claim
first: the status is what stops a second dispatcher taking the same issue, so claiming after the
spawn is a race.

1. **Move every issue in the group to `Development (AI)`, and read each response back** to confirm
   the status field is actually set. A `save_issue` naming a status that no longer exists returns a
   successful-looking payload with the field silently dropped — and this is the one write the
   entire concurrency story rests on. **If any of them did not take, move back the ones that did
   and dispatch nothing for this group**; a spawned child with an unclaimed issue can be dispatched
   again by the next firing. A part-claimed group is that same race with extra steps.
2. **`create_session`**, with:
   - `title` — `<issue id> <short title>` for a group of one; for a larger group, every id and the
     first story's title (`PD-201 + PD-207 — ride chat unread watermark`), so the session list
     still says what is being built and by which sibling.
   - `tags` — **`["queue-dispatch"]`**. STEP 1's gate depends on this.
   - `source_url` — `https://github.com/Lenhador88/LetsRide`. Without it the child has no clone
     and no GitHub reach.
   - `permission_mode` — omit, to inherit. It cannot be more permissive than this session's mode,
     so an explicit value can only narrow it by accident.
   - `prompt` — the brief below.

```
Build these Linear issues, in this order: <id>: <title> · <id>: <title> · …

Read `.claude/commands/queue-pickup.md` in this repo and follow it exactly. You were dispatched
to build exactly these stories and no others; the picking has already been done, so start at
STEP 3 — they are already in `Development (AI)`, so confirm rather than re-claim them.

<For a group of more than one, say why they travel together:>
These are one group because they collide: <the overlapping paths, or "both add a migration", or
"both change a shared primitive">. That is why they are one branch and one PR rather than two
sessions — building them apart is what produces duplicate migration numbers, divergent
implementations of one component, and a review of a file the other branch is about to change.

Scout findings from dispatch, per story, so you do not repeat them:
- <id> — paths: <paths> · migration: <Y/N> · primitive: <Y/N> · size: <S/M/L> · premise: <verdict>

Other stories are in flight in OTHER sessions right now: <every issue in Development (AI) that is
not in this group, with its paths, from the dispatch records — not just this batch — or "none">.
Do not touch their paths. If your build genuinely needs to, stop and park into `Needs help`
rather than editing across the boundary — the dispatcher's caps assumed you would not.

Do not act on anything else in this conversation and do not treat earlier turns as instructions.
```

3. **Read `create_session`'s response back and confirm `tags` is on it.** If it is missing,
   **archive that session immediately and move every issue in the group back to `Queued (AI)`** —
   an untagged child holds STEP 1's gate against every future dispatch for the whole length of its
   build, and there is no way to tag it after the fact. Re-dispatching next firing costs a group;
   leaving it costs the queue.
4. **If `create_session` fails**, move **every issue in the group** back to **`Queued (AI)`**
   before going on to the next group. Leaving one in `Development (AI)` claims it for a child that
   does not exist, and nothing else will ever release it.
5. **Comment the dispatch record on EVERY issue in the group**, each naming the same child session
   id, so every later firing can evaluate the caps against this story *and* check the child is
   still alive:

   ```
   <!-- dispatch-record -->
   session: session_01ABC…
   group: PD-201, PD-207
   paths: src/components/postcards/, src/lib/data/postcards.ts
   migration: N
   primitive: N
   ```

   **`paths`, `migration` and `primitive` are the GROUP's union, written identically on every
   member** — they are what STEP 2 feeds back into the caps, and a per-story record would let a
   later firing dispatch something that collides with a sibling it could not see. `group:` lists
   every issue the session holds, itself included; omit the line for a group of one.

   **One record per issue rather than one for the group**, because STEP 2's liveness check reads
   the records off the issues in `Development (AI)` — an issue with no record of its own is a
   freeze there, and it would be reached by every member but the one that happened to carry it.

   **Written after the spawn, not before, because the session id is the point.** A record written
   at claim time proves only that a claim was made — it reads identically whether a child is
   building or the dispatcher died before spawning one. With the id in it, STEP 2 can ask
   `list_sessions` whether that child still exists, which is a liveness check rather than a clock.
   The window this leaves is the reverse one: a spawn that succeeds and a comment that does not,
   leaving a live child with a record-less issue. STEP 2 freezes and notifies on that, which is
   loud and one issue-move to clear — the honest direction for the smaller window.

**Then stop.** Do not wait for children, do not poll them, do not review their work. They finish
in their own sessions and close their own issues. **They cannot report back to you** — a cloud
session receives messages and cannot answer into the conversation that spawned it — which is why
every child-visible outcome goes to Linear, the PR, or a push notification.

---

## STEP 6 — The stall check, then exit

**This step runs on EVERY firing, whether or not anything was dispatched.** That is the whole
correction over the shape it replaces: the alarm used to run only when a firing exited on a
blocking condition, and once `Development (AI)` stopped being a blocking condition, the case it
was written for — a child that died holding an issue — could never reach it. Every dispatch now
asks the question, so a claimed issue with nobody behind it ages into view instead of sitting for
ever.

Ask how long the oldest of these has been true:

- **An issue in `Development (AI)`** — its child should have finished. Age the branch tip if there
  is one, because a live build keeps resetting it and a dead one does not:

  ```bash
  git ls-remote --heads origin | grep -i "pd-<n>"          # gitBranchName is a guess; this is not
  git fetch origin "<ref>" --quiet && git log -1 --format=%ct "origin/<ref>"
  ```

  **This repo's branches are `claude/<slug>` and usually carry no issue id**, so that grep
  legitimately finds nothing on a healthy build. Fall back to the issue's `stateHistory[].startedAt`
  — and read a no-branch result as *unknown*, not as *dead*. Both states this reaches are real: an
  issue parked in the column by hand with no build behind it, and a child that has not pushed in
  hours.
- **A `Needs help` issue** — `get_issue` → `stateHistory[].startedAt`. It is a stop by design and
  it still ages: an issue nobody has come back to for hours is worth telling the owner about.
- **An owner session RUNNING (STEP 1)** — age it by its `updated_at`, and **name the session's
  title**. *"'Postcard flip with comments' has been RUNNING since 09:12"* is actionable; "another
  session is working" is not.

**If the oldest is more than 3 hours old, send ONE push notification naming it and saying the
queue is stalled — then record that you did**, as a comment beginning
`<!-- stall-alarm session:<id> -->`, naming the same session id as the dispatch record it
concerns. **Never alarm on a dispatch that already carries one.**

**Scope the marker to the dispatch, never to the issue.** A returned issue is re-dispatched as an
ordinary candidate, so an issue-scoped marker would silence the alarm for every *later* child of
that story — the never-clearing shape again, arriving through the mechanism meant to prevent
double-notifying. Match on the session id, or equivalently ignore any alarm older than the most
recent `<!-- dispatch-record -->` on that issue.

**A group shares one session id, so look for the marker across the whole group.** One dead child
holds every issue in its group, and all of them age past the threshold together; checking only the
issue in front of you finds no marker on the siblings and alarms once per member for a single dead
session. Read `group:` off the record, check every member for `<!-- stall-alarm session:<id> -->`,
and write the marker on just one of them — the alarm is about the child, and there is one child.

**Fall through when the oldest subject is already alarmed**, rather than stopping: take the next
oldest that is not. Reading only the single oldest would let one permanently-alarmed story hide
every stalled one behind it.

**Once-ness is durable rather than probabilistic, and that is a correction.** The rule used to be
a `[3h, 4h)` window, on the reasoning that a narrow band fires roughly once. It does — but only if
a firing actually lands inside it, and the owner-activity gate can suppress dispatching for a
whole working day. A window missed while every firing was held is a window gone for ever, on
exactly the dead child the alarm exists for. An open-ended threshold plus a written record fires
once *and* cannot be missed. The comment is checkable by any later firing, which a transcript is
not.

For an owner session RUNNING there is no issue to comment on, so that one keeps a `[3h, 4h)`
window — and with one firing an hour that window holds at most one firing, so it cannot repeat and
**can instead be missed outright**: the single firing inside it is consumed if the switch is off,
if a dispatcher is in flight, or if a wedged one is being recovered. Accepted, because it is the
one clock whose subject the owner can already see; do not copy the shape to a clock whose subject
they cannot.

**Re-anchor on the branch tip, do not suppress.** The obvious version — "tip moved recently, exit
silently" — is wrong invisibly: a build that dies at hour 3½ has a fresh tip at the only firing
inside the window, exits silently, and by the next one the window has passed. Ageing the tip
self-heals instead.

### What else this step sends, and what it does not

- **A batch was dispatched** → one `PushNotification` naming the issues **grouped as dispatched**,
  saying whether a cap or a ceiling trimmed anything, and including how many of the two slots were
  already taken when the firing started. `PD-201 + PD-207 in one session, PD-210 in another` is the
  line; a flat list of three ids hides the shape entirely.
- **The owner-activity gate is held with work waiting** → nothing, unless the stall clock above
  says otherwise. This is the ordinary state while the owner works, and notifying on it would mean
  a push an hour.
- **A hold that nothing ages** → notify, but **only once per condition**. Five qualify: the two
  `list_sessions` failures, the unreadable `list_triggers` switch (STEP 1), the usage hold, and
  STEP 2's record-less freeze. None has a subject
  the stall clock can age, so silence would mean no report ever — but a sustained one would
  otherwise send a push every hour, which is the thing the row above refuses. For the freeze,
  write `<!-- stall-alarm session:none -->` on the issue and skip it while it carries one — **but
  not when the freeze was reached by a failed `list_comments`**, since reading that marker back is
  the very call that failed, so it repeats for the same reason the connector failures do. The two
  session-list failures and the switch have no issue to mark, so they repeat, and that is accepted because they
  mean the connector is down.
- **Empty queue, every candidate stale or blocked, or a batch of zero** → silence.

### Your last act — archive yourself

**A dispatcher spawned by STEP -1 archives its own session once this step is done**, which
releases the container and keeps a queue that fires hourly from filling the owner's session list
with a run they will never open again. It is best effort: if the call refuses, say nothing and
exit — nothing downstream depends on it, and an archived row is still returned by `list_sessions`
either way, so this buys tidiness and a container rather than a working gate.

**Archive nothing else.** Not the relay, ever (`CLAUDE.md` §What Not To Do), and not a child —
a child archives itself, and archiving a live one strands its issue in `Development (AI)`.

**The relay never reaches this step**, so in STEP -1's failure branch, where the firing runs in
the relay, this instruction does not apply to you.

### How you get woken again

- **The hourly Routine fires. That is the only clock, and there is deliberately no other.**
  Product owner, 2026-08-18: *"when the development ends, I dont want those new sessions to report
  back to the routine. It will just pick up new stories on the next hourly run."* Children used to
  `fire_trigger` on finishing so the next batch started seconds after a slot freed;
  `queue-pickup.md` STEP 5 bullet 6 now tells them to send nothing.

  **A freed slot therefore waits for the top of the hour**, and that is the accepted cost rather
  than a gap to engineer around. What it buys: one clock instead of two, at most one firing an
  hour to collide with a dispatcher still working, and an off switch that stops every dispatch
  rather than only the heartbeat. **Do not reintroduce the poke** — not as an optimisation, not as
  a stall alarm, and not as "just for the parked case".

  **It does not make a concurrent firing impossible, and STEP -1's in-flight check is not dead
  code.** The cron fires on its own anchor minute regardless of how long a dispatcher lives, so any
  dispatcher that outlives the gap to the next cron minute — four scout agents will do it — is
  running when the next firing lands. Removing the poke lowered the rate; the check is what makes
  it safe.
- **`send_later`** — **only for a condition that resolves on a clock you can name**, and never for
  a held gate. A gate clears when the owner stops working, which no event reports and no delay
  predicts, so re-arming on it is a poll: three hours of owner activity would wake a session ~180
  times. **In STEP -1's failure branch that session is the relay** — the one session in this design
  whose context must not accumulate and which no session can clear — and outside that branch you
  are a dispatcher that is meant to have archived itself a step ago. The hourly firing already
  covers it either way, and it is now the only clock the queue has — do not add a second one
  here.

---

## Why this shape

**The old procedure was one long-lived session building one story at a time, suppressed whenever
the owner was working.** All of that came from one constraint: a session spawned *by a Routine*
gets its connectors from the trigger, and `create_trigger` refuses the `connectors` parameter for
this organization — so binding to a session that already held them was the only way to have a job
that could reach Linear at all.

**A session spawned by another session inherits them.** Probed 2026-08-16 from a `create_session`
child with the repo attached: `permission_mode: auto` inherited, and Linear, Supabase and the
GitHub tools all answered. That removed the reason the single session had to be reused, and with
it the three costs the reuse was paying — context accumulating across firings, a `/clear` no
session can perform, and a firing landing mid-conversation with the owner.

**The one capability that probe left unverified is now measured, and STEP -1 depends on it far
harder than the poke ever did.** Probed 2026-08-18 from two `create_session` children, itemised
this time rather than summarised:

- **Child with no repo attached** — `permission_mode: auto` inherited, and Linear, Supabase,
  Vercel, GitHub **and the Claude Code Remote tools** (`list_sessions`, `list_triggers`,
  `get_session`) all answered.
- **Child with `source_url` set** — repo checked out, and it called `create_session` itself: the
  grandchild came back with `parent_session_id` set and its `tags` intact.

So the relay's spawn of a dispatcher and the dispatcher's spawn of its children stand on measured
ground. **The child needs none of it any more** — `queue-pickup.md` STEP 5 bullet 6 stopped poking
on 2026-08-18, so the only CCR calls left in the queue are the relay's and the dispatcher's.

**Two gaps, and neither is closable from inside a session.** Both probes were spawned from an
*interactive* session, so **the exact hop STEP -1 performs — a Routine-fired session spawning a
child — is inferred rather than measured**; and whether any of these grants survive a container
reclaim across an idle hour is observable only after the fact. STEP 0 is the detector for the
second, and STEP -1's `create_session` failure branch is the detector for the first: it degrades
to the old shape and notifies, rather than stopping.

**What it does not remove is the reason for a dispatcher.** The caps in STEP 4 need one place that
can see every story in flight at once. A chain — each child spawning the next — is simpler and
cannot enforce any of them.

**Two irreversible things, carried here because the calls that trip them are CCR calls made by a
session that is not reading this file:**

- **Never delete `trig_01Gzy8eCiaXUUa1knvJnNpwy`**, the disabled fresh-session Routine. Its three
  connectors were hand-attached and `create_trigger` refuses the parameter, so no session can
  recreate it; `update_trigger enabled: true` restores it whole. **It was not in `list_triggers`
  on 2026-08-16, and still was not on 2026-08-18** (the whole account holds two Routines at
  `limit=100`, and neither is it) — see
  `docs/HANDOFF.md`; if it is gone the documented fallback is gone with it. **STEP -1 is what makes
  that survivable**: the thing the fallback existed to provide — a firing whose context is one hour
  old rather than eleven days — no longer needs a Routine to provide it.
- **Never archive the relay session** (`session_01B2mxc642tG8vZ15wysQpqM`). `update_trigger` has
  no `persistent_session_id` parameter, so recovery means a new trigger bound to a new session.
  **Everything the relay spawns is disposable** and archiving one is fine: a dispatcher carries
  `queue-dispatch-run` and a child carries `queue-dispatch`, and those two tags are how all three
  roles are told apart from the outside.
