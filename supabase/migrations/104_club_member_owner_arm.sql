-- 104: `019`'s `role = 'owner'` INSERT arm becomes dead, and dead policy
-- branches get removed. PD-103, the second half.
--
-- One policy replaced. No function, no trigger, no grant, no column. Strictly
-- NARROWING: after this, `authenticated` can insert `role = 'member'` and
-- nothing else, by any route.
--
-- ---------------------------------------------------------------------------
-- ** ORDERING: this applies AFTER the client stops sending `role: 'owner'`. **
-- ---------------------------------------------------------------------------
--   1. deploy  actions: second insert becomes `upsert ... ignoreDuplicates`
--   2. apply   103  the seeding triggers, the backfill, the ride guard
--   3. deploy  actions: the second insert and both compensating deletes REMOVED
--   4. apply   104  (this file)                          <- HERE, and not before
--
-- Between steps 2 and 3 the deployed bundle still sends `role: 'owner'` on its
-- idempotent upsert. Whether PostgREST evaluates a WITH CHECK for a row that
-- `on conflict do nothing` discards is a Postgres detail nobody in this repo has
-- measured, and betting an outage on it is precisely the habit `021`'s header
-- exists to break. Two files, each safe at a moment that actually arrives.
--
-- This is the destructive half of additive-first/deploy/destructive-last, and it
-- is destructive in the sense that matters: the removed arm is the only thing
-- standing between an older bundle's `role: 'owner'` insert and a `42501`. It
-- must not lead its deploy.
--
-- ---------------------------------------------------------------------------
-- Why the arm is DEAD rather than merely unused
-- ---------------------------------------------------------------------------
-- `019` admitted `role = 'owner'` only when the caller already owns the club:
--
--   role = 'owner' and exists (select 1 from public.clubs c
--                               where c.id = club_members.club_id
--                                 and c.owner_id = auth.uid())
--
-- and its own comment says why that arm is not a courtesy — "`createClub`
-- inserts the club row and then its own `role = 'owner'` membership row as a
-- second round trip, so without this arm club creation stops working entirely".
--
-- ** `103`'s trigger makes that second round trip the DATABASE's, and the
-- trigger is not `authenticated`. ** Inside a `security definer` function
-- `current_user` is the owner (`103` measurement (b)), so the trigger's insert
-- is not evaluated against this policy at all. Every remaining use of the arm by
-- a client is therefore an attempt to insert a row the trigger has already
-- written, which is a `23505` — the arm cannot succeed, it can only produce a
-- duplicate-key error one statement later. That is dead, not unused.
--
-- Removing it leaves `authenticated` able to claim `member` and nothing else.
-- `admin` was already claimable by nobody (`019`) and is written only by `088`'s
-- `promote_club_member`, through a definer RPC; `owner` is now written only by
-- `103`'s trigger and `095`'s transfer, both definer. So the club roster's role
-- column is entirely server-owned, which is the property `019` was reaching for
-- and could not have while `createClub` wrote the row.
--
-- ** This MODIFIES a standing requirement rather than merely tidying. **
-- `database-enforced-integrity`'s "Club membership role SHALL NOT be
-- self-assignable" carries the scenario "The creator's own owner row is still
-- permitted", which describes a write the creator no longer makes. Its
-- assertion in `rls_test.sql` is UPDATED rather than deleted — deleting it loses
-- the record that the rule ever existed, and its replacement is what documents
-- the narrowing.
--
-- ---------------------------------------------------------------------------
-- The rest of `019` is reproduced VERBATIM, because a policy is replaced whole
-- ---------------------------------------------------------------------------
-- Read off `pg_policies` on DEV 2026-09-03 rather than retyped from `019`, and
-- the two agree: `auth.uid() = user_id`, plus the club being public or owned by
-- the caller. Nothing about WHO the row is for changes here, so `joinClub` and
-- `058`'s default-club auto-join are untouched.
--
-- The subquery reaches `clubs` under RLS and that does NOT recurse: the `clubs`
-- SELECT policy calls `private.is_club_member`, which is `security definer` and
-- therefore reads `club_members` with RLS off. `008` already relied on this
-- shape; it is restated so the next reader does not re-derive it.

drop policy if exists "Users can join public clubs, as a member unless they own it"
  on public.club_members;

create policy "Users can join public clubs, as a member"
  on public.club_members for insert to authenticated
  with check (
    auth.uid() = user_id

    -- Unchanged from 008 and 019: you may only add yourself, and only to a club
    -- that is public or that you own. Reproduced verbatim rather than
    -- referenced, because a policy is replaced whole.
    and exists (
      select 1 from public.clubs c
       where c.id = club_members.club_id
         and (c.is_public or c.owner_id = auth.uid())
    )

    -- 104. ONE arm and no second: `member` is what joining means. `owner` is
    -- what CREATING means and 103's trigger writes it; `admin` is what 088's
    -- promote_club_member writes. Both are definer paths, so neither is
    -- evaluated against this policy, and no client can name either value.
    and role = 'member'
  );

comment on policy "Users can join public clubs, as a member" on public.club_members is
  'The only row a client may write to this table: their own, into a club that is public or that they own, at role ''member''. 104 removed 019''s owner arm, which 103''s AFTER INSERT trigger made dead — the trigger writes the creator''s owner row as the database rather than as the rider, so every client use of that arm could only ever produce a 23505 against a row that already existed. ''owner'' is now written by 103''s seed and 095''s transfer, ''admin'' by 088''s promote_club_member, all three security definer. There is still NO UPDATE POLICY on this table (019 Q10), so the role column is entirely server-owned.';

comment on column public.club_members.role is
  'owner | admin | member. ** Server-owned since 104. ** A client may insert ''member'' and nothing else, and there is no UPDATE policy on this table at all (019 Q10), so no client can name ''owner'' or ''admin'' by any route. ''owner'' is written by 103''s establish_club_owner_membership trigger and moved by 095''s leave_owned_club; ''admin'' is written by 088''s promote_club_member and cleared by demote_club_admin. All four are security definer. 019''s rule — "only the club''s own owner_id may insert ''owner''" — was true until 103 gave the database that job.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--   -- Still THREE policies, and NOT four: the absence of UPDATE is 019 Q10's
--   -- answer and is load-bearing. A sorted COMMAND LIST rather than a count —
--   -- 015's trap, where a count of 3 also passes for a set that swapped DELETE
--   -- for UPDATE.
--   select string_agg(cmd, ',' order by cmd) from pg_policies
--    where schemaname = 'public' and tablename = 'club_members';
--                                                    -- DELETE,INSERT,SELECT
--
--   -- 0 — every club_members policy is still `to authenticated`, and none
--   -- mentions anon.
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'club_members'
--      and roles::text[] <> array['authenticated'];                        -- 0
--
--   -- The old policy is GONE by name and the new one is the only INSERT.
--   select policyname from pg_policies
--    where schemaname = 'public' and tablename = 'club_members'
--      and cmd = 'INSERT';        -- 'Users can join public clubs, as a member'
--
--   -- f — neither role LITERAL survives in the new WITH CHECK. ** Match the
--   -- literal, not the word: ** `owner` still appears in the surviving
--   -- `c.owner_id = auth.uid()` conjunct, so a bare `like '%owner%'` reads t
--   -- against a correct policy. `like '%role%'` (019's footer) reads t too, and
--   -- says nothing about which arms survived.
--   select with_check like '%''owner''::text%'
--       or with_check like '%''admin''::text%' from pg_policies
--    where schemaname = 'public' and tablename = 'club_members'
--      and cmd = 'INSERT';                                                 -- f
--   select with_check like '%''member''::text%' from pg_policies
--    where schemaname = 'public' and tablename = 'club_members'
--      and cmd = 'INSERT';                                                 -- t
--
--   -- t — and that is not a mistake, carried forward from 019's footer.
--   -- `authenticated` DOES hold the table-level UPDATE grant, so a promotion
--   -- attempt is filtered to zero rows by the ABSENT UPDATE POLICY rather than
--   -- refused by a missing privilege. Both are asserted in rls_test.sql.
--   select has_table_privilege('authenticated', 'public.club_members', 'update');
--
--   -- The invariant 103 established still holds — RLS BYPASSED, per design.md
--   -- §D7. Re-run here because this file is the one that removes the client's
--   -- last route to writing an owner row: if 103's trigger were somehow absent,
--   -- this is the statement that turns "redundant" into "nobody can".
--   select count(*) from public.clubs c
--    where not exists (select 1 from public.club_members m
--                       where m.club_id = c.id and m.user_id = c.owner_id);  -- 0
--
--   -- Advisors: unchanged. This file creates no function.
--
-- ---------------------------------------------------------------------------
-- §Rollback
-- ---------------------------------------------------------------------------
--   drop policy "Users can join public clubs, as a member" on public.club_members;
--   -- then re-create 019's policy verbatim, under 019's name.
-- Reversible in full, and it has to be: rolling this back is what an emergency
-- redeploy of a pre-103 bundle would need.
