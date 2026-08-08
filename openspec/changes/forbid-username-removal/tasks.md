# Tasks — a username cannot be removed once it is set

Q1 (renames) and Q2 (coerce vs raise) do not change what gets built — the guard is NULL-only and
coercing either way. **Q3 (PROD apply order) blocks group 5 only**, and nothing before it.

## 1. Pre-flight

- [ ] 1.1 Re-run the invariant count against **both** databases and record the numbers in the
      migration header rather than citing this file:
      `select count(*) from public.profiles where onboarding_completed_at is not null and username is null;`
      Expected 0 on `letsride` (`zwprydcyryvudhurbnye`) and `letsride-dev`
      (`fpmrimzxadewsaiwpsel`). **A non-zero result stops the build**: that row needs an
      operator-set username first, and the migration must not invent one.
- [ ] 1.2 Capture the current `pg_get_functiondef('public.enforce_onboarding_completion'::regproc)`
      verbatim into the change notes, so the rollback body in `design.md` §Migration Plan is a
      copy rather than a reconstruction.
- [ ] 1.3 Confirm the UPDATE trigger is still not column-scoped —
      `pg_get_triggerdef` must read `BEFORE UPDATE ON public.profiles`, with no `OF <columns>`.
      A column-scoped trigger would make the whole approach dead code.

## 2. The migration

- [ ] 2.1 Write `supabase/migrations/038_username_is_not_removable.sql`, `CREATE OR REPLACE
      FUNCTION public.enforce_onboarding_completion()` with the full existing body plus the new
      arm. Do not recreate either trigger (`design.md` §D5).
- [ ] 2.2 Place the arm **after** the `current_user <> 'authenticated'` gate and the
      `tg_op = 'INSERT'` branch, and **before** the
      `if old.onboarding_completed_at is not null then … return new` early return. This ordering
      is the whole fix; below the early return it protects nobody (`design.md` §D4).
- [ ] 2.3 Key it on `old.username is not null`, not on `old.onboarding_completed_at`
      (`design.md` §D3), and coerce with `coalesce` rather than raising (`design.md` §D2).
- [ ] 2.4 Write the header to cover, in this order: the defect and its rolled-back reproduction;
      why the arm sits above the early return; why coerce rather than raise; that `service_role`,
      `postgres`, the seed and the signup trigger deliberately pass through; that a
      `security definer` function is **not** covered and why that is stated rather than closed;
      and the PROD ordering deviation from Q3.
- [ ] 2.5 Add a footer of verification queries the way `014`/`015`/`016` do — the invariant count,
      `prosecdef` still `false`, both triggers still present and still not column-scoped, and 0 new
      policies or grants — and scope every privilege assertion to its grantee, per `015`'s recorded
      footer bug.
- [ ] 2.6 Do **not** touch `src/`. `setUsername` keeps its direct update, its column grant and its
      `23505`/`23514` branches.

## 3. Assertions — `supabase/tests/rls_test.sql`

Required by `openspec/config.yaml`: a migration changing a write rule is not finished without
them. Every one below asserts a **stored value**, never an error code (`design.md` §D2), except
3.7 which asserts a genuine rejection that predates this change.

- [ ] 3.1 **The load-bearing one.** As an **already-onboarded** fixture, `update profiles set
      username = null where id = <self>`, then assert the stored username is unchanged. Using a
      mid-wizard fixture here would pass against a guard placed below the early return, which is
      the exact wrong fix (`design.md` §D4).
- [ ] 3.2 As a **mid-onboarding** fixture that has already chosen a name (`…000d`, `halfway`),
      the same write, same assertion — "once set, never unset" covers both.
- [ ] 3.3 The name from 3.2 still reads as taken to another mid-onboarding rider afterwards, so a
      name cannot be freed and re-taken by this route. Extends the existing assertion at
      `rls_test.sql:161`.
- [ ] 3.4 A rider whose username is NULL (`…000e`) can still set one — onboarding step 1 is
      unbroken. This is the regression the whole change most plausibly causes.
- [ ] 3.5 `complete_onboarding(location)` still stamps for a rider with a username, and still
      refuses with `check_violation` for one without. Both arms; the function is `security
      definer` and the trigger short-circuits for it, so this proves the new arm did not disturb a
      path that never sees it.
- [ ] 3.6 A non-`authenticated` role can still null a username — set the role to the table owner
      (as the suite already does elsewhere) and assert the write lands. This is the operator
      escape hatch, and it is the assertion that fails if someone later "tightens" the fix into a
      CHECK constraint.
- [ ] 3.7 `''`, `'   '`, a two-character name and a value containing a newline are each rejected
      with `23514`. Confirms rather than assumes that NULL was the only hole — verified against
      the live constraint 2026-08-08 (`'' ~ '^[a-z0-9_]{3,20}$'` is `false`).
- [ ] 3.8 A rider deleting their own `profiles` row affects **0 rows**, and `authenticated` holds a
      table-level DELETE grant while no DELETE policy exists. Assert both halves — the grant is
      what makes the second half worth stating, and the pair is what detects a future permissive
      policy.
- [ ] 3.9 A rider cannot null **another** rider's username: 0 rows affected, target unchanged.
- [ ] 3.10 A blocked rider still reads 0 rows of the blocker's profile, and learns nothing about
      whether the username changed. Guards against a new inference channel.
- [ ] 3.11 `anon` still reaches nothing on `profiles` — decision #1, re-proved because the
      function was replaced.
- [ ] 3.12 Confirm the two existing assertions still pass **unmodified**: `rls_test.sql:378`
      (`username is still writable — onboarding step 2 is an ordinary UPDATE`) and
      `rls_test.sql:145` (`a rider who has chosen a username is visible before onboarding
      completes`). If either needs editing, the wrong option was implemented.
- [ ] 3.13 Run `PGPASSWORD=postgres npm test` green, and re-derive the assertion count rather than
      copying one — `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`.

## 4. Apply to DEV

- [ ] 4.1 Apply `038` to `letsride-dev` (`fpmrimzxadewsaiwpsel`).
- [ ] 4.2 Re-run the reproduction probe from `proposal.md` §Why inside a rolled-back transaction
      and confirm it now reports the username **unchanged** and `own_delete_rows=0`.
- [ ] 4.3 Exercise onboarding step 1 against DEV through the app's own form, not through SQL —
      the grant path and the action are what riders use. `npm run walk` with `WALK_FIXTURES=1`
      covers the rest of the surface.
- [ ] 4.4 Check security advisors on DEV. Expect **no new finding**; the change adds no
      `security definer` function and no policy. A new WARN means something else was applied.

## 5. Apply to PROD — BLOCKED on Q3

- [ ] 5.1 Get the owner's answer on Q3: apply `038` ahead of the deliberately-held-back `036` and
      of `037`, out of filename order, or wait behind them.
- [ ] 5.2 Re-run task 1.1's pre-flight against PROD immediately before applying.
- [ ] 5.3 Apply, then verify live the way `014`–`016` were: the invariant count, both triggers
      present and not column-scoped, `prosecdef` still `false`, 0 new policies, 0 new advisors,
      and the reproduction probe leaving the username unchanged.
- [ ] 5.4 Record the apply and any filename-order deviation in `docs/ENVIRONMENTS.md`, so the next
      `npm run db:drift` reading is expected rather than alarming.

## 6. Documentation and wrap-up

- [ ] 6.1 Update `CLAUDE.md` §Supabase Rules' applied-state paragraph — with the command that
      verifies it, never a bare number.
- [ ] 6.2 Add the `profiles` row to `CLAUDE.md`'s schema table only if it gains a claim worth
      carrying; prefer one sentence naming the durability rule over restating the migration.
- [ ] 6.3 File follow-ups A, B and C from `design.md` §Follow-ups as Linear issues — `Todo AI` for
      A and B, `Backlog` for C. Never `Queued (AI)`.
- [ ] 6.4 Run `reviewer` on the diff before the PR, per `CLAUDE.md`. The proposal has no automated
      gate at all: `openspec/` is in the CI denylist, so a proposal-only PR runs zero jobs.
- [ ] 6.5 PR to `development`, drive it green, merge, move PD-127 to `Done`.
- [ ] 6.6 `/opsx:archive` once the RLS suite is green and the migration is applied to at least DEV.
