# Constraints that will waste your time otherwise — moved from the handoff 2026-09-02

> Container, connector and tooling traps, each with the measurement that found it. Read the one
> you are about to hit; none of them is position.

## Constraints that will waste your time otherwise

**`git log %G?` lies about signatures here.** Signing works; `gpg.ssh.allowedSignersFile` is not
configured, so git reports `%G? = N` for correctly signed commits. Check the header:

```bash
git cat-file commit <sha> | grep -q '^gpgsig' && echo signed || echo unsigned
```

**`origin/HEAD` is not set in this clone.** Any script referencing it silently no-ops. Fall back
to `origin/main` explicitly.

**`playwright-core` is a devDependency now**, so `npm ci` installs it. It used to be installed
with `--no-save`, which meant any later `npm install` silently removed it and the walk died with
`ERR_MODULE_NOT_FOUND` — which reads like a broken script rather than a missing package.

**`FIGMA_ACCESS_TOKEN` lives only in the session environment** and dies with the container if it
is not in the environment config. Only `figma:pull` and `figma:icons` need it.

**Vercel's MCP fetch tool authenticates as the account owner**, so a 200 from it is not evidence
that a URL is publicly reachable.

**MCP connector names are not stable, and name-matched permission rules break silently when they
rotate.** A session has watched the Supabase server arrive as `Supabase` and later reconnect as
`mcp__d217aba8-…__execute_sql`; Vercel and Figma did the same. Every `mcp__Supabase__*` rule in
`.claude/settings.json` silently stopped matching at that moment, so long-approved tools started
prompting again.

**For Supabase that is over as of 2026-08-07 — the owner moved the grant to the connector's own
always-allow setting**, which is what the prompts were coming from all along, and the project's
twelve `mcp__Supabase__*` entries plus the two `autoMode.allow` prose rules were deleted with it.
A setting attached to the connector cannot stop matching when the connector's tool ids change.
`.claude/settings.json` carries a rule saying that absence is deliberate — **do not restore
them**, because two mechanisms for one grant is how one of them goes stale. `CLAUDE.md`
§Working Principles has the reasoning, and the one thing nobody in a session can test: whether a
connector-level always-allow leaves the four-entry `deny` list standing.

The hazard still applies to every rule still matched by name — those four `deny` entries, and the
Vercel, GitHub and Linear entries in `permissions.allow`. The symptom is a permission prompt for
something the project already allows; the fix is a connector setting or an owner decision, not a
wider project rule. A UUID-scoped mirror belongs in `.claude/settings.local.json`, which is
gitignored **because those ids are per-machine** — never commit them. There is no such file in
this container today (`ls .claude/settings.local.json`).

**The hourly Routine once prompted for Linear on every firing, and the cause was none of the
above — it had no repository attached.** `session_context.sources` was empty, so there was no
checkout, so `.claude/settings.json` was never read, so neither `defaultMode: "auto"` nor any
`permissions.allow` entry existed to match. The connector always-allow was set first and changed
nothing, because connectors attach per session independently of the repo.

**The cheap diagnostic, learned the expensive way: a permission dialog offering "Allow once" but
no "Allow always" means there is no project settings file to persist a grant into — i.e. no
repo.** Check `session_context.sources` before theorising about permission layers.

**The queue's own machinery — the two trigger ids, the never-delete rule, the relay session and
the cron traps — is in `CLAUDE.md` §The roadmap lives in Linear, and the procedures are
`.claude/commands/queue-dispatch.md` (pick and hand out) and `.claude/commands/queue-pickup.md`
(build one group).** None of it belongs here: settled contract, not current position.

**The prompt is repointed — read 2026-08-18, `trig_01WJkMVXGzUVGDcC1njNmaan` names
`queue-dispatch.md`.** It also says *"you are the DISPATCHER"*, which since STEP -1 is one role too
far — the session it fires into is the **relay**, and the file overrides the prompt. Harmless, and
only the owner or that session can reword it.

**The fallback Routine is still missing** — `trig_01Gzy8eCiaXUUa1knvJnNpwy`, absent again on
2026-08-18 at `limit=100 include_completed=true`, where the account returns **27** rows and none is
it. Only the owner can rebuild it, by hand, in the Routines UI.

**A missing `enabled` key is not a disable, and reading it as one is what made this file say the
queue was switched off.** Measured 2026-08-18 at 20:05Z: **not one of those 27 rows carried an
`enabled` key**, including `trig_01WJkMVXGzUVGDcC1njNmaan`, which had fired at 17:09Z. The key
*does* appear once explicitly set and it persists — an `update_trigger enabled: true` at 20:40Z
came back with it and a separate `list_triggers` at 20:52Z still showed it — so the old rule *a
disabled row simply lacks the key* says "disabled" about a Routine that is running.

**But `enabled: true` is not "the queue is running", and the same call proved it**: that row was
**two and a half hours past its due fire** when it showed the flag. Present-and-true is
authoritative about the flag; absent is unknown, since no row known to be off has ever been read
back. The two steps that gated on it were deleted the same day (`queue-dispatch.md` §Why this
shape).

**`next_run_at` is the check that works, and it caught a real stall the same evening**: it sat at
18:05Z with the clock at 20:40Z and no fire since 17:09Z — the second time this Routine has been
found silently stopped, with nothing on the board or in the repo showing it. **Check it whenever
the queue seems quiet**; nothing alarms on a Routine that has stopped firing, because every alarm
in the design runs inside a firing.

**Re-arm by id** — `update_trigger trigger_id=trig_01WJkMVXGzUVGDcC1njNmaan enabled: true`, which
moved it to 21:05Z. That is one observation rather than a mechanism: whether the `enabled`
parameter re-anchors the schedule or any write does is untested. It does show the cron survived —
21:05Z is the next `:05` after the call — so `cron_expression` need not be re-sent. **Say the id
out loud**: the identical command is the documented restore for the irreplaceable fallback
`…Gzy8e`, and running it on the wrong one puts two dispatch Routines on one board.

```
# via the CCR MCP: list_triggers -> trig_01WJkMVXGzUVGDcC1njNmaan
#   its prompt must name queue-dispatch.md, not queue-pickup.md
#   next_run_at in the FUTURE = armed; in the past = it has stopped firing.
```

**A procedure change needs no trigger edit — but it does NOT reach the relay on its own, and that
is the correction that cost ten days.** The prompt says *read the file and follow it*, so relay
behaviour lands as a file change and nothing outside the repo has to move. What does not follow,
and what this section claimed until 2026-08-28, is that merging the change is enough: **the relay goes on executing the copy it cloned when its
session was created.** Measured 2026-08-28 — its container reported `container_cc_version 2.1.235`
against 2.1.247+ on every session started that week, so it had not been re-provisioned in ten days.
**That a relay container is *never* re-provisioned is inferred from that one snapshot**, and
`PD-345` reports a second reading at 21:15Z the same day, still 2.1.235, **without saying whether
it came from a `get_session` or off the Routine's run record** — so one measurement plus an
unconfirmed second, not n=2. It is load-bearing: if some other event rebuilds one, archiving is not the only repair. **A change that the
relay itself must execute needs the relay archived so it re-clones, and archiving it is part of
making that change rather than a follow-up** (`queue-dispatch.md` §Editing this file is not finished
until the relay is archived — PD-345, which also records that no trigger-side signal detects a relay
refusing its firings, the board being the only detector); a change only dispatchers and children execute arrives on the merge, because
each of those is a fresh session with a fresh checkout. That matters because **no ordinary session
can edit that prompt, measured 2026-08-17** — `update_trigger` returns *"editing the prompt of a routine whose fires deliver into
a session that is not your own is not available via this tool"*. So a prompt edit is the relay
session's own call or a Routines-UI edit. Do not spend another session rediscovering the refusal.

**The queue dispatched nothing between 2026-08-18 and 2026-08-24, and every health signal said it
was fine.** The relay `session_01B2mxc642tG8vZ15wysQpqM` — titled `### Development ###` — was
**archived** at 20:13Z on 2026-08-18. `trig_01WJkMVXGzUVGDcC1njNmaan` rebound *itself* to
`session_014ncc5vBmsKG9fmfznUoZ48` 55 minutes later, connectors intact. But the relay's id is also
**copied into `.claude/commands/queue-dispatch.md`**, and STEP -1 matches a session's own id
against that copy — so every firing since arrived unrecognised, hit the **misroute** branch, and
correctly stopped, into a transcript nobody reads.

**The misroute rule worked; the copy it compared against did not.** Nothing was red at any point:
`enabled: true`, `next_run_at` in the future, fired on the hour, every time.

**It then happened a second time, for a different reason, and that is why the id is gone rather
than corrected.** Repointing the copy on 2026-08-24 changed nothing: the queue dispatched nothing
for four more days. The 2026-08-18 clone the relay was running names the *archived* id — verified,
`git show d7eff03:.claude/commands/queue-dispatch.md` — and its container had not been rebuilt in
that window. **That this is why each firing refused is inference, not a reading of the relay's own
transcript**, which no session can reach; it is the only hypothesis consistent with 19-second
`SUCCEEDED` runs that spawn nothing. Diagnosed 2026-08-28.
**Since then no role decision reads a session id at all** — STEP -1 keys off the prompt, which is
handed to the session at firing time and cannot go stale. Do not reintroduce an id comparison as a
safety check; it is the thing that failed, twice, in both directions.

**The relay was archived at 2026-08-28T22:09:58Z to force that re-clone, and the rebind had NOT
appeared 48 minutes later.** At 22:57Z `list_triggers` still reported
`trig_01WJkMVXGzUVGDcC1njNmaan` bound to the archived `session_014ncc5vBmsKG9fmfznUoZ48`, with
`next_run_at` 23:05:51Z — so the 23:05Z firing may land in the gap. **Read this as expected rather
than as a second failure**: the one prior data point is 55 minutes (2026-08-18), and the field is
not a countdown. **It did rebind, at 23:08:12Z — 58 minutes**, to `session_01EfJjZAFMoiBvpKo3fNHxLq`,
which makes the figure two data points (55 and 58) rather than one. **Re-read it before assuming the
queue is healthy again** — a rebind to a *fresh* session id is what says the next firing runs the
current `queue-dispatch.md`:

```
# via the CCR MCP: list_triggers -> trig_01WJkMVXGzUVGDcC1njNmaan
#   then get_session on whatever it names. session_status FIRST, and it answers TWO questions:
#     ARCHIVED        = a rebind is pending, so container_cc_version answers "unknown", never "stale"
#     REQUIRES_ACTION = BLOCKED on a permission prompt nobody can answer. Read pending_action.
#   only then container_cc_version: live and older than a session started today = an old clone.
```

**That relay was archived in turn on 2026-08-29 at 11:15Z, and NOT for staleness** — it was
`REQUIRES_ACTION`, blocked since 11:14Z on `mcp__Linear__list_issue_statuses`, with two stories
queued and both slots free, while `container_cc_version` read `2.1.251` (current) and the Routine
read `enabled: true` with a future `next_run_at`. **Every health check in this file said fine.**
The call it blocked on is granted twice in its own checkout — literally in `permissions.allow` and
by capability in `autoMode.allow` since 2026-08-07 — so the auto-mode classifier declined a
pre-authorized call, which makes this intermittent rather than a missing rule.
`.claude/commands/queue-dispatch.md` §Two irreversible things carries it.

Measured 2026-08-24, and these are the two checks worth reusing:

```
mcp__Claude_Code_Remote__list_triggers    # persistent_session_id — the authority for the relay id
mcp__Claude_Code_Remote__list_sessions    # a working queue leaves relay-spawned sessions behind
```

The second returned **no relay-spawned session at all** across the whole window, and the last
story to enter `Development (AI)` did so on 2026-08-18 at 13:31Z — seven hours *before* the
archive. Repointed on 2026-08-24; the four queued stories should drain on the next firing.

**Not outstanding, contrary to what this section said until 2026-08-24:** the old relay's question
*"queue dispatch: PD-255 blocked by `src/types/index.ts` overlap; proposing exemption"* needs
nobody. PD-255 reached `Deployed to DEV` at 15:06Z on 2026-08-18 — again before the archive — and
is `Done (in production)`. Check a story before recording a question about it as open:
`get_issue PD-255`.

**Two facts measured 2026-08-16 that the trigger list will not tell you, and both need re-reading
rather than trusting:**

- **`…WJkMV` was found stopped**, `last_fired_at` 2026-08-14T09:36Z with `next_run_at` two days in
  the past. Nothing on the board or in the repo showed it; the queue simply stopped — and it
  happened again on 2026-08-18, which is why the paragraphs above exist. **Check `next_run_at` is
  in the future** — the presence of the row is not the check, and neither is `enabled`, which
  reports a flag rather than whether anything is firing. *"Stopped" rather than "paused": a past
  `next_run_at` is not evidence anyone paused it deliberately.*
- **`trig_01Gzy8eCiaXUUa1knvJnNpwy` did not appear in `list_triggers` at all** (7 rows at
  `limit=100` then, 27 on 2026-08-18 with `include_completed=true`). If it is genuinely gone, the
  documented fallback is gone with it and only the owner can rebuild it, by hand, in the Routines
  UI.

```bash
# via the CCR MCP: list_triggers  limit=100
#   -> trig_01WJkMVXGzUVGDcC1njNmaan  next_run_at in the FUTURE = armed; in the past = it stopped
#   -> trig_01Gzy8eCiaXUUa1knvJnNpwy  present at all?  (the irreplaceable fallback — and note a
#      disabled trigger may simply be omitted from the listing, which is not excluded)
```

**The one thing that design cannot prove in advance:** the connector test ran minutes after the
session was active, so the container was warm. **Whether the grants survive a container reclaim
across an idle hour is unproven**, and no session can test it — it is only observable after the
fact. STEP 0 of the procedure is the detector; the fallback is re-enabling the old Routine.

**The queue was rebuilt on 2026-08-18 around the board rather than the session list**, on the
owner's instruction, and the four removals each have a measurement behind them in
`queue-dispatch.md` §Why this shape: the scout pass (~120k a firing to predict paths), the
`list_sessions` reads (~35k a call), the dispatch-record comments, and the `enabled` gate above.
What replaced them:

- **`slot-1` / `slot-2`** — two Linear labels created that day on the `PD` team. Every issue a
  build session holds carries its label, so free slots are counted in the same call that reads the
  queue. **An issue moved into `Development (AI)` by hand carries no label and holds no slot.**
- **A `<!-- territory -->` comment per slot**, written by the session that is building — the paths,
  whether it adds a migration, whether it touches a shared primitive.
- **The relay pre-check** (`queue-dispatch.md` STEP -1) — four small board reads before it spawns
  anything, because a dispatcher costs a whole session and six of them on 2026-08-18 produced one
  child.
- **`queue-pickup.md` STEP 6** — a session that finishes with budget left takes another queued
  story into its own slot. Bounded at 3 stories and 400k output tokens, measured off ten recent
  children that spent 9.8k–377k each.
- **The owner-activity gate is gone**, on the owner's instruction — *"we can indeed drop the gate
  whether I am here or not"*, with *"i do not edit files by hand, always prompting here"*.

**The durable lesson from what prompted it**, since the incident itself cleared the same evening:
a session that keeps re-arming a check-in to watch one PR has no bound on what it spends, and its
issue holds a queue slot the whole time. `queue-pickup.md` STEP 4c now bounds driving CI to green
at three attempts, and `CLAUDE.md` §Working Principles carries the same rule for a directed
session. Neither reaches a session already running — stopping one of those is the owner archiving
it.

**The board's live state is the fastest-moving thing in this file — do not read it here:**

```bash
# via the Linear MCP: list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c state=<one status>
#   -> Queued (AI) is the queue; Development (AI) is what is being built, and the slot-1/slot-2
#      labels on those rows are the concurrency count; any Needs help row stops every dispatch
```

## Connector rotation — moved from CLAUDE.md 2026-09-02

**A brief's `tools:` line is an exact-name allowlist, and an entry on it is neither guaranteed
loaded nor guaranteed present.** `InputValidationError` means the schema arrived **deferred** —
`ToolSearch select:<name>` *and then call it*. `No such tool available` means the name is
**absent**, which is what a connector rotation does: the MCP servers re-register under a UUID
prefix and the friendly name stops resolving, silently. **In a subagent, `ToolSearch` is filtered
by that agent's own `tools:` line before it searches, so a rotated tool is never surfaced at all**
and the agent cannot recover from inside itself. **A main thread has no `tools:` line**, so a
keyword lookup (`+list_issues linear`) *does* recover a rotated connector there, which is why the
queue procedures say to search again by keyword on a `select:` miss.

**The fix is the `tools:` line carrying BOTH spellings** — the friendly name and the UUID-prefixed
one — which every brief reaching Supabase, Linear or Figma does. `src/__tests__/agent-briefs.test.ts`
is the check, and no grep is: every twin sits on one line, so `grep -c` answers 1 however many
are there. Two things it does NOT cover: `github` has no twin on any brief, because no UUID for
it has ever been seen, and `.claude/settings.json`'s `permissions.allow` name-matches its
literal `mcp__*` entries too, so a rotated one comes back `requires approval`, which in an
unattended firing is a hard stop. Pasting UUIDs there widens a permission surface and is the
owner's call.

**The report is still owed when a connector arrives under a spelling nobody has recorded** — an
agent naming the passes that did not run; restoring the call is the owner's. Every brief reaching
**Supabase** carries `ToolSearch` and a §Reaching Supabase block; `agent-briefs.test.ts` enforces it.

## Two builds at once — moved from CLAUDE.md 2026-09-02

**A second concurrent build is not free, and the collisions are resources rather than files:**

- **One test database.** `supabase/tests/run.sh` defaults `TEST_DB=letsride_test` and opens with
  `drop database if exists`. A refused drop is not proof this is safe: every step is its own
  `psql`, so a drop landing between two of them takes the other run down mid-chain.
- **Two fixed ports.** The relay defaults to `:3001` and the walk targets `:3000`. `npm run dev`
  pins no port, so the second agent's server slides to the next free one while its walk still
  calls `:3000` — it walks the **first** agent's tree and reports **green**.
- **One working tree, and the main thread is a writer too.** A verifying agent reads the tree,
  so anything that writes it while a run is in flight makes the report describe a commit that no
  longer exists. Commit and stand still for the length of a verification run, or hand the agent
  `isolation: "worktree"`.

The first two are overridable — `TEST_DB=`, `RELAY_PORT=`, `WALK_BASE=`, `next dev -p`. The
database half fails loudly; the port half passes, which is why it is the dangerous one.

## Branch cleanup — moved from CLAUDE.md 2026-09-02

**Branch cleanup is an owner action, and the branches on the orphaned root must never be
deleted.** The repo's history was rewritten on 2026-08-04, so `main` and `development` root at
`0ea7054` and every branch that had not merged by then sits on a root with **no merge base to
`development` at all** — `git merge` cannot reach those commits, only `git show <sha> -- <path>`
can. Deleting such a branch destroys the only copy of whatever was in flight that day. `PD-143`
carries the do-not-touch list.

**The safety question is *unmerged content*, not "is it an orphan".** An ahead-count and
`git cherry` both report every commit of a squash-merged branch as unlanded for ever, so re-derive
it with `merge-tree`, which needs no merge base. The answer is a snapshot — run it immediately
before deleting anything:

```bash
devtree=$(git rev-parse origin/development^{tree})
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin |
           grep -vE '^origin/(development|main|HEAD)$'); do
  res=$(git merge-tree --write-tree origin/development "$b" 2>/dev/null | head -1)
  [ -z "$res" ] && { echo "ORPHAN  $b"; continue; }          # no merge base at all
  [ "$res" != "$devtree" ] && echo "UNMERGED $b"             # merging it would change something
done
```

**No session can delete a branch here** — `git push origin --delete` returns **HTTP 403** from
GitHub while ordinary pushes in the same session succeed, and the GitHub MCP server exposes
`create_branch` with no delete counterpart. Do not spend a session rediscovering this.
