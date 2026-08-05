-- Assertions for migration 021, which is written and deliberately NOT deployed.
--
-- ---------------------------------------------------------------------------
-- How to run it, and why there are two of these files rather than one
-- ---------------------------------------------------------------------------
--
--   PENDING=021 npm test      # applies 021, skips 023, runs rls_test_pending_021.sql
--   PENDING=023 npm test      # applies 023, skips 021, runs rls_test_pending_023.sql
--
-- Each runs **instead of** rls_test.sql, and there is deliberately no mode that
-- applies both. Two reasons, and both are findings rather than inconveniences:
--
--   1. 021 turns roughly twenty of rls_test.sql's own assertions red. 003's and
--      012's stamp assertions read `terms_accepted_at` and
--      `onboarding_completed_at` directly as the caller, which is exactly the
--      column SELECT 021 revokes. When 021 lands with its code repair, those
--      assertions move to the accessor and rls_test_pending_021.sql merges back
--      into rls_test.sql.
--
--   2. **021 and 023 cannot both hold as drafted.** 023 refuses every write from
--      a rider whose two stamps are not set; 021 removes the only path by which
--      a client ever sets either one. Applied together, no rider can become
--      qualified to participate and the wizard is a dead end. This was not
--      reasoned out in advance — it was found by writing a single pending suite
--      and watching the onboarding-completes assertion fail with "permission
--      denied for table profiles". Whichever change lands 021 owns resolving it,
--      by giving consent and completion their own `security definer` writers.
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
-- 021: the consent and lifecycle stamps are own-row only
-- ===========================================================================

\echo ''
\echo '# Another rider''s consent record is not retrievable (migration 021)'

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

-- A direct column select, which is the path PUBLIC_PROFILE_COLUMNS only
-- *conventionally* avoids. RLS is row-level: the profiles SELECT policy admits
-- this row, so before 021 this returned the value.
select assert_denied($$
  select terms_accepted_at from profiles where id = '00000000-0000-0000-0000-00000000000a'$$,
  'a rider cannot read another rider''s consent stamp');

select assert_denied($$
  select onboarding_completed_at from profiles where id = '00000000-0000-0000-0000-00000000000a'$$,
  'a rider cannot read another rider''s onboarding stamp');

-- `select *` is the shape PostgREST issues for `select=*`, and the shape
-- getMyProfile uses on the caller's OWN row. It needs SELECT on every column, so
-- it is refused for everyone — including for your own row. That is not a bug in
-- this assertion, it is the code change 021 cannot ship without.
select assert_denied($$select * from profiles where id = '00000000-0000-0000-0000-00000000000a'$$,
  'select * over another rider''s profile is refused');

select assert_denied($$select * from profiles where id = auth.uid()$$,
  'select * over your OWN profile is refused too — getMyProfile must be repointed');

-- Guards against over-tightening. If these fail the app cannot draw a byline.
savepoint still_readable;
select assert_eq((select username from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'clubowner', 'the columns the UI renders are still readable');
select assert_eq((select count(*)::int from profiles where username is not null),
  (select count(*)::int from profiles where username is not null),
  'a bulk profile read still works');
rollback to savepoint still_readable;

\echo ''
\echo '# ... and your own is readable through the accessor (migration 021)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq((select count(*)::int from public.my_profile_stamps()),
  1, 'the accessor returns exactly one row — the caller''s own');
select assert_eq((select terms_accepted_at from public.my_profile_stamps()),
  timestamptz '2026-01-01 00:00:00+00', 'the accessor returns the caller''s consent stamp');
select assert_eq((select onboarding_completed_at from public.my_profile_stamps()),
  timestamptz '2026-01-01 00:00:00+00', 'the accessor returns the caller''s onboarding stamp');

-- It takes no arguments, so there is no row to choose but your own. Asserted by
-- switching identity and seeing the answer change rather than by reading the
-- function body.
select set_config('test.uid', '00000000-0000-0000-0000-000000000011', false);
select assert_eq((select terms_accepted_at from public.my_profile_stamps()),
  null::timestamptz, 'the accessor follows the caller, and cannot be pointed elsewhere');

\echo ''
\echo '# A blocked rider reaches nothing, unchanged (migration 021)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000001a'),
  0, 'a blocked rider gets zero rows for the blocking rider''s profile');
select assert_eq((select count(*)::int from public.my_profile_stamps()),
  1, 'and still reads their own stamps — the block is about other people');

\echo ''
\echo '# The grant is what decides, not the projection (migration 021)'

-- Scoped to the grantee. `postgres` and `service_role` hold everything by
-- Supabase default, so anything counted table-wide reads wrong against a correct
-- database — the mistake 015's footer made and documented.
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'terms_accepted_at', 'select'),
  false, 'authenticated holds no column SELECT on terms_accepted_at');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed_at', 'select'),
  false, 'authenticated holds no column SELECT on onboarding_completed_at');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'terms_accepted_at', 'update'),
  false, 'nor UPDATE on terms_accepted_at');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed_at', 'update'),
  false, 'nor UPDATE on onboarding_completed_at');

-- The table-level grant is what a column-level REVOKE cannot touch, so its
-- absence is the assertion that the migration used the right shape. Without
-- this, a file that only revoked the columns would pass every test above by
-- accident of the policy rather than the grant.
select assert_eq(has_table_privilege('authenticated', 'public.profiles', 'select'),
  false, 'there is no table-wide SELECT left to override the column grants');

select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'username', 'select'),
  true, 'username is still readable (guards against over-tightening)');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'username', 'update'),
  true, 'and still writable — onboarding step 1 needs it');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'update'),
  false, 'avatar_url is read-only: nothing writes it and it reaches every member list');

select assert_eq(has_function_privilege('anon', 'public.my_profile_stamps()', 'execute'),
  false, 'anon cannot call the accessor');
select assert_eq(has_function_privilege('authenticated', 'public.my_profile_stamps()', 'execute'),
  true, 'authenticated can — the route guard needs it');

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
\echo 'All pending (021) assertions passed.'
