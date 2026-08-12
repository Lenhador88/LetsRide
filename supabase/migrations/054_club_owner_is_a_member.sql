-- 054: a club's owner reaches their own club as a member does. PD-128.
--
-- `private.is_club_member` reads `club_members` and nothing else, so a club
-- owner holding no membership row loses their own private club's rides — and
-- cannot create one in it either, because `rides` INSERT carries the same
-- predicate in its WITH CHECK. The club itself stays visible, which is what
-- makes the defect silent: `clubs` SELECT is
-- `is_public OR owner_id = auth.uid() OR private.is_club_member(id)`, an
-- explicit owner arm. One policy in the caller set got the concept right; the
-- other nine did not. This file closes that disagreement in the one predicate
-- they all share.
--
-- ---------------------------------------------------------------------------
-- NO POLICY IS RECREATED BY THIS FILE
-- ---------------------------------------------------------------------------
-- That is the property a reviewer checks fastest, and it is the reason the arm
-- goes here rather than into the policies. An ownership arm added at POLICY
-- level is the shape that could escape a block conjunct; this file adds none.
-- Ten policies call this function directly (all in `public`, read from
-- `pg_policies` on DEV 2026-08-12, zero direct callers in `storage`, zero in
-- any other function) and every one of them becomes correct together, with no
-- DDL on any table, no grant change, no backfill and no application code change.
--
-- The widening is larger than the direct caller set and is enumerated in
-- `openspec/changes/grant-club-owner-member-reach/proposal.md`. It INCLUDES two
-- `storage.objects` SELECT policies, which name no function at all and inherit
-- `postcards` / `rides` SELECT through an RLS-filtered EXISTS — so this reaches
-- image bytes, deliberately.
--
-- Blocking is unaffected, and the reason is DOMINATION rather than position:
-- every occurrence of this predicate sits under a `private.is_blocked` conjunct,
-- and the only disjuncts that escape one test the viewer's own identity
-- (`organizer_id = auth.uid()`, `author_id = auth.uid()`, `user_id = auth.uid()`),
-- which `blocks_no_self_block CHECK (blocker_id <> blocked_id)` makes safe by
-- forcing `private.is_blocked(x, x)` false. Do NOT restate this as "`is_blocked`
-- is a top-level conjunct" — that is FALSE for `rides` and `postcards` SELECT,
-- whose top-level operator is `OR`, so a check written that way fires against a
-- correct database and teaches the next reader to skip it.
--
-- ---------------------------------------------------------------------------
-- The state this repairs is currently unreachable, and that is why now
-- ---------------------------------------------------------------------------
-- Clubs whose `owner_id` holds no `club_members` row, measured with RLS
-- bypassed on 2026-08-12, immediately before this file was written:
--
--     DEV  (fpmrimzxadewsaiwpsel)   0 total, 0 private
--     PROD (zwprydcyryvudhurbnye)   0 total, 0 private
--
-- No rider is in the broken state, so nothing is on fire and no backfill is
-- owed. What the zeros settle is that this is fixable predicate-first, with no
-- data migration and no rider-visible transition. Two doors lead in and the
-- second needs nothing to fail: `createClub`'s two un-transacted inserts, or an
-- owner simply leaving — `club_members` DELETE is `auth.uid() = user_id` with
-- no owner carve-out.
--
-- ---------------------------------------------------------------------------
-- RECURSION WARNING — read before hardening `public.clubs`
-- ---------------------------------------------------------------------------
-- This function now reads `public.clubs`, and `clubs`' own SELECT policy calls
-- this function. That self-edge does not recurse ONLY because `public.clubs`
-- does not force row-level security and this function's definer owns the table,
-- so RLS is not applied to the read inside this body.
-- `ALTER TABLE public.clubs FORCE ROW LEVEL SECURITY` would turn every club read
-- in the application into `42P17` infinite recursion — not one screen, the whole
-- app. No security advisor asks for that setting; do not add it without first
-- replacing this read. Verified on DEV 2026-08-12:
--   select relforcerowsecurity, pg_get_userbyid(relowner)
--     from pg_class where oid = 'public.clubs'::regclass;   -- false, postgres
--
-- ---------------------------------------------------------------------------
-- Why `search_path` changes in the same statement, deliberately
-- ---------------------------------------------------------------------------
-- This is the ONLY function in `private` whose `search_path` is `'public'`
-- rather than `''`; the other fifteen — `is_blocked`, `is_club_public`,
-- `is_ride_crew` among them — use the empty path with schema-qualified
-- references. Changing it on a function ten policies call is its own risk, so
-- it is stated rather than slipped in: it is safe here because the replacement
-- body resolves NOTHING through the search path. Every reference is
-- schema-qualified (`public.club_members`, `public.clubs`, `auth.uid()`), so the
-- setting has no name left to resolve and cannot change what this function
-- means. Leaving `'public'` behind on a body being rewritten anyway would keep a
-- known inconsistency for no gain, and a `security definer` function whose
-- search path is a writable schema is the standing hazard the other fifteen
-- already avoid.
--
-- ---------------------------------------------------------------------------
-- Rollback — the pre-054 body, copied verbatim from `pg_get_functiondef` on DEV
-- 2026-08-12 rather than reconstructed. It restores `search_path TO 'public'`
-- and the unqualified `club_members` with the arm, a revert being a revert.
-- ---------------------------------------------------------------------------
--   CREATE OR REPLACE FUNCTION private.is_club_member(target_club_id uuid)
--    RETURNS boolean
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--     select exists (
--       select 1 from club_members
--       where club_id = target_club_id and user_id = auth.uid()
--     );
--   $function$
--
-- The name does not change. `CREATE OR REPLACE FUNCTION` cannot rename, so a
-- rename would mean dropping and recreating all ten calling policies on the
-- visibility layer for a naming gain — and the name becomes accurate again the
-- moment `enforce-creator-membership` makes the owner's membership row
-- mandatory. `COMMENT ON FUNCTION` carries the contract instead.

create or replace function private.is_club_member(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Membership first: it is the common case, and `or` short-circuits, so a
  -- rider who holds a row never pays for the `clubs` lookup. Two independent
  -- EXISTS clauses rather than a join, for the same reason.
  select exists (
    select 1 from public.club_members
     where club_id = target_club_id
       and user_id = auth.uid()
  ) or exists (
    select 1 from public.clubs
     where id = target_club_id
       and owner_id = auth.uid()
  );
$$;

comment on function private.is_club_member(uuid) is
  'True when the caller holds a club_members row for the club OR is the club''s owner_id. '
  'The owner arm is deliberate and is NOT a bug: a club owner holding no membership row is '
  'otherwise locked out of their own private club''s rides, postcards and roster, in both '
  'directions, while the club itself stays visible. The name is kept because renaming would '
  'require recreating all ten calling policies, and because enforce-creator-membership makes '
  'every owner hold a membership row again, at which point the arm is belt-and-braces for a '
  'state the database no longer permits. Caller-relative: it resolves auth.uid(), so it answers '
  'a question about the CALLER and must never be used to compute a notification fan-out '
  'recipient set. Reads public.clubs, so see 054''s header before forcing RLS on that table.';
