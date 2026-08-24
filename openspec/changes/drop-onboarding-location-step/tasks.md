# Tasks — drop the location step from onboarding

Specs: `specs/database-enforced-integrity/spec.md`, `specs/client-render-shell/spec.md`,
`specs/client-cache-invalidation/spec.md`. Mechanism, rejected alternatives and the open
questions: `design.md`.

**Order matters in one place, and it is not negotiable:** §1 (the migration) applies **before**
§3 (the code deploy), on each project. `design.md` §D5 has the table showing why the reverse
strands every new signup permanently. Everything else in this file can be done in any order.

## 1. The migration — `075`

- [ ] 1.1 Re-derive the number: `ls supabase/migrations/` against `list_migrations` on **both**
      projects. `074` is the highest file at proposal time and nothing in-flight claims `075` —
      verify, do not inherit (`design.md` §Q4).
- [ ] 1.2 `create or replace function public.complete_onboarding(p_location text)` — **the
      signature does not change.** No overload, no `DEFAULT`, no dropped parameter
      (`proposal.md` §What Changes 1 carries all three reasons). Reproduce the whole body from
      `059`, every comment verbatim, because `prosrc` is what
      `docs/reference/migrations.md`'s reconciliation compares.
- [ ] 1.3 In that body, delete **only** the location arm of the `003` §6a guard. The
      `v_username is null` arm and `023` §1.13's `v_terms is null` arm stay word for word, with
      the same messages and the same `check_violation` errcode.
- [ ] 1.4 Change the write to
      `location = coalesce(nullif(pg_catalog.btrim(p_location), ''), p.location)`. **This is the
      task that prevents data loss, not a tidy-up** — `design.md` §D4. Leave `coalesce` and
      `nullif` unqualified and keep `btrim` qualified, exactly as `059`'s comment requires; a
      `pg_catalog.coalesce` raises `42883` on the happy path.
- [ ] 1.5 Leave the `v_was_complete` capture, the welcome-club insert, its `when others` block and
      `059`'s two `raise warning` calls **untouched and verbatim**. The join hangs off the
      transition into completion, not off the location.
- [ ] 1.6 Update the `comment on function public.complete_onboarding(text)` to state what
      completion now requires (username + consent), that a NULL or blank location leaves the
      column alone, and that the argument is still accepted and still stored.
- [ ] 1.7 `create or replace function public.enforce_onboarding_completion()` — reproduce whole
      from `023`, comments verbatim, removing `new.location is null` from **both** the INSERT arm
      and the UPDATE arm. The INSERT arm is the one no prose in this repo mentions; read the
      deployed `prosrc` rather than `003`'s text, which `012` and `023` both superseded.
- [ ] 1.8 Do **not** add `security definer` to that trigger function and do **not** touch its
      `if current_user <> 'authenticated' then return new` early return. `033`'s footer requires it
      to stay `security invoker`; `design.md` §D1 says why the gate is correct.
- [ ] 1.9 Do **not** touch `018`'s `profiles_location_length`, the `location` column, its grants,
      any policy, or `enforce_participation_gate`.
- [ ] 1.10 File header: the three places the invariant lived, why the RPC's copy is the
      load-bearing one, the `coalesce` and what it prevents, and the ordering rule from §D5 stated
      as an instruction to whoever applies it to PROD.
- [ ] 1.11 Footer verification block: the queries that show both functions' new bodies, that the
      trigger is still `security invoker`, and that
      `has_function_privilege('anon','public.complete_onboarding(text)','execute')` is still false
      while `authenticated`'s is true — a **role-named** assertion, per `031`'s lesson.

## 2. RLS assertions — required by `openspec/config.yaml`, not optional

A policy or trigger change with no new assertion is not finished.

- [ ] 2.1 Rewrite `complete_onboarding() refuses a NULL location` and `... refuses a location of
      nothing but spaces` in place (`supabase/tests/rls_test.sql`, ~line 3100) as assertions that
      both calls **succeed**. Rename the labels to name the new behaviour; do not delete them —
      `design.md` §D8 on comparing label sets rather than counts.
- [ ] 2.2 Add: completing with `p_location => null` leaves an already-set `location` unchanged.
      Use a fixture that has a location, so the assertion can fail.
- [ ] 2.3 Add: completing with `'   '` leaves the column unchanged and raises nothing.
- [ ] 2.4 Add: completing with a real location still stores it in the same statement (keep the
      existing `'Amsterdam'` assertion; it is the old-bundle path and must not regress).
- [ ] 2.5 Keep and re-verify: refusal while `username` is NULL, refusal while `terms_accepted_at`
      is NULL, `018`'s 101-character ceiling still firing inside the `security definer` function,
      and the one-way stamp.
- [ ] 2.6 Add the trigger's own arms: as `authenticated`, an attempt to set
      `onboarding_completed_at` is still refused for want of a column grant; and with the grant
      simulated inside a savepoint, still refused for a NULL username and **accepted** for a NULL
      location.
- [ ] 2.7 Add the welcome-club assertion for a rider completing with no location — the
      `club_members` row still appears, and no `notifications` row does (`058` §4).
- [ ] 2.8 Update `supabase/tests/seed.sql`'s comment on the `halfway` fixture (`…000d`): it is no
      longer "mid-onboarding, step 2", it is the mid-wizard rider `design.md` §Q1 is about. Leave
      the row itself as it is.
- [ ] 2.9 `PGPASSWORD=postgres npm test` green, and reconcile the assertion **label set** against
      the previous run rather than the count.

## 3. The code — deployed AFTER §1 has applied

- [ ] 3.1 `src/lib/actions/onboarding.ts`: `setUsername` calls
      `supabase.rpc('complete_onboarding', { p_location: null })` after a successful username
      UPDATE. Name the argument explicitly — it is what keeps PostgREST resolution unambiguous
      without a `DEFAULT`.
- [ ] 3.2 Keep the whole `23505` → `{ error: USERNAME_TAKEN_MESSAGE, taken: parsed.username }`
      path and the `23514` charset path **ahead** of the RPC call. A refused username must never
      reach `complete_onboarding` (`specs/database-enforced-integrity` §A refused username leaves
      the rider un-onboarded).
- [ ] 3.3 Map the RPC's `23514` to the existing *"Finish the earlier steps first."* and a falsy
      return to *"Your profile could not be found. Sign in again."*, matching what `setLocation`
      does today.
- [ ] 3.4 Call `invalidateOnboardingState()` **once, after both writes**, never between them.
- [ ] 3.5 Return `redirectTo: '/postcards'`.
- [ ] 3.6 Delete `setLocation` and `src/app/onboarding/location/page.tsx`. Check whether
      `retaining`/`seedRetained` still have other callers before assuming they do
      (`git grep -n "seedRetained\|retaining("`).
- [ ] 3.7 `src/app/onboarding/username/page.tsx`: remove `<Pagination>` and its import; the
      primary's copy per `design.md` §Q2 (default: "Finish"). Update the header comment — it
      currently says "Step 1 of 2".
- [ ] 3.8 `src/lib/auth/guard.ts`: `resume` becomes the constant `/onboarding/username`; the
      `isOnboarding` branch becomes terms → resume, the resume path → `null`, **everything else
      under `/onboarding` → resume**. Replace the "step 2 cannot be reached before step 1" comment
      with why the catch-all exists (`design.md` §D6) rather than deleting it silently.
- [ ] 3.9 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` green.

## 4. Unit tests

- [ ] 4.1 `src/lib/auth/__tests__/guard.test.ts`: rewrite every case naming `/onboarding/location`.
      The load-bearing new case is **a rider with a username and no stamp on `/onboarding/location`
      is redirected, not left there** — that is the stranding `design.md` §D6 exists to prevent.
- [ ] 4.2 Add a case for an unknown path under `/onboarding` resolving to the resume step.
- [ ] 4.3 Keep the `unavailable` / `gone` cases and the auth-entry fall-through untouched and
      passing; this change must not move them.
- [ ] 4.4 `src/lib/auth/__tests__/guard-cache.test.ts` references `/onboarding/location` as a
      cache-key path — update to a path that still exists.
- [ ] 4.5 No test for `setUsername` exists today (`lib/actions/` has no direct tests) and this
      change does not add the harness for one. Say so rather than leaving the gap implied: the
      two-write sequence is covered by the RLS suite on the database side and by the walk on the
      screen side, and by nothing in between.

## 5. Documentation claims — two of these CI will not catch

- [ ] 5.1 `CLAUDE.md` §Critical: the route guard — *"There are four (`signUp`, `setUsername`,
      `acceptTerms`, `setLocation`)"* becomes three, without `setLocation`. The
      `guard-cache-invalidators` claim greps the call sites and **does** run in CI's cheap set, so
      getting this wrong is a red build.
- [ ] 5.2 The two guard-case counts in `CLAUDE.md` (§Critical: the route guard, and the Tests
      table's Units row) move with `guard.test.ts`. Both are `kind: 'vitest-file'` and are
      **excluded from `docs:check --cheap`**, so only a local `npm run docs:check` catches them.
- [ ] 5.3 `npm run docs:check` (the full sweep, not `--cheap`) green before the PR.
- [ ] 5.4 `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — this proposal adds section
      pointers into `CLAUDE.md` and `docs/reference/`.
- [ ] 5.5 `docs/specs/login-onboarding.md` names `/onboarding/location` as step 2. It is history,
      not a template (`CLAUDE.md` §The Agent Squad), so **leave it alone** — do not "fix" a
      historical artifact into disagreeing with itself.
- [ ] 5.6 `CLAUDE.md` and `docs/HANDOFF.md` are the **main thread's** to edit, not a subagent's.
      Whoever runs the build carries 5.1 and 5.2 rather than delegating them.

## 6. Archive coordination — do this before `/opsx:archive`, not after

- [ ] 6.1 Re-derive the claimant list:
      `grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive`.
- [ ] 6.2 `add-account-deletion` also modifies `Onboarding completion SHALL gate participation, not
      only navigation`, and its copy of the scenario `Completing onboarding is still the only way
      through` still says the stamp is *"refused while either field is NULL"*. Correct that clause
      in **its** file, in the same session, whichever change archives first. Archiving compares
      scenario **names**, which are identical, so nothing will warn.
- [ ] 6.3 Re-read `openspec/specs/database-enforced-integrity/spec.md` as the previous archive
      actually left it and rewrite this change's MODIFIED block against **that** text, keeping
      every scenario a sibling added.
- [ ] 6.4 Confirm the two ADDED deltas (`client-render-shell`, `client-cache-invalidation`) still
      have no other claimant — `add-account-deletion` and `add-static-export-bundle` both modify
      the route-guard requirement, which this change deliberately does not touch.

## 7. Apply and verify — the ordering gate

- [ ] 7.1 Apply `075` to **DEV** before merging the code, and exercise both paths by hand in a
      rolled-back transaction: `complete_onboarding(null)` for a rider with a location (unchanged),
      and `complete_onboarding('Utrecht')` (stored).
- [ ] 7.2 Confirm the deployed bundle on DEV still works against the relaxed function **before**
      the code merges — that is the "old bundle, new database" cell of `design.md` §D5's table, and
      it is the whole safety argument.
- [ ] 7.3 Merge to `development`; Vercel builds the Preview against `letsride-dev`. The story is
      not finished until it is running on DEV and the Linear issue says `Deployed to DEV`.
- [ ] 7.4 `npm run walk` against DEV, with the relay (`scripts/supabase-relay.mjs`) — read its
      header first. `GUARD_CASES_SIGNED_IN` in `scripts/walk.mjs` names `/onboarding/username`;
      **add `['/onboarding/location', '/postcards']`** so the deleted route's redirect is asserted
      by the one gate that renders anything. It is a new phase's worth of value in one line of an
      existing phase.
- [ ] 7.5 `get_advisors(security)` on DEV after apply. Expect the same ten as `CLAUDE.md` §Security
      advisors; an unexpected advisor is one **not** in that table. `075` replaces two existing
      `security definer` functions and adds none, so the count must not move.
- [ ] 7.6 On promotion to `main`: apply `075` to PROD **before the promotion build serves**
      (`069`'s precedent), then confirm `app.letsride.social` resolves to a `READY` deployment on
      the promotion sha.
- [ ] 7.7 `npm run db:drift` after both applies.
- [ ] 7.8 Re-measure the mid-wizard population on both projects immediately before the deploy —
      `select count(*) from profiles where onboarding_completed_at is null and username is not
      null`. It was 0/0 on 2026-08-24 and it is a snapshot, not a property.
