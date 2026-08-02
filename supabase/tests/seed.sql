-- Fixtures, inserted as superuser so RLS does not apply. Profiles are created
-- by the handle_new_user trigger rather than inserted directly, which keeps the
-- signup path itself under test.
--
-- Since 003 the trigger inserts nothing but the id, so every profile starts out
-- mid-onboarding with a NULL username. The riders that need to be visible to
-- each other are finished off explicitly below. That is not a shortcut around
-- the wizard: enforce_onboarding_completion() only binds the `authenticated`
-- role, precisely so the table owner and service_role can repair rows.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'member@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outsider@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'halfway@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'rookie@example.com');

-- Three fully onboarded riders. The completion timestamp is a fixed literal so
-- the one-way-door assertions can compare against it exactly.
update profiles set username = 'clubowner',  location = 'Lisbon',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000000a';
update profiles set username = 'clubmember', location = 'Porto',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000000b';
update profiles set username = 'outsider',   location = 'Faro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000000c';

-- Mid-onboarding, step 2: username chosen, location not. Visible to other
-- riders (the ghost-row policy keys on username, not on completion) but still
-- gated out of the app.
update profiles set username = 'halfway',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000000d';

-- Mid-onboarding, step 1: nothing chosen yet. Left exactly as the trigger made
-- it — this is the ghost row the select policy has to hide.

-- A private club with one member besides the owner.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'Secret Riders', false, '00000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b', 'member');

-- A public club, so the suite can tell "locked down" apart from "broken".
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000000c2', 'Open Riders', true, '00000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'owner');

-- A club-only ride: not public, belongs to the private club.
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dawn Run', 'The Bridge', now() + interval '1 day',
   false, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 'going');

-- A public ride.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-0000000000d2', 'Coast Run', 'The Pier', now() + interval '2 days',
   true, '00000000-0000-0000-0000-00000000000a');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000a', 'going');
