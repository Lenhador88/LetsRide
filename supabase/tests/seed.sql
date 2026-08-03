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
  ('00000000-0000-0000-0000-00000000000e', 'rookie@example.com'),
  ('00000000-0000-0000-0000-00000000001a', 'blocker@example.com'),
  ('00000000-0000-0000-0000-00000000001b', 'blocked@example.com');

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

-- ---------------------------------------------------------------------------
-- 009: postcards, likes and blocks
-- ---------------------------------------------------------------------------
-- Two more onboarded riders, in a block relationship. Everything below is
-- built on a fresh club (c4) and fresh rides (d3, d4) rather than on c2/d2,
-- so the pre-009 roster counts the suite already asserts stay exactly as they
-- were. A fixture that quietly changes an existing assertion's expected value
-- makes it impossible to tell a regression from a rewrite.

update profiles set username = 'blocker', location = 'Madrid',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000001a';
update profiles set username = 'blocked', location = 'Seville',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000001b';

-- The block itself: one directional row, symmetric in effect.
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000001b');

-- A public club holding the owner plus both sides of the block, so the roster
-- assertions can show each of them vanishing for the other while staying
-- visible to an unrelated rider.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000000c4', 'Block Test Club', true, '00000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000001a', 'member'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000001b', 'member');

-- A public ride with the same three in the crew.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-0000000000d3', 'Block Test Run', 'The Cafe', now() + interval '3 days',
   true, '00000000-0000-0000-0000-00000000000a');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-00000000000a', 'going'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-00000000001a', 'going'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-00000000001b', 'going');

-- A public ride ORGANISED by the blocked rider: the whole ride has to leave the
-- blocker's feed, not just the byline.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-0000000000d4', 'Blocked Rider Run', 'The Wall', now() + interval '4 days',
   true, '00000000-0000-0000-0000-00000000001b');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-00000000001b', 'going');

-- An accepted friendship spanning the block, to prove the row disappears for
-- both parties rather than only for the one who pressed the button.
insert into friendships (id, requester_id, addressee_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000001a',
   '00000000-0000-0000-0000-00000000001b', 'accepted');
-- A control friendship with no block anywhere near it.
insert into friendships (id, requester_id, addressee_id, status) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-00000000000c', 'accepted');

-- A club the primary rider (000a) is NOT a member of. Every other club in this
-- seed has 000a as owner, which left "cannot post into a club you do not belong
-- to" unassertable — the assertion that reached for c4 was really testing a club
-- 000a owns, so it passed the write and failed the test.
--
-- Deliberately PUBLIC: 000a can see it, so a refusal here is provably about
-- membership rather than visibility. That is the case the insert/update WITH
-- CHECK exists to stop.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000000c5', 'Outsiders MC', true, '00000000-0000-0000-0000-00000000000b');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-00000000000b', 'owner');

-- Postcards.
--   e1  global, by the club owner            -- the ordinary feed case
--   e2  scoped to the PRIVATE club c1        -- members only
--   e3  global, by the blocked rider         -- must vanish for the blocker
--   e4  global, by the blocker               -- must vanish for the blocked rider
--   e5  scoped to c1 but authored by the OUTSIDER, who is not a member of c1.
--       Not reachable through the insert policy — inserted here as superuser to
--       model a rider who posted while a member and later left. It is the only
--       fixture that exercises the unconditional author branch of the select
--       policy in isolation from every other branch.
insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a',
   null, 'postcards/000a/dawn.jpg', 'Sunrise on the N222'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000c1', 'postcards/000a/secret.jpg', 'Club only'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000001b',
   null, 'postcards/001b/coast.jpg', 'From the blocked rider'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000001a',
   null, 'postcards/001a/hills.jpg', 'From the blocker'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000000c',
   '00000000-0000-0000-0000-0000000000c1', 'postcards/000c/left.jpg', 'Posted before I left');

-- Two likes on the same globally visible postcard: one from the blocked rider,
-- one from an unrelated rider. The blocker must see a count of 1, everyone else 2.
insert into postcard_likes (postcard_id, user_id) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000001b'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c');

-- ---------------------------------------------------------------------------
-- 010: postcard image storage
-- ---------------------------------------------------------------------------
-- One storage.objects row per postcards fixture above, at the exact same
-- image_path, so "can I read this object" and "can I read the postcard it
-- belongs to" are assertions about the same visibility predicate rather than
-- two independently-seeded stories that happen to agree.
--
-- The `media` bucket itself is not created here — migration 010 already did
-- that, and re-inserting it would collide with its primary key.

insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'postcards/000a/dawn.jpg',   '00000000-0000-0000-0000-00000000000a',
   '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'postcards/000a/secret.jpg', '00000000-0000-0000-0000-00000000000a',
   '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'postcards/001b/coast.jpg',  '00000000-0000-0000-0000-00000000001b',
   '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'postcards/001a/hills.jpg',  '00000000-0000-0000-0000-00000000001a',
   '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'postcards/000c/left.jpg',   '00000000-0000-0000-0000-00000000000c',
   '{"mimetype":"image/jpeg","size":1024}');
