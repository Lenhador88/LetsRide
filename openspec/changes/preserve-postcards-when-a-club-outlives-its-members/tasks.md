# Tasks — preserve-postcards-when-a-club-outlives-its-members (PD-98)

**This change HAS a migration**, so `openspec/config.yaml`'s tasks rule binds: every task adding or
changing SQL is paired with a task adding assertions to `supabase/tests/rls_test.sql`. A policy
change with no new assertion is not finished.

> **§5 is not optional.** §4 hangs a trigger on `postcards` DELETE, an already-shipped write path, so
> `036`'s hand-exercise gate fires: from the moment `107` applies, every rider deleting any postcard
> runs new code inside their own transaction, and a raise there takes their deletion down with it.
> The RLS suite does not satisfy this.

> **There is nothing to backfill.** Measured on DEV 2026-09-05, RLS bypassed: 0 postcards authored by
> a non-member of their club, 0 memberless clubs. The defect is loaded, not fired. Re-measure in §0
> anyway — the number that matters is PROD's, and it has never been checked.

## 0. Pre-flight — re-derive rather than trust

- [ ] 0.1 **The migration number.** This file says `107` because `106` is the last on disk. Check
  both halves; this repo has had it wrong in both directions:
  ```bash
  ls supabase/migrations/ | tail -5
  grep -rn "10[7-9]_" openspec/changes/ --include=tasks.md | grep -v archive   # another change holding it?
  ```
  ```
  mcp__Supabase__list_migrations fpmrimzxadewsaiwpsel   # DEV
  mcp__Supabase__list_migrations zwprydcyryvudhurbnye   # PROD
  ```
- [ ] 0.2 **Reachability on BOTH projects**, RLS bypassed. DEV was measured; PROD was not.
  ```sql
  select count(*) from public.postcards p
   where p.club_id is not null
     and not exists (select 1 from public.club_members m
                      where m.club_id = p.club_id and m.user_id = p.author_id);
  select count(*) from public.clubs c
   where not exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id <> c.owner_id);
  ```
  If PROD returns a non-zero first count, **stop and report it**: a club there is one account
  deletion away from destroying a live rider's postcards, and that is an owner-facing fact.
- [ ] 0.3 **Re-read the live `private.transfer_owned_clubs` body from `pg_proc`**, not from `029` or
  `032`. The file on disk is not what runs.
- [x] 0.4 **Enumerate every site interpolating `owner_id`** from the catalogue, per the requirement
  added to `database-enforced-integrity`. **Expect 7 policies, 24 functions, 2 CHECKs.**
  ```sql
  -- ** DO NOT add `where schemaname = 'public'` ** — that is how two sites were missed.
  select schemaname, tablename, policyname, cmd from pg_policies
   where coalesce(qual,'') like '%owner_id%' or coalesce(with_check,'') like '%owner_id%';
  ```
  **This task originally said 4 and was corrected twice.** 4 counts `clubs` alone; 5 adds
  `club_members` INSERT but is schema-scoped and so cannot see the two `storage.objects` policies
  (`Club avatars are readable with the club`, `Club covers are readable with the club` — both
  resolve closed, and §D5 nulls the paths anyway). A builder following the old number would have
  read 7-vs-4 as "a site arrived since the design" and stalled on a figure that was simply wrong.

## 1. The migration — `107_a_club_may_outlive_its_last_member.sql`

Statement order is fixed and §7 explains why: the function that can create the state goes last.

- [ ] 1.1 `alter table public.clubs alter column owner_id drop not null`.
- [ ] 1.2 Add a comment on the column recording that NULL means *ownerless tombstone*, reachable only
  through `private.transfer_owned_clubs`, and never a legal initial state.

## 2. Policies — narrow the two arms that do not fail closed

- [ ] 2.1 **`clubs` SELECT**: narrow the public arm to `(is_public and owner_id is not null)`. Leave
  the owner and member arms alone. `design.md` §D3.
- [ ] 2.2 **`club_members` INSERT**: add `c.owner_id is not null` to the existing EXISTS. Defence in
  depth behind 2.1, because `is_public` is data an owner can flip.
- [ ] 2.3 **`private.club_invite_is_answerable_for`**: add `c.owner_id is not null`. This is the site
  §D2's fourth row predicts — its `not private.is_blocked(candidate, c.owner_id)` conjunct returns
  **TRUE** against a NULL owner. Comment it with that reason, not with "belt and braces".
- [ ] 2.4 **`private.notify_club_joined` and `private.notify_ride_created_in_club`**: add
  `where c.owner_id is not null` to the owner arm of each union. Both are closed today only because
  the post-union `recipient <> new.user_id` filter drops a NULL row; `notifications.user_id` is
  `NOT NULL`, so if that filter is ever reordered the trigger raises and takes a rider's join or ride
  creation down with it.
- [x] 2.5 **[CORRECTED — this instruction was wrong and following it would have shipped a hole.]**
  Do NOT touch `clubs` UPDATE, DELETE or INSERT, `is_club_member_for`, `is_club_admin_for`,
  `club_takes_invites_for` or `join_club_from_invite`. Each genuinely fails closed; §3 asserts that
  rather than rewriting it.

  **Three names were removed from that list:**
  - **`can_read_club` — MUST be narrowed**, identically and in the same migration. It is a
    `security definer` function carrying its own `c.is_public` test, so §D3 does not reach it;
    leaving it admitting everyone would have made the policy and its own textual twin disagree.
    `rls_test.sql` 060 is what caught this, and its message asks for exactly that.
  - **`club_takes_join_requests_for`** and **`club_invite_link_reachable_by`** — both refuse an
    ownerless club only via a `<>` comparison that happens to go NULL, while their own
    `not is_blocked(…, owner_id)` conjuncts fail OPEN. Neither is a live hole; both are made
    explicit, because this change adds a requirement forbidding reliance on a neighbouring
    guarantee about something else, and shipping the rule beside counter-examples makes it
    advisory on the day it lands.

  **Three names were added:** `notify_club_join_requested` (same NULL-recipient hazard as §2.4's
  two), `notify_club_invited` (needs a POSITIVE existence test — adding the condition to its
  negative one would read as a guard and do nothing), and `complete_onboarding` (§D12).
- [ ] 2.6 **Assertions** for every policy touched above — §6.

## 3. `private.transfer_owned_clubs` — split the no-successor arm

- [ ] 3.1 In the `else` branch, test for a surviving third-party postcard:
  `exists (select 1 from public.postcards p where p.club_id = club.id and p.author_id <> departing)`.
- [ ] 3.2 **No third-party postcard** → keep `032`'s two statements verbatim: delete the club's
  `is_public = false` rides, then the club. Do not touch this path.
- [ ] 3.3 **Third-party postcard survives** → **one** `update` setting `owner_id = null`,
  `avatar_path = null`, `cover_image_path = null`. One statement, or `016`'s row CHECKs raise `23514`
  on the happy path. §D5.
- [ ] 3.4 **Delete no rides in the new arm.** `032` §2's premise — `ON DELETE SET NULL` orphaning a
  private ride — does not hold when the club survives. §D8, and Q3 if a reviewer disagrees.
- [ ] 3.5 Confirm the loop still emits `avatar_path` and `cover_image_path` as `object_path` **before**
  branching, so the bytes are surrendered on both arms. It does today; assert it rather than assume.
- [ ] 3.6 Leave the successor arm untouched, including its `for update of p` lock.

## 4. Reaping the tombstone (Q4)

- [ ] 4.1 A `private` function plus an `after delete on public.postcards` trigger deleting the club
  when it is ownerless, has no `club_members` row, and holds no remaining postcard.
- [ ] 4.2 **`owner_id is null` is the first condition**, so an ordinary postcard deletion pays one
  indexed probe and stops.
- [ ] 4.3 The body must not be able to raise on the ordinary path. `return null` on every branch.
- [ ] 4.4 Put it in **`private`**, not `public`: a `security definer` function in `public` adds one
  `authenticated_security_definer_function_executable` advisor and one in `private` adds none. The
  count must stay 39 DEV / 37 PROD.
- [ ] 4.5 If a reviewer declines Q4, delete this section and add a stated consequence to
  `design.md` §D6: the tombstone is permanent and no rider can remove it.

## 5. Hand-exercise gate — before `107` applies, on DEV, in a rolled-back transaction

`036`'s procedure. As `authenticated`, counting rows rather than assuming them.

- [ ] 5.1 Delete a postcard in a club with an owner → succeeds, club untouched.
- [ ] 5.2 Delete a postcard with `club_id is null` → succeeds.
- [ ] 5.3 Delete the last postcard in an ownerless club → succeeds, club gone.
- [ ] 5.4 Delete a postcard in an ownerless club that has others → succeeds, club stays.
- [ ] 5.5 Cascade case: erase an account whose postcards are the last in an ownerless club → the
  club is reaped inside the erasure and the erasure completes.
- [ ] 5.6 Record each result in the migration header. `rollback` at the end of every one.

## 6. `supabase/tests/rls_test.sql`

Every requirement in `specs/club-ownerless-lifecycle/spec.md` is a role-and-resource statement, so
each maps onto an assertion here. Fixtures are needed for all of them — the state is unreachable on
DEV today.

- [ ] 6.1 **Fixtures**: a club owned by A, postcards by B and D who have both left, plus a
  second club whose only postcards are A's own.
- [ ] 6.2 The club with third-party postcards survives A's erasure with `owner_id` NULL; the other is
  deleted. Both postcards survive with `club_id` **unchanged and not null**.
- [ ] 6.3 **The negative set**, one assertion each: a rider never in the club; a rider who was in it
  and left; the postcard author themselves (positive — reads their own); a rider blocked by the
  author, both block directions; a signed-out/`anon` reach; a rider attempting to join it; a rider
  holding a pending invite; a rider holding an invite link; a rider requesting to join.
- [ ] 6.4 UPDATE and DELETE on an ownerless club refused **for a named non-owner role**. Not a
  table-wide privilege count, which reads permissive because `postgres` and `service_role` hold
  everything by Supabase default.
- [ ] 6.5 `is_club_member_for` and `is_club_admin_for` false for every rider including the former
  owner.
- [ ] 6.6 The five owner-only RPCs refuse an ownerless club, indistinguishably from "no such club".
- [ ] 6.7 `avatar_path` and `cover_image_path` NULL after the transition, and both returned as
  `object_path`.
- [ ] 6.8 A postcard tagged to a ride deleted in the same call survives with `ride_id` NULL.
- [ ] 6.9 `postcard_likes`, `postcard_comments`, `postcard_hides`, `postcard_reports` survive and none
  is readable by a rider who cannot read the postcard.
- [ ] 6.10 **Reach assertions use `has_function_privilege('<role>', …)`**, never a call. The suite runs
  as the table owner, for whom neither the schema barrier nor the grant exists — this is how `029`
  shipped a worker `service_role` could not reach with nothing red.
- [ ] 6.11 Any new `public` function is revoked **`from public, anon`**, not just `public`: Supabase
  grants EXECUTE to `anon` explicitly. §4.4 should mean there is no such function; assert zero.
- [ ] 6.12 A club cannot be inserted with a NULL `owner_id` by any client role.
- [ ] 6.13 `delete_owned_club` still cascades and creates no ownerless row.
- [ ] 6.14 The default club is untouched by every path here.
- [ ] 6.15 Compare **label sets** against the pre-change run, not counts — a count cannot tell a
  rename from a loss.

## 7. Apply and verify — migration-first

- [ ] 7.1 **Migration-first**, and the reason is that the file has no unsafe side, not that
  migration-first is a default. `design.md` §Sequencing: no client writes `owner_id`, no new
  PostgREST relationship, no type change, and the policy delta is provably a no-op against every row
  existing at apply time because the column is `NOT NULL` until this file runs.
- [ ] 7.2 `PGPASSWORD=postgres npm test` green before applying anything.
- [ ] 7.3 Apply to **DEV** and verify against the live catalogue: `owner_id` nullable, the two
  narrowed policies, the changed function bodies read back from `pg_proc`.
- [ ] 7.4 `get_advisors(security)` on DEV — **still 39**. A new advisor means a function landed in
  `public`; move it to `private`.
- [ ] 7.5 Exercise the whole path on DEV with fixtures: create the shape from 6.1, delete the owner's
  account through the real Edge Function, confirm the club survives ownerless and the postcards live.
- [ ] 7.6 `npm run walk` — no screen may break on a postcard whose club embed is null.
- [ ] 7.7 PROD promotion is a **separate** step, in filename order, recorded in
  `docs/reference/migrations.md` §Applied state. Do not promote in the same session as the DEV apply.

## 8. Documentation

- [ ] 8.1 `docs/reference/schema.md` — the `clubs` row's *"a club outlives its owner"* line gains the
  ownerless state and its meaning; the `postcards` row records that `club_id` is never nulled.
- [ ] 8.2 `docs/reference/migrations.md` §Applied state — `107`'s ordering and its advisor delta (0).
- [ ] 8.3 **Do not write `CLAUDE.md` or `docs/HANDOFF.md`.** The main thread owns both.
