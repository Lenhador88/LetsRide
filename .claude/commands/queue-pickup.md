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

**Renaming a status is a two-click change nothing in the repo can see, and it has already
happened twice** — three names moved at once on 2026-08-08 and every file naming one went stale.
The live set as last read back off the board:

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
| `Done (in production)` | completed | Promoted to `main` and live for riders. **Was `Done`** | **Whoever promoted** — never a firing |
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
> STEP 1's lock — is collected first and acted on together in **STEP 1.5**, which owns the only
> exit path. **Never reintroduce an early return above STEP 1.5.** A silent exit here sits *in
> front of* the stall notification, so the one alarm built to detect a permanently frozen queue
> can never fire — self-reinforcingly, because the `Needs help` path deliberately leaves an open
> PR behind, which trips this step for ever.

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

   **There is no number to compare against 80%**, so a check written as if there were would be a
   gate that can never fire — the same silently-failing shape as the team-scoped lock and the
   buried stall alarm. Do not "fix" this by inventing a threshold, and do not reach for the OAuth
   credential to query an internal endpoint: that breaks silently the day it changes and would
   *look* like a working gate. What was checked, so nobody re-derives it:

   ```bash
   claude --help | sed -n '/^Commands:/,$p'   # no `usage` subcommand — /usage is interactive only
   ls ~/.claude                               # no usage/stats/limit file
   env | grep -iE 'usage|limit|quota'         # nothing
   ```

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

   **Key off `session_status`, not `status_bucket`.** The two have been observed agreeing once,
   which is a correlation rather than a documented mapping; the bucket is a UI grouping that can
   be re-cut without the status changing.

   **Exclude your own id or this gate is held by the firing itself** — the pickup runs in a
   RUNNING session by definition, so a check that counts every RUNNING session never passes.
   This repo's recurring shape again, and the cheapest one to get wrong.

   **Your own id is `session_01B2mxc642tG8vZ15wysQpqM` — the Development session.** If you are
   not it, the pickup is a misrouted message and you stop for that reason rather than this one.
   The fallback if the Routine is ever rebound is this session's own
   `Claude-Session: https://claude.ai/code/<id>` line, the one used for commit trailers.

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

   **This slows the effective cadence well below hourly, and that is the intent rather than a
   bug.** The Routine fires at a fixed minute; if the owner touched any session in the 15 minutes
   before it, the whole hour is skipped, so a day of short bursts can mean no pickups at all.
   Read a quiet queue as the gate working, not as the Routine being broken.

```
list_sessions  mine=true  limit=50
  -> drop session_01B2mxc642tG8vZ15wysQpqM (yourself)
  -> (6) any remaining SESSION_STATUS_RUNNING            -> stop
  -> (7) max(updated_at) of the rest within 15 minutes   -> stop
```

**Two ways that call can fail, and both mean HELD — never open.** Failing open starts a story
alongside live work, which is the single outcome STEP 0.5 exists to prevent, and it looks like a
clean pass:

- **The call fails or the connector is unreachable.** Per STEP 0, a `select:` miss is a *rename*,
  not an absence — search by keyword before concluding the tool is gone.
- **The response carries `has_more: true`.** The list's ordering is documented nowhere this
  session can read, so a truncated page is not a sample you can reason about: a RUNNING session
  on the next page is invisible and a `max(updated_at)` over an arbitrary subset is not the
  maximum. `limit=50` makes truncation unlikely, not impossible.

**Both exits send their own `PushNotification`**, because a gate held with no data has no
`updated_at` to age and **STEP 1.5 therefore cannot stall-alarm on it**. Do not write "STEP 1.5
covers it" — that is the same unreachable-alarm mistake gate (7) documents at length. **Three
exits in this file stop with no clock behind them**: these two and an unmeasurable dirty tree at
STEP 1.5. All three notify, because a stop nothing can age is a stop nothing will ever report.

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

**It is not possible from inside the session**, measured rather than assumed, so nobody spends
another session rediscovering it:

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

### The split — reads are probed, writes are still not

**`general-purpose` and `claude` inherit this session's MCP grants**, probed from a real
subagent: `mcp__Linear__list_issue_statuses`, `mcp__github__get_me`,
`mcp__github__list_pull_requests` and `mcp__Supabase__list_projects` all returned real data as
`Lenhador88` with **zero prompts and zero denials**, and `git ls-remote origin` worked.

- **Preloading is not guaranteed by the `tools:` line either. Brief subagents to `ToolSearch`
  first.** A subagent that calls `mcp__Linear__save_issue` straight off fails on
  `InputValidationError` — **which looks exactly like a missing permission and is not one.**
  Declaring a tool does not establish its schema is loaded: probed 2026-08-09 (`PD-154`), all
  four Supabase tools on `reviewer`'s **own** `tools:` line arrived deferred while
  `mcp__Supabase__list_tables` on `data`'s answered a direct call — same session, opposite ways.
- **Only reads were probed. The writes — `save_issue`, `create_pull_request`,
  `merge_pull_request`, `git push` — remain unverified**, and four clean reads are not evidence
  about writes.

**`gh` is not installed**, so `mcp__github__create_pull_request` is the only route to a PR.
Re-derive rather than trust any of this:

```bash
command -v gh                                                                          # expect nothing
grep -l "mcp__Linear__\|create_pull_request\|merge_pull_request" .claude/agents/*.md   # expect none
```

That second command is why the squad agents cannot own the Linear and PR steps: none of them
holds those tools in its frontmatter. Until the write probe is done, **keep those calls in the
main thread** — a dozen calls a firing carrying no file content, so the split costs almost
nothing:

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
agent told to "have `reviewer` check its work" simply cannot — and the review then silently does
not happen, with CI green, a merged PR and a `Deployed to DEV` status all looking correct.

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

**The stall check covers every blocking reason rather than only the lock**, because every one of
them can be held by something nobody is working on — an issue dragged into `Development (AI)` by
hand, a branch left by a session that died, a PR abandoned mid-review — and the queue then
freezes for ever while every firing exits quietly. Ask how long the oldest blocking condition has
been true:

- **The lock** — `mcp__Linear__get_issue` → `stateHistory[].startedAt` on each issue in
  `Development (AI)` or `Needs help`. Take the longest-held.
- **A dirty tree (0.5 gate 2)** — age the newest mtime among the modified files:

  ```bash
  { git ls-files -z -m -o --exclude-standard; git diff --name-only -z --cached; } \
    | xargs -0 -r stat -c %Y 2>/dev/null | sort -rn | head -1
  ```

  **Do not parse `git status --porcelain` for this.** Two attempts did and both were broken:

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
  age past the 3–4 hour window and out the far side, where the alarm exits silently.

  **This entry is easy to leave out and it is the one with no other cover.** A session that died
  holding one uncommitted file on `development` makes gate (3) false (nothing is committed) and
  gate (4) false (no PR), so without this nothing ages it, STEP 1.5 exits silently, and the queue
  freezes hourly with nothing on the board pointing at it.

  **The mtime is an approximation** — it dates the last *edit*, not the moment the tree became
  dirty — which is fine for an alarm whose only question is "has this been true for hours".
  **But if the command returns nothing at all, do not fall back to the lock's own clock**: the
  scenario this entry exists for is a dirty tree on `development` with no lock, no branch and no
  PR, so there is nothing to fall back to. Treat an empty result as *unknown age* and **send a
  `PushNotification`**, like the two clockless `list_sessions` exits in STEP 0.5.
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

  The risk is real — **nothing establishes that only a human moves `updated_at`**, so a
  background agent, a cloud session or a second Routine touching itself more often than every 15
  minutes holds this gate on every firing, for ever.

  **But no clock available here can detect that.** The gate is *defined* as
  `now − max(updated_at) < 15 minutes`, so whenever it is held that value is under 15 minutes by
  construction — ageing the gate by it can never produce a number inside the 3–4 hour window, and
  a stateless firing has no history to measure instead. **An alarm written on it is strictly
  worse than none**, because it claims cover that does not exist.

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

**Re-anchor, do not suppress.** The obvious version of this check is "tip moved recently → exit
silently", and it is wrong invisibly: a build that *dies* at hour 3½ has a fresh tip at the only
firing inside the window, exits silently, and by the next firing the window has passed — so the
alarm is lost for ever on exactly the abandoned branch it exists to catch. Ageing the tip
self-heals instead: a live build keeps resetting it so the alarm never fires, and a dead one
stops resetting it and ages into its own window. A false "the queue is stalled" on a working
firing teaches the owner to ignore the one alarm that matters.

**Send it with the `PushNotification` tool.** A self-bound Routine cannot carry notifications of
its own, so this is the only way the message reaches anyone.

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
was given, including anything in the context of that build. It may never *start* one it was not
given. If you find yourself reaching for 4b to justify building something in another subsystem,
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

**This is a backstop, not the sequencing mechanism.** `docs/reference/linear.md` §Sequencing is still the
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
way here is lost unless this step writes it out. **Put the sub-4 items in the `Needs help`
comment**, since there is no PR body here to hold them.

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

**In this order — every bullet depends on the one above it.** The closing comment links stories
that must already exist, and the DEV-deploy check gates the status move rather than following it.
That is why they are numbered and cross-referenced by number.

1. **File or update every STEP 4b follow-up its table sent to a column** — a sub-4 item a session
   could have built itself goes nowhere and is already recorded in the PR body; a sub-4 *owner
   action* is still filed. First, because bullet 4 links them, and per STEP 4b's search rule some
   are updates to issues that already exist rather than new ones.
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

**File any follow-up you already rated before you stop — every exit path owes that, not just
STEP 5's.** STEP 4b decides where each one goes but deliberately creates nothing, so this path
and STEP 2c are the two that leave with a triage list and no STEP 5 to write it out. **Put the
sub-4 items in the `Needs help` comment**, since there is no PR body here to hold them. Rating
something and then dropping it is worse than never noticing it, because the rating is what made
it look handled.

Use it whenever you would otherwise guess: an ambiguous requirement, a visibility rule
nobody wrote down, a migration whose ordering you cannot verify, a design frame that does not
exist, CI red for a reason outside the story, or a decision that is the owner's to make.
`CLAUDE.md` §Working Principles forbids letting an unlabelled guess pass as a known value —
`Needs help` is where those go.

**Stopping into `Needs help` is always better than merging something you are not confident
in.** It also parks the queue until the owner clears it, which is the intended behaviour.

**Note the interaction with STEP 0.5.** Parking here leaves a branch and an open PR behind on
purpose, so the next firing trips STEP 0.5's in-flight checks *and* STEP 1's lock — which is
exactly the state that would let an early exit at 0.5 suppress the stall notification for ever.
STEP 1.5 is the single exit for that reason.

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

## Why this session is reused

A session spawned by a Routine gets its connectors from the trigger, and **`create_trigger`
refuses the `connectors` parameter for this organization** — so every rebuild of a fresh-session
Routine is one bad call away from a permanently connector-less job, and only the owner can
re-attach them by hand in the claude.ai Routines UI. Binding to a long-lived session moves the
grant off the trigger entirely: the session holds its own connections, and the firing is just a
message arriving in a conversation that can already reach Linear.

**Two things follow that are irreversible from inside a session, and both are the conclusion of
the paragraph above rather than a new rule.** They are also in `CLAUDE.md` §What Not To Do,
because the calls that trip them are CCR calls made by a session that is not reading this file:

- **Never delete `trig_01Gzy8eCiaXUUa1knvJnNpwy`** — the *disabled* fresh-session Routine, and the
  fallback. Its three connectors were hand-attached and cannot be recreated from a session, so
  deleting it destroys the only recoverable path; `update_trigger enabled: true` restores it
  whole. **`…WJkMV` is the cheap hourly one and `…Gzy8e` is the irreplaceable one** — keep the two
  straight in both directions. A disabled trigger's `list_triggers` row has **no `enabled` key at
  all** rather than `"enabled": false`, so read a disable back by checking the field is gone.
- **Never archive or abandon this session** (`session_01B2mxc642tG8vZ15wysQpqM`). Archiving it
  stops the queue silently, with no error anywhere, and `update_trigger` has no
  `persistent_session_id` parameter — so recovery means a *third* trigger bound to a new session.

What it costs, and what each cost is paid with:

| Cost | Paid with |
|---|---|
| The session is not idle by construction | STEP 0.5 |
| Context accumulates across firings | STEP 0.6 — **partially.** No session can compact or clear itself, so the mechanism is a fresh subagent per story plus an owner-facing `/clear` prompt |
| The trigger cannot carry push notifications | STEP 0 / STEP 5 send them from the session |
| A firing can land mid-conversation with the owner | STEP 0.5 (1) — their work wins |

And what it buys beyond the connectors: the session can see whether the owner is mid-request,
which is the only reliable idle signal there is, and no fresh session could ever have it.
