-- 029: make the profiles cascade survivable — indexes, and a club that outlives
-- its owner.
--
-- Groundwork for `add-account-deletion`. Nothing here removes a column, a table
-- or a grant, nothing changes a SELECT policy, and nothing in `src/` reads
-- anything this adds. That is the definition of the group it belongs to, and it
-- is why this can land before the Edge Function exists: the indexes are right
-- regardless of whether the flow ever ships.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against the hosted project 2026-08-06
-- ---------------------------------------------------------------------------
--   profiles .................................................. 4
--   clubs (total) ............................................. 2
--   clubs with more than one member ........................... 1
--   clubs whose owner is not the only member .................. 1
--   clubs carrying avatar_path or cover_image_path ............ 0
--   clubs owned by a rider who is not a member of it .......... 0
--   club_members .............................................. 3
--   club_members with role = 'admin' .......................... 0
--   rides ..................................................... 3
--   rides with a club_id ...................................... 0
--   ride_members .............................................. 3
--   postcards ................................................. 3
--
-- Two of those decide things below. **Zero clubs have ever carried an image**,
-- so §2's "the club loses its images" costs nothing today and is a rule for
-- later rather than a migration of existing rows. **Zero rows are `admin`**, so
-- §2's first successor arm is dead code on arrival — written anyway, because the
-- day it stops being dead is the day someone would otherwise have to remember
-- this file existed.
--
-- A count that is 0 today is not a count that is 0 at apply time. Re-run:
--
--   select count(*) from public.clubs where avatar_path is not null
--                                        or cover_image_path is not null;
--   select count(*) from public.club_members where role = 'admin';
--
-- ---------------------------------------------------------------------------
-- The count this migration had to correct before it could start
-- ---------------------------------------------------------------------------
-- The proposal says **eleven** FKs reference `public.profiles`, and its own task
-- list says **eight** of them are already served by an index. Both are wrong:
-- there are **thirteen**, every one `ON DELETE CASCADE`, and **nine** are served.
-- The grep the proposal recommends counts fifteen lines and two of them are
-- `friendships`, which `013` dropped — so subtracting the dropped pair from a
-- number that was already wrong produced a second wrong number.
--
-- Derived from the catalogue instead, which is the only source that cannot be
-- stale. This query is also §1's assertion, and it is written as a derivation
-- rather than a list of names so a table added next year fails it:
--
--   select c.conrelid::regclass as tbl, a.attname,
--          exists (select 1 from pg_index i
--                   where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
--     from pg_constraint c
--     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
--    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass;

-- ---------------------------------------------------------------------------
-- §1. The four FK columns a cascade cannot use an index for
-- ---------------------------------------------------------------------------
--
-- Postgres does not index the referencing side of a foreign key. On `delete
-- from profiles` it must find the children of the departing row in every one of
-- the thirteen tables, and without a leading-column index that is a sequential
-- scan per table, inside the transaction that holds the locks.
--
-- Nine are already served, all of them by accident of a composite PK or an
-- index added for a screen: `blocks` twice (its PK plus `009`'s reversed index),
-- `postcards`, `postcard_likes`, `postcard_hides`, `postcard_reports`,
-- `profile_countries`, `feed_reads` — and `postcard_comments`, which is the only
-- one that was deliberate. `011` wrote `postcard_comments_author_id_idx` and said
-- in its own comment that it was "for the ON DELETE CASCADE from profiles".
--
-- These four are that same reason, never written. Free now at three rides and
-- two clubs; not free later, and a deletion holds locks while it runs.
--
-- `clubs.owner_id` and `rides.organizer_id` are plain single-column FKs with no
-- index of any kind. `club_members.user_id` and `ride_members.user_id` each sit
-- second in a composite PK — `(club_id, user_id)`, `(ride_id, user_id)` — which
-- serves a lookup by club or by ride and does nothing for a lookup by rider.

create index club_members_user_id_idx  on public.club_members (user_id);
create index ride_members_user_id_idx  on public.ride_members (user_id);
create index clubs_owner_id_idx        on public.clubs (owner_id);
create index rides_organizer_id_idx    on public.rides (organizer_id);

comment on index public.clubs_owner_id_idx is
  'For the ON DELETE CASCADE from profiles (029), and for "clubs this rider owns". Same reason 011 gave for postcard_comments_author_id_idx.';
comment on index public.rides_organizer_id_idx is
  'For the ON DELETE CASCADE from profiles (029), and for "rides this rider organises".';
comment on index public.club_members_user_id_idx is
  'For the ON DELETE CASCADE from profiles (029). The PK is (club_id, user_id), which cannot serve a lookup by rider.';
comment on index public.ride_members_user_id_idx is
  'For the ON DELETE CASCADE from profiles (029). The PK is (ride_id, user_id), which cannot serve a lookup by rider.';

-- ---------------------------------------------------------------------------
-- §2. A club outlives its owner
-- ---------------------------------------------------------------------------
--
-- **This is the dangerous one, and it is a defect that exists today rather than
-- one this change introduces.** `clubs.owner_id → profiles` is ON DELETE
-- CASCADE, and `postcards.club_id → clubs` is ON DELETE CASCADE behind it. Chain
-- them: rider A owns club C; riders B, D and E have posted forty postcards into
-- C; A deletes their account; all forty are destroyed, along with the club, its
-- roster and its `feed_reads` watermarks.
--
-- `009` reasoned about the second link carefully and correctly for the case it
-- had — a club being deleted *by its owner, deliberately*, where "cascade loses
-- the rows; set null leaks them" and losing them is the right failure. It did
-- not consider the club deletion arriving as a side effect of a third party's
-- erasure request. The reasoning is sound and its premise moved.
--
-- So ownership transfers before the cascade runs, in one transaction:
--
--   1. the longest-tenured remaining `admin`, by `club_members.joined_at`
--   2. failing that, the longest-tenured remaining `member`
--   3. failing that — the departing rider is the only member — the club goes
--      with them, which is `009`'s original case and its original answer
--
-- **`016`'s CHECKs do NOT need relaxing, and the proposal is wrong that they
-- do.** `clubs_avatar_path_owned` is `avatar_path is null OR avatar_path like
-- 'club-avatars/' || owner_id || '/%'`, so it pins a *non-NULL* path to the
-- current owner. The proposal reads that as "any ownership transfer raises
-- 23514" and asks for a relaxation; design D2 chose the other option in the same
-- breath — null both paths on transfer — and says of it "no new constraint
-- semantics". D2 is right and the task list contradicts it. A transfer that
-- nulls the path satisfies the first disjunct and the CHECK never bites.
--
-- Measured rather than reasoned, on the real constraint definition:
--
--   transfer KEEPING the image path .................... refused 23514
--   transfer NULLing the path (what D2 decided) ........ allowed
--
-- So all four of `016`'s path CHECKs survive this migration unchanged, and §3
-- asserts they do. The rejected alternative — an `image_owner_id` column the
-- CHECK points at instead — was rejected in D2 on the grounds that it retains a
-- departed rider's uid inside a live path forever, which is the opposite of what
-- an erasure request asked for.
--
-- **The club loses its images when its owner leaves.** That is a stated product
-- consequence, not a bug to be found later: the club keeps its name and falls
-- back to initials, exactly as all 2 clubs do today. The function returns the
-- object paths so its caller can delete the bytes; a path dropped from the row
-- without its object deleted is an orphan nothing can enumerate, which is the
-- failure `scripts/storage/sweep-orphans.mjs` exists to clean up after.

create or replace function private.transfer_owned_clubs(departing uuid)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  club record;
  successor uuid;
begin
  for club in
    select c.id, c.avatar_path, c.cover_image_path
      from public.clubs c
     where c.owner_id = departing
     order by c.id
     for update
  loop
    -- Both image paths are surrendered whichever branch runs: on transfer
    -- because the CHECK pins them to the old owner, and on deletion because the
    -- row is going. Returned before either, so the caller can delete the bytes.
    if club.avatar_path is not null then
      object_path := club.avatar_path;
      return next;
    end if;
    if club.cover_image_path is not null then
      object_path := club.cover_image_path;
      return next;
    end if;

    -- `admin` first, then `member`, then anything else — total over the enum
    -- rather than a two-arm CASE, so a stray second `owner` row sorts last
    -- instead of being picked at random. Nothing writes `admin` today (0 rows);
    -- 019 made the column unforgeable and the invitations feature owns writing
    -- it, so this arm is correct and unreachable, in that order.
    --
    -- `for update` on the candidate's profile row is what stops this selecting
    -- someone who is themselves mid-deletion: their cascade must take the same
    -- lock, so one of the two transactions waits and re-reads.
    select m.user_id into successor
      from public.club_members m
      join public.profiles p on p.id = m.user_id
     where m.club_id = club.id
       and m.user_id <> departing
     order by case m.role when 'admin' then 0 when 'member' then 1 else 2 end,
              m.joined_at,
              m.user_id
     limit 1
       for update of p;

    if successor is not null then
      update public.clubs
         set owner_id         = successor,
             avatar_path      = null,
             cover_image_path = null
       where id = club.id;

      -- The roster has to agree with the row, or /clubs/[id]/members draws the
      -- owner ring on a rider who no longer owns the club. 019's WITH CHECK
      -- permits exactly `role = 'owner' and user_id = clubs.owner_id`, so this
      -- is the state that policy already calls legitimate.
      update public.club_members
         set role = 'owner'
       where club_id = club.id
         and user_id = successor;

      delete from public.club_members
       where club_id = club.id
         and user_id = departing;
    else
      -- No member remains, so the club goes — 009's original case. Its rides go
      -- FIRST and explicitly, rather than being orphaned by
      -- `rides.club_id ON DELETE SET NULL`.
      --
      -- That default was chosen in 001 for a schema with no `is_public`
      -- interaction and no 022. Today a private club's rides carry
      -- `is_public = false` (022 guarantees it), so a SET NULL leaves a ride
      -- with `club_id` NULL and `is_public` false — which 022 §4's SELECT policy
      -- resolves to "only the organizer may see it", while its `ride_members`
      -- rows survive and `ride_members`' own policy hangs off the ride. A roster
      -- nobody can read, attached to a ride nobody can find. A zombie.
      delete from public.rides where club_id = club.id;
      delete from public.clubs where id = club.id;
    end if;

    successor := null;
  end loop;
end;
$$;

comment on function private.transfer_owned_clubs(uuid) is
  'Hand every club this rider owns to its longest-tenured remaining admin, else its longest-tenured remaining member, else delete it with its rides (029). Returns the Storage object paths it surrendered so the caller can delete the bytes. Exists so one rider erasing their account does not destroy other riders'' postcards through the clubs -> postcards cascade. security definer because it rewrites rows across three tables under nobody''s ownership; in `private` so PostgREST never publishes it.';

-- `private` has no USAGE for `authenticated` (005), so this is belt and braces —
-- and belt and braces is the point for a function that deletes clubs.
--
-- **This paragraph used to end by saying no `public` wrapper is created here
-- deliberately, and that the wrapper "belongs with the Edge Function that calls
-- it". `031` created exactly that wrapper, because without it NOTHING could call
-- this function at all** — `service_role` holds no USAGE on `private`, and
-- PostgREST routes only to `public`. Read `031` before reasoning about who
-- reaches this; the deferral recorded here was the mistake, not the design.
revoke all on function private.transfer_owned_clubs(uuid) from public, anon, authenticated;

-- The body above is superseded by `032`, which demotes the departing rider
-- instead of deleting their membership row, and deletes only the rides that
-- `ON DELETE SET NULL` would strand. `create or replace` there, so this
-- definition is history — read `032` for what actually runs.

-- ---------------------------------------------------------------------------
-- §3. Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Every FK into profiles is served by a leading-column index. Expect 0.
-- Written as a derivation, so a table added next year fails it rather than
-- slipping past a list of four names:
--
--   select count(*) from pg_constraint c
--    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
--      and not exists (select 1 from pg_index i
--                       where i.indrelid = c.conrelid
--                         and i.indkey[0] = c.conkey[1]);
--
-- Thirteen FKs into profiles, all CASCADE. Expect 13 and 13:
--
--   select count(*), count(*) filter (where confdeltype = 'c')
--     from pg_constraint
--    where contype = 'f' and confrelid = 'public.profiles'::regclass;
--
-- 016's four path CHECKs are untouched. Expect 4:
--
--   select count(*) from pg_constraint
--    where conrelid = 'public.clubs'::regclass and contype = 'c'
--      and conname in ('clubs_avatar_path_shape', 'clubs_avatar_path_owned',
--                      'clubs_cover_image_path_shape', 'clubs_cover_image_path_owned');
--
-- The function is unreachable from the client. Expect false, false, and a
-- 42501 from a direct PostgREST call:
--
--   select has_function_privilege('authenticated', 'private.transfer_owned_clubs(uuid)', 'execute'),
--          has_function_privilege('anon',          'private.transfer_owned_clubs(uuid)', 'execute');
--
-- It is the fourth `security definer` function outside `public`, so it does NOT
-- add a security advisor: `authenticated_security_definer_function_executable`
-- fires on functions `authenticated` may execute, and this one it may not.
-- Expect the advisor count to stay at eight.
