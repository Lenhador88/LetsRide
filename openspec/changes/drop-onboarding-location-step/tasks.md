# Tasks — drop the location step from onboarding

Specs: `specs/database-enforced-integrity/spec.md`, `specs/client-render-shell/spec.md`,
`specs/client-cache-invalidation/spec.md`. Mechanism, rejected alternatives and the open
questions: `design.md`.

**Five findings from the `reviewer` pass are folded in**: the profile editor's mandatory location
(§3b, and it is the one that would have shipped a gate one screen past the wizard), the three raise
messages (§1.3b), `username_exists` answering *taken* for the caller's own name (§1.9), the two
stale `guard-cache.ts` comments (§3.9), and the walk phase that loses its refusal trigger (§7.4b).

**Status: 66 of 70 done. The four that are open are open for a reason, and none is a code task.**

| Task | Why it is not done |
|---|---|
| `7.4`, `7.4d` | The walk needs `WALK_EMAIL`/`WALK_PASSWORD` against DEV, which no session holds. The walk-side **edits** (`7.4b`, `7.4c`) are written and checked; what is outstanding is *running* it. |
| `8.1`, `8.3` | The PD-170 and PD-260 comments, posted at merge. Agents do not write to the board — `CLAUDE.md` §The roadmap lives in Linear — so these are the main thread's. |

The walk is the only gate in this repo that renders anything, so `7.4` being unrun is the one real
verification gap in this change and should be named as such wherever it is reported — not left to
be inferred from an unchecked box.

**Order matters in one place, and it is not negotiable:** §1 (the migration) applies **before**
§3 (the code deploy), on each project. `design.md` §D5 has the table showing why the reverse
strands every new signup permanently. Everything else in this file can be done in any order.

## 1. The migration — `075`

- [x] 1.1 Re-derive the number: `ls supabase/migrations/` against `list_migrations` on **both**
      projects. `074` is the highest file at proposal time and nothing in-flight claims `075` —
      verify, do not inherit (`design.md` §Q4).
- [x] 1.2 `create or replace function public.complete_onboarding(p_location text)` — **the
      signature does not change.** No overload, no `DEFAULT`, no dropped parameter
      (`proposal.md` §What Changes 1 carries all three reasons). Reproduce the whole body from
      `059`, every comment verbatim, because `prosrc` is what
      `docs/reference/migrations.md`'s reconciliation compares.
- [x] 1.3 In that body, delete **only** the location arm of the `003` §6a guard. The
      `v_username is null` arm and `023` §1.13's `v_terms is null` arm stay, with the same
      `check_violation` errcode. **The username arm's message changes** — see 1.3b; the consent
      arm's is already separate and stays word for word.
- [x] 1.3b Replace `'onboarding cannot be completed before username and location are set'` with
      `'onboarding cannot be completed before a username is set'`, in **all three** places: this
      function, and both arms of the trigger in 1.7. A retained message asserts a rule `075`
      removes, and `rls_test.sql:3100,3102` match on SQLSTATE `23514` rather than on text, so
      nothing goes red. Grep afterwards to confirm the only surviving copies are in the
      already-applied migration files, which are append-only and must not be edited.
- [x] 1.4 Change the write to
      `location = coalesce(nullif(pg_catalog.btrim(p_location), ''), p.location)`. **This is the
      task that prevents data loss, not a tidy-up** — `design.md` §D4. Leave `coalesce` and
      `nullif` unqualified and keep `btrim` qualified, exactly as `059`'s comment requires; a
      `pg_catalog.coalesce` raises `42883` on the happy path.
- [x] 1.5 Leave the `v_was_complete` capture, the welcome-club insert, its `when others` block and
      `059`'s two `raise warning` calls **untouched and verbatim**. The join hangs off the
      transition into completion, not off the location.
- [x] 1.6 Update the `comment on function public.complete_onboarding(text)` to state what
      completion now requires (username + consent), that a NULL or blank location leaves the
      column alone, and that the argument is still accepted and still stored.
- [x] 1.7 `create or replace function public.enforce_onboarding_completion()` — reproduce whole
      from `023`, comments verbatim, removing `new.location is null` from **both** the INSERT arm
      and the UPDATE arm. The INSERT arm is the one no prose in this repo mentions; read the
      deployed `prosrc` rather than `003`'s text, which `012` and `023` both superseded.
- [x] 1.8 Do **not** add `security definer` to that trigger function and do **not** touch its
      `if current_user <> 'authenticated' then return new` early return. `033`'s footer requires it
      to stay `security invoker`; `design.md` §D1 says why the gate is correct.
- [x] 1.9 `create or replace function public.username_exists(p_username text)` — reproduce whole
      from `056`, comment verbatim, adding `and profiles.id <> (select auth.uid())` to the `exists`
      predicate. `security invoker`, `stable`, `set search_path = ''`, and the
      `revoke ... from public, anon` / `grant execute ... to authenticated` pair all unchanged.
      `design.md` §D7 is the decision and why it is in this change; update the function comment to
      say the caller's own name reads free, and keep the sentence about PD-146, which this does
      **not** fix.
- [x] 1.10 Do **not** touch `018`'s `profiles_location_length`, the `location` column, its grants,
      any policy, or `enforce_participation_gate`.
- [x] 1.11 File header: the three places the invariant lived, why the RPC's copy is the
      load-bearing one, the `coalesce` and what it prevents, and the ordering rule from §D5 stated
      as an instruction to whoever applies it to PROD.
- [x] 1.12 Footer verification block: the queries that show both functions' new bodies, that the
      trigger is still `security invoker`, and that
      `has_function_privilege('anon','public.complete_onboarding(text)','execute')` is still false
      while `authenticated`'s is true — a **role-named** assertion, per `031`'s lesson. Same pair
      for `username_exists(text)`, which this file also replaces.

## 2. RLS assertions — required by `openspec/config.yaml`, not optional

A policy or trigger change with no new assertion is not finished.

- [x] 2.1 Rewrite `complete_onboarding() refuses a NULL location` and `... refuses a location of
      nothing but spaces` in place (`supabase/tests/rls_test.sql`, ~line 3100) as assertions that
      both calls **succeed**. Rename the labels to name the new behaviour; do not delete them —
      `design.md` §D10 on comparing label sets rather than counts.
- [x] 2.2 Add: completing with `p_location => null` leaves an already-set `location` unchanged.
      Use a fixture that has a location, so the assertion can fail.
- [x] 2.3 Add: completing with `'   '` leaves the column unchanged and raises nothing.
- [x] 2.4 Add: completing with a real location still stores it in the same statement (keep the
      existing `'Amsterdam'` assertion; it is the old-bundle path and must not regress).
- [x] 2.5 Keep and re-verify: refusal while `username` is NULL, refusal while `terms_accepted_at`
      is NULL, `018`'s 101-character ceiling still firing inside the `security definer` function,
      and the one-way stamp.
- [x] 2.6 Add the trigger's own arms: as `authenticated`, an attempt to set
      `onboarding_completed_at` is still refused for want of a column grant; and with the grant
      simulated inside a savepoint, still refused for a NULL username and **accepted** for a NULL
      location.
- [x] 2.7 Add the welcome-club assertion for a rider completing with no location — the
      `club_members` row still appears, and no `notifications` row does (`058` §4).
- [x] 2.8 Update `supabase/tests/seed.sql`'s comment on the `halfway` fixture (`…000d`): it is no
      longer "mid-onboarding, step 2", it is the mid-wizard rider `design.md` §Q1 is about. Leave
      the row itself as it is.
- [x] 2.9 `username_exists`: the caller's own name — and its case variants — read **available**;
      another visible rider's name still reads **taken**; the function still returns a boolean and
      is still revoked from `anon`. The self case is the one that cannot pass today.
- [x] 2.10 Assert the new refusal message at least once, by text and not only by SQLSTATE, so 1.3b
      cannot silently regress. One assertion is enough; the point is that *some* gate reads the
      string.
- [x] 2.11 `PGPASSWORD=postgres npm test` green, and reconcile the assertion **label set** against
      the previous run rather than the count.

## 3. The code — deployed AFTER §1 has applied

- [x] 3.1 `src/lib/actions/onboarding.ts`: `setUsername` calls
      `supabase.rpc('complete_onboarding', { p_location: null })` after a successful username
      UPDATE. Name the argument explicitly — it is what keeps PostgREST resolution unambiguous
      without a `DEFAULT`.
- [x] 3.2 Keep the whole `23505` → `{ error: USERNAME_TAKEN_MESSAGE, taken: parsed.username }`
      path and the `23514` charset path **ahead** of the RPC call. A refused username must never
      reach `complete_onboarding` (`specs/database-enforced-integrity` §A refused username leaves
      the rider un-onboarded).
- [x] 3.3 Map the RPC's `23514` to the existing *"Finish the earlier steps first."* and a falsy
      return to *"Your profile could not be found. Sign in again."*, matching what `setLocation`
      does today.
- [x] 3.4 Call `invalidateOnboardingState()` **once, after both writes**, never between them.
- [x] 3.5 Return `redirectTo: '/postcards'`.
- [x] 3.6 Delete `setLocation` and `src/app/onboarding/location/page.tsx`. Check whether
      `retaining`/`seedRetained` still have other callers before assuming they do
      (`git grep -n "seedRetained\|retaining("`).
- [x] 3.7 `src/app/onboarding/username/page.tsx`: remove `<Pagination>` and its import; the
      primary's copy per `design.md` §Q2 (default: "Finish"). Update the header comment — it
      currently says "Step 1 of 2".
- [x] 3.8 `src/lib/auth/guard.ts`: `resume` becomes the constant `/onboarding/username`; the
      `isOnboarding` branch becomes terms → resume, the resume path → `null`, **everything else
      under `/onboarding` → resume**. Replace the "step 2 cannot be reached before step 1" comment
      with why the catch-all exists (`design.md` §D6) rather than deleting it silently.
- [x] 3.9 `src/lib/auth/guard-cache.ts` — **comments only, no code**. Its §Writers header and
      `invalidateOnboardingState`'s own doc block both enumerate `setUsername`, `acceptTerms` and
      `setLocation`. Both must lose `setLocation` and say that the username step now carries the
      terminal invalidation. The `guard-cache-invalidators` claim greps call sites and filters
      comment lines out by design, so neither of these will ever go red on its own.
- [x] 3.10 `git grep -n "setLocation"` before opening the PR and confirm every remaining hit is
      either an unrelated React `useState` setter (`CreateClubForm`, `EditClubForm`,
      `CreatePostcardForm` all have one) or an append-only migration file.
- [x] 3.11 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` green.

## 3b. The profile editor stops requiring a location

Finding 1 of the review pass, and in scope for the reason `proposal.md` §What Changes 4 gives: a
story whose thesis is that location is not a gate cannot leave it gating the next screen.

- [x] 3b.1 `src/lib/validation/profile.ts`: `location` takes the `optionalText` shape — trim,
      `max(100, 'Must be 100 characters or fewer.')`, `transform((value) => value || null)`. Empty
      means **clear it**, storing NULL rather than `''`, which is the only value `018`'s
      `profiles_location_length` admits for "no location".
- [x] 3b.2 `optionalText` is declared **below** `locationSchema` today, so the definition has to
      move rather than be edited where it sits — a `const` referenced before initialisation is a
      runtime error, not a type error.
- [x] 3b.3 Delete `locationSchema`'s `min(1, 'Tell us where you ride from.')`. Check whether
      `locationSchema` has any consumer left once `setLocation` is deleted
      (`git grep -n locationSchema`); if `profileEditSchema` is the only one, fold it in rather
      than keeping a one-caller export.
- [x] 3b.4 That schema's doc comment describes `003`'s completion trigger refusing the stamp while
      `location` is NULL. That is what `075` removes — rewrite it, do not leave it.
- [x] 3b.5 `src/components/profile/EditProfileForm.tsx`: remove `required` from the location Input.
      Note for whoever tests it: the form carries `noValidate`, so `required` was never what
      refused the submit — Zod at the action boundary was. Both had to go, and only one of them is
      visible in the browser.
- [x] 3b.6 Confirm by hand on DEV that a rider with NULL `location` can save a bio change, and that
      clearing a location stores NULL rather than `''`
      (`select location is null from profiles where id = ...`).

## 4. Unit tests

- [x] 4.1 `src/lib/auth/__tests__/guard.test.ts`: rewrite every case naming `/onboarding/location`.
      The load-bearing new case is **a rider with a username and no stamp on `/onboarding/location`
      is redirected, not left there** — that is the stranding `design.md` §D6 exists to prevent.
- [x] 4.2 Add a case for an unknown path under `/onboarding` resolving to the resume step.
- [x] 4.3 Keep the `unavailable` / `gone` cases and the auth-entry fall-through untouched and
      passing; this change must not move them.
- [x] 4.4 `src/lib/auth/__tests__/guard-cache.test.ts` references `/onboarding/location` as a
      cache-key path — update to a path that still exists.
- [x] 4.5 No test for `setUsername` exists today (`lib/actions/` has no direct tests) and this
      change does not add the harness for one. Say so rather than leaving the gap implied: the
      two-write sequence is covered by the RLS suite on the database side and by the walk on the
      screen side, and by nothing in between.

## 5. Documentation claims — two of these CI will not catch

- [x] 5.1 `CLAUDE.md` §Critical: the route guard — *"There are four (`signUp`, `setUsername`,
      `acceptTerms`, `setLocation`)"* becomes three, without `setLocation`. The
      `guard-cache-invalidators` claim greps the call sites and **does** run in CI's cheap set, so
      getting this wrong is a red build.
- [x] 5.2 The two guard-case counts in `CLAUDE.md` (§Critical: the route guard, and the Tests
      table's Units row) move with `guard.test.ts`. Both are `kind: 'vitest-file'` and are
      **excluded from `docs:check --cheap`**, so only a local `npm run docs:check` catches them.
- [x] 5.3 `npm run docs:check` (the full sweep, not `--cheap`) green before the PR.
- [x] 5.4 `npx vitest run scripts/docs/__tests__/crossrefs.test.mjs` — this proposal adds section
      pointers into `CLAUDE.md` and `docs/reference/`.
- [x] 5.5 `docs/specs/login-onboarding.md` names `/onboarding/location` as step 2. It is history,
      not a template (`CLAUDE.md` §The Agent Squad), so **leave it alone** — do not "fix" a
      historical artifact into disagreeing with itself.
- [x] 5.6 `CLAUDE.md` and `docs/HANDOFF.md` are the **main thread's** to edit, not a subagent's.
      Whoever runs the build carries 5.1 and 5.2 rather than delegating them.

## 6. Archive coordination — do this before `/opsx:archive`, not after

- [x] 6.1 Re-derive the claimant list:
      `grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive`.
- [x] 6.2 `add-account-deletion` also modifies `Onboarding completion SHALL gate participation, not
      only navigation`, and its copy of the scenario `Completing onboarding is still the only way
      through` still says the stamp is *"refused while either field is NULL"*. Correct that clause
      in **its** file, in the same session, whichever change archives first. Archiving compares
      scenario **names**, which are identical, so nothing will warn.
- [x] 6.3 Re-read `openspec/specs/database-enforced-integrity/spec.md` as the previous archive
      actually left it and rewrite this change's MODIFIED block against **that** text, keeping
      every scenario a sibling added.
- [x] 6.4 Confirm the ADDED requirements — four under `database-enforced-integrity`, two under
      `client-render-shell`, one under `client-cache-invalidation` — still have no other claimant — `add-account-deletion` and `add-static-export-bundle` both modify
      the route-guard requirement, which this change deliberately does not touch.

## 7. Apply and verify — the ordering gate

- [x] 7.1 Apply `075` to **DEV** before merging the code, and exercise both paths by hand in a
      rolled-back transaction: `complete_onboarding(null)` for a rider with a location (unchanged),
      and `complete_onboarding('Utrecht')` (stored).
- [x] 7.2 Confirm the deployed bundle on DEV still works against the relaxed function **before**
      the code merges — that is the "old bundle, new database" cell of `design.md` §D5's table, and
      it is the whole safety argument.
- [x] 7.3 Merge to `development`; Vercel builds the Preview against `letsride-dev`. The story is
      not finished until it is running on DEV and the Linear issue says `Deployed to DEV`.
- [ ] 7.4 `npm run walk` against DEV, with the relay (`scripts/supabase-relay.mjs`) — read its
      header first. `GUARD_CASES_SIGNED_IN` in `scripts/walk.mjs` names `/onboarding/username`;
      **add `['/onboarding/location', '/postcards']`** so the deleted route's redirect is asserted
      by the one gate that renders anything. It is a new phase's worth of value in one line of an
      existing phase.
- [x] 7.4b **`checkEditProfileRetention` needs a new refusal trigger before 3b.1 lands, or it goes
      red and poisons itself.** It fills `location` with `'   '` precisely because
      `profileEditSchema`'s `.trim().min(1)` refuses it; once the field is optional that submit
      **succeeds**, so `the refusal is reported` and `location survives it` both fail *and the run
      clears the walk account's stored location on DEV*, which breaks the phase's own first
      assertion (`location loads from the stored profile`) on every later run. Switch the trigger
      to a **101-character location**, which `max(100)` still refuses, keeping the phase on the
      same field and still testing PD-203's `??` chain.
- [x] 7.4c Rewrite that phase's header comment. It justifies the first assertion with *"`023`'s
      completion trigger refuses the onboarding stamp while `location` is NULL, so a non-empty
      value here is guaranteed"* — still true of the existing walk account, no longer true as a
      rule, and it is the rule the comment is asserting.
- [ ] 7.4d If `WALK_FIXTURES=1` creates or reuses a rider, confirm the account the walk signs in as
      still has a location. The phase reads a stored value it does not write.
- [x] 7.5 `get_advisors(security)` on DEV after apply. Expect the same ten as the advisors table in
      `CLAUDE.md` §Supabase Rules; an unexpected advisor is one **not** in that table. `075` replaces two existing
      `security definer` functions and adds none, so the count must not move.
- [x] 7.6 On promotion to `main`: apply `075` to PROD **before the promotion build serves**
      (`069`'s precedent), then confirm `app.letsride.social` resolves to a `READY` deployment on
      the promotion sha.
- [x] 7.7 `npm run db:drift` after both applies.
- [x] 7.8 Re-measure the mid-wizard population on both projects immediately before the deploy —
      `select count(*) from profiles where onboarding_completed_at is null and username is not
      null`. It was 0/0 on 2026-08-24 and it is a snapshot, not a property.

## 8. The board — the remainder is not this file's to hold

- [ ] 8.1 Before closing PD-286, comment on **PD-170** naming what this change deliberately left
      behind: every rider onboarded under `075` carries NULL `location`, so a rider who also
      declines GPS gets an empty near-you strip with nothing prompting them to fill it in, and the
      prompt the issue suggests is unbuilt. An out-of-scope section in a proposal that is about to
      be archived is not a board item.
- [x] 8.2 Re-read PD-286's title before writing a status. It names dropping the step; if any part
      of that is undelivered the issue **stays open** — `CLAUDE.md` §The roadmap lives in Linear,
      and "the rest needs an owner action" is not a split when applying the migration to PROD is an
      owner step on every change under `supabase/`.
- [ ] 8.3 PD-260 (the near-you strip on the rides list) inherits the same gap the day it lands.
      Note it there rather than rediscovering it.
