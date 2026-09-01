-- 095: An owner leaves their club. PD-194, closing PD-103's club-side half.
--
-- Additive. One new published function, two new `private` functions, one new
-- trigger. No new policy, no policy rewritten, no column added or dropped, no
-- grant changed on any existing object.
--
-- ---------------------------------------------------------------------------
-- The rule, decided by the product owner on 2026-08-31
-- ---------------------------------------------------------------------------
--   "194 an owner can only leave a club if there is at least one more admin
--    associated with it, or if it has no members."
--
-- and, for the club whose only member is its leaving owner: delete it, with a
-- confirmation.
--
--   Arm  Condition                                    Outcome
--   ---  -------------------------------------------  -------------------------
--    1   a club_members row with role='admin' and     the owner leaves and
--        user_id <> clubs.owner_id                    OWNERSHIP TRANSFERS to the
--                                                     longest-standing such
--                                                     admin (joined_at asc,
--                                                     tie-broken by user_id).
--                                                     One statement.
--    2   no club_members row for any rider other      the owner leaves, and
--        than the owner                               leaving DELETES the club,
--                                                     through 043/059's
--                                                     existing delete_owned_club
--                                                     and no second route
--    3   members exist, no other admin                REFUSED, naming the
--                                                     remedy: promote somebody
--                                                     to admin first (088)
--
-- ** This file performs arm 1 and NOTHING ELSE. ** Arms 2 and 3 are a raise.
-- The reason is not tidiness: a function that can delete a club is a function a
-- stale cache can aim at a club with members in it. The client decides which
-- affordance to draw from a roster count that is read under RLS, out of a cache
-- — so it can be stale, and it is ALWAYS A FLOOR, because `009`'s club_members
-- SELECT predicate drops rows in both block directions. Walk the disagreements:
--
--   client thinks arm 2, truth is arm 3 -> a do-everything function refuses.
--                                          Fails closed. Fine.
--   client thinks arm 2, truth is arm 1 -> it transfers instead of deleting.
--                                          Non-destructive. Fine.
--   client thinks arm 1 or 3, truth is  -> the rider taps a row saying "Leave
--   arm 2                                  club" and a club is DESTROYED, with
--                                          every postcard in it, on a tap that
--                                          promised nothing of the kind.
--
-- The last one is reachable from an ordinary stale cache with no blocking
-- involved. So deletion stays behind the existing DeleteClubSheet, which counts
-- what it would destroy, phrases every count as a floor, and takes a second
-- explicit confirmation. ** No call a rider makes as "leave" can delete a
-- club **, by construction rather than by care.
--
-- ---------------------------------------------------------------------------
-- Why this is an RPC and not a policy change — four barriers, in order
-- ---------------------------------------------------------------------------
-- All four re-measured on DEV 2026-08-31. The FIRST is the one anybody starting
-- at the policy misses, and it fails before any policy is evaluated:
--
--   1. `authenticated`'s UPDATE COLUMN GRANT on `clubs` is `avatar_path,
--      cover_image_path, description, is_public, latitude, location_name,
--      location_place_id, longitude, name` — and NOT `owner_id` (`045`, widened
--      by `066`). A client transfer fails `42501` on the grant.
--   2. `clubs` UPDATE carries `using (auth.uid() = owner_id)` AND `with check
--      (auth.uid() = owner_id)`, which is also what stops a rider dumping a club
--      on an unwilling stranger.
--   3. `club_members` has NO UPDATE POLICY AT ALL — three policies, SELECT,
--      INSERT, DELETE, and `036` §7.6 rests on the absence.
--   4. ** PostgREST has no transaction. ** A transfer is three writes across two
--      tables; done as three round trips it tears into a club whose `owner_id`
--      and whose roster disagree — which is precisely the disagreement PD-128
--      and `043` both had to reason around. One statement or nothing.
--
-- Widening any of the first three widens it for every other purpose too.
--
-- ** And a FIFTH thing fires on the HAPPY path. ** `016`'s
-- `clubs_avatar_path_owned` and `clubs_cover_image_path_owned` pin both image
-- paths to the row's CURRENT `owner_id`:
--
--   CHECK (avatar_path IS NULL OR avatar_path ~~ ('club-avatars/' || owner_id || '/%'))
--   CHECK (cover_image_path IS NULL OR cover_image_path ~~ ('club-covers/' || owner_id || '/%'))
--
-- so ANY `update clubs set owner_id` raises `23514` while either path is
-- non-null. §2 NULLs both in the SAME STATEMENT as the ownership move — row
-- CHECKs are evaluated at statement end — and returns the surrendered paths, so
-- the leaver's client can delete the bytes. They are the only client that can:
-- both objects sit under THEIR uid prefix, which is what those CHECKs pin.
-- `032` already does it this way and is the precedent rather than a
-- coincidence.
--
-- ---------------------------------------------------------------------------
-- Pre-flight — MEASURED 2026-08-31 with RLS BYPASSED, re-run at apply time
-- ---------------------------------------------------------------------------
-- ** Any of these counts taken under `authenticated` is a defect **, because
-- `club_members` SELECT drops rows in both block directions and every roster
-- number a client can hold is a floor.
--
--                                              DEV        PROD
--   clubs total / is_default                   12 / 1     1 / 1
--   clubs whose owner_id holds NO roster row     0          0
--   clubs with another rider at role='admin'     0          0     <- arm 1
--   clubs whose owner is the only member         9          0     <- arm 2
--   profiles                                    21          5
--   club_members rows with role='admin'          0          0
--   protect_club_owner_membership /
--     establish_club_owner_membership          absent     absent
--
--   select c.id, c.name, c.is_default,
--          (select count(*) from public.club_members m
--            where m.club_id = c.id and m.user_id <> c.owner_id)                     as other_members,
--          (select count(*) from public.club_members m
--            where m.club_id = c.id and m.user_id <> c.owner_id and m.role='admin')  as other_admins
--     from public.clubs c order by c.name;
--
-- Three things those settle:
--
--   * ** `enforce-creator-membership` has NOT shipped on either project. **
--     Neither of its function names exists. So this file cannot assume the
--     seeding trigger or the backfill, and every arm below has to behave
--     correctly for a club already in the ownerless state.
--   * ** Arm 1 is unexercised by real data on both projects. ** It ships
--     correct-and-unreachable, the way `029`'s admin arm did until `088`, so its
--     assertions in `rls_test.sql` are the only thing that will ever run it
--     before a rider does.
--   * ** PROD's only club is the welcome club, which §3 refuses. ** The first
--     production effect of this change is a REFUSAL, and the only rider it can
--     reach today is whoever owns that club. That belongs in the PR body rather
--     than reading as a shipped feature nobody can use.
--
-- The ownerless count is asserted rather than repaired: the repair is
-- `enforce-creator-membership`'s backfill and duplicating the same UPSERT in two
-- files is how they drift. 0 on both today, so it is a tripwire.
--
-- ---------------------------------------------------------------------------
-- Three Postgres behaviours, MEASURED on a scratch replay of the full chain
-- (Postgres 17, 2026-08-31) rather than recalled — `021` §3's style
-- ---------------------------------------------------------------------------
-- (a) ** `LockRows` sits BELOW `Limit`. ** `explain (costs off)` on §1's exact
--     select prints `Limit -> LockRows -> Sort -> Hash Join`. So `order by …
--     limit 1 for update of m, p` SKIPS a candidate that stops matching under a
--     concurrently-committed change rather than misreading it as "no successor".
--     `032` §3 measured this for `for update of p` alone; this adds a second
--     lock target and the shape is unchanged.
--
-- (b) ** Inside a `security definer` function `current_user` is the function's
--     OWNER. ** A DELETE on `club_members` issued from a definer body logged
--     `postgres`, and the `when (current_user = 'authenticated')` trigger below
--     did not fire at all. That is what lets §2's transfer delete the leaver's
--     roster row through its own guard.
--
-- (c) ** An RI CASCADE runs as the OWNER OF THE REFERENCING TABLE, not as the
--     deleting role — so the guard NEVER FIRES ON A CASCADE. ** Measured
--     directly: `delete from clubs` issued as `authenticated` through `clubs`'
--     own "Club owners can delete" policy fired a BEFORE DELETE trigger on
--     `club_members` twice with `current_user = postgres`, and the
--     WHEN-guarded twin fired zero times.
--
--     ** This corrects the change's `design.md` §D4, which states that without
--     rule 3 "an owner cannot delete their own club". ** They can: the WHEN
--     clause already excludes every cascade, from `clubs` and from `profiles`
--     alike, so club deletion and account deletion are untouched by this guard
--     whether or not rule 3 exists. Rule 3 is kept as DEFENCE IN DEPTH and is
--     labelled as such below rather than as the thing that makes deletion work —
--     it is what keeps the guard correct if the WHEN clause is ever removed, and
--     `022`'s no-escape shape is exactly the version that would need it.
--
-- ---------------------------------------------------------------------------
-- The trigger inventory, read off pg_trigger rather than remembered — and two
-- entries the design's own table does not carry
-- ---------------------------------------------------------------------------
--   clubs         enforce_participation_gate       BEFORE INSERT  ROW  WHEN
--   clubs         propagate_club_privacy_to_rides  AFTER  UPDATE  ROW
--   club_members  enforce_participation_gate       BEFORE INSERT  ROW  WHEN
--   club_members  notify_club_joined               AFTER  INSERT  ROW
--
-- ** There is still NO DELETE trigger on `club_members`, so §3's is the first
-- and there is no name-ordering interaction to reason about. ** And the
-- participation gate is INSERT ONLY on both tables, so §2's UPDATEs do not fire
-- it — the WHEN clause is the second reason, not the first.
--
-- ** `propagate_club_privacy_to_rides` DOES fire on §2's `update clubs`, and the
-- change's `design.md` trigger table omits it. ** It is a no-op here, and that
-- is read off its body rather than assumed: `if old.is_public and not
-- new.is_public then …` — the transfer does not touch `is_public`, so the
-- branch is not taken and no ride changes. Named because `036`'s gate is about
-- exactly this class of surprise, and because "the transfer fires no trigger" is
-- a claim that is false as stated.
--
-- ** `092` adds a FOREIGN KEY INTO `club_members`, and the design's §D10 says
-- there is none. ** `club_join_waves (club_id, subject_user_id) REFERENCES
-- club_members (club_id, user_id) ON DELETE CASCADE`, and `club_join_waves`
-- carries an AFTER DELETE trigger, `retract_club_waved`. So deleting the
-- departing owner's roster row in §2 step 8 is NOT "exactly one row and nothing
-- follows it": it cascade-deletes every welcome wave addressed to them in that
-- club and runs a notification fan-out for each, inside the leaver's own
-- transaction. That chain is already live for every ordinary `leaveClub` the
-- moment `092` applies, so this file introduces it rather than creating it —
-- but it is the reason §7's hand-exercise counts rows on both tables rather
-- than only checking that the call returned.
--
-- ---------------------------------------------------------------------------
-- `036`'s hand-exercise gate FIRES, and this is the paragraph not to skim
-- ---------------------------------------------------------------------------
-- §3 hangs a trigger on a LIVE WRITE PATH. `leaveClub` runs today, and every
-- ordinary member leaving any club will execute new code inside their own
-- transaction from the moment this applies. ** A raise there takes that rider's
-- leave down with it. ** Exercise by hand on DEV first and again on PROD, in a
-- rolled-back transaction, as `authenticated`, with rows COUNTED rather than
-- assumed. `delete_owned_club`'s cascade is the second path to exercise.
--
-- ---------------------------------------------------------------------------
-- Ordering: additive against the shipped bundle, and it applies FIRST
-- ---------------------------------------------------------------------------
-- `069`'s footing, not `089`'s. The guard refuses nothing the deployed app does
-- — `ClubOptionsMenu` renders `Leave club` only in its `!isOwner` branch today —
-- and an older bundle never calls a function that did not exist. The reverse
-- order leaves a deployed `Leave club` row calling a function that does not
-- exist, which is `082`'s `PGRST202` with nothing red. ** Nothing here is
-- destructive, so the third step of additive-first/deploy/destructive-last is
-- absent by construction rather than skipped. **
--
-- ---------------------------------------------------------------------------
-- Security advisors: EXACTLY ONE new, and it is `public.leave_owned_club`
-- ---------------------------------------------------------------------------
-- `authenticated_security_definer_function_executable`, +1. The two `private`
-- functions add NONE — `005` grants no USAGE on `private` to any client role and
-- PostgREST publishes only `public`, which is `085`'s
-- eight-private-functions-zero-advisors shape and the reason the count moves by
-- the number of PUBLIC functions rather than of functions.
--
-- The published one is narrow on `043`'s and `088`'s stated terms: it takes a
-- CLUB AND NOTHING ELSE — no rider id, no successor id, no role argument — so a
-- successor cannot be proposed and `019`'s property that `admin` is claimable by
-- no client survives alongside its new corollary that `owner` is NAMEABLE by no
-- client. It re-checks ownership in its own body, where that check is the entire
-- access control, and it discloses one bit about a club the caller already owns.
--
-- ** The absolute count depends on what has applied. ** `092` and `093` are on
-- disk and applied to neither project; `093` alone adds six published definer
-- functions. So the claim is `before + 1`:
--
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'execute');
--
-- The gate-trigger count moves by ZERO here: §3's trigger is a DELETE guard with
-- its own name, and this file creates no table.

-- ===========================================================================
-- §1. The successor query
-- ===========================================================================
-- ** In `private`, so it adds no advisor — structurally, rather than dependent
-- on the revoke below surviving `apply_migration`'s string round trip **, which
-- `021`'s footer records as a real failure mode.
--
-- ** NOT shared with `private.transfer_owned_clubs`, and that declines an
-- instruction rather than overlooking one. ** `enforce-creator-membership`
-- §Q1 asks this change to extract `032`'s successor `select` into one shared
-- selector, on the ground that a second hand-written copy drifts and a club
-- would then inherit differently depending on why its owner left. That fear is
-- now the DECIDED behaviour: the two rules differ in candidate set, by product
-- decision.
--
--                     032 — the owner deletes      095 — the owner chooses
--                     their account                to leave
--   candidates        admin, ELSE ANY MEMBER       ** admin only **
--   nobody left       deletes the club silently    ** refuses **, and the rider
--                                                  is offered the delete sheet
--   departing row     DEMOTED to member            ** DELETED **
--
-- They differ because `032` has NOBODY TO ASK. An account deletion is
-- irreversible, it is already committing, and its alternative to a
-- member-successor is destroying every other member's postcards through the
-- `clubs -> postcards` cascade. A voluntary leave has a rider standing there who
-- can promote somebody, so it can afford to refuse. Unifying the two behind a
-- `boolean admins_only` would put a product decision inside a flag.
--
-- ** So: two functions, and what must never drift is ASSERTED rather than
-- extracted. ** That is the ORDERING, not the candidate set:
--
--   * the total CASE over the enum, so a stray second `role = 'owner'` row sorts
--     LAST instead of being picked at random. This function filters to
--     `role = 'admin'` and therefore needs only `joined_at, user_id` — the full
--     CASE is written anyway, so the two bodies stay diffable, which is the
--     whole of the answer to "extract, never copy";
--   * `joined_at` ascending, tie-broken by `user_id`. `user_id` is arbitrary and
--     that is the point: it is DETERMINISTIC, so two runs against the same
--     roster pick the same rider, and it is a rule SQL can evaluate rather than
--     one a client picks.
--
-- ** VOLATILE, and it must be. ** A `stable` or `immutable` function cannot
-- execute `SELECT … FOR UPDATE` at all — Postgres refuses it outright — so
-- marking this `stable` for tidiness turns every call into a runtime error.
create or replace function private.pick_club_admin_successor(
  target_club uuid,
  departing   uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_successor uuid;
begin
  -- TWO lock targets, and they are there for two different races.
  --   p  is `032`'s: a candidate whose own account deletion is committing
  --      concurrently is SKIPPED in favour of the next rather than misread as
  --      "no successor". Measured: LockRows sits below Limit.
  --   m  is new, and it is what `088`'s three RPCs race over — promote_club_member,
  --      demote_club_admin and remove_club_member all take `for update` on
  --      exactly that row. Without it a demotion committing between this select
  --      and the caller's `set role = 'owner'` would leave the club owned by a
  --      rider whose roster row says `member`.
  --
  -- Lock order is clubs -> club_members -> profiles throughout, which is the
  -- union of what already exists rather than a new convention: delete_owned_club
  -- locks `clubs` alone, `088`'s three lock a `club_members` row, `032` locks
  -- `clubs` then `profiles`. No existing function takes them the other way, so
  -- this introduces no cycle.
  select m.user_id into v_successor
    from public.club_members m
    join public.profiles p on p.id = m.user_id
   where m.club_id = target_club
     and m.user_id <> departing
     and m.role = 'admin'
   order by case m.role when 'admin' then 0 when 'member' then 1 else 2 end,
            m.joined_at,
            m.user_id
   limit 1
     for update of m, p;

  return v_successor;
end;
$$;

revoke all on function private.pick_club_admin_successor(uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function private.pick_club_admin_successor(uuid, uuid) is
  'Picks the rider a voluntarily-leaving owner hands their club to: the longest-standing OTHER admin, joined_at ascending, tie-broken by user_id, NULL when there is none. ** ADMIN-ONLY ON PURPOSE. ** private.transfer_owned_clubs (032) deliberately falls back to any member, because an account deletion has nobody to ask and its alternative is destroying the club and every postcard in it; a voluntary leave has a rider standing there who can promote somebody, so it refuses instead. The two bodies are kept diffable rather than merged — the full role CASE is written here even though the role filter makes it redundant — and rls_test.sql asserts they agree on a roster whose candidate sets coincide. ** Blocking does NOT filter the candidate set ** (095 §D9): a block is a relation between two riders and the leaver is leaving, and filtering would let any admin trap their owner by clicking Block. Volatile by necessity: FOR UPDATE is illegal in a non-volatile function.';

-- ===========================================================================
-- §2. The transfer — arm 1, and nothing else
-- ===========================================================================
-- Parameter named `p_club_id` to match `delete_owned_club`, whose sibling
-- constraints this function inherits, rather than `088`'s `target_club`.
-- `043`'s reason is unchanged: `club_id` is a column on five tables, so a
-- parameter of that name makes `where club_id = club_id` ambiguous.
-- `#variable_conflict error` and alias-qualified column references throughout,
-- `043`'s belt and braces for a function that can move a club.
--
-- Return shape `table (object_path text)`, byte-identical to
-- `delete_owned_club` and `private.transfer_owned_clubs`, so the client's
-- Storage sweep is literally the code `deleteClub` already runs.
--
-- ** FOUR raise sites, and only two of them may be distinguishable. **
--
--   1. no session                 insufficient_privilege
--   2. no such club / not yours   insufficient_privilege, message BYTE-IDENTICAL
--                                 to delete_owned_club's, so the two cannot
--                                 drift into two answers
--   3. the default club           insufficient_privilege, and the message MAY be
--                                 specific: `059` already settled that naming
--                                 this discloses nothing, `058` §2 having
--                                 granted SELECT on is_default
--   4. no successor               check_violation, ** ONE site covering arms 2
--                                 AND 3, with ONE message **
--
-- ** Site 4 must never be split into two clearer messages. ** If it said
-- "promote someone to admin first" for arm 3 and "this club has no members;
-- delete it" for arm 2, an owner blocked with their club's only member would be
-- told THAT A MEMBER EXISTS WHOM THEY CANNOT SEE — one bit about a person a
-- block is hiding, obtainable today by no other route. `088`'s three RPCs and
-- `delete_owned_club` all collapse to one raise site for exactly this reason.
-- The single message names both remedies and is true in either case.
--
-- `check_violation` rather than `insufficient_privilege` for site 4, `023` §2's
-- rule: `42501` is indistinguishable from an ordinary RLS denial, and it is what
-- lets the client tell "no successor" from "not your club" without the message.
create or replace function public.leave_owned_club(p_club_id uuid)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_uid       uuid := (select auth.uid());
  v_avatar    text;
  v_cover     text;
  v_default   boolean;
  v_successor uuid;
begin
  if v_uid is null then
    raise exception 'leave_owned_club requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- The ownership test is the function's OWN job: `security definer` runs the
  -- body with RLS bypassed, so `and c.owner_id = v_uid` is the entire access
  -- control and it is the line to read first in any future edit. The lock is on
  -- `clubs` and is taken before anything else — see §1's lock order.
  select c.avatar_path, c.cover_image_path, c.is_default
    into v_avatar, v_cover, v_default
    from public.clubs c
   where c.id = p_club_id
     and c.owner_id = v_uid
     for update;

  if not found then
    raise exception 'no club with that id is owned by the caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- `059` §3 records the shape exactly: after `058` every rider joins the
  -- welcome club, so it always has members and can never reach `032`'s
  -- "nobody left, delete it" arm — it TRANSFERS, to whichever rider joined
  -- earliest, who then satisfies delete_owned_club's whole access check. `059`
  -- added an is_default refusal there and could not fix the transfer itself,
  -- because `clubs.owner_id` is NOT NULL with a CASCADE FK and "do not
  -- transfer" is unavailable when the owner's account is being erased.
  --
  -- ** A voluntary leave has the option `059` did not: the owner can simply
  -- stay. ** So this refuses, and the welcome club becomes unleavable and
  -- undeletable by any rider by any route — the correct weight for the club
  -- every rider is in. Without this line, `059`'s known gap goes from
  -- "reachable only by an account deletion" to one tap in the club menu,
  -- silently.
  if v_default then
    raise exception 'the club carrying clubs.is_default cannot be left; unflagging it is a deliberate act that needs database access'
      using errcode = 'insufficient_privilege';
  end if;

  v_successor := private.pick_club_admin_successor(p_club_id, v_uid);

  if v_successor is null then
    raise exception 'this club has no other admin to take it on; promote another rider to admin, or delete the club'
      using errcode = 'check_violation';
  end if;

  -- Surrendered whether or not the caller manages to delete the bytes, so they
  -- are returned BEFORE the statement that clears them. Both sit under the
  -- LEAVER's uid prefix (016's CHECKs pin them there) and the leaver is the
  -- caller, so the caller's own Storage policy is the only one that permits the
  -- delete.
  if v_avatar is not null then
    object_path := v_avatar;
    return next;
  end if;
  if v_cover is not null then
    object_path := v_cover;
    return next;
  end if;

  -- ** ONE statement, and splitting it raises 23514 on the HAPPY path. **
  -- 016's two path CHECKs are row CHECKs evaluated at statement end and they
  -- pin both paths to the row's owner_id, so `set owner_id = v_successor` alone
  -- is refused whenever either image exists. 032 already writes it this way.
  update public.clubs c
     set owner_id         = v_successor,
         avatar_path      = null,
         cover_image_path = null
   where c.id = p_club_id;

  -- No client can write this value: `019`'s INSERT policy admits `role =
  -- 'member'` and an owner arm keyed on clubs.owner_id, `club_members` has no
  -- UPDATE policy at all, and this is an UPDATE inside a definer body. So
  -- `owner` remains nameable by no client, which is `019`'s property extended
  -- to the value `088` never had to write.
  update public.club_members m
     set role = 'owner'
   where m.club_id = p_club_id
     and m.user_id = v_successor;

  -- ** DELETED, not demoted, and this is the single most important divergence
  -- from `032`. ** That function demotes because its transfer commits before
  -- the rest of an account deletion runs, and a Storage 5xx in between must not
  -- eject a rider from a private club they can no longer rejoin. Here the rider
  -- is CHOOSING to leave, in one call that either commits whole or does not, so
  -- leaving them a `member` row would be leaving them in a club they asked to
  -- leave. Product owner, 2026-08-31, asked directly: leave means out. Copying
  -- `032` wholesale would ship exactly that bug.
  --
  -- ** Deleting ZERO rows is correct and SHALL NOT raise. ** `054`'s ownerless
  -- owner — a club whose owner_id holds no roster row — passes through this
  -- function unchanged: the ownership check above is on `clubs.owner_id` rather
  -- than on a roster row, the successor query sees the same candidates, and this
  -- is a no-op. An implementation that raised on "no row deleted" would leave
  -- that rider unable to leave at all.
  --
  -- §3's guard does not fire here: this function is `security definer`, so
  -- `current_user` is the owner and the trigger's WHEN clause is false
  -- (measured (b)). Belt and braces anyway — the statement above has already
  -- moved `owner_id` to the successor, so the guard's own predicate would not
  -- match this row even if it did fire.
  delete from public.club_members m
   where m.club_id = p_club_id
     and m.user_id = v_uid;

  return;
end;
$$;

revoke all    on function public.leave_owned_club(uuid) from public, anon;
grant execute on function public.leave_owned_club(uuid) to authenticated;

comment on function public.leave_owned_club(uuid) is
  'Arm 1 of PD-194 and nothing else: the calling owner hands their club to its longest-standing OTHER admin and their own roster row goes. Takes a CLUB and no rider id, so a successor cannot be proposed and `owner` stays nameable by no client. The ownership re-check in the body is the ENTIRE access control, RLS not applying inside a definer function. The leaver''s row is DELETED rather than demoted, which is where this diverges from 032 (that one demotes because its transfer commits mid-account-deletion and must survive a failure after it). Four raise sites: no session; no such club / not yours, whose message is byte-identical to delete_owned_club''s; the clubs.is_default club, which may be specific because 058 §2 granted SELECT on that column; and ** ONE site with ONE message for arms 2 and 3 together ** — splitting it would tell an owner blocked with their club''s only member that a member they cannot see exists. Returns the surrendered avatar and cover paths, because 016''s CHECKs force the transfer to clear both and only the leaver''s Storage policy reaches those bytes. Deleting a club is NOT reachable from here: that is delete_owned_club, behind a confirmation sheet that counts what it destroys.';

-- ===========================================================================
-- §3. The guard PD-103 owes — an owner-membership row has two legal exits
-- ===========================================================================
-- `enforce-creator-membership` covers four functions across two domains — seed
-- the creator's row on INSERT and refuse deleting it, for clubs and for rides.
-- PD-194 is exactly one cell of that table: the CLUB-SIDE OUT DOOR. It moves
-- here and nothing else does. That change is amended, not superseded: its
-- reasoning is why this guard is shaped the way it is, and the two have no
-- ordering constraint in either direction — this guard is silent for a club with
-- no owner-membership row (the state that change's seed exists to prevent), and
-- that change's seed and backfill are INSERTs a DELETE guard cannot interfere
-- with.
--
-- ** THREE RULES, and rule 3's status is the one this file corrects. **
--
--   1. REFUSE when `old.user_id` equals the club's `owner_id`. `check_violation`
--      (23514), never `insufficient_privilege` — `023` §2's rule, because 42501
--      is indistinguishable from an ordinary RLS denial and an assertion that
--      accepted "any error" would pass when the wrong rule fired.
--   2. `when (current_user = 'authenticated')` ON THE TRIGGER — `023`'s shape,
--      not `022`'s. This is a rule about what the CLIENT may do, not an
--      invariant about what the table may contain. It is what lets §2's definer
--      transfer through, and copying `022`'s no-escape shape would make this
--      change unimplementable without `disable trigger`.
--   3. ALLOW when the parent `clubs` row is already gone. ** Defence in depth,
--      NOT the thing that keeps club deletion working. ** Measurement (c) in the
--      header: an RI cascade runs as the owner of the referencing table, so rule
--      2 already excludes every cascade — from `clubs` and from `profiles` —
--      and club deletion and account deletion are untouched either way. Rule 3
--      is what keeps this guard correct if rule 2 is ever removed, which is the
--      shape `022` uses and the one somebody will reach for.
--
-- ** `security definer`, and for rule 3 that is a CORRECTNESS requirement
-- rather than a convention. ** Under invoker rights the parent probe runs
-- beneath the caller's RLS, so "the club row is invisible to me" and "the club
-- row does not exist" are the same empty result — and the guard's answer to the
-- second is to PERMIT THE DELETE. A guard that fails open must not be left to a
-- coincidence of the current policy set. No exploit is reachable today (every
-- rider who can delete a club_members row is that row's own user_id, and `054`'s
-- owner arm plus `009`'s roster predicate mean they can see the club), but the
-- property has to hold by construction.
--
-- ** It lives in `private`, where the drafted version put its equivalent in
-- `public` with a revoke. ** Both add no advisor; `private` makes that
-- STRUCTURAL — `005` grants no USAGE to any client role and PostgREST publishes
-- only `public` — rather than dependent on a revoke surviving a string round
-- trip. It is also where `085`'s eight helpers and `036`'s fan-outs live.
--
-- ** It keys on `clubs.owner_id`, NEVER on `club_members.role`. ** Those are two
-- different answers to "who owns this club" and they are ALLOWED TO DISAGREE:
-- `054` exists because they did, `088`'s promote_club_member carries an explicit
-- arm commented "054's ownerless owner, whose row may say 'member'", and PD-128
-- is the whole story. `owner_id` is what decides everywhere — clubs UPDATE and
-- DELETE, delete_owned_club, is_club_admin_for's first arm, and now this. `role`
-- is the roster's RENDERING of that fact and is allowed to lag. A role-keyed
-- guard would let an ownerless owner delete a row the invariant needs, and would
-- refuse a delete on a stale `owner` row for a club somebody else owns.
create or replace function private.protect_club_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select c.owner_id into v_owner
    from public.clubs c
   where c.id = old.club_id;

  -- Rule 3. Defence in depth; see the header.
  if v_owner is null then
    return old;
  end if;

  -- Rule 1. The message may name the remedy: the caller is deleting their OWN
  -- row (the DELETE policy is `auth.uid() = user_id`) for a club whose owner_id
  -- they can already read, so nothing here is disclosed that they do not hold.
  if old.user_id = v_owner then
    raise exception 'a club''s owner cannot leave its roster; hand the club on with public.leave_owned_club, or delete it with public.delete_owned_club'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

revoke all on function private.protect_club_owner_membership()
  from public, anon, authenticated, service_role;

comment on function private.protect_club_owner_membership() is
  'BEFORE DELETE guard on club_members: an owner-membership row has exactly TWO legal ways to disappear — public.leave_owned_club''s transfer (095) and the club going away — and every other route is refused by the database rather than by a component. The club-side half of PD-103''s invariant, moved here by PD-194. Keys on clubs.owner_id and NEVER on club_members.role: the two are permitted to disagree (054, PD-128, and 088''s ownerless-owner arm). Raises check_violation, not insufficient_privilege, so an assertion cannot pass on the wrong rule firing. security definer is a CORRECTNESS requirement for the parent probe: under invoker rights "invisible to me" and "does not exist" are the same empty result and the guard would fail open. The WHEN clause on the trigger is what lets the definer transfer through; RI cascades never reach it at all, because a cascade runs as the referencing table''s owner (measured on PG17, 2026-08-31).';

drop trigger if exists protect_club_owner_membership on public.club_members;
create trigger protect_club_owner_membership
  before delete on public.club_members
  for each row when (current_user = 'authenticated')
  execute function private.protect_club_owner_membership();

-- ===========================================================================
-- §Verification — run against each project after applying
-- ===========================================================================
--   -- the three functions, and proconfig WITH THE LITERAL QUOTES, which is how
--   -- Postgres stores it: matching on `search_path=` finds nothing and reads as
--   -- a pass.
--   select p.oid::regprocedure::text, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where (n.nspname, p.proname) in
--          (('public','leave_owned_club'), ('private','pick_club_admin_successor'),
--           ('private','protect_club_owner_membership'));
--                          -- three rows, prosecdef t, {"search_path=\"\""}
--   select prosrc like '%#variable_conflict error%'
--     from pg_proc where oid = 'public.leave_owned_club(uuid)'::regprocedure;  -- t
--
--   -- privileges BY ROLE, never by calling it as the table owner — 031 exists
--   -- because 029 shipped a function nothing could call and the suite, which
--   -- runs as the owner, did not notice.
--   select has_function_privilege('authenticated',
--            'public.leave_owned_club(uuid)', 'execute'),                      -- t
--          has_function_privilege('anon',
--            'public.leave_owned_club(uuid)', 'execute'),                      -- f
--          has_function_privilege('authenticated',
--            'private.pick_club_admin_successor(uuid,uuid)', 'execute'),       -- f
--          has_function_privilege('anon',
--            'private.pick_club_admin_successor(uuid,uuid)', 'execute'),       -- f
--          has_function_privilege('service_role',
--            'private.pick_club_admin_successor(uuid,uuid)', 'execute'),       -- f
--          has_function_privilege('service_role',
--            'private.protect_club_owner_membership()', 'execute');            -- f
--   -- PUBLIC's default =X/ grant is gone from the published one
--   select count(*) from pg_proc p, aclexplode(p.proacl) a
--    where p.oid = 'public.leave_owned_club(uuid)'::regprocedure
--      and a.grantee = 0;                                                      -- 0
--
--   -- nothing moved in the visibility layer. Sorted COMMAND LIST, never a count
--   -- — 015's trap: a count of 3 also passes for a set that swapped DELETE for
--   -- UPDATE.
--   select string_agg(cmd, ',' order by cmd) from pg_policies
--    where schemaname = 'public' and tablename = 'club_members';
--                                                    -- DELETE,INSERT,SELECT
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'clubs';                      -- 4
--
--   -- the trigger, and the gate count UNCHANGED (this file creates no table)
--   select count(*) from pg_trigger
--    where tgname = 'protect_club_owner_membership' and not tgisinternal;      -- 1
--   select tgtype, pg_get_expr(tgqual, tgrelid) from pg_trigger
--    where tgname = 'protect_club_owner_membership' and not tgisinternal;
--     -- 11 = ROW(1) | BEFORE(2) | DELETE(8), and CURRENT_USER = 'authenticated'.
--     -- Read the bits rather than the number: 9 is the same trigger AFTER
--     -- rather than BEFORE, which returns `old` too late to refuse anything.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--                                              -- the pre-flight count, + 0
--
--   -- advisors: the pre-flight count + 1, the one new finding being
--   -- authenticated_security_definer_function_executable on leave_owned_club.
--   -- A SECOND new one means a revoke did not land or a function went into the
--   -- wrong schema — 021's footer for why the file and the database can
--   -- silently disagree.
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'execute');
--
--   -- the tripwire this file asserts and declines to repair: no club is in the
--   -- ownerless state. 0 on both projects, 2026-08-31. A non-zero means
--   -- enforce-creator-membership's backfill has become urgent.
--   select count(*) from public.clubs c
--    where not exists (select 1 from public.club_members m
--                       where m.club_id = c.id and m.user_id = c.owner_id);    -- 0
--
-- ===========================================================================
-- §Rollback
-- ===========================================================================
--   drop trigger protect_club_owner_membership on public.club_members;
--   drop function private.protect_club_owner_membership();
--   drop function public.leave_owned_club(uuid);
--   drop function private.pick_club_admin_successor(uuid, uuid);
-- Nothing else moved — no policy, no grant on an existing object, no column —
-- so the rollback is complete rather than approximate.
