# Tasks — a club's owner reaches their own club as a member does

**Nothing here blocks on an open question.** Q1–Q4 in `proposal.md` are all non-blocking or
already answered; Q4 is re-verified by task 1.2 rather than trusted.

**No `src/` file changes**, so `tsc`, ESLint, `next build` and `npm run test:unit` are unaffected
by this change and are not gates for it. `npm test` (the RLS suite) is, and `supabase/**` changing
is what makes it run in CI.

## 1. Pre-flight — re-verify, do not trust the proposal

- [ ] 1.1 Confirm `private.is_club_member`'s body is still what `design.md` §D5 records, on
      **both** projects, so the rollback text is a copy rather than a reconstruction:
      `select pg_get_functiondef('private.is_club_member(uuid)'::regprocedure);` against
      `fpmrimzxadewsaiwpsel` and `zwprydcyryvudhurbnye`. A difference between the two stops the
      build — the function predates the `051`–`053` divergence and SHALL be identical.
- [ ] 1.2 **Re-verify the block interaction** (`proposal.md` N4, `design.md` §D4) against
      `pg_policies` rather than against this proposal. For each of `rides` SELECT, `postcards`
      SELECT, `club_members` SELECT, `ride_members` SELECT, `ride_messages` SELECT,
      `postcard_comments` SELECT and `postcard_likes` SELECT, confirm the **domination**
      property: no assignment satisfies the policy through `is_club_member` while its governing
      `private.is_blocked` conjunct is false, and the only disjunct bypassing that tests the
      viewer's own identity.
      **Do NOT check this as "`is_blocked` is a top-level conjunct" — that is false for `rides`
      and `postcards` SELECT, whose top-level operator is `OR`**, and a gate written that way
      fails on a correct database and trains the next reader to skip it. Confirm instead that
      `blocks_no_self_block` still exists, since the self-identity bypass depends on it:
      `select pg_get_constraintdef(oid) from pg_constraint where conname = 'blocks_no_self_block';`
- [ ] 1.3 Re-derive **both** caller sets rather than copying the proposal's tables — they are the
      claims a reviewer will check, and the second is the one a text search cannot produce:
      ```sql
      -- Direct callers. Expected: 10 rows, all schemaname = 'public'.
      select schemaname, tablename, policyname, cmd from pg_policies
       where (coalesce(qual,'') || coalesce(with_check,'')) like '%is_club_member%'
       order by schemaname, tablename, policyname;
      -- Inherited callers: RLS-filtered EXISTS against a widened table. INCLUDES storage.
      select schemaname, tablename, policyname, cmd from pg_policies
       where (coalesce(qual,'') || coalesce(with_check,'')) ~ 'FROM (rides|postcards|clubs) '
       order by schemaname, tablename, policyname;
      ```
      **A zero count in `storage` for the first query proves nothing about the second** — the two
      `storage.objects` SELECT policies that inherit this change name no function at all. Also
      confirm zero function callers:
      `select proname from pg_proc where prosrc like '%is_club_member%' and proname <> 'is_club_member';`
- [ ] 1.3a **Confirm the recursion dependency still holds** (`proposal.md` §Impact): `clubs` must
      not force RLS, or the new self-edge becomes `42P17` on every club read.
      `select relforcerowsecurity, pg_get_userbyid(relowner) from pg_class where oid = 'public.clubs'::regclass;`
      Expected `false` / `postgres`. **A `true` here stops the build** — the arm cannot be written
      as a direct `clubs` read and would need a second `security definer` helper instead.
- [ ] 1.4 Re-run the ownerless-owner census on both projects and record the numbers **in the
      migration header**, not by citing this file:
      ```sql
      select count(*) filter (where not c.is_public) as private, count(*) as total
        from public.clubs c
       where not exists (select 1 from public.club_members m
                          where m.club_id = c.id and m.user_id = c.owner_id);
      ```
      Both were **0 / 0** on 2026-08-12. A non-zero result does **not** stop the build — it is
      exactly the state this change makes harmless — but it SHALL be recorded, and it raises the
      priority of `enforce-creator-membership`.
- [ ] 1.5 Confirm the next free migration number with `ls supabase/migrations/` against
      `list_migrations` on both projects. Expected `054`; DEV is at `053` and PROD at `050`, so
      **PROD is three files behind and this file SHALL NOT be applied there ahead of `051`–`053`**
      — filename order is apply order.

## 2. The migration

- [ ] 2.1 Write `supabase/migrations/054_club_owner_is_a_member.sql`, a single
      `CREATE OR REPLACE FUNCTION private.is_club_member(target_club_id uuid)` that returns true
      when the caller holds a `club_members` row for the club **or** is the club's `owner_id`.
      Keep `RETURNS boolean`, `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`.
- [ ] 2.2 In the same statement, set `search_path = ''` and schema-qualify every reference
      (`public.club_members`, `public.clubs`), matching every other function in `private`. Leave
      `auth.uid()` as-is — it is already schema-qualified.
- [ ] 2.3 Order the two arms so the membership `EXISTS` is evaluated first and the `clubs` lookup
      only on its failure, and do not introduce a join — two short-circuiting `EXISTS` clauses
      joined by `or`, so the common case costs exactly what it costs today.
- [ ] 2.4 Add `COMMENT ON FUNCTION private.is_club_member(uuid)` stating the two-arm contract and
      the reason the name was not changed (`design.md` §D2), so the next reader does not file the
      owner arm as a bug.
- [ ] 2.5 Header comment carries: the PD-128 reference, the 1.4 census numbers, the rollback body
      verbatim from `design.md` §D5, the explicit statement that **no policy is recreated** —
      which is the property a reviewer checks fastest (`design.md` §D4: an arm added at policy
      level is the shape that could escape a block conjunct; this change adds none) — and the
      recursion warning below, in these terms or clearer:

      > This function now reads `public.clubs`, and `clubs`' own SELECT policy calls this
      > function. That self-edge does not recurse **only** because `public.clubs` does not force
      > row-level security and this function's definer owns the table, so RLS is not applied to
      > the read inside this body. `ALTER TABLE public.clubs FORCE ROW LEVEL SECURITY` would turn
      > every club read in the application into `42P17` infinite recursion. No security advisor
      > asks for that setting; do not add it without replacing this read.

      It goes in the header rather than only in the proposal because a session tidying up RLS
      settings will be reading `pg_class`, not `openspec/`.
- [ ] 2.6 Do **not** touch `club_members` DELETE, any trigger, any grant, or any policy. The
      owner-leaving guard is `enforce-creator-membership`'s.

## 3. Assertions — `supabase/tests/rls_test.sql`

`openspec/config.yaml`: a policy change with no new assertion is not finished. **The suite runs as
the table owner**, for whom RLS does not apply, so every assertion below SHALL run under
`set local role authenticated` with the harness's `auth.uid()` GUC set to the rider under test —
an assertion that merely *calls* `private.is_club_member` as the owner proves nothing, which is
`031`'s lesson applied to a predicate rather than to a grant.

- [ ] 3.1 **Fixture.** A private club whose `owner_id` holds **no** `club_members` row, a second
      rider who is a member, a third who is neither, and a ride in that club organized by the
      member. Build it by deleting the owner's row after creation, so the fixture exercises the
      real route in.
- [ ] 3.2 **Positive — the reported bug, read.** As the ownerless owner: the club ride is
      returned. Assert the count, not merely that no error was raised.
- [ ] 3.3 **Positive — the reported bug, write.** As the ownerless owner: `assert_allowed` an
      insert of a ride carrying that `club_id`. This is the half the issue notes is easy to miss.
- [ ] 3.4 **Positive — the widened set.** As the ownerless owner: the club's roster is readable,
      a postcard into the club is insertable and readable, and a `feed_reads` row for the club is
      insertable.
- [ ] 3.5 **N1.** As the third rider (neither owner nor member): zero rides, zero postcards, zero
      roster rows for the private club.
- [ ] 3.6 **N2.** As a rider who owns **no** club and has just deleted their `club_members` row:
      zero rides immediately. Proves the arm keys on `clubs.owner_id`, not on history.
- [ ] 3.7 **N4 — the block, and this is the assertion that matters most.** With a block row
      between the ownerless owner and the ride's organizer, assert the owner reads **zero** rides
      for that ride. Repeat in the opposite direction (`blocker`/`blocked` swapped) — blocking is
      symmetric though the row is directional, so both directions need their own assertion.
- [ ] 3.8 **N4, continued.** A blocked rider's postcard in the owner's own club is not returned to
      the owner; a blocked rider's `club_members` row is absent from the roster the owner reads.
- [ ] 3.9 **N5.** The owner of club A reads zero rides, postcards and roster rows for private
      club B.
- [ ] 3.10 **N6.** With `auth.uid()` NULL and `set local role anon`, every table in the caller set
      returns zero rows or refuses. Assert the **role's privilege** —
      `has_table_privilege('anon', 'public.rides', 'select')` — rather than only the empty
      result, per `031`. **Scope the grant assertion to its grantee**: a table-wide count reads
      non-zero because `postgres` and `service_role` hold everything by Supabase default.
- [ ] 3.11 **N7, part one — ownership alone confers no chat.** As the ownerless owner **holding no
      `ride_members` row** for the member's ride: assert zero `ride_messages` and `assert_denied`
      on inserting one. **Assert the absence of the crew row in the same block**, so the test
      cannot pass merely because the fixture happened to leave the owner off the crew — the
      property is *"not crew, therefore no chat"*, not *"no chat"*.
- [ ] 3.11a **N7, part two — the join path SHALL work, and must be asserted as a positive.** As
      the ownerless owner: `assert_allowed` inserting their own `ride_members` row for that ride,
      then assert the `ride_messages` count is **non-zero** and an insert is allowed.
      **Without this, 3.11 asserts a property the system will not have** — a capability the owner
      does have would sit behind a green suite that only ever tested the non-crew state. This is
      `031`'s lesson applied to a predicate: assert the reach, not only its absence.
- [ ] 3.11b **N7, part three — the block dominates the join.** With a block between the ownerless
      owner and the ride's organizer: `assert_denied` on the `ride_members` insert, and assert the
      chat stays unreachable. This is the assertion that proves the join path is gated rather
      than open.
- [ ] 3.11c **N8 for chat.** As a crew-joined owner: `assert_denied` on deleting another rider's
      `ride_messages` row in a ride they did not organize.
- [ ] 3.11d **Storage — the widening that reaches image bytes.** The RLS suite's harness shims
      `storage.foldername` and creates the `media` bucket, so this is assertable on plain
      Postgres. As the ownerless owner, assert `storage.objects` SELECT **returns** the row for a
      postcard image posted into their club by the member — this is a real widening and SHALL be
      asserted deliberately rather than discovered. Then assert it returns **zero** when the
      postcard's author is blocked in either direction, which is the guarantee that matters.
      Repeat for a `ride-maps` object against the now-visible ride.
- [ ] 3.12 **N8 / N9.** As the ownerless owner: `assert_denied` on updating the member's ride,
      on updating the member's postcard, and on deleting the member's `club_members` row.
- [ ] 3.13 **N3.** Assert that **no policy predicate references `admin` at all** — the suite
      applies the whole chain to a scratch database and asserts the end state, so it has no
      pre-`054` state to compare against and "the admin's reach is identical before and after" is
      unwritable. An earlier revision of this task asked for exactly that; it is replaced rather
      than dropped, because dropping it would leave N3 — the case claiming a whole role gains
      nothing — with no assertion at all. The absolute form:
      ```sql
      select count(*) from pg_policies
       where schemaname = 'public'
         and (coalesce(qual,'') || coalesce(with_check,'')) like '%admin%';
      ```
      Expected **0**. That is what "no admin-specific arm exists" means as a property of the end
      state, and it holds whether or not `054` has been applied — which is the point.
- [ ] 3.14 **Regression floor.** Assert a plain member's reach into a private club is unchanged,
      so the migration cannot pass by widening everyone.
- [ ] 3.15 Run `PGPASSWORD=postgres npm test` green. **Compare label sets, not counts**, against
      the pre-change run — a count cannot tell a rename from a loss.

## 4. Apply and verify

- [ ] 4.1 Apply `054` to DEV (`fpmrimzxadewsaiwpsel`). No hand-exercise gate is needed: this
      change hangs no trigger on a live write path, so no rider's transaction runs new code.
- [ ] 4.2 Verify the applied function against the file —
      `select md5(pg_get_functiondef('private.is_club_member(uuid)'::regprocedure));` — and
      confirm `proconfig` now reads `search_path=` (empty) rather than `search_path=public`.
- [ ] 4.3 Re-run 1.3's caller query and confirm it still returns the same 10 policies, none
      recreated: `select count(*) from pg_policies where …`. A changed count means something
      dropped a policy.
- [ ] 4.4 **Check the security advisors** — `get_advisors(security)` on DEV.
      `authenticated_security_definer_function_executable` SHALL still be **7**, and
      `private.is_club_member` SHALL NOT appear: `authenticated` holds no USAGE on `private`.
      An unexpected advisor is one not in `CLAUDE.md` §Supabase Rules' table.
- [ ] 4.5 Exercise it by hand on DEV in a **rolled-back transaction**: impersonate an ownerless
      owner, confirm the ride reads and the ride insert succeeds, then `rollback`.
- [ ] 4.6 `npm run db:drift` — the repo and both databases agree on the chain. Expect PROD to be
      behind by `051`–`054` until 4.7.
- [ ] 4.7 Apply to PROD (`zwprydcyryvudhurbnye`) **only after `051`–`053` are applied there**, in
      filename order, and re-run 4.2 and 4.4 against PROD.

## 5. Documentation

- [ ] 5.1 Update `docs/reference/schema.md` where it describes the club audience predicate — it
      is the per-table contract and it currently describes a membership-only test.
- [ ] 5.2 Add the owner arm to `docs/reference/migrations.md`'s chain notes if `054` acquires any
      ordering relationship. It has none today (`design.md` §D6); record that it has none rather
      than leaving the question open.
- [ ] 5.3 Do **not** write `CLAUDE.md` or `docs/HANDOFF.md` from an agent — the main thread owns
      the docs spine.

## 6. Archive

- [ ] 6.1 `npx openspec validate grant-club-owner-member-reach --strict`.
- [ ] 6.2 Before archiving, re-check that no other change has since modified
      `Ride visibility SHALL be stated per role` —
      `grep -rn "Ride visibility SHALL be stated per role" openspec/changes/`. Archiving replaces
      a requirement wholesale, so the second change to archive silently discards the first's edit.
- [ ] 6.3 Do not archive while the RLS suite is failing.
