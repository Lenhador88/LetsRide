-- 103: creator membership becomes a property of the table. PD-103.
--
-- Additive. Three new `private` functions, three new triggers, one backfill.
-- ** No policy is created, dropped or rewritten here, and no grant on any
-- existing object moves. ** The visibility layer is not entered — that is a
-- deliberate property of this file and §Verification asserts it rather than
-- claiming it.
--
-- ---------------------------------------------------------------------------
-- The defect, and why the fix is a trigger rather than the RPC three comments
-- in this repo still name
-- ---------------------------------------------------------------------------
-- `createClub` and `createRide` each write TWO rows across two round trips with
-- no transaction between them, because PostgREST has none. Since the client
-- render migration (2026-08-06) both round trips run in the browser, so closing
-- the tab or losing signal between them leaves:
--
--   * a club with an `owner_id` and NO `club_members` row, or
--   * a ride whose `organizer_id` holds no `ride_members` row.
--
-- That state went from "reachable only on a Supabase error" to "reachable on
-- demand". The real gap is not the missing transaction — it is that NOTHING
-- ASSERTS THE INVARIANT. No CHECK, trigger or constraint anywhere says "a club
-- has an owner-membership row".
--
-- ** An RPC would bind only its callers. ** The publishable key ships in the
-- bundle and PostgREST accepts any rider's JWT, so `insert into clubs` stays
-- reachable whether or not an RPC exists — the orphan would be one hand-rolled
-- request away for ever, and the invariant would be a convention again, which is
-- the exact critique `019`'s header makes of `joinClub` leaning on a column
-- default. An `AFTER INSERT` trigger binds every writer: the browser, the seed,
-- a migration, `service_role`, and the account-deletion Edge Function.
--
-- ** Both seeding triggers therefore take NO `WHEN` clause. ** `022`'s shape,
-- not `023`'s. A `when (current_user = 'authenticated')` here would say "the
-- client must produce this row", when what this file means is "the table may not
-- contain a club without one". The delete guard in §4 is the opposite case and
-- does carry the clause — see there.
--
-- ---------------------------------------------------------------------------
-- Pre-flight — MEASURED 2026-09-03 on DEV (fpmrimzxadewsaiwpsel) with RLS
-- BYPASSED. RE-RUN AT APPLY TIME.
-- ---------------------------------------------------------------------------
-- ** Any of these counts taken as `authenticated` is a defect. ** `009`'s
-- `club_members` SELECT predicate drops rows in BOTH block directions, so a
-- healthy club whose only member is an owner the reader is blocked with reads
-- as an orphan. The invariant is a property of the TABLE and can never be
-- asserted from a query result — §D7 of the design, and the reason the
-- assertions in `rls_test.sql` `reset role` around every orphan count.
--
--                                                    DEV 2026-09-03
--   clubs total                                            17
--   clubs with no club_members row for owner_id              0
--     ... of those, private (reachable from no screen)       0
--   clubs whose owner row exists with role <> 'owner'        0
--   rides total                                             27
--   rides with no ride_members row for organizer_id          0
--     ... of those, still upcoming                           0
--   club_members rows with role = 'admin'                    0
--   private clubs                                            1
--   profiles                                                24
--
--   select
--     (select count(*) from public.clubs)                                  as clubs_total,
--     (select count(*) from public.clubs c where not exists
--        (select 1 from public.club_members m
--          where m.club_id = c.id and m.user_id = c.owner_id))             as orphan_clubs,
--     (select count(*) from public.clubs c where not c.is_public and not exists
--        (select 1 from public.club_members m
--          where m.club_id = c.id and m.user_id = c.owner_id))             as orphan_clubs_private,
--     (select count(*) from public.clubs c
--        join public.club_members m on m.club_id = c.id and m.user_id = c.owner_id
--       where m.role <> 'owner')                                           as wrong_role_owner_rows,
--     (select count(*) from public.rides)                                  as rides_total,
--     (select count(*) from public.rides r where not exists
--        (select 1 from public.ride_members m
--          where m.ride_id = r.id and m.user_id = r.organizer_id))         as orphan_rides,
--     (select count(*) from public.club_members where role = 'admin')      as admin_rows,
--     (select count(*) from public.clubs where not is_public)              as private_clubs;
--
-- ** Read the zeroes correctly. ** They say nobody has hit the window yet on a
-- dataset this size — not that the window is hard to hit. What they settle is
-- that §3's backfill has nothing to repair TODAY, so it ships as a guard for the
-- apply-time re-run rather than as the main event. The 2026-08-06 numbers this
-- change was proposed against (2 clubs / 3 rides) are superseded, not
-- corroborated: the database has grown by an order of magnitude since.
--
-- ** One consequence of a NON-ZERO count at apply time, named because it is
-- invisible in the SQL. ** §3's INSERTs fire `notify_club_joined` (099) and
-- `notify_ride_joined` (055/036). For a club whose owner is missing from a
-- roster that still holds other riders, backfilling the owner notifies each of
-- them that the owner "joined". At 0 orphans that is a no-op; at a non-zero
-- count it is a small burst of truthful-but-odd notifications, and it is
-- preferable to `alter table ... disable trigger`, which takes ACCESS EXCLUSIVE
-- on a live table to suppress a fan-out that reaches nobody today.
--
-- ---------------------------------------------------------------------------
-- Three Postgres behaviours, MEASURED on a scratch replay of the full chain
-- (PostgreSQL 16.13, 2026-09-03; CI runs 17) rather than recalled — `021` §3's style
-- ---------------------------------------------------------------------------
-- (a) ** An AFTER INSERT ROW trigger on `clubs` CAN see its own just-inserted
--     row. ** `select count(*) from public.clubs where id = new.id` returned 1
--     from inside the trigger body — the AFTER-row queue is drained after a
--     CommandCounterIncrement. Neither function below depends on it (both read
--     `NEW` and nothing else, which is §D1's point), but `019`'s INSERT policy
--     subquery would, so the observation is recorded rather than assumed.
--
-- (b) ** Inside a `security definer` function `current_user` is the function's
--     OWNER. ** The seeded insert logged `current_user = postgres`, so `023`'s
--     `enforce_participation_gate` — `before insert ... when (current_user =
--     'authenticated')` on both membership tables — DID NOT FIRE for it. That is
--     correct: the gate already fired on the `clubs` / `rides` insert that
--     caused this one, and an un-onboarded rider never reaches the trigger at
--     all. It is invisible in a positive test, which is `023` §2's own warning,
--     so `rls_test.sql` 103.8 states it from the other end: the un-onboarded
--     rider cannot create the parent, and holds no membership row afterwards.
--
-- (c) ** An RI CASCADE runs as the OWNER OF THE REFERENCING TABLE, not as the
--     deleting role — so a `when (current_user = 'authenticated')` guard NEVER
--     FIRES ON A CASCADE. ** `delete from rides` issued as `authenticated`
--     through the rides DELETE policy fired an unguarded BEFORE DELETE trigger
--     on `ride_members` with `current_user = postgres`, and the WHEN-guarded
--     twin fired zero times. `095` measured the same on PG17 for `clubs`.
--
--     ** This corrects `design.md` §D3 rule 3, which says that without the
--     parent-is-gone probe "an owner cannot delete their own club". ** They can:
--     the WHEN clause already excludes every cascade. Rule 3 stays as DEFENCE IN
--     DEPTH — it is what keeps the guard correct if the WHEN clause is ever
--     removed, which is `022`'s shape and the one somebody will reach for — and
--     it is labelled as such in §4 rather than as the thing that makes deletion
--     work.
--
-- ---------------------------------------------------------------------------
-- ** SEQUENCING: applying this file before the client change is DEPLOYED is an
-- instant outage of club AND ride creation. ** Read this before applying.
-- ---------------------------------------------------------------------------
--   1. deploy  actions: the second insert becomes
--              `upsert(..., { ignoreDuplicates: true })`   <- MUST BE LIVE FIRST
--   2. apply   103  (this file)
--   3. deploy  actions: the second insert and both compensating deletes removed
--   4. apply   104  019's dead owner arm removed
--
-- The bundle deployed before step 1 issues a PLAIN `.insert()` into
-- `club_members` for a row this file's trigger has already written. That raises
-- `23505`; the action's own compensating delete then removes the club it just
-- created; the rider sees "That club could not be created." on EVERY attempt.
-- Same shape for `createRide`. This is `021`'s header's deadlock, and `096` is
-- the same lesson in the other direction.
--
-- Step 1 is safe against BOTH databases: against today's, `upsert ...
-- ignoreDuplicates` on `(club_id, user_id)` behaves identically to the insert;
-- against this file's, it finds the trigger's row and does nothing. It is the
-- shape `joinClub` already uses. The reason usually given for it — "there is no
-- UPDATE grant on club_members" — is WRONG, and `019`'s §Verification block says
-- so: `authenticated` does hold the table-level UPDATE grant, and promotion is
-- blocked by the absent UPDATE POLICY, which filters to zero rows rather than
-- raising. `ignoreDuplicates` is still correct, for the better reason that an
-- on-conflict-update would silently affect nothing.
--
-- ** `036`'s hand-exercise gate FIRES on §4. ** That trigger hangs on a live
-- write path: every ordinary `setRideAttendance(rideId, null)` runs new code
-- inside the rider's own transaction from the moment this applies, and a raise
-- there takes that rider's RSVP-removal down with it. Exercise by hand on DEV
-- first, in a rolled-back transaction, as `authenticated`, with rows COUNTED.
-- §2 and §3 hang no trigger on an existing write path — `club_members` and
-- `ride_members` INSERT already carry `enforce_participation_gate` and a
-- notification fan-out, and this file adds to `clubs` and `rides` INSERT.
--
-- ---------------------------------------------------------------------------
-- Where the three functions live, and why it is NOT where the proposal says
-- ---------------------------------------------------------------------------
-- ** All three go in `private`. ** The proposal writes `public.` with a
-- `revoke all ... from public, anon, authenticated`; `095` set the convention
-- afterwards and it is strictly better, so this file follows `095`. Both add no
-- security-advisor finding, but `private` makes that STRUCTURAL — `005` grants
-- no USAGE on the schema to any client role and PostgREST publishes only
-- `public` — rather than dependent on a revoke surviving `apply_migration`'s
-- string round trip, which `021`'s footer records as a real failure mode. It is
-- also where `085`'s helpers, `036`'s fan-outs and `095`'s own guard live.
--
-- The revokes are issued anyway, belt and braces, and named by ROLE in
-- §Verification rather than proved by attempting a call: the RLS suite runs as
-- the table owner, for whom neither barrier exists — `031`'s lesson.
--
-- ** So the advisor count moves by ZERO. ** Three definer functions, none of
-- them in `public`, is `085`'s eight-private-functions-zero-advisors shape.
--
-- ---------------------------------------------------------------------------
-- What this file does NOT contain
-- ---------------------------------------------------------------------------
-- ** The CLUB-side delete guard. It SHIPPED in `095` (PD-194) on 2026-08-31 as
-- `private.protect_club_owner_membership()`, and it moved rather than being
-- dropped. ** That change decides what an owner leaving MEANS — a transfer to
-- the longest-standing other admin, a deletion when nobody else is on the
-- roster, or a refusal — so it owns the guard's exceptions. Re-adding it here
-- would be two files creating the same trigger. Only the RIDE side is this
-- file's, and it has no exceptions to wait for: `design.md` Q2 was answered
-- 2026-08-11 with a plain NO, and the asymmetry with the club side is
-- deliberate — a club outlives its owner and has a roster to inherit it, a ride
-- is one rider's plan on one date with nobody to hand it to.
--
-- Also absent, and each is somebody else's file: ownership transfer, an
-- invitation flow, a club-delete or ride-cancel screen, and `max_riders`
-- enforcement (`077` dropped it).

-- ===========================================================================
-- §1. The club seed
-- ===========================================================================
-- ** It takes no caller input at all. ** `new.id` and `new.owner_id` come from a
-- row the caller was already authorized to insert by the `clubs` INSERT policy
-- (`auth.uid() = owner_id`), so there is no argument, and therefore no id to
-- substitute: the negative case "called with somebody else's id" is
-- UNREPRESENTABLE rather than merely refused. That is `021` §3's standard.
--
-- ** `security definer`, and the reason is determinism rather than privilege. **
-- An invoker-rights version is correct for two DIFFERENT reasons in two
-- different cases — for `authenticated` because `019`'s WITH CHECK happens to
-- pass, and for the seed / a migration / `service_role` because table ownership
-- skips the check entirely — and the first of those depends on a policy subquery
-- seeing an uncommitted sibling row. Definer makes it one reason. It also means
-- `023`'s participation gate does not fire on this insert (measurement (b)),
-- which is correct and is asserted rather than assumed.
--
-- ** `joined_at` is `new.created_at`, not `now()`. ** `045` made
-- `clubs.created_at` server-owned, so the two are the same instant on the create
-- path and this only matters to §3's backfill — where `now()` would make every
-- repaired owner the NEWEST member of their own club and skew `032`'s
-- longest-tenured-remaining-member transfer for exactly the clubs most likely to
-- need it. Writing it the same way in both places is what keeps them diffable.
-- `048` revoked `joined_at` from `authenticated`'s INSERT grant; this function
-- runs as the owner, so it writes the column the client cannot.
--
-- ** A plain INSERT, no `on conflict`. ** An AFTER INSERT trigger fires only for
-- a row that did not exist, and `club_members` cascades from `clubs`, so a
-- conflict here would mean the primary key had been violated upstream. Swallowing
-- it with `do nothing` would hide that.
create or replace function private.establish_club_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.club_members (club_id, user_id, role, joined_at)
  values (new.id, new.owner_id, 'owner', new.created_at);
  return null;
end;
$$;

revoke all on function private.establish_club_owner_membership()
  from public, anon, authenticated, service_role;

comment on function private.establish_club_owner_membership() is
  'AFTER INSERT on clubs: writes the owner''s own roster row in the same statement as the club, so "a club whose owner_id holds no club_members row" has no representation rather than merely being unlikely (PD-103). A TRIGGER and not an RPC, because an RPC binds only its callers and `insert into clubs` stays reachable with the publishable key that already ships in the bundle. NO `WHEN` clause, deliberately — 022''s shape, not 023''s — so it binds the browser, the seed, a migration and service_role alike. Takes no argument, so there is no id to substitute. security definer for determinism rather than privilege, which also means 023''s participation gate does not fire for the row it writes: the gate already fired on the clubs insert that caused it. joined_at is the club''s created_at, matching the backfill so the two stay diffable.';

drop trigger if exists establish_club_owner_membership on public.clubs;
create trigger establish_club_owner_membership
  after insert on public.clubs
  for each row
  execute function private.establish_club_owner_membership();

-- ===========================================================================
-- §2. The ride seed
-- ===========================================================================
-- `'going'` rather than `'maybe'`: an organizer who has scheduled a ride has
-- said they are going. `ride_members` has an UPDATE policy (`102` re-issued it),
-- so they may move themselves to `maybe` afterwards — the invariant §4 protects
-- is PRESENCE, not status.
--
-- ** This is what makes `toRideListItem` and `getRideCrew` agree by
-- construction. ** The card already draws the organizer "on the ride by
-- construction" while the crew screen reads `ride_members` only, so today the
-- two disagree about an orphaned ride. `getRideCrew` is deliberately NOT taught
-- to synthesise an organizer row: that would be a second copy of the rule, free
-- to drift.
create or replace function private.establish_ride_organizer_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ride_members (ride_id, user_id, status, joined_at)
  values (new.id, new.organizer_id, 'going', new.created_at);
  return null;
end;
$$;

revoke all on function private.establish_ride_organizer_membership()
  from public, anon, authenticated, service_role;

comment on function private.establish_ride_organizer_membership() is
  'AFTER INSERT on rides: writes the organizer''s own crew row in the same statement as the ride (PD-103), status ''going''. Same shape and same reasoning as private.establish_club_owner_membership — no WHEN clause, no argument, security definer, joined_at from the parent''s created_at. This is what makes toRideListItem''s "the organizer leads the avatar row" and getRideCrew''s ride_members-only read agree BY CONSTRUCTION rather than by two copies of one rule, which is why getRideCrew is deliberately not changed.';

drop trigger if exists establish_ride_organizer_membership on public.rides;
create trigger establish_ride_organizer_membership
  after insert on public.rides
  for each row
  execute function private.establish_ride_organizer_membership();

-- ===========================================================================
-- §3. The backfill — BEFORE the guard, and AFTER the seeds
-- ===========================================================================
-- After the seeding triggers, which do not fire on rows that already exist, and
-- before §4's guard, so a pre-existing orphan cannot make the guard's first
-- evaluation inconsistent.
--
-- ** This deliberately differs from `023`'s no-backfill ruling, and the contrast
-- IS the argument. ** `023` refused to write `terms_accepted_at` because a
-- fabricated record of a person's ACT is worse than a missing one. An
-- owner-membership row records no act: it is DERIVED from `clubs.owner_id`,
-- which the same rider already wrote, and it is exactly the row `createClub`
-- intended to write and was interrupted before writing. Nothing is fabricated.
--
-- ** The UPDATE is not an afterthought. ** An owner who found their own orphaned
-- PUBLIC club on /clubs/explore and tapped "Join club" holds `role = 'member'`,
-- and `club_members` has NO UPDATE POLICY (`019` Q10), so no client action can
-- ever repair them. This statement is the only thing that can, and it must be an
-- UPDATE rather than an insert that finds a conflict.
--
-- ** It keys on `clubs.owner_id` and never on `club_members.role`. ** Those are
-- two answers to "who owns this club" and they are ALLOWED to disagree — `054`
-- exists because they did, `088`'s promote_club_member carries an explicit arm
-- for it, and PD-128 is the whole story. `owner_id` decides everywhere.
--
-- ** No status repair on the ride side, and that is not an omission. ** The ride
-- invariant is that the organizer's row EXISTS; `maybe` is how an organizer
-- expresses uncertainty and rewriting it to `going` would overwrite a rider's
-- own stated answer. §4 protects presence and this repairs presence.

insert into public.club_members (club_id, user_id, role, joined_at)
select c.id, c.owner_id, 'owner', c.created_at
  from public.clubs c
 where not exists (
   select 1 from public.club_members m
    where m.club_id = c.id and m.user_id = c.owner_id
 );

update public.club_members m
   set role = 'owner'
  from public.clubs c
 where c.id = m.club_id
   and m.user_id = c.owner_id
   and m.role <> 'owner';

insert into public.ride_members (ride_id, user_id, status, joined_at)
select r.id, r.organizer_id, 'going', r.created_at
  from public.rides r
 where not exists (
   select 1 from public.ride_members m
    where m.ride_id = r.id and m.user_id = r.organizer_id
 );

-- ===========================================================================
-- §4. The ride guard — an organizer cannot leave their own crew
-- ===========================================================================
-- Seeding closes the create window. It does nothing about the OTHER door:
-- `setRideAttendance(rideId, null)` issues `delete from ride_members where
-- user_id = auth.uid()`, and `ride_members` DELETE is `auth.uid() = user_id`
-- with no organizer exception. `RideAttendanceBar` hides the control behind
-- `!is_organizer` — a UI guard, which `CLAUDE.md` is unambiguous is not the
-- enforcement, since the actions are plain async functions in the browser.
--
-- ** THREE RULES, in the order the body evaluates them. **
--
--   1. REFUSE when `old.user_id` is the ride's `organizer_id`. `check_violation`
--      (23514), never `insufficient_privilege` — `023` §2's rule: 42501 is
--      indistinguishable from an ordinary RLS denial, and an assertion that
--      accepted "any error" would pass when the WRONG RULE fired.
--   2. `when (current_user = 'authenticated')` ON THE TRIGGER — `023`'s shape,
--      not `022`'s, and the OPPOSITE choice to §1 and §2 above. This is a rule
--      about what the CLIENT may do rather than an invariant about what the
--      table may contain, so a `security definer` caller passes straight through
--      it (measurement (b)) — which is what would let a future privileged path
--      remove an organizer, exactly as `095` §2's transfer passes through the
--      club-side twin. Copying `022`'s no-escape shape would make that
--      unimplementable without `disable trigger`.
--   3. ALLOW when the parent `rides` row is already gone. ** Defence in depth,
--      NOT the thing that keeps ride deletion working. ** Measurement (c): an RI
--      cascade runs as the referencing table's owner, so rule 2 already excludes
--      every cascade — from `rides` and from `profiles` alike. Rule 3 is what
--      keeps this guard correct if rule 2 is ever removed.
--
-- ** `security definer` is a CORRECTNESS REQUIREMENT for rule 3, not a
-- convention. ** Under invoker rights the parent probe runs beneath the caller's
-- RLS, so "the ride row is invisible to me" and "the ride row does not exist"
-- are the SAME EMPTY RESULT — and this guard's answer to the second is to PERMIT
-- THE DELETE. A guard that fails open must not be left to a coincidence of the
-- current policy set. No exploit is reachable today (every rider who can delete
-- a ride_members row is that row's own user_id, and `102` gave `ride_members`
-- SELECT an unconditional `user_id = auth.uid()` arm precisely so an own row
-- survives an invisible parent), but the property has to hold by construction.
-- That is the same hazard §D7 spends a section on for ASSERTIONS, and it would
-- be absurd to guard the tests against it and leave the guard itself to luck.
create or replace function private.protect_ride_organizer_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizer uuid;
begin
  select r.organizer_id into v_organizer
    from public.rides r
   where r.id = old.ride_id;

  -- Rule 3. Defence in depth; see the header.
  if v_organizer is null then
    return old;
  end if;

  -- Rule 1. The message may name the remedy: the caller is deleting their OWN
  -- row (the DELETE policy is `auth.uid() = user_id`) on a ride whose organizer
  -- they can already read, so nothing here is disclosed that they do not hold.
  --
  -- ** The substring `cannot leave its crew` IS A CONTRACT with
  -- `setRideAttendance`, which branches on it. ** It matches the MESSAGE and not
  -- the SQLSTATE alone, because `018`'s text bounds raise `23514` too and a
  -- code-only branch would report an overlong field as an organizer refusal —
  -- the same reason `createRide` matches `022`'s audience error by message.
  -- `095`'s club-side twin says `cannot leave its roster` and `leaveClub`
  -- matches that. ** Nothing in CI compares the two halves **, so `rls_test.sql`
  -- asserts the phrase directly: reword the rest freely, keep those four words.
  if old.user_id = v_organizer then
    raise exception 'a ride''s organizer cannot leave its crew; set your status to ''maybe'' instead, or delete the ride'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

revoke all on function private.protect_ride_organizer_membership()
  from public, anon, authenticated, service_role;

comment on function private.protect_ride_organizer_membership() is
  'BEFORE DELETE guard on ride_members: the organizer''s own crew row cannot be removed by a client, so "a ride whose organizer is not on its crew" has no representation (PD-103). The RIDE half of the invariant; the club half shipped in 095 as private.protect_club_owner_membership. Presence, NOT status — ride_members has an UPDATE policy and an organizer may still move to ''maybe'', which is design.md Q2''s answer (2026-08-11: an organizer may not leave). Keys on rides.organizer_id, never on ride_members.status. Raises check_violation, not insufficient_privilege, so an assertion cannot pass on the wrong rule firing. security definer is a CORRECTNESS requirement for the parent probe: under invoker rights "invisible to me" and "does not exist" are the same empty result and the guard would fail open. The WHEN clause on the trigger is what lets a definer caller through; RI cascades never reach it at all, because a cascade runs as the referencing table''s owner (measured on PG16, 2026-09-03; 095 measured the same on PG17).';

drop trigger if exists protect_ride_organizer_membership on public.ride_members;
create trigger protect_ride_organizer_membership
  before delete on public.ride_members
  for each row when (current_user = 'authenticated')
  execute function private.protect_ride_organizer_membership();

-- ===========================================================================
-- §Verification — run against each project after applying
-- ===========================================================================
--   -- The three functions, and proconfig WITH THE LITERAL QUOTES, which is how
--   -- Postgres stores `set search_path = ''`: matching on `search_path=` finds
--   -- nothing and reads as a pass.
--   select p.oid::regprocedure::text, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'private'
--      and p.proname in ('establish_club_owner_membership',
--                        'establish_ride_organizer_membership',
--                        'protect_ride_organizer_membership');
--                    -- three rows, prosecdef t, proconfig {"search_path=\"\""}
--
--   -- Privileges BY ROLE, never by attempting the call — 031 exists because 029
--   -- shipped a function nothing could call and the suite, which runs as the
--   -- table owner, did not notice.
--   select has_function_privilege('authenticated',
--            'private.establish_club_owner_membership()', 'execute'),        -- f
--          has_function_privilege('authenticated',
--            'private.establish_ride_organizer_membership()', 'execute'),    -- f
--          has_function_privilege('authenticated',
--            'private.protect_ride_organizer_membership()', 'execute'),      -- f
--          has_function_privilege('anon',
--            'private.protect_ride_organizer_membership()', 'execute'),      -- f
--          has_function_privilege('service_role',
--            'private.protect_ride_organizer_membership()', 'execute');      -- f
--
--   -- The three triggers. Read the BITS, not the number: for the guard, 11 =
--   -- ROW(1) | BEFORE(2) | DELETE(8); 9 is the same trigger AFTER rather than
--   -- BEFORE, which returns `old` too late to refuse anything. For the two
--   -- seeds, 5 = ROW(1) | INSERT(4) — AFTER is the absence of bit 2.
--   select c.relname, t.tgname, t.tgtype, pg_get_expr(t.tgqual, t.tgrelid)
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where not t.tgisinternal
--      and t.tgname in ('establish_club_owner_membership',
--                       'establish_ride_organizer_membership',
--                       'protect_ride_organizer_membership');
--     -- 3 rows:
--     --   clubs         establish_club_owner_membership      5   (null)
--     --   rides         establish_ride_organizer_membership  5   (null)
--     --   ride_members  protect_ride_organizer_membership   11   CURRENT_USER = 'authenticated'
--     -- The two NULL qualifiers are the assertion: a WHEN clause on either seed
--     -- would exempt the seed and service_role from the invariant.
--
--   -- The invariant itself, RLS BYPASSED. Under `authenticated` these undercount
--   -- by exactly the rows the runner is blocked from — design.md §D7.
--   select count(*) from public.clubs c
--    where not exists (select 1 from public.club_members m
--                       where m.club_id = c.id and m.user_id = c.owner_id);    -- 0
--   select count(*) from public.clubs c
--     join public.club_members m on m.club_id = c.id and m.user_id = c.owner_id
--    where m.role <> 'owner';                                                  -- 0
--   select count(*) from public.rides r
--    where not exists (select 1 from public.ride_members m
--                       where m.ride_id = r.id and m.user_id = r.organizer_id); -- 0
--
--   -- Nothing moved in the visibility layer. SORTED COMMAND LIST, never a count
--   -- — 015's trap: a count of 3 also passes for a set that swapped DELETE for
--   -- UPDATE.
--   select tablename, string_agg(cmd, ',' order by cmd) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('clubs','club_members','rides','ride_members')
--    group by tablename;
--     --   club_members  DELETE,INSERT,SELECT        (3, and NOT four — 019 Q10)
--     --   clubs         DELETE,INSERT,SELECT,UPDATE
--     --   ride_members  DELETE,INSERT,SELECT,UPDATE
--     --   rides         DELETE,INSERT,SELECT,UPDATE
--   select count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('clubs','club_members','rides','ride_members')
--      and roles::text[] <> array['authenticated'];                            -- 0
--
--   -- Advisors: the pre-flight count + 0. All three functions are in `private`,
--   -- which 005 grants no client role USAGE on and PostgREST does not publish,
--   -- so authenticated_security_definer_function_executable cannot fire for
--   -- them. A new finding means one went into the wrong schema.
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'execute');
--
-- ===========================================================================
-- §Rollback
-- ===========================================================================
--   drop trigger protect_ride_organizer_membership on public.ride_members;
--   drop trigger establish_ride_organizer_membership on public.rides;
--   drop trigger establish_club_owner_membership on public.clubs;
--   drop function private.protect_ride_organizer_membership();
--   drop function private.establish_ride_organizer_membership();
--   drop function private.establish_club_owner_membership();
-- ** The backfill is NOT rolled back and cannot be. ** It wrote rows that are
-- indistinguishable from the ones createClub and createRide would have written,
-- which is the whole of §3's argument; there is no marker to select on and
-- nothing would be gained by inventing one. Every other object above is dropped
-- clean — no policy, no grant on an existing object, no column moved.
