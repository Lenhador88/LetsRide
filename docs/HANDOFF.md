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

**Owner action: the Linear workspace hit its free-plan issue-creation limit this session** —
`save_issue` without an `id` (create) fails with `"You've exceeded the free issue limit for this
workspace. Please upgrade or contact sales@linear.app for a free trial."`; updating an existing
issue still works, which is how PD-380/PD-377 could still be closed out. Upgrading the plan (or
archiving old issues, if the limit counts live rather than lifetime issues) is the fix; nothing in
a session can do either.

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
grep -c "NOTICE:  ok" <(PGPASSWORD=postgres npm test 2>&1)   # 3280, from 3335
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
branch's environment first, so the app is serving before the function is (PD-236). **Written and
unverified** — it needs `SUPABASE_ACCESS_TOKEN` as a repository secret (PD-369) and is skipped with
a warning until then. **The day the token lands, one dispatch per project (`all`) is still owed**:
`resolve-ride-location` on both projects predates PD-236's marker fix (`b343d6d`, measured
2026-09-02 — the deployed `ezbr_sha256` is from 2026-08-27), and no future merge touches it. The
push trigger fixes future drift, not that one. The walk is wired into CI (`walk` job): it needs no credential because it mints
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

**IT HAS NOW BEEN RENDERED — the walk ran against DEV on 2026-09-01 and is green.** 23/23 screens
and 47/47 guard, navigation and sign-out checks, run twice: once as the club's OWNER and once as an
ordinary MEMBER, which are different code paths on the club detail because the introduction prompt
exempts an owner.

**23 needs a `WALK_EMAIL`; a MINTED rider walks 22, and that is a pass rather than a shrink.**
Re-measured 2026-09-02, both ways in one sitting. `/clubs/detail/thread` is discovered by scraping
a link off the Threads list, and the walk's own fixtures create a ride and a club but **no thread**
— so a freshly-minted rider's club has nothing to open and the walk says so in words
(`(no threads in that club — /clubs/detail/thread unwalked)`). The guard-check total moves with it
for the same reason: 47 as a minted rider, **44** as a named one, because minting adds three
checks of its own. So compare a walk against the account it ran as, and read the parenthesised
lines — the walk names every route it skipped.

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
