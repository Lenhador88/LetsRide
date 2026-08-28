-- 086 — A club's stamps include the photos taken on its own rides (PD-328)
-- ===========================================================================
--
-- Product owner, 2026-08-27: *"Club postcards (the stamp preview) will also
-- display postcards from the rides of that respective club (also some sort of
-- indication that that postcard comes from a ride)."*
--
-- Proposal: openspec/changes/club-stamps-include-its-rides/.
--
-- ---------------------------------------------------------------------------
-- WHY THIS CANNOT BE A WIDENED `.in()` IN THE CLIENT
-- ---------------------------------------------------------------------------
-- `getClubFeed` filters `club_id = <club>`, and `club_id` IS the audience. A
-- postcard taken on the club's ride but posted app-wide carries `club_id null`,
-- so that filter cannot see it — and it cannot be found by `ride_id` either,
-- because `062` revoked `select (ride_id)` from `authenticated` PRECISELY so
-- the raw uuid could not be used to group postcards, and Postgres checks a
-- column privilege to FILTER on a column as well as to return it.
--
-- So this is `062`'s own shape, reused: a `security definer` accessor that
-- holds the column and answers club -> the postcard IDS the caller may see.
-- The caller then re-reads those rows through the ordinary `POSTCARD_SELECT`
-- path under their own RLS, so the `postcards` SELECT policy stays the only
-- authority on content and this function's restated visibility is load-bearing
-- only for the CORRELATION — which postcards belong to this club.
--
-- ** IT IS A FILTER AND NEVER A GRANT, and 086.16 proves that rather than
-- describing it ** — the accessor's result is asserted to be a SUBSET of what
-- the caller's own `postcards` read returns, over the whole fixture.
--
-- ---------------------------------------------------------------------------
-- THE FLAG IS NOT THE INVERSE READ 062 REVOKED
-- ---------------------------------------------------------------------------
-- `062`'s column comment is explicit that there is no postcard -> ride read and
-- that "a badge naming a postcard's ride needs its own accessor". This
-- migration does not build one. `from_ride` is a BOOLEAN computed as
-- `p.club_id is distinct from club` — it says the row arrived through the ride
-- arm and never which ride, so no ride identity crosses the boundary and the
-- marker the app draws is a glyph rather than a name.
--
-- ---------------------------------------------------------------------------
-- ORDERING
-- ---------------------------------------------------------------------------
-- Additive AND inert: one function, no trigger on any shipped write path, no
-- policy changed. `036`'s hand-exercise gate does NOT fire for this file, and
-- that is stated rather than left unsaid — "it was not needed" and "we forgot"
-- look identical afterwards.

-- ---------------------------------------------------------------------------
-- §1. The accessor
-- ---------------------------------------------------------------------------
create or replace function public.club_stamp_postcard_ids(
  club      uuid,
  before    timestamptz default null,
  page_size int         default 30
)
returns table (id uuid, from_ride boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         -- `is distinct from`, NEVER `<>`. p.club_id is nullable and
         -- `null <> club` is NULL, which would drop every app-wide postcard —
         -- exactly the rows the ride arm exists to find — out of the result.
         -- Same class as 073's measured CHECK correction.
         (p.club_id is distinct from club) as from_ride
    from public.postcards p
   where
     -- (1) THE OUTER CLUB GATE. Evaluated once per statement rather than per
     -- row, because it does not depend on `p` — 062's own note about the same
     -- shape.
     --
     -- ** IT EXCLUDES TWO POPULATIONS AND ONLY THE FIRST IS OBVIOUS. **
     --   a. 083's INVITEE: a rider holding a live ride_invites row for one of
     --      this club's rides. can_read_ride is TRUE for them and
     --      can_read_club is FALSE, so this gate is the only thing between
     --      them and the club's postcard correlation. 086.4 mutation-tests it.
     --   b. ** SINCE 085, EVERY SIGNED-IN RIDER. ** discoverable_private_clubs
     --      makes a private club's id enumerable by anybody, and this function
     --      is published by PostgREST and granted to `authenticated`. So this
     --      gate is what stops a rider taking an id off 085's accessor and
     --      probing a private club's postcards straight against the endpoint.
     --      The two migrations ship on one branch; do not read (a) alone and
     --      conclude the gate is nearly decoration.
     private.can_read_club((select auth.uid()), club)
     and (
       -- (2a) THE AUDIENCE ARM — club_id IS the audience, unchanged.
       p.club_id = club
       -- (2b) THE TAG ARM. p.ride_id is readable HERE and by no client.
       -- The per-ride gate is load-bearing for a PUBLIC club holding a
       -- PRIVATE ride: 022's propagate_club_privacy_to_rides rewrites a
       -- club's rides only in the private direction, so a public club can
       -- own a ride a non-member may not read, and without this conjunct
       -- that ride's postcards would surface on the club's strip.
       or exists (
         select 1
           from public.rides r
          where r.id = p.ride_id
            and r.club_id = club
            and private.can_read_ride((select auth.uid()), r.id)
       )
     )
     -- (3) 011's `postcards` SELECT qual, COPIED VERBATIM FROM 062 §2.
     -- This is a RESTATEMENT AND CAN GO STALE — 086.15 pins the policy's whole
     -- text under this function's name, in addition to the pin that already
     -- exists under ride_journal_postcard_ids' name, and its failure message
     -- says to move both bodies rather than to re-pin the string.
     --
     -- The author branch is unconditional there and must stay unconditional
     -- here: 009 made it so a rider can never lose their own photo, including
     -- one in a club they left and one they hid from themselves.
     and (
       p.author_id = (select auth.uid())
       or (
         not private.is_blocked((select auth.uid()), p.author_id)
         and (
           p.club_id is null
           or private.is_club_member(p.club_id)
         )
         and not exists (
           select 1
             from public.postcard_hides h
            where h.postcard_id = p.id
              and h.user_id = (select auth.uid())
         )
       )
     )
     and (before is null or p.created_at < before)
   order by p.created_at desc, p.id desc
   -- `greatest(…, 0)` for the reason 085's accessor carries it: Postgres
   -- raises `LIMIT must not be negative`, so without it a client passing -1
   -- gets a 500 from an endpoint that should have returned nothing.
   limit greatest(least(coalesce(page_size, 30), 100), 0);
$$;

comment on function public.club_stamp_postcard_ids(uuid, timestamptz, int) is
  'The ids of the postcards on a club''s strip — both those posted TO the club and those tagged to one of its rides — that the CALLER may see, newest first (086, PD-328). Returns ids and a flag and NEVER a row: the caller re-reads them under their own RLS, so `postcards` SELECT is still the only authority on content and this function''s restated visibility is load-bearing only for the CORRELATION. security definer because 062 revoked select (ride_id) from authenticated and Postgres checks a column privilege to FILTER as well as to return. THREE composed predicates, each excluding somebody: private.can_read_club excludes 083''s invitee (for whom can_read_ride is true) and, since 085, every signed-in rider holding a discoverable private club''s id; the per-ride private.can_read_ride excludes a non-member of a PUBLIC club facing that club''s PRIVATE ride, 022 rewriting rides only in the private direction; and 011''s postcards qual, restated verbatim from 062 §2, carries blocks, hides, club membership and the unconditional author branch. `from_ride` is `club_id is distinct from club` — it says the row came through the ride arm and NEVER which ride, so 062''s absent postcard -> ride read stays absent and the flag is not one.';

-- Postgres grants EXECUTE to PUBLIC on every new function unless told
-- otherwise (062 §2's note). `revoke all` and `revoke execute` are the same
-- thing on a function.
revoke all on function public.club_stamp_postcard_ids(uuid, timestamptz, int) from public, anon;
grant execute on function public.club_stamp_postcard_ids(uuid, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The function itself.
--
--   select prosecdef, proconfig, pg_get_function_result(oid)
--     from pg_proc where proname = 'club_stamp_postcard_ids';
--   -- t | {search_path=} | TABLE(id uuid, from_ride boolean)
--
--   select has_function_privilege('authenticated','public.club_stamp_postcard_ids(uuid,timestamptz,int)','execute'), -- t
--          has_function_privilege('anon',         'public.club_stamp_postcard_ids(uuid,timestamptz,int)','execute'); -- f
--
-- 2. ** THE COLUMN GRANT 062 CLOSED IS STILL CLOSED. ** This file exists
--    BECAUSE of that revoke, so an apply that quietly restored it would make
--    the accessor pointless and the exposure live again. Asserted as a sorted
--    string rather than a count — 015's trap.
--
--   select string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='postcards'
--      and grantee='authenticated' and privilege_type='SELECT';
--   -- author_id,caption,club_id,created_at,id,image_path,updated_at
--
--   select has_column_privilege('authenticated','public.postcards','ride_id','SELECT');
--   -- f
--
-- 3. The policy this function RESTATES did not move. Capture before and after.
--
--   select md5(qual) from pg_policies
--    where schemaname='public' and tablename='postcards' and cmd='SELECT';
--   -- c8fb49b026866743283b3d7ecfbc5122   (unchanged by 086)
--
-- 4. Advisors: TWENTY before this file (085 having taken 17 to 20),
--    TWENTY-ONE after. Exactly one new
--    `authenticated_security_definer_function_executable`. A second means
--    something landed in `public` that belongs in `private`.
--
-- 5. NO HAND-EXERCISE GATE. This file creates one function, hangs no trigger on
--    any write path and changes no policy, so 036's rule does not fire. Stated
--    rather than omitted, because "it was not needed" and "we forgot" look
--    identical afterwards.
