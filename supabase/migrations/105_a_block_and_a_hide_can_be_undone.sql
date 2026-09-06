-- 105 — A block and a hide can be undone (PD-298)
-- ===========================================================================
--
-- Proposal: openspec/changes/undo-a-block-or-a-hide/. Read `design.md` before
-- changing anything here; three of its findings invert what a careful
-- implementer would otherwise write, and each is restated at its site below.
--
-- `unblockRider` and `unhidePostcard` are written, tested and have ZERO
-- callers. This file is what makes a caller possible, and PD-298's premise —
-- *"the schema is already on our side … this is a screen, not a migration"* —
-- is false in BOTH directions, measured on DEV 2026-09-05 as `authenticated`
-- with a real blocker's `sub`:
--
--   * own `blocks` rows readable ............ 1
--   * the blocked rider's `profiles` row .... 0
--
-- because 009's `profiles` SELECT qual is
-- `(auth.uid() = id) OR ((username IS NOT NULL) AND (NOT
-- private.is_blocked(auth.uid(), id)))` and `private.is_blocked` is SYMMETRIC.
-- A blocked-riders list built on existing schema renders a list of UUIDs.
--
-- And 011 puts the hide conjunct INSIDE the `postcards` SELECT qual, so a
-- hidden postcard is unreadable by the very rider who hid it. 011 said so at
-- the index it created — *"this serves the profiles cascade and a 'hidden
-- posts' screen if one is ever designed"*.
--
-- ---------------------------------------------------------------------------
-- WHY TWO `security definer` FUNCTIONS AND NOT A SECOND `profiles` POLICY
-- ---------------------------------------------------------------------------
-- ** MULTIPLE PERMISSIVE POLICIES FOR THE SAME ROLE AND COMMAND ARE OR'd. **
-- So a `profiles` SELECT policy reading `exists (select 1 from blocks b where
-- b.blocker_id = auth.uid() and b.blocked_id = profiles.id)` would not "let
-- the blocked-riders list read the row" — it would let EVERY `profiles` read
-- in the app read it: the postcard byline, the club roster, the ride crew,
-- search, chat. The block would stop working while still existing, which is
-- the worst of the three available outcomes. `design.md` D1.
--
-- A `security definer` function is the opposite shape: one named hole with one
-- statement in it, every other reader untouched. `private.is_blocked` itself
-- exists for this reason and 009 says so in its header.
--
-- ** `public`, NOT `private` ** — 029 is the precedent for getting this
-- backwards, and nothing caught it because the RLS suite runs as the table
-- owner, for whom no barrier exists. The client calls both of these through
-- PostgREST and PostgREST routes only to `public`. The two advisors are the
-- price; §Verification below accounts for them.
--
-- ** THE BYPASS IS LOAD-BEARING AND INVISIBLE. ** Both functions are owned by
-- `postgres` and `relforcerowsecurity` is FALSE on all four tables involved —
-- `blocks`, `postcard_hides`, `profiles`, `postcards` (read from `pg_class`,
-- 2026-09-05). Set FORCE ROW LEVEL SECURITY on any of them and these two
-- silently return nothing rather than failing.
--
-- ---------------------------------------------------------------------------
-- ORDERING
-- ---------------------------------------------------------------------------
-- Purely additive and inert: two functions, one index, no policy, CHECK,
-- grant, column or trigger changed. Neither side of the deploy fails — an old
-- bundle never calls them, and a new bundle against the old database gets a
-- PostgREST 404 on two reads that gate nothing else. 036's hand-exercise gate
-- does NOT fire, because nothing here hangs a trigger on a shipped write path.
-- Stated rather than omitted: "it was not needed" and "we forgot" look
-- identical afterwards.
--
-- Q1 (widen the postcard Storage policy so the hidden list can show a
-- thumbnail) came back as its stated default — NO. Nothing in this file
-- touches `storage.objects`, so nothing here leaves the additive class.

-- ---------------------------------------------------------------------------
-- §1. public.my_blocked_riders() — the identity the profiles policy withholds
-- ---------------------------------------------------------------------------
create or replace function public.my_blocked_riders()
returns table (blocked_id uuid, username text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- ** NO `username is not null` CONJUNCT, DELIBERATELY. ** (design.md D2)
  --
  -- The standing precedent — public.ride_journal_postcard_ids — restates its
  -- table's whole SELECT qual verbatim, and copying that habit HERE is a bug.
  -- `username is not null` is a conjunct of the very `profiles` policy this
  -- function exists to bypass, and restating it DROPS A ROW: the `blocks`
  -- INSERT policy checks only `blocker_id = auth.uid()`, the sole CHECK is
  -- `blocks_no_self_block`, and nothing anywhere requires the blocked party to
  -- have a username. Through the app that cannot happen — you can only block
  -- someone you can see — but the publishable key ships in the bundle and
  -- PostgREST accepts any rider's JWT, so a block against an un-onboarded uuid
  -- is one hand-rolled request away.
  --
  -- ** THE RULE IS ONE ROW OUT PER `blocks` ROW IN, ALWAYS. ** A block missing
  -- from this list is a block nobody can lift, which is precisely the defect
  -- PD-298 exists to fix, reproduced inside its own fix. A NULL username
  -- renders as Avatar's initials fallback; it does not vanish.
  --
  -- The join itself cannot drop a row either way: blocks_blocked_id_fkey
  -- references profiles(id) ON DELETE CASCADE, so a `blocks` row always has a
  -- `profiles` row.
  --
  -- ** AND NO `avatar_path` COLUMN, ALSO DELIBERATELY. ** (design.md D3,
  -- measured) `storage.objects` policies are ordinary RLS evaluated as the
  -- CALLER, and "Riders read avatars their profile visibility allows"
  -- delegates to `exists (select 1 from profiles p where p.avatar_path =
  -- objects.name …)` — which, for a blocker reading the rider they blocked, is
  -- exactly the read this function had to bypass. It is FALSE. A definer
  -- function can RETURN a path; it cannot make Storage SIGN one. Returning it
  -- would ship a column whose only possible rendering is a broken image, at
  -- the cost of a signing round trip that can only answer null.
  select b.blocked_id, p.username, b.created_at
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = (select auth.uid())
   order by b.created_at desc, b.blocked_id desc;
$$;

comment on function public.my_blocked_riders() is
  'Every block THIS rider created, newest first, carrying the username 009''s `profiles` SELECT policy withholds — `private.is_blocked` is symmetric, so the blocker cannot read the row of the rider they blocked and a list built on existing schema renders UUIDs (105, PD-298). security definer to bypass exactly that policy and nothing else; a second permissive `profiles` policy would have been OR''d into EVERY profiles read in the app and would have undone the block itself (design.md D1). ** It deliberately does NOT restate the policy''s `username is not null` conjunct ** — that would drop a block against an un-onboarded uuid, which PostgREST accepts today, and a block missing from this list cannot be lifted (D2). ** And it deliberately returns no avatar_path **: the Storage avatar policy resolves an EXISTS over `profiles` as the CALLER, which is false for this pair, so the path provably cannot sign and the list renders initials (D3, measured). Takes no argument at all: the subject is auth.uid() and nothing else.';

-- Postgres grants EXECUTE to PUBLIC on every new function unless told
-- otherwise. ** `anon` IS NAMED SEPARATELY AND MUST BE. ** Supabase's project
-- default is `alter default privileges in schema public grant execute on
-- functions to anon, authenticated`, which is an EXPLICIT grant to anon that a
-- `revoke … from public` does not touch. 009's `revoke … from public` alone
-- was enough for a function in `private`, where anon holds no schema USAGE;
-- this one is in `public`, so decision #1 needs the second grantee named.
revoke all on function public.my_blocked_riders() from public, anon;
grant execute on function public.my_blocked_riders() to authenticated;

-- ---------------------------------------------------------------------------
-- §2. public.my_hidden_postcards(before_at, page_size)
-- ---------------------------------------------------------------------------
create or replace function public.my_hidden_postcards(
  before_at timestamptz default null,
  page_size int         default 20
)
returns table (
  postcard_id      uuid,
  hidden_at        timestamptz,
  restorable       boolean,
  caption          text,
  author_username  text,
  taken_place_name text,
  image_path       text,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with hidden as (
    select h.postcard_id            as pid,
           h.created_at             as hid_at,
           p.caption                as cap,
           a.username               as uname,
           p.taken_place_name       as place,
           p.image_path             as img,
           p.created_at             as posted_at,
           -- ** 011's `postcards` SELECT QUAL, MINUS THE HIDE CONJUNCT AND
           -- NOTHING ELSE. ** This IS `restorable`: it answers "would deleting
           -- the hide row put this postcard back in front of this rider", and
           -- unhiding a row for which it is false restores nothing.
           --
           -- The author branch of the real qual is unconditional and is absent
           -- here on purpose — a self-hide is excluded from the result set
           -- entirely, below, so it can never reach this expression.
           --
           -- This is a RESTATEMENT AND IT CAN GO STALE. 105.13 pins the
           -- policy's whole text under this function's name; if that assertion
           -- fails, move this body rather than re-pinning the string.
           (
             not private.is_blocked((select auth.uid()), p.author_id)
             and (
               p.club_id is null
               or private.is_club_member(p.club_id)
             )
           ) as can_restore
      from public.postcard_hides h
      join public.postcards p on p.id = h.postcard_id
      join public.profiles  a on a.id = p.author_id
     where h.user_id = (select auth.uid())
       -- ** A SELF-HIDE IS EXCLUDED (Q5). ** The author branch of the
       -- `postcards` policy is unconditional, so a rider's hide of their own
       -- postcard is inert — the postcard is still on every screen they look
       -- at. Listing it would offer to "unhide" something never hidden. The
       -- row itself is left alone: 7.2, hidePostcard is not changed to refuse
       -- writing one.
       and p.author_id <> (select auth.uid())
       and (before_at is null or h.created_at < before_at)
     order by h.created_at desc, h.postcard_id desc
     -- `greatest(…, 0)` for the reason 085's and 086's accessors carry it:
     -- Postgres raises `LIMIT must not be negative`, so without it a client
     -- passing -1 gets a 500 from an endpoint that should return nothing. It
     -- changes no in-range input — least(page_size, 50) for every page_size a
     -- caller may legitimately send.
     limit least(greatest(coalesce(page_size, 20), 0), 50)
  )
  -- ** THE NULLING HAPPENS HERE, NOT IN THE COMPONENT. ** The render model is
  -- the client, so a rule that only reaches a component is advisory: anyone
  -- calling this endpoint directly must get the same emptied row the app does.
  select pid,
         hid_at,
         can_restore,
         case when can_restore then cap       end,
         case when can_restore then uname     end,
         case when can_restore then place     end,
         case when can_restore then img       end,
         case when can_restore then posted_at end
    from hidden
   order by hid_at desc, pid desc;
$$;

comment on function public.my_hidden_postcards(timestamptz, int) is
  'This rider''s own postcard_hides rows, newest first, each carrying exactly what Unhide would restore and nothing more (105, PD-298). security definer because 011 puts the hide conjunct INSIDE the `postcards` SELECT qual, so a hidden postcard is unreadable to the rider who hid it. `restorable` is 011''s qual restated with the hide conjunct removed and every other conjunct — the block predicate and the club-membership predicate — intact; when it is false every preview column comes back NULL, and the NULLING IS IN THE FUNCTION rather than in the component because the client owns the render path. ** `restorable` IS A BOOLEAN AND NEVER AN ENUM, and the reason is never returned. ** Three reasons make a row unrestorable — the rider left the club, the AUTHOR BLOCKED THEM, or the author deleted their account — and naming the middle one would tell a rider they had been blocked, which rls_test.sql asserts in as many words must not happen, on a schedule the rider controls: hide one postcard per person you want to monitor and read this list as a block detector. The three collapse into one indistinguishable state (design.md D4). A rider''s own postcard is excluded (Q5): the author branch of the policy is unconditional, so that hide is inert. image_path is returned for a RESTORABLE row only, and the app does not sign it — the Storage postcard policy resolves its EXISTS as the caller, under the same hide conjunct, so it cannot sign for a row on this list (D3, measured); the column is here so that if the owner ever widens that policy only the client changes.';

revoke all on function public.my_hidden_postcards(timestamptz, int) from public, anon;
grant execute on function public.my_hidden_postcards(timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------------
-- §3. The index the blocked-riders list sorts on
-- ---------------------------------------------------------------------------
-- `blocks` has blocks_pkey (blocker_id, blocked_id) and blocks_blocked_id_idx
-- (blocked_id, blocker_id) from 009. Neither carries created_at, so a rider's
-- own blocks newest-first is a prefix scan plus a sort. Free at real
-- cardinality — DEV holds exactly one blocks row — and added anyway for
-- symmetry with the postcard_hides_user_id_idx 011 created for this exact
-- screen, because the cost of adding it now is one line. (design.md D6;
-- inferred rather than measured, no rider has enough blocks for a plan to say
-- anything.)
create index if not exists blocks_blocker_id_created_at_idx
  on public.blocks (blocker_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. Both functions, their modifiers and their grants.
--
--   select proname, prosecdef, proconfig, pg_get_function_result(oid)
--     from pg_proc where proname in ('my_blocked_riders','my_hidden_postcards');
--   -- t | {search_path=} | TABLE(...)  for both
--
--   select has_function_privilege('authenticated','public.my_blocked_riders()','execute'),   -- t
--          has_function_privilege('anon',         'public.my_blocked_riders()','execute'),   -- f
--          has_function_privilege('authenticated','public.my_hidden_postcards(timestamptz,int)','execute'),  -- t
--          has_function_privilege('anon',         'public.my_hidden_postcards(timestamptz,int)','execute');  -- f
--
-- 2. ** THE POLICIES THIS FILE RESTATES DID NOT MOVE. ** Capture before and
--    after; a restatement is a copy and a copy goes stale.
--
--   select tablename, md5(qual) from pg_policies
--    where schemaname='public' and tablename in ('postcards','profiles') and cmd='SELECT';
--
-- 3. ** NO POLICY, CHECK, TRIGGER OR GRANT CHANGED BY THIS FILE. ** The counts
--    are pinned in rls_test.sql 105.14 rather than here, because a number in a
--    comment is not a gate.
--
-- 4. Advisors: THIRTY-SEVEN before this file, THIRTY-NINE after — exactly two
--    new `authenticated_security_definer_function_executable` WARNs, one per
--    function. Derived rather than trusted:
--
--      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.prosecdef
--         and has_function_privilege('authenticated', p.oid, 'execute');
--      -- 34 before, 36 after
--
--    34 + 2 rls_enabled_no_policy INFOs + 1 auth_leaked_password_protection is
--    the documented 37. NO new rls_enabled_no_policy INFO: this file creates
--    no table. A third new advisor of any kind means something landed here
--    that this file did not intend.
