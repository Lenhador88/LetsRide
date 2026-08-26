-- 080: a ride carries the zone its meeting point is in, and its wall-clock survives.
--
-- Linear PD-193. Decision A, taken by the product owner 2026-08-19 after the
-- comparison table on that issue; read that comment before this file, because it
-- is the argument and this is only the mechanism.
--
-- ---------------------------------------------------------------------------
-- The interim this closes
-- ---------------------------------------------------------------------------
-- `CLAUDE.md` §Technology Decisions has recorded ride times as pinned to
-- `APP_TIME_ZONE` (`Europe/Amsterdam`) and called that, verbatim, "a documented
-- interim" whose correct model is "wall-clock at the meeting point, which needs
-- a zone column on `rides`". This is that column.
--
-- What is wrong without it, concretely: an organizer in Lisbon creates a ride
-- starting 09:00. `wallClockToUtc` resolves that as 09:00 Amsterdam, and
-- `formatRideTime` draws it back in Amsterdam. Every rider — including the
-- organizer standing at the meeting point — sees 08:00 local. Nothing is broken
-- while every ride is in NL, which is why this has not bitten yet.
--
-- ---------------------------------------------------------------------------
-- THE INVARIANT, which is the whole file in one sentence
-- ---------------------------------------------------------------------------
--   ** The wall-clock the organizer typed is what is preserved. The zone is
--      what says which instant that wall-clock names. **
--
-- Everything below follows from it, and the second trigger arm exists because
-- the two halves of a ride's location do NOT arrive together:
--
--   * A PICKED ride knows its zone at INSERT — the client holds it from the
--     place search — so `wallClockToUtc` resolves against it at the only moment
--     that matters and no correction is ever needed.
--   * A TYPED ride does not, and cannot: the zone comes from the geocode, the
--     geocode needs the Geoapify key, the key exists only in
--     `resolve-ride-location`'s secret store, and that call is fire-and-forget
--     AFTER the insert by requirement (`specs/ride-map-tiles` refuses to put a
--     vendor call between Save and the redirect). So the zone lands seconds to
--     minutes late.
--
-- Without the second arm, the moment that late zone lands `formatRideTime`
-- starts drawing 08:00 for a ride the organizer typed as 09:00 — asynchronously,
-- on their own screen, after they saved. That is a NEW defect and it is worse
-- than the one being fixed, because today's error is at least uniform and
-- stable. The finding is on PD-193, 2026-08-19, and it is why the scope as
-- originally written was not built.
--
-- ---------------------------------------------------------------------------
-- Why the shift lives HERE and not in the Edge Function
-- ---------------------------------------------------------------------------
-- Four reasons, and the first is sufficient on its own:
--
-- 1. `AT TIME ZONE` is exact across a DST boundary and a TypeScript
--    reimplementation of it is not — `wallClockToUtc` needs two passes and a
--    documented answer for the two hours a year that are ambiguous or
--    nonexistent. One correct implementation beats two.
-- 2. It is ATOMIC with the zone write. A read-modify-write in the function
--    would race an organizer editing the departure time in the same seconds,
--    which is exactly the window the function runs in.
-- 3. `tsconfig.json` excludes `supabase/functions`, so nothing type-checks that
--    file; `deploy_edge_function` is on the deny list, so only the owner can
--    deploy it. `067` §4 is this repo's standing argument for the same choice:
--    a correctness rule living only there is one unreviewed deploy from being
--    gone, silently, in the direction that stores a plausible wrong value.
-- 4. The function is not the only writer that moves a zone. The CLIENT moves it
--    too — a rider picking a new place, or clearing a pick — and a rule in the
--    function would not cover those at all.
--
-- ---------------------------------------------------------------------------
-- The `departure_at` guard, which is what stops it firing on an ordinary edit
-- ---------------------------------------------------------------------------
-- The shift runs only when a statement changes `timezone` and leaves
-- `departure_at` ALONE. A statement that supplies both has already decided what
-- the instant is, and shifting it again would move a ride the rider just set.
--
-- That is not a heuristic, it is the two writers stated exactly:
--
--   * `resolve-ride-location` sends the zone and never touches `departure_at`.
--     -> shift.
--   * `updateRide` always sends `departure_at`, resolved against the zone the
--     edit form was RENDERING in. If the rider changed the time, or picked a
--     place in a different zone, the instant differs from the stored one and
--     the statement wins. If they touched neither, the instant is identical and
--     any zone change came from somewhere else — so the wall-clock is held.
--
-- ---------------------------------------------------------------------------
-- Why an unusable zone is stored as NULL rather than raised
-- ---------------------------------------------------------------------------
-- NULL is not a failure state here: the column's own contract is "NULL means we
-- do not know", and `APP_TIME_ZONE` is the documented fallback. A name this
-- server cannot resolve is a name we do not know, so refusing to store it is the
-- column keeping its contract rather than swallowing an error.
--
-- Raising was the alternative and it is worse in both directions. On the picked
-- path the write is the RIDER'S OWN INSERT, so a zone name Postgres does not
-- recognise would refuse to create their ride over a value they never saw. On
-- the typed path the raise reaches `resolve-ride-location`'s column write, which
-- handles a refusal by deleting both freshly uploaded tiles and returning
-- `column_write_refused` — so a perfectly good geocode would cost the rider
-- their map. Every other stage of that pipeline fails open; this one matches.
--
-- A CHECK cannot do this job at all: `pg_timezone_names` is a view over the
-- server's tz database and is not immutable, so it may not appear in a CHECK.
-- The bounded-length CHECK below is the part that IS immutable.
--
-- ** The read side is guarded separately and must be. ** `Intl` is the consumer
-- and ICU's zone table is not Postgres's; an invalid `timeZone` makes
-- `Intl.DateTimeFormat` throw a RangeError, which from a `formatRide*` helper
-- would take down every screen the ride appears on. `rideZone()` in
-- `src/lib/utils.ts` falls back to `APP_TIME_ZONE` for anything it cannot format
-- in, so a value that passed here and fails there degrades to today's behaviour
-- instead of to a blank screen. Neither guard makes the other redundant.
--
-- ---------------------------------------------------------------------------
-- Retention and reach
-- ---------------------------------------------------------------------------
-- An IANA zone name for a ride's meeting point. It is coarser than the
-- coordinate already stored beside it since `051`, and it is visible to exactly
-- the riders who can already read the ride row — `001`, `017` and `022` decide
-- that, and RLS is row-level, so a reader who gets the row gets every column
-- they hold a grant for. No new policy; see §5.

-- ---------------------------------------------------------------------------
-- §1. The column
-- ---------------------------------------------------------------------------
alter table public.rides add column timezone text;

-- Immutable, so it can be a CHECK. The longest name in the IANA database is
-- `America/Argentina/ComodRivadavia` at 32 characters; 64 is comfortably past
-- any real one and short enough that the column cannot become a text field.
--
-- ** It is UNREACHABLE through §2's trigger, and it is kept anyway. ** A BEFORE
-- row trigger runs before CHECK constraints are evaluated, and that trigger
-- normalises anything absent from `pg_timezone_names` to NULL — which is every
-- string over 64 characters. So no ordinary write can raise `23514` here.
--
-- What it is a floor under is the paths that skip user triggers:
-- `session_replication_role = replica`, which logical replication and some
-- restore paths set. `018` and `063` are this repo's worked examples of a
-- constraint that reads as live protection while protecting nothing, and the
-- difference is exactly this paragraph — `080.1` in the suite asserts BOTH
-- directions, including the refusal with the trigger disabled, so the layering
-- is a measured fact rather than a claim.
alter table public.rides
  add constraint rides_timezone_is_bounded
  check (timezone is null or char_length(timezone) between 1 and 64);

comment on column public.rides.timezone is
  'The IANA zone the meeting point is in (080, PD-193), or NULL for "we do not know" — which is the ordinary state for every ride created before this and for any place whose provider sent no zone. NULL falls back to APP_TIME_ZONE (Europe/Amsterdam) on both the read and the write side, which is exactly the behaviour every ride had before this column existed. Written by TWO paths: the client supplies it in the same INSERT as departure_at when the rider PICKED their start, and resolve-ride-location writes it after the fact when they TYPED one. public.enforce_ride_timezone() normalises a name this server cannot resolve to NULL rather than raising, and shifts departure_at to preserve the organizer''s wall-clock whenever a statement moves the zone without moving the instant. Never validated by a CHECK: pg_timezone_names is a view and is not immutable.';

-- ---------------------------------------------------------------------------
-- §2. The trigger — normalise, then preserve
-- ---------------------------------------------------------------------------
-- ONE function and ONE trigger rather than two, because the order between the
-- two steps is load-bearing: an unresolvable zone must become NULL *before* the
-- shift decides what to shift to, or a typo would move a ride into a zone that
-- does not exist.
--
-- ** It is not gated on `current_user`. ** `enforce_participation_gate` carries
-- `when (current_user = 'authenticated')` because it is an authorization rule
-- about a client. This is an integrity rule about a value, and it must hold for
-- the Edge Function's caller-scoped write, for a future `security definer`
-- writer, and for a hand-run `update` on a hosted project alike.
--
-- ** It never raises. ** Same reasoning as `clear_ride_map_tiles` and
-- `protect_picked_ride_location`, which sit on this same table: the writes it
-- guards are ones the rider asked for, and a raise aborts them over a value
-- they did not supply.

create or replace function public.enforce_ride_timezone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fallback constant text := 'Europe/Amsterdam';
begin
  -- 1. A zone this server cannot resolve is a zone we do not know.
  if new.timezone is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone)
  then
    raise warning 'rides.timezone: % is not a zone this server can resolve — stored as NULL', new.timezone;
    new.timezone := null;
  end if;

  -- 2. The zone moved and the instant did not, so the instant follows the zone
  --    and the wall-clock stays where the organizer put it.
  if tg_op = 'UPDATE'
     and new.timezone is distinct from old.timezone
     and new.departure_at is not distinct from old.departure_at
  then
    new.departure_at :=
      (old.departure_at at time zone coalesce(old.timezone, fallback))
        at time zone coalesce(new.timezone, fallback);
  end if;

  return new;
end;
$$;

comment on function public.enforce_ride_timezone() is
  'Two rules over rides.timezone (080, PD-193), in this order because the order matters. (1) A name absent from pg_timezone_names is stored as NULL and warned about, never raised — NULL is the column''s own "we do not know" and every stage of the map pipeline that writes this column fails open. (2) On an UPDATE that changes timezone and leaves departure_at untouched, departure_at is shifted so the organizer''s wall-clock is unchanged, resolving NULL as APP_TIME_ZONE on both sides. AT TIME ZONE is used rather than arithmetic because it is exact across a DST boundary. The departure_at guard is what keeps it off an ordinary edit: updateRide always sends departure_at, so a statement that genuinely moved the ride differs from the stored instant and wins; resolve-ride-location sends the zone alone, so it shifts. security invoker and NOT gated on current_user: this is an integrity rule about a value, not an authorization rule about a client.';

revoke all on function public.enforce_ride_timezone() from public, anon, authenticated;

drop trigger if exists enforce_ride_timezone on public.rides;

-- ** No WHEN clause, unlike its two neighbours on this table. ** Step 1 has to
-- see every INSERT, and step 2's own condition is `tg_op`-dependent, so a WHEN
-- covering both would restate the body. Postgres fires BEFORE row triggers in
-- NAME order, which puts this after `clear_ride_map_tiles` (c < e) and before
-- `protect_picked_ride_location` (e < p) — and the first of those matters: §3
-- below NULLs `new.timezone` when the meeting point changes, and step 2 must see
-- that as the zone moving.
create trigger enforce_ride_timezone
  before insert or update on public.rides
  for each row
  execute function public.enforce_ride_timezone();

-- ---------------------------------------------------------------------------
-- §3. The zone is NOT part of the location group, and that is a decision
-- ---------------------------------------------------------------------------
-- `067`'s `clear_ride_map_tiles` treats a ride's location as one group that
-- moves together: change the meeting point and the coordinate, the vendor score
-- and both tiles go, because they all describe a place the ride is no longer at.
-- The obvious next step is to put `timezone` in that group. **It was, and it was
-- wrong — measured on DEV before this file merged, so the reasoning is worth
-- keeping rather than the code.**
--
-- ** Clearing the zone pulls it out from under the writer that just resolved
--    against it. ** `updateRide` builds `departure_at` with
--    `wallClockToUtc(typed, resolveDepartureZone(location, previous.timezone))`
--    — the zone the edit form was RENDERING in, which is the only zone that
--    reproduces the digits the rider is looking at. A statement that changes the
--    meeting point *and* the departure time therefore carries an instant
--    expressed in a zone that `clear_ride_map_tiles` is about to drop, and §2's
--    guard correctly declines to shift it, because the statement did move the
--    instant. Measured: a ride at 09:00 Lisbon, saved with a new address and
--    09:30 typed, stored 08:30Z with a NULL zone and rendered **10:30**. The
--    rider is shown an hour they did not type, on their own screen, on save.
--
-- That is the precise defect this whole file exists to prevent, arriving through
-- the one path §2 cannot see. The control case — address changed, time
-- untouched — was correct throughout, which is what made it asymmetric rather
-- than obvious.
--
-- ** So the zone survives a location change, and a stale zone is the better
--    interim. ** Until the geocode lands it is the zone of the previous meeting
--    point, which for a ride being moved within a region is usually right and is
--    never worse than `APP_TIME_ZONE` for a ride that was abroad. `067`'s
--    trigger is left exactly as it was; nothing in this file replaces it.
--
-- ** `updateRide` does not clear it either, on the same reasoning. ** Its
--    `pickCleared` branch NULLs `start_place_id`, the coordinate and the vendor
--    score — all provenance for a POINT — and leaves `timezone` alone, because
--    the ride still meets at the place the TEXT names and that place still has a
--    clock.
--
-- What remains true: the only writers of this column are ones that know a better
-- answer, and §2 holds the wall-clock whenever one of them moves it.
--
-- `protect_picked_ride_location` is likewise untouched. It fires only when a
-- statement moves a picked ride's latitude, longitude or confidence, and
-- `resolve-ride-location` writes none of those — nor a timezone — for a picked
-- ride: its coordinate is the rider's own and its zone came with the pick.

-- ---------------------------------------------------------------------------
-- §4. Grants — ADDITIVE, per operation, never a re-stated list
-- ---------------------------------------------------------------------------
-- `045` converted `rides` to per-column INSERT and UPDATE grants, so a column
-- added after it is NOT writable until it is named — `42501`, and for the Edge
-- Function that surfaces as the existing `column_write_refused` path, silently.
--
-- ** Additive `grant` statements, deliberately not a re-issued list ** — `067`
-- §5 made the same choice for the same reason. `044`/`046` are this repo's
-- worked example of the alternative going wrong: two files each issuing an
-- absolute `revoke` + `grant` list, where running them out of order silently
-- reinstates a column the later one removed, with no error and nothing red.
--
-- BOTH verbs, unlike `051`'s tile columns which got UPDATE alone. The picked
-- path supplies the zone at ride CREATION, which is the whole reason a picked
-- ride never needs a correction; without INSERT it would be refused at the one
-- moment it is knowable.

grant insert (timezone) on public.rides to authenticated;

grant update (timezone) on public.rides to authenticated;

-- ---------------------------------------------------------------------------
-- §5. No index and no policy — both decisions, neither an omission
-- ---------------------------------------------------------------------------
-- ** No RLS policy. ** The column lives on `rides`. `001`, `017` and `022`
-- already decide who may read a ride row, and RLS is row-level: a reader who
-- gets the row gets every column they hold a grant for. `rides` is
-- `authenticated=rdm` at the table level for SELECT, so no column SELECT grant
-- is needed either. Adding a policy here would be the bug — `067` §6.
--
-- ** No index. ** Nothing filters, sorts or joins on this column, and nothing
-- is going to: it is read alongside `departure_at` on rows a query has already
-- selected.
