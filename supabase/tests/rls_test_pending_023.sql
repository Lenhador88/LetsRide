-- Assertions for migration 023, which is written and deliberately NOT deployed.
--
-- ---------------------------------------------------------------------------
-- How to run it, and why there are two of these files rather than one
-- ---------------------------------------------------------------------------
--
--   PENDING=023     npm test  # applies 023, skips 025, runs this file
--   PENDING=025     npm test  # applies 025, skips 023, runs rls_test_pending_025.sql
--   PENDING=023+025 npm test  # applies BOTH, runs rls_test_pending_023_025.sql
--
-- Each runs **instead of** rls_test.sql, for one reason that still stands and
-- one that no longer does:
--
--   1. **Still true.** 025 turns roughly twenty of rls_test.sql's own assertions
--      red. 003's and 012's stamp assertions read `terms_accepted_at` and
--      `onboarding_completed_at` directly as the caller, which is exactly the
--      column SELECT 025 revokes. When 025 lands with its code repair, those
--      assertions move to the accessor and rls_test_pending_025.sql merges back
--      into rls_test.sql.
--
--   2. **RESOLVED 2026-08-05.** This note used to read: "021 and 023 cannot both
--      hold as drafted. 023 refuses every write from a rider whose two stamps
--      are not set; 021 removes the only path by which a client ever sets either
--      one. Applied together, no rider can become qualified to participate and
--      the wizard is a dead end." That was found by writing a single pending
--      suite and watching the onboarding-completes assertion fail with
--      "permission denied for table profiles", so it was a real finding and the
--      fix had to be real too. `021` was split: its `accept_terms()` and
--      `complete_onboarding(text)` are applied and give the database the write
--      path, and only its revoke stays pending, as `025`. The pair that must
--      compose is 023 and 025, and `PENDING=023+025` is the mode that proves it.
--
-- **This file models 023 WITHOUT the revoke**, which is a real state — it is what
-- the database looks like between applying 023 and applying 025. So the direct
-- stamp UPDATEs below are refused as 23514 by 023's guard rather than as 42501 by
-- a missing grant. The combined suite asserts the other shape, deliberately.
--
-- Everything here uses harness.sql's identity idiom — `set_config('test.uid', …)`,
-- which is what the harness's `auth.uid()` reads. The hosted database uses
-- `request.jwt.claims` instead, and setting the wrong one is read by nothing:
-- `auth.uid()` returns NULL, every *positive* assertion passes while proving
-- nothing, and only the negatives fail.

\set ON_ERROR_STOP on
begin;

-- Every assertion runs as `authenticated`, never as the table owner, which
-- bypasses RLS and would pass while testing nothing.
set role authenticated;
select assert_eq(current_user::text, 'authenticated', 'the suite runs as authenticated');
reset role;

-- ===========================================================================
-- Fixtures this file adds
-- ===========================================================================
--
-- seed.sql gives every finished rider BOTH stamps and the two unfinished ones
-- neither-or-consent-only, so it cannot express "onboarded but never consented"
-- — which is the state 3 of the 4 live riders are actually in, and the one
-- 023 §1.13 exists for. These riders are added here rather than in seed.sql so
-- that not one expected value in rls_test.sql moves.
--
--   0011  username, location, onboarding_completed_at SET, terms NULL
--   0012  username, location, BOTH stamps set, and no content of any kind
--   0013  username, location, NEITHER stamp — the rider mid-wizard who has
--         filled in both fields and not yet been stamped

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000011', 'noconsent@example.com'),
  ('00000000-0000-0000-0000-000000000012', 'qualified@example.com'),
  ('00000000-0000-0000-0000-000000000013', 'midwizard@example.com');
reset role;

update profiles set username = 'noconsent', location = 'Braga',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000000011';
update profiles set username = 'qualified', location = 'Aveiro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000000012';
update profiles set username = 'midwizard', location = 'Evora'
  where id = '00000000-0000-0000-0000-000000000013';

-- ===========================================================================
-- 023: onboarding and consent gate participation
-- ===========================================================================

\echo ''
\echo '# A rider with neither stamp cannot create anything (migration 023)'

-- The fixture block above ends as the table owner. Assuming the role back is not
-- housekeeping: 023's gate is guarded by `when (current_user = 'authenticated')`,
-- so as superuser it correctly does not fire and every rejection assertion below
-- reports "the statement succeeded". That is exactly the failure the suite
-- README warns about — a section that runs as the owner passes while testing
-- nothing — and it is how this line came to be here.
set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the gate assertions run as authenticated, or they prove nothing');

-- 000e is seed.sql's step-1 rider: no username, no location, no stamps.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

select assert_rejected($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-00000000000e',
          'postcards/00000000-0000-0000-0000-00000000000e/eeeeeeee-0000-4000-8000-00000000aa01.jpg', 'hi')$$,
  '23514', 'un-onboarded: postcards refused');

select assert_rejected($$
  insert into clubs (name, is_public, owner_id)
  values ('Ghost MC', true, '00000000-0000-0000-0000-00000000000e')$$,
  '23514', 'un-onboarded: clubs refused');

select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, is_public, organizer_id)
  values ('Ghost Run', 'Nowhere', now() + interval '1 day', true,
          '00000000-0000-0000-0000-00000000000e')$$,
  '23514', 'un-onboarded: rides refused');

select assert_rejected($$
  insert into club_members (club_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000e')$$,
  '23514', 'un-onboarded: club_members refused');

select assert_rejected($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000e', 'going')$$,
  '23514', 'un-onboarded: ride_members refused');

select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000e', 'hello')$$,
  '23514', 'un-onboarded: postcard_comments refused');

select assert_rejected($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000e')$$,
  '23514', 'un-onboarded: postcard_likes refused');

-- Decided explicitly rather than by pattern: with email confirmation off
-- (decision #6) an account can be made with an address nobody controls, and no
-- admin role exists to triage what it files.
select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000e1', 'spam')$$,
  '23514', 'un-onboarded: postcard_reports refused');

\echo ''
\echo '# Onboarded but never consented is refused just the same (migration 023)'

-- This is the state 3 of the 4 live riders are in, so it is the arm that
-- actually decides whether the gate needs a consent prompt before it can ship.
select set_config('test.uid', '00000000-0000-0000-0000-000000000011', false);

select assert_rejected($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-000000000011',
          'postcards/00000000-0000-0000-0000-000000000011/11111111-0000-4000-8000-00000000aa02.jpg', 'hi')$$,
  '23514', 'no consent: postcards refused');

select assert_rejected($$
  insert into clubs (name, is_public, owner_id)
  values ('Unconsented MC', true, '00000000-0000-0000-0000-000000000011')$$,
  '23514', 'no consent: clubs refused');

select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, is_public, organizer_id)
  values ('Unconsented Run', 'Nowhere', now() + interval '1 day', true,
          '00000000-0000-0000-0000-000000000011')$$,
  '23514', 'no consent: rides refused');

select assert_rejected($$
  insert into club_members (club_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000011')$$,
  '23514', 'no consent: club_members refused');

select assert_rejected($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000011', 'going')$$,
  '23514', 'no consent: ride_members refused');

select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000011', 'hello')$$,
  '23514', 'no consent: postcard_comments refused');

select assert_rejected($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000011')$$,
  '23514', 'no consent: postcard_likes refused');

select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000e1', 'spam')$$,
  '23514', 'no consent: postcard_reports refused');

\echo ''
\echo '# With both stamps, all eight succeed (migration 023)'

-- The half that stops the gate passing by refusing everything. 0012 is a fresh
-- rider with both stamps and no rows anywhere, so each of these is a first write
-- rather than a duplicate.
select set_config('test.uid', '00000000-0000-0000-0000-000000000012', false);

select assert_allowed($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-000000000012',
          'postcards/00000000-0000-0000-0000-000000000012/12121212-0000-4000-8000-00000000aa03.jpg', 'hi')$$,
  'qualified: postcards allowed');

select assert_allowed($$
  insert into clubs (name, is_public, owner_id)
  values ('Qualified MC', true, '00000000-0000-0000-0000-000000000012')$$,
  'qualified: clubs allowed');

select assert_allowed($$
  insert into rides (title, meeting_point, departure_at, is_public, organizer_id)
  values ('Qualified Run', 'The Pier', now() + interval '1 day', true,
          '00000000-0000-0000-0000-000000000012')$$,
  'qualified: rides allowed');

select assert_allowed($$
  insert into club_members (club_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000012')$$,
  'qualified: club_members allowed');

select assert_allowed($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000012', 'going')$$,
  'qualified: ride_members allowed');

select assert_allowed($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000012', 'hello')$$,
  'qualified: postcard_comments allowed');

select assert_allowed($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000012')$$,
  'qualified: postcard_likes allowed');

select assert_allowed($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000e1', 'spam')$$,
  'qualified: postcard_reports allowed');

\echo ''
\echo '# The five uncovered tables still accept an un-onboarded rider (migration 023)'

-- Named in 023's header with their reasons, so the omission is a decision. These
-- assertions are what stop it silently becoming an oversight later: a gate
-- landing on `blocks` would mean "finish the wizard before you can get away from
-- someone".
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

select assert_allowed($$
  insert into blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000a')$$,
  'un-onboarded: blocks still allowed — safety is not gated');

select assert_allowed($$
  insert into postcard_hides (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000e')$$,
  'un-onboarded: postcard_hides still allowed — per-viewer');

select assert_allowed($$
  insert into feed_reads (user_id, club_id, last_seen_at)
  values ('00000000-0000-0000-0000-00000000000e', null, now())$$,
  'un-onboarded: feed_reads still allowed — a watermark shows nobody anything');

select assert_allowed($$
  insert into profile_countries (user_id, country_code)
  values ('00000000-0000-0000-0000-00000000000e', 'PT')$$,
  'un-onboarded: profile_countries still allowed — it is their own profile');

\echo ''
\echo '# Nobody is stranded mid-wizard (migration 023)'

-- The single failure mode this change must not have. Reads are untouched and the
-- two onboarding writes are UPDATEs to the rider's own profiles row, which the
-- gate does not cover — proved by writing them for real and reading them back,
-- since an UPDATE filtered to zero rows does not error.
savepoint wizard_step_one;
update profiles set username = 'rookie'
 where id = '00000000-0000-0000-0000-00000000000e';
select assert_eq((select username from profiles where id = '00000000-0000-0000-0000-00000000000e'),
  'rookie', 'a rider with no stamps can still complete onboarding step 1');

update profiles set location = 'Sintra', terms_accepted_at = now()
 where id = '00000000-0000-0000-0000-00000000000e';
update profiles set onboarding_completed_at = now()
 where id = '00000000-0000-0000-0000-00000000000e';
select assert_eq(
  (select onboarding_completed_at is not null
     from profiles where id = '00000000-0000-0000-0000-00000000000e')::text,
  'true', 'and step 2, and the completion stamp, in the ordinary way');

-- And having done so, the gate opens. Otherwise the wizard leads nowhere.
select assert_allowed($$
  insert into clubs (name, is_public, owner_id)
  values ('Newly Qualified MC', true, '00000000-0000-0000-0000-00000000000e')$$,
  'finishing the wizard opens the gate');
rollback to savepoint wizard_step_one;

\echo ''
\echo '# Completion requires consent (migration 023 §1.13)'

-- 0013 has username and location and neither stamp — 003's guard is satisfied
-- and 023's is not, so this isolates the new rule from the two old ones.
select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);
select assert_rejected($$
  update profiles set onboarding_completed_at = now()
   where id = '00000000-0000-0000-0000-000000000013'$$,
  '23514', 'completion is refused while terms_accepted_at is NULL');

-- PostgREST's upsert is INSERT ... ON CONFLICT DO UPDATE, the second route to
-- the same column that 003 and 012 both had to cover.
select assert_rejected($$
  insert into profiles (id, onboarding_completed_at)
  values ('00000000-0000-0000-0000-000000000013', now())
  on conflict (id) do update set onboarding_completed_at = excluded.onboarding_completed_at$$,
  '23514', 'and refused through a PostgREST-style upsert too');

-- Accepting and completing in one statement is permitted: the consent branch
-- resolves first, so `new.terms_accepted_at` is already set by the time the
-- completion guard reads it. Written for real and read back.
savepoint consent_then_complete;
update profiles set terms_accepted_at = now(), onboarding_completed_at = now()
 where id = '00000000-0000-0000-0000-000000000013';
select assert_eq(
  (select (terms_accepted_at is not null and onboarding_completed_at is not null)
     from profiles where id = '00000000-0000-0000-0000-000000000013')::text,
  'true', 'accepting and completing in one statement is allowed');
rollback to savepoint consent_then_complete;

-- Guards against 023's rule displacing 003's rather than joining it: the
-- username/location requirement must still fire on its own. 000e has neither.
--
-- Identity first, and it is load-bearing rather than tidy: this statement
-- targets 000e's row, so left as 0013 it would be filtered to zero rows by RLS,
-- raise nothing, and report "succeeded" — an assertion that reads like a
-- regression and is really a mis-scoped UPDATE. That is the same failure
-- assert_allowed refuses UPDATE outright to avoid.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select assert_rejected($$
  update profiles set terms_accepted_at = now(), onboarding_completed_at = now()
   where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'consent alone does not complete onboarding — location is still required');

\echo ''
\echo '# A fresh profiles row cannot choose its own consent timestamp (023 §1.14)'

-- 012 §KNOWN LIMIT recorded this hole and left it because "an assertion cannot
-- currently be written against a path 23505 blocks". Deleting the row first is
-- what makes it writable, and it models the exact event 012 named: account
-- deletion removing a profiles row while auth.users survives.
savepoint reinsert_profile;

reset role;
delete from profiles where id = '00000000-0000-0000-0000-000000000013';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);

-- The row is gone, so this is a genuine INSERT rather than an upsert.
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-000000000013'),
  0, 'the profile row is really absent, so the next insert is not a 23505');

insert into profiles (id, username, location, terms_accepted_at)
  values ('00000000-0000-0000-0000-000000000013', 'midwizard', 'Evora',
          timestamptz '2020-01-01 00:00:00+00');
select assert_eq(
  (select terms_accepted_at > timestamptz '2026-06-01 00:00:00+00'
     from profiles where id = '00000000-0000-0000-0000-000000000013')::text,
  'true', 'a chosen consent timestamp on INSERT is replaced with server time');

rollback to savepoint reinsert_profile;

-- And the completion guard applies on the INSERT path too, or the same hole
-- reopens one column over.
savepoint reinsert_complete;
reset role;
delete from profiles where id = '00000000-0000-0000-0000-000000000013';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);
select assert_rejected($$
  insert into profiles (id, username, location, onboarding_completed_at)
  values ('00000000-0000-0000-0000-000000000013', 'midwizard', 'Evora', now())$$,
  '23514', 'a fresh row cannot be born onboarded without consent');
rollback to savepoint reinsert_complete;

\echo ''
\echo '# The gate is wired the way it has to be (migration 023)'

-- Catalog introspection, so the role is dropped back to the owner. It has to be:
-- `has_function_privilege` resolves `private.may_participate()` by name, and
-- `authenticated` has no USAGE on that schema by design (005) — the check itself
-- would answer 42501 rather than a boolean.
reset role;

select assert_eq(
  (select count(*)::int from pg_trigger
    where tgname = 'enforce_participation_gate' and not tgisinternal),
  8, 'eight gate triggers, one per gated table');

-- Named rather than counted. A bare total would not notice a gate landing on
-- `blocks`, which is the omission that matters most.
select assert_eq(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'enforce_participation_gate'
      and c.relname in ('blocks','postcard_hides','feed_reads','profile_countries','profiles')),
  0, 'and none of the five deliberate omissions acquired one');

-- The WHEN guard is load-bearing twice over: without it the gate fires for the
-- seed and the migration role, and with the guard in the function body instead
-- it fires for nobody, because the function is security definer and
-- `current_user` is then its owner. Neither failure shows up in a positive test.
select assert_eq(
  (select count(*)::int from pg_trigger
    where tgname = 'enforce_participation_gate' and not tgisinternal
      and pg_get_triggerdef(oid) ilike '%current_user%'),
  8, 'every gate trigger carries the WHEN guard that reads the invoking role');

select assert_eq(has_function_privilege('anon', 'private.may_participate()', 'execute'),
  false, 'anon cannot call the gate helper');
select assert_eq(
  has_function_privilege('authenticated', 'public.enforce_participation_gate()', 'execute'),
  false, 'the trigger function is not callable as an RPC');

select assert_eq(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'profiles' and not t.tgisinternal),
  2, 'profiles carries the 003/012 UPDATE trigger and 023''s INSERT one');

-- The migration this file covers changes no policy's role targeting and grants
-- anon nothing, which is the invariant every other suite section ends on.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and not (roles = '{authenticated}')),
  0, 'every policy still targets authenticated only');
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  0, 'anon still holds no table privileges in public');

rollback;

\echo ''
\echo 'All pending (023) assertions passed.'
