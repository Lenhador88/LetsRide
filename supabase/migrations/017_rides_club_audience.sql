-- 017: a ride may only be posted into a club you belong to.
--
-- **This closes a hole that 016's create-ride form opened.** `rides.club_id` has
-- existed since 001 and no screen ever set it, so the INSERT policy — bare
-- `auth.uid() = organizer_id` — was never wrong in practice. Making the column
-- settable made it reachable, and review caught it after the merge rather than
-- before, which is the argument for running `reviewer` before the PR.
--
-- The attack, in full, because "spam" undersells it:
--
--   1. Club ids are not secret. Every public club's id is in the DOM of
--      `/clubs/explore`, and a rider who has left a private club still knows its
--      id.
--   2. `createRide` accepted any UUID that parsed. The Zod schema checks shape,
--      not membership, and shape is not authorization.
--   3. The rides SELECT policy reads
--      `is_public OR (club_id IS NOT NULL AND private.is_club_member(club_id))`.
--      So a ride inserted with someone else's `club_id` and `is_public = false`
--      becomes visible to **that club's members and only them** — it renders on
--      their Timeline and their Rides sub-page.
--
-- The result is an unmembered rider writing into a private club's audience. It
-- is not a read leak: nothing readable by the attacker changes. It is the write
-- half, and `postcards` has been guarded against exactly this since 009, whose
-- INSERT policy already carries `(club_id is null or private.is_club_member(...))`.
-- This migration gives `rides` the same predicate. The asymmetry was an accident
-- of history, not a decision.
--
-- **UPDATE is included, and it is not an afterthought.** Without it a rider
-- inserts a ride with no club (passing the new INSERT check) and then updates
-- `club_id` to any club at all, since the UPDATE policy is also bare
-- `auth.uid() = organizer_id`. Guarding INSERT alone would move the hole rather
-- than close it.

-- ---------------------------------------------------------------------------
-- §1. INSERT
-- ---------------------------------------------------------------------------
--
-- `private.is_club_member` is the same `security definer` helper 004 created and
-- 009's postcards policy uses. Reusing it rather than writing an EXISTS keeps
-- one definition of membership; two copies are how 004 and 008 diverged.

drop policy if exists "Authenticated users can create rides" on public.rides;

create policy "Riders create rides, and only in clubs they belong to"
  on public.rides for insert to authenticated
  with check (
    auth.uid() = organizer_id
    and (club_id is null or private.is_club_member(club_id))
  );

-- ---------------------------------------------------------------------------
-- §2. UPDATE
-- ---------------------------------------------------------------------------
--
-- USING keeps the row reachable by its organizer; WITH CHECK constrains what it
-- may become. Both are needed — USING alone would let the row be edited into a
-- state the policy would have refused on insert.
--
-- One deliberate consequence, recorded rather than discovered: a rider who
-- **leaves** a club can no longer edit the rides they organised in it, because
-- the new row version fails the membership check. They can still delete them.
-- The alternative — grandfathering by comparing to the old `club_id` — needs the
-- OLD row inside WITH CHECK, which RLS does not provide, so it would take a
-- trigger. Nothing edits rides today (there is no edit UI anywhere), so this
-- costs nothing now; revisit it with whatever screen adds one.

drop policy if exists "Organizers can update rides" on public.rides;

create policy "Organizers update their own rides, within their own clubs"
  on public.rides for update to authenticated
  using (auth.uid() = organizer_id)
  with check (
    auth.uid() = organizer_id
    and (club_id is null or private.is_club_member(club_id))
  );

-- ---------------------------------------------------------------------------
-- §Verification — run these against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 4 — select, insert, update, delete, one each
--   select count(*) from pg_policies where tablename = 'rides';
--
-- Expected: 0 — every rides policy is `to authenticated`
--   select count(*) from pg_policies
--    where tablename = 'rides' and roles::text[] <> array['authenticated'];
--
-- Expected: 2 — INSERT and UPDATE both carry the membership predicate
--   select count(*) from pg_policies
--    where tablename = 'rides' and with_check like '%is_club_member%';
--
-- Expected: t — the SELECT policy is untouched by this migration
--   select qual like '%is_blocked%' and qual like '%is_club_member%'
--     from pg_policies where tablename = 'rides' and cmd = 'SELECT';
