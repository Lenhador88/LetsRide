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
insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-00000000000f', 'dave@gmail.com');
reset role;
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000000f'),
  1, 'inserting an auth user creates a profile');

-- 003 stripped handle_new_user() back to a bare insert (id). Anything it
-- guessed was a field the user never chose, and the username guess was a live
-- signup-killing bug (below).
select assert_eq((select username from profiles where id = '00000000-0000-0000-0000-00000000000f'),
  null::text, 'the signup trigger no longer invents a username');
select assert_eq((select onboarding_completed_at from profiles where id = '00000000-0000-0000-0000-00000000000f'),
  null::timestamptz, 'a fresh signup starts with onboarding incomplete');

-- The bug 003 fixes: username was `unique` and derived from the email local
-- part, so the second dave@ signup raised a unique violation *inside* the
-- trigger, rolled the auth.users insert back with it, and Supabase surfaced it
-- as "Database error saving new user". The account was never created.
set role auth_admin;
insert into auth.users (id, email)
  values ('00000000-0000-0000-0000-000000000010', 'dave@yahoo.com');
reset role;
select assert_eq((select count(*)::int from profiles
                   where id in ('00000000-0000-0000-0000-00000000000f',
                                '00000000-0000-0000-0000-000000000010')),
  2, 'two signups sharing an email local part both get a profile');

\echo ''
\echo '# Half-finished profiles are visible only to their owner (migration 003)'

-- A NULL username means the rider has not reached the end of onboarding step 1.
-- The row exists from the instant auth.users does, so without this predicate
-- every abandoned signup would surface as a blank entry in rider search and any
-- member list. Fixtures: ...000e chose nothing, ...000d chose a username but no
-- location, ...000f and ...0010 are the two dave@ signups above.

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000000e'),
  0, 'a rider mid-onboarding is invisible to another signed-in rider');
select assert_eq((select count(*)::int from profiles where username is null),
  0, 'no ghost row of any kind reaches a bulk profile read');
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  1, 'an onboarded rider is still visible (guards against over-tightening)');

-- The predicate is username-nullness, not completion: a rider who has picked a
-- name is a real person to everyone else even while the wizard still gates them.
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000000d'),
  1, 'a rider who has chosen a username is visible before onboarding completes');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000000e'),
  1, 'a rider mid-onboarding can read their own row (every wizard step needs it)');
select assert_eq((select count(*)::int from profiles where username is null),
  1, 'a rider mid-onboarding sees their own ghost row and no other');
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  1, 'a rider mid-onboarding can still see onboarded riders');

-- Onboarding step 1's live availability check runs as a rider who is themselves
-- mid-onboarding, so it only works because the policy keys on username-nullness
-- rather than on completion. Tightening it to `onboarding_completed_at is not
-- null` would make taken names read as free and turn step 1 into a 23505.
select assert_eq((select count(*)::int from profiles where lower(username) = 'clubowner'),
  1, 'a rider mid-onboarding can see that a username is already taken');
select assert_eq((select count(*)::int from profiles where lower(username) = 'halfway'),
  1, 'a name held by another unfinished rider still reads as taken');

-- 003 drops and recreates the profiles select policy, so 002's guarantee has to
-- be re-proved on the replacement rather than assumed to have survived it.
select assert_eq(
  (select roles::text from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Profiles are viewable by signed-in riders'),
  '{authenticated}', 'the select policy 003 recreated still names authenticated only');

reset role;
set role anon;
select assert_denied('select count(*) from profiles',
  'anon still cannot read profiles after 003 recreated the select policy');
reset role;

\echo ''
\echo '# The onboarding gate cannot be forged from the client (migration 003)'

-- "Users can update their own profile" lets a rider PATCH any column on their
-- own row, so onboarding_completed_at is client-writable unless something stops
-- it. Without enforce_onboarding_completion() the gate is decorative: a
-- hand-rolled PostgREST call sets the timestamp and walks past the wizard.

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select assert_rejected($$
  update profiles set onboarding_completed_at = now()
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'completion cannot be claimed with a NULL username');

-- PostgREST's upsert (Prefer: resolution=merge-duplicates) is INSERT ... ON
-- CONFLICT DO UPDATE, which is a second route to the same column. Postgres does
-- fire BEFORE UPDATE triggers on the DO UPDATE branch, and this proves it.
select assert_rejected($$
  insert into profiles (id, onboarding_completed_at)
  values ('00000000-0000-0000-0000-00000000000e', now())
  on conflict (id) do update set onboarding_completed_at = excluded.onboarding_completed_at$$,
  '23514', 'the gate survives a PostgREST-style upsert, not just a plain update');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000d', false);
select assert_rejected($$
  update profiles set onboarding_completed_at = now()
  where id = '00000000-0000-0000-0000-00000000000d'$$,
  '23514', 'completion cannot be claimed with a NULL location');

select assert_allowed($$
  update profiles set location = 'Braga', onboarding_completed_at = now()
  where id = '00000000-0000-0000-0000-00000000000d'$$,
  'the last wizard step completes once username and location are both set');

\echo ''
\echo '# Onboarding completion is a one-way door (migration 003)'

-- Completion is stored rather than derived precisely so that a later profile
-- edit can never re-gate a rider. That only holds if the column cannot move
-- once set; both updates below succeed as statements and are silently pinned
-- back to the fixture timestamp by the trigger.

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

update profiles set onboarding_completed_at = null
  where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq((select onboarding_completed_at from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  timestamptz '2026-01-01 00:00:00+00', 'completion cannot be cleared to re-trigger the wizard');

update profiles set onboarding_completed_at = timestamptz '2020-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq((select onboarding_completed_at from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  timestamptz '2026-01-01 00:00:00+00', 'completion cannot be back-dated');

-- The trigger fires on every profile update, so the cost of getting it wrong is
-- that ordinary profile editing breaks. It must pass everything else through.
update profiles set bio = 'Rides at dawn', location = 'Coimbra'
  where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq((select bio from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'Rides at dawn', 'an onboarded rider can still edit the rest of their profile');
select assert_eq((select onboarding_completed_at from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  timestamptz '2026-01-01 00:00:00+00', 'an ordinary profile edit does not disturb completion');

\echo ''
\echo '# Username charset, length and reserved names (migration 003, Q4)'

-- The client is not a trust boundary: every one of these is reachable as a
-- direct PostgREST call, so the rules have to live in the database.

select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

select assert_rejected($$update profiles set username = 'ab'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'a username shorter than 3 characters is rejected');
select assert_rejected($$update profiles set username = 'twenty_one_chars_long'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'a username longer than 20 characters is rejected');
select assert_rejected($$update profiles set username = 'has space'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'a username with an illegal character is rejected');
select assert_rejected($$update profiles set username = 'Ripper'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'an uppercase username is rejected');
select assert_rejected($$update profiles set username = 'admin'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'a reserved username is rejected');
select assert_rejected($$update profiles set username = 'rides'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'a username colliding with a route segment is rejected');
select assert_rejected($$update profiles set username = 'clubowner'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23505', 'a username already taken is rejected');

select assert_allowed($$update profiles set username = 'rookie_99'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  'a legal username is accepted (guards against over-tightening)');

\echo ''
\echo '# Case-insensitive uniqueness lives in the index, not in the charset rule'

-- profiles_username_format already forbids uppercase, so "reject Ripper" above
-- passes against 001's plain unique(username) too — it proves nothing about
-- case folding. Dropping the charset check inside a savepoint is the only way
-- to put profiles_username_lower_key itself under test, and without it the
-- impersonation vector Q4 describes would be untested while looking covered.

reset role;
savepoint charset_check_off;
alter table profiles drop constraint profiles_username_format;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select assert_rejected($$update profiles set username = 'Clubowner'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23505', 'lower(username) rejects a case-variant of an existing username');
reset role;
rollback to savepoint charset_check_off;

-- indisunique is a catalog boolean rather than rendered SQL, so only the
-- expression half depends on how this Postgres major version prints an index.
select assert_eq(
  (select count(*)::int from pg_index i
     join pg_class c on c.oid = i.indexrelid
   where c.relname = 'profiles_username_lower_key'
     and i.indisunique
     and pg_get_indexdef(i.indexrelid) like '%lower(username)%'),
  1, 'uniqueness is indexed on lower(username), not on the raw value');
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_key'),
  0, '001''s case-sensitive unique constraint is gone');

-- The savepoint rollback above restores the session role, so the catalog
-- assertions below run unprivileged-free as they always have. has_function_
-- privilege() on a private.* function needs USAGE on that schema, which
-- `authenticated` deliberately does not hold.

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
