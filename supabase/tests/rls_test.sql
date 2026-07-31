-- RLS policy suite. Every assertion here traces to a defect that reached the
-- repository, so a failure means a known bug has come back.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

begin;

-- A suite that silently runs as superuser would pass while testing nothing, so
-- confirm the role switch and the identity shim actually took effect first.
set role authenticated;
select assert_eq(current_user::text, 'authenticated', 'suite runs as the authenticated role');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq(auth.uid(), '00000000-0000-0000-0000-00000000000c'::uuid, 'auth.uid() reflects the test identity');

\echo ''
\echo '# Outsider cannot reach private content (migration 002)'

select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'private club is invisible to an outsider');
select assert_eq((select count(*)::int from club_members where club_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'private club roster is invisible to an outsider');
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d1'),
  0, 'club-only ride is invisible to an outsider');
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-0000000000d1'),
  0, 'club-only ride roster is invisible to an outsider');

select assert_denied($$
  insert into club_members (club_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000c')$$,
  'outsider cannot join a private club');
select assert_denied($$
  insert into ride_members (ride_id, user_id)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000c')$$,
  'outsider cannot join a club-only ride');

\echo ''
\echo '# Public content stays reachable (guards against over-tightening)'

select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000000c2'),
  1, 'public club is visible to an outsider');
select assert_eq((select count(*)::int from club_members where club_id = '00000000-0000-0000-0000-0000000000c2'),
  1, 'public club roster is visible to an outsider');
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  1, 'public ride is visible to an outsider');
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-0000000000d2'),
  1, 'public ride roster is visible to an outsider');
select assert_allowed($$
  insert into club_members (club_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000c')$$,
  'anyone can join a public club');
select assert_allowed($$
  insert into ride_members (ride_id, user_id)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000c')$$,
  'anyone can join a public ride');

\echo ''
\echo '# Members can reach their own private club (migration 002)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000000c1'),
  1, 'member can see their private club');
select assert_eq((select count(*)::int from club_members where club_id = '00000000-0000-0000-0000-0000000000c1'),
  2, 'member can see the private club roster');
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d1'),
  1, 'member can see a club-only ride');
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-0000000000d1'),
  1, 'member can see the club-only ride roster');

\echo ''
\echo '# Club creation flow still works (the owner inserts their own membership)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_allowed($$
  insert into clubs (id, name, is_public, owner_id)
  values ('00000000-0000-0000-0000-0000000000c3', 'New Club', false,
          '00000000-0000-0000-0000-00000000000a')$$,
  'owner can create a private club');

reset role;
insert into clubs (id, name, is_public, owner_id)
  values ('00000000-0000-0000-0000-0000000000c3', 'New Club', false,
          '00000000-0000-0000-0000-00000000000a');
set role authenticated;
select assert_allowed($$
  insert into club_members (club_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000000a', 'owner')$$,
  'owner can add themselves to their own private club');

\echo ''
\echo '# Signup still creates a profile (guards the revoke in migration 004)'

reset role;
set role auth_admin;
insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-00000000000f', 'newrider@example.com',
          '{"full_name":"New Rider"}'::jsonb);
reset role;
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000000f'),
  1, 'inserting an auth user creates a profile');
select assert_eq((select username from profiles where id = '00000000-0000-0000-0000-00000000000f'),
  'newrider', 'profile username is derived from the email local part');

\echo ''
\echo '# Security definer functions stay off the public API (migrations 003, 004)'

select assert_eq(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_club_member'),
  0, 'is_club_member is not in the PostgREST-exposed public schema');
select assert_eq(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'is_club_member'),
  1, 'is_club_member lives in the private schema');
select assert_eq(has_function_privilege('anon', 'private.is_club_member(uuid)', 'execute'),
  false, 'anon cannot execute is_club_member');
select assert_eq(has_function_privilege('authenticated', 'private.is_club_member(uuid)', 'execute'),
  true, 'authenticated can execute is_club_member (RLS policies need it)');

select assert_eq(has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
  false, 'anon cannot execute handle_new_user');
select assert_eq(has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  false, 'authenticated cannot execute handle_new_user');
select assert_eq(
  (select coalesce(array_to_string(p.proconfig, ', '), '(unset)')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'handle_new_user'),
  'search_path=""', 'handle_new_user has an empty pinned search_path');

\echo ''
\echo '# No anonymous access anywhere (migrations 002, 007)'

-- The anon key ships in the client bundle, so anything anon can reach is
-- public to the internet. This was a live exposure: every profile row was
-- readable until 007 went out.
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  0, 'anon holds no table privileges in public');

select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and not (roles = '{authenticated}')),
  0, 'every policy targets authenticated only, never PUBLIC or anon');

-- Belt and braces: the grants and the policies are checked above, but the
-- thing that actually matters is whether a real anonymous request returns data.
set role anon;
select assert_denied('select count(*) from profiles', 'anon cannot read profiles');
select assert_denied('select count(*) from clubs', 'anon cannot read clubs');
select assert_denied('select count(*) from rides', 'anon cannot read rides');
select assert_denied('select count(*) from club_members', 'anon cannot read club rosters');
select assert_denied('select count(*) from ride_members', 'anon cannot read ride rosters');
select assert_denied('select count(*) from friendships', 'anon cannot read friendships');
reset role;

rollback;

\echo ''
\echo 'All RLS policy assertions passed.'
