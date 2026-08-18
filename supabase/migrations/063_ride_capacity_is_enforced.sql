-- 063: `max_riders` finally caps a crew.
--
-- Linear PD-174. The proposal is openspec/changes/enforce-ride-capacity/.
--
-- The column has existed since `001` and nothing has ever counted against it.
-- `018` added `rides_max_riders_range` — 1..999 or NULL — and its own header is
-- explicit that it "bounds what can be *stored*, and nothing else". So an
-- organizer could set a cap of 5 and get 50, and the number they typed was a
-- promise the database did not keep. `018`'s statement stays true of `018`;
-- this file is what makes it stale.
--
-- ---------------------------------------------------------------------------
-- What is enforced, exactly — a JOIN GATE, not an invariant
-- ---------------------------------------------------------------------------
-- The rule is **"you may not take a new seat on a ride whose crew already
-- fills its cap"**. It is deliberately NOT "crew size <= max_riders at all
-- times", and the difference is the whole design:
--
--   * An organizer may lower the cap below the current crew size. Nobody is
--     evicted, the existing rows stand, and the effect is that no further rider
--     can join until the crew drops back under the cap. An over-subscribed ride
--     is a LEGAL state — and therefore a state every rule below has to keep
--     working in, which is where the first version of this file got it wrong. The alternative — refusing the organizer's edit — takes
--     away the one action an organizer who has realised 20 is too many actually
--     wants, and silently deleting somebody's RSVP is worse than either.
--   * Nothing here is retroactive. No backfill, no eviction, no repair pass.
--   * `max_riders IS NULL` is "no cap", which is what every ride in both
--     projects carries today.
--
-- **The cap counts every `ride_members` row, `going` and `maybe` alike.**
-- "On this ride" already means exactly "holds a `ride_members` row of either
-- status" everywhere else in this schema — `private.is_ride_crew` (`034`), the
-- ride-chat audience, `036`/`055`/`060`'s fan-out, and `isRideCrew` in
-- src/lib/data/rides.ts. Counting only `going` would put a second definition of
-- "on this ride" in one schema, and it would add a trap: a rider switching
-- Going -> Maybe would silently surrender their seat to whoever asked next.
--
-- ---------------------------------------------------------------------------
-- Why a trigger, and why `security definer`
-- ---------------------------------------------------------------------------
-- A check-then-insert in `setRideAttendance` races two riders joining at once,
-- which is the defect rather than a lesser version of it — and CLAUDE.md's rule
-- is that no new integrity rule may live only in a Zod schema, because a rider
-- can simply not run your validation.
--
-- `security definer` is REQUIRED here and is not the usual convenience. `009`
-- put `private.is_blocked` on the `ride_members` SELECT policy itself, so a
-- roster read under the joining rider's own RLS is missing every crew member
-- that rider has blocked or been blocked by. Counted `security invoker`, the
-- cap would be exceeded by exactly the number of blocks in play — silently, and
-- worse the more the rider has blocked. The count has to see the true roster.
--
-- ---------------------------------------------------------------------------
-- The three traps this function is shaped around
-- ---------------------------------------------------------------------------
-- 1. **`setRideAttendance` writes through an UPSERT, and a BEFORE INSERT
--    trigger fires on an upsert even when it resolves to an UPDATE.** Measured
--    on Postgres 16: `insert ... on conflict do update` on an existing key
--    fires BEFORE INSERT and then BEFORE UPDATE. So a rider ALREADY on the crew
--    changing Going -> Maybe goes through the count, and a full ride would
--    freeze its own members' RSVPs — a worse bug than the one this file fixes.
--    An EXISTS exemption is what answers it; the body says why the obvious
--    narrower fix does not.
--
-- 1b. **The organizer is on their own ride with or without a row**, so their
--    row records a fact rather than claiming a seat and is exempt too. Both
--    exemptions are in the body with their reasoning.
--
-- 2. **UPDATE, not just INSERT.** `048` grants `authenticated` UPDATE on
--    `(ride_id, user_id, status)` — `ride_id` is in the grant because
--    PostgREST's `ON CONFLICT DO UPDATE` SET list carries every payload column
--    including both conflict columns. So `update ride_members set ride_id =
--    <a full ride>` moves a seat, and an INSERT-only trigger is one statement
--    away from being bypassed. A status-only change takes no new seat and must
--    NOT be refused, which is the early return below.
--
--    The guard is inside the function rather than `before insert or update of
--    ride_id` on purpose: `update of <col>` fires whenever the column is NAMED
--    in the SET list, unchanged or not, and PostgREST names `ride_id` on every
--    single RSVP. The column-scoped form would buy nothing and hide the intent.
--
-- 3. **Two riders taking the last seat at the same instant.** A count in a
--    BEFORE trigger is not serialised by itself: two concurrent transactions
--    each see `cap - 1` and both land — measured, and the crew ends at 3 on a
--    cap of 2. A `for no key update` on the parent `rides` row is what makes
--    the last seat singular; the body says why it is that lock mode and not
--    `for update`.
--
-- **The unlocked read in front of it is a fast path, not a second check.**
-- Most rides carry no cap — measured 2026-08-18, DEV has 2 capped rides of 6
-- and PROD 1 of 2 — so a locking read on every RSVP would serialise the app's
-- most common write, and contend with `updateRide` on the same row, for a rule
-- that applies to a minority of rides. Uncapped rides return before taking any
-- lock. The race it admits is benign
-- and already legal: an organizer setting a cap while a rider is mid-join gets
-- an over-subscribed ride by one, which is the same state lowering a cap
-- produces on purpose.
--
-- ---------------------------------------------------------------------------
-- No `when (current_user = 'authenticated')`, unlike `023`
-- ---------------------------------------------------------------------------
-- The participation gate is a rule about CLIENTS — a service role has no
-- onboarding to complete — so `023` scopes its triggers to the client role.
-- Capacity is an integrity rule about the ride, so it binds every writer,
-- including the owner and `service_role`. Nothing in the repo writes
-- `ride_members` as either: no Edge Function touches the table, and every
-- seeded ride in `supabase/tests/seed.sql` carries a NULL cap, so the seed and
-- the RLS suite's own fixtures are unaffected.
--
-- It also makes the assertions honest. The RLS suite runs as the table owner,
-- for whom neither RLS nor a role-scoped trigger applies — the `031` lesson —
-- so a role-scoped capacity trigger would be asserted only in the arms that
-- remember to `set role authenticated`.
--
-- **Trigger firing order.** Postgres fires same-timing row triggers in name
-- order, so `enforce_participation_gate` runs before `enforce_ride_capacity`.
-- That is the right way round: an un-onboarded rider is told to finish
-- onboarding, not that the ride is full.
--
-- ---------------------------------------------------------------------------
-- Before applying: hand-exercise the write paths
-- ---------------------------------------------------------------------------
-- CLAUDE.md §Supabase Rules — this hangs a trigger off an already-shipped write
-- path, so from the moment it applies every RSVP, every join and every ride
-- creation runs new code inside the rider's own transaction, and a trigger that
-- raises takes that rider's write down with it. Exercise a join, a repeat RSVP,
-- a leave and a ride creation on DEV inside a rolled-back transaction first.
-- `openspec/changes/enforce-ride-capacity/tasks.md` carries the statements.

-- ---------------------------------------------------------------------------
-- §1. The function
-- ---------------------------------------------------------------------------

create or replace function private.enforce_ride_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap   int;
  taken int;
  host  uuid;
begin
  -- A status change takes no new seat. This is the whole of the going <-> maybe
  -- path, and it is also what keeps a repeat RSVP on a full ride working.
  if tg_op = 'UPDATE' and new.ride_id is not distinct from old.ride_id then
    return new;
  end if;

  -- Fast path, unlocked — see the header. NULL here is either "no cap" or "no
  -- such ride"; both correctly fall through, and the FK is what reports the
  -- second, with a better message than this function could raise.
  select r.max_riders, r.organizer_id into cap, host
    from public.rides r
   where r.id = new.ride_id;

  if cap is null then
    return new;
  end if;

  -- **Trap 1: a rider who ALREADY HOLDS A SEAT takes no new one.** This is the
  -- exemption, and the shape it has to have. `setRideAttendance` upserts, and a
  -- BEFORE INSERT trigger fires on an upsert even when it resolves to an UPDATE
  -- (measured, Postgres 16) — so without this, an existing member changing
  -- Going -> Maybe is put through the count. On a ride exactly at its cap the
  -- narrower fix of excluding `new.user_id` from that count is enough; on an
  -- OVER-SUBSCRIBED one — the state the join gate deliberately allows, and
  -- reached by lowering a cap — it is not: 4 rows against a cap of 2 counts 3
  -- others and refuses. A full ride would freeze its own members' RSVPs, which
  -- is a worse bug than the one this file fixes.
  --
  -- Note the bare `update ride_members set status = …` form passes either way,
  -- because it takes the early return above. **An assertion written in that
  -- shape is vacuous here** — the suite exercises the upsert, and against an
  -- over-subscribed ride.
  if exists (select 1 from public.ride_members m
              where m.ride_id = new.ride_id
                and m.user_id = new.user_id) then
    return new;
  end if;

  -- **Trap 2: the organizer is on their own ride by construction**, with or
  -- without a row — `getRide` and `toRideListItem` both render a host holding
  -- no `ride_members` row as `going`. Their row RECORDS that fact rather than
  -- claiming a seat, so refusing it would leave the app showing an organizer on
  -- a ride the database will not let them onto. Reachable today: `createRide`'s
  -- two inserts have no transaction and its rollback runs in the browser, so a
  -- closed tab leaves exactly this state, and `enforce-creator-membership`'s
  -- atomic create would hit it too.
  --
  -- The cost is bounded at one row over the cap, and only when the organizer's
  -- row is written last — which `createRide` never does.
  if new.user_id = host then
    return new;
  end if;

  -- Authoritative, and the lock that makes the last seat singular. Re-read
  -- rather than trusting the value above: an organizer may have cleared the cap
  -- between the two, and this is the read that is serialised against every
  -- other joiner.
  --
  -- **`for no key update`, not `for update`.** Every FK pointing at this ride —
  -- `ride_messages`, `postcards.ride_id`, `ride_map_render_attempts`,
  -- `notifications` — takes `FOR KEY SHARE` on the parent row when a child row
  -- is written. `FOR UPDATE` conflicts with that; `FOR NO KEY UPDATE` conflicts
  -- only with itself, which is exactly the serialisation wanted and nothing
  -- else. Measured, because the difference reads as a nicety and is not: with a
  -- join in flight on a ride, a concurrent `ride_messages` insert on the SAME
  -- ride took **2455 ms** under `for update` and **54 ms** under `for no key
  -- update`. The race is still closed either way — two concurrent joins for the
  -- last seat of a cap-2 ride leave a crew of 2 under both, and a crew of 3
  -- under no lock at all.
  select r.max_riders into cap
    from public.rides r
   where r.id = new.ride_id
     for no key update;

  if cap is null then
    return new;
  end if;

  -- No `<> new.user_id`: the exemption above has already established that this
  -- rider holds no row, so a plain count is both correct and honest about what
  -- it means.
  select count(*) into taken
    from public.ride_members m
   where m.ride_id = new.ride_id;

  if taken >= cap then
    -- `check_violation` rather than `insufficient_privilege`, for `023`'s
    -- reason: 42501 is indistinguishable from an ordinary RLS denial, so an
    -- assertion accepting it would pass when the wrong rule fired.
    --
    -- **The message is part of the contract.** `setRideAttendance` matches on
    -- the substring `this ride is full`, because `018`'s CHECKs raise the same
    -- SQLSTATE on this table's parent and a length violation must not be
    -- reported to a rider as a full ride. Changing this text changes the client.
    --
    -- **It carries no numbers, deliberately.** A BEFORE trigger runs ahead of
    -- the RLS `WITH CHECK`, so this raise reaches riders the INSERT policy was
    -- about to refuse — someone who left the private club, or whom the
    -- organizer blocked. They learn one bit (that ride is full) where they
    -- would otherwise have learned one bit (42501); `% of % seats are taken`
    -- would hand them the crew size and the cap of a ride they cannot see.
    raise exception 'this ride is full'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- **In `private`, like `notify_ride_joined` on this same table and unlike `023`'s
-- gate.** PostgREST routes only to `public`, so the schema is what keeps a
-- trigger function off the exposed API surface; the revoke below is the second
-- lock on the same door rather than the only one. A trigger needs no runtime
-- EXECUTE check — `notify_ride_joined` has fired for `authenticated` from
-- `private` since `055` — so nothing is lost by it.
revoke all on function private.enforce_ride_capacity() from public, anon, authenticated;

comment on function private.enforce_ride_capacity() is
  'Caps a ride crew at rides.max_riders (063, PD-174). A JOIN GATE, not an invariant: lowering a cap below the current crew evicts nobody and an over-subscribed ride is legal. Counts every ride_members row, going and maybe alike, because "on this ride" already means that everywhere else in this schema. security definer because 009 put private.is_blocked on the ride_members SELECT policy, so an invoker-rights count is short by the caller''s blocks. Two exemptions, both load-bearing: a rider who already holds a row takes no new seat (a BEFORE INSERT trigger fires on an upsert that resolves to an UPDATE, so without it a full or over-subscribed ride would freeze its own members'' RSVPs), and the ride''s organizer, who is on their own ride with or without a row. Takes for no key update — not for update — on the parent rides row so two riders cannot both take the last seat, without blocking the FK''s KEY SHARE on chat messages and postcards for the same ride.';

-- ---------------------------------------------------------------------------
-- §2. The trigger
-- ---------------------------------------------------------------------------

drop trigger if exists enforce_ride_capacity on public.ride_members;
create trigger enforce_ride_capacity
  before insert or update on public.ride_members
  for each row
  execute function private.enforce_ride_capacity();

comment on column public.rides.max_riders is
  'Crew cap, 1..999 or NULL for no cap (018 bounds the value). ENFORCED since 063 by private.enforce_ride_capacity() on ride_members — as a join gate rather than an invariant: an organizer may lower it below the current crew size, nobody is evicted, and no further rider may join until the crew drops back under it. Counts rows of BOTH statuses.';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The trigger exists, fires on both verbs, and carries no WHEN clause.
--
--   select tgname, pg_get_triggerdef(oid)
--     from pg_trigger
--    where tgrelid = 'public.ride_members'::regclass and not tgisinternal
--    order by tgname;
--   -- enforce_participation_gate ... BEFORE INSERT ... WHEN (CURRENT_USER = 'authenticated')
--   -- enforce_ride_capacity      ... BEFORE INSERT OR UPDATE ... (no WHEN)
--   -- notify_ride_joined         ... AFTER INSERT
--
-- 2. The function is definer and NOT executable by the client roles.
--
--   select n.nspname, p.prosecdef,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
--          has_function_privilege('anon',          p.oid, 'execute') as anon_exec
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where p.proname = 'enforce_ride_capacity';
--   -- private, t, f, f  — one row. A `public` row means it landed on the
--   -- PostgREST surface and the revoke is the only thing holding it.
--
-- 3. Nothing was evicted. Zero rows on both projects, before AND after —
--    measured 2026-08-18, no ride on either is over its cap (DEV: 1/20 and
--    2/20; PROD: one capped ride, under). A row here after applying would mean
--    this file changed something it was never meant to touch, since it is a
--    join gate and never retroactive.
--
--   select r.id, r.max_riders, count(m.*) as crew
--     from public.rides r join public.ride_members m on m.ride_id = r.id
--    where r.max_riders is not null
--    group by r.id, r.max_riders
--   having count(m.*) > r.max_riders;
--
-- 4. Advisors: this adds NO new WARN. The function is `security definer` and
--    lives in `private` with no client EXECUTE, so it is not an
--    `authenticated_security_definer_function_executable` — the same shape
--    `023`'s gate and `060`'s fan-out have, both likewise absent from that
--    advisor's eight. A ninth WARN means it landed in `public`.
