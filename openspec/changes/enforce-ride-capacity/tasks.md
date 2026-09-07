# Tasks — enforce ride capacity

> ⚠ **THE FEATURE THIS CHANGE SPECIFIES WAS REMOVED — do not archive without reading PD-436.**
> `063` shipped the cap; `077` (PD-293, 2026-08-24) then dropped `max_riders` in full — the
> column, `018`'s `rides_max_riders_range` CHECK and `private.enforce_ride_capacity()`. So
> `specs/ride-capacity/spec.md` below is **fifteen** requirements describing a rule the database
> no longer has (`grep -c "^### Requirement:" specs/ride-capacity/spec.md`), and archiving this
> change would fold them into `openspec/specs/` as a standing contract. **§6.2 and §6.3 are done
> (PD-264); §6.1 and §6.4 are the only tasks here that still apply, and §6.4 is what blocks
> archiving today.** What happens to this directory is PD-436's question.

Specs: `specs/ride-capacity/spec.md`, `specs/database-enforced-integrity/spec.md`.
Mechanism and the rejected alternatives: `design.md`.

**Order matters in one place only:** §3 (hand-exercise on DEV) is a gate ahead of §7 (apply), per
`CLAUDE.md` §Supabase Rules — this hangs a trigger off an already-shipped write path.

## 1. The migration

- [x] 1.1 Derive the file number from `ls supabase/migrations/` against
      `mcp__Supabase__list_migrations` on both projects. `062` is the highest file at proposal
      time and no in-flight proposal claims `063` — verify, do not inherit.
- [x] 1.2 Write `private.enforce_ride_capacity()` — `security definer`, `set search_path = ''`,
      fully-qualified names. **Body order as shipped**, and `design.md` §D5 carries why it inverts
      what this task first said: read `max_riders` and `organizer_id` **unlocked**, return early
      when the cap is NULL, return early when the write takes no new seat, return early for the
      ride's own organizer, and only then take the lock
      (`select max_riders … from public.rides where id = new.ride_id for no key update`), count and
      raise. Locking first would serialise every RSVP on the majority of rides, which carry no cap
      at all.
- [x] 1.3 The seat test is `new.ride_id is not distinct from old.ride_id` on UPDATE and an
      `exists` probe on `(new.ride_id, new.user_id)` on INSERT — **not** a count excluding the
      writer's own row, which refuses an existing member on an over-subscribed ride
      (`design.md` §D3, measured).
- [x] 1.4 Raise with `errcode = 'check_violation'` and the exact message `this ride is full`.
      Both halves are contract — the client matches on them (`design.md` §D9).
- [x] 1.5 `revoke all on function private.enforce_ride_capacity() from public, anon,
      authenticated`, per `005`. Add a `comment on function` saying what it gates, that it is a
      join gate rather than an invariant, and why it is definer.
- [x] 1.6 `create trigger enforce_ride_capacity before insert or update on public.ride_members for
      each row execute function private.enforce_ride_capacity()`. **Not** `update of ride_id` —
      the upsert's SET list always names it (`design.md` §D2). **No** `when` clause
      (`design.md` §D10, and Q2 if the owner overrules).
- [x] 1.7 The name must sort after `enforce_participation_gate`, so consent is answered before
      capacity. Do not rename either.
- [x] 1.8 Do **not** drop, replace or re-create `enforce_participation_gate` or
      `notify_ride_joined`. Add the verification query to the file's footer that shows all three
      triggers present afterwards.
- [x] 1.9 Header comment: the four settled decisions, the `036` hand-exercise requirement, the
      rollback SQL, and the measured facts a later reader would otherwise re-derive wrongly
      (BEFORE-INSERT fires on an upsert that resolves to UPDATE; BEFORE runs ahead of the RLS
      `WITH CHECK`; an invoker count is short by the writer's blocks).

## 2. RLS suite — `supabase/tests/rls_test.sql`

Every one of these is required by `openspec/config.yaml` (*a policy change with no new assertion
is not finished*). Write them under `set role authenticated` unless noted; the suite runs as the
table owner elsewhere, and an owner-role assertion cannot tell a definer count from an invoker
one (`031`'s lesson).

- [x] 2.1 Cap reached refuses a new join — assert SQLSTATE `23514` **and** the message text.
- [x] 2.2 `max_riders` NULL admits any number of riders.
- [x] 2.3 A `maybe` row counts toward the cap: cap 2, one `going` + one `maybe`, third rider
      refused.
- [x] 2.4 A status flip inside a full ride succeeds — `going` → `maybe` and back, through the same
      upsert shape PostgREST issues (`on conflict (ride_id, user_id) do update set ride_id = …,
      user_id = …, status = …`), not a bare UPDATE. Using a bare UPDATE here is the assertion
      that passes against the broken implementation.
- [x] 2.5 A blocked pair still fills the ride: with a `blocks` row in place, a rider joining a
      full ride is refused. Assert as the joining rider, not as the owner — this is the assertion
      that fails if the count is `security invoker`.
- [x] 2.6 An over-subscribed ride (built at the cap, then the cap lowered) keeps every row, admits
      no new joiner, and still lets an existing member change status.
- [x] 2.7 The organizer's own row lands on a ride with `max_riders = 1` and zero crew rows, and
      lands again when the ride is already at its cap and the organizer holds no row.
- [x] 2.8 A `ride_id` UPDATE moving a seat into a full ride is refused; the same move into a ride
      with room is admitted.
- [x] 2.9 A DELETE on a full ride is never refused, and the next join is then admitted.
- [x] 2.10 Catalog assertions (owner role, `reset role`): the trigger exists on `ride_members`
      with timing `BEFORE INSERT OR UPDATE`; `enforce_participation_gate` and `notify_ride_joined`
      are both still present; `has_function_privilege('authenticated',
      'private.enforce_ride_capacity()', 'execute')` is **false** — assert the role, never by
      calling it (`031`/`029`).
- [x] 2.11 Assert that no new assertion of the form `count(ride_members) <= max_riders` was added
      anywhere — by not writing one. Named as a task because it is the natural thing to reach for
      and it fails on a legal state (`ride-capacity`, decision 2).
- [x] 2.12 Compare label sets, not counts, against the previous run when reconciling the suite —
      a count cannot tell a rename from a loss (`CLAUDE.md`).

## 3. Hand-exercise gate — DEV, before the migration is applied anywhere

`CLAUDE.md`: *"A migration that hangs triggers off an already-shipped write path needs a
hand-exercise gate before it applies."* From the moment this applies, every RSVP runs new code
inside the rider's own transaction, and a trigger that raises takes that rider's write down.

- [x] 3.1 On DEV, inside `begin; … rollback;`: apply the migration, then exercise a **join** on an
      uncapped ride and confirm it lands.
- [x] 3.2 Same transaction: a **re-RSVP** (`going` → `maybe`) by an existing crew member on a ride
      at its cap, through the upsert shape, and confirm it lands.
- [x] 3.3 Same transaction: a **leave** (delete) on a full ride, and confirm it lands.
- [x] 3.4 Same transaction: a **ride creation** with `max_riders = 1` followed by the organizer's
      crew row, and confirm both land.
- [x] 3.5 Same transaction: a join on a full ride, and confirm the refusal is `23514` with the
      contract message.
- [x] 3.6 `rollback`, and record the five outcomes in the PR body. A green suite is not this gate.

## 4. The action

- [x] 4.1 Add the capacity branch to `setRideAttendance` in `src/lib/actions/rides.ts`:
      `error.code === '23514' && error.message.includes('this ride is full')` →
      `{ error: 'This ride is full.' }`. Place it **before** the existing generic branch.
- [x] 4.2 Invalidate on that refusal — `invalidateRide()` — which the action does not do for any
      other failure. The refusal is proof the cached crew is stale (`ride-capacity` §Stale).
- [x] 4.3 Do **not** add a pre-flight count, a disabled control or an optimistic "full" state.
      `RideAttendanceBar` already renders the error in its `role="status"` region and already
      rolls the pill back; no component changes.
- [x] 4.4 Confirm no change is needed in `src/types/index.ts` — `max_riders` is already on all
      three ride row types and "full" is derived, not stored. If this task turns out to require a
      type change, **stop and raise it**: it contradicts the proposal's Impact section.

## 5. Stale comments that assert the gap

Each of these states as fact that capacity is unenforced. A comment claiming a rule does not exist
is how the next session re-derives the gap.

- [x] 5.1 `src/lib/actions/rides.ts` — `setRideAttendance`'s docstring paragraph beginning
      *"`max_riders` is not enforced, here or anywhere."*
- [x] 5.2 `src/lib/validation/rides.ts` — the `max_riders` field comment (*"the column stays a
      promise the database does not keep"*). Keep the point that Zod owns the message and the
      database owns the guarantee; drop the claim that nothing enforces it.
- [x] 5.3 `src/lib/data/rides.ts` — `RIDE_CREW_LIMIT`'s docstring (*"roster size is unbounded by
      construction"*) and `getRideCrew`'s. Both are now wrong for capped rides and still right for
      uncapped ones; say which.
- [x] 5.4 `src/lib/data/profile.ts` — the `max_riders` note.
- [ ] 5.5 `docs/FIGMA-FIDELITY-TODO.md` — two entries (§Create ride, §Ride detail) record this as
      an open gap. **This file was locked by another session at proposal time and was deliberately
      not edited**; do it in the apply phase, or hand it to the main thread if it is still locked.
      **Still open at merge**: PR #252 was open across that file for the whole build, so the three
      stale claims (lines 250, 664, 731) are logged in `docs/HANDOFF.md` §Known issues with their
      line numbers instead. The next branch that opens that file fixes them.

## 6. OpenSpec coordination — do not skip, this is the one that outlives the change

**All three are ARCHIVE-time tasks and stay open at merge, deliberately.** 6.1 says *"before
archiving"*, and 6.2/6.3 edit two other in-flight changes — outside the path caps this build was
dispatched under. Filed as its own issue so it is not lost with this change directory.

- [ ] 6.1 Before archiving: re-read `openspec/specs/database-enforced-integrity/spec.md` as the
      previous archive left it and rewrite the MODIFIED block against **that** text, keeping every
      scenario the siblings added. The version transcribed in the delta was read 2026-08-18.
- [x] 6.2 **DONE — PD-264, 2026-09-07.** Deleted the `Unenforced capacity is recorded, not
      silently assumed` scenario from
      `openspec/changes/add-account-deletion/specs/database-enforced-integrity/spec.md` and
      `openspec/changes/add-ride-map-tiles/specs/database-enforced-integrity/spec.md`. Both
      carried it verbatim, and archiving replaces a requirement wholesale — so whichever of the
      three archived last would have reinstated it. Claimant list re-derived first, and it is
      still exactly these three.

      **The scenario is VOID, not false, and that is stronger than this task assumed.** It said
      "about a database where it is [enforced]". That was true on 2026-08-18 and stopped being
      true six days later: `077` (PD-293) dropped `max_riders` — column, CHECK and trigger — so
      the scenario now names a column that does not exist. Each deletion leaves a comment saying
      so, because a reader who greps `enforce_ride_capacity`, finds `077` removing it and
      concludes the scenario is true again would restore a claim about nothing.
- [x] 6.3 **DONE — PD-264, 2026-09-07.** Both siblings' coordination banners now name this
      change as the third claimant, carry the re-derivation command, and say that this change
      *removes* where the other two *extend*.
- [ ] 6.4 **Refresh ALL THREE deltas against the standing spec, not just this one — and this is
      what actually blocks archiving today.** `openspec archive` refuses a MODIFIED block that
      lacks a scenario the current spec has (`specs-apply.js`: *"current spec contains
      scenario(s) not present in the modified block"*). The standing
      `openspec/specs/database-enforced-integrity/spec.md:420` carries it — **already correct and
      current**, citing `077` and the drop — and none of `add-account-deletion`,
      `add-ride-map-tiles` or this change carries it. So all three throw on archive right now.

      **COPY THE NAME EXACTLY, BACKTICKS INCLUDED. It is:**

      ```
      #### Scenario: No capacity rule is claimed for `ride_members`
      ```

      `parseScenarioBlocks` captures `/^####\s*Scenario:\s*(.+)\s*$/` and
      `findMissingCurrentScenarios` compares those strings **raw** — unlike requirement names,
      which go through `normalizeRequirementName`. So pasting it without the backticks around
      `ride_members` throws again, naming the real scenario as still missing.

      **The trap is what a reader then does about that throw.** `findMissingCurrentScenarios`
      only checks current ⊆ incoming, so an EXTRA scenario in the delta is never refused — adding
      the correctly-named one *beside* the mistyped one clears the throw and archives, leaving the
      requirement carrying **two** capacity scenarios. That is the exact outcome §6.2 exists to
      prevent, reached by following this task and then fixing the error it caused. Delete the
      mistyped line; do not add a second beside it.

      **Why this is filed here rather than in each sibling.** `add-account-deletion`'s tasks say
      nothing about the refresh at all (its §7.7 re-reads for drift, which is a different job).
      `add-ride-map-tiles` §7.2 **does** state the obligation — but it says *"whichever of the
      **two**"*, so it predates and does not know about the third claimant, **and it is ticked
      `[x]` while the obligation is still outstanding.** One task naming all three is the only
      form that is true.

      Keep the standing scenario when refreshing — do not "fix" it, and do not reinstate the
      deleted `Unenforced capacity is recorded, not silently assumed` beside it.

      Measured 2026-09-07 (PD-264): missing from all three deltas.

## 7. Apply and verify

- [x] 7.1 `PGPASSWORD=postgres npm test` green, with the §2 assertions in place.
- [x] 7.2 Apply to DEV (`fpmrimzxadewsaiwpsel`) with `apply_migration`, after §3.
- [x] 7.3 `get_advisors(security)` on DEV: expect no new advisor. A new
      `authenticated_security_definer_function_executable` WARN means the function landed in
      `public` or the revoke did not.
- [x] 7.4 Verify against the live project rather than the file: the trigger's timing and events,
      the function's `prosecdef` and `proconfig`, and that `authenticated` holds no EXECUTE.
- [ ] 7.5 Walk an RSVP through the app against DEV — join, change, leave, and one refusal on a
      ride capped at the current crew size. `npm run walk` does not cover capacity; this is by
      hand. **Still open at merge, and it cannot be closed from a session in this container**:
      `CLAUDE.md` §Technology Decisions records that Chromium here cannot reach Supabase at all —
      the fetch hangs with no response and no `requestfailed` — so no browser in this container can
      sign in. The database behaviour is covered by 24 assertions and a rolled-back DEV exercise;
      what is *not* covered is the rider seeing "This ride is full." on the screen. Owner action,
      or a session on a machine whose browser can reach the project.
- [x] 7.6 PROD promotion is a separate step in filename order with the rest of the DEV-ahead gap,
      per `docs/ENVIRONMENTS.md` §Migrations. Do not promote this file alone.

## 8. Follow-ups to file, not to build here

- [x] 8.1 **Nothing to file here — measured, not inferred.** The `ride_members` UPDATE policy's
      missing `EXISTS` reads like a visibility hole and is not one: Postgres applies the SELECT
      policy to the NEW row of an UPDATE, and that policy carries the conjunct. Isolated by
      relaxing only the roster SELECT policy inside a rolled-back transaction, at which point the
      move succeeds. `proposal.md` has the three measurements. What the 063 suite section pins is
      the refusal at `42501`, so the coverage cannot quietly go away.
- [ ] 8.2 File the capacity affordance as a design question: the ride plan and Crew screens draw
      no seats-remaining count and no "Ride is full" state, so a rider learns it by being refused.
      Note that the number must come from a privileged count, never from the embedded roster.
- [ ] 8.3 Record Q1–Q4 from `design.md` wherever the owner will see them; Q3 (does the cap include
      the organizer?) is the one a rider would notice, and the form's `Maximum riders` label does
      not say.
