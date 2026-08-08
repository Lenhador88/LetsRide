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

## The status names — re-derive them, never type them from memory

**Three of them changed on 2026-08-08 and nothing in the repo noticed**, which is the second
time this exact drift has bitten: `CLAUDE.md` already warns that *renaming a status is a
two-click change nothing in the repo can see*, and then every file naming a status went stale
anyway. The live set, read back off the board:

| Status | Type | Means | Who moves it |
|---|---|---|---|
| `Backlog AI` | backlog | Captured, not triaged. **Was `Backlog`** | Either |
| `Todo Human` | unstarted | Triaged; owner chores live here | Either |
| `Todo AI` | unstarted | Triaged, and a session could do it. **Not a start signal** | Either |
| `Needs decision` | unstarted | Blocked on a product answer or a proposal read | **Owner** |
| `Queued (AI)` | started | **Approved to build. The only start signal** | **Owner** |
| `Development (AI)` | started | An agent has it *now*. **The concurrency lock** | Agent |
| `Needs help` | started | An agent stopped and needs the owner. **Also the lock** | Agent |
| **`Deployed to DEV`** | started | **Merged to `development`, green, live on DEV. Where a firing ends** | Agent |
| `Done (in production)` | completed | Promoted to `main` and live for riders. **Was `Done`** | **Owner** |
| `Canceled` / `Duplicate` | canceled / duplicate | Closed without shipping. **Both clear a blocker** (STEP 2b) | Either |

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

- **`Deployed to DEV` is typed `started`.** So is `Queued (AI)`. **Never widen the STEP 1 lock
  to "any issue whose statusType is `started`"** — that would count every queued story and every
  story already shipped to DEV as work in flight, and the queue would freeze permanently while
  looking perfectly healthy. The lock is **two names**, and STEP 1 says which. (This is the same
  never-clearing-guard shape as the team-scoped lock and the buried stall alarm. It is a
  recurring failure here, not a numbered series — do not give it a sequence number, because
  hypotheticals and observed events end up sharing one.)
- **`Done (in production)` is the only `completed` status, and a session never sets it.**
  Production promotion is manual and the owner's, done in their own session at their own timing
  (§STEP 5). A firing that moves an issue there is claiming riders have the feature when they do
  not.

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
once. So `mcp__github__list_pull_requests` (STEP 0.5 check 4) and `mcp__github__create_pull_request`
(STEP 4c, the only route to a PR since `gh` is absent) carry the same hazard, and check 4's
version of it **fails open**: the name does not resolve, no open PR is found, the gate passes,
and the firing builds on top of unfinished pushed work.

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

## STEP 0.5 — Is this session idle? Gather, do not exit yet.

**New with the reused session, and the whole reason this step exists:** a fresh session was
idle by construction. This one is not. The firing message is queued behind whatever the
session is already doing and lands the moment that finishes — which may be the middle of a
conversation with the owner, or the middle of a build.

> **Gather the answers here; do NOT exit here.** Every reason to stop — this step's seven and
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

5. **Claude usage headroom is low.** Asked for by the product owner 2026-08-07 as *"if any
   Claude usage limit is above 80%, skip the run"*. **The 80% cannot be evaluated, and this
   check is deliberately weaker than the request.** Read the limits below before relying on
   it.

   **Exit if a usage signal is visible in this session** — a system warning that a limit is
   approaching or reached, an overage notice, or a rate-limit message, whether it arrived
   this firing or earlier in the conversation. A build is by far the most expensive thing
   this Routine does, and it is the one worth not starting.

   **What was checked, 2026-08-07, so nobody re-derives it:**

   ```bash
   claude --help | sed -n '/^Commands:/,$p'   # no `usage` subcommand — /usage is interactive only
   ls ~/.claude                               # no usage/stats/limit file
   env | grep -iE 'usage|limit|quota'         # nothing
   ```

   No MCP tool exposes it either. **So there is no number to compare against 80%**, and a
   check written as if there were would be a gate that can never fire — the same
   silently-failing shape as the team-scoped lock and the buried stall alarm. Do not "fix"
   this by inventing a threshold.

   **Do not reach for the OAuth credential to query an internal endpoint.** It would be
   undocumented, fragile, and would break silently the day it changed — which is worse than
   this honest gap, because it would *look* like a working gate.

   **The lever that does work is the owner's, and it is one call:**

   ```
   update_trigger  trigger_id=trig_01WJkMVXGzUVGDcC1njNmaan  enabled=false   # pause
   update_trigger  trigger_id=trig_01WJkMVXGzUVGDcC1njNmaan  enabled=true    # resume
   ```

   Reading it back: a **disabled** trigger's `list_triggers` row has no `enabled` key at all
   rather than `"enabled": false`.

6. **Another Claude Code session is working.** Product owner, 2026-08-08: the trigger picks up a
   story only *"IF there are no other sessions active / doing work in claude code"*. One
   `list_sessions` call answers it.

   **Any session other than this one with `session_status: SESSION_STATUS_RUNNING` is a reason to
   stop.** Archived and idle sessions are not: `SESSION_STATUS_ARCHIVED` and
   `SESSION_STATUS_IDLE` both mean nothing is executing.

   **Key off `session_status`, not `status_bucket`.** In the 2026-08-08 sample the two agreed —
   the one RUNNING session was bucketed `…_WORKING`, archived ones `…_COMPLETED`, the idle one
   `…_REVIEW_READY` — but that is one observation of a correlation, not a documented mapping, and
   the bucket is a UI grouping that can be re-cut without the status changing. `session_status` is
   the field that names the thing being asked about.

   **Exclude your own id or this gate is held by the firing itself** — the pickup runs in a
   RUNNING session by definition, so a check that counts every RUNNING session never passes.
   This repo's recurring shape again, and the cheapest one to get wrong.

   **Your own id is `session_01B2mxc642tG8vZ15wysQpqM` — the Development session.** That is not
   a lookup, it is a fact about where this Routine fires, and §The Development session is
   infrastructure already requires a firing to confirm it *is* that session before acting on a
   pickup at all. If you are not it, the pickup is a misrouted message and you stop for that
   reason rather than this one. The session id also appears in this session's own
   `Claude-Session: https://claude.ai/code/<id>` line — the one used for commit trailers — which
   is the fallback if the Routine is ever rebound to a different session and this paragraph goes
   stale.

7. **The owner is at the keyboard.** Same instruction, second half: *"And I'm AFK for >15 mins."*
   **If any of the owner's other sessions was touched within the last 15 minutes, stop.**

   Take `max(updated_at)` across every session the same call returns **except this one**, and
   compare it against now. **Archived sessions count** — archiving is itself something the owner
   just did by hand, and a recent `updated_at` on an archived session is presence, not residue.

   **This is a proxy for AFK, not a measurement of it, and it is labelled as one deliberately.**
   It sees activity in Claude Code sessions and nothing else: the owner reading the app, sitting
   in Linear, or on their phone all read as AFK. There is no presence signal a session can reach,
   so this is the honest ceiling rather than a first approximation to be tightened later.

   **Exclude this session for the same reason as (6)** — the firing lands here and moves this
   session's own `updated_at`, so including it makes the gate permanently held. The case that
   exclusion loses is the owner typing *into this session*, and (1) is what covers it: the two
   checks are complementary rather than redundant.

   **Note what this does to the cadence, because it is a consequence rather than a bug.** The
   Routine fires hourly at a fixed minute. If the owner touched any session in the 15 minutes
   before that instant, the whole hour is skipped — so a day of working in short bursts can mean
   no pickups at all. That is what was asked for; it is written down here so a future session
   reads a quiet queue as the gate working rather than as the Routine being broken.

```
list_sessions  mine=true  limit=50
  -> drop session_01B2mxc642tG8vZ15wysQpqM (yourself)
  -> (6) any remaining SESSION_STATUS_RUNNING            -> stop
  -> (7) max(updated_at) of the rest within 15 minutes   -> stop
```

**If the call fails or the connector is unreachable, treat both gates as HELD and stop** — and
because a held gate with no data has no `updated_at` to age, **STEP 1.5 cannot stall-alarm on
it**. So this exit **sends its own `PushNotification`** rather than leaving a line in a
transcript nobody opens: without one the queue freezes hourly and completely silently, which is
the failure STEP 0 exists to prevent, reappearing one gate later. This is the one external call in
this file that had no stated failure behaviour; STEP 0 names Linear's (notify loudly, stop) and
STEP 5 names Vercel's (continue, mark unverified). Failing open here is the worst option
available: it starts a story alongside live work, which is the single outcome STEP 0.5 exists to
prevent. And per STEP 0, a `select:` miss is a *rename*, not an absence — search by keyword
before concluding the tool is gone.

**If the response comes back with `has_more: true`, treat both gates as HELD and stop.** The
ordering of that list is not documented anywhere this session can read, so a truncated page is
not a sample you can reason about: a RUNNING session on the next page is invisible, and a
`max(updated_at)` over an arbitrary subset is not the maximum. Both would then **fail open** —
the firing starts a second story alongside live work, which is the one outcome STEP 0.5 exists
to prevent, and it would look like a clean pass. `limit=50` is chosen to make truncation
unlikely rather than impossible; the `has_more` check is what makes it safe.

**Failing closed costs an hour — and like the connector-failure case above, it cannot be
stall-aged**, because a gate held with no usable data has no clock behind it. So this exit
**also sends its own `PushNotification`**. Do not write "STEP 1.5 covers it": that was in a draft
of this paragraph and it is the same unreachable-alarm mistake gate (7) documents at length.

**Three exits in this file stop with no clock behind them** — this one, the connector failure
above, and an unmeasurable dirty tree at STEP 1.5. All three notify, for the same reason: a stop
that nothing can age is a stop nothing will ever report.

The commands for (2) (3) (4):

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

**Only (1) and (5) need judgement, and (1) is the one that matters most.** (2), (3), (4), (6)
and (7) are all mechanical — a `git` command or one `list_sessions` call — and they are the
backstop that catches what judgement misses. A session that died mid-build leaves a dirty tree
behind, and that is exactly the state where picking up a second story does damage.

**Do not "help" by finishing the in-flight work.** It was not queued to you, you do not know
whether the owner is still deciding something about it, and a scheduled unattended session
is the worst possible place to guess. Let the next hour try again.

---

## STEP 0.6 — Start the story in a clean context

The product owner's instruction, 2026-08-08: *"everytime a new story is about to be picked up,
session should be compacted or cleared if possible before starting to build a new story."*

**It is not possible from inside the session, and that was measured rather than assumed.** The
finding, so nobody spends another session rediscovering it:

| Route | Result |
|---|---|
| A tool that compacts or clears the caller's own context | **Does not exist.** Not in the built-in tool set, not in the Agent SDK's `Query` / `ClaudeSDKClient` surface |
| A hook that *initiates* a compact | **Does not exist.** `PreCompact` and `PostCompact` are reactive only; no hook output field triggers either |
| `/compact`, `/clear` | Built-in **CLI commands the owner types**. The `Skill` tool's own description says built-in commands are not skills, so there is no invocation path |
| `claude --autocompact <n>` | Real, but it sets a **startup threshold** — it cannot fire mid-session, and this session was not started with it |
| An env var or `settings.json` key | None. No `autoCompact`, no `compactInterval` |

**So "clear the session" is an owner action, and the honest substitute is to build the story
somewhere that starts empty.** A subagent does: it gets its own fresh context window, and its
file reads, greps, diffs and test logs never enter this conversation. **One build subagent per
story is therefore the closest achievable thing to a clear**, and it is the rule, not a
preference.

### The split — reads are now probed, writes are still not

**`general-purpose` and `claude` inherit this session's MCP grants. Probed 2026-08-08 from a
real subagent**, because this file used to call the question untested and ask for exactly this
experiment:

- `mcp__Linear__list_issue_statuses`, `mcp__github__get_me`, `mcp__github__list_pull_requests`
  and `mcp__Supabase__list_projects` **all resolved and returned real data**, authenticated as
  `Lenhador88`, with **zero permission prompts and zero denials**. `git ls-remote origin`
  succeeded too, so the git credential is reachable.
- **The schemas are deferred, not preloaded.** Every one needed a `ToolSearch`
  `select:<name>` lookup first. A subagent that calls `mcp__Linear__save_issue` straight off
  fails on `InputValidationError` — **which looks exactly like a missing permission and is
  not one.** Brief subagents to `ToolSearch` first.
- **Only reads were probed. The writes — `save_issue`, `create_pull_request`,
  `merge_pull_request`, `git push` — remain unverified**, and four clean reads are not
  evidence about writes.

**`gh` is still not installed**, so `mcp__github__create_pull_request` is the only route to a
PR. Re-derive rather than trust any of this:

```bash
command -v gh                                                                          # expect nothing
grep -l "mcp__Linear__\|create_pull_request\|merge_pull_request" .claude/agents/*.md   # expect none
```

That second command is why the squad agents cannot own the Linear and PR steps: none of them
holds those tools in its frontmatter. The built-ins do — but until the write probe is done,
**keep those calls in the main thread.** They are perhaps a dozen calls a firing and they carry
no file content, so the split costs almost nothing:

- **Main thread, always:** STEPs 0–3, STEP 4b's triage *decision*, the Linear status writes, the
  `git push`, the PR open and merge (STEP 4c), STEP 5 — **and every `Agent` call.**
- **One build subagent:** everything from branching to a **committed** branch. It returns **a
  short report, never a diff** — what landed, which files, what it wants triaged, and the two
  commit ranges STEP 4c needs.

**The push is the main thread's for the same reason the Linear and PR writes are.** `git push`
is on the unprobed-writes list below, and handing an unverified write to a subagent *during a
firing* is the thing that list exists to prevent — the issue is already claimed and the lock
already held by that point. It is one Bash call carrying no file content, so keeping it inline
costs nothing.
- **A second, separate `reviewer` subagent**, spawned by the main thread at **STEP 4c** — after
  the builder returns *and* after STEP 4b has committed anything travelling, so the one pass
  sees the whole branch.

**The main thread spawns both, one after the other, because a subagent cannot spawn a
subagent.** No agent in `.claude/agents/*.md` carries a Task tool in its frontmatter, so a build
agent told to "run the squad itself" and to "have `reviewer` check its work" simply cannot, and
the review silently does not happen — a story with no fold-ins would then merge having never
been reviewed at all, with CI green, a merged PR and a `Deployed to DEV` status all looking
correct. **Caught by `reviewer` on this very change**, which is the argument for the rule making
its own case.

That costs the main thread two `Agent` calls and two short reports per story, and nothing else:
the reports are the only thing that lands in this conversation, which is the whole point.

**Where the story genuinely needs a specialist** — `data` for a migration, `media` for an
upload, `realtime` for a subscription — **the main thread spawns that agent directly** instead
of, or before, the generic builder. Same rule: the main thread holds the `Agent` calls, the
subagents hold the files.
- Do not read a large file into the main thread to "get oriented". Ask for the conclusion.
  `CLAUDE.md` §When to delegate: *the answer is a conclusion, not the files*.
- Never paste a full diff, a full test log or a full file into the main thread. A path and a
  line number is clickable and costs nothing.

**The `reviewer` pass stays non-negotiable and stays a separate subagent from the builder,
spawned by the main thread.** Its entire value is that it did not write the code, so folding it
into the build agent to save a hop destroys the thing it is there for — and per above, the build
agent could not run it anyway.

### Tell the owner when a clear is due — and say it where they will see it

You cannot clear this session; they can, and they will not know unless you say so. **STEP 5
sends it as part of the push notification**, not only as a line of text in a transcript nobody
opens on a phone. Only ever say it when STEP 5 finished cleanly and nothing is in flight — a
clear mid-build would discard exactly the context that makes the reuse worth having.

---

## STEP 1 — The lock. Gather this too.

List the issues **of project `88f3f224-ecf0-46f0-a032-c86b7a12f81c`** and check their
statuses. **If ANY of them is in `Development (AI)` or `Needs help`, that is the lock and it
is held.** One story at a time is the rule — an issue in either status means a previous
firing is still in flight, or is blocked waiting on the owner. Carry the answer to STEP 1.5
rather than exiting here.

**Exactly those two names, and match on the name rather than the type.** `Deployed to DEV` is
typed `started` and so is `Queued (AI)`, so a lock written as "any `started` issue" is held by
every queued story and by every story that has already shipped — permanently, and with the
symptom of a healthy job behind a busy queue. **A story sitting in `Deployed to DEV` does not
hold the lock**: it is finished as far as a firing is concerned, and it waits there only for a
production promotion the owner does by hand. See §The status names.

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

You now hold every reason to stop: STEP 0.5's seven and STEP 1's lock. **If none is true, go
to STEP 2.** Otherwise stop — but run the stall check *before* you do, because this is the
one place that can see a queue which has frozen.

**The stall check, and it covers every blocking reason rather than only the lock.** That is
the fix for the bug this step exists to prevent: the alarm used to hang off the lock alone,
sitting behind an unconditional silent exit that could never reach it. Ask how long the
oldest blocking condition has been true:

- **The lock** — `mcp__Linear__get_issue` → `stateHistory[].startedAt` on each issue in
  `Development (AI)` or `Needs help`. Take the longest-held.
- **A dirty tree (0.5 gate 2)** — age the newest mtime among the modified files:

  ```bash
  { git ls-files -z -m -o --exclude-standard; git diff --name-only -z --cached; } \
    | xargs -0 -r stat -c %Y 2>/dev/null | sort -rn | head -1
  ```

  **Do not parse `git status --porcelain` for this. Two attempts did and both were broken** —
  each measured with a repro rather than reasoned about, and each found only after it shipped:

  | Attempt | What breaks it |
  |---|---|
  | `\| awk '{print $2}' \| xargs` | `--porcelain` **quotes** any path with a space or non-ASCII byte (`core.quotePath` is on by default). `awk` splits it, `xargs` dies with *"unmatched double quote"* having `stat`ed only the paths before it. A tree dirtied **3 minutes** ago aged as **57,886 hours** |
  | `--porcelain -z \| sed -z 's/^...//'` | A rename is **two** `-z` records — `R  <new>\0<old>\0` — and the second carries no status prefix, so `sed` eats the first three characters of a real path. Observed: `todelete.txt` → `elete.txt` |

  `ls-files` emits **paths only**, so there is no prefix to strip and no quoting to unpick;
  `--cached` adds staged-only files, which `-m` misses when the working copy matches the index.
  Duplicates between the two are harmless — the answer is a maximum. Deleted paths fail `stat`
  and drop out, which is why `2>/dev/null` is there.

  **`xargs` exits non-zero when that happens — the *pipeline* does not.** Measured: plain shell
  gives **0**, because `head` is the last stage and its status is the pipeline's;
  `set -o pipefail` gives **123**. So the advice is *do not run this under `pipefail`* — and
  **never branch on its exit status**, which is the trap: a guard written as "non-zero means the
  tree had deletions" can never fire on the default shell. Read the **output** instead, and treat
  empty as unknown age.

  **The direction of these errors is the opposite of harmless.** Dropping entries can only
  *lower* a maximum, so every failure mode makes the tree read **older** than it is — pushing the
  age straight past the 3–4 hour window and out the far side, where the alarm exits silently. An
  earlier caveat here claimed the failures "read newer, so it errs toward staying quiet". That
  was backwards, and it papered over the bug rather than fixing it.

  **This entry is easy to leave out and it is the one with no other cover.** A session that died
  holding
  one uncommitted file on `development` makes gate (3) false (nothing is committed) and gate (4)
  false (no PR), so if this is missing nothing ages it, STEP 1.5 exits silently, and the queue
  freezes hourly with nothing on the board pointing at it. Caught by `reviewer` against a
  sentence claiming the list was already complete.

  **The mtime is still an approximation** — it dates the last *edit*, not the moment the tree
  became dirty, and `2>/dev/null` drops deleted paths that cannot be `stat`ed. That is fine for
  an alarm whose only question is "has this been true for hours". **But if the command returns
  nothing at all, do not fall back to the lock's own clock** — the scenario this entry exists for
  is a dirty tree on `development` with no lock, no branch and no PR, so there is nothing to fall
  back to. Treat an empty result as *unknown age* and **send a `PushNotification`**, the same as
  the two clockless `list_sessions` exits in STEP 0.5.
- **A branch in flight (0.5 gate 3)** — `git log -1 --format=%cr` on its tip.
- **An open PR on the current branch (0.5 gate 4)** — its `createdAt`.
- **The owner's unfinished request** — never stalls. It is a live human, not a stuck job.
  Exclude it; notifying someone about their own open conversation is noise.
- **Low usage headroom** — never stalls either, and for the same reason: it is a live
  external condition the owner already knows about and can see better than this session can.
  A push saying "the queue is stalled because your usage is high" tells them nothing they do
  not know and spends the very budget it is reporting on. Exclude it.
- **Another session RUNNING (0.5 gate 6)** — **stalls, and this is the one most likely to
  freeze the queue silently from now on.** A session left in `SESSION_STATUS_RUNNING` blocks
  every firing for as long as it sits there, and unlike a lock or a branch there is nothing on
  the board pointing at it. Age it by its `updated_at`. Name the session's title in the
  notification, because "another session is working" is not actionable and *"'Postcard flip
  with comments' has been RUNNING since 09:12"* is.
- **The owner not being AFK (0.5 gate 7)** — **has no reachable alarm, and the honest move is to
  say so rather than write one that cannot fire.**

  The risk is real: **nothing establishes that only a human moves `updated_at`.** A background
  agent, a cloud session or a second Routine touching itself more often than every 15 minutes
  holds this gate on every firing, for ever.

  **But no clock available here can detect that.** The gate is *defined* as
  `now − max(updated_at) < 15 minutes`, so whenever it is held that value is under 15 minutes by
  construction — ageing the gate by it can never produce a number inside the 3–4 hour window.
  A draft of this file did exactly that and called it a fix. **It was strictly worse than no
  alarm**, because the exemption at least said plainly that nothing would fire. There is no
  session-side history to measure against either: each firing is stateless and cannot know
  whether this gate was also held an hour ago.

  **So: do not fake it, and do not reintroduce the `max(updated_at)` version.** What actually
  covers the dangerous case is **gate (6)** — a session touching itself every few minutes is
  almost certainly `SESSION_STATUS_RUNNING` while it does so, and (6) both catches that and
  alarms on it correctly. The residue that (6) misses is a session that updates without running,
  which no signal here distinguishes from a human at a keyboard.

  **If a firing ever notices this gate held while (6) is clear and every fresh session looks
  automated, say so in that firing's notification** — a judgement call reported once is worth
  more than a threshold that never trips.

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

**Never take work from `Backlog AI`, `Todo Human`, `Todo AI` or `Needs decision`.**
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

For each entry, look up its status. **A blocker counts as cleared when it is `Deployed to DEV`,
`Done (in production)`, `Canceled` or `Duplicate`. Anything else and you do not build this
issue.** `Duplicate` has to be in that set for the same reason `Canceled` is — a blocker closed
as a duplicate is never going to reach any other status, so leaving it out means every firing
skips the dependent story, comments once, and moves on, for ever, with no alarm behind it.
Comment
on it once naming the unfinished blocker, then go back to STEP 2 and take the next candidate by
priority. Do **not** move it to `Needs help` — being blocked is an ordinary state, not something
the owner must clear, and parking the whole queue for it would be worse than skipping one story.

**`Deployed to DEV` has to be in that set, and leaving it out would deadlock the queue.** A
firing branches off `development`, so a blocker merged there is *already available to build
on* — waiting for `Done (in production)` would mean waiting for a manual promotion the owner
does on their own schedule, and every dependent story in the column would sit blocked until
they did. The build order and the release order are different questions; this check is the
first one.

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
- **The `reviewer` pass on the code happens once, at STEP 4c, on the final diff — not here.**
  Changed 2026-08-08. It is still the one non-negotiable delegation, and still always *before*
  the merge and never after: it has caught, in one session, a feature that shipped completely
  unreachable because an optional prop gated its only entry point, and an RLS leak that every
  other gate passed. What changed is *when*, not *whether*.

  **Reviewing here and then again after STEP 4b was one pass too many, and the second was the
  only one that saw everything.** A fold-in commits after this step, so a review taken here is
  provably incomplete the moment STEP 4b builds anything — which is why STEP 4c already carried
  a conditional re-review. Two passes where the earlier one is superseded is not defence in
  depth; it is the same diff read twice, minus the fold-ins, at full cost. Running once at the
  end removes the **structural** gap — the one this file created itself, by placing a pass
  before a step that commits.

  **It does not remove every gap, and an earlier draft of this bullet claimed it did.** It said
  "impossible by construction", which `reviewer` falsified on this very change: STEP 4c bullet 3
  drives CI to green, and fixing `reviewer`'s own findings commits too — both land *after* the
  only pass. The honest bound is narrower and worth stating exactly, because an overclaim here
  is what stops the next reader looking: **one pass covers everything committed up to it, and
  nothing after.** STEP 4c bullet 1 carries the rule for what comes after.

  **The proposal pass is a different gate and it stays.** When `openspec` runs, `reviewer` reads
  the *proposal* — that is the first of `CLAUDE.md` §The Agent Squad's two, and the only artifact
  in this pipeline with no automated gate at all, since `openspec/` runs zero CI jobs. Collapsing
  the build passes does not touch it.
- Verify locally: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
  Run `PGPASSWORD=postgres npm test` if anything under `supabase/**` changed.
- A migration that changes a policy must add an assertion.
- Update `docs/HANDOFF.md` as part of landing the work, not as a separate task.

**This step stops short of the PR on purpose.** STEP 4b decides whether anything else is
travelling in it, and that decision has to be made while the branch is still open — so opening
and merging is STEP 4c, after the triage. An earlier draft put the triage after the merge and
still told it to use "the same PR", which is not executable in order; `reviewer` caught it
before this file shipped.

**Per STEP 0.6 the building runs in a subagent the main thread spawns, and that is the mechanism
standing in for the clear the owner asked for.** Brief it with the issue, the branch name and
the `CLAUDE.md` rules that bear on the story. Where the story wants a specialist — `data`,
`media`, `realtime`, `design-system`, `test` — **the main thread spawns that agent**, because a
subagent cannot spawn one. `reviewer` is spawned separately from the main thread too, but at
STEP 4c rather than here.

The main thread should end this step holding a branch name, a short build report and the commit
range that is the story itself — never a diff, never a test log, never a file — and it does the
`git push` itself, per STEP 0.6. **Keep that range**: STEP 4c's scope pass needs it to tell the
story's own commits from the fold-ins', and it cannot be recovered from a combined diff.

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
| Travels | **Recommendation ≥ 7/10 *and* This session = Y** | **Build it now** — same branch, same PR, reviewed at STEP 4c |
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
| **`Backlog AI`** | You rated it below 4/10 — a real thought, not a triaged one |

**`Backlog AI` is not banned, and an earlier draft of this file banned it wrongly.** `Todo AI`
means *triaged*, and the owner reads it to choose work; filling it with 2/10 ideas devalues
exactly the column this change depends on.

### Search before you file — update an existing issue rather than opening a second one

The product owner's instruction, 2026-08-08: non-obvious improvements *"should lead to issues
created **or updated** in linear"*. The second half is the one a firing will skip, and skipping
it is not neutral — a board carrying two issues for one problem reads as two pieces of work,
which is the same failure as filing nothing and then some.

So for each item, **search first**:

```
mcp__Linear__list_issues  project=88f3f224-ecf0-46f0-a032-c86b7a12f81c  query=<a few distinctive words>
```

- **Something already covers it** → update that issue instead. Add a comment with what this
  build learned, the four ratings and the PR it surfaced from; raise the priority or move the
  status only if this build genuinely changed the picture. **Never move an existing issue into
  `Queued (AI)`** — that is still the owner's column, and promoting one from inside a firing is
  the same overreach as picking work from it.
- **Nothing covers it** → create it, per the table above.
- **Say which you did** in the STEP 5 comment. "Updated `PD-xxx`" and "filed `PD-yyy`" are
  different facts and the owner is reading for both.

Search on the *symptom*, not on your own phrasing of the fix — the existing issue was almost
certainly written from a different angle, and a query built from your title will miss it.

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
the review comes before the merge, and putting it after is the defect this repo has paid for
three times: PR #34, #46 and #94 each shipped and were then reviewed, and #46's finding was a
live RLS hole letting any signed-in rider post a ride into any club.

1. **Run `reviewer` on the final diff. Always, once, here.** This is the single code-review
   gate for the firing — STEP 4 no longer runs one, so there is no earlier pass to fall back on
   and **no "nothing folded in, so this is a no-op" branch**. That branch is gone deliberately:
   it was the one path through this file that could reach a merge with a review that predated
   the last commit.

   Because it now always sees the whole branch, it is also the pass that reviews the fold-ins —
   which is the entire safety argument for building them unattended.

   **A commit made AFTER this pass is not covered by it, and two are routine here:** a CI fix
   at bullet 3, and any fix for `reviewer`'s own findings. The bound is *one pass covers
   everything up to it*, so — **re-run `reviewer` on the delta alone** (`git diff <reviewed
   sha>...HEAD`) when what you added after it is non-trivial: anything touching `src/`,
   `supabase/`, a policy, a guard or a permission. A lockfile bump, a typo, a formatting fix or
   a reworded comment does not need one. **When in doubt, re-run on the delta** — it is a small
   diff by definition, so the cheap call is the safe one, which is the opposite of the
   trade-off that justified collapsing the two full passes.

   **Its prompt must carry the scope material, because it runs before the PR exists and so
   cannot read the PR body.** Pass: the issue being built, each fold-in with its one-line
   relatedness justification and its four ratings, and the two commit ranges — the story's own
   commits versus the fold-ins'. Without those, `reviewer.md`'s scope pass cannot check the
   breadth cap at all, and is briefed to report that rather than guess the boundary from the
   diff.
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

   **`HEAD`, not `$BRANCH`.** The only `BRANCH` variable in this file is assigned at STEP 0.5
   check (3), where it is *expected to be `development`* — so reusing it here pushes the story
   branch's commits straight onto `development`, which `CLAUDE.md` forbids outright, and then the
   must-be-empty guard fails and stalls the firing with no PR open. Unset, it is worse in the
   honest direction: `fatal: invalid refspec ''`.
3. Drive CI to green and merge. Do not merge red. **Never push to `main` and never open a PR
   against `main`** — production promotion belongs to the owner.

---

## STEP 5 — Close the loop, and wrap the session up

**The run is not over when the PR merges.** Wrap-up is the last step of the work, not a
separate task, and STEP 4b's stories are part of it — a follow-up that was rated and then never
filed is worse than one that was never noticed, because the rating made it look handled.

**In this order — every bullet depends on the one above it**, and two drafts of this step got it
wrong in the same way. One wrote the closing comment before the stories it was told to link,
which cannot be done before they exist. The other left the DEV-deploy check as a trailing
paragraph *after* the status move and the notification, making it a gate on something that had
already happened. Both are why the steps below are numbered and cross-referenced by number.

1. **File or update every STEP 4b follow-up that did not get built.** First, because bullet 4
   links them, and per STEP 4b's search rule some are updates to issues that already exist
   rather than new ones.
2. **Return to `development` and pull**, so the next firing's STEP 0.5 passes and so bullet 3
   has the merge commit to check against.

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
   title>`. Append `— /clear is safe` when bullet 2 left the session clean, so the owner learns
   it somewhere they actually read (STEP 0.6).

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
  promotion makes it true.
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
- **Everything else becomes a story** in `Todo AI`, `Todo Human` or `Backlog AI` — or an update
  to the issue that already covers it, per STEP 4b's search rule — and the owner decides when it
  gets built.

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
| Context accumulates across firings | STEP 0.6 — **partially.** No session can compact or clear itself, so the mechanism is a fresh subagent per story plus an owner-facing `/clear` prompt |
| The trigger cannot carry push notifications | STEP 0 / STEP 5 send them from the session |
| A firing can land mid-conversation with the owner | STEP 0.5 (1) — their work wins |

And what it buys beyond the connectors: the session can see whether the owner is mid-request,
which is the only reliable idle signal there is, and no fresh session could ever have it.
