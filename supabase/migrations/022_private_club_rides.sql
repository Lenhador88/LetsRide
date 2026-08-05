-- 022: a private club's ride is not a public ride.
--
-- `rides.is_public` and `rides.club_id` are independently settable, so a ride
-- attached to a private club can carry `is_public = true`. The SELECT policy
-- then reads `is_public OR club member` and makes that ride — **and its crew,
-- through `ride_members`, whose policy delegates to `rides` by EXISTS** —
-- readable by every signed-in rider. `CreateRideForm` ships the public checkbox
-- `defaultChecked`, so the *default* path through the new create-ride screen
-- produces exactly this.
--
-- 017 closed the write half of the neighbouring hole (posting into a club you do
-- not belong to). This closes the audience half: belonging to the club is no
-- longer enough if the ride claims an audience the club does not have.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, re-measured against the hosted project 2026-08-05 at write time
-- ---------------------------------------------------------------------------
--   rides ..................................................... 3
--   rides with a non-NULL club_id ............................. 0
--   private clubs (is_public = false) ......................... 0
--   rides violating the rule (private club AND is_public) ..... 0
--
-- Zero, as the proposal measured earlier the same day — confirmed rather than
-- copied. **The window in which this is free is short**: `/rides/new` began
-- offering `club_id` on 2026-08-05, and the checkbox defaults to public, so the
-- first ride created in a private club would violate it.
--
--   select count(*) from public.rides r join public.clubs c on c.id = r.club_id
--    where c.is_public = false and r.is_public = true;
--
-- ---------------------------------------------------------------------------
-- Three parts, one per rule, and none of them is redundant
-- ---------------------------------------------------------------------------
--   §2  BEFORE INSERT OR UPDATE on `rides` — refuses the write outright. This is
--       "the database SHALL refuse a ride whose club_id names a private club
--       unless is_public is false".
--   §3  AFTER UPDATE on `clubs` — a club turning private takes its rides with
--       it, so a ride is never left behind carrying a stored flag its club
--       contradicts.
--   §4  The `rides` SELECT policy stops trusting `is_public` on its own. This is
--       the one that holds for a row that reached the table by some path §2 does
--       not cover, and it is what makes the crew unreachable, since
--       `ride_members` reads visibility through `rides`.
--
-- A CHECK constraint cannot do any of it: it cannot see another table. A policy
-- WITH CHECK could do §2 but binds `authenticated` only, and this is *validity*
-- rather than authorization — CLAUDE.md's line, and the reason §2 is a trigger
-- that binds everyone.

-- ---------------------------------------------------------------------------
-- §1. Is this club public?
-- ---------------------------------------------------------------------------
--
-- `security definer` for the same reason `private.is_club_member` is: the caller
-- may not be able to SELECT the club row (a rider posting into a private club
-- they belong to *can*, but a trigger must not depend on that), and a visibility
-- rule that varies with who is asking is not an integrity rule.
--
-- Fails closed: a club_id that resolves to nothing is treated as not public.
-- Unreachable through the foreign key, and the coalesce is what makes "the row
-- vanished mid-statement" refuse rather than permit.

create or replace function private.is_club_public(club uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.is_public from public.clubs c where c.id = club), false);
$$;

comment on function private.is_club_public(uuid) is
  'Is this club public? security definer so a trigger and a policy get the same answer regardless of who is asking (022). Lives in `private` so PostgREST does not publish it.';

revoke all on function private.is_club_public(uuid) from public, anon;
grant execute on function private.is_club_public(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- §2. The write is refused
-- ---------------------------------------------------------------------------
--
-- No `current_user <> 'authenticated'` escape hatch, unlike 012's consent guard.
-- That guard is a rule about what the *client* may write; this is an invariant
-- about what the table may contain, so it binds the seed, the migration role and
-- service_role alike. `alter table public.rides disable trigger` is the escape
-- if an operator ever genuinely needs one, and it is deliberately explicit.
--
-- ONE DELIBERATE CONSEQUENCE, recorded rather than left to be discovered — the
-- same shape 017 recorded for its own UPDATE arm. If a club turns private while
-- one of its rides somehow still carries `is_public = true`, the organizer
-- cannot edit that ride until the flag comes down, because the new row version
-- fails this check. §3 exists so that state does not arise in the first place;
-- this note covers the row that predates §3 or arrives around it. Nothing edits
-- rides today — there is no edit UI anywhere — so it costs nothing now.

-- `security definer`, and NOT for privilege — for name resolution. `private` has
-- no USAGE for `authenticated` by design (005 put the helpers there so PostgREST
-- cannot publish them; 009's footer asserts a direct call answers 42501
-- "permission denied for schema private"). An RLS policy may still call them
-- because a policy expression stores a resolved function OID and never does a
-- name lookup — only EXECUTE is checked at run time. **A plpgsql body is
-- different: it resolves `private.is_club_public` when it prepares the
-- expression, which checks schema USAGE and fails for every rider.** The whole
-- statement fails, not just the club arm, so an invoker-rights version breaks
-- creating a ride with no club at all — which is exactly how this was caught,
-- by 017's own "a ride with no club is unaffected" assertion turning red.
--
-- The alternative, granting `authenticated` USAGE on `private`, would undo 005's
-- design and the assertion 009 wrote to protect it. This is the narrow fix.

create or replace function public.enforce_ride_club_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.club_id is not null
     and new.is_public
     and not private.is_club_public(new.club_id) then
    raise exception 'a ride in a private club cannot be public'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_ride_club_audience() is
  'A ride may not claim a wider audience than the club it belongs to (022). check_violation rather than an RLS denial: this is validity, and the SQLSTATE is what lets an assertion tell it apart from a policy refusal. security definer for name resolution in `private`, not for privilege — see the note above its definition.';

-- It is a trigger function, so nothing should ever call it directly.
revoke all on function public.enforce_ride_club_audience() from public, anon, authenticated;

drop trigger if exists enforce_ride_club_audience on public.rides;

create trigger enforce_ride_club_audience
  before insert or update on public.rides
  for each row execute function public.enforce_ride_club_audience();

-- ---------------------------------------------------------------------------
-- §3. A club turning private takes its rides with it
-- ---------------------------------------------------------------------------
--
-- `security definer`, and that deserves its justification rather than the
-- keyword on its own. The club owner is not necessarily the organizer of every
-- ride in their club, and the `rides` UPDATE policy is `auth.uid() =
-- organizer_id` — so an invoker-rights version would silently update the subset
-- of rides the owner happens to organise and leave the rest exposed. A partial
-- fix to an exposure is worse than none, because it looks done.
--
-- What bounds it, in full:
--   - it only ever writes `is_public = false`, never true, so it can only narrow
--     visibility;
--   - it only touches rows with `club_id = new.id`;
--   - it only fires on a transition from public to private, which the caller was
--     already authorized to make — the `clubs` UPDATE policy is
--     `auth.uid() = owner_id`;
--   - it takes no arguments from the caller.
--
-- That is narrower than `moderate_comment`, which the security advisors already
-- accept and which 011 §1b argues at the same length.

create or replace function public.propagate_club_privacy_to_rides()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_public and not new.is_public then
    update public.rides
       set is_public = false
     where club_id = new.id
       and is_public;
  end if;

  return null;
end;
$$;

comment on function public.propagate_club_privacy_to_rides() is
  'When a club goes private its public rides go with it (022). security definer because the club owner does not organise every ride in their club and the rides UPDATE policy is organizer-scoped — an invoker-rights version would fix a subset and look finished.';

revoke all on function public.propagate_club_privacy_to_rides() from public, anon, authenticated;

drop trigger if exists propagate_club_privacy_to_rides on public.clubs;

create trigger propagate_club_privacy_to_rides
  after update of is_public on public.clubs
  for each row execute function public.propagate_club_privacy_to_rides();

-- ---------------------------------------------------------------------------
-- §4. `is_public` alone stops being enough to read a ride
-- ---------------------------------------------------------------------------
--
-- Every arm of 017's policy is preserved. The only change is that the
-- `is_public` arm now also requires the ride's club, if it has one, to be
-- public. Stated as the spec states it, role by role:
--
--   organizer .................... always, regardless of is_public or the club
--   club member .................. always, through the is_club_member arm
--   non-member, public + no club .. yes — decision #1 makes "public" mean
--                                   "any signed-in rider"
--   non-member, private club ...... zero rows, and its crew with it, because
--                                   ride_members reads visibility through rides
--   blocked rider ................. zero rows, unchanged
--   signed-out visitor ............ zero rows — `anon` holds no grant on rides
--
-- This is belt and braces beside §2 and §3 for a row written through them, and
-- it is the only protection for a row that was not — one predating this
-- migration, or one written by service_role. Visibility derived from the club is
-- strictly better than visibility stored on the ride, because there is nothing
-- to fall out of step.
--
-- Changes nothing on any screen today: 0 rides carry a club_id.

drop policy if exists "Rides are viewable by the club, organizer and signed-in riders" on public.rides;

create policy "Rides are viewable by the club, organizer and signed-in riders"
  on public.rides for select to authenticated
  using (
    organizer_id = auth.uid()
    or (
      not private.is_blocked(auth.uid(), organizer_id)
      and (
        (is_public and (club_id is null or private.is_club_public(club_id)))
        or (club_id is not null and private.is_club_member(club_id))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 4 — select, insert, update, delete, one each. 017's number, unmoved.
--   select count(*) from pg_policies where tablename = 'rides';
--
-- Expected: 0 — every rides policy is still `to authenticated`.
--   select count(*) from pg_policies
--    where tablename = 'rides' and roles::text[] <> array['authenticated'];
--
-- Expected: t — the SELECT policy no longer trusts is_public on its own, and
-- still carries both predicates it had before.
--   select qual like '%is_club_public%' and qual like '%is_blocked%'
--          and qual like '%is_club_member%'
--     from pg_policies where tablename = 'rides' and cmd = 'SELECT';
--
-- Expected: 2 — one trigger on rides, one on clubs.
--   select count(*) from pg_trigger
--    where tgname in ('enforce_ride_club_audience', 'propagate_club_privacy_to_rides')
--      and not tgisinternal;
--
-- Expected: f — private.is_club_public is not reachable by anon, and `private`
-- is not in PostgREST's exposed schemas at all.
--   select has_function_privilege('anon', 'private.is_club_public(uuid)', 'execute');
--
-- Expected: 0 rows, before and after — nothing violates.
--   select count(*) from public.rides r join public.clubs c on c.id = r.club_id
--    where c.is_public = false and r.is_public = true;
