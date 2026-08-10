-- 043: the one delete a client is structurally incapable of doing safely.
--
-- PD-101, `openspec/changes/add-ride-club-edit-delete/` §D1. Purely additive:
-- one function, its grants and its comment. No policy is added, dropped or
-- rewritten, no column moves, no trigger is hung off an existing write path.
-- Nothing in `src/` calls it until `deleteClub` ships, so applying this on its
-- own is a no-op from the application's point of view.
--
-- ---------------------------------------------------------------------------
-- Why a function at all — the club owner holds no grant to clean up
-- ---------------------------------------------------------------------------
-- `rides.club_id` is `ON DELETE SET NULL`. A ride left with `club_id` NULL and
-- `is_public` false satisfies neither non-organizer arm of the `rides` SELECT
-- policy, so it becomes visible ONLY to its organizer while its `ride_members`
-- rows survive — and `ride_members` SELECT and `ride_messages` SELECT both open
-- with an `EXISTS` against `rides` under the caller's own RLS, so the crew loses
-- the ride, the roster and the entire chat in one step while the organizer keeps
-- seeing a crew that can no longer see them. That is the zombie `029` named and
-- `032` §2 narrowed the rule for.
--
-- A client cannot prevent it. The `rides` DELETE policy is
-- `auth.uid() = organizer_id` with no club-owner arm, so a club owner deleting
-- their club holds no grant to delete a ride another member organised in it —
-- and for a PRIVATE club that is every ride, because `propagate_club_privacy_to_rides`
-- and `enforce_ride_club_audience` between them guarantee a private club's rides
-- are all `is_public = false`.
--
-- Two alternatives were considered and rejected in §D1; neither is reopened here.
-- Widening the `rides` DELETE policy with a club-owner arm would let an owner
-- delete any member's ride at any time, which is a moderation decision nobody has
-- made arriving as a side effect of a cleanup, and it cannot be scoped to "during
-- a delete" in a policy. Refusing to delete a club that holds rides the owner did
-- not organise converts a silent bug into a permanent dead end: they cannot delete
-- those rides, cannot transfer the club, and cannot make the other member act.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against letsride-dev 2026-08-09
-- ---------------------------------------------------------------------------
--   clubs ..................................................... 2
--   clubs that are private .................................... 0
--   clubs carrying avatar_path or cover_image_path ............ 1
--   rides ..................................................... 2
--   rides with a club_id ...................................... 1
--   private club rides organised by someone other than the owner  0
--   club_members .............................................. 2
--   postcards with a club_id .................................. 0
--   existing public.delete_owned_club ......................... 0
--   plpgsql.variable_conflict ................................. error
--
-- So nothing in either database is in the shape this function exists for yet.
-- Re-run before reading any of it as current:
--
--   select count(*) from public.rides r join public.clubs c on c.id = r.club_id
--    where r.is_public = false and r.organizer_id <> c.owner_id;
--
-- ---------------------------------------------------------------------------
-- The parameter name, and the honest reason for the pragma
-- ---------------------------------------------------------------------------
-- `club_id` is a column on `rides`, `club_members`, `feed_reads`, `postcards`
-- and `notifications`, so a parameter of that name makes `where club_id =
-- club_id` ambiguous. `p_` is this repo's own answer to exactly that case —
-- `complete_onboarding(p_location text)`, where `location` is a `profiles`
-- column — and locals take `v_`, as that function's do.
--
-- **The pragma is NOT a fix for a silent mass delete, and writing it that way
-- would ship a claim the database contradicts.** Measured on letsride-dev
-- 2026-08-09: `plpgsql.variable_conflict` is already `error`, so a probe
-- function with the colliding parameter raised `42702 column reference
-- "club_id" is ambiguous` and deleted 0 of 3 rows. The collision fails loudly
-- under the default configuration.
--
-- What `#variable_conflict error` buys is that the guarantee becomes local to
-- this function instead of depending on a cluster GUC an operator can set to
-- `use_column` — which is the one setting under which the silent version becomes
-- real. Every column reference below is alias-qualified for the same reason:
-- belt and braces on a function that deletes clubs.

create or replace function public.delete_owned_club(p_club_id uuid)
returns table (object_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid    uuid := (select auth.uid());
  v_avatar text;
  v_cover  text;
begin
  if v_uid is null then
    raise exception 'delete_owned_club requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- The ownership test is the function's OWN job. `security definer` runs the
  -- body with RLS bypassed — measured on Postgres 16 for 021 §3, and it is
  -- ownership rather than superuser, so `force row level security` would be the
  -- only thing that changed it. There is no policy backstop behind this line:
  -- the `and c.owner_id = v_uid` below is the entire access control, and it is
  -- the line to read first in any future edit.
  --
  -- One SELECT and one raise site, so "no such club" and "not your club" are
  -- the same code path and cannot drift into two distinguishable answers. A
  -- caller learns nothing about a club they do not own, including whether it
  -- exists.
  select c.avatar_path, c.cover_image_path
    into v_avatar, v_cover
    from public.clubs c
   where c.id = p_club_id
     and c.owner_id = v_uid
     for update;

  if not found then
    raise exception 'no club with that id is owned by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- Surrendered whether or not the caller manages to delete the bytes, so they
  -- are returned before the row that holds them goes. Both sit under the
  -- OWNER's uid prefix (016's CHECKs pin them there), and the owner is the
  -- caller, so the caller's own Storage policy permits the delete.
  if v_avatar is not null then
    object_path := v_avatar;
    return next;
  end if;
  if v_cover is not null then
    object_path := v_cover;
    return next;
  end if;

  -- Only the rides `ON DELETE SET NULL` would turn into zombies — `032` §2's
  -- already-argued rule, reused rather than re-derived. A PUBLIC ride survives
  -- the club perfectly well: it stays public, stays readable by every signed-in
  -- rider, keeps its crew and simply stops belonging to a club. Deleting it
  -- would destroy another rider's content for no reason.
  --
  -- Note the predicate is the RIDE's own audience, not the club's: 022 lets a
  -- public club hold a private ride, and that ride is a zombie too.
  delete from public.rides r
   where r.club_id = p_club_id
     and r.is_public = false;

  delete from public.clubs c
   where c.id = p_club_id;

  return;
end;
$$;

comment on function public.delete_owned_club(uuid) is
  'Deletes the CALLER''s own club and the rides ON DELETE SET NULL would strand (043). security definer because the club owner holds no grant to delete a ride another member organised in their club — the rides DELETE policy is auth.uid() = organizer_id with no club-owner arm — so a client-side club delete leaves every private ride visible only to its organizer with its crew and chat unreadable. Re-checks owner_id = auth.uid() internally: RLS does not apply inside the body, so that check is the whole access control. Returns the club''s own avatar and cover object paths so the caller can delete the bytes; cascade-deleted postcards'' images are permanently orphaned (PD-94).';

-- Postgres grants EXECUTE to PUBLIC on every new function unless told otherwise,
-- and the harness reproduces Supabase's default function grants for the same
-- reason. `revoke all` and `revoke execute` are the same thing on a function;
-- `all` matches 021's shape.
revoke all on function public.delete_owned_club(uuid) from public, anon;
grant execute on function public.delete_owned_club(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What this does NOT do: Storage, and it is stated rather than implied
-- ---------------------------------------------------------------------------
-- This function deletes ROWS. Storage is a separate API that no SQL function in
-- this repo reaches, so every image behind the deleted rows survives the
-- transaction. Three sets, and they are not equally recoverable:
--
--   * The club's own `avatar_path` / `cover_image_path` (016, under
--     `club-avatars/<owner uid>/` and `club-covers/<owner uid>/`). RETURNED
--     above; the caller is the owner, so their Storage policy reaches them.
--   * **Every cascade-deleted postcard's `image_path`, under
--     `postcards/<author uid>/`. These belong to OTHER riders, and the Storage
--     policies gate on the path's uid prefix, so neither the club owner nor
--     this function can delete them. They are PERMANENTLY ORPHANED.**
--   * Anything the client's Storage call then fails to remove — offline, a
--     partial failure, or a rider who closes the app between the RPC and the
--     Storage delete. The row deletion has already committed and there is no
--     transaction left to roll back.
--
-- Orphaned Storage objects are PD-94's scope. This migration files no new issue
-- and proposes no sweep; it records which objects it orphans so PD-94 inherits
-- an accurate list instead of rediscovering it.
--
-- ---------------------------------------------------------------------------
-- The blast radius this hands to the confirmation copy, read off the FKs
-- ---------------------------------------------------------------------------
-- Deleting a club destroys, by cascade or by the delete above: every postcard in
-- it (`postcards.club_id` CASCADE — including every OTHER member's, which `009`
-- reasoned out deliberately for a club deleted BY its owner and which this
-- change does not reopen), every `club_members` row, every `feed_reads`
-- watermark, every notification about it, and every private ride in it — with
-- each of those rides its `ride_members` crew and its `ride_messages` chat.
-- A confirmation naming only postcards understates it by two whole tables of
-- other people's writing.
--
-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- `apply_migration` takes SQL as an argument rather than a path, so the file and
-- the database can disagree by exactly one clause — and here the
-- security-relevant clause IS `security definer`. `022` shipped that defect once,
-- in the other direction. Expect t and `{search_path=""}`, with the literal
-- quotes, which is how Postgres stores it:
--
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.delete_owned_club(uuid)'::regprocedure;
--
-- The pragma survived the round trip. Expect t:
--
--   select prosrc like '%#variable_conflict error%' from pg_proc
--    where oid = 'public.delete_owned_club(uuid)'::regprocedure;
--
-- Reachability as a ROLE, never by calling it as the table owner, for whom no
-- barrier exists — `031` exists because `029` shipped a function nothing could
-- call and nothing noticed. Expect t, f:
--
--   select has_function_privilege('authenticated', 'public.delete_owned_club(uuid)', 'execute'),
--          has_function_privilege('anon',          'public.delete_owned_club(uuid)', 'execute');
--
-- And PUBLIC's default grant is gone. Expect f:
--
--   select coalesce(bool_or(a::text like '=X/%'), false)
--     from pg_proc p, unnest(p.proacl) a
--    where p.oid = 'public.delete_owned_club(uuid)'::regprocedure;
--
-- No policy moved. Expect 4 and 4:
--
--   select count(*) filter (where tablename = 'clubs'),
--          count(*) filter (where tablename = 'rides')
--     from pg_policies where schemaname = 'public' and tablename in ('clubs', 'rides');
--
-- Expect ONE new security advisor and expect it to be correct rather than a
-- regression: a seventh `authenticated_security_definer_function_executable`,
-- taking the total from eight to nine. `CLAUDE.md`'s advisor table gains the row
-- in the same change, because an expected advisor missing from that table reads
-- as a regression for ever.
