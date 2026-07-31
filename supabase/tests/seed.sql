-- Fixtures, inserted as superuser so RLS does not apply. Profiles are created
-- by the handle_new_user trigger rather than inserted directly, which keeps the
-- signup path itself under test.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com',    '{"full_name":"Club Owner"}'::jsonb),
  ('00000000-0000-0000-0000-00000000000b', 'member@example.com',   '{"full_name":"Club Member"}'::jsonb),
  ('00000000-0000-0000-0000-00000000000c', 'outsider@example.com', '{"full_name":"Outsider"}'::jsonb);

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
