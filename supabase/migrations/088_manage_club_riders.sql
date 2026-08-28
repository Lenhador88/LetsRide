-- 088 — Manage riders: an admin can remove a rider, and a role nothing has
--       ever written becomes writable. PD-326.
-- ===========================================================================
--
-- `club_members.role` has carried `admin` since `001`'s CHECK and NOTHING has
-- ever written it. `019` made the column unforgeable from the client, `048`
-- narrowed the UPDATE grant to `(club_id, user_id, role)` and left it entirely
-- dead — because there is **no UPDATE policy on `club_members` at all**, which
-- is the fact `036` §7.6 leans on for *"nobody can promote an admin"*. So a
-- club has exactly one person who can act, and no way to remove anybody,
-- including a rider who has to be removed.
--
-- This file adds the two operations and adds NO policy. Both are narrow
-- `security definer` RPCs on `043`'s shape — `moderate_club_thread` and
-- `delete_owned_club` — because the alternative is a permanent widening:
--
--   * a `club_members` UPDATE policy would have to admit an admin writing
--     ANOTHER rider's row, and RLS cannot see which COLUMN changed, so the
--     same policy that permits a promotion permits rewriting `club_id` and
--     `user_id` — the three columns `048` grants together. `019`'s whole
--     lesson is that `role` is an authorization decision and a policy that
--     admits the row admits the decision.
--   * a `club_members` DELETE policy would have to admit deleting a row that
--     is not yours, which is the one thing `001`'s `auth.uid() = user_id` has
--     always said it does not.
--
-- `088.2` and `088.3` assert the two absences, because "we added an RPC
-- instead" is only true while nobody adds the policy as well.
--
-- ---------------------------------------------------------------------------
-- WHO MAY DO WHAT, AND THE ONE SENTENCE IT REDUCES TO
-- ---------------------------------------------------------------------------
-- Product owner, 2026-08-27: *"There is a 'Manage riders' section in the 3
-- dots, that allows admins to accept new riders, remove existing riders, or
-- promote riders to admins."* Admins remove, and admins promote. The negative
-- cases the sentence does not answer are decided here, and they all fall out
-- of one rule:
--
--   ** AN ADMIN MAY ACT ON MEMBERS. ONLY THE OWNER MAY ACT ON ADMINS. **
--
-- | Act                          | Owner | Admin | Member |
-- |------------------------------|-------|-------|--------|
-- | remove a `member`            | yes   | yes   | no     |
-- | remove an `admin`            | yes   | **no**| no     |
-- | remove the owner             | **no**| no    | no     |
-- | remove yourself              | **no**| **no**| no     |
-- | promote `member` -> `admin`  | yes   | yes   | no     |
-- | demote `admin` -> `member`   | yes   | **no**| no     |
-- | demote yourself (admin only) | n/a   | yes   | n/a    |
-- | write any role but those two | **no**| no    | no     |
--
-- The reasons, one per refusal, because a permission table with no reasons is
-- a table the next session edits:
--
--   * **An admin may not remove or demote another admin.** Removal is a
--     superset of demotion, so the two must agree or the weaker one is a
--     bypass of the stronger. One rogue or compromised admin would otherwise
--     be able to dismantle a club's entire leadership without its owner ever
--     acting — and `029`'s succession makes admin standing a claim on the club
--     itself (see below), so taking it away is the owner's call. The owner's
--     own sentence grants admins the two CONSTRUCTIVE acts (remove a rider,
--     promote a rider) and is silent on the destructive one; silence is not a
--     grant when the thing being granted is irreversible by the person losing
--     it.
--   * **Nobody removes or demotes the OWNER, including the owner.** Ownership
--     is `clubs.owner_id`, not a roster row; deleting the roster row would
--     leave the club owned by somebody who is not in it — a state
--     `enforce-creator-membership` treats as a defect — and would not transfer
--     anything. The way out of owning a club is `delete_owned_club` (`043`) or
--     `029`'s succession, and both are elsewhere on purpose.
--   * **Nobody removes THEMSELVES here.** Leaving is `001`'s own DELETE policy
--     and the client already draws it (`ClubOptionsMenu`'s `Leave club`). Two
--     paths to one outcome is two places for it to drift, and the removal path
--     carries an authority check that leaving must never require.
--   * **No role but `member` and `admin` is writable, and there is no ARGUMENT
--     with which to try.** `019` pins the only legitimate `owner` row to
--     `clubs.owner_id`; a second one would make `029`'s successor query pick
--     between two, which is exactly the "stray second owner row" its comment
--     sorts last to survive. §2 writes literals and takes no role parameter,
--     which is `085`'s "no input by which to attempt it" rather than a
--     whitelist somebody can widen.
--   * **An admin MAY step down.** It takes nothing from anybody else, and an
--     admin with no way out would have to leave the club entirely to shed the
--     role.
--
-- ---------------------------------------------------------------------------
-- `029`'S SUCCESSION BECOMES REACHABLE FOR THE FIRST TIME
-- ---------------------------------------------------------------------------
-- `private.transfer_owned_clubs` hands a deleting owner's club to *"its
-- longest-tenured remaining admin, else its longest-tenured remaining
-- member"*. Its own comment says the admin arm is *"correct and unreachable,
-- in that order"* — because nothing has ever written `admin`. This file makes
-- it reachable, so `088.9` exercises that arm end to end rather than leaving
-- the first real use of it to a rider deleting their account.
--
-- That is also the sharpest reason the promotion is an authorization decision
-- rather than a label: **promoting a rider puts them first in line to inherit
-- the club.**
--
-- ---------------------------------------------------------------------------
-- WHAT A REMOVED RIDER KEEPS, AND WHAT THEY LOSE
-- ---------------------------------------------------------------------------
-- Removal deletes exactly one `club_members` row and touches nothing else, so
-- the answer is entirely the existing cascades and audience predicates:
--
--   * **Their postcards stay in the club.** `postcards.club_id` is untouched
--     and there is no cascade from `club_members`, so the club keeps its
--     history — and the removed rider can no longer READ their own postcard
--     there, because `009`'s club audience arm is membership. That asymmetry
--     is deliberate and is the same one a rider who LEAVES already gets.
--   * **Their rides stay in the club.** `rides.club_id` is untouched; `017`'s
--     membership rule is on INSERT only. A ride they organised in the club
--     keeps running, and they keep organising it.
--   * **Their `ride_members` rows are untouched**, so they stay in the crew of
--     club rides they had already joined — the crew is the ride's, not the
--     club's.
--   * **Their `club_join_requests` row does not exist**, because an approval
--     deleted it (`085` §5). So a removed rider of a PRIVATE club may ask
--     again immediately, and a removed rider of a public one may simply
--     rejoin. **Removal is not a ban**, and this file deliberately does not
--     make it one: a ban is a different feature with a different table, and
--     blocking is what a club owner has today for a rider they want gone for
--     good.
--
-- **Removal is indistinguishable from leaving, to everybody including the
-- removed rider**, and there is no notification. That is not laziness in
-- either direction:
--
--   * a notification addressed to the removed rider carries the club as its
--     subject, and `036` §3's club conjunct resolves under the RECIPIENT's own
--     RLS — which, for a private club, they have just stopped satisfying. The
--     row would be written and never returned, which is exactly the trap
--     `085`'s decline hit (`085.26`, and `089` is where it is answered). A
--     notification that works for public clubs and silently does not for
--     private ones is worse than none.
--   * a notification to the rest of the club would publish a moderation
--     action to an audience that did not take it.
--
-- ---------------------------------------------------------------------------
-- ORDERING AND COST
-- ---------------------------------------------------------------------------
-- **Additive**, so it applies BEFORE the deploy that serves its screen — two
-- new functions, no policy, no column, no trigger. Nothing existing changes
-- behaviour, so an app that has not shipped yet simply never calls them.
--
-- `036`'s hand-exercise gate does NOT fire: this file hangs no trigger on any
-- write path. Nothing that a rider already does runs new code because of it.
--
-- **Three new `authenticated_security_definer_function_executable` advisors**,
-- one per published function, taking the total from 21 to 24. Expected, and
-- expected for the same reason `043`'s pair are: narrowness is the defence.
-- Each takes a CLUB and a RIDER and does exactly one thing to one row, each
-- re-checks the caller's authority in its own body — where it is load-bearing,
-- because `security definer` bypasses RLS — and each has ONE raise site, so a
-- caller learns nothing about a club or a membership that is not theirs to
-- act on.

-- ---------------------------------------------------------------------------
-- §1. Removing a rider
-- ---------------------------------------------------------------------------
-- Takes the club and the rider rather than a membership id, because
-- `club_members` has no id — its key is the pair — and because every caller
-- has both to hand from the roster it just drew.
create or replace function public.remove_club_member(
  target_club uuid,
  target_rider uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid       uuid := (select auth.uid());
  v_owner     uuid;
  v_role      text;
  v_is_admin  boolean;
begin
  if v_uid is null then
    raise exception 'remove_club_member requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- TWO reads and ONE raise site. "No such club", "not your club", "no such
  -- member", "that rider is the owner" and "you are an admin trying to remove
  -- an admin" all leave by the same door below, so a caller cannot use this
  -- function to learn who is in a club they may not read, or who is an admin
  -- of one.
  --
  -- **Two statements rather than one outer join, and that is not a style
  -- choice**: Postgres refuses `FOR UPDATE` on the nullable side of an outer
  -- join outright, so the obvious single `left join ... for update of m` is a
  -- runtime error rather than a slower query. The lock belongs on the
  -- membership row — it is what two admins acting at once race over, and
  -- taking it makes the second transaction re-read a row that is already gone.
  select c.owner_id into v_owner
    from public.clubs c where c.id = target_club;

  select m.role into v_role
    from public.club_members m
   where m.club_id = target_club
     and m.user_id = target_rider
     for update;

  v_is_admin := private.is_club_admin_for(v_uid, target_club);

  if v_owner is null                       -- no such club
     or v_role is null                     -- that rider is not in it
     or not v_is_admin                     -- the caller may not act here
     or target_rider = v_uid               -- leaving is 001's own DELETE policy
     or target_rider = v_owner             -- the owner is not removable
     or (v_role <> 'member' and v_uid <> v_owner)  -- only the owner touches an admin
  then
    raise exception 'no removable membership matches that club and rider'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.club_members m
   where m.club_id = target_club
     and m.user_id = target_rider;

  -- **Belt and braces, and named as such rather than left to look load-bearing.**
  -- No reachable state puts a `club_join_requests` row beside a membership
  -- today: an approval DELETES the row (085 §5), club_takes_join_requests
  -- excludes members so a member cannot insert one, and a declined row refuses
  -- a second ask by the unique key. The statement is here because it is one
  -- line and it makes "removal leaves no request state" true unconditionally
  -- rather than true by an argument three files long — and because if that
  -- argument ever stops holding, a surviving `pending` row would let a second
  -- admin undo this removal by approving it.
  delete from public.club_join_requests r
   where r.club_id = target_club
     and r.user_id = target_rider;
end;
$$;

revoke all on function public.remove_club_member(uuid, uuid) from public, anon;
grant execute on function public.remove_club_member(uuid, uuid) to authenticated;

comment on function public.remove_club_member(uuid, uuid) is
  'An owner or admin removes ONE rider from ONE club (088, PD-326). Deletes exactly one club_members row and touches nothing else — the rider''s postcards, rides and ride_members rows all stay, and they may rejoin or re-request immediately, because removal is not a ban. Only the OWNER may remove an admin; nobody removes the owner, and nobody removes themselves (leaving is 001''s own DELETE policy). ONE raise site, so a caller learns nothing about a club or a roster they may not read. security definer because club_members DELETE is auth.uid() = user_id and 088 deliberately adds no policy: a policy admitting an admin to delete somebody else''s row cannot be narrowed to the case this function checks.';

-- ---------------------------------------------------------------------------
-- §2. Promoting, and demoting
-- ---------------------------------------------------------------------------
-- ** TWO VERBS AND NO ROLE ARGUMENT, AND THAT IS THE WHOLE SHAPE. ** The
-- obvious single `set_club_member_role(club, rider, new_role text)` is smaller
-- and is wrong for this repo's own recorded reason: `019` made `admin`
-- claimable by no client, and `085` preserved that through a NEW write path by
-- giving it *"no input by which to attempt it"*. A role parameter is exactly
-- such an input — a whitelist in the body is a check, where an absent argument
-- is a property. So each function writes a LITERAL role and takes none.
--
-- The cost is honest and it is one advisor: three published functions rather
-- than two, 21 -> 24. It buys a shape where the only reachable role values are
-- the two spelled in these bodies.
create or replace function public.promote_club_member(
  target_club uuid,
  target_rider uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid   uuid := (select auth.uid());
  v_owner uuid;
  v_role  text;
begin
  if v_uid is null then
    raise exception 'promote_club_member requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- Two statements and one lock, for the reason `remove_club_member` states:
  -- `FOR UPDATE` is refused on the nullable side of an outer join.
  select c.owner_id into v_owner
    from public.clubs c where c.id = target_club;

  select m.role into v_role
    from public.club_members m
   where m.club_id = target_club
     and m.user_id = target_rider
     for update;

  if v_owner is null                       -- no such club
     or v_role is null                     -- that rider is not in it
     or v_role <> 'member'                 -- already an admin, or the owner row
     or target_rider = v_owner             -- 054's ownerless owner, whose row may say 'member'
     or not private.is_club_admin_for(v_uid, target_club)
  then
    raise exception 'no promotable membership matches that club and rider'
      using errcode = 'insufficient_privilege';
  end if;

  update public.club_members m
     set role = 'admin'
   where m.club_id = target_club
     and m.user_id = target_rider;
end;
$$;

-- ** THE ONE ARM AN ADMIN DOES NOT GET. ** Removal is a superset of demotion,
-- so the two must agree or the weaker one is a bypass of the stronger — and an
-- admin who could demote a peer could remove them in two steps, which would
-- make §1's refusal decorative.
create or replace function public.demote_club_admin(
  target_club uuid,
  target_rider uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid   uuid := (select auth.uid());
  v_owner uuid;
  v_role  text;
begin
  if v_uid is null then
    raise exception 'demote_club_admin requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  select c.owner_id into v_owner
    from public.clubs c where c.id = target_club;

  select m.role into v_role
    from public.club_members m
   where m.club_id = target_club
     and m.user_id = target_rider
     for update;

  if v_owner is null                       -- no such club
     or v_role is null                     -- that rider is not in it
     or v_role <> 'admin'                  -- nothing to take away
     or target_rider = v_owner             -- the owner's row is not a role to set
     -- The owner, or the admin stepping down themselves. Stepping down takes
     -- nothing from anybody else, and an admin with no way out would have to
     -- leave the club entirely to shed the role.
     or (v_uid <> v_owner and v_uid <> target_rider)
  then
    raise exception 'no demotable membership matches that club and rider'
      using errcode = 'insufficient_privilege';
  end if;

  update public.club_members m
     set role = 'member'
   where m.club_id = target_club
     and m.user_id = target_rider;
end;
$$;

revoke all on function public.promote_club_member(uuid, uuid) from public, anon;
grant execute on function public.promote_club_member(uuid, uuid) to authenticated;
revoke all on function public.demote_club_admin(uuid, uuid) from public, anon;
grant execute on function public.demote_club_admin(uuid, uuid) to authenticated;

comment on function public.promote_club_member(uuid, uuid) is
  'An owner or admin promotes ONE member of ONE club to admin (088, PD-326) — the product owner''s own sentence, 2026-08-27: "admins ... promote riders to admins". Writes the LITERAL role and takes NO role argument, preserving 019''s property that admin is claimable by no client by giving this path no input by which to attempt anything else. The target must currently be `member`, so this is never a way in and never a way to rewrite the owner''s row. ONE raise site. **The counter-argument is recorded rather than built**: 029''s succession orders `admin` ahead of every longer-tenured member, so promoting a rider puts them first in line to inherit the club — an owner-only gate is one conjunct away (v_uid <> v_owner) if the owner wants it.';
comment on function public.demote_club_admin(uuid, uuid) is
  'The OWNER takes admin away, or an admin steps down themselves (088, PD-326). No admin demotes a peer: removal is a superset of demotion, so an admin who could demote could remove in two steps and remove_club_member''s refusal would be decorative. Writes the literal `member` and takes no role argument, like its twin. ONE raise site, so "not an admin", "not in this club", "no such club" and "not yours to demote" are indistinguishable.';

-- ---------------------------------------------------------------------------
-- §3. Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'club_members';
--   -- 4, UNCHANGED: SELECT, INSERT, DELETE and nothing else. There is still
--   --    NO UPDATE policy, which is what 036 §7.6 relies on.
--
--   select polcmd, polname from pg_policy
--    where polrelid = 'public.club_members'::regclass order by polname;
--   -- no row with polcmd = 'w' (UPDATE) and no second 'd' (DELETE).
--
--   select proname, prosecdef from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and proname in ('remove_club_member', 'promote_club_member',
--                      'demote_club_admin');
--   -- three rows, all prosecdef = true.
--
--   select count(*) from pg_trigger where tgname = 'enforce_participation_gate'
--     and not tgisinternal;
--   -- 16 — UNCHANGED. This file adds no gate and no trigger of any kind.
--
--   -- Advisors: 24, up from 21, all three new ones
--   -- authenticated_security_definer_function_executable and all three expected.
