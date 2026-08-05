-- 018: the ten rider-authored columns whose length rule existed only in Zod.
--
-- **This closes a live defect; it does not prevent a future one.** The
-- publishable key ships in the client bundle today and PostgREST accepts any
-- rider's JWT, so a megabyte club name is one hand-rolled request away right
-- now. `src/lib/validation/` is enforcement only because every write currently
-- goes through a Server Action that parses it — a convention in our code, not a
-- rule in the database. The client-rendered shell removes the convention and
-- leaves the rule, so the rule has to exist first.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against the hosted project (zwprydcyryvudhurbnye)
-- 2026-08-05, immediately before writing this file — the way 013 did it
-- ---------------------------------------------------------------------------
-- Population: 4 profiles, 2 clubs, 3 rides.
--
--   profiles.bio            > 500 raw ......................... 0
--   profiles.bike_model     > 60 raw .......................... 0
--   profiles.location       trimmed < 1 or > 100 raw ........... 0
--   clubs.name              trimmed < 1 or > 60 raw ............ 0
--   clubs.description       > 500 raw ......................... 0
--   rides.title             trimmed < 1 or > 80 raw ............ 0
--   rides.description       > 500 raw ......................... 0
--   rides.meeting_point     trimmed < 1 or > 120 raw ........... 0
--   rides.route_description > 1000 raw ........................ 0
--   rides.max_riders        < 1 or > 999 ...................... 0
--
-- Every count is zero, so every constraint below is added VALIDATED. A non-zero
-- count would have meant NOT VALID plus a separate validate, never a loosened
-- rule. Re-run the counts before applying if this file has been sitting:
--
--   select
--     (select count(*) from public.profiles where bio is not null and length(bio) > 500),
--     (select count(*) from public.clubs where length(btrim(name)) < 1 or length(name) > 60),
--     (select count(*) from public.rides where length(btrim(title)) < 1 or length(title) > 80);
--
-- ---------------------------------------------------------------------------
-- Trimmed floor, raw ceiling — the same asymmetry as postcard_comments_body_length
-- ---------------------------------------------------------------------------
-- The floor is on `btrim(x)` so a title of nothing but spaces is refused; the
-- ceiling is on the raw value so padding cannot smuggle a longer string past a
-- trimmed check. 011 argues this at length for comment bodies and the reasoning
-- is identical here.
--
-- **The Zod schemas trim before measuring the ceiling, so they are marginally
-- more permissive than these constraints for a padded value.** That direction is
-- the safe one: the client refuses first with a sentence, and anything that
-- reaches the database with 60 characters of name plus trailing spaces is not a
-- form submission. Recorded rather than reconciled — changing Zod is application
-- code and this phase adds none.
--
-- ---------------------------------------------------------------------------
-- The numbers are adopted, not chosen here
-- ---------------------------------------------------------------------------
-- Each matches its schema in `src/lib/validation/` exactly:
--   profile.ts   BIO_MAX_LENGTH 500, BIKE_MODEL_MAX_LENGTH 60, locationSchema 1..100
--   clubs.ts     CLUB_NAME_MAX 60, CLUB_DESCRIPTION_MAX 500
--   rides.ts     RIDE_TITLE_MAX 80, RIDE_DESCRIPTION_MAX 500,
--                RIDE_MEETING_POINT_MAX 120, RIDE_ROUTE_MAX 1000, max_riders 1..999
--
-- The `clubs` and `rides` bounds were chosen rather than measured — both Figma
-- frames are OLD-stylesheet and marked To do — and both schema files say so.
-- This migration adopts them as written rather than reopening the question
-- (design.md Q4); a different limit later is another migration, not an edit here.
--
-- ---------------------------------------------------------------------------
-- NULL, and the empty string
-- ---------------------------------------------------------------------------
-- NULL stays permitted on every optional column, and on `location`, which is
-- NULL for every rider between signup and onboarding step 2. A constraint that
-- forbade it would make the wizard unreachable.
--
-- **The empty string is deliberately still permitted on the optional columns**,
-- and this is a decision rather than an oversight. Every Zod schema maps '' to
-- NULL before it reaches the database, so nothing writes one today (measured: 0
-- rows across bio, bike_model and location). Refusing '' outright would be a
-- rule the task did not state, on a phase defined as adding nothing the
-- application has to change for, and its only failure mode is a raw 23514 on a
-- path no screen handles. Worth doing on its own merits, separately, with the
-- clear/never-set distinction stated as a requirement first.

-- ---------------------------------------------------------------------------
-- §1. profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add constraint profiles_bio_length
  check (bio is null or length(bio) <= 500);

alter table public.profiles
  add constraint profiles_bike_model_length
  check (bike_model is null or length(bike_model) <= 60);

-- The floor applies only once a value exists. `location` is NOT NULL-able by
-- design (003 added it nullable precisely so an unfinished wizard has somewhere
-- to be), and 003's completion trigger is what requires it before the stamp.
alter table public.profiles
  add constraint profiles_location_length
  check (location is null or (length(btrim(location)) >= 1 and length(location) <= 100));

-- ---------------------------------------------------------------------------
-- §2. clubs
-- ---------------------------------------------------------------------------

-- `name` is NOT NULL since 001, so no null arm — a null already fails.
alter table public.clubs
  add constraint clubs_name_length
  check (length(btrim(name)) >= 1 and length(name) <= 60);

alter table public.clubs
  add constraint clubs_description_length
  check (description is null or length(description) <= 500);

-- ---------------------------------------------------------------------------
-- §3. rides
-- ---------------------------------------------------------------------------

alter table public.rides
  add constraint rides_title_length
  check (length(btrim(title)) >= 1 and length(title) <= 80);

alter table public.rides
  add constraint rides_description_length
  check (description is null or length(description) <= 500);

alter table public.rides
  add constraint rides_meeting_point_length
  check (length(btrim(meeting_point)) >= 1 and length(meeting_point) <= 120);

alter table public.rides
  add constraint rides_route_description_length
  check (route_description is null or length(route_description) <= 1000);

-- A range, not a length. NULL means "no cap", which is what every ride created
-- before /rides/new offered the field carries.
--
-- This bounds what can be *stored*, and nothing else. `max_riders` has never
-- limited `ride_members` — no policy, trigger or constraint counts a crew
-- against it, and this migration does not add one. The spec names that gap
-- explicitly so it stays recorded rather than assumed closed by the presence of
-- a constraint on the column.
alter table public.rides
  add constraint rides_max_riders_range
  check (max_riders is null or (max_riders >= 1 and max_riders <= 999));

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 10 — this migration's constraints, counted by name rather than by a
-- table-wide total, so a later migration adding an unrelated CHECK does not
-- silently move the number (015's footer made that mistake with grants).
--
--   select count(*) from pg_constraint
--    where contype = 'c'
--      and conname in ('profiles_bio_length','profiles_bike_model_length',
--                      'profiles_location_length','clubs_name_length',
--                      'clubs_description_length','rides_title_length',
--                      'rides_description_length','rides_meeting_point_length',
--                      'rides_route_description_length','rides_max_riders_range');
--
-- Expected: 0 — none of them left NOT VALID, since every pre-flight was zero.
--
--   select count(*) from pg_constraint
--    where contype = 'c' and not convalidated
--      and conrelid in ('public.profiles'::regclass, 'public.clubs'::regclass,
--                       'public.rides'::regclass);
--
-- Expected: 0 rows — nothing existing violates. Belt and braces: the constraints
-- are validated on creation, so a non-empty result here would mean the ALTER
-- silently did not run.
--
--   select count(*) from public.rides where length(btrim(title)) < 1;
--
-- Every bound also has a rejection and a boundary-acceptance assertion in
-- supabase/tests/rls_test.sql, which applies the whole chain to a scratch
-- database on every PR that touches supabase/**.
