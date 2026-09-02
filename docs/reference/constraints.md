# Constraints that will waste your time otherwise

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

**The queue's own machinery is in `docs/reference/linear.md` §The queue is drained by one Routine,
on one clock, and the procedures are `.claude/commands/queue-run.md` (read the board, claim one
group) and `.claude/commands/queue-pickup.md` (build it, same session).** What belongs here is the
platform behaviour that will waste a session's time again if it is rediscovered:

- **A session a Routine mints for itself holds the repo and the attached connectors, and — as far
  as anything has shown — no `create_session`.** Measured across every relay from 2026-08-18 to
  2026-09-02: ~40–80 output tokens per firing, nothing spawned, while `last_run` read `SUCCEEDED`.
  The reading — that the session-management tools are built-in tooling a session gets when a
  person or another session starts it, not a connector — is **inferred** from that (PD-241 calls
  it a hypothesis, twice), and whether `get_session`, `archive_session`, `list_triggers` or
  `list_sessions` are held has not been measured at all; `queue-run.md`'s inventory firing is what
  does. **Any queue design that needs a firing to spawn, fire or archive anything is dead on
  arrival**, and every health check on the Routine will say it is fine.
- **Trigger-fired sessions are excluded from `list_sessions` by default** — measured 2026-09-02:
  the relay carried `origin: scheduled_trigger` and the tags `config:routine-lineage-none`,
  `routine:agent-minted` on `get_session`, and was absent from a 40-row `list_sessions` the same
  minute, which the tool's own description says is the default.
  Find one from `list_triggers`' `last_run.session_id` (fresh-session Routines) or
  `persistent_session_id` (bound ones), then `get_session` on it.
- **No session can create, fire, edit or delete a Routine.** `create_trigger` refused the
  `connectors` parameter for this organization (2026-08-16, 2026-08-18); `update_trigger` on a
  prompt refuses with *"editing the prompt of a routine whose fires deliver into a session that is
  not your own is not available via this tool"* (2026-08-17); and on 2026-09-02 the auto-mode
  classifier refused both `create_trigger` and `fire_trigger` outright. The Routines UI is the only
  editor. **Read-only** `list_triggers` and `get_session` are pre-authorized in
  `.claude/settings.json`.
- **A missing `enabled` key is not a disable.** Measured 2026-08-18: none of 27 rows carried one,
  the queue Routine included, while it was firing. The key appears once explicitly set and reports
  the flag; **`next_run_at` in the past is what says a Routine has stopped firing** — found twice
  (2026-08-14, 2026-08-18) with nothing on the board or in the repo showing it. `enabled: true` and
  a future `next_run_at` say nothing about whether a firing *does* anything; the board does.
- **An unattended session can stall on a permission prompt nobody answers.** The classifier
  declined `mcp__Linear__list_issue_statuses` on 2026-08-29 (PD-349) — granted twice over in the
  session's own checkout — and the account's other Routine stalled on an artifact publish on
  2026-09-02. `session_status: REQUIRES_ACTION` with `pending_action` naming the tool is the
  signature. Intermittent, not a missing rule; a fresh-session Routine simply loses that one firing.
- **A Routine with no repository attached prompts for everything** — the paragraph above this
  list. Check `session_context.sources` before theorising about permission layers.
- **UI edits re-anchor an hourly cron** to the minute of the edit; re-read `cron_expression`.

**What the queue rests on now, all of it on the board** (rebuilt 2026-08-18 around Linear instead
of the session list, on the owner's instruction; the firing made the builder on 2026-09-02):

- **`slot-1` / `slot-2`** — two Linear labels on the `PD` team. Every issue a build session holds
  carries its label, so free slots are counted in the same call that reads the queue. **An issue
  moved into `Development (AI)` by hand carries no label and holds no slot.**
- **A `<!-- territory -->` comment per slot**, written by the session that is building — the paths,
  whether it adds a migration, whether it touches a shared primitive.
- **`queue-pickup.md` STEP 6** — a session that finishes with budget left takes another queued
  story into its own slot, bounded at 3 stories and 400k output tokens. In a Routine-minted session
  the budget read is unavailable and the gate fails closed: one group per firing.
- **No owner-activity gate**, on the owner's instruction — *"we can indeed drop the gate whether I
  am here or not"*, with *"i do not edit files by hand, always prompting here"*.

**Four outages in three weeks were each diagnosed as the previous one's cause, and none was** —
the one that was there all along is the first bullet above. PD-241, PD-345 and PD-349 hold the
record; nothing on the Routine detected any of them.

**The durable lesson from the session that prompted the 08-18 rebuild:** a session that keeps
re-arming a check-in to watch one PR has no bound on what it spends, and its issue holds a queue
slot the whole time. `queue-pickup.md` STEP 4c bounds driving CI to green at three attempts, and
`CLAUDE.md` §Working Principles carries the same rule for a directed session. Neither reaches a
session already running — stopping one of those is the owner archiving it.

**The board's live state is the fastest-moving thing in this file — do not read it here:**

```bash
# via the Linear MCP: list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c state=<one status>
#   -> Queued (AI) is the queue; Development (AI) is what is being built, and the slot-1/slot-2
#      labels on those rows are the concurrency count; any Needs help row stops every firing
```

## Connector rotation

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

## Two builds at once

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

## Branch cleanup

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
