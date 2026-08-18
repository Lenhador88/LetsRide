-- 067: A ride's start location can be PICKED, and a pick outranks a geocode.
--      PD-114, openspec/changes/add-ride-start-location-search.
--
-- Sections 1 and 2 of that change's tasks.md, and nothing else.
--
-- `meeting_point` is untouched: still `NOT NULL`, still free text, still bounded
-- at 120 by `018`. Search is an accelerator on top of it and never a gate — "the
-- layby past the second roundabout" stays a legal meeting point and a ride is
-- never refused for having no pick.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NOT `066` WITH THE TABLE NAME CHANGED
-- ---------------------------------------------------------------------------
-- `clubs` had NO prior writer for its location, so `066` added four columns to
-- empty space. `rides` already has one: `resolve-ride-location` geocodes
-- `meeting_point` and writes `latitude`, `longitude`, `geocode_confidence`
-- (`051`). This file adds a SECOND writer, and PRECEDENCE BETWEEN THE TWO is
-- most of what it does. Three facts were re-measured on DEV
-- (fpmrimzxadewsaiwpsel, Postgres 17.6) on 2026-08-18, immediately before this
-- was written, rather than read off the design:
--
--   1. `051`'s `clear_ride_map_tiles` is `BEFORE UPDATE ... WHEN (old.meeting_point
--      IS DISTINCT FROM new.meeting_point)` and NULLs all five columns
--      unconditionally. In a rolled-back transaction, one statement setting
--      `meeting_point`, `latitude`, `longitude` and `geocode_confidence`
--      together stored the new text and THREE NULLS. A BEFORE trigger
--      overwrites what the same statement supplied — which is exactly what
--      `051` WANTED against a stale path and must not have against a fresh
--      pick. Without §3 below, the picked edit path cannot work at all.
--
--   2. `authenticated` holds INSERT on none of `latitude`, `longitude`,
--      `geocode_confidence` — `051` granted UPDATE only, and `045` had already
--      converted `rides` to per-column grants so every later column arrives
--      unwritable. `has_column_privilege('authenticated','public.rides',
--      'latitude','INSERT')` returned false. So a pick supplied at ride
--      CREATION raises `42501` today, above RLS, with the policy set looking
--      perfectly correct.
--
--   3. `rides_geocode_coupling` requires a `geocode_confidence` alongside any
--      coordinate: `update rides set latitude = 52.37, longitude = 4.89` was
--      refused `23514`. A picked place has no vendor score, so that constraint
--      has to be replaced rather than added to.
--
-- ---------------------------------------------------------------------------
-- PROVENANCE IS THE COLUMNS, NOT AN ENUM AND NOT A SENTINEL
-- ---------------------------------------------------------------------------
-- PD-114's own 2026-08-12 comment sets the problem correctly — confidence
-- SATURATES, so a maximally-confident geocode and a picked place are
-- indistinguishable within that column — and offers two answers: a
-- `location_source` enum, or a CHECK-admitted sentinel confidence reserved for
-- picks. Neither is taken.
--
--   * An ENUM is a second statement of a fact the columns already carry, free
--     to disagree with them, and tying it to them takes a CHECK that IS this
--     constraint plus a column.
--   * A SENTINEL abuses a column whose name says it holds a vendor score. Any
--     later reader who was not told the convention reads it as one.
--
-- So: `start_place_id IS NOT NULL` means a rider picked this point,
-- `geocode_confidence IS NOT NULL` means the vendor guessed it, and §2's CHECK
-- makes the two arms mutually exclusive. The marker costs the column the story
-- needed anyway and cannot disagree with itself.
--
-- ** One half of provenance is ENFORCED and the other half is a CLAIM. ** A
-- rider cannot forge over a pick — §4's trigger restores it. A rider CAN
-- hand-write the geocoded arm onto a ride carrying no pick, because
-- `authenticated` holds `update (geocode_confidence)` from `051` and that grant
-- CANNOT BE REVOKED HERE: `resolve-ride-location` builds its writing client
-- from the anon key plus the CALLER's own `Authorization` header (its own §Rule
-- 1), so it writes as `authenticated` on the rider's JWT, not as `service_role`
-- — `delete-account` is the only place a service-role key exists in this
-- project. Revoking ahead of a redeployed function raises `42501` on every
-- geocode, and the function is FAIL-OPEN, so every ride would silently stop
-- getting a tile with nothing red anywhere. Closing it needs a `security
-- definer` `record_ride_geocode(...)` for the function to call and THEN the
-- revoke, in that order, across two migrations — `021`/`025`'s additive-first /
-- deploy / destructive-last rule. It is tasks.md §8 and it is deliberately not
-- here.
--
-- ---------------------------------------------------------------------------
-- THIS FILE HANGS A NEW TRIGGER ON A LIVE WRITE PATH
-- ---------------------------------------------------------------------------
-- `036`'s lesson: from the moment this applies, every ride create and every
-- ride edit runs new code inside the rider's own transaction, and a trigger
-- that raises takes that rider's write down with it. Both triggers here CLEAR
-- OR RESTORE COLUMNS AND NEVER RAISE, so the worst case is a lost location
-- rather than a refused ride write. Every affected path — create with a pick,
-- create without, text-only edit, edit with a new pick, re-pick the same place,
-- clear the pick, a geocode-shaped UPDATE against a picked ride, and
-- `propagate_club_privacy_to_rides` across a club — was hand-exercised on DEV
-- in a rolled-back transaction with this file's DDL applied inside it, BEFORE
-- it was applied for real.

-- ---------------------------------------------------------------------------
-- §1. The column
-- ---------------------------------------------------------------------------
-- ONE column, not four. `066` needed four on `clubs` because a club had no text
-- field for a location at all; a ride already has `meeting_point`, which is NOT
-- NULL, bounded, required, and the thing every screen renders. Picking FILLS
-- that text, so a `start_place_name` would be a copy of `meeting_point` equal
-- to it in every stored row.

alter table public.rides add column start_place_id text;

comment on column public.rides.start_place_id is
  'The Overture GERS id of the place the organizer PICKED for this ride''s start (067, PD-114). PROVENANCE, never a join key: its presence is what says a rider chose this coordinate rather than resolve-ride-location guessing it, and rides_location_coupling makes that arm exclusive with geocode_confidence. `text` rather than `uuid` because GERS ids are documented as opaque strings and only happen to be UUID-shaped today — same reasoning as places.id and clubs.location_place_id. NO foreign key to public.places: the index is reloaded wholesale by scripts/places/load.sql, so `restrict` would make it unrefreshable the moment one ride referenced a row and `cascade`/`set null` would silently wipe the location of every ride whose place did not survive a re-cut. It can therefore DANGLE and nothing in the database will ever say so.';

-- ---------------------------------------------------------------------------
-- §2. The coupling, replaced — and the length bound
-- ---------------------------------------------------------------------------
-- `051`'s `rides_geocode_coupling` requires a confidence alongside any
-- coordinate, which a pick cannot supply. Replaced rather than relaxed, because
-- the replacement is where provenance gets encoded: three arms, mutually
-- exclusive, so a row can never claim both writers or neither.
--
-- ** `rides_geocode_coupling` IS GONE BY NAME after this file. ** `051`'s
-- footer and the RLS suite grep for it; both are updated in the same change.
-- Dropping and re-adding a constraint in a NEW file is not editing an applied
-- migration.
--
-- ** `0.70::real` KEEPS ITS CAST, AND DROPPING IT IS THE TRAP. ** Re-measured
-- on DEV 2026-08-18 rather than inherited:
--
--   select (0.70::real >= 0.70);        -->  false
--   select (0.70::real >= 0.70::real);  -->  true
--
-- `real` cannot represent 0.70 and the bare literal is `numeric`, so Postgres
-- widens the `real` and a candidate whose confidence is EXACTLY the stated
-- floor violates its own constraint. That is not a filter, it is a write error
-- on a path no scenario covers. Retyping a constraint is exactly the moment
-- that cast gets lost, which is why it is called out at the point of retyping.

alter table public.rides drop constraint rides_geocode_coupling;

alter table public.rides add constraint rides_location_coupling check (
  -- (a) nothing known. The state of every ride in both projects today.
  (latitude is null and longitude is null
     and geocode_confidence is null and start_place_id is null)
  -- (b) PICKED. A rider chose a row out of public.places, so there is no vendor
  --     score and its absence is correct rather than missing: confidence is the
  --     vendor's evidence for a guess, and choosing from an index is not a
  --     guess.
  or (start_place_id is not null
     and latitude is not null and longitude is not null
     and geocode_confidence is null
     and latitude >= -90 and latitude <= 90
     and longitude >= -180 and longitude <= 180)
  -- (c) GEOCODED. `051`'s arm, unchanged including both casts, plus the
  --     requirement that no pick is claimed alongside it. The upper bound is
  --     what makes a mis-scaled vendor value fail closed: if the vendor is
  --     really emitting 0-100, every write is refused and NO tile is ever
  --     stored, loudly, rather than every tile being stored with a meaningless
  --     score.
  or (start_place_id is null
     and latitude is not null and longitude is not null
     and geocode_confidence is not null
     and latitude >= -90 and latitude <= 90
     and longitude >= -180 and longitude <= 180
     and geocode_confidence >= 0.70::real
     and geocode_confidence <= 1.0::real)
);

-- A GERS id is opaque but it is not unbounded, and it is the field a client
-- controls most directly — nothing stops a rider posting a novel here. 100,
-- mirroring `066`'s `clubs_location_place_id_length`.
alter table public.rides add constraint rides_start_place_id_length check (
  start_place_id is null or char_length(start_place_id) <= 100
);

-- ---------------------------------------------------------------------------
-- §3. `clear_ride_map_tiles`, corrected so a pick supplied by the same
--     statement survives
-- ---------------------------------------------------------------------------
-- `051`'s reasoning is ADOPTED UNCHANGED for the pick: text edited without a
-- new pick means the pin is no longer known to describe it, so the pin goes.
-- Deciding whether two strings denote the same place is the problem geocoding
-- exists to solve, and an over-eager clear costs one render.
--
-- What changes is the ONE case `051` could not have: a statement carrying the
-- new text AND a newly picked place, which today loses the coordinate (fact 1
-- in the header).
--
-- ** "Supplied by this statement" is NOT DECIDABLE and this does not pretend it
-- is. ** Postgres gives a BEFORE trigger no way to see the SET list: `NEW`
-- carries the old value for an omitted column, so an OMISSION and a REPETITION
-- of the stored value are the same input. The decision is therefore made from a
-- DIFFERENCE between OLD and NEW — a proxy for supply, not the thing itself —
-- and the proxy is arranged to fail in the CLEARING direction. Case by case:
--
--   * text edited, location columns omitted   -> NEW carries the old id, not
--     distinct, everything clears. Correct, and it does not depend on the
--     client sending anything.
--   * text edited, a NEW place picked          -> distinct, the pick is kept.
--   * pick, save, edit the text (pick cleared to NULL), re-pick the SAME place
--     -> OLD is NULL and NEW is the id, so distinct, kept.
--   * a hand-rolled client repeating the stored id beside new text -> not
--     distinct, cleared. The safe direction.
--   * the pick cleared with the text left alone -> NEW is NULL and OLD is not,
--     so distinct, `new.start_place_id is not null` is false, everything
--     clears. The organizer may always remove their own pin.
--
-- ** The residual case, stated rather than hidden: ** a statement that supplies
-- a NEW place id but no new coordinates keeps the row's OLD coordinates under
-- the new id. It is constraint-legal and it is wrong data. No `OLD`/`NEW` test
-- can separate it from a legitimate pick, the app always sends the three
-- together, and the alternative — also clearing the coordinates on the pick arm
-- — would break the case this whole section exists for.
--
-- ** The WHEN scope is still NOT OPTIONAL, and it now has two arms. **
-- `propagate_club_privacy_to_rides` (022) runs `update public.rides set
-- is_public = false where club_id = ... and is_public` the moment a club turns
-- private. It touches neither `meeting_point` nor `start_place_id`, so neither
-- arm is true and no ride in that club loses its location. An unscoped trigger
-- would clear every tile in the club in one statement — a bulk data loss with a
-- plausible-looking cause, discovered weeks later.
--
-- Still BEFORE and still CLEARING RATHER THAN RAISING, so no ride write can be
-- aborted by it. Its one hazard is unchanged and now has a second route:
-- clearing the path columns destroys the only record of the superseded object
-- names, so the client must delete those objects BEFORE issuing the UPDATE that
-- fires this.

create or replace function public.clear_ride_map_tiles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.start_place_id is not null
     and new.start_place_id is distinct from old.start_place_id then
    -- A newly picked place. Keep its coordinate; a pick carries no vendor
    -- score, and both tiles were rendered for the PREVIOUS point.
    new.geocode_confidence := null;
    new.map_card_path      := null;
    new.map_detail_path    := null;
  else
    new.start_place_id     := null;
    new.latitude           := null;
    new.longitude          := null;
    new.geocode_confidence := null;
    new.map_card_path      := null;
    new.map_detail_path    := null;
  end if;
  return new;
end;
$$;

comment on function public.clear_ride_map_tiles() is
  'Clears a ride''s location and both tile paths when meeting_point or start_place_id changes (051, rewritten by 067). The one exception is a NEWLY PICKED place — start_place_id non-NULL and distinct from OLD — whose coordinate is kept while the confidence and both tiles are cleared, because 051''s BEFORE trigger otherwise discards a pick supplied by the same statement as the text (measured on DEV 2026-08-18). "Supplied by this statement" is not decidable from a BEFORE trigger, so the test is a difference between OLD and NEW and it fails in the clearing direction. Scoped by the trigger''s WHEN to an actual meeting_point or start_place_id change: propagate_club_privacy_to_rides bulk-updates is_public across a club and touches neither, so no ride there loses its location — an unscoped version would wipe every tile in that club the moment it turned private.';

revoke all on function public.clear_ride_map_tiles() from public, anon, authenticated;

drop trigger if exists clear_ride_map_tiles on public.rides;

create trigger clear_ride_map_tiles
  before update on public.rides
  for each row when (
    old.meeting_point is distinct from new.meeting_point
    or old.start_place_id is distinct from new.start_place_id)
  execute function public.clear_ride_map_tiles();

-- ---------------------------------------------------------------------------
-- §4. Precedence — a pick cannot be moved by a later geocode
-- ---------------------------------------------------------------------------
-- On a ride whose location the rider PICKED, a geocode would replace an exact
-- coordinate with a vendor's approximation of the same words: a silent
-- downgrade with nothing to see afterwards, because both states look identical
-- from a screen.
--
-- ** This lives in Postgres and NOT in the Edge Function, deliberately. **
-- `tsconfig.json` excludes `supabase/functions`, so nothing type-checks
-- `index.ts`; `deploy_edge_function` is on the deny list, so only the owner can
-- deploy it; and `031` is the standing lesson that an assumption about what a
-- non-client role can reach goes unnoticed because the RLS suite runs as the
-- table owner. A precedence rule living only there is a rule one unreviewed
-- deploy can remove, silently, in the direction that stores a plausible wrong
-- value. The function is ALSO changed to skip a picked ride (tasks.md §6), and
-- that is the fix for wasted vendor spend, not the fix for correctness.
--
-- ** Ordering against §3 is safe and does not rest on luck. ** Postgres fires
-- BEFORE row triggers in NAME order, and `clear_ride_map_tiles` sorts before
-- `protect_picked_ride_location`. A BEFORE trigger's WHEN is evaluated against
-- `NEW` AS MODIFIED BY THE TRIGGERS BEFORE IT — the half worth re-measuring
-- rather than trusting, and it was, on DEV 2026-08-18 with a two-trigger probe
-- on a scratch table: the earlier trigger NULLed a column the statement
-- supplied, and the later trigger's `when (new.a is not null)` did NOT fire. So
-- on a text-only edit of a picked ride, §3 sets `new.start_place_id` to NULL
-- and this trigger's `is not distinct from` arm is false, so it does not fire.
-- On a new pick the ids differ and it does not fire either. The two can be
-- reasoned about independently.
--
-- ** A tile rendered FOR THE STORED PICK is accepted. ** Its UPDATE leaves the
-- coordinates equal, so the WHEN never fires and the paths land — which is what
-- lets the redeployed Edge Function render a picked ride without a further
-- exception here.
--
-- It RESTORES AND CLEARS, NEVER RAISES: the write it guards is an enrichment on
-- a path the rider is already on, and a raise there aborts a write the rider
-- asked for because of a value they did not supply.
--
-- The path columns are NULLed whenever it fires, including on a statement that
-- moves only `geocode_confidence`. That arm is over-eager in the clearing
-- direction on purpose — `rides_map_paths_need_a_coordinate` would happily keep
-- a tile that is now a picture of the rejected point.

create or replace function public.protect_picked_ride_location()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.latitude           := old.latitude;
  new.longitude          := old.longitude;
  new.geocode_confidence := null;
  new.map_card_path      := null;
  new.map_detail_path    := null;
  return new;
end;
$$;

comment on function public.protect_picked_ride_location() is
  'Restores a ride''s PICKED coordinate when any statement tries to move it without changing start_place_id (067, PD-114), forces geocode_confidence back to NULL and NULLs both tile paths — a tile rendered for the rejected coordinate is a picture of the wrong place. Never raises: the write it guards is resolve-ride-location enriching a ride the rider is already saving, and aborting that would refuse a write the rider asked for over a value they did not supply. In Postgres rather than in the Edge Function because nothing type-checks that function, only the owner can deploy it, and a precedence rule living only there is one unreviewed deploy from being gone.';

revoke all on function public.protect_picked_ride_location() from public, anon, authenticated;

drop trigger if exists protect_picked_ride_location on public.rides;

create trigger protect_picked_ride_location
  before update on public.rides
  for each row when (
    old.start_place_id is not null
    and new.start_place_id is not distinct from old.start_place_id
    and (new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.geocode_confidence is distinct from old.geocode_confidence))
  execute function public.protect_picked_ride_location();

-- ---------------------------------------------------------------------------
-- §5. Grants — ADDITIVE, per operation, never a re-stated list
-- ---------------------------------------------------------------------------
-- `045` converted `rides` to per-column INSERT and UPDATE grants, so a column
-- added after it is NOT writable until it is named. `051` then granted UPDATE
-- on the five tile columns and INSERT on none of them, because a tile is only
-- ever written by an UPDATE after the ride exists. A PICK is different: it is
-- supplied at ride CREATION, which is fact 2 in the header — `42501` today.
--
-- ** Additive `grant` statements, deliberately not a re-issued list. **
-- `044`/`046` are this repo's worked example of the alternative going wrong:
-- two files each issuing an absolute `revoke` + `grant` list, where running
-- them out of order silently reinstates a column the later one removed, with no
-- error and nothing red.
--
-- NOT granted, and each absence is a decision:
--   * INSERT on `geocode_confidence` — no client ever produces one, and under
--     §2 a client that could would be writing the geocoded arm by hand.
--   * INSERT on `map_card_path` / `map_detail_path` — `051`'s rule, unchanged.
--   * `created_at`, `id`, `organizer_id` on UPDATE — `045` closed those and
--     nothing here names them.
--   * anything at all to `anon` — decision #1, and `007` revoked the last one.

grant insert (start_place_id, latitude, longitude) on public.rides to authenticated;

grant update (start_place_id) on public.rides to authenticated;

-- `051` already granted `update (latitude, longitude, geocode_confidence,
-- map_card_path, map_detail_path)`; nothing here repeats or removes it.

-- ---------------------------------------------------------------------------
-- §6. No index and no policy — both decisions, neither an omission
-- ---------------------------------------------------------------------------
-- ** No RLS policy. ** These columns live on `rides`. `001`, `017` and `022`
-- already decide who may read a ride row, and RLS is row-level: a reader who
-- gets the row gets every column they hold a grant for. There is no NARROWER
-- policy available here, only a wider one, and a second predicate over the same
-- row is how two predicates drift apart. `rides` is `authenticated=rdm` at the
-- table level for SELECT, so no column SELECT grant is needed either — unlike
-- `postcards`, which is `d` only and is why `062` had to revoke a column grant
-- there. Adding a policy here would be the bug.
--
-- ** No index on (latitude, longitude). ** The trigger for adding one is a
-- SQL-SIDE DISTANCE PREDICATE — `066` §4's rule, same as for `clubs`. Nothing
-- reads these coordinates in a WHERE clause today; a "rides near me" filter is
-- explicitly out of scope for this change. An index the planner never reads is
-- a write cost on every ride edit and a thing to keep in step. Add it with that
-- change, not before it.

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The grants, SCOPED TO THE GRANTEE. A table-wide count reads 2 against a
--    correct database, because postgres and service_role hold everything by
--    Supabase default — the mistake `015`'s footer made and documented.
--
--   select privilege_type, string_agg(column_name, ',' order by column_name)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='rides'
--      and grantee='authenticated' and privilege_type in ('INSERT','UPDATE')
--    group by privilege_type order by privilege_type;
--   -- INSERT  club_id,departure_at,description,id,is_public,latitude,longitude,
--   --         max_riders,meeting_point,organizer_id,route_description,
--   --         start_place_id,title
--   -- UPDATE  club_id,departure_at,description,geocode_confidence,is_public,
--   --         latitude,longitude,map_card_path,map_detail_path,max_riders,
--   --         meeting_point,route_description,start_place_id,title
--
--   select has_column_privilege('authenticated','public.rides','geocode_confidence','INSERT');
--   -- false — no client ever produces one
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='rides' and grantee='anon';
--   -- 0
--
-- 2. Each arm of the coupling, as the ORGANIZER rather than as the owner (a
--    caller the policy filters to zero rows never fires a CHECK at all —
--    `066`'s block got this wrong on its first pass):
--
--   -- expect 23514 on each
--   update public.rides set start_place_id = 'g1' where id = '<own ride>';
--   update public.rides set latitude = 52.0, longitude = 4.0 where id = '<own ride>';
--   update public.rides set start_place_id = 'g1', latitude = 52.0, longitude = 4.0,
--          geocode_confidence = 0.9 where id = '<own ride>';
--   update public.rides set start_place_id = 'g1', latitude = 95.0, longitude = 4.0
--     where id = '<own ride>';
--   update public.rides set start_place_id = repeat('x', 101), latitude = 52.0,
--          longitude = 4.0 where id = '<own ride>';
--
--   -- expect ACCEPTED, and the floor one is the cast assertion
--   update public.rides set start_place_id = 'g1', latitude = 52.0, longitude = 4.0
--     where id = '<own ride>';
--   update public.rides set latitude = 52.0, longitude = 4.0,
--          geocode_confidence = 0.70 where id = '<own ride, no pick>';
--
-- 3. The SAME-STATEMENT case, which is the whole point of §3 and which a
--    two-statement test passes while proving nothing:
--
--   update public.rides set meeting_point = 'Shell Pernis Werk, Rotterdam',
--          start_place_id = 'g2', latitude = 51.885, longitude = 4.372
--    where id = '<own ride>';
--   -- the pick SURVIVES: start_place_id = 'g2', coordinates stored,
--   -- geocode_confidence NULL, both tile paths NULL
--
--   update public.rides set meeting_point = 'Somewhere else' where id = '<same ride>';
--   -- everything clears
--
-- 4. Precedence — a geocode-shaped UPDATE on a picked ride, which must NOT
--    raise and must NOT move the coordinate:
--
--   update public.rides set latitude = 52.37, longitude = 4.89,
--          geocode_confidence = 0.95 where id = '<picked ride>';
--   -- accepted, 1 row, coordinate unchanged, geocode_confidence NULL,
--   -- both tile paths NULL
--
-- 5. `get_advisors(security)` on DEV. The expected set is the ten in CLAUDE.md;
--    a new WARN means a revoke did not land. Both functions here are `security
--    invoker`, so neither adds an
--    `authenticated_security_definer_function_executable`.
--
-- 6. The trigger count on `rides` goes from four to five:
--
--   select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where c.relname = 'rides' and not t.tgisinternal;   -- 5
