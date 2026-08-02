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
\echo '# Postcard visibility follows club scope (migration 009)'

-- A postcard's audience is its club_id and nothing else: NULL is the app-wide
-- feed, a club_id is that club's members. Fixtures: e1 global, e2 in the
-- PRIVATE club c1, e5 also in c1 but authored by the outsider, who is not a
-- member of it.

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'a global postcard is visible to any signed-in rider');
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e2'),
  0, 'a club-scoped postcard is invisible to a non-member of that club');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e2'),
  1, 'a club-scoped postcard is visible to a member (guards against over-tightening)');

-- The author branch is unconditional and first, so leaving a club never
-- silently takes your own photo away from you. e5 is the only fixture that
-- isolates it: the outsider authored it inside a club they are not in.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e5'),
  1, 'an author still sees their own postcard in a club they are not a member of');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e5'),
  0, 'that same postcard stays invisible to a rider who is neither author nor member');

\echo ''
\echo '# Blocking removes a rider from the feed, both ways (decision #2)'

-- The stored row is directional (1a blocked 1b). Both directions must hold, and
-- the asymmetry is resolved inside private.is_blocked rather than at any call
-- site — a one-directional block is worse than none, because the rider who
-- pressed the button still sees the person they blocked.

select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e3'),
  0, 'the blocker does not see the blocked rider''s postcard');
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e4'),
  1, 'the blocker still sees their own postcard');

select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e4'),
  0, 'and vice versa: the blocked rider does not see the blocker''s postcard');
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e3'),
  1, 'the blocked rider still sees their own postcard');

-- A block is between two people, not a global takedown.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from postcards
                   where id in ('00000000-0000-0000-0000-0000000000e3',
                                '00000000-0000-0000-0000-0000000000e4')),
  2, 'an unrelated rider still sees both riders'' postcards');

-- The bulk read is the feed itself. A targeted lookup can pass while the list
-- query still leaks, so both are asserted.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from postcards),
  2, 'the blocker''s whole feed excludes the blocked rider (e1 + own e4)');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from postcards),
  2, 'the blocked rider''s whole feed excludes the blocker (e1 + own e3)');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from postcards),
  5, 'a club member with no blocks sees every postcard (guards against over-tightening)');

\echo ''
\echo '# Blocking removes a rider from search, rosters and crews (decision #2)'

-- Same predicate, five tables, one helper. If any of these drifts, "blocked"
-- silently means "hidden on the screens someone remembered".

select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000001b'),
  0, 'the blocker cannot see the blocked rider''s profile');
select assert_eq((select count(*)::int from profiles where username = 'blocked'),
  0, 'the blocked rider does not surface in rider search');
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000001a'),
  1, 'the blocker can still see their own profile');

select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000001a'),
  0, 'and vice versa: the blocked rider cannot see the blocker''s profile');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from profiles
                   where id in ('00000000-0000-0000-0000-00000000001a',
                                '00000000-0000-0000-0000-00000000001b')),
  2, 'an unrelated rider still sees both profiles');

-- Club rosters. c4 holds the owner plus both sides of the block.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from club_members where club_id = '00000000-0000-0000-0000-0000000000c4'),
  2, 'the blocked rider is gone from the club roster the blocker reads');
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000000000c4'
                     and user_id = '00000000-0000-0000-0000-00000000001a'),
  1, 'the blocker still sees their own roster row');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from club_members where club_id = '00000000-0000-0000-0000-0000000000c4'),
  2, 'and vice versa on the same roster');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from club_members where club_id = '00000000-0000-0000-0000-0000000000c4'),
  3, 'an unrelated rider sees the full roster');

-- Ride crews. d3 holds the same three.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-0000000000d3'),
  2, 'the blocked rider is gone from the ride crew the blocker reads');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-0000000000d3'),
  3, 'an unrelated rider sees the full crew');

-- A ride ORGANISED by a blocked rider leaves the feed entirely, not just its
-- byline. d4 is organised by 1b.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d4'),
  0, 'a ride organised by a blocked rider is invisible to the blocker');
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-0000000000d4'),
  0, 'and its crew goes with it, because the roster policy inherits ride visibility');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d4'),
  1, 'the organizer still sees their own ride');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d4'),
  1, 'an unrelated rider still sees that ride');

-- friendships is beyond the tables the brief named, and is included because a
-- pending request from a blocked rider sitting in your list is the same leak.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from friendships),
  0, 'a friendship spanning a block is hidden from the blocker');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from friendships),
  0, 'and from the blocked rider');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from friendships),
  1, 'an unblocked friendship is still visible to its parties');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_denied($$
  insert into friendships (requester_id, addressee_id)
  values ('00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000001b')$$,
  'a rider cannot send a friend request across a block');
select assert_allowed($$
  insert into friendships (requester_id, addressee_id)
  values ('00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000000c')$$,
  'an ordinary friend request still works (guards against over-tightening)');

\echo ''
\echo '# Blocking changes visibility only — it never deletes data (migration 009)'

-- The alternative, cascading deletes on block, is unrecoverable and makes
-- blocking a write primitive against other people's data: block the organizer
-- to erase yourself from a ride's record, or to decrement someone's like count.
-- Every row below is still there; only who can see it changed.

reset role;
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000000000c4'),
  3, 'the blocked rider''s club membership row still exists in the table');
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-0000000000d3'),
  3, 'the blocked rider''s ride crew row still exists in the table');
select assert_eq((select count(*)::int from postcard_likes
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  2, 'the blocked rider''s like still exists in the table');
set role authenticated;

\echo ''
\echo '# Postcard writes are author-scoped (migration 009)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

select assert_denied($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000a', 'postcards/000a/forged.jpg')$$,
  'a rider cannot create a postcard authored by someone else');
select assert_denied($$
  insert into postcards (author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1',
          'postcards/000c/injected.jpg')$$,
  'a rider cannot post into a club they are not a member of');
-- The same rule against a PUBLIC club. c1 above is private, so that denial could
-- equally have come from not being able to see the club at all; 000c can see c5
-- and still cannot post into it. Membership, not visibility, is what is enforced.
select assert_denied($$
  insert into postcards (author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c5',
          'postcards/000c/injected-public.jpg')$$,
  'a rider cannot post into a PUBLIC club they are not a member of');
select assert_allowed($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', 'postcards/000c/ok.jpg')$$,
  'any signed-in rider can post to the app-wide feed');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_allowed($$
  insert into postcards (author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1',
          'postcards/000b/ok.jpg')$$,
  'a club member can post into their own club');

-- UPDATE and DELETE are filtered by the USING clause rather than refused, so a
-- denial assertion would pass for the wrong reason: the statement succeeds and
-- touches zero rows. The row itself is the evidence.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
update postcards set caption = 'hijacked' where id = '00000000-0000-0000-0000-0000000000e1';
select assert_eq((select caption from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  'Sunrise on the N222', 'a rider cannot edit another rider''s postcard');
delete from postcards where id = '00000000-0000-0000-0000-0000000000e1';
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'a rider cannot delete another rider''s postcard');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_denied($$
  update postcards set author_id = '00000000-0000-0000-0000-00000000000c'
  where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'an author cannot hand their postcard to another rider');
-- c5, not c4: 000a OWNS c4, so the earlier form of this assertion permitted the
-- write and was testing nothing. c5 is public and 000a is not a member, so this
-- pins the refusal to membership rather than visibility.
select assert_denied($$
  update postcards set club_id = '00000000-0000-0000-0000-0000000000c5'
  where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'an author cannot move a postcard into a club they are not a member of');
select assert_allowed($$
  update postcards set caption = 'Sunrise on the N222, again'
  where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'an author can edit their own caption');
select assert_allowed($$delete from postcards where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'an author can delete their own postcard');

-- The documented side effect of the WITH CHECK: an author who left a club keeps
-- read and delete on their postcard in it, but loses the caption edit. A policy
-- cannot see the old row, so permitting that edit means dropping the club test
-- entirely — which would let any rider move a photo into any private club.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_denied($$
  update postcards set caption = 'edited'
  where id = '00000000-0000-0000-0000-0000000000e5'$$,
  'an author who left a club cannot edit their postcard in it');
select assert_allowed($$delete from postcards where id = '00000000-0000-0000-0000-0000000000e5'$$,
  'but they can still delete it, so nothing is stranded');

\echo ''
\echo '# image_path is a storage path, not a URL (migration 009)'

-- RLS enforces authorization, never validity. Storing a URL bakes in the
-- project ref and the public/signed distinction, so the shape is a constraint.

select assert_rejected($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', 'https://example.com/a.jpg')$$,
  '23514', 'an https URL is rejected as an image_path');
select assert_rejected($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', 's3://bucket/a.jpg')$$,
  '23514', 'any other URI scheme is rejected too');
select assert_rejected($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '/postcards/000c/a.jpg')$$,
  '23514', 'a leading slash is rejected');
select assert_rejected($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '')$$,
  '23514', 'an empty image_path is rejected');
select assert_rejected($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-00000000000c', 'postcards/000c/a.jpg', repeat('x', 2001))$$,
  '23514', 'a caption over 2000 characters is rejected');

\echo ''
\echo '# Likes follow postcard visibility (migration 009)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_denied($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000c')$$,
  'a rider cannot like a club postcard they cannot see');
select assert_denied($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a')$$,
  'a rider cannot like on another rider''s behalf');
select assert_allowed($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000000c')$$,
  'a rider can like a postcard they can see');

-- The block path into the same rule: e3 is invisible to the blocker, so the
-- insert policy's EXISTS clause refuses the like without restating the block.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_denied($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000001a')$$,
  'a rider cannot like a postcard hidden from them by a block');

-- Like counts are per-viewer by construction: counting rows under RLS cannot
-- drift from the rows it summarises, which is why there is no like_count column.
select assert_eq((select count(*)::int from postcard_likes
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'the blocker does not see or count the blocked rider''s like');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from postcard_likes
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  2, 'an unrelated rider counts both likes');

-- Unliking is a DELETE filtered by USING, so it silently touches zero rows
-- rather than raising. The surviving row is the assertion.
delete from postcard_likes
  where postcard_id = '00000000-0000-0000-0000-0000000000e1'
    and user_id = '00000000-0000-0000-0000-00000000001b';
select assert_eq((select count(*)::int from postcard_likes
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'
                     and user_id = '00000000-0000-0000-0000-00000000001b'),
  1, 'unliking cannot remove another rider''s like');
select assert_allowed($$
  delete from postcard_likes
  where postcard_id = '00000000-0000-0000-0000-0000000000e1'
    and user_id = '00000000-0000-0000-0000-00000000000c'$$,
  'a rider can remove their own like');

-- No mutable column, so no update policy and no update grant. The missing grant
-- is the layer that still holds if a future policy is written too permissively.
select assert_denied($$
  update postcard_likes set user_id = '00000000-0000-0000-0000-00000000000a'
  where postcard_id = '00000000-0000-0000-0000-0000000000e1'$$,
  'nobody can update a like row at all');

\echo ''
\echo '# The block list itself (migration 009)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from blocks), 1, 'a rider sees the blocks they created');

-- Being blocked is not disclosed. A rider who can enumerate who blocked them
-- has been handed a target list, and the point of the feature is that the other
-- party simply goes quiet.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from blocks), 0, 'the blocked rider is not told they were blocked');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from blocks), 0, 'an unrelated rider sees no blocks at all');

select assert_rejected($$
  insert into blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c')$$,
  '23514', 'a rider cannot block themselves');
select assert_denied($$
  insert into blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000000b')$$,
  'a rider cannot block on another rider''s behalf');

-- Pressing Block twice must not error the app. The composite PK makes the raw
-- duplicate a 23505 and makes `on conflict do nothing` a clean no-op, so the
-- caller has a documented idempotent write rather than a race to lose.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_rejected($$
  insert into blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000001b')$$,
  '23505', 'a duplicate block is a duplicate');
select assert_allowed($$
  insert into blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000001b')
  on conflict do nothing$$,
  'the same block written with on conflict do nothing is a silent no-op');

-- The row is directional, so a counter-block is a second row. Insert carries no
-- visibility requirement precisely so this works: 1b cannot see 1a at all.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_allowed($$
  insert into blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000001a')$$,
  'a blocked rider can still block back');

-- Unblock removes only your own direction, or one party could lift the other's.
delete from blocks where blocker_id = '00000000-0000-0000-0000-00000000001a';
reset role;
select assert_eq((select count(*)::int from blocks
                   where blocker_id = '00000000-0000-0000-0000-00000000001a'),
  1, 'a rider cannot lift a block someone else placed on them');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_allowed($$
  delete from blocks where blocker_id = '00000000-0000-0000-0000-00000000001a'$$,
  'a rider can lift their own block');

\echo ''
\echo '# is_blocked stays off the public API and is symmetric (migration 009)'

-- Same hygiene 005 established for is_club_member. PostgREST publishes every
-- function in `public` as an RPC endpoint; a security definer function that
-- reads rows the caller cannot see does not belong there.
select assert_denied($$select private.is_blocked(
    '00000000-0000-0000-0000-00000000001a'::uuid,
    '00000000-0000-0000-0000-00000000001b'::uuid)$$,
  'authenticated cannot call is_blocked directly, only through a policy');

reset role;

select assert_eq(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_blocked'),
  0, 'is_blocked is not in the PostgREST-exposed public schema');
select assert_eq(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'is_blocked'),
  1, 'is_blocked lives in the private schema');
select assert_eq(has_function_privilege('anon', 'private.is_blocked(uuid, uuid)', 'execute'),
  false, 'anon cannot execute is_blocked');
select assert_eq(has_function_privilege('authenticated', 'private.is_blocked(uuid, uuid)', 'execute'),
  true, 'authenticated can execute is_blocked (RLS policies need it)');

-- Symmetry is the property every call site depends on, so it is asserted on the
-- helper directly rather than only through the policies that use it.
select assert_eq(private.is_blocked('00000000-0000-0000-0000-00000000001a',
                                    '00000000-0000-0000-0000-00000000001b'),
  true, 'is_blocked finds the block in the direction it was stored');
select assert_eq(private.is_blocked('00000000-0000-0000-0000-00000000001b',
                                    '00000000-0000-0000-0000-00000000001a'),
  true, 'is_blocked is symmetric — it finds the same block reversed');
select assert_eq(private.is_blocked('00000000-0000-0000-0000-00000000000a',
                                    '00000000-0000-0000-0000-00000000000c'),
  false, 'is_blocked reports false for an unrelated pair');

\echo ''
\echo '# New tables are locked down by construction (migration 009)'

select assert_eq(
  (select count(*)::int from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('postcards', 'postcard_likes', 'blocks')
      and relrowsecurity),
  3, 'row level security is enabled on all three new tables');

-- 009 drops SELECT policies by catalog lookup and recreates one per table.
-- Policies for the same command are OR'd, so a single leftover would silently
-- undo the block predicate on that table — the exact shape of the bug 008 was
-- written to fix.
select assert_eq(
  (select count(*)::int from (
     select tablename from pg_policies
      where schemaname = 'public' and cmd = 'SELECT'
      group by tablename having count(*) > 1) t),
  0, 'no table carries a second SELECT policy that could OR the block predicate away');

-- The grant is the layer that holds independently of the policies. Neither a
-- like nor a block has a mutable column, so neither carries an UPDATE grant.
select assert_eq(has_table_privilege('authenticated', 'public.postcard_likes', 'update'),
  false, 'authenticated holds no UPDATE grant on postcard_likes');
select assert_eq(has_table_privilege('authenticated', 'public.blocks', 'update'),
  false, 'authenticated holds no UPDATE grant on blocks');
select assert_eq(has_table_privilege('authenticated', 'public.postcards', 'update'),
  true, 'authenticated can update postcards (caption edits)');

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
