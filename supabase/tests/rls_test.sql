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

-- Written for real and read back: an UPDATE filtered to zero rows does not
-- error, so assert_allowed cannot tell "permitted" from "forbidden entirely".
savepoint wizard_completes;
update profiles set location = 'Braga', onboarding_completed_at = now()
  where id = '00000000-0000-0000-0000-00000000000d';
select assert_eq(
  (select (location = 'Braga' and onboarding_completed_at is not null)
     from profiles where id = '00000000-0000-0000-0000-00000000000d')::text,
  'true', 'the last wizard step completes once username and location are both set');
rollback to savepoint wizard_completes;

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
\echo '# The consent stamp is not client-owned (migration 012)'

-- terms_accepted_at is evidence that a specific rider accepted specific terms at
-- a specific time. "Users can update their own profile" covers the column, so
-- without 012 the subject of that evidence can rewrite it.

-- Rider 000a is deliberately an *onboarded* rider, and that is the load-bearing
-- part of these two. The trigger returns early once onboarding_completed_at is
-- set, so a consent guard written below that branch would never run for anyone
-- who has finished the wizard — i.e. for every rider this protects. These fail
-- if 012's block is ever moved below the early return.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

update profiles set terms_accepted_at = null
  where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq((select terms_accepted_at from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  timestamptz '2026-01-01 00:00:00+00', 'consent cannot be cleared by the rider who gave it');

update profiles set terms_accepted_at = timestamptz '2020-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq((select terms_accepted_at from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  timestamptz '2026-01-01 00:00:00+00', 'consent cannot be back-dated');

update profiles set bio = 'Still rides at dawn'
  where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq((select terms_accepted_at from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  timestamptz '2026-01-01 00:00:00+00', 'an ordinary profile edit does not disturb consent');

-- First acceptance: the client says *that*, the server says *when*. 000e is the
-- step-1 rider, the only fixture with no stamp yet. Pinning alone would leave
-- this hole — the very first write choosing any timestamp it liked.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

savepoint first_consent;
update profiles set terms_accepted_at = timestamptz '2020-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000000000e';
select assert_eq(
  (select terms_accepted_at > timestamptz '2026-06-01 00:00:00+00'
     from profiles where id = '00000000-0000-0000-0000-00000000000e')::text,
  'true', 'a first consent write is stamped with server time, not the value sent');
rollback to savepoint first_consent;

-- PostgREST's upsert is INSERT ... ON CONFLICT DO UPDATE, the same second route
-- to the column that 003's completion gate had to cover.
-- Identity first: `rollback to savepoint` above restores the row, not
-- `test.uid`, so anything here would otherwise still run as 000e and be
-- refused by RLS against 000a's row — an UPDATE 0 that reads like setup.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
insert into profiles (id, terms_accepted_at)
  values ('00000000-0000-0000-0000-00000000000a', timestamptz '2020-01-01 00:00:00+00')
  on conflict (id) do update set terms_accepted_at = excluded.terms_accepted_at;
select assert_eq((select terms_accepted_at from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  timestamptz '2026-01-01 00:00:00+00', 'the consent guard survives a PostgREST-style upsert');

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

-- The positive case has to write for real and read the value back. An UPDATE
-- filtered to zero rows does not error, so assert_allowed would pass here even
-- against a policy permitting nothing — see the comment on that function.
savepoint legal_username_accepted;
update profiles set username = 'rookie_99'
  where id = '00000000-0000-0000-0000-00000000000e';
select assert_eq((select username from profiles where id = '00000000-0000-0000-0000-00000000000e'),
  'rookie_99', 'a legal username is accepted (guards against over-tightening)');
rollback to savepoint legal_username_accepted;

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

-- The five friendship assertions that sat here went with the table in 013. They
-- covered one more surface of block symmetry, not a rule of its own — the same
-- rule is still asserted above and below against profiles, rides, ride_members,
-- club_members, postcards and comments.

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
  values ('00000000-0000-0000-0000-00000000000a', 'postcards/00000000-0000-0000-0000-00000000000a/forged.jpg')$$,
  'a rider cannot create a postcard authored by someone else');
select assert_denied($$
  insert into postcards (author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1',
          'postcards/00000000-0000-0000-0000-00000000000c/injected.jpg')$$,
  'a rider cannot post into a club they are not a member of');
-- The same rule against a PUBLIC club. c1 above is private, so that denial could
-- equally have come from not being able to see the club at all; 000c can see c5
-- and still cannot post into it. Membership, not visibility, is what is enforced.
select assert_denied($$
  insert into postcards (author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c5',
          'postcards/00000000-0000-0000-0000-00000000000c/injected-public.jpg')$$,
  'a rider cannot post into a PUBLIC club they are not a member of');
select assert_allowed($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', 'postcards/00000000-0000-0000-0000-00000000000c/ok.jpg')$$,
  'any signed-in rider can post to the app-wide feed');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_allowed($$
  insert into postcards (author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1',
          'postcards/00000000-0000-0000-0000-00000000000b/ok.jpg')$$,
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
savepoint author_edits_caption;
update postcards set caption = 'Sunrise on the N222, again'
  where id = '00000000-0000-0000-0000-0000000000e1';
select assert_eq((select caption from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  'Sunrise on the N222, again', 'an author can edit their own caption');
rollback to savepoint author_edits_caption;
-- Not assert_allowed. That helper runs the statement and then raises to undo
-- it, so it only ever proves the statement did not ERROR — and a DELETE
-- filtered to zero rows by its USING clause does not error. This assertion
-- passed with the delete policy dropped entirely until a mutation test caught
-- it. The savepoint restores the row and everything that cascades off it.
savepoint author_deletes_own_postcard;
delete from postcards where id = '00000000-0000-0000-0000-0000000000e1';
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000000000e1'),
  0, 'an author can delete their own postcard');
rollback to savepoint author_deletes_own_postcard;

-- The documented side effect of the WITH CHECK: an author who left a club keeps
-- read and delete on their postcard in it, but loses the caption edit. A policy
-- cannot see the old row, so permitting that edit means dropping the club test
-- entirely — which would let any rider move a photo into any private club.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_denied($$
  update postcards set caption = 'edited'
  where id = '00000000-0000-0000-0000-0000000000e5'$$,
  'an author who left a club cannot edit their postcard in it');
savepoint departed_author_deletes;
delete from postcards where id = '00000000-0000-0000-0000-0000000000e5';
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000000000e5'),
  0, 'but they can still delete it, so nothing is stranded');
rollback to savepoint departed_author_deletes;

\echo ''
\echo '# image_path is a storage path, not a URL (migration 009)'

-- RLS enforces authorization, never validity. Storing a URL bakes in the
-- project ref and the public/signed distinction, so the shape is a constraint.

-- Two layers, and since 010 they fire in this order: the INSERT policy's
-- `image_path like 'postcards/<uid>/%'` refuses a malformed path with 42501
-- before the CHECK constraint is ever reached. Both are asserted, because the
-- constraint is what still holds if the policy is ever loosened, and a suite
-- that only tested the outer layer would not notice the inner one rotting.
select assert_denied($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', 'https://example.com/a.jpg')$$,
  'an https URL is rejected as an image_path');
select assert_denied($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', 's3://bucket/a.jpg')$$,
  'any other URI scheme is rejected too');
select assert_denied($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '/postcards/00000000-0000-0000-0000-00000000000c/a.jpg')$$,
  'a leading slash is rejected');
select assert_denied($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '')$$,
  'an empty image_path is rejected');

-- The inner layer, with RLS out of the way. The table owner bypasses policies,
-- so anything rejected here is the CHECK constraint from 009 doing it.
reset role;
select assert_rejected($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', 'https://example.com/a.jpg')$$,
  '23514', 'beneath RLS, the constraint still rejects an https URL');
select assert_rejected($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '/leading/slash.jpg')$$,
  '23514', 'beneath RLS, the constraint still rejects a leading slash');
select assert_rejected($$
  insert into postcards (author_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', '')$$,
  '23514', 'beneath RLS, the constraint still rejects an empty path');
set role authenticated;
select assert_rejected($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-00000000000c', 'postcards/00000000-0000-0000-0000-00000000000c/a.jpg', repeat('x', 2001))$$,
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
-- Same weakness as the postcard delete above: assert_allowed cannot tell a
-- permitted delete from one filtered to zero rows. Deleted for real, counted,
-- and rolled back so the like counts the next section asserts still hold.
savepoint rider_removes_own_like;
delete from postcard_likes
  where postcard_id = '00000000-0000-0000-0000-0000000000e1'
    and user_id = '00000000-0000-0000-0000-00000000000c';
select assert_eq((select count(*)::int from postcard_likes
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'
                     and user_id = '00000000-0000-0000-0000-00000000000c'),
  0, 'a rider can remove their own like');
rollback to savepoint rider_removes_own_like;

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
savepoint rider_lifts_own_block;
delete from blocks where blocker_id = '00000000-0000-0000-0000-00000000001a';
select assert_eq((select count(*)::int from blocks
                   where blocker_id = '00000000-0000-0000-0000-00000000001a'),
  0, 'a rider can lift their own block');
rollback to savepoint rider_lifts_own_block;

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
\echo '# Postcard image storage (migration 010)'

-- Shape checks first, independent of any test identity.
reset role;

select assert_eq(
  (select relrowsecurity from pg_class
    where relnamespace = 'storage'::regnamespace and relname = 'objects'),
  true, 'row level security is enabled on storage.objects');

select assert_eq((select public from storage.buckets where id = 'media'),
  false, 'the media bucket is private');
select assert_eq((select file_size_limit from storage.buckets where id = 'media'),
  5242880::bigint, 'the media bucket caps object size at 5 MiB');
select assert_eq((select allowed_mime_types from storage.buckets where id = 'media'),
  array['image/jpeg'], 'the media bucket only accepts image/jpeg');

select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and not (roles = '{authenticated}')),
  0, 'every storage.objects policy targets authenticated only, never PUBLIC or anon');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd = 'UPDATE'),
  0, 'no UPDATE policy on storage.objects — uploads never upsert (see uploadObject)');
-- Scoped to the `postcards/` policies by name rather than counting the whole
-- table, which is what this asserted until 014 added `avatars/` and `covers/`
-- and turned 3 into 9.
--
-- Bumping the number would have been the wrong repair. The intent is "no
-- leftover policy to OR against the others" — a property of ONE folder's rule
-- set — and a whole-table count stops testing that the moment a second surface
-- lands: a spurious fourth postcards policy would then be hidden by a
-- coincidental total. The per-folder count keeps the original meaning, and 014
-- asserts its own three-per-folder totals separately.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname ilike '%postcard%'),
  3, 'exactly insert, select and delete for postcards/ — no leftover policy to OR against the others');

set role authenticated;

-- SELECT mirrors postcard visibility exactly, through the same EXISTS-under-RLS
-- trick postcard_likes uses: nothing here restates the author/block/club
-- predicate, so it cannot drift from the one 009 owns.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from storage.objects where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg'),
  1, 'an outsider can read the object behind a globally visible postcard');
select assert_eq((select count(*)::int from storage.objects where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dec2.jpg'),
  0, 'an outsider cannot read the object behind a club postcard they cannot see');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from storage.objects where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dec2.jpg'),
  1, 'a club member can read the object behind that club''s postcard (guards against over-tightening)');

-- The block predicate, inherited the same way — never restated as a second
-- is_blocked() call inside this policy.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from storage.objects where name = 'postcards/00000000-0000-0000-0000-00000000001b/bbbbbbbb-0000-4000-8000-00000000c0a5.jpg'),
  0, 'a blocker cannot read the image behind a postcard from someone they blocked');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from storage.objects where name = 'postcards/00000000-0000-0000-0000-00000000001b/bbbbbbbb-0000-4000-8000-00000000c0a5.jpg'),
  1, 'an unrelated rider can still read that same object (guards against over-tightening)');

-- An object with no referencing postcards row at all is unreadable by anyone,
-- including its own uploader — visibility runs entirely through the postcards
-- row, so there is nothing to see until that row exists. A real (unwrapped)
-- insert, relying on the suite's own final rollback to clean it up, same as
-- the postcard_likes deletion earlier in this file.
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'postcards/00000000-0000-0000-0000-00000000000c/55555555-5555-5555-5555-555555555555.jpg',
   '00000000-0000-0000-0000-00000000000c', '{"mimetype":"image/jpeg","size":1024}');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-00000000000c/55555555-5555-5555-5555-555555555555.jpg'),
  0, 'even the uploader cannot read their own object before a postcards row references it');

-- INSERT: own folder, well-formed path, matching mimetype and size all have
-- to hold at once. assert_allowed's own subtransaction undoes this, so the
-- object above (inserted for real) is the only lasting row from this block.
select assert_allowed($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'postcards/00000000-0000-0000-0000-00000000000c/11111111-1111-1111-1111-111111111111.jpg',
          '00000000-0000-0000-0000-00000000000c', '{"mimetype":"image/jpeg","size":1024}')$$,
  'a rider can upload into their own folder with a well-formed path, jpeg mimetype and size under the cap');

select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'postcards/00000000-0000-0000-0000-00000000000a/22222222-2222-2222-2222-222222222222.jpg',
          '00000000-0000-0000-0000-00000000000c', '{"mimetype":"image/jpeg","size":1024}')$$,
  'a rider cannot write into another rider''s folder');

select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'postcards/00000000-0000-0000-0000-00000000000c/33333333-3333-3333-3333-333333333333.png',
          '00000000-0000-0000-0000-00000000000c', '{"mimetype":"image/png","size":1024}')$$,
  'a rider cannot upload a non-jpeg mimetype even into their own folder');

select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'postcards/00000000-0000-0000-0000-00000000000c/44444444-4444-4444-4444-444444444444.jpg',
          '00000000-0000-0000-0000-00000000000c', '{"mimetype":"image/jpeg","size":10485760}')$$,
  'a rider cannot upload past the size cap even with a matching mimetype');

select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'postcards/00000000-0000-0000-0000-00000000000c/not-a-uuid.jpg',
          '00000000-0000-0000-0000-00000000000c', '{"mimetype":"image/jpeg","size":1024}')$$,
  'a malformed filename is rejected even with correct folder ownership');

-- DELETE: an uploader can remove their own object, never someone else's. This
-- is what makes createPostcard's compensating cleanup possible when the
-- postcards insert fails after the upload already succeeded.
--
-- DELETE is filtered by USING rather than refused — same trap postcards' own
-- tests already call out (line ~548): a wrong-owner delete silently touches
-- zero rows instead of raising, so the row's survival is the evidence, not
-- an exception.
delete from storage.objects where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg';
select assert_eq((select count(*)::int from storage.objects where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg'),
  1, 'a rider cannot delete another rider''s postcard image');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
-- The positive half needs a real delete for the same reason the negative half
-- above does: assert_allowed only proves the statement did not error, and this
-- one would not error even if the policy filtered it to nothing.
savepoint rider_deletes_own_image;
delete from storage.objects where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg';
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg'),
  0, 'a rider can delete their own postcard image');
rollback to savepoint rider_deletes_own_image;

-- No anonymous access, same as everywhere else. anon holds a broad table
-- grant in this harness (see harness.sql) precisely so this is a test of RLS,
-- not of a missing grant: the SELECT returns zero rows rather than erroring,
-- because RLS silently filters rather than refusing when no policy matches;
-- the INSERT genuinely errors, because a failed WITH CHECK on a write does.
set role anon;
select assert_eq((select count(*)::int from storage.objects), 0,
  'anon reads zero rows from storage.objects, no matter what is in it');
select assert_denied($$
  insert into storage.objects (bucket_id, name, metadata)
  values ('media', 'postcards/anon/00000000-0000-0000-0000-000000000000.jpg', '{"mimetype":"image/jpeg","size":1}')$$,
  'anon cannot upload to storage at all');
reset role;
set role authenticated;

\echo ''
\echo '# A rider cannot read an image by claiming its path (migration 010)'

-- The hole 010 was written with and fixed before it was ever applied. The
-- storage SELECT policy delegates to postcards via EXISTS, which inherits RLS
-- from *whatever row matches the path* — not from the object's owner. Nothing
-- in 009 bound image_path to the author's own folder, so a rider could insert
-- their own app-wide postcard carrying someone else's path and make that
-- object readable to themselves and to every signed-in rider, blocked or not.
-- image_path reaches the browser (lib/data selects *), so the path is known to
-- anyone who ever saw the postcard legitimately.
--
-- Two independent brakes now, and both are asserted: the write is refused, and
-- even a row that somehow exists does not expose the object.

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

-- 000c is not a member of private club c1, so neither the postcard nor its
-- object is reachable. This is the precondition the exploit tried to defeat.
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dec2.jpg'),
  0, 'a private club image is invisible to an outsider to begin with');

select assert_denied($$
  insert into postcards (author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-00000000000c', null,
          'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dec2.jpg')$$,
  'a rider cannot claim another rider''s image path on their own postcard');

-- The unique index refuses a second postcard on a path another postcard already
-- holds, which is the first brake. Assert that directly rather than leaving it
-- implied.
reset role;
select assert_rejected($$
  insert into postcards (id, author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-00000000000c', null,
          'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dec2.jpg')$$,
  '23505', 'two postcards cannot share one image path, even inserted as owner');

-- Belt, and the one that would have caught the original hole: the leak was in
-- the READ, so prove the storage SELECT policy refuses on its own — with the
-- unique index and the INSERT policy both stepped around. Uses an object in
-- 000a's folder that no postcard points at, so nothing else can do the work.
insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'postcards/00000000-0000-0000-0000-00000000000a/eeeeeeee-0000-4000-8000-00000000beef.jpg',
          '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1024}');
insert into postcards (id, author_id, club_id, image_path)
  values ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000000c', null,
          'postcards/00000000-0000-0000-0000-00000000000a/eeeeeeee-0000-4000-8000-00000000beef.jpg');
set role authenticated;

select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-00000000000a/eeeeeeee-0000-4000-8000-00000000beef.jpg'),
  0, 'a forged postcard row does not expose an image from another rider''s folder');

select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-00000000000a/eeeeeeee-0000-4000-8000-00000000beef.jpg'),
  0, 'and it stays invisible to every other signed-in rider too');

-- Guards against over-tightening: the ordinary path must still resolve.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dec2.jpg'),
  1, 'the author still reads their own club image');

reset role;
delete from postcards where id = '00000000-0000-0000-0000-0000000000e9';
delete from storage.objects
  where name = 'postcards/00000000-0000-0000-0000-00000000000a/eeeeeeee-0000-4000-8000-00000000beef.jpg';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

\echo ''
\echo '# Comments inherit their postcard''s audience (migration 011)'

-- A comment has no audience of its own. Every policy on postcard_comments
-- delegates to postcards through EXISTS, so these assertions are really about
-- whether that delegation holds — nothing in 011 restates the club predicate,
-- and if it ever does, one of these two counts stops agreeing with the other.
-- Fixtures: cc1/cc3/cc4 on the global postcard e1, cc2 on e2 inside PRIVATE
-- club c1.

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e2'),
  0, 'an outsider cannot read comments on a private club''s postcard');
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc2'),
  0, 'and cannot reach that comment by its id either');
-- The bulk read is the one a feed actually issues. A targeted lookup can pass
-- while the list query still leaks, so both are asserted — same pairing the
-- postcards section uses.
select assert_eq((select count(*)::int from postcard_comments),
  3, 'the outsider''s whole comment read excludes the private club''s comment');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e2'),
  1, 'a club member reads comments on that club''s postcard (guards against over-tightening)');
select assert_eq((select count(*)::int from postcard_comments), 4,
  'a rider with no blocks reads every comment they have audience for');

-- Writing inherits the same predicate, so "cannot comment on what you cannot
-- see" needs no clause of its own in the insert policy.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_denied($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000c', 'let me in')$$,
  'a rider cannot comment on a postcard they cannot see');
select assert_allowed($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', 'Great shot')$$,
  'a rider can comment on a postcard they can see (guards against over-tightening)');

\echo ''
\echo '# Comments cannot be forged or edited, and moderation is the author''s (migration 011)'

select assert_denied($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 'forged')$$,
  'a rider cannot forge author_id on a comment');

-- No UPDATE policy and no UPDATE grant, so this is refused at the privilege
-- layer rather than filtered — including for the comment's own author, which
-- is the point: editing means designing "edited", and nothing has.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_denied($$
  update postcard_comments set body = 'edited'
  where id = '00000000-0000-0000-0000-000000000cc1'$$,
  'a rider cannot edit their own comment');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_denied($$
  update postcard_comments set body = 'edited'
  where id = '00000000-0000-0000-0000-000000000cc1'$$,
  'not even the postcard''s author can edit a comment on it');

-- DELETE is filtered by USING rather than refused, so a wrong-hands delete
-- silently touches zero rows instead of raising. The surviving row is the
-- evidence, same trap the postcards and storage sections already call out.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
delete from postcard_comments where id = '00000000-0000-0000-0000-000000000cc1';
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc1'),
  1, 'a rider cannot delete someone else''s comment on someone else''s postcard');

-- The positive form carries the same trap in reverse, and it is sharper than
-- it looks: assert_allowed only proves the statement did not ERROR, and a
-- DELETE that matches nothing does not error. Using it here would pass against
-- a policy that permits no deletion at all — verified by mutation, where
-- reducing this policy to `author_id = auth.uid()` left an assert_allowed form
-- of the moderation case still green. So both positives delete for real, count
-- the row, and put it back as superuser for the sections that follow.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
delete from postcard_comments where id = '00000000-0000-0000-0000-000000000cc1';
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc1'),
  0, 'a rider can delete their own comment');
reset role;
insert into postcard_comments (id, postcard_id, author_id, body) values
  ('00000000-0000-0000-0000-000000000cc1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-00000000000b', 'Beautiful light on that road.');
set role authenticated;

-- The second branch of the delete policy: moderation on your own post. e1 is
-- authored by 000a; cc1 is not, so only that branch can do this.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
delete from postcard_comments where id = '00000000-0000-0000-0000-000000000cc1';
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc1'),
  0, 'a postcard author can delete a comment on their own postcard');

-- The limit of that branch, and the reason public.moderate_comment() exists.
-- RLS filters a DELETE by what the caller may READ — a WHERE clause reads
-- columns, so the SELECT policy applies. An author who blocked their harasser
-- therefore cannot clear that comment off their own photo with any query a
-- client would write. This was documented as working, was not, and is now
-- pinned in both directions: the policy alone fails, the function succeeds.
reset role;
insert into postcard_comments (id, postcard_id, author_id, body) values
  ('00000000-0000-0000-0000-000000000cc9', '00000000-0000-0000-0000-0000000000e4',
   '00000000-0000-0000-0000-00000000001b', 'harassment from a blocked rider');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000000000e4'),
  1, 'the author can see their own postcard');
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc9'),
  0, 'but not the comment on it from a rider they blocked');

delete from postcard_comments where id = '00000000-0000-0000-0000-000000000cc9';
reset role;
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc9'),
  1, 'so a qualified delete removes nothing — the policy cannot reach an unreadable row');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select public.moderate_comment('00000000-0000-0000-0000-000000000cc9'))::text,
  'true', 'moderate_comment() reports that it removed the unreadable comment');
reset role;
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc9'),
  0, 'and the comment is actually gone');
set role authenticated;

-- The function is not a back door. It deletes only on a postcard the CALLER
-- authored, checked against auth.uid() inside the function rather than against
-- anything passed in — so security definer moves the authorization, it does not
-- remove it. e1 belongs to 000a, so 000c moderating it must be refused.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select public.moderate_comment('00000000-0000-0000-0000-000000000cc1'))::text,
  'false', 'a rider cannot moderate a comment on someone else''s postcard');
select assert_eq((select public.moderate_comment(gen_random_uuid()))::text,
  'false', 'and a comment that does not exist is a clean false, not an error');
reset role;
insert into postcard_comments (id, postcard_id, author_id, body) values
  ('00000000-0000-0000-0000-000000000cc1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-00000000000b', 'Beautiful light on that road.');
set role authenticated;
-- ...and that right does not extend past their own postcards. cc2 sits on e2,
-- which 000a also authored, so the negative needs a postcard they did NOT
-- author: e5, by the outsider. A comment is written there for the purpose.
reset role;
insert into postcard_comments (id, postcard_id, author_id, body) values
  ('00000000-0000-0000-0000-000000000cc5', '00000000-0000-0000-0000-0000000000e5',
   '00000000-0000-0000-0000-00000000000b', 'On someone else''s postcard.');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
delete from postcard_comments where id = '00000000-0000-0000-0000-000000000cc5';
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc5'),
  1, 'moderation does not extend to comments on a postcard someone else authored');
reset role;
delete from postcard_comments where id = '00000000-0000-0000-0000-000000000cc5';
set role authenticated;

-- Validity, not authorization: RLS never enforces shape, so the body bounds
-- are a CHECK constraint and refuse with 23514 after the policy has passed.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', '')$$,
  '23514', 'an empty comment body is rejected');
select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', '     ')$$,
  '23514', 'a whitespace-only comment body is rejected');
select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', repeat('x', 1001))$$,
  '23514', 'a comment body over 1000 characters is rejected');

-- The ceiling is on the RAW length and the floor on the TRIMMED one, and both
-- the constraint and its mirror in lib/validation/comments.ts go out of their
-- way to explain why. Nothing asserted it: changing the ceiling to
-- length(btrim(body)) — the exact mistake those comments exist to prevent —
-- passed the whole suite. `repeat('x', 1001)` cannot tell the two apart, so
-- this pads a legal 1000-character body with whitespace instead.
select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c',
          repeat(' ', 500) || repeat('x', 1000))$$,
  '23514', 'whitespace padding cannot smuggle a 1000-character body past the raw ceiling');


\echo ''
\echo '# Blocking hides comments in both directions (decision #2, migration 011)'

-- cc3 is by the blocked rider and cc4 by the blocker, both on the same
-- globally visible postcard. Each must vanish for the other and for neither
-- of them alone — a one-directional block is worse than none.

select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc3'),
  0, 'the blocker does not see the blocked rider''s comment');
select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  2, 'and the comment count they read on that postcard drops with it');

select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from postcard_comments
                   where id = '00000000-0000-0000-0000-000000000cc4'),
  0, 'and vice versa: the blocked rider does not see the blocker''s comment');
select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  2, 'their own comment is still theirs to read, so the count matches');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  3, 'an unrelated rider counts all three (comment counts are per-viewer, like likes)');

-- A blocked rider cannot comment on the blocker's postcard at all, and the
-- insert policy never mentions blocks — it inherits the refusal from the
-- postcards select policy through its EXISTS.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_denied($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000001a', 'hello')$$,
  'a rider cannot comment on a postcard hidden from them by a block');

-- Blocking is a visibility filter, never a delete (009 §7). Every comment row
-- is still there; only who can read it changed.
reset role;
select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  3, 'all three comment rows still exist in the table beneath RLS');
set role authenticated;

\echo ''
\echo '# Reports are private to the reporter and one per postcard (migration 011)'

-- Seeded: ff1, filed by the outsider against e1. Nobody but the reporter can
-- read it — there is no admin role in this project, which migration 011's
-- header records as a known trust-and-safety gap rather than a design.

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from postcard_reports), 1,
  'a rider reads the report they filed');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from postcard_reports), 0,
  'a rider cannot read another rider''s reports');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq((select count(*)::int from postcard_reports), 0,
  'not even the reported postcard''s author can read reports about it');

-- One report per rider per postcard, so a repeat press is a no-op rather than
-- a brigading tool. Same idempotency shape as blocks.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000e1', 'spam')$$,
  '23505', 'a rider cannot report the same postcard twice');
select assert_allowed($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000e1', 'spam')
  on conflict do nothing$$,
  'the same report written with on conflict do nothing is a silent no-op');

select assert_denied($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'spam')$$,
  'a rider cannot file a report in another rider''s name');
select assert_denied($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000e2', 'spam')$$,
  'a rider cannot report a postcard they cannot see');
select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000e3', 'because')$$,
  '23514', 'a reason outside the constrained set is rejected');
select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason, note)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000e3', 'spam', '   ')$$,
  '23514', 'a whitespace-only note is rejected (a note is optional, an empty one is not a note)');
-- The note's ceiling had no assertion at all: dropping `length(note) <= 1000`
-- outright passed the whole suite. Nothing reads this table and nothing may
-- delete from it, so an unbounded note is stored forever with no way to clear it.
select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason, note)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000e3',
          'spam', repeat('x', 1001))$$,
  '23514', 'a report note over 1000 characters is rejected');
select assert_allowed($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000e3', 'harassment')$$,
  'a rider can report a different postcard they can see (guards against over-tightening)');

-- A report is a statement at a moment in time. Neither grant exists, so both
-- are refused at the privilege layer rather than filtered to zero rows.
select assert_denied($$
  update postcard_reports set reason = 'hate'
  where id = '00000000-0000-0000-0000-000000000ff1'$$,
  'nobody can edit a report, including its author');
select assert_denied($$
  delete from postcard_reports where id = '00000000-0000-0000-0000-000000000ff1'$$,
  'nobody can withdraw a report, including its author');

\echo ''
\echo '# Hiding a postcard is per-viewer, and it happens in RLS (migration 011)'

-- Unlike a block, a hide is one-directional and affects nobody but its owner.
-- Nothing seeds a hide — a seeded one would silently move the postcard counts
-- every earlier section asserts — so the rows below are written live, through
-- the INSERT policy, which puts that policy under test as a side effect.

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from postcards), 4,
  'the feed the hider reads before hiding anything');
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'and the postcard about to be hidden is in it');

insert into postcard_hides (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c');

select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  0, 'a hidden postcard is gone for the rider who hid it');
select assert_eq((select count(*)::int from postcards), 3,
  'and it is gone from their whole feed, not only from a targeted lookup');

-- The hide reaches everything that delegates to the postcards select policy,
-- with no restatement anywhere: likes, comments and the Storage object behind
-- the image all go with it.
select assert_eq((select count(*)::int from postcard_likes
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  0, 'the hidden postcard''s likes go with it');
select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  0, 'so do its comments');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg'),
  0, 'and so does the Storage object behind its image');
select assert_denied($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', 'still here')$$,
  'and the hider can no longer comment on it');

-- ...and nobody else's feed moved at all. This is the half that makes "hide"
-- different from "block".
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from postcards), 5,
  'another rider''s feed is untouched by someone else''s hide');
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'and they still see the hidden postcard itself');

-- The author branch of the select policy is unconditional and comes first, so
-- a self-hide is accepted and inert. 009 made that branch unconditional so a
-- rider never loses their own photo; a self-hide that removed it from their own
-- profile grid would reintroduce exactly that loss, and there is no "hidden
-- postcards" screen from which to undo it.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
insert into postcard_hides (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a');
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'an author still sees their own postcard after hiding it — the hide is inert');
delete from postcard_hides
  where postcard_id = '00000000-0000-0000-0000-0000000000e1'
    and user_id = '00000000-0000-0000-0000-00000000000a';

-- Hides are private. A rider who could read them would learn what everyone
-- else has quietly muted.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from postcard_hides), 0,
  'a rider cannot read another rider''s hides');
-- e4, not the already-hidden e1: against e1 this insert collides with 000c's
-- existing row and would be refused as a duplicate, which is a different claim
-- from "refused by RLS" and would pass for the wrong reason.
select assert_denied($$
  insert into postcard_hides (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000000c')$$,
  'a rider cannot hide a postcard on another rider''s behalf');
select assert_denied($$
  update postcard_hides set user_id = '00000000-0000-0000-0000-00000000000b'
  where postcard_id = '00000000-0000-0000-0000-0000000000e1'$$,
  'nobody can update a hide row at all');

-- Deliberately written WITHOUT a where clause, and that is the whole point.
-- Postgres applies SELECT policies to a DELETE only when the statement has to
-- read columns — a where clause or returning. A qualified `delete ... where
-- user_id = <someone else>` is therefore refused by the SELECT policy before
-- the DELETE policy is ever consulted, and passes even if the DELETE policy
-- says `using (true)`: verified by mutation, where that exact weakening
-- survived the qualified form. The bare delete reads nothing, so only the
-- DELETE policy stands between this rider and every hide row in the table.
delete from postcard_hides;
reset role;
select assert_eq((select count(*)::int from postcard_hides
                   where user_id = '00000000-0000-0000-0000-00000000000c'),
  1, 'an unqualified delete cannot lift someone else''s hide');
set role authenticated;

-- Unhide must work from out of view, or the hide is a one-way door: the DELETE
-- policy deliberately carries no visibility requirement, same as unliking.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
delete from postcard_hides
  where postcard_id = '00000000-0000-0000-0000-0000000000e1'
    and user_id = '00000000-0000-0000-0000-00000000000c';
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'unhiding restores the postcard, from a state where it could not be seen');
select assert_eq((select count(*)::int from postcards), 4,
  'and the feed is back to what it was');

\echo ''
\echo '# Deleting a postcard takes its interactions with it (migration 011)'

-- All three 011 tables cascade on postcard_id, and that is load-bearing rather
-- than tidy: every one of their select policies resolves visibility by
-- delegating to the postcards row. An orphan would be a row whose audience
-- predicate has nothing left to delegate to — invisible to everyone, forever,
-- and still counted by anything that reads beneath RLS.
--
-- Run as owner: the cascade is a foreign key, not a policy, so RLS would only
-- obscure what is being tested. A hide is written first because the live hide
-- section above deliberately unwinds its own.
reset role;
insert into postcard_hides (postcard_id, user_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c');
select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  3, 'precondition: the postcard about to be deleted carries comments');

delete from postcards where id = '00000000-0000-0000-0000-0000000000e1';

select assert_eq((select count(*)::int from postcard_comments
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  0, 'deleting a postcard cascades its comments');
select assert_eq((select count(*)::int from postcard_hides
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  0, 'and its hides');
select assert_eq((select count(*)::int from postcard_reports
                   where postcard_id = '00000000-0000-0000-0000-0000000000e1'),
  0, 'and the reports filed against it — which is also how a report is lost, see 011''s header');
-- What does NOT go with it is the Storage object, because no foreign key
-- crosses into Storage. 010 §3 and the comment 011 puts on the postcards
-- delete policy both say so; this is that claim, asserted.
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000d1a1.jpg'),
  1, 'but the Storage object survives — deletePostcard must remove it in the same request');
set role authenticated;

\echo ''
\echo '# The 011 tables are locked down by construction (migration 011)'

-- "A rider cannot delete another rider's postcard" is asserted where the
-- postcards delete policy is exercised, near the top of the postcard-writes
-- section — 011 checked that policy exists rather than adding one, so the
-- assertion stays where it already lives instead of being duplicated here.

reset role;

select assert_eq(
  (select count(*)::int from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('postcard_comments', 'postcard_hides', 'postcard_reports')
      and relrowsecurity),
  3, 'row level security is enabled on all three new tables');

-- 011 §3 drops the postcards SELECT policy by catalog lookup and recreates one.
-- Policies for the same command are OR'd, so a leftover would silently restore
-- every hidden postcard. The suite already checks this globally (see the 009
-- section); this pins it to the table 011 actually rewrote.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'SELECT'),
  1, 'postcards still carries exactly one SELECT policy after 011 recreated it');

-- No table 011 created has a mutable column, so none carries an UPDATE policy
-- or an UPDATE grant. The grant is the layer that holds independently of the
-- policies.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and cmd = 'UPDATE'
      and tablename in ('postcard_comments', 'postcard_hides', 'postcard_reports')),
  0, 'no UPDATE policy exists on any table 011 created');
select assert_eq(has_table_privilege('authenticated', 'public.postcard_comments', 'update'),
  false, 'authenticated holds no UPDATE grant on postcard_comments');
select assert_eq(has_table_privilege('authenticated', 'public.postcard_hides', 'update'),
  false, 'authenticated holds no UPDATE grant on postcard_hides');
select assert_eq(has_table_privilege('authenticated', 'public.postcard_reports', 'update'),
  false, 'authenticated holds no UPDATE grant on postcard_reports');
select assert_eq(has_table_privilege('authenticated', 'public.postcard_reports', 'delete'),
  false, 'authenticated holds no DELETE grant on postcard_reports — a report cannot be withdrawn');
select assert_eq(has_table_privilege('authenticated', 'public.postcard_comments', 'delete'),
  true, 'authenticated can delete comments (own, or on their own postcard)');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

\echo ''
\echo '# No anonymous access anywhere (migrations 002, 007)'

-- ===========================================================================
-- 014: profile avatars, covers and countries
-- ===========================================================================
-- Three rules, and the interesting one is that NONE of them mentions blocking.
-- The countries policy and both Storage read policies inherit the profiles
-- SELECT predicate through an EXISTS, so what these assert is that the
-- inheritance actually works — a restated copy would pass a test written
-- against itself.

\echo ''
\echo '014: profile media and countries'

set role authenticated;

-- An unrelated rider sees the blocker's countries and media.
--
-- Identity is `test.uid`, which is what harness.sql's auth.uid() reads. The
-- first version of this block used `request.jwt.claims`, copied from 014's own
-- verification footer — that is the idiom for the REAL Supabase database, where
-- auth.uid() parses the JWT. Here it set a GUC nothing reads, auth.uid()
-- returned NULL, and the profiles policy's `username is not null` arm then made
-- every profile visible. The assertions failed loudly, which is the only reason
-- this is a comment rather than a silent hole: a NULL uid makes *more* visible,
-- so a positive assertion written the same way would have passed while proving
-- nothing.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq(
  (select count(*)::int from profile_countries
    where user_id = '00000000-0000-0000-0000-00000000001a'),
  2, 'an unrelated rider sees another rider''s countries');
select assert_eq(
  (select count(*)::int from storage.objects
    where name = 'avatars/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f1.jpg'),
  1, 'an unrelated rider can read another rider''s avatar object');
select assert_eq(
  (select count(*)::int from storage.objects
    where name = 'covers/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f2.jpg'),
  1, 'an unrelated rider can read another rider''s cover object');

-- The blocked rider sees none of it. This is the whole point of inheriting the
-- profiles predicate rather than restating it.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq(
  (select count(*)::int from profile_countries
    where user_id = '00000000-0000-0000-0000-00000000001a'),
  0, 'a blocked rider cannot read the blocker''s countries');
select assert_eq(
  (select count(*)::int from storage.objects
    where name = 'avatars/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f1.jpg'),
  0, 'a blocked rider cannot read the blocker''s avatar object');
select assert_eq(
  (select count(*)::int from storage.objects
    where name = 'covers/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f2.jpg'),
  0, 'a blocked rider cannot read the blocker''s cover object');

-- Symmetry: the block row is directional, the effect is not.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq(
  (select count(*)::int from profile_countries
    where user_id = '00000000-0000-0000-0000-00000000001b'),
  0, 'the blocker cannot read the blocked rider''s countries either');

-- Writing countries.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
-- `on conflict do nothing`, which is the statement `addCountry` actually
-- sends (supabase-js `upsert` with `ignoreDuplicates: true`). The first
-- version of this assertion issued a PLAIN insert and passed, while the action
-- — then using the default merge form — failed 42501 on every call. A suite
-- that exercises a different statement than production is not covering
-- production, which is the same class of gap as `assert_allowed` being unable
-- to prove an UPDATE.
select assert_allowed(
  $$insert into profile_countries (user_id, country_code)
      values ('00000000-0000-0000-0000-00000000000c', 'FR')
      on conflict (user_id, country_code) do nothing$$,
  'a rider adds a country to their own profile (the on-conflict form the action sends)');

-- The regression guard. `on conflict do update` is what supabase-js emits
-- WITHOUT `ignoreDuplicates`, and Postgres checks UPDATE privilege when it
-- plans the statement rather than when a row actually conflicts — so this is
-- refused even though no duplicate exists. 014 grants no UPDATE on this table
-- by design; if someone adds one, or drops `ignoreDuplicates`, this fails.
select assert_denied(
  $$insert into profile_countries (user_id, country_code)
      values ('00000000-0000-0000-0000-00000000000c', 'BE')
      on conflict (user_id, country_code) do update set country_code = excluded.country_code$$,
  'the merge form is refused — there is no UPDATE grant, and none is wanted');

-- The invariant stated directly, mirroring the storage.objects UPDATE assertion
-- above. The `assert_denied` guard proves the behaviour; these two prove the
-- *reason*, so someone who hits that 42501 in future and reaches for
-- `grant update` fails here rather than quietly widening the table.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profile_countries' and cmd = 'UPDATE'),
  0, 'profile_countries has no UPDATE policy — a country is added or removed, never edited');
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated' and table_name = 'profile_countries'
      and privilege_type = 'UPDATE'),
  0, 'authenticated holds no UPDATE grant on profile_countries');

-- Adding a country twice is a double-tap, not an error.
savepoint c_twice;
insert into profile_countries (user_id, country_code)
  values ('00000000-0000-0000-0000-00000000000c', 'IT')
  on conflict (user_id, country_code) do nothing;
insert into profile_countries (user_id, country_code)
  values ('00000000-0000-0000-0000-00000000000c', 'IT')
  on conflict (user_id, country_code) do nothing;
select assert_eq(
  (select count(*)::int from profile_countries
    where user_id = '00000000-0000-0000-0000-00000000000c' and country_code = 'IT'),
  1, 'adding the same country twice leaves one row');
rollback to savepoint c_twice;
select assert_denied(
  $$insert into profile_countries (user_id, country_code)
      values ('00000000-0000-0000-0000-00000000000a', 'ES')$$,
  'a rider cannot add a country to someone else''s profile');

-- The code shape is a constraint, not a policy — 23514, not 42501.
select assert_rejected(
  $$insert into profile_countries (user_id, country_code)
      values ('00000000-0000-0000-0000-00000000000c', 'fr')$$,
  '23514', 'a lowercase country code is rejected');
select assert_rejected(
  $$insert into profile_countries (user_id, country_code)
      values ('00000000-0000-0000-0000-00000000000c', 'FRA')$$,
  '23514', 'a three-letter country code is rejected');

-- Removing is permitted, and assert_allowed cannot prove a DELETE — see the
-- comment on that helper. Run it and count the row.
savepoint c_del;
delete from profile_countries
  where user_id = '00000000-0000-0000-0000-00000000001a' and country_code = 'NL';
select assert_eq(
  (select count(*)::int from profile_countries
    where user_id = '00000000-0000-0000-0000-00000000001a' and country_code = 'NL'),
  1, 'a rider cannot delete someone else''s country (the row survives)');
rollback to savepoint c_del;

-- Path ownership is a CHECK on profiles, so it fires before any policy and
-- reports 23514 rather than an RLS refusal. That distinction is the reason
-- 014 made it a constraint instead of only a Storage policy clause.
select assert_rejected(
  $$update profiles
       set avatar_path = 'avatars/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000f9.jpg'
     where id = '00000000-0000-0000-0000-00000000000c'$$,
  '23514', 'a rider cannot claim an avatar path in another rider''s folder');
select assert_rejected(
  $$update profiles
       set cover_image_path = 'covers/00000000-0000-0000-0000-00000000000c/not-a-uuid.jpg'
     where id = '00000000-0000-0000-0000-00000000000c'$$,
  '23514', 'a malformed cover path is rejected on shape');

-- The own-folder branch on the SELECT policies, and why it exists.
--
-- Readability is otherwise "some profiles row points at me", so the moment an
-- avatar is replaced the previous object stops being selectable — and Postgres
-- ANDs SELECT quals into a DELETE whose WHERE names table columns, so the
-- cleanup delete in `setProfileImage` matched zero rows, reported no error, and
-- leaked one billable object per replacement, permanently. Extending the orphan
-- sweeper could not have fixed it: an orphan is unreferenced by definition, so
-- under the `exists` alone it was unreadable and undeletable by anyone.
savepoint orphan;
set local role postgres;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'avatars/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000e1.jpg',
   '00000000-0000-0000-0000-00000000000c', '{"mimetype":"image/jpeg","size":10}');
set local role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

select assert_eq(
  (select count(*)::int from storage.objects
    where name = 'avatars/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000e1.jpg'),
  1, 'a rider can see an object in their own folder that no profile row references');

delete from storage.objects
  where name = 'avatars/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000e1.jpg';
select assert_eq(
  (select count(*)::int from storage.objects
    where name = 'avatars/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000e1.jpg'),
  0, 'and can delete it — which is what makes replacing an avatar not leak the old one');

-- The branch is scoped to the folder, not to the bucket: someone else's
-- unreferenced object stays invisible.
--
-- Filtered to `avatars/` deliberately. The first version of this assertion
-- matched on `foldername[2]` alone and failed — because that segment is the
-- uploader's uid in EVERY folder, so it also counted the rider's `postcards/`
-- object, which 010's policy makes legitimately visible. The test was wrong,
-- not the policy; recorded because the failure looked exactly like a leak.
set local role postgres;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'avatars/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000e2.jpg',
   '00000000-0000-0000-0000-00000000000c', '{"mimetype":"image/jpeg","size":10}');
set local role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq(
  (select count(*)::int from storage.objects
    where (storage.foldername(name))[1] = 'avatars'
      and (storage.foldername(name))[2] = '00000000-0000-0000-0000-00000000000c'),
  0, 'the own-folder branch does not expose another rider''s unreferenced avatar');
rollback to savepoint orphan;

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

-- Uploading into someone else's folder.
select assert_denied(
  $$insert into storage.objects (bucket_id, name, owner, metadata)
      values ('media',
              'avatars/00000000-0000-0000-0000-00000000001a/00000000-0000-0000-0000-0000000000fa.jpg',
              '00000000-0000-0000-0000-00000000000c',
              '{"mimetype":"image/jpeg","size":10}')$$,
  'a rider cannot upload an avatar into another rider''s folder');
select assert_denied(
  $$insert into storage.objects (bucket_id, name, owner, metadata)
      values ('media',
              'covers/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000fb.png',
              '00000000-0000-0000-0000-00000000000c',
              '{"mimetype":"image/png","size":10}')$$,
  'a non-jpeg cover upload is refused');

reset role;

-- Three policies per upload surface (insert, select, delete), no UPDATE on any
-- of them, so no upsert path exists for any of them.
--
-- This was a whole-table count of 9 and had to be edited when 014 added two
-- surfaces, then again when 016 added two more. An assertion that needs bumping
-- on every unrelated change stops being read and starts being silenced — and
-- bumping the number is precisely the repair 014's own footnote warns against,
-- because a total stops testing "no leftover policy to OR against" for any one
-- folder the moment a second folder exists.
--
-- What it always meant is: every policy belongs to a surface, and no surface has
-- a fourth. That is what these say. A new surface fails the first assertion
-- loudly and its migration adds its own count — which is the outcome you want,
-- rather than a silent pass.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname !~* '(postcard|avatar|cover)'),
  0, 'every storage.objects policy names the upload surface it belongs to');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname ~* '(avatar|cover)' and policyname !~* 'club'),
  6, 'the profile surfaces carry three policies each — avatars/ and covers/');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and not (roles = '{authenticated}')),
  0, 'every storage.objects policy targets authenticated only');


-- ===========================================================================
-- 015: the unread watermark
-- ===========================================================================

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

\echo ''
\echo '# A watermark belongs to one rider and one audience they can read (migration 015)'

select assert_allowed($$
  insert into feed_reads (user_id, club_id)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1')$$,
  'a rider can mark a club they belong to as seen');

-- c5 is the club 000a is deliberately not a member of. The WITH CHECK arm is
-- what closes the FK existence oracle described in 015 §2.
select assert_denied($$
  insert into feed_reads (user_id, club_id)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c5')$$,
  'a rider cannot mark a club they do not belong to');

select assert_denied($$
  insert into feed_reads (user_id, club_id)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1')$$,
  'a rider cannot write another rider''s watermark');

select assert_allowed($$
  insert into feed_reads (user_id, club_id) values ('00000000-0000-0000-0000-00000000000a', null)$$,
  'a rider can mark the app-wide feed as seen');

-- The assertion that catches a missing `nulls not distinct`. Under a plain
-- UNIQUE these two inserts both succeed, the rider accumulates a second
-- app-wide row every visit, and the upsert never finds a conflict to update —
-- a bug that would look like "the badge never clears" rather than like a
-- constraint problem.
insert into feed_reads (user_id, club_id) values ('00000000-0000-0000-0000-00000000000a', null);
select assert_rejected($$
  insert into feed_reads (user_id, club_id) values ('00000000-0000-0000-0000-00000000000a', null)$$,
  '23505', 'a second app-wide watermark collides — NULL audiences are not distinct');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from feed_reads), 0,
  'a rider sees none of another rider''s watermarks');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_denied($$
  update feed_reads set user_id = '00000000-0000-0000-0000-00000000000b' where club_id is null$$,
  'a rider cannot hand their watermark to someone else');

\echo ''
\echo '# The badge counts activity since the watermark, under RLS (migration 015)'

-- Deterministic rather than seed-dependent: this postcard is created inside the
-- suite's transaction, so `now()` — which is the transaction start time — sits
-- strictly before it. An ancient watermark must count it; a watermark of now()
-- must not.
insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-0000000000ef', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000c1',
   'postcards/00000000-0000-0000-0000-00000000000a/ffffffff-0000-4000-8000-0000000015a1.jpg',
   'After the watermark');

insert into feed_reads (user_id, club_id, last_seen_at)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1',
        now() - interval '10 years');

select assert_eq(
  (select unread from club_unread_counts() where club_id = '00000000-0000-0000-0000-0000000000c1') > 0,
  true, 'activity after the watermark counts as unread');

update feed_reads set last_seen_at = now()
 where user_id = '00000000-0000-0000-0000-00000000000a'
   and club_id = '00000000-0000-0000-0000-0000000000c1';

select assert_eq(
  (select unread from club_unread_counts() where club_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'advancing the watermark clears the badge');

-- A club with no postcards and no rides badges zero rather than going missing:
-- the row comes from club_members, so every joined club is always represented.
select assert_eq(
  (select unread from club_unread_counts() where club_id = '00000000-0000-0000-0000-0000000000c2'),
  0, 'a joined club with no activity returns a row reading zero');

select assert_eq(
  (select count(*)::int from club_unread_counts() where club_id = '00000000-0000-0000-0000-0000000000c5'),
  0, 'a club the rider has not joined gets no badge at all');

-- 000c authored a postcard in c1 and is not a member of it ("Posted before I
-- left"), which is exactly the case where a membership-driven badge and a
-- content-driven one would disagree.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq(
  (select count(*)::int from club_unread_counts() where club_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'authoring into a club you have left does not badge it');

\echo ''
\echo '# The watermark table is locked down by construction (migration 015)'

select assert_eq(has_table_privilege('authenticated', 'public.feed_reads', 'delete'),
  false, 'authenticated holds no DELETE grant on feed_reads — a watermark cannot be reset');
select assert_eq(has_table_privilege('authenticated', 'public.feed_reads', 'update'),
  true, 'authenticated can advance a watermark — the upsert needs it');

-- SECURITY INVOKER is what makes it safe to publish at /rest/v1/rpc/. If this
-- ever flips to DEFINER the function stops obeying the blocks and hides that
-- the postcards policy applies, and starts counting rows the caller cannot read.
select assert_eq((select prosecdef from pg_proc where proname = 'club_unread_counts'),
  false, 'club_unread_counts runs as the caller, so RLS decides what it counts');

select assert_eq(
  (select count(*)::int from pg_indexes
    where tablename = 'rides' and indexname = 'rides_club_id_created_at_idx'),
  1, 'the rides half of the badge is indexed rather than a sequential scan');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);


-- ===========================================================================
-- 017: a ride belongs only to a club you are in
-- ===========================================================================

set role authenticated;

\echo ''
\echo '# A ride cannot be posted into a club you do not belong to (migration 017)'

-- 000c is not a member of c1 (private) or c5 (public, owned by 000b). Club ids
-- are not secret — every public club's id is in the DOM of /clubs/explore — so
-- knowing the id is the attacker's starting position, not their obstacle.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

select assert_denied($$
  insert into rides (title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('Crashing the private club', 'The Bridge', now() + interval '1 day',
          false, '00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-00000000000c')$$,
  'an outsider cannot post a ride into a private club');

select assert_denied($$
  insert into rides (title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('Crashing a public club', 'The Pier', now() + interval '1 day',
          false, '00000000-0000-0000-0000-0000000000c5',
          '00000000-0000-0000-0000-00000000000c')$$,
  'a non-member cannot post a ride into a public club either');

-- Guards against over-tightening in both directions: no club is still fine, and
-- a member of the club is still fine.
select assert_allowed($$
  insert into rides (title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('No club at all', 'The Cafe', now() + interval '1 day',
          true, null, '00000000-0000-0000-0000-00000000000c')$$,
  'a ride with no club is unaffected');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_allowed($$
  insert into rides (title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('A ride for my own club', 'The Bridge', now() + interval '1 day',
          false, '00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-00000000000b')$$,
  'a member can post a ride into their own club');

\echo ''
\echo '# Nor moved into one afterwards (migration 017)'

-- The hole guarding INSERT alone would leave: insert clubless, then update. The
-- ride is 000c's own, so the organizer arm of the policy is satisfied and only
-- the membership predicate can refuse it.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id)
values ('00000000-0000-0000-0000-0000000000df', 'Trojan ride', 'The Wall',
        now() + interval '1 day', false, null, '00000000-0000-0000-0000-00000000000c');

select assert_denied($$
  update rides set club_id = '00000000-0000-0000-0000-0000000000c1'
   where id = '00000000-0000-0000-0000-0000000000df'$$,
  'a clubless ride cannot be moved into a club the organizer is not in');

select assert_eq(
  (select count(*)::int from pg_policies
    where tablename = 'rides' and with_check like '%is_club_member%'),
  2, 'both INSERT and UPDATE carry the membership predicate, not just INSERT');

reset role;
delete from rides where id = '00000000-0000-0000-0000-0000000000df';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

-- ===========================================================================
-- 016: club avatars and covers
-- ===========================================================================

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

\echo ''
\echo '# A club image must live in its owner''s folder (migration 016)'

select assert_rejected($$
  update clubs set avatar_path = 'club-avatars/not-a-uuid/x.jpg'
   where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', 'a malformed club avatar path is refused by the shape check');

-- 000a owns c1, so the UPDATE policy lets the statement through; the CHECK is
-- what stops it. Pointing a club you own at an object in someone else's folder
-- is the move that would make their private image readable to your club.
select assert_rejected($$
  update clubs set avatar_path = 'club-avatars/00000000-0000-0000-0000-00000000000b/aaaaaaaa-0000-4000-8000-00000000c1a1.jpg'
   where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '23514', 'a club image in another rider''s folder is refused');

select assert_allowed($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'club-avatars/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000c1a1.jpg',
          '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1024}')$$,
  'a rider uploads a club avatar into their own folder');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'club-avatars/00000000-0000-0000-0000-00000000000a/bbbbbbbb-0000-4000-8000-00000000c1a2.jpg',
          '00000000-0000-0000-0000-00000000000b', '{"mimetype":"image/jpeg","size":1024}')$$,
  'a rider cannot upload into another rider''s club-avatars folder');

\echo ''
\echo '# A club image is readable exactly when its club is (migration 016)'

reset role;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'club-covers/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000c1b1.jpg',
   '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":2048}');
update clubs set cover_image_path = 'club-covers/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000c1b1.jpg'
 where id = '00000000-0000-0000-0000-0000000000c1';
set role authenticated;

-- c1 is private. The storage SELECT policy never names "public or owner or
-- member" — it delegates to the clubs policy through the EXISTS, so this is
-- testing that the delegation actually holds rather than that a second copy of
-- the predicate was written correctly.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'club-covers/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000c1b1.jpg'),
  1, 'a member of the private club can read its cover');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'club-covers/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000c1b1.jpg'),
  0, 'an outsider cannot read the private club''s cover');

-- Guards against over-tightening, and against the uploader arm being the only
-- thing that ever matches: the owner reads it through their own folder.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'club-covers/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000c1b1.jpg'),
  1, 'the owner reads their own club cover');

-- An object nobody's club points at stays private to its uploader, which is
-- what stops a detached upload from being world-readable inside the bucket.
reset role;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'club-covers/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000dead1.jpg',
   '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":2048}');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'club-covers/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000dead1.jpg'),
  0, 'an unattached club cover is invisible to everyone but its uploader');

\echo ''
\echo '# The club media surface is locked down by construction (migration 016)'

-- Counted by policy NAME, not as a whole-table total. 010's total-count
-- assertion broke the day 014 added a second surface, and bumping the number
-- would have stopped testing "no leftover policy to OR against" for any one
-- folder. This is the third surface; the lesson holds.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname ilike '%club %'),
  6, 'club-avatars/ and club-covers/ carry three policies each and no more');

select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.clubs'::regclass and contype = 'c' and conname like '%path%'),
  4, 'both club image columns carry a shape check and an owner-folder check');

-- ===========================================================================
-- 018: text bounds on rider-authored columns
-- ===========================================================================

\echo ''
\echo '# Every length rule that lived only in Zod now lives here too (migration 018)'

-- These are not RLS assertions and they belong here anyway: the point of 018 is
-- that the rule holds for a caller PostgREST would happily serve, which is the
-- same population every other assertion in this file is about. Each bound gets a
-- rejection AND an acceptance at the boundary, because a constraint that refuses
-- everything passes a rejection test perfectly.

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- profiles: bio 500, bike_model 60, location 1..100.
select assert_rejected($$
  update profiles set bio = repeat('x', 501)
   where id = '00000000-0000-0000-0000-00000000000a'$$,
  '23514', 'a bio over 500 characters is refused');

select assert_rejected($$
  update profiles set bike_model = repeat('x', 61)
   where id = '00000000-0000-0000-0000-00000000000a'$$,
  '23514', 'a bike model over 60 characters is refused');

select assert_rejected($$
  update profiles set location = repeat('x', 101)
   where id = '00000000-0000-0000-0000-00000000000a'$$,
  '23514', 'a location over 100 characters is refused');

-- The floor is on the TRIMMED value, so whitespace is not a location.
select assert_rejected($$
  update profiles set location = '   '
   where id = '00000000-0000-0000-0000-00000000000a'$$,
  '23514', 'a location of nothing but spaces is refused');

-- Acceptance at the boundary, written for real and read back: an UPDATE filtered
-- to zero rows does not error, so assert_allowed cannot tell "permitted" from
-- "forbidden entirely" — and it refuses UPDATE outright for that reason.
savepoint bounds_profiles;
update profiles
   set bio = repeat('x', 500), bike_model = repeat('y', 60), location = repeat('z', 100)
 where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq(
  (select (length(bio) = 500 and length(bike_model) = 60 and length(location) = 100)
     from profiles where id = '00000000-0000-0000-0000-00000000000a')::text,
  'true', 'the exact boundary value is accepted on all three profile columns');
rollback to savepoint bounds_profiles;

-- NULL is not the empty string and is not a violation. `location` NULL is the
-- state every rider is in between signup and onboarding step 2, so a constraint
-- that forbade it would make the wizard unreachable.
savepoint bounds_profiles_null;
update profiles set bio = null, bike_model = null, location = null
 where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq(
  (select (bio is null and bike_model is null and location is null)
     from profiles where id = '00000000-0000-0000-0000-00000000000a')::text,
  'true', 'NULL is accepted on every optional profile column');
rollback to savepoint bounds_profiles_null;

-- clubs: name 1..60, description 500.
select assert_rejected($$
  insert into clubs (name, is_public, owner_id)
  values (repeat('x', 61), true, '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a club name over 60 characters is refused');

select assert_rejected($$
  insert into clubs (name, is_public, owner_id)
  values ('   ', true, '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a club name of nothing but spaces is refused');

-- The asymmetry postcard_comments_body_length established: the ceiling is on the
-- RAW value, so padding cannot smuggle a longer name past a trimmed check. 60
-- trimmed, 62 raw — accepted by a naive `length(btrim(name)) <= 60`.
select assert_rejected($$
  insert into clubs (name, is_public, owner_id)
  values (repeat('x', 60) || '  ', true, '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'padding cannot smuggle a name past the raw ceiling');

select assert_rejected($$
  insert into clubs (name, description, is_public, owner_id)
  values ('Bounded MC', repeat('x', 501), true, '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a club description over 500 characters is refused');

select assert_allowed($$
  insert into clubs (name, description, is_public, owner_id)
  values (repeat('x', 60), repeat('y', 500), true, '00000000-0000-0000-0000-00000000000a')$$,
  'a club at exactly 60 and 500 characters is accepted');

select assert_allowed($$
  insert into clubs (name, description, is_public, owner_id)
  values ('Nulls MC', null, true, '00000000-0000-0000-0000-00000000000a')$$,
  'a club with no description is accepted');

-- rides: title 1..80, description 500, meeting_point 1..120,
-- route_description 1000, max_riders 1..999. club_id stays NULL throughout so
-- these test 018 and not 017's membership predicate or 022's audience rule.
select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, is_public, organizer_id)
  values (repeat('x', 81), 'The Pier', now() + interval '1 day', true,
          '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a ride title over 80 characters is refused');

select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, is_public, organizer_id)
  values ('  ', 'The Pier', now() + interval '1 day', true,
          '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a whitespace-only ride title is refused');

select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, is_public, organizer_id)
  values ('Dusk Run', repeat('x', 121), now() + interval '1 day', true,
          '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a meeting point over 120 characters is refused');

select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, is_public, organizer_id)
  values ('Dusk Run', '  ', now() + interval '1 day', true,
          '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a whitespace-only meeting point is refused');

select assert_rejected($$
  insert into rides (title, description, meeting_point, departure_at, is_public, organizer_id)
  values ('Dusk Run', repeat('x', 501), 'The Pier', now() + interval '1 day', true,
          '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a ride description over 500 characters is refused');

select assert_rejected($$
  insert into rides (title, route_description, meeting_point, departure_at, is_public, organizer_id)
  values ('Dusk Run', repeat('x', 1001), 'The Pier', now() + interval '1 day', true,
          '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a route description over 1000 characters is refused');

select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, max_riders, is_public, organizer_id)
  values ('Dusk Run', 'The Pier', now() + interval '1 day', 0, true,
          '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a ride with room for zero riders is refused');

select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, max_riders, is_public, organizer_id)
  values ('Dusk Run', 'The Pier', now() + interval '1 day', 1000, true,
          '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a ride with room for 1000 riders is refused');

select assert_allowed($$
  insert into rides (title, description, route_description, meeting_point,
                     departure_at, max_riders, is_public, organizer_id)
  values (repeat('t', 80), repeat('d', 500), repeat('r', 1000), repeat('m', 120),
          now() + interval '1 day', 999, true,
          '00000000-0000-0000-0000-00000000000a')$$,
  'a ride at every boundary value at once is accepted');

select assert_allowed($$
  insert into rides (title, meeting_point, departure_at, is_public, organizer_id)
  values ('Minimal Run', 'X', now() + interval '1 day', true,
          '00000000-0000-0000-0000-00000000000a')$$,
  'a ride with NULL description, route and max_riders is accepted');

-- ===========================================================================
-- 019: club_members.role is not self-assignable
-- ===========================================================================

\echo ''
\echo '# A rider joins as a member, and the owner arrives as owner (migration 019)'

-- The defect this closes was live: the INSERT policy constrained who the row was
-- for and said nothing about `role`, so any rider could join any public club as
-- `admin` — a value /clubs/[id]/members renders with a label and an owner ring.

-- A public club owned by the OUTSIDER (000c), so the owner arm and the joiner
-- arm are exercised by two different riders on a club neither of them shares
-- with the block fixtures. Nothing earlier in this file counts its roster.
reset role;
insert into clubs (id, name, is_public, owner_id)
  values ('00000000-0000-0000-0000-0000000000c6', 'Role Test Club', true,
          '00000000-0000-0000-0000-00000000000c');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_allowed($$
  insert into club_members (club_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-00000000000c', 'owner')$$,
  'the club''s own owner_id may insert their owner row');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_denied($$
  insert into club_members (club_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-00000000000a', 'admin')$$,
  'a rider joining a public club cannot arrive as admin');

select assert_denied($$
  insert into club_members (club_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-00000000000a', 'owner')$$,
  'a rider joining a public club cannot arrive as owner');

-- Guards against over-tightening: the ordinary join must still work, both by
-- omitting the column (the default, which is what joinClub does) and by naming
-- it. A WITH CHECK sees the row after defaults are applied, so these are two
-- genuinely different statements.
select assert_allowed($$
  insert into club_members (club_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-00000000000a')$$,
  'an ordinary join still succeeds on the role default');

select assert_allowed($$
  insert into club_members (club_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-00000000000a', 'member')$$,
  'an ordinary join still succeeds naming role explicitly');

-- design.md Q10: promotion stays impossible until the invitations feature
-- designs it, and the absence of an UPDATE policy is the recorded answer rather
-- than an oversight. Pinned here so that adding one means deleting a test that
-- says why it was not there.
--
-- Read back rather than asserted allowed/denied: `authenticated` DOES hold the
-- table-level UPDATE grant, so RLS filters the statement to zero rows instead of
-- raising. It succeeds and changes nothing, and those two look identical from
-- assert_allowed — which is why that helper refuses UPDATE outright.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
savepoint no_promotion;
update club_members set role = 'admin'
 where club_id = '00000000-0000-0000-0000-0000000000c2'
   and user_id = '00000000-0000-0000-0000-00000000000a';
select assert_eq(
  (select role from club_members
    where club_id = '00000000-0000-0000-0000-0000000000c2'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  'owner', 'a club owner cannot promote anyone, including themselves');
rollback to savepoint no_promotion;

select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'club_members' and cmd = 'UPDATE'),
  0, 'club_members carries no UPDATE policy, which is Q10''s answer');

-- Scoped to the grantee. `postgres` and `service_role` hold everything by
-- Supabase default, so a table-wide count of UPDATE grants reads 2 against a
-- correct database — the mistake 015's footer made and documented.
select assert_eq(
  has_table_privilege('authenticated', 'public.club_members', 'update'),
  true, 'the grant is present, so it is genuinely RLS refusing the promotion');

-- ===========================================================================
-- 020: a country code must be a country
-- ===========================================================================

\echo ''
\echo '# ZZ is well-formed and is not a country (migration 020)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

select assert_rejected($$
  insert into profile_countries (user_id, country_code)
  values ('00000000-0000-0000-0000-00000000000a', 'ZZ')$$,
  '23514', 'an unassigned code ZZ is refused');

select assert_rejected($$
  insert into profile_countries (user_id, country_code)
  values ('00000000-0000-0000-0000-00000000000a', 'XX')$$,
  '23514', 'an unassigned code XX is refused');

-- 014's shape check still does its own job: case is a separate rule from
-- membership, and `nl` violates the first without reaching the second.
select assert_rejected($$
  insert into profile_countries (user_id, country_code)
  values ('00000000-0000-0000-0000-00000000000a', 'nl')$$,
  '23514', 'a lowercase code is still refused');

select assert_allowed($$
  insert into profile_countries (user_id, country_code)
  values ('00000000-0000-0000-0000-00000000000a', 'NL')$$,
  'an assigned code is accepted (guards against refusing everything)');

-- ===========================================================================
-- 022: a private club's ride is not a public ride
-- ===========================================================================

\echo ''
\echo '# A ride cannot claim a wider audience than its club (migration 022)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- c1 is private and 000a belongs to it, so 017's membership predicate passes and
-- the only thing left to refuse the write is 022's trigger.
select assert_rejected($$
  insert into rides (title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('Leaky Run', 'The Bridge', now() + interval '1 day', true,
          '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a')$$,
  '23514', 'a ride in a private club cannot be created public');

select assert_allowed($$
  insert into rides (title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('Quiet Run', 'The Bridge', now() + interval '1 day', false,
          '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a')$$,
  'the same ride kept private is accepted');

-- UPDATE too, or the rule would only move: insert private, then widen.
select assert_rejected($$
  update rides set is_public = true
   where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23514', 'a private club''s ride cannot be widened to public afterwards');

\echo ''
\echo '# A club turning private takes its rides with it (migration 022)'

-- c2 is public and 000a owns it. A ride posted there is legitimately public
-- until the moment the club is not.
savepoint club_goes_private;

insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('00000000-0000-0000-0000-0000000000d7', 'Open Club Run', 'The Square',
          now() + interval '5 days', true,
          '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a');
select assert_eq(
  (select is_public from rides where id = '00000000-0000-0000-0000-0000000000d7'),
  true, 'a public club''s ride may be public');

-- The discriminating case, and the reason it needs three statements rather than
-- one: a ride in c2 organised by someone who is NOT the club owner. The `rides`
-- UPDATE policy is `auth.uid() = organizer_id`, so an invoker-rights version of
-- propagate_club_privacy_to_rides silently skips this row while still fixing d7
-- above — reporting `UPDATE 1` and looking finished. No seed rider is a
-- non-owner member of c2, so 000b joins it here (which exercises 019's role
-- default in passing).
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
insert into club_members (club_id, user_id)
  values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b');
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('00000000-0000-0000-0000-0000000000d8', 'Members Run', 'The Bridge',
          now() + interval '6 days', true,
          '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b');

-- Back to the owner: turning the club private is theirs to do, and the whole
-- point is that it must reach a ride they do not organise.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
update clubs set is_public = false where id = '00000000-0000-0000-0000-0000000000c2';
select assert_eq(
  (select is_public from rides where id = '00000000-0000-0000-0000-0000000000d7'),
  false, 'making the club private brings its public rides down with it');
select assert_eq(
  (select is_public from rides where id = '00000000-0000-0000-0000-0000000000d8'),
  false, '... including a ride organised by someone other than the club owner');

rollback to savepoint club_goes_private;

\echo ''
\echo '# Ride visibility, stated once per role (migration 022)'

-- A ride that violates the rule, seeded past the trigger on purpose. 022's
-- trigger binds every role — there is no `current_user` escape, unlike 012's
-- guard — so this is the only way to produce the row, and producing it is the
-- point: §4 of that migration exists for rows §2 did not see.
reset role;
alter table public.rides disable trigger enforce_ride_club_audience;
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('00000000-0000-0000-0000-0000000000d5', 'Smuggled Run', 'The Bridge',
          now() + interval '6 days', true,
          '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a');
alter table public.rides enable trigger enforce_ride_club_audience;
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-00000000000a', 'going');
set role authenticated;

-- Organizer: regardless of is_public, club_id or club visibility.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d5'),
  1, 'the organizer reads their own ride in a private club');

-- Club member.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d5'),
  1, 'a member of the private club reads its ride');

-- Non-member, private club's ride. Before 022 this returned 1, on the strength
-- of a flag the club contradicts.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d5'),
  0, 'a non-member cannot read a private club''s ride even when it is flagged public');

-- And its crew with it. ride_members never names a club — its policy delegates
-- to rides by EXISTS — so this is testing that the delegation holds rather than
-- that a second copy of the predicate was written correctly.
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-0000000000d5'),
  0, 'nor the crew of that ride, through ride_members');

-- Non-member, public ride with no club. Decision #1: "public" means "any
-- signed-in rider". Guards against over-tightening — this is the arm 022
-- narrowed, so it is the one that could have been lost.
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  1, 'a signed-in non-member still reads a public ride with no club');

-- Blocked rider. d4 is public and clubless and organised by the blocked rider,
-- so this proves the rewritten policy kept 009's predicate rather than that the
-- ride was unreachable for some other reason.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d4'),
  0, 'the block predicate survived 022 rewriting the select policy');

-- Signed-out visitor.
reset role;
set role anon;
select assert_denied('select count(*) from rides',
  'anon still cannot read rides after 022 recreated the select policy');
reset role;

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);


-- ===========================================================================
-- 024: the legacy avatar_url columns are gone
-- ===========================================================================
-- Two claims here, and the second is the one with teeth. That the columns are
-- absent is arithmetic. That nothing *else* got looser is the risk a `drop
-- column` actually carries — 024 runs under RESTRICT precisely so a missed
-- dependency aborts the apply, and these assertions are what proves the CHECKs
-- 014 and 016 hung off these two tables are still hanging there afterwards.
--
-- Why the removed column specifically mattered: `avatar_url` was unconstrained
-- `text` on a row its subject may PATCH (`auth.uid() = id`, `auth.uid() =
-- owner_id`), and the read layer put it straight into `<img src>` for every
-- other rider. It was the one image reference in this schema that could point
-- outside the writer's own Storage folder — at a host they control, collecting
-- the IP of anyone who rendered a member list, including riders who had blocked
-- them. What is asserted below is that no such column survives on either table
-- and that every remaining one is still pinned to its writer.

\echo ''
\echo '024: the legacy avatar_url columns are gone'

select assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'avatar_url'),
  0, 'profiles.avatar_url is gone (migration 024)');
select assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'clubs'
      and column_name = 'avatar_url'),
  0, 'clubs.avatar_url is gone (migration 024)');

-- Deliberately broader than the two above, and deliberately a count a future
-- change is *supposed* to break: any new `*url*` column on either table is a
-- candidate for exactly the same defect and should have to argue for itself
-- here rather than arrive silently. A Storage path column is named `*_path`
-- and does not match, so this costs the next image surface nothing.
select assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name in ('profiles','clubs')
      and column_name like '%url%'),
  0, 'no rider-writable URL column survives on profiles or clubs');

-- Named rather than counted. `select count(*) ... where conname like '%path%'`
-- would read 4 today and read 4 again if 024 had taken an ownership check and
-- some later migration had added an unrelated one — and it would need bumping
-- the day a third image surface lands, which is how an assertion stops being
-- read. These name the four that must survive.
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname in ('profiles_avatar_path_is_a_storage_path',
                      'profiles_avatar_path_is_own_folder',
                      'profiles_cover_image_path_is_a_storage_path',
                      'profiles_cover_image_path_is_own_folder')),
  4, '014''s four profile path CHECKs survived the drop');
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.clubs'::regclass
      and conname in ('clubs_avatar_path_shape',
                      'clubs_avatar_path_owned',
                      'clubs_cover_image_path_shape',
                      'clubs_cover_image_path_owned')),
  4, '016''s four club path CHECKs survived the drop');

\echo ''
\echo '# A rider still cannot write an image reference outside their own folder (024)'

-- The negative and the positive are the same statement with one uuid changed,
-- which is the point: what separates them is ownership and nothing else. Run
-- the negative first — a positive alone would pass against a CHECK that had
-- been dropped, and a negative alone would pass against one that forbade
-- everything.
select assert_rejected($$
  update profiles
     set avatar_path = 'avatars/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-0000000000a4.jpg'
   where id = '00000000-0000-0000-0000-00000000000c'$$,
  '23514', 'a rider cannot point their avatar at an object in another rider''s folder');
select assert_rejected($$
  update profiles
     set cover_image_path = 'covers/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-0000000000a5.jpg'
   where id = '00000000-0000-0000-0000-00000000000c'$$,
  '23514', '... nor their cover');

-- assert_allowed refuses an UPDATE by design — RLS filters one it forbids to
-- zero rows rather than raising, so it would pass against a policy permitting
-- nothing. Run it and count the row instead.
savepoint own_folder_ok;
update profiles
   set avatar_path      = 'avatars/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000a4.jpg',
       cover_image_path = 'covers/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000a5.jpg'
 where id = '00000000-0000-0000-0000-00000000000c';
select assert_eq(
  (select count(*)::int from profiles
    where id = '00000000-0000-0000-0000-00000000000c'
      and avatar_path = 'avatars/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000a4.jpg'
      and cover_image_path = 'covers/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000a5.jpg'),
  1, 'the same two paths inside the rider''s own folder are accepted');
rollback to savepoint own_folder_ok;

-- Clubs carry the same rule keyed on `owner_id` instead of `id`, and it needs
-- its own pair: 016's CHECK is the only thing standing between a club owner and
-- attaching a stranger's private object to a club they control, since the
-- Storage read policy would then serve that object to the whole club.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_rejected($$
  update clubs
     set avatar_path = 'club-avatars/00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000a6.jpg'
   where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', 'a club owner cannot point their club avatar at another rider''s object');
select assert_rejected($$
  update clubs
     set cover_image_path = 'club-covers/00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-0000000000a7.jpg'
   where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', '... nor the club cover');

savepoint club_own_folder_ok;
update clubs
   set avatar_path      = 'club-avatars/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-0000000000a6.jpg',
       cover_image_path = 'club-covers/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-0000000000a7.jpg'
 where id = '00000000-0000-0000-0000-0000000000c2';
select assert_eq(
  (select count(*)::int from clubs
    where id = '00000000-0000-0000-0000-0000000000c2'
      and avatar_path = 'club-avatars/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-0000000000a6.jpg'
      and cover_image_path = 'club-covers/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-0000000000a7.jpg'),
  1, 'the same two paths inside the club owner''s own folder are accepted');
rollback to savepoint club_own_folder_ok;

-- And the same rule one layer down, in Storage itself, because the table CHECK
-- and the storage.objects policy are two independent locks on one door and 024
-- must not have quietly removed either. 014's suite covers the `avatars/`
-- folder negative and a `covers/` *mimetype* negative; the `covers/` folder
-- negative is new here.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
    values ('media',
            'covers/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-0000000000a8.jpg',
            '00000000-0000-0000-0000-00000000000c',
            '{"mimetype":"image/jpeg","size":10}')$$,
  'a rider cannot upload a cover into another rider''s folder');
select assert_allowed($$
  insert into storage.objects (bucket_id, name, owner, metadata)
    values ('media',
            'covers/00000000-0000-0000-0000-00000000000c/00000000-0000-0000-0000-0000000000a8.jpg',
            '00000000-0000-0000-0000-00000000000c',
            '{"mimetype":"image/jpeg","size":10}')$$,
  'the same cover upload into their own folder is accepted');

-- ===========================================================================
-- 021: the own-row accessor and the two own-row writers
-- ===========================================================================
--
-- 021 is APPLIED, so its assertions belong here rather than in a pending suite.
-- It creates three functions and nothing else — `my_onboarding_state()`,
-- `accept_terms()` and `complete_onboarding(text)` — and it is deliberately
-- additive: every grant this file's other 380-odd assertions rely on is
-- untouched by it.
--
-- **What is NOT here is the revoke.** That is `025`, still pending, with its own
-- suite. The split follows the migrations exactly: anything asserting these
-- functions' BEHAVIOUR is mainline, anything asserting
-- `has_column_privilege(...) = false` is pending on 025. The two must not drift
-- into each other — an assertion about the revoke that ran here would fail
-- against the database that actually runs.
--
-- ---------------------------------------------------------------------------
-- The trap these functions exist inside, measured rather than recalled
-- ---------------------------------------------------------------------------
-- Inside a `security definer` function `current_user` is the function's OWNER,
-- not the caller. 003's completion guard and 012's consent guard both open with
-- `if current_user <> 'authenticated' then return new`, so for a write issued
-- from one of these functions the trigger **fires and enforces nothing**. Every
-- rule therefore has to live in the function body, and every assertion below
-- would pass just as happily against a function that wrongly assumed it
-- inherited them — which is why they are driven through the RPCs.
--
-- This section adds four fixtures of its own and rolls them back, so not one
-- expected value anywhere above it moves. That is why it sits at the end.

savepoint accessors_021;

-- 0013 and 0014 exist to ISOLATE the two rules complete_onboarding() enforces.
-- Both refusals raise 23514, so a fixture failing both would let an assertion
-- nominally about the username rule pass because the consent rule fired.
-- 0013 has a username and no consent; 0014 has consent and no username.
set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000011', 'noconsent@example.com'),
  ('00000000-0000-0000-0000-000000000012', 'qualified@example.com'),
  ('00000000-0000-0000-0000-000000000013', 'midwizard@example.com'),
  ('00000000-0000-0000-0000-000000000014', 'consentonly@example.com');
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
update profiles set terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000000014';

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 021 assertions run as authenticated, or they prove nothing');

\echo ''
\echo '# my_onboarding_state() answers for the caller and nobody else (021)'

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq((select count(*)::int from public.my_onboarding_state()),
  1, 'the accessor returns exactly one row — the caller''s own');
select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  timestamptz '2026-01-01 00:00:00+00', 'the accessor returns the caller''s consent stamp');
select assert_eq((select onboarding_completed_at from public.my_onboarding_state()),
  timestamptz '2026-01-01 00:00:00+00', 'the accessor returns the caller''s onboarding stamp');

-- The third output, which is what lets proxy.ts answer its whole question in one
-- round trip instead of a table select plus an RPC on every request.
select assert_eq((select has_username from public.my_onboarding_state()),
  true, 'the accessor reports that the caller has chosen a username');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select assert_eq((select has_username from public.my_onboarding_state()),
  false, '... and reports false for the rider who has not');

-- It takes no arguments, so there is no row to choose but your own. Asserted by
-- switching identity and seeing the answer change rather than by reading the body.
select set_config('test.uid', '00000000-0000-0000-0000-000000000011', false);
select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  null::timestamptz, 'the accessor follows the caller, and cannot be pointed elsewhere');

select set_config('test.uid', '', false);
select assert_eq((select count(*)::int from public.my_onboarding_state()),
  0, 'the accessor returns zero rows for a caller with no session');

-- A blocked rider still reads their own row: the block is about other people.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000001a'),
  0, 'a blocked rider gets zero rows for the blocking rider''s profile');
select assert_eq((select count(*)::int from public.my_onboarding_state()),
  1, 'and still reads their own stamps through the accessor');

-- The earlier revision's two-output accessor must not survive beside it.
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'my_profile_stamps'),
  0, 'the superseded my_profile_stamps() accessor is gone, not merely unused');

\echo ''
\echo '# accept_terms() is server-timed, own-row and idempotent (021)'

select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);
savepoint consent_rpc;
select set_config('test.first_consent', public.accept_terms()::text, false);

select assert_eq((select terms_accepted_at is not null from public.my_onboarding_state()),
  true, 'accept_terms() stamps the caller''s consent');

-- Server-timed rather than caller-chosen. The function takes no argument, so a
-- back-dated stamp is unrepresentable rather than merely refused — this asserts
-- the consequence of that, which is that the value landed in the present.
select assert_eq(current_setting('test.first_consent')::timestamptz
                   > timestamptz '2026-06-01 00:00:00+00',
  true, 'the stamp it wrote is server time, not a value the caller chose');

-- Idempotent. **This assertion is the weak half of the pair and is kept only
-- because it reads the return value rather than the column** — it cannot detect
-- a re-stamp on its own, because `now()` is `transaction_timestamp()` and this
-- whole suite is one transaction, so a stamp written twice is written with the
-- identical value both times. The next assertion is the load-bearing one.
select assert_eq(public.accept_terms(),
  current_setting('test.first_consent')::timestamptz,
  'a second accept_terms() returns the first call''s stamp rather than moving it');
rollback to savepoint consent_rpc;

-- **This is the one that actually pins idempotency.** 0012 consented on
-- 2026-01-01, before this transaction existed, so only a genuine "already set,
-- leave it alone" can hand that value back — a function that re-stamps returns
-- the transaction timestamp and fails here. Confirmed by mutation: removing
-- accept_terms()'s `and p.terms_accepted_at is null` guard is caught by this
-- line and by nothing else.
select set_config('test.uid', '00000000-0000-0000-0000-000000000012', false);
select assert_eq(public.accept_terms(), timestamptz '2026-01-01 00:00:00+00',
  'accept_terms() does not overwrite an existing stamp');

-- 0011 and 0013 both have NULL consent. Calling as 0011 must stamp 0011 and
-- leave 0013 exactly as it was. RLS does not apply inside a security definer
-- function owned by the table's owner — measured — so the WHERE clause pinned to
-- auth.uid() is the whole of this function's access control.
select set_config('test.uid', '00000000-0000-0000-0000-000000000011', false);
savepoint consent_follows_caller;
select public.accept_terms();
select assert_eq((select terms_accepted_at is not null from public.my_onboarding_state()),
  true, 'accept_terms() stamped the caller''s own row');
select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);
select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  null::timestamptz, '... and left the other NULL-consent rider untouched');
rollback to savepoint consent_follows_caller;

-- No session. 42501 rather than 23514 on purpose: this is an authorization
-- failure, not an integrity rule, and keeping the two SQLSTATEs apart is what
-- stops an assertion passing because the wrong rule fired.
select set_config('test.uid', '', false);
select assert_denied($$select public.accept_terms()$$,
  'accept_terms() refuses a caller with no session');

\echo ''
\echo '# complete_onboarding() carries its own rules, because the trigger does not (021)'

-- Consent first: 0013 has username and location, so 003's rule is satisfied and
-- only the consent rule can fire. This is 023 §1.13's rule, enforced here because
-- a security definer write bypasses the trigger that also carries it.
select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);
select assert_rejected($$select public.complete_onboarding('Evora')$$,
  '23514', 'complete_onboarding() refuses while terms_accepted_at is NULL');

-- Username: 0014 has consent and no username, so only 003's rule can fire.
select set_config('test.uid', '00000000-0000-0000-0000-000000000014', false);
select assert_rejected($$select public.complete_onboarding('Coimbra')$$,
  '23514', 'complete_onboarding() refuses while username is NULL');

-- The location argument. NULL is the arm 018's CHECK cannot cover, because
-- profiles_location_length deliberately permits NULL — every rider is NULL there
-- between signup and step 2.
select set_config('test.uid', '00000000-0000-0000-0000-000000000012', false);
select assert_rejected($$select public.complete_onboarding(null)$$,
  '23514', 'complete_onboarding() refuses a NULL location');
select assert_rejected($$select public.complete_onboarding('   ')$$,
  '23514', 'complete_onboarding() refuses a location of nothing but spaces');

-- 018's CHECK still applies inside a security definer function — measured, not
-- assumed, and asserted here so the migration does not have to restate a ceiling
-- the table already enforces.
select assert_rejected($$select public.complete_onboarding(repeat('x', 101))$$,
  '23514', '018''s location ceiling still fires inside a security definer function');

\echo ''
\echo '# ... and it completes the wizard atomically and one-way (021)'

select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);
savepoint wizard_rpc;
select public.accept_terms();
select assert_eq(public.complete_onboarding('Amsterdam') is not null,
  true, 'complete_onboarding() returns the stamp it set');

-- Both columns in one statement, so there is no window in which a rider is
-- stamped complete with no location. Read back rather than inferred.
select assert_eq(
  (select onboarding_completed_at is not null from public.my_onboarding_state()),
  true, 'the completion stamp landed');
select assert_eq((select location from profiles where id = auth.uid()),
  'Amsterdam', '... and the location landed in the same statement');

rollback to savepoint wizard_rpc;

-- One-way (003 §6b), restated by the function because the trigger that normally
-- pins it did not run.
--
-- **Anchored on the fixture's literal stamp rather than on a value this
-- transaction wrote, and that distinction IS the assertion.** `now()` is
-- `transaction_timestamp()` — frozen for the whole suite, since the suite is one
-- transaction — so the obvious version of this test, completing a fresh rider
-- twice and comparing the two return values, compares two identical frozen
-- timestamps and passes against a function that re-stamps on every call.
-- Measured, not theorised: dropping the `coalesce` from complete_onboarding was
-- the one mutation out of fourteen that survived the suite, until this was
-- rewritten to compare against 0012's 2026-01-01 fixture. 0012 was onboarded
-- long before this transaction began, so only a genuine pin can return it.
select set_config('test.uid', '00000000-0000-0000-0000-000000000012', false);
savepoint completion_is_one_way;
select assert_eq(public.complete_onboarding('Utrecht'),
  timestamptz '2026-01-01 00:00:00+00',
  'complete_onboarding() on an already-onboarded rider returns the ORIGINAL stamp');
select assert_eq(
  (select onboarding_completed_at from public.my_onboarding_state()),
  timestamptz '2026-01-01 00:00:00+00',
  '... and the stored stamp did not move either');
select assert_eq((select location from profiles where id = auth.uid()),
  'Utrecht', '... while still applying the location it was given');
rollback to savepoint completion_is_one_way;

select set_config('test.uid', '', false);
select assert_denied($$select public.complete_onboarding('Amsterdam')$$,
  'complete_onboarding() refuses a caller with no session');

\echo ''
\echo '# The three functions are wired the way they have to be (021)'

reset role;

select assert_eq(has_function_privilege('anon', 'public.my_onboarding_state()', 'execute'),
  false, 'anon cannot call the accessor');
select assert_eq(has_function_privilege('authenticated', 'public.my_onboarding_state()', 'execute'),
  true, 'authenticated can — the route guard needs it');
select assert_eq(has_function_privilege('anon', 'public.accept_terms()', 'execute'),
  false, 'anon cannot call accept_terms()');
select assert_eq(has_function_privilege('authenticated', 'public.accept_terms()', 'execute'),
  true, 'authenticated can — it is the only path to the consent stamp once 025 lands');
select assert_eq(has_function_privilege('anon', 'public.complete_onboarding(text)', 'execute'),
  false, 'anon cannot call complete_onboarding()');
select assert_eq(has_function_privilege('authenticated', 'public.complete_onboarding(text)', 'execute'),
  true, 'authenticated can — it is the only path to the completion stamp once 025 lands');

-- All three must be `security definer`, or 025 takes the stamps away with nothing
-- left able to write them. Asserted from the catalog rather than trusted from the
-- file, because apply_migration takes SQL as an argument and 022 once shipped
-- with this exact clause missing. `proconfig` stores the pin as the literal
-- `search_path=""`, quotes included — matching on `search_path=` finds nothing
-- and reads as a passing test.
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('my_onboarding_state', 'accept_terms', 'complete_onboarding')
      and prosecdef and proconfig @> array['search_path=""']),
  3, 'all three 021 functions are security definer with a pinned search_path');

-- 021 is additive: it must not have moved a single grant. If any of these is
-- false, something from 025 has leaked into it.
select assert_eq(has_table_privilege('authenticated', 'public.profiles', 'select'),
  true, '021 left the table-wide SELECT alone — the revoke is 025''s job');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed_at', 'update'),
  true, '... and the completion stamp is still client-writable until 025');

rollback to savepoint accessors_021;

set role authenticated;
select set_config('test.uid', '', false);
reset role;

\echo ''
\echo '# The recovery grant is Supabase-signed, single-use and 15 minutes wide (migration 026)'

-- 026 replaces the httpOnly `lr-recovery` cookie. Everything below is one of
-- the two properties the cookie held:
--
--   1. only a session established by a recovery link may change the password
--      without knowing the old one   — the `amr` assertions
--   2. the ability to reset is spent by the reset — the single-use assertions
--
-- **These set `request.jwt.claims`, which is the HOSTED idiom, and they also
-- have to set `test.uid`, which is the LOCAL one.** harness.sql shims
-- auth.uid() onto `test.uid` but defines auth.jwt() exactly as Supabase does,
-- so a test setting only the claims gets a NULL auth.uid() and a positive
-- assertion that passes while proving nothing. Both, every time.
--
-- What this file cannot prove: that PostgREST really puts `amr` in
-- request.jwt.claims on the hosted project, and that a real recovery link mints
-- `method: "recovery"`. Those are in 026's §Verification footer.

savepoint grant_026;

reset role;

select assert_eq(
  (select count(*)::int from pg_policies where tablename = 'password_reset_grants'),
  0, 'the grant table carries no policies — the two functions are the only door');
select assert_eq(
  (select relrowsecurity from pg_class where oid = 'public.password_reset_grants'::regclass),
  true, '... and RLS is on, so no policies denies rather than allows');

-- Scoped to the grantee. The unscoped form always finds grants, because
-- postgres owns the table and service_role holds everything by Supabase
-- default — 015's footer read 2 against a correct database for exactly this.
select assert_eq(has_table_privilege('authenticated', 'public.password_reset_grants', 'select'),
  false, 'authenticated cannot read the grant table');
select assert_eq(has_table_privilege('authenticated', 'public.password_reset_grants', 'insert'),
  false, 'authenticated cannot forge a spend record');
select assert_eq(has_table_privilege('authenticated', 'public.password_reset_grants', 'update'),
  false, 'authenticated cannot move a spend record');
select assert_eq(has_table_privilege('authenticated', 'public.password_reset_grants', 'delete'),
  false, 'authenticated cannot un-spend a grant');
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where table_name = 'password_reset_grants' and grantee = 'anon'),
  0, 'anon holds nothing on the grant table');

select assert_eq(has_function_privilege('anon', 'public.has_password_reset_grant()', 'execute'),
  false, 'anon cannot ask whether it holds a grant');
select assert_eq(has_function_privilege('anon', 'public.consume_password_reset_grant()', 'execute'),
  false, 'anon cannot spend one');
select assert_eq(has_function_privilege('authenticated', 'public.has_password_reset_grant()', 'execute'),
  true, 'authenticated can — the reset screen calls it');
select assert_eq(has_function_privilege('authenticated', 'public.consume_password_reset_grant()', 'execute'),
  true, 'authenticated can — updatePassword calls it');
select assert_eq(has_function_privilege('authenticated', 'private.password_reset_session()', 'execute'),
  false, 'authenticated cannot reach the rule directly, only through the two entry points');

-- Asserted from the catalog rather than trusted from the file: apply_migration
-- takes SQL as an argument, and 022 once shipped with `security definer`
-- missing. proconfig stores the pin as the literal search_path="" — matching on
-- `search_path=` finds nothing and reads as a pass.
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('has_password_reset_grant', 'consume_password_reset_grant')
      and prosecdef and proconfig @> array['search_path=""']),
  2, 'both entry points are security definer with a pinned search_path');
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'private'::regnamespace
      and proname = 'password_reset_session'
      and not prosecdef and proconfig @> array['search_path=""']),
  1, '... and the rule itself is INVOKER — it reads only the caller''s own claims');

set role authenticated;

-- No session at all.
select set_config('test.uid', '', false);
select set_config('request.jwt.claims', '', false);
select assert_eq(public.has_password_reset_grant(), false,
  'a caller with no claims holds no grant');
select assert_eq(public.consume_password_reset_grant(), false,
  '... and cannot spend one');

-- An ORDINARY SIGNED-IN SESSION. This is the whole threat: a recovery link
-- yields a session indistinguishable from this one, and proxy.ts deliberately
-- does not bounce it off /auth/reset-password.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(json_build_object(
    'method', 'password', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'a password session holds no grant, however fresh');
select assert_eq(public.consume_password_reset_grant(), false,
  '... and spending one is refused');
reset role;
select assert_eq((select count(*)::int from public.password_reset_grants), 0,
  '... and the refusal wrote no row');
set role authenticated;

-- GoTrue also calls `otp` and `magiclink` recovery methods (Session.IsRecovery).
-- 026 §3 is deliberately narrower than the platform: nothing in this app mints
-- either, and if the recovery mail ever moves to a token_hash link — which
-- records `otp` — this must fail closed and loudly rather than widen quietly.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(json_build_object(
    'method', 'otp', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'an otp session holds no grant — narrower than GoTrue, on purpose (026 §3)');
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(json_build_object(
    'method', 'magiclink', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'a magiclink session holds no grant either');

-- Malformed claims are a refusal, not a 500.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', 'not-a-uuid',
  'amr', json_build_array(json_build_object(
    'method', 'recovery', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'a malformed session_id is refused rather than raised');
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'amr', json_build_array(json_build_object(
    'method', 'recovery', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'a recovery claim with no session_id is refused — there is nothing to spend');

-- `amr` may legally be an array of plain strings when a custom access token
-- hook is installed. None is; the shape fails closed if one ever is.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array('recovery')
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'the RFC-8176 string form of amr fails closed');

-- 027. The function's contract is "never raises", and both callers are built on
-- it: a raise turns a malformed token into a 500 on the reset screen instead of
-- a refusal. 026 guarded exactly one cast, and these two escaped it. Neither is
-- reachable through a Supabase-signed token — GoTrue writes int64 timestamps and
-- PostgREST writes the claims JSON itself — so what these pin is the contract,
-- not a live hole. They fail with 22008 and 22P02 respectively against 026.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(json_build_object('method', 'recovery', 'timestamp', 1e300))
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'a timestamp outside the timestamptz range refuses rather than raising 22008');

select set_config('request.jwt.claims', 'not json at all', false);
select assert_eq(public.has_password_reset_grant(), false,
  'claims that are not JSON refuse rather than raising 22P02 out of auth.jwt()');
select assert_eq(public.consume_password_reset_grant(), false,
  '... on the spending path too, which is the one that writes');

-- 027 also narrows a duplicated `recovery` entry from max() to min(). GoTrue
-- upserts one mfa_amr_claims row per method per session, so two is unreachable;
-- where both readings are unreachable the conservative one is free, and 026 §3
-- already takes that position on the method list.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(
    json_build_object('method', 'recovery',
      'timestamp', extract(epoch from now() - interval '16 minutes')::bigint),
    json_build_object('method', 'recovery',
      'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'a stale recovery entry beside a fresh one takes the stale reading (027: min, not max)');

-- Fifteen minutes, matching the cookie's maxAge. The timestamp is the instant
-- the recovery session was minted and cannot be slid forward by refreshing a
-- token, so this window is a real one.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(json_build_object(
    'method', 'recovery', 'timestamp', extract(epoch from now() - interval '16 minutes')::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), false,
  'a recovery grant 16 minutes old has expired');
select assert_eq(public.consume_password_reset_grant(), false,
  '... and cannot be spent');
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(json_build_object(
    'method', 'recovery', 'timestamp', extract(epoch from now() - interval '14 minutes')::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), true,
  '... but at 14 minutes it still holds');

-- The positive case, and then the property that makes it a grant rather than a
-- flag: spending it is what ends it.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(json_build_object(
    'method', 'recovery', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.has_password_reset_grant(), true,
  'a fresh recovery session holds a grant');
select assert_eq(public.consume_password_reset_grant(), true,
  '... spends it exactly once');
select assert_eq(public.consume_password_reset_grant(), false,
  '... and a second attempt on the same session is refused');
select assert_eq(public.has_password_reset_grant(), false,
  '... and the screen is told so too');

reset role;
select assert_eq(
  (select user_id from public.password_reset_grants
    where session_id = '00000000-0000-0000-0000-0000000000f1'),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'the spend record names the rider who spent it');

-- Keyed on the session, not the rider: one link, one reset, and a rider's own
-- second recovery link is a different session and works normally.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000b',
  'session_id', '00000000-0000-0000-0000-0000000000f1',
  'amr', json_build_array(json_build_object(
    'method', 'recovery', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.consume_password_reset_grant(), false,
  'a spent session stays spent whoever presents it');
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000b',
  'session_id', '00000000-0000-0000-0000-0000000000f2',
  'amr', json_build_array(json_build_object(
    'method', 'recovery', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.consume_password_reset_grant(), true,
  '... while another rider''s own link is unaffected by it');

-- Reach: a new personal-data table the account-deletion path does not cover is
-- unfinished. This one is covered by the FK, so it needs no code.
reset role;
savepoint grant_026_cascade;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select assert_eq(
  (select count(*)::int from public.password_reset_grants
    where user_id = '00000000-0000-0000-0000-00000000000b'),
  0, 'deleting the rider deletes their spend records — deletion reach, by FK');
rollback to savepoint grant_026_cascade;

-- Retention: 24 hours, swept on the only path that writes. The sweep is global
-- rather than per-caller, so this row belongs to a third rider.
insert into public.password_reset_grants (session_id, user_id, claimed_at)
values ('00000000-0000-0000-0000-0000000000f9',
        '00000000-0000-0000-0000-00000000000c',
        now() - interval '25 hours');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000000a',
  'session_id', '00000000-0000-0000-0000-0000000000f3',
  'amr', json_build_array(json_build_object(
    'method', 'recovery', 'timestamp', extract(epoch from now())::bigint))
)::text, false);
select assert_eq(public.consume_password_reset_grant(), true,
  'a later reset succeeds ...');
reset role;
select assert_eq(
  (select count(*)::int from public.password_reset_grants
    where session_id = '00000000-0000-0000-0000-0000000000f9'),
  0, '... and sweeps a spend record older than the 24-hour window');
select assert_eq(
  (select count(*)::int from public.password_reset_grants
    where session_id = '00000000-0000-0000-0000-0000000000f3'),
  1, '... without sweeping the one it just wrote');

rollback to savepoint grant_026;

set role authenticated;
select set_config('test.uid', '', false);
select set_config('request.jwt.claims', '', false);
reset role;

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
select assert_denied('select count(*) from postcard_comments', 'anon cannot read comments');
select assert_denied('select count(*) from postcard_hides', 'anon cannot read hides');
select assert_denied('select count(*) from postcard_reports', 'anon cannot read reports');
select assert_denied('select count(*) from profile_countries', 'anon cannot read countries');
select assert_denied('select count(*) from feed_reads', 'anon cannot read watermarks');
reset role;

rollback;

\echo ''
\echo 'All RLS policy assertions passed.'
