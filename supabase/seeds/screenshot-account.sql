-- Screenshot seed — one curated rider and the content their signed-in view
-- shows, so a simulator pointed at DEV can be photographed for the App Store
-- listing (PD-448, feeding PD-232).
--
-- ===========================================================================
-- THIS MUST NEVER RUN AGAINST PRODUCTION. The guard in section 0 is the
-- enforcement, not this comment. Read it before changing anything.
-- ===========================================================================
--
--   PGPASSWORD=... psql "$DEV_DATABASE_URL" \
--     -v ON_ERROR_STOP=1 -v seed_password="$(openssl rand -base64 18)" \
--     -f supabase/seeds/screenshot-account.sql
--
--   node scripts/dev/seed-screenshot-media.mjs      # then this — see §What this file cannot do
--
-- ---------------------------------------------------------------------------
-- Why this is a SECOND seed rather than an option on the first
-- ---------------------------------------------------------------------------
-- `supabase/seeds/development.sql` is a RESET: it aborts if `auth.users` holds
-- one row it did not create, then deletes and rebuilds. Its header says "There
-- is no override, on purpose", and that guard has been refusing on DEV since
-- 2026-08-06, because DEV carries the product owner's own account. It is
-- correct and this file does not weaken, extend or reuse it.
--
-- So this one is ADDITIVE. It owns five fixed uuids and nothing else: it
-- deletes those five accounts, rebuilds them and their content, and touches no
-- row it did not create. Every id below is a literal for exactly that reason —
-- a re-run is a delete of a known set, never a `where email like`.
--
-- The one exception is section 7, which writes `postcard_hides` rows FOR THE
-- SEEDED RIDER over other people's postcards. That is a per-viewer flag, not a
-- deletion: it changes what one seeded account sees and is invisible to every
-- other rider, including the author. See section 7 for why the deck needs it.
--
-- ---------------------------------------------------------------------------
-- The guard, and why it is shaped like this
-- ---------------------------------------------------------------------------
-- The first seed's guard cannot be borrowed: it reads "no account this seed did
-- not create", which is false on DEV today. This one asks two independent
-- questions instead, and PROD fails both:
--
--   1. At least one `@letsride.dev` account exists. Those are minted by the
--      walk and by the first seed, on DEV only; PROD has never held one and
--      cannot start, because nothing points the walk at PROD. It is a POSITIVE
--      marker of DEV rather than a negative one of PROD, which is the half that
--      survives PROD growing new kinds of account.
--   2. No `@letsride.test` account exists. Those two rows are PROD's, recorded
--      in `docs/HANDOFF.md` §Test accounts and due for deletion before launch —
--      so this arm is the one that expires, and arm 1 is why that is safe.
--
-- **The caveat, stated rather than papered over:** on a brand-new DEV with no
-- fixtures at all, arm 1 refuses. That is one deliberate step (run the walk
-- once, or the reset seed) and not an override. After this file's own first
-- successful run the marker is present by construction, since it creates five
-- `@letsride.dev` accounts itself.
--
-- ---------------------------------------------------------------------------
-- What this file cannot do, and what the media script does about it
-- ---------------------------------------------------------------------------
-- **Images.** `image_path`, `avatar_path`, `cover_image_path` and the two ride
-- map columns are Storage object paths, and SQL cannot upload a JPEG. A row
-- whose object is missing renders the literal grey panel "This photo could not
-- be loaded", which is worse in a screenshot than an empty state. So this file
-- writes the paths and `scripts/dev/seed-screenshot-media.mjs` puts bytes at
-- them, signing in as each rider under ordinary RLS — there is no service-role
-- key here and decision #8 says there must not be.
--
-- **Map tiles.** `rides.latitude`, `longitude`, `geocode_confidence`,
-- `map_card_path` and `map_detail_path` are left NULL on purpose. The
-- `resolve-ride-location` Edge Function is the only thing that produces a real
-- tile, and the same script invokes it per ride exactly as `createRide` does.
-- Writing a coordinate here would only make `051`'s coupling CHECK demand a
-- confidence score this file has no way to earn.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. The guard
-- ---------------------------------------------------------------------------
do $$
declare
  dev_fixtures integer;
  prod_fixtures integer;
begin
  select count(*) into dev_fixtures  from auth.users where email like '%@letsride.dev';
  select count(*) into prod_fixtures from auth.users where email like '%@letsride.test';

  if prod_fixtures > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format('REFUSING TO SEED: %s @letsride.test account(s) exist.', prod_fixtures),
      detail  = 'Those two rows are PRODUCTION''s, per docs/HANDOFF.md §Test accounts.',
      hint    = 'You are pointed at the wrong database. Check DEV_DATABASE_URL.';
  end if;

  if dev_fixtures = 0 then
    raise exception using
      errcode = 'raise_exception',
      message = 'REFUSING TO SEED: no @letsride.dev account exists, so this does not look like DEV.',
      detail  = 'Every DEV database carries walk fixtures; production has never held one.',
      hint    = 'If this really is a fresh DEV, run the walk once (npm run walk) and re-run this file.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Reset — the five accounts this file owns, and nothing else
-- ---------------------------------------------------------------------------
-- `profiles.id` cascades from `auth.users`, and `clubs.owner_id`,
-- `rides.organizer_id`, `postcards.author_id`, `club_threads.author_id` and
-- `club_messages.author_id` all cascade from `profiles` — so this one statement
-- removes every row below and reaches nothing else.
--
-- `private.reap_ownerless_club` fires on the cascaded postcard and ride
-- deletions, and cannot touch a pre-existing club: it deletes only a club whose
-- `owner_id` is already NULL and which has no members, postcards, rides or
-- threads left. The seeded clubs are gone by then for the same reason their
-- owner is.
--
-- **That reaches only seeded rows while nothing else writes as these accounts**,
-- which is a property of how they are used rather than of the cascade. Signing
-- in as `sofiarides` and joining a residue club would put a foreign `club_id`
-- in the next re-run's cascade — where `reap_ownerless_club` still cannot fire,
-- since that club keeps its owner. Measured 0 on DEV 2026-09-08, after three
-- walk runs as the seeded rider; the walk's write phases clean up after
-- themselves. Re-measure rather than trust it:
--
--   select count(*) from public.club_members m
--    where m.user_id::text like '5c0f1a00-000%'
--      and m.club_id::text not like '5c0f1a00-0100%';   -- 0
--
-- Storage objects are NOT removed — `delete from storage.objects` is refused by
-- Supabase's own guard, and the paths below are fixed, so a re-run reuses the
-- objects that are already there. `scripts/dev/seed-screenshot-media.mjs` skips
-- a path that already holds an object rather than colliding with it.
delete from auth.users where id in (
  '5c0f1a00-0001-4000-8000-000000000001',
  '5c0f1a00-0002-4000-8000-000000000002',
  '5c0f1a00-0003-4000-8000-000000000003',
  '5c0f1a00-0004-4000-8000-000000000004',
  '5c0f1a00-0005-4000-8000-000000000005'
);

-- ---------------------------------------------------------------------------
-- 2. The riders
-- ---------------------------------------------------------------------------
-- Five, not one. The screenshot account is `sofiarides`; the other four exist
-- because a club with one member, a discussion with one voice and a postcard
-- with no likes photograph as an empty app rather than a used one.
--
-- Every token column is '' and never NULL. GoTrue scans these into non-nullable
-- Go strings, so a NULL turns every login into "Invalid login credentials" — a
-- failure that reads like a wrong password and has cost this project real time
-- before (docs/HANDOFF.md §Test accounts).
--
-- `@letsride.dev` deliberately: it is the disposable namespace, it is what the
-- guard above reads, and the domain appears on no screen.
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
  ('5c0f1a00-0001-4000-8000-000000000001'::uuid, 'sofia@letsride.dev', interval '400 days'),
  ('5c0f1a00-0002-4000-8000-000000000002'::uuid, 'jonas@letsride.dev', interval '320 days'),
  ('5c0f1a00-0003-4000-8000-000000000003'::uuid, 'lieke@letsride.dev', interval '260 days'),
  ('5c0f1a00-0004-4000-8000-000000000004'::uuid, 'marco@letsride.dev', interval '180 days'),
  ('5c0f1a00-0005-4000-8000-000000000005'::uuid, 'nadia@letsride.dev', interval '90 days')
) as r(id, email, age);

-- `handle_new_user` has already written a profile row per account holding
-- nothing but the id — since `003` the trigger leaves every rider
-- mid-onboarding. Finishing them here is not a shortcut around the wizard: the
-- onboarding and participation guards bind the `authenticated` role only,
-- precisely so the table owner can repair rows. Both stamps are required before
-- section 3 can insert anything at all — `023`'s participation gate refuses a
-- club, ride, postcard, membership, like or comment from a rider missing
-- either.
--
-- terms_version comes from private.current_terms_version() rather than a
-- literal, so these rows stay correct the day the owner replaces the
-- placeholder — `030` says that function is the only place the value lives.
--
-- The avatar and cover paths are pinned to the rider's own uuid by `014`'s
-- CHECKs; `scripts/dev/seed-screenshot-media.mjs` uploads to exactly these.
update public.profiles p set
  username                = v.username,
  location                = v.location,
  home_country            = v.home_country,
  bio                     = v.bio,
  bike_model              = v.bike_model,
  avatar_path             = 'avatars/' || v.id || '/' || v.avatar_object || '.jpg',
  cover_image_path        = case when v.cover_object is null then null
                                 else 'covers/' || v.id || '/' || v.cover_object || '.jpg' end,
  terms_accepted_at       = now() - v.age,
  terms_version           = private.current_terms_version(),
  onboarding_completed_at = now() - v.age
from (values
  ('5c0f1a00-0001-4000-8000-000000000001'::uuid, 'sofiarides',    'Amsterdam', 'NL',
   'Commutes in the rain, plans the long way round for the weekend.', 'Triumph Street Triple 765',
   '5c0f1a00-1001-4000-8000-000000000001'::uuid, '5c0f1a00-1101-4000-8000-000000000001'::uuid,
   interval '399 days'),
  ('5c0f1a00-0002-4000-8000-000000000002'::uuid, 'jonaswrenches', 'Haarlem',   'NL',
   'If it has a carburettor I want to look at it.', 'BMW R 1250 GS',
   '5c0f1a00-1002-4000-8000-000000000002'::uuid, '5c0f1a00-1102-4000-8000-000000000002'::uuid,
   interval '319 days'),
  ('5c0f1a00-0003-4000-8000-000000000003'::uuid, 'liekeontwo',    'Utrecht',   'NL',
   'Weekend twisties, weekday tram.', 'Kawasaki Z900RS',
   '5c0f1a00-1003-4000-8000-000000000003'::uuid, null,
   interval '259 days'),
  ('5c0f1a00-0004-4000-8000-000000000004'::uuid, 'marcodetours',  'Antwerp',   'BE',
   'Never once taken the short way.', 'Moto Guzzi V7',
   '5c0f1a00-1004-4000-8000-000000000004'::uuid, null,
   interval '179 days'),
  ('5c0f1a00-0005-4000-8000-000000000005'::uuid, 'nadiakm',       'Rotterdam', 'NL',
   'New licence, old maps.', 'Honda CB500X',
   '5c0f1a00-1005-4000-8000-000000000005'::uuid, null,
   interval '89 days')
) as v(id, username, location, home_country, bio, bike_model, avatar_object, cover_object, age)
where p.id = v.id;

-- The flag row under the profile. `profiles.home_country` above is a different
-- thing that no screen draws yet (`113`); this is what `ProfileCountries`
-- renders, and it is the one a screenshot of the profile shows.
insert into public.profile_countries (user_id, country_code, created_at) values
  ('5c0f1a00-0001-4000-8000-000000000001', 'NL', now() - interval '399 days'),
  ('5c0f1a00-0001-4000-8000-000000000001', 'BE', now() - interval '250 days'),
  ('5c0f1a00-0001-4000-8000-000000000001', 'DE', now() - interval '180 days'),
  ('5c0f1a00-0001-4000-8000-000000000001', 'FR', now() - interval '60 days');

-- ---------------------------------------------------------------------------
-- 3. Clubs
-- ---------------------------------------------------------------------------
-- The owner's roster row is `103`'s trigger, not this file's — restating it
-- raises 23505 on `club_members_pkey`. The trigger takes the club's own
-- `created_at`, so a seeded owner still joined when their club was created.
--
-- `location_name`/`location_place_id`/`latitude`/`longitude` are all-or-nothing
-- (`066`'s `clubs_location_coupling`), and the two place ids below are REAL —
-- read out of `search-places` on 2026-09-08 rather than invented, because an
-- invented vendor id is a value that looks dereferenceable and is not. They are
-- also what makes these two clubs answer "clubs near you", which reads
-- `clubs.latitude`/`longitude` and nothing else.
insert into public.clubs (
  id, name, description, is_public, owner_id, created_at,
  avatar_path, cover_image_path, location_name, location_place_id, latitude, longitude
) values
  ('5c0f1a00-0100-4000-8000-0000000000a1', 'Noord-Holland Riders',
   'Sunday runs north of the IJ. All bikes, all paces, coffee compulsory.', true,
   '5c0f1a00-0001-4000-8000-000000000001', now() - interval '380 days',
   'club-avatars/5c0f1a00-0001-4000-8000-000000000001/5c0f1a00-2001-4000-8000-000000000001.jpg',
   'club-covers/5c0f1a00-0001-4000-8000-000000000001/5c0f1a00-2101-4000-8000-000000000001.jpg',
   'Amsterdam',
   'geoapify:51df6fb4e386971340595bc4c1eff02f4a40f00101f901c3ba000000000000c00208920309416d7374657264616d',
   52.3745403, 4.8979755),
  ('5c0f1a00-0100-4000-8000-0000000000a2', 'Sunday Espresso Run',
   'Out at eight, back before the shops open. Short, quick, every week.', true,
   '5c0f1a00-0002-4000-8000-000000000002', now() - interval '240 days',
   'club-avatars/5c0f1a00-0002-4000-8000-000000000002/5c0f1a00-2002-4000-8000-000000000002.jpg',
   'club-covers/5c0f1a00-0002-4000-8000-000000000002/5c0f1a00-2102-4000-8000-000000000002.jpg',
   'Haarlem',
   'geoapify:517d1c72d8228e124059ca7a2068bb314a40f00101f901aeb9000000000000c00208920307486161726c656d',
   52.3885317, 4.6388048);

-- `admin` is seeded on purpose: `club_members.role` has accepted it since `001`
-- and the app has never written one, so the admin-only paths have never been
-- rendered against a real row.
insert into public.club_members (club_id, user_id, role, joined_at) values
  ('5c0f1a00-0100-4000-8000-0000000000a1', '5c0f1a00-0002-4000-8000-000000000002', 'admin',  now() - interval '370 days'),
  ('5c0f1a00-0100-4000-8000-0000000000a1', '5c0f1a00-0003-4000-8000-000000000003', 'member', now() - interval '250 days'),
  ('5c0f1a00-0100-4000-8000-0000000000a1', '5c0f1a00-0004-4000-8000-000000000004', 'member', now() - interval '170 days'),
  ('5c0f1a00-0100-4000-8000-0000000000a1', '5c0f1a00-0005-4000-8000-000000000005', 'member', now() - interval '80 days'),
  ('5c0f1a00-0100-4000-8000-0000000000a2', '5c0f1a00-0001-4000-8000-000000000001', 'member', now() - interval '230 days'),
  ('5c0f1a00-0100-4000-8000-0000000000a2', '5c0f1a00-0005-4000-8000-000000000005', 'member', now() - interval '70 days');

-- ---------------------------------------------------------------------------
-- 4. The club discussion
-- ---------------------------------------------------------------------------
-- `116` made `last_activity_at` the timeline's sort key, so it is set to each
-- thread's newest message rather than left at its default — a thread whose
-- messages are backdated and whose activity stamp is `now()` sorts correctly by
-- accident today and wrongly the moment a second thread lands.
insert into public.club_threads (id, club_id, author_id, title, created_at, last_activity_at) values
  ('5c0f1a00-0200-4000-8000-0000000000b1', '5c0f1a00-0100-4000-8000-0000000000a1',
   '5c0f1a00-0002-4000-8000-000000000002', 'Coffee stop before the Afsluitdijk run?',
   now() - interval '9 days', now() - interval '2 days' - interval '4 hours'),
  ('5c0f1a00-0200-4000-8000-0000000000b2', '5c0f1a00-0100-4000-8000-0000000000a1',
   '5c0f1a00-0003-4000-8000-000000000003', 'Spare visor insert, anyone?',
   now() - interval '20 days', now() - interval '11 days');

insert into public.club_messages (id, thread_id, author_id, body, created_at) values
  ('5c0f1a00-0201-4000-8000-0000000000b1', '5c0f1a00-0200-4000-8000-0000000000b1',
   '5c0f1a00-0002-4000-8000-000000000002',
   'Thinking we meet at the windmills and get coffee there rather than halfway. Saves a stop in the wind.',
   now() - interval '9 days'),
  ('5c0f1a00-0202-4000-8000-0000000000b1', '5c0f1a00-0200-4000-8000-0000000000b1',
   '5c0f1a00-0001-4000-8000-000000000001',
   'Works for me. It opens at eight, so we would still be on the dyke before the wind picks up.',
   now() - interval '8 days' - interval '20 hours'),
  ('5c0f1a00-0203-4000-8000-0000000000b1', '5c0f1a00-0200-4000-8000-0000000000b1',
   '5c0f1a00-0005-4000-8000-000000000005',
   'First time on this one for me. Is the crossing as flat as everyone says?',
   now() - interval '4 days'),
  ('5c0f1a00-0204-4000-8000-0000000000b1', '5c0f1a00-0200-4000-8000-0000000000b1',
   '5c0f1a00-0003-4000-8000-000000000003',
   'Flat, straight and 32 km of it. The bit afterwards is the good part.',
   now() - interval '2 days' - interval '4 hours'),
  ('5c0f1a00-0205-4000-8000-0000000000b2', '5c0f1a00-0200-4000-8000-0000000000b2',
   '5c0f1a00-0003-4000-8000-000000000003',
   'Scratched mine on the ferry. Anyone got a spare pinlock lying around before Sunday?',
   now() - interval '20 days'),
  ('5c0f1a00-0206-4000-8000-0000000000b2', '5c0f1a00-0200-4000-8000-0000000000b2',
   '5c0f1a00-0004-4000-8000-000000000004',
   'I have two. Bring me a coffee and it is yours.',
   now() - interval '11 days');

-- ---------------------------------------------------------------------------
-- 5. Rides
-- ---------------------------------------------------------------------------
-- Times are WALL CLOCK at the meeting point, which is what `080` and every
-- `formatRide*` helper mean: the instant is derived from the local date and
-- time in the ride's own zone rather than written as UTC and hoped for.
--
-- Three upcoming and one past, because `/rides` draws upcoming first and then a
-- "Past rides" section, and a screenshot of the section header needs a row
-- under it. **The past one is CLUB-attached for that reason** — `/rides` opens
-- on the `From clubs` tile, so a clubless past ride leaves the default screen
-- with no past section at all. Measured: it did, until the club id landed.
--
-- The organizer's crew row is `103`'s trigger, like the club owner's above.
-- Coordinates and both map paths are deliberately absent — see the header.
--
-- **Every meeting point is a STREET ADDRESS, and that is what makes a tile
-- appear.** `resolve-ride-location`'s first gate is `result_type` in
-- `building`, `amenity` or `street` (`gates.ts` §STREET_LEVEL_RESULT_TYPES), so
-- a town on its own is refused and the ride keeps its fallback panel — measured
-- 2026-09-08 on DEV, where "Apeldoorn, Netherlands" and "Zaanse Schans,
-- Zaandam" both came back with no coordinate at all and "Loolaan 554,
-- Apeldoorn" rendered both tiles. The function fails OPEN, so the only symptom
-- is a missing picture.
insert into public.rides (
  id, title, description, route_description, meeting_point, departure_at, timezone,
  is_public, organizer_id, club_id, created_at
) values
  ('5c0f1a00-0300-4000-8000-0000000000c1', 'Afsluitdijk and back',
   'North over the dyke, lunch in Makkum, the long way home through the polder.',
   'Zaandam · Purmerend · Den Oever · Afsluitdijk · Makkum, and back down the far side.',
   'Kalverringdijk 15, Zaandam',
   ((((now() at time zone 'Europe/Amsterdam')::date + 4)::timestamp + time '09:00') at time zone 'Europe/Amsterdam'),
   'Europe/Amsterdam', true,
   '5c0f1a00-0001-4000-8000-000000000001', '5c0f1a00-0100-4000-8000-0000000000a1',
   now() - interval '12 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c2', 'Sunday espresso run',
   'The usual: out through the dunes, coffee at the end, home before eleven.',
   null,
   'Grote Markt, Haarlem',
   -- The next SUNDAY at least ten days out, not a fixed offset: the title says
   -- Sunday, and a screenshot of a Sunday run dated Saturday is exactly the
   -- detail somebody notices in a store listing.
   ((((now() at time zone 'Europe/Amsterdam')::date + 10
      + ((0 - extract(dow from (now() at time zone 'Europe/Amsterdam')::date + 10)::int + 7) % 7))::timestamp
     + time '08:30') at time zone 'Europe/Amsterdam'),
   'Europe/Amsterdam', true,
   '5c0f1a00-0002-4000-8000-000000000002', '5c0f1a00-0100-4000-8000-0000000000a2',
   now() - interval '6 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c3', 'Ardennes weekender',
   'Two days, one hotel, no motorway. Bring rain gear you actually trust.',
   'South to Maastricht, then the Ourthe valley all Saturday and back over the Hoge Venen.',
   'Vrijthof, Maastricht',
   ((((now() at time zone 'Europe/Amsterdam')::date + 25)::timestamp + time '07:30') at time zone 'Europe/Amsterdam'),
   'Europe/Amsterdam', true,
   '5c0f1a00-0001-4000-8000-000000000001', null,
   now() - interval '3 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c4', 'Veluwe forest loop',
   'Sand, pine and one very slow deer.',
   null,
   'Loolaan 554, Apeldoorn',
   ((((now() at time zone 'Europe/Amsterdam')::date - 6)::timestamp + time '10:00') at time zone 'Europe/Amsterdam'),
   'Europe/Amsterdam', true,
   '5c0f1a00-0001-4000-8000-000000000001', '5c0f1a00-0100-4000-8000-0000000000a1',
   now() - interval '30 days');

insert into public.ride_members (ride_id, user_id, status, joined_at) values
  ('5c0f1a00-0300-4000-8000-0000000000c1', '5c0f1a00-0002-4000-8000-000000000002', 'going', now() - interval '11 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c1', '5c0f1a00-0003-4000-8000-000000000003', 'going', now() - interval '9 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c1', '5c0f1a00-0005-4000-8000-000000000005', 'maybe', now() - interval '4 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c2', '5c0f1a00-0001-4000-8000-000000000001', 'going', now() - interval '5 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c2', '5c0f1a00-0005-4000-8000-000000000005', 'going', now() - interval '2 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c3', '5c0f1a00-0003-4000-8000-000000000003', 'going', now() - interval '2 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c3', '5c0f1a00-0004-4000-8000-000000000004', 'going', now() - interval '1 day'),
  ('5c0f1a00-0300-4000-8000-0000000000c4', '5c0f1a00-0002-4000-8000-000000000002', 'going', now() - interval '29 days'),
  ('5c0f1a00-0300-4000-8000-0000000000c4', '5c0f1a00-0005-4000-8000-000000000005', 'going', now() - interval '28 days');

-- One live invite link on the club ride, because `/rides/detail/invite` and
-- `115`'s anonymous preview both need a token that exists, and without one the
-- walk reports "no live invite link on this ride and none could be created"
-- unless it is run with `WALK_FIXTURES=1` — which is not what you want pointed
-- at a curated account.
--
-- **The token is GENERATED, never a literal.** `115` (PD-430) makes it an
-- anonymous read key for six columns of this ride, so a fixed one committed to
-- a repository is a bearer token in git history. The column's default is
-- `encode(gen_random_bytes(16), 'hex')`; leave it alone. `expires_at` follows
-- the app's own rule — the ride's departure, or two weeks, whichever is first.
insert into public.ride_invite_links (id, ride_id, created_by, expires_at, created_at)
select '5c0f1a00-0600-4000-8000-000000000091',
       r.id, r.organizer_id,
       least(r.departure_at, now() + interval '14 days'),
       now() - interval '2 days'
  from public.rides r where r.id = '5c0f1a00-0300-4000-8000-0000000000c1';

-- The ride's own chat. Without it `/rides/detail/thread` has nothing to open —
-- measured: the walk reported "no threads on that ride" and skipped the screen,
-- which is one fewer screen to photograph and, on any other run, a skip that
-- reads exactly like a pass.
insert into public.ride_threads (id, ride_id, author_id, title, created_at, last_activity_at) values
  ('5c0f1a00-0500-4000-8000-0000000000f1', '5c0f1a00-0300-4000-8000-0000000000c1',
   '5c0f1a00-0001-4000-8000-000000000001', 'Fuel stop and the weather',
   now() - interval '5 days', now() - interval '1 day' - interval '3 hours');

insert into public.ride_thread_messages (id, thread_id, author_id, body, created_at) values
  ('5c0f1a00-0501-4000-8000-0000000000f1', '5c0f1a00-0500-4000-8000-0000000000f1',
   '5c0f1a00-0001-4000-8000-000000000001',
   'Tanks full before we leave, please. The next station after the dyke is a long way on.',
   now() - interval '5 days'),
  ('5c0f1a00-0502-4000-8000-0000000000f1', '5c0f1a00-0500-4000-8000-0000000000f1',
   '5c0f1a00-0003-4000-8000-000000000003',
   'Forecast says dry until four. I am bringing the oversuit anyway.',
   now() - interval '3 days'),
  ('5c0f1a00-0503-4000-8000-0000000000f1', '5c0f1a00-0500-4000-8000-0000000000f1',
   '5c0f1a00-0002-4000-8000-000000000002',
   'Same. See everyone at nine.',
   now() - interval '1 day' - interval '3 hours');

-- ---------------------------------------------------------------------------
-- 6. Postcards
-- ---------------------------------------------------------------------------
-- `club_id` IS the audience: NULL is the app-wide deck, set is that club's
-- members. There is deliberately no `is_public` flag here (`009`).
--
-- The place line under a photo is arm 2 of `072`'s coupling — a name and a
-- precision of 'place', with both coordinates NULL. That is the shape the app
-- writes when a rider picks a town rather than handing over a GPS fix, and it
-- is the one worth photographing.
-- `taken_at_offset_minutes` is DERIVED from the zone rather than written as a
-- literal. A hard-coded 120 is right in CEST and an hour wrong from late
-- October to late March, and this file is built to be re-run before every
-- screenshot session — so the literal would be correct on the day it was
-- written and quietly wrong for four months of the year. `072`'s coupling only
-- checks that the pair moves together, so nothing would have caught it.
-- Measured on DEV: the expression answers 60 for 2026-01-15 and 2026-11-01 and
-- 120 for 2026-07-15, in both zones below.
insert into public.postcards (
  id, author_id, club_id, ride_id, caption, image_path,
  taken_at, taken_at_offset_minutes, taken_place_name, taken_location_precision, taken_country_code,
  created_at, updated_at
)
select
  v.id, v.author_id, v.club_id, v.ride_id, v.caption, v.image_path,
  now() - v.taken_ago,
  ((extract(epoch from ((now() - v.taken_ago) at time zone v.zone))
    - extract(epoch from (now() - v.taken_ago))) / 60)::smallint,
  v.place, 'place', v.country,
  now() - v.posted_ago, now() - v.posted_ago
from (values
  ('5c0f1a00-0400-4000-8000-0000000000d1'::uuid, '5c0f1a00-0001-4000-8000-000000000001'::uuid,
   null::uuid, null::uuid,
   'Low sun the whole way out. Worth the six o''clock alarm.',
   'postcards/5c0f1a00-0001-4000-8000-000000000001/5c0f1a00-3001-4000-8000-000000000001.jpg',
   interval '2 hours', interval '2 hours', 'Afsluitdijk', 'NL', 'Europe/Amsterdam'),
  ('5c0f1a00-0400-4000-8000-0000000000d2'::uuid, '5c0f1a00-0002-4000-8000-000000000002'::uuid,
   null, null,
   'Espresso, then two hundred kilometres of nothing at all.',
   'postcards/5c0f1a00-0002-4000-8000-000000000002/5c0f1a00-3002-4000-8000-000000000002.jpg',
   interval '1 day', interval '1 day', 'Haarlem', 'NL', 'Europe/Amsterdam'),
  ('5c0f1a00-0400-4000-8000-0000000000d3'::uuid, '5c0f1a00-0001-4000-8000-000000000001'::uuid,
   '5c0f1a00-0100-4000-8000-0000000000a1', null,
   'Club run. Back row, as always.',
   'postcards/5c0f1a00-0001-4000-8000-000000000001/5c0f1a00-3003-4000-8000-000000000003.jpg',
   interval '2 days', interval '2 days', 'Zaandam', 'NL', 'Europe/Amsterdam'),
  ('5c0f1a00-0400-4000-8000-0000000000d4'::uuid, '5c0f1a00-0003-4000-8000-000000000003'::uuid,
   null, null,
   'Rain stopped the minute we set off. It does that here.',
   'postcards/5c0f1a00-0003-4000-8000-000000000003/5c0f1a00-3004-4000-8000-000000000004.jpg',
   interval '3 days', interval '3 days', 'Utrecht', 'NL', 'Europe/Amsterdam'),
  ('5c0f1a00-0400-4000-8000-0000000000d5'::uuid, '5c0f1a00-0001-4000-8000-000000000001'::uuid,
   null, '5c0f1a00-0300-4000-8000-0000000000c4',
   'Veluwe, in the trees. Sand everywhere for a week afterwards.',
   'postcards/5c0f1a00-0001-4000-8000-000000000001/5c0f1a00-3005-4000-8000-000000000005.jpg',
   interval '6 days', interval '5 days', 'Apeldoorn', 'NL', 'Europe/Amsterdam'),
  ('5c0f1a00-0400-4000-8000-0000000000d6'::uuid, '5c0f1a00-0004-4000-8000-000000000004'::uuid,
   null, null,
   'Took the detour. Have never once regretted taking the detour.',
   'postcards/5c0f1a00-0004-4000-8000-000000000004/5c0f1a00-3006-4000-8000-000000000006.jpg',
   interval '7 days', interval '7 days', 'Durbuy', 'BE', 'Europe/Brussels'),
  ('5c0f1a00-0400-4000-8000-0000000000d7'::uuid, '5c0f1a00-0005-4000-8000-000000000005'::uuid,
   null, null,
   'First proper trip on the CB. It liked it more than I did.',
   'postcards/5c0f1a00-0005-4000-8000-000000000005/5c0f1a00-3007-4000-8000-000000000007.jpg',
   interval '9 days', interval '9 days', 'Rotterdam', 'NL', 'Europe/Amsterdam')
) as v(id, author_id, club_id, ride_id, caption, image_path,
       taken_ago, posted_ago, place, country, zone);

insert into public.postcard_likes (postcard_id, user_id, created_at) values
  ('5c0f1a00-0400-4000-8000-0000000000d1', '5c0f1a00-0002-4000-8000-000000000002', now() - interval '1 hour'),
  ('5c0f1a00-0400-4000-8000-0000000000d1', '5c0f1a00-0003-4000-8000-000000000003', now() - interval '1 hour'),
  ('5c0f1a00-0400-4000-8000-0000000000d1', '5c0f1a00-0005-4000-8000-000000000005', now() - interval '30 minutes'),
  ('5c0f1a00-0400-4000-8000-0000000000d2', '5c0f1a00-0001-4000-8000-000000000001', now() - interval '20 hours'),
  ('5c0f1a00-0400-4000-8000-0000000000d3', '5c0f1a00-0004-4000-8000-000000000004', now() - interval '1 day'),
  ('5c0f1a00-0400-4000-8000-0000000000d3', '5c0f1a00-0005-4000-8000-000000000005', now() - interval '1 day'),
  ('5c0f1a00-0400-4000-8000-0000000000d5', '5c0f1a00-0002-4000-8000-000000000002', now() - interval '4 days'),
  ('5c0f1a00-0400-4000-8000-0000000000d6', '5c0f1a00-0001-4000-8000-000000000001', now() - interval '6 days'),
  ('5c0f1a00-0400-4000-8000-0000000000d7', '5c0f1a00-0001-4000-8000-000000000001', now() - interval '8 days');

insert into public.postcard_comments (id, postcard_id, author_id, body, created_at, updated_at) values
  ('5c0f1a00-0401-4000-8000-0000000000e1', '5c0f1a00-0400-4000-8000-0000000000d1',
   '5c0f1a00-0003-4000-8000-000000000003', 'That light. Jealous — it was grey the whole way here.',
   now() - interval '90 minutes', now() - interval '90 minutes'),
  ('5c0f1a00-0401-4000-8000-0000000000e2', '5c0f1a00-0400-4000-8000-0000000000d1',
   '5c0f1a00-0005-4000-8000-000000000005', 'Adding this one to the list for next month.',
   now() - interval '45 minutes', now() - interval '45 minutes'),
  ('5c0f1a00-0401-4000-8000-0000000000e3', '5c0f1a00-0400-4000-8000-0000000000d3',
   '5c0f1a00-0002-4000-8000-000000000002', 'Back row is the only row worth being in.',
   now() - interval '1 day', now() - interval '1 day'),
  ('5c0f1a00-0401-4000-8000-0000000000e4', '5c0f1a00-0400-4000-8000-0000000000d7',
   '5c0f1a00-0004-4000-8000-000000000004', 'Congratulations! How did it handle the wind?',
   now() - interval '8 days', now() - interval '8 days');

-- ---------------------------------------------------------------------------
-- 7. Clearing the screenshot rider's deck of everyone else's postcards
-- ---------------------------------------------------------------------------
-- `/postcards` is the home screen, and its app-wide deck is EVERY postcard with
-- a NULL `club_id` from every rider — there is no following graph in this
-- product, so a month of walk residue sits in the same list as the seven above.
-- Most of those rows point at Storage objects that were never uploaded, which
-- renders as the grey "This photo could not be loaded" panel.
--
-- `postcard_hides` is the app's own per-viewer mute (`011`). Writing one here
-- changes what `sofiarides` sees and is invisible to the author and to every
-- other rider — so this is curation of one account's view, not the cleanup the
-- story puts out of scope, and it deletes nothing.
--
-- It hides what exists AT SEED TIME. A postcard posted by a later walk run is
-- not hidden, which is the honest behaviour: re-run this file before a
-- screenshot session and the deck is clean again.
--
-- **Scoped to the app-wide deck** (`club_id is null`), which is the list that
-- carries the residue. Without that predicate it also mutes club postcards the
-- screenshot rider cannot currently see — measured on DEV, 11 rows written
-- where 6 were app-wide — and those five would come back to bite the day
-- somebody joins one of those clubs to photograph a club feed.
insert into public.postcard_hides (postcard_id, user_id, created_at)
select p.id, '5c0f1a00-0001-4000-8000-000000000001', now()
  from public.postcards p
 where p.club_id is null
   and p.author_id not in (
         '5c0f1a00-0001-4000-8000-000000000001',
         '5c0f1a00-0002-4000-8000-000000000002',
         '5c0f1a00-0003-4000-8000-000000000003',
         '5c0f1a00-0004-4000-8000-000000000004',
         '5c0f1a00-0005-4000-8000-000000000005')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. What landed, and what is still missing
-- ---------------------------------------------------------------------------
do $$
declare
  n_riders integer; n_clubs integer; n_rides integer; n_cards integer;
  n_threads integer; n_hidden integer;
begin
  select count(*) into n_riders from auth.users where id in (
    '5c0f1a00-0001-4000-8000-000000000001', '5c0f1a00-0002-4000-8000-000000000002',
    '5c0f1a00-0003-4000-8000-000000000003', '5c0f1a00-0004-4000-8000-000000000004',
    '5c0f1a00-0005-4000-8000-000000000005');
  select count(*) into n_clubs   from public.clubs        where id::text like '5c0f1a00-0100%';
  select count(*) into n_rides   from public.rides        where id::text like '5c0f1a00-0300%';
  select count(*) into n_cards   from public.postcards    where id::text like '5c0f1a00-0400%';
  select count(*) into n_threads from public.club_threads where id::text like '5c0f1a00-0200%';
  select count(*) into n_hidden  from public.postcard_hides
   where user_id = '5c0f1a00-0001-4000-8000-000000000001';

  raise notice 'Seeded % rider(s), % club(s), % thread(s), % ride(s), % postcard(s); % other postcard(s) hidden from the screenshot rider.',
    n_riders, n_clubs, n_threads, n_rides, n_cards, n_hidden;
  raise notice 'Sign in as sofia@letsride.dev with the password passed as -v seed_password.';
  raise notice 'NOT DONE YET: no image object and no map tile exists. Run scripts/dev/seed-screenshot-media.mjs next, or every photo renders as a grey panel.';
end
$$;
