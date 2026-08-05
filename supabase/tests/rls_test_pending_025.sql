-- Assertions for migration 025, which is written and deliberately NOT deployed.
--
-- ---------------------------------------------------------------------------
-- How to run it, and what is deliberately NOT in it
-- ---------------------------------------------------------------------------
--
--   PENDING=023     npm test  # applies 023, skips 025, runs rls_test_pending_023.sql
--   PENDING=025     npm test  # applies 025, skips 023, runs this file
--   PENDING=023+025 npm test  # applies BOTH, runs rls_test_pending_023_025.sql
--
-- This file was `rls_test_pending_021.sql` until 2026-08-05. It was renamed and
-- **cut in half** when `021` was split, and the cut follows the migrations
-- exactly:
--
--   021 (APPLIED)  the three own-row functions
--                  -> their behaviour is asserted in rls_test.sql, mainline
--   025 (pending)  the revoke and the column allowlist
--                  -> this file: everything that only becomes true after it
--
-- So there is nothing here about what `accept_terms()` returns or when
-- `complete_onboarding()` refuses. Those functions exist in the database that
-- actually runs, so asserting them only from a pending suite would leave shipped
-- behaviour untested on every ordinary `npm test`. **If you are adding an
-- assertion, the question is which migration it constrains, not which file you
-- happened to be reading at the time.**
--
-- What this file keeps is the half that only becomes true after the revoke: a
-- rider cannot reach another rider's stamps by any path, `select *` is refused
-- even on your own row, the client can no longer write either stamp, and
-- `has_column_privilege` is false on both columns and true on the ones the UI
-- draws.
--
-- Each pending mode runs **instead of** rls_test.sql, and the reason is this
-- migration: 025 turns roughly twenty of rls_test.sql's own assertions red,
-- because 003's and 012's stamp assertions read `terms_accepted_at` and
-- `onboarding_completed_at` directly as the caller. When 025 lands with its code
-- repair, those assertions move to the accessor and this file merges back in.
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
-- — which is the state 3 of the 4 live riders are actually in. Added here rather
-- than in seed.sql so that not one expected value in rls_test.sql moves.
--
--   0011  username, location, onboarding_completed_at SET, terms NULL
--   0013  username, location, NEITHER stamp

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000011', 'noconsent@example.com'),
  ('00000000-0000-0000-0000-000000000013', 'midwizard@example.com');
reset role;

update profiles set username = 'noconsent', location = 'Braga',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000000011';
update profiles set username = 'midwizard', location = 'Evora'
  where id = '00000000-0000-0000-0000-000000000013';

-- ===========================================================================
-- 025: the consent and lifecycle stamps are own-row only
-- ===========================================================================

\echo ''
\echo '# Another rider''s consent record is not retrievable (migration 025)'

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

-- A direct column select, which is the path PUBLIC_PROFILE_COLUMNS only
-- *conventionally* avoids. RLS is row-level: the profiles SELECT policy admits
-- this row, so before 025 this returned the value.
select assert_denied($$
  select terms_accepted_at from profiles where id = '00000000-0000-0000-0000-00000000000a'$$,
  'a rider cannot read another rider''s consent stamp');

select assert_denied($$
  select onboarding_completed_at from profiles where id = '00000000-0000-0000-0000-00000000000a'$$,
  'a rider cannot read another rider''s onboarding stamp');

-- `select *` is the shape PostgREST issues for `select=*`, and the shape
-- getMyProfile uses on the caller's OWN row. It needs SELECT on every column, so
-- it is refused for everyone — including for your own row. That is not a bug in
-- this assertion, it is the code change 025 cannot ship without.
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
\echo '# ... and the client can no longer write either stamp (migration 025)'

-- The write half, and the reason 021's two writers had to exist before this file
-- could be applied at all. Without them these refusals would leave the wizard
-- with no path to either stamp — which is exactly the deadlock that made the
-- single-file version unshippable in either order.
select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);

select assert_denied($$
  update profiles set terms_accepted_at = now()
   where id = '00000000-0000-0000-0000-000000000013'$$,
  'a rider can no longer write their own consent stamp directly');

select assert_denied($$
  update profiles set onboarding_completed_at = now()
   where id = '00000000-0000-0000-0000-000000000013'$$,
  'a rider can no longer write their own completion stamp directly');

-- The upsert route to the same column, which 003, 012 and 023 each had to cover
-- separately. 025 closes it for free, because INSERT is granted by column too.
select assert_denied($$
  insert into profiles (id, onboarding_completed_at)
  values ('00000000-0000-0000-0000-000000000013', now())
  on conflict (id) do update set onboarding_completed_at = excluded.onboarding_completed_at$$,
  'and a PostgREST-style upsert cannot name the column either');

-- ... while the wizard's own writes are untouched. 025 must not strand a rider
-- mid-onboarding, and `username` is the step that still goes through an ordinary
-- UPDATE rather than through an RPC. Written for real and read back, because an
-- UPDATE filtered to zero rows does not error.
savepoint wizard_still_writes;
update profiles set username = 'midwizard2' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'midwizard2', 'an ordinary profile UPDATE still works after the revoke');
rollback to savepoint wizard_still_writes;

-- And 021's writers still reach what the client no longer can. Asserted here as
-- well as in rls_test.sql, because *after the revoke* is the only place this is
-- load-bearing: it is the single path left.
savepoint writers_still_work;
select assert_eq(public.accept_terms() is not null,
  true, 'accept_terms() still writes the stamp the client can no longer touch');
select assert_eq(public.complete_onboarding('Amsterdam') is not null,
  true, 'complete_onboarding() likewise — these are now the ONLY paths');
rollback to savepoint writers_still_work;

\echo ''
\echo '# A blocked rider reaches nothing, unchanged (migration 025)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000001a'),
  0, 'a blocked rider gets zero rows for the blocking rider''s profile');
select assert_eq((select count(*)::int from public.my_onboarding_state()),
  1, 'and still reads their own stamps — the block is about other people');

\echo ''
\echo '# The grant is what decides, not the projection (migration 025)'

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
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'terms_accepted_at', 'insert'),
  false, 'nor INSERT — the upsert route needs closing too');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed_at', 'insert'),
  false, 'nor INSERT on the completion stamp');

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
  has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'select'),
  true, 'and avatar_path — the app cannot draw a byline without both');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'username', 'update'),
  true, 'and still writable — onboarding step 2 needs it');
-- This used to assert `has_column_privilege(..., 'avatar_url', 'update')` is
-- false — the cheap half of the fix, leaving the column readable but not
-- writable. **024 drops the column outright, which is the whole fix**, so there
-- is no privilege left to ask about: `has_column_privilege` raises 42703 on a
-- dropped column rather than returning false, and the old line failed the suite
-- rather than passing it. Restated as absence, which is strictly stronger.
--
-- The ordering hazard the old note recorded here is **gone, and that is what the
-- renumber bought.** As `021` this file's migration ran BEFORE `024` locally and
-- AFTER it on the hosted project, so a `grant select (avatar_url)` would have
-- passed here and aborted there. At `025` both orders agree.
select assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'avatar_url'),
  0, 'avatar_url is not merely read-only but absent (024), so 025 need not grant it');

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
\echo 'All pending (025) assertions passed.'
