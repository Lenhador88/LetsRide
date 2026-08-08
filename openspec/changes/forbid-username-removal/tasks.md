# Tasks — a username cannot be removed once it is set

Q1 (renames) and Q2 (coerce vs raise) do not change what gets built — the guard is NULL-only and
coercing either way. **Q3 (PROD apply order) blocks group 5 only**, and nothing before it.

## 1. Pre-flight

- [x] 1.1 Re-run the invariant count against **both** databases and record the numbers in the
      migration header rather than citing this file:
      `select count(*) from public.profiles where onboarding_completed_at is not null and username is null;`
      Expected 0 on `letsride` (`zwprydcyryvudhurbnye`) and `letsride-dev`
      (`fpmrimzxadewsaiwpsel`). **A non-zero result stops the build**: that row needs an
      operator-set username first, and the migration must not invent one.
- [x] 1.2 Capture the current `pg_get_functiondef('public.enforce_onboarding_completion'::regproc)`
      verbatim into the change notes, so the rollback body in `design.md` §Migration Plan is a
      copy rather than a reconstruction.
- [x] 1.3 Confirm the UPDATE trigger is still not column-scoped —
      `pg_get_triggerdef` must read `BEFORE UPDATE ON public.profiles`, with no `OF <columns>`.
      A column-scoped trigger would make the whole approach dead code.

## 2. The migration

- [x] 2.1 Write `supabase/migrations/038_username_is_not_removable.sql`, `CREATE OR REPLACE
      FUNCTION public.enforce_onboarding_completion()` with the full existing body plus the new
      arm. Do not recreate either trigger (`design.md` §D5).
- [x] 2.2 Place the arm **after** the `current_user <> 'authenticated'` gate and the
      `tg_op = 'INSERT'` branch, and **before** the
      `if old.onboarding_completed_at is not null then … return new` early return. This ordering
      is the whole fix; below the early return it protects nobody (`design.md` §D4).
- [x] 2.3 Key it on `old.username is not null`, not on `old.onboarding_completed_at`
      (`design.md` §D3), and coerce with `coalesce` rather than raising (`design.md` §D2).
- [x] 2.4 Write the header to cover, in this order: the defect and its rolled-back reproduction;
      why the arm sits above the early return; why coerce rather than raise; that `service_role`,
      `postgres`, the seed and the signup trigger deliberately pass through; that a
      `security definer` function is **not** covered and why that is stated rather than closed
      (naming `handle_new_user` specifically, per `design.md` §D6); and the PROD ordering
      deviation from Q3.
- [x] 2.5 Carry `033`'s warning into the header — `033:311-313`: *"copying `003`'s or `012`'s body
      here would silently drop both."* `038` restates the whole function body and is named for a
      username rule, so the next author restating it will reach for `033` or for `038` and must be
      told which parts of the body came from `012` (the consent arm) and `023` (the participation
      and INSERT arms). The suite catches a dropped arm, so this is a convention gap rather than a
      hole — and the header costs nothing.
- [x] 2.6 Add a footer of verification queries the way `014`/`015`/`016` do — the invariant count,
      `prosecdef` still `false`, both triggers still present and still not column-scoped, and 0 new
      policies or grants — and scope every privilege assertion to its grantee, per `015`'s recorded
      footer bug.
- [x] 2.7 Do **not** touch `src/`. `setUsername` keeps its direct update, its column grant and its
      `23505`/`23514` branches.

## 3. Assertions — `supabase/tests/rls_test.sql`

Required by `openspec/config.yaml`: a migration changing a write rule is not finished without
them. **The new rule is asserted as a stored value, never as an error code** (`design.md` §D2) —
that is 3.1, 3.2, 3.4 and 3.9b. The assertions that *do* check an error code (3.3, 3.3b, 3.5,
3.7) are each pinning a refusal that **predates this change**: the unique index, the
`complete_onboarding` guard, and the format CHECK.

- [x] 3.1 **The load-bearing one.** As an **already-onboarded** fixture, `update profiles set
      username = null where id = <self>`, then assert the stored username is unchanged. Using a
      mid-wizard fixture here would pass against a guard placed below the early return, which is
      the exact wrong fix (`design.md` §D4).
- [x] 3.2 As a **mid-onboarding** fixture that has already chosen a name (`…000d`, `halfway`),
      the same write, same assertion — "once set, never unset" covers both.
- [x] 3.3 The name from 3.2 cannot be **taken** by another rider afterwards —
      `assert_rejected(… '23505')` against `profiles_username_lower_key`. Assert the index, not
      the availability check: `isUsernameTaken` reads under the block-aware SELECT policy, so to a
      blocked rider a taken name reads free, and an assertion phrased as "reads as taken to every
      other rider" cannot pass. The existing assertion at `rls_test.sql:161` covers the
      readable-to-everyone case and stays as it is.
- [x] 3.3b Pin the asymmetry itself, since 3.3 depends on knowing it: as a rider blocked by the
      holder of a name, the availability check reports it **free** while an attempt to take it is
      refused `23505`. This predates the change and is asserted so a future "fix" to one half
      cannot silently contradict the other.
- [x] 3.4 A rider whose username is NULL (`…000e`) can still set one — onboarding step 1 is
      unbroken. This is the regression the whole change most plausibly causes.
- [x] 3.5 `complete_onboarding(location)` still stamps for a rider with a username, and still
      refuses with `check_violation` for one without. Both arms; the function is `security
      definer` and the trigger short-circuits for it, so this proves the new arm did not disturb a
      path that never sees it.
- [x] 3.6 A non-`authenticated` role can still null a username — set the role to the table owner
      (as the suite already does elsewhere) and assert the write lands. This is the operator
      escape hatch, and it is the assertion that fails if someone later "tightens" the fix into a
      CHECK constraint.
- [x] 3.7 `''`, `'   '`, a two-character name and a value containing a newline are each rejected
      with `23514`. Confirms rather than assumes that NULL was the only hole — verified against
      the live constraint 2026-08-08 (`'' ~ '^[a-z0-9_]{3,20}$'` is `false`).
- [x] 3.8 A rider deleting their own `profiles` row affects **0 rows**, and `authenticated` holds a
      table-level DELETE grant while no DELETE policy exists. Assert both halves — the grant is
      what makes the second half worth stating, and the pair is what detects a future permissive
      policy.
- [x] 3.9 A rider cannot null **another** rider's username: 0 rows affected, target unchanged.
- [x] 3.9b **The upsert route.** Issue the statement supabase-js/PostgREST actually sends for
      `resolution=merge-duplicates` — `insert into profiles (id, username) values (<self>, null)
      on conflict (id) do update set username = excluded.username` — and assert the stored
      username is unchanged. `authenticated` holds INSERT on `username` and an INSERT policy
      exists, so this is a real second client route into the column; that the BEFORE UPDATE
      trigger fires for the DO UPDATE arm is a two-step derivation nothing currently pins. Same
      class as the `ignoreDuplicates` bug `src/lib/actions/profile.ts` records, where the suite
      issued a different statement than production and shipped green.
- [x] 3.10 A blocked rider still reads 0 rows of the blocker's profile. Do **not** assert that they
      learn nothing about the username — `profiles_username_lower_key` is a plain unique index and
      3.3b pins what they can in fact learn. Assert only that this change adds nothing.
- [x] 3.11 `anon` still reaches nothing on `profiles` — decision #1, re-proved because the
      function was replaced.
- [x] 3.12 Confirm the two existing assertions still pass **unmodified**: `rls_test.sql:378`
      (`username is still writable — onboarding step 2 is an ordinary UPDATE`) and
      `rls_test.sql:145` (`a rider who has chosen a username is visible before onboarding
      completes`). If either needs editing, the wrong option was implemented.
- [x] 3.13 Run `PGPASSWORD=postgres npm test` green, and re-derive the assertion count rather than
      copying one — `PGPASSWORD=postgres npm test 2>&1 | grep -c "NOTICE:  ok"`.

## 4. Apply to DEV

- [x] 4.1 Apply `038` to `letsride-dev` (`fpmrimzxadewsaiwpsel`).
- [x] 4.2 Re-run the reproduction probe from `proposal.md` §Why inside a rolled-back transaction
      and confirm it now reports the username **unchanged** and `own_delete_rows=0`.
- [ ] 4.3 Exercise onboarding step 1 against DEV through the app's own form, not through SQL —
      the grant path and the action are what riders use. `npm run walk` with `WALK_FIXTURES=1`
      covers the rest of the surface.
- [x] 4.4 Check security advisors on DEV. Expect **no new finding**; the change adds no
      `security definer` function and no policy. A new WARN means something else was applied.

## 5. Apply to PROD — BLOCKED on Q3

- [ ] 5.1 Get the owner's answer on Q3 — which of the three rows in `proposal.md` §Deployment
      ordering. Recommended default: `037` then `038`, leaving only the deliberately-gated `036`
      behind. **Do not treat `036` and `037` as one decision**; `docs/HANDOFF.md` §Two migrations
      says conflating them is how the wrong one gets applied.
- [ ] 5.2 Re-run task 1.1's pre-flight against PROD immediately before applying.
- [ ] 5.3 Apply, then verify live the way `014`–`016` were: the invariant count, both triggers
      present and not column-scoped, `prosecdef` still `false`, 0 new policies, 0 new advisors,
      and the reproduction probe leaving the username unchanged.
- [ ] 5.4 Record the apply and any filename-order deviation in `docs/ENVIRONMENTS.md`, so the next
      `npm run db:drift` reading is expected rather than alarming.

## 6. Documentation and wrap-up

- [x] 6.1 Update `docs/HANDOFF.md` **first** — it is what a new session reads before anything else,
      and a PROD apply falsifies two things in it verbatim: §Two migrations' block quoting
      `PROD (zwprydcyryvudhurbnye): 35 rows, ending 035_comment_whitespace_floor`, and the
      DEV/PROD row counts beside it. Rewrite them with the `list_migrations` command that verifies
      them, never a bare number.
- [x] 6.1b Update `CLAUDE.md` §Supabase Rules' applied-state paragraph — same rule, same command.
- [x] 6.2 Add the `profiles` row to `CLAUDE.md`'s schema table only if it gains a claim worth
      carrying; prefer one sentence naming the durability rule over restating the migration.
- [ ] 6.3 File follow-ups A, B and C from `design.md` §Follow-ups as Linear issues — `Todo AI` for
      A and B, `Backlog` for C. Never `Queued (AI)`.
- [ ] 6.4 Run `reviewer` on the diff before the PR, per `CLAUDE.md`. The proposal has no automated
      gate at all: `openspec/` is in the CI denylist, so a proposal-only PR runs zero jobs.
- [ ] 6.5 PR to `development`, drive it green, merge, move PD-127 to `Done`.
- [ ] 6.6 `/opsx:archive` once the RLS suite is green and the migration is applied to at least DEV.

## Implementation notes — 2026-08-08

Four things the build did that this list did not anticipate. None changes a decision; each is
recorded so the next reader does not have to reconstruct it from the diff.

1. **One existing assertion had to change, and it is not either of the two 3.12 names.**
   `rls_test.sql` §7.12f (`036`) produced its ghost-row fixture by having the rider **null their own
   username through RLS**, with a comment saying it was done that way "because the point is that it
   is reachable by a rider rather than only by the table owner". That is the defect `038` closes, so
   the setup stopped working. The assertion's *intent* — the `profiles` EXISTS conjunct in the
   notifications policy is not redundant with the block conjunct — is preserved: the rider's attempt
   is kept and is now asserted to be **coerced**, then the eviction is produced as the table owner
   and the original expected value (0) stands. Net effect on the label set is +36/−1 rather than
   +35/−0. 3.12's two names (`rls_test.sql:378`, `:145`) both pass unmodified, so the guidance that
   "if either needs editing, the wrong option was implemented" is not triggered.
2. **Placement within the permitted window.** 2.2 allows anywhere after the `tg_op = 'INSERT'`
   branch and before the early return. It is placed **first in the UPDATE path**, immediately after
   the INSERT branch, rather than immediately above the early return — so a future rule arriving
   with an early return of its own cannot orphan it. Measured both ways on a scratch database: with
   the guard above the early return an onboarded rider keeps their name and a mid-wizard rider keeps
   theirs; moved below it, the onboarded rider reads `<NULL>` while the mid-wizard rider still
   passes. That is `design.md` §D4's trap, reproduced rather than restated.
3. **The function's `comment on function` was updated too**, beyond 2.4/2.5. It enumerates the rules
   the function carries and named only two; `028`'s lesson is that a database comment is the one
   piece of documentation no edit to `CLAUDE.md` can reach.
4. **4.3 was not done.** Exercising onboarding step 1 through the app's own form needs
   `WALK_EMAIL`/`WALK_PASSWORD` and the Supabase relay, which this pass did not hold. The grant path
   was exercised against DEV as `authenticated` instead, inside a rolled-back `DO` block: a
   NULL-username rider set `probe038name`, then could not remove it, and a second rider's attempt to
   null the first's affected 0 rows. That is the same SQL the action sends, minus the browser — a
   lower-fidelity substitute, labelled as one.
