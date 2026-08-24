-- Development seed — riders, a club, rides and postcards, so a preview
-- deployment shows an app rather than five empty states.
--
-- ===========================================================================
-- THIS MUST NEVER RUN AGAINST PRODUCTION. The guard below is the enforcement,
-- not this comment. Read it before changing anything.
-- ===========================================================================
--
--   PGPASSWORD=... psql "$DEV_DATABASE_URL" \
--     -v ON_ERROR_STOP=1 -v seed_password="$(openssl rand -base64 18)" \
--     -f supabase/seeds/development.sql
--
-- ---------------------------------------------------------------------------
-- The guard, and why it is shaped like this
-- ---------------------------------------------------------------------------
-- It refuses to run if `auth.users` holds a single row this seed did not
-- create — i.e. any address outside `@letsride.dev`.
--
-- That is deliberately not a flag someone can forget to pass. A flag defends
-- against the run you were thinking about; this defends against the run you
-- were not, which is the only kind that reaches production. It also gets
-- *stronger* over time rather than weaker: production accumulates real riders,
-- so every day that passes makes this abort more certain, while a
-- `--environment=dev` argument is exactly as forgettable in a year as today.
--
-- It is correct on day one too. Production already holds the two
-- `@letsride.test` fixtures and one real Gmail signup, so the guard fires
-- there right now, before any real rider exists.
--
-- Re-running is safe: seed rows are deleted and rebuilt, so this is a reset
-- rather than an append. The delete cascades through `029`'s FKs.
--
-- If DEV ever collects a genuine signup, the guard will refuse and it is
-- telling the truth — that database now has data someone might care about.
-- Delete that account deliberately, or seed a fresh project. There is no
-- override, on purpose.
--
-- ---------------------------------------------------------------------------
-- Two things this seed does NOT do
-- ---------------------------------------------------------------------------
-- **The password is a required argument, never a literal.** `CLAUDE.md` §Test
-- accounts is unambiguous that passwords do not live in this repo, and a
-- dev-only credential is still a credential the day someone points these
-- variables at the wrong project. Pass `-v seed_password=...`; psql aborts on
-- an unset variable because ON_ERROR_STOP is set above.
--
-- **The postcard images do not exist.** `image_path` is a Storage object path,
-- and this file writes rows, not objects — there is no way to upload a JPEG
-- from SQL. So the deck renders with broken thumbnails until someone signs in
-- and posts one through the app. That is the honest trade: an empty home
-- screen reviews nothing at all, and `/postcards` IS the home screen. Posting
-- a real one is also the only way to exercise compression, EXIF stripping and
-- the Storage policies, so it is worth doing early on a fresh DEV anyway.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. The guard
-- ---------------------------------------------------------------------------
do $$
declare
  foreign_users integer;
  sample text;
begin
  select count(*), min(email)
    into foreign_users, sample
    from auth.users
   where email is null or email not like '%@letsride.dev';

  if foreign_users > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format(
        'REFUSING TO SEED: %s account(s) exist that this seed did not create (e.g. %s).',
        foreign_users, coalesce(sample, '<null email>')),
      detail  = 'This looks like a database with real users in it — production, or a DEV that has collected a genuine signup.',
      hint    = 'If this really is DEV, remove the non-@letsride.dev accounts deliberately, then re-run.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Reset — makes the seed idempotent rather than additive
-- ---------------------------------------------------------------------------
delete from auth.users where email like '%@letsride.dev';

-- ---------------------------------------------------------------------------
-- 2. Riders
-- ---------------------------------------------------------------------------
-- Every token column is '' and never NULL. GoTrue scans these into
-- non-nullable Go strings, so a NULL turns every login into "Invalid login
-- credentials" — a failure that reads like a wrong password and has cost this
-- project real time before (docs/HANDOFF.md §Test accounts).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000',
  r.id, 'authenticated', 'authenticated', r.email,
  extensions.crypt(:'seed_password', extensions.gen_salt('bf')),
  now(), now() - r.age, now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', '', '', '', ''
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'ana@letsride.dev',   interval '40 days'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'bruno@letsride.dev', interval '30 days'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'chiara@letsride.dev',interval '20 days'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'dieter@letsride.dev',interval '10 days')
) as r(id, email, age);

-- `handle_new_user` has already created a profile row per user, holding nothing
-- but the id — since 003 the trigger deliberately leaves every rider
-- mid-onboarding. Finishing them here is not a shortcut around the wizard: the
-- onboarding and participation guards bind the `authenticated` role only,
-- precisely so the table owner can repair rows.
--
-- terms_version comes from private.current_terms_version() rather than a
-- literal, so these rows stay correct the day the owner replaces the
-- placeholder — 030 says that function is the only place the value lives.
update public.profiles p set
  username                = v.username,
  location                = v.location,
  bio                     = v.bio,
  bike_model              = v.bike_model,
  terms_accepted_at       = now() - interval '1 day',
  terms_version           = private.current_terms_version(),
  onboarding_completed_at = now() - interval '1 day'
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'anaroads',    'Lisbon',    'Coastal roads and long lunches.',        'Yamaha Ténéré 700'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'brunorides',  'Porto',     'Weekend twisties, weekday commute.',     'Honda CB650R'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'chiaramoto', 'Amsterdam', 'Rain is just weather.',                  'BMW R nineT'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'dieterk',     'Berlin',    'Two wheels, no hurry.',                  'Ducati Scrambler')
) as v(id, username, location, bio, bike_model)
where p.id = v.id;

-- ---------------------------------------------------------------------------
-- 3. A club, with the owner-membership row that createClub cannot guarantee
-- ---------------------------------------------------------------------------
-- Written as two inserts here for the same reason the app does it — there is no
-- transactional helper yet. That gap is the known issue behind
-- openspec/changes/enforce-creator-membership/; a seed running in one psql
-- transaction is not evidence that the app's path is safe.
insert into public.clubs (id, name, description, is_public, owner_id, created_at)
values
  ('aaaaaaaa-0000-4000-8000-00000000aaaa', 'Atlantic Coast Riders',
   'Sunday runs along the coast. All bikes, all paces.', true,
   '11111111-1111-4111-8111-111111111111', now() - interval '35 days'),
  ('bbbbbbbb-0000-4000-8000-00000000bbbb', 'Rain or Shine MC',
   'A small private club for all-weather commuters.', false,
   '33333333-3333-4333-8333-333333333333', now() - interval '15 days');

insert into public.club_members (club_id, user_id, role, joined_at) values
  ('aaaaaaaa-0000-4000-8000-00000000aaaa', '11111111-1111-4111-8111-111111111111', 'owner',  now() - interval '35 days'),
  ('aaaaaaaa-0000-4000-8000-00000000aaaa', '22222222-2222-4222-8222-222222222222', 'admin',  now() - interval '28 days'),
  ('aaaaaaaa-0000-4000-8000-00000000aaaa', '33333333-3333-4333-8333-333333333333', 'member', now() - interval '12 days'),
  ('bbbbbbbb-0000-4000-8000-00000000bbbb', '33333333-3333-4333-8333-333333333333', 'owner',  now() - interval '15 days'),
  ('bbbbbbbb-0000-4000-8000-00000000bbbb', '44444444-4444-4444-8444-444444444444', 'member', now() - interval '9 days');

-- `admin` is seeded on purpose: club_members.role has accepted it since 001 and
-- nothing in the app has ever written one, so the admin-only paths have never
-- been rendered against a real row. DEV is where that gets noticed.

-- ---------------------------------------------------------------------------
-- 4. Rides — future-dated so they appear in the default list
-- ---------------------------------------------------------------------------
-- `max_riders` was here until 077 dropped the column (PD-293). Not replaced by
-- anything: there is no crew ceiling in this product, so a seeded ride carries
-- no cap field to keep in step.
insert into public.rides (id, title, description, meeting_point, departure_at, is_public, organizer_id, club_id, created_at)
values
  ('cccccccc-0000-4000-8000-00000000ccc1', 'Serra da Arrábida loop',
   'Coast road out, hills back. Coffee at the top.', 'Cais do Sodré, Lisbon',
   now() + interval '3 days', true,
   '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-00000000aaaa', now() - interval '5 days'),
  ('cccccccc-0000-4000-8000-00000000ccc2', 'Early breakfast run',
   'Short one. Back before the traffic.', 'Ponte da Arrábida, Porto',
   now() + interval '9 days', true,
   '22222222-2222-4222-8222-222222222222', null, now() - interval '2 days'),
  ('cccccccc-0000-4000-8000-00000000ccc3', 'Wet weather practice',
   'Members only. Bring proper gear.', 'Sloterdijk, Amsterdam',
   now() + interval '14 days', false,
   '33333333-3333-4333-8333-333333333333', 'bbbbbbbb-0000-4000-8000-00000000bbbb', now() - interval '1 day');

insert into public.ride_members (ride_id, user_id, status, joined_at) values
  ('cccccccc-0000-4000-8000-00000000ccc1', '11111111-1111-4111-8111-111111111111', 'going', now() - interval '5 days'),
  ('cccccccc-0000-4000-8000-00000000ccc1', '22222222-2222-4222-8222-222222222222', 'going', now() - interval '4 days'),
  ('cccccccc-0000-4000-8000-00000000ccc1', '33333333-3333-4333-8333-333333333333', 'maybe', now() - interval '3 days'),
  ('cccccccc-0000-4000-8000-00000000ccc2', '22222222-2222-4222-8222-222222222222', 'going', now() - interval '2 days'),
  ('cccccccc-0000-4000-8000-00000000ccc3', '33333333-3333-4333-8333-333333333333', 'going', now() - interval '1 day'),
  ('cccccccc-0000-4000-8000-00000000ccc3', '44444444-4444-4444-8444-444444444444', 'going', now() - interval '12 hours');

-- ---------------------------------------------------------------------------
-- 5. Postcards — rows only; the images are absent, see the header
-- ---------------------------------------------------------------------------
-- club_id IS the audience: NULL is the app-wide feed, set is that club's
-- members. There is deliberately no is_public flag. Both are seeded so the
-- filter tiles have something to filter.
insert into public.postcards (id, author_id, club_id, caption, image_path, created_at, updated_at)
values
  ('dddddddd-0000-4000-8000-00000000ddd1', '11111111-1111-4111-8111-111111111111',
   null, 'First proper sun of the year.',
   'postcards/11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-0000000000d1.jpg',
   now() - interval '6 days', now() - interval '6 days'),
  ('dddddddd-0000-4000-8000-00000000ddd2', '22222222-2222-4222-8222-222222222222',
   'aaaaaaaa-0000-4000-8000-00000000aaaa', 'Club run, back row as always.',
   'postcards/22222222-2222-4222-8222-222222222222/00000000-0000-4000-8000-0000000000d2.jpg',
   now() - interval '4 days', now() - interval '4 days'),
  ('dddddddd-0000-4000-8000-00000000ddd3', '33333333-3333-4333-8333-333333333333',
   null, 'Amsterdam, predictably.',
   'postcards/33333333-3333-4333-8333-333333333333/00000000-0000-4000-8000-0000000000d3.jpg',
   now() - interval '2 days', now() - interval '2 days'),
  ('dddddddd-0000-4000-8000-00000000ddd4', '44444444-4444-4444-8444-444444444444',
   null, 'New bike day.',
   'postcards/44444444-4444-4444-8444-444444444444/00000000-0000-4000-8000-0000000000d4.jpg',
   now() - interval '18 hours', now() - interval '18 hours');

insert into public.postcard_likes (postcard_id, user_id) values
  ('dddddddd-0000-4000-8000-00000000ddd1', '22222222-2222-4222-8222-222222222222'),
  ('dddddddd-0000-4000-8000-00000000ddd1', '33333333-3333-4333-8333-333333333333'),
  ('dddddddd-0000-4000-8000-00000000ddd4', '11111111-1111-4111-8111-111111111111');

insert into public.postcard_comments (postcard_id, author_id, body, created_at) values
  ('dddddddd-0000-4000-8000-00000000ddd1', '33333333-3333-4333-8333-333333333333',
   'Jealous. It is raining here.', now() - interval '5 days'),
  ('dddddddd-0000-4000-8000-00000000ddd4', '22222222-2222-4222-8222-222222222222',
   'Congrats! What is it?', now() - interval '12 hours');

-- ---------------------------------------------------------------------------
-- 6. What landed
-- ---------------------------------------------------------------------------
do $$
declare
  n_users integer; n_clubs integer; n_rides integer; n_cards integer;
begin
  select count(*) into n_users from auth.users where email like '%@letsride.dev';
  select count(*) into n_clubs from public.clubs;
  select count(*) into n_rides from public.rides;
  select count(*) into n_cards from public.postcards;
  raise notice 'Seeded % rider(s), % club(s), % ride(s), % postcard(s).', n_users, n_clubs, n_rides, n_cards;
  raise notice 'Sign in as ana@letsride.dev with the password passed as -v seed_password.';
  raise notice 'Postcard images are NOT present — post one through the app to see a real thumbnail.';
end
$$;
