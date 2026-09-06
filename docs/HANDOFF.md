# Handoff — where things stand

**Read `CLAUDE.md` first.** It carries the stack, the v2 design tokens, the settled
architectural decisions, the working principles and the canonical Supabase project. This file
is only the *current position* — the things that will be stale in a week.

**Prune it as part of landing work, not as a separate task.** Proof of something already
verified belongs in its migration's own §Verification footer; a settled decision belongs in
`CLAUDE.md`. What stays here is what is still true and still undone.

**The queue moved to Linear on 2026-08-07 — this file kept the facts.** *What is next and who can
do it* now lives in [Let's ride (AI)](https://linear.app/lets-ride/project/lets-ride-ai-10cb543bcb9d)
(`PD-86`–`PD-103` were the seeding); *what is true, and the command that proves it* stayed here.
`CLAUDE.md` §The roadmap lives in Linear carries the boundary and the status pipeline. The one
thing to internalise: **the owner releases work by dragging it into `Queued (AI)`** — that
column is the start signal, and a session that picks its own work from the backlog has taken the
decision the board exists to give them.

## Before you trust this file

Every claim below is about state that moves without this file moving with it:

```bash
git log --oneline -5 origin/main                  # what actually shipped
git diff --stat origin/main -- docs/HANDOFF.md    # is this file itself unmerged?
```

If the second prints anything, someone edited the handoff and it never reached `main` — which
has happened, and is why a `Stop` hook warns about it (`.claude/hooks/handoff-landed-check.sh`).

**What is reference rather than position lives in `docs/reference/`** — moved out on
2026-09-01 so this file could be read in one sitting: the native shell and store readiness
(`native-shell.md`), running the app and the walk (`running-locally.md`), the per-project
migration log (`migrations.md` §Applied state), known issues (`known-issues.md`), the signup
fix (`signup.md`) and which design to build from (`design-system.md`); on 2026-09-02 the CI
hand-gate (`ci.md`), the route census (`render-model.md`), the container and connector traps
(`constraints.md`), the observability position (`observability.md`) and where the DEV/PROD split
stands (`ENVIRONMENTS.md`). A section here that says "moved whole" is a pointer kept so existing
citations resolve; the content is at the target.

---

## A green tick is not a check — read the jobs, not the run

Moved whole to [`docs/reference/ci.md`](reference/ci.md) on 2026-09-02 — the hand-gate for when
CI is unavailable, the runner-outage signature, the two build shapes and the four `npm ci` traps.
The heading is kept so existing pointers resolve. The one line to carry: a run's
`conclusion: success` with both real jobs `skipped` tested nothing — read the jobs.

## Branching, as of 2026-08-07 16:42 UTC

- **`development` is the repo's default branch.** So a session clones `development` and reads
  `CLAUDE.md` and `.claude/` from it — an instruction merged there is now actually in force.
  `docs/ENVIRONMENTS.md` §The last piece has the reasoning and the ordered checklist.
- **Where `main` is, and what the last promotion carried, are commands rather than lines here** —
  this section used to name the sha and the count, went two promotions stale, and once had a new
  promotion prepended to ids that were already wrong:

  ```bash
  git log --oneline -1 origin/main                     # what shipped
  git log --oneline --merges -5 origin/main            # the promotions, newest first
  git rev-list --count <sha>^1..<sha>^2                # what one carried (shallow clone: newest only)
  git log --oneline origin/main..origin/development    # what is waiting for the next one
  ```

  **`development` is normally AHEAD of `main`, and that is the steady state rather than drift.**
  The two are level only in the minutes after a promotion. What *is* invariant: `main` moves only
  by promotion, and everything else lands on `development` first. Each promotion's migration
  ordering — which files went before the build served and which after — is recorded per file in
  `docs/reference/migrations.md` §Applied state.
- **Rename and "switch default branch" are different controls in different places**, and
  reaching for the first is how this repo once ended up with two branches differing only in case,
  no `main` at all, a Vercel Production Branch pointing at a branch that no longer existed, and
  CI matching neither (GitHub branch filters are case-sensitive). Settings → General → Default
  branch → ⇄ is the one that moves a pointer.

---

## The next epic: the native shell, and store submission

Moved whole to [`docs/reference/native-shell.md`](reference/native-shell.md) on 2026-09-01 —
what landed in the shell, what is written-and-unverified-on-device, and the store-readiness
table. The two headings below are kept so existing pointers resolve; the content is there.

### The shell — started 2026-08-07

See `docs/reference/native-shell.md` §The shell.

### Store readiness — assessed 2026-08-06

See `docs/reference/native-shell.md` §Store readiness.

## Owner actions — nobody in a session can do these

**The queue is Linear's** — label `Owner only`, which is how these surface without anyone reading
this far into a file. `list_issues project=88f3f224-ecf0-46f0-a032-c86b7a12f81c label="Owner only"`
is the live list; the table that used to sit here was a second copy of it and is gone. **This
section keeps only what an issue body has no room for: the commands, and the two caveats that
explain why an item is not optional.**

**Re-measure before quoting any of them.** Two `Owner only` issues in a row have been found
already-fixed (`PD-88`, the Site URL and redirect allowlist; `PD-93`, pinning `defaultMode`), and
that is a pattern rather than a coincidence: **a dashboard setting has no file to change, so
nothing marks it done except someone re-measuring.** The credential-free probes are in
`docs/ENVIRONMENTS.md` §The redirect allowlist.

Every one is a dashboard click or a credential a human holds, so **ask for them rather than
working around them.** Four carry detail worth having at hand:

1. **`PD-90` — enable `UpdatePasswordRequireCurrentPassword`.** Worth knowing *why* it is not
   optional: it is what actually closes the recovery hole `026` can only gate at the app's front
   door — GoTrue's `PUT /auth/v1/user` accepts a password change from any live session, measured.

2. **`PD-86` is CLOSED — 2026-08-16, and PROD's `SERVICE_ROLE_KEY` is PROVEN**, by a real
   deletion against `zwprydcyryvudhurbnye` verified in the database rather than off the 200:
   `auth.users`, `public.profiles` and `auth.identities` all gone, re-sign-in `400
   invalid_credentials` (so a hard delete, not Supabase's soft mode, which would have made the
   address unreusable). Read that issue, not this line, before re-running anything — the
   already-fixed `Owner only` item is a recurring shape here, and `:398`'s query is how you check
   rather than any count written down.

   **Only the destructive leg is the one not to repeat**, because it creates and irreversibly
   deletes a real PROD account. Everything else ran on DEV on 2026-08-19, where an account is
   free — including the two probes this passage used to schedule, a request with no `password`
   and one with a wrong non-empty password, both refused `reauth_required`. The durable half is
   the split rather than the errand: a probe that creates and deletes nothing is not deferred
   alongside one that costs a real account.

   The redeploy carrying PD-102's re-authentication proof closed **2026-08-17T14:32Z** — `delete-account`
   at **PROD v9 / DEV v5**, both `ezbr_sha256` `9793933d…`, both newer than the directory's last
   *behavioural* commit. Both functions are `ACTIVE` on both projects with `verify_jwt` true;
   `resolve-ride-location` sits at `c09a0474…`, DEV v6 / PROD v5, redeployed 2026-08-27T14:41Z with
   PD-236 — and `search-places` at `97ae3134…`, DEV v5 / PROD v9, redeployed 14:28Z the same
   sitting. **Nothing is owed on any of the three today**, which is rare enough to be worth
   re-measuring rather than trusting.

   **What IS still owed is a re-render of the stored tiles.** A tile is rendered once and written to
   `rides.map_card_path` / `map_detail_path`; nothing re-renders it, so every ride created before
   2026-08-27T14:41Z keeps the old build's output — burned-in credit, card z13, detail z15, no pin.
   The function runs on ride creation and on an address edit and nowhere else, so clearing them is a
   deliberate pass through the app's own edit form rather than something that heals.

   **Cross-project equality never means current** —
   it says the two projects agree, never that either matches the repo, which is row 2 of §Store
   readiness above, not §Known issues, a bulleted list with no rows in it. PD-231 put
   `list_edge_functions` on `reviewer`'s `tools:` line so it can make that comparison rather than
   probing the endpoint — **an entry on a `tools:` line is not availability**. PD-246 is the
   measurement and is closed (2026-08-17T14:53Z, owner); the rule stands, the outage it recorded
   does not, and three review passes since have reached both connectors under their plain names.

   **Every redeploy is an owner action**, via the dashboard rather than the CLI — Edge
   Functions → *Deploy a new function* → Via editor, secret under Project Settings → Edge
   Functions. So an edit to `index.ts` is silent drift until someone repeats this. The CLI path
   failed twice on things the dashboard cannot get wrong: it resolves
   `supabase/functions/<name>/index.ts` relative to the **current directory**, and the secret and
   the deploy were aimed at different project refs.

3. **`PD-92` — supply the T&C version string.**

   - `030` stamps every new consent with `0-placeholder`, because `/legal/terms` is placeholder
     copy that disclaims being an agreement. **Replace it when the binding text lands** — one
     line in `private.current_terms_version()`, in a new migration. Consents already stamped
     keep the version they were given, which is the point of the column.
4. **`PD-94` — sweep the orphaned Storage objects**, and note that **only the owner can**. Run
   2026-08-06 as `qa-verify`: *"0 object(s) in your folder, 0 referenced by a postcard. No
   orphans."* That settles nothing about the two objects (1.15 MB) the note refers to, because
   the sweeper signs in as a rider and `010`'s Storage policies scope it to
   `postcards/<that rider's uid>/`. The orphans are in the folder of whoever hit the bug fixed
   in #21, which is not this fixture. Needs their own credentials:

   ```bash
   export $(grep -v '^#' .env.local | xargs -d '\n')
   NODE_USE_ENV_PROXY=1 RIDER_EMAIL=… RIDER_PASSWORD=… npm run storage:sweep   # then -- --delete
   ```

   `NODE_USE_ENV_PROXY=1` and exporting `.env.local` are both required — the script reads the
   URL and key from the environment and Node's `fetch` ignores `HTTPS_PROXY` without the flag.

**Not an owner action, but the next thing a session should pick up if the shell is blocked:**
verify the remaining Postcards screens against the design. `/postcards/new` and
the postcard thread still carry inferred composition; the design has frames for both.

## Running things in this container

Moved whole to [`docs/reference/running-locally.md`](reference/running-locally.md) on
2026-09-01 — the per-command table, the relay, the walk and its fixtures. The heading below is
kept so existing pointers resolve.

### The walk, and the relay it now needs

See `docs/reference/running-locally.md` §The walk.

## The reaper watches every child, and the service_role split was never a split — 2026-09-06

**PD-399 + PD-408 + PD-409, one branch, taken into `slot-1`.** Grouped because all three would
otherwise have taken migration number `112` and all three land in `supabase/tests/rls_test.sql`;
the first two edit the same `comment on function`.

**PD-399 + PD-408 — `112_the_reaper_watches_every_child.sql`, applied to DEV.** `107` §5 hung the
ownerless-club reaper on `postcards` DELETE **alone** and filed the rest, so a club emptied in any
other order was never revisited and stayed for ever: invisible, unjoinable, uneditable, undeletable
and unreapable. `112` adds the three missing `AFTER DELETE` triggers — one per remaining conjunct —
and rewrites the comment that claimed an enumeration it never had.

**`112`'s own header is the canonical account and is not restated here** — it argues, per table,
why the function body does not move, why `club_members` is built despite being unreachable today,
why re-entrancy is one level *by construction*, and why the `WHEN` clause is on `postcards` and
`rides` and nowhere else. Read it before touching the reaper. The two things worth carrying out of
it: **a table that can make the reaper decline must be able to re-ask when it clears** (which is
why the unreachable `club_members` trigger ships), and **the whitelist and the re-entrancy bound
are the same fact** — each trigger-bearing table is also a conjunct, so the delete only runs when
that table contributes zero cascade rows.

**The hand-exercise gate ran BEFORE the apply**, in `DO` blocks that raise at the end so they
cannot commit, ordinary paths driven as `authenticated`. Ten checks, all PASS. The two worth
keeping: a rider **leaving a club** (the ordinary action this put new code in front of), and an
**account erasure** running the new `club_members` trigger inside the rider's own deletion
transaction, where a raise would abort the erasure itself.

**PD-409 — no migration, and the issue's own framing was the thing that was wrong.** It reports
`081` and `094` as "opposite precedents" with "nothing saying which is the rule", and offers
revoking `service_role` across the six club/ride thread tables as the honest fix. **Measured, the
split is 30-vs-3, not 2-vs-1**, and the three are a category rather than a precedent:
`postcard_reports`, `club_thread_reports`, `push_devices` — two moderation queues whose rows are
reporter identities, and a device-token store. **`076` §3 already states the rule and scopes it in
as many words**: *"The narrowness is deliberate and is not a claim about the other tables."* So
`094` followed `076`; `081`/`108` leaving the thread tables alone was **correct**, and revoking
across them would make six tables inconsistent with the other twenty-four.

What was genuinely missing is what the issue's title says: the rule was written only in a migration
body, where the next table's author does not look. It is now in `CLAUDE.md` §Supabase Rules.
**No migration, no grant change** — the schema was already right under the correct rule.

- **The local suite cannot measure this and must not pretend to.** `service_role` is a bare role in
  `harness.sql`, so `has_table_privilege` reads **false for every table** there — an assertion
  would pass for the wrong reason. The three existing per-table assertions defeat that by granting
  the hosted default and revoking it inside a savepoint (`rls_test.sql` :1630, :25674); that trick
  does not generalise to a set, so the hosted query in `CLAUDE.md` is the measurement.

**Suite 3630 → 3642**, reconciled by **label set**: +12 `112.*`, **6 relabelled 1:1, 0 lost**. Four
of the six were pre-existing trigger pins that the new triggers turned red — working exactly as
designed. Two were converted from a **count** to a **name list** while updating them (`rides`'
eight triggers, `club_threads`'), because a count cannot see a swap and its failure diff names
nothing; `107.12b`'s own reasoning, applied where it was already being edited. Every new assertion
verified both ways, and the three behavioural ones by counterfactual on DEV: **without the trigger
the club survives as a permanent orphan; with it, reaped.**

```bash
git grep -n "reap_ownerless_club" -- supabase/ | grep -c .
PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"   # 3642, from 3630
```

## A removal now bars a live invite link, and the join waves got their behaviour back — 2026-09-06

**PD-361 + PD-376, one branch, taken into `slot-1`.** Grouped because both land assertions in
`supabase/tests/rls_test.sql` and the first carries the migration that fixes the number.

**PD-361 — `111_a_removal_bars_a_live_invite_link.sql`, applied to DEV.** `088`'s
`remove_club_member` deleted one `club_members` row and its own comment said *"removal is not a
ban"*; `093` shipped afterwards with a reachability helper carrying no conjunct about removal, so a
removed rider pasted the same pre-minted URL back in and was a member again. `public.club_removals`
is the bar — keyed on the pair, written inside the RPC after its authority block, read by one new
conjunct, and deleted the moment the rider is readmitted by any other route. Built from the proposal
that PR #403 landed; **the narrow reading is the owner's** and this closes the link door alone.

**Six things a later session should not re-derive:**

- **The predicate has exactly one legal home**, and the proposal's table of rejected sites is the
  reason. The one to watch is `private.join_club_from_invite`: it is shared with the in-app accept
  path, so a conjunct there closes a door the owner deliberately left open — and it is the tidiest-
  looking fix, which is what makes it dangerous.
- **The clearing trigger MUST be `security definer` with `set search_path = ''`, and this is
  measured rather than argued.** Dropping that line turns the *pre-existing* assertion `anyone can
  join a public club` red with a permission error — the outage arriving exactly where `design.md`
  D3 predicts it. `joinClub` inserts as `authenticated`; the other four admission paths are definer
  and would pass silently, which is why `111.13a` reads `prosecdef` from the **catalogue**.
- **The live helper carried EIGHT conjuncts, not the seven `093` shipped** — `107` added
  `k.owner_id is not null`. The body was read off DEV rather than reconstructed from `093`'s file,
  which is exactly what a `create or replace` against a stale body would have silently reverted.
- **The suite's derived `029 §A` caught a real omission during the build**: `user_id` is a second FK
  into `profiles` whose leading column the PK does not index. Hence `club_removals_user_id_idx`. A
  hand-written list of indexed tables would have missed it; the derivation did not.
- **The hand-exercise gate ran BEFORE the apply**, in `DO` blocks that raise at the end so they
  cannot commit. The public Join button was measured with and against the trigger on **two
  independent clubs** — `notifications` delta **1** either way. A first attempt read 1 vs 0, and
  that was **fixture state, not suppression**: the first join's notification survived the membership
  delete and the fan-out deduplicated the second. An AFTER INSERT trigger returning `null` cannot
  cancel a sibling AFTER trigger.
- **Applied REDUCED and proved by object diff**, so its recorded statement will not equal `md5sum`
  of the file — the norm, not drift. The diff compared `md5` of `pg_get_functiondef` for all three
  functions, the column list, and the three `obj_description` strings between DEV and a local
  database that applied **the file itself**: all five identical.

**Open, and deliberately not built:** a rider removed while holding a **pending in-app invite** can
still accept it — the same defect one table over, on `club_invites`. It stays on PD-361 rather than
becoming a second row, because the owner's decision names the link path alone and this is one
statement in a later migration if they widen it.

**PD-376 — the two behavioural assertions `101` took away are back, retargeted.** `101` dropped
`club_thread_waves` and with it the only *behavioural* fixture for two properties `092.1`'s own
comment claims of **both** wave tables. They are now `092.3a` (a block hides the row and drops the
count, in each direction, with the waver still reading their own wave) and `092.7a` (owner, admin
and member reach the same rows).

- **The structural half was never a substitute, and the isolation proves it.** `092.7` reads
  `pg_policies` for the *shape* of the predicate; it cannot see a role diverging through the
  **parent**, because the EXISTS runs against `club_members` under the reader's own RLS. Removing
  the admin's roster row fails `092.7a` and nothing else.
- **`092.3a` must not end with `reset role`.** `092.5` below it sets `test.uid` and reads without
  setting the role itself, so it inherits `authenticated` — reset it and `092.5` runs as the table
  owner, bypasses RLS, and reads the very row it exists to prove is hidden. Measured, not feared.
- **The reader is `920008` on purpose**: `920006` is blocked with the subject (`092.5`) and `920007`
  has blocked both wavers, so either would be counting an already-filtered set and the drop would
  not be this policy's doing.

**Suite 3570 → 3630**, reconciled by **label set** rather than by count: +51 `111.*`, +9 `092.3a`/
`092.7a`, **7 relabelled 1:1, 0 lost**. Every new assertion was verified both ways.

```bash
git grep -n "club_removals\|092.3a\|092.7a" -- supabase/
PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"   # 3630, from 3570
```

## The walk is green again, and both its baselines are measured — 2026-09-06

**PD-410 + PD-390 + PD-344, one branch, taken into `slot-1`.** Grouped because the first two are the
same file and the same measurement, and the third needed the identical relay + dev-server +
Chromium setup to separate its two candidate explanations.

**The walk's own printed totals, both runs green, exit 0** — this is what
[`docs/reference/running-locally.md`](reference/running-locally.md) §The walk now records, replacing
the dispute PD-390 was filed over:

| Account | Screens | Checks |
|---|---|---|
| Minted (no `WALK_EMAIL`) — CI's path | **26** | **75** |
| Named (`walk-fixture@letsride.dev`) | **26** | **78** |

**Neither number in the old argument was right**, which is why no amount of reading could settle it.
The named account measures 3 higher for one reason: `checkEditRetention` runs against a ride the
rider owns, and a freshly minted rider owns none.

**PD-410 — the walk's join phase was asserting against the flow PD-392 replaced.** `checkJoinClub`
wrapped the Join tap in `waitForTableWrite('club_members', …)` and then dismissed the sheet with
`Not now`; since PD-392 the tap writes nothing on that path and `Post` is the join. Three things a
later session should not re-derive:

- **The watcher is armed BEFORE the tap and that is the fix, not a style choice.** The tap writes on
  one of two paths — the sheet opens (`Post` joins), or `joinClub` runs on the tap itself for the
  default club and for a stale row where an introduction already exists. Which one happened is only
  knowable afterwards, and on the sheet path the write is a second click away. A watcher armed after
  the fact misses the direct join outright. `watchForTableWrite` is that half, split out of
  `waitForTableWrite`, which now returns the boolean rather than only warning.
- **Do not navigate on the membership write alone.** `Post` is two writes with no transaction across
  them; the membership lands first and the introduction second, and the sheet closes on the second.
  Navigating early cancels the introduction in flight, which leaves the rider in `097`'s *joined,
  owes an introduction* state — and the club detail then opens the MEMBER-mode sheet on arrival,
  which is `aria-modal` over a scrim, so the `Club options` click fails its actionability check and
  times out at 20s. **Measured exactly that way on the first run of the fix**, so the phase now waits
  for the sheet to detach and also dismisses a member-mode sheet if one appears.
- **`097`'s one-introduction-per-membership rule does NOT bound the residue.** The refusal keys on
  `club_threads.introduces_user_id`, and the composite FK is `on delete set null` on that column — so
  *leaving the club NULLs the marker* and the next run is not refused. **One introduction thread per
  `WALK_EMAIL` run, accumulating**; on the minted path `author_id`'s cascade takes it with the
  account. The phase posts a body that says it is automated rather than impersonating a rider.
  Cleaning it up is **PD-411**, and the ordering there is the trap: `club_threads` SELECT is
  membership-gated, so a delete has to run *before* the leave or the author can no longer see the
  thread they wrote.
- **The membership watcher carries its own 45s budget and must keep one.** It is armed before the
  tap, so at the default 20s the sheet wait in front of it can spend half the budget before `Post`
  is clicked — and a slow-but-successful join then reports a hard FAIL, which since this change
  reddens the run rather than printing a `!`. A gate that goes red on latency is the defect PD-410
  exists to remove, arriving from the far side.
- **The failure path leaves the club anyway, and that is not tidiness.** A missed write is not proof
  of a missed join, and on the `WALK_EMAIL` path nothing else ever collects the membership — that
  account is never deleted. It compounds rather than repeating: `discoverJoinableClub` picks a club
  the rider is *not* in, so each false failure would permanently shrink the pool by one club.

**PD-344 — the reported symptom and the actual defect are two different things, and only the second
was real.** Measured in this container's Chromium against the dev server:

- `navigator.share` is **`undefined`** here, so the arm the issue blamed cannot have run at all; the
  clipboard arm runs and resolves.
- The label **does** change: `"Link copied"` at 150ms, still there at ~1.05s, back to `"Share this
  postcard"` at ~2.65s. So *"the label never changes"* is `ShareButton`'s own 2-second `setNotice`
  reset being missed by an observer stepping through with tool calls — not the share path.

**The defect its body describes is real and is fixed**, and it is reachable on every platform that
has a share sheet, which is every platform a rider is on: `shareAppLink` returned `'shared'` from
**both** arms of its `navigator.share` try/catch, and all five callers read `'shared'` as *the sheet
was its own feedback, say nothing*. The fix branches on `AbortError` — which the Web Share API
specifies for a cancelled share and nothing else — so a dismissal still stays silent and every other
rejection falls through to the clipboard. **Where it is genuinely ambiguous it resolves as a
dismissal**, which reproduces today's behaviour for that subset and can therefore only improve on
the old unconditional `'shared'`, never regress it.

**`src/lib/__tests__/share.test.ts` is new and had no predecessor** — the function had no test at
all, which is how this survived. Verified both ways: reverting the branch fails exactly three of its
seven cases.

```bash
NODE_USE_ENV_PROXY=1 RELAY_UPSTREAM=https://fpmrimzxadewsaiwpsel.supabase.co node scripts/supabase-relay.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:3001 NODE_USE_ENV_PROXY=1 npm run dev
npm run walk                                     # 26/26 screens, 75/75 checks
npx vitest run src/lib/__tests__/share.test.ts   # 7/7
```

## Threads replace the ride chat — 2026-09-06

**PD-402 — three migrations: `108_ride_threads.sql` (additive, applied to DEV),
`109_retire_ride_chat.sql` (destructive, held back until the merged bundle was confirmed serving,
then applied) and
`110_a_ride_watermark_is_not_an_oracle.sql` (applied to DEV).** `034`'s
single unbounded chat stream is replaced by the club's model one domain over — `ride_threads` /
`ride_thread_messages` / `ride_thread_reads` on `081`/`082`'s shape, with the audience swapped from
club membership to `private.is_ride_crew` ∩ ride visibility. Owner's data call, 2026-09-05: *"we are
not live yet, so all ride chats can be dropped."* PROD held **0** `ride_messages` and **0**
`ride_reads` either way.

**All three are applied to DEV and the change is complete there.** `109` was held back until the
merged bundle was confirmed *serving* — `READY` on merge sha `923541c` with `aliasError` null — and
applied at 10:09Z, about 25 minutes after the merge. Its verification passed on every point: both
tables gone, `private.is_ride_crew` still present, publication down to
`club_messages, ride_thread_messages`, gate triggers 23 → 22, `notifications` untouched, advisors
unchanged at 41. **The post-`109` walk rendered 26/26 screens clean**, including all three new
thread routes, with `ride_messages` and `ride_reads` no longer in the database — which is the only
gate that could have caught a surviving read of a dropped table.

**THE ORDERING IS THE STORY, and it breaks in one direction.** `108` applies **before** the client
merges — it is purely additive and creates no object a shipped bundle can observe. `109` applies
only after the new bundle is **confirmed serving** on DEV: `READY` on the merge sha with
`aliasError` null, which is **not** the same as merged. This repo applied a destructive file 102
seconds after a merge once, out from under a Preview still calling the function it dropped.

**Six things a later session should not have to re-derive:**

- **They cannot be one file, and that also forces the new table's name.** The publication entry and
  the new tables must exist before the new bundle subscribes and reads; `ride_messages` must outlive
  the old bundle. One file cannot be both sides of a deploy — and because `108` runs while
  `ride_messages` still exists, the name is unavailable, which is why it is `ride_thread_messages`.
  **`ride_messages` is retired permanently and SHALL NOT be reused**: an old bundle hitting a
  same-named table with a different column set gets malformed rows rather than a clean `PGRST205`.
- **The audience is an INTERSECTION and neither half alone is it.** Every SELECT policy carries the
  `EXISTS` against `rides` evaluated as the caller **and** `private.is_ride_crew`. That is `034`'s
  own recorded trap — its first draft substituted the helper for the club's membership check and
  dropped the EXISTS, and shipped a leak. The own-row arm stays **inside** the block group and is
  not hoisted, which is the opposite of what `102` did for seven other policies; the change's
  `design.md` D6 has why the ride-thread case differs.
- **Deletion is a `security definer` RPC on both tables and never a DELETE policy, and this CLOSES a
  recorded gap rather than porting it.** RLS filters a DELETE by what the caller may READ, so a
  policy-based delete silently affects zero rows whenever the row is invisible to its own author.
  §Your own row survives the parent going out of view records `ride_messages` as carrying a residual
  silent `DELETE 0` that `102` deliberately left open, because hoisting past the `is_ride_crew`
  conjunct would have broken the INTERSECTION invariant. A definer function is not subject to the
  SELECT policy at all, so the replacement cannot inherit it. **That entry's open item is closed by
  the table going.**
- **`ride_thread_reads`' write policies must carry the audience conjunct, and `110` is what put it
  there.** `108` shipped them as a bare `user_id = auth.uid()`, which reinstates the existence
  oracle `015` §2 and `081` §2 closed: a watermark write against an invisible-but-real thread
  succeeded where a nonexistent one raised, so a signed-in rider could test whether a uuid named a
  real thread. **The measurement that settles any future argument about this**: `club_thread_reads`
  AND `feed_reads` both carry the conjunct on INSERT and UPDATE, so `ride_thread_reads` was the only
  watermark table in the schema without one. A new watermark table follows those three, not the
  shape `108` shipped.

  **Post-fix, a nonexistent `thread_id` does NOT raise `23503`** — RLS evaluates `WITH CHECK` before
  the FK's AFTER trigger, so both cases return `42501`, which is exactly what makes them
  indistinguishable. An assertion written against `23503` would pin the bug rather than the repair.
- **`moderate_ride_thread` has TWO authority arms and the tasks file named one.** `tasks.md` 2.16
  gave it `rides.organizer_id` alone while 2.8 forbade a DELETE policy, which between them left a
  thread's author unable to remove their own thread — contradicting the spec's own scenario at
  line 263. Line 257 settles it: *"a crew member who is neither the organizer nor the thread's
  author SHALL be refused"*. So the arms are organizer **OR** author, in one function. It is still
  **not** `private.is_ride_crew` (every crew member deleting every other's thread is not
  moderation) and still not the club's owner or admin — the resource is the ride, and a ride has no
  admin role.
- **The no-paging argument survives conditionally rather than by luck.** `ride-timeline.ts` argues
  it does not page because a ride is a bounded event. A conversation is the first source on a ride
  with **no natural ceiling**, so that only holds because both thread sources are bounded by thread
  COUNT: creations are one row per thread by construction, and `getRideThreadReplies` collapses its
  message window to one row per thread before returning. **Its horizon is taken from the WINDOW,
  never from the survivors** — deriving it from the returned rows makes a two-hundred-message window
  in one thread report a horizon at that thread's latest message and cut the ride's whole history to
  the last hour. Both directions are pinned by tests.
- **`mergeRideTimeline`'s completeness derivation is deliberately untouched**, and adding a
  collapsing source is exactly why. The club's weaker form (*"the horizon filter dropped nothing"*)
  was reachable-wrong through `getClubThreadReplies` for that reason; PD-400 has since made the two
  expressions byte-identical, and that is the state to keep them in. Do not "align" them.

**The OpenSpec archive is deliberately NOT done, and `openspec/specs/ride-chat/` is still there.**
`tasks.md` 10.1 asks for it and `design.md` D11 gives the order — archive `add-ride-chat-unread` and
`invite-riders-to-a-ride` first, because both carry `MODIFIED` deltas against requirements this
change removes, and whichever archives second has its edit silently discarded. **The reason it was
left is one D11 does not mention**: `invite-riders-to-a-ride` carries **six** spec deltas and only
one is `ride-chat` — the other five (`client-cache-invalidation`,
`database-enforced-integrity`, `event-fanout-integrity`, `notifications`, `ride-invites`) fold into
live specs and belong to a different story. Archiving it with `--skip-specs` to dodge the ordering
problem would discard those five, which is the same silent loss D11 warns about arriving from the
other direction; archiving it properly means folding another story's spec edits on this session's
judgement, and `openspec/` is in the CI denylist so nothing would catch a mistake.

So it is left whole rather than half-done. Whoever picks it up: archive the two others **with**
specs, in D11's order, then this one, then confirm `openspec/specs/ride-chat/` is **deleted** rather
than left as an empty shell.

**It has an owner and an order now (2026-09-06).** The archive is `PD-403`'s remaining half — that
story delivered everything else and stays open for this — and `PD-403` is `blockedBy` **`PD-359`**
(*"Archive the two invite OpenSpec changes so ride-invites becomes a standing spec"*), which is the
story that owns the five deltas above. So the sequence is `PD-359`, then `PD-403`'s remainder. Do
not archive `add-ride-chat-unread` alone to make one of them look finished; that is the ordering
failure this whole section exists to prevent.

**There is no `ride_message` notification kind, and the issue says there is.** `036` and `060` name
`ride_messages` only in **comments**, as the precedent their own reasoning copies — the comment
trap, where a grep for the retired thing counts its obituaries. `notifications_type_check` has 16
arms and that is not one. So `notifications`, its CHECKs, its policies and its fan-outs are
untouched, and roughly a third of the migration the issue describes does not exist.

**Nothing in `design/` draws a thread, in either domain.** The snapshot holds `Ride - Chat`,
`Ride - Chat - Options` and `Ride - Chat - Text focus` — the screens this deletes. The club's thread
screens were built without a v2 frame and this copies **the shipped club implementation**. Do not go
looking for a frame.

**Two follow-ups are scoped and deliberately not built** (proposal Q3, Q4): a reply notification —
the chat produced none, so its absence is not a regression, and `098` is the largest fan-out
migration in the repo — and thread reports. **Q4 is the owner's because of its trigger rather than
its size**: App Store Review Guideline 1.2 wants a report path on user-generated content, and this
change adds a new UGC surface, so the store submission is what flips it to blocking. Until then a
rider's remedies are to leave the crew and to block the author, and RLS applies a block to every
thread surface.

```bash
git grep -n "ride_thread_messages\|moderate_ride_thread" -- src/ supabase/
npx vitest run src/lib/rides src/lib/data/__tests__/ride-timeline.test.ts scripts/native
```

## `101`–`107` were promoted, and both projects were briefly level — 2026-09-06

**`main` carries `f3c55b4` (35 commits, PR #405) and PROD is at migration `107`.** Both projects
now hold 107 files and 39 security advisors, and `development` was fast-forwarded to `main` so the
two branches do not diverge. Riders have block/hide undo, the paging club timeline, the ride
timeline, the introduction-as-join, the trimmed privacy sheet, and a club that survives its last
member instead of taking other riders' postcards down with it.

**The promotion's real decision was an ORDERING CONFLICT and it will recur** — the seven files did
not agree about which side of the deploy they wanted. `CLAUDE.md` §Supabase Rules carries the rule
that settled it and [`docs/reference/migrations.md`](reference/migrations.md) §Applied state the
per-file detail; do not copy either back here.

**`103`'s already-loaded-tab hazard was measured empty rather than waived.** That file's own log
says a PROD promotion should ship the transitional group-1 upsert and let it soak, because an SPA
tab holding the pre-merge bundle keeps issuing the plain insert for days. PROD had **0 sign-ins in
seven days** and a most-recent sign-in of 2026-08-14, so no such tab existed. **On a PROD with live
riders that argument evaporates and the soak is the answer** — do not read this promotion as a
precedent for skipping it.

**PROD's objects were proved against DEV rather than against the recorded text**, which is the only
check that catches a transcription error in an apply that succeeded. Both exceptions it found were
comment-only, and in the direction where PROD matches the repo file and DEV does not —
`migrations.md` §What reads as drift carries them.

**The check is three answers, not one** — the applied chain on each project against the files, in
both directions. `list_migrations` on `zwprydcyryvudhurbnye` and on `fpmrimzxadewsaiwpsel` (both 107
names, DEV carrying three extra rows with no file) against:

```bash
ls supabase/migrations/*.sql | wc -l   # 107
```

## The queue jam was an unmerged PR, and the stall check cannot see one — 2026-09-06

**`slot-1` held PD-98 from 2026-09-05T19:43:43Z until this merge, and its build never died.** It
opened [PR #396](https://github.com/Lenhador88/LetsRide/pull/396) at 20:35Z with `107` in it,
gates green, and ended there without merging. Six firings and two handoff entries then reported
the branch as never pushed, and PD-406 was filed on that.

**`queue-run.md` STEP 6 missed it exactly as written.** It ages the branch with
`git ls-remote --heads origin | grep -i "pd-<n>"`, and this repo's branches are `claude/<slug>`,
so the grep finds nothing on a healthy build *and* on this one. The file says to read that as
**unknown, not dead** — the 23:44Z alarm did; every prose entry after it hardened `unknown` into
`never pushed`, which is the one claim the file forbids.

**An open PR is the signal that separates the two, and STEP 6 now asks for it FIRST** — before it
ages any branch, and a hit ends the ageing. The final message then reads
`PR #<n> open, unmerged — merge it` with the link, which the owner can act on in one step, instead
of `unknown`, which they have to re-derive.

**Three details in that block are load-bearing and each was a review finding**, so do not
"simplify" them back:

```
mcp__github__list_pull_requests  owner=Lenhador88 repo=LetsRide state=open base=development
```

- **`list_pull_requests`, not `search_pull_requests`.** The second is not on
  `.claude/settings.json`'s allowlist, and an unlisted tool on an unattended firing is a permission
  prompt nobody answers — the stall this change exists to end, made hourly.
- **The match is `Closes PD-<n>` in the body or `(PD-<n>)` in the title, never a bare mention.**
  A PR body names the issues it filed and folded in, so #396 carried PD-398 in its own `## Filed`
  section; matching that would report the wrong issue and, since a hit stops the ageing, silence
  the other slot's real stall.
- **Absent tool → say so and fall through to the branch tip.** STEP 0 does not probe this read, and
  `mcp__github__*` is the one connector family with no second spelling to try.

**The no-hit path is unchanged and its last line is the one that failed.** `unknown` still means
unknown; STEP 6 now says so twice, because every hardening of that word on 2026-09-06 was false and
one became a High-priority issue offering to revert a live migration.

## The removal bar is proposed, not built — 2026-09-06

**PD-361, [PR #403](https://github.com/Lenhador88/LetsRide/pull/403) — the proposal only, and the
story stays open.** `openspec/changes/refuse-a-removed-rider-a-live-invite-link/` specifies a
`public.club_removals` row keyed on `(club_id, user_id)`, an eighth conjunct in
`private.club_invite_link_reachable_by`, and a trigger that clears the row on readmission. **No
code, and no migration number** — the build was deferred by the concurrency cap, not by any
judgement about the story.

**The defect, verified first-hand rather than from the issue:** `088`'s `remove_club_member` deletes
one `club_members` row and its own comment says *"removal is not a ban"*. `093` shipped afterwards,
and its reachability helper carries seven conjuncts of which none is about removal — so a removed
rider passes `not is_club_member_for` **because** they were removed, and a pre-minted link readmits
them silently.

**Five things a build must not re-derive:**

- **The predicate has exactly one legal home**, and that is what makes the owner's narrow reading
  expressible at all. `093.22` forbids a caller predicate in the public bodies, `093.18` requires the
  preview and the claim to answer identically in every dead state, and
  `private.join_club_from_invite` is shared with the in-app accept — so a predicate there would close
  PD-360's door too, which is the wide reading the owner declined. The reachability helper is the
  only site that closes one door and not the other.
- **The clearing trigger is the change's one real hazard.** `after insert on public.club_members`
  with no `WHEN` clause runs inside **every club join in the app**, beside `notify_club_joined`, and
  a raise there takes a rider's join down with it. It exists because without a clearing path the bar
  silently becomes the permanent ban the owner explicitly rejected — invisibly, since no role can
  read the row. It fires the hand-exercise gate, and `tasks.md` group 4 is that gate.
- **That trigger function MUST be `security definer` with `set search_path = ''`.** A trigger
  function defaults to `security invoker`, and `club_removals` grants nothing to `authenticated`
  and carries no policy — so an invoker-rights delete raises `42501` and rolls the rider's join
  back. All three triggers already on `club_members` are `security definer`. **Which joins break is
  a question about the writer's role, not about whether a removal row exists** — Postgres checks
  table privileges at executor start, so `joinClub`'s direct insert as `authenticated` fails every
  time while the two `security definer` invite paths inherit the owner's rights and pass silently.
  That asymmetry, plus the fact that the RLS suite runs as the table owner (the `029` trap), is why
  `tasks.md` 3.13a asserts `prosecdef` as a catalogue read rather than from a green join.
- **`removed_by` is deliberately absent, and that is a spec requirement rather than a saving.**
  `manage-club-riders` requires that *"nothing anywhere SHALL record who removed whom"*. That same
  spec's *"no tombstone row SHALL be created"* is now false, handled by an explicit REMOVED+ADDED
  delta pair — do not read the contradiction as an oversight.
- **A voluntary leaver is not barred**, and the distinction is made by writing the row **inside
  `remove_club_member`**, never by a DELETE trigger on `club_members` — which would also fire on
  cascades and on anyone leaving.

**One question is the owner's and is non-blocking:** a rider removed while holding a **pending
in-app invite** can still accept it — the same defect one table over, on `club_invites` rather than
`club_invite_links`. Left open because the owner's decision names the link path alone. `088` already
deletes any **`club_join_requests`** row for the pair on removal — unscoped by status, though a
`pending` survivor is the stated reason: it *"would let a second admin undo this removal"* — so the
`club_invites` counterpart is one line in
the same migration. **`088` touches no invite table at all**, which is the defect this proposal
exists to fix; do not read that precedent as covering links. It lives on PD-361, not as a second
row.

```bash
npx openspec validate refuse-a-removed-rider-a-live-invite-link --strict
```

## The floating action is proposed, not built — 2026-09-06

**PD-404, [PR #401](https://github.com/Lenhador88/LetsRide/pull/401) — the proposal only, and the
story moved to `Needs decision` rather than `Deployed to DEV`.**
`openspec/changes/replace-the-create-bar-with-a-floating-action/`. **No code, deliberately**: the
issue says *"the build must not pick one silently"* about its frame decision, and both ways forward
are closed to an unattended session — option 1 needs a Figma write (explicit owner ask), option 2
contradicts an approved v2 frame against decision #4.

**Three findings a build must not re-derive:**

- **The frame problem is TWO decisions.** `2375:8771` draws the ride detail's nav bar at **390×88
  with no create control**, so `RideCreateBar` is already an additive departure and converting it
  contradicts nothing. `2043:10604` instances the same component at **390×152** with
  `Button Container 358×56` inside it, so converting the club changes a variant **26 other** frames
  instance. That asymmetry is what makes a split available: ride detail now, club detail later.
- **The story's value and its worst defect are one decision.** With the tokens' own
  `16 pad + control + 8` rule, a 56px control reserves **80px** and a 48px one **72px** against
  `--navbar-action`'s **64px**. **Nothing breaks even** — matching 64px needs a 40px control, below
  the 44×44 floor. The honest value is *horizontal* space; do not repeat the issue body's sentence.
- **There is no elevation token at all**, so a floating action would be the app's first persistent
  one — `grep -in "shadow\|elevation" design/TOKENS.md` is 0.

**Two blocking questions are the owner's**, both phrased as the rider's state in the proposal's
§Open questions. Filed **PD-407** (`/rides/explore` reserves 64px for a sticky action
`STICKY_ACTIONS` does not hold).

**The crossrefs gate now sits exactly at its ambiguous ceiling of 35**, so the next ambiguous
section pointer added anywhere in the repo trips it. Note in particular that **`§Working
Principles` can never be cited that way** — it is ambiguous against `§Working With the Product
Owner` on its leading word, and the checker counts a one-word leading match. Writing the
`<file> §<Section>` idiom out as an *example* trips the gate too: the checker cannot tell an
illustration from a citation, which is how this very entry went red once.

```bash
npx openspec validate replace-the-create-bar-with-a-floating-action --strict
npx vitest run scripts/docs/__tests__/crossrefs.test.mjs   # 26/26, at the ceiling
```

## `107` has its file, and nothing in the repo could tell — 2026-09-06

**DEV's applied `a_club_may_outlive_its_last_member` (`20260905203011`) is
`supabase/migrations/107_a_club_may_outlive_its_last_member.sql`**, merged with this change. It was
sitting in an unmerged PR that the section above explains nobody looked for. **PD-406's A/B/C
decision is withdrawn on the issue** — its option B, *revert it on DEV*, would now drop a migration
the repo has a file for. Its last section survives and is what that issue carries.

**The check that catches this exists, and nobody ran it.** `scripts/db/check-migration-drift.mjs`
builds the union of the files and both applied sets and reports `applied to a database but has no
file` — exactly this case, by name, in one line. But it needs `DEV_DATABASE_URL` and
`PROD_DATABASE_URL`, **which no session holds**, and it is not in `ci.yml`
([`docs/reference/migrations.md`](reference/migrations.md) §What reads as drift, and why none of it
is says the same of `074`). So the drift ran unseen for six firings past a gate that was written
for it. **What a session CAN reach is `list_migrations`**, so that is now the check that is
written down: `queue-pickup.md` STEP 4 compares the chain both ways before a build picks a number,
and `CLAUDE.md`'s drift paragraph names the applied-with-no-file direction rather than only the
unapplied one. **A `db:drift` CI job is still the better gate and it is the owner's** — it needs
`DEV_DATABASE_URL` and `PROD_DATABASE_URL` as Actions secrets, and **neither exists**:
`grep -rn "DATABASE_URL" .github/workflows/` returns nothing. That is an addition rather than the
repoint of §Owner setup item 5, which is about the `NEXT_PUBLIC_SUPABASE_*` pair naming PROD — a
different fact, and not an obstacle to adding these two.

```bash
git ls-files supabase/migrations/*.sql | tail -1   # 107_a_club_may_outlive_its_last_member.sql
```

## Three from one queue firing — a timeline lie, the ride's bottom slot, the privacy copy — 2026-09-06

**PD-400 + PD-401 + PD-405, one branch, taken into `slot-2`.** Grouped because all three are
small `src/`-only changes with no migration, so they fit one `reviewer` pass; they collide with
nothing, which is why the group is three rather than two.

**PD-400 — `mergeClubTimeline` could append the club's founding under a stream that had rows
behind it.** `complete` was derived from *"the horizon filter dropped nothing"*
(`inside.length === events.length`), which is a different question from the one the flag answers.
It is now `horizon === null && shown.length === ordered.length`, the test `mergeRideTimeline` has
always used.

- **Reachable through exactly one of the five sources, which is why it stayed invisible.** A full
  read of the other four returns at least `CLUB_TIMELINE_LIMIT` rows, so the display cap cuts
  before the horizon can lie. **`getClubThreadReplies` is the exception**: it collapses its window
  to one row per thread, so two busy threads return two rows out of a two-hundred-message window
  with a live horizon.
- **`resolveClubTimelineAdvance` needed no change** — it reads the flag rather than re-deriving
  it, so it became correct by the fix upstream. Do not "simplify" the two merges into one; they
  diverge on more than this.
- **The stricter test under-reports at the exact-boundary read, and that is NOT a new bug** —
  found in the pre-merge review and recorded so nobody re-files it. A source returning *exactly*
  its limit sets a horizon at its oldest row even when nothing is behind it, so `complete` is
  `false` where the old expression could read `true`. It **self-heals, with one condition**:
  `resolveClubTimelineAdvance` returns `fetch-window`, the next window comes back empty,
  `absorbClubTimelineWindow` nulls the accumulated horizon, and `complete` flips true on the
  following merge. The cost is one extra read on a boundary-exact club, and it is byte-identical
  to what `mergeRideTimeline` has always done — which is what the issue asked for.
  **The condition is the mount's window ceiling**, and it is the variant a later session would
  otherwise re-file as a fresh bug: at `CLUB_TIMELINE_MAX_WINDOWS` (10) that call returns
  `capped` rather than `fetch-window`, so the horizon is never nulled and the tail reads
  *cannot get more* instead of showing the true end. It needs a boundary-exact club **and** a
  rider who has already taken ten fetch steps, and it still fails in the safe direction —
  understating the end rather than asserting a false one.

**PD-401 — the ride detail's create bar, and the collision it had to settle.** `RideCreateBar` is
`ClubCreateBar`'s slot and geometry with **one** action (a postcard tagged to the ride), because
that is all a ride creates until PD-402 lands. `RideCrewRail` moved above `RideMap` and lost its
`SectionHeader`; it carries its own `mx-4`, so no geometry moved with it.

- **Option B of the issue's four, plus the fallback that makes it lossless.** `RideAttendanceBar`
  keeps the sticky slot outright; where it has it, the timeline heading's `(+)` survives. So a
  crew member always has **exactly one** entrance to the composer, never two and never none.
- **`resolveRideDetailActions` (`src/lib/rides/bottom-slot.ts`) is that decision, as a pure
  function, because the property is what a tidy-up breaks.** Simplifying `bottomSlot !== 'create'`
  back to `canRsvp` looks correct and re-opens it. Its test is exhaustive over the four-input
  space.
- **Option D — moving the RSVP into the page body — is deliberately NOT taken, and is still
  open.** It is the issue's own recommendation and it contradicts `2375:8771`, which draws that
  bar stacked on the navigation bar. That is the same frame decision PD-404 is parked on, and it
  is the owner's. **D is B minus one predicate**, so nothing here forecloses it.

**PD-405 — the privacy sheet says less.** The checkbox is `Share usage data` and its sub-label is
gone. **The replay disclosure did not go; it MOVED into the intro above the toggle**, because it
is the only place a rider is told their screen is recorded before consenting.

- **A sheet reading only `Share usage data` over a switch that enables session replay is the
  shape to avoid**, and this file is one careless trim away from it at any time.
  `PrivacySheet.dom.test.tsx` pins the fact **and its position** — presence alone is not the
  property, and the mutation that moves the clause below the checkbox fails only the order
  assertion (1 failed, 3 passed), which is what proves the two are independent.
- **Three surfaces must keep agreeing and only one is enforceable from here**: this sheet,
  `/legal/privacy`, and the App Store / Play data forms still parked on PD-232. Write copy from
  `src/lib/observability/scrub.ts` and `src/lib/analytics/events.ts`, never from a description
  of them.

```bash
git grep -n "resolveRideDetailActions\|horizon === null && shown" -- src/
npx vitest run src/lib/rides src/lib/data/__tests__/club-timeline.test.ts src/components/profile
```

## A club may outlive its last member — 2026-09-05

**PD-98, `107_a_club_may_outlive_its_last_member.sql`, applied to DEV.** `transfer_owned_clubs`'
no-successor arm deleted the club, and `postcards.club_id → clubs` is ON DELETE CASCADE, so a rider
erasing their account destroyed postcards belonging to riders who had left that club earlier. The
club now **survives, ownerless**, when third-party postcards are in it. Owner's decision, 2026-09-05
17:26Z, on the issue itself — they rejected both the inheritance default and detaching the postcards.

**Six things a later session should not have to re-derive:**

- **`club_id` is NEVER nulled to save a postcard, and the reason is stronger than the owner's.**
  They rejected detaching for loss of meaning. It is also a data-exposure bug: **`club_id is null` is
  the `postcards` SELECT policy's app-wide arm**, so detaching publishes a private club's photos to
  every signed-in rider. The direction is the whole safety argument — this change only ever moves an
  audience NARROWER, from "the club's members" to "its author alone".
- **`private.can_read_club` had to move in the same migration, and the change's own task list said
  not to touch it.** It is a `security definer` function carrying its OWN `is_public` test, so
  narrowing the policy does not reach it. `rls_test.sql` 060 pins the two textually and is the only
  thing in the repo that caught it. They must always move together.
- **The welcome club is EXCLUDED and still deletes — a security condition, not an oversight.**
  `complete_onboarding` is `security definer` and force-joins every new rider to `clubs.is_default`
  with no `owner_id` predicate ("the INSERT policy does not apply", says its own comment), so an
  ownerless welcome club would hand its preserved postcards to the entire signup stream. **All 5
  club-attached postcards on DEV are in that club**, so the remainder is most of the defect by row
  count — [PD-398](https://linear.app/lets-ride/issue/PD-398), filed rather than left in a comment.
- **Nulling `owner_id` is the MECHANISM.** `clubs_owner_id_fkey` is ON DELETE CASCADE; detaching from
  it is what makes the club survive. Implementing the arm as "skip the delete" leaves the club
  pointing at the departing rider, loses it to the cascade moments later, and passes every assertion
  written against the function in isolation.
- **Four more sites refused an ownerless club only via a neighbouring `<>` that happens to go NULL**,
  while their own `not is_blocked(…, owner_id)` conjuncts fail OPEN. None was a live hole; all are
  explicit now, because the change adds a requirement forbidding exactly that reliance.
  **Three-valued logic lands in three directions here: RLS `using` fails CLOSED, a CHECK fails OPEN,
  and a total wrapper like `not is_blocked()` fails OPEN.**
- **The reaper does not fire while a RIDE remains.** `rides.club_id` is ON DELETE SET NULL, so
  reaping over a surviving private ride strands the zombie `032` §2 exists to prevent. It is also
  `security definer` **because the `clubs` DELETE policy admits nobody for an ownerless club** — a
  `security invoker` version deletes zero rows in silence and passes any assertion that only checks
  the postcard delete succeeded.

**Open, and the owner's to answer:** a preserved postcard's club chip. `POSTCARD_SELECT` embeds
`club:clubs(id, name)` under the reader's RLS, so once the club is ownerless the chip stops
resolving — the club context survives in the DATA (`club_id` untouched, no repair needed if this is
ever widened) but not on screen. **No rider loses a chip they see today**: a club with an owner still
satisfies `is_public and owner_id is not null`, so this is a refinement of a brand-new state rather
than a regression.

```bash
git grep -n "reap_ownerless_club\|owner_id is not null" -- supabase/
PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"   # 3488, from 3440
```

## A block and a hide can be undone, and neither was a screen problem — 2026-09-05

**PD-298, `105_a_block_and_a_hide_can_be_undone.sql` + `106` (which narrows the hides accessor after review), applied to DEV.** Profile → ⋯ → **Privacy**
now carries a blocked-riders list and a hidden-postcards list — the first callers `unblockRider`
and `unhidePostcard` have ever had. Owner's choice of proposal 3, in the existing `PrivacySheet`
rather than a new route.

**The issue's own premise was false, and that is the durable part.** It says *"the schema is
already on our side … this is a screen, not a migration."* Measured on DEV as `authenticated`:

```sql
-- as the blocker: own blocks rows 1, the blocked rider's profiles row 0
select count(*) from public.blocks;                       -- 1
select count(*) from public.profiles where id = <blocked>; -- 0
```

`009`'s `profiles` SELECT policy applies `private.is_blocked`, which is **symmetric**, so the
blocker cannot read the profile of the rider they blocked. `011` §3 puts the hide conjunct
*inside* the `postcards` SELECT policy, so a hidden postcard is unreadable to the rider who hid
it — `011` says so at the index it creates. **So "the design draws no screen" was the symptom and
not the cause**: neither list could be populated at all. Two `security definer` accessors are the
fix, and each carries a visibility rule, which is why this went through `openspec`.

**Five things a later session should not have to re-derive:**

- **`my_blocked_riders()` deliberately does NOT restate `009`'s `username is not null`.** The
  standing precedent (`ride_journal_postcard_ids`) copies its table's qual verbatim, and doing
  that here drops a block against a rider who never finished onboarding — **a block missing from
  the list can never be lifted**, which is PD-298's own defect one level down. Pinned at both
  layers: `105.3` in the suite, and `BlockedRidersList.test.tsx` against a `.filter()` added later
  to tidy the render.
- **The hidden list carries NO per-row detail at all, and that is a security property rather than
  an unfinished screen.** The first cut returned `restorable` plus a preview, collapsing three
  reasons into one boolean. **The pre-merge review showed that is still a block detector, and it
  is the finding worth carrying**: for a postcard with `club_id is null` the club arm is vacuous,
  so `restorable` reduces to `not is_blocked(me, author)` — and `my_blocked_riders()`, shipped in
  the same change, tells a rider their own *outbound* blocks. Subtract one from the other and a
  quiet row says *"that rider blocked me"*, repeatably, on a schedule the rider picks. The
  three-way collapse was also only two-way: account deletion cascades the hide row away entirely
  (`105.10` asserts it), so it can never produce an unrestorable row.
  **No predicate fixes this** — for a non-club postcard the only reason to withhold is a block, so
  withholding *is* the signal and not withholding leaks the author's photo. `106` removed the
  differentiation instead: two columns, `postcard_id` and `hidden_at`, both facts about something
  the rider did. A component test asserts two rows render byte-identically apart from the date.
  **Enriching this list re-opens the channel**, and every enrichment looks like an obvious
  improvement.
- **Neither list can show an image, and this is structural rather than unfinished.** Storage
  signing is a second authorization pass run **as the rider**, and `010`'s policies resolve an
  `EXISTS` against `profiles`/`postcards` under the caller's own RLS. A `security definer`
  accessor bypasses table RLS and cannot bypass that. Showing the photo means widening a Storage
  policy — handing an author's image to someone they may have blocked — which is **an open owner
  decision, deliberately not taken** (proposal §Q1).
- **`revoke … from public` is not enough on a `public` function.** Supabase's project default
  grants EXECUTE to `anon` **explicitly**, and revoking from `PUBLIC` does not touch an explicit
  grant. `105` revokes from `public, anon`; `009` got away with `from public` alone only because
  `private` denies `anon` schema USAGE. `105.11` pins it as a privilege assertion, never a call —
  the suite runs as the table owner, which is what let `029` ship broken.
- **`105` adds exactly TWO advisors, one per accessor** — run rather than derived. It stood as a
  two-advisor difference between the projects until the 2026-09-06 promotion; both are at 39 now.

```bash
git grep -n "my_blocked_riders\|my_hidden_postcards" -- src/ supabase/
PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"   # 3440, from 3382
```
## The introduction sheet is the join now — 2026-09-05

**PD-392, [PR #395](https://github.com/Lenhador88/LetsRide/pull/395).** `IntroductionPrompt` opened
*after* `joinClub` had written the `club_members` row, so `Not now` read as *"don't join yet"* and
meant *"you have joined"*. On the Join-button path it now offers **Post** (join, then introduce) and
**Join later** (write nothing, join nothing). No migration — the sheet opening for a non-member is a
client mode, not a relaxation of `owesIntroduction`, whose `viewerRole !== null` conjunct is
untouched.

**Five things a later session should not have to re-derive:**

- **The order is forced and cannot be swapped.** `097`'s `introduce_to_club` refuses a non-member
  via `private.is_club_member`, so the membership lands first. The two writes are separately
  failable with no transaction across them, and a failed introduction deliberately leaves a member
  who owes one — `097`'s own first-class state. **No compensating delete**: a join-then-leave has
  the `club_joined` notification wake the story refuses, and `095`'s owner guard makes it not even
  total.
- **The dismissal rule is an iff and it has THREE call sites**, not the one the proposal first
  named: `record a session dismissal ⟺ a membership exists`. The sheet reports the fact out through
  `onDismiss` because it is the only thing that knows its own write returned; reading it back off
  the cache races `invalidateClubMembership`. `onPosted`'s unconditional write **is** the iff, not
  an exception to it.
- **`ExploreClubsList` is mounted TWICE** — `/clubs/explore` and `/clubs`' first-run screen — and
  the first cut wired only one. Every `Join club` on the screen a rider sees before joining anything
  did nothing at all: no membership, no sheet, no error, because the handler returns before the
  write. `onIntroduce` is **required** now and `ClubCard` is a discriminated union on `joined`, so a
  repeat is a type error. The queue is `src/lib/clubs/use-introduction-queue.ts` — one home, because
  two copies is how the two screens drift.
- **The latch is per sheet INSTANCE and hoisting it to a page is a defect.** After club A's `Post`
  lands, a page-level latch would open club B's sheet in member mode, `introduceToClub` alone would
  be refused for a non-member, and **B would become unjoinable** — surfacing as an introduction
  error rather than anything about joining. Both screens key the sheet per club for this.
- **The default club still joins in one tap.** It is exempt from introductions and reachable today
  with a live `Join club` button, so a sheet-only membership would make it unjoinable.
  `ClubMembershipButton` gained `is_default` as a required prop, **read as data** — asserting it
  from a screen's position in the flow is PD-384's defect.

**One open question is the owner's:** whether `Join later` emits an analytics event. Default taken —
no.

```bash
git grep -n "joinAndIntroduceToClub\|useIntroductionQueue" -- src/
npx vitest run src/components/clubs src/lib/actions/__tests__/join-and-introduce.test.ts
```

## The ride detail is a timeline now — 2026-09-05

**PD-393, [PR #393](https://github.com/Lenhador88/LetsRide/pull/393).** `/rides/detail` adopts the
club's shape: the plan is a header, and below it a merged stream of the ride's postcards, its crew
arrivals (`ride_members.joined_at`) and a floor entry naming who planned it (`rides.created_at`).
No migration — every source already existed. `RideJournal` is deleted and `getRideJournal` returns
a `TimelineSource<Postcard>` rather than a bare array.

**It does NOT page, and the club's does.** `src/lib/data/ride-timeline.ts` carries the argument: a
ride is a bounded event with two sources, so both are read whole and `steps` raises a display cap
over rows already in hand. If a ride ever routinely overruns `RIDE_TIMELINE_JOINS` (60) or
`FEED_PAGE_SIZE` (30), the club's window machinery is the answer and is already written.

**Two things this left standing, both the owner's call:**

- **`PostcardStamp` is DELETED — product owner, 2026-09-05, asked directly.** It was orphaned the
  moment the ride Journal dissolved, and the choice was between PD-257 bringing it back and it
  going with that story; the owner chose deletion. The component, its test, its `stamp-edge` mask
  and its postmark are gone, and **PD-257 now owes a tile of its own** if that story is ever
  built — `docs/FIGMA-FIDELITY-TODO.md` §The stamp as a franked postal stamp keeps the four
  measurements a rebuild would need. Every postcard in the app is a `PostcardCard`:

  ```bash
  git ls-files src/ | grep -c PostcardStamp    # 0
  ```

  The FILE, not the name: three files still mention the stamp in past tense, deliberately, and a
  grep for the word counts those obituaries — CLAUDE.md §Technology Decisions' comment trap.

- **`mergeClubTimeline` can read `complete` while a source still has rows behind it.** It derives
  completeness from *"the horizon filter dropped nothing"*; `mergeRideTimeline` uses the stronger
  and correct *"no source declared a horizon"*. Unreachable through four of the club's five sources
  — a full read there returns more rows than `CLUB_TIMELINE_LIMIT`, so the display cap always cuts
  first — and **reachable through `getClubThreadReplies`**, which collapses its window to one row
  per thread. The symptom is `club-created` appended under a stream that is not finished. One line
  in `mergeClubTimeline`; not changed inside a ride PR.

## Your own row survives the parent going out of view — 2026-09-03

**PD-362, `102_own_row_reads_survive_the_parent.sql`, applied to DEV.** Seven SELECT policies wrote
the own-row branch *inside* the block conjunct — `<parent EXISTS> and (own_id = auth.uid() or not
is_blocked(...))` — where it is a no-op (`blocks_no_self_block` already makes `is_blocked(x, x)`
false) and the parent EXISTS dominates. Since **RLS filters a DELETE by what the caller may READ**
(`081`), that silently disarmed three DELETE policies written deliberately without a visibility
requirement. **Three are hoisted, four are deliberately left alone**; the migration header carries
the per-policy reasoning and `102.4` pins the four that did not move.

**Five things a later session should not have to re-derive:**

- **The hoist would have widened a WRITE, and §1b is the whole reason it does not.** On
  `ride_members` alone, `048` grants UPDATE on `ride_id`, and the SELECT policy is applied to the
  NEW row of an UPDATE — so hoisting the own-row arm let a **non-member move their seat onto a
  private club's ride they cannot see**. `102` restates that refusal as an explicit `exists` against
  `rides` in the UPDATE policy's **WITH CHECK**. The **USING** side stays bare on purpose: leaving a
  ride you can no longer see must keep working, which is what §1 is for. **This was caught by an
  existing assertion (077.4), not by reading the diff** — which is the argument for measuring each
  of the seven rather than sweeping them.
- **Three in-repo comments already claimed the property the shape defeated**, which is why this is a
  defect rather than a design: `009`'s `postcard_likes` DELETE comment ("a rider must be able to
  withdraw a like from a postcard that has since gone out of view, **or the row is stranded**"),
  `011`'s `postcard_comments` SELECT comment ("Your own comment is unconditional, so you never lose
  sight of what you wrote"), and `092`'s table comment naming `postcard_likes` outright — *"do not
  'simplify' §3.1 to match `postcard_likes`, which carries the same defect and is filed separately."*
- **`postcard_comments` was the one PD-362 recorded as NOT measured. It is real** — its DELETE policy
  carries no parent EXISTS on either arm, so the SELECT shape was the whole of what refused an
  ex-member's withdrawal.
- **The four left alone each have their own reason, and a sweep would have got them wrong.**
  `club_members` is a **semantic no-op** (holding the row is what makes `is_club_member` true —
  `102.4b` proves it behaviourally); `club_messages` has **no DELETE policy at all**; `club_threads`'
  DELETE independently requires membership *and* hoisting would contradict PD-367 Q8, which the owner
  answered **EVICT**; `ride_messages`' DELETE carries its own `exists` against `rides`.
- **`ride_messages` has a residual silent `DELETE 0` and it is NOT this migration's** — a rider who
  leaves the crew of a ride they can still see. It comes from the `is_ride_crew` conjunct rather than
  the block conjunct, and hoisting past `is_ride_crew` would break the documented invariant that this
  table's audience is an INTERSECTION. Left open deliberately.

**Two pre-existing assertions changed their expected value, both from 0 to 1, and both encoded the
defect rather than a requirement** — the hider's own like in `011`'s hide block, and `051`'s
ex-member precondition (which the change makes *strictly stronger*: the ride-map tile is now proven
refused to a rider who **can** read their own surviving crew row). Suite **3310**, from 3280.

```bash
PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"   # 3310
git grep -n "MUST STAY THERE" -- supabase/    # the rule, recorded at each policy
```

## The walk opens both invite landing routes, and a firing now records what it cost — 2026-09-03

**PD-358 + PD-387, one branch.** Neither is rider-visible.

**PD-358 — `checkInviteLanding`, and its signed-OUT half is the first thing in `scripts/walk.mjs`
that asserts on a page loaded with no session at all.** `/rides/join` and `/clubs/join` join the
bare route list, and the phase opens each with a 32-hex token that parses and matches nothing.

- **The issue's premise "the app's ONE public screen" was true when filed and stopped being true
  four days later** — `093` (PD-360) shipped `/clubs/join` as the twin, and it was equally
  unwalked. The phase takes a `kind` off `INVITE_LANDINGS` rather than being written twice.
- **The load-bearing assertions are the two about the oracle, not the one about ride data.** A dead
  token cannot produce ride data whatever the screen does, so "no ride title on screen" would pass
  on a build that leaks every ride. What a dead token *can* show is whether a stranger can tell a
  live token from a dead one — which RLS cannot refuse, because each preview RPC is granted to
  `authenticated` and a refusal answers the question as well as a row does. So: the dead token is
  not reported as dead, and no request to the preview RPC leaves the page.
- **The route-list entries carry no token deliberately.** `adoptInviteTokenFromLocation` strips the
  query with `history.replaceState`, so a token there makes `finalPath` come back without it and
  the loop reports a redirect that did not happen.
- **The phase adds `+20` checks (10 per landing route × 2) and `+2` screens.** The base those
  deltas were once added to is no longer in dispute: both were measured on 2026-09-06 (PD-390) and
  live in `docs/reference/running-locally.md` §The walk — **quote that, and do not add a delta to
  a remembered number.** **The phase HAS now been run**, both accounts, all 20 assertions green.

**PD-387 — `.claude/commands/queue-pickup.md` §The cost record.** One labelled block in one Linear
comment, one line in the PR body. Three things a later session should not re-derive:

- **It is owed by any firing that CLAIMED a story, whichever way it ended** — so STEP 2c, §If you
  get stuck and STEP 4c's three-attempt CI bound all write it into the comment they were already
  writing. That is the requirement most likely to be quietly dropped, and the issue is explicit
  about why: a breakdown that only appears on the runs that went well is an advertisement.
- **The wall-clock stamp had to move to `queue-run.md` STEP 0.** PD-387 proposes reading `fired_at`
  off `list_triggers` and `usage` off `get_session`; PD-241's measured inventory says no
  `mcp__Claude_Code_Remote__*` tool exists in a Routine-minted session. Nothing recovers a run's
  start time afterwards, so STEP 0 takes it in the same call as the push probe. The two token rows
  read `not available` on a firing and the section says that is expected, not a fault.
- **Every row is labelled measured or self-reported.** The phase split is narration — no clock in
  the loop attributes wall time to activities — and it is marked as such *inside the block*, because
  the block is what gets read. Where the numbers surface and what figure stops a run is PD-388's.

```bash
git grep -n "INVITE_LANDINGS\|checkInviteLanding" -- scripts/walk.mjs
npx vitest run scripts/docs/__tests__/crossrefs.test.mjs src/__tests__/agent-briefs.test.ts
```

## A ride's audience guard is about the TRANSITION, not the shape — 2026-09-03

**PD-338 + PD-311, one branch.** `EditRideForm`'s `wouldStrand = !clubId && !isPublic` is gone;
`narrowsToNobody(stored, submitted)` in `src/lib/rides/audience.ts` replaces it, and `updateRide`
computes the same predicate against a **fresh read** rather than against the payload. A ride that
arrived clubless and private — PD-320's composer default, and the ordinary ride for a rider in no
clubs — is now editable; detaching a private ride from its club, and un-publishing a clubless
public one, are still refused.

**Four things a later session should not have to re-derive:**

- **`Narrow` was a stated ASSUMPTION, not an owner decision.** Nobody was available; the proposal
  says so at the top and
  `openspec/changes/scope-the-strand-guard-to-the-transition/design.md` §Open questions Q1 carries
  `Wide` (drop the guard) with its evidence. Wide is Narrow *minus one predicate*, so shipping this forecloses nothing — but if the
  owner wanted Wide, PD-338 is not fully answered.
- **The guard is advisory and always was.** The `rides` UPDATE policy carries **no `is_public`
  predicate** — measured on DEV, which is why there is no migration and why a diff for this touching
  `supabase/` would be wrong. Do not describe the action's copy as enforcement; it is now
  check-then-act as well (read `previous`, then UPDATE), so a concurrent commit can move the stored
  shape between the two statements.
- **`createRide` still carries no guard, and the spec now says that is deliberate.** Creating in
  the shape narrows nothing — no prior audience, no crew. The two write paths disagree by design;
  a future reviewer "fixing" the asymmetry would re-break PD-338.
- **The proposal review found the ex-member requirement naming `leaveClub` as its only route.**
  `removeClubMember` → `public.remove_club_member` is a second one, and `club_members` carries no
  admin DELETE policy, so a reader checking policies alone misses it. The spec now mandates copy
  about the *state* ("no longer a member of X") rather than the act, because neither the client nor
  the action can tell an ejection from a departure.

**Two follow-ons this opened rather than closed.** `clear_ride_map_tiles` and
`protect_picked_ride_location` now run for a population of rides that could not be updated at all
before, so editing a meeting point clears the tiles and depends on `resolve-ride-location` to
re-render them — which PD-385 is already open on. And the change directory is **implemented and
not archived**: `/opsx:archive` it only *after* `add-ride-club-edit-delete`, whose still-active
`ride-lifecycle` spec is the base text this delta attaches to.

```bash
git grep -n "narrowsToNobody\|RIDE_AUDIENCE_REFUSAL" -- src/
npx vitest run src/lib/rides src/components/rides src/lib/actions/__tests__/ride-audience.test.ts
```

**PD-311, on the same branch and for the same guard.** `checkEditRetention` broke on the first
candidate whose form *rendered*, flipped the public box and clicked Save — which on a clubless ride
is the disabled button, so the phase timed out after 30 s with none of its own assertions run, and
did so depending on what the walk account happened to own. It now picks the first candidate that
renders **and** stays submittable after the flip (reading `isEnabled`, not re-deriving the rule, so
it survives the guard being reshaped again), falls through to the club form, and reports a named
failed assertion when nothing qualifies. `provision()` creates the club **first** and attaches the
fixture ride to it — passing `owned.club` in, so a rider who already has a club still gets a clubbed
ride. **PD-338 did not close PD-311 and was not expected to**: un-publishing a clubless *public*
ride is still the refused transition.

## The welcome club CAN appear on Explore with a `Join club` button — 2026-09-03

**`getExploreClubs`' public half filters on `is_public` alone and has no `is_default` exclusion**, so
any screen reasoning *"the default club auto-joins at signup, so it cannot appear here"* is wrong.
PD-384 shipped that assumption as a hardcoded `isDefaultClub: false` and the pre-merge review caught
it; the fix carries `is_default` on `ClubListItem` so Explore and the club detail read one column.

Two documented routes put a rider outside the welcome club, and **only the private half excludes it**
(`085`'s `private.club_takes_join_requests_for` carries `and c.is_default = false`):

- **Leaving.** `club_members` DELETE is a bare `auth.uid() = user_id` and `leaveClub` has no
  default-club guard — only the *owner* is refused (`095`, `059`).
- **The signup join doing nothing.** `059` §2: `complete_onboarding`'s insert can select zero rows,
  which is a SUCCESS, so no exception block sees it.

```sql
-- how many riders are outside it? 15 of 24 on DEV, 2026-09-03
select count(*) from profiles p
 where not exists (select 1 from club_members m join clubs c on c.id = m.club_id
                    where m.user_id = p.id and c.is_default);
```

**The durable rule: `is_default` is DATA and must be read, never asserted from a screen's position
in the flow.** The same trap is available to any future list that grows a membership control.

## Back from a ride returns to the club at that row — 2026-09-03

**PD-378.** Opening a ride from a club timeline and pressing Back left the club altogether: the ride
plan's arrow was `current === 'plan' ? '/rides' : …`, unconditional, so the rider landed on the rides
list and had to navigate back into the club and scroll down again.

**The issue's own premise was wrong in a way worth keeping**, because the next reader will make the
same reading: it says *"the destination is already right … so this is about the offset, not the
route"*, on the strength of PD-262 having fixed `ClubDetailHeader`'s back. That is a different
screen's back button. The ride's own back never returned to the club at all, so this was route
**and** offset, and fixing the offset alone would have fixed nothing.

**The mechanism already existed and needed no new concept** — PD-366 built it for threads. A club
timeline row's key (`ride:<uuid>`) is now carried out on the ride card's link in
`RETURN_ANCHOR_PARAM` (the same `row=` the thread screen uses, so `clubTimelineAnchorSchema` bounds
both) and turned back into `/clubs/detail?id=<club>#<anchor>` by `rideReturnTo`. The club timeline's
existing anchor hunt does the rest — extending a paged stream to look for the row, **bounded by
`CLUB_TIMELINE_ANCHOR_WINDOWS` (3) rather than searching until it finds it**. A ride far enough back
in a long timeline is a silent no-op and the rider lands at the top, which is the original complaint;
that bound is PD-375's and this story did not move it.

Four things a later session should not have to re-derive:

- **The club is read off `ride.club_id`, never a URL parameter**, so the wrong answer is
  unrepresentable — a club id in the link is a second copy of a fact the row owns and can disagree
  with it. **The stated cost:** `club_id` arrives with the ride, so the arrow answers `/rides` for the
  moment before that read lands and then sharpens. Strictly better than before (which answered
  `/rides` always); `rideReturnTo`'s docstring prices the alternative.
- **`/clubs/detail/rides` has the same problem and this fix does NOT cover it** — PD-378 asked that
  question directly and this is the answer. Tap a ride on a club's Rides sub-page, press Back, and
  you land on `/rides`, outside the club. The reason is structural: this mechanism carries a *row*,
  and every anchor it builds resolves to `routes.club(id)` — the **timeline**. Coming back to the
  Rides sub-page is a return *route*, which means carrying a path and an allowlist to bound it
  (`back-navigation.ts`'s `BACK_ORIGINS`) — a different mechanism with a redirect surface this one
  deliberately does not have.
- **Four ride screens drop the anchor on the way back to the plan**, deliberately and not silently.
  Crew, Chat and Invite go back via `routes.ride`, which carries no `row`, and the links reaching
  them carry none either — so plan → crew → back lands on a plan whose back is `/rides` again.
  **`/rides/detail/edit` is the fourth and is easy to miss**, because it draws a plain `Header`
  rather than `RideHeader` and so is invisible to a reader auditing that component.
- **The browser/Android hardware back is untouched.** It is a history pop, not this arrow; this
  change neither improves nor breaks it. The in-app arrow and the edge swipe share one value
  (`useSwipeBack(backHref)`), so those two cannot disagree — the defect PD-341 closed once already.

```bash
git grep -n "rideFromClubTimeline\|rideReturnTo" -- src/
npx vitest run src/lib/__tests__/club-timeline-return.test.ts
```

## Map tiles have been dead on BOTH projects since 2026-08-27, and only the DEPLOY is wrong — 2026-09-03

**PD-385, diagnosed, not fixable from a session.** The deployed `resolve-ride-location` sends
`MARKER_STYLE = 'type:material;color:#1A1A1A;…;contentcolor:#FFFFFF;size:40'`. **Uppercase hex is a
hard 400 at the tile vendor** — `gates.ts`'s header carries the measurement (`color:#ff5050` → 200,
`color:#FF5050` → 400). The repo has the lowercase fix; the deploy does not.

**The whole diagnosis is one diff**: `index.ts` is byte-identical to the repo on both projects, and
a comment-stripped diff of `gates.ts` returns exactly the `MARKER_STYLE` line. `67ab011` introduced
it at 14:33Z, the deploy shipped it at **14:41Z**, `b343d6d` fixed it at **15:36Z — 55 minutes
later** — and nothing has redeployed since.

**Why one 400 empties both columns:** the marker is sent only for the detail tile, but
`index.ts`'s `bothRendered = !!cardTile && !!detailTile` is PD-202's deliberate both-or-neither
rule, so `tileColumns` becomes `{}`. For a *picked* ride `locationColumns` is `{}` too, so the
payload is empty and the function returns `nothing_to_write`. Every observed row fits: rides
created before 14:41 have tiles (3 of 3), every one after does not (0 of 7).

**PROD carries the identical build** — same `ezbr_sha256` `c09a0474…`. It matters less only because
PROD has few rides.

**Deployed 2026-09-06 — ten days after the fix was committed, and PD-369 is the durable lesson.**
`SUPABASE_ACCESS_TOKEN` landed and the catch-up dispatch put `b343d6d` on both projects:
`resolve-ride-location` DEV v6→7, PROD v5→6, `ezbr_sha256` `3a88a35e…` equal across the two.
Nothing was red anywhere for the whole ten days, which is the entire cost of that missing secret.
**A redeploy does not heal the existing rows** — nothing re-renders a ride whose address did not
change, so the DEV rides that were created blind still need a deliberate pass (PD-385). PROD's two
rides are not geocoded, so no rider-visible row is affected.

```bash
# is the deploy still behind the repo? the file's date alone cannot answer it
TZ=UTC git log -1 --format=%cd --date=iso-strict-local -- supabase/functions/resolve-ride-location/
# mcp__Supabase__list_edge_functions <ref> → an updated_at older than that is stale
```
```sql
-- how many rides were created blind and still carry no tile (11 on DEV, 0 on PROD)
select count(*) from public.rides where latitude is not null and map_card_path is null;
```

## The creator's membership row is the database's to write — 2026-09-03

**PD-103, `103_creator_membership.sql` + `104_club_member_owner_arm.sql` — applied to DEV 2026-09-04.** The apply waited on the deploy being confirmed serving (`READY` on the merge sha, `aliasError` null) rather than on the merge — `CLAUDE.md` §Supabase Rules' own rule, and `103` is exactly the class it names. **PROD has neither.** `list_migrations` settles the apply and `git ls-tree origin/development supabase/migrations/` settles the merge; this line claimed both before either was true, twice, which is why it now names two different commands.
`createClub` and `createRide` each did two inserts with no transaction; the compensating rollback
stopped being one when the writes moved to the browser, so closing the tab between the two round
trips left a club with an owner and no membership row. Two `AFTER INSERT` triggers now seed the row,
`104` removes `019`'s `role = 'owner'` INSERT arm, and both actions are one statement.

**Five things a later session should not have to re-derive:**

- **The ordering rule breaks in exactly one direction, and the safe direction is the one that looks
  riskier.** Applying `103` against a bundle that still writes the row is an **instant outage** of
  club and ride creation — `23505` on a row the trigger already wrote, then that bundle's own
  compensating delete removes the club, so every attempt reports *"That club could not be
  created."* Deploying first only makes orphans on the server, and **`103`'s backfill repairs exactly
  those**. So: deploy → `103` → `104`, and `104` last because it is safe only once the deployed
  bundle has stopped sending `role: 'owner'`.
- **The collapse of `tasks.md` group 1 was a DEV shortcut and PROD's promotion must NOT copy it.**
  Deploy-first is self-healing for the *server* and **not for an already-loaded browser tab**,
  which keeps the pre-merge JS and goes on issuing the plain insert — so from the moment `103`
  applies it gets `23505`, its own compensating delete removes the club, and that lasts as long as
  the tab does. Effectively zero tabs on DEV; not so on PROD. There, do what group 1 says: ship the
  transitional idempotent upsert, **let it soak**, then apply. Caught by the pre-merge review.
- **A seeding trigger with no `WHEN` clause binds every FIXTURE in the repo, and the proposal did
  not anticipate that** — ~1050 changed lines across `supabase/tests/seed.sql`,
  `supabase/tests/rls_test.sql` and `supabase/seeds/development.sql`, none of which had a task.
  Each stated the owner/organizer tuple the database now owns and raised `23505` **on its own
  insert**. The trigger's insert runs FIRST and succeeds, so `on conflict do nothing` on it would
  have fixed nothing and would have masked a real PK violation — the tuples were removed instead.
- **`054`'s "ownerless owner" and the isolated organizer arm of `is_ride_crew` are now unreachable
  by any client.** Nine sites in the suite relied on that state arising by accident; each now
  manufactures it as the table owner. Any prose describing it as reachable is false.
- **All three functions live in `private`, not the proposal's `public`** (following `095`), so the
  advisor count does not move on either project. On the ride guard
  `security definer` is **correctness**: its parent probe cannot tell an invisible ride from a
  deleted one under invoker rights, and would fail open.

The client reads the guards by **message**, not SQLSTATE — `018`'s text bounds raise `23514` too.
**Each coupling needs BOTH pins, and the unit test is not the one that compares them**: the unit
tests hardcode the message, so `rls_test.sql` 103.4 (ride) and 095.5 (club) are what go red on a
reword. The club-side pair was missing entirely until the pre-merge review caught the asymmetry.

```bash
git grep -n "cannot leave its crew" -- src/ supabase/   # the coupling, both ends
PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"   # 3382, from 3310
```

## Where this left off — 2026-09-03, a queue firing closed one stale story and one race, and parked one

**Group taken into `slot-2`: PD-380, PD-381, PD-377 — one dropped, two built.**

- **PD-380 (map tiles / attribution) was stale before any code was written.** `ATTRIBUTION_MODE =
  'none'` has been committed (`#319`, 2026-08-27) and deployed to DEV
  (`mcp__Supabase__get_edge_function` `updated_at` 2026-08-27T14:41Z, after that commit) for
  **seven days** — the burned-in credit this issue asked to suppress was already gone when it was
  filed. Moved to `Needs decision` with the measurement rather than closed, because the reported
  symptom ("tiles missing") is real and unexplained: **6 of 9 upcoming rides on DEV carry a real
  coordinate and still have no rendered `map_card_path`/`map_detail_path`.** Filed
  [PD-385](https://linear.app/lets-ride/issue/PD-385) to diagnose that separately — it is a
  tile-generation question, not an attribution one.
- **PD-381 — a thread's own delete could 404 the rider on the way out.** `deleteClubThread`/
  `moderateClubThread` invalidate the thread's own query key before returning, and the confirm
  sheet's `router.replace` only *usually* wins the race against that invalidation's refetch
  resolving to `null` on the still-mounted thread screen — the same pattern `DeleteRideControl`/
  `DeleteClubControl` document as "safe by timing" for rides and clubs, which are exposed to the
  identical race and have not been audited for it. `ThreadOptions` now takes an `onDeleted`
  callback fired the instant delete succeeds, and the thread page uses it to stop calling
  `notFound()` for a thread its own delete just removed — closes the race by construction rather
  than relying on which side is faster. **Worth checking whether rides/clubs need the same guard**
  — not done here, out of this story's scope. **Not filed as a Linear issue**: the workspace's
  free-plan issue limit was hit partway through this session (creates fail, reads/updates still
  work) — see the note below. Raise it by hand once the plan issue clears, or ask and this gets
  filed on the next firing.
- **PD-377 — decision proposal only, per the owner's own framing of the story.** Three options for
  letting a rider post a photo of a past ride so it stays unread/new while displaying at the ride's
  own time rather than the post time — `openspec/changes/place-backdated-postcards-on-the-timeline/`,
  validated (`npx openspec validate place-backdated-postcards-on-the-timeline --strict`). Recommends
  option B (a rider-supplied `displayed_at`, unread still keyed on `created_at`) with two open
  sub-questions put to the owner rather than guessed. Options comment posted, moved to
  `Needs decision`.

**The Linear issue-creation limit hit on 2026-09-03 has CLEARED — do not read it as a standing
block.** For part of that day `save_issue` without an `id` failed with `"You've exceeded the free
issue limit for this workspace"`, while updates kept working. **Creating works again**: PD-389 was
created later the same day, read back with the right project and status. The cause is unknown from
inside a session (a plan change, or the limit counting live rather than lifetime issues and old
ones being archived), so treat it as a condition that can recur rather than as fixed for good.

**Try the create; do not skip filing on the strength of this paragraph.** A session that files
nothing because it expects a refusal loses the follow-up silently, which is worse than a failed call
— the failure is loud and has an obvious fallback (record it in the PR body and say so).

```
mcp__Linear__list_comments issueId=PD-380   # the staleness evidence and the PD-385 pointer
mcp__Linear__list_comments issueId=PD-377   # the options comment
```

## Where this left off — 2026-09-02, the queue is rebuilt and waits on the owner's Routine

**The hourly queue dispatched nothing from a firing between 2026-08-18 and 2026-09-02, and the
cause was never any of the three the procedure documented.** Every relay answered its firing with
40–80 output tokens and spawned nothing, and every story since 08-28 was picked up by the owner
opening a session by hand; the reading — a session the Routine mints for itself holds no
`create_session`, which is built-in tooling rather than a connector — is inferred from that and
is what the new procedure's STEP 0 self-check measures on every firing. The
measurements are on PD-241 (2026-09-02 comment), and `docs/reference/linear.md` §The queue is
drained by one Routine, on one clock carries the shape that replaced it.

**What landed:** `.claude/commands/queue-run.md` — every firing is the builder: read the board,
take one group into a free slot, then follow `queue-pickup.md` in the same session.
`queue-dispatch.md` is deleted; `queue-pickup.md`, `CLAUDE.md`, `docs/reference/linear.md`,
`docs/reference/constraints.md`, `reviewer.md`, `settings.json` and the STEP cross-reference test
are repointed. **Nothing fires it yet.** In this order:

1. **Owner — disable `trig_01WJkMVXGzUVGDcC1njNmaan`** in the Routines UI (it fires hourly, does
   nothing, and cost $103 in 4.5 days). Its relay session `session_01UJDMybf8mX4xbhK93P7EpL` can
   be archived from the UI afterwards.
2. **Owner — create the new Routine** in the Routines UI: fresh session per firing, this repository
   on `development`, connectors Linear + Supabase + Vercel (+ GitHub and Claude Code Remote, if
   either is offered — the second was not on 2026-09-02), hourly, push notification on completion,
   and the prompt in `queue-run.md` §Why this shape.
3. **Nothing else.** Every firing self-checks the three things a build cannot do without (Linear,
   opening and merging a PR, git push) and builds if they pass; the first passing firing also posts the full
   tool inventory on PD-241 for the record. A firing that fails the check posts what is missing and
   ends with `self-check failed — read PD-241` — that notification is the one to act on, and the
   likely fix is `queue-pickup.md` STEP 4c growing a `git push` + comment fallback.

```
mcp__Claude_Code_Remote__list_triggers     # the new Routine present, next_run_at in the future;
                                           # …WJkMV gone or enabled:false
mcp__Linear__list_comments  issueId=PD-241 # the inventory comment from the first passing firing,
                                           # then the board moving on its own
```

## Where this left off — 2026-09-03, the thread wave is retired at the database

**PD-373 (`101_retire_club_thread_waves.sql`), applied to DEV.** The successor PD-372 said it owed.
Dropped: `public.club_thread_waves` — with its three policies, its grants, both indexes, `023`'s
participation gate and its two outbound keys — plus `098`'s `notify_club_thread_waved` /
`retract_club_thread_waved` triggers and the `private` functions behind them (bodies last written
by `100`).

**Three things a later session should not have to re-derive:**

- **`club_join_waves` is UNTOUCHED and fully live.** `092` shipped two wave tables and only the
  thread one is gone; waving a rider's ARRIVAL keeps its policies, grants, gate and both of its own
  fan-outs. A session grepping `wave` is one table away from deleting the surviving feature.
- **The decision on `notifications`: the `club_thread_waved` enum arm STAYS and no row was
  deleted** (1 on DEV). `NotificationType`, `notificationCopy` and `NotificationsListItem`'s
  `describe` keep their arm, so every row already written still renders and still opens its thread.
  Nothing forces an enum to shrink because its writer is gone, and narrowing the two CHECKs would
  have meant deleting real notification history for no observable gain. The stated cost: the
  constraint now admits a type nothing can produce. `098`'s rollback ordering applies if anyone
  ever removes it — delete the live rows BEFORE re-adding the validated CHECK.
- **Two `club_join_waves` properties lost their only behavioural assertions**, because they were
  written against the dropped table and 101 removed rather than retargeted them: the block arm on
  the REACTOR hiding a row and dropping the per-viewer count in each direction (was `092.3`), and
  three club roles reaching exactly the same rows (was `092.7`'s fixture half). Both are still
  pinned STRUCTURALLY off `pg_policies`. Retargeting them is a change to a table `101` does not
  touch and wants its own review; the suite says so at the point each was removed.

```bash
grep -c "NOTICE:  ok" <(PGPASSWORD=postgres npm test 2>&1)   # 3280 after 101, from 3335 — and 3310 after 102 (PD-362)
```

**PROD is one behind: `101` is applied to DEV only** and is the whole of the gap. **This is NOT
`090`'s case, and reading it as one breaks PROD's club timeline.** `090`'s "no ordering constraint"
held because the client path that could observe the dropped objects was already gone from the
bundle *being promoted*. Here that bundle is PD-372 (`c7267e5`), and it is confirmed serving only
on **DEV** — `git branch -r --contains c7267e5` does not list `origin/main`. PROD's live bundle
still reads and writes `club_thread_waves`: `src/lib/data/club-waves.ts` and
`src/lib/actions/club-waves.ts` on `origin/main`, measured 2026-09-03. **`101` must not be applied
to PROD until the `development` → `main` promotion carrying PD-372 is confirmed serving there**
(`READY` on the merge sha, `aliasError` null) — applying it earlier makes every PROD club timeline
read a `PGRST200` on the wave-count embed and every wave tap error, the exact shape `024`'s
`avatar_url` precedent describes in `docs/ENVIRONMENTS.md`.

## Where this left off — 2026-09-02, an introduction is listed only as its announcement

**PD-372, merged to `development`.** The club detail drew one conversation three ways — the join
row, a thread creation row titled `Introduction`, and a fresh reply row every time somebody
commented, which is why replying to an introduction read as *"always creates a new thread"*. Three
browse reads now filter on `club_threads.introduces_user_id`, in the query rather than after it,
and the club timeline's only waveable row is the announcement row (product owner, 2026-09-02:
*"yes, only annoucements are waveable please"*).

**Two things a later session will otherwise rediscover the hard way:**

- **`club_thread_waves` is DROPPED — `101_retire_club_thread_waves.sql` (PD-373), applied to DEV
  2026-09-03.** It was a live table with no writer for one day: `092`'s policies and grants, `023`'s
  gate and both `098` triggers all standing while nothing in `src/` could reach them, and the three
  DEV rows unwithdrawable by the riders who placed them, which is `092`'s *"or the row is
  stranded"* coming true. See the entry above for what the drop covers and what it deliberately
  left alone.
- **The announcement row falling out of the window is CLOSED by PD-375 (below), not by a members-list
  door.** `097` still refuses the welcome club introductions outright, so that club cannot produce the
  state either way.

```bash
git grep -n "ANNOUNCEMENT_MARKER" -- src/          # the rule, and its three call sites
npx vitest run src/lib/data/__tests__/announcement-rule.test.ts
```

## Where this left off — 2026-09-03, the club timeline pages on scroll

**PD-375, branch `claude/pd-375-club-timeline-load-more`.** `CLUB_TIMELINE_LIMIT` was a hard stop at
20 entries with no `load more`; the club timeline now extends as the rider scrolls, via
`openspec/changes/page-the-club-timeline-on-scroll/` (proposal reviewed once, revised against 8
findings, then implemented — read `design.md` before touching any of this again). **This is what
closes PD-374's hole**, which was cancelled on 2026-09-02 on the assumption that scrolling back
through the timeline — rather than a second door on the members list — was the fix: an
introduction is reachable again once its join row scrolls past the display cap, **bounded by
`CLUB_TIMELINE_MAX_WINDOWS` (10 windows, ~600 joins) rather than at whatever depth** — a join
older than that is still unreachable by browsing within one mount, which is a narrower fix than
the issue first assumed but closes the case any real club is likely to hit.

**The mechanism is horizon-lowering, not cursor-advancing.** Each of the five sources (rides,
postcards, threads, joins, thread-replies-collapsed-to-one-per-thread) already carried a
`horizon` — the point above which its window is known-complete — so a page step re-asks every
still-open source for the window below the current floor and **absorbs** the result into what is
already drawn, rather than layering a second, parallel notion of position on top. `complete` needed
no redefinition: it already meant "nothing dropped at either end", which is exactly "reached the
club's founding" once paging is the only way rows arrive.

**Three correctness traps a later session would otherwise rediscover, each closed in the design
rather than the code alone:**

- **A short source's `until` must never be `null`.** `null` means "now" everywhere else in this
  read, so a finished source asked again re-fetches page one forever. `pendingClubTimelineSources`
  is what a page step must consult before issuing any read.
- **Removing a row below the first window (a block, a hide) is not caught by the first window's own
  refetch.** The first window's diff only sees `[h_new, +∞)`; a removal three windows deep produces
  no visible change there. Screens with a removal-capable control (currently `PostcardCard`'s
  Hide/Block) fire an explicit `onRemoved` that discards every deeper window outright, rather than
  inferring removal from a refetch.
- **A two-step read's saturation is measured on the wrong half.** `getClubFeed` re-selects its ids
  under RLS, and that second read can legitimately come back short of what the first asked for —
  measuring `boundedHorizon` on it can falsely declare "reached the founding" over rows RLS simply
  filtered. `getClubFeedWindow` measures saturation on the id-fetching accessor instead.

```bash
git grep -n "CLUB_TIMELINE_MAX_WINDOWS\|pendingClubTimelineSources" -- src/lib/data/club-timeline.ts
npx vitest run src/lib/data/__tests__/club-timeline.test.ts
```

## Where this left off — 2026-09-01, the club bundle is IN PRODUCTION

**Later the same day — the process session (branch `claude/dev-process-improvements-94p8kc`).**
Four things landed, none rider-visible: the write path got its first real tests
(`src/lib/actions/__tests__/`, pinning the two cache invalidations); CI type-checks the three Edge
Functions under Deno (`functions` job, scoped to `supabase/functions/**`); the docs spine was cut
from ~112k tokens per session to ~40k by moving the handoff's reference sections into
`docs/reference/` and rewriting `CLAUDE.md` to rules plus their commands — and to ~31k in a second
pass on 2026-09-02 (this file ~9k, `CLAUDE.md` ~22k; measure with `wc -c`, divided by four). What is
left in `CLAUDE.md` is rules and their anchored sentences; cutting further means deleting rules; and
`deploy-functions.yml` deploys the Edge Functions on every merge that touches them (owner's
decision, 2026-09-02: autonomous), waiting for Vercel's GitHub Deployment of that sha in that
branch's environment first, so the app is serving before the function is (PD-236). **Verified 2026-09-06**:
the token landed (PD-369), and the two owed catch-up dispatches — one per project, `all` — ran
green and closed the `resolve-ride-location` gap that no future merge would ever have touched. The
CLI needed no `config.toml`; `--project-ref` was enough, as the workflow header predicted. The walk is wired into CI (`walk` job): it needs no credential because it mints
its own rider, so the only thing it costs DEV is one signed-up-then-deleted rider per run. **It is
skipped until the repository variable `WALK_CI=1` exists, because its guard step measured the
Actions secrets naming PROD** — `docs/ENVIRONMENTS.md` §Owner setup item 5 was never done, and
`CLAUDE.md` said the opposite until this session. Repoint the secrets, set the variable, and the job
runs; **not a required check yet** — a branch-protection click once it has been green a few PRs
(PD-370). One thing measured both ways: on #373 opening the PR through the GitHub MCP
triggered no CI run (the first came with the next push, seven hours later); on #374 it triggered one
within a minute. So a missing run after a PR opens is not a rule either way — check with
`actions_list list_workflow_runs` filtered to the branch, and push a commit if it stays absent.

**All four stories shipped to riders.** `PD-365` (the introduction, `097`), `PD-366` (the return
anchor, no migration), `PD-367` (club-thread notifications, `098` plus `100`) and `PD-368` (the join
fan-out widened, `099`). Both projects are at `100`; `main` and `development` are both at the
promotion merge with identical trees.

**IT HAS NOW BEEN RENDERED — the walk ran against DEV on 2026-09-01 and is green**, run twice: once
as the club's OWNER and once as an ordinary MEMBER, which are different code paths on the club
detail because the introduction prompt exempts an owner.

**That run's totals are superseded and are deliberately not repeated here** — see §The walk is green
again, and both its baselines are measured (2026-09-06), which measured both accounts and is the
only baseline to quote. Five routes have been added since. Compare a walk against the account it ran
as, and read the parenthesised lines — the walk names every route it skipped.

**Two durable DEV fixtures were created for it, and they are the reason the next walk needs no
setup:**

| Email | Username | State |
|---|---|---|
| `walk-fixture@letsride.dev` | `walkfixture` | Onboarded, has a location and a bike. **Owns `Walk fixture club`** (public, non-default) and a thread in it |
| `walk-fixture-2@letsride.dev` | `walkfixture2` | Onboarded. A **member** of that club, so the introduction prompt fires for them; has posted an introduction |

**Both share one password and it IS in this repo** — §Test accounts has it, deliberately, under a
carve-out the product owner granted on 2026-09-01 for disposable DEV walk fixtures. And it is a
convenience rather than a key: **the walk mints its own rider when `WALK_EMAIL`/`WALK_PASSWORD` are
unset**, so no session is ever blocked on a credential for it. A session reported exactly that
blocker on 2026-09-01 without reading `scripts/walk.mjs`, which says so in its own header.

**What was exercised end to end, through the real database under real RLS:** `introduce_to_club`
wrote an introduction and **refused the second with `42501`** (one per membership); a reply and a
wave each fired their fan-out; and the notifications screen rendered both new types as *"replied to
Route planning for the weekend."* and *"waved at Route planning for the weekend."* — the thread
TITLE resolved, which is the new hinted embed working, and the generic
`did something on LetsRide.` fallback absent, which is both switch arms being present.

**`/notifications` was added to the walk's route list in the same session**, with its reason at the
site: it renders an exhaustive switch over `notifications.type` in two places and was the only route
in the app the walk could not see, while `098` took that switch from fourteen arms to sixteen.

**Two things are still NOT exercised, and neither is closable here.** **Realtime** — the relay does
not proxy the WebSocket upgrade, so the walk suppresses the failures and reports the absence rather
than hiding it. And the introduction **sheet's own interaction** — typing into it and tapping Post —
was driven through the RPC rather than by clicking, so the sheet is proven to MOUNT without throwing
and its writes are proven correct, but the button wiring itself is covered only by its component
test. The introduction sheet also still has **no v2 Figma frame**, so its composition and wording
remain inferred.

**Why the promotion was low-risk even before the walk ran, which is worth keeping for the next one.** Production holds
exactly ONE club — the Welcome club, `is_default = true` — with 0 threads and 0 messages, and every
part of this bundle exempts or cannot reach that state: the introduction prompt and
`introduce_to_club` both refuse the default club, `notify_club_joined` returns early on it, and the
return anchor and thread notifications need a thread. So the bundle was **inert until somebody
creates a real club** — which is why promoting ahead of the walk was defensible, and why the walk
still mattered and was worth running the same evening. Re-measure rather than trusting it, because
one real club changes the answer:

```sql
select count(*) from public.clubs where not is_default;   -- 0 on PROD, 2026-09-01
```

**The promotion's order is the reusable part.** All four went MIGRATION-FIRST, before the build
served, and the reasoning is per file rather than per batch — `097` inert, `098` adding a column the
bundle READS through an explicit column list, `099` and `100` no schema at all. **That reversed what
PD-367's body and this file both said**, which was deploy-after-serving on `089`'s rule; `089`'s
premise expired one day after `089` shipped, when PD-335 gave both exhaustive switches a
self-healing runtime fallback. Both greps still return 1:

```bash
grep -c "did something on LetsRide" src/components/notifications/copy.ts
grep -c "return { href: null }" src/components/notifications/NotificationsListItem.tsx
```

**`100` exists because the pre-merge review found the one defect no single story's review could
see, and it is the lesson worth carrying.** `098` resolved its recipient as `club_threads.author_id`
with no membership predicate, reasoning that authorship implied membership — true when the THREAD
was written, false when the REPLY is. Nothing deletes a thread when its author leaves, so
`A starts a thread → A leaves → B replies` wrote A a row `club_threads` SELECT can never return:
unreadable from birth, one per distinct replier, for ever. **`097` multiplies exactly that
population**, because it makes the ex-member-authored thread a designed state whose words survive
the leave and keep attracting replies. Two agents, two correct stories, one defect in the seam. The
fix is `private.is_club_member_for(t.author_id, t.club_id)` — the subject-taking twin, so an
ownerless owner, who CAN still read the thread, keeps being notified. Verified by restoring `098`'s
bodies on a scratch database: the whole pre-existing 3301-assertion suite passes and only the new
`100.1` goes red.

**Both open questions are ANSWERED and both confirmed what shipped**, so neither moved any code.
Product owner: *"Q2 yes leave it"* and *"Q8 no, no more notifications."*

- **The wave retraction (PD-367 Q2) — KEEP.** **The case against it is recorded rather than closed**,
  in that change's §D6, because it is what a later change would act on: `092`'s only sound
  justification does not transfer here, and the sharpest form of `090`'s objection is that **a second
  reply from the same actor in the same thread collapses and re-notifies nobody, while a wave toggled
  off and on again does not** — so a wave button is the only control in this schema usable as a
  doorbell. It applies equally to `club_waved` and `postcard_liked`, so if it is ever taken it is one
  file covering all three, not a divergence in a change about threads.
- **A thread's author who leaves the club (PD-367 Q8) — EVICT.** An eviction rather than a deletion,
  so rejoining returns every row with its `created_at` and read state intact, and it is observable
  only for an author who is NOT the club's owner — `is_club_member` unions an owner arm (`054`).

**Two smaller things left undone**, neither blocking: the two change directories
(`introduce-yourself-on-joining-a-club` and `notify-a-club-thread`) are implemented and **not
archived**; and **`docs/reference/schema.md` has no `notifications` row at all**, which `098`'s task
list assumed it did — that absence predates this bundle and is the one documentation gap it did not
close.

**One scope narrowing PD-378 has since closed:** PD-366's task 11.3 names the ride card among the
links that should carry the return anchor, and it did not carry one — correctly at the time, because
only the thread screen read the parameter, so it would have been a prefill nothing reads. PD-378 made
the ride screen read it; the ride card carries it now, and both ends of that trip are one string. See
§Back from a ride returns to the club at that row.

## The open OpenSpec changes, and the collision between two of them

**`npm run openspec -- list --json` is the live view** — read it rather than a table here. Six
are in flight as of 2026-08-10, and `add-ride-club-edit-delete` is one of them: `PD-101` shipped
to production, but the change sits at 42/44 in `changes/` rather than `archive/`, so **archiving
it is a real outstanding action** rather than a bookkeeping detail. Status per change belongs to
Linear; the *content* belongs to the change directory. What follows is only what neither holds.

**`add-account-deletion` carries an open product decision inside it — the postcard half of
1.6b.** `account-erasure-cascade` claims a club with no members left holds postcards "entirely
their own by construction"; a rider can leave a club while their postcards stay, so the branch
designed to protect third-party content can destroy it. `032` fixed the *rides* half. The
proposal's default for the postcards half hands the club to the author of the oldest surviving
postcard — which gives a club to someone who never joined it. Decide it before group 3.

**`enforce-creator-membership` and `add-account-deletion` collide, and OpenSpec will not warn
you.** Both carry a delta modifying
`database-enforced-integrity`'s *Club membership role SHALL NOT be self-assignable*, and
archiving replaces a requirement wholesale — so **whichever archives second silently discards
the first one's edit**. Both delta files now open with a coordination banner carrying the merged
text they should converge on. Read it before archiving either.

## Ride chat is shipped but has never been loaded against production

**`PD-115` and its sub-issues carry the status; this is the caveat they have no room for.** The
screen is verified by CI, the RLS suite and live schema checks against PROD, and **nobody has
loaded it against the production database** — this container cannot: Chromium here cannot reach
`supabase.co` at all (§The walk), and Vercel's MCP fetch authenticates as the account owner, so a
200 from it is not evidence a rider can reach anything. The first real proof is the owner opening
a ride they have RSVP'd to and sending a message.

Two things would only show up on that first real load, so check them before assuming a bug is
elsewhere: whether the Realtime socket actually delivers on the production project (the
publication membership is asserted, the *delivery* is not), and whether the composer's
`crypto.randomUUID` path is on a secure origin — it is over HTTPS, and the fallback exists for
`http://<lan-ip>` device testing.

## The welcome club — which club it is, is DATA, and it differs per project

`058` and `059` (2026-08-16, both on DEV and PROD) make every rider join a welcome club the moment
they complete onboarding. **Nothing in the repo names that club.** `clubs.is_default` does, and it
is a different row on each project, so the only honest way to answer "is this on?" is to ask the
database:

```sql
select id, name, is_public, is_default from clubs where is_default;   -- exactly one row
```

Zero rows is the **quiet** failure and the one to look for: onboarding still completes, riders
just join nothing, for ever. `059` raises a `warning` into the Postgres log on every signup in
that state — `mcp__Supabase__query_logs` is where it surfaces — because `058`'s exception block
cannot see it (an insert over zero rows raises nothing).

Measured 2026-08-16: PROD `23d62dc7-4370-4b0b-b0fe-e83e7015ac7b` `Welcome club`, DEV
`7458ae47-f874-4922-a97f-e16b16529da2` `Welcome club (dev)`.

**Two known gaps, both deliberate, neither closed:**

- **The welcome club can still be INHERITED by an ordinary rider.** `029`'s succession hands a
  departing owner's clubs to the longest-tenured remaining member, and this club always has
  members, so it can never reach the "nobody left, delete it" arm. `059` stops that rider deleting
  it and `058`'s column grant stops them re-pointing the flag — but they do inherit rename and
  imagery rights over the club everyone is in. Reachable only by the welcome club's owner deleting
  their own account. `clubs.owner_id` is NOT NULL, so "do not transfer" is not an available answer.
- **It appears in the Create-ride club dropdown for every rider**, because `getMyClubs` feeds it
  and everyone is a member. `059` silenced the fan-out, so posting a ride there notifies nobody
  and leaks nothing — but "a ride in the welcome club" is a misleading thing for a rider to be
  offered. Closing it is a `rides` INSERT policy arm plus a filter in the dropdown, and it was not
  taken because it is a product decision rather than a defect.

**Not backfilled.** The join fires on the transition into completion only, so the riders who
onboarded before `058` keep whatever membership they chose. PROD's `Welcome club` therefore still
reads 2 members until someone new signs up.

## Migrations — the per-project log

Moved whole to [`docs/reference/migrations.md`](reference/migrations.md) §Applied state on
2026-09-01 — the row-versus-file reconciliation, every promotion's ordering and the hand-exercise
records. **The live comparison is a command, not a sentence:**

```bash
ls supabase/migrations/*.sql | wc -l    # against list_migrations on both refs
```

## Known issues, roughly by cost to fix

Moved whole to [`docs/reference/known-issues.md`](reference/known-issues.md) on 2026-09-01. The
roadmap is Linear; that file holds the issues that are *understood* — the mechanism, the sites
to re-derive and the reason each was not folded into the PR that found it.

## Test accounts

| Email | Username | State |
|---|---|---|
| `duskrider@letsride.test` | `duskrider` | Onboarded. **SQL-inserted**, never signed in |
| `qa-verify@letsride.test` | `verify24321868` | Onboarded and consented. **SQL-inserted** originally |

**THE WALK NEEDS NO PASSWORD AT ALL — read this before reporting it as blocked, which a session
did on 2026-09-01.** With `WALK_EMAIL`/`WALK_PASSWORD` both unset, `scripts/walk.mjs` **mints its
own rider** through the app's own signup and username forms and deletes it afterwards as a
non-fatal teardown. PD-268 made that true of the CODE rather than only of a paragraph, and DEV's
`mailer_autoconfirm: true` is what allows it. So *"I cannot walk, nobody gave me a password"* is
never true here, and the fixtures below are a convenience rather than a key.

**Passwords for accounts that MATTER are not in this repo and must never be.** `duskrider`'s lives
with the product owner; `qa-verify`'s is in the git history of this file and should be treated as
burned. Pass one in the environment, never on a command line that gets logged.

**DISPOSABLE WALK FIXTURES ARE THE DELIBERATE EXCEPTION, product owner 2026-09-01** — *"temporary
users created for the walks, the dev passwords can be stored whichever place u can easily access
them edit them etc."* Their password is written below on purpose. The reasoning, so it is not
"corrected" back out by a later reader: the account is worth nothing (a DEV rider holding test data
on a project with no real riders), it is **replaceable in two minutes** by the recipe in §The walk,
and the alternative — an owner-held secret — reintroduces a human round trip for a check that was
designed not to need one. **If it is ever a problem, delete the accounts rather than rotating the
password**; that is what "disposable" buys and it is why burning it in git history costs nothing.
This carve-out covers walk fixtures on **DEV only** and nothing else — a PROD credential, a
service-role key or any account a person actually uses stays out, and `autoMode.hard_deny` still
holds the service-role key absolutely.

**DEV's walk fixtures, with their password, because they are disposable** — all on `letsride-dev`
(`fpmrimzxadewsaiwpsel`). A smoke walk that signs in as a real rider on the production project is a
habit worth not forming.

| Email | Username | Password | What it carries |
|---|---|---|---|
| `walk-fixture@letsride.dev` | `walkfixture` | `WalkFixture2-2026-09-02` | Onboarded, has a location and a bike. **Owns `Walk fixture club`** (public, non-default) and a thread in it — so `/clubs/detail/thread` is walkable |
| `walk-fixture-2@letsride.dev` | `walkfixture2` | same | Onboarded. A **member** of that club, not its owner, so the introduction prompt fires for them; has posted an introduction |
| `rider-1786033029156@letsride.dev` | — | owner-held | Consented, **no username, not onboarded** — the fixture for walking the wizard |
| `rider-1786033088990@letsride.dev` | `devrider093453` | owner-held | Fully onboarded, predates the two above |

**The password in the row above was rotated on 2026-09-02, and the one it replaced did not work.**
The recorded value answered `invalid_credentials` against DEV's own token endpoint — measured, not
inferred — so a walk run with it signed in as nobody and reported `0/10 screens rendered clean`,
which reads exactly like a broken build rather than a bad credential. That is the trap worth
carrying: **a wrong `WALK_EMAIL`/`WALK_PASSWORD` fails the walk everywhere at once**, because every
route then redirects to `/auth/login` and every guard check for a signed-in rider fails with it.
Check the credential itself before believing the screens, in one call:

```bash
curl -s --noproxy '*' -X POST 'http://localhost:3001/auth/v1/token?grant_type=password' \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"walk-fixture-2@letsride.dev","password":"..."}'   # 200, not 400
```

Rotated rather than deleted, against §Test accounts' own "delete rather than rotate" advice, and
deliberately: `walk-fixture-2` **holds the introduction** that makes the club-detail and Threads
screens worth walking at all, and deleting it destroys the fixture PD-372 needed. Both accounts now
share the new value. The reset was one SQL `update` on `auth.users.encrypted_password` through
`extensions.crypt(…, gen_salt('bf'))` — no service-role key, no Auth admin API.

**The two `walk-fixture*` accounts are a PAIR and the second is the point.** A club's owner is
exempt from the introduction prompt (`097`, and
`openspec/changes/introduce-yourself-on-joining-a-club/design.md` §D7), so walking as the owner alone
renders a code path the feature does not have. Walk as **both** when the club detail changes.

**Replacing them, if they are ever lost or you want fresh ones:** sign up through
`/auth/v1/signup` (DEV autoconfirms), then `accept_terms()`, then `PATCH /profiles?id=eq.<uid>` with
a username — **`&select=id` is required**, because `025` makes `profiles` column-scoped and asking
for the default full-row representation answers `42501` — then `complete_onboarding({p_location:
null})`. That is the app's own order and its own reason: a refused username must never leave a rider
stamped complete without one.

**`devrider093453`'s `terms_accepted_at` is a REPAIRED value, not the original — 2026-08-24.** A
session measuring `023`'s consent gate nulled it expecting its statement batch to roll back; it
auto-committed, which left that rider stuck at the consent step. The original timestamp is
unrecoverable, so it was set to the row's own `onboarding_completed_at`
(`2026-08-06 16:18:17.284543+00`) — defensible because `023` guarantees consent preceded
completion, and wrong by however long the rider actually took over the two steps. Nothing reads
the value beyond `is null`, so this costs nothing today; it is recorded because "measured on
DEV" and "true of a real signup" are not the same claim for this column any more. **The general
lesson is the one to carry: an `execute_sql` batch through the MCP server auto-commits — there
is no implicit transaction to roll back**, so a destructive probe on a shared fixture needs an
explicit `begin`/`rollback` or a scratch row of its own.

**Their passwords are not recorded anywhere, deliberately — set one when you need it.** A
session has `execute_sql` on DEV under the standing grant, so the credential is *derivable* in
ten seconds rather than *stored*, which is strictly better than a password living in a file:

```sql
-- Generate the password locally; never type a memorable one, and never commit it.
update auth.users
   set encrypted_password = extensions.crypt('<generated>', extensions.gen_salt('bf')),
       updated_at = now()
 where email = 'rider-1786033088990@letsride.dev';
```

If you walk the wizard with the un-onboarded one, put it back afterwards or the next session
finds no un-onboarded fixture — `update public.profiles set username = null, location = null,
onboarding_completed_at = null where id = (select id from auth.users where email = '…')`. The
`003` and `012` triggers do not block this: both short-circuit on
`current_user <> 'authenticated'`, and an MCP session is not that role.

**Only having one reachable password is why the shared-device case (task 4.6) is proven by
mechanism and not by sequence.** The walk asserts that sign-out destroys the session, the query
cache and every `sb-*` key; a *second real rider signing in afterwards* has never been run.

Both accounts are acceptable only because the app is **not live**. **Delete both before launch:**

```sql
delete from auth.users where email like '%@letsride.test';
```

Two caveats: `.test` is an RFC 2606 reserved TLD that receives no mail, so neither account can
sign up, recover a password or confirm anything, and PROD has confirmation **on**. Both still
sign in, because both were SQL-inserted with `email_confirmed_at` already set — and for that same
reason **neither proves anything about the signup flow**. If you create another this way, set
`confirmation_token`, `recovery_token`, `email_change` and the other token columns to `''`,
never NULL — GoTrue scans them into non-nullable strings and a NULL turns every login into
"do not match".

There is also one **real** signup (a Gmail address, 2026-08-04) with no consent, no username, no
onboarding and no sign-in. That rider confirmed their address 13 seconds after signing up, hit
*"we could not record your consent — sign in to continue"*, and never came back — they are the
live proof of the bug `docs/reference/signup.md` §Signup describes, not an anomaly beside it.

## Where the open questions live

**Linear's `Needs decision` and `Todo Human` columns, not here** — that is the
column's whole job, and a second copy is the one that goes stale. `PD-185` (branch protection on
both long-lived branches) and `PD-186` (the 🟠-prefixed Figma sections) were moved there on
2026-08-10; both had existed only in this file.

One that is *not* a question and keeps getting re-asked: the Site URL and redirect allowlist on
`letsride`. `PD-88` closed it, `PD-106` then moved both projects onto `letsride.social` and took
PROD's `http://localhost:3000/**` entry off on the way — and a dashboard setting has no file
behind it, so re-run the credential-free probe in `docs/ENVIRONMENTS.md` §The redirect allowlist
rather than reopening it.

---

## Which design to build from

Moved whole to [`docs/reference/design-system.md`](reference/design-system.md) §Which design to
build from on 2026-09-01 — the epic-status traps, the Chevron Down export check and the wave
icon's provenance. The heading below is kept so existing pointers resolve.

### The wave icon — authored into Figma 2026-08-16, redrawn 2026-08-17, thinned to 2.20 the same day

See `docs/reference/design-system.md` §The wave icon.

## Constraints that will waste your time otherwise

Moved whole to [`docs/reference/constraints.md`](reference/constraints.md) on 2026-09-02. Read it
the moment something in this container, a connector or the tooling behaves oddly — most of what
looks broken here has been measured before and has a workaround written down.
