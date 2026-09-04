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

-- Mid-onboarding: consent given and a username chosen, but no completion stamp.
-- Visible to other riders (the ghost-row policy keys on username, not on
-- completion) but still gated out of the app. NOT "step 2 of 2" any more —
-- `075` (PD-286) made the username step the one that completes onboarding, so
-- this row is now a rider whose completion write did not land rather than one
-- with a screen left to fill in. It is kept because that state is still
-- reachable and the policies still have to answer for it.
update profiles set username = 'halfway',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000000d';

-- Mid-onboarding, step 1: nothing chosen yet. Left exactly as the trigger made
-- it — this is the ghost row the select policy has to hide.

-- ---------------------------------------------------------------------------
-- 103: the creator's own membership row is NO LONGER SEEDED HERE
-- ---------------------------------------------------------------------------
-- `establish_club_owner_membership` and `establish_ride_organizer_membership`
-- are AFTER INSERT triggers with NO `WHEN` clause, so they bind this file
-- exactly as they bind the browser — that is the point of `022`'s shape. Every
-- `insert into clubs` below therefore already carries its `(club_id, owner_id,
-- 'owner')` row by the time the next statement runs, and re-stating it here
-- raises 23505 on `club_members_pkey`.
--
-- ** So an owner/organizer row absent from this file is the trigger's, not an
-- omission. ** Every roster and crew count the suite asserts is unchanged: the
-- trigger writes the same row with the same role, differing only in `joined_at`,
-- which it takes from the parent's `created_at` rather than from this
-- statement's `now()` — a few microseconds earlier, and the same ordering.

-- A private club with one member besides the owner.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'Secret Riders', false, '00000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b', 'member');

-- A public club, so the suite can tell "locked down" apart from "broken".
-- Its owner row is 103's; see above.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000000c2', 'Open Riders', true, '00000000-0000-0000-0000-00000000000a');

-- A club-only ride: not public, belongs to the private club. Its organizer crew
-- row is 103's.
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dawn Run', 'The Bridge', now() + interval '1 day',
   false, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a');

-- A public ride.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-0000000000d2', 'Coast Run', 'The Pier', now() + interval '2 days',
   true, '00000000-0000-0000-0000-00000000000a');

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
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000001a', 'member'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000001b', 'member');

-- A public ride with the same three in the crew.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-0000000000d3', 'Block Test Run', 'The Cafe', now() + interval '3 days',
   true, '00000000-0000-0000-0000-00000000000a');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-00000000001a', 'going'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-00000000001b', 'going');

-- A public ride ORGANISED by the blocked rider: the whole ride has to leave the
-- blocker's feed, not just the byline.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-0000000000d4', 'Blocked Rider Run', 'The Wall', now() + interval '4 days',
   true, '00000000-0000-0000-0000-00000000001b');

-- The two friendship fixtures here were dropped with the table in 013.

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
   null, 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg', 'Sunrise on the N222'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000c1', 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dec2.jpg', 'Club only'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000001b',
   null, 'postcards/00000000-0000-0000-0000-00000000001b/bbbbbbbb-0000-4000-8000-00000000c0a5.jpg', 'From the blocked rider'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000001a',
   null, 'postcards/00000000-0000-0000-0000-00000000001a/cccccccc-0000-4000-8000-000000001115.jpg', 'From the blocker'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000000c',
   '00000000-0000-0000-0000-0000000000c1', 'postcards/00000000-0000-0000-0000-00000000000c/dddddddd-0000-4000-8000-000000001ef7.jpg', 'Posted before I left');

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
  ('media', 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg',   '00000000-0000-0000-0000-00000000000a',
   '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dec2.jpg', '00000000-0000-0000-0000-00000000000a',
   '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'postcards/00000000-0000-0000-0000-00000000001b/bbbbbbbb-0000-4000-8000-00000000c0a5.jpg',  '00000000-0000-0000-0000-00000000001b',
   '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'postcards/00000000-0000-0000-0000-00000000001a/cccccccc-0000-4000-8000-000000001115.jpg',  '00000000-0000-0000-0000-00000000001a',
   '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'postcards/00000000-0000-0000-0000-00000000000c/dddddddd-0000-4000-8000-000000001ef7.jpg',   '00000000-0000-0000-0000-00000000000c',
   '{"mimetype":"image/jpeg","size":1024}');

-- ---------------------------------------------------------------------------
-- 011: comments and reports
-- ---------------------------------------------------------------------------
-- No new riders, clubs or postcards. Everything below hangs off fixtures that
-- already exist, precisely so no assertion written before 011 changes its
-- expected value — the rule this file's 009 section states and the reason the
-- block story got its own club and rides.
--
-- NOTHING SEEDS A HIDE. A hide row changes what its owner can see, so seeding
-- one would silently move the postcard counts every earlier section asserts.
-- The hide story is written live inside rls_test.sql instead, which also puts
-- the INSERT policy under test rather than routing around it as superuser.
--
-- Comments, on postcards that already carry the visibility stories worth
-- inheriting:
--   cc1  on e1 (global)         by the club member  -- the ordinary case
--   cc2  on e2 (PRIVATE club c1) by the club member  -- an outsider must not see it
--   cc3  on e1                  by the blocked rider -- must vanish for the blocker
--   cc4  on e1                  by the blocker       -- must vanish for the blocked rider
insert into postcard_comments (id, postcard_id, author_id, body) values
  ('00000000-0000-0000-0000-000000000cc1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-00000000000b', 'Beautiful light on that road.'),
  ('00000000-0000-0000-0000-000000000cc2', '00000000-0000-0000-0000-0000000000e2',
   '00000000-0000-0000-0000-00000000000b', 'See you all on Sunday.'),
  ('00000000-0000-0000-0000-000000000cc3', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-00000000001b', 'From the blocked rider.'),
  ('00000000-0000-0000-0000-000000000cc4', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-00000000001a', 'From the blocker.');

-- One report, by the outsider against the globally visible postcard e1. Enough
-- to prove both halves that matter: nobody else can read it, and the same
-- rider cannot file it twice.
insert into postcard_reports (id, reporter_id, postcard_id, reason, note) values
  ('00000000-0000-0000-0000-000000000ff1', '00000000-0000-0000-0000-00000000000c',
   '00000000-0000-0000-0000-0000000000e1', 'spam', 'Posted the same photo four times.');

-- ---------------------------------------------------------------------------
-- 014: profile avatars, covers and countries
-- ---------------------------------------------------------------------------
-- Hung off the block pair (1a/1b) rather than the club fixtures, so the
-- assertions can show a profile's media and countries vanishing for the rider
-- on the other side of a block while staying visible to an unrelated one —
-- and so none of the pre-014 counts move.
--
-- The paths are written by hand at the exact shape 014's CHECK constraints
-- demand. That is deliberate: if the constraint and the app's path builder ever
-- disagree, a fixture written to the *constraint* is what catches it, whereas
-- one generated by the builder would agree with itself and prove nothing.
update profiles
   set avatar_path      = 'avatars/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f1.jpg',
       cover_image_path = 'covers/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f2.jpg'
 where id = '00000000-0000-0000-0000-00000000001a';

insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'avatars/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f1.jpg',
   '00000000-0000-0000-0000-00000000001a', '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'covers/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f2.jpg',
   '00000000-0000-0000-0000-00000000001a', '{"mimetype":"image/jpeg","size":2048}');

-- The blocker has ridden in two countries; the club owner in one. Two riders
-- rather than one so a "can see countries" assertion cannot pass by counting
-- every row in the table.
insert into profile_countries (user_id, country_code) values
  ('00000000-0000-0000-0000-00000000001a', 'NL'),
  ('00000000-0000-0000-0000-00000000001a', 'DE'),
  ('00000000-0000-0000-0000-00000000000a', 'PT');
