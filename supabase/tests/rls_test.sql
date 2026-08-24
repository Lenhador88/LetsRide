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
\echo '# Neither stamp can be written by the client at all (migrations 003, 012, 025)'

-- Until 025 landed, "Users can update their own profile" covered these two
-- columns and 003's/012's BEFORE trigger was the only thing stopping a rider
-- rewriting their own completion and consent record — so this section used to
-- write both columns directly and check the trigger's CHECK logic (a NULL
-- username or location refuses completion, a clear or a back-date is silently
-- re-pinned). 025 revokes SELECT, INSERT and UPDATE on both columns from
-- `authenticated` outright (an explicit re-grant allowlist, because a
-- column-scoped REVOKE against a table-level GRANT is a documented no-op — see
-- the migration's own DEFECT 1). A statement naming either column now fails at
-- the GRANT, before the trigger is ever entered — so the refusal is
-- unconditional rather than value-dependent, which the "syntactically valid
-- completion" case below exists to prove: it is refused exactly as hard as a
-- forged one.
--
-- The trigger's rule content did not go away; it moved into
-- `complete_onboarding()` and `accept_terms()`, the only remaining path to
-- either column (021 §3, asserted in the 021 section below), because a
-- `security definer` function runs as its owner and the trigger's
-- `current_user <> 'authenticated'` guard short-circuits for it. Re-asserting
-- the CHECK's exact wording here would be asserting dead code: no role can
-- ever reach it carrying a value the client chose. What IS still reachable —
-- the re-pin the trigger performs on an ordinary edit — is asserted two blocks
-- down, and is the only branch of that function any role can still enter.

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

select assert_denied($$
  update profiles set onboarding_completed_at = now()
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  'a direct write to the completion stamp is refused before the trigger ever runs');

-- PostgREST's upsert (Prefer: resolution=merge-duplicates) is INSERT ... ON
-- CONFLICT DO UPDATE, a second route to the same column — INSERT is granted by
-- column too, so 025 closes it for free.
select assert_denied($$
  insert into profiles (id, onboarding_completed_at)
  values ('00000000-0000-0000-0000-00000000000e', now())
  on conflict (id) do update set onboarding_completed_at = excluded.onboarding_completed_at$$,
  'and so is the same write sent as a PostgREST-style upsert');

select assert_denied($$
  update profiles set terms_accepted_at = now()
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  'a direct write to the consent stamp is refused the same way');

select assert_denied($$
  insert into profiles (id, terms_accepted_at)
  values ('00000000-0000-0000-0000-00000000000e', now())
  on conflict (id) do update set terms_accepted_at = excluded.terms_accepted_at$$,
  'and so is its upsert form');

-- 023 §1.14's two INSERT arms: a bare INSERT naming a stamp, with no ON
-- CONFLICT at all — the path 012 §KNOWN LIMIT recorded and 023 closed with a
-- trigger. No fixture is needed for either, because the grant refuses them
-- before any row-existence or ownership question is reached. 023's trigger is
-- now belt-and-braces behind the grant rather than the enforcement of record,
-- which is exactly why these are asserted as *unreachable* rather than deleted:
-- they are what fails if a later migration re-grants either column.
select assert_denied($$
  insert into profiles (id, terms_accepted_at)
  values ('00000000-0000-0000-0000-00000000009e', now())$$,
  'a bare INSERT naming the consent column is refused just the same — grant-enforced, not trigger-enforced');

select assert_denied($$
  insert into profiles (id, username, location, onboarding_completed_at)
  values ('00000000-0000-0000-0000-00000000009e', 'ghostrider', 'Evora', now())$$,
  'and a fresh row cannot be born onboarded either — same grant, other column');

-- The rider whose wizard step this would legitimately complete is refused
-- exactly as hard. 000d has a username and no location; the pre-025 version of
-- this suite completed the wizard with this exact statement and read the row
-- back to prove it. That path is gone — this is a grant, not a value check, and
-- `complete_onboarding()` is where the wizard's last step lives now.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000d', false);
select assert_denied($$
  update profiles set location = 'Braga', onboarding_completed_at = now()
  where id = '00000000-0000-0000-0000-00000000000d'$$,
  'a syntactically valid completion is refused too — the grant does not read the value');

\echo ''
\echo '# ... nor read by it, own row or not (migration 025)'

-- RLS is row-level: the profiles SELECT policy admits every non-blocked rider
-- with a username, which includes 000a admitting 000c and vice versa. Before
-- 025 that meant every column of the row, including these two. The column
-- grant is what narrows it now, so the same row RLS admits still refuses the
-- two stamps specifically.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

select assert_denied($$select terms_accepted_at from profiles where id = auth.uid()$$,
  'a rider cannot read their OWN consent stamp directly');
select assert_denied($$select onboarding_completed_at from profiles where id = auth.uid()$$,
  'nor their own completion stamp');
select assert_denied($$select terms_accepted_at from profiles where id = '00000000-0000-0000-0000-00000000000c'$$,
  'nor another rider''s consent stamp — the row is visible, the column is not');
select assert_denied($$select onboarding_completed_at from profiles where id = '00000000-0000-0000-0000-00000000000c'$$,
  'nor another rider''s completion stamp');

-- `select=*` is the shape PostgREST issues for an unqualified projection, and
-- it is the shape getMyProfile used to send for the caller's own row. It needs
-- SELECT on every column, so it is refused even for your own row. That is not a
-- flaw in the assertion, it is the code change 025 could not ship without.
select assert_denied($$select * from profiles where id = auth.uid()$$,
  'select * over your OWN profile is refused — getMyProfile must be repointed');
select assert_denied($$select * from profiles where id = '00000000-0000-0000-0000-00000000000c'$$,
  'select * over another rider''s profile is refused the same way');

-- Guards against over-tightening, and they are not ceremony: the shape 025 had
-- to use revokes SELECT table-wide first, so a mistake in the re-grant list
-- leaves the app unable to draw a single byline. The second is the 003
-- ghost-row predicate restated as a bulk read — every row a bulk profile read
-- returns has a username — which also proves the read is not refused outright.
select assert_eq((select username from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'clubowner', 'the columns the UI renders are still readable');
select assert_eq((select count(*)::int from profiles where username is not null),
                 (select count(*)::int from profiles),
  'a bulk profile read still works, and every row it returns has a username');

\echo ''
\echo '# An ordinary profile edit still leaves both stamps exactly where they were (003, 012)'

-- These two are 003's "an ordinary profile edit does not disturb completion"
-- and 012's consent twin, repointed rather than deleted — the rule is still
-- live and it is the ONLY branch of enforce_onboarding_completion() any role
-- can still enter. The trigger fires on every profile UPDATE by
-- `authenticated`, takes the two `new.<stamp> := old.<stamp>` re-pin branches,
-- and must pass everything else through; the cost of getting it wrong is that
-- ordinary profile editing breaks, or that an unrelated edit silently NULLs a
-- consent record. What changed is only how the stamp is read back: 025 revoked
-- the column, so it comes through my_onboarding_state().
--
-- Rider 000a is deliberately an *onboarded* rider, which is the load-bearing
-- part of the consent half: the trigger returns early once
-- onboarding_completed_at is set, so a consent re-pin written below that branch
-- would never run for anyone who has finished the wizard — i.e. for every rider
-- 012 protects. This fails if 012's block is ever moved below the early return.
--
-- Not wrapped in a savepoint, deliberately: the pre-025 version of this section
-- left exactly this state behind (bio 'Still rides at dawn', location
-- 'Coimbra') and later sections are written against it.
update profiles set bio = 'Rides at dawn', location = 'Coimbra'
  where id = auth.uid();
select assert_eq((select bio from profiles where id = auth.uid()),
  'Rides at dawn', 'an onboarded rider can still edit the rest of their profile');
select assert_eq((select onboarding_completed_at from public.my_onboarding_state()),
  timestamptz '2026-01-01 00:00:00+00', 'an ordinary profile edit does not disturb completion');

update profiles set bio = 'Still rides at dawn' where id = auth.uid();
select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  timestamptz '2026-01-01 00:00:00+00', 'an ordinary profile edit does not disturb consent');

\echo ''
\echo '# The grant is what decides now, not a value check (migration 025)'

-- Scoped to the grantee: postgres and service_role hold everything by Supabase
-- default, so a table-wide count reads wrong against a correct database — the
-- mistake 015's footer made and documented. has_column_privilege and
-- has_table_privilege need no particular active role to ask the question, so
-- this runs after dropping back to the connection's own role, like the other
-- catalog-introspection blocks in this file.
reset role;

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

-- The table-level grant is what a column-level REVOKE cannot touch (Postgres
-- discards it with a warning), so its absence is the assertion that 025 used
-- the allowlist SHAPE its own header's DEFECT 1 says is the only one that
-- works. Without this line, a file that only revoked the two columns would pass
-- every assertion above by accident of the policy rather than of the grant.
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
  true, 'and username is still writable — onboarding step 2 is an ordinary UPDATE');

set role authenticated;

\echo ''
\echo '# Username charset, length and reserved names (migration 003, Q4)'

-- The client is not a trust boundary: every one of these is reachable as a
-- direct PostgREST call, so the rules have to live in the database.

select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

select assert_rejected($$update profiles set username = 'ab'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'a username shorter than 3 characters is rejected');
-- 057 widened the bound from 20 to 25, so the name that used to sit one over it
-- — `twenty_one_chars_long` — is now legal, and this refusal moved up five
-- characters with it. The matching POSITIVE at exactly 25 is below, with the
-- other one: a `{3,}` typo removes the bound entirely and only this line fails.
select assert_rejected($$update profiles set username = 'aaaaaaaaaaaaaaaaaaaaaaaaaa'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', '057: a username longer than 25 characters is rejected');
select assert_rejected($$update profiles set username = 'has space'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'a username with an illegal character is rejected');
-- 056 relaxed profiles_username_format's CHARSET to `A-Za-z0-9_` — the length
-- bound in it is 057's and reads `{3,25}` today — so the
-- assertion that stood here — "an uppercase username is rejected" — now states
-- the opposite of the rule. Its positive replacement is in §056 below. What is
-- worth pinning in its place is the boundary 056 did NOT move: the charset was
-- widened to ASCII letters, not to Unicode, and the range is collation-stable
-- (checked f on both C.UTF-8 and the hosted en_US.UTF-8, because a
-- collation-sensitive `[A-Za-z]` would have made this pass locally and fail in
-- production, or worse).
select assert_rejected($$update profiles set username = 'Riddér'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23514', 'a username with a non-ASCII letter is rejected — 056 widened the charset to A-Z, not to Unicode');
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

-- 057's boundary from the accepting side, written for real for the same reason.
-- The rejection at 26 above cannot stand alone: a bound left at 20 by a
-- half-applied 057 refuses this and passes every negative in this file.
savepoint max_length_username_accepted;
update profiles set username = 'aaaaaaaaaaaaaaaaaaaaaaaaa'   -- 25
  where id = '00000000-0000-0000-0000-00000000000e';
select assert_eq(
  (select length(username) from profiles where id = '00000000-0000-0000-0000-00000000000e'),
  25, '057: a username of exactly 25 characters is accepted');
rollback to savepoint max_length_username_accepted;

\echo ''
\echo '# Case-insensitive uniqueness lives in the index, not in the charset rule'

-- This assertion used to need scaffolding, and 056 removed the need for it.
--
-- While profiles_username_format forbade uppercase, `Clubowner` failed as a
-- 23514 before it ever reached the index — Postgres evaluates CHECK constraints
-- first — so the only way to put profiles_username_lower_key itself under test
-- was to DROP the charset check inside a savepoint and put it back. That made
-- the assertion true of a database this repo has never run.
--
-- 056 admits capitals, so `Clubowner` now reaches the index for real and the
-- refusal is the index's. The scaffolding is gone and the assertion is
-- strictly stronger: it runs against the whole live constraint set, which is
-- what the impersonation vector Q4 describes actually meets.

select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select assert_rejected($$update profiles set username = 'Clubowner'
  where id = '00000000-0000-0000-0000-00000000000e'$$,
  '23505', 'lower(username) rejects a case-variant of an existing username');
reset role;

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

-- The `reset role` above is what lets the catalog assertions below run
-- unprivileged-free, as they always have — it used to be the savepoint rollback
-- that did it, and 056 removed the savepoint. has_function_privilege() on a
-- private.* function needs USAGE on that schema, which `authenticated`
-- deliberately does not hold.

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
-- Which LAYER refuses this changed with 046: the missing UPDATE grant on
-- author_id now fires before RLS, so the `with check` conjunct that used to be
-- the only refusal is never reached. `assert_denied` recognises 42501 and
-- nothing else and cannot tell the two apart, so the label says both rather than
-- naming a mechanism that no longer runs. The policy half stays measured by
-- 044's md5 pin on this policy's qual||with_check, which is exact text.
select assert_denied($$
  update postcards set author_id = '00000000-0000-0000-0000-00000000000c'
  where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'an author cannot hand their postcard to another rider — the missing UPDATE grant on author_id refuses it first (046), and the WITH CHECK would refuse it anyway');
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
-- postcards is the exception, and 041 is why. It asserted
-- has_table_privilege(...,'update') = true until 041 revoked the table-level
-- grant and re-granted UPDATE over the seven columns that held it, so that
-- `ride_id` could arrive without one. The table-level answer is now
-- deliberately FALSE while every column-level answer stays true — the shape
-- `notifications` already has.
--
-- Flipping the expected value to `false` and stopping would have dropped the
-- coverage entirely: the capability this assertion has always protected is
-- "an author can still edit their caption", which is a COLUMN question now.
-- Both halves are asserted, and 041's own section enumerates all seven.
select assert_eq(has_table_privilege('authenticated', 'public.postcards', 'update'),
  false, 'authenticated holds no TABLE-level UPDATE grant on postcards — 041 made it column-level');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'caption', 'UPDATE'),
  true, 'authenticated can still update postcards.caption (caption edits) — the capability the table-level grant used to carry');

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
      and policyname !~* '(postcard|avatar|cover|ride map)'),
  0, 'every storage.objects policy names the upload surface it belongs to');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname ~* '(avatar|cover)' and policyname !~* 'club'),
  6, 'the profile surfaces carry three policies each — avatars/ and covers/');
-- The sixth surface, added by 051. Scoped to its own name rather than folded
-- into a whole-table total, for the reason the block above gives: a total stops
-- testing "no leftover policy to OR against" for any one folder the moment a
-- second folder exists.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname ~* 'ride map'),
  3, '051: ride-maps/ carries exactly three policies — insert, select and delete');
select assert_eq(
  (select array_agg(cmd order by cmd)::text from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname ~* 'ride map'),
  '{DELETE,INSERT,SELECT}', '051: ... and no UPDATE among them, so replacing a tile is delete-then-insert and stays subject to the same path pinning');
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
-- suite's transaction, so `now()` — the transaction start time — is the fixed
-- point everything here is arranged around.
--
-- **068 moved two things in this block, and neither is a change of intent.**
-- Both are mechanical consequences of the migration, written down because the
-- obvious repair to either one silently stops testing the rule:
--
--   * **The postcard moves, not the watermark.** 068 hangs a BEFORE INSERT OR
--     UPDATE trigger on `feed_reads` that stamps `now()`, and a trigger fires
--     for the table owner exactly as it does for `authenticated` — so a
--     watermark written at `now() - interval '10 years'` is no longer
--     expressible, here or anywhere. `postcards.created_at` moves instead, as
--     the owner, because 044 withholds that column's grant from
--     `authenticated`. A session that "fixes" this by writing `last_seen_at`
--     directly will find its value silently replaced and this assertion passing
--     for the wrong reason.
--   * **000b reads, not 000a.** 068 excludes the reader's OWN postcards, and
--     this one is 000a's. Read as 000a it would answer zero for a reason that
--     has nothing to do with the watermark. 000b is the other member of c1.
insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-0000000000ef', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000c1',
   'postcards/00000000-0000-0000-0000-00000000000a/ffffffff-0000-4000-8000-0000000015a1.jpg',
   'After the watermark');

reset role;
update postcards set created_at = now() + interval '1 hour'
 where id = '00000000-0000-0000-0000-0000000000ef';
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
insert into feed_reads (user_id, club_id)
values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1');

select assert_eq(
  (select unread from club_unread_counts() where club_id = '00000000-0000-0000-0000-0000000000c1') > 0,
  true, 'activity after the watermark counts as unread');

-- The watermark cannot be advanced past the postcard inside one transaction —
-- 068 stamps it `now()`, which does not move — so the postcard comes back
-- behind it instead. Same comparison, same rule, the other operand; 061
-- arranges its own "read to the end" case this way for the same reason.
--
-- This label read 'advancing the watermark clears the badge' before 068. It is
-- renamed rather than kept because the mechanism it names is no longer the one
-- being exercised, and a label that describes a movement the suite can no
-- longer make is how the next reader tries to make it.
reset role;
update postcards set created_at = now() - interval '1 minute'
 where id = '00000000-0000-0000-0000-0000000000ef';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);

select assert_eq(
  (select unread from club_unread_counts() where club_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'nothing newer than the watermark clears the badge');

-- Back to 000a for the rest of this section: c2's only member is 000a, and c5
-- is 000b's OWN club — read as 000b, the two assertions below would answer
-- NULL and 1 and fail for reasons that are nothing to do with what they test.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

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
--
-- **Repointed from has_table_privilege to has_column_privilege by 048**, which
-- made this grant column-level. The intent is unchanged and is the reason the
-- assertion survives rather than going: the promotion above must be refused by
-- RLS rather than by a missing grant, or the test that follows it proves
-- nothing. But the TABLE-level answer is false now, so the old form would have
-- started failing while its label still claimed the grant was present — 045's
-- trap, one table further along. `role` is the column a promotion feature would
-- write, so it is the one the question has to be asked about.
select assert_eq(
  has_column_privilege('authenticated', 'public.club_members', 'role', 'UPDATE'),
  true, 'the grant on `role` is present, so it is genuinely RLS refusing the promotion — asked per column since 048');

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
-- 021 is APPLIED, so its assertions belong here. It creates three functions and
-- nothing else — `my_onboarding_state()`, `accept_terms()` and
-- `complete_onboarding(text)` — and is deliberately additive: on its own it
-- moves no grant.
--
-- **The revoke — `025` — is applied too, and this section still covers only
-- 021's own behaviour.** 025's grant facts (`has_column_privilege(...) = false`
-- and friends) live near the top of this file, in "The grant is what decides
-- now, not a value check", immediately after the direct-write and direct-read
-- denials they explain. This section used to carry two of its own — "021 left
-- the table-wide SELECT alone" and "... still client-writable until 025" —
-- asserting that 021 alone had not moved a grant, back when the two migrations
-- were on opposite sides of a deploy and the two states genuinely differed.
-- They no longer do, so every grant fact this database has is asserted once,
-- where it is explained, rather than twice under two framings that would drift
-- apart the next time either migration changes.
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

-- The location argument, and these are EXPECTED-VALUE FLIPS rather than
-- renames. Both labels asserted a 23514 until 075 (PD-286) deleted the arm that
-- raised it, so the old wording names a rule the schema no longer has. They are
-- kept in place, inverted, with a `075:` prefix and the reason stated — a
-- session reconciling label sets against `development` has to be able to see
-- that reinstating either line would re-assert a removed rule and turn a
-- correct database red. Nothing here is deleted for the same reason.
--
-- 0012 is already onboarded and holds 'Aveiro', so these two are also the
-- re-run case, which is what 075's `coalesce` exists for. The stored value is
-- read back after each call rather than inferred from the absence of an error:
-- a function that wrote NULL over 'Aveiro' would return a stamp and look
-- exactly like a pass. 075.3, at the end of this file, is the same pin on a
-- fixture of its own.
select set_config('test.uid', '00000000-0000-0000-0000-000000000012', false);
savepoint null_location_075;
select assert_eq(public.complete_onboarding(null) is not null, true,
  '075: complete_onboarding() ACCEPTS a NULL location — was "complete_onboarding() refuses a NULL location", and the arm that raised 23514 went with the location step');
select assert_eq((select location from profiles where id = auth.uid()),
  'Aveiro', '075: ... and a NULL location leaves the stored value ALONE — the write is conditional now, because deleting the refusal on its own would have made every re-run erase a rider''s location');
select assert_eq(public.complete_onboarding('   ') is not null, true,
  '075: complete_onboarding() ACCEPTS a location of nothing but spaces — was "complete_onboarding() refuses a location of nothing but spaces"; nullif(btrim(...), '''') turns it into "leave it alone" rather than a 23514 from 018''s CHECK');
select assert_eq((select location from profiles where id = auth.uid()),
  'Aveiro', '075: ... and it leaves the stored value alone too, which a coalesce over the untrimmed argument would not');
rollback to savepoint null_location_075;

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
  true, 'authenticated can — it is the only path to the consent stamp now that 025 has landed');
select assert_eq(has_function_privilege('anon', 'public.complete_onboarding(text)', 'execute'),
  false, 'anon cannot call complete_onboarding()');
select assert_eq(has_function_privilege('authenticated', 'public.complete_onboarding(text)', 'execute'),
  true, 'authenticated can — it is the only path to the completion stamp now that 025 has landed');

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

-- The grant state itself — that 025 really did take both columns away, leaving
-- these three functions as the only path back to them — is asserted once, near
-- the top of this file, rather than restated here under a second framing.

rollback to savepoint accessors_021;

set role authenticated;
select set_config('test.uid', '', false);
reset role;

-- ===========================================================================
-- 023: onboarding and consent gate participation, not just navigation
-- ===========================================================================
--
-- 023 is APPLIED, alongside 025 (the revoke, asserted near the top of this
-- file) and 021 (the writers, just above) — so this section, not a pending
-- suite, is where its assertions belong. It adds a BEFORE INSERT trigger to
-- eight tables — `postcards`, `clubs`, `rides`, `club_members`, `ride_members`,
-- `postcard_comments`, `postcard_likes`, `postcard_reports` — refusing any write
-- from a rider who has not finished onboarding AND accepted the terms. Five
-- tables are deliberately NOT gated, each for its own reason given in the
-- migration header: `blocks` and `postcard_hides` are safety valves that must
-- work for an un-onboarded rider too, `feed_reads` produces nothing anyone sees,
-- `profile_countries` is a fact about the rider's own profile, and `profiles` is
-- the row the wizard itself writes — gating it would make onboarding
-- unreachable, which is the one failure mode this whole change must not have.
--
-- ---------------------------------------------------------------------------
-- The fixtures this section adds, and why it adds a postcard of its own
-- ---------------------------------------------------------------------------
-- Two riders, rolled back at the end, so nothing above this point moves:
--
--   0011  username, location, onboarding_completed_at SET, terms NULL — the
--         state 3 of the 4 riders on the hosted project were actually in when
--         023 was written, and the arm that made the consent prompt a
--         precondition of applying this migration at all
--   0012  username, location, BOTH stamps set, and no content of any kind — so
--         each of its writes below is a first write, not a duplicate
--
-- And **one postcard**, because seed.sql's `...00e1` is gone by the time this
-- section runs: the 011 cascade block deletes it for real, outside any
-- savepoint, to prove that comments, hides and reports go with it. The pending
-- suite these assertions came from ran instead of this file and so still had it.
-- A comment, like and report all need a postcard that exists AND is visible to
-- their author, so this section owns one: club_id NULL (the app-wide feed) and
-- authored by 000a, who is in no block relationship. Inserted as the table owner
-- — 023's trigger carries `when (current_user = 'authenticated')`, so seeding it
-- does not have to satisfy the gate it is here to test.

savepoint participation_gate_023;

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000011', 'noconsent@example.com'),
  ('00000000-0000-0000-0000-000000000012', 'qualified@example.com');
reset role;

update profiles set username = 'noconsent', location = 'Braga',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000000011';
update profiles set username = 'qualified', location = 'Aveiro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000000012';

insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-000000023e01', '00000000-0000-0000-0000-00000000000a',
   null, 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000023e001.jpg',
   'A postcard this section owns');

-- The fixtures landed at all, which is a claim about 025 as much as about the
-- seed: it revoked from `authenticated`, not from the table owner. If that ever
-- stops being true this block fails loudly instead of silently seeding nothing.
select assert_eq((select count(*)::int from profiles
                   where id in ('00000000-0000-0000-0000-000000000011',
                                '00000000-0000-0000-0000-000000000012')
                     and terms_accepted_at is not null),
  1, 'the fixtures exist and only one of them consented — 025 revoked from authenticated, not from the owner');

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 023 assertions run as authenticated, or they prove nothing');

\echo ''
\echo '# A rider with two NULL stamps reaches the far side of the wizard end to end (023 + 021 + 025)'

-- The proof that this pair composes at all, and the headline of what used to be
-- `PENDING=023+025`. 000e is seed.sql's step-1 rider — no username, no location,
-- no stamps, the worst case — walked through the wizard using only what the
-- shipped app has (the two RPCs and one ordinary profile UPDATE), with the gate
-- checked shut at every step it should be shut and open exactly once it is not.
-- This is the scenario that failed with "permission denied for table profiles"
-- the first time 023 and the revoke were put in one database, before 021 gave
-- the wizard a way through.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

savepoint the_whole_path;

select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  null::timestamptz, 'start: no consent');
select assert_eq((select onboarding_completed_at from public.my_onboarding_state()),
  null::timestamptz, 'start: not onboarded');
select assert_eq((select has_username from public.my_onboarding_state()),
  false, 'start: no username');

select assert_rejected($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-00000000000e',
          'postcards/00000000-0000-0000-0000-00000000000e/eeeeeeee-0000-4000-8000-00000000ab01.jpg', 'hi')$$,
  '23514', 'start: the gate refuses a postcard');

-- Step 1 as it works once 023 §1.13 is live: consent first, because completion
-- now requires it. This is the call /onboarding/terms makes.
select public.accept_terms();
select assert_eq((select terms_accepted_at is not null from public.my_onboarding_state()),
  true, 'step 1: accept_terms() records consent');

-- Step 2: the username, an ordinary UPDATE on a column 025 still grants.
update profiles set username = 'rookie' where id = auth.uid();
select assert_eq((select has_username from public.my_onboarding_state()),
  true, 'step 2: the username is an ordinary UPDATE and still works');

-- The gate is still shut, because completion has not happened yet — asserted so
-- the path cannot pass by opening early.
select assert_rejected($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-00000000000e',
          'postcards/00000000-0000-0000-0000-00000000000e/eeeeeeee-0000-4000-8000-00000000ab02.jpg', 'hi')$$,
  '23514', 'mid-wizard: consent alone does not open the gate');

-- Step 3: location and completion, in one statement.
select assert_eq(public.complete_onboarding('Amsterdam') is not null,
  true, 'step 3: complete_onboarding() returns the stamp it set');
select assert_eq((select location from profiles where id = auth.uid()),
  'Amsterdam', 'step 3: the location landed in the same statement');
select assert_eq((select onboarding_completed_at is not null from public.my_onboarding_state()),
  true, 'step 3: and so did the completion stamp');

-- And the gate opens. This one assertion is what the whole path exists for: it
-- is the statement that failed the day 023 and the revoke were first tried in
-- the same database.
savepoint the_first_postcard;
insert into postcards (author_id, image_path, caption)
values ('00000000-0000-0000-0000-00000000000e',
        'postcards/00000000-0000-0000-0000-00000000000e/eeeeeeee-0000-4000-8000-00000000ab03.jpg', 'hi');
select assert_eq((select count(*)::int from postcards
                   where author_id = '00000000-0000-0000-0000-00000000000e'),
  1, 'THE PATH HOLDS: the rider who started with two NULL stamps has posted');
rollback to savepoint the_first_postcard;

rollback to savepoint the_whole_path;

\echo ''
\echo '# A rider with neither stamp cannot create anything (migration 023)'

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
  values ('00000000-0000-0000-0000-000000023e01', '00000000-0000-0000-0000-00000000000e', 'hello')$$,
  '23514', 'un-onboarded: postcard_comments refused');

select assert_rejected($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-000000023e01', '00000000-0000-0000-0000-00000000000e')$$,
  '23514', 'un-onboarded: postcard_likes refused');

-- Decided explicitly rather than by pattern: with email confirmation off
-- (decision #6) an account can be made with an address nobody controls, and no
-- admin role exists to triage what it files.
select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000023e01', 'spam')$$,
  '23514', 'un-onboarded: postcard_reports refused');

-- 034's table, and the one case in this section where the SQLSTATE is the whole
-- assertion. An un-onboarded rider is not on any ride, so a bare insert here
-- would be refused 42501 by the crew policy and `assert_rejected(..., '23514')`
-- would FAIL — correctly, but for a reason that reads like a broken gate. Put
-- the rider on the ride first and the two refusals separate cleanly: 42501 means
-- "not crew", 23514 means "crew, but not onboarded", and only the second is what
-- this section is about.
reset role;
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000e', 'going');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

select assert_rejected($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000e', 'hello')$$,
  '23514', 'un-onboarded: ride_messages refused even when crew');

\echo ''
\echo '# Onboarded but never consented is refused just the same (migration 023)'

-- The state 3 of the 4 riders on the hosted project were actually in when 023
-- was written, so this is the arm that decided whether the gate needed a consent
-- prompt before it could ship at all.
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
  values ('00000000-0000-0000-0000-000000023e01', '00000000-0000-0000-0000-000000000011', 'hello')$$,
  '23514', 'no consent: postcard_comments refused');

select assert_rejected($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-000000023e01', '00000000-0000-0000-0000-000000000011')$$,
  '23514', 'no consent: postcard_likes refused');

select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000023e01', 'spam')$$,
  '23514', 'no consent: postcard_reports refused');

\echo ''
\echo '# With both stamps, all nine succeed (migrations 023 + 034)'

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

-- These three need the postcard this section seeded, not just the gate: their
-- INSERT policies all resolve the audience by delegating to the postcards row,
-- so a rider who cannot SEE the postcard is refused 42501 whatever their stamps
-- say. Passing here is therefore two claims, and the gate is only one of them.
select assert_allowed($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-000000023e01', '00000000-0000-0000-0000-000000000012', 'hello')$$,
  'qualified: postcard_comments allowed');

select assert_allowed($$
  insert into postcard_likes (postcard_id, user_id)
  values ('00000000-0000-0000-0000-000000023e01', '00000000-0000-0000-0000-000000000012')$$,
  'qualified: postcard_likes allowed');

select assert_allowed($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000023e01', 'spam')$$,
  'qualified: postcard_reports allowed');

-- The ninth (034). It needs a precondition none of the other eight do: the
-- rider has to be ON the ride, because ride_messages is gated by crew rather
-- than by ride visibility. `qualified: ride_members allowed` above proves the
-- RSVP is permitted but rolls it back — assert_allowed always does — so the crew
-- row is written here as the table owner, the same shape the club c3 case near
-- the top of this file uses.
--
-- Without it this assertion would still pass while proving nothing about the
-- gate: a non-crew rider is refused by RLS with 42501, and assert_allowed's
-- failure message would send the next reader hunting through 034's policies for
-- a bug in the consent gate.
reset role;
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000012', 'going');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000000012', false);

select assert_allowed($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000012', 'see you at the pier')$$,
  'qualified: ride_messages allowed');

\echo ''
\echo '# The five deliberate omissions still accept an un-onboarded rider (migration 023)'

-- Named in 023's header with their reasons, so the omission is a decision. These
-- are what stop it silently becoming an oversight later: a gate landing on
-- `blocks` would mean "finish the wizard before you can get away from someone".
-- `profiles`, the fifth, is covered below rather than here — a gate on it would
-- make onboarding unreachable, which is a stronger claim than an insert.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

select assert_allowed($$
  insert into blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000a')$$,
  'un-onboarded: blocks still allowed — safety is not gated');

select assert_allowed($$
  insert into postcard_hides (postcard_id, user_id)
  values ('00000000-0000-0000-0000-000000023e01', '00000000-0000-0000-0000-00000000000e')$$,
  'un-onboarded: postcard_hides still allowed — per-viewer');

select assert_allowed($$
  insert into feed_reads (user_id, club_id, last_seen_at)
  values ('00000000-0000-0000-0000-00000000000e', null, now())$$,
  'un-onboarded: feed_reads still allowed — a watermark shows nobody anything');

select assert_allowed($$
  insert into profile_countries (user_id, country_code)
  values ('00000000-0000-0000-0000-00000000000e', 'PT')$$,
  'un-onboarded: profile_countries still allowed — it is their own profile');

-- `ride_reads` is the sixth omission and it is the one whose safety is
-- TRANSITIVE rather than direct, which is why it is asserted here rather than
-- left to 061's own header. The other five accept an un-onboarded rider on
-- purpose; this one refuses them, and not because of a gate — because 061's
-- WITH CHECK requires crew standing, and the gates on `rides` and `ride_members`
-- are what stop an un-consented account acquiring any.
--
-- **That chain is the whole argument for leaving the gate off this table**, and
-- CLAUDE.md is explicit that the gate is narrower than "every write" — an
-- account created by calling GoTrue's /auth/v1/signup directly reaches real
-- write paths with `terms_accepted_at` NULL. So the chain is asserted at both
-- links rather than assumed: the watermark is refused, and the membership row
-- that would have made it succeed is refused by the gate.
-- `d4` rather than `d2`, and the difference is not cosmetic: the first assertion
-- in this section has `000e` block `000a`, who organises `d2` — so `d2` is now
-- invisible to them and the refusal would come from the VISIBILITY conjunct
-- while the label claimed the crew one. `d4` is public and organised by `001b`,
-- whom `000e` has not blocked, so the visibility conjunct passes and the crew
-- conjunct is provably what refuses. Asserted, not assumed.
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000000000d4'),
  1, '023/061: un-onboarded: the rider CAN see this public ride ...');
select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000d4')$$,
  '023/061: ... and ride_reads is REFUSED anyway — not by a gate, but because they cannot be crew');
select assert_rejected($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-00000000000e', 'going')$$,
  '23514', '023/061: ... and the gate is what stops them acquiring the crew row that would change that');

\echo ''
\echo '# Nobody is stranded — the one failure mode this pair must not have (023 + 025)'

-- Three things must all be true for a NULL-consent rider, or the gate is
-- unshippable and the rider is locked out of the app by the very migration meant
-- to protect them. The consent prompt the route guard sends them to needs all
-- three.
select set_config('test.uid', '00000000-0000-0000-0000-000000000011', false);

-- (a) they can read their own position, which is what the guard routes on.
select assert_eq((select count(*)::int from public.my_onboarding_state()),
  1, 'stranded check (a): a NULL-consent rider can read their own state');
select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  null::timestamptz, '... and it correctly reports the missing consent');

-- (b) they can consent — the one the gate would otherwise make impossible, since
-- 023 refuses their writes and 025 refuses their UPDATE.
savepoint stranded_consent;
select assert_eq(public.accept_terms() is not null,
  true, 'stranded check (b): a NULL-consent rider can call accept_terms()');
-- ... and having done so, the gate opens. Otherwise consenting leads nowhere.
select assert_allowed($$
  insert into clubs (name, is_public, owner_id)
  values ('Newly Consented MC', true, '00000000-0000-0000-0000-000000000011')$$,
  '... and consenting opens the gate for a rider who was already onboarded');
rollback to savepoint stranded_consent;

-- (c) the rider's own ordinary profile writes still work while both stamps are
-- NULL. `profiles` is the fifth deliberate omission from the gate, and this is
-- what that omission is for. Written for real and read back, because an UPDATE
-- filtered to zero rows by RLS does not error.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
savepoint stranded_wizard;
update profiles set username = 'rookie' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'rookie', 'stranded check (c): step 1 still writes with both stamps NULL');
update profiles set bio = 'still mid-wizard' where id = auth.uid();
select assert_eq((select bio from profiles where id = auth.uid()),
  'still mid-wizard', '... and so does an ordinary profile column');
rollback to savepoint stranded_wizard;

\echo ''
\echo '# The gate is wired the way it has to be (migration 023)'

-- Catalog introspection, so the role drops back to the owner. It has to be:
-- `has_function_privilege` resolves `private.may_participate()` by name, and
-- `authenticated` has no USAGE on that schema by design (005) — the check itself
-- would answer 42501 rather than a boolean.
reset role;

-- Ten since 051 added ride_map_render_attempts, nine since 034 added
-- ride_messages. This number is deliberately hand-written rather than derived:
-- if it were `(select count(*) from the tables we gated)` it could not notice a
-- gate going missing, which is the whole point.
select assert_eq(
  (select count(*)::int from pg_trigger
    where tgname = 'enforce_participation_gate' and not tgisinternal),
  11, '069: eleven gate triggers, one per gated table');

-- Named rather than counted, for the same reason the omissions below are: the
-- total above cannot tell a gate that MOVED from one that was added, and the
-- ledger is the table 051 gated.
select assert_eq(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'enforce_participation_gate'
      and c.relname = 'ride_map_render_attempts'),
  1, '051: ... and the tenth is on the render ledger — spending our vendor budget is a write like any other');

-- Named rather than counted. A bare total would not notice a gate landing on
-- `blocks`, which is the omission that matters most.
select assert_eq(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'enforce_participation_gate'
      and c.relname in ('blocks','postcard_hides','feed_reads','ride_reads','profile_countries','profiles')),
  0, 'and none of the six deliberate omissions acquired one');

-- The WHEN guard is load-bearing twice over: without it the gate fires for the
-- seed and the migration role, and with the guard in the function body instead
-- it fires for nobody, because the function is security definer and
-- `current_user` is then its owner. Neither failure shows up in a positive test.
select assert_eq(
  (select count(*)::int from pg_trigger
    where tgname = 'enforce_participation_gate' and not tgisinternal
      and pg_get_triggerdef(oid) ilike '%current_user%'),
  11, '069: every gate trigger carries the WHEN guard that reads the invoking role');

-- The two halves of the security-definer question, and they point opposite ways.
-- The gate functions MUST be definer; the profile completion guard must NOT be,
-- because as definer its own `current_user <> 'authenticated'` early return
-- would be true on every call and it would enforce nothing while passing every
-- positive test — the shape 022 once shipped wrong, in the other direction.
select assert_eq(
  (select prosecdef from pg_proc
    where proname = 'may_participate' and pronamespace = 'private'::regnamespace),
  true, 'private.may_participate() is security definer');
select assert_eq(
  (select prosecdef from pg_proc
    where proname = 'enforce_participation_gate' and pronamespace = 'public'::regnamespace),
  true, 'public.enforce_participation_gate() is security definer');
select assert_eq(
  (select prosecdef from pg_proc
    where proname = 'enforce_onboarding_completion' and pronamespace = 'public'::regnamespace),
  false, 'public.enforce_onboarding_completion() is security INVOKER, or it enforces nothing');

select assert_eq(has_function_privilege('anon', 'private.may_participate()', 'execute'),
  false, 'anon cannot call the gate helper');
select assert_eq(
  has_function_privilege('authenticated', 'public.enforce_participation_gate()', 'execute'),
  false, 'the trigger function is not callable as an RPC');

-- 023 §1.14's INSERT trigger. With 025 applied nothing can reach its body — the
-- client holds no grant on either stamp, and every other role short-circuits on
-- the function's own `current_user <> 'authenticated'` guard — so its presence
-- is all the suite can honestly assert. It is defence in depth against a future
-- re-grant, and this count is what notices if it is ever dropped as dead code.
select assert_eq(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'profiles' and not t.tgisinternal),
  2, 'profiles carries the 003/012 UPDATE trigger and 023''s INSERT one');

-- The invariant every other section ends on. 023 changes no policy's role
-- targeting and grants anon nothing.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and not (roles = '{authenticated}')),
  0, 'every policy still targets authenticated only, after the gate');
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  0, 'anon still holds no table privileges in public, after the gate');

rollback to savepoint participation_gate_023;

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

-- ===========================================================================
-- 029: the profiles cascade — four indexes, and a club that outlives its owner
-- ===========================================================================
--
-- Groundwork for account deletion. `clubs.owner_id → profiles` is ON DELETE
-- CASCADE and `postcards.club_id → clubs` is ON DELETE CASCADE behind it, so
-- one rider erasing their account destroys every postcard every OTHER rider
-- ever posted into a club that rider happened to own. §C proves that defect
-- exists before it proves the fix works — a fix asserted without its
-- counterfactual is a test that passes if the transfer silently does nothing.
--
-- This section owns its own fixtures. The seed's c1/c2/c4 are shared with forty
-- assertions above, and its `...00e5` postcard is deleted for real at line ~730,
-- so nothing here leans on either.

set role authenticated;
select set_config('test.uid', '', false);
select set_config('request.jwt.claims', '', false);
reset role;

\echo ''
\echo '# 029 §A — every FK into profiles can be found by index, derived not listed'

-- Written as a derivation over the catalogue rather than four names, so a table
-- added next year fails this rather than slipping past a hardcoded list. This is
-- the whole point of the assertion: the four indexes are the easy part.
select assert_eq(
  (select count(*)::int from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and not exists (select 1 from pg_index i
                       where i.indrelid = c.conrelid
                         and i.indkey[0] = c.conkey[1])),
  0, '029: no FK into profiles lacks a leading-column index');

-- 13, not the 11 the proposal claims. The grep it recommends counts 15 lines and
-- two of them are `friendships`, which 013 dropped. Asserted so the number stops
-- being re-derived by hand and getting it wrong a third time.
--
-- **14 since 034 added ride_messages.author_id**, and this assertion is why that
-- was noticed rather than assumed: a new table holding personal data that the
-- account-deletion path does not reach is unfinished work, and the only thing
-- standing between "we added a table" and "we quietly stopped deleting all of a
-- rider's data" is a count somebody has to change on purpose. The derived
-- assertion above passed on the same run, so 034's author_id index is real.
--
-- **16 since 036 added notifications.user_id AND notifications.actor_id**, and
-- the pair is the point rather than the arithmetic. A notification is personal
-- data about BOTH riders — it records that a named rider interacted with another
-- named rider's content at a named instant — so erasure has to reach it from
-- both ends: `user_id` takes every notification TO the departing rider, and
-- `actor_id` takes every notification ABOUT them out of every OTHER rider's
-- list. One key without the other leaves half the record standing, and neither
-- direction is visible in the other's constraint. This is the count changed on
-- purpose, which is what the paragraph above asks for.
--
-- **17 since 061 added ride_reads.user_id.** A watermark is behavioural personal
-- data about an identified person — when a named rider last looked at a named
-- conversation — which makes it exactly the kind of row the paragraph above is
-- about, and it is the most disclosive thing 061 adds. The cascade reaches it
-- from `profiles`; it also cascades from `rides`, which is a second and
-- independent path that this assertion cannot see, so the erasure story is
-- asserted directly in the 061 section rather than inferred from this number.
select assert_eq(
  (select count(*)::int from pg_constraint
    where contype = 'f' and confrelid = 'public.profiles'::regclass),
  18, '029/061/069: eighteen FKs reference public.profiles');
select assert_eq(
  (select count(*)::int from pg_constraint
    where contype = 'f' and confrelid = 'public.profiles'::regclass
      and confdeltype = 'c'),
  18, '029/061/069: ... and every one of them is ON DELETE CASCADE');

-- 016's path CHECKs are NOT relaxed. The proposal asks for a relaxation on the
-- grounds that pinning the path to owner_id makes any transfer raise 23514;
-- design D2 chose the other option in the same breath — null both paths on
-- transfer — and says of it "no new constraint semantics". D2 is right, so all
-- four survive and §B proves a transfer still works.
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.clubs'::regclass and contype = 'c'
      and conname in ('clubs_avatar_path_shape', 'clubs_avatar_path_owned',
                      'clubs_cover_image_path_shape', 'clubs_cover_image_path_owned')),
  4, '029: 016''s four club path CHECKs are untouched');

select assert_eq(
  has_function_privilege('authenticated', 'private.transfer_owned_clubs(uuid)', 'execute'),
  false, '029: authenticated cannot execute the transfer function');
select assert_eq(
  has_function_privilege('anon', 'private.transfer_owned_clubs(uuid)', 'execute'),
  false, '029: anon cannot execute the transfer function');
select assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'transfer_owned_clubs'),
  0, '029: the worker itself is not in public, so PostgREST cannot route to it');

-- 031: the door the Edge Function actually knocks on, and who it opens for.
--
-- 029 shipped the worker with NO caller able to reach it: service_role held no
-- USAGE on `private` and PostgREST routes only to `public`, so
-- `.schema('private').rpc(...)` fails before it reaches Postgres. The suite did
-- not catch it because the suite runs as the table owner, for whom neither
-- barrier exists — which is why these assertions name a ROLE rather than
-- calling the function.
select assert_eq(
  has_function_privilege('service_role', 'public.transfer_owned_clubs_for_deletion(uuid)', 'execute'),
  true, '031: service_role can reach the transfer through the public wrapper');
select assert_eq(
  has_function_privilege('authenticated', 'public.transfer_owned_clubs_for_deletion(uuid)', 'execute'),
  false, '031: a rider calling the wrapper is refused before a row is read');
select assert_eq(
  has_function_privilege('anon', 'public.transfer_owned_clubs_for_deletion(uuid)', 'execute'),
  false, '031: and so is anon');
select assert_eq(
  has_function_privilege('service_role', 'private.transfer_owned_clubs(uuid)', 'execute'),
  true, '031: ... because service_role also holds EXECUTE on the worker it calls');

-- ** The POSITIVE half, unasserted until 053. ** Everything below pins that the
-- grant did not spread; nothing pinned that it EXISTS — so revoking it went
-- red nowhere, and account deletion would simply stop working in production
-- with the suite still green. That is not hypothetical: `052`'s verification
-- block tells a reader to expect this false and cites `031` as its authority
-- (see `053`'s header). A session that "restores" the documented value takes
-- `private.transfer_owned_clubs` out of service_role's reach, which is the
-- exact defect `031` exists to fix.
select assert_eq(
  has_schema_privilege('service_role', 'private', 'usage'),
  true, '053: service_role DOES hold USAGE on private — 031 granted it so the deletion function can resolve its worker; 052''s verification block claims otherwise and is wrong');

-- The assertion that matters most in 031: widening `private` for service_role
-- must not widen it for the client. `005` put the helpers there so PostgREST
-- could not publish them, and `009`'s footer asserts a direct call answers
-- 42501 "permission denied for schema private".
select assert_eq(
  has_schema_privilege('authenticated', 'private', 'usage'),
  false, '031: granting service_role USAGE on private did not grant it to riders');
select assert_eq(
  has_schema_privilege('anon', 'private', 'usage'),
  false, '031: ... nor to anon');
select assert_eq(
  has_function_privilege('service_role', 'private.is_blocked(uuid,uuid)', 'execute'),
  false, '031: schema USAGE alone did not hand service_role the other private helpers');

-- **The assertion that would actually have caught 029's defect**, and the one
-- the seven above cannot substitute for: CALL it as service_role, rather than
-- asking whether the grant exists. A grant can be right while name resolution
-- still fails — that is precisely the shape of what shipped, where EXECUTE was
-- moot because the schema was unreachable. `has_function_privilege` returned a
-- confident answer to the wrong question.
--
-- A uuid that owns no clubs, so this is a provable no-op rather than a
-- transfer inside an assertion.
do $$
declare
  n int;
begin
  set local role service_role;
  select count(*) into n from public.transfer_owned_clubs_for_deletion(
    '00000000-0000-0000-0000-0000deadbeef');
  reset role;
  if n <> 0 then
    raise exception 'FAIL  031: the ghost uuid owns clubs — fixture drift, not a pass';
  end if;
  raise notice 'ok    031: service_role can actually CALL the wrapper, not just hold the grant';
exception when insufficient_privilege then
  reset role;
  raise exception 'FAIL  031: service_role holds the grant but the call is refused — 029''s defect is back';
end $$;

set role authenticated;
select assert_rejected(
  $$select * from public.transfer_owned_clubs_for_deletion('00000000-0000-0000-0000-0000deadbeef')$$,
  '42501', '031: ... and a rider calling it is refused for real, not just on paper');
reset role;

\echo ''
\echo '# 029 §B — the transfer picks admin, then member, then deletes the club'

savepoint transfer_029;

-- Fixtures this section owns. 000a owns c1 (private, one other member: 000b),
-- c2 (public, no other member) and c4 (public, two other members: 001a, 001b).
-- That is one club per branch, which is why no new club is created here.
--
-- Images on c1, because "a transfer of a club WITH images succeeds" is the
-- assertion the CHECK question turns on. Paths must satisfy the shape CHECK and
-- sit under the CURRENT owner's uid.
update clubs
   set avatar_path      = 'club-avatars/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000000c1.jpg',
       cover_image_path = 'club-covers/00000000-0000-0000-0000-00000000000a/bbbbbbbb-0000-4000-8000-0000000000c1.jpg'
 where id = '00000000-0000-0000-0000-0000000000c1';

-- A ride in the private club organised by SOMEONE ELSE, so it survives 000a's
-- cascade and can be asserted against. d1 is organised by 000a and dies with
-- them, which is correct and proves nothing about the club.
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-000000029d01', 'Members Only Run', 'The Bridge', now() + interval '9 days',
   false, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b');

-- Two rides in c2 — the club that gets DELETED, because 000a is its only member
-- — organised by a rider who is NOT 000a, so neither dies to the organizer
-- cascade and 032 §2's rule is the only thing deciding their fate. c2 is public,
-- which is what lets one of them be public: 022 forbids a ride wider than its
-- club, so a private club could not host the first of these at all.
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-000000032d01', 'Open Run', 'The Square', now() + interval '10 days',
   true,  '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-000000032d02', 'Quiet Run', 'The Lane', now() + interval '11 days',
   false, '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000c');

-- A crew on the private one, so "stranded zombie" is a real state rather than a
-- hypothetical: without 032 §2's delete these rows outlive every reader.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-000000032d02', '00000000-0000-0000-0000-00000000000c', 'going');

-- The third-party postcard: authored by 000c, scoped to 000a's private club.
-- This is the row the whole change exists to protect.
insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-000000029e01', '00000000-0000-0000-0000-00000000000c',
   '00000000-0000-0000-0000-0000000000c1',
   'postcards/00000000-0000-0000-0000-00000000000c/dddddddd-0000-4000-8000-00000029e001.jpg',
   'Not mine to lose');

-- Preconditions, asserted rather than assumed — the seed is shared and the
-- assertions below are meaningless if it has drifted.
select assert_eq((select count(*)::int from clubs where owner_id = '00000000-0000-0000-0000-00000000000a'),
  4, '029: 000a owns four clubs before the transfer');
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000000000c2'
                     and user_id <> '00000000-0000-0000-0000-00000000000a'),
  0, '029: c2 has no member but its owner — the deletion branch');

-- The fourth is c3, and it is worth naming because it is not a tidy fixture.
-- Line ~82 inserts the club for real while its roster insert lives inside
-- `assert_allowed`, which unwinds — so c3 is a club with an owner and NO
-- membership row at all, not even its owner's. That is exactly the state
-- `docs/HANDOFF.md` records as reachable on demand now that `createClub` does
-- two inserts with no transaction, and it lands here by accident.
--
-- It exercises a branch the design did not enumerate: the successor query is
-- `user_id <> departing`, so "no other member" and "no members whatsoever"
-- take the same path and the club is deleted. Correct, and asserted rather
-- than left as a coincidence.
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000000000c3'),
  0, '029: c3 is an orphan club — an owner with no roster at all');

-- Promote 001b in c4 so the admin arm is exercised. 001a and 001b were inserted
-- in one statement so their joined_at is identical; without the promotion the
-- tie breaks on user_id and 001a wins, which is the member arm again.
update club_members set role = 'admin'
 where club_id = '00000000-0000-0000-0000-0000000000c4'
   and user_id = '00000000-0000-0000-0000-00000000001b';

-- THE COUNTERFACTUAL, and it has to run HERE — before the transfer, not beside
-- the cascade assertions in §C where it reads more naturally. Once the transfer
-- has moved c1 to 000b, deleting 000a no longer reaches c1 and the "defect is
-- real" assertion passes for the wrong reason: it would be measuring the fix it
-- is supposed to be the control for. Cost an hour; written down so it does not
-- cost a second one.
--
-- Without the transfer, deleting 000a destroys a postcard authored by 000c
-- through profiles -> clubs -> postcards. If this ever starts failing, an FK
-- changed and the transfer function may have become unnecessary — worth being
-- told about rather than discovering as a silently redundant migration.
savepoint no_transfer_029;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000029e01'),
  0, '029: WITHOUT the transfer, 000c''s postcard dies with 000a — the defect is real');
select assert_eq(
  (select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000000c1'),
  0, '029: ... because the club went with its owner');
rollback to savepoint no_transfer_029;

-- The call. Returns the object paths it surrendered so the caller can delete
-- the bytes; both belong to c1 and this is the only place they are observable.
select assert_eq(
  (select count(*)::int from private.transfer_owned_clubs('00000000-0000-0000-0000-00000000000a')),
  2, '029: the transfer returns both of c1''s Storage object paths');

select assert_eq(
  (select owner_id from clubs where id = '00000000-0000-0000-0000-0000000000c4'),
  '00000000-0000-0000-0000-00000000001b'::uuid,
  '029: c4 goes to the ADMIN, not to the equally-tenured member');
select assert_eq(
  (select role from club_members where club_id = '00000000-0000-0000-0000-0000000000c4'
     and user_id = '00000000-0000-0000-0000-00000000001b'),
  'owner', '029: ... and the roster agrees, so /members does not ring the wrong rider');

select assert_eq(
  (select owner_id from clubs where id = '00000000-0000-0000-0000-0000000000c1'),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  '029: c1 goes to its only remaining member');
select assert_eq(
  (select avatar_path is null and cover_image_path is null from clubs
    where id = '00000000-0000-0000-0000-0000000000c1'),
  true, '029: ... and surrenders both images, which is what keeps 016''s CHECK satisfied');
-- 032 changed this from a delete to a demotion, and the reason is the whole
-- point: the transfer commits over PostgREST before the Edge Function's Storage
-- sweep runs. `029` removed the row here, so one transient Storage error left a
-- rider still holding an account and no longer a member of a private club they
-- founded — which `club_members`' INSERT policy (`c.is_public or c.owner_id =
-- auth.uid()`) makes unrejoinable. The row must survive a failure in between.
select assert_eq(
  (select role from club_members where club_id = '00000000-0000-0000-0000-0000000000c1'
     and user_id = '00000000-0000-0000-0000-00000000000a'),
  'member', '032: the departing rider is DEMOTED, not removed — a failed sweep must not eject them');

select assert_eq(
  (select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000000c2'),
  0, '029: c2 is deleted — no member remained to receive it');
select assert_eq(
  (select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000000c3'),
  0, '029: ... and so is the orphan club with no roster at all');

-- 032 §2. `029` deleted EVERY ride in a club it was deleting; D3's zombie
-- argument only ever covered rides that `SET NULL` would strand — `club_id`
-- NULL plus `is_public` false, which 022 §4 resolves to organizer-only while the
-- crew rows survive. A PUBLIC ride loses nothing to SET NULL, so deleting it
-- destroyed another rider's content for no stated reason.
--
-- Both rides below belong to c2, which has no member but its owner and is
-- therefore deleted. Neither is organised by the departing rider, so neither
-- cascades — the only thing that decides their fate is this rule.
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-000000032d01'),
  1, '032: a PUBLIC ride survives its club being deleted, orphaned but readable');
select assert_eq(
  (select club_id from rides where id = '00000000-0000-0000-0000-000000032d01'),
  null::uuid, '032: ... via ON DELETE SET NULL, exactly as 001 intended');
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-000000032d02'),
  0, '032: a PRIVATE ride is deleted instead of being stranded as a zombie');
select assert_eq(
  (select count(*)::int from clubs where owner_id = '00000000-0000-0000-0000-00000000000a'),
  0, '029: 000a owns no club afterwards');

-- D3's zombie: a ride whose club is deleted must not survive with club_id NULL
-- and is_public false, which 022 §4 resolves to "only the organizer may see it"
-- while its ride_members rows live on — a roster nobody can read.
select assert_eq(
  (select count(*)::int from rides r
    where r.club_id is null and r.is_public = false
      and exists (select 1 from ride_members m where m.ride_id = r.id)),
  0, '029: no ride is left private, clubless and carrying a crew nobody can read');

-- The transferred club's ride keeps its audience. 022's invariant is that a
-- ride may not be wider than its club; the transfer must not widen either side.
select assert_eq(
  (select is_public from rides where id = '00000000-0000-0000-0000-000000029d01'),
  false, '029: the private club''s ride stays private through the transfer');
select assert_eq(
  (select club_id from rides where id = '00000000-0000-0000-0000-000000029d01'),
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  '029: ... and stays attached to its club');
-- 022's invariant: no public ride in a private club. Asserted as "the transfer
-- introduces no NEW violation" rather than "there are none", because there is
-- one and it is deliberate — line ~2603 disables `enforce_ride_club_audience`
-- to seed `...00d5 'Smuggled Run'` into private c1, which is the only way to
-- produce a row that 022 §4's SELECT policy exists to handle. A flat `= 0` here
-- passes only until someone reads it as proof the invariant is globally true.
select assert_eq(
  (select count(*)::int from rides r join clubs c on c.id = r.club_id
    where r.is_public and not c.is_public
      and r.id <> '00000000-0000-0000-0000-0000000000d5'),
  0, '029: the transfer introduces no new 022 violation');
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d5'),
  1, '029: ... and the one deliberate violation is still there, so the exclusion above hides nothing');

\echo ''
\echo '# 029 §C — the cascade, and the defect it exists to prevent'

-- The control for all of this ran in §B, above the transfer — see the note
-- there for why it cannot live here.
--
-- The transfer has already happened, so this is the second half of the order
-- the Edge Function performs: transfer, then delete. Calling it again is a
-- deliberate no-op — 000a owns nothing now — and asserting that it returns no
-- paths is the cheapest available proof that a retried deletion does not
-- double-transfer a club (design D7's idempotency requirement).
select assert_eq(
  (select count(*)::int from private.transfer_owned_clubs('00000000-0000-0000-0000-00000000000a')),
  0, '029: a second transfer for the same rider is a no-op — retry is safe');

delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';

select assert_eq(
  (select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  0, '029: the profile row goes with auth.users — deleting the profile alone is what 012 §KNOWN LIMIT forbids');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000029e01'),
  1, '029: WITH the transfer, 000c''s postcard survives 000a''s deletion');

-- Asserted from 000c's OWN session, not the table owner's. "The row is still
-- there" and "its author can still see it" are different claims, and only the
-- second is the product promise.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000029e01'),
  1, '029: ... and 000c can still read it under RLS, from their own session');
select set_config('test.uid', '', false);
reset role;

select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-000000029d01'),
  1, '029: 000b''s ride in the transferred club survives its old club owner');
select assert_eq(
  (select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000000c1'),
  1, '029: the club itself survives, under its new owner');
select assert_eq(
  (select count(*)::int from rides where organizer_id = '00000000-0000-0000-0000-00000000000a'),
  0, '029: the departing rider''s OWN rides are cancelled — D3, and intended');
select assert_eq(
  (select count(*)::int from postcards where author_id = '00000000-0000-0000-0000-00000000000a'),
  0, '029: and their own postcards go');

-- Nothing is left dangling anywhere in the thirteen. A count per table would go
-- stale the day a fourteenth arrives; this finds orphans by derivation.
select assert_eq(
  (select count(*)::int from club_members where user_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*)::int from ride_members where user_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*)::int from blocks where blocker_id = '00000000-0000-0000-0000-00000000000a'
                                         or blocked_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*)::int from postcard_likes where user_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*)::int from postcard_comments where author_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*)::int from postcard_hides where user_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*)::int from postcard_reports where reporter_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*)::int from profile_countries where user_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*)::int from feed_reads where user_id = '00000000-0000-0000-0000-00000000000a'),
  0, '029: no row anywhere still references the deleted rider');

-- **Derived rather than listed — task 6.1.** The sum immediately above names
-- nine tables by hand, fixed when 029 was written against "the thirteen" FKs
-- that existed then. `034` and `036` have each added a FK into `profiles`
-- since — `ride_messages.author_id` and `notifications.user_id` /
-- `actor_id` — and neither joined the list above, so this cascade test has
-- been silently blind to two of the sixteen live FKs for as long as they
-- have existed. That is exactly the risk task 6.1 names: "the part most
-- likely to be silently wrong". This walks `pg_constraint` itself — the same
-- derivation 029 §A already uses for the index assertion — so it covers
-- every FK into `profiles` today and every one a future migration adds,
-- with no second place to remember to update.
--
-- `clubs.owner_id`, `rides.organizer_id` and `postcards.author_id` are
-- re-covered here too, redundantly with the named assertions above — no
-- exclusion list, because the point of a derivation is that it does not
-- know which tables it "should" skip.
--
-- **The row-count sweep below is NOT what catches a future non-cascading FK,
-- and an earlier revision of this comment implied it was — reviewer finding
-- #3, 2026-08-16.** All sixteen live FKs happen to be `ON DELETE CASCADE`
-- today, so the sweep passes vacuously with respect to that risk: under
-- CASCADE the row is gone and the count is 0 by construction; under
-- `SET NULL` the row survives with a NULL the sweep's `WHERE col = uid`
-- cannot see, so it would ALSO read 0 with data left behind; under
-- `RESTRICT`/`NO ACTION` the `delete from auth.users` above raises before
-- this block ever runs, so it never gets the chance to read anything. There
-- is no live state in which the sweep alone goes red for the wrong-FK-type
-- risk — only the assertion immediately below is falsifiable against it,
-- checked directly against `confdeltype` rather than inferred from row
-- counts. Mutation-tested 2026-08-16: flipping one constraint to `SET NULL`
-- in a rolled-back transaction turns this assertion red and leaves the sweep
-- green, which is exactly the gap it exists to close.
select assert_eq(
  (select count(*)::int from pg_constraint
    where contype = 'f' and confrelid = 'public.profiles'::regclass
      and confdeltype <> 'c'),
  0, '6.1: every FK into profiles is ON DELETE CASCADE — a SET NULL or RESTRICT/NO ACTION here strands a departed rider''s row rather than removing it, and the row-count sweep below cannot see that case (see the comment above)');

-- The sweep itself: real proof, for the CASCADE case the assertion above
-- guarantees is the only live case, that the cascade actually ran end to end
-- rather than merely being declared. Its own value is bounded by that
-- guarantee — see the comment above for exactly what it does and does not
-- catch on its own.
do $$
declare
  fk record;
  leftover int;
  checked int := 0;
begin
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col)
      into leftover using '00000000-0000-0000-0000-00000000000a'::uuid;
    if leftover <> 0 then
      raise exception 'FAIL  6.1: % row(s) still reference the deleted rider through %.%',
        leftover, fk.tbl, fk.col;
    end if;
    checked := checked + 1;
  end loop;
  -- A derivation that silently iterates zero times passes for the same
  -- reason a dropped assertion does — this is what tells the two apart.
  if checked < 16 then
    raise exception 'FAIL  6.1: only % FK column(s) into profiles were found — expected at least 16, so this derivation itself is broken rather than the cascade', checked;
  end if;
  raise notice 'ok    6.1: every FK into profiles (% columns, derived from pg_constraint) is clear of the deleted rider', checked;
end $$;

rollback to savepoint transfer_029;

-- ===========================================================================
-- 030: consent records which terms it accepted
-- ===========================================================================

\echo ''
\echo '# 030 — terms_version is server-owned, and the client cannot even name it'

-- The task list asked for 012's shape — "a client-supplied version is replaced
-- by the server's". The grant is stronger than the trigger: 025 revoked the
-- table-level privileges and re-granted a column allowlist, this column is in
-- none of the three, and column privileges are checked against the columns named
-- in SET *before* any BEFORE trigger runs. So the client is refused rather than
-- silently corrected, and that is what is asserted.
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'select'),
  false, '030: authenticated cannot read terms_version');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'update'),
  false, '030: authenticated cannot update terms_version');
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'insert'),
  false, '030: authenticated cannot insert terms_version');
select assert_eq(
  has_column_privilege('anon', 'public.profiles', 'terms_version', 'select'),
  false, '030: anon cannot read terms_version either');

-- No backfill. Every profile that predates the column keeps NULL for ever — a
-- version invented for a consent that predates the column is a fabricated
-- evidence record, which is worse than an honest unknown.
select assert_eq(
  (select count(terms_version)::int from profiles),
  0, '030: no consent was backfilled with a version it never saw');

savepoint terms_version_030;

-- This section owns its consenting rider rather than borrowing one. Every seed
-- fixture with NULL stamps has been consented by an assertion somewhere above —
-- 000d, the obvious candidate, is stamped by the time control reaches here — and
-- `accept_terms()` is idempotent, so borrowing a consented rider would test
-- nothing while passing. A fresh auth user gets a profile row from
-- `handle_new_user` with both stamps NULL, which is the only state that stamps a
-- version.
set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000030d01', 'unconsented@example.com');
reset role;

select assert_eq(
  (select count(*)::int from profiles where id = '00000000-0000-0000-0000-000000030d01'
     and terms_accepted_at is null and terms_version is null),
  1, '030: the fixture starts with neither a consent stamp nor a version');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000030d01', false);

select assert_rejected(
  $$select terms_version from profiles where id = '00000000-0000-0000-0000-000000030d01'$$,
  '42501', '030: a rider reading their own terms_version is refused');
select assert_rejected(
  $$update profiles set terms_version = 'v99' where id = '00000000-0000-0000-0000-000000030d01'$$,
  '42501', '030: a rider writing their own terms_version is refused, not corrected');

select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  null::timestamptz, '030: ... and has not consented yet');

select public.accept_terms() is not null as consented;
select set_config('test.uid', '', false);
reset role;

select assert_eq(
  (select terms_version from profiles where id = '00000000-0000-0000-0000-000000030d01'),
  '0-placeholder', '030: accept_terms() stamps the current version alongside the timestamp');

-- Idempotency now pins the version as well as the timestamp: a rider who
-- consented under one version is not silently re-recorded under a later one.
-- Asserted by moving the recorded version out from under a second call, which
-- is the only way to tell "did not re-stamp" from "re-stamped with the same
-- constant" — the two are indistinguishable while there is one version string.
update profiles set terms_version = 'v-earlier'
  where id = '00000000-0000-0000-0000-000000030d01';

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000030d01', false);
select public.accept_terms();
select set_config('test.uid', '', false);
reset role;

select assert_eq(
  (select terms_version from profiles where id = '00000000-0000-0000-0000-000000030d01'),
  'v-earlier', '030: a second accept_terms() leaves the recorded version alone');
select assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_terms_version'),
  0, '030: the version string is not published by PostgREST');

rollback to savepoint terms_version_030;

\echo ''
\echo '# A ride''s chat belongs to its CREW, not to everyone who can see the ride (034)'

-- Self-contained fixtures, deliberately. This section could hang off d2/d3 from
-- seed.sql — they already carry a crew and a block relationship — and that would
-- be wrong twice: it runs last, so it would inherit whatever the twenty sections
-- above left behind, and it needs one shape seed.sql cannot provide without
-- moving an existing roster count (an organizer holding NO ride_members row).
--
-- The riders, and what each one is for:
--   40a1  organizer, and deliberately NOT in ride_members  -- the arm that is
--         easy to leave out, and whose absence locks a host out of their own chat
--   40b1  crew, `going`                                    -- the ordinary case
--   40c1  crew, `maybe`                                    -- same rights, no read-only tier
--   40d1  onboarded, can SEE the public ride, never RSVP'd -- the whole point of 034
--   40e1  crew, `going`, and has blocked 40b1
savepoint ride_chat_034;

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000340a1', 'chathost@example.com'),
  ('00000000-0000-0000-0000-0000000340b1', 'chatgoing@example.com'),
  ('00000000-0000-0000-0000-0000000340c1', 'chatmaybe@example.com'),
  ('00000000-0000-0000-0000-0000000340d1', 'chatoutside@example.com'),
  ('00000000-0000-0000-0000-0000000340e1', 'chatblocker@example.com'),
  ('00000000-0000-0000-0000-0000000340f1', 'chathostblocker@example.com'),
  ('00000000-0000-0000-0000-0000000340ab', 'chatclubleaver@example.com');
reset role;

update profiles set username = 'chathost',    location = 'Leiden',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000340a1';
update profiles set username = 'chatgoing',   location = 'Delft',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000340b1';
update profiles set username = 'chatmaybe',   location = 'Gouda',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000340c1';
update profiles set username = 'chatoutside', location = 'Breda',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000340d1';
update profiles set username = 'chatblocker', location = 'Utrecht',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000340e1';
-- Crew, and blocks the ORGANIZER rather than a fellow rider — case 4b.
update profiles set username = 'chathostblocker', location = 'Arnhem',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000340f1';
-- Joins a private club, RSVPs to its ride, then leaves the club — case 4c.
update profiles set username = 'chatclubleaver', location = 'Zwolle',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000340ab';

insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000340e1', '00000000-0000-0000-0000-0000000340b1');

-- Public, so 40d1 provably CAN see the ride. That is what makes "sees the ride,
-- reads nothing" a statement about the crew rule rather than about visibility.
-- No ride_members row for the organizer — see above.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-000000034f01', 'Chat Test Run', 'The Locks',
   now() + interval '5 days', true, '00000000-0000-0000-0000-0000000340a1');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-000000034f01', '00000000-0000-0000-0000-0000000340b1', 'going'),
  ('00000000-0000-0000-0000-000000034f01', '00000000-0000-0000-0000-0000000340c1', 'maybe'),
  ('00000000-0000-0000-0000-000000034f01', '00000000-0000-0000-0000-0000000340e1', 'going'),
  ('00000000-0000-0000-0000-000000034f01', '00000000-0000-0000-0000-0000000340f1', 'going');

-- One message per rider who is entitled to post one, so every count below is a
-- different subset of the same four rows and a wrong policy moves at least one.
insert into ride_messages (id, ride_id, author_id, body) values
  ('00000000-0000-0000-0000-000000034a01', '00000000-0000-0000-0000-000000034f01',
   '00000000-0000-0000-0000-0000000340a1', 'Meeting at the locks at eight.'),
  ('00000000-0000-0000-0000-000000034b01', '00000000-0000-0000-0000-000000034f01',
   '00000000-0000-0000-0000-0000000340b1', 'I will be there.'),
  ('00000000-0000-0000-0000-000000034c01', '00000000-0000-0000-0000-000000034f01',
   '00000000-0000-0000-0000-0000000340c1', 'Depends on the weather.'),
  ('00000000-0000-0000-0000-000000034e01', '00000000-0000-0000-0000-000000034f01',
   '00000000-0000-0000-0000-0000000340e1', 'Bringing spare fuel.');

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 034 assertions run as authenticated, or they prove nothing');

-- 1. The organizer, holding no ride_members row at all. If the crew helper is
--    ever reduced to a membership lookup this is the assertion that fails, and
--    it fails as "the host cannot read their own ride's chat".
select set_config('test.uid', '00000000-0000-0000-0000-0000000340a1', false);
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f01'),
  4, '034: the organizer reads the thread with no ride_members row of their own');

-- 2. The whole point of the table having its own predicate. 40d1 can see the
--    ride — asserted, not assumed, because a hidden ride would make the second
--    line pass for entirely the wrong reason.
select set_config('test.uid', '00000000-0000-0000-0000-0000000340d1', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000034f01'),
  1, '034: a non-crew rider CAN see the public ride ...');
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f01'),
  0, '034: ... and still reads none of its chat — seeing a ride is not being on it');
select assert_denied($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340d1', 'let me in')$$,
  '034: a non-crew rider cannot post to the chat either');

-- 3. `maybe` is crew. There is no read-only tier, and this is the assertion that
--    says so — the alternative reading (only `going` may speak) is a plausible
--    product rule that nothing in the schema would otherwise rule out.
select set_config('test.uid', '00000000-0000-0000-0000-0000000340c1', false);
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f01'),
  4, '034: a `maybe` RSVP reads the whole thread');
select assert_allowed($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340c1', 'weather looks better')$$,
  '034: a `maybe` RSVP can post, exactly like `going`');

-- 4. Blocking, from both ends. Symmetric from one directional row: 40e1 blocked
--    40b1, and neither can see the other's message, while both stay crew and
--    both keep their own.
select set_config('test.uid', '00000000-0000-0000-0000-0000000340b1', false);
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f01'),
  3, '034: the blocked rider does not see the blocker''s message');
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-000000034b01'),
  1, '034: ... but still sees their own');

select set_config('test.uid', '00000000-0000-0000-0000-0000000340e1', false);
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f01'),
  3, '034: and the blocker does not see the blocked rider''s message');

-- 4b. Blocking the ORGANIZER, which is a different question from blocking a
--     fellow rider and is the one a crew-only predicate gets wrong. The rides
--     SELECT policy carries the block clause, so blocking the host removes the
--     ride — and decision #2 says a blocked rider disappears from feeds, search,
--     chat, member lists and crews *simultaneously*. A `ride_members` row
--     survives a block, so a predicate that asks only "are you on the crew"
--     keeps the chat open after the ride itself is gone.
reset role;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000340f1', '00000000-0000-0000-0000-0000000340a1');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-0000000340f1', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000034f01'),
  0, '034: blocking the organizer takes the ride away ...');
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f01'),
  0, '034: ... and the chat goes with it — decision #2 names chat explicitly');

-- 4c. The same hole reached from the other side, and this one is a leak rather
--     than an inconsistency: 022 pins a private club's rides to is_public =
--     false, so leaving the club removes the ride. The ride_members row does not
--     go with it, so a crew predicate alone leaves an ex-member reading a
--     private club's ride chat.
--
--     Asserted separately from 4b even though one conjunct fixes both, because a
--     single assertion cannot say WHICH visibility rule did the hiding — and
--     these two are hidden by different arms of the rides policy.
reset role;
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000340c9', 'Chat Private MC', false,
   '00000000-0000-0000-0000-0000000340a1');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000340c9', '00000000-0000-0000-0000-0000000340a1', 'owner'),
  ('00000000-0000-0000-0000-0000000340c9', '00000000-0000-0000-0000-0000000340ab', 'member');
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-000000034f02', 'Club Chat Run', 'The Yard',
   now() + interval '6 days', false, '00000000-0000-0000-0000-0000000340c9',
   '00000000-0000-0000-0000-0000000340a1');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-000000034f02', '00000000-0000-0000-0000-0000000340ab', 'going');
insert into ride_messages (id, ride_id, author_id, body) values
  ('00000000-0000-0000-0000-000000034a02', '00000000-0000-0000-0000-000000034f02',
   '00000000-0000-0000-0000-0000000340a1', 'Club members only, this one.');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-0000000340ab', false);
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f02'),
  1, '034: a private club''s member reads that club''s ride chat');

reset role;
delete from club_members
 where club_id = '00000000-0000-0000-0000-0000000340c9'
   and user_id = '00000000-0000-0000-0000-0000000340ab';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000340ab', false);

select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000034f02'),
  0, '034: leaving the club takes the private ride away ...');
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f02'),
  0, '034: ... and the chat with it — a ride_members row outlives the club membership');

-- 4d. The client cannot choose a message's timestamp. `default now()` applies
--     only when the column is OMITTED, and a table-level INSERT grant lets
--     PostgREST name any column — so without a column-level grant a rider can
--     stamp a message in the year 3000 and pin it to the end of every crew
--     member's thread, permanently, with no delete UI to remove it. Ordering is
--     the product on this screen, which is what makes it worse here than the
--     same exposure on postcard_comments.
select set_config('test.uid', '00000000-0000-0000-0000-0000000340a1', false);
select assert_denied($$
  insert into ride_messages (ride_id, author_id, body, created_at)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340a1', 'from the future',
          timestamptz '3000-01-01 00:00:00+00')$$,
  '034: a rider cannot write created_at — the server owns message order');

-- 5. Authorship cannot be spoofed. The WITH CHECK names auth.uid() as well as
--    the crew, so being on the ride is not enough to post as somebody else.
select set_config('test.uid', '00000000-0000-0000-0000-0000000340b1', false);
select assert_denied($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340c1', 'not mine to send')$$,
  '034: a crew member cannot post as another rider');

-- 6. No edits, and both halves are the enforcement — a missing grant is the
--    outer gate, a missing policy the inner one. Absence is exactly what a
--    well-meaning `grant all` restores by accident, so it is asserted rather
--    than commented.
select assert_denied($$
  update ride_messages set body = 'edited'
   where id = '00000000-0000-0000-0000-000000034b01'$$,
  '034: nobody can edit a message, not even its author');

-- 7. Deletes. Filtered by USING rather than refused, so a wrong-hands delete
--    touches zero rows instead of raising — the surviving row is the evidence,
--    and assert_allowed would pass here against a policy permitting nothing
--    (the trap 011's section describes and had to be shown by mutation).
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-000000034c01'),
  1, '034: 40c1''s message is there to begin with');
delete from ride_messages where id = '00000000-0000-0000-0000-000000034c01';
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-000000034c01'),
  1, '034: a crew member cannot delete another rider''s message');

delete from ride_messages where id = '00000000-0000-0000-0000-000000034b01';
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-000000034b01'),
  0, '034: a rider can delete their own message');

select set_config('test.uid', '00000000-0000-0000-0000-0000000340a1', false);
delete from ride_messages where id = '00000000-0000-0000-0000-000000034c01';
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-000000034c01'),
  0, '034: the organizer moderates any message on their own ride');

-- 8. Leaving the crew. The negative case most likely to be read as a bug later,
--    so it is pinned in both directions: the leaver loses the thread INCLUDING
--    their own messages, and the messages themselves survive for everyone else.
--    A conversation is not retracted because one participant left.
reset role;
insert into ride_messages (id, ride_id, author_id, body) values
  ('00000000-0000-0000-0000-000000034b02', '00000000-0000-0000-0000-000000034f01',
   '00000000-0000-0000-0000-0000000340b1', 'still here for now');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-0000000340b1', false);
delete from ride_members
 where ride_id = '00000000-0000-0000-0000-000000034f01'
   and user_id = '00000000-0000-0000-0000-0000000340b1';
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-000000034f01'),
  0, '034: a rider who leaves the crew loses the thread, their own messages included');

select set_config('test.uid', '00000000-0000-0000-0000-0000000340a1', false);
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-000000034b02'),
  1, '034: ... and what they wrote stays for the riders who are still on it');

-- 9. The body bounds, which the client must not own (CLAUDE.md: no integrity
--    rule may live only in a Zod schema). Floor on the TRIMMED length, ceiling
--    on the RAW length — asserted separately because a naive `.trim()` in either
--    place silently disagrees with the constraint in one direction only.
select assert_rejected($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340a1', '   ')$$,
  '23514', '034: a message of nothing but spaces is refused');

-- Newlines and tabs, and this is the assertion that matters. `btrim(body)` with
-- no second argument strips **spaces only**, so the spaces-only case above
-- passes against a constraint that still accepts a body of newlines — the
-- client's JS `.trim()` would be stricter than the database, which is the
-- inversion "no integrity rule may live only in a Zod schema" exists to stop.
-- The thread renders `whitespace-pre-wrap` and ships no delete UI, so the
-- artifact is a permanent tall blank bubble in every crew member's chat.
select assert_rejected($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340a1', E'\n\n\n')$$,
  '23514', '034: ... and so is one of nothing but newlines');
select assert_rejected($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340a1', E'\t \t')$$,
  '23514', '034: ... and tabs');
select assert_allowed($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340a1', E'\n  see you  \n')$$,
  '034: but whitespace AROUND real text is content, not emptiness');
select assert_rejected($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340a1', repeat('x', 1001))$$,
  '23514', '034: a message over 1000 characters is refused');
select assert_allowed($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-000000034f01',
          '00000000-0000-0000-0000-0000000340a1', repeat('x', 1000))$$,
  '034: exactly 1000 characters is accepted — the boundary is inclusive');

-- 10. The helper stays off the exposed API surface, the same hygiene 005
--     established and 009 repeated. USAGE on `private` is what a direct call
--     lacks; EXECUTE is what a policy expression needs, and they are different
--     checks — which is why the grant in 034 is not redundant with the schema.
select assert_denied(
  $$select private.is_ride_crew('00000000-0000-0000-0000-000000034f01'::uuid)$$,
  '034: authenticated cannot call is_ride_crew directly, only through a policy');

reset role;
select assert_eq(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_ride_crew'),
  0, '034: is_ride_crew is not in the PostgREST-exposed public schema');
select assert_eq(has_function_privilege('anon', 'private.is_ride_crew(uuid)', 'execute'),
  false, '034: anon cannot execute is_ride_crew');
select assert_eq(has_function_privilege('authenticated', 'private.is_ride_crew(uuid)', 'execute'),
  true, '034: authenticated can execute is_ride_crew (RLS policies need it)');

-- 11. The grants, scoped to their grantee. 015's footer counted a privilege
--     table-wide and read 2 against a correct database, because `postgres` and
--     `service_role` hold everything by Supabase default.
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'ride_messages'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  0, '034: authenticated holds no UPDATE grant on ride_messages');
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'ride_messages'
      and grantee = 'anon'),
  0, '034: anon holds nothing on ride_messages');

-- The column grant, both ways. INSERT is granted per column so `created_at`
-- cannot be named (§4b); asserting only the absence would pass against a
-- migration that granted no INSERT at all and broke every send.
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'ride_messages'
      and grantee = 'authenticated' and privilege_type = 'INSERT'),
  'author_id,body,id,ride_id', '034: authenticated may insert exactly four columns');
select assert_eq(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'ride_messages'
      and grantee = 'authenticated' and privilege_type = 'INSERT'
      and column_name = 'created_at'),
  0, '034: ... and created_at is not one of them — the server owns message order');
select assert_eq(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'ride_messages'
      and grantee = 'anon'),
  0, '034: anon holds no column privilege either');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'ride_messages' and cmd = 'UPDATE'),
  0, '034: and there is no UPDATE policy either');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'ride_messages'),
  3, '034: three policies — select, insert, delete');
select assert_eq(
  (select relrowsecurity from pg_class
    where oid = 'public.ride_messages'::regclass),
  true, '034: row level security is enabled on ride_messages');

-- 12. Realtime. Publication membership is what makes a subscription fire, and a
--     table outside it produces a channel that connects, reports SUBSCRIBED and
--     silently never delivers — indistinguishable from a quiet chat, which is
--     why it is asserted here rather than left to a dashboard.
select assert_eq(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'ride_messages'),
  1, '034: ride_messages is in the supabase_realtime publication');

-- 13. Account deletion has to find a rider's messages by index rather than by
--     scanning every message in the app — the same reason 009 indexed
--     postcard_likes.user_id. 029 §A asserts this shape for every other FK into
--     profiles; this is the new one.
select assert_eq(
  (select count(*)::int from pg_index i
     join pg_class c on c.oid = i.indrelid
     join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
   where c.relname = 'ride_messages' and a.attname = 'author_id'),
  1, '034: ride_messages.author_id leads an index, so the profiles cascade is not a seq scan');

rollback to savepoint ride_chat_034;

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
select assert_denied('select count(*) from ride_messages', 'anon cannot read ride chat');
select assert_denied('select count(*) from notifications', 'anon cannot read notifications');
reset role;

\echo ''
\echo '# A comment is empty if it has no non-whitespace character, not just no spaces (035)'

-- 011's floor was `length(btrim(body)) >= 1`, and its own comment claimed that
-- refused "a comment of nothing but spaces". It did — spaces, and only spaces:
-- btrim(text) with no second argument strips U+0020 alone. So a body of newlines
-- satisfied it while commentBodySchema's JS .trim() refused one, leaving the
-- CLIENT stricter than the database on a rule the database is supposed to own.
--
-- 034 hit the identical trap and named this table as carrying it. These are the
-- assertions that stop it coming back on either.
-- This section owns its fixture. seed.sql's `...00e1` is deleted FOR REAL by the
-- 011 cascade block above — outside any savepoint, to prove comments and hides
-- go with their postcard — so reaching for it here fails at RLS with 42501
-- before the CHECK is ever evaluated, and the assertion would report a
-- constraint problem that is really a missing row. Same reason the 023 section
-- seeds its own.
savepoint comment_whitespace_035;
reset role;
insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-000000035e01', '00000000-0000-0000-0000-00000000000a',
   null, 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-000000035e01.jpg',
   'A postcard the 035 section owns');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);

select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-000000035e01',
          '00000000-0000-0000-0000-00000000000b', '   ')$$,
  '23514', '035: a comment of nothing but spaces is refused');
select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-000000035e01',
          '00000000-0000-0000-0000-00000000000b', E'\n\n\n')$$,
  '23514', '035: ... and newlines, which the btrim form accepted');
select assert_rejected($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-000000035e01',
          '00000000-0000-0000-0000-00000000000b', E'\t\t')$$,
  '23514', '035: ... and tabs');
select assert_allowed($$
  insert into postcard_comments (postcard_id, author_id, body)
  values ('00000000-0000-0000-0000-000000035e01',
          '00000000-0000-0000-0000-00000000000b', E'\n real words \n')$$,
  '035: but whitespace around real text is content');

-- Both tables answer "is this empty" the same way now. Asserted as a pair
-- rather than one each, because the failure mode is exactly one of them being
-- corrected and the other inheriting the old form from a copied migration.
reset role;
select assert_eq(
  (select count(*)::int from pg_constraint
    where conname in ('postcard_comments_body_length', 'ride_messages_body_length')
      and pg_get_constraintdef(oid) like '%~ ''\\S''%'),
  2, '035: both body constraints use the non-whitespace floor, not btrim');
select assert_eq(
  (select count(*)::int from pg_constraint
    where conname in ('postcard_comments_body_length', 'ride_messages_body_length')
      and pg_get_constraintdef(oid) like '%btrim%'),
  0, '035: ... and neither still uses btrim, which strips spaces only');

rollback to savepoint comment_whitespace_035;

\echo ''
\echo '# Notifications: written only by triggers, readable only by their recipient (036)'

-- ===========================================================================
-- 036. The audience rule for a table whose rows OUTLIVE the decision that
-- wrote them.
-- ===========================================================================
--
-- Self-contained fixtures. This section runs last, so hanging it off seed.sql
-- would inherit whatever the twenty-two sections above left behind — and it
-- needs three shapes seed.sql cannot provide without moving an existing count:
-- a club whose OWNER holds no membership row, an `admin`-role member, and an
-- actor whose only purpose is to have their username nulled.
--
-- The riders, and what each one is for:
--   36a1  author of the postcard, organizer of the rides, owner of three clubs
--   36b1  the ACTOR — likes, comments, RSVPs, joins, creates a club ride
--   36c1  a second club member, so a club fan-out has TWO members to be wrong about
--   36d1  an unrelated third rider, member of nothing
--   36e1  an `admin`-role member — inserted as the TABLE OWNER, see §7.10 below
--   36f1  joins clubs and then leaves them, for the eviction assertions
--   3691  owner of a club holding NO club_members row of their own
--   3621  a "ghost" actor with exactly one row, so nulling their username
--         moves a count by exactly one
savepoint notifications_036;

reset role;
select set_config('test.uid', '', false);

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000360a1', 'n36author@example.com'),
  ('00000000-0000-0000-0000-0000000360b1', 'n36actor@example.com'),
  ('00000000-0000-0000-0000-0000000360c1', 'n36other@example.com'),
  ('00000000-0000-0000-0000-0000000360d1', 'n36outsider@example.com'),
  ('00000000-0000-0000-0000-0000000360e1', 'n36admin@example.com'),
  ('00000000-0000-0000-0000-0000000360f1', 'n36leaver@example.com'),
  ('00000000-0000-0000-0000-000000036091', 'n36ownerless@example.com'),
  ('00000000-0000-0000-0000-000000036021', 'n36ghost@example.com');
reset role;

update profiles set username = 'n36author', location = 'Lisbon',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000360a1';
update profiles set username = 'n36actor', location = 'Porto',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000360b1';
update profiles set username = 'n36other', location = 'Faro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000360c1';
update profiles set username = 'n36outsider', location = 'Braga',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000360d1';
update profiles set username = 'n36admin', location = 'Aveiro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000360e1';
update profiles set username = 'n36leaver', location = 'Evora',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000360f1';
update profiles set username = 'n36ownerless', location = 'Coimbra',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000036091';
update profiles set username = 'n36ghost', location = 'Setubal',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000036021';

-- c01 private, c02 public (carries the admin), c03 private with an OWNERLESS
-- owner, c04 public (carries a non-public ride, for the two-conjunct case).
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-00000036c001', 'N36 Private MC',   false, '00000000-0000-0000-0000-0000000360a1'),
  ('00000000-0000-0000-0000-00000036c002', 'N36 Public MC',    true,  '00000000-0000-0000-0000-0000000360a1'),
  ('00000000-0000-0000-0000-00000036c003', 'N36 Ownerless MC', false, '00000000-0000-0000-0000-000000036091'),
  ('00000000-0000-0000-0000-00000036c004', 'N36 PubClub MC',   true,  '00000000-0000-0000-0000-0000000360a1'),
  -- c005 exists only so the leaver is a RECIPIENT rather than an actor. In c004
  -- they are the one who joined, so the club_joined row is addressed to the
  -- OWNER and there is nothing of theirs to keep or lose — an assertion written
  -- against it tests nothing about the club policy. Making them an admin here
  -- gives them a row of their own whose subject is a PUBLIC club.
  ('00000000-0000-0000-0000-00000036c005', 'N36 LeaverAdmin MC', true, '00000000-0000-0000-0000-0000000360a1');

-- ---------------------------------------------------------------------------
-- 7.11 / 7.4 / 7.9 / 7.10 — the fan-out fires with NO JWT, which is what proves
--      the actor is read from NEW rather than from auth.uid()
-- ---------------------------------------------------------------------------
-- Everything below is inserted as the TABLE OWNER with `test.uid` empty, so
-- auth.uid() is NULL throughout. If any fan-out had been written
-- `where recipient <> auth.uid()`, that predicate would evaluate to NULL — not
-- TRUE — and filter out EVERY recipient, so every count below would be 0 and
-- every self-suppression assertion would pass vacuously.
--
-- ** The admin row is inserted here, as the owner, and that is deliberate. **
-- No client can create or promote an admin: club_members INSERT admits `member`,
-- or `owner` for the club's own owner_id, and there is NO UPDATE policy on the
-- table at all — so `admin` is insertable by nobody and promotable by nobody,
-- and zero admin rows exist in production (measured 2026-08-07). Omitting the
-- arm as untestable is not acceptable: it ships the day invitations do, and an
-- untested arm is how it ships broken.
select assert_eq(auth.uid(), null::uuid,
  '036: the fan-out fixtures are written with NO JWT — auth.uid() is NULL');

-- ** ONE STATEMENT PER JOIN, AND THAT IS NOT STYLE. ** An AFTER ROW trigger
-- fires after the whole STATEMENT completes, not after each row — so a
-- twelve-row INSERT makes all twelve rows visible to every one of the twelve
-- trigger invocations, and the owner's own membership row then fans out to an
-- admin who "already" exists. Measured here, not assumed: batched, the admin
-- reads 3 rows instead of 2.
--
-- That is a real Postgres semantic rather than a bug in the fan-out, and the
-- app never produces it — `createClub` writes the club and then ONE membership
-- row, and every later join is one rider's own request. Seeding in one batch
-- would therefore assert against a shape the product cannot reach, which is
-- worse than asserting nothing. Split so each fan-out sees exactly the roster
-- that existed before it, which is what happens in production.
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c001', '00000000-0000-0000-0000-0000000360a1', 'owner');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c001', '00000000-0000-0000-0000-0000000360b1', 'member');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c001', '00000000-0000-0000-0000-0000000360c1', 'member');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c001', '00000000-0000-0000-0000-0000000360f1', 'member');

insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c002', '00000000-0000-0000-0000-0000000360a1', 'owner');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c002', '00000000-0000-0000-0000-0000000360e1', 'admin');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c002', '00000000-0000-0000-0000-0000000360b1', 'member');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c002', '00000000-0000-0000-0000-0000000360c1', 'member');

insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c003', '00000000-0000-0000-0000-0000000360b1', 'member');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c003', '00000000-0000-0000-0000-0000000360c1', 'member');

insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c004', '00000000-0000-0000-0000-0000000360a1', 'owner');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c004', '00000000-0000-0000-0000-0000000360f1', 'member');

insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c005', '00000000-0000-0000-0000-0000000360a1', 'owner');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c005', '00000000-0000-0000-0000-0000000360f1', 'admin');
-- ... and this join is what gives the leaver a row of their own on c005.
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c005', '00000000-0000-0000-0000-0000000360c1', 'member');

-- The fan-out really ran with no JWT. Without this the whole section is vacuous.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-00000036c001'),
  3, '036: club_joined fans out with no JWT present — the actor comes from NEW, not auth.uid()');

-- ** The single most visible possible defect. ** club_members INSERT of the
-- creator's own `owner` row is how every club is created, so a suppression
-- written inside one arm of the union rather than after it tells every creator
-- they joined their own club.
select assert_eq(
  (select count(*)::int from notifications where user_id = actor_id),
  0, '036: nobody is ever notified of their own action — creating a club notifies nobody');

-- 7.9: TWO members plus a non-member. One member cannot tell a correct recipient
-- set apart from private.is_club_member's everybody-or-nobody.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-00000036c002'
      and user_id = '00000000-0000-0000-0000-0000000360a1'),
  3, '036: the club owner is notified of all three joins');
-- 7.10: the admin arm. e1 joined first, so is notified of b1 and c1 only.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-00000036c002'
      and user_id = '00000000-0000-0000-0000-0000000360e1'),
  2, '036: an `admin`-role member is notified too — the arm no client can reach yet');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-00000036c002'
      and user_id = '00000000-0000-0000-0000-0000000360b1'),
  0, '036: an ORDINARY member is NOT notified of a join');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and user_id = '00000000-0000-0000-0000-0000000360d1'),
  0, '036: a rider outside the club is notified of nothing');

-- ---------------------------------------------------------------------------
-- 7.12d — club_joined DOES reach an owner holding no membership row
-- ---------------------------------------------------------------------------
-- c03's owner (3691) holds no club_members row. The union is safe for THIS type
-- because `clubs` SELECT carries an `owner_id = auth.uid()` arm, so the row
-- resolves for them. Asserted together with 7.12c below: either one alone reads
-- as an inconsistency rather than as a deliberate asymmetry.
select assert_eq(
  (select count(*)::int from club_members
    where club_id = '00000000-0000-0000-0000-00000036c003'
      and user_id = '00000000-0000-0000-0000-000000036091'),
  0, '036: the c03 fixture really is an OWNERLESS owner — no membership row');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-00000036c003'
      and user_id = '00000000-0000-0000-0000-000000036091'),
  2, '036: club_joined reaches an ownerless owner, because clubs SELECT has an owner arm');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000036091', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-00000036c003'),
  2, '036: ... and they can READ both, which is what makes the union safe here');
reset role;
select set_config('test.uid', '', false);

-- ---------------------------------------------------------------------------
-- 7.12c — ride_created_in_club DOES reach an ownerless owner since 060, and
--         the history of this block is the whole lesson
-- ---------------------------------------------------------------------------
-- ** THE EXPECTED VALUE BELOW HAS BEEN INVERTED TWICE AND IS NOW A POSITIVE. **
-- 036 §7.5 withheld `clubs.owner_id` from this fan-out, and was right to: until
-- 054, `rides` SELECT's only club arm was private.is_club_member(club_id),
-- whose body had no owner arm — so a row written to an ownerless owner was one
-- their own SELECT policy dropped on every read, for ever. 054 gave that
-- predicate an owner arm, which made the owner able to read the ride (asserted
-- below) and turned the narrowing from a consequence into a gap. 060 closes it.
--
-- ** 060 DID NOT SIMPLY ADD THE OWNER ARM. ** It unions the owner in and then
-- filters every candidate through private.can_read_ride(candidate, ride), so
-- the recipient set is now MEASURED against the read policy rather than derived
-- from a claim about another function's body. That distinction is the point of
-- PD-211: the claim 036 §7.5 encoded was true when written and false eighteen
-- migrations later, with nothing anywhere to notice. Were 054 ever reverted,
-- this fan-out would narrow again by itself and this assertion would fail
-- honestly instead of accumulating unreadable rows.
--
-- The caller-relative helper is still NOT reachable from a fan-out — 036 trap
-- (c) is untouched. 060 split its body into
-- private.is_club_member_for(candidate, club) so the subject-taking reading and
-- the caller-relative one cannot drift; is_club_member(uuid) is now a wrapper
-- over it, with the same signature, OID and grants.
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-00000036d001', 'N36 Private Club Run', 'The Bridge',
   now() + interval '3 days', false, '00000000-0000-0000-0000-00000036c001', '00000000-0000-0000-0000-0000000360a1'),
  ('00000000-0000-0000-0000-00000036d002', 'N36 Solo Run', 'The Pier',
   now() + interval '4 days', true, null, '00000000-0000-0000-0000-0000000360a1'),
  ('00000000-0000-0000-0000-00000036d003', 'N36 Quiet Club Run', 'The Cafe',
   now() + interval '5 days', false, '00000000-0000-0000-0000-00000036c004', '00000000-0000-0000-0000-0000000360a1'),
  ('00000000-0000-0000-0000-00000036d004', 'N36 Ownerless Club Run', 'The Wall',
   now() + interval '6 days', false, '00000000-0000-0000-0000-00000036c003', '00000000-0000-0000-0000-0000000360b1');

select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d004'
      and user_id = '00000000-0000-0000-0000-000000036091'),
  1, '060: ride_created_in_club DOES reach an ownerless owner — was 0 under 036 §7.5, whose justification 054 voided. The owner arrives through the union AND through can_read_ride, so this is a measurement of their read policy rather than a claim about it');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d004'
      and user_id = '00000000-0000-0000-0000-0000000360c1'),
  1, '036: ... while the club''s actual members are notified');

-- The read the narrowing used to track, and now the reason it is gone. It is
-- asserted here, in 036's own section, rather than only in 054's, because this
-- is the assertion whose EXPECTED VALUE 054 inverted — and an inverted
-- expectation left un-relabelled is indistinguishable from a regression to the
-- next reader.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000036091', false);
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-00000036d004'),
  1, '036/054: an ownerless owner CAN see their own private club''s ride — was 0 until 054 gave is_club_member an owner arm, which is what makes 060''s owner arm safe rather than a source of unreadable rows');
-- ** AND THEY CAN READ THE ROW, WHICH IS THE ASSERTION 036 §7.5 WOULD HAVE
-- WANTED. ** Counting rows written cannot see the failure this whole class is
-- about: an unreadable row exists and is counted. Only a read as the recipient
-- distinguishes "notified" from "written a row nobody can ever read".
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d004'
      and user_id = '00000000-0000-0000-0000-000000036091'),
  1, '060: ... and the ownerless owner READS the row written to them — 036 §3 conjunct 4 resolves the ride for them, which is the only thing that makes the owner arm a repair rather than a second instance of §7.5''s hazard');
reset role;
select set_config('test.uid', '', false);

-- A ride with no club addresses nobody, and a public ride is not fanned out to
-- every signed-in rider.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d002'),
  0, '036: a ride with club_id NULL notifies nobody, and its creation still succeeds');

-- The organizer is excluded by rider id rather than by role.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d001'
      and user_id = '00000000-0000-0000-0000-0000000360a1'),
  0, '036: the ride''s organizer is not notified of their own ride');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d001'),
  3, '036: ... and every other member of that club is');

-- ---------------------------------------------------------------------------
-- 7.4 / 7.7 — ride_joined reaches the organizer, and an UPDATE is not an event
-- ---------------------------------------------------------------------------
-- ** 055 WIDENED THIS TYPE TO THE WHOLE CREW. ** Every count in this block still
-- reads what it did under 036, and that is a property of the fixture rather than
-- of the fan-out: d002's only crew members are its organizer and the actor, so
-- the widened set and the organizer-only set coincide here. The block is left in
-- place because what it asserts — the organizer is reached, an UPDATE is not an
-- event, a rejoin does not stack — all still holds. The one label that claimed
-- the NARROWNESS is corrected below; the crew set itself is asserted in §055,
-- against a fixture with four distinct recipients, which is the only shape that
-- can tell the two apart.
-- ** Every count below is scoped to THIS section's own ride. ** seed.sql's own
-- RSVPs, likes and comments fire these same triggers when the fixtures load, so
-- an unscoped `where type = 'ride_joined'` counts rows this section did not
-- write — which is how an assertion stops testing its own intent. Measured:
-- unscoped, this first one reads 2 against a perfectly correct fan-out.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-00000036d002', '00000000-0000-0000-0000-0000000360a1', 'going');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-00000036d002'),
  0, '036: the organizer RSVPing to their own ride notifies nobody');

insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-00000036d002', '00000000-0000-0000-0000-0000000360b1', 'going');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-00000036d002'
      and user_id = '00000000-0000-0000-0000-0000000360a1'),
  1, '036: an RSVP notifies the ride''s organizer');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-00000036d002'),
  1, '036/055: ... and nobody else HERE — not because the set is organizer-only, which 055 widened, but because d002''s only other crew member IS the organizer. The crew set is asserted in §055 against four distinct recipients');

update ride_members set status = 'maybe'
 where ride_id = '00000000-0000-0000-0000-00000036d002'
   and user_id = '00000000-0000-0000-0000-0000000360b1';
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-00000036d002'),
  1, '036: changing an RSVP going<->maybe writes nothing — the fan-out is on INSERT');

-- Leaving and rejoining does not re-notify: the uniqueness index catches it.
delete from ride_members
 where ride_id = '00000000-0000-0000-0000-00000036d002'
   and user_id = '00000000-0000-0000-0000-0000000360b1';
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-00000036d002', '00000000-0000-0000-0000-0000000360b1', 'going');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-00000036d002'),
  1, '036: leaving and rejoining a ride does not tell the organizer twice');

-- ---------------------------------------------------------------------------
-- 7.4 / 7.8 / 7.12g — likes, comments, and the retraction
-- ---------------------------------------------------------------------------
insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-00000036e001', '00000000-0000-0000-0000-0000000360a1', null,
   'postcards/00000000-0000-0000-0000-0000000360a1/aaaaaaaa-0000-4000-8000-00000036e001.jpg',
   'A postcard the 036 section owns'),
  ('00000000-0000-0000-0000-00000036e002', '00000000-0000-0000-0000-0000000360a1', null,
   'postcards/00000000-0000-0000-0000-0000000360a1/aaaaaaaa-0000-4000-8000-00000036e002.jpg',
   'A second one, for the ghost actor');

insert into postcard_likes (postcard_id, user_id) values
  ('00000000-0000-0000-0000-00000036e001', '00000000-0000-0000-0000-0000000360a1');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and postcard_id = '00000000-0000-0000-0000-00000036e001'),
  0, '036: liking your own postcard notifies nobody');
delete from postcard_likes
 where postcard_id = '00000000-0000-0000-0000-00000036e001'
   and user_id = '00000000-0000-0000-0000-0000000360a1';

insert into postcard_comments (id, postcard_id, author_id, body) values
  ('00000000-0000-0000-0000-00000036cc01', '00000000-0000-0000-0000-00000036e001',
   '00000000-0000-0000-0000-0000000360a1', 'commenting on my own postcard');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_commented' and postcard_id = '00000000-0000-0000-0000-00000036e001'),
  0, '036: commenting on your own postcard notifies nobody');

-- Two actors like the same postcard. This is the pair 7.12g needs: a one-actor
-- assertion literally cannot fail.
insert into postcard_likes (postcard_id, user_id) values
  ('00000000-0000-0000-0000-00000036e001', '00000000-0000-0000-0000-0000000360b1'),
  ('00000000-0000-0000-0000-00000036e001', '00000000-0000-0000-0000-0000000360c1');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and postcard_id = '00000000-0000-0000-0000-00000036e001'),
  2, '036: two riders liking one postcard produce two rows — actor_id is in the key');

-- ** The retraction, scoped by the FULL key. ** Scoped by type + postcard_id
-- alone, this delete would take c1's row as well — a write one rider can aim at
-- another rider's row, in the one table no rider may write to at all.
delete from postcard_likes
 where postcard_id = '00000000-0000-0000-0000-00000036e001'
   and user_id = '00000000-0000-0000-0000-0000000360b1';
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and postcard_id = '00000000-0000-0000-0000-00000036e001'
      and actor_id = '00000000-0000-0000-0000-0000000360b1'),
  0, '036: unliking retracts the actor''s own notification');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and postcard_id = '00000000-0000-0000-0000-00000036e001'
      and actor_id = '00000000-0000-0000-0000-0000000360c1'),
  1, '036: ... and NOT another rider''s row for the same postcard — the full-key scope');

-- 7.8: the assertion that catches a unique index written without NULLS NOT
-- DISTINCT. Without it the constraint never fires and this reads 2, then 3, ...
insert into postcard_likes (postcard_id, user_id) values
  ('00000000-0000-0000-0000-00000036e001', '00000000-0000-0000-0000-0000000360b1');
delete from postcard_likes
 where postcard_id = '00000000-0000-0000-0000-00000036e001'
   and user_id = '00000000-0000-0000-0000-0000000360b1';
insert into postcard_likes (postcard_id, user_id) values
  ('00000000-0000-0000-0000-00000036e001', '00000000-0000-0000-0000-0000000360b1');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and postcard_id = '00000000-0000-0000-0000-00000036e001'
      and actor_id = '00000000-0000-0000-0000-0000000360b1'),
  1, '036: like, unlike, like again leaves exactly ONE row (NULLS NOT DISTINCT)');
select assert_eq(
  (select indnullsnotdistinct from pg_index
    where indexrelid = 'notifications_event_key'::regclass),
  true, '036: ... and the index really is NULLS NOT DISTINCT, not merely behaving');

-- Two comments from one rider produce TWO rows: the subject of a comment
-- notification is the comment, and the recipient has two things to read.
insert into postcard_comments (id, postcard_id, author_id, body) values
  ('00000000-0000-0000-0000-00000036cc02', '00000000-0000-0000-0000-00000036e001',
   '00000000-0000-0000-0000-0000000360b1', 'first comment'),
  ('00000000-0000-0000-0000-00000036cc03', '00000000-0000-0000-0000-00000036e001',
   '00000000-0000-0000-0000-0000000360b1', 'second comment');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_commented' and postcard_id = '00000000-0000-0000-0000-00000036e001'),
  2, '036: two comments from one rider produce two notifications — they do not collapse');

-- The ghost's single row, for 7.12f.
insert into postcard_likes (postcard_id, user_id) values
  ('00000000-0000-0000-0000-00000036e002', '00000000-0000-0000-0000-000000036021');

-- ---------------------------------------------------------------------------
-- 7.12b — THE SUBSET RULE: every row the fan-out wrote can be READ BACK by the
--      rider it was written for
-- ---------------------------------------------------------------------------
-- ** This is the assertion that catches the class of bug, and the draft of this
-- change shipped an instance of it. ** The recipient set and the SELECT policy
-- are written in different files by different reasoning, and a widening on one
-- side is invisible from the other. An assertion that only counts rows WRITTEN
-- cannot see the failure, because the whole failure is a row that exists and is
-- unreadable — nothing raises, no count moves.
--
-- Derived over every row in the table rather than per type by hand, so a sixth
-- type added later is covered without anyone remembering to extend this.
--
-- ** IT MUST RUN BEFORE ANY DELIBERATE EVICTION, AND THAT ORDERING IS PART OF
-- THE ASSERTION. ** The rule is that a fan-out never writes a row unreadable
-- AT THE MOMENT IT IS WRITTEN. Every eviction scenario below — leaving a club,
-- a block, a nulled username — makes a row correctly unreadable later, which is
-- the feature rather than the bug. Run after them, this reads one short and
-- points at a perfectly correct row: measured, when the "leaving retracts
-- nothing" block sat above this one, it flagged n36leaver's c004 ride row after
-- n36leaver had left c004 on purpose. Anything that evicts belongs below.
-- ** The truth is captured as the TABLE OWNER and the reading is done as
-- `authenticated`, and getting that backwards makes the assertion vacuous. **
-- Run wholly as the owner, RLS does not apply, every iteration counts every row,
-- and the sum is recipients x total — measured here as 240 against a true 30,
-- which passes for nothing and fails for the wrong reason. Run wholly as
-- `authenticated`, the recipient LIST is itself filtered by the policy under
-- test, so the loop only ever visits riders who can already see something.
reset role;
create temp table n036_truth as
  select (select count(*)::int from public.notifications) as total;
create temp table n036_recipients as
  select distinct user_id from public.notifications;
grant select on n036_truth, n036_recipients to authenticated;

set role authenticated;
do $$
declare
  total    integer;
  readable integer := 0;
  n        integer;
  r        record;
begin
  select t.total into total from n036_truth t;

  for r in select rr.user_id from n036_recipients rr loop
    perform set_config('test.uid', r.user_id::text, false);
    select count(*)::int into n from public.notifications;
    readable := readable + n;
  end loop;

  perform set_config('test.uid', '', false);
  perform assert_eq(readable, total,
    '036: every row the fan-out wrote is readable by its recipient — the fan-out set is a SUBSET of the read set');
end $$;
reset role;
select set_config('test.uid', '', false);
drop table n036_truth;
drop table n036_recipients;

-- ---------------------------------------------------------------------------
-- 7.12k — leaving retracts NOTHING, and the absence of a retraction is a
--      decision rather than a forgotten trigger
-- ---------------------------------------------------------------------------
-- The row records an EVENT AT AN INSTANT, not a standing claim about the
-- present. postcard_unliked is the deliberate exception, on a harassment
-- argument rather than a truthfulness one.
delete from ride_members
 where ride_id = '00000000-0000-0000-0000-00000036d002'
   and user_id = '00000000-0000-0000-0000-0000000360b1';
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-00000036d002'),
  1, '036: leaving a ride retracts nothing — no AFTER DELETE trigger on ride_members');

delete from club_members
 where club_id = '00000000-0000-0000-0000-00000036c004'
   and user_id = '00000000-0000-0000-0000-0000000360f1';
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-00000036c004'),
  1, '036: leaving a club retracts nothing either — the join really happened');

-- ---------------------------------------------------------------------------
-- 7.3 — the recipient, and nobody else
-- ---------------------------------------------------------------------------
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and postcard_id = '00000000-0000-0000-0000-00000036e001'),
  2, '036: the postcard''s author reads the notifications about it');

-- The ACTOR learns nothing: not that the row exists, not that it was delivered.
select set_config('test.uid', '00000000-0000-0000-0000-0000000360b1', false);
select assert_eq(
  (select count(*)::int from notifications
    where actor_id = '00000000-0000-0000-0000-0000000360b1'),
  0, '036: the actor cannot see a single row their own action caused');

-- A third rider, by any filter including a known row id.
select set_config('test.uid', '00000000-0000-0000-0000-0000000360d1', false);
select assert_eq(
  (select count(*)::int from notifications),
  0, '036: an unrelated rider reads nothing at all');
select assert_eq(
  (select count(*)::int from notifications
    where postcard_id = '00000000-0000-0000-0000-00000036e001'),
  0, '036: ... including by a known subject id');

-- The postcard's author cannot enumerate who ELSE was notified — the count of
-- riders notified must not be derivable from any read they can issue.
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications
    where user_id <> '00000000-0000-0000-0000-0000000360a1'),
  0, '036: owning the subject grants no read on rows addressed to other riders');

-- ---------------------------------------------------------------------------
-- 7.2 — the grants, named as a ROLE rather than attempted
-- ---------------------------------------------------------------------------
-- ** The suite runs as the TABLE OWNER, for whom neither the grant nor RLS
-- applies. ** So an attempted insert would SUCCEED and prove the exact opposite
-- of what it claims. This is 031's lesson and the precise shape of the bug 029
-- shipped: assert the privilege OF the role, never FROM it.
reset role;
select assert_eq(
  has_table_privilege('authenticated', 'public.notifications', 'insert'),
  false, '036: `authenticated` holds NO INSERT grant — the absent grant is what makes the trigger the only writer');
select assert_eq(
  has_table_privilege('authenticated', 'public.notifications', 'delete'),
  false, '036: ... and no DELETE grant — a rider cannot delete the evidence they were told something');
select assert_eq(
  has_table_privilege('authenticated', 'public.notifications', 'select'),
  true, '036: ... but does hold SELECT, or the screen renders nothing');
select assert_eq(
  has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update'),
  true, '036: read_at is writable by its own recipient');
select assert_eq(
  has_column_privilege('authenticated', 'public.notifications', 'type', 'update'),
  false, '036: ... and `type` is not — the column grant refuses it before any policy is consulted');
select assert_eq(
  has_column_privilege('authenticated', 'public.notifications', 'actor_id', 'update'),
  false, '036: ... nor actor_id, so a rider cannot re-address a row to another actor');
select assert_eq(
  has_column_privilege('authenticated', 'public.notifications', 'created_at', 'update'),
  false, '036: ... nor created_at, so ordering never depends on a rider');
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where table_name = 'notifications' and grantee = 'anon'),
  0, '036: anon holds nothing on notifications — decision #1');

-- The fan-out functions are reachable by no client role. Naming the role again,
-- for the same reason, and including service_role because 031 granted it USAGE
-- on `private` and every helper there keeps its own revoke.
select assert_eq(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and (p.proname like 'notify\_%' or p.proname = 'retract_postcard_liked')
      and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute'))),
  0, '036: no client role can call any of the six fan-out functions directly');
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'private'::regnamespace
      and (proname like 'notify\_%' or proname = 'retract_postcard_liked')),
  6, '036: ... and there are six of them, so that assertion is not vacuous');

-- ---------------------------------------------------------------------------
-- 7.5 — blocking, applied TWICE, with A and B exchanged
-- ---------------------------------------------------------------------------
-- The two checks answer different questions and neither implies the other.
-- Fan-out asks "is this blocked now"; the policy asks it again at a LATER now,
-- which is the case a fan-out-only design fails silently.

-- (i) A block created AFTER the row hides it. b1 already has rows addressed to
--     a1; a1 blocks b1.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications where actor_id = '00000000-0000-0000-0000-0000000360b1'),
  6, '036: before the block, a1 reads every row b1 caused — two club joins, a like, two comments and an RSVP');

reset role;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000360a1', '00000000-0000-0000-0000-0000000360b1');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications where actor_id = '00000000-0000-0000-0000-0000000360b1'),
  0, '036: a block created AFTER the rows hides every one of them');
-- ... and the count falls with the list, in the same instant, because both read
-- through the same policy.
select assert_eq(
  (select count(*)::int from notifications),
  (select unread_notification_count()),
  '036: the unread count falls with the list — same policy, one instant');
-- Blocking does not retract notifications about THIRD parties, and no gap,
-- count or marker indicates that anything was removed.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and actor_id = '00000000-0000-0000-0000-0000000360c1'),
  1, '036: a block retracts nothing about a third rider, on the same postcard');

-- Unblocking RESTORES rather than resurrecting: nothing deleted the rows.
reset role;
delete from blocks
 where blocker_id = '00000000-0000-0000-0000-0000000360a1'
   and blocked_id = '00000000-0000-0000-0000-0000000360b1';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications where actor_id = '00000000-0000-0000-0000-0000000360b1'),
  6, '036: unblocking returns the rows — eviction, never deletion');

-- (ii) The SAME thing with A and B exchanged, because the row is directional and
--      the effect symmetric. This time the ACTOR blocks the RECIPIENT.
reset role;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000360b1', '00000000-0000-0000-0000-0000000360a1');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications where actor_id = '00000000-0000-0000-0000-0000000360b1'),
  0, '036: the block hides them with A and B exchanged — one directional row, symmetric effect');
reset role;
delete from blocks
 where blocker_id = '00000000-0000-0000-0000-0000000360b1'
   and blocked_id = '00000000-0000-0000-0000-0000000360a1';

-- (iii) A block existing BEFORE the action writes no row at all, while the
--       rider's own write still succeeds — the block suppresses the
--       notification, not the action.
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000360d1', '00000000-0000-0000-0000-0000000360a1');
insert into postcard_likes (postcard_id, user_id) values
  ('00000000-0000-0000-0000-00000036e001', '00000000-0000-0000-0000-0000000360d1');
select assert_eq(
  (select count(*)::int from postcard_likes
    where postcard_id = '00000000-0000-0000-0000-00000036e001'
      and user_id = '00000000-0000-0000-0000-0000000360d1'),
  1, '036: a blocked rider''s like still succeeds ...');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and actor_id = '00000000-0000-0000-0000-0000000360d1'),
  0, '036: ... and writes no notification at all — blocking is applied at fan-out too');
delete from postcard_likes
 where postcard_id = '00000000-0000-0000-0000-00000036e001'
   and user_id = '00000000-0000-0000-0000-0000000360d1';
delete from blocks
 where blocker_id = '00000000-0000-0000-0000-0000000360d1'
   and blocked_id = '00000000-0000-0000-0000-0000000360a1';

-- ---------------------------------------------------------------------------
-- 7.6 — the resolvability conjunct, isolated: PRIVATE evicts, PUBLIC does not
-- ---------------------------------------------------------------------------
-- Two separate assertions on purpose. One cannot say WHICH arm of the clubs
-- policy did the work, and the pair is what proves the conjunct is load-bearing
-- rather than incidentally satisfied.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360f1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and club_id = '00000000-0000-0000-0000-00000036c001'),
  1, '036: the leaver holds a private club''s ride notification while still a member');

reset role;
delete from club_members
 where club_id = '00000000-0000-0000-0000-00000036c001'
   and user_id = '00000000-0000-0000-0000-0000000360f1';

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360f1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and club_id = '00000000-0000-0000-0000-00000036c001'),
  0, '036: leaving a PRIVATE club evicts its notifications — the row survives, the read does not');

-- The other arm, asserted separately because a single assertion cannot say
-- WHICH arm of the clubs policy did the work. Same rider, same action, same
-- type — only the club's `is_public` differs.
reset role;
delete from club_members
 where club_id = '00000000-0000-0000-0000-00000036c005'
   and user_id = '00000000-0000-0000-0000-0000000360f1';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360f1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-00000036c005'),
  1, '036: leaving a PUBLIC club does NOT evict — clubs SELECT admits any signed-in rider');

-- Nothing deleted the evicted row: rejoining brings it back, unchanged.
reset role;
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c001', '00000000-0000-0000-0000-0000000360f1', 'member');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360f1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and club_id = '00000000-0000-0000-0000-00000036c001'),
  1, '036: rejoining returns the evicted row — a rider''s history is not destroyed by leaving');

-- ---------------------------------------------------------------------------
-- 7.12e — the two-conjunct case, which is the leak a one-table-per-type
--      conjunct would open
-- ---------------------------------------------------------------------------
-- A PUBLIC club, a ride whose is_public is false, and a reader who has left the
-- club. The CLUB resolves and the RIDE does not, so naming only `clubs` for this
-- type would render "created a ride in <club>" for a ride the rider cannot open.
reset role;
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c004', '00000000-0000-0000-0000-0000000360d1', 'member');
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-00000036d005', 'N36 Two Conjunct Run', 'The Gate',
   now() + interval '7 days', false, '00000000-0000-0000-0000-00000036c004', '00000000-0000-0000-0000-0000000360a1');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360d1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d005'),
  1, '036: a member reads the club-ride notification');

reset role;
delete from club_members
 where club_id = '00000000-0000-0000-0000-00000036c004'
   and user_id = '00000000-0000-0000-0000-0000000360d1';

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360d1', false);
select assert_eq(
  (select count(*)::int from clubs where id = '00000000-0000-0000-0000-00000036c004'),
  1, '036: after leaving, the PUBLIC club still resolves ...');
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-00000036d005'),
  0, '036: ... and the non-public ride does NOT ...');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d005'),
  0, '036: ... so the row is not returned — both conjuncts are required, not either');

-- ---------------------------------------------------------------------------
-- 7.12j — an organizer flipping rides.is_public is a SECOND, independent
--      retraction path
-- ---------------------------------------------------------------------------
-- Separate from the club-turned-private case, which reaches the same outcome by
-- a different column on a different table. d003 sits in a public club and is
-- already is_public = false; f1 is still a member of c004 having rejoined
-- nothing, so this asserts the member/leaver split directly.
reset role;
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000036c004', '00000000-0000-0000-0000-0000000360f1', 'member')
  on conflict do nothing;
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-00000036d006', 'N36 Public Then Not', 'The Square',
   now() + interval '8 days', true, '00000000-0000-0000-0000-00000036c004', '00000000-0000-0000-0000-0000000360a1');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360f1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d006'),
  1, '036: a club member holds the notification for a public club ride');

reset role;
update rides set is_public = false where id = '00000000-0000-0000-0000-00000036d006';

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360f1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d006'),
  1, '036: a member still in the club KEEPS it — the club-member arm never consults is_public');

reset role;
delete from club_members
 where club_id = '00000000-0000-0000-0000-00000036c004'
   and user_id = '00000000-0000-0000-0000-0000000360f1';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360f1', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d006'),
  0, '036: ... and one who has since LEFT loses it — neither arm of rides SELECT admits them');

-- ---------------------------------------------------------------------------
-- 7.12i — hiding your own postcard retracts NOTHING
-- ---------------------------------------------------------------------------
-- An earlier revision of this scenario was titled the other way round and a
-- suite written from that title cannot pass. The recipient of these rows is by
-- construction the postcard's AUTHOR, and `postcards` SELECT's first arm is
-- `author_id = auth.uid()`, ahead of the hide predicate — so a hide is an input
-- to the OTHER arm only. It is the ordering of those arms that makes this come
-- out this way, which is exactly why it is asserted rather than inferred.
reset role;
insert into postcard_hides (postcard_id, user_id) values
  ('00000000-0000-0000-0000-00000036e001', '00000000-0000-0000-0000-0000000360a1');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000036e001'),
  1, '036: the author still sees their own hidden postcard — the own-row arm is first');
select assert_eq(
  (select count(*)::int from notifications
    where postcard_id = '00000000-0000-0000-0000-00000036e001'
      and type in ('postcard_liked', 'postcard_commented')),
  4, '036: ... and hiding it retracts none of its like or comment notifications');
reset role;
delete from postcard_hides
 where postcard_id = '00000000-0000-0000-0000-00000036e001'
   and user_id = '00000000-0000-0000-0000-0000000360a1';

-- ---------------------------------------------------------------------------
-- 7.12f — the ACTOR conjunct, with NO block anywhere in sight
-- ---------------------------------------------------------------------------
-- ** The `profiles` EXISTS is not redundant with the block conjunct. ** A NULL
-- username drops a row out of `profiles` SELECT on its own, with nothing to do
-- with blocking, and without the conjunct the notification is counted and cannot
-- be drawn.
--
-- ** This used to be done as the ghost THEMSELVES, through RLS, and 038 closed
-- that route. ** The comment here read "any rider can null their own username in
-- ONE request — the column grant is live, the CHECK admits NULL, and
-- enforce_onboarding_completion returns early for an already-onboarded rider
-- before it reaches the column", which was true and was the live defect PD-127
-- fixed. The rider's attempt is kept below and is now asserted to be COERCED,
-- because deleting it would lose the one place this suite shows 038's rule
-- reaching a surface other than `profiles` itself. The eviction the notifications
-- policy is really being tested for is then produced as the table owner, which
-- the trigger's `current_user <> 'authenticated'` gate deliberately still
-- permits — so what changed is who can reach the state, never whether the
-- conjunct works.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications
    where postcard_id = '00000000-0000-0000-0000-00000036e002'),
  1, '036: the author holds the ghost''s one notification');

select set_config('test.uid', '00000000-0000-0000-0000-000000036021', false);
update profiles set username = null where id = '00000000-0000-0000-0000-000000036021';
select assert_eq((select username from profiles where id = auth.uid()),
  'n36ghost', '036/038: the ghost can no longer null their own username — the row stays in profiles');

select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications
    where postcard_id = '00000000-0000-0000-0000-00000036e002'),
  1, '036/038: ... so the notification survives an attempt that used to evict it');

reset role;
update profiles set username = null where id = '00000000-0000-0000-0000-000000036021';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications
    where postcard_id = '00000000-0000-0000-0000-00000036e002'),
  0, '036: an actor whose username is NULL evicts the row — no block involved');
select assert_eq(
  (select count(*)::int from notifications),
  (select unread_notification_count()),
  '036: ... and the count falls with the list, so the badge never outlives the screen');

-- Eviction, not deletion: restoring the username returns the row with its
-- original created_at and read state. Restored as the table owner, because the
-- point being made here is about the ROW rather than about who may write the
-- username — that half is asserted above, through RLS, as the ghost themselves.
reset role;
update profiles set username = 'n36ghost' where id = '00000000-0000-0000-0000-000000036021';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
select assert_eq(
  (select count(*)::int from notifications
    where postcard_id = '00000000-0000-0000-0000-00000036e002' and read_at is null),
  1, '036: restoring the username returns the row, still unread — eviction, never deletion');

-- ---------------------------------------------------------------------------
-- 7.12h — mark-all-read touches EXACTLY the rows the count reported
-- ---------------------------------------------------------------------------
-- ** The UPDATE policy's predicate is the SELECT policy's, and this is what
-- makes that observable. ** Under a wider UPDATE policy — `user_id = auth.uid()`
-- alone, so that "mark all read" also clears evicted rows — this statement would
-- touch rows SELECT hides, and the difference between the two numbers is the
-- count of hidden rows. The commonest reason a row is hidden is a block, which
-- must never be disclosed by any gap, count or marker.
--
-- Compared against unread_notification_count() taken immediately before, rather
-- than by inspecting the table as the owner, for whom the policy does not apply.
reset role;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000360a1', '00000000-0000-0000-0000-0000000360c1');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000360a1', false);
create temp table n036_markread as
  select unread_notification_count() as before_count;

with marked as (
  update notifications set read_at = now()
   where read_at is null
  returning 1
)
update n036_markread set before_count = before_count
  from (select count(*)::int as affected from marked) m;

-- The two numbers have to be captured in one statement or the comparison is
-- against a moving target, so the affected count is recomputed as "rows now
-- read that the policy returns" and checked against the count taken before.
select assert_eq(
  (select before_count from n036_markread),
  (select count(*)::int from notifications where read_at is not null),
  '036: mark-all-read affected exactly the rows the unread count reported — UPDATE is no wider than SELECT');
select assert_eq(
  (select unread_notification_count()),
  0, '036: ... and the badge is clear afterwards');

-- The evicted row was NOT touched, so no arithmetic on the response reveals it.
reset role;
-- Written as "every one of them" rather than as a hard number, so it states its
-- own intent and cannot drift when a fixture is added: whatever the blocked
-- actor caused, none of it was reachable by the update.
select assert_eq(
  (select count(*)::int from notifications
    where user_id = '00000000-0000-0000-0000-0000000360a1'
      and actor_id = '00000000-0000-0000-0000-0000000360c1'
      and read_at is null),
  (select count(*)::int from notifications
    where user_id = '00000000-0000-0000-0000-0000000360a1'
      and actor_id = '00000000-0000-0000-0000-0000000360c1'),
  '036: every blocked-actor row is still UNREAD — mark-all-read could reach none of them');
delete from blocks
 where blocker_id = '00000000-0000-0000-0000-0000000360a1'
   and blocked_id = '00000000-0000-0000-0000-0000000360c1';
drop table n036_markread;

-- ---------------------------------------------------------------------------
-- 7.7 — every cascade, including the two-level one and the club_id asymmetry
-- ---------------------------------------------------------------------------
-- The retention window IS the cascade window — "as long as the subject exists" —
-- so these are not incidental hygiene assertions. They are the only evidence the
-- retention claim has, which is the property a stated number would not have had.
reset role;
select set_config('test.uid', '', false);

-- A comment: its own notification goes, and the likes on the same postcard stay.
select assert_eq(
  (select count(*)::int from notifications
    where comment_id = '00000000-0000-0000-0000-00000036cc02'),
  1, '036: the comment notification exists before its comment is deleted');
delete from postcard_comments where id = '00000000-0000-0000-0000-00000036cc02';
select assert_eq(
  (select count(*)::int from notifications
    where comment_id = '00000000-0000-0000-0000-00000036cc02'),
  0, '036: deleting a comment destroys its notification');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'postcard_liked' and postcard_id = '00000000-0000-0000-0000-00000036e001'),
  2, '036: ... and leaves the likes on the same postcard alone');

-- A club, which is the asymmetry worth asserting explicitly: rides.club_id is
-- ON DELETE SET NULL while notifications.club_id is ON DELETE CASCADE, so the
-- RIDE survives and the notification does not. "Created a ride in <club>" is
-- unrenderable once the club is gone.
-- Asserted as "some exist" rather than as a hard number. The exact count is a
-- function of every join and ride c004 accumulated across the scenarios above,
-- so a literal here would have to be recomputed by hand every time one of them
-- gains a fixture — and a number maintained that way is one that eventually gets
-- "corrected" to whatever the code now produces. What this step needs is only
-- that the cascade has something to destroy.
select assert_eq(
  (select count(*) > 0 from notifications
    where club_id = '00000000-0000-0000-0000-00000036c004'),
  true, '036: c004 has notifications to lose before the club is deleted');
delete from clubs where id = '00000000-0000-0000-0000-00000036c004';
select assert_eq(
  (select count(*)::int from notifications
    where club_id = '00000000-0000-0000-0000-00000036c004'),
  0, '036: deleting a club destroys its notifications ...');
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-00000036d005'),
  1, '036: ... while the ride itself SURVIVES with club_id NULL — the two FKs disagree, deliberately');

-- A postcard: every like and comment notification naming it goes.
delete from postcards where id = '00000000-0000-0000-0000-00000036e001';
select assert_eq(
  (select count(*)::int from notifications
    where postcard_id = '00000000-0000-0000-0000-00000036e001'),
  0, '036: deleting a postcard destroys every notification naming it');

-- ** The two-level cascade, which is invisible in any single foreign key. **
-- Deleting an ORGANIZER removes their rides (rides.organizer_id is ON DELETE
-- CASCADE), and every notification about those rides goes with them — including
-- rows delivered to riders who are still perfectly active. Stated as a
-- consequence of the erasure rather than discovered.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d001'),
  3, '036: other riders hold notifications about a01''s club ride');
-- As the table owner, matching the 029 sections above: the harness grants
-- auth_admin only INSERT and SELECT on auth.users, because signup is the only
-- thing that role does in production. Erasure is the Edge Function's
-- service-role path, which no local role stands in for.
delete from auth.users where id = '00000000-0000-0000-0000-0000000360a1';
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-00000036d001'),
  0, '036: deleting the organizer deletes their ride ...');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club' and ride_id = '00000000-0000-0000-0000-00000036d001'),
  0, '036: ... and every other rider''s notification about it goes two levels down with it');

-- The departing rider's own rows, in BOTH directions: to them by the user_id
-- cascade, about them by the actor_id cascade. No tombstone, no "deleted rider"
-- byline, matching the ruling already made for comments and ride messages.
select assert_eq(
  (select count(*)::int from notifications
    where user_id = '00000000-0000-0000-0000-0000000360a1'
       or actor_id = '00000000-0000-0000-0000-0000000360a1'),
  0, '036: a departing rider''s notifications go in BOTH directions — recipient and actor');

-- ---------------------------------------------------------------------------
-- The shape of the thing, asserted so a later edit cannot quietly change it
-- ---------------------------------------------------------------------------
select assert_eq(
  (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  true, '036: row level security is enabled on notifications');

-- Scoped to this table's own policies rather than counting every policy in the
-- schema: an assertion counting a shared surface stops testing its own intent
-- the moment a second surface lands there.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'notifications'),
  2, '036: exactly two policies — SELECT and UPDATE');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and cmd in ('INSERT', 'DELETE')),
  0, '036: ... and neither is an INSERT or a DELETE policy');

-- ** The UPDATE predicate IS the SELECT predicate, in both USING and WITH
-- CHECK. ** Written out three times in the migration, so this is what stops a
-- later edit to one of them drifting: three deparsed expressions, one distinct
-- value.
select assert_eq(
  (select count(distinct e)::int from (
     select qual as e from pg_policies
      where schemaname = 'public' and tablename = 'notifications' and cmd = 'SELECT'
     union all
     select qual from pg_policies
      where schemaname = 'public' and tablename = 'notifications' and cmd = 'UPDATE'
     union all
     select with_check from pg_policies
      where schemaname = 'public' and tablename = 'notifications' and cmd = 'UPDATE'
   ) t),
  1, '036: UPDATE''s predicate is SELECT''s, in USING and WITH CHECK — no write reaches a row no read returns');

-- ** No `when (current_user = ...)` clause on any of the six. ** 023's clause is
-- correct on the participation gate and wrong here: a fan-out must fire for
-- every writer, including the seed this suite runs as. An absent guard is
-- otherwise indistinguishable from a forgotten one, so it is asserted as a flat
-- zero across a set whose size is asserted beside it.
select assert_eq(
  (select count(*)::int from pg_trigger
    where not tgisinternal
      and (tgname like 'notify\_%' or tgname = 'retract_postcard_liked')),
  6, '036: six fan-out triggers exist');
select assert_eq(
  (select count(*)::int from pg_trigger
    where not tgisinternal and tgqual is not null
      and (tgname like 'notify\_%' or tgname = 'retract_postcard_liked')),
  0, '036: ... and NOT ONE carries a WHEN clause — 023''s CURRENT_USER guard would never fire here');

-- auth.uid() appears nowhere in a fan-out body, checkable by inspection rather
-- than inferred from behaviour.
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'private'::regnamespace
      and (proname like 'notify\_%' or proname = 'retract_postcard_liked')
      and (prosrc ilike '%auth.uid()%' or prosrc ilike '%current_user%')),
  0, '036: no fan-out body mentions auth.uid() or current_user — the actor comes from NEW');
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'private'::regnamespace
      and (proname like 'notify\_%' or proname = 'retract_postcard_liked')
      and prosecdef and proconfig @> array['search_path=""']),
  6, '036: every fan-out is SECURITY DEFINER with search_path pinned empty');

-- The count must be INVOKER. A definer count steps past the block predicate and
-- every resolvability conjunct, producing a badge the rider can never clear.
select assert_eq(
  (select prosecdef from pg_proc where proname = 'unread_notification_count'),
  false, '036: unread_notification_count is SECURITY INVOKER — the badge cannot disagree with the screen');

-- 7.12l — six FK columns, six usable indexes, DERIVED from pg_index rather than
-- read off the migration's list. `actor_id` sits third in the uniqueness index,
-- where it cannot lead a lookup, so without its own index every account deletion
-- is a sequential scan of every notification in the table.
select assert_eq(
  (select count(*)::int from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.contype = 'f'),
  6, '036: notifications carries six foreign keys');
select assert_eq(
  (select count(*)::int from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.contype = 'f'
      and not exists (select 1 from pg_index i
                       where i.indrelid = c.conrelid
                         and i.indkey[0] = c.conkey[1])),
  0, '036: ... and not one of them lacks a leading-column index — every cascade path is indexed');
select assert_eq(
  (select count(*)::int from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.contype = 'f'
      and c.confdeltype = 'c'),
  6, '036: ... and every one is ON DELETE CASCADE — the retention window is the cascade window');

-- The subject CHECK refuses a type it does not know about, which is what makes
-- adding a type without extending it fail at the point of change rather than
-- admitting a row with no subject.
select assert_rejected($$
  insert into notifications (user_id, actor_id, type, postcard_id)
  values ('00000000-0000-0000-0000-0000000360b1', '00000000-0000-0000-0000-0000000360c1',
          'ride_joined', '00000000-0000-0000-0000-00000036e002')$$,
  '23514', '036: a type carrying the wrong subject column is refused by the shape CHECK');

rollback to savepoint notifications_036;

\echo ''
\echo '# A username cannot be removed once it is set (038)'

-- ===========================================================================
-- 038. "Once set, never unset."
-- ===========================================================================
--
-- The defect: `authenticated` holds column UPDATE on `username`, both CHECKs
-- admit NULL by construction, and enforce_onboarding_completion returned early
-- for an already-onboarded rider before reaching any username logic. So
-- `PATCH /rest/v1/profiles?id=eq.<me>` with `{"username": null}` removed the row
-- from every other rider's read — the `profiles` SELECT policy is
-- `(auth.uid() = id) OR (username IS NOT NULL AND NOT private.is_blocked(...))`.
--
-- ** The new rule is asserted as STORED STATE, never as an error code. ** 038
-- coerces rather than raises, matching 012's treatment of `terms_accepted_at` in
-- the same function, so the write returns 200 with the old value intact. An
-- assertion written as assert_rejected(..., '23514', ...) would FAIL against a
-- correct implementation. The assertions below that do name a SQLSTATE are each
-- pinning a refusal that PREDATES this change — the unique index (23505), the
-- format CHECK (23514) and complete_onboarding's own guard.
--
-- ** The load-bearing fixture is an ONBOARDED one. ** A guard placed below the
-- `old.onboarding_completed_at ... return new` early return is dead code for
-- exactly the population it protects, and would still pass a suite that only
-- tested a mid-wizard rider. 3801 is that fixture; 3802 is the mid-wizard case,
-- which is a real second rule rather than a weaker restatement of the first.
--
-- The arms 038 carried forward from 003, 012 and 023 are not re-asserted here —
-- the sections above already cover every one of them (the consent re-pin, the
-- INSERT arms, the completion guard), and they run against the replaced body.
--
-- Self-contained fixtures, like 036 and 037 above: this section runs last and
-- must not depend on what twenty-three sections left behind. The block pair from
-- seed.sql (1a/1b) is reused for the two block assertions, because the block row
-- itself is the fixture and re-seeding it would be a second copy of the same
-- relationship.
--   3801  onboarded, has a username           -- the population the rule protects
--   3802  mid-wizard, has a username          -- "once set", before completion
--   3803  no username, no stamps              -- onboarding step 1 must still work
--   3804  onboarded, someone else's row       -- the cross-rider case
--   3805  consent + username, not completed   -- complete_onboarding must still stamp
--   3806  consent, NO username                -- ... and must still refuse
savepoint username_038;

reset role;
select set_config('test.uid', '', false);

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000038001', 'u38onboarded@example.com'),
  ('00000000-0000-0000-0000-000000038002', 'u38halfway@example.com'),
  ('00000000-0000-0000-0000-000000038003', 'u38fresh@example.com'),
  ('00000000-0000-0000-0000-000000038004', 'u38other@example.com'),
  ('00000000-0000-0000-0000-000000038005', 'u38qualified@example.com'),
  ('00000000-0000-0000-0000-000000038006', 'u38noname@example.com');
reset role;

update profiles set username = 'u38onboarded', location = 'Lisbon', bio = 'before',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000038001';
update profiles set username = 'u38halfway', bio = 'before',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000038002';
update profiles set username = 'u38other', location = 'Faro', bio = 'before',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000038004';
update profiles set username = 'u38qualified', location = 'Aveiro',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000038005';
update profiles set terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000038006';
-- 3803 is left exactly as handle_new_user made it: no username, no stamps.

-- ---------------------------------------------------------------------------
-- 038.1 — the onboarded rider, which is the whole point
-- ---------------------------------------------------------------------------
-- Each of these writes a SECOND column in the same statement and reads it back.
-- An UPDATE filtered to zero rows by RLS does not error, so "the username is
-- unchanged" on its own would pass against a policy that permitted nothing at
-- all — the trap the comment on assert_allowed records. The bio landing is what
-- proves the statement ran and only the username was coerced.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000038001', false);

update profiles set username = null, bio = 'after' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'u38onboarded',
  '038: an ONBOARDED rider cannot null their own username — the arm sits above the completion early return');
select assert_eq((select bio from profiles where id = auth.uid()),
  'after',
  '038: ... and the same statement''s other column DID land, so the write was coerced rather than filtered to zero rows');

-- A rename is untouched: the guard is `coalesce`, so it only ever fires on NULL.
-- Q1 (may a rider rename?) is deliberately left as it was, and this is the
-- assertion that fails if someone later tightens the rule without deciding it.
update profiles set username = 'u38renamed' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'u38renamed', '038: a rename to another valid name still succeeds — the guard is NULL-only, and Q1 stays open');
update profiles set username = 'u38onboarded' where id = auth.uid();

-- ---------------------------------------------------------------------------
-- 038.2 — the mid-wizard rider, which is a second rule and not a weaker one
-- ---------------------------------------------------------------------------
-- Keyed on `old.username` rather than on `old.onboarding_completed_at`, so a
-- rider who chose a name at step 1 and is sitting on step 2 is covered too. That
-- is the route by which a taken name could otherwise be freed and re-taken.
select set_config('test.uid', '00000000-0000-0000-0000-000000038002', false);

update profiles set username = null, bio = 'after' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'u38halfway',
  '038: a rider MID-WIZARD cannot null a username they have already chosen — the rule keys on old.username, not on completion');
select assert_eq((select bio from profiles where id = auth.uid()),
  'after', '038: ... and that write landed too');

-- The consequence, and it is asserted against the INDEX rather than against the
-- availability check. `isUsernameTaken` reads under the block-aware SELECT
-- policy, so "reads as taken to every other rider" is not a true statement about
-- this database — see 038.3 immediately below.
select set_config('test.uid', '00000000-0000-0000-0000-000000038003', false);
select assert_rejected($$update profiles set username = 'u38halfway'
  where id = '00000000-0000-0000-0000-000000038003'$$,
  '23505',
  '038: the name the mid-wizard rider kept still cannot be taken by anyone else — profiles_username_lower_key, not the availability check');

-- ---------------------------------------------------------------------------
-- 038.3 — the pre-existing asymmetry, pinned so neither half can be "fixed" alone
-- ---------------------------------------------------------------------------
-- 1a blocked 1b. To 1b, 1a's name reads FREE (the SELECT policy hides the row)
-- while taking it is refused by the index. That predates this change and is
-- unaltered by it; 038.2's wording depends on knowing it, so it is asserted
-- rather than described.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from profiles where lower(username) = 'blocker'),
  0, '038: a rider blocked by the holder of a name reads that name as FREE — the availability check runs under the block-aware policy');
select assert_rejected($$update profiles set username = 'blocker'
  where id = '00000000-0000-0000-0000-00000000001b'$$,
  '23505',
  '038: ... while taking it is still refused 23505 — an inference channel that predates 038 and is neither opened nor closed by it');

-- ---------------------------------------------------------------------------
-- 038.4 — the regression this change most plausibly causes
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000038003', false);
savepoint first_username_038;
update profiles set username = 'u38fresh' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'u38fresh', '038: a rider whose username is NULL can still set one — onboarding step 1 is unbroken');
update profiles set username = null where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'u38fresh', '038: ... and from that moment on they cannot remove it — the rule engages on the value, not on a stamp');
rollback to savepoint first_username_038;

-- ---------------------------------------------------------------------------
-- 038.5 — complete_onboarding is security definer, so it never sees this arm
-- ---------------------------------------------------------------------------
-- Inside a security definer function `current_user` is the owner, so the
-- trigger's first gate returns early and the function's own restatement of 003's
-- rule is the enforcement. Both arms, to prove the new code disturbed neither.
select set_config('test.uid', '00000000-0000-0000-0000-000000038005', false);
savepoint complete_038;
select assert_eq(public.complete_onboarding('Nijmegen') is not null,
  true, '038: complete_onboarding() still stamps for a rider who has a username');
select assert_eq((select location from profiles where id = auth.uid()),
  'Nijmegen', '038: ... and still applies the location in the same statement');
rollback to savepoint complete_038;

select set_config('test.uid', '00000000-0000-0000-0000-000000038006', false);
select assert_rejected($$select public.complete_onboarding('Tilburg')$$,
  '23514', '038: ... and still refuses one who does not — that guard lives in the function, not in the trigger');

-- ---------------------------------------------------------------------------
-- 038.6 — the operator escape hatch, which is why this is not a CHECK
-- ---------------------------------------------------------------------------
-- The trigger's `current_user <> 'authenticated'` gate is preserved rather than
-- narrowed, so the table owner, service_role, the seed and the signup trigger
-- still write NULL freely. ** This is the assertion that fails if someone later
-- "tightens" 038 into a CHECK constraint **, which no role can pass and which
-- would leave a rider stranded by any future defect unrepairable.
reset role;
savepoint operator_038;
update profiles set username = null where id = '00000000-0000-0000-0000-000000038001';
select assert_eq((select username from profiles where id = '00000000-0000-0000-0000-000000038001'),
  null::text, '038: the table owner can still null a username — the operator escape hatch survives');
rollback to savepoint operator_038;

-- ---------------------------------------------------------------------------
-- 038.7 — NULL really was the only hole
-- ---------------------------------------------------------------------------
-- Verified against the live constraint rather than assumed: '' does not match
-- '^[A-Za-z0-9_]{3,25}$' (056's charset and 057's length; '^[a-z0-9_]{3,20}$'
-- when 038 was written, and neither widening changes these four), and neither does a
-- value carrying a newline — Postgres's `~` is not anchored to the whole string
-- across newlines unless it is written this way, so the newline case is the one
-- worth stating.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000038003', false);
select assert_rejected($$update profiles set username = ''
  where id = '00000000-0000-0000-0000-000000038003'$$,
  '23514', '038: an empty username is refused 23514 — 003''s CHECK, unchanged');
select assert_rejected($$update profiles set username = '   '
  where id = '00000000-0000-0000-0000-000000038003'$$,
  '23514', '038: ... and a whitespace-only one');
select assert_rejected($$update profiles set username = 'ab'
  where id = '00000000-0000-0000-0000-000000038003'$$,
  '23514', '038: ... and a two-character one');
select assert_rejected($$update profiles set username = E'ok\nname'
  where id = '00000000-0000-0000-0000-000000038003'$$,
  '23514', '038: ... and one carrying a newline');

-- ---------------------------------------------------------------------------
-- 038.8 / 042 — deleting the row is the OTHER way to vanish, and it is now shut
-- ---------------------------------------------------------------------------
-- 038 asserted both halves of this door and shut neither: the delete affected
-- zero rows, but only because no DELETE policy existed for a live grant to use.
-- Protection by omission. 042 removes the grant, so the refusal is structural —
-- a future DELETE policy on profiles, added for any unrelated reason, no longer
-- reopens self-erasure on its own.
--
-- ** The grant assertion below is 038's, REPOINTED rather than deleted. ** Its
-- label and its expected value both flipped when 042 applied; deleting it would
-- have removed the only thing watching this grant. The zero-rows assertion above
-- it is 038's, unchanged and still load-bearing: it is the behavioural half, and
-- it must keep passing whichever way the refusal is delivered.
select set_config('test.uid', '00000000-0000-0000-0000-000000038001', false);
savepoint own_delete_038;
-- Wrapped, because 042 changed HOW this is refused and the suite must not care.
-- Before 042 the statement succeeded and touched zero rows; after it, the role
-- has no DELETE privilege at all, so Postgres refuses it outright with 42501
-- before RLS is ever consulted. The row surviving is the assertion — an
-- exception here would abort the transaction and take the rest of the suite with
-- it, so it is caught and swallowed on purpose.
do $$
begin
  delete from profiles where id = auth.uid();
exception when insufficient_privilege then
  null;
end $$;
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-000000038001'),
  1, '038: a rider deleting their OWN profiles row affects zero rows');
rollback to savepoint own_delete_038;

reset role;
select assert_eq(has_table_privilege('authenticated', 'public.profiles', 'delete'),
  false, '042: authenticated holds NO DELETE grant on profiles — the refusal is structural, not the policy''s absence');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'DELETE'),
  0, '038: ... and there is no DELETE policy on profiles for that grant to use');

-- Account deletion must survive 042, and this asserts the MECHANISM rather than
-- a proxy for it. delete-account/index.ts calls `auth.admin.deleteUser(sub)`;
-- nothing anywhere issues `delete from profiles`. The profile row goes because
-- `profiles.id references auth.users(id) on delete cascade` (001), and a
-- referential action does not consult table privileges at all — so revoking a
-- grant cannot reach it. Exercised end to end, not reasoned about.
--
-- ** The obvious assertion here — has_table_privilege('service_role', ...) —
-- cannot be made in THIS suite, and that is a harness property rather than an
-- oversight. ** harness.sql reproduces Supabase's broad default table grants for
-- `anon` and `authenticated` only; `service_role` exists there purely so 031's
-- explicit grants apply, and it deliberately holds nothing by default. So the
-- assertion would read `false` locally against a hosted database where it is
-- `true`, and granting it in the harness first would manufacture the very fact
-- the assertion then "proves". It is verified against the hosted project instead
-- — 042's §Verification item 1, confirmed on letsride-dev after applying.
reset role;
savepoint cascade_042;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000042001', 'pd145-cascade@example.com');
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-000000042001'),
  1, '042: precondition — the signup trigger created a profiles row to cascade');
delete from auth.users where id = '00000000-0000-0000-0000-000000042001';
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-000000042001'),
  0, '042: deleting the auth.users row still reaps the profile — account deletion (029-032) does not use the revoked grant');
rollback to savepoint cascade_042;

-- The revoke named DELETE alone. A table-level `revoke all` here would have
-- silently taken 025's per-column allowlist with it and black-screened every
-- signed-in rider, which no assertion above would have caught.
select assert_eq(has_column_privilege('authenticated', 'public.profiles', 'username', 'select'),
  true, '042: ... and 025''s column grants survive it — select');
select assert_eq(has_column_privilege('authenticated', 'public.profiles', 'username', 'update'),
  true, '042: ... and update, so the revoke was scoped to DELETE and did not become a revoke all');

-- ---------------------------------------------------------------------------
-- 038.9 — another rider's row, and the upsert route into your own
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000038001', false);
update profiles set username = null, bio = 'intruder'
  where id = '00000000-0000-0000-0000-000000038004';
select assert_eq((select username from profiles where id = '00000000-0000-0000-0000-000000038004'),
  'u38other', '038: a rider cannot null ANOTHER rider''s username');
select assert_eq((select bio from profiles where id = '00000000-0000-0000-0000-000000038004'),
  'before',
  '038: ... and nothing else on that row moved either — zero rows affected by the UPDATE policy, not a coerced write');

-- The statement supabase-js sends for `Prefer: resolution=merge-duplicates`.
-- `authenticated` holds INSERT on `username` and an INSERT policy exists, so this
-- is a genuine second client route into the column; that the BEFORE UPDATE
-- trigger fires for the DO UPDATE arm is a two-step derivation nothing else
-- pins. Same class as the `ignoreDuplicates` bug src/lib/actions/profile.ts
-- records, where the suite issued a different statement than production and
-- shipped green.
insert into profiles (id, username, bio)
values ('00000000-0000-0000-0000-000000038001', null, 'upserted')
on conflict (id) do update set username = excluded.username, bio = excluded.bio;
select assert_eq((select username from profiles where id = auth.uid()),
  'u38onboarded',
  '038: the PostgREST upsert is not a second way in — INSERT ... ON CONFLICT DO UPDATE is coerced the same way');
select assert_eq((select bio from profiles where id = auth.uid()),
  'upserted', '038: ... and the upsert itself landed, so that is a coercion and not a refusal');

-- ---------------------------------------------------------------------------
-- 038.10 — this change opens no new channel, and reaches no new role
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000001a'),
  0, '038: a blocked rider still reads zero rows of the blocker''s profile');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from profiles where id = '00000000-0000-0000-0000-00000000001b'),
  0, '038: ... and the blocker still reads zero of theirs — symmetric, unchanged');

reset role;
set role anon;
select assert_denied($$select count(*) from profiles$$,
  '038: anon still reaches nothing on profiles — the function was replaced, so decision #1 is re-proved');
select assert_denied($$update profiles set username = 'anonymous'
  where id = '00000000-0000-0000-0000-000000038001'$$,
  '038: ... and cannot write a username either');
reset role;

-- ---------------------------------------------------------------------------
-- 038.11 — the body itself, named rather than only inferred from behaviour
-- ---------------------------------------------------------------------------
-- A position comparison, not a presence one: "the arm exists" passes just as
-- well when it is dead code below the early return, which is the single most
-- likely way to ship a green useless fix. 038.1 is the behavioural proof; this
-- is the one that says why it failed when it fails.
select assert_eq(
  (select prosrc like '%coalesce(new.username, old.username)%'
     from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc),
  true, '038: the coercion is in the function body');
select assert_eq(
  (select strpos(prosrc, 'coalesce(new.username, old.username)')
        < strpos(prosrc, 'new.onboarding_completed_at := old.onboarding_completed_at')
     from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc),
  true, '038: ... and it sits ABOVE the completion early return, where it is not dead code for an onboarded rider');
select assert_eq(
  (select prosecdef from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc),
  false, '038: the function is still security invoker — as definer its own current_user gate would never fire for anyone');
select assert_eq(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.profiles'::regclass and not tgisinternal and tgattr <> ''),
  0, '038: and neither trigger is column-scoped — one scoped OF username would never fire for a rename');

rollback to savepoint username_038;

\echo ''
\echo '# A postcard''s ride tag is a TAG, never a second audience (041)'

-- Self-contained fixtures, for 034's reasons: this section runs last, so
-- hanging it off seed.sql would inherit whatever the sections above left
-- behind, and it needs shapes seed.sql cannot provide without moving an
-- existing count — an organizer holding NO ride_members row, a club `admin`,
-- and three rides whose audiences differ from each other.
--
-- The riders, and what each one is for:
--   410a1  organizer of ALL THREE rides, and deliberately in NO ride_members
--          row -- so tagging by the host exercises the organizer arm of
--          is_ride_crew rather than the membership arm
--   410b1  crew `going` of the public ride                -- the ordinary case
--   410c1  crew `maybe` of the public ride                -- identical rights
--   410d1  onboarded, CAN see the public rides, never RSVP'd, in no club
--   410e1  crew `going`, and blocks the ORGANIZER
--   410f1  member of the PRIVATE club and crew of its ride, who then leaves
--   4101a  OWNER of the public club, and crew of the UNRELATED public ride
--   4101b  `admin` of the public club, and crew of that club's ride
savepoint ride_tag_041;

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000410a1', 'journalhost@example.com'),
  ('00000000-0000-0000-0000-0000000410b1', 'journalgoing@example.com'),
  ('00000000-0000-0000-0000-0000000410c1', 'journalmaybe@example.com'),
  ('00000000-0000-0000-0000-0000000410d1', 'journaloutside@example.com'),
  ('00000000-0000-0000-0000-0000000410e1', 'journalblocker@example.com'),
  ('00000000-0000-0000-0000-0000000410f1', 'journalleaver@example.com'),
  ('00000000-0000-0000-0000-00000004101a', 'journalclubowner@example.com'),
  ('00000000-0000-0000-0000-00000004101b', 'journalclubadmin@example.com');
reset role;

update profiles set username = 'journalhost',    location = 'Nijmegen',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000410a1';
update profiles set username = 'journalgoing',   location = 'Tilburg',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000410b1';
update profiles set username = 'journalmaybe',   location = 'Venlo',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000410c1';
update profiles set username = 'journaloutside', location = 'Almere',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000410d1';
update profiles set username = 'journalblocker', location = 'Hilversum',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000410e1';
update profiles set username = 'journalleaver',  location = 'Assen',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-0000000410f1';
update profiles set username = 'journalclubowner', location = 'Emmen',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000004101a';
update profiles set username = 'journalclubadmin', location = 'Ede',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-00000004101b';

-- A PRIVATE club and a PUBLIC one, with DIFFERENT owners, so "the owner of the
-- ride's club" and "the author of the postcard" are never the same rider —
-- otherwise 041.10's role assertions would pass through the author branch of
-- the SELECT policy and prove nothing about roles.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000410c9', 'Journal Private MC', false,
   '00000000-0000-0000-0000-0000000410a1'),
  ('00000000-0000-0000-0000-0000000410ca', 'Journal Open MC', true,
   '00000000-0000-0000-0000-00000004101a');
-- The `admin` row is inserted as the TABLE OWNER on purpose: club_members has
-- no UPDATE policy and 019's INSERT arm admits `member` only, so `admin` is
-- unreachable through the client entirely (036's finding, unchanged). Seeding
-- it here is the only way to assert what an admin can reach.
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000410c9', '00000000-0000-0000-0000-0000000410a1', 'owner'),
  ('00000000-0000-0000-0000-0000000410c9', '00000000-0000-0000-0000-0000000410f1', 'member'),
  ('00000000-0000-0000-0000-0000000410ca', '00000000-0000-0000-0000-00000004101a', 'owner'),
  ('00000000-0000-0000-0000-0000000410ca', '00000000-0000-0000-0000-0000000410a1', 'member'),
  ('00000000-0000-0000-0000-0000000410ca', '00000000-0000-0000-0000-00000004101b', 'admin');

-- Three rides whose audiences differ from each other, all organised by 410a1:
--   41f01  public, NO club   -- every signed-in rider can see it
--   41f02  public, PUBLIC club
--   41f03  not public, PRIVATE club (022 pins it to is_public = false)
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-000000041f01', 'Journal Open Run', 'The Ferry',
   now() + interval '7 days', true, null, '00000000-0000-0000-0000-0000000410a1'),
  ('00000000-0000-0000-0000-000000041f02', 'Journal Club Run', 'The Depot',
   now() + interval '8 days', true, '00000000-0000-0000-0000-0000000410ca',
   '00000000-0000-0000-0000-0000000410a1'),
  ('00000000-0000-0000-0000-000000041f03', 'Journal Secret Run', 'The Barn',
   now() + interval '9 days', false, '00000000-0000-0000-0000-0000000410c9',
   '00000000-0000-0000-0000-0000000410a1');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-000000041f01', '00000000-0000-0000-0000-0000000410b1', 'going'),
  ('00000000-0000-0000-0000-000000041f01', '00000000-0000-0000-0000-0000000410c1', 'maybe'),
  ('00000000-0000-0000-0000-000000041f01', '00000000-0000-0000-0000-0000000410e1', 'going'),
  ('00000000-0000-0000-0000-000000041f01', '00000000-0000-0000-0000-00000004101a', 'going'),
  ('00000000-0000-0000-0000-000000041f02', '00000000-0000-0000-0000-00000004101b', 'going'),
  ('00000000-0000-0000-0000-000000041f03', '00000000-0000-0000-0000-0000000410f1', 'going');

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 041 assertions run as authenticated, or they prove nothing');

-- --------------------------------------------------------------------------
-- 041.1  The three seeded postcards are written THROUGH the policy, as the
--        organizer, who holds no ride_members row on any of the three rides.
--        So the setup is itself the assertion that the organizer arm of
--        is_ride_crew works — the arm whose absence locks a host out of
--        tagging their own ride.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000410a1', false);
select assert_eq((select count(*)::int from ride_members
                   where user_id = '00000000-0000-0000-0000-0000000410a1'),
  0, '041: the organizer holds no ride_members row on any of the three rides');

insert into postcards (id, author_id, club_id, image_path, caption, ride_id) values
  ('00000000-0000-0000-0000-000000041e01', '00000000-0000-0000-0000-0000000410a1',
   '00000000-0000-0000-0000-0000000410c9',
   'postcards/00000000-0000-0000-0000-0000000410a1/41e01000-0000-4000-8000-000000041e01.jpg',
   'Private club, open ride', '00000000-0000-0000-0000-000000041f01'),
  ('00000000-0000-0000-0000-000000041e02', '00000000-0000-0000-0000-0000000410a1',
   null,
   'postcards/00000000-0000-0000-0000-0000000410a1/41e02000-0000-4000-8000-000000041e02.jpg',
   'App-wide, secret ride', '00000000-0000-0000-0000-000000041f03'),
  ('00000000-0000-0000-0000-000000041e05', '00000000-0000-0000-0000-0000000410a1',
   '00000000-0000-0000-0000-0000000410c9',
   'postcards/00000000-0000-0000-0000-0000000410a1/41e05000-0000-4000-8000-000000041e05.jpg',
   'Private club, public club''s ride', '00000000-0000-0000-0000-000000041f02');
-- Counted as the OWNER: 062 revokes SELECT on ride_id from authenticated, so a
-- client can no longer filter on the column at all. What is under test is the
-- three INSERTs above, whose grant and policy are both untouched — so the write
-- stays the rider's and only the read-back moves.
reset role;
select assert_eq((select count(*)::int from postcards
                   where ride_id in ('00000000-0000-0000-0000-000000041f01',
                                     '00000000-0000-0000-0000-000000041f02',
                                     '00000000-0000-0000-0000-000000041f03')),
  3, '041: the organizer tags all three of their own rides with no ride_members row of their own');
set role authenticated;

-- --------------------------------------------------------------------------
-- 041.2  The audience is unchanged, WIDENING direction. This is the leak the
--        whole change exists to not have: a `or ride_id = ...` in the SELECT
--        policy would make the Journal work and hand this row to 410b1.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000410b1', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000041f01'),
  1, '041: a crew member CAN see the ride their postcard is tagged to ...');
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000000410c9'
                     and user_id = '00000000-0000-0000-0000-0000000410b1'),
  0, '041: ... and is NOT a member of the private club the postcard is scoped to ...');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-000000041e01'),
  0, '041: ... so they get ZERO rows for it — club_id is still the whole audience');

-- --------------------------------------------------------------------------
-- 041.3  The audience is unchanged, NARROWING direction. The mirror image, and
--        it has to be asserted too: a SELECT policy that made ride visibility
--        a REQUIREMENT would silently hide app-wide postcards.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000410d1', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000041f03'),
  0, '041: a rider outside the private club canNOT see its ride ...');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-000000041e02'),
  1, '041: ... and still sees an app-wide postcard tagged to it — the tag neither grants nor withholds');

-- --------------------------------------------------------------------------
-- 041.4  Both RSVP statuses tag. There is no read-only tier and no
--        `going`-only tier — the alternative reading is a plausible product
--        rule that nothing in the schema would otherwise rule out.
--        Written as real inserts rather than assert_allowed, because the rows
--        are the fixtures 041.8 and 041.9 filter.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000410b1', false);
insert into postcards (id, author_id, club_id, image_path, caption, ride_id) values
  ('00000000-0000-0000-0000-000000041e03', '00000000-0000-0000-0000-0000000410b1',
   null, 'postcards/00000000-0000-0000-0000-0000000410b1/41e03000-0000-4000-8000-000000041e03.jpg',
   'Great run', '00000000-0000-0000-0000-000000041f01');
-- The tag is read back as the OWNER from here on. 062 revokes SELECT on
-- postcards.ride_id from authenticated, so a client cannot read what it just
-- wrote — the INSERT grant is untouched and it is the INSERT these fixtures
-- test, so the write is still made as the rider and only the read-back moves.
reset role;
select assert_eq((select ride_id from postcards where id = '00000000-0000-0000-0000-000000041e03'),
  '00000000-0000-0000-0000-000000041f01'::uuid,
  '041: a crew member with status `going` tags their postcard to the ride');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-0000000410c1', false);
insert into postcards (id, author_id, club_id, image_path, caption, ride_id) values
  ('00000000-0000-0000-0000-000000041e04', '00000000-0000-0000-0000-0000000410c1',
   null, 'postcards/00000000-0000-0000-0000-0000000410c1/41e04000-0000-4000-8000-000000041e04.jpg',
   'Made it after all', '00000000-0000-0000-0000-000000041f01');
reset role;
select assert_eq((select ride_id from postcards where id = '00000000-0000-0000-0000-000000041e04'),
  '00000000-0000-0000-0000-000000041f01'::uuid,
  '041: a crew member with status `maybe` tags identically — is_ride_crew carries no status filter');
set role authenticated;

-- --------------------------------------------------------------------------
-- 041.5  The CREW conjunct, in isolation. 410d1 can see the ride — asserted,
--        not assumed, because a hidden ride would make the refusal pass for
--        entirely the wrong reason. This is the assertion that goes red if
--        private.is_ride_crew is ever dropped from the with_check.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000410d1', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000041f01'),
  1, '041: a non-crew rider CAN see the public ride ...');
select assert_denied($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-0000000410d1',
          'postcards/00000000-0000-0000-0000-0000000410d1/41d01000-0000-4000-8000-0000000410d1.jpg',
          'let me in', '00000000-0000-0000-0000-000000041f01')$$,
  '041: ... and still cannot tag it — seeing a ride is not being on it (the crew conjunct)');

-- --------------------------------------------------------------------------
-- 041.6  The VISIBILITY conjunct, in isolation. A crew row is inserted as the
--        TABLE OWNER so private.is_ride_crew answers TRUE, and the refusal is
--        then attributable to the EXISTS and to nothing else. Without the
--        EXISTS a foreign key is validated with RLS BYPASSED, so `references
--        rides(id)` accepts any ride in the database.
-- --------------------------------------------------------------------------
reset role;
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-000000041f03', '00000000-0000-0000-0000-0000000410d1', 'going');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000410d1', false);

select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000041f03'),
  0, '041: a non-member of the private club still cannot see its ride, crew row or not ...');
select assert_denied($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-0000000410d1',
          'postcards/00000000-0000-0000-0000-0000000410d1/41d02000-0000-4000-8000-0000000410d2.jpg',
          'sneaking in', '00000000-0000-0000-0000-000000041f03')$$,
  '041: ... and cannot tag it WHILE HOLDING A ride_members ROW — the refusal is the visibility conjunct alone');

-- --------------------------------------------------------------------------
-- 041.7  Blocking the ORGANIZER. Asserted SEPARATELY from 041.6 even though
--        one conjunct closes both, because a single assertion cannot say WHICH
--        arm of the rides policy did the hiding — and these two are hidden by
--        different arms. Decision #2: a blocked rider disappears from feeds,
--        chat, member lists and ride crews simultaneously.
-- --------------------------------------------------------------------------
reset role;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000410e1', '00000000-0000-0000-0000-0000000410a1');
-- Counted as the TABLE OWNER, and it has to be: ride_members SELECT follows
-- ride visibility, so the blocker cannot see their own crew row any more. The
-- row surviving in the database is exactly the fact that makes a bare
-- is_ride_crew — which is security definer and reads it as the owner too —
-- answer TRUE for a rider the rides policy has already shut out.
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-000000041f01'
                     and user_id = '00000000-0000-0000-0000-0000000410e1'),
  1, '041: a rider who blocks the organizer KEEPS their ride_members row in the table ...');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000410e1', false);

select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000041f01'),
  0, '041: ... and loses the ride, because the rides policy carries the block predicate ...');
select assert_denied($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-0000000410e1',
          'postcards/00000000-0000-0000-0000-0000000410e1/41e0e000-0000-4000-8000-0000000410e1.jpg',
          'still here', '00000000-0000-0000-0000-000000041f01')$$,
  '041: ... so they cannot tag it either — is_ride_crew alone would have let them, it is security definer');

-- --------------------------------------------------------------------------
-- 041.8  Leaving the private club, the other side of the same hole and the one
--        034 calls a leak rather than an inconsistency. Savepointed, so the
--        club roster 041.13 reads is not moved by this story.
-- --------------------------------------------------------------------------
savepoint tag_club_leaver_041;
select set_config('test.uid', '00000000-0000-0000-0000-0000000410f1', false);
select assert_allowed($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-0000000410f1',
          'postcards/00000000-0000-0000-0000-0000000410f1/41f01000-0000-4000-8000-0000000410f1.jpg',
          'club run', '00000000-0000-0000-0000-000000041f03')$$,
  '041: a private club member on the crew CAN tag that club''s ride ...');

reset role;
delete from club_members
 where club_id = '00000000-0000-0000-0000-0000000410c9'
   and user_id = '00000000-0000-0000-0000-0000000410f1';
-- Counted as the table owner, for 041.7's reason: the roster is gone from this
-- rider's own view along with the ride. The surviving row is what a bare
-- is_ride_crew would still find.
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-000000041f03'
                     and user_id = '00000000-0000-0000-0000-0000000410f1'),
  1, '041: ... leaving the club leaves the ride_members row standing in the table ...');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000410f1', false);
select assert_denied($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-0000000410f1',
          'postcards/00000000-0000-0000-0000-0000000410f1/41f02000-0000-4000-8000-0000000410f2.jpg',
          'still in?', '00000000-0000-0000-0000-000000041f03')$$,
  '041: ... and they can no longer tag it — 022 takes the private club''s ride with the membership');
rollback to savepoint tag_club_leaver_041;

-- --------------------------------------------------------------------------
-- 041.9  The error SHAPE is a property of the gate, not an accident. A
--        nonexistent ride and an invisible one are refused identically, so
--        nothing tells a rider that a ride they cannot see exists. RLS WITH
--        CHECK is evaluated BEFORE the foreign key's AFTER ROW referential
--        trigger, so 23503 is unreachable while the visibility conjunct
--        stands — removing it would reintroduce the distinction as a real
--        oracle, which is what this pins.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000410b1', false);
select assert_rejected($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-0000000410b1',
          'postcards/00000000-0000-0000-0000-0000000410b1/41b09000-0000-4000-8000-0000000410b9.jpg',
          'nowhere', '00000000-0000-0000-0000-00000004ffff')$$,
  '42501', '041: a NONEXISTENT ride id is refused 42501 by the policy, never 23503 by the foreign key');
select assert_rejected($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-0000000410b1',
          'postcards/00000000-0000-0000-0000-0000000410b1/41b10000-0000-4000-8000-0000000410ba.jpg',
          'somewhere', '00000000-0000-0000-0000-000000041f03')$$,
  '42501', '041: ... and an INVISIBLE one is refused with the identical 42501 — the two are indistinguishable to a client');

-- --------------------------------------------------------------------------
-- 041.10  A rider cannot attach a ride to somebody else's postcard. The
--         authorship rule predates this change; the ride tag is a new reason
--         to try, and the UPDATE route is refused by the COLUMN GRANT rather
--         than by a policy, which is 041's chosen instrument.
-- --------------------------------------------------------------------------
select assert_denied($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-0000000410a1',
          'postcards/00000000-0000-0000-0000-0000000410a1/41b11000-0000-4000-8000-0000000410bb.jpg',
          'not mine to post', '00000000-0000-0000-0000-000000041f01')$$,
  '041: a crew member cannot tag a ride onto a postcard authored by somebody else');
select assert_denied($$
  update postcards set ride_id = '00000000-0000-0000-0000-000000041f01'
   where id = '00000000-0000-0000-0000-000000041e01'$$,
  '041: nor re-tag another rider''s postcard — refused by the absent column grant, before any policy runs');
select assert_denied($$
  update postcards set ride_id = null
   where id = '00000000-0000-0000-0000-000000041e03'$$,
  '041: and an author cannot even UNtag their OWN postcard — the tag is set once, by decision');

-- --------------------------------------------------------------------------
-- 041.11  The participation gate is unmoved. A rider with no consent stamp is
--         refused whether or not they name a ride, and the crew row is seeded
--         as the table owner so the refusal is provably the gate rather than
--         the tag. 023's trigger is BEFORE INSERT, so it raises 23514 ahead of
--         the policy's 42501.
-- --------------------------------------------------------------------------
reset role;
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-000000041f01', '00000000-0000-0000-0000-00000000000e', 'going');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select assert_rejected($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-00000000000e',
          'postcards/00000000-0000-0000-0000-00000000000e/41e0e100-0000-4000-8000-00000000ee01.jpg', 'hi')$$,
  '23514', '041: an un-onboarded rider still cannot post an UNtagged postcard');
select assert_rejected($$
  insert into postcards (author_id, image_path, caption, ride_id)
  values ('00000000-0000-0000-0000-00000000000e',
          'postcards/00000000-0000-0000-0000-00000000000e/41e0e200-0000-4000-8000-00000000ee02.jpg',
          'hi', '00000000-0000-0000-0000-000000041f01')$$,
  '23514', '041: ... nor a TAGGED one, crew row and all — the tag opens no way around 023');

-- --------------------------------------------------------------------------
-- 041.12  Club and ride are ORTHOGONAL and are not constrained to agree. Row
--         three of design.md §D4's table: a club postcard tagged to an
--         unrelated public ride is LEGAL, and it renders for that club's
--         members only. Without this the tempting "the postcard's club must be
--         the ride's club" trigger could be added with a green suite.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000004101a', false);
insert into postcards (id, author_id, club_id, image_path, caption, ride_id) values
  ('00000000-0000-0000-0000-000000041e06', '00000000-0000-0000-0000-00000004101a',
   '00000000-0000-0000-0000-0000000410ca',
   'postcards/00000000-0000-0000-0000-00000004101a/41e06000-0000-4000-8000-000000041e06.jpg',
   'Our club, someone else''s ride', '00000000-0000-0000-0000-000000041f01');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-000000041e06'),
  1, '041: a club member tags a C-scoped postcard to a ride that has nothing to do with C');
select assert_eq((select club_id from rides where id = '00000000-0000-0000-0000-000000041f01'),
  null::uuid, '041: ... and that ride provably belongs to no club at all');

select set_config('test.uid', '00000000-0000-0000-0000-0000000410b1', false);
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-000000041f01'
                     and user_id = '00000000-0000-0000-0000-0000000410b1'),
  1, '041: a crew member of that same ride ...');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-000000041e06'),
  0, '041: ... who is not in C gets zero rows for it — the Journal is a query, not a place');

-- --------------------------------------------------------------------------
-- 041.13  No role gets an elevated read into a ride's Journal. `owner` and
--         `admin` are the two rows of club_members.role with nothing else
--         asserting them here, and `admin` is unreachable through the client
--         at all (no UPDATE policy on club_members, and 019's INSERT arm
--         admits `member` only) — hence the table-owner seed above.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000004101a', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000041f02'),
  1, '041: the OWNER of the ride''s club can see the ride ...');
-- The Journal query is public.ride_journal_postcard_ids from 062 onward: the
-- client cannot filter postcards on ride_id any more, so a `where ride_id = …`
-- here would be asserting against a read no rider can issue. Every rider in
-- this section can SEE the ride they are asked about — asserted immediately
-- above in each case — so the accessor's own ride conjunct changes none of
-- these expected values, and each one still measures exactly what it did: what
-- club_id lets this rider read.
select assert_eq(
  (select count(*)::int
     from public.ride_journal_postcard_ids('00000000-0000-0000-0000-000000041f02')),
  0, '041: ... and reads NOTHING in its Journal, because that postcard is scoped to a club they are not in');

select set_config('test.uid', '00000000-0000-0000-0000-00000004101b', false);
select assert_eq((select role from club_members
                   where club_id = '00000000-0000-0000-0000-0000000410ca'
                     and user_id = '00000000-0000-0000-0000-00000004101b'),
  'admin', '041: the ADMIN of the ride''s club holds the role ...');
-- The ride-visibility line the OWNER case has directly above it, and this case
-- did not. Without it the zero below is satisfiable two ways — by club_id, which
-- is what its label claims, or by can_read_ride going false — so a regression in
-- 060's helper for a club admin would leave the line green while it measured
-- something else. The `owner` case is already covered; only this one was short.
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000041f02'),
  1, '041/062: ... and can see the ride, so the zero below is about club_id and not about can_read_ride ...');
select assert_eq(
  (select count(*)::int
     from public.ride_journal_postcard_ids('00000000-0000-0000-0000-000000041f02')),
  0, '041: ... and reads nothing either — `admin` buys no moderation reach, there is no admin role in this system');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410f1', false);
select assert_eq(
  (select count(*)::int
     from public.ride_journal_postcard_ids('00000000-0000-0000-0000-000000041f02')),
  1, '041: while an ordinary member of the postcard''s OWN club reads it — the zeroes above are about club_id, not about the ride');

-- --------------------------------------------------------------------------
-- 041.14  Blocking removes a rider from the JOURNAL query specifically, both
--         directions from one directional row. Asserted here rather than
--         inherited from the feed, because the Journal is a different query
--         and decision #2 lists its surfaces individually. Savepointed — the
--         block would otherwise move 041.16's counts.
-- --------------------------------------------------------------------------
savepoint tag_block_041;
reset role;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000410c1', '00000000-0000-0000-0000-0000000410b1');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-0000000410b1', false);
-- `id in (accessor)` rather than `where ride_id = …`, for 041.13's reason. The
-- author filter stays a filter on postcards, which is still readable per column
-- — and it re-reads under the caller's own RLS, so a postcard the accessor
-- should not have named would still count zero here.
select assert_eq((select count(*)::int from postcards
                   where id in (select public.ride_journal_postcard_ids('00000000-0000-0000-0000-000000041f01'))
                     and author_id = '00000000-0000-0000-0000-0000000410c1'),
  0, '041: the blocked rider sees none of the blocker''s postcards in the Journal query');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-000000041e03'),
  1, '041: ... and still sees their own');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410c1', false);
select assert_eq((select count(*)::int from postcards
                   where id in (select public.ride_journal_postcard_ids('00000000-0000-0000-0000-000000041f01'))
                     and author_id = '00000000-0000-0000-0000-0000000410b1'),
  0, '041: and the blocker sees none of the blocked rider''s — symmetric from one directional row');
rollback to savepoint tag_block_041;

-- --------------------------------------------------------------------------
-- 041.15  A hide is per-viewer and one-directional, and it reaches the Journal
--         query too. Savepointed for the same reason.
-- --------------------------------------------------------------------------
savepoint tag_hide_041;
select set_config('test.uid', '00000000-0000-0000-0000-0000000410d1', false);
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-000000041e03'),
  1, '041: a rider sees an app-wide postcard in the Journal query to begin with');
insert into postcard_hides (postcard_id, user_id) values
  ('00000000-0000-0000-0000-000000041e03', '00000000-0000-0000-0000-0000000410d1');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-000000041e03'),
  0, '041: ... and a hide removes it from the Journal query, not only from the feed');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410c1', false);
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-000000041e03'),
  1, '041: ... for that viewer alone — a hide is one-directional, unlike a block');
rollback to savepoint tag_hide_041;

-- --------------------------------------------------------------------------
-- 041.16  THE ASSERTION THAT GOES RED IF SOMEBODY ADDS THE ride_id CONJUNCT TO
--         THE UPDATE POLICY FOR SYMMETRY WITH club_id.
--
--         Contrast it with rls_test.sql:719-727 — "an author who left a club
--         cannot edit their postcard in it" — which is asserted as a REFUSAL
--         and is accepted, because club_id IS updatable and its with_check is
--         the only thing stopping a rider moving a photo into a private club.
--         ride_id is NOT updatable, so the same conjunct would prevent nothing
--         and cost an identical lockout: a caption edit refused by a condition
--         about somebody else's ride.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000410b1', false);
delete from ride_members
 where ride_id = '00000000-0000-0000-0000-000000041f01'
   and user_id = '00000000-0000-0000-0000-0000000410b1';
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-000000041f01'
                     and user_id = '00000000-0000-0000-0000-0000000410b1'),
  0, '041: the author of a TAGGED postcard leaves the crew ...');
-- Wrapped so the failure NAMES ITSELF. A bare UPDATE refused by the with_check
-- raises the generic "new row violates row-level security policy", at a line
-- number, with nothing to tell the next reader which conjunct did it or that
-- adding one was the mistake. This is the one assertion whose entire value is
-- the message it prints on the day somebody reintroduces the conjunct.
do $tagged_caption$
begin
  update public.postcards set caption = 'Great run, edited'
   where id = '00000000-0000-0000-0000-000000041e03';
exception when insufficient_privilege then
  raise exception 'FAIL  041: a caption edit on a TAGGED postcard was REFUSED for an author who left the crew. Somebody has added a ride_id conjunct to the postcards UPDATE policy for symmetry with club_id. It buys nothing — ride_id has no UPDATE grant — and costs exactly this lockout. See 041''s header and design.md §D3.';
end
$tagged_caption$;
select assert_eq((select caption from postcards where id = '00000000-0000-0000-0000-000000041e03'),
  'Great run, edited',
  '041: ... and can STILL edit its caption — the mirror of rls_test.sql:719-727, which refuses the club case and is accepted only because club_id is updatable');
reset role;
select assert_eq((select ride_id from postcards where id = '00000000-0000-0000-0000-000000041e03'),
  '00000000-0000-0000-0000-000000041f01'::uuid,
  '041: ... with the tag untouched by the edit');
set role authenticated;

-- --------------------------------------------------------------------------
-- 041.17  Nulling the tag changes NOBODY's visibility. The strongest available
--         evidence that ride_id never became an audience axis: the same four
--         riders before and after, expected value unchanged in every case.
--         Savepointed so 041.18 still has a tag to lose.
-- --------------------------------------------------------------------------
savepoint tag_null_041;
select set_config('test.uid', '00000000-0000-0000-0000-0000000410a1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e01'),
  1, '041: before the tag is nulled — the author sees it');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410f1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e01'),
  1, '041: before — a member of the postcard''s club sees it');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410b1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e01'),
  0, '041: before — a crew member of the tagged ride, not in that club, does not');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410d1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e01'),
  0, '041: before — an unrelated rider does not');

reset role;
update postcards set ride_id = null where id = '00000000-0000-0000-0000-000000041e01';
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-0000000410a1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e01'),
  1, '041: after — the author still sees it');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410f1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e01'),
  1, '041: after — the club member still sees it');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410b1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e01'),
  0, '041: after — the crew member still does not');
select set_config('test.uid', '00000000-0000-0000-0000-0000000410d1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e01'),
  0, '041: after — the unrelated rider still does not. Identical sets: the tag is not an audience axis');
rollback to savepoint tag_null_041;

-- --------------------------------------------------------------------------
-- 041.18  The cascade window, and the defect `on delete cascade` would have
--         re-created. Asserted from the OTHER rider's session, not the
--         deleter's: a count taken as the deleter proves nothing, because the
--         author branch of the SELECT policy is unconditional.
--
--         rides.organizer_id is ON DELETE CASCADE, so this is also what an
--         organizer's account deletion does — 410a1 deleting their account
--         empties this Journal and destroys nobody else's postcard.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000410a1', false);
delete from rides where id = '00000000-0000-0000-0000-000000041f01';
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000041f01'),
  0, '041: the organizer deletes the ride');

select set_config('test.uid', '00000000-0000-0000-0000-00000004101a', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e06'),
  1, '041: ANOTHER rider''s postcard survives the ride''s deletion — set null, never cascade');
reset role;
select assert_eq((select ride_id from postcards where id = '00000000-0000-0000-0000-000000041e06'),
  null::uuid, '041: ... with its tag nulled by the referential action, which runs privileged and is not gated by the withheld UPDATE grant');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000410c1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e04'),
  1, '041: ... and so does a third rider''s, read from their own session');

-- Deleting a postcard's AUTHOR removes the postcard and leaves the ride alone.
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000410c1';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000410a1', false);
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000041e04'),
  0, '041: deleting a postcard''s author removes the postcard (the author_id cascade) ...');
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000041f02'),
  1, '041: ... and touches no ride — the Journal is simply shorter, with no placeholder');

-- --------------------------------------------------------------------------
-- 041.19  The shape: policies, grants and the index. Identity-free, so it runs
--         as the table owner — and every grant assertion NAMES THE ROLE rather
--         than attempting a write, because the owner has neither RLS nor a
--         column privilege and an attempted write would prove nothing (031).
-- --------------------------------------------------------------------------
reset role;

select assert_eq(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'postcards'),
  4, '041: postcards still carries exactly four policies — select, insert, update, delete');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'SELECT'),
  1, '041: ... exactly ONE of them SELECT, so nothing can OR the club predicate away');

-- The absence is the load-bearing part, so it is asserted as TEXT rather than
-- described. `ride_id` appears nowhere in the SELECT policy, in either
-- direction — it neither grants nor withholds.
select assert_eq(
  (select qual like '%ride_id%' from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'SELECT'),
  false, '041: ride_id does not appear in the postcards SELECT policy at all — club_id IS the audience');
select assert_eq(
  (select md5(qual) from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'SELECT'),
  'c8fb49b026866743283b3d7ecfbc5122',
  '041: ... and the whole SELECT qual is byte-identical to what 011 left, captured from letsride-dev before 041 applied');

select assert_eq(
  (select with_check like '%is_ride_crew%' from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'INSERT'),
  true, '041: the INSERT with_check carries the crew conjunct ...');
select assert_eq(
  (select with_check like '%FROM rides%' from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'INSERT'),
  true, '041: ... and the ride-visibility EXISTS beside it — neither half is the gate alone');
select assert_eq(
  (select with_check like '%ride_id%' from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'UPDATE'),
  false, '041: and the UPDATE with_check names ride_id NOWHERE — adding it for symmetry with club_id is the lockout 041.16 pins');

-- The column grants, one assertion per column, so an omission in the re-grant
-- fails here rather than as a rider who cannot edit something in production.
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'ride_id', 'UPDATE'),
  false, '041: authenticated holds NO UPDATE grant on postcards.ride_id — the tag is set once');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'ride_id', 'INSERT'),
  true, '041: ... but may INSERT it, or nothing could ever be tagged');
-- INVERTED BY 062, and kept in place rather than deleted because it is the
-- record of why the grant existed. It read `true, '041: ... and may SELECT it,
-- or the Journal query could not filter on it'` — a deliberate assertion, and
-- the exact collision PD-166 was filed to hold open: Postgres checks SELECT on
-- a column to FILTER on it, so the Journal wanted the same privilege the
-- correlation channel did. 062 resolves it in the Journal's favour by moving
-- the filter into public.ride_journal_postcard_ids, which holds the column so
-- authenticated does not have to. The full 062 section is at the end of this
-- file; this line stays here so 041's enumeration of its own grants still reads
-- as a complete account.
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'ride_id', 'SELECT'),
  false, '062: authenticated may NOT select postcards.ride_id — 041 granted it so the Journal could filter on it, and PD-166 chose the accessor over the grant');

-- 041 kept both of these and 044 left them alone; 046 takes them, applying 045's
-- own objection back to this table — "the policy, not the grant, is what refuses
-- a hand-off" was the reasoning 045 rejected, so it could not stay standing here.
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'id', 'UPDATE'),
  false, '046: postcards.id holds NO update grant — 041 kept it, 046 took it, matching rides.id and clubs.id');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'author_id', 'UPDATE'),
  false, '046: ... and NOT on author_id — the policy is no longer the ONLY thing refusing a hand-off, which is 045''s argument applied back to 044');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'club_id', 'UPDATE'),
  true, '041: ... on club_id (updatable by design — which is why ITS with_check conjunct is required)');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'image_path', 'UPDATE'),
  true, '041: ... on image_path');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'caption', 'UPDATE'),
  true, '041: ... on caption');
-- The two timestamp columns were in 041's re-granted list and are NOT any more.
-- 041's own comment here said "fixing PD-163 SHOULD edit this line deliberately"
-- — 044 is that edit, so both lines flip to false and are relabelled 044 rather
-- than deleted. The full 044 section lives further down; these two stay in place
-- so that 041's enumeration of its own re-grant list still reads as a complete
-- account of which columns hold UPDATE and which do not.
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'updated_at', 'UPDATE'),
  false, '044: ... and NOT on updated_at — 041 re-granted it, 044 took it back, and postcards_set_updated_at stamps it anyway');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'created_at', 'UPDATE'),
  false, '044: ... and NOT on created_at — 041 pinned this as a known defect (PD-163) and 044 is the deliberate edit that closes it');

select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'caption,club_id,image_path',
  '041/044/046: exactly three columns hold UPDATE — ride_id (041), created_at and updated_at (044), id and author_id (046) are not among them');

-- 007 revoked the last of anon's reach and decision #1 keeps it that way. The
-- column-level check is separate because a per-column grant does not appear in
-- role_table_grants at all — 034 §4b's trap, and 037 asserts the same shape.
select assert_eq(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and column_name = 'ride_id' and grantee = 'anon'),
  0, '041: anon holds no column privilege on postcards.ride_id, in any verb');
select assert_eq(
  (select bool_or(has_column_privilege('anon', 'public.postcards', 'ride_id', p))
     from unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p),
  false, '041: ... confirmed by naming the role on every verb, not by counting rows');

-- The FK action is the decision this file's header is mostly about. 'n' is SET
-- NULL, 'c' is CASCADE, 'a' is NO ACTION — and 'c' here would mean one rider
-- deleting their account destroys other riders' postcards.
select assert_eq(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.postcards'::regclass and contype = 'f'
      and conkey = array[(select attnum from pg_attribute
                           where attrelid = 'public.postcards'::regclass and attname = 'ride_id')]),
  'n', '041: postcards.ride_id is ON DELETE SET NULL, never CASCADE — rides.organizer_id already cascades');
select assert_eq(
  (select attnotnull from pg_attribute
    where attrelid = 'public.postcards'::regclass and attname = 'ride_id'),
  false, '041: ... and the column is nullable, because most postcards have no ride');

-- The index serves the set null sweep (leading column) and the Journal query
-- (the pair). Without it the sweep scans postcards once per deleted ride.
select assert_eq(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'postcards'
      and indexname = 'postcards_ride_id_idx'),
  1, '041: postcards_ride_id_idx exists, so the set null sweep is not a seq scan per deleted ride');
select assert_eq(
  (select count(*)::int from pg_index i
     join pg_class c on c.oid = i.indrelid
     join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
   where c.relname = 'postcards' and a.attname = 'ride_id'),
  1, '041: ... with ride_id LEADING it, which is what the sweep needs');

-- 041 is additive and INERT. Unlike 036 it hangs nothing off an existing write
-- path, so the trigger count on this shipped table must not have moved.
select assert_eq(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.postcards'::regclass and not tgisinternal),
  2, '041: postcards still carries exactly two triggers — the participation gate and the updated_at stamp. 041 added no fan-out');

rollback to savepoint ride_tag_041;


-- ===========================================================================
-- 043. delete_owned_club — the one delete a client is structurally incapable
--      of doing safely, and the assertion that fails when it does TOO MUCH.
-- ===========================================================================

\echo ''
\echo '# Deleting a club you own, without stranding anyone (043)'

-- Self-contained fixtures, for 034's and 041's reason and one of its own: this
-- section runs last and it DELETES CLUBS, so it must own every row it destroys.
-- Nothing here touches seed.sql's clubs, and 043.5 is what proves that rather
-- than asserting it in prose.
--
-- The riders, and what each one is for:
--   430a1  owner of club A (private), club C (public) and club D (public)
--   430b1  member of A and ORGANIZER of A's private ride -- the ride the club
--          owner holds no grant to delete by hand, which is the whole reason
--          043 exists. Also the author of A's postcard
--   430c1  crew of A's private ride, of C's private ride and of D's public ride
--   430d1  owner of club B -- the unrelated club 043.5 proves is untouched
--   430e1  member of B, organizer of B's private ride
--   430f1  member of C and D, organizer of C's two rides and D's public ride
--   4301a  signed in, in no club and on no crew -- the non-owner caller of
--          043.2, and the rider who must STILL see C's public ride afterwards
--   4301b  a hand-written `admin` row in club B, for 043.9
--   4301c  blocked by B's owner, for 043.7
savepoint owned_club_043;

reset role;
set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000430a1', 'clubdelowner@example.com'),
  ('00000000-0000-0000-0000-0000000430b1', 'clubdelorganizer@example.com'),
  ('00000000-0000-0000-0000-0000000430c1', 'clubdelcrew@example.com'),
  ('00000000-0000-0000-0000-0000000430d1', 'clubdelbystander@example.com'),
  ('00000000-0000-0000-0000-0000000430e1', 'clubdelbmember@example.com'),
  ('00000000-0000-0000-0000-0000000430f1', 'clubdelcmember@example.com'),
  ('00000000-0000-0000-0000-00000004301a', 'clubdeloutsider@example.com'),
  ('00000000-0000-0000-0000-00000004301b', 'clubdeladmin@example.com'),
  ('00000000-0000-0000-0000-00000004301c', 'clubdelblocked@example.com');
reset role;

-- One statement rather than nine, because nine near-identical UPDATEs is nine
-- places for a typo'd uuid to look like a deliberately un-onboarded rider.
update profiles p
   set username                = v.username,
       location                = 'Rotterdam',
       onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
       terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  from (values
    ('00000000-0000-0000-0000-0000000430a1'::uuid, 'clubdelowner'),
    ('00000000-0000-0000-0000-0000000430b1'::uuid, 'clubdelorganizer'),
    ('00000000-0000-0000-0000-0000000430c1'::uuid, 'clubdelcrew'),
    ('00000000-0000-0000-0000-0000000430d1'::uuid, 'clubdelbystander'),
    ('00000000-0000-0000-0000-0000000430e1'::uuid, 'clubdelbmember'),
    ('00000000-0000-0000-0000-0000000430f1'::uuid, 'clubdelcmember'),
    ('00000000-0000-0000-0000-00000004301a'::uuid, 'clubdeloutsider'),
    ('00000000-0000-0000-0000-00000004301b'::uuid, 'clubdeladmin'),
    ('00000000-0000-0000-0000-00000004301c'::uuid, 'clubdelblocked')
  ) v (id, username)
 where p.id = v.id;
select assert_eq((select count(*)::int from profiles
                   where username like 'clubdel%' and onboarding_completed_at is not null),
  9, '043: nine onboarded riders seeded — a mistyped uuid here would look like a deliberately un-onboarded rider');

-- A carries no image, so 043.3 can assert the function returns NO paths; C
-- carries both, so 043.6 can assert it returns exactly them. 016's CHECKs pin
-- each path to the row's own owner_id, which is why both sit under 430a1.
insert into clubs (id, name, is_public, owner_id, avatar_path, cover_image_path) values
  ('00000000-0000-0000-0000-0000000430ca', 'Deleted MC', false,
   '00000000-0000-0000-0000-0000000430a1', null, null),
  ('00000000-0000-0000-0000-0000000430cb', 'Containment MC', false,
   '00000000-0000-0000-0000-0000000430d1', null, null),
  ('00000000-0000-0000-0000-0000000430cc', 'Open Deleted MC', true,
   '00000000-0000-0000-0000-0000000430a1',
   'club-avatars/00000000-0000-0000-0000-0000000430a1/43aaaaaa-0000-4000-8000-0000004301aa.jpg',
   'club-covers/00000000-0000-0000-0000-0000000430a1/43bbbbbb-0000-4000-8000-0000004301bb.jpg'),
  ('00000000-0000-0000-0000-0000000430cd', 'Privacy Toggle MC', true,
   '00000000-0000-0000-0000-0000000430a1', null, null);

-- The `admin` row is seeded as the TABLE OWNER on purpose, exactly as 041 does:
-- club_members has no UPDATE policy and 019's INSERT arm admits `member` only,
-- so `admin` is unreachable through the client entirely. Seeding it here is the
-- only way to assert what an admin can reach — which is 043.9's whole subject.
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000430ca', '00000000-0000-0000-0000-0000000430a1', 'owner'),
  ('00000000-0000-0000-0000-0000000430ca', '00000000-0000-0000-0000-0000000430b1', 'member'),
  ('00000000-0000-0000-0000-0000000430ca', '00000000-0000-0000-0000-0000000430c1', 'member'),
  ('00000000-0000-0000-0000-0000000430cb', '00000000-0000-0000-0000-0000000430d1', 'owner'),
  ('00000000-0000-0000-0000-0000000430cb', '00000000-0000-0000-0000-0000000430e1', 'member'),
  ('00000000-0000-0000-0000-0000000430cb', '00000000-0000-0000-0000-00000004301b', 'admin'),
  ('00000000-0000-0000-0000-0000000430cc', '00000000-0000-0000-0000-0000000430a1', 'owner'),
  ('00000000-0000-0000-0000-0000000430cc', '00000000-0000-0000-0000-0000000430f1', 'member'),
  ('00000000-0000-0000-0000-0000000430cd', '00000000-0000-0000-0000-0000000430a1', 'owner'),
  ('00000000-0000-0000-0000-0000000430cd', '00000000-0000-0000-0000-0000000430f1', 'member');

insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-0000000430d1', '00000000-0000-0000-0000-00000004301c');

-- 43f01  A, private, organised by a MEMBER -- the ride the owner cannot delete
-- 43f02  B, private, organised by a member -- the containment case
-- 43f03  C, PUBLIC   -- must survive the club with club_id NULL
-- 43f04  C, private  -- must go with the club (022 lets a public club hold one)
-- 43f05  D, public   -- the privacy-toggle pair
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-000000043f01', 'Deleted Club Run', 'The Barn',
   now() + interval '7 days', false, '00000000-0000-0000-0000-0000000430ca',
   '00000000-0000-0000-0000-0000000430b1'),
  ('00000000-0000-0000-0000-000000043f02', 'Containment Run', 'The Mill',
   now() + interval '8 days', false, '00000000-0000-0000-0000-0000000430cb',
   '00000000-0000-0000-0000-0000000430e1'),
  ('00000000-0000-0000-0000-000000043f03', 'Survivor Run', 'The Quay',
   now() + interval '9 days', true, '00000000-0000-0000-0000-0000000430cc',
   '00000000-0000-0000-0000-0000000430f1'),
  ('00000000-0000-0000-0000-000000043f04', 'Quiet Run In An Open Club', 'The Yard',
   now() + interval '10 days', false, '00000000-0000-0000-0000-0000000430cc',
   '00000000-0000-0000-0000-0000000430f1'),
  ('00000000-0000-0000-0000-000000043f05', 'Toggle Run', 'The Locks',
   now() + interval '11 days', true, '00000000-0000-0000-0000-0000000430cd',
   '00000000-0000-0000-0000-0000000430f1');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-000000043f01', '00000000-0000-0000-0000-0000000430c1', 'going'),
  ('00000000-0000-0000-0000-000000043f02', '00000000-0000-0000-0000-0000000430d1', 'going'),
  ('00000000-0000-0000-0000-000000043f03', '00000000-0000-0000-0000-00000004301a', 'going'),
  ('00000000-0000-0000-0000-000000043f04', '00000000-0000-0000-0000-0000000430c1', 'maybe'),
  ('00000000-0000-0000-0000-000000043f05', '00000000-0000-0000-0000-0000000430c1', 'going');

-- The chat is the least recoverable thing a club delete destroys and the least
-- obvious, so it is seeded rather than reasoned about.
insert into ride_messages (ride_id, author_id, body) values
  ('00000000-0000-0000-0000-000000043f01', '00000000-0000-0000-0000-0000000430c1',
   'See you at the barn.');

-- A postcard by a MEMBER, not by the owner: the cascade this change does not
-- reopen (009 reasoned it out for a club deleted BY its owner) but does have to
-- disclose. The owner's tap destroys another rider's writing.
insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-000000043e01', '00000000-0000-0000-0000-0000000430b1',
   '00000000-0000-0000-0000-0000000430ca',
   'postcards/00000000-0000-0000-0000-0000000430b1/43e01000-0000-4000-8000-000000043e01.jpg',
   'Posted into a club I do not own');

insert into feed_reads (user_id, club_id) values
  ('00000000-0000-0000-0000-0000000430b1', '00000000-0000-0000-0000-0000000430ca');

-- --------------------------------------------------------------------------
-- 043.1  Shape, and reachability BY ROLE. Identity-free, so it runs as the
--        table owner — and every privilege assertion NAMES THE ROLE rather
--        than calling the function, because the owner has no barrier to clear
--        and a successful call would prove nothing about who else may make it.
--        031 exists because 029 shipped a function nothing could call.
-- --------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'delete_owned_club'),
  1, '043: public.delete_owned_club exists, in `public` so PostgREST can route to it at all');

select assert_eq(
  (select prosecdef from pg_proc where oid = 'public.delete_owned_club(uuid)'::regprocedure),
  true, '043: it is SECURITY DEFINER — the clause apply_migration can silently drop, which 022 shipped once in the other direction');
-- Matched on the literal quotes, which is how Postgres stores it: a needle
-- reading `search_path=` alone finds nothing and passes as a green test.
select assert_eq(
  (select proconfig[1] from pg_proc where oid = 'public.delete_owned_club(uuid)'::regprocedure),
  'search_path=""', '043: ... with search_path pinned to the empty string');

-- The pragma is invisible behaviourally under the default GUC, so a structural
-- needle is the only thing that can see it go missing. It is what makes the
-- no-ambiguity guarantee local to the function rather than dependent on a
-- cluster setting an operator could move to `use_column`.
select assert_eq(
  (select prosrc like '%#variable_conflict error%' from pg_proc
    where oid = 'public.delete_owned_club(uuid)'::regprocedure),
  true, '043: the body opens with #variable_conflict error, so the guarantee is local to the function and not a cluster GUC');
select assert_eq(
  (select prosrc like '%r.club_id = p_club_id%' from pg_proc
    where oid = 'public.delete_owned_club(uuid)'::regprocedure),
  true, '043: ... and the ride delete is alias-qualified, which is the belt to that braces');

select assert_eq(has_function_privilege('authenticated', 'public.delete_owned_club(uuid)', 'execute'),
  true, '043: authenticated may EXECUTE it — asserted as a ROLE FACT, never by calling it as the table owner (031)');
select assert_eq(has_function_privilege('anon', 'public.delete_owned_club(uuid)', 'execute'),
  false, '043: ... anon may not, as everywhere (decision #1)');
select assert_eq(
  (select coalesce(bool_or(a::text like '=X/%'), false)
     from pg_proc p, unnest(p.proacl) a
    where p.oid = 'public.delete_owned_club(uuid)'::regprocedure),
  false, '043: ... and PUBLIC holds no EXECUTE — Postgres grants it by default, so the revoke has to be there');

-- 043 adds a FUNCTION, not a policy arm. Scoped to the two tables it touches
-- rather than counted schema-wide, so a policy landing elsewhere does not make
-- this assertion stop testing its own intent.
select assert_eq(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'clubs'),
  4, '043: clubs still carries exactly four policies — 043 widens no arm');
select assert_eq(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'rides'),
  4, '043: ... and rides four, which is the alternative D1 rejected: no club-owner arm was added to the DELETE policy');

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 043 behavioural assertions run as authenticated, or they prove nothing');

-- --------------------------------------------------------------------------
-- 043.2  The refusal, and that it does not reveal whether the club exists.
--        A security definer function runs with RLS bypassed, so `owner_id =
--        auth.uid()` inside the body is the ENTIRE access control here.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000004301a', false);
select assert_denied($$select * from public.delete_owned_club('00000000-0000-0000-0000-0000000430ca')$$,
  '043: a signed-in rider who owns nothing cannot delete somebody else''s club');

-- The owner of a DIFFERENT club, which is the caller most likely to be admitted
-- by a body that checks "is the caller an owner" instead of "of this club".
select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
select assert_denied($$select * from public.delete_owned_club('00000000-0000-0000-0000-0000000430ca')$$,
  '043: ... nor can the owner of a different club — the check is owner OF THIS CLUB, not "an owner"');

-- A member of the club is the other near-miss: they can SELECT the row, so a
-- body relying on the caller's RLS rather than its own test would admit them.
select set_config('test.uid', '00000000-0000-0000-0000-0000000430b1', false);
select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000430ca'),
  1, '043: a member CAN read the club row ...');
select assert_denied($$select * from public.delete_owned_club('00000000-0000-0000-0000-0000000430ca')$$,
  '043: ... and still cannot delete it — the function does not inherit the caller''s SELECT reach');

-- Existence disclosure, compared rather than described. Both branches are one
-- raise site in the body, so this cannot pass while the two answers differ.
-- Captured through set_config from an exception handler rather than a pg_temp
-- function, because the temp schema belongs to the session user and this block
-- runs as `authenticated`.
select set_config('test.uid', '00000000-0000-0000-0000-00000004301a', false);
do $$
begin
  begin
    perform 1 from public.delete_owned_club('00000000-0000-0000-0000-0000000430ca');
    perform set_config('test.refusal_theirs', 'not refused at all', false);
  exception when others then
    perform set_config('test.refusal_theirs', sqlstate || ' ' || sqlerrm, false);
  end;
  begin
    perform 1 from public.delete_owned_club('00000000-0000-0000-0000-00000043dead');
    perform set_config('test.refusal_absent', 'not refused at all', false);
  exception when others then
    perform set_config('test.refusal_absent', sqlstate || ' ' || sqlerrm, false);
  end;
end
$$;
select assert_eq(current_setting('test.refusal_theirs'), current_setting('test.refusal_absent'),
  '043: the refusal for a club you do not own is byte-identical to the refusal for a club that does not exist');
select assert_eq(left(current_setting('test.refusal_theirs'), 5), '42501',
  '043: ... and both are 42501, the authorization SQLSTATE the rest of this schema uses for a refusal');

-- Deleted nothing. Counted as the table owner, so "gone" cannot be confused
-- with "invisible to this caller".
reset role;
select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000430ca'),
  1, '043: after four refused calls the club is still there ...');
select assert_eq((select count(*)::int from rides where club_id = '00000000-0000-0000-0000-0000000430ca'),
  1, '043: ... and so is its ride');
set role authenticated;

-- --------------------------------------------------------------------------
-- 043.3  The owner's call, and the delete no client grant permits: a PRIVATE
--        ride organised by somebody else, in the owner's own club.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000430a1', false);
select assert_eq((select count(*)::int from public.delete_owned_club('00000000-0000-0000-0000-0000000430ca')),
  0, '043: the owner''s call succeeds, and returns no object paths for a club that carries no images');

reset role;
select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000430ca'),
  0, '043: the club is gone');
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000043f01'),
  0, '043: ... and with it a PRIVATE ride the owner did not organise — the delete no policy grants them');
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-000000043f01'),
  0, '043: ... that ride''s crew list ...');
select assert_eq((select count(*)::int from ride_messages where ride_id = '00000000-0000-0000-0000-000000043f01'),
  0, '043: ... and its entire chat history, which is the least recoverable thing here');
select assert_eq((select count(*)::int from club_members where club_id = '00000000-0000-0000-0000-0000000430ca'),
  0, '043: every membership row goes');
select assert_eq((select count(*)::int from feed_reads where club_id = '00000000-0000-0000-0000-0000000430ca'),
  0, '043: ... every feed_reads watermark ...');
select assert_eq((select count(*)::int from postcards where id = '00000000-0000-0000-0000-000000043e01'),
  0, '043: ... and another member''s postcard, by the postcards.club_id CASCADE 009 reasoned out and this change only discloses');

-- --------------------------------------------------------------------------
-- 043.4  CONTAINMENT — the only assertion here that fails when the function
--        deletes MORE than it was asked to.
--
--        Every assertion in 043.3 checks that the target's rows are GONE, and
--        all of them go on passing under a WHERE clause that is too broad: a
--        dropped club filter, an ambiguous reference resolved the wrong way, or
--        a plain `delete from rides where is_public = false`. Club B is
--        unrelated to club A in every column and shares no rider with it.
-- --------------------------------------------------------------------------
select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000430cb'),
  1, '043: an unrelated club is untouched by the delete of another one');
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000043f02'),
  1, '043: ... including its PRIVATE ride, which a `delete from rides where is_public = false` would have taken');
select assert_eq((select club_id::text from rides where id = '00000000-0000-0000-0000-000000043f02'),
  '00000000-0000-0000-0000-0000000430cb', '043: ... still attached to its own club rather than SET NULL');
select assert_eq((select count(*)::int from club_members where club_id = '00000000-0000-0000-0000-0000000430cb'),
  3, '043: ... its three membership rows ...');
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-000000043f02'),
  1, '043: ... and that ride''s crew');

-- seed.sql's own clubs are the second containment case, and they cost one line.
select assert_eq((select count(*)::int from clubs where id in (
    '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2',
    '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c5')),
  4, '043: ... and seed.sql''s four clubs, none of which this section ever names');

-- --------------------------------------------------------------------------
-- 043.5  The zombie invariant, stated globally rather than over this section's
--        own ids: NO ride anywhere is left detached, private and still carrying
--        a crew. That is the state `rides.club_id ON DELETE SET NULL` produces
--        and the one reason this function exists at all.
-- --------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from rides r
    where r.club_id is null and r.is_public = false
      and exists (select 1 from ride_members m where m.ride_id = r.id)),
  0, '043: no ride ANYWHERE is left with club_id NULL, is_public false and a surviving crew — the zombie SET NULL makes');

set role authenticated;

-- --------------------------------------------------------------------------
-- 043.6  The public club: the private ride goes, the PUBLIC one survives with
--        club_id NULL, and the images come back so the caller can delete the
--        bytes. 032 §2's rule, reused rather than re-derived — deleting a
--        public ride would destroy another rider's content for no reason.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000430a1', false);
select assert_eq(
  (select string_agg(object_path, ' ' order by object_path)
     from public.delete_owned_club('00000000-0000-0000-0000-0000000430cc')),
  'club-avatars/00000000-0000-0000-0000-0000000430a1/43aaaaaa-0000-4000-8000-0000004301aa.jpg'
  || ' ' ||
  'club-covers/00000000-0000-0000-0000-0000000430a1/43bbbbbb-0000-4000-8000-0000004301bb.jpg',
  '043: the call returns the club''s own avatar and cover object paths, both under the OWNER''s uid prefix, so the caller can delete the bytes');

reset role;
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000043f04'),
  0, '043: a PRIVATE ride in a PUBLIC club is a zombie too, so it goes — the predicate is the ride''s own audience');
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000043f03'),
  1, '043: ... while the PUBLIC ride survives its club ...');
select assert_eq((select club_id is null from rides where id = '00000000-0000-0000-0000-000000043f03'),
  true, '043: ... detached by ON DELETE SET NULL, which costs a public ride nothing ...');
select assert_eq((select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-000000043f03'),
  1, '043: ... with its crew row intact');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000004301a', false);
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000043f03'),
  1, '043: and a signed-in rider in no club still READS that surviving ride — the survival is visible, not merely a row');

-- --------------------------------------------------------------------------
-- 043.7  The four standing policies, from the CLIENT direction. The suite has
--        never covered these: the proposal quotes them rather than modifying
--        them, and an unasserted policy is one a later change can widen for
--        free. Club B and its ride carry all of it; nothing here deletes them
--        outside a savepoint.
-- --------------------------------------------------------------------------
savepoint club_writes_043;

select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
update clubs set name = 'Renamed by its owner' where id = '00000000-0000-0000-0000-0000000430cb';
select assert_eq((select name from clubs where id = '00000000-0000-0000-0000-0000000430cb'),
  'Renamed by its owner', '043: a club OWNER can update their own club');

select set_config('test.uid', '00000000-0000-0000-0000-0000000430e1', false);
update clubs set name = 'Renamed by a member' where id = '00000000-0000-0000-0000-0000000430cb';
select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
select assert_eq((select name from clubs where id = '00000000-0000-0000-0000-0000000430cb'),
  'Renamed by its owner', '043: an ordinary MEMBER''s club update matches zero rows and changes nothing');

select set_config('test.uid', '00000000-0000-0000-0000-00000004301a', false);
update clubs set name = 'Renamed by an outsider' where id = '00000000-0000-0000-0000-0000000430cb';
select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
select assert_eq((select name from clubs where id = '00000000-0000-0000-0000-0000000430cb'),
  'Renamed by its owner', '043: ... and a NON-MEMBER''s does the same');

select set_config('test.uid', '00000000-0000-0000-0000-00000004301c', false);
update clubs set name = 'Renamed by a blocked rider' where id = '00000000-0000-0000-0000-0000000430cb';
select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
select assert_eq((select name from clubs where id = '00000000-0000-0000-0000-0000000430cb'),
  'Renamed by its owner', '043: ... and so does a rider the owner has blocked');

-- Blocking is NOT why the line above holds, and asserting it without this reads
-- as though it were. `blocks` appears in no arm of either clubs policy;
-- blocking reaches club surfaces through club_members SELECT and the profiles
-- predicate, and a second copy here could disagree with those.
select assert_eq(
  (select bool_or(coalesce(qual, '') like '%is_blocked%'
               or coalesce(with_check, '') like '%is_blocked%')
     from pg_policies where schemaname = 'public' and tablename = 'clubs'),
  false, '043: no clubs policy names a block predicate in any arm — the blocked rider above is refused as a non-owner, nothing more');

rollback to savepoint club_writes_043;
set role authenticated;

-- Ownership cannot be handed over by a client. **Which LAYER refuses it changed
-- with 045, and the label had to change with it**: `assert_denied` recognises
-- 42501 and nothing else, and a missing column grant and a failed `with check`
-- are both 42501 — so this line would have gone on passing while claiming the
-- `with check` did the work, which stopped being what is measured. 045 revokes
-- UPDATE on `clubs.owner_id`, so the grant now refuses first and the policy is
-- never reached. The conjunct is still there and is pinned as text below, so
-- both layers stay asserted rather than one silently replacing the other.
-- The consequence is unchanged: an owner cannot leave a club they own.
select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
select assert_denied($$update clubs set owner_id = '00000000-0000-0000-0000-0000000430e1'
                        where id = '00000000-0000-0000-0000-0000000430cb'$$,
  '043/045: an owner cannot reassign their club — the missing UPDATE grant on owner_id refuses it first (045), and the WITH CHECK would refuse it anyway');

-- --------------------------------------------------------------------------
-- 043.8  The rides half, and the middle assertion is the measurement the whole
--        migration rests on: a club owner holds NO grant to delete a member's
--        ride in their own club.
-- --------------------------------------------------------------------------
savepoint ride_writes_043;

select set_config('test.uid', '00000000-0000-0000-0000-0000000430e1', false);
update rides set title = 'Renamed by its organizer' where id = '00000000-0000-0000-0000-000000043f02';
select assert_eq((select title from rides where id = '00000000-0000-0000-0000-000000043f02'),
  'Renamed by its organizer', '043: an ORGANIZER can update their own ride');

select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
update rides set title = 'Renamed by the club owner' where id = '00000000-0000-0000-0000-000000043f02';
select assert_eq((select title from rides where id = '00000000-0000-0000-0000-000000043f02'),
  'Renamed by its organizer', '043: the CLUB OWNER cannot update a member''s ride in their own club');

delete from rides where id = '00000000-0000-0000-0000-000000043f02';
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000043f02'),
  1, '043: nor delete it — THE gap delete_owned_club exists for, since for a private club that is every ride');

select set_config('test.uid', '00000000-0000-0000-0000-0000000430e1', false);
delete from rides where id = '00000000-0000-0000-0000-000000043f02';
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000043f02'),
  0, '043: ... while its own organizer can, which is the arm D1 refused to widen');

rollback to savepoint ride_writes_043;
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-0000000430e1', false);
-- Same layer swap as the clubs case above, and the same reason the label moved.
select assert_denied($$update rides set organizer_id = '00000000-0000-0000-0000-0000000430d1'
                        where id = '00000000-0000-0000-0000-000000043f02'$$,
  '043/045: an organizer cannot hand their ride to somebody else — the missing UPDATE grant on organizer_id refuses it first (045), and the WITH CHECK naming auth.uid() would refuse it anyway');

-- What a bare client-side club delete does, asserted rather than argued. This is
-- the state the RPC exists to prevent, so it is worth one savepoint to show it
-- is real: the policy PERMITS the delete, and the wreckage is the ride.
savepoint bare_delete_043;
select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
delete from clubs where id = '00000000-0000-0000-0000-0000000430cb';
reset role;
select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000430cb'),
  0, '043: the standing DELETE policy lets an owner delete their club with a bare client delete ...');
select assert_eq(
  (select count(*)::int from rides r
    where r.id = '00000000-0000-0000-0000-000000043f02'
      and r.club_id is null and r.is_public = false
      and exists (select 1 from ride_members m where m.ride_id = r.id)),
  1, '043: ... and THAT is the zombie: detached, private, crew intact, visible to its organizer alone');
rollback to savepoint bare_delete_043;
set role authenticated;

-- --------------------------------------------------------------------------
-- 043.9  The `admin` row. **This pins CURRENT POLICY TEXT, not a product rule.**
--        Neither clubs policy consults club_members in any arm, so an admin row
--        changes nothing today. Whether `admin` SHOULD carry edit rights once
--        the role can be held at all is design.md Q3 — open, product owner's —
--        and a label reading "admins may not edit clubs" would ship that
--        undecided answer as a green test.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000004301b', false);
select assert_eq((select role from club_members
                   where club_id = '00000000-0000-0000-0000-0000000430cb'
                     and user_id = '00000000-0000-0000-0000-00000004301b'),
  'admin', '043: the admin row exists, seeded as the table owner because 019 admits only `member` through the client');

update clubs set name = 'Renamed by an admin' where id = '00000000-0000-0000-0000-0000000430cb';
delete from clubs where id = '00000000-0000-0000-0000-0000000430cb';
select set_config('test.uid', '00000000-0000-0000-0000-0000000430d1', false);
select assert_eq((select name from clubs where id = '00000000-0000-0000-0000-0000000430cb'),
  'Containment MC', '043: admin role confers no club write under current policies — UPDATE matches zero rows');
select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000000430cb'),
  1, '043: admin role confers no club write under current policies — DELETE matches zero rows');

-- Why, rather than only that. This is the line that would have to change first.
select assert_eq(
  (select bool_or(coalesce(qual, '') like '%club_members%'
               or coalesce(with_check, '') like '%club_members%')
     from pg_policies
    where schemaname = 'public' and tablename = 'clubs' and cmd in ('UPDATE', 'DELETE')),
  false, '043: neither the clubs UPDATE nor DELETE policy consults club_members in any arm, which is WHY the role changes nothing');

-- --------------------------------------------------------------------------
-- 043.10  propagate_club_privacy_to_rides in BOTH directions. The 022 section
--         already covers the downgrade; the assertion that has never existed is
--         that flipping back does NOT restore, because that is the half a
--         confirmation screen has to disclose and the half nobody would guess.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000430a1', false);
select assert_eq((select is_public from rides where id = '00000000-0000-0000-0000-000000043f05'),
  true, '043: a public club''s ride starts public ...');

update clubs set is_public = false where id = '00000000-0000-0000-0000-0000000430cd';
select assert_eq((select is_public from rides where id = '00000000-0000-0000-0000-000000043f05'),
  false, '043: ... turning the club private brings it down, even though the owner does not organise it ...');

update clubs set is_public = true where id = '00000000-0000-0000-0000-0000000430cd';
select assert_eq((select is_public from rides where id = '00000000-0000-0000-0000-000000043f05'),
  false, '043: ... and turning the club public again does NOT restore it — the trigger is one-directional and the information is gone');

select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-000000043f05'),
  1, '043: ... while the crew keep their ride_members rows throughout — losing sight of a ride is the policy working, not an RSVP being deleted');

rollback to savepoint owned_club_043;


-- ===========================================================================
-- 017. The EX-MEMBER ORGANIZER, and the two exits the UI now promises.
--      PD-101 task 1.4b. The migration constrained is `017`, not `043`: it is
--      that file's UPDATE policy, whose own header recorded this consequence
--      and closed with "nothing edits rides today (there is no edit UI
--      anywhere) ... revisit it with whatever screen adds one." The screen
--      exists as of PD-101, so this is that revisit.
-- ===========================================================================

\echo ''
\echo '# An organizer who left the club can no longer edit the ride, and has two exits (017)'

-- `WITH CHECK` is evaluated on the post-image of EVERY update, not only ones
-- that name `club_id`. So an organizer who left the ride's club is refused on a
-- save that changes nothing but the title: `USING` passes (they are still
-- `organizer_id`), the post-image fails `private.is_club_member(club_id)`.
--
-- `updateRide` now tells that rider, in copy, that they may "delete the ride,
-- or make it public and remove it from the club". **Those two sentences are
-- claims about policy, and until this section nothing pinned either.** Relax
-- the `WITH CHECK`, or add a membership arm to the DELETE policy, and the
-- message silently becomes wrong with no test going red.
--
-- Self-contained fixtures, per the README's rule that a section adding them
-- owns them — and because seeding this on `seed.sql`'s riders would move
-- expected values earlier in the file, and because an earlier section deletes
-- seed rows outside any savepoint.
--
--   17a1a1  organizer of the ride, member of the club, and the rider who leaves
--   17b1b1  owner of the private club, and the ride's one crew member
savepoint ex_member_017;

reset role;
set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000017a1a1', 'exmemberorganizer@example.com'),
  ('00000000-0000-0000-0000-00000017b1b1', 'exmemberclubowner@example.com');
reset role;

update profiles p
   set username                = v.username,
       location                = 'Groningen',
       onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
       terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  from (values
    ('00000000-0000-0000-0000-00000017a1a1'::uuid, 'exmemberorganizer'),
    ('00000000-0000-0000-0000-00000017b1b1'::uuid, 'exmemberclubowner')
  ) v (id, username)
 where p.id = v.id;

-- PRIVATE, which is the case that bites: 022 pins its rides to
-- `is_public = false`, so the ex-member cannot simply widen the audience and
-- leave the ride attached — detaching is half of the second exit, not a
-- decoration on it.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-00000017c1c1', 'Left Behind MC', false,
   '00000000-0000-0000-0000-00000017b1b1');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-00000017c1c1', '00000000-0000-0000-0000-00000017b1b1', 'owner'),
  ('00000000-0000-0000-0000-00000017c1c1', '00000000-0000-0000-0000-00000017a1a1', 'member');
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-00000017d1d1', 'Ride I Organised', 'The Weir',
   timestamptz '2026-09-01 09:00:00+00', false,
   '00000000-0000-0000-0000-00000017c1c1', '00000000-0000-0000-0000-00000017a1a1');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-00000017d1d1', '00000000-0000-0000-0000-00000017b1b1', 'going');

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 017 ex-member assertions run as authenticated, or they prove nothing');

-- --------------------------------------------------------------------------
-- 017.1  THE PRECONDITION, and without it the whole case passes vacuously.
--        A refusal proves nothing if the rider could never edit this ride in
--        the first place — that would pass just as green against a policy that
--        refuses everybody. So the same rider makes the same edit WHILE STILL
--        A MEMBER, and it has to succeed.
--
--        Written as the statement PostgREST actually emits: `updateRide` sends
--        all eight editable columns and `.select('id')`, so the SET list and
--        the RETURNING are both part of what Postgres plans and checks. A
--        hand-narrowed `set title = ...` would be a different statement — the
--        README's `addCountry` lesson.
--
--        **A must-succeed UPDATE cannot go through `assert_allowed`** — that
--        helper refuses UPDATE and DELETE on purpose, because RLS filters them
--        to zero rows rather than raising and it would pass against a policy
--        permitting nothing. So the shape is its documented replacement: run
--        the statement, then assert the effect. One consequence for whoever
--        reads a red CI log: if the policy *refuses* one of these, it surfaces
--        as an unlabelled `new row violates row-level security policy` at the
--        statement rather than as a `FAIL <label>`, and the claim that broke is
--        the assertion immediately below it.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000017a1a1', false);
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-00000017c1c1'
                     and user_id = '00000000-0000-0000-0000-00000017a1a1'),
  1, '017: the organizer starts as a member of the ride''s club ...');

update rides
   set title             = 'Edited while still a member',
       description       = null,
       route_description = null,
       meeting_point     = 'The Weir',
       departure_at      = timestamptz '2026-09-01 09:00:00+00',
       max_riders        = null,
       is_public         = false,
       club_id           = '00000000-0000-0000-0000-00000017c1c1'
 where id = '00000000-0000-0000-0000-00000017d1d1'
returning id;
select assert_eq((select title from rides where id = '00000000-0000-0000-0000-00000017d1d1'),
  'Edited while still a member',
  '017: ... and CAN edit it while the membership row exists — the precondition without which 017.2 passes against a policy that refuses everyone');

-- --------------------------------------------------------------------------
-- 017.2  Leaving, then the refusal. The membership row is removed by
--        `leaveClub`'s OWN statement, through the policy, rather than deleted
--        as the table owner — so what changes between 017.1 and 017.3 is a
--        thing a rider can actually do from the app.
-- --------------------------------------------------------------------------
delete from club_members
 where club_id = '00000000-0000-0000-0000-00000017c1c1'
   and user_id = '00000000-0000-0000-0000-00000017a1a1';
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-00000017c1c1'
                     and user_id = '00000000-0000-0000-0000-00000017a1a1'),
  0, '017: leaveClub''s own statement removes the membership row, under the policy rather than by fiat');

-- --------------------------------------------------------------------------
-- 017.3  THE REFUSAL. 42501 wears two meanings in this suite and the label has
--        to say which: this is **a policy refusing a row on the post-image**,
--        not a grant refusing a column (which fires at plan time, before any
--        predicate) and not a `USING` miss (which filters to zero rows and
--        raises nothing at all). 017.4 asserts the row is still visible and
--        017.5 shows what the silent kind looks like, so all three readings
--        are separated rather than assumed.
--
--        Note the statement changes nothing but the title: `club_id` and
--        `is_public` are re-sent at their current values, which is exactly the
--        save an organizer makes when correcting a typo.
-- --------------------------------------------------------------------------
select assert_denied($$
  update rides
     set title             = 'A typo fix that touches no club field',
         description       = null,
         route_description = null,
         meeting_point     = 'The Weir',
         departure_at      = timestamptz '2026-09-01 09:00:00+00',
         max_riders        = null,
         is_public         = false,
         club_id           = '00000000-0000-0000-0000-00000017c1c1'
   where id = '00000000-0000-0000-0000-00000017d1d1'
  returning id$$,
  '017: an ex-member organizer''s UPDATE is refused 42501 by the WITH CHECK on the post-image — a POLICY refusing a row, not a grant refusing a column, and it fires on a save that touches no club field (PD-101 1.4b)');

-- --------------------------------------------------------------------------
-- 017.4  Why that is a WITH CHECK failure and not an unreachable row: the
--        organizer arm of the SELECT policy still hands them the ride, and the
--        USING clause of the UPDATE policy is the same test. So the row is
--        reachable and the refusal is about what it would BECOME.
-- --------------------------------------------------------------------------
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-00000017d1d1'),
  1, '017: ... while the ex-member organizer can still SEE the ride — so the refusal is the post-image, not an invisible row');
select assert_eq((select count(*)::int from clubs where id = '00000000-0000-0000-0000-00000017c1c1'),
  0, '017: ... and can no longer see the private club at all, which is why re-joining is not a third exit');

-- --------------------------------------------------------------------------
-- 017.5  The other refusal, for contrast: a non-organizer is filtered by
--        USING and gets NO error. That is the branch `updateRide` reports as
--        "not yours to edit"; reporting it as the ex-member message, or the
--        ex-member case as this one, is the mix-up these two assertions pin.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000017b1b1', false);
update rides
   set title             = 'Renamed by the club owner',
       description       = null,
       route_description = null,
       meeting_point     = 'The Weir',
       departure_at      = timestamptz '2026-09-01 09:00:00+00',
       max_riders        = null,
       is_public         = false,
       club_id           = '00000000-0000-0000-0000-00000017c1c1'
 where id = '00000000-0000-0000-0000-00000017d1d1'
returning id;
select assert_eq((select title from rides where id = '00000000-0000-0000-0000-00000017d1d1'),
  'Edited while still a member',
  '017: a non-organizer''s UPDATE raises nothing and changes nothing — USING filters it to zero rows, which is a different refusal from 017.3 wearing no SQLSTATE at all');

-- --------------------------------------------------------------------------
-- 017.6  EXIT TWO, asserted first because it leaves the ride in place: make it
--        public and detach it, in ONE statement, which is what the edit form
--        sends. Both halves are required — 022 refuses a public ride in a
--        private club, and the WITH CHECK refuses a club the caller has left —
--        so neither field alone gets the rider out.
-- --------------------------------------------------------------------------
savepoint ex_member_detach_017;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000017a1a1', false);

update rides
   set title             = 'Ride I Organised',
       description       = null,
       route_description = null,
       meeting_point     = 'The Weir',
       departure_at      = timestamptz '2026-09-01 09:00:00+00',
       max_riders        = null,
       is_public         = true,
       club_id           = null
 where id = '00000000-0000-0000-0000-00000017d1d1'
returning id;
select assert_eq((select is_public and club_id is null from rides
                   where id = '00000000-0000-0000-0000-00000017d1d1'),
  true, '017: exit two — publishing and detaching in one statement SUCCEEDS, which is the second remedy updateRide''s message names');
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-00000017d1d1'),
  1, '017: ... and the crew row survives it, so taking the exit does not silently drop the rider''s RSVPs');

rollback to savepoint ex_member_detach_017;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000017a1a1', false);

-- --------------------------------------------------------------------------
-- 017.7  EXIT ONE, from the same refused state: the DELETE policy is
--        `auth.uid() = organizer_id` with no membership arm, so leaving the
--        club costs the rider the edit and not the ride. `deleteRide` emits
--        `.delete().eq('id', …).select('id')`, and the RETURNING is part of it
--        — a DELETE ... RETURNING is filtered by the SELECT policy too.
-- --------------------------------------------------------------------------
savepoint ex_member_delete_017;

delete from rides where id = '00000000-0000-0000-0000-00000017d1d1' returning id;
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-00000017d1d1'),
  0, '017: exit one — the ex-member organizer CAN still delete the ride, so the first remedy the message offers actually works');

rollback to savepoint ex_member_delete_017;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000017a1a1', false);

-- --------------------------------------------------------------------------
-- 017.8  The policy text the copy depends on, pinned structurally. A migration
--        that relaxes either of these turns `updateRide`'s message into a
--        claim about a rule that no longer exists, and nothing behavioural
--        above would notice: 017.3 would simply stop refusing.
-- --------------------------------------------------------------------------
reset role;
select assert_eq(
  (select with_check like '%is_club_member%' from pg_policies
    where schemaname = 'public' and tablename = 'rides' and cmd = 'UPDATE'),
  true, '017: the rides UPDATE with_check still carries the membership predicate — relaxing it is what would make updateRide''s "you have left this club" message false');
select assert_eq(
  (select qual from pg_policies
    where schemaname = 'public' and tablename = 'rides' and cmd = 'DELETE'),
  '(auth.uid() = organizer_id)',
  '017: ... and the DELETE policy is still organizer-only with no membership arm, which is what holds exit one open');

rollback to savepoint ex_member_017;

\echo ''
\echo '# The feed''s sort key is server-owned — an author cannot pin themselves (044)'

-- --------------------------------------------------------------------------
-- 044.  postcards.created_at is the home feed's SORT KEY and its PAGINATION
--       CURSOR (src/lib/data/postcards.ts orders created_at desc and pages
--       with .lt). While `authenticated` could write it, an author could pin
--       their own postcard to the top of every feed permanently and push it
--       outside every later cursor page — PD-163. 044 takes the grant away on
--       BOTH verbs, and does the same for `updated_at`.
--
--       Asserted BY ROLE with has_column_privilege, never by attempting the
--       write: this suite runs as the table owner, for whom no column
--       privilege is a barrier, so a write that succeeded here would prove
--       nothing and a write that failed would prove something else. 031 is
--       where that lesson is written down.
-- --------------------------------------------------------------------------
reset role;

-- INSERT, column by column. 041 made UPDATE column-level and left INSERT at
-- table level, so before 044 `created_at` was insertable even though it was not
-- in any grant list — the half a reader of 041 alone would not predict.
--
-- **The exact list below grew from six to eleven in 064, and that is the point
-- of asserting it exactly rather than per column.** 064 adds the five capture
-- columns, and this assertion is what makes any future widening of INSERT a
-- deliberate edit to a test rather than a silent one — including the shape 044
-- and 046 both warn about, where an absolute re-grant written from a document
-- instead of from the database reinstates a column somebody removed on purpose.
-- What must NEVER come back here is `created_at` or `updated_at`.
select assert_eq(has_table_privilege('authenticated', 'public.postcards', 'insert'),
  false, '044: authenticated holds no TABLE-level INSERT grant on postcards — 044 made it column-level, as 041 did for UPDATE');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'created_at', 'INSERT'),
  false, '044: ... so a postcard cannot be BORN dated in the year 3000 either, which the UPDATE half alone would not have stopped');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'updated_at', 'INSERT'),
  false, '044: ... nor born claiming an edit that never happened — nothing stamped updated_at on INSERT');
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and grantee = 'authenticated' and privilege_type = 'INSERT'),
  'author_id,caption,club_id,id,image_path,ride_id,taken_at,taken_at_offset_minutes,taken_country_code,taken_latitude,taken_location_precision,taken_longitude,taken_place_name',
  '044/064/072/073/074: the INSERT grant list is exact, and neither timestamp 044 closed is among the thirteen columns on it — 072 added two place columns to 064''s eleven, 073 dropped the provider id again, and 074 added the country');

-- The whole migration in one line. **Deliberately a RESTATEMENT** and placed
-- after the four it summarises rather than before them: all four combinations
-- it covers are asserted individually above and in 041's block, so a mutation
-- reaches one of those first and this one can only go red behind it. It earns
-- its place as the sentence a future session greps for, not as unique coverage
-- — and putting it first would have made the specific failures unreachable
-- instead, which is the worse of the two.
select assert_eq(
  (select bool_or(has_column_privilege('authenticated', 'public.postcards', c, p))
     from unnest(array['created_at', 'updated_at']) c,
          unnest(array['INSERT', 'UPDATE']) p),
  false, '044: authenticated can write NEITHER timestamp on postcards, by NEITHER verb — the feed cannot be pinned');

-- What must survive, or the fix has broken the product instead of the hole.
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'created_at', 'SELECT'),
  true, '044: created_at is still READABLE — the feed sorts and pages on it, so revoking select would empty the home screen');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'caption', 'INSERT'),
  true, '044: ... and caption is still insertable, so createPostcard''s four-column insert still lands');
select assert_eq(has_table_privilege('authenticated', 'public.postcards', 'delete'),
  true, '044: ... and DELETE is untouched at table level — deleting your own postcard is the only remedy a rider has');

-- The default is the VALUE and the grant is the GUARANTEE — 034 §4b's sentence.
-- Losing the default now costs every insert a NOT NULL violation rather than a
-- wrong timestamp, because nothing else can supply one.
select assert_eq(
  (select string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ',' order by a.attname)
     from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.postcards'::regclass
      and a.attname in ('created_at', 'updated_at')),
  'created_at=now(),updated_at=now()',
  '044: both timestamps still DEFAULT now() — the grant reserves the column, the default is what fills it');

-- 007 revoked the last of anon's reach; decision #1 keeps it that way. Named by
-- role on every verb rather than counted, because a per-column grant does not
-- appear in role_table_grants at all — 034 §4b's trap.
select assert_eq(
  (select bool_or(has_column_privilege('anon', 'public.postcards', c, p))
     from unnest(array['created_at', 'updated_at']) c,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p),
  false, '044: anon holds nothing on either postcards timestamp, in any verb');

-- 044 is a GRANT change and nothing else. The UPDATE policy is the one it could
-- plausibly have been "tidied" into, so it is pinned as text rather than
-- described — captured from letsride-dev with 044 applied.
select assert_eq(
  (select md5(qual || with_check) from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'UPDATE'),
  'ac4c46eb256cc388059ad524be0b90ae',
  '044: the postcards UPDATE policy is byte-identical — 044 moved grants and touched no policy');

-- --------------------------------------------------------------------------
-- 044.b  The trigger still stamps updated_at, even though `authenticated` no
--        longer holds UPDATE on that column. This is the claim that makes §2
--        free rather than a regression, and it is the one worth measuring
--        BEHAVIOURALLY: a column privilege gates the statement's SET list,
--        while a BEFORE trigger assigns to NEW after that check. Getting it
--        backwards would mean every caption edit silently stopped recording
--        when it happened.
--
--        Run as `authenticated` with the suite's own identity idiom
--        (set_config('test.uid', ...)). Setting request.jwt.claims here is read
--        by nothing — auth.uid() is redefined in harness.sql to read test.uid —
--        and a positive assertion written that way passes while proving
--        nothing, which is exactly what this one would do.
-- --------------------------------------------------------------------------
savepoint stamp_044;

-- Its own fixture rather than a seed row, aged to 2020 so that "moved" and
-- "did not move" are distinguishable instead of both reading as now(). Two
-- reasons it is written here rather than reusing `e1`:
--
--   * `e1` is DELETED at rls_test.sql:1646, outside any savepoint, to prove the
--     comment/hide/report cascade. Every fixture this section could borrow is
--     one an earlier section may have consumed, and a missing row makes an
--     assertion read NULL rather than fail for its own reason.
--   * The ageing is done at INSERT, not by a later UPDATE, because
--     `postcards_set_updated_at` fires on the OWNER's update too — `set
--     updated_at = '2020-01-01'` would be overwritten with now() on the spot and
--     the assertion below would pass against a row that was never aged, proving
--     nothing. A before/after comparison cannot substitute either: `now()` is
--     TRANSACTION time and this whole suite is one transaction, so both
--     readings would be the same instant.
--
-- Inserted as the owner, which is also what lets it name both timestamps at all.
reset role;
insert into postcards (id, author_id, club_id, image_path, caption, created_at, updated_at)
values ('00000000-0000-0000-0000-00000044e001', '00000000-0000-0000-0000-00000000000a',
        null, 'postcards/00000000-0000-0000-0000-00000000000a/44440000-0000-4000-8000-000000000044.jpg',
        'Aged on purpose', '2020-01-01', '2020-01-01');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

update postcards set caption = 'Aged on purpose, edited'
 where id = '00000000-0000-0000-0000-00000044e001';

select assert_eq(
  (select caption from postcards where id = '00000000-0000-0000-0000-00000044e001'),
  'Aged on purpose, edited',
  '044: an author can still edit their own caption — the grant that survived is the one the app actually uses');
select assert_eq(
  (select updated_at > '2021-01-01'::timestamptz from postcards
    where id = '00000000-0000-0000-0000-00000044e001'),
  true, '044: ... and postcards_set_updated_at STILL stamps updated_at off its aged 2020 value, despite authenticated holding no UPDATE grant on it — a column privilege gates the SET list, not what a BEFORE trigger assigns');
select assert_eq(
  (select created_at = '2020-01-01'::timestamptz from postcards
    where id = '00000000-0000-0000-0000-00000044e001'),
  true, '044: ... while created_at is carried through at its aged value, because no trigger writes it and no grant admits it');

rollback to savepoint stamp_044;
reset role;

\echo ''
\echo '# rides and clubs: created_at is server-owned, ownership needs a grant too (045)'

-- --------------------------------------------------------------------------
-- 045.  The other half of PD-163. Both tables were still at the pre-041 shape
--       — everything table-level, no column grants at all — so `created_at`
--       was writable on both verbs and `id`/`organizer_id`/`owner_id` on
--       UPDATE. `clubs.created_at` was a LIVE pinning vector, because
--       getClubsToExplore orders `created_at desc`; `rides.created_at` was not
--       (that list sorts `departure_at`) and is closed anyway.
--
--       Grant questions are asked BY ROLE with has_column_privilege. The suite
--       runs as the table owner, for whom no column privilege is a barrier, so
--       attempting the write would prove nothing — 031's lesson.
-- --------------------------------------------------------------------------
reset role;

-- Neither table has an updated_at column, so 044's trigger-vs-grant question
-- does not arise here. Asserted rather than described, because "we checked" is
-- exactly the claim a later session would re-derive wrongly from 044's shape.
select assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name in ('rides', 'clubs')
      and column_name = 'updated_at'),
  0, '045: neither rides nor clubs has an updated_at column at all — 044''s trigger-vs-grant finding has nothing to apply to here');

-- ---- rides -------------------------------------------------------------
select assert_eq(has_table_privilege('authenticated', 'public.rides', 'insert'),
  false, '045: authenticated holds no TABLE-level INSERT grant on rides — it is column-level now');
select assert_eq(has_table_privilege('authenticated', 'public.rides', 'update'),
  false, '045: ... nor a TABLE-level UPDATE grant on rides');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'created_at', 'INSERT'),
  false, '045: a ride cannot be created with a chosen created_at');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'created_at', 'UPDATE'),
  false, '045: ... nor rewritten to one afterwards');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'created_at', 'SELECT'),
  true, '045: ... while staying readable, because the ride card renders it');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'organizer_id', 'UPDATE'),
  false, '045: rides.organizer_id holds NO update grant — a hand-off is now refused by the grant as well as by the WITH CHECK, so relaxing that policy for an unrelated feature cannot reopen it silently');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'organizer_id', 'INSERT'),
  true, '045: ... but IS insertable, or createRide could not author a ride as its organizer');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'id', 'UPDATE'),
  false, '045: rides.id holds no update grant — re-keying your own row buys nothing');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'id', 'INSERT'),
  true, '045: ... and IS insertable, for the client-generated-UUID convention 034 and 044 both keep');

-- The exact column sets. These are what catch a LATER migration adding a column
-- to either table and handing it a grant by accident — the individual
-- assertions above cannot, because nobody writes one for a column that does not
-- exist yet.
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'rides'
      and grantee = 'authenticated' and privilege_type = 'INSERT'),
  'club_id,departure_at,description,id,is_public,latitude,longitude,max_riders,meeting_point,organizer_id,route_description,start_place_id,title',
  '045/067: exactly thirteen columns of rides hold INSERT, and created_at is not among them — 067 added the three a pick is made of, and deliberately NOT geocode_confidence');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'geocode_confidence', 'INSERT'),
  false, '067: geocode_confidence is the one location column with no INSERT grant — no client produces a vendor score, so a rider cannot author the geocoded arm at create time at all');
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'rides'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'club_id,departure_at,description,geocode_confidence,is_public,latitude,longitude,map_card_path,map_detail_path,max_riders,meeting_point,route_description,start_place_id,title',
  '045/051/067: exactly fourteen columns of rides hold UPDATE — created_at, id and organizer_id are still not among them, the five 051 added ARE, and 067 added start_place_id so a rider can re-pick or clear');

-- ---- clubs -------------------------------------------------------------
select assert_eq(has_table_privilege('authenticated', 'public.clubs', 'insert'),
  false, '045: authenticated holds no TABLE-level INSERT grant on clubs');
select assert_eq(has_table_privilege('authenticated', 'public.clubs', 'update'),
  false, '045: ... nor a TABLE-level UPDATE grant on clubs');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'created_at', 'INSERT'),
  false, '045: a club cannot be created with a chosen created_at — THE live pinning vector, since getClubsToExplore orders created_at desc');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'created_at', 'UPDATE'),
  false, '045: ... nor floated to the top of Explore afterwards by rewriting it');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'created_at', 'SELECT'),
  true, '045: ... while staying readable, because Explore SORTS on it');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'owner_id', 'UPDATE'),
  false, '045: clubs.owner_id holds NO update grant — same second lock as rides.organizer_id');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'owner_id', 'INSERT'),
  true, '045: ... but IS insertable, or createClub could not author a club as its owner');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'id', 'UPDATE'),
  false, '045: clubs.id holds no update grant');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'id', 'INSERT'),
  true, '045: ... and IS insertable, same convention as rides.id');

select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'clubs'
      and grantee = 'authenticated' and privilege_type = 'INSERT'),
  'avatar_path,cover_image_path,description,id,is_public,latitude,location_name,location_place_id,longitude,name,owner_id',
  '045/066: exactly eleven columns of clubs hold INSERT — the four 066 added ARE among them, and created_at still is not');
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'clubs'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'avatar_path,cover_image_path,description,is_public,latitude,location_name,location_place_id,longitude,name',
  '045/066: exactly nine columns of clubs hold UPDATE — the four 066 added ARE among them, and created_at, id and owner_id still are not');

-- What must survive on both tables, or the fix broke the product.
select assert_eq(
  (select bool_and(has_table_privilege('authenticated', t, p))
     from unnest(array['public.rides', 'public.clubs']) t,
          unnest(array['select', 'delete']) p),
  true, '045: SELECT and DELETE stay TABLE-level on both — deleting your own ride or club is untouched');

-- The default is the value; the grant is the guarantee. Losing the default now
-- costs every insert a NOT NULL violation rather than a wrong timestamp.
select assert_eq(
  (select string_agg(c.relname || '=' || pg_get_expr(d.adbin, d.adrelid), ',' order by c.relname)
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where c.relname in ('rides', 'clubs') and a.attname = 'created_at'),
  'clubs=now(),rides=now()',
  '045: created_at still DEFAULTs now() on both tables');

select assert_eq(
  (select bool_or(has_column_privilege('anon', 'public.' || t, 'created_at', p))
     from unnest(array['rides', 'clubs']) t,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p),
  false, '045: anon holds nothing on either created_at, in any verb');

-- **The policy layer, pinned as text.** 043's two ownership assertions now trip
-- on the grant and never reach the WITH CHECK, so without these two the policy
-- half would be untested while those labels still mentioned it. This is the
-- pair that keeps both locks measured.
select assert_eq(
  (select with_check from pg_policies
    where schemaname = 'public' and tablename = 'clubs' and cmd = 'UPDATE'),
  '(auth.uid() = owner_id)',
  '045: the clubs UPDATE with_check still pins owner_id to auth.uid() — the lock 043''s assert_denied no longer reaches');
-- **Exact text, not LIKE.** The first draft of this line matched
-- `'%auth.uid() = organizer_id%'`, which survives the precise relaxation 045's
-- header names as foreseeable — ORing a club-admin arm in beside it — because
-- the substring is still there. The label would have stayed green while
-- "still pins organizer_id" stopped being true, which is the 043 defect this
-- pair of assertions was written to fix, reproduced inside the fix. The clubs
-- sibling above already pinned full text; both do now.
select assert_eq(
  (select with_check from pg_policies
    where schemaname = 'public' and tablename = 'rides' and cmd = 'UPDATE'),
  '((auth.uid() = organizer_id) AND ((club_id IS NULL) OR private.is_club_member(club_id)))',
  '045: ... and the rides UPDATE with_check is exactly organizer_id AND the club-membership conjunct — ORing an admin arm in beside it must go red here');

-- --------------------------------------------------------------------------
-- 045.b  The four live write paths, as their actions actually emit them.
--        `updateRide` and `updateClub` shipped in PD-101 hours before 045, so
--        unlike 044 this migration lands on a table with a live UPDATE path —
--        which is why every column the four name is exercised here rather than
--        argued in the header. Column lists read out of src/lib/actions/ and
--        the Zod schemas they spread; two of the four ARE spreads, whatever
--        their docstrings say.
--
--        Run as `authenticated` with the suite's own identity idiom
--        (set_config('test.uid', ...)). request.jwt.claims is read by nothing
--        here — auth.uid() is redefined in harness.sql — so a positive
--        assertion written that way would pass while proving nothing.
-- --------------------------------------------------------------------------
savepoint write_paths_045;

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- createRide: the spread of rideSchema, plus departure_at and organizer_id.
insert into rides (title, description, route_description, meeting_point,
                   departure_at, max_riders, is_public, club_id, organizer_id)
values ('045 ride', 'desc', 'route', 'Meeting point', now() + interval '7 days',
        10, true, null, '00000000-0000-0000-0000-00000000000a');
select assert_eq((select count(*)::int from rides where title = '045 ride'),
  1, '045: createRide''s exact nine-column insert still lands');
select assert_eq(
  (select created_at > now() - interval '1 minute' from rides where title = '045 ride'),
  true, '045: ... and its created_at came from the default, which is the only place it can now come from');

-- updateRide: the explicit eight.
update rides set title = '045 ride edited', description = 'desc2',
                 route_description = 'route2', meeting_point = 'Elsewhere',
                 departure_at = now() + interval '8 days', max_riders = 12,
                 is_public = true, club_id = null
 where title = '045 ride';
select assert_eq((select count(*)::int from rides where title = '045 ride edited'),
  1, '045: updateRide''s exact eight-column update still lands');

-- createClub: the spread of clubSchema, plus owner_id. The two path columns are
-- named as NULL on purpose — naming a column in the list needs the privilege
-- whatever the value is, so this measures the grant without dragging in 016's
-- path CHECK.
insert into clubs (name, description, is_public, avatar_path, cover_image_path, owner_id)
values ('045 club', 'desc', true, null, null, '00000000-0000-0000-0000-00000000000a');
select assert_eq((select count(*)::int from clubs where name = '045 club'),
  1, '045: createClub''s exact six-column insert still lands');

-- updateClub: the explicit five.
update clubs set name = '045 club edited', description = 'desc2', is_public = true,
                 avatar_path = null, cover_image_path = null
 where name = '045 club';
select assert_eq((select count(*)::int from clubs where name = '045 club edited'),
  1, '045: updateClub''s exact five-column update still lands');

-- And the writes the grants exist to refuse, in the same four shapes.
select assert_denied($$insert into rides (title, meeting_point, departure_at, is_public,
                                          organizer_id, created_at)
                       values ('pinned', 'x', now(), true,
                               '00000000-0000-0000-0000-00000000000a', '3000-01-01')$$,
  '045: a ride cannot be INSERTED with a chosen created_at');
select assert_denied($$update rides set created_at = '3000-01-01'
                        where title = '045 ride edited'$$,
  '045: nor can an organizer rewrite it afterwards');
select assert_denied($$insert into clubs (name, is_public, owner_id, created_at)
                       values ('pinned', true, '00000000-0000-0000-0000-00000000000a', '3000-01-01')$$,
  '045: a club cannot be INSERTED with a chosen created_at — this is the Explore pin');
select assert_denied($$update clubs set created_at = '3000-01-01'
                        where name = '045 club edited'$$,
  '045: nor can an owner float it to the top of Explore afterwards');

rollback to savepoint write_paths_045;
reset role;

\echo ''
\echo '# A byline cannot be reassigned, by grant as well as by policy (046)'

-- --------------------------------------------------------------------------
-- 046.  045 argued that ownership refused by a policy conjunct ALONE is one
--       unrelated `with check` edit away from being reachable, and revoked
--       rides.organizer_id / clubs.owner_id on that ground. 044 had kept
--       postcards.author_id on the opposite reasoning, hours earlier on the
--       same branch. 046 applies 045's argument back.
--
--       Nothing was exposed — the conjunct really does refuse the hand-off, and
--       the assertion at rls_test.sql:~697 has proved that since 009. What
--       changes is that TWO layers now refuse it, and that the branch stops
--       containing a principle and a counter-example to it.
-- --------------------------------------------------------------------------
reset role;

select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'author_id', 'UPDATE'),
  false, '046: a byline cannot be reassigned — the grant refuses it, not only the with_check');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'author_id', 'INSERT'),
  true, '046: ... but IS insertable, because every INSERT policy here is `<owner column> = auth.uid()` and the client has to send it — you may declare authorship of a new row and never reassign an existing one');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'id', 'UPDATE'),
  false, '046: postcards.id is not re-keyable either, matching rides.id and clubs.id');

-- The two the rule must NOT over-fire on. `club_id` is the one that would go if
-- "sensitive column" were the test instead of "no legitimate client update":
-- 041 §D3 records it as updatable BY DESIGN, and its with_check conjunct is the
-- only thing stopping a photo being moved into a private club — revoking the
-- grant would delete a designed capability and make that conjunct dead code.
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'club_id', 'UPDATE'),
  true, '046: club_id KEEPS its update grant — the audience is meant to be changeable, and 041''s with_check conjunct is what guards it');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'caption', 'UPDATE'),
  true, '046: ... and caption too, or the one postcard edit the design draws would stop working');

-- The ownership columns across all three tables, in one line. This is the claim
-- 044 and 045 disagreed about, so it is worth stating once where a future
-- session greps for it rather than leaving it spread over three files.
select assert_eq(
  (select bool_or(has_column_privilege('authenticated', t, c, 'UPDATE'))
     from (values ('public.postcards', 'author_id'),
                  ('public.rides', 'organizer_id'),
                  ('public.clubs', 'owner_id')) v(t, c)),
  false, '046: NO ownership column on postcards, rides or clubs holds an UPDATE grant — one rule, three tables, after 044 and 045 disagreed about it');
select assert_eq(
  (select bool_and(has_column_privilege('authenticated', t, c, 'INSERT'))
     from (values ('public.postcards', 'author_id'),
                  ('public.rides', 'organizer_id'),
                  ('public.clubs', 'owner_id')) v(t, c)),
  true, '046: ... while all three stay INSERTable, which is the asymmetry rather than an inconsistency');

\echo ''
\echo '# RLS does not apply to TRUNCATE, so the grant had to go (047)'

-- --------------------------------------------------------------------------
-- 047.  `authenticated` held TRUNCATE, REFERENCES and TRIGGER on the five
--       tables 001 created — the residue of Supabase's project default
--       `grant all on tables`. RLS never governed TRUNCATE: a policy filters
--       rows, TRUNCATE empties the relation without reading one, so
--       `truncate public.club_members` succeeded as `authenticated` (measured
--       on DEV 2026-08-10 in a rolled-back transaction).
--
--       Not reachable through PostgREST, which has no TRUNCATE verb — and
--       "unreachable through PostgREST" is a property of the API surface, not
--       of the database, which is the whole reason it is closed.
--
--       Grant questions are asked BY ROLE with has_table_privilege. The suite
--       runs as the table owner, for whom no privilege is a barrier, so
--       attempting the TRUNCATE would prove nothing — 031's lesson.
-- --------------------------------------------------------------------------
reset role;

-- The five, one assertion per privilege per table, so a failure names the pair.
select assert_eq(
  (select bool_or(has_table_privilege('authenticated', t, 'TRUNCATE'))
     from unnest(array['public.rides', 'public.clubs', 'public.club_members',
                       'public.ride_members', 'public.profiles']) t),
  false, '047: authenticated cannot TRUNCATE any of the five tables 001 created — RLS would not have stopped it');
select assert_eq(
  (select bool_or(has_table_privilege('authenticated', t, 'REFERENCES'))
     from unnest(array['public.rides', 'public.clubs', 'public.club_members',
                       'public.ride_members', 'public.profiles']) t),
  false, '047: ... nor point a foreign key at them, which is an existence oracle on ids it cannot SELECT');
select assert_eq(
  (select bool_or(has_table_privilege('authenticated', t, 'TRIGGER'))
     from unnest(array['public.rides', 'public.clubs', 'public.club_members',
                       'public.ride_members', 'public.profiles']) t),
  false, '047: ... nor attach a trigger to a table it does not own');

-- The whole-schema sweep. This is what catches a LATER migration creating a
-- table and inheriting the same `grant all` default — the five assertions above
-- cannot, because nobody writes one for a table that does not exist yet.
select assert_eq(
  (select coalesce(string_agg(c.relname, ',' order by c.relname), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'TRUNCATE')
        or has_table_privilege('authenticated', c.oid, 'REFERENCES')
        or has_table_privilege('authenticated', c.oid, 'TRIGGER'))),
  '', '047: NO table in public grants authenticated TRUNCATE, REFERENCES or TRIGGER — swept rather than listed, so a new table inheriting Supabase''s grant-all default shows up here');

-- REFERENCES is also expressible per column, and a column-level grant would not
-- appear in the table-level sweep above.
select assert_eq(
  (select coalesce(string_agg(distinct table_name || '.' || column_name, ','), '')
     from information_schema.column_privileges
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type = 'REFERENCES'),
  '', '047: ... and no COLUMN of any public table grants it either, which the table-level sweep alone would miss');

-- **The anti-vacuity check, and it is the reason 047 is testable at all.**
-- harness.sql used to reproduce Supabase's default as `grant select, insert,
-- update, delete`, which never granted these three — so every assertion above
-- would have passed on a database where the grant had never existed, measuring
-- nothing. It now says `grant all`. This proves the harness still does, by
-- creating a table and reading what the default handed it.
create table public.grant_default_probe_047 (id int);
select assert_eq(has_table_privilege('authenticated', 'public.grant_default_probe_047', 'TRUNCATE'),
  true, '047: a FRESH public table still inherits TRUNCATE from the reproduced Supabase default — so the assertions above measure 047''s revoke rather than a harness that never granted it');
drop table public.grant_default_probe_047;

-- The revoke had to name `authenticated` and not `public`, or it would have
-- stripped the owner and service_role with it. Only the owner half is assertable
-- HERE: harness.sql creates service_role but deliberately grants it no table
-- privileges — "the suite never assumes it, because on the hosted project
-- service_role holds every privilege by Supabase default and an assertion made
-- as service_role would pass for that reason rather than for the intended one".
-- So `has_table_privilege('service_role', ...)` is false on this database by
-- design and true on the hosted one, and asserting it here would fail for an
-- environment reason rather than a real one. That half is verified against DEV
-- in 047's §Verification step 2 instead, which is the split CLAUDE.md's Testing
-- section describes: the suite cannot see Supabase role defaults.
select assert_eq(
  (select bool_and(has_table_privilege('postgres', t, 'TRUNCATE'))
     from unnest(array['public.rides', 'public.clubs', 'public.club_members',
                       'public.ride_members', 'public.profiles']) t),
  true, '047: the owner keeps TRUNCATE on all five — the revoke named authenticated, so a blanket `revoke ... from public` did not go out with it');

-- The DML grants 047 must not have touched. Scoped to SELECT and DELETE
-- because 045 already owns the INSERT/UPDATE column lists on rides and clubs.
select assert_eq(
  (select bool_and(has_table_privilege('authenticated', t, 'SELECT'))
     from unnest(array['public.rides', 'public.clubs', 'public.club_members',
                       'public.ride_members']) t),
  true, '047: SELECT is untouched on the four — profiles is excluded because 025 made its SELECT column-level, so the table-level answer is false and always was');
select assert_eq(
  (select bool_and(has_table_privilege('authenticated', t, 'DELETE'))
     from unnest(array['public.rides', 'public.clubs', 'public.club_members',
                       'public.ride_members']) t),
  true, '047: ... and so is DELETE, so leaving a club or a ride still works');

\echo ''
\echo '# A membership timestamp is not the rider''s to write (048)'

-- --------------------------------------------------------------------------
-- 048.  The third instalment of 044/045/046: a timestamp a list SORTS on must
--       not be writable by the rider it sorts. All three tables started at the
--       pre-041 shape — everything table-level, attacl NULL on every column —
--       so INSERT covered every column on all three and UPDATE covered every
--       column on the two membership tables.
--
--       Both rosters are LIMIT-bounded at 200 with no pagination, so a
--       back-dated joined_at did not merely sort first: it guaranteed a place
--       inside the truncation window and pushed a genuine member out of it.
-- --------------------------------------------------------------------------
reset role;

-- The exact column sets, per table and verb. These are what catch a LATER
-- migration handing one of these tables a new column with a grant by accident.
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcard_comments'
      and grantee = 'authenticated' and privilege_type = 'INSERT'),
  'author_id,body,id,postcard_id',
  '048: exactly four columns of postcard_comments hold INSERT — created_at and updated_at are not among them');
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'club_members'
      and grantee = 'authenticated' and privilege_type = 'INSERT'),
  'club_id,role,user_id',
  '048: exactly three columns of club_members hold INSERT, and joined_at is not among them');
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'club_members'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'club_id,role,user_id',
  '048: ... and exactly the same three hold UPDATE — dead today (there is NO update policy on club_members) but narrowed so a future member-promotion policy cannot inherit joined_at for free');
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'ride_members'
      and grantee = 'authenticated' and privilege_type = 'INSERT'),
  'ride_id,status,user_id',
  '048: exactly three columns of ride_members hold INSERT, and joined_at is not among them');
-- All three are REQUIRED, not tidy: setRideAttendance is an upsert and
-- PostgREST's ON CONFLICT DO UPDATE SET list carries every payload column,
-- including the two conflict columns. Granting `status` alone breaks every
-- repeat RSVP with 42501 — exercised for real in 048.b below.
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'ride_members'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'ride_id,status,user_id',
  '048: ... and the same three hold UPDATE, which is the upsert''s SET list rather than a choice — joined_at is the only column that came out');

-- postcard_comments has NO update grant and must not acquire one: 011 designed
-- comment editing out, and there is no UPDATE policy either.
select assert_eq(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcard_comments'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  0, '048: postcard_comments holds NO update grant on any column — editing a comment is not designed, and a grant here would be the thing that created the capability');

-- No TABLE-level INSERT or UPDATE survives on any of the three. Without this a
-- later `grant insert on <table>` would silently restore every column.
select assert_eq(
  (select bool_or(has_table_privilege('authenticated', t, p))
     from unnest(array['public.postcard_comments', 'public.club_members',
                       'public.ride_members']) t,
          unnest(array['INSERT', 'UPDATE']) p),
  false, '048: no TABLE-level INSERT or UPDATE remains on any of the three — all three are column-level now');

-- The four timestamps themselves, named by role on all three verbs.
select assert_eq(
  (select bool_or(has_column_privilege('authenticated', t, c, p))
     from (values ('public.postcard_comments', 'created_at'),
                  ('public.postcard_comments', 'updated_at'),
                  ('public.club_members', 'joined_at'),
                  ('public.ride_members', 'joined_at')) v(t, c),
          unnest(array['INSERT', 'UPDATE']) p),
  false, '048: none of the four timestamps is writable on either verb');
select assert_eq(
  (select bool_and(has_column_privilege('authenticated', t, c, 'SELECT'))
     from (values ('public.postcard_comments', 'created_at'),
                  ('public.postcard_comments', 'updated_at'),
                  ('public.club_members', 'joined_at'),
                  ('public.ride_members', 'joined_at')) v(t, c)),
  true, '048: ... while all four stay readable, because the thread and both rosters SORT on them');

-- anon holds nothing on any of them, in any verb.
select assert_eq(
  (select bool_or(has_column_privilege('anon', t, c, p))
     from (values ('public.postcard_comments', 'created_at'),
                  ('public.club_members', 'joined_at'),
                  ('public.ride_members', 'joined_at')) v(t, c),
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p),
  false, '048: anon holds nothing on any of the three timestamps, in any verb');

-- The defaults still supply what the grants now reserve. If one were ever
-- dropped, every insert would fail NOT NULL instead of getting a wrong value.
select assert_eq(
  (select count(*)::int from pg_attribute a
     join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid in ('public.postcard_comments'::regclass,
                         'public.club_members'::regclass,
                         'public.ride_members'::regclass)
      and a.attname in ('created_at', 'updated_at', 'joined_at')
      and pg_get_expr(d.adbin, d.adrelid) = 'now()'),
  4, '048: all four timestamps still DEFAULT now() — the grant is the guarantee, the default is the value');

-- --------------------------------------------------------------------------
-- 048.b  The live write paths, as their actions actually emit them, plus the
--        writes the grants exist to refuse.
--
--        Run as `authenticated` with the suite's own identity idiom
--        (set_config('test.uid', ...)). request.jwt.claims is read by nothing
--        here — auth.uid() is redefined in harness.sql — so a positive
--        assertion written that way would pass while proving nothing.
-- --------------------------------------------------------------------------
savepoint write_paths_048;

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- createRide, then the organizer's own crew row it inserts straight after.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id)
values ('00000000-0000-0000-0000-0000000048a1', '048 ride', 'Meeting point',
        now() + interval '7 days', true, '00000000-0000-0000-0000-00000000000a');
insert into ride_members (ride_id, user_id, status)
values ('00000000-0000-0000-0000-0000000048a1', '00000000-0000-0000-0000-00000000000a', 'going');
select assert_eq(
  (select status from ride_members
    where ride_id = '00000000-0000-0000-0000-0000000048a1'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  'going', '048: createRide''s three-column crew-row insert still lands');
select assert_eq(
  (select joined_at > now() - interval '1 minute' from ride_members
    where ride_id = '00000000-0000-0000-0000-0000000048a1'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  true, '048: ... and its joined_at came from the default, which is the only place it can now come from');

-- **setRideAttendance, as PostgREST actually emits it.** The SET list carries
-- every payload column including the two conflict columns — recovered verbatim
-- from pg_stat_statements on DEV. This is the assertion that would have caught
-- a `grant update (status)` list, which reads correct and takes RSVP down on
-- the SECOND tap rather than the first.
insert into ride_members (ride_id, user_id, status)
values ('00000000-0000-0000-0000-0000000048a1', '00000000-0000-0000-0000-00000000000a', 'maybe')
on conflict (ride_id, user_id) do update
  set ride_id = excluded.ride_id,
      status  = excluded.status,
      user_id = excluded.user_id;
select assert_eq(
  (select status from ride_members
    where ride_id = '00000000-0000-0000-0000-0000000048a1'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  'maybe', '048: a REPEAT RSVP still lands — the upsert''s ON CONFLICT DO UPDATE needs ride_id and user_id in the grant as well as status, and granting status alone would fail this with 42501');

-- createClub, then the owner's own membership row.
insert into clubs (id, name, description, is_public, owner_id)
values ('00000000-0000-0000-0000-0000000048c1', '048 club', 'desc', true,
        '00000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role)
values ('00000000-0000-0000-0000-0000000048c1', '00000000-0000-0000-0000-00000000000a', 'owner');
select assert_eq(
  (select role from club_members
    where club_id = '00000000-0000-0000-0000-0000000048c1'
      and user_id = '00000000-0000-0000-0000-00000000000a'),
  'owner', '048: createClub''s three-column membership insert still lands, role included');

-- joinClub's upsert. `ignoreDuplicates` makes this ON CONFLICT DO NOTHING, so
-- unlike the RSVP it needs no update privilege at all — asserted so the
-- difference between the two upserts is recorded rather than assumed.
insert into club_members (club_id, user_id)
values ('00000000-0000-0000-0000-0000000048c1', '00000000-0000-0000-0000-00000000000a')
on conflict do nothing;
select assert_eq(
  (select count(*)::int from club_members
    where club_id = '00000000-0000-0000-0000-0000000048c1'),
  1, '048: joinClub''s ON CONFLICT DO NOTHING upsert still lands and stays a no-op on a row that exists');

-- addComment, on a postcard the same rider authors.
insert into postcards (id, author_id, image_path)
values ('00000000-0000-0000-0000-0000000048f1', '00000000-0000-0000-0000-00000000000a',
        'postcards/00000000-0000-0000-0000-00000000000a/048.jpg');
insert into postcard_comments (postcard_id, author_id, body)
values ('00000000-0000-0000-0000-0000000048f1', '00000000-0000-0000-0000-00000000000a', '048 comment');
select assert_eq(
  (select count(*)::int from postcard_comments
    where postcard_id = '00000000-0000-0000-0000-0000000048f1'),
  1, '048: addComment''s three-column insert still lands');
select assert_eq(
  (select created_at > now() - interval '1 minute' from postcard_comments
    where postcard_id = '00000000-0000-0000-0000-0000000048f1'),
  true, '048: ... and its created_at came from the default, so it cannot be pinned to the top of the thread');

-- And the writes the grants exist to refuse, in the same shapes.
select assert_denied($$insert into ride_members (ride_id, user_id, status, joined_at)
                       values ('00000000-0000-0000-0000-0000000048a1',
                               '00000000-0000-0000-0000-00000000000b', 'going', '1970-01-01')$$,
  '048: a rider cannot join a ride with a chosen joined_at — first place in the crew is also the avatar row on the ride card');
select assert_denied($$update ride_members set joined_at = '1970-01-01'
                        where ride_id = '00000000-0000-0000-0000-0000000048a1'$$,
  '048: nor back-date their crew row afterwards');
select assert_denied($$insert into club_members (club_id, user_id, joined_at)
                       values ('00000000-0000-0000-0000-0000000048c1',
                               '00000000-0000-0000-0000-00000000000b', '1970-01-01')$$,
  '048: a rider cannot join a club with a chosen joined_at — the roster truncates at 200, so a back-dated row pushes a real member out of the list');
select assert_denied($$update club_members set joined_at = '1970-01-01'
                        where club_id = '00000000-0000-0000-0000-0000000048c1'$$,
  '048: nor back-date their membership afterwards');
select assert_denied($$insert into postcard_comments (postcard_id, author_id, body, created_at)
                       values ('00000000-0000-0000-0000-0000000048f1',
                               '00000000-0000-0000-0000-00000000000a', 'pinned', '1970-01-01')$$,
  '048: a comment cannot be INSERTED with a chosen created_at — the thread sorts ASC, so this is the top of the thread, above the comments it replies to');
select assert_denied($$insert into postcard_comments (postcard_id, author_id, body, updated_at)
                       values ('00000000-0000-0000-0000-0000000048f1',
                               '00000000-0000-0000-0000-00000000000a', 'edited', '3000-01-01')$$,
  '048: nor be born claiming an edit, on a table that has no UPDATE path at all');

rollback to savepoint write_paths_048;
reset role;

\echo ''
\echo '# Ride map tiles: the tile inherits the ride audience exactly (051)'

-- ===========================================================================
-- 051. Ride map tiles — five columns, three CHECKs, the stale-tile trigger,
--      the append-only render ledger, and the `ride-maps/` Storage folder.
--
-- ** The shape that matters here is that the tile's audience is the RIDE's,
-- exactly — neither wider nor narrower. ** So every read assertion below names
-- a role the `rides` SELECT policy already decides, and the tile assertion is
-- expected to agree with it. An implementer copying 034's chat policy would
-- break the third one (a signed-in rider who is not on the crew), and it fails
-- SILENTLY as a grey strip rather than as an error — which is why it is
-- asserted explicitly rather than left to follow from the others.
--
-- Two things this section deliberately does NOT claim to cover, so their
-- absence is not read as coverage:
--   * the ceiling's behaviour under CONCURRENCY. This suite runs serially, so
--     these assertions pass whatever the concurrent behaviour is. The policy
--     overshoots permissively by design and 051's header says so.
--   * anything about a SIGNED URL. Storage checks the policy when the URL is
--     minted, not when it is fetched; that is verifiable only against the
--     hosted project.
-- ===========================================================================
savepoint ride_map_tiles_051;

reset role;
select set_config('test.uid', '', false);

-- A ride inside the PRIVATE club c1, organised by 000b (a member, not the
-- owner). Separates "club owner reads it" from "organizer reads it", which d1
-- confounds because 000a is both.
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-000000051051', 'Member Run', 'The Depot', now() + interval '5 days',
   false, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b');

-- A public ride organised by the BLOCKER, so the block can be asserted with the
-- two riders exchanged. d4 already covers the other direction (organised by the
-- blocked rider), and the `blocks` row is directional while the effect is not.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-000000051052', 'Blocker Run', 'The Yard', now() + interval '6 days',
   true, '00000000-0000-0000-0000-00000000001a');

-- A public ride inside the PUBLIC club c2, so `propagate_club_privacy_to_rides`
-- has something with a tile to bulk-update when c2 turns private. Without a ride
-- in a public club there is nothing for the unscoped-trigger test to fire on.
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-000000051053', 'Club Run', 'The Garage', now() + interval '7 days',
   true, '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a');

-- Tiles. Written as the owner because the Edge Function that would write them
-- does not exist yet; the point of these rows is the READ policy, and the write
-- path is asserted separately below through the CHECKs and the column grant.
update rides set latitude = 52.3784733, longitude = 4.9031499, geocode_confidence = 1.0,
  map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2ca1.jpg',
  map_detail_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2de1.jpg'
  where id = '00000000-0000-0000-0000-0000000000d2';
update rides set latitude = 52.1, longitude = 4.9, geocode_confidence = 0.9,
  map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d1ca1.jpg'
  where id = '00000000-0000-0000-0000-0000000000d1';
update rides set latitude = 52.2, longitude = 4.8, geocode_confidence = 0.9,
  map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d3ca1.jpg'
  where id = '00000000-0000-0000-0000-0000000000d3';
update rides set latitude = 52.3, longitude = 4.7, geocode_confidence = 0.9,
  map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000001b/bbbbbbbb-0000-4000-8000-0000000d4ca1.jpg'
  where id = '00000000-0000-0000-0000-0000000000d4';
update rides set latitude = 52.4, longitude = 4.6, geocode_confidence = 0.9,
  map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000001a/aaaaaaaa-0000-4000-8000-0000000d6ca1.jpg'
  where id = '00000000-0000-0000-0000-000000051052';
update rides set latitude = 52.5, longitude = 4.5, geocode_confidence = 0.9,
  map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000b/bbbbbbbb-0000-4000-8000-0000000d5ca1.jpg'
  where id = '00000000-0000-0000-0000-000000051051';
update rides set latitude = 52.6, longitude = 4.4, geocode_confidence = 0.9,
  map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d7ca1.jpg'
  where id = '00000000-0000-0000-0000-000000051053';

insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2ca1.jpg',
   '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}'),
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2de1.jpg',
   '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}'),
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d1ca1.jpg',
   '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}'),
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d3ca1.jpg',
   '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}'),
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000001b/bbbbbbbb-0000-4000-8000-0000000d4ca1.jpg',
   '00000000-0000-0000-0000-00000000001b', '{"mimetype":"image/jpeg","size":1}'),
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000001a/aaaaaaaa-0000-4000-8000-0000000d6ca1.jpg',
   '00000000-0000-0000-0000-00000000001a', '{"mimetype":"image/jpeg","size":1}'),
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000000b/bbbbbbbb-0000-4000-8000-0000000d5ca1.jpg',
   '00000000-0000-0000-0000-00000000000b', '{"mimetype":"image/jpeg","size":1}'),
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d7ca1.jpg',
   '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}'),
  -- The orphan: an object no `rides` row names. Models an upload whose column
  -- write was refused, a tile superseded by an address edit, and a tile whose
  -- ride was deleted — all three end identically.
  ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000f00d.jpg',
   '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}');

-- 000c holds a ride_members row on the PRIVATE club's ride but is not a member
-- of that club. This is the ex-member state: nothing removes a ride_members row
-- when a rider leaves a club, so a crew-based predicate would keep the tile
-- reachable for ever. 000b gets `maybe` on d3 to prove maybe == going.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000c', 'going'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-00000000000b', 'maybe');

set role authenticated;

-- --------------------------------------------------------------------------
-- 051.1  The per-role read table. Every row of it, positive and negative.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2ca1.jpg'),
  1, '051: the organizer reads their own ride''s card tile');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2de1.jpg'),
  1, '051: ... and the detail tile, which is a second object under the same rules');
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-0000000000d2'
                     and user_id = '00000000-0000-0000-0000-00000000000a'),
  1, '051: (the organizer does hold a ride_members row here, so the next assertion is the one that isolates it)');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000b/bbbbbbbb-0000-4000-8000-0000000d5ca1.jpg'),
  1, '051: the club owner reads a club ride''s tile on the strength of MEMBERSHIP, not of owning the club');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000b/bbbbbbbb-0000-4000-8000-0000000d5ca1.jpg'),
  1, '051: the organizer of a private club''s ride reads its tile, holding no ride_members row at all');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d1ca1.jpg'),
  1, '051: a private club MEMBER reads that club''s ride tile');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d3ca1.jpg'),
  1, '051: a crew member with status `maybe` reads the tile — identical to `going`, because crew status is not part of this audience at all');

select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d3ca1.jpg'),
  1, '051: a crew member with status `going` reads the tile');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
-- ** The assertion an implementer copying 034 would break, and it fails as a
-- grey strip rather than as an error. ** Seeing a ride is not being on it, but
-- for a TILE that distinction is exactly wrong: the tile renders a column the
-- same screen already prints as text to this rider.
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2ca1.jpg'),
  1, '051: a signed-in rider with NO ride_members row reads a public ride''s tile');
-- The negatives, all reached with the exact object path in hand: a path is
-- built from a ride id and a uid and is NOT a secret.
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d1ca1.jpg'),
  0, '051: a NON-MEMBER of a private club reads nothing, knowing the exact path');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000b/bbbbbbbb-0000-4000-8000-0000000d5ca1.jpg'),
  0, '051: ... including a second ride in that club organised by someone else');
-- The ex-member: 000c holds a live ride_members row on d1 and still reads
-- nothing. A crew-based predicate would have kept this reachable for ever,
-- because nothing deletes a ride_members row when a rider leaves the club.
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-0000000000d1'
                     and user_id = '00000000-0000-0000-0000-00000000000c'),
  0, '051: (the ex-member''s own ride_members row is itself invisible to them — the row exists, which is what the next assertion needs)');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d1ca1.jpg'),
  0, '051: an ex-member''s surviving ride_members row does NOT keep the tile reachable');

-- Blocking, in both directions, with every other condition satisfied: both
-- rides are public, both riders are signed in and onboarded, and the refusal
-- comes from the EXISTS against `rides` inheriting `not private.is_blocked(...)`
-- rather than from any predicate 051 writes.
--
-- ** Each refusal below is PAIRED with an unrelated rider reading the very same
-- object. ** A bare `count = 0` is what a mistyped path returns and what a
-- broken policy returns; only the pair tells "refused" apart from "no such
-- row", which is 049's lesson applied to a different table.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000001b/bbbbbbbb-0000-4000-8000-0000000d4ca1.jpg'),
  1, '051: (an unrelated rider DOES read the blocked rider''s ride tile, so the refusal below is about the block and not about a missing object)');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000001a/aaaaaaaa-0000-4000-8000-0000000d6ca1.jpg'),
  1, '051: (... and the blocker''s ride tile too, pairing the other direction)');

select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000001b/bbbbbbbb-0000-4000-8000-0000000d4ca1.jpg'),
  0, '051: the BLOCKER reads nothing of a public ride organised by the rider they blocked');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000001a/aaaaaaaa-0000-4000-8000-0000000d6ca1.jpg'),
  0, '051: the BLOCKED rider reads nothing of a public ride organised by the blocker — the row is directional, the effect is not');

-- --------------------------------------------------------------------------
-- 051.2  The orphan, and the own-folder arm that exists only for it.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000f00d.jpg'),
  0, '051: an object no rides row names is unreadable by another rider under any circumstances');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
-- ** Without the own-folder arm this reads 0, and that is not the safe
-- direction. ** A Storage listing is filtered by this same policy, so an orphan
-- nobody can see is an orphan nobody can name, and the DELETE policy can only
-- remove an object by name. Omitting the arm makes the object permanent,
-- invisible and uncounted rather than making it go away.
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000f00d.jpg'),
  1, '051: ... and its own folder''s rider CAN still list it, which is the only thing the own-folder arm does');
savepoint orphan_sweep_051;
delete from storage.objects
  where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000f00d.jpg';
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000f00d.jpg'),
  0, '051: ... and can therefore delete it, so "until something sweeps them" names an actor that exists');
rollback to savepoint orphan_sweep_051;

-- --------------------------------------------------------------------------
-- 051.3  The `ride-maps/` folder's own write policies. Per folder, never by
--        reusing another folder's coverage.
-- --------------------------------------------------------------------------
select assert_allowed($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000abcd.jpg',
          '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}')$$,
  '051: a rider uploads a tile into their own ride-maps folder');
select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'ride-maps/00000000-0000-0000-0000-00000000000b/aaaaaaaa-0000-4000-8000-00000000abcd.jpg',
          '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}')$$,
  '051: ... and never into another rider''s folder');
select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/not-a-uuid.jpg',
          '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}')$$,
  '051: ... and never under a filename outside the pinned shape');
select assert_denied($$
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000abcd.png',
          '00000000-0000-0000-0000-00000000000a', '{"mimetype":"image/jpeg","size":1}')$$,
  '051: ... and never as .png — the tile is requested as JPEG because the bucket allows nothing else');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
savepoint cross_rider_delete_051;
delete from storage.objects
  where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2ca1.jpg';
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d2ca1.jpg'),
  1, '051: another rider cannot delete a tile out of a folder that is not theirs (asserted by counting, since a filtered DELETE raises nothing)');
rollback to savepoint cross_rider_delete_051;

reset role;
set role anon;
select assert_eq((select count(*)::int from storage.objects
                   where (storage.foldername(name))[1] = 'ride-maps'),
  0, '051: a signed-out visitor reads no ride-maps object at all — decision #1');
select assert_denied($$
  insert into storage.objects (bucket_id, name, metadata)
  values ('media', 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000dead.jpg',
          '{"mimetype":"image/jpeg","size":1}')$$,
  '051: ... and uploads none either');
reset role;
set role authenticated;

-- --------------------------------------------------------------------------
-- 051.4  The three CHECK constraints. Named individually, because 1.8 asks for
--        all three and a count cannot tell which one fired.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

select assert_rejected($$
  update rides set latitude = 52.0, longitude = 4.0, geocode_confidence = null
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: the coupling CHECK refuses a coordinate with no confidence beside it');
select assert_rejected($$
  update rides set latitude = 52.0, longitude = null, geocode_confidence = 0.9
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: ... and half a coordinate');
select assert_rejected($$
  update rides set latitude = 52.0, longitude = 4.0, geocode_confidence = 0.69
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: ... and a confidence below the 0.70 floor');
select assert_rejected($$
  update rides set latitude = 52.0, longitude = 4.0, geocode_confidence = 1.5
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: ... and a confidence above 1.0, which is what makes a mis-scaled vendor value fail closed rather than store nonsense');
select assert_rejected($$
  update rides set latitude = 95.0, longitude = 4.0, geocode_confidence = 0.9
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: ... and a latitude out of range');

-- ** The cast assertion. ** `0.70::real >= 0.70` is FALSE on Postgres — `real`
-- cannot represent 0.70 and the bare literal is `numeric`, so the column gets
-- widened and a candidate at EXACTLY the stated floor would violate its own
-- constraint. That is not a filter, it is a write error on a path no scenario
-- covers. Written `>= 0.70::real`, this must be ACCEPTED.
savepoint floor_exactly_051;
update rides set latitude = 52.0, longitude = 4.0, geocode_confidence = 0.70
 where id = '00000000-0000-0000-0000-0000000000d2';
select assert_eq((select geocode_confidence from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  0.70::real, '051: a confidence of EXACTLY the floor is accepted — the CHECK casts the literal to the column''s own type');
rollback to savepoint floor_exactly_051;

select assert_rejected($$
  update rides set latitude = null, longitude = null, geocode_confidence = null,
    map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000beef.jpg'
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: the one-directional CHECK refuses a tile path with no coordinate behind it');
-- The other direction must be PERMITTED: a geocode that succeeds and an upload
-- that fails is a valid stored state, and a symmetric constraint would turn a
-- partial failure into a write failure and lose the coordinate too.
savepoint coord_without_path_051;
update rides set map_card_path = null, map_detail_path = null
 where id = '00000000-0000-0000-0000-0000000000d2';
select assert_eq((select (latitude is not null and map_card_path is null) from rides
                   where id = '00000000-0000-0000-0000-0000000000d2'),
  true, '051: ... but a coordinate with NO path is permitted, which is the failed-upload state');
rollback to savepoint coord_without_path_051;
-- And one path present with the other NULL, which is the "one tile lands, the
-- other does not" state each screen resolves independently.
savepoint one_path_051;
update rides set map_detail_path = null where id = '00000000-0000-0000-0000-0000000000d2';
select assert_eq((select (map_card_path is not null and map_detail_path is null) from rides
                   where id = '00000000-0000-0000-0000-0000000000d2'),
  true, '051: ... and one tile present with the other absent is permitted too');
rollback to savepoint one_path_051;

select assert_rejected($$
  update rides set map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000b/bbbbbbbb-0000-4000-8000-0000000d5ca1.jpg'
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: the path-pinning CHECK refuses a path in ANOTHER rider''s folder — a ride is not a laundering route to someone else''s object');
select assert_rejected($$
  update rides set map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/nope.jpg'
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: ... and a filename outside the pinned shape');
select assert_rejected($$
  update rides set map_card_path = 'postcards/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000beef.jpg'
   where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', '051: ... and a path pointing out of the ride-maps folder entirely');

-- --------------------------------------------------------------------------
-- 051.5  The column grant. `045` converted `rides` to per-column INSERT/UPDATE
--        grants, so these five columns arrive with NO update grant unless 051
--        issues one — and the Edge Function writes them as `authenticated`
--        under the caller's forwarded JWT. A missing grant fails 42501 ABOVE
--        RLS, on every ride, with the policy set looking perfectly correct.
--
--        Asserted by naming the ROLE's privilege rather than by writing, since
--        this suite runs as the table owner for whom no grant barrier exists —
--        `031`'s lesson.
-- --------------------------------------------------------------------------
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'latitude', 'update'),
  true, '051: authenticated may UPDATE rides.latitude — without this the Edge Function cannot write a tile at all');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'longitude', 'update'),
  true, '051: ... longitude');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'geocode_confidence', 'update'),
  true, '051: ... geocode_confidence');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'map_card_path', 'update'),
  true, '051: ... map_card_path');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'map_detail_path', 'update'),
  true, '051: ... map_detail_path');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'map_card_path', 'insert'),
  false, '051: ... and INSERT on a tile column is NOT granted — a tile is only ever written by an UPDATE after the ride exists');
select assert_eq(has_column_privilege('anon', 'public.rides', 'map_card_path', 'update'),
  false, '051: anon holds nothing on the tile columns — decision #1');

-- --------------------------------------------------------------------------
-- 051.6  The stale-tile trigger, and the bulk update it must NOT fire on.
-- --------------------------------------------------------------------------
savepoint address_edit_051;
update rides set meeting_point = 'A Different Corner'
 where id = '00000000-0000-0000-0000-0000000000d2';
select assert_eq((select (latitude is null and longitude is null and geocode_confidence is null
                          and map_card_path is null and map_detail_path is null)
                    from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  true, '051: changing meeting_point clears all five tile columns in the same statement');
rollback to savepoint address_edit_051;

-- BEFORE, not AFTER: the clearing has to win over anything the same statement
-- supplies, or a client can keep a stale path by sending both.
savepoint address_edit_with_path_051;
update rides set meeting_point = 'Another Corner',
  latitude = 51.0, longitude = 3.0, geocode_confidence = 0.99,
  map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000beef.jpg'
 where id = '00000000-0000-0000-0000-0000000000d2';
select assert_eq((select (latitude is null and map_card_path is null) from rides
                   where id = '00000000-0000-0000-0000-0000000000d2'),
  true, '051: ... and the clearing overwrites a coordinate and a path supplied by that same statement');
rollback to savepoint address_edit_with_path_051;

savepoint whitespace_edit_051;
update rides set meeting_point = 'The Pier ' where id = '00000000-0000-0000-0000-0000000000d2';
select assert_eq((select map_card_path is null from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  true, '051: a whitespace-only edit clears too — IS DISTINCT FROM is the whole test, and an over-eager clear costs one render');
rollback to savepoint whitespace_edit_051;

-- ** The scope. ** `propagate_club_privacy_to_rides` issues
-- `update public.rides set is_public = false where club_id = … and is_public`,
-- so an UNSCOPED trigger wipes every tile in a club the instant it turns
-- private — a bulk data loss with a plausible-looking cause. d7 sits in the
-- public club c2 and carries a tile.
savepoint club_turns_private_051;
reset role;
update clubs set is_public = false where id = '00000000-0000-0000-0000-0000000000c2';
select assert_eq((select is_public from rides where id = '00000000-0000-0000-0000-000000051053'),
  false, '051: (the club going private did reach the ride, so the next assertion is about the trigger and not about a no-op)');
select assert_eq((select map_card_path from rides where id = '00000000-0000-0000-0000-000000051053'),
  'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000d7ca1.jpg',
  '051: a club turning private does NOT clear its rides'' tiles — the audience narrowed and the meeting point did not change');
rollback to savepoint club_turns_private_051;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

savepoint unrelated_edit_051;
update rides set title = 'Coast Run Renamed' where id = '00000000-0000-0000-0000-0000000000d2';
select assert_eq((select map_card_path is not null from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  true, '051: an edit that does not touch meeting_point leaves the tile alone');
rollback to savepoint unrelated_edit_051;

-- --------------------------------------------------------------------------
-- 051.7  The render ledger.
-- --------------------------------------------------------------------------
select assert_eq((select relrowsecurity from pg_class where oid = 'public.ride_map_render_attempts'::regclass),
  true, '051: RLS is enabled on the render ledger');

-- The grants, by ROLE rather than by calling: the organizer must be able to
-- raise their own count and must not be able to lower it, and the direction is
-- the whole design.
select assert_eq(has_table_privilege('authenticated', 'public.ride_map_render_attempts', 'insert'),
  true, '051: authenticated may INSERT into the ledger — recording an attempt is the organizer''s own write');
select assert_eq(has_table_privilege('authenticated', 'public.ride_map_render_attempts', 'select'),
  true, '052: ... and may SELECT, which is how the organizer reads their own spend — NOT how the ceiling counts, which is 052''s definer helper');
select assert_eq(has_table_privilege('authenticated', 'public.ride_map_render_attempts', 'update'),
  false, '051: ... and holds NO update grant, so an attempted_at cannot be moved out of the window');
select assert_eq(has_table_privilege('authenticated', 'public.ride_map_render_attempts', 'delete'),
  false, '051: ... and NO delete grant, so a count cannot be lowered — the only direction the organizer wants is the one with no grant behind it');
select assert_eq(has_table_privilege('anon', 'public.ride_map_render_attempts', 'select'),
  false, '051: anon holds nothing on the ledger');
select assert_eq((select count(*)::int from pg_policies
                   where schemaname = 'public' and tablename = 'ride_map_render_attempts'
                     and cmd in ('UPDATE', 'DELETE')),
  0, '051: and there is no UPDATE or DELETE policy either — the missing grant is the outer gate, the missing policy the inner one');

-- 052: the ceiling could not be an aggregate over the ledger's own table.
-- Postgres raises `infinite recursion detected in policy` structurally, so the
-- count lives in a `private` security definer helper. Asserted by naming the
-- ROLE rather than by calling it, since this suite runs as the table owner for
-- whom neither the schema barrier nor the grant exists — `031`'s shape.
--
-- The role drops back to the owner first, for the reason 023's block already
-- documents: `has_function_privilege` resolves a `private.` name, and
-- `authenticated` holds no USAGE on that schema by design (005), so the check
-- itself would answer 42501 rather than a boolean.
reset role;
select assert_eq(has_function_privilege('authenticated',
  'private.ride_map_renders_in_window(uuid)', 'execute'),
  true, '052: authenticated may execute the ceiling helper — an RLS expression is evaluated as the querying role, so without this every ledger insert fails');
select assert_eq(has_function_privilege('anon',
  'private.ride_map_renders_in_window(uuid)', 'execute'),
  false, '052: ... and anon may not — decision #1');
select assert_eq(
  (select prosecdef from pg_proc where oid = 'private.ride_map_renders_in_window(uuid)'::regprocedure),
  true, '052: the helper really is SECURITY DEFINER — 022 shipped exactly this clause missing between the repo and the database, and the invoker version would recurse again');
select assert_eq(
  (select proconfig[1] from pg_proc where oid = 'private.ride_map_renders_in_window(uuid)'::regprocedure),
  'search_path=""'::text, '052: ... with the pinned empty search_path every definer function here carries');
select assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'ride_map_renders_in_window' and n.nspname = 'private'),
  1, '052: ... and it lives in `private`, which PostgREST does not route to, so no client can ask it about a ride they do not organise');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- The attempted_at trigger. A DEFAULT applies only when the column is OMITTED,
-- and PostgREST lets a client name it, so the trigger is the guarantee.
savepoint backdate_051;
insert into ride_map_render_attempts (ride_id, attempted_at)
  values ('00000000-0000-0000-0000-0000000000d3', timestamptz '2000-01-01 00:00:00+00');
select assert_eq((select attempted_at > now() - interval '1 minute' from ride_map_render_attempts
                   where ride_id = '00000000-0000-0000-0000-0000000000d3'),
  true, '051: a client-supplied attempted_at is discarded and replaced with server time — a caller who can backdate has no ceiling at all');
rollback to savepoint backdate_051;

-- Entitlement: only the ride's organizer may record an attempt against it.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_denied($$
  insert into ride_map_render_attempts (ride_id)
  values ('00000000-0000-0000-0000-0000000000d2')$$,
  '051: a rider who can SEE a public ride cannot record a render attempt against it — the cost lands on us, not on them');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_denied($$
  insert into ride_map_render_attempts (ride_id)
  values ('00000000-0000-0000-0000-0000000000d3')$$,
  '051: ... and neither can a crew member of that ride');

-- The ceiling.
reset role;
select set_config('test.uid', '', false);
insert into ride_map_render_attempts (ride_id)
  select '00000000-0000-0000-0000-0000000000d2' from generate_series(1, 10);
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq((select count(*)::int from ride_map_render_attempts
                   where ride_id = '00000000-0000-0000-0000-0000000000d2'),
  10, '052: the organizer reads their own ride''s ledger rows — their own spend, read under their own RLS; the ceiling counts separately in the definer and is no longer bounded by this policy');
select assert_denied($$
  insert into ride_map_render_attempts (ride_id)
  values ('00000000-0000-0000-0000-0000000000d2')$$,
  '051: an organizer at the ceiling is refused a further ledger insert');
-- A ride that has spent nothing is unaffected: the ceiling is per ride, and a
-- count that leaked across rides would look identical from the refusal above.
select assert_allowed($$
  insert into ride_map_render_attempts (ride_id)
  values ('00000000-0000-0000-0000-0000000000d3')$$,
  '051: ... while a different ride of theirs is still under its own ceiling');

-- ** The guarantee that is invisible from the ledger's own tests. ** A spend
-- control must never abort a statement against `rides`: a BEFORE UPDATE trigger
-- that raised at the ceiling would stop an organizer editing their own ride's
-- address for the rest of the window, which is far worse than a missing map and
-- is the failure the design names explicitly.
savepoint ceiling_never_blocks_ride_051;
update rides set meeting_point = 'The Pier Annex' where id = '00000000-0000-0000-0000-0000000000d2';
select assert_eq((select meeting_point from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  'The Pier Annex', '051: an organizer AT their ceiling still updates their own ride''s meeting_point — the refusal lands on the ledger and never on the ride');
select assert_eq((select map_card_path is null from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  true, '051: ... and the stale-tile trigger still clears, so the rider sees the fallback with no error');
rollback to savepoint ceiling_never_blocks_ride_051;

-- The ledger is nobody else's business: it records when an identified rider was
-- editing a meeting point.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq((select count(*)::int from ride_map_render_attempts
                   where ride_id = '00000000-0000-0000-0000-0000000000d2'),
  0, '051: another rider reads ZERO ledger rows for a ride they do not organise, though the ride itself is public to them');
select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-0000000000d2'),
  1, '051: ... and that is not because the ride is hidden from them');

-- --------------------------------------------------------------------------
-- 051.8  The left-the-club path (task 1.8a). Nothing else covers it, and it is
--        the silent failure design.md §D2 exists to describe: the UPDATE policy
--        re-evaluates club membership on EVERY update, including one touching
--        only the map columns, and nothing clears rides.club_id when a rider
--        leaves a club.
-- --------------------------------------------------------------------------
reset role;
delete from club_members
 where club_id = '00000000-0000-0000-0000-0000000000c1'
   and user_id = '00000000-0000-0000-0000-00000000000b';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);

select assert_eq((select count(*)::int from rides where id = '00000000-0000-0000-0000-000000051051'),
  1, '051: an organizer who left the club can still SELECT their own ride — the rides SELECT policy''s organizer arm is unconditional');
select assert_denied($$
  update rides set latitude = 52.0, longitude = 4.0, geocode_confidence = 0.9,
    map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000b/bbbbbbbb-0000-4000-8000-00000000beef.jpg'
   where id = '00000000-0000-0000-0000-000000051051'$$,
  '051: ... and is refused the tile write by the UPDATE policy''s WITH CHECK club arm — so the function must pre-flight membership BEFORE spending a geocode');

-- --------------------------------------------------------------------------
-- 053 — the ledger's table comment, and the one grant it is easy to misread
-- --------------------------------------------------------------------------
-- A table comment is what `\d+` prints, so a wrong one is read far more often
-- than the migration that wrote it. `051`'s described the in-policy aggregate
-- that `052` proved Postgres refuses outright, which would send the next reader
-- straight back to the shape that cannot execute.
--
-- Pin the CLAIM, not the noun: the corrected comment necessarily contains the
-- phrase "aggregate over this table" in its negation, so the obvious needle
-- matches the fix as well as the defect. CLAUDE.md's comment trap, on a table
-- comment rather than a grep.
reset role;
select assert_eq(
  (select obj_description('public.ride_map_render_attempts'::regclass, 'pg_class')
            not like '%ceiling is a WITH CHECK aggregate%'),
  true, '053: the ledger''s comment no longer describes the recursive in-policy count 052 removed');
select assert_eq(
  (select obj_description('public.ride_map_render_attempts'::regclass, 'pg_class')
            like '%ride_map_renders_in_window%'),
  true, '053: ... and names the definer helper that replaced it');

-- Schema USAGE is not EXECUTE, which is the half of 031 that IS still true and
-- the reason the positive assertion above is safe to make.
select assert_eq(
  has_function_privilege('service_role', 'private.ride_map_renders_in_window(uuid)', 'execute'),
  false, '053: service_role''s USAGE on private did not hand it the render ceiling');
set role authenticated;

rollback to savepoint ride_map_tiles_051;

\echo ''
\echo '# 054 — a club owner reaches their own club as a member does (PD-128)'

-- ===========================================================================
-- 054. `private.is_club_member` gains an owner arm, so a club owner holding no
--      `club_members` row reaches their own club exactly as a member does.
--
-- ** Every assertion below runs under `set role authenticated` with the
-- harness's `test.uid` set to the rider under test. ** The suite otherwise runs
-- as the table owner, for whom RLS does not apply — so an assertion that merely
-- CALLS `private.is_club_member` proves nothing about what a rider reaches.
-- That is 031's lesson applied to a predicate rather than to a grant, and the
-- three assertions here that do name a role (`anon`'s table privileges,
-- `authenticated`'s USAGE on `private`) are written that way for the same
-- reason.
--
-- The fixture is built by WALKING THE ROUTE IN rather than by seeding the end
-- state: the owner creates the club and their own membership row exactly as
-- `createClub` does, then leaves. `club_members` DELETE is `auth.uid() =
-- user_id` with no owner carve-out, so that door needs nothing to fail.
--
-- Two things this section deliberately does NOT claim, so their absence is not
-- read as coverage:
--   * the fan-out. An ownerless owner still receives no `ride_created_in_club`
--     notification, because `private.notify_ride_created_in_club` reads
--     `club_members` directly and must (a caller-relative helper cannot compute
--     a recipient set). That gap is `enforce-creator-membership`'s — N10.
--   * anything about the ADMIN role beyond the absolute check below. `admin`
--     has no representation outside `club_members.role`, so it implies a
--     membership row and gained nothing here — N3.
-- ===========================================================================
savepoint club_owner_reach_054;

reset role;
select set_config('test.uid', '', false);

-- Four riders of their own rather than the seed's, so no count asserted
-- anywhere above this line moves. Same rule 009's fixtures follow.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000128001', 'pd128owner@example.com'),
  ('00000000-0000-0000-0000-000000128002', 'pd128member@example.com'),
  ('00000000-0000-0000-0000-000000128003', 'pd128stranger@example.com'),
  ('00000000-0000-0000-0000-000000128004', 'pd128rejoiner@example.com');

update profiles set username = 'pd128owner', location = 'Lisbon',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000128001';
update profiles set username = 'pd128member', location = 'Porto',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000128002';
update profiles set username = 'pd128stranger', location = 'Faro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000128003';
update profiles set username = 'pd128rejoiner', location = 'Braga',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000128004';

-- --------------------------------------------------------------------------
-- 054.1  The fixture, built through the real route in.
-- --------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);

insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000001c1280', 'Ownerless MC', false,
   '00000000-0000-0000-0000-000000128001');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000001c1280', '00000000-0000-0000-0000-000000128001', 'owner');

select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000001c1280'
                     and user_id = '00000000-0000-0000-0000-000000128001'),
  1, '054: fixture — a new club owner starts out holding their own membership row, as createClub writes it');

delete from club_members
 where club_id = '00000000-0000-0000-0000-0000001c1280'
   and user_id = '00000000-0000-0000-0000-000000128001';

-- Checked as the TABLE OWNER, so "the row is gone" cannot be confused with
-- "the row is invisible to me" — which is exactly what the widened SELECT
-- predicate would otherwise make ambiguous.
reset role;
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000001c1280'
                     and user_id = '00000000-0000-0000-0000-000000128001'),
  0, '054: fixture — and can simply leave, club_members DELETE being auth.uid() = user_id with no owner carve-out: the door into the ownerless state that needs nothing to fail');

-- The member's row goes in as the table owner because a PRIVATE club cannot be
-- joined through RLS at all — club_members INSERT's club arm is
-- `c.is_public OR c.owner_id = auth.uid()`. Modelling an invite the app does
-- not yet have.
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000001c1280', '00000000-0000-0000-0000-000000128002', 'member');

-- Everything else is written by the MEMBER, through the policies, so the
-- fixture is reachable state rather than asserted state.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128002', false);

insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-0000001d1280', 'Ownerless Club Run', 'The Depot',
   now() + interval '7 days', false, '00000000-0000-0000-0000-0000001c1280',
   '00000000-0000-0000-0000-000000128002');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000001d1280', '00000000-0000-0000-0000-000000128002', 'going');
insert into ride_messages (id, ride_id, author_id, body) values
  ('00000000-0000-0000-0000-0000001a1280', '00000000-0000-0000-0000-0000001d1280',
   '00000000-0000-0000-0000-000000128002', 'Meeting at the depot at seven.');
insert into postcards (id, author_id, club_id, image_path, caption) values
  ('00000000-0000-0000-0000-0000001e1280', '00000000-0000-0000-0000-000000128002',
   '00000000-0000-0000-0000-0000001c1280',
   'postcards/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128e01.jpg',
   'Posted into the club');
update rides set latitude = 38.7, longitude = -9.1, geocode_confidence = 0.9,
       map_card_path = 'ride-maps/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128d01.jpg'
 where id = '00000000-0000-0000-0000-0000001d1280';

reset role;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('media', 'postcards/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128e01.jpg',
   '00000000-0000-0000-0000-000000128002', '{"mimetype":"image/jpeg","size":1024}'),
  ('media', 'ride-maps/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128d01.jpg',
   '00000000-0000-0000-0000-000000128002', '{"mimetype":"image/jpeg","size":1024}');

-- --------------------------------------------------------------------------
-- 054.2  The reported bug, both halves. It is not read-only: `rides` INSERT
--        carries the same predicate in its WITH CHECK, so before 054 the club
--        rendered, its Rides sub-page rendered, and the write was refused.
-- --------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);

select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  1, '054: the ownerless owner reads a ride in their own private club — the reported bug, read half');
select assert_allowed($$
  insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('00000000-0000-0000-0000-0000001d1281', 'Owner Run', 'The Yard',
          now() + interval '8 days', false, '00000000-0000-0000-0000-0000001c1280',
          '00000000-0000-0000-0000-000000128001')$$,
  '054: ... and can create one in it — the reported bug, write half, which rides INSERT''s WITH CHECK refused before 054');

-- --------------------------------------------------------------------------
-- 054.3  The rest of the widened set. Nine of the ten calling policies were
--        wrong in the same way; fixing only the two that were reported would
--        have left these seven behind.
-- --------------------------------------------------------------------------
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000001c1280'),
  1, '054: the ownerless owner reads their private club''s roster');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000001e1280'),
  1, '054: ... and a postcard a member posted into it');
select assert_allowed($$
  insert into postcards (id, author_id, club_id, image_path, caption)
  values ('00000000-0000-0000-0000-0000001e1281', '00000000-0000-0000-0000-000000128001',
          '00000000-0000-0000-0000-0000001c1280',
          'postcards/00000000-0000-0000-0000-000000128001/aaaaaaaa-0000-4000-8000-000000128e02.jpg',
          'The owner posts too')$$,
  '054: ... and can post one into it');
select assert_allowed($$
  insert into feed_reads (user_id, club_id)
  values ('00000000-0000-0000-0000-000000128001', '00000000-0000-0000-0000-0000001c1280')$$,
  '054: ... and can set their own read watermark for their own club (design.md D7 — an own-row write that leaks nothing, refused before 054)');

-- --------------------------------------------------------------------------
-- 054.4  The regression floor. A migration that widened EVERYONE would pass
--        every assertion above, so the plain member's reach is asserted as the
--        control and the stranger's absence as the bound.
-- --------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000128002', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  1, '054: a plain member''s reach into the private club is unchanged — ride');
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000001c1280'),
  1, '054: ... roster');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000001e1280'),
  1, '054: ... postcard');

-- N1: neither owner nor member.
select set_config('test.uid', '00000000-0000-0000-0000-000000128003', false);
select assert_eq((select count(*)::int from clubs
                   where id = '00000000-0000-0000-0000-0000001c1280'),
  0, '054: N1 — a rider who neither owns the club nor belongs to it reads zero: the club itself');
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  0, '054: N1 — ... its rides');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000001e1280'),
  0, '054: N1 — ... its postcards');
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000001c1280'),
  0, '054: N1 — ... its roster');
select assert_denied($$
  insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id)
  values ('00000000-0000-0000-0000-0000001d1282', 'Gatecrash', 'The Gate',
          now() + interval '9 days', false, '00000000-0000-0000-0000-0000001c1280',
          '00000000-0000-0000-0000-000000128003')$$,
  '054: N1 — ... and cannot create a ride in it, the arm keying on clubs.owner_id and on nothing else');

-- N5: owning club A grants nothing in private club B. Read against the seed's
-- c1, which this rider neither owns nor belongs to.
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000000000d1'),
  0, '054: N5 — the owner of club A reads zero rides in a private club B they do not own');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000000000e2'),
  0, '054: N5 — ... zero of B''s postcards');
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000000000c1'),
  0, '054: N5 — ... zero of B''s roster rows');

-- N2: the arm keys on the CURRENT clubs.owner_id, never on membership history.
savepoint ex_member_054;
reset role;
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000001c1280', '00000000-0000-0000-0000-000000128004', 'member');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128004', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  1, '054: N2 — a rider who owns no club reads the ride while their membership row exists');
delete from club_members
 where club_id = '00000000-0000-0000-0000-0000001c1280'
   and user_id = '00000000-0000-0000-0000-000000128004';
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  0, '054: N2 — ... and zero immediately after leaving, so the owner arm keys on the current clubs.owner_id and never on membership history');
rollback to savepoint ex_member_054;

-- N3: the admin gains nothing, because `admin` has no representation outside
-- `club_members.role` — it IMPLIES a membership row. Stated as a property of
-- the end state, because the suite applies the whole chain to a scratch
-- database and so has no pre-054 state to compare against.
savepoint admin_054;
reset role;
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000001c1280', '00000000-0000-0000-0000-000000128004', 'admin');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128004', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  1, '054: N3 — a club admin reads the ride because they hold a membership row, and for no other reason');
rollback to savepoint admin_054;

reset role;
select assert_eq((select count(*)::int from pg_policies
                   where schemaname = 'public'
                     and (coalesce(qual, '') || coalesce(with_check, '')) like '%admin%'),
  0, '054: N3 — no policy predicate in public references admin at all, so 054 added no admin-specific arm and the role''s reach is whatever its membership row already bought');

-- N6: a signed-out visitor gains nothing. Asserted as the ROLE's privilege
-- rather than only as an empty result, per 031 — and scoped to the grantee,
-- because postgres and service_role hold everything by Supabase default and a
-- table-wide count would read non-zero against a correct database.
select assert_eq(has_table_privilege('anon', 'public.rides', 'select'),
  false, '054: N6 — anon holds no SELECT on rides, so the owner arm has nothing to widen for a signed-out request');
select assert_eq(has_table_privilege('anon', 'public.clubs', 'select'),
  false, '054: N6 — ... nor on clubs');
select assert_eq(has_table_privilege('anon', 'public.club_members', 'select'),
  false, '054: N6 — ... nor on club_members');
select assert_eq(has_table_privilege('anon', 'public.postcards', 'select'),
  false, '054: N6 — ... nor on postcards');
select assert_eq(has_table_privilege('anon', 'public.feed_reads', 'insert'),
  false, '054: N6 — ... nor INSERT on feed_reads');
select set_config('test.uid', '', false);
select assert_eq(private.is_club_member('00000000-0000-0000-0000-0000001c1280'),
  false, '054: N6 — and the predicate itself is false with no session, because BOTH arms resolve auth.uid() and NULL matches no owner_id');

-- --------------------------------------------------------------------------
-- 054.5  N4 — the block. This is the assertion that matters most: decision #2
--        says widening a membership test must not step past a block.
--
-- ** The property is DOMINATION, not position. ** `rides` SELECT and
-- `postcards` SELECT are top-level `OR`, so "is_blocked is a top-level
-- conjunct" is FALSE of them and a gate written that way fires against a
-- correct database. What closes it is that the only disjunct escaping the block
-- conjunct is the viewer's own row, and `blocks_no_self_block` makes
-- is_blocked(x, x) false for every x.
-- --------------------------------------------------------------------------
select assert_eq((select pg_get_constraintdef(oid) from pg_constraint
                   where conname = 'blocks_no_self_block'),
  'CHECK ((blocker_id <> blocked_id))',
  '054: N4 — blocks_no_self_block still exists, which is the whole reason the self-identity disjuncts are a safe bypass of the block conjunct');

savepoint owner_blocks_organizer_054;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000128001', '00000000-0000-0000-0000-000000128002');
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  0, '054: N4 — an owner who has blocked the ride''s organizer reads zero rows for it, even though they own the club it sits in');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000001e1280'),
  0, '054: N4 — ... and zero for that rider''s postcard in their own club');
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000001c1280'),
  0, '054: N4 — ... and the blocked rider is absent from the roster the owner can now read');
rollback to savepoint owner_blocks_organizer_054;

savepoint organizer_blocks_owner_054;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128002', false);
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000128002', '00000000-0000-0000-0000-000000128001');
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  0, '054: N4 — blocking is symmetric though the row is directional: the owner reads zero rows for the ride when the ORGANIZER is the blocker');
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000001e1280'),
  0, '054: N4 — ... and zero postcards, in that direction too');
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000001c1280'),
  0, '054: N4 — ... and an empty roster, in that direction too');
rollback to savepoint organizer_blocks_owner_054;

-- --------------------------------------------------------------------------
-- 054.6  Storage — the widening that reaches image BYTES, not metadata. Both
--        policies name no function at all: they inherit `postcards` / `rides`
--        SELECT through an RLS-filtered EXISTS, so a grep for is_club_member
--        misses all of this. Asserted deliberately rather than discovered.
-- --------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128e01.jpg'),
  1, '054: the ownerless owner can read the storage row for a postcard image a member posted into their club — the widening reaches photographs');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128d01.jpg'),
  1, '054: ... and the map tile of the club ride they can now see');

savepoint storage_owner_blocks_054;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000128001', '00000000-0000-0000-0000-000000128002');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128e01.jpg'),
  0, '054: ... and zero when the author is blocked — the guarantee that matters, the image being the payload');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128d01.jpg'),
  0, '054: ... and zero for the map tile of a ride whose organizer is blocked');
rollback to savepoint storage_owner_blocks_054;

savepoint storage_author_blocks_054;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128002', false);
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000128002', '00000000-0000-0000-0000-000000128001');
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);
select assert_eq((select count(*)::int from storage.objects
                   where name = 'postcards/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128e01.jpg'),
  0, '054: ... zero image bytes in the other block direction too');
select assert_eq((select count(*)::int from storage.objects
                   where name = 'ride-maps/00000000-0000-0000-0000-000000128002/aaaaaaaa-0000-4000-8000-000000128d01.jpg'),
  0, '054: ... zero map tile in the other block direction too');
rollback to savepoint storage_author_blocks_054;

-- --------------------------------------------------------------------------
-- 054.7  N7 — ride chat. Ownership alone yields NO chat; joining the crew does,
--        and that is decided rather than overlooked, because it is exactly what
--        any member of the club can already do. The rule preserved is
--        ride-chat's: chat visibility is the INTERSECTION of ride visibility
--        and crew membership, and 054 widens only the ride half.
-- --------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);

-- The crew row's ABSENCE is asserted alongside, so the next assertion cannot
-- pass merely because the fixture happened to leave the owner off the crew.
-- The property is "not crew, therefore no chat", not "no chat".
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-0000001d1280'
                     and user_id = '00000000-0000-0000-0000-000000128001'),
  0, '054: N7 — the ownerless owner holds no crew row for the member''s ride');
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-0000001d1280'),
  0, '054: N7 — ... and therefore reads zero chat messages: ownership alone never satisfies the ride-visibility ∩ crew-membership intersection');
select assert_denied($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-0000001d1280', '00000000-0000-0000-0000-000000128001',
          'Owner speaking')$$,
  '054: N7 — ... nor can they post into it');

savepoint owner_joins_crew_054;
select assert_allowed($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-0000001d1280', '00000000-0000-0000-0000-000000128001', 'going')$$,
  '054: N7 — the owner MAY join the crew of a club ride they can now see: ride_members INSERT is auth.uid() = user_id AND an RLS-filtered EXISTS, so this is the RSVP path every member already has, not a loophole');

insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000001d1280', '00000000-0000-0000-0000-000000128001', 'going');
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-0000001d1280'),
  1, '054: N7 — and thereafter reaches the chat AS CREW, the intersection satisfied by two independent facts rather than by ownership. Asserted as a positive: without it 054.7 would assert a property the system does not have');
select assert_allowed($$
  insert into ride_messages (ride_id, author_id, body)
  values ('00000000-0000-0000-0000-0000001d1280', '00000000-0000-0000-0000-000000128001',
          'Owner speaking')$$,
  '054: N7 — ... and may post in it');
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-0000001d1280'
                     and user_id = '00000000-0000-0000-0000-000000128001'),
  1, '054: N7 — ... and the crew row is in the ride''s crew list, so the reach is recorded and visible rather than silent');

-- N8 for chat. Counted rather than assert_denied: a DELETE the USING clause
-- forbids is FILTERED to zero rows, not raised, so assert_denied would fail
-- against a correct policy. Same reason harness.sql refuses assert_allowed for
-- UPDATE and DELETE.
savepoint owner_cannot_moderate_chat_054;
delete from ride_messages where id = '00000000-0000-0000-0000-0000001a1280';
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-0000001a1280'),
  1, '054: N8 — a crew-joined owner cannot delete another rider''s message in a ride they did not organize; ride_messages DELETE stays author-or-organizer');
rollback to savepoint owner_cannot_moderate_chat_054;

rollback to savepoint owner_joins_crew_054;

-- N7, part three: the block dominates the join, so the chat is unreachable by
-- EVERY route rather than only by the direct one.
savepoint block_dominates_join_054;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128002', false);
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000128002', '00000000-0000-0000-0000-000000128001');
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);
select assert_denied($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-0000001d1280', '00000000-0000-0000-0000-000000128001', 'going')$$,
  '054: N7 — a block refuses the crew insert, the policy''s EXISTS against rides being RLS-filtered: the owner cannot join');
select assert_eq((select count(*)::int from ride_messages
                   where ride_id = '00000000-0000-0000-0000-0000001d1280'),
  0, '054: N7 — ... and therefore cannot reach the chat by any route');
rollback to savepoint block_dominates_join_054;

-- --------------------------------------------------------------------------
-- 054.8  N8 / N9 — reaching a club confers NO moderation power over its
--        content. Ownership answers "may I see and participate", never "may I
--        edit, delete or evict".
--
-- All four are counted rather than assert_denied, and that is not a stylistic
-- choice: `rides` UPDATE/DELETE, `postcards` UPDATE and `club_members` DELETE
-- are all keyed in their USING clause, which FILTERS the statement to zero rows
-- instead of raising 42501. assert_denied would fail against a correct policy.
-- --------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000128001', false);

savepoint owner_cannot_edit_ride_054;
update rides set title = 'Hijacked' where id = '00000000-0000-0000-0000-0000001d1280';
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'
                     and title = 'Ownerless Club Run'),
  1, '054: N8 — the owner cannot edit a ride in their club organized by someone else; rides UPDATE stays organizer_id-keyed');
rollback to savepoint owner_cannot_edit_ride_054;

savepoint owner_cannot_delete_ride_054;
delete from rides where id = '00000000-0000-0000-0000-0000001d1280';
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-0000001d1280'),
  1, '054: N8 — ... nor delete it; rides DELETE stays organizer_id-keyed');
rollback to savepoint owner_cannot_delete_ride_054;

savepoint owner_cannot_edit_postcard_054;
update postcards set caption = 'Hijacked' where id = '00000000-0000-0000-0000-0000001e1280';
select assert_eq((select count(*)::int from postcards
                   where id = '00000000-0000-0000-0000-0000001e1280'
                     and caption = 'Posted into the club'),
  1, '054: N8 — ... nor edit another rider''s postcard in their club; postcards UPDATE stays author_id-keyed');
rollback to savepoint owner_cannot_edit_postcard_054;

savepoint owner_cannot_evict_054;
delete from club_members
 where club_id = '00000000-0000-0000-0000-0000001c1280'
   and user_id = '00000000-0000-0000-0000-000000128002';
select assert_eq((select count(*)::int from club_members
                   where club_id = '00000000-0000-0000-0000-0000001c1280'
                     and user_id = '00000000-0000-0000-0000-000000128002'),
  1, '054: N9 — ... nor remove another member; club_members DELETE stays auth.uid() = user_id');
rollback to savepoint owner_cannot_evict_054;

reset role;
select assert_eq((select count(*)::int from pg_policies
                   where schemaname = 'public' and tablename = 'club_members' and cmd = 'UPDATE'),
  0, '054: N9 — club_members still carries no UPDATE policy, so no client can change a role');

-- --------------------------------------------------------------------------
-- 054.9  The properties of the function itself, and the one that is a tripwire
--        rather than a description.
-- --------------------------------------------------------------------------
select assert_eq((select array_to_string(proconfig, ',') from pg_proc
                   where oid = 'private.is_club_member(uuid)'::regprocedure),
  'search_path=""',
  '054: is_club_member''s search_path is now empty, matching the other fourteen functions in private — safe because its body schema-qualifies every reference, so the setting has no name left to resolve');
select assert_eq((select prosecdef from pg_proc
                   where oid = 'private.is_club_member(uuid)'::regprocedure),
  true, '054: ... and it is still SECURITY DEFINER, which is what lets it read club_members and clubs on behalf of a caller who can read neither');
select assert_eq(has_schema_privilege('authenticated', 'private', 'usage'),
  false, '054: authenticated holds no USAGE on private, which is why widening is_club_member adds no security advisor and why no client can call it directly');

-- ** A tripwire, not a description. ** 054's owner arm makes this function read
-- public.clubs, and clubs' own SELECT policy calls this function — a direct
-- self-edge. It does not recurse ONLY because clubs does not force RLS and this
-- function's definer owns the table. `ALTER TABLE public.clubs FORCE ROW LEVEL
-- SECURITY` is ordinary hardening that no advisor asks for, and it would turn
-- every club read in the app into 42P17. This assertion is what makes that a
-- red suite rather than a production outage.
select assert_eq((select relforcerowsecurity from pg_class where oid = 'public.clubs'::regclass),
  false, '054: public.clubs does not FORCE row-level security — one of the TWO reasons is_club_member reading clubs, while clubs SELECT calls is_club_member, is not 42P17 infinite recursion');

-- **The second condition, and the header above names both while this section
-- used to assert only the first.** RLS is skipped inside the definer body only
-- because the function owner IS the table owner; a later migration that
-- recreates the function under a different owner, or reassigns public.clubs,
-- re-applies RLS inside the body and every club read in the app becomes 42P17 —
-- while `relforcerowsecurity` stays false and the assertion above stays green.
-- Asserting one of two stated conditions reads as covering both, which is worse
-- than asserting neither.
select assert_eq(
  (select pg_get_userbyid(relowner) from pg_class where oid = 'public.clubs'::regclass)
  = (select pg_get_userbyid(proowner) from pg_proc
      where oid = 'private.is_club_member(uuid)'::regprocedure),
  true, '054: ... and the definer owns public.clubs, which is the other reason — RLS is not applied inside a definer body owned by the table owner');

-- No policy was recreated by 054, and no direct caller lives outside `public`.
-- The second is the security-relevant half: the widening DOES reach two
-- storage.objects policies, but transitively, through an RLS-filtered EXISTS
-- rather than by naming this function.
select assert_eq((select count(*)::int from pg_policies
                   where (coalesce(qual, '') || coalesce(with_check, '')) like '%is_club_member%'
                     and schemaname <> 'public'),
  0, '054: every DIRECT caller of is_club_member is in public — storage inherits the widening through an RLS-filtered EXISTS, never by naming the function');
select assert_eq((select count(*)::int from pg_policies
                   where (coalesce(qual, '') || coalesce(with_check, '')) like '%is_club_member%'),
  10, '054: exactly ten policies call is_club_member, the count 054 left untouched — it replaced the function body and recreated no policy');

set role authenticated;
rollback to savepoint club_owner_reach_054;

-- ===========================================================================
-- 055. `ride_joined` fans out to the WHOLE CREW — everyone Going or Maybe,
--      unioned with the organizer, minus the actor, minus anyone blocked with
--      them. PD-129, widening 036 §7.4's organizer-only set.
--
-- ** THE LABELS BELOW ARE PREFIXED `055:` AND SIT UNDER THIS HEADER, WHICH IS
-- NOT A FORMALITY. ** PD-169 records that 042's assertions were filed under the
-- wrong header and have been misread as belonging to the migration above them
-- ever since. A label is the only thing a failing run prints, so it is the only
-- place the reader learns which migration is on the hook.
--
-- ** EVERY COUNT IS SCOPED TO THIS SECTION'S OWN RIDE *AND* ITS OWN ACTOR. **
-- The widened fan-out fires on every fixture RSVP in this section, and on the
-- seed's, so an unscoped `where type = 'ride_joined'` counts rows this block did
-- not write. Scoping to the ride alone is not enough either, now that a single
-- ride accumulates one fan-out per joiner: the assertion under test is the fan-
-- out caused by ONE join, so `actor_id` is part of every scope below.
-- ===========================================================================
savepoint ride_joined_crew_055;

reset role;
select set_config('test.uid', '', false);

-- Eight riders of this section's own, so no count asserted anywhere above this
-- line moves. Same rule 009's and 054's fixtures follow.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000129001', 'pd129organizer@example.com'),
  ('00000000-0000-0000-0000-000000129002', 'pd129going@example.com'),
  ('00000000-0000-0000-0000-000000129003', 'pd129maybe@example.com'),
  ('00000000-0000-0000-0000-000000129004', 'pd129actor@example.com'),
  ('00000000-0000-0000-0000-000000129005', 'pd129blockedactor@example.com'),
  ('00000000-0000-0000-0000-000000129006', 'pd129leaver@example.com'),
  ('00000000-0000-0000-0000-000000129007', 'pd129otherride@example.com'),
  ('00000000-0000-0000-0000-000000129008', 'pd129blockedorg@example.com');

update profiles set username = 'pd129organizer', location = 'Lisbon',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000129001';
update profiles set username = 'pd129going', location = 'Porto',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000129002';
update profiles set username = 'pd129maybe', location = 'Faro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000129003';
update profiles set username = 'pd129actor', location = 'Braga',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000129004';
update profiles set username = 'pd129blockedactor', location = 'Aveiro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000129005';
update profiles set username = 'pd129leaver', location = 'Evora',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000129006';
update profiles set username = 'pd129otherride', location = 'Coimbra',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000129007';
update profiles set username = 'pd129blockedorg', location = 'Setubal',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000129008';

-- d01 is the ride under test. d02 exists only so a rider can be on a DIFFERENT
-- ride — a negative that passes vacuously without one. d03 carries the organizer
-- arm ALONE: nobody RSVPs the organizer onto it, so a row reaching them there
-- can only have come through the union.
--
-- All three are PUBLIC and club-less on purpose. This section is about the
-- recipient SET, and a club or a private flag would make every read assertion
-- below depend on `rides` SELECT's second disjunct as well — which is 017's,
-- 022's and 054's territory, already covered there, and would mask which
-- conjunct a failure came from.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-0000129d0001', 'PD129 Crew Run',  'The Quay',  now() + interval '6 days',
   true, '00000000-0000-0000-0000-000000129001'),
  ('00000000-0000-0000-0000-0000129d0002', 'PD129 Other Run', 'The Bend',  now() + interval '7 days',
   true, '00000000-0000-0000-0000-000000129001'),
  ('00000000-0000-0000-0000-0000129d0003', 'PD129 Union Run', 'The Ridge', now() + interval '8 days',
   true, '00000000-0000-0000-0000-000000129001');

-- ---------------------------------------------------------------------------
-- 055.0  No JWT, which is what proves the actor is read from NEW
-- ---------------------------------------------------------------------------
-- Everything in this fixture is inserted as the TABLE OWNER with `test.uid`
-- empty, so auth.uid() is NULL throughout. 036 trap (b): had the widened
-- recipient set been written `where candidates.recipient <> auth.uid()`, that
-- predicate would be NULL rather than TRUE and would filter out EVERY
-- recipient — so every count below would read 0, every negative assertion here
-- would pass vacuously, and only the positives would fail.
select assert_eq(auth.uid(), null::uuid,
  '055: the widened fan-out is exercised with NO JWT — auth.uid() is NULL, so a recipient set written against it would filter everyone out');

-- ** ONE STATEMENT PER JOIN, AND IT MATTERS MORE HERE THAN IT DID FOR 036. **
-- An AFTER ROW trigger fires once the whole STATEMENT completes, so a batched
-- multi-row INSERT makes every row visible to every invocation. 036's club
-- fan-out already had that property; this one now reads `ride_members`, so a
-- batched RSVP would have each joiner notify riders who "already" joined in the
-- same statement. The app cannot produce that — every RSVP is one rider's own
-- request — so seeding in one batch would assert against a shape the product
-- never reaches.

-- ---------------------------------------------------------------------------
-- 055.1  The organizer's own RSVP still notifies nobody — the after-union
--        exclusion, which is the single easiest thing to break here
-- ---------------------------------------------------------------------------
-- The organizer now qualifies through BOTH arms: as `rides.organizer_id` and,
-- the instant this statement lands, as a `ride_members` row. Move the actor
-- exclusion inside either arm and the other one still yields them, so every
-- organizer RSVPing to their own ride tells themselves they joined it. 036 §7.6
-- paid for this on club creation; this is the same trap on a different table.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129001', 'going');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'),
  0, '055: the organizer RSVPing to their own ride still notifies nobody — the actor exclusion sits AFTER the union, so qualifying through both arms does not leak one through');

-- ---------------------------------------------------------------------------
-- 055.2  Building the crew. Each of these fans out in its own right; the
--        assertions under test come after, scoped to the LAST joiner.
-- ---------------------------------------------------------------------------
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129002', 'going');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129003', 'maybe');

-- The leaver joins and then leaves, so they are off the crew BEFORE the fan-out
-- under test. Written as a join-then-leave rather than simply omitting them,
-- because "a rider who never joined is not notified" is a different and much
-- weaker claim than "a rider who left is not".
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129006', 'going');
delete from ride_members
 where ride_id = '00000000-0000-0000-0000-0000129d0001'
   and user_id = '00000000-0000-0000-0000-000000129006';

-- On the crew, and blocked with the ACTOR. The block is directional in the row
-- and symmetric in effect, so it is written one way only and asserted to bite.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129005', 'going');
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000129005', '00000000-0000-0000-0000-000000129004');

-- On the crew, and blocked with the ORGANIZER rather than the actor. This is
-- 055's KNOWN GAP fixture — see 055.6.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129008', 'going');
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000129008', '00000000-0000-0000-0000-000000129001');

-- A rider on a different ride entirely.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0002', '00000000-0000-0000-0000-000000129007', 'going');

-- ---------------------------------------------------------------------------
-- 055.3  THE FAN-OUT UNDER TEST. One join, and the whole recipient set.
-- ---------------------------------------------------------------------------
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129004', 'going');

-- The positives. Each names WHY the rider is in the set, because a bare count
-- cannot distinguish "the crew arm works" from "the organizer arm fired twice".
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'
      and user_id = '00000000-0000-0000-0000-000000129002'),
  1, '055: a GOING crew member is notified — this is the widening 036 §7.4 deferred');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'
      and user_id = '00000000-0000-0000-0000-000000129003'),
  1, '055: a MAYBE crew member is notified too — a Maybe rider is still on the crew, and a ride filling up is what flips them to Going');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'
      and user_id = '00000000-0000-0000-0000-000000129001'),
  1, '055: the ORGANIZER is still notified — they stay in the union and their copy differs at render time, not by type');

-- The negatives. Every one of these is a rider the widened set could plausibly
-- have swept in.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'
      and user_id = '00000000-0000-0000-0000-000000129004'),
  0, '055: the ACTOR is never notified of their own join, though they are on the crew they just joined');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'
      and user_id = '00000000-0000-0000-0000-000000129005'),
  0, '055: a crew member BLOCKED with the actor is not notified — blocking is applied at fan-out, and the block row points the other way');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'
      and user_id = '00000000-0000-0000-0000-000000129006'),
  0, '055: a rider who ALREADY LEFT the crew is not notified — the crew arm is a live read of ride_members, not a history of it');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'
      and user_id = '00000000-0000-0000-0000-000000129007'),
  0, '055: a rider on a DIFFERENT ride is not notified — the crew arm is scoped by ride_id');

-- The whole set in one number, so a recipient nobody thought to name still fails
-- this. The three are: organizer, going, maybe.
--
-- ** THIS READ 4 UNTIL 060, AND THE MISSING FOURTH IS THE POINT. ** 055's crew
-- arm also wrote a row to the rider blocked with the ORGANIZER — a row 036 §3
-- conjunct 4 discarded on every read, for ever. 060 filters the union through
-- private.can_read_ride, so it is no longer written. See 055.6.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  3, '060: THREE rows and no fourth — organizer, going and maybe; the actor, the leaver, the blocked-with-actor rider, the other ride''s rider AND (since 060) the blocked-with-organizer crew member are all out');

-- ---------------------------------------------------------------------------
-- 055.4  The ORGANIZER ARM IN ISOLATION, which 055.3 cannot prove
-- ---------------------------------------------------------------------------
-- In 055.3 the organizer holds a `ride_members` row of their own, so their
-- notification is over-determined — the crew arm alone would have delivered it
-- and a broken union would still pass. d03 has no organizer RSVP at all, so a
-- row reaching them there came through `rides.organizer_id` and nowhere else.
-- Without this, "the organizer stays in the union" is untested.
select assert_eq(
  (select count(*)::int from ride_members
    where ride_id = '00000000-0000-0000-0000-0000129d0003'
      and user_id = '00000000-0000-0000-0000-000000129001'),
  0, '055: the organizer holds NO ride_members row on d03 — without this precondition the next assertion passes through the crew arm and proves nothing');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0003', '00000000-0000-0000-0000-000000129002', 'going');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0003'
      and actor_id = '00000000-0000-0000-0000-000000129002'
      and user_id = '00000000-0000-0000-0000-000000129001'),
  1, '055: an organizer holding no crew row is STILL notified — this is the union arm on its own, and the only assertion that fails if it is dropped');

-- ---------------------------------------------------------------------------
-- 055.5  READ-TIME RESOLVABILITY — the subset rule, applied to the widening
-- ---------------------------------------------------------------------------
-- ** THIS IS THE ASSERTION THAT ANSWERS 036 §7.5's QUESTION FOR THIS TYPE. **
-- The recipient set and the SELECT policy live in different files and a widening
-- on one side is invisible from the other, so counting rows WRITTEN cannot see
-- the failure — the whole failure is a row that exists and cannot be read.
--
-- The organizer union is safe here because `rides` SELECT leads with an
-- unconditional `organizer_id = auth.uid()` arm, unlike `ride_created_in_club`,
-- whose only club arm is a membership test. That is asserted structurally in
-- 055.7 and behaviourally right here.
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-000000129001', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  1, '055: the ORGANIZER can READ the row the union wrote them — the union is safe for ride_joined, which is exactly what 036 §7.5 refuses for ride_created_in_club');

select set_config('test.uid', '00000000-0000-0000-0000-000000129002', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  1, '055: ... and so can a GOING crew member — the widened rows are not write-only');

select set_config('test.uid', '00000000-0000-0000-0000-000000129003', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  1, '055: ... and so can a MAYBE crew member');

-- The negative side of the read: a rider outside the recipient set reads none of
-- it, addressed to somebody else. 036 §3 conjunct 1 is what does this, and it
-- would be the first thing a careless widening broke.
select set_config('test.uid', '00000000-0000-0000-0000-000000129007', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'),
  0, '055: the other ride''s rider reads NOTHING about d01 — widening the recipient set widened no read');
select set_config('test.uid', '00000000-0000-0000-0000-000000129004', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  0, '055: the actor cannot read a single row their own join caused — the actor learns nothing about delivery, 036 §3 conjunct 1');

reset role;
select set_config('test.uid', '', false);

-- ---------------------------------------------------------------------------
-- 055.6 / 060  THE GAP 055 PINNED, NOW CLOSED. A crew member blocked with the
--              ORGANIZER is written NO ROW AT ALL.
-- ---------------------------------------------------------------------------
-- ** THE ASSERTION THAT MOVED IS THE ONE COUNTING WRITES, AND THE READ-BACK ONE
-- LOOKS IDENTICAL EITHER WAY. ** Under 055 the row was written and discarded on
-- every read; under 060 it is never written. Both read back 0 as the recipient,
-- so a read-only assertion here would have passed unchanged through the entire
-- repair and proved nothing. The write count is asserted first, as the TABLE
-- OWNER, for exactly that reason.
--
-- The mechanism is unchanged and is still the reason this is reachable rather
-- than contrived: a `ride_members` row does not imply its holder can SELECT the
-- ride, because blocking removes nobody from a roster. What changed is that the
-- fan-out now asks — private.can_read_ride(candidate, ride), the subject-taking
-- shape 036 trap (c) demands, which 055's header named and PD-211 built.
--
-- ** WHAT THIS COSTS, STATED WHERE THE BEHAVIOUR CHANGED. ** 055 called the gap
-- REVERSIBLE: the unreadable row became readable on unblocking. There is now no
-- row to become readable, so a rider who unblocks gets no backlog for the
-- period they were blocked. That is consistent with every other fan-out in 036
-- — each suppresses at fan-out time when a block stands (§7.1: "a block
-- suppresses the notification, not the action") — and with §7.6's rule that a
-- notification records an event at an instant rather than a standing claim. The
-- suppression is LIVE STATE, not a permanent exclusion of this rider, and the
-- probe below is what proves the difference.
select assert_eq(
  (select count(*)::int from ride_members
    where ride_id = '00000000-0000-0000-0000-0000129d0001'
      and user_id = '00000000-0000-0000-0000-000000129008'),
  1, '055: the blocked-with-organizer rider is STILL on the crew — blocking removes nobody from a roster, which is what made the gap reachable rather than contrived');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'
      and user_id = '00000000-0000-0000-0000-000000129008'),
  0, '060: ... and NO ROW IS WRITTEN to them — counted as the table owner, which is the only reader that can tell "never written" from "written and unreadable". This was 1 under 055');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000129008', false);
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-0000129d0001'),
  0, '055: ... and they cannot SELECT the ride, because rides SELECT''s organizer arm is not theirs and its second disjunct is gated on not being blocked with the organizer — the exact question can_read_ride now asks on their behalf');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  0, '060: ... so they read zero — unchanged in value from 055 and NOT the assertion that proves the repair, which is the write count above');
reset role;
select set_config('test.uid', '', false);

-- ** THE SUPPRESSION IS STATE, NOT A VERDICT ON THIS RIDER. ** Unblocking
-- returns no backlog — there is nothing to return — but the NEXT join reaches
-- them, and they can read it. Without this, "no row" would be indistinguishable
-- from a can_read_ride that returns false for everyone, which is the shape a
-- narrowing fails in.
delete from blocks
 where blocker_id = '00000000-0000-0000-0000-000000129008'
   and blocked_id = '00000000-0000-0000-0000-000000129001';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000129008', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  0, '060: unblocking returns NO BACKLOG — 055''s row was never written, so there is nothing to reveal. This assertion read 1 under 055 and its inversion is the one behaviour change 060 makes to a rider');
reset role;
select set_config('test.uid', '', false);

-- A fresh join, with the block lifted. The joiner is the other ride's rider,
-- who is not on d01's crew and so can actually cause a fan-out here.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129007', 'going');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000129008', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129007'),
  1, '060: ... and once unblocked they ARE notified of the next join, and can READ it — the narrowing tracks live visibility rather than excluding a rider for good');
reset role;
select set_config('test.uid', '', false);

-- Restore the fixture: the block goes back, and the fresh joiner comes off the
-- crew so 055.8's recipient set below is the same three riders 055.3 asserted.
-- Their rows survive — leaving retracts nothing — and every count in 055.8 is
-- scoped to actor 129004, so they are invisible to it.
delete from ride_members
 where ride_id = '00000000-0000-0000-0000-0000129d0001'
   and user_id = '00000000-0000-0000-0000-000000129007';
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000129008', '00000000-0000-0000-0000-000000129001');

-- ---------------------------------------------------------------------------
-- 055.6b / 060  THE SAME GAP BY THE OTHER ROUTE, ALSO CLOSED: a crew member who
--               LEFT THE CLUB.
-- ---------------------------------------------------------------------------
-- ** TWO MECHANISMS, ONE GAP, AND THIS IS WHY THE CHEAP FIX WAS REFUSED. **
-- 055.6 reaches it through a block. This reaches it through club membership,
-- with no block anywhere in the fixture — a rider RSVPs to a PRIVATE club's ride
-- while a member, then leaves the club and keeps their `ride_members` row.
--
-- The two are worth separating because a fan-out that excluded candidates
-- blocked with the organizer would close 055.6 and leave THIS untouched, while
-- reading as a complete repair. Any fix had to satisfy both, which is what made
-- `private.can_read_ride(candidate, ride)` — a helper taking its subject as an
-- argument — the shape rather than another `is_blocked` call. 060 built it, and
-- this section is the half that proves it is not merely a second block test.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000129c0001', 'PD129 Private MC', false,
   '00000000-0000-0000-0000-000000129001');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000129c0001', '00000000-0000-0000-0000-000000129001', 'owner');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000129c0001', '00000000-0000-0000-0000-000000129006', 'member');
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-0000129d0004', 'PD129 Club Run', 'The Gate',
   now() + interval '9 days', false, '00000000-0000-0000-0000-0000129c0001',
   '00000000-0000-0000-0000-000000129001');

-- The leaver joins the club's ride while still a member, and can read it.
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0004', '00000000-0000-0000-0000-000000129006', 'going');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000129006', false);
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-0000129d0004'),
  1, '055: the club member CAN read the private club''s ride while their membership stands — the precondition, without which the eviction below proves nothing');
reset role;
select set_config('test.uid', '', false);

-- They leave the CLUB. Nothing removes them from the ride's crew: club_members
-- DELETE is a bare `auth.uid() = user_id`, and no trigger reaches ride_members.
delete from club_members
 where club_id = '00000000-0000-0000-0000-0000129c0001'
   and user_id = '00000000-0000-0000-0000-000000129006';
select assert_eq(
  (select count(*)::int from ride_members
    where ride_id = '00000000-0000-0000-0000-0000129d0004'
      and user_id = '00000000-0000-0000-0000-000000129006'),
  1, '055: leaving the club leaves them ON THE RIDE''S CREW — no trigger reaches ride_members, which is what makes them a live fan-out candidate who can no longer resolve the ride');

-- ** AND THEY CANNOT RESOLVE THE RIDE ANY MORE. ** The precondition that makes
-- the zero below mean something, and the exact question can_read_ride asks: it
-- fails on the club arm, with no block anywhere in this fixture.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000129006', false);
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-0000129d0004'),
  0, '055: ... and can no longer SELECT the ride — a private club''s ride resolves through private.is_club_member alone, and they hold neither a membership row nor the club');
reset role;
select set_config('test.uid', '', false);

-- A third rider joins that ride, so the ex-member is fanned out to as crew.
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000129c0001', '00000000-0000-0000-0000-000000129002', 'member');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0004', '00000000-0000-0000-0000-000000129002', 'going');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0004'
      and actor_id = '00000000-0000-0000-0000-000000129002'
      and user_id = '00000000-0000-0000-0000-000000129006'),
  0, '060: the ex-member is written NO ROW — was 1 under 055, whose crew arm was a live read of ride_members that knew nothing about club membership. Counted as the table owner: this is the route a block-only fix would have missed entirely');

-- ** THE FAN-OUT STILL FIRED. ** Without this, the zero above is equally
-- explained by can_read_ride returning false for everybody, which is precisely
-- how a narrowing fails — silently, in the safe-looking direction.
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0004'
      and actor_id = '00000000-0000-0000-0000-000000129002'
      and user_id = '00000000-0000-0000-0000-000000129001'),
  1, '060: ... while the ORGANIZER of that same private club ride IS notified by the same fan-out — so the zero above is the ex-member''s visibility, not a fan-out that stopped writing');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000129006', false);
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0004'
      and actor_id = '00000000-0000-0000-0000-000000129002'
      and user_id = '00000000-0000-0000-0000-000000129006'),
  0, '060: ... and they read zero, as they did under 055 — value unchanged, cause changed. The write count above is what moved, which is why a read-only assertion could never have gated this repair');
reset role;
select set_config('test.uid', '', false);

-- ---------------------------------------------------------------------------
-- 055.7  The policy text the union's safety DEPENDS ON, pinned structurally
-- ---------------------------------------------------------------------------
-- 055.5 proves the organizer can read their row today. This proves WHY, so that
-- a future rewrite of `rides` SELECT — it has already been rewritten by 017 and
-- by 022, and 054 changed a function underneath it this week — fails here with a
-- pointer rather than silently turning every organizer notification into a dead
-- row. 036 §3 makes the same argument for not deriving one policy from another.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'rides' and cmd = 'SELECT'
      and qual like '((organizer_id = auth.uid()) OR %'),
  1, '055: rides SELECT still LEADS with an unconditional organizer arm, at the top level of an OR — this is the whole reason unioning rides.organizer_id is safe for ride_joined and not for ride_created_in_club');

-- ** AND THE OTHER HALF: THERE IS NO CREW ARM AT ALL. ** Measured on DEV
-- 2026-08-12 and again 2026-08-17. `rides` SELECT resolves through organizer,
-- public, or club membership — a `ride_members` row is NOT one of the ways in.
--
-- ** THIS ASSERTION CHANGED MEANING IN 060 WITHOUT CHANGING ITS VALUE. ** Under
-- 055 it recorded WHY 055.6's gap existed, and adding a crew arm would have
-- closed that gap. 060 closed the gap from the fan-out end instead, and the
-- absence is now LOAD-BEARING rather than merely explanatory: `034`'s
-- ride_messages policies and `041`'s postcard ride-tag WITH CHECK are both an
-- INTERSECTION of "can see the ride" with private.is_ride_crew, and 034's own
-- comment says the crew half alone "lets an ex-club-member read a private
-- ride's chat". A crew arm here collapses that intersection. 060's header
-- carries the full argument for why the cheap end of PD-211 was refused.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'rides' and cmd = 'SELECT'
      and (qual like '%ride_members%' or qual like '%is_ride_crew%')),
  0, '060: rides SELECT still has NO crew arm — adding one would collapse 034''s ride_messages intersection and 041''s tag gate into their crew halves, which is the leak 034 shipped in draft and fixed. 060 narrowed the fan-out instead');

-- The status domain the crew arm names. `status in ('going','maybe')` is total
-- against today's CHECK, so it currently excludes nothing; the day a third
-- status is added it stops being total and the recipient set silently changes
-- meaning. This turns that into a failing test rather than a silent widening.
select assert_eq(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.ride_members'::regclass
      and conname = 'ride_members_status_check'),
  'CHECK ((status = ANY (ARRAY[''going''::text, ''maybe''::text])))',
  '055: ride_members.status is still exactly {going, maybe} — the crew arm names both, so a third status added without revisiting 055 changes who gets notified');

-- ---------------------------------------------------------------------------
-- 055.8  Idempotence and the INSERT-only shape, on the WIDENED set
-- ---------------------------------------------------------------------------
-- 036 asserted both against the organizer alone. A recipient set of one cannot
-- distinguish "the uniqueness index caught the rejoin" from "the second fan-out
-- addressed a different rider", so both are re-asserted against a set of three.
-- It was four until 060 stopped writing to the blocked-with-organizer rider;
-- the shape these assert is unchanged and only the size of the set moved.
update ride_members set status = 'maybe'
 where ride_id = '00000000-0000-0000-0000-0000129d0001'
   and user_id = '00000000-0000-0000-0000-000000129004';
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  3, '055: flipping going<->maybe writes nothing to any of the three — the fan-out is on INSERT and there is no trigger on UPDATE');

delete from ride_members
 where ride_id = '00000000-0000-0000-0000-0000129d0001'
   and user_id = '00000000-0000-0000-0000-000000129004';
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  3, '055: leaving retracts nothing from the crew either — no AFTER DELETE trigger on ride_members, and the join really happened');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-0000129d0001', '00000000-0000-0000-0000-000000129004', 'going');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_joined' and ride_id = '00000000-0000-0000-0000-0000129d0001'
      and actor_id = '00000000-0000-0000-0000-000000129004'),
  3, '055: leaving and rejoining does not stack a second row in ANY crew member''s list — notifications_event_key, nulls not distinct, still absorbs it');

-- ---------------------------------------------------------------------------
-- 055.9  The function itself, and the contract 055 must not have relaxed
-- ---------------------------------------------------------------------------
-- `create or replace` is the one shape that can quietly drop a property: the
-- replacement carries whatever the new text says and nothing warns that the old
-- text said more. Each of these is a clause the widening could have lost.
select assert_eq(
  (select prosecdef from pg_proc where oid = 'private.notify_ride_joined()'::regprocedure),
  true, '055: the widened fan-out is STILL security definer — without it the trigger is refused outright, since authenticated holds no INSERT grant on notifications');
-- Note the stored form: `set search_path = ''` is recorded as the four
-- characters `search_path=""`, NOT as `search_path=`. Asserting the latter fails
-- against a perfectly correct function, which is how this assertion was first
-- written. Compared against a SIBLING fan-out as well, so the pair cannot drift
-- and so a Postgres change to the representation fails neither.
select assert_eq(
  (select proconfig[1] from pg_proc where oid = 'private.notify_ride_joined()'::regprocedure),
  'search_path=""', '055: ... and still pins an EMPTY search_path, so every name in the body resolves schema-qualified or not at all');
select assert_eq(
  (select proconfig from pg_proc where oid = 'private.notify_ride_joined()'::regprocedure)
  = (select proconfig from pg_proc where oid = 'private.notify_club_joined()'::regprocedure),
  true, '055: ... identical to the sibling fan-out 055 was modelled on, so the two cannot drift apart');
select assert_eq(
  (select prosrc like '%auth.uid()%' from pg_proc
    where oid = 'private.notify_ride_joined()'::regprocedure),
  false, '055: auth.uid() appears NOWHERE in the widened body — 036 trap (b); against a NULL uid a self-suppression written that way filters out every recipient');
select assert_eq(
  (select prosrc like '%is_ride_crew%' from pg_proc
    where oid = 'private.notify_ride_joined()'::regprocedure),
  false, '055: and private.is_ride_crew is NOT reached for — its name is the recipient set, but it reads auth.uid() internally, so it answers for the CALLER and would make the set everybody');

-- The grant posture, named by ROLE rather than attempted — 031's lesson, and the
-- suite runs as the table owner, for whom the barrier does not exist.
select assert_eq(
  (select count(*)::int from (values ('authenticated'), ('anon'), ('service_role')) as r(role)
    where has_function_privilege(r.role, 'private.notify_ride_joined()', 'execute')),
  0, '055: no client role and not service_role can execute the widened fan-out — create or replace preserves privileges, and 055 re-issues the revoke anyway');

-- The trigger binding survives `create or replace` because the OID does, so no
-- trigger DDL was issued. Asserted because re-creating it would have been the
-- obvious wrong move, and a WHEN clause is what would have arrived with it.
select assert_eq(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.ride_members'::regclass
      and not tgisinternal and tgname = 'notify_ride_joined' and tgqual is null),
  1, '055: the trigger is still bound to ride_members and still carries NO when clause — create or replace keeps the OID, so 055 issues no trigger DDL');

-- The comment 036 §7.7 wrote is now false and had to move with the body. A
-- database comment is the one piece of documentation no edit to CLAUDE.md can
-- reach, which is why 028 and 033 exist.
select assert_eq(
  (select obj_description('private.notify_ride_joined()'::regprocedure, 'pg_proc')
     like '%organizer and nobody else%'),
  false, '055: the function comment no longer claims the organizer and nobody else — 036 §7.7''s text would have become a lie');
select assert_eq(
  (select obj_description('private.notify_ride_joined()'::regprocedure, 'pg_proc')
     like '%WHOLE CREW%'),
  true, '055: ... and says what it now does instead');

-- ---------------------------------------------------------------------------
-- 055.10  Nothing else moved. 055 is one function and one comment.
-- ---------------------------------------------------------------------------
-- The product owner's decision was explicitly that the organizer keeps a
-- DISTINCT STRING CHOSEN AT RENDER TIME rather than a new notification type. So
-- the type CHECK and the subject shape must be untouched — a sixth type here
-- would be the change that decision refused.
select assert_eq(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_type_check'),
  'CHECK ((type = ANY (ARRAY[''postcard_liked''::text, ''postcard_commented''::text, ''ride_joined''::text, ''club_joined''::text, ''ride_created_in_club''::text])))',
  '055: the type CHECK is UNTOUCHED at five types — the organizer''s distinct copy is chosen at render time by comparing the reader against rides.organizer_id, not by a sixth type');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'notifications'),
  2, '055: still exactly two policies on notifications, SELECT and UPDATE — 055 created none, dropped none, and added no INSERT policy');
select assert_eq(
  (select count(*)::int from (values ('authenticated'), ('anon')) as r(role)
    where has_table_privilege(r.role, 'public.notifications', 'insert')),
  0, '055: and neither client role gained an INSERT grant — fan-out stays trigger-only, which is what the absent grant enforces');

set role authenticated;
rollback to savepoint ride_joined_crew_055;

\echo ''
\echo '# 056 — a username keeps the case the rider typed; uniqueness still folds (PD-226)'

-- ===========================================================================
-- 056. `profiles_username_format` relaxes its charset to `A-Za-z0-9_`, so `Pedro`
--      stores as `Pedro`. Exactly one of 003 §4's two rules moved: the unique
--      index on `lower(username)` is UNTOUCHED, which is why `pedro`, `PEDRO`
--      and `PeDrO` are unavailable to everyone else.
--
-- ** Every assertion here runs under `set role authenticated` with the harness's
-- `test.uid` set. ** The suite otherwise runs as the table owner, for whom RLS
-- does not apply — and 056.4 in particular is meaningless without it, since its
-- whole content is what one rider can see of another.
--
-- Two of the four sections exist because the relaxation is not self-contained:
--
--   056.2  the reserved list was written lowercase BECAUSE the charset forced
--          lowercase (003 §4 says so in as many words). Relax one and leave the
--          other and `Admin` is a registerable username — no error, no red, a
--          rider rendering as `Admin` on every byline.
--   056.4  the availability check had to move off `.eq('username', …)`, and the
--          two things that must survive that move are (a) it is still
--          block-aware and (b) it does not treat `_` as a wildcard.
-- ===========================================================================
savepoint username_case_056;

reset role;
select set_config('test.uid', '', false);

-- Two riders of their own, so no count asserted anywhere above this line moves.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000226001', 'pd226holder@example.com'),
  ('00000000-0000-0000-0000-000000226002', 'pd226rival@example.com');

update profiles set location = 'Lisbon',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id in ('00000000-0000-0000-0000-000000226001',
               '00000000-0000-0000-0000-000000226002');

set role authenticated;

-- --------------------------------------------------------------------------
-- 056.1  POSITIVE: the case the rider typed is the case that is stored
-- --------------------------------------------------------------------------
-- Written for real and read back, never `assert_allowed`: an UPDATE filtered to
-- zero rows does not raise, so "allowed" passes against a policy that permits
-- nothing. Same rule as 003's own positive case.
select set_config('test.uid', '00000000-0000-0000-0000-000000226001', false);

update profiles set username = 'Pedro' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'Pedro',
  '056: a username stores the case the rider typed — `Pedro` is written and read back as `Pedro`, not folded');

savepoint mixed_case_056;
update profiles set username = 'Road_King_99' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'Road_King_99', '056: ... including mixed case beside the digits and underscore 003 already allowed');
rollback to savepoint mixed_case_056;

-- The boundaries 056 did NOT move, restated against the widened charset so a
-- future relaxation cannot quietly take them with it.
select assert_rejected($$update profiles set username = 'Ab'
  where id = '00000000-0000-0000-0000-000000226001'$$,
  '23514', '056: two characters is still too short, capitals or not');
-- The length bound is 057's rather than 056's, and it is restated here in the
-- widened charset for this block's own reason: `Aaaa…` and `aaaa…` are one
-- constraint away from being different lengths if the two rules are ever merged
-- into a per-case alternation. 26, not 21 — 057 moved the bound, and the
-- assertion that stood here refused a name the database now accepts.
select assert_rejected($$update profiles set username = 'Aaaaaaaaaaaaaaaaaaaaaaaaaa'
  where id = '00000000-0000-0000-0000-000000226001'$$,
  '23514', '056/057: twenty-six characters is still too long, capitals or not');
select assert_rejected($$update profiles set username = 'Road King'
  where id = '00000000-0000-0000-0000-000000226001'$$,
  '23514', '056: a space is still an illegal character');

-- --------------------------------------------------------------------------
-- 056.2  NEGATIVE: every case-variant of a taken name is refused
-- --------------------------------------------------------------------------
-- 23505 in all four, not 23514: the refusal is the INDEX's, which is the whole
-- reason 003 put uniqueness on `lower(username)` rather than on the raw value.
-- Before 056 three of these four failed the charset CHECK first and could not
-- reach the index at all — which is why 003's own header called a `Ripper`
-- attempt "testing the check constraint, not the index".
select set_config('test.uid', '00000000-0000-0000-0000-000000226002', false);

select assert_rejected($$update profiles set username = 'Pedro'
  where id = '00000000-0000-0000-0000-000000226002'$$,
  '23505', '056: a second rider cannot take the name exactly as it is written');
select assert_rejected($$update profiles set username = 'pedro'
  where id = '00000000-0000-0000-0000-000000226002'$$,
  '23505', '056: ... nor its all-lowercase variant');
select assert_rejected($$update profiles set username = 'PEDRO'
  where id = '00000000-0000-0000-0000-000000226002'$$,
  '23505', '056: ... nor its all-uppercase variant');
select assert_rejected($$update profiles set username = 'PeDrO'
  where id = '00000000-0000-0000-0000-000000226002'$$,
  '23505', '056: ... nor any mixed-case variant — the impersonation vector 003 Q4 closed stays closed');

-- --------------------------------------------------------------------------
-- 056.3  NEGATIVE: `Admin` does not walk through a lowercase denylist
-- --------------------------------------------------------------------------
-- The trap this migration existed to close as much as the charset itself. Each
-- of these passes `username <> ALL (ARRAY['admin', …])` — the 003 comparison —
-- and is refused only because 056 folds the column before comparing.
select assert_rejected($$update profiles set username = 'Admin'
  where id = '00000000-0000-0000-0000-000000226002'$$,
  '23514', '056: a reserved name in title case is refused — the denylist compares folded, not exact');
select assert_rejected($$update profiles set username = 'ADMIN'
  where id = '00000000-0000-0000-0000-000000226002'$$,
  '23514', '056: ... and in upper case');
select assert_rejected($$update profiles set username = 'LetsRide'
  where id = '00000000-0000-0000-0000-000000226002'$$,
  '23514', '056: ... and the brand name in the casing anyone would actually try');
select assert_rejected($$update profiles set username = 'Rides'
  where id = '00000000-0000-0000-0000-000000226002'$$,
  '23514', '056: ... and a route segment, which is the half of the list nobody thinks about');

-- The constraint definitions themselves, because both assertions above would
-- also pass against a database where someone had added seventeen capitalised
-- entries to the list instead of folding the column — which is the maintenance
-- burden 056 exists to avoid rather than an equivalent implementation.
reset role;
select assert_eq(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_format'),
  'CHECK (((username IS NULL) OR (username ~ ''^[A-Za-z0-9_]{3,25}$''::text)))',
  '056/057: profiles_username_format admits capitals and nothing else, up to 25 characters');
select assert_eq(
  (select pg_get_constraintdef(oid) like '%lower(username) <> ALL%' from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_not_reserved'),
  true,
  '056: profiles_username_not_reserved compares lower(username), so the list stays seventeen lowercase names');
set role authenticated;

-- --------------------------------------------------------------------------
-- 056.4  The availability check: case-insensitive, still block-aware, no wildcards
-- --------------------------------------------------------------------------
-- `username_exists` replaced `.eq('username', …)`, which PostgREST cannot make
-- case-insensitive. The three properties that had to survive that move are the
-- three failure modes of the obvious alternatives, so each has its own
-- assertion rather than being implied by the others.
select set_config('test.uid', '00000000-0000-0000-0000-000000226002', false);

select assert_eq(public.username_exists('Pedro'), true,
  '056: username_exists finds a taken name spelled exactly as stored');
select assert_eq(public.username_exists('pedro'), true,
  '056: ... and spelled in lower case');
select assert_eq(public.username_exists('PEDRO'), true,
  '056: ... and in upper case — a `.eq()` filter answered false here and sent the rider to a 23505 on submit');
select assert_eq(public.username_exists('pedr'), false,
  '056: ... and does not find a name nobody holds');

-- ** The assertion that fails if anyone "simplifies" this to `.ilike()`. **
-- LIKE reads `_` as a single-character wildcard and the charset allows
-- underscores, so `ilike 'road_king'` matches a stored `roadXking` and reports
-- a free name taken. PostgREST exposes no ESCAPE clause, so that defect could
-- not be repaired at the call site — which is the whole reason this is a
-- function. The fixture is the collision itself: the name in the table differs
-- from the probe only where the wildcard would be.
--
-- ** 075 moved the FIXTURE and neither label nor expected value. ** The name
-- used to be written onto 226002 and probed from 226002's own seat, which
-- worked only while `username_exists` counted the caller's own row. 075
-- excludes it, so the positive control below would read `false` and the
-- wildcard assertion above it would then pass by finding nothing at all —
-- green, and testing neither property. 226001 holds the name now and 226002
-- still asks the question, which is what both labels always described.
savepoint underscore_wildcard_056;
select set_config('test.uid', '00000000-0000-0000-0000-000000226001', false);
update profiles set username = 'roadXking' where id = auth.uid();
select set_config('test.uid', '00000000-0000-0000-0000-000000226002', false);
select assert_eq(public.username_exists('road_king'), false,
  '056: username_exists does not read `_` as a wildcard — `road_king` is free while `roadXking` is taken (this is what .ilike() would get wrong)');
select assert_eq(public.username_exists('roadXking'), true,
  '056: ... and still finds the literal name, so the assertion above is not passing by finding nothing');
rollback to savepoint underscore_wildcard_056;

-- ** The security-relevant one: it is `security invoker`, so it answers under
-- the block-aware SELECT policy. ** As `security definer` the first of these
-- would read `true` — which does not fix the asymmetry 038.3 pins, it converts
-- it into a channel reporting the EXISTENCE of a blocked rider's username to
-- the party they blocked. 1a blocked 1b; the seed's fixtures.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq(public.username_exists('blocker'), false,
  '056: username_exists answers under the block-aware policy — a name held by a rider who blocked the caller still reads FREE, exactly as the .eq() filter it replaced did');
select assert_eq(public.username_exists('BLOCKER'), false,
  '056: ... in every case, so folding did not widen what the caller can see');
select assert_rejected($$update profiles set username = 'Blocker'
  where id = '00000000-0000-0000-0000-00000000001b'$$,
  '23505',
  '056: ... while the index still refuses the name in any case — 038.3''s asymmetry is unchanged, not reopened');

-- The catalog half, per 031: a function the client cannot reach is worse than
-- none, and the suite runs as the table owner, for whom no grant barrier
-- exists. So EXECUTE is asserted BY ROLE rather than by the calls above.
reset role;
select assert_eq(
  (select prosecdef from pg_proc where oid = 'public.username_exists(text)'::regprocedure),
  false,
  '056: username_exists is security INVOKER — the one keyword that would silently turn the availability check into a block-piercing read');
select assert_eq(
  (select proconfig from pg_proc where oid = 'public.username_exists(text)'::regprocedure),
  array['search_path=""'],
  '056: ... with its search_path pinned, so a caller cannot shadow `profiles` with their own table');
select assert_eq(
  has_function_privilege('authenticated', 'public.username_exists(text)', 'execute'),
  true, '056: `authenticated` can actually call it — 031''s lesson, asserted by role rather than by calling it as the owner');
select assert_eq(
  has_function_privilege('anon', 'public.username_exists(text)', 'execute'),
  false, '056: ... and `anon` cannot, because decision #1 grants that role nothing anywhere');
select assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'username_exists' and n.nspname = 'public'),
  1, '056: ... and it lives in `public`, which is the only schema PostgREST routes to (029''s defect, which 031 had to undo)');

set role authenticated;
rollback to savepoint username_case_056;

-- ===========================================================================
-- 058. Every rider joins the club carrying `clubs.is_default` the moment they
--      complete onboarding, its fan-out is silenced, and no rider can point
--      that flag at a club of their own.
--
-- ** THE LABELS BELOW ARE PREFIXED `058:` AND SIT UNDER THIS HEADER. ** PD-169
-- again: a label is the only thing a failing run prints, so it is the only
-- place the reader learns which migration is on the hook.
--
-- ** THE ASSERTION THAT MATTERS MOST IS 058.6, AND IT IS NOT THE HAPPY PATH. **
-- The join runs inside `complete_onboarding()`'s transaction, so an error there
-- would roll the completion stamp back and strand the rider in a wizard
-- decision #5 gives no way out of. Every other assertion here proves a welcome
-- club works; that one proves a broken welcome club cannot cost a rider their
-- account. It is exercised by making the insert genuinely raise, because an
-- exception block that is never entered tests nothing.
--
-- The fixture is this section's own — its own riders, its own two clubs — so no
-- count asserted above this line moves. Same rule 009's, 054's and 055's
-- fixtures follow.
-- ===========================================================================
savepoint default_club_058;

reset role;
select set_config('test.uid', '', false);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000058001', 'pd058owner@example.com'),
  ('00000000-0000-0000-0000-000000058002', 'pd058joiner@example.com'),
  ('00000000-0000-0000-0000-000000058003', 'pd058leaver@example.com'),
  ('00000000-0000-0000-0000-000000058004', 'pd058failsafe@example.com'),
  ('00000000-0000-0000-0000-000000058005', 'pd058ordinary@example.com');

-- The welcome club's owner is finished. The other four are mid-wizard with a
-- username and consent and NO completion stamp — the only state from which
-- `complete_onboarding()` does anything at all, and therefore the only one that
-- exercises 058 rather than its `v_was_complete` short-circuit.
update profiles set username = 'pd058owner', location = 'Lisbon',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000058001';
update profiles set username = 'pd058joiner',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000058002';
update profiles set username = 'pd058leaver',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000058003';
update profiles set username = 'pd058failsafe',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000058004';
update profiles set username = 'pd058ordinary',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000058005';

-- c1 is the welcome club. c2 is an ordinary public club and exists only as the
-- regression floor for §4: an early return written one line too high would
-- silence `club_joined` for every club in the app, and every assertion about
-- the welcome club would still pass.
insert into clubs (id, name, is_public, owner_id, is_default) values
  ('00000000-0000-0000-0000-0000058c0001', 'PD058 Welcome', true,
   '00000000-0000-0000-0000-000000058001', true);
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000058c0002', 'PD058 Ordinary', true,
   '00000000-0000-0000-0000-000000058001');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000058c0001', '00000000-0000-0000-0000-000000058001', 'owner');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000058c0002', '00000000-0000-0000-0000-000000058001', 'owner');

-- ---------------------------------------------------------------------------
-- 058.0  The flag is singular, and it is public. Both are enforced, not
--        assumed — §2 reads it with a bare `where is_default`.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from clubs where is_default), 1,
  '058: exactly one club carries the flag, which is the premise every assertion below rests on');
select assert_eq(
  (select is_default from clubs where id = '00000000-0000-0000-0000-0000058c0002'), false,
  '058: ... and an ordinary club defaults to false rather than NULL — a three-valued column would make `where is_default` drop the NULLs and read identically');

select assert_rejected($$insert into clubs (id, name, is_public, owner_id, is_default) values
  ('00000000-0000-0000-0000-0000058c0004', 'PD058 Second Default', true,
   '00000000-0000-0000-0000-000000058001', true)$$,
  '23505', '058: a SECOND default club is refused by clubs_one_default_club — without the partial unique index, complete_onboarding would join every new rider to all of them');

-- Unflagged first, so the CHECK is what refuses this and not the unique index
-- — both apply to a private second default, and a test that accepted either
-- would pass with the CHECK deleted.
savepoint private_default_058;
update clubs set is_default = false where id = '00000000-0000-0000-0000-0000058c0001';
select assert_rejected($$insert into clubs (id, name, is_public, owner_id, is_default) values
  ('00000000-0000-0000-0000-0000058c0005', 'PD058 Private Default', false,
   '00000000-0000-0000-0000-000000058001', true)$$,
  '23514', '058: the default club must be PUBLIC — every rider would otherwise hold a membership of a club that appears on no Explore list and whose roster is the entire user base');
rollback to savepoint private_default_058;

-- ---------------------------------------------------------------------------
-- 058.1  The grant posture. This is the security half of 058: a rider who
--        could write this column would have every future signup join their
--        club.
-- ---------------------------------------------------------------------------
select assert_eq(
  has_column_privilege('authenticated', 'public.clubs', 'is_default', 'select'), true,
  '058: `authenticated` can READ the flag — granted deliberately, so a screen can tell the welcome club apart and so the next select(''*'') does not earn a 42501');
select assert_eq(
  has_column_privilege('authenticated', 'public.clubs', 'is_default', 'insert'), false,
  '058: ... and cannot INSERT it, so a rider cannot create a club that is born the default');
select assert_eq(
  has_column_privilege('authenticated', 'public.clubs', 'is_default', 'update'), false,
  '058: ... and cannot UPDATE it, which is the one that matters — clubs UPDATE''s policy permits an owner to write their own row, so the COLUMN grant is the only thing standing between a rider and every future signup');
select assert_eq(
  has_column_privilege('anon', 'public.clubs', 'is_default', 'select'), false,
  '058: ... and `anon` holds nothing on it, per decision #1');

-- The same three, exercised rather than read off the catalog — 031's lesson is
-- that a role assertion and a real call can disagree, so this section does both.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058001', false);

select assert_eq(
  (select is_default from clubs where id = '00000000-0000-0000-0000-0000058c0001'), true,
  '058: the SELECT grant is not vacuous — an ordinary rider really can read the flag');
select assert_rejected($$update clubs set is_default = true
  where id = '00000000-0000-0000-0000-0000058c0002'$$,
  '42501', '058: a club''s OWNER cannot point the flag at their own club — refused by the column grant, before clubs UPDATE''s policy (which would permit this row) is ever consulted');
select assert_rejected($$insert into clubs (id, name, is_public, owner_id, is_default) values
  ('00000000-0000-0000-0000-0000058c0006', 'PD058 Sneaky', true,
   '00000000-0000-0000-0000-000000058001', true)$$,
  '42501', '058: ... nor create one already carrying it, which is the same hole through the INSERT door');

-- Proof the two refusals above are the grant and not a broken policy: the same
-- owner, the same row, a column they DO hold.
savepoint owner_can_still_write_058;
update clubs set name = 'PD058 Ordinary renamed'
  where id = '00000000-0000-0000-0000-0000058c0002';
select assert_eq(
  (select name from clubs where id = '00000000-0000-0000-0000-0000058c0002'),
  'PD058 Ordinary renamed',
  '058: ... while that owner can still update a column they hold, so the two assertions above are the grant refusing and not the policy');
rollback to savepoint owner_can_still_write_058;

-- ---------------------------------------------------------------------------
-- 058.2  THE POSITIVE. Finishing the wizard puts the rider in the welcome
--        club, as a `member` and nothing more.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058002', false);
select assert_eq(public.complete_onboarding('Porto') is not null, true,
  '058: complete_onboarding still returns the stamp it set');

reset role;
select assert_eq(
  (select role from club_members
    where club_id = '00000000-0000-0000-0000-0000058c0001'
      and user_id = '00000000-0000-0000-0000-000000058002'),
  'member',
  '058: ... and the rider is now in the welcome club as a MEMBER — never owner or admin, which would hand every signup moderation over a club they have not seen');
select assert_eq(
  (select count(*)::int from club_members
    where user_id = '00000000-0000-0000-0000-000000058002'),
  1,
  '058: ... and in that club ONLY, so the join reads the flag rather than every public club');

-- ---------------------------------------------------------------------------
-- 058.3  The fan-out is silent for the welcome club, and ONLY for it.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined'
      and club_id = '00000000-0000-0000-0000-0000058c0001'),
  0,
  '058: joining the welcome club notifies NOBODY — 036 §7.6 would otherwise address its owner with one row per signup, for ever, which is the whole notification list of one account');

-- The regression floor. 058.4's rider joins an ordinary club by hand, through
-- the client role and the real policy, and the owner must still hear about it.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058005', false);
select assert_eq(public.complete_onboarding('Faro') is not null, true,
  '058: a second rider finishes the wizard (they must be a participant before 023''s gate lets them join anything by hand)');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000058c0002', '00000000-0000-0000-0000-000000058005', 'member');

reset role;
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined'
      and club_id = '00000000-0000-0000-0000-0000058c0002'
      and actor_id = '00000000-0000-0000-0000-000000058005'),
  1,
  '058: ... while an ORDINARY club still notifies its owner — an early return one line too high would silence club_joined app-wide and every assertion above would still pass');

-- ---------------------------------------------------------------------------
-- 058.4  Leaving is permanent. The join fires on the TRANSITION into
--        completion, so a later call cannot put a rider back.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058003', false);
select assert_eq(public.complete_onboarding('Braga') is not null, true,
  '058: the leaver finishes the wizard');

reset role;
select assert_eq(
  (select count(*)::int from club_members
    where club_id = '00000000-0000-0000-0000-0000058c0001'
      and user_id = '00000000-0000-0000-0000-000000058003'),
  1, '058: ... and lands in the welcome club like everyone else');

set role authenticated;
delete from club_members
  where club_id = '00000000-0000-0000-0000-0000058c0001'
    and user_id = '00000000-0000-0000-0000-000000058003';
select assert_eq(
  (select count(*)::int from club_members
    where club_id = '00000000-0000-0000-0000-0000058c0001'
      and user_id = auth.uid()),
  0, '058: ... then leaves it, through the ordinary DELETE policy — the welcome club is not a club a rider is trapped in');

-- The re-run. It must still do its own job (the location moves) while doing
-- nothing about the club, or `leaveClub` is a button whose effect is undone by
-- the next profile write that reaches this RPC.
select assert_eq(public.complete_onboarding('Setubal') is not null, true,
  '058: ... and a SECOND call to complete_onboarding still succeeds');

reset role;
select assert_eq(
  (select location from profiles where id = '00000000-0000-0000-0000-000000058003'),
  'Setubal',
  '058: ... and really ran, so the assertion below is not passing because the call was a no-op');
select assert_eq(
  (select count(*)::int from club_members
    where club_id = '00000000-0000-0000-0000-0000058c0001'
      and user_id = '00000000-0000-0000-0000-000000058003'),
  0,
  '058: ... and the rider who LEFT the welcome club is still out of it — v_was_complete is captured before the update, because the coalesce makes a re-run indistinguishable from a first completion afterwards');

-- ---------------------------------------------------------------------------
-- 058.5  No default club at all: the join is a no-op and onboarding is
--        untouched. This is the state every project is in before §5 runs, and
--        the state a fresh scratch database is in permanently.
-- ---------------------------------------------------------------------------
savepoint no_default_058;
reset role;
update clubs set is_default = false where id = '00000000-0000-0000-0000-0000058c0001';

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058004', false);
select assert_eq(public.complete_onboarding('Evora') is not null, true,
  '058: with NO club flagged, onboarding completes exactly as it did before 058');

reset role;
select assert_eq(
  (select count(*)::int from club_members
    where user_id = '00000000-0000-0000-0000-000000058004'),
  0, '058: ... and the rider simply joins nothing');
rollback to savepoint no_default_058;

-- ---------------------------------------------------------------------------
-- 058.6  ** THE ONE THAT PAYS FOR THE EXCEPTION BLOCK. ** The insert is made
--        to RAISE, and the completion stamp must survive it.
-- ---------------------------------------------------------------------------
-- Without the block, the raise propagates, the whole RPC's transaction unwinds,
-- and the rider is left with `onboarding_completed_at` NULL — which decision #5
-- turns into a route guard that returns them to the wizard on every navigation,
-- for ever, with no skip affordance anywhere in the flow. The rider cannot get
-- out and cannot tell anyone, because every screen that could is behind the
-- guard.
--
-- A real trigger rather than a mocked one: 058's block catches `when others`,
-- and the only honest way to test that is to give it something to catch.
savepoint insert_raises_058;
reset role;

create function public.pd058_boom() returns trigger
language plpgsql as $$
begin
  raise exception 'pd058 boom' using errcode = 'check_violation';
end;
$$;
create trigger pd058_boom before insert on public.club_members
  for each row execute function public.pd058_boom();

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058004', false);
select assert_eq(public.complete_onboarding('Aveiro') is not null, true,
  '058: a club_members trigger that RAISES does not take the completion stamp down with it — this is the assertion the exception block exists for, and a welcome club is worth nothing beside it');

reset role;
select assert_eq(
  (select onboarding_completed_at is not null from profiles
    where id = '00000000-0000-0000-0000-000000058004'),
  true,
  '058: ... the rider is really onboarded, not merely told they are');
select assert_eq(
  (select location from profiles where id = '00000000-0000-0000-0000-000000058004'),
  'Aveiro',
  '058: ... their location landed too, so the whole statement committed rather than half of it');
select assert_eq(
  (select count(*)::int from club_members
    where user_id = '00000000-0000-0000-0000-000000058004'),
  0, '058: ... and they are simply not in a club, which is the correct degradation');

drop trigger pd058_boom on public.club_members;
drop function public.pd058_boom();
rollback to savepoint insert_raises_058;

-- ---------------------------------------------------------------------------
-- 058.7  The function's own contract, per 031: assert the ROLE, never the
--        call, because this suite runs as the table owner.
-- ---------------------------------------------------------------------------
reset role;
select assert_eq(
  (select prosecdef from pg_proc where oid = 'public.complete_onboarding(text)'::regprocedure),
  true,
  '058: complete_onboarding is still SECURITY DEFINER — the join depends on it, since the club_members INSERT policy would refuse a row the rider did not ask for');
select assert_eq(
  (select proconfig from pg_proc where oid = 'public.complete_onboarding(text)'::regprocedure),
  array['search_path=""'],
  '058: ... with its search_path still pinned, which every unqualified name in the added block would otherwise be exposed to');
select assert_eq(
  has_function_privilege('authenticated', 'public.complete_onboarding(text)', 'execute'),
  true, '058: ... and `authenticated` can still call it');
select assert_eq(
  has_function_privilege('anon', 'public.complete_onboarding(text)', 'execute'),
  false, '058: ... and `anon` still cannot');
select assert_eq(
  has_function_privilege('authenticated', 'private.notify_club_joined()', 'execute'),
  false,
  '058: private.notify_club_joined is still unreachable from the client role — 036 §7.7''s revoke survived the redefinition, which a bare `create or replace` preserves and a `drop`/`create` would silently have dropped');

-- ---------------------------------------------------------------------------
-- 059.0  ** THE APP-WIDE BROADCAST. ** A ride created in the default club
--        notifies nobody, because its membership is every rider in the app.
-- ---------------------------------------------------------------------------
-- 058 silenced `notify_club_joined` and left `036` §7.5's OTHER club fan-out
-- alone. That one reads `club_members` directly, so after 058 one tap on Create
-- ride — the welcome club is an ordinary option in the dropdown `getMyClubs`
-- feeds — writes a notification row for every rider in the app, inside the
-- organizer's own INSERT, repeatable at will. `rides` INSERT permits it
-- (`club_id is null or private.is_club_member(club_id)`), which is exactly what
-- auto-joining every rider turned on.
--
-- Written as the CLIENT role, through the real policy, because "may this rider
-- create the ride at all" is half the finding.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058002', false);
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-0000059d0001', 'PD059 Welcome Ride', 'The Gate',
   now() + interval '9 days', true, '00000000-0000-0000-0000-0000058c0001',
   '00000000-0000-0000-0000-000000058002');

reset role;
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club'
      and club_id = '00000000-0000-0000-0000-0000058c0001'),
  0,
  '059: a ride in the DEFAULT club notifies nobody — 058 auto-joins every rider into it, so 036 §7.5''s member fan-out would be an app-wide broadcast any rider could fire at will, and 058 §4 silenced the wrong one of the two');

-- The regression floor, and it is the whole reason the assertion above is not
-- just "notifications are broken". Same statement shape, ordinary club: the
-- fan-out must still reach its members.
--
-- A different organizer, and not by preference — 058002 was auto-joined to the
-- welcome club and to nothing else, so `rides` INSERT refuses them 058c0002
-- outright. 058005 joined that club by hand in 058.3, which is what makes them
-- the only rider here who can write this row at all. That refusal is itself the
-- proof that the assertion above ran against a real membership rather than a
-- permissive policy.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058005', false);
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-0000059d0002', 'PD059 Ordinary Ride', 'The Bend',
   now() + interval '10 days', true, '00000000-0000-0000-0000-0000058c0002',
   '00000000-0000-0000-0000-000000058005');

reset role;
select assert_eq(
  (select count(*)::int from notifications
    where type = 'ride_created_in_club'
      and ride_id = '00000000-0000-0000-0000-0000059d0002'),
  1,
  '059: ... while an ORDINARY club still fans out to its members — 058c0002 holds the owner and 058005, so the one member who is not the organizer hears about it');

-- ---------------------------------------------------------------------------
-- 059.1  The welcome club cannot be deleted by whoever ends up owning it.
-- ---------------------------------------------------------------------------
-- 029's succession hands a departing owner's clubs to the longest-tenured
-- remaining member, and after 058 the welcome club ALWAYS has members, so it
-- can never reach the "nobody left, delete it" arm — it transfers to an
-- ordinary rider. `delete_owned_club`'s entire access check is
-- `c.owner_id = v_uid`, so without this guard that rider turns 058 off for
-- every future signup with one tap in the club menu.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058001', false);
select assert_rejected(
  $$select * from public.delete_owned_club('00000000-0000-0000-0000-0000058c0001')$$,
  '42501',
  '059: the club carrying is_default cannot be deleted, even by its own owner — that ownership is INHERITABLE through 029''s succession, so without this any rider who outlives the welcome club''s owner can switch auto-join off for everyone');

-- Not vacuous: the same caller, the same function, their other club.
savepoint delete_ordinary_059;
select set_config('test.uid', '00000000-0000-0000-0000-000000058001', false);
select * from public.delete_owned_club('00000000-0000-0000-0000-0000058c0002');
reset role;
select assert_eq(
  (select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000058c0002'),
  0,
  '059: ... while the SAME owner can still delete an ordinary club through the same function, so the refusal above is the is_default guard and not a broken access check');
rollback to savepoint delete_ordinary_059;

-- And the guard is the FLAG rather than the club: unflag it and it deletes.
savepoint delete_unflagged_059;
reset role;
update clubs set is_default = false where id = '00000000-0000-0000-0000-0000058c0001';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058001', false);
select * from public.delete_owned_club('00000000-0000-0000-0000-0000058c0001');
reset role;
select assert_eq(
  (select count(*)::int from clubs where id = '00000000-0000-0000-0000-0000058c0001'),
  0,
  '059: ... and unflagging it makes it deletable again — the guard reads is_default rather than pinning one club, so retiring a welcome club stays possible without a migration');
rollback to savepoint delete_unflagged_059;

-- ---------------------------------------------------------------------------
-- 059.2  The silence 058's exception block could not see.
-- ---------------------------------------------------------------------------
-- The insert selects zero rows when nothing carries the flag, and zero rows is
-- a SUCCESS — no exception, so 058's `when others` never runs and the feature
-- is off for every rider with no diagnostic anywhere. plpgsql `raise warning`
-- is not observable from SQL, so what is asserted here is the shape the warning
-- hangs off: `found` is false in the no-club case and the completion still
-- lands. 058.5 asserts the same path's behaviour; this pins the CONDITION.
savepoint warns_on_no_default_059;
reset role;
update clubs set is_default = false where id = '00000000-0000-0000-0000-0000058c0001';
select assert_eq(
  (select count(*)::int from clubs where is_default), 0,
  '059: with the flag cleared there is no default club, which is the state 058 §5''s guard leaves behind when it finds zero or two name matches');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000058004', false);
select assert_eq(public.complete_onboarding('Guimaraes') is not null, true,
  '059: ... onboarding still completes, silently, which is the correct degradation and also the failure nobody would ever notice');
reset role;
select assert_eq(
  (select count(*)::int from club_members where user_id = '00000000-0000-0000-0000-000000058004'),
  0,
  '059: ... having joined nothing — the case 059 §2 adds the warning for, because an insert over zero rows raises nothing for 058''s handler to catch');
rollback to savepoint warns_on_no_default_059;

-- ---------------------------------------------------------------------------
-- 059.3  Nothing else about the two redefined functions moved.
-- ---------------------------------------------------------------------------
reset role;
select assert_eq(
  has_function_privilege('authenticated', 'private.notify_ride_created_in_club()', 'execute'),
  false,
  '059: private.notify_ride_created_in_club is still unreachable from the client role — 036 §7.7''s revoke survives a bare `create or replace`, which a drop/create would have discarded');
select assert_eq(
  (select prosecdef from pg_proc where oid = 'public.delete_owned_club(uuid)'::regprocedure),
  true,
  '059: delete_owned_club is still SECURITY DEFINER — its own owner_id check is the entire access control and means nothing without it');
select assert_eq(
  has_function_privilege('anon', 'public.delete_owned_club(uuid)', 'execute'),
  false, '059: ... and `anon` still cannot call it (043''s revoke)');
select assert_eq(
  (select proconfig from pg_proc where oid = 'public.delete_owned_club(uuid)'::regprocedure),
  array['search_path=""'],
  '059: ... with its search_path still pinned');

set role authenticated;
rollback to savepoint default_club_058;

\echo ''
\echo '# 060 — a fan-out addresses only riders whose own policy resolves the subject (PD-211)'

-- ===========================================================================
-- 060. The catalog half. The BEHAVIOUR is asserted where the behaviour lives —
--      036 §7.12c for the owner arm, 055.3, 055.6 and 055.6b for the crew
--      narrowing — because an assertion filed away from the fixture it explains
--      is one PD-169 records being misread for weeks.
--
--      What is left here is what no behavioural test can see: the grant posture
--      of two new subject-taking helpers, the split of is_club_member's body,
--      and the pinned policy text that private.can_read_ride restates.
-- ===========================================================================
savepoint recipient_sets_060;

reset role;
select set_config('test.uid', '', false);

-- ---------------------------------------------------------------------------
-- 060.0  Fixtures of this section's own
-- ---------------------------------------------------------------------------
-- Self-contained, like 009's, 054's and 055's, and for the same reason: every
-- section above rolls its own fixtures back at its savepoint, so nothing from
-- 036's or 055's exists here. Three riders and two rides, arranged so each arm
-- of `rides` SELECT is reachable by exactly one of them.
--
-- ** THE CLUB'S OWNER HOLDS NO MEMBERSHIP ROW AND IS NOT THE ORGANIZER. ** That
-- separation is the whole fixture: with the owner organizing, every assertion
-- below would pass through the unconditional organizer arm and the owner arm
-- would be untested — which is the shape 055.4 exists to avoid on the other
-- function.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000211001', 'pd211owner@example.com'),
  ('00000000-0000-0000-0000-000000211002', 'pd211member@example.com'),
  ('00000000-0000-0000-0000-000000211003', 'pd211outsider@example.com');

update profiles set username = 'pd211owner', location = 'Lisbon',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000211001';
update profiles set username = 'pd211member', location = 'Porto',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000211002';
update profiles set username = 'pd211outsider', location = 'Faro',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000211003';

insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000211c0001', 'PD211 Private MC', false,
   '00000000-0000-0000-0000-000000211001');
-- The owner deliberately gets NO club_members row. The member does.
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000211c0001', '00000000-0000-0000-0000-000000211002', 'member');
select assert_eq(
  (select count(*)::int from club_members
    where club_id = '00000000-0000-0000-0000-0000211c0001'
      and user_id = '00000000-0000-0000-0000-000000211001'),
  0, '060: fixture — the club''s owner holds NO membership row, which is the state 054 repaired and 036 §7.5 reasoned about');

insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-0000211d0001', 'PD211 Club Run', 'The Gate',
   now() + interval '4 days', false, '00000000-0000-0000-0000-0000211c0001',
   '00000000-0000-0000-0000-000000211002'),
  ('00000000-0000-0000-0000-0000211d0002', 'PD211 Open Run', 'The Quay',
   now() + interval '5 days', true, null,
   '00000000-0000-0000-0000-000000211002');

-- ---------------------------------------------------------------------------
-- 060.1  THE PINNED POLICY. This is the assertion the whole file rests on.
-- ---------------------------------------------------------------------------
-- private.can_read_ride is a SECOND IMPLEMENTATION of rides SELECT, which 036
-- §3 warns against — "the conjunction is cheap and does not go stale; the
-- derivation does". There is no way around it: a policy can only be evaluated
-- for the caller, and a fan-out needs the answer for somebody else. So the
-- restatement is fenced here instead.
--
-- rides SELECT has already been rewritten twice, by 017 and by 022, and 054
-- changed a function underneath it. A third rewrite that leaves can_read_ride
-- alone would silently restore PD-211: the fan-out would go on filtering
-- against a policy that no longer exists, writing or withholding rows against
-- the wrong rule, with nothing red anywhere.
--
-- ** MATCHED WHOLE, NOT BY `like`. ** A pattern match is what let this class of
-- drift live: 055.7's two `like` assertions were both TRUE throughout the
-- period the fan-out was wrong. Only equality catches an arm added, removed or
-- reordered inside the parts a pattern does not name.
select assert_eq(
  (select qual from pg_policies
    where schemaname = 'public' and tablename = 'rides' and cmd = 'SELECT'),
  '((organizer_id = auth.uid()) OR ((NOT private.is_blocked(auth.uid(), organizer_id)) AND ((is_public AND ((club_id IS NULL) OR private.is_club_public(club_id))) OR ((club_id IS NOT NULL) AND private.is_club_member(club_id)))))',
  '060: rides SELECT is TEXTUALLY what private.can_read_ride restates. If this fails, the helper is stale — update it in the same change rather than re-pinning this string, or every notification fan-out starts filtering against a policy that no longer exists');

-- ---------------------------------------------------------------------------
-- 060.1b  THE SECOND PINNED POLICY — clubs SELECT, which can_read_club restates
-- ---------------------------------------------------------------------------
-- ** A ride_created_in_club ROW HAS TWO SUBJECTS AND 036 §3 TESTS THEM
-- INDEPENDENTLY. ** Conjunct 4 requires the `rides` row resolve, conjunct 5 the
-- `clubs` row, and the row carries both `ride_id` and `club_id`. So filtering
-- that fan-out on can_read_ride alone would DERIVE club-visibility from
-- ride-visibility — which 036 §3 forbids in those words: "Do not collapse it on
-- the grounds that ride-visibility implies club-visibility ... The conjunction
-- is cheap and does not go stale; the derivation does."
--
-- The conjunct excludes nobody today: every candidate is a club_members row or
-- clubs.owner_id, and clubs SELECT has an arm for each. It is written for the
-- state 041 names as reachable — clubs SELECT gaining a block predicate, which
-- decision #2's own logic argues for. Then a member blocked with the CLUB OWNER
-- but not with the RIDE ORGANIZER passes can_read_ride, fails clubs SELECT, and
-- gets a row nobody can ever read.
select assert_eq(
  (select qual from pg_policies
    where schemaname = 'public' and tablename = 'clubs' and cmd = 'SELECT'),
  '(is_public OR (owner_id = auth.uid()) OR private.is_club_member(id))',
  '060: clubs SELECT is TEXTUALLY what private.can_read_club restates — the twin of the pin above. A block arm added here is exactly the change that makes the club conjunct start excluding people, and it must arrive at the helper in the same change');

-- ---------------------------------------------------------------------------
-- 060.2  The three subject-taking helpers are reachable by NO client role
-- ---------------------------------------------------------------------------
-- Named by ROLE rather than attempted — 031's lesson: the suite runs as the
-- table owner, for whom neither the schema barrier nor the EXECUTE barrier
-- exists, so calling them would prove nothing about a rider.
--
-- ** THIS IS A SECURITY PROPERTY, NOT TIDINESS, AND IT IS WHY THESE FUNCTIONS
-- TAKE A SUBJECT. ** can_read_ride(x, r) is a BLOCK ORACLE: on a public ride it
-- returns false only when x and the organizer are blocked with each other,
-- which decision #2 requires must never be revealed by any gap, count or
-- marker. is_club_member_for(x, c) is a MEMBERSHIP ORACLE for private clubs.
-- can_read_club is the second oracle of that kind. All three are safe only
-- because no rider can call them.
--
-- service_role is included because 031 granted it USAGE on `private`; revoking
-- from `public` is what actually closes it, EXECUTE being granted to PUBLIC by
-- default on creation.
select assert_eq(
  (select count(*)::int
     from (values ('authenticated'), ('anon'), ('service_role')) as r(role)
     cross join (values ('private.can_read_ride(uuid,uuid)'),
                        ('private.can_read_club(uuid,uuid)'),
                        ('private.is_club_member_for(uuid,uuid)')) as f(fn)
    where has_function_privilege(r.role, f.fn, 'execute')),
  0, '060: no client role and not service_role can execute any of the three subject-taking helpers — can_read_ride is a block oracle, can_read_club a private-club oracle, is_club_member_for a membership oracle');

-- Not vacuous: both functions exist, in `private`, and nowhere PostgREST routes.
select assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('can_read_ride', 'can_read_club', 'is_club_member_for')),
  3, '060: ... and there are three of them, so that assertion is not vacuous');
select assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('can_read_ride', 'can_read_club', 'is_club_member_for')),
  0, '060: ... and none is in the PostgREST-exposed public schema');

-- Definer with the path pinned, all three. Asserted from the catalog rather
-- than trusted from the file: apply_migration takes SQL as an argument, and 022
-- once shipped with `security definer` missing. proconfig stores the pin as the
-- literal search_path="" — matching on `search_path=` finds nothing and reads
-- as a pass.
select assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('can_read_ride', 'can_read_club', 'is_club_member_for')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, '060: all three helpers are SECURITY DEFINER with an empty search_path — without the first they read nothing under a rider''s RLS, and without the second an unqualified name resolves wherever the caller points it');

-- ---------------------------------------------------------------------------
-- 060.3  The split of is_club_member: one body, two entry points
-- ---------------------------------------------------------------------------
-- 060 moved the membership rule into is_club_member_for(candidate, club) and
-- made is_club_member(club) a wrapper passing auth.uid(). The alternative was a
-- second copy of the rule inside can_read_ride — and PD-211 exists precisely
-- because 036 §7.5 encoded a claim about this function's body that 054 made
-- false eighteen migrations later, with nothing to notice.
--
-- ** THE GRANT THAT MUST SURVIVE. ** A policy expression is evaluated as the
-- querying role, so `authenticated` needs EXECUTE on the caller-relative entry
-- point or all ten calling policies fail closed for every rider. The nested
-- call needs no grant: the wrapper is definer, so its body runs as the owner.
select assert_eq(
  has_function_privilege('authenticated', 'private.is_club_member(uuid)', 'execute'),
  true, '060: authenticated can STILL execute private.is_club_member — ten policies evaluate it as the querying role, and without this every one of them fails closed');
select assert_eq(
  has_function_privilege('anon', 'private.is_club_member(uuid)', 'execute'),
  false, '060: ... and anon still cannot — decision #1');

-- The wrapper delegates rather than duplicating. If someone re-inlines the body
-- here, the two readings can drift again and this is what says so.
-- ** PINNED BY EQUALITY, NOT BY `like`, AND THAT IS THE WHOLE ASSERTION. ** A
-- `like '%is_club_member_for%'` is satisfied by the mention alone, so
-- `select private.is_club_member_for(auth.uid(), $1) or exists (...)` — an arm
-- added to the wrapper and not to the body — would pass it while making
-- can_read_ride silently NARROWER than the policy it restates. rides SELECT's
-- own qual text would be unchanged, so 060.1 would not fire either. That is
-- PD-211's exact shape: a claim about a function's body that something later
-- makes false, with nothing to notice. The two readings do not merely "share a
-- body" by intent — this is what asserts it.
select assert_eq(
  (select prosrc from pg_proc
    where oid = 'private.is_club_member(uuid)'::regprocedure),
  E'\n  select private.is_club_member_for(auth.uid(), target_club_id);\n',
  '060: is_club_member is EXACTLY a delegation to is_club_member_for and nothing else — an extra arm here would leave can_read_ride narrower than the policy it restates, with neither 060.1 nor a substring match able to see it');
select assert_eq(
  (select prosrc like '%auth.uid()%' from pg_proc
    where oid = 'private.is_club_member_for(uuid,uuid)'::regprocedure),
  false, '060: ... and the body itself mentions auth.uid() NOWHERE — 036 trap (c): a caller-relative helper computes one answer and applies it to every candidate, making a recipient set everybody or nobody');

-- Behaviour, both entry points, against the same pair. 054's own section already
-- proves the owner arm end to end through the policies; this proves the two
-- readings AGREE, which is the property the split has to preserve and the only
-- one a wrapper could silently lose.
select assert_eq(
  private.is_club_member_for('00000000-0000-0000-0000-000000211001',
                             '00000000-0000-0000-0000-0000211c0001'),
  true, '060: is_club_member_for sees an OWNERLESS OWNER as a member — 054''s owner arm, now reachable for a named candidate');
select assert_eq(
  private.is_club_member_for('00000000-0000-0000-0000-000000211002',
                             '00000000-0000-0000-0000-0000211c0001'),
  true, '060: ... and an ordinary member through the membership arm');
select assert_eq(
  private.is_club_member_for('00000000-0000-0000-0000-000000211003',
                             '00000000-0000-0000-0000-0000211c0001'),
  false, '060: ... and an outsider as neither owner nor member');

-- ** CALLED AS THE TABLE OWNER WITH test.uid SET, NOT UNDER `set role
-- authenticated`. ** `authenticated` holds no USAGE on the `private` schema, so
-- a rider cannot call this function by name at all — only a policy can, and
-- policies are what 054's own section exercises end to end. Switching identity
-- through the harness's test.uid is what makes the wrapper's argument-free
-- reading testable here; the role barrier is asserted separately, above.
select set_config('test.uid', '00000000-0000-0000-0000-000000211001', false);
select assert_eq(
  private.is_club_member('00000000-0000-0000-0000-0000211c0001'),
  true, '060: the caller-relative wrapper agrees with the candidate-relative body for the same rider — which is what makes the split behaviour-preserving rather than a claim that it is');
select set_config('test.uid', '00000000-0000-0000-0000-000000211003', false);
select assert_eq(
  private.is_club_member('00000000-0000-0000-0000-0000211c0001'),
  false, '060: ... and agrees on the negative too, so the wrapper is not simply returning true');
select set_config('test.uid', '', false);

-- ---------------------------------------------------------------------------
-- 060.4  can_read_ride answers for a NAMED rider, not for the caller
-- ---------------------------------------------------------------------------
-- Called with NO JWT, as the table owner, with test.uid empty. That is the whole
-- point: auth.uid() is NULL here, so a helper that read it internally would
-- answer NULL for every candidate and every assertion below would fail. This is
-- 036 trap (c) asserted directly rather than inferred from a fan-out's counts.
select assert_eq(auth.uid(), null::uuid,
  '060: can_read_ride is exercised with NO JWT — a helper that resolved auth.uid() internally would answer NULL for every candidate');

select assert_eq(
  private.can_read_ride('00000000-0000-0000-0000-000000211002',
                        '00000000-0000-0000-0000-0000211d0001'),
  true, '060: the ORGANIZER resolves their own private club ride — the unconditional first arm, which is what makes unioning rides.organizer_id safe for ride_joined');
select assert_eq(
  private.can_read_ride('00000000-0000-0000-0000-000000211001',
                        '00000000-0000-0000-0000-0000211d0001'),
  true, '060: and the OWNERLESS OWNER resolves it, through 054''s owner arm reached for a NAMED candidate — this single call is what replaces 036 §7.5''s reasoning about is_club_member''s body with a measurement of it');
select assert_eq(
  private.can_read_ride('00000000-0000-0000-0000-000000211003',
                        '00000000-0000-0000-0000-0000211d0001'),
  false, '060: an outsider does NOT — a private club''s ride is not public, and they hold neither the club nor a membership row');
select assert_eq(
  private.can_read_ride('00000000-0000-0000-0000-000000211003',
                        '00000000-0000-0000-0000-0000211d0002'),
  true, '060: a rider unrelated to a PUBLIC club-less ride resolves it — decision #1''s any-signed-in-rider reading, and the arm an over-eager narrowing would break first');
select assert_eq(
  private.can_read_ride('00000000-0000-0000-0000-000000211003',
                        '00000000-0000-0000-0000-000000000000'),
  false, '060: a ride that does not exist resolves for nobody — EXISTS over zero rows, not NULL, so the fan-out''s WHERE never goes three-valued and never silently drops every candidate');

-- ** THE BLOCK ARM, WHICH IS 055.6's ROUTE. ** Asserted directly on the helper
-- rather than only through a fan-out's counts, because this is the disjunct
-- whose placement decided the whole design: a crew arm added to rides SELECT at
-- the top level would sit OUTSIDE this test and hand the ride back to a rider
-- who blocked the organizer. 060's header carries that argument.
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000211003', '00000000-0000-0000-0000-000000211002');
select assert_eq(
  private.can_read_ride('00000000-0000-0000-0000-000000211003',
                        '00000000-0000-0000-0000-0000211d0002'),
  false, '060: ... and a rider blocked with the organizer stops resolving even a PUBLIC ride — symmetric from one directional row, and the reason a crew member can hold a roster row and see nothing');
select assert_eq(
  private.can_read_ride('00000000-0000-0000-0000-000000211002',
                        '00000000-0000-0000-0000-0000211d0002'),
  true, '060: ... while the organizer of that same ride is untouched by the block — the first arm is unconditional, so a block never hides a rider''s own ride from them');
delete from blocks
 where blocker_id = '00000000-0000-0000-0000-000000211003'
   and blocked_id = '00000000-0000-0000-0000-000000211002';

-- ---------------------------------------------------------------------------
-- 060.4b  can_read_club, the second subject
-- ---------------------------------------------------------------------------
-- Excludes nobody in the fan-out today — see 060.1b — so its arms are asserted
-- directly here rather than through a recipient count, which is the only way to
-- test a conjunct that currently removes no one. A conjunct nothing exercises
-- is one a later edit deletes without a single assertion moving.
select assert_eq(
  private.can_read_club('00000000-0000-0000-0000-000000211001',
                        '00000000-0000-0000-0000-0000211c0001'),
  true, '060: the OWNERLESS OWNER resolves their own private club — clubs SELECT''s owner arm, which 036 §7.5 already noted exists here and not on rides');
select assert_eq(
  private.can_read_club('00000000-0000-0000-0000-000000211002',
                        '00000000-0000-0000-0000-0000211c0001'),
  true, '060: ... and a member resolves it through is_club_member_for');
select assert_eq(
  private.can_read_club('00000000-0000-0000-0000-000000211003',
                        '00000000-0000-0000-0000-0000211c0001'),
  false, '060: ... and an outsider does NOT, this club being private — the arm that would start excluding fan-out candidates the day clubs SELECT gains a block predicate');
select assert_eq(
  private.can_read_club('00000000-0000-0000-0000-000000211003',
                        '00000000-0000-0000-0000-000000000000'),
  false, '060: ... and a club that does not exist resolves for nobody');

select assert_eq(
  (select prosrc like '%can_read_club%' from pg_proc
    where oid = 'private.notify_ride_created_in_club()'::regprocedure),
  true, '060: and the club fan-out actually CALLS it — the type carries club_id as well as ride_id, and 036 §3 tests the two subjects independently rather than deriving one from the other');
select assert_eq(
  (select prosrc like '%can_read_club%' from pg_proc
    where oid = 'private.notify_ride_joined()'::regprocedure),
  false, '060: ... while ride_joined does NOT, and must not — that type leaves club_id NULL, so 036 §3 conjunct 5 is vacuous for it and a club filter would gate on a column the row does not carry');

-- ---------------------------------------------------------------------------
-- 060.5  What the two fan-outs must not have lost to `create or replace`
-- ---------------------------------------------------------------------------
-- `create or replace` is the one shape that can quietly drop a property: the
-- replacement carries whatever the new text says and nothing warns that the old
-- text said more. 055.9 covers notify_ride_joined's own clauses; these are the
-- ones 060 could have dropped from either function.
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'private'::regnamespace
      and proname in ('notify_ride_joined', 'notify_ride_created_in_club')
      and prosrc like '%can_read_ride%'),
  2, '060: BOTH fan-outs filter their recipients through can_read_ride — the crew narrowing and the owner arm are the same repair, and a half-applied 060 is the state this catches');
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'private'::regnamespace
      and proname in ('notify_ride_joined', 'notify_ride_created_in_club')
      and (prosrc ilike '%auth.uid()%' or prosrc ilike '%current_user%')),
  0, '060: neither rewritten body mentions auth.uid() or current_user — 036 trap (b), and the filter 060 adds is exactly the kind of predicate that invites one');

-- ** THE CLAUSE WHOSE LOSS IS SILENT AND WORST. ** 059 §1 added an early return
-- for the club carrying clubs.is_default: every rider belongs to that one, so
-- without it a single ride created there writes one notification per rider in
-- the app, synchronously, and any rider can fire it at will. 060 rewrites that
-- function, and nothing about a missing early return raises.
select assert_eq(
  (select prosrc like '%is_default%' from pg_proc
    where oid = 'private.notify_ride_created_in_club()'::regprocedure),
  true, '060: 059''s default-club early return SURVIVED the rewrite — without it a ride in the welcome club is an app-wide broadcast any rider can fire, which 059 §1 calls worse than the defect 058 §4 refused to ship');

-- The comments both functions carry. 055 established the rule: a database
-- comment is the one piece of documentation no edit to CLAUDE.md can reach, so
-- it moves in the same statement that makes it wrong. 036 §7.5's sentence
-- survived into 059's re-issue unchecked, which is the drift PD-211 names.
select assert_eq(
  (select obj_description('private.notify_ride_created_in_club()'::regprocedure, 'pg_proc')
     like '%deliberately NOT unioned%'),
  false, '060: the fan-out comment no longer claims the owner is deliberately excluded — that sentence outlived its premise by 054, and 059 copied it forward without re-checking it');
select assert_eq(
  (select obj_description('private.notify_ride_created_in_club()'::regprocedure, 'pg_proc')
     like '%is_default%'),
  true, '060: ... and still records 059''s default-club early return, which the rewrite had to carry as well as correct');

-- The trigger bindings. `create or replace` keeps the OID, so no trigger DDL was
-- issued and no WHEN clause could have arrived with one — 036 trap (a). The
-- tgname filter is REQUIRED rather than tidy: rides and ride_members both carry
-- enforce_participation_gate, so the unfiltered query returns four rows.
select assert_eq(
  (select count(*)::int from pg_trigger
    where not tgisinternal and tgqual is null
      and tgname in ('notify_ride_joined', 'notify_ride_created_in_club')),
  2, '060: both triggers are still bound and still carry NO when clause — create or replace keeps the OID, so 060 issues no trigger DDL');

-- ---------------------------------------------------------------------------
-- 060.6  Nothing a rider can READ moved. 060 is five functions and no policy.
-- ---------------------------------------------------------------------------
-- The whole repair is on the WRITE side of notifications. A file that narrowed
-- a fan-out and widened a read at the same time would pass every assertion
-- above, so the read surface is pinned separately.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'notifications'),
  2, '060: still exactly two policies on notifications, SELECT and UPDATE — 060 created none and dropped none');
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and (qual like '%is_club_member(%' or with_check like '%is_club_member(%')),
  10, '060: the ten policies calling is_club_member are unchanged in number — the split replaced the function body, never a policy, so 054''s widened set neither grew nor shrank');
select assert_eq(
  (select count(*)::int from (values ('authenticated'), ('anon')) as r(role)
    where has_table_privilege(r.role, 'public.notifications', 'insert')),
  0, '060: and neither client role gained an INSERT grant — fan-out stays trigger-only, which is what the absent grant enforces');
select assert_eq(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_type_check'),
  'CHECK ((type = ANY (ARRAY[''postcard_liked''::text, ''postcard_commented''::text, ''ride_joined''::text, ''club_joined''::text, ''ride_created_in_club''::text])))',
  '060: the type CHECK is UNTOUCHED at five types — 060 changes who receives which existing type, never what a notification is');

set role authenticated;
rollback to savepoint recipient_sets_060;

reset role;

\echo ''
\echo '# The chat unread watermark — own rows, own audience, and no read receipts (061)'

-- ===========================================================================
-- 061. A watermark is the first row in this schema that says something about a
--      rider's BEHAVIOUR rather than their membership or their content.
-- ===========================================================================
--
-- Self-contained fixtures, for 034's reason and one more: this section needs a
-- message that is strictly NEWER than a watermark, and §The clock below explains
-- why that cannot be arranged the way 015's section arranges it.
--
-- The riders, and what each one is for:
--   6101  organizer, and deliberately NOT in ride_members  -- the third coalesce
--         arm, which is what stops the host being the one rider whose dot never
--         lights
--   6102  crew, `going`                                    -- the ordinary case
--   6103  crew, `maybe`                                    -- no read-only tier
--   6104  onboarded, can SEE the public ride, never RSVP'd -- the crew conjunct
--   6105  crew, `going`, and blocks the ORGANIZER          -- the visibility
--         conjunct, reached through the block arm of the rides policy
--   6106  crew on the private club's ride, then LEAVES the club -- the same
--         conjunct reached through the club arm, which is a different arm and
--         so is asserted separately
--   6107  crew, `going`, and 6102 has blocked them         -- a blocked AUTHOR,
--         who must not be able to light 6102's dot
--   6108  ADMIN of the ride's private club, and not on the ride at all -- a club
--         role confers nothing here, which is the assumption most likely to be
--         made silently
savepoint ride_chat_unread_061;

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000061001', 'unreadhost@example.com'),
  ('00000000-0000-0000-0000-000000061002', 'unreadgoing@example.com'),
  ('00000000-0000-0000-0000-000000061003', 'unreadmaybe@example.com'),
  ('00000000-0000-0000-0000-000000061004', 'unreadoutside@example.com'),
  ('00000000-0000-0000-0000-000000061005', 'unreadhostblocker@example.com'),
  ('00000000-0000-0000-0000-000000061006', 'unreadclubleaver@example.com'),
  ('00000000-0000-0000-0000-000000061007', 'unreadblocked@example.com'),
  ('00000000-0000-0000-0000-000000061008', 'unreadclubadmin@example.com');
reset role;

update profiles set username = 'unreadhost',        location = 'Leiden',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000061001';
update profiles set username = 'unreadgoing',       location = 'Delft',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000061002';
update profiles set username = 'unreadmaybe',       location = 'Gouda',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000061003';
update profiles set username = 'unreadoutside',     location = 'Breda',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000061004';
update profiles set username = 'unreadhostblocker', location = 'Arnhem',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000061005';
update profiles set username = 'unreadclubleaver',  location = 'Zwolle',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000061006';
update profiles set username = 'unreadblocked',     location = 'Venlo',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000061007';
update profiles set username = 'unreadclubadmin',   location = 'Assen',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000061008';

-- 6102 blocks 6107. Note which pair: blocking a fellow CREW MEMBER leaves the
-- ride visible (the rides policy's block arm names the ORGANIZER), so this is
-- the case where the chat still opens and one author's messages are missing
-- from it. That is what makes it a test of the dot rather than of the ride.
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000061002', '00000000-0000-0000-0000-000000061007');

-- Public, so 6104 provably CAN see it — which is what makes "sees the ride,
-- cannot write a watermark" a statement about the crew conjunct.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-000000061f01', 'Unread Test Run', 'The Ferry',
   now() + interval '7 days', true, '00000000-0000-0000-0000-000000061001');

-- `joined_at` is written explicitly here and it is not decoration: it is the
-- SECOND coalesce arm, and the "messages from before you joined do not badge
-- you" case cannot be expressed without it. 048 makes the column server-owned by
-- withholding the grant, which binds `authenticated` and not the owner.
insert into ride_members (ride_id, user_id, status, joined_at) values
  ('00000000-0000-0000-0000-000000061f01', '00000000-0000-0000-0000-000000061002',
   'going', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000061f01', '00000000-0000-0000-0000-000000061003',
   'maybe', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000061f01', '00000000-0000-0000-0000-000000061005',
   'going', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000061f01', '00000000-0000-0000-0000-000000061007',
   'going', now() - interval '2 days');

-- ---------------------------------------------------------------------------
-- §The clock, and why every message below carries an explicit created_at
-- ---------------------------------------------------------------------------
-- 015's section arranges an "unread" case by inserting a postcard and then a
-- watermark stamped `now() - interval '10 years'`. **That is not available
-- here**, and the reason is the point rather than an inconvenience: 061 hangs a
-- BEFORE INSERT OR UPDATE trigger on `ride_reads` that overwrites
-- `last_read_at` with `now()`, and a trigger fires for the table owner exactly
-- as it does for `authenticated`. So every watermark this suite can create sits
-- at the transaction's `now()`, to the microsecond.
--
-- The messages move instead. `created_at` is server-owned on `ride_messages` by
-- 034 §4b's withheld column grant, which — like 048's — binds the client roles
-- and not the owner.
--
-- A session that "fixes" this by writing `last_read_at` directly will find its
-- value silently replaced and the assertion still passing for the wrong reason,
-- which is why the trigger is asserted head-on further down rather than only
-- relied upon here.
insert into ride_messages (id, ride_id, author_id, body, created_at) values
  -- Before 6102 and 6103 joined: must NOT badge them, and this is the only
  -- assertion covering the second coalesce arm.
  ('00000000-0000-0000-0000-000000061a01', '00000000-0000-0000-0000-000000061f01',
   '00000000-0000-0000-0000-000000061001', 'Posted before you joined',
   now() - interval '3 days'),
  -- After everyone joined, from the organizer: the ordinary unread case.
  ('00000000-0000-0000-0000-000000061a02', '00000000-0000-0000-0000-000000061f01',
   '00000000-0000-0000-0000-000000061001', 'Ferry leaves at nine',
   now() + interval '1 hour'),
  -- From 6102: their OWN message, which must never light their own dot.
  ('00000000-0000-0000-0000-000000061a03', '00000000-0000-0000-0000-000000061f01',
   '00000000-0000-0000-0000-000000061002', 'See you there',
   now() + interval '2 hours'),
  -- From 6107, whom 6102 has blocked: must not light 6102's dot, and the
  -- exclusion must come from 034's SELECT policy rather than from any filter
  -- written into 061.
  ('00000000-0000-0000-0000-000000061a04', '00000000-0000-0000-0000-000000061f01',
   '00000000-0000-0000-0000-000000061007', 'Bringing a spare visor',
   now() + interval '3 hours');

-- The private club, its ride, and the two riders who reach it differently: 6106
-- is crew and leaves the club; 6108 is a club ADMIN and never joins the ride.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000610c9', 'Unread Private MC', false,
   '00000000-0000-0000-0000-000000061001');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000610c9', '00000000-0000-0000-0000-000000061001', 'owner'),
  ('00000000-0000-0000-0000-0000000610c9', '00000000-0000-0000-0000-000000061006', 'member'),
  ('00000000-0000-0000-0000-0000000610c9', '00000000-0000-0000-0000-000000061008', 'admin');
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-000000061f02', 'Unread Club Run', 'The Depot',
   now() + interval '8 days', false, '00000000-0000-0000-0000-0000000610c9',
   '00000000-0000-0000-0000-000000061001');
insert into ride_members (ride_id, user_id, status, joined_at) values
  ('00000000-0000-0000-0000-000000061f02', '00000000-0000-0000-0000-000000061006',
   'going', now() - interval '2 days');

-- A ride with a crew and NO messages at all — an empty thread must read exactly
-- like a thread read to the end, which is correct and is worth pinning.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id) values
  ('00000000-0000-0000-0000-000000061f03', 'Unread Quiet Run', 'The Bridge',
   now() + interval '9 days', true, '00000000-0000-0000-0000-000000061001');
insert into ride_members (ride_id, user_id, status, joined_at) values
  ('00000000-0000-0000-0000-000000061f03', '00000000-0000-0000-0000-000000061002',
   'going', now() - interval '2 days');

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 061 assertions run as authenticated, or they prove nothing');

-- ---------------------------------------------------------------------------
-- 061.1  Who may write a watermark
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000061002', false);

select assert_allowed($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061002',
          '00000000-0000-0000-0000-000000061f01')$$,
  '061: a crew member marks their own ride chat read');

-- **`assert_allowed` unwinds its own subtransaction**, so the row it just proved
-- permitted is gone. Everything below turns on riders actually HOLDING
-- watermarks, so each permitted insert is repeated for real. Writing only the
-- assertion leaves later sections measuring an empty table and passing or
-- failing for reasons that have nothing to do with the rule under test.
insert into ride_reads (user_id, ride_id)
values ('00000000-0000-0000-0000-000000061002', '00000000-0000-0000-0000-000000061f01');

select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061003',
          '00000000-0000-0000-0000-000000061f01')$$,
  '061: a rider cannot write another rider''s watermark');

-- `maybe` is crew, exactly as it is for posting (034.3). There is no read-only
-- tier, and the alternative reading — that only `going` counts — is a plausible
-- product rule nothing else in the schema would rule out.
select set_config('test.uid', '00000000-0000-0000-0000-000000061003', false);
select assert_allowed($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061003',
          '00000000-0000-0000-0000-000000061f01')$$,
  '061: a `maybe` RSVP marks a chat read, exactly like `going`');
insert into ride_reads (user_id, ride_id)
values ('00000000-0000-0000-0000-000000061003', '00000000-0000-0000-0000-000000061f01');

-- The crew conjunct, isolated: 6104 can see the ride, asserted rather than
-- assumed, because a hidden ride would make the refusal pass for the wrong
-- reason entirely.
select set_config('test.uid', '00000000-0000-0000-0000-000000061004', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000061f01'),
  1, '061: a non-crew rider CAN see the public ride ...');
select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061004',
          '00000000-0000-0000-0000-000000061f01')$$,
  '061: ... and still cannot write a watermark for it — seeing a ride is not being on it');

-- The existence oracle 015 §2 names, closed. A ride that does not exist and a
-- ride that exists but is invisible must be refused identically — row security
-- runs before the foreign key, so neither reaches 23503.
select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061004',
          '00000000-0000-0000-0000-0000000619f9')$$,
  '061: a watermark naming a ride that does not exist is refused by RLS, not by the FK');
select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061004',
          '00000000-0000-0000-0000-000000061f02')$$,
  '061: ... and a private club''s ride is refused identically, so the write is not an existence oracle');

-- ---------------------------------------------------------------------------
-- 061.2  The two conjuncts, refused one at a time
-- ---------------------------------------------------------------------------
-- Both of these hold a `ride_members` row throughout, so `private.is_ride_crew`
-- answers TRUE for each. What refuses them is the visibility EXISTS — reached
-- through two DIFFERENT arms of the rides policy, which is why they are asserted
-- separately even though one conjunct fixes both. A single assertion cannot say
-- which rule did the hiding.
-- **The "row standing" half is asserted as the OWNER, and that is not a
-- convenience.** Read as the blocker it comes back 0 — 009 gates `ride_members`
-- SELECT behind an EXISTS on `rides` *before* its `user_id = auth.uid()` arm, so
-- losing the ride loses the sight of your own membership row with it. Asserting
-- it under RLS would therefore have "passed" by measuring the wrong thing, and
-- the point here is precisely that the row is still THERE: `private.is_ride_crew`
-- is `security definer` and sees it, answers true, and would admit this rider on
-- its own. Only the visibility conjunct refuses them.
--
-- It is also the state 061 §4 names for the coalesce: with arm two unreadable,
-- such a rider falls through to `rides.created_at`, which over-reports rather
-- than hides.
reset role;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000061005', '00000000-0000-0000-0000-000000061001');
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-000000061f01'
                     and user_id = '00000000-0000-0000-0000-000000061005'),
  1, '061: blocking the organizer leaves the ride_members row standing ...');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-000000061005', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000061f01'),
  0, '061: ... and takes the ride away ...');
select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061005',
          '00000000-0000-0000-0000-000000061f01')$$,
  '061: ... so the watermark is refused by the visibility conjunct, which the crew helper alone would not do');

-- Owner-side for the same reason as the block case above.
reset role;
delete from club_members
 where club_id = '00000000-0000-0000-0000-0000000610c9'
   and user_id = '00000000-0000-0000-0000-000000061006';
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-000000061f02'
                     and user_id = '00000000-0000-0000-0000-000000061006'),
  1, '061: leaving the club leaves the ride_members row standing ...');
set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-000000061006', false);
select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061006',
          '00000000-0000-0000-0000-000000061f02')$$,
  '061: ... and the watermark is refused through the club arm — a different arm from the block case');

-- A club role confers nothing. 6108 is an ADMIN of the club the ride belongs to,
-- so the visibility conjunct passes; `private.is_ride_crew` knows nothing about
-- club roles, so the crew conjunct is what refuses them. The mirror image of the
-- two cases above.
select set_config('test.uid', '00000000-0000-0000-0000-000000061008', false);
select assert_eq((select count(*)::int from rides
                   where id = '00000000-0000-0000-0000-000000061f02'),
  1, '061: a club admin CAN see their club''s private ride ...');
select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061008',
          '00000000-0000-0000-0000-000000061f02')$$,
  '061: ... and still cannot write a watermark — a club role is not a crew seat');

-- ---------------------------------------------------------------------------
-- 061.3  The organizer, who may hold no ride_members row at all
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000061001', false);
select assert_eq((select count(*)::int from ride_members
                   where ride_id = '00000000-0000-0000-0000-000000061f01'
                     and user_id = '00000000-0000-0000-0000-000000061001'),
  0, '061: the organizer holds no ride_members row ...');
select assert_allowed($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061001',
          '00000000-0000-0000-0000-000000061f01')$$,
  '061: ... and can still mark their own ride''s chat read, through is_ride_crew''s organizer arm');
insert into ride_reads (user_id, ride_id)
values ('00000000-0000-0000-0000-000000061001', '00000000-0000-0000-0000-000000061f01');

-- ---------------------------------------------------------------------------
-- 061.4  Nobody reads anybody else's watermark — this app has no read receipts
-- ---------------------------------------------------------------------------
-- The organizer is named specifically because the organizer is the role a
-- future "who has seen this" affordance would be built for, and the SELECT
-- policy is where that is refused rather than merely unbuilt.
select assert_eq((select count(*)::int from ride_reads
                   where ride_id = '00000000-0000-0000-0000-000000061f01'),
  1, '061: the organizer sees their own watermark and no other rider''s — no read receipts');

select set_config('test.uid', '00000000-0000-0000-0000-000000061002', false);
select assert_eq((select count(*)::int from ride_reads), 1,
  '061: and a crew member sees only their own, across every ride');

select assert_denied($$
  update ride_reads set user_id = '00000000-0000-0000-0000-000000061003'
   where ride_id = '00000000-0000-0000-0000-000000061f01'$$,
  '061: a rider cannot hand their watermark to someone else');

-- ---------------------------------------------------------------------------
-- 061.5  The trigger owns the clock
-- ---------------------------------------------------------------------------
-- Head-on, on BOTH arms. A BEFORE INSERT trigger alone would impose the value on
-- a rider's first visit to a ride and keep the client's on every visit after —
-- which works on fresh rows and drifts in use, so an INSERT-only assertion would
-- pass against the broken version.
-- Run for real rather than through `assert_allowed`, which would unwind the row
-- before the value could be read back. The insert succeeding IS the proof that
-- naming the column is not refused — the column grant is deliberately table-wide
-- (see 061 §3 and §5), so what makes the value true is the trigger, not a
-- refusal at the door.
insert into ride_reads (user_id, ride_id, last_read_at)
values ('00000000-0000-0000-0000-000000061002',
        '00000000-0000-0000-0000-000000061f03', timestamptz '3000-01-01 00:00:00+00');
select assert_eq(
  (select last_read_at from ride_reads
    where user_id = '00000000-0000-0000-0000-000000061002'
      and ride_id = '00000000-0000-0000-0000-000000061f03') = now(),
  true, '061: ... it is overwritten with server time on INSERT');

update ride_reads set last_read_at = timestamptz '3000-01-01 00:00:00+00'
 where user_id = '00000000-0000-0000-0000-000000061002'
   and ride_id = '00000000-0000-0000-0000-000000061f03';
select assert_eq(
  (select last_read_at from ride_reads
    where user_id = '00000000-0000-0000-0000-000000061002'
      and ride_id = '00000000-0000-0000-0000-000000061f03') = now(),
  true, '061: ... and on UPDATE too, which is the arm the upsert reaches on every visit after the first');

-- ---------------------------------------------------------------------------
-- 061.6  The dot's answer
-- ---------------------------------------------------------------------------
-- 6102 holds a watermark at `now()` on 61f01. Of the four messages there, one
-- predates their joining, one is their own, one is from a rider they blocked,
-- and one is the organizer's at now() + 1 hour. Only the last may light the dot,
-- and every other exclusion is a different rule.
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f01'), true,
  '061: a message newer than the watermark lights the dot');

-- Advancing past every message clears it. The upsert's UPDATE arm is what runs
-- here, and the trigger stamps `now()` — which is why the messages had to be
-- placed in the future rather than the watermark in the past.
reset role;
update ride_messages set created_at = now() - interval '1 minute'
 where ride_id = '00000000-0000-0000-0000-000000061f01';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000061002', false);
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f01'), false,
  '061: ... and nothing newer than it clears the dot');

-- Restore the future messages for the exclusion cases below.
reset role;
update ride_messages set created_at = now() + interval '1 hour'
 where id = '00000000-0000-0000-0000-000000061a02';
update ride_messages set created_at = now() + interval '2 hours'
 where id = '00000000-0000-0000-0000-000000061a03';
update ride_messages set created_at = now() + interval '3 hours'
 where id = '00000000-0000-0000-0000-000000061a04';
set role authenticated;

-- Your own message never badges you, and this is the assertion that fails if
-- `author_id <> auth.uid()` is dropped. It is reachable with no race at all:
-- send from the chat screen, tap back.
--
-- Isolated by removing every OTHER unread message, so nothing else can hold the
-- answer true and make a broken exclusion look correct.
reset role;
update ride_messages set created_at = now() - interval '1 minute'
 where id in ('00000000-0000-0000-0000-000000061a02',
              '00000000-0000-0000-0000-000000061a04');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000061002', false);
select assert_eq(
  (select count(*)::int from ride_messages
    where id = '00000000-0000-0000-0000-000000061a03'), 1,
  '061: the rider''s own newer message is there ...');
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f01'), false,
  '061: ... and does not light their own dot — 015 does NOT make this exclusion, deliberately');

-- A blocked author cannot light the blocker's dot, and no block filter appears
-- anywhere in 061: 034's SELECT policy already excludes the message and the
-- function reads through it. 6102 blocked 6107, so 61a04 is the only unread
-- message and it is invisible to them.
reset role;
update ride_messages set created_at = now() - interval '1 minute'
 where id = '00000000-0000-0000-0000-000000061a03';
update ride_messages set created_at = now() + interval '3 hours'
 where id = '00000000-0000-0000-0000-000000061a04';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000061002', false);
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-000000061a04'),
  0, '061: a blocked rider''s message is not readable ...');
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f01'), false,
  '061: ... so it cannot light the blocker''s dot — the exclusion is 034''s policy, not a filter in 061');

-- ... and the same message DOES light an unblocked crew member's dot, which is
-- what stops the assertion above from passing merely because nothing is unread.
select set_config('test.uid', '00000000-0000-0000-0000-000000061003', false);
select assert_eq((select count(*)::int from ride_messages
                   where id = '00000000-0000-0000-0000-000000061a04'),
  1, '061: the same message IS readable by a rider who has not blocked its author ...');
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f01'), true,
  '061: ... and does light their dot, so the block assertion above is not vacuous');

-- ---------------------------------------------------------------------------
-- 061.7  The three coalesce arms
-- ---------------------------------------------------------------------------
-- 6103 holds a watermark from 061.1, so this rider is cleared first to reach the
-- no-watermark state the second arm is about.
-- Every message is put THREE days back, which is before this rider's
-- `joined_at` of two days back. `now() - 1 minute` would not do: that is after
-- they joined, so arm two would correctly badge them and the assertion below
-- would fail while measuring nothing.
reset role;
delete from ride_reads where user_id = '00000000-0000-0000-0000-000000061003';
update ride_messages set created_at = now() - interval '3 days'
 where ride_id = '00000000-0000-0000-0000-000000061f01';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000061003', false);

-- Arm 2: no watermark, so the comparison point is `joined_at`. Every message now
-- predates this rider joining, so none may badge them — joining a ride with a
-- long thread must not light the dot for all of it.
select assert_eq((select count(*)::int from ride_reads
                   where user_id = '00000000-0000-0000-0000-000000061003'),
  0, '061: a rider with no watermark ...');
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f01'), false,
  '061: ... is not badged by messages posted before they joined — the joined_at arm');

reset role;
update ride_messages set created_at = now() + interval '1 hour'
 where id = '00000000-0000-0000-0000-000000061a02';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000061003', false);
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f01'), true,
  '061: ... and is badged by one posted after they joined');

-- Arm 3, and it is load-bearing TODAY rather than in theory: the organizer holds
-- no ride_members row, so a two-arm coalesce would answer NULL for them and the
-- host would be the one member of the crew whose dot never lights. Dropping the
-- third arm fails exactly here.
-- 61a03 is moved forward rather than 61a02, and the difference is the rule under
-- test in the section above: 61a02's author IS the organizer, so
-- `author_id <> auth.uid()` excludes it and this assertion would read false
-- while the fallback worked perfectly. 61a03 is 6102's.
reset role;
delete from ride_reads where user_id = '00000000-0000-0000-0000-000000061001';
update ride_messages set created_at = now() + interval '1 hour'
 where id = '00000000-0000-0000-0000-000000061a03';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000061001', false);
select assert_eq((select count(*)::int from ride_reads
                   where user_id = '00000000-0000-0000-0000-000000061001'),
  0, '061: the organizer holds no watermark and no ride_members row ...');
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f01'), true,
  '061: ... and another rider''s message still lights their dot — the rides.created_at arm');

-- ---------------------------------------------------------------------------
-- 061.8  What the function must NOT disclose, and the empty case
-- ---------------------------------------------------------------------------
-- A ride that does not exist, a ride the caller cannot see, and a chat with
-- nothing in it must be indistinguishable — all false, none raising. Anything
-- else makes the RPC an existence oracle, and it is published at
-- /rest/v1/rpc/ride_has_unread for every signed-in rider.
select set_config('test.uid', '00000000-0000-0000-0000-000000061004', false);
select assert_eq(ride_has_unread('00000000-0000-0000-0000-0000000619f9'), false,
  '061: a ride that does not exist answers false rather than raising');
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f02'), false,
  '061: ... and a ride the caller cannot see answers identically');

select set_config('test.uid', '00000000-0000-0000-0000-000000061002', false);
select assert_eq(ride_has_unread('00000000-0000-0000-0000-000000061f03'), false,
  '061: a chat with no messages answers false — the same as one read to the end, which is correct');

-- ---------------------------------------------------------------------------
-- 061.9  Leaving the crew, and the cascades
-- ---------------------------------------------------------------------------
-- Nothing cascades on LEAVING: the foreign key is to `rides`, not to
-- `ride_members`. 015 §2's comment says leaving a club "cascades the row away
-- via the FK" — it does not, there either, and inheriting that sentence would
-- have stated a retention guarantee the schema does not give.
select set_config('test.uid', '00000000-0000-0000-0000-000000061002', false);
reset role;
delete from ride_members
 where ride_id = '00000000-0000-0000-0000-000000061f01'
   and user_id = '00000000-0000-0000-0000-000000061002';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000061002', false);
select assert_eq((select count(*)::int from ride_reads
                   where ride_id = '00000000-0000-0000-0000-000000061f01'),
  1, '061: leaving the crew leaves the watermark standing — rejoining reuses it');
select assert_denied($$
  insert into ride_reads (user_id, ride_id)
  values ('00000000-0000-0000-0000-000000061002',
          '00000000-0000-0000-0000-000000061f01')
  on conflict (user_id, ride_id) do update set last_read_at = now()$$,
  '061: ... but further writes are refused, because the crew conjunct now fails');

reset role;
delete from rides where id = '00000000-0000-0000-0000-000000061f01';
select assert_eq((select count(*)::int from ride_reads
                   where ride_id = '00000000-0000-0000-0000-000000061f01'),
  0, '061: deleting the ride cascades every crew member''s watermark for it away');

-- From the other end. This is the second cascade path into `ride_reads` and the
-- FK-count assertion in the 029 section cannot see it, which is why it is
-- asserted directly.
delete from profiles where id = '00000000-0000-0000-0000-000000061002';
select assert_eq((select count(*)::int from ride_reads
                   where user_id = '00000000-0000-0000-0000-000000061002'),
  0, '061: deleting the rider cascades every watermark they hold away, on every ride');

-- ---------------------------------------------------------------------------
-- 061.10  The table and the function are locked down by construction
-- ---------------------------------------------------------------------------
select assert_eq((select count(*)::int from pg_policies where tablename = 'ride_reads'),
  3, '061: three policies on ride_reads — select, insert, update, and no delete');
select assert_eq(
  (select count(*)::int from pg_policies
    where tablename = 'ride_reads' and roles::text[] <> array['authenticated']),
  0, '061: every ride_reads policy targets authenticated only — decision #1');

-- Scoped to the grantee, per the story's own instruction and 015's footer. The
-- unscoped form ("no DELETE grant on the table at all") returns 2 against a
-- correct database, because `postgres` owns it and `service_role` holds
-- everything by Supabase default.
select assert_eq(has_table_privilege('authenticated', 'public.ride_reads', 'delete'),
  false, '061: authenticated holds no DELETE grant on ride_reads — a watermark cannot be reset');
select assert_eq(has_table_privilege('authenticated', 'public.ride_reads', 'update'),
  true, '061: ... and does hold UPDATE, which the upsert''s second visit needs');
select assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where table_name = 'ride_reads' and grantee = 'anon'),
  0, '061: anon holds nothing on ride_reads');

-- Named as a ROLE rather than by calling it — 031's lesson. The suite runs as
-- the table owner, for whom neither the grant nor the schema barrier exists, so
-- calling the function proves nothing about who else can.
select assert_eq(
  has_function_privilege('authenticated', 'public.ride_has_unread(uuid)', 'execute'),
  true, '061: authenticated can call ride_has_unread ...');
select assert_eq(
  has_function_privilege('anon', 'public.ride_has_unread(uuid)', 'execute'),
  false, '061: ... and anon cannot');

-- INVOKER is what makes it safe to publish at /rest/v1/rpc/. If it ever flips to
-- DEFINER it stops obeying the blocks and the ride-visibility arms that 034's
-- policy applies, and starts answering true for threads the caller cannot read.
select assert_eq((select prosecdef from pg_proc where proname = 'ride_has_unread'),
  false, '061: ride_has_unread runs as the caller, so RLS decides what counts');
select assert_eq((select prosecdef from pg_proc where proname = 'stamp_ride_read'),
  false, '061: and the timestamp trigger needs no elevated rights either');

-- The `nulls not distinct` clause 015 needs and this table must not copy. There
-- is no nullable key column for it to apply to — no "app-wide ride" the way
-- `feed_reads.club_id IS NULL` is the app-wide feed — so the clause would state
-- a rule this table does not have and invite the next reader to infer one.
select assert_eq(
  (select count(*)::int from pg_index
    where indrelid = 'public.ride_reads'::regclass and indnullsnotdistinct),
  0, '061: no `nulls not distinct` index on ride_reads — the key is NOT NULL, so 015''s clause is not copied');
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.ride_reads'::regclass and contype = 'p'),
  1, '061: ... because a real primary key is available, which is also the upsert''s on-conflict target');

-- Both arms. `tgtype` bit 4 is INSERT and bit 16 is UPDATE; bit 2 is BEFORE.
select assert_eq(
  (select (tgtype & 4 > 0)::int + (tgtype & 16 > 0)::int + (tgtype & 2 > 0)::int
     from pg_trigger where tgname = 'stamp_ride_read' and not tgisinternal),
  3, '061: the timestamp trigger is BEFORE and fires on both INSERT and UPDATE');

-- The cascade index, which exists for the delete path rather than for a screen:
-- the primary key leads with `user_id`, so removing one RIDE has nothing to find
-- its watermarks by without it.
select assert_eq(
  (select count(*)::int from pg_indexes
    where tablename = 'ride_reads' and indexname = 'ride_reads_ride_id_idx'),
  1, '061: ride_reads carries an index on ride_id, for the cascade a ride deletion runs');

set role authenticated;
rollback to savepoint ride_chat_unread_061;

reset role;

\echo ''
\echo '# The ride tag is read through an accessor, never off the column (062)'

-- ===========================================================================
-- 062. postcards.ride_id stops being client-readable, and the Journal reads it
--      through public.ride_journal_postcard_ids instead.
-- ===========================================================================
--
-- PD-166, option A. 041 granted `select (ride_id)` deliberately — "or the
-- Journal query could not filter on it", because Postgres checks the column
-- privilege to FILTER as well as to RETURN — and that grant is also the
-- correlation channel: a raw uuid comparable across postcards by a viewer who
-- can resolve neither the ride nor its crew. 062 gives the privilege to the
-- accessor instead. 041's own assertion is inverted in place rather than
-- deleted, up in the 041 section, where it is the record of why the grant
-- existed.
--
-- The riders, and what each one is for:
--   6201  organizer of the PUBLIC ride, in no club
--   6202  author of the app-wide postcards, member of the private club and
--         crew of its ride -- so every fixture here is reachable through 041's
--         own INSERT gate rather than only through the table owner
--   6203  owner of the PRIVATE club and organizer of its ride
--   6204  onboarded outsider: sees the public ride and the app-wide postcards,
--         and neither the private club nor its ride -- the RIDE conjunct
--   6205  blocks 6202                      -- the block arm, through the accessor
--   6206  hides 6202's postcard            -- the hide arm, through the accessor
savepoint ride_journal_accessor_062;

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000062001', 'journalaccessorhost@example.com'),
  ('00000000-0000-0000-0000-000000062002', 'journalaccessorauthor@example.com'),
  ('00000000-0000-0000-0000-000000062003', 'journalaccessorclub@example.com'),
  ('00000000-0000-0000-0000-000000062004', 'journalaccessoroutside@example.com'),
  ('00000000-0000-0000-0000-000000062005', 'journalaccessorblocker@example.com'),
  ('00000000-0000-0000-0000-000000062006', 'journalaccessorhider@example.com');
reset role;

update profiles set username = 'accessorhost',    location = 'Haarlem',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000062001';
update profiles set username = 'accessorauthor',  location = 'Utrecht',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000062002';
update profiles set username = 'accessorclub',    location = 'Zutphen',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000062003';
update profiles set username = 'accessoroutside', location = 'Sneek',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000062004';
update profiles set username = 'accessorblocker', location = 'Roermond',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000062005';
update profiles set username = 'accessorhider',   location = 'Dokkum',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000062006';

insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000620c1', 'Accessor Private MC', false,
   '00000000-0000-0000-0000-000000062003');
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000620c1', '00000000-0000-0000-0000-000000062002', 'member');

-- 62f01 public, no club -- every signed-in rider can see it.
-- 62f02 the private club's ride, so 6204 can see its POSTCARD and not the ride.
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id) values
  ('00000000-0000-0000-0000-00000062f001', 'Accessor Open Run', 'The Locks',
   now() + interval '7 days', true, null, '00000000-0000-0000-0000-000000062001'),
  ('00000000-0000-0000-0000-00000062f002', 'Accessor Secret Run', 'The Yard',
   now() + interval '8 days', false, '00000000-0000-0000-0000-0000000620c1',
   '00000000-0000-0000-0000-000000062003');
insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-00000062f001', '00000000-0000-0000-0000-000000062002', 'going'),
  ('00000000-0000-0000-0000-00000062f002', '00000000-0000-0000-0000-000000062002', 'going');

-- created_at is explicit because the accessor promises an ORDER and one of the
-- assertions below is that order. 041 left the column client-writable (PD-163),
-- so this is the seed writing a value it is allowed to write, not a bypass.
insert into postcards (id, author_id, club_id, image_path, caption, created_at, ride_id) values
  ('00000000-0000-0000-0000-0000000620e1', '00000000-0000-0000-0000-000000062002',
   null, 'postcards/00000000-0000-0000-0000-000000062002/620e1.jpg',
   'App-wide, open ride', timestamptz '2026-02-01 10:00:00+00',
   '00000000-0000-0000-0000-00000062f001'),
  ('00000000-0000-0000-0000-0000000620e2', '00000000-0000-0000-0000-000000062003',
   '00000000-0000-0000-0000-0000000620c1', 'postcards/00000000-0000-0000-0000-000000062003/620e2.jpg',
   'Private club, open ride', timestamptz '2026-02-01 11:00:00+00',
   '00000000-0000-0000-0000-00000062f001'),
  ('00000000-0000-0000-0000-0000000620e3', '00000000-0000-0000-0000-000000062002',
   null, 'postcards/00000000-0000-0000-0000-000000062002/620e3.jpg',
   'App-wide, secret ride', timestamptz '2026-02-01 12:00:00+00',
   '00000000-0000-0000-0000-00000062f002');

insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000062005', '00000000-0000-0000-0000-000000062002');
insert into postcard_hides (postcard_id, user_id) values
  ('00000000-0000-0000-0000-0000000620e1', '00000000-0000-0000-0000-000000062006'),
  -- 6202 hides their OWN postcard. 011 accepts that and makes it inert, because
  -- the author branch of the SELECT policy is unconditional — the accessor
  -- restates it unconditionally too, and this row is what proves it did.
  ('00000000-0000-0000-0000-0000000620e1', '00000000-0000-0000-0000-000000062002');

-- ---------------------------------------------------------------------------
-- 062.1  THE GRANT. Named by ROLE, never by calling anything — 031's lesson:
--        the suite runs as the table owner, for whom no grant exists to fail.
-- ---------------------------------------------------------------------------
select assert_eq(has_table_privilege('authenticated', 'public.postcards', 'select'),
  false, '062: authenticated holds no TABLE-level SELECT on postcards — a column-level revoke against a table-level grant is a documented no-op, so the table grant had to go first');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'id', 'SELECT'),
  true, '062: ... and the re-grant names id ...');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'author_id', 'SELECT'),
  true, '062: ... author_id ...');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'club_id', 'SELECT'),
  true, '062: ... club_id, which IS the audience and must stay readable ...');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'image_path', 'SELECT'),
  true, '062: ... image_path ...');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'caption', 'SELECT'),
  true, '062: ... caption ...');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'created_at', 'SELECT'),
  true, '062: ... created_at, the feed''s sort key and pagination cursor ...');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'updated_at', 'SELECT'),
  true, '062: ... and updated_at — seven columns, one assertion each, so an omission fails here rather than as a screen on the error boundary');

-- The two verbs 062 does NOT touch, asserted so a later grant rewrite cannot
-- take them in passing: a tag is set once at INSERT and never edited (041 §3).
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'ride_id', 'INSERT'),
  true, '062: ride_id is still INSERTable — PD-256 tags a postcard once, and closing the read must not close the write');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'ride_id', 'UPDATE'),
  false, '062: ... and still not UPDATEable, unchanged from 041');
select assert_eq(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards' and grantee = 'anon'),
  0, '062: anon holds nothing on postcards, in any verb — decision #1, unchanged');

-- ---------------------------------------------------------------------------
-- 062.2  THE ACCESSOR, as an object. `public` and not `private` is 031's
--        lesson in the other direction: PostgREST routes only to `public`, so
--        a worker in `private` is one nothing can call — and the suite, which
--        holds USAGE on both, could not tell the difference.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'ride_journal_postcard_ids'),
  'public', '062: the accessor lives in public, where PostgREST can route to it — 029 put a worker in private and 031 exists to move it');
select assert_eq(
  has_function_privilege('authenticated', 'public.ride_journal_postcard_ids(uuid)', 'execute'),
  true, '062: authenticated can call it, or the Journal has no read at all ...');
select assert_eq(
  has_function_privilege('anon', 'public.ride_journal_postcard_ids(uuid)', 'execute'),
  false, '062: ... and anon cannot — decision #1');
select assert_eq(
  (select prosecdef from pg_proc where proname = 'ride_journal_postcard_ids'),
  true, '062: it is security definer, which is the whole mechanism — as invoker it would hit the same revoked column its caller does');
select assert_eq(
  (select proconfig from pg_proc where proname = 'ride_journal_postcard_ids'),
  array['search_path=""'], '062: ... with search_path pinned empty, 005''s hardening');

-- ---------------------------------------------------------------------------
-- 062.3  THE PINNED POLICY, 060.1's fence applied to the other restatement.
--
--        A security definer function bypasses RLS, so the accessor carries a
--        COPY of 011's postcards SELECT qual. Pinned as WHOLE TEXT rather than
--        by `like`, for 060.1's reason: a pattern match cannot see an arm
--        added, removed or reordered inside the parts it does not name. 041
--        already pins the same qual by md5 — that line is 041's account of "the
--        SELECT policy is not touched by this file"; this one names what copies
--        it, so the failure arrives at the accessor rather than at 041.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select qual from pg_policies
    where schemaname = 'public' and tablename = 'postcards' and cmd = 'SELECT'),
  '((author_id = auth.uid()) OR ((NOT private.is_blocked(auth.uid(), author_id)) AND ((club_id IS NULL) OR private.is_club_member(club_id)) AND (NOT (EXISTS ( SELECT 1
   FROM postcard_hides h
  WHERE ((h.postcard_id = postcards.id) AND (h.user_id = auth.uid())))))))',
  '062: postcards SELECT is TEXTUALLY what ride_journal_postcard_ids restates. If this fails, the accessor is stale — update it in the same change rather than re-pinning this string, or the Journal starts naming rows against a rule that no longer exists');

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 062 behavioural assertions run as authenticated, or they prove nothing');

-- ---------------------------------------------------------------------------
-- 062.4  The column is gone from the client, and the rest of the row is not.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000062002', false);
select assert_denied($$
  select ride_id from postcards where id = '00000000-0000-0000-0000-0000000620e1'$$,
  '062: a rider cannot READ the tag off their own postcard');
select assert_denied($$
  select count(*) from postcards where ride_id = '00000000-0000-0000-0000-00000062f001'$$,
  '062: ... and cannot FILTER on it either, which is the half a select list could never close — Postgres checks the column privilege for a WHERE just as for a target list');
select assert_eq(
  (select caption from postcards where id = '00000000-0000-0000-0000-0000000620e1'),
  'App-wide, open ride',
  '062: ... while the rest of the row reads exactly as before — the re-grant is what keeps every feed working');

-- The EMBED, which is the same rule arriving where nobody looks for it. A
-- PostgREST embed is a join, and its predicate names postcards.ride_id, so it
-- is refused exactly as a target list naming the column is. tag-postcards-to-
-- rides task 4.3 specified a `rides(...)` embed on the postcard read and 062
-- makes it 42501 — the tasks file now says so, and this is the line that keeps
-- saying it after somebody edits that file.
--
-- **TWO controls, because one of them varies two things at once.** The club_id
-- join swaps the joined TABLE as well as the column, so on its own it excludes
-- "a join is refused" and leaves "`rides` is the unreadable thing" standing —
-- which would go on passing, with the label naming the wrong mechanism, the day
-- somebody column-scopes `rides` SELECT the way 062 just did to `postcards`.
-- That is not hypothetical: 062 §1 frames the shape as an adopted pattern. The
-- second control joins the SAME table without naming ride_id, so between them
-- only the column grant is left.
select assert_denied($$
  select 1 from postcards p join rides r on r.id = p.ride_id limit 1$$,
  '062: a join whose predicate names ride_id is refused too — so a rides embed on a postcard read is 42501, which is tag-postcards-to-rides task 4.3');
select assert_eq(
  (select count(*)::int from postcards p join rides r on r.organizer_id = p.author_id
    where p.id = '00000000-0000-0000-0000-0000000620e1'
      and r.id = '00000000-0000-0000-0000-00000062f001'),
  0, '062: ... while joining the SAME table on a granted column is allowed — so the refusal is postcards.ride_id and not rides');
select assert_eq(
  has_table_privilege('authenticated', 'public.rides', 'select'),
  true, '062: ... and rides SELECT is still table-level for authenticated, which is the other half of that');
select assert_eq(
  (select count(*)::int from postcards p join clubs c on c.id = p.club_id
    where p.id = '00000000-0000-0000-0000-0000000620e2'),
  1, '062: ... and a join on club_id still returns a row — the refusal above is a column grant, not a join');

-- ---------------------------------------------------------------------------
-- 062.5  The accessor answers the Journal, ordered, and its restated audience
--        matches the policy's arm for arm.
-- ---------------------------------------------------------------------------
-- 6202 authored 620e1 and is a member of the private club, so both rows resolve
-- — and 620e1 resolves through the AUTHOR branch despite the self-hide above.
select assert_eq(
  (select array(select * from public.ride_journal_postcard_ids('00000000-0000-0000-0000-00000062f001'))),
  array['00000000-0000-0000-0000-0000000620e2',
        '00000000-0000-0000-0000-0000000620e1']::uuid[],
  '062: the author reads both postcards on the open ride, NEWEST FIRST — and their own is there despite hiding it from themselves, because 011''s author branch is unconditional and the accessor restates it unconditionally');

select set_config('test.uid', '00000000-0000-0000-0000-000000062004', false);
select assert_eq(
  (select array(select * from public.ride_journal_postcard_ids('00000000-0000-0000-0000-00000062f001'))),
  array['00000000-0000-0000-0000-0000000620e1']::uuid[],
  '062: an outsider on the same ride reads the app-wide postcard and NOT the private club''s — club_id is still the whole audience, and the accessor did not widen it');

select set_config('test.uid', '00000000-0000-0000-0000-000000062005', false);
select assert_eq(
  (select count(*)::int from public.ride_journal_postcard_ids('00000000-0000-0000-0000-00000062f001')),
  0, '062: a rider who blocked the author reads nothing — decision #2 reaches the accessor, not only the feed');

select set_config('test.uid', '00000000-0000-0000-0000-000000062006', false);
select assert_eq(
  (select count(*)::int from public.ride_journal_postcard_ids('00000000-0000-0000-0000-00000062f001')),
  0, '062: and a rider who hid the postcard reads nothing — the hide arm too');

-- ---------------------------------------------------------------------------
-- 062.6  THE RIDE CONJUNCT, which is the only thing in the accessor that the
--        SELECT policy does not already do. Without it, a rider holding the id
--        of a ride they cannot see learns which of their visible postcards
--        belong to it — the correlation channel PD-166 is about, arriving
--        through the accessor that was supposed to close it.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000062004', false);
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-0000000620e3'),
  1, '062: the outsider CAN see the postcard tagged to the secret ride — it is app-wide, so the zero below is about the ride and nothing else');
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-00000062f002'),
  0, '062: ... and cannot see that ride ...');
select assert_eq(
  (select count(*)::int from public.ride_journal_postcard_ids('00000000-0000-0000-0000-00000062f002')),
  0, '062: ... so its Journal answers nothing for them — private.can_read_ride, 060''s pinned helper, and 041''s INSERT gate in the read direction');

select set_config('test.uid', '00000000-0000-0000-0000-000000062002', false);
select assert_eq(
  (select array(select * from public.ride_journal_postcard_ids('00000000-0000-0000-0000-00000062f002'))),
  array['00000000-0000-0000-0000-0000000620e3']::uuid[],
  '062: while the club member on its crew reads it — the ride conjunct excludes the outsider and nobody else');

-- ---------------------------------------------------------------------------
-- 062.7  A ride id that resolves to nothing is answered the same way as one the
--        caller may not see: zero rows, no error. 041.9's rule in the read
--        direction — a distinguishable refusal is an oracle telling a rider
--        that a ride they cannot see exists.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from public.ride_journal_postcard_ids('00000000-0000-0000-0000-0000009f9f9f')),
  0, '062: a nonexistent ride returns zero rows rather than raising');
select assert_eq(
  (select count(*)::int from public.ride_journal_postcard_ids(null)),
  0, '062: and so does a null ride — nothing is tagged to nothing');

reset role;
rollback to savepoint ride_journal_accessor_062;

\echo ''
\echo '# A ride cap that actually caps — max_riders reaches ride_members (063)'

-- ===========================================================================
-- 063. rides.max_riders finally counts against ride_members.
-- ===========================================================================
--
-- PD-174. The column has existed since 001, 018 bounded its VALUE and said so
-- explicitly ("this bounds what can be *stored*, and nothing else"), and
-- nothing ever counted a crew against it. An organizer could set 5 and get 50.
--
-- What is asserted here is a JOIN GATE, not an invariant. "Crew size <=
-- max_riders" is deliberately NOT true at all times: lowering a cap below the
-- current crew is allowed and evicts nobody, so an over-subscribed ride is a
-- legal state and 063.4 asserts it as one. Reading these as invariant
-- assertions and "fixing" the over-subscribed case would delete somebody's
-- RSVP.
--
-- The riders, and what each one is for:
--   6301  organizer of the capped ride, and one of its two seats
--   6302  the second seat, held at `maybe` -- so every refusal below also
--         asserts that `maybe` counts toward the cap
--   6303  a would-be sixth rider: the plain refusal
--   6304  blocks 6302, so HALF THE ROSTER IS INVISIBLE TO THEM -- 063.6, the
--         one case that fails if the count is ever made `security invoker`
--   6305  joins after a seat is freed
savepoint ride_capacity_063;

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000063001', 'caphost@example.com'),
  ('00000000-0000-0000-0000-000000063002', 'capmaybe@example.com'),
  ('00000000-0000-0000-0000-000000063003', 'capsixth@example.com'),
  ('00000000-0000-0000-0000-000000063004', 'capblocker@example.com'),
  ('00000000-0000-0000-0000-000000063005', 'caplate@example.com');
reset role;

update profiles set username = 'caphost',    location = 'Gouda',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000063001';
update profiles set username = 'capmaybe',   location = 'Delft',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000063002';
update profiles set username = 'capsixth',   location = 'Breda',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000063003';
update profiles set username = 'capblocker', location = 'Venlo',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000063004';
update profiles set username = 'caplate',    location = 'Assen',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000063005';

-- Public rides, so the ride_members INSERT policy's EXISTS resolves for every
-- rider here and a refusal below can only be the capacity trigger.
insert into rides (id, title, meeting_point, departure_at, is_public, max_riders, organizer_id) values
  ('00000000-0000-0000-0000-00000063f001', 'Capped Run', 'The Ferry',
   now() + interval '7 days', true, 2,    '00000000-0000-0000-0000-000000063001'),
  ('00000000-0000-0000-0000-00000063f002', 'Uncapped Run', 'The Ferry',
   now() + interval '7 days', true, null, '00000000-0000-0000-0000-000000063001');

insert into ride_members (ride_id, user_id, status) values
  ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063001', 'going'),
  ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063002', 'maybe');

insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000063004', '00000000-0000-0000-0000-000000063002');

-- A private club and its ride, for 063.7b. 6305 is NOT a member, so `rides`'
-- SELECT policy hides this ride from them entirely — which is the whole point,
-- and also the reason that assertion cannot look the id up through a subquery.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000630c1', 'Capacity Private MC', false,
   '00000000-0000-0000-0000-000000063001');
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, max_riders, organizer_id) values
  ('00000000-0000-0000-0000-00000063f009', 'Members Only Run', 'The Ferry',
   now() + interval '7 days', false, '00000000-0000-0000-0000-0000000630c1', null,
   '00000000-0000-0000-0000-000000063001');

-- ---------------------------------------------------------------------------
-- 063.1  The mechanism itself. `security definer` is REQUIRED (063.6 is why),
--        and a definer function that the client can CALL is a different thing
--        from one a trigger invokes -- 031's lesson is to assert the ROLE
--        rather than to call the function, so that is what these do.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'enforce_ride_capacity'),
  true, '063: the capacity function is security definer — an invoker-rights count is short by the caller''s blocks');

-- In `private`, so PostgREST cannot route to it at all — the schema is the
-- barrier and the revoke below is the second lock on the same door. A row here
-- for `public` would mean the revoke is the only one.
select assert_eq(
  (select array_agg(n.nspname order by n.nspname)::text[] from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'enforce_ride_capacity'),
  array['private'],
  '063: ... and lives in private, off the PostgREST surface, like notify_ride_joined on this same table');

select assert_eq(
  has_function_privilege('authenticated', 'private.enforce_ride_capacity()', 'execute'),
  false, '063: ... with no EXECUTE for authenticated — asserted on the ROLE rather than by calling it (031''s lesson)');

select assert_eq(
  has_function_privilege('anon', 'private.enforce_ride_capacity()', 'execute'),
  false, '063: ... nor for anon');

-- Both verbs, because 048 grants UPDATE on `ride_id` and an INSERT-only trigger
-- is one `update ride_members set ride_id = ...` away from being bypassed —
-- 063.7 is that statement.
select assert_eq(
  (select pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE%'
     from pg_trigger where tgrelid = 'public.ride_members'::regclass
      and tgname = 'enforce_ride_capacity'),
  true, '063: the trigger fires on INSERT and on UPDATE, not on INSERT alone');

-- Name order is firing order for same-timing row triggers, and this is the
-- right way round: an un-onboarded rider is told to finish onboarding rather
-- than that the ride is full. Both raise 23514, so the ORDER is the only thing
-- that decides which message they get.
select assert_eq(
  (select array_agg(tgname order by tgname)::text[] from pg_trigger
    where tgrelid = 'public.ride_members'::regclass and not tgisinternal
      and (tgtype & 2) = 2),
  array['enforce_participation_gate', 'enforce_ride_capacity'],
  '063: the participation gate sorts before the capacity gate, so consent is refused before capacity is');

-- ---------------------------------------------------------------------------
-- 063.2  A full ride refuses the next rider, and `maybe` is what filled it.
--        The second seat is 6302's `maybe` row, so every refusal in this
--        section is also the assertion that `maybe` counts.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000063003', false);

select assert_rejected($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063003', 'going')$$,
  '23514', '063: a third rider is refused on a cap of 2 — and the second seat is a `maybe`, so `maybe` counts');

select assert_rejected($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063003', 'maybe')$$,
  '23514', '063: ... and cannot slip in as a `maybe` either — the cap is on the crew, not on one status');

-- **The message is contract, so the SQLSTATE alone is not enough.**
-- `setRideAttendance` matches `error.message.includes('this ride is full')`
-- alongside the code, because `018`'s four text CHECKs on `rides` and `023`'s
-- gate all raise 23514 — so a reworded raise would silently downgrade a full
-- ride to "the ride may no longer be available". `assert_rejected` reads the
-- SQLSTATE only, hence the block.
do $cap$
declare msg text;
begin
  begin
    insert into ride_members (ride_id, user_id, status)
      values ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063003', 'going');
    raise exception 'FAIL  063: a full ride accepted a rider';
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    if msg <> 'this ride is full' then
      raise exception 'FAIL  063: the refusal message is the client contract — expected "this ride is full", got "%"', msg;
    end if;
    raise notice 'ok    063: the refusal message is exactly `this ride is full`, which is what setRideAttendance matches on';
  end;
end
$cap$;

-- ---------------------------------------------------------------------------
-- 063.3  An UNCAPPED ride is untouched. NULL is "no cap", which is what every
--        ride in both projects carries today — so this is the assertion that
--        063 changed nothing for anybody.
-- ---------------------------------------------------------------------------
savepoint cap_uncapped;
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f002', '00000000-0000-0000-0000-000000063003', 'going');
select assert_eq(
  (select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-00000063f002'),
  1, '063: an uncapped ride takes the rider a capped one refused');
rollback to savepoint cap_uncapped;

-- ---------------------------------------------------------------------------
-- 063.4  A rider ALREADY on a full ride can still change their mind. This is
--        the case a plain `count(*) >= max_riders` gets wrong and nothing else
--        here would catch: `setRideAttendance` is an UPSERT, and a BEFORE
--        INSERT trigger fires on an upsert even when it resolves to an UPDATE
--        (measured, Postgres 16). Counting the caller's own row would freeze
--        every existing member's RSVP on a full ride — a worse bug than the one
--        063 fixes. An EXISTS exemption is what answers it; 063.5 carries the
--        over-subscribed case, which is where the narrower fix breaks.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000063002', false);

savepoint cap_reRsvp;
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063002', 'going')
  on conflict (ride_id, user_id) do update
    set ride_id = excluded.ride_id, user_id = excluded.user_id, status = excluded.status;
select assert_eq(
  (select status from ride_members
    where ride_id = '00000000-0000-0000-0000-00000063f001'
      and user_id = '00000000-0000-0000-0000-000000063002'),
  'going', '063: a member of a FULL ride can still switch maybe -> going — the upsert''s BEFORE INSERT fires even though it resolves to an UPDATE');
rollback to savepoint cap_reRsvp;

-- The plain UPDATE form of the same change, which takes the trigger's early
-- return rather than the count: `ride_id` is unchanged, so no new seat is taken.
savepoint cap_flip;
update ride_members set status = 'going'
  where ride_id = '00000000-0000-0000-0000-00000063f001'
    and user_id = '00000000-0000-0000-0000-000000063002';
select assert_eq(
  (select status from ride_members
    where ride_id = '00000000-0000-0000-0000-00000063f001'
      and user_id = '00000000-0000-0000-0000-000000063002'),
  'going', '063: ... and by a plain UPDATE too — a status change takes no new seat');
rollback to savepoint cap_flip;

-- ---------------------------------------------------------------------------
-- 063.5  Lowering the cap below the current crew is ALLOWED and evicts nobody.
--        The rule is a join gate: an over-subscribed ride is legal, and what
--        the lowered cap buys the organizer is that nobody else gets on.
-- ---------------------------------------------------------------------------
reset role;
savepoint cap_lowered;
update rides set max_riders = 1 where id = '00000000-0000-0000-0000-00000063f001';

select assert_eq(
  (select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-00000063f001'),
  2, '063: lowering the cap below the crew evicts nobody — an over-subscribed ride is a legal state, not a repair job');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000063003', false);
select assert_rejected($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063003', 'going')$$,
  '23514', '063: ... and no further rider may join while the crew is over it');

-- **The case the first cut of `063` got wrong, and the reason this assertion is
-- an UPSERT.** Excluding only the writer's own row from the count is enough on
-- a ride exactly AT its cap and not enough on one OVER it: 2 rows against a cap
-- of 1 leaves 1 other, which still meets the cap, so an existing member's RSVP
-- was refused — a lowered cap froze the crew it had promised not to evict. The
-- bare `update ride_members set status` form passes against that bug, because
-- it takes the trigger's early return, so an assertion in that shape would have
-- been vacuous. This is the statement `setRideAttendance` actually issues.
select set_config('test.uid', '00000000-0000-0000-0000-000000063002', false);
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063002', 'going')
  on conflict (ride_id, user_id) do update
    set ride_id = excluded.ride_id, user_id = excluded.user_id, status = excluded.status;
select assert_eq(
  (select status from ride_members
    where ride_id = '00000000-0000-0000-0000-00000063f001'
      and user_id = '00000000-0000-0000-0000-000000063002'),
  'going', '063: a member of an OVER-SUBSCRIBED ride can still change their RSVP — a lowered cap must not freeze the crew it did not evict');

reset role;
rollback to savepoint cap_lowered;

-- ---------------------------------------------------------------------------
-- 063.6  THE BLOCK CASE, and the reason the count is `security definer`.
--        009 put private.is_blocked on the ride_members SELECT policy itself,
--        so 6304 — who blocked 6302 — sees ONE of the two crew rows. Counted
--        under their own RLS the ride would look half empty, and the cap would
--        be exceeded by exactly the number of blocks in play.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000063004', false);

select assert_eq(
  (select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-00000063f001'),
  1, '063: the blocking rider can see only ONE of the two crew rows — 009 hides the other');

select assert_rejected($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063004', 'going')$$,
  '23514', '063: ... and is refused anyway — the definer count sees the roster the blocker cannot');

-- ---------------------------------------------------------------------------
-- 063.7  The bypass 048 left open. `authenticated` holds UPDATE on `ride_id`
--        (PostgREST's ON CONFLICT DO UPDATE SET list carries it, so it had to
--        be granted), which means a seat can be MOVED. An INSERT-only trigger
--        would be one statement away from useless.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000063005', false);
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f002', '00000000-0000-0000-0000-000000063005', 'going');

select assert_rejected($$
  update ride_members set ride_id = '00000000-0000-0000-0000-00000063f001'
   where ride_id = '00000000-0000-0000-0000-00000063f002'
     and user_id = '00000000-0000-0000-0000-000000063005'$$,
  '23514', '063: a seat cannot be MOVED into a full ride — the trigger fires on UPDATE, not on INSERT alone');

-- 063.7b  And the neighbouring question a reader of the policy list WILL ask,
--         answered here so it is not re-derived wrongly: the UPDATE policy's
--         `with check` is a bare `auth.uid() = user_id` while the INSERT
--         policy's carries an EXISTS against `rides`, which reads like a hole —
--         move the row instead of inserting it and the ride-visibility test is
--         skipped. It is not a hole. Postgres also applies the SELECT policy to
--         the NEW row of an UPDATE, so a row cannot be updated into
--         invisibility.
--
-- **The target id is a LITERAL, and that is the whole assertion.** Written as a
-- subquery selecting "a private ride this rider is not in", it runs under the
-- rider's own RLS — which hides exactly those rides — so it evaluates to NULL,
-- the statement becomes `set ride_id = null`, and the 42501 comes from the
-- roster policy's EXISTS failing on a NULL. That version passes while measuring
-- nothing about visibility. Caught in review; do not reintroduce it.
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-00000063f009'),
  0, '063: the rider cannot see the private club''s ride at all — without this the next line proves nothing');

select assert_rejected($$
  update ride_members set ride_id = '00000000-0000-0000-0000-00000063f009'
   where ride_id = '00000000-0000-0000-0000-00000063f002'
     and user_id = '00000000-0000-0000-0000-000000063005'$$,
  '42501', '063: ... and cannot move their seat onto it — RLS refuses that one, not the capacity trigger, and that ride is UNCAPPED so only visibility can be doing the work');

-- ---------------------------------------------------------------------------
-- 063.8  Leaving frees the seat, with no further machinery: `No` deletes the
--        row (there is no third status), so the next rider simply fits.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000063002', false);
delete from ride_members
  where ride_id = '00000000-0000-0000-0000-00000063f001'
    and user_id = '00000000-0000-0000-0000-000000063002';
select assert_eq(
  (select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-00000063f001'),
  1, '063: leaving a full ride removes the row — `No` has no stored status');

select set_config('test.uid', '00000000-0000-0000-0000-000000063003', false);
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f001', '00000000-0000-0000-0000-000000063003', 'going');
select assert_eq(
  (select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-00000063f001'),
  2, '063: ... and the rider refused a moment ago now fits — the gate reopens on its own');

-- ---------------------------------------------------------------------------
-- 063.9  createRide's shape at the tightest cap the CHECK allows. The organizer
--        inserts the ride and then their own crew row, two statements and no
--        transaction, so a capacity rule that counted the row it is about to
--        write would make `max_riders = 1` uncreatable.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000063001', false);
insert into rides (id, title, meeting_point, departure_at, is_public, max_riders, organizer_id)
  values ('00000000-0000-0000-0000-00000063f003', 'Solo Run', 'The Ferry',
          now() + interval '7 days', true, 1, '00000000-0000-0000-0000-000000063001');
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f003', '00000000-0000-0000-0000-000000063001', 'going');
select assert_eq(
  (select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-00000063f003'),
  1, '063: an organizer''s own crew row lands at max_riders = 1 — a solo ride is creatable');

select set_config('test.uid', '00000000-0000-0000-0000-000000063003', false);
select assert_rejected($$
  insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f003', '00000000-0000-0000-0000-000000063003', 'going')$$,
  '23514', '063: ... and nobody else may join it');

-- ---------------------------------------------------------------------------
-- 063.10 THE ORGANIZER IS EXEMPT, and the reason is not generosity. `getRide`
--        and `toRideListItem` both render a host holding no `ride_members` row
--        as `going`, so the row records a fact rather than claiming a seat —
--        and `createRide`'s two inserts have no transaction and its rollback
--        runs in the browser, so a closed tab leaves exactly this state.
--        Without the exemption the app shows an organizer on a ride the
--        database will not let them onto, permanently.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000063001', false);
delete from ride_members
  where ride_id = '00000000-0000-0000-0000-00000063f003'
    and user_id = '00000000-0000-0000-0000-000000063001';
reset role;
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f003', '00000000-0000-0000-0000-000000063005', 'going');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000063001', false);
insert into ride_members (ride_id, user_id, status)
  values ('00000000-0000-0000-0000-00000063f003', '00000000-0000-0000-0000-000000063001', 'going');
select assert_eq(
  (select count(*)::int from ride_members where ride_id = '00000000-0000-0000-0000-00000063f003'),
  2, '063: an organizer restores their own crew row on a ride already at its cap — their row is a record, not a seat, and it is the one thing that may exceed the cap');

reset role;
rollback to savepoint ride_capacity_063;

\echo ''
\echo '# A photo''s capture time and place — bounded, coupled, and insert-only (064)'

-- ===========================================================================
-- 064.  postcards.taken_at / taken_at_offset_minutes / taken_latitude /
--       taken_longitude / taken_location_precision.  PD-255.
--
--       The privacy rule this file cannot test, stated so nobody reads the
--       absence as coverage: **the reduction happens in the BROWSER, before the
--       request is built.** No assertion here can see that, because by the time
--       a row exists the choice has already been made. What the database CAN
--       own, and what is asserted below, is everything that follows from it —
--       which columns may ever be written, that a `region` row really is
--       rounded, that the triple cannot arrive half-populated, and that nobody
--       can edit any of it afterwards.
--
--       Grants are asserted BY ROLE with has_column_privilege, never by
--       attempting a write: this suite runs as the table owner, for whom no
--       column privilege is a barrier (031's lesson).
-- ===========================================================================
savepoint capture_metadata_064;

reset role;

-- ---------------------------------------------------------------------------
-- 064.1  INSERT reaches all five, so a rider can publish what they chose.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select bool_and(has_column_privilege('authenticated', 'public.postcards', c, 'INSERT'))
     from unnest(array['taken_at', 'taken_at_offset_minutes', 'taken_latitude',
                       'taken_longitude', 'taken_location_precision']) c),
  true, '064: authenticated may INSERT all five capture columns — the rider''s own choice is what writes them');

-- ---------------------------------------------------------------------------
-- 064.2  SELECT reaches all five, and the reason is a decision rather than
--        habit: a rider must be able to read back what they published, and the
--        Journal's `order by taken_at` needs the column privilege — Postgres
--        checks a column reference in an ORDER BY exactly as in a target list,
--        which is what 062 measured for a predicate.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select bool_and(has_column_privilege('authenticated', 'public.postcards', c, 'SELECT'))
     from unnest(array['taken_at', 'taken_at_offset_minutes', 'taken_latitude',
                       'taken_longitude', 'taken_location_precision']) c),
  true, '064: ... and may SELECT all five — the audience of these columns IS the audience of the postcard, and there is no narrower one available');

select assert_eq(has_table_privilege('authenticated', 'public.postcards', 'select'),
  false, '064: ... while the TABLE-level SELECT grant is still absent, so 062''s shape survived the re-grant and select(*) is still 42501');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'ride_id', 'SELECT'),
  false, '064: ... and ride_id is STILL not readable — 062 took it out deliberately, and an absolute re-grant list is exactly how that gets silently reverted');

-- ---------------------------------------------------------------------------
-- 064.3  NO UPDATE, on any of the five, ever. This is the insert-only decision
--        and the whole remedy for a mis-published location is deleting the
--        postcard. 064 issues no UPDATE statement at all — leaving the verb
--        alone is what produces this, and touching it is 044/046's trap.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select bool_or(has_column_privilege('authenticated', 'public.postcards', c, 'UPDATE'))
     from unnest(array['taken_at', 'taken_at_offset_minutes', 'taken_latitude',
                       'taken_longitude', 'taken_location_precision']) c),
  false, '064: no capture column holds UPDATE — a rider may always make a photo vaguer by deleting it and never sharper, and there is no path to re-point an old postcard at a new place');

select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'caption,club_id,image_path',
  '064: the UPDATE list is UNMOVED at exactly three columns — if this goes red, 064 touched a verb it must not mention and has reinstated whatever 046 removed');

-- ---------------------------------------------------------------------------
-- 064.4  anon holds nothing, on any of the five, in any verb. Decision #1.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select bool_or(has_column_privilege('anon', 'public.postcards', c, p))
     from unnest(array['taken_at', 'taken_at_offset_minutes', 'taken_latitude',
                       'taken_longitude', 'taken_location_precision']) c,
          unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p),
  false, '064: anon holds no privilege of any kind on any capture column — a coordinate is the last thing that should reach a role with no session');

-- ---------------------------------------------------------------------------
-- 064.5  The all-NULL shape is legal, and it is the COMMON one. HEIC (the
--        iPhone default), screenshots and anything already through another
--        app's share sheet carry no EXIF at all. If this were refused, every
--        existing insert fixture in this file would break — which is itself the
--        proof, since none of them names a capture column.
-- ---------------------------------------------------------------------------
set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000064001', 'exifrider@example.com');
reset role;
update profiles set username = 'exifrider', location = 'Utrecht',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000064001';

insert into postcards (id, author_id, image_path)
  values ('00000000-0000-0000-0000-00000064f001',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a1.jpg');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000064f001'),
  1, '064: a postcard with no capture metadata at all is legal — it is the common case, not the edge one');

-- ---------------------------------------------------------------------------
-- 064.6  taken_at is BOUNDED because it cannot be OWNED. 044 closed created_at
--        by taking the grant away; that instrument is unavailable here, because
--        this value exists only in the rider's own file. So the CHECK is the
--        guarantee — and a future value is the one that matters, since the
--        Journal sorts on this column.
-- ---------------------------------------------------------------------------
select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f002',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a2.jpg',
          now() + interval '1 day', 0)$$,
  '23514', '064: a capture time in the FUTURE is refused — it is the ride Journal''s sort key, so PD-163''s pin-yourself-to-the-top defect would arrive again through a column the client must be able to write');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f003',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a3.jpg',
          timestamptz '1970-01-01 00:00:00+00', 0)$$,
  '23514', '064: the epoch-0 placeholder is refused — and a 1900 floor would have ADMITTED it, which is why the floor is 1995, the year DateTimeOriginal was specified');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f004',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a4.jpg',
          timestamptz '1904-01-01 00:00:00+00', 0)$$,
  '23514', '064: ... and so is the 1904 Mac epoch, the other value a 1900 floor would have let through');

insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f005',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a5.jpg',
          now() - interval '3 hours', 120);
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000064f005'),
  1, '064: an honest capture time earlier today lands — the bound refuses garbage, not riders');

-- ---------------------------------------------------------------------------
-- 064.7  The offset is coupled to the instant IN BOTH DIRECTIONS. There is one
--        writer and it always knows an offset, so a bare instant is a value no
--        renderer can draw a wall clock from — and a bare offset is nonsense.
-- ---------------------------------------------------------------------------
select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_at)
  values ('00000000-0000-0000-0000-00000064f006',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a6.jpg',
          now() - interval '1 hour')$$,
  '23514', '064: a capture time with NO offset is refused — the camera''s wall clock would be unrecoverable, and the Journal would draw a Helsinki photo in Amsterdam time');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f007',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a7.jpg',
          120)$$,
  '23514', '064: ... and an offset with no capture time is refused too — the coupling runs both ways');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f018',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b8.jpg',
          now() - interval '1 hour', 5999)$$,
  '23514', '064: an offset no place on Earth uses is refused — OffsetTimeOriginal is two digits of hours, so a camera with a corrupt clock setting writes a WELL-FORMED +99:59 and reaches 5999');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f019',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b9.jpg',
          now() - interval '1 hour', -5999)$$,
  '23514', '064: ... and the same in the other direction');

-- The bound is PERMISSIVE on purpose — ±1440 rather than the real world's
-- -720..840 — because the client is what narrows it, and a CHECK tight to the
-- real world would refuse a rider over a camera setting they cannot see.
insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f020',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640c0.jpg',
          now() - interval '1 hour', 840);
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000064f020'),
  1, '064: UTC+14, the furthest offset any place on Earth uses, lands');

-- **The wall itself, at ±1440 exactly.** The two refusals above are at ±5999,
-- which is four times outside it — so on their own a migration relaxing this
-- CHECK to ±2000 would leave every assertion in this block green. A pair
-- straddling the boundary is what makes the number pinned rather than merely
-- exceeded.
insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f021',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640c1.jpg',
          now() - interval '1 hour', 1440);
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000064f021'),
  1, '064: exactly 1440 is inside the CHECK — no client emits it, and the bound is where the file says it is');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_at, taken_at_offset_minutes)
  values ('00000000-0000-0000-0000-00000064f022',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640c2.jpg',
          now() - interval '1 hour', 1441)$$,
  '23514', '064: ... and 1441 is not — one minute outside, so relaxing the bound cannot pass unnoticed');

-- ---------------------------------------------------------------------------
-- 064.8  The coordinate TRIPLE arrives whole or not at all. Three nullable
--        columns admit eight states, five of which are nonsense; without this
--        every reader invents its own guess about a half-populated row. Same
--        shape as rides_location_coupling, one table over — 051 called it
--        rides_geocode_coupling and 067 replaced it under the new name when a
--        picked coordinate stopped carrying a confidence.
-- ---------------------------------------------------------------------------
select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_latitude)
  values ('00000000-0000-0000-0000-00000064f008',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a8.jpg',
          52.37)$$,
  '23514', '064: a latitude with no longitude is refused — half a coordinate is not a place');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_latitude, taken_longitude)
  values ('00000000-0000-0000-0000-00000064f009',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640a9.jpg',
          52.37, 4.9)$$,
  '23514', '064: a coordinate with no precision marker is refused — a reader could not tell a rounded point from an exact one, and would have to guess how honestly to label it');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_location_precision)
  values ('00000000-0000-0000-0000-00000064f010',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b0.jpg',
          'precise')$$,
  '23514', '064: ... and a precision marker with no coordinate is refused, which is the same rule read the other way');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000064f011',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b1.jpg',
          52.37, 4.9, 'approximate')$$,
  '23514', '064/072: an unknown precision marker is refused — the domain is the contract the composer''s buttons produce (''region'', ''precise'', and ''place'' since 072), and a value outside it would be a mode nobody designed');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000064f012',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b2.jpg',
          95.0, 4.9, 'precise')$$,
  '23514', '064: an out-of-range latitude is refused — 051''s bounds, copied rather than reinvented');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000064f013',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b3.jpg',
          52.37, 195.0, 'precise')$$,
  '23514', '064: ... and an out-of-range longitude with it');

-- ---------------------------------------------------------------------------
-- 064.9  A `region` row must ACTUALLY BE ROUNDED, and this is the assertion the
--        whole privacy model leans on that a reviewer would otherwise assume is
--        the client's job. The app is client-rendered: the rounding happens in
--        a browser this project does not control, so a patched client could
--        send a precise coordinate under a `region` marker and be drawn as
--        approximate. CLAUDE.md — no new integrity rule may live only in Zod.
--
--        **The constraint enforcing this is called
--        `postcards_coarse_location_is_rounded` since 072**, which renamed it
--        and retargeted it at both coarse markers. Every assertion in this
--        block is unchanged, because `region` is still one of them; the
--        `place` half is asserted in the 072 block below.
-- ---------------------------------------------------------------------------
select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000064f014',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b4.jpg',
          52.370216, 4.895168, 'region')$$,
  '23514', '064: a PRECISE coordinate sent under a region marker is refused — the rounding is done in a browser this app does not control, so the claim has to be checked here or it is not a claim at all');

insert into postcards (id, author_id, image_path, taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000064f015',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b5.jpg',
          52.37, 4.9, 'region');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000064f015'),
  1, '064: ... and a genuinely rounded one lands');

-- The halfway case, and the reason the predicate is written the way it is. It
-- asks whether the stored value IS at two decimal places, NOT whether it equals
-- Postgres's own rounding of some original — so JS and Postgres disagreeing on
-- 4.895 (JS floors to 4.89, numeric round gives 4.90) cannot fail an honest
-- client. Both land.
insert into postcards (id, author_id, image_path, taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000064f016',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b6.jpg',
          4.89, 4.90, 'region');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000064f016'),
  1, '064: ... including the halfway case both languages round differently — the CHECK asks "is it at two places", not "does it equal MY rounding of the original"');

-- A precise row is NOT held to the rounding rule, which is the point of the
-- marker: it is what distinguishes a value the rider chose to publish exactly
-- from one they chose to blur.
insert into postcards (id, author_id, image_path, taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000064f017',
          '00000000-0000-0000-0000-000000064001',
          'postcards/00000000-0000-0000-0000-000000064001/00000000-0000-0000-0000-0000000640b7.jpg',
          52.370216, 4.895168, 'precise');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000064f017'),
  1, '064: a precise row keeps every digit — the marker is what says which rule applies');

-- ---------------------------------------------------------------------------
-- 064.10 NO POLICY MOVED. 064 is a grants-and-constraints change; if any of the
--        four quals differs afterwards it has done something it does not
--        describe. Asserted as a count of policies rather than a pinned md5,
--        because the quals are asserted individually throughout this file and a
--        hash here would go red on every legitimate future edit to them.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'postcards'),
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'postcards'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%taken_%'),
  '064: no postcards policy mentions a capture column — the audience of a photo''s location is the audience of the photo, and adding an arm for it would be inventing a second one');

rollback to savepoint capture_metadata_064;


-- ===========================================================================
-- 066 — a club carries its own location (PD-259)
-- ===========================================================================
-- Four columns on `clubs`, filled from a picked `public.places` row. There is
-- **no new policy**, deliberately: the columns live on `clubs`, so `001`'s
-- SELECT policy already governs them exactly as it governs `name`. A policy
-- here could only widen what is already right.
--
-- So what is asserted instead is the two things 066 DOES change — the grants
-- and the CHECKs — plus the negative that no policy moved.
-- ---------------------------------------------------------------------------
savepoint club_location_066;

reset role;

-- ---------------------------------------------------------------------------
-- 066.1  The four columns are writable by a rider, on both verbs. Without
--        this, 045's allowlist silently refuses them and Create club drops the
--        location with no error the rider can see.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select bool_and(has_column_privilege('authenticated', 'public.clubs', c, 'INSERT'))
     from unnest(array['location_name', 'location_place_id', 'latitude', 'longitude']) c),
  true, '066: authenticated may INSERT all four location columns — set at create');
select assert_eq(
  (select bool_and(has_column_privilege('authenticated', 'public.clubs', c, 'UPDATE'))
     from unnest(array['location_name', 'location_place_id', 'latitude', 'longitude']) c),
  true, '066: ... and UPDATE all four, because a club that moves must be editable');
select assert_eq(
  (select bool_and(has_column_privilege('authenticated', 'public.clubs', c, 'SELECT'))
     from unnest(array['location_name', 'location_place_id', 'latitude', 'longitude']) c),
  true, '066: ... and SELECT all four — the club renders where it is, and Explore sorts on the coordinates');

-- The table-level grants must STILL be absent. A `grant insert on public.clubs`
-- written to add four columns would hand over `created_at` and `is_default`
-- with them, and every per-column assertion above would still pass.
select assert_eq(has_table_privilege('authenticated', 'public.clubs', 'insert'),
  false, '066: the TABLE-level INSERT grant is still absent — 066 added columns to 045''s allowlist, it did not replace the allowlist with a table grant');
select assert_eq(has_table_privilege('authenticated', 'public.clubs', 'update'),
  false, '066: ... and so is the TABLE-level UPDATE grant');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'created_at', 'INSERT'),
  false, '066: created_at is STILL not insertable — 045 closed the Explore-pinning vector and an additive grant cannot reopen it');
select assert_eq(has_column_privilege('authenticated', 'public.clubs', 'is_default', 'UPDATE'),
  false, '066: ... and is_default is STILL not updatable, which 058 revoked — this is what an ADDITIVE grant buys over 044/046''s absolute re-stated list');

-- ---------------------------------------------------------------------------
-- 066.2  The coupling refuses every half-written location. This is the rule
--        that cannot live in Zod: a rider drives the browser, and a name with
--        no coordinates renders on a card while being invisible to the
--        distance filter.
--
--        23514 by name rather than "any error" — assert_rejected's own reason.
--
--        **As the club's OWNER (…000a), not the file's default identity.** The
--        first version of this block ran as …000c and every assertion failed —
--        043's UPDATE policy filtered the row to zero, so the statement
--        succeeded having touched nothing and no CHECK ever fired. A constraint
--        can only be tested by a caller the policy lets through, which is the
--        same trap `assert_allowed`'s own comment describes for UPDATE.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;

select assert_rejected(
  $$update clubs set location_name = 'Utrecht'
     where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', '066: a name with no coordinates is refused — half a location is not a location');
select assert_rejected(
  $$update clubs set latitude = 52.09
     where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', '066: ... and coordinates with no name are refused too, which is the half that would filter correctly and render blank');
select assert_rejected(
  $$update clubs set location_name = 'Utrecht', location_place_id = 'x',
                     latitude = 52.09, longitude = null
     where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', '066: ... and three of four is still half a location');

-- Range, on both axes and both signs. A latitude of 91 is not a place.
select assert_rejected(
  $$update clubs set location_name = 'Nowhere', location_place_id = 'x',
                     latitude = 91, longitude = 5.12
     where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', '066: a latitude past the pole is refused');
select assert_rejected(
  $$update clubs set location_name = 'Nowhere', location_place_id = 'x',
                     latitude = 52.09, longitude = -181
     where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', '066: ... and a longitude past the antimeridian');

-- The two length bounds, which `001` gave `name` and `description` and which
-- 018 had to add to `profiles` for exactly this reason.
select assert_rejected(
  $$update clubs set location_name = repeat('x', 201), location_place_id = 'x',
                     latitude = 52.09, longitude = 5.12
     where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', '066: a 201-character location name is refused — the bound is in the database, not only in the Zod schema');
select assert_rejected(
  $$update clubs set location_name = 'Utrecht', location_place_id = repeat('x', 513),
                     latitude = 52.09, longitude = 5.12
     where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', '066/069: ... and a 513-character provider id, which is the field a client controls most directly');
-- The POSITIVE at the new bound, written for real and read back. The rejection
-- at 513 passes on its own against a database where 069 never applied, which is
-- exactly the shape 057's boundary move had to fix: a one-sided boundary test
-- cannot tell a widened constraint from an unchanged one.
-- The coupling CHECK requires the whole location set to move together, so the
-- name and coordinate come with it. That is 066 working, not noise.
update clubs set location_name = 'Utrecht',
                 location_place_id = 'geoapify:' || repeat('x', 503),
                 latitude = 52.09, longitude = 5.12
 where id = '00000000-0000-0000-0000-0000000000c2';
select assert_eq(
  (select char_length(location_place_id)::int from clubs
    where id = '00000000-0000-0000-0000-0000000000c2'),
  512, '069: exactly 512 characters is accepted — a provider id observed at 191 has room, and the bound is not the observed maximum');

-- ---------------------------------------------------------------------------
-- 066.3  A COMPLETE location is accepted, and clearing it back to NULL is too.
--        Both are run and counted rather than passed to assert_allowed, which
--        cannot prove an UPDATE did anything (see its own comment).
-- ---------------------------------------------------------------------------
savepoint club_location_066_write;

update clubs
   set location_name = 'Utrecht', location_place_id = 'gers-fixture',
       latitude = 52.09, longitude = 5.12
 where id = '00000000-0000-0000-0000-0000000000c2';
select assert_eq(
  (select count(*)::int from clubs
    where id = '00000000-0000-0000-0000-0000000000c2' and latitude = 52.09),
  1, '066: an owner can set a complete location on their own club');

update clubs
   set location_name = null, location_place_id = null,
       latitude = null, longitude = null
 where id = '00000000-0000-0000-0000-0000000000c2';
select assert_eq(
  (select count(*)::int from clubs
    where id = '00000000-0000-0000-0000-0000000000c2' and location_name is null),
  1, '066: ... and can clear it again — all four NULL is the other legal state, which is what "optional" means');

rollback to savepoint club_location_066_write;

-- ---------------------------------------------------------------------------
-- 066.4  A NON-owner cannot set a location on somebody else's club. 043's
--        UPDATE policy is what refuses it, unchanged — asserted because 066
--        widened the grant, and a grant is checked BEFORE a policy: a reader of
--        066 alone cannot tell that the policy still stands behind it.
-- ---------------------------------------------------------------------------
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;

savepoint club_location_066_other;
update clubs
   set location_name = 'Rotterdam', location_place_id = 'gers-other',
       latitude = 51.92, longitude = 4.48
 where id = '00000000-0000-0000-0000-0000000000c1';
select assert_eq(
  (select count(*)::int from clubs
    where id = '00000000-0000-0000-0000-0000000000c1' and location_name is not null),
  0, '066: a member who does not own the club cannot give it a location — 043''s UPDATE policy filters the row to zero, and the new grant does not reach past it');
rollback to savepoint club_location_066_other;

-- ---------------------------------------------------------------------------
-- 066.5  NO POLICY MOVED. 066 is a columns-grants-and-constraints change; if a
--        clubs policy now mentions one of the four, it has done something it
--        does not describe. Counted rather than hashed, for the reason 064.10
--        gives.
-- ---------------------------------------------------------------------------
reset role;
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'clubs'),
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'clubs'
      and (coalesce(qual, '') || coalesce(with_check, ''))
          not like '%locat%'
      and (coalesce(qual, '') || coalesce(with_check, ''))
          not like '%latitude%'
      and (coalesce(qual, '') || coalesce(with_check, ''))
          not like '%longitude%'),
  '066: no clubs policy mentions a location column — the audience of where a club is IS the audience of the club, and adding an arm for it would be inventing a second one');

-- And there is still no foreign key to `places`, which is the one thing about
-- these columns most likely to be "fixed" by a later reader who has not read
-- 066's header. A reload of `places` deletes every row first.
select assert_eq(
  -- Keyed on the COLUMN, not on a target table. It used to name `places`, and
  -- `070` dropped that table — so the old form counted 0 by construction and
  -- would have gone on passing against a schema that grew a FK to something
  -- else entirely. This asks the question that outlives the provider.
  (select count(*)::int from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.clubs'::regclass and c.contype = 'f'
     and a.attname = 'location_place_id'),
  0, '066/070: clubs.location_place_id carries NO foreign key to anything — it holds a third party''s opaque id, so it is provenance and a dangling value is a normal state');

rollback to savepoint club_location_066;


-- ===========================================================================
-- 067 — a ride's start location can be PICKED, and a pick outranks a geocode
--       (PD-114)
-- ===========================================================================
-- One column on `rides`, a replaced coupling CHECK, a length CHECK, a rewritten
-- `clear_ride_map_tiles`, and a new `protect_picked_ride_location` trigger.
--
-- ** There is NO new policy, deliberately, and that is what 067.6 asserts. **
-- The columns live on `rides`, so 001/017/022 already decide who reads them:
-- RLS is row-level, a reader who gets the row gets every column they hold a
-- grant for, and there is no NARROWER policy available here — only a wider one.
--
-- ** The two BEFORE triggers change what "refused" means on an UPDATE, and this
-- block is written around that rather than against it. ** Measured on DEV
-- 2026-08-18 after applying: on INSERT no trigger runs, so the CHECK refuses
-- every mixed combination with 23514. On UPDATE the triggers run FIRST and
-- NORMALISE the row — `clear_ride_map_tiles` NULLs a confidence sent beside a
-- new pick, `protect_picked_ride_location` restores a coordinate somebody tried
-- to move — so the statement is ACCEPTED and the stored row is still legal. An
-- assertion demanding 23514 from those UPDATEs would be asserting against the
-- design's own "never raise on a rider's write" rule. Both mechanisms are
-- asserted: the CHECK where it is reachable, the normalisation where it is not.
-- ---------------------------------------------------------------------------
savepoint ride_start_location_067;

reset role;
select set_config('test.uid', '', false);

-- ---------------------------------------------------------------------------
-- 067.1  The grants. A pick is supplied at ride CREATION, and 045 converted
--        `rides` to per-column grants, so before 067 `latitude` carried no
--        INSERT grant at all and a create-with-a-pick raised 42501 ABOVE RLS
--        with the policy set looking perfectly correct.
--
--        SCOPED TO THE GRANTEE, per 015's footer: a table-wide count reads 2
--        against a correct database because postgres and service_role hold
--        everything by Supabase default.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select bool_and(has_column_privilege('authenticated', 'public.rides', c, 'INSERT'))
     from unnest(array['start_place_id', 'latitude', 'longitude']) c),
  true, '067: authenticated may INSERT start_place_id, latitude and longitude — a pick is set at create, not only at edit');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'start_place_id', 'UPDATE'),
  true, '067: ... and may UPDATE start_place_id, because a rider can re-pick or clear it');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'geocode_confidence', 'INSERT'),
  false, '067: ... and holds NO INSERT grant on geocode_confidence — no client ever produces a vendor score, and one that could would be writing the geocoded arm by hand');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'map_card_path', 'INSERT'),
  false, '067: ... nor on a tile path, which is 051''s rule and an additive grant cannot reopen it');

-- The UPDATE grant on geocode_confidence STAYS, and this assertion is the
-- tripwire for the hardening that must not land early. resolve-ride-location
-- writes as the CALLER (anon key plus the rider's own Authorization header),
-- not as service_role — delete-account is the only place a service-role key
-- exists — so revoking this ahead of a redeployed function raises 42501 on
-- every geocode, fail-open, and every ride silently stops getting a tile.
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'geocode_confidence', 'UPDATE'),
  true, '067: authenticated STILL holds update (geocode_confidence) — 051 granted it and the geocoder writes as the caller, so revoking it before that function is redeployed takes every tile down silently (tasks.md §8)');

-- The table-level grants must still be absent, or the per-column assertions
-- above would pass while `id` and `organizer_id` had been handed over with them.
select assert_eq(has_table_privilege('authenticated', 'public.rides', 'insert'),
  false, '067: the TABLE-level INSERT grant is still absent — 067 added columns to 045''s allowlist, it did not replace the allowlist');
select assert_eq(has_column_privilege('authenticated', 'public.rides', 'created_at', 'INSERT'),
  false, '067: created_at is STILL not insertable, which 045 closed');

select assert_eq(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'rides' and grantee = 'anon'),
  0, '067: anon holds NO column grant on rides, of any kind, for any operation — decision #1');

-- ---------------------------------------------------------------------------
-- 067.2  The coupling, arm by arm, on INSERT — where the CHECK is the only
--        thing standing, because both of 067's triggers are BEFORE UPDATE.
--
--        Run as the OWNER for the confidence-bearing rows: `authenticated`
--        holds no INSERT grant on geocode_confidence, so as a rider those
--        statements are refused 42501 by the grant BEFORE the CHECK is ever
--        consulted — which is a different rule passing under the same label.
--        Both refusals are asserted, each against the rule that actually fires.
-- ---------------------------------------------------------------------------
select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id, start_place_id)
  values ('00000000-0000-0000-0000-000000067001', 'Half a pick', 'The Pier', now() + interval '9 days',
          true, '00000000-0000-0000-0000-00000000000a', 'gers-1')$$,
  '23514', '067: a place id with NO coordinate is refused — a pick that names a place but not a point is not a location');

select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id, latitude, longitude)
  values ('00000000-0000-0000-0000-000000067002', 'Unattributed', 'The Pier', now() + interval '9 days',
          true, '00000000-0000-0000-0000-00000000000a', 52.0, 4.0)$$,
  '23514', '067: a coordinate claiming NEITHER writer is refused — every stored coordinate has to say who produced it, or a reader has to guess how much to trust it');

select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                     start_place_id, latitude, longitude, geocode_confidence)
  values ('00000000-0000-0000-0000-000000067003', 'Both at once', 'The Pier', now() + interval '9 days',
          true, '00000000-0000-0000-0000-00000000000a', 'gers-1', 52.0, 4.0, 0.9)$$,
  '23514', '067: a row claiming BOTH writers is refused — the two arms are mutually exclusive, which is what makes presence of start_place_id readable as provenance');

select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                     start_place_id, latitude, longitude)
  values ('00000000-0000-0000-0000-000000067004', 'Past the pole', 'The Pier', now() + interval '9 days',
          true, '00000000-0000-0000-0000-00000000000a', 'gers-1', 95.0, 4.0)$$,
  '23514', '067: a PICKED latitude past the pole is refused — the range bounds apply to the picked arm too, not only to the geocoded one 051 wrote them for');

select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                     start_place_id, latitude, longitude)
  values ('00000000-0000-0000-0000-000000067005', 'Past the antimeridian', 'The Pier', now() + interval '9 days',
          true, '00000000-0000-0000-0000-00000000000a', 'gers-1', 52.0, -181.0)$$,
  '23514', '067: ... and a picked longitude past the antimeridian');

select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                     start_place_id, latitude, longitude)
  values ('00000000-0000-0000-0000-000000067006', 'A novel', 'The Pier', now() + interval '9 days',
          true, '00000000-0000-0000-0000-00000000000a', repeat('x', 513), 52.0, 4.0)$$,
  '23514', '067/069: a 513-character provider id is refused — the id is the field a client controls most directly and nothing stops a rider posting a novel into it');

select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                     latitude, longitude, geocode_confidence)
  values ('00000000-0000-0000-0000-000000067007', 'Below the floor', 'The Pier', now() + interval '9 days',
          true, '00000000-0000-0000-0000-00000000000a', 52.0, 4.0, 0.69)$$,
  '23514', '067: a geocoded confidence below the 0.70 floor is refused on INSERT too — 051''s bound survived the constraint being replaced');

select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                     latitude, longitude, geocode_confidence)
  values ('00000000-0000-0000-0000-000000067008', 'Above the ceiling', 'The Pier', now() + interval '9 days',
          true, '00000000-0000-0000-0000-00000000000a', 52.0, 4.0, 1.5)$$,
  '23514', '067: ... and one above 1.0, which is what makes a mis-scaled vendor value fail closed rather than store nonsense');

-- All three LEGAL states are accepted. Counted rather than passed to
-- assert_allowed for the INSERTs, so the row is proved to exist rather than
-- proved not to have errored.
savepoint coupling_arms_067;
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id)
values ('00000000-0000-0000-0000-000000067010', 'Nothing known', 'The layby past the second roundabout',
        now() + interval '9 days', true, '00000000-0000-0000-0000-00000000000a');
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                   start_place_id, latitude, longitude)
values ('00000000-0000-0000-0000-000000067011', 'Picked', 'Shell Pernis Werk, Rotterdam',
        now() + interval '9 days', true, '00000000-0000-0000-0000-00000000000a', 'gers-1', 51.885, 4.372);
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                   latitude, longitude, geocode_confidence)
values ('00000000-0000-0000-0000-000000067012', 'Geocoded', 'Dam Square, Amsterdam',
        now() + interval '9 days', true, '00000000-0000-0000-0000-00000000000a', 52.373, 4.893, 0.70);
select assert_eq(
  (select count(*)::int from rides where id in ('00000000-0000-0000-0000-000000067010',
     '00000000-0000-0000-0000-000000067011', '00000000-0000-0000-0000-000000067012')),
  3, '067: all three legal states land — nothing known, picked, geocoded');
-- The cast, restated at the point it can be lost. `0.70::real >= 0.70` is FALSE
-- on Postgres: `real` cannot represent 0.70 and the bare literal is `numeric`,
-- so the column is widened and a confidence at EXACTLY the stated floor would
-- violate its own constraint. The row above carries exactly 0.70, so retyping
-- the constraint without the cast turns this green assertion red.
select assert_eq((select geocode_confidence from rides where id = '00000000-0000-0000-0000-000000067012'),
  0.70::real, '067: a geocoded confidence of EXACTLY the floor is accepted — the replaced constraint kept 051''s ::real casts');
select assert_eq((select geocode_confidence is null from rides where id = '00000000-0000-0000-0000-000000067011'),
  true, '067: a PICKED coordinate carries no confidence, and that is correct rather than missing — confidence is the vendor''s evidence for a guess, and choosing a row from an index is not a guess');
rollback to savepoint coupling_arms_067;

-- The rider's own view of the same rule: `authenticated` cannot even NAME
-- geocode_confidence on an INSERT, so the mixed row is refused one layer above
-- the CHECK. 42501 rather than 23514, and the distinction matters — a test that
-- accepted "any error" would pass with the CHECK deleted.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_rejected($$
  insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                     latitude, longitude, geocode_confidence)
  values ('00000000-0000-0000-0000-000000067013', 'Rider-written geocode', 'The Pier',
          now() + interval '9 days', true, '00000000-0000-0000-0000-00000000000a', 52.0, 4.0, 0.9)$$,
  '42501', '067: a RIDER cannot write geocode_confidence at create at all — the missing INSERT grant refuses it above RLS, before the CHECK is consulted');

-- ---------------------------------------------------------------------------
-- 067.3  On UPDATE the triggers run FIRST and NORMALISE, so a mixed statement
--        is ACCEPTED and the STORED ROW is still legal. This is the design's
--        "clear or restore, never raise" rule, and it is asserted rather than
--        assumed because the obvious test — demanding 23514 from these same
--        statements — fails against a correct database.
--
--        The invariant that actually matters is about the STORED ROW, and it
--        holds by two independent mechanisms: the CHECK on INSERT, the triggers
--        on UPDATE.
-- ---------------------------------------------------------------------------
reset role;
savepoint normalisation_067;
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id)
values ('00000000-0000-0000-0000-000000067020', 'Normalise me', 'The Pier',
        now() + interval '9 days', true, '00000000-0000-0000-0000-00000000000a');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- An unpicked ride, one statement carrying BOTH markers. clear_ride_map_tiles
-- fires on the start_place_id change and NULLs the confidence.
update rides set start_place_id = 'gers-1', latitude = 52.0, longitude = 4.0, geocode_confidence = 0.9
 where id = '00000000-0000-0000-0000-000000067020';
select assert_eq(
  (select (start_place_id = 'gers-1' and latitude = 52.0 and geocode_confidence is null)
     from rides where id = '00000000-0000-0000-0000-000000067020'),
  true, '067: an UPDATE claiming BOTH writers is not refused, it is NORMALISED — the trigger drops the confidence beside a new pick, so the stored row still claims exactly one writer');

-- The same ride is now PICKED. A statement carrying an out-of-range coordinate
-- and a below-floor confidence is accepted, because protect_picked_ride_location
-- restores the picked point before the CHECK ever sees the row.
update rides set latitude = 95.0, longitude = 4.0, geocode_confidence = 0.69
 where id = '00000000-0000-0000-0000-000000067020';
select assert_eq(
  (select (latitude = 52.0 and longitude = 4.0 and geocode_confidence is null)
     from rides where id = '00000000-0000-0000-0000-000000067020'),
  true, '067: ... and a nonsense coordinate aimed at a PICKED ride is restored rather than refused, so a rider''s save is never aborted over a value the geocoder supplied');

-- With NEITHER trigger firing — an unpicked ride, no text change, no place-id
-- change — the CHECK is reachable on UPDATE and refuses, which is what stops
-- "the triggers normalise" being read as "the constraint is decorative".
update rides set start_place_id = null, latitude = null, longitude = null
 where id = '00000000-0000-0000-0000-000000067020';
select assert_rejected($$
  update rides set latitude = 95.0, longitude = 4.0, geocode_confidence = 0.9
   where id = '00000000-0000-0000-0000-000000067020'$$,
  '23514', '067: on an UNPICKED ride, where neither trigger fires, the CHECK is reached and refuses an out-of-range coordinate');
select assert_rejected($$
  update rides set latitude = 52.0, longitude = 4.0
   where id = '00000000-0000-0000-0000-000000067020'$$,
  '23514', '067: ... and refuses a coordinate claiming neither writer');
reset role;
rollback to savepoint normalisation_067;

-- ---------------------------------------------------------------------------
-- 067.4  THE SAME-STATEMENT CASE. This is the whole reason 051's trigger had to
--        be rewritten, and a test that writes the text and the pick in TWO
--        statements passes while proving nothing — it is the single statement
--        the edit form actually issues.
--
--        Measured on DEV before 067: one UPDATE setting meeting_point,
--        latitude, longitude and geocode_confidence together stored the new
--        text and THREE NULLS.
-- ---------------------------------------------------------------------------
savepoint same_statement_067;
reset role;
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id)
values ('00000000-0000-0000-0000-000000067030', 'Edit me', 'The Pier',
        now() + interval '9 days', true, '00000000-0000-0000-0000-00000000000a');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

update rides set meeting_point = 'Shell Pernis Werk, Rotterdam',
                 start_place_id = 'gers-shell', latitude = 51.885, longitude = 4.372
 where id = '00000000-0000-0000-0000-000000067030';
select assert_eq(
  (select (meeting_point = 'Shell Pernis Werk, Rotterdam' and start_place_id = 'gers-shell'
           and latitude = 51.885 and longitude = 4.372 and geocode_confidence is null)
     from rides where id = '00000000-0000-0000-0000-000000067030'),
  true, '067: new text and a NEW pick in ONE statement keeps the pick — 051''s BEFORE trigger discarded it, which made the picked edit path impossible');

-- The tiles go even on the arm that keeps the coordinate: they were rendered
-- for the PREVIOUS point.
reset role;
update rides set map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-00000000beef.jpg'
 where id = '00000000-0000-0000-0000-000000067030';
set role authenticated;
update rides set meeting_point = 'Shell Pernis Werk, Rotterdam (by the pumps)',
                 start_place_id = 'gers-other', latitude = 51.0, longitude = 4.0
 where id = '00000000-0000-0000-0000-000000067030';
select assert_eq(
  (select (start_place_id = 'gers-other' and map_card_path is null)
     from rides where id = '00000000-0000-0000-0000-000000067030'),
  true, '067: ... and both tile paths go with it, because they are a picture of the point the rider just replaced');

-- Text ALONE clears everything. The client sending nothing for the location
-- columns is indistinguishable from it sending the stored values, so the proxy
-- has to fail in the clearing direction — and this is that direction.
update rides set meeting_point = 'Somewhere else entirely'
 where id = '00000000-0000-0000-0000-000000067030';
select assert_eq(
  (select (start_place_id is null and latitude is null and longitude is null
           and geocode_confidence is null and map_card_path is null and map_detail_path is null)
     from rides where id = '00000000-0000-0000-0000-000000067030'),
  true, '067: changing the text with no new pick clears the whole location — the pin is no longer known to describe what the text says');

-- A hand-rolled client REPEATING the row's stored place id beside new text is
-- cleared too, and must be: `NEW` carries the old value for an omitted column,
-- so an omission and a repetition are the same input to a BEFORE trigger.
update rides set meeting_point = 'Repeat Corner', start_place_id = 'gers-repeat',
                 latitude = 50.0, longitude = 3.0
 where id = '00000000-0000-0000-0000-000000067030';
update rides set meeting_point = 'Repeat Corner Two', start_place_id = 'gers-repeat',
                 latitude = 50.0, longitude = 3.0
 where id = '00000000-0000-0000-0000-000000067030';
select assert_eq(
  (select (start_place_id is null and latitude is null)
     from rides where id = '00000000-0000-0000-0000-000000067030'),
  true, '067: a client repeating the STORED place id beside new text clears anyway — an omission and a repetition are the same input to a BEFORE trigger, and the proxy fails in the clearing direction');

-- Re-picking the SAME place after it was cleared is kept, because OLD is now
-- NULL and NEW is the id, so they are distinct.
update rides set meeting_point = 'Repeat Corner', start_place_id = 'gers-repeat',
                 latitude = 50.0, longitude = 3.0
 where id = '00000000-0000-0000-0000-000000067030';
select assert_eq(
  (select (start_place_id = 'gers-repeat' and latitude = 50.0)
     from rides where id = '00000000-0000-0000-0000-000000067030'),
  true, '067: re-picking the SAME place after clearing it is kept — OLD is NULL and NEW is the id, so IS DISTINCT FROM says yes');

-- The organizer may always REMOVE their own pin, text untouched.
update rides set start_place_id = null, latitude = null, longitude = null
 where id = '00000000-0000-0000-0000-000000067030';
select assert_eq(
  (select (meeting_point = 'Repeat Corner' and start_place_id is null and latitude is null)
     from rides where id = '00000000-0000-0000-0000-000000067030'),
  true, '067: an organizer can clear the pick without touching the text — precedence protects a pick from being MOVED, never from being removed by its owner');
reset role;
rollback to savepoint same_statement_067;

-- ---------------------------------------------------------------------------
-- 067.5  PRECEDENCE. A geocode-shaped UPDATE against a picked ride must leave
--        the picked coordinate, must leave the confidence NULL, must clear both
--        tile paths, and MUST NOT RAISE — the write it guards is the geocoder
--        enriching a ride the rider is already saving, and a raise there aborts
--        a write the rider asked for over a value they did not supply.
--
--        Asserted as the STORED OUTCOME of a statement issued as the caller,
--        never as the behaviour of the Edge Function that would normally issue
--        it — the function is not reachable from this suite and 031 is the
--        standing lesson about asserting a function instead of the rule.
-- ---------------------------------------------------------------------------
savepoint precedence_067;
reset role;
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                   start_place_id, latitude, longitude)
values ('00000000-0000-0000-0000-000000067040', 'Picked ride', 'Shell Pernis Werk, Rotterdam',
        now() + interval '9 days', true, '00000000-0000-0000-0000-00000000000a', 'gers-shell', 51.885, 4.372);
update rides set map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000067ca.jpg',
                 map_detail_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000067de.jpg'
 where id = '00000000-0000-0000-0000-000000067040';
-- A tile rendered FOR THE STORED PICK is accepted, which is what lets the
-- redeployed Edge Function render a picked ride without a further exception.
select assert_eq(
  (select (map_card_path is not null and latitude = 51.885)
     from rides where id = '00000000-0000-0000-0000-000000067040'),
  true, '067: a tile written for the STORED coordinate is accepted — the UPDATE leaves latitude and longitude equal, so the precedence trigger never fires');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
update rides set latitude = 52.37, longitude = 4.89, geocode_confidence = 0.95
 where id = '00000000-0000-0000-0000-000000067040';
select assert_eq(
  (select (latitude = 51.885 and longitude = 4.372) from rides where id = '00000000-0000-0000-0000-000000067040'),
  true, '067: a geocode-shaped UPDATE does NOT move a picked coordinate — an exact point would otherwise be replaced by a vendor''s approximation of the same words, silently, with both states looking identical from a screen');
select assert_eq(
  (select geocode_confidence is null from rides where id = '00000000-0000-0000-0000-000000067040'),
  true, '067: ... and the confidence it tried to write is forced back to NULL, so the row cannot claim a vendor produced a value the vendor did not');
select assert_eq(
  (select (map_card_path is null and map_detail_path is null)
     from rides where id = '00000000-0000-0000-0000-000000067040'),
  true, '067: ... and both tile paths are cleared, because a tile rendered for the coordinate just rejected is a picture of the wrong place and 051''s one-directional CHECK would happily keep it');
select assert_eq(
  (select count(*)::int from rides where id = '00000000-0000-0000-0000-000000067040'),
  1, '067: ... and the statement did NOT raise — the ride is still there, which is the half a rejected-write test cannot show');
reset role;
rollback to savepoint precedence_067;

-- ---------------------------------------------------------------------------
-- 067.6  REACH, one assertion per role. 067 adds NO policy, so what is asserted
--        is that the existing ones already govern the new column — and, in the
--        one direction that could go wrong, that a widened GRANT did not reach
--        past a policy that still refuses.
-- ---------------------------------------------------------------------------
savepoint reach_067;
reset role;
-- d1 sits in the PRIVATE club c1, organised by 000a. 000b is a member of c1 and
-- is promoted to admin here, so "a club admin cannot move someone else's pick"
-- is tested against a real admin rather than against a plain member.
update club_members set role = 'admin'
 where club_id = '00000000-0000-0000-0000-0000000000c1'
   and user_id = '00000000-0000-0000-0000-00000000000b';
update rides set meeting_point = 'The Depot', start_place_id = 'gers-depot',
                 latitude = 51.5, longitude = 4.5
 where id = '00000000-0000-0000-0000-0000000000d1';
-- A public ride organised by the BLOCKER, so the block can be asserted with the
-- two riders exchanged: d4 already covers the direction organised by the
-- blocked rider, and the `blocks` row is directional while the effect is not.
insert into rides (id, title, meeting_point, departure_at, is_public, organizer_id,
                   start_place_id, latitude, longitude)
values ('00000000-0000-0000-0000-000000067050', 'Blocker Run', 'The Yard',
        now() + interval '9 days', true, '00000000-0000-0000-0000-00000000001a', 'gers-yard', 51.1, 4.1);
update rides set start_place_id = 'gers-wall', latitude = 51.2, longitude = 4.2
 where id = '00000000-0000-0000-0000-0000000000d4';
-- A crew row for the outsider on the private club's ride. Crew membership is
-- NOT an arm of the rides SELECT policy and this change does not add one.
insert into ride_members (ride_id, user_id, status)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000c', 'going')
on conflict do nothing;

set role authenticated;

-- ORGANIZER: may set, change and clear the pick on their own ride.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
savepoint organizer_writes_067;
update rides set start_place_id = 'gers-new', latitude = 51.9, longitude = 4.9
 where id = '00000000-0000-0000-0000-0000000000d1';
select assert_eq(
  (select count(*)::int from rides
    where id = '00000000-0000-0000-0000-0000000000d1' and start_place_id = 'gers-new'),
  1, '067: the ORGANIZER can move the pick on their own ride');
rollback to savepoint organizer_writes_067;

-- CLUB ADMIN: may not. rides UPDATE is organizer-scoped and 067 adds no arm to
-- it, so the statement touches zero rows SILENTLY — asserted by counting,
-- because a filtered UPDATE raises nothing.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
savepoint admin_writes_067;
update rides set start_place_id = 'gers-admin', latitude = 1.0, longitude = 1.0
 where id = '00000000-0000-0000-0000-0000000000d1';
select assert_eq(
  (select count(*)::int from rides
    where id = '00000000-0000-0000-0000-0000000000d1' and start_place_id = 'gers-admin'),
  0, '067: a club ADMIN cannot move a pick on a ride they do not organise — a location an admin can move is a ride whose crew arrives somewhere the organizer never chose');
rollback to savepoint admin_writes_067;

-- CLUB MEMBER: reads the coordinate exactly as they read the ride.
select assert_eq(
  (select start_place_id from rides where id = '00000000-0000-0000-0000-0000000000d1'),
  'gers-depot', '067: a member of the private club READS the ride''s pick, because the columns live on the row and 022''s SELECT policy already admits them');

-- NON-MEMBER of the private club: zero rows, coordinate included. The crew row
-- inserted above is deliberately theirs, so this also proves crew membership
-- alone confers nothing.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq(
  (select count(*)::int from rides
    where id = '00000000-0000-0000-0000-0000000000d1' and start_place_id is not null),
  0, '067: a NON-MEMBER of the private club reads zero rows for that ride — the coordinate is out of reach because the ROW is, not because anything filters a column');
-- The crew row is counted as the OWNER, deliberately. Read as 000c it is zero
-- — `ride_members`'s own SELECT policy is scoped to rides the caller can read,
-- so an outsider cannot see even their own crew row on a ride they cannot
-- reach. Counting it as the rider would therefore have proved the fixture
-- missing rather than the policy correct, which is the trap: the assertion
-- would have gone green the day somebody deleted the fixture.
reset role;
select assert_eq(
  (select count(*)::int from ride_members
    where ride_id = '00000000-0000-0000-0000-0000000000d1'
      and user_id = '00000000-0000-0000-0000-00000000000c'),
  1, '067: ... and the crew row they hold on that ride really exists, so the zero above is the rides SELECT policy refusing them and not a missing fixture — crew membership is NOT an arm of that policy and 067 did not add one');
set role authenticated;

-- BLOCKED, both directions. The `blocks` row is directional; the effect is not.
select set_config('test.uid', '00000000-0000-0000-0000-00000000001a', false);
select assert_eq(
  (select count(*)::int from rides
    where id = '00000000-0000-0000-0000-0000000000d4' and start_place_id is not null),
  0, '067: a blocker reads no coordinate on a ride organised by the rider they blocked');
select set_config('test.uid', '00000000-0000-0000-0000-00000000001b', false);
select assert_eq(
  (select count(*)::int from rides
    where id = '00000000-0000-0000-0000-000000067050' and start_place_id is not null),
  0, '067: ... and the blocked rider reads none on a ride organised by the blocker — symmetric in effect, and enforced on the ROW rather than in a screen');

-- ANON reaches nothing at all.
reset role;
set role anon;
-- Refused at the GRANT, not filtered to zero rows: 007 revoked anon's table
-- grant on `rides` outright, so the read raises 42501 before any policy is
-- consulted. Asserted as a denial rather than as a count, because a count
-- written here would error rather than return 0 and the assertion would fail
-- for the right reason with the wrong message.
select assert_denied($$select count(*) from rides where start_place_id is not null$$,
  '067: a signed-out visitor cannot read a ride''s pick at all — decision #1, and 067 adds no grant and no policy that reaches anon');
select assert_denied($$
  update rides set start_place_id = 'gers-anon' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '067: ... and writes none either');
reset role;
rollback to savepoint reach_067;

-- ---------------------------------------------------------------------------
-- 067.7  THE BULK UPDATE. The clearing trigger's WHEN now has two arms, and an
--        unscoped version would wipe every location in a club the moment it
--        turned private — a bulk data loss with a plausible-looking cause,
--        discovered weeks later. propagate_club_privacy_to_rides touches
--        neither meeting_point nor start_place_id, so neither arm is true.
-- ---------------------------------------------------------------------------
savepoint bulk_update_067;
reset role;
insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id,
                   start_place_id, latitude, longitude)
values ('00000000-0000-0000-0000-000000067060', 'Club Run', 'The Garage', now() + interval '9 days',
        true, '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a',
        'gers-garage', 52.6, 4.4);
update rides set map_card_path = 'ride-maps/00000000-0000-0000-0000-00000000000a/aaaaaaaa-0000-4000-8000-0000000067bc.jpg'
 where id = '00000000-0000-0000-0000-000000067060';
update clubs set is_public = false where id = '00000000-0000-0000-0000-0000000000c2';
select assert_eq(
  (select is_public from rides where id = '00000000-0000-0000-0000-000000067060'),
  false, '067: (the club going private did reach the ride, so the next assertion is about the trigger and not about a no-op)');
select assert_eq(
  (select (start_place_id = 'gers-garage' and latitude = 52.6 and map_card_path is not null)
     from rides where id = '00000000-0000-0000-0000-000000067060'),
  true, '067: a club turning private does NOT clear its rides'' picks or tiles — the audience narrowed, and neither the meeting point nor the place id changed in that statement');
rollback to savepoint bulk_update_067;

-- ---------------------------------------------------------------------------
-- 067.8  NO POLICY MOVED, and no foreign key appeared. 067 is a
--        column-grants-constraints-and-triggers change; if a rides policy now
--        mentions the new column it has done something it does not describe.
--        Counted rather than hashed, for the reason 064.10 gives.
-- ---------------------------------------------------------------------------
reset role;
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'rides'),
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'rides'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%start_place%'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%latitude%'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%longitude%'),
  '067: no rides policy mentions the start location — the audience of where a ride starts IS the audience of the ride, and adding an arm for it would be inventing a second predicate over the same row');

select assert_eq(
  -- Keyed on the COLUMN rather than on `places`, for the reason the matching
  -- `clubs` assertion gives: `070` dropped that table, so the old form asked a
  -- question the schema could no longer answer wrong.
  (select count(*)::int from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.rides'::regclass and c.contype = 'f'
     and a.attname = 'start_place_id'),
  0, '067/070: rides.start_place_id carries NO foreign key to anything — provenance, and a dangling id is a normal state');

-- The old constraint is gone BY NAME, which anything grepping for it must be
-- updated for — this assertion is what makes that visible rather than silent.
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.rides'::regclass and conname = 'rides_geocode_coupling'),
  0, '067: rides_geocode_coupling no longer exists — 067 replaced it with rides_location_coupling, because a picked coordinate carries no confidence and the old constraint required one');
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.rides'::regclass and conname = 'rides_location_coupling'),
  1, '067: ... and rides_location_coupling is what stands in its place');

-- Both new/rewritten functions are SECURITY INVOKER with the pinned empty
-- search_path. 022 shipped exactly this clause missing between the repo and the
-- database, so it is asserted rather than read off the file.
select assert_eq(
  (select bool_or(prosecdef) from pg_proc
    where proname in ('clear_ride_map_tiles', 'protect_picked_ride_location')),
  false, '067: neither trigger function is SECURITY DEFINER — they run as the rider, touch only NEW, and adding a definer here would be a privilege nobody needs');
select assert_eq(
  (select bool_and(proconfig[1] = 'search_path=""') from pg_proc
    where proname in ('clear_ride_map_tiles', 'protect_picked_ride_location')),
  true, '067: ... and both carry the pinned empty search_path every function in this repo does');
select assert_eq(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'rides' and not t.tgisinternal),
  5, '067: rides carries five non-internal triggers — 051 took it from three to four and 067 adds the precedence one');

rollback to savepoint ride_start_location_067;

reset role;

\echo ''
\echo '# The feed watermark runs on the server''s clock, and your own postcard is not news (068)'

-- ===========================================================================
-- 068. Two defects in 015, both named by 061 and neither fixed there.
-- ===========================================================================
--
-- Self-contained fixtures, for 061's reason: this section needs content placed
-- on either side of a watermark, and after 068 the watermark is the one thing
-- that cannot be moved — the trigger stamps `now()` for the table owner exactly
-- as it does for `authenticated`. So the POSTCARDS and the RIDE carry explicit
-- `created_at` values, written as the owner because 044 and 045 withhold those
-- columns' grants from the client roles.
--
-- The riders, and what each one is for:
--   6801  the reader. Member of both clubs, authors the postcard that must NOT
--         badge them, and organizes the ride that deliberately still does
--   6802  the other member. Authors the postcard that MUST badge 6801, and is
--         the rider for whom 6801's postcard is news — which is what stops the
--         exclusion assertion from passing merely because nothing is unread
--
-- The two clubs are split by content type on purpose. `club_unread_counts()`
-- returns one number per club — postcards plus rides — so a club holding both
-- could not tell "the postcard was excluded" from "the ride was excluded", and
-- the rides half is the arm 068 deliberately did NOT change.
savepoint feed_watermark_068;

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000068001', 'watermarkreader@example.com'),
  ('00000000-0000-0000-0000-000000068002', 'watermarkauthor@example.com');
reset role;

update profiles set username = 'watermarkreader', location = 'Utrecht',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000068001';
update profiles set username = 'watermarkauthor', location = 'Tilburg',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000068002';

-- 68c1 — postcards only.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000680c1', 'Watermark Postcards MC', false,
   '00000000-0000-0000-0000-000000068001');
insert into club_members (club_id, user_id, role, joined_at) values
  ('00000000-0000-0000-0000-0000000680c1', '00000000-0000-0000-0000-000000068001',
   'owner', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000680c1', '00000000-0000-0000-0000-000000068002',
   'member', now() - interval '2 days');

-- 68c2 — rides only.
insert into clubs (id, name, is_public, owner_id) values
  ('00000000-0000-0000-0000-0000000680c2', 'Watermark Rides MC', false,
   '00000000-0000-0000-0000-000000068001');
insert into club_members (club_id, user_id, role, joined_at) values
  ('00000000-0000-0000-0000-0000000680c2', '00000000-0000-0000-0000-000000068001',
   'owner', now() - interval '2 days');

-- Both postcards sit AFTER `now()`, which is where every watermark this suite
-- can write lands. 68e1 is the reader's own; 68e2 is the other member's.
insert into postcards (id, author_id, club_id, image_path, caption, created_at) values
  ('00000000-0000-0000-0000-0000000680e1', '00000000-0000-0000-0000-000000068001',
   '00000000-0000-0000-0000-0000000680c1',
   'postcards/00000000-0000-0000-0000-000000068001/680e1000-0000-4000-8000-0000000680e1.jpg',
   'My own postcard', now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000680e2', '00000000-0000-0000-0000-000000068002',
   '00000000-0000-0000-0000-0000000680c1',
   'postcards/00000000-0000-0000-0000-000000068002/680e2000-0000-4000-8000-0000000680e2.jpg',
   'Somebody else''s postcard', now() + interval '2 hours');

insert into rides (id, title, meeting_point, departure_at, is_public, club_id, organizer_id, created_at) values
  ('00000000-0000-0000-0000-0000000680d1', 'Watermark Run', 'The Quay',
   now() + interval '7 days', false, '00000000-0000-0000-0000-0000000680c2',
   '00000000-0000-0000-0000-000000068001', now() + interval '1 hour');

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the 068 assertions run as authenticated, or they prove nothing');

-- ---------------------------------------------------------------------------
-- 068.1  The trigger owns the clock, on both arms
-- ---------------------------------------------------------------------------
-- Run for real rather than through `assert_allowed`, which unwinds its own
-- subtransaction before the value could be read back. The insert SUCCEEDING is
-- itself part of the proof: the column grant is deliberately left table-wide
-- (068 §1), so what makes the value true is the trigger and not a refusal at
-- the door.
select set_config('test.uid', '00000000-0000-0000-0000-000000068001', false);

insert into feed_reads (user_id, club_id, last_seen_at)
values ('00000000-0000-0000-0000-000000068001', '00000000-0000-0000-0000-0000000680c1',
        timestamptz '3000-01-01 00:00:00+00');
select assert_eq(
  (select last_seen_at from feed_reads
    where user_id = '00000000-0000-0000-0000-000000068001'
      and club_id = '00000000-0000-0000-0000-0000000680c1') = now(),
  true, '068: a forged last_seen_at is overwritten with server time on INSERT — the device no longer owns one side of the comparison');

update feed_reads set last_seen_at = timestamptz '3000-01-01 00:00:00+00'
 where user_id = '00000000-0000-0000-0000-000000068001'
   and club_id = '00000000-0000-0000-0000-0000000680c1';
select assert_eq(
  (select last_seen_at from feed_reads
    where user_id = '00000000-0000-0000-0000-000000068001'
      and club_id = '00000000-0000-0000-0000-0000000680c1') = now(),
  true, '068: ... and on UPDATE too, which is the arm the upsert reaches on every visit after the first');

-- The statement PostgREST compiles `.upsert({…}, {onConflict:"user_id,club_id"})`
-- to, written out. The suite speaks SQL rather than HTTP, so this pins the half
-- of the mechanism the database owns — that the ON CONFLICT arm reaches the
-- trigger — and cannot pin the half PostgREST owns, which is that the column
-- stays in the SET list because `markClubSeen` keeps it in the request body.
insert into feed_reads (user_id, club_id, last_seen_at)
values ('00000000-0000-0000-0000-000000068001', '00000000-0000-0000-0000-0000000680c1',
        timestamptz '3000-01-01 00:00:00+00')
on conflict (user_id, club_id) do update
  set user_id = excluded.user_id,
      club_id = excluded.club_id,
      last_seen_at = excluded.last_seen_at;
select assert_eq(
  (select last_seen_at from feed_reads
    where user_id = '00000000-0000-0000-0000-000000068001'
      and club_id = '00000000-0000-0000-0000-0000000680c1') = now(),
  true, '068: ... including through the ON CONFLICT DO UPDATE arm itself, which is the statement the client actually sends');

-- `markFeedSeen` writes the app-wide row and sends the same forged value. The
-- trigger is on the table rather than on a predicate, so this is a check that
-- the NULL audience was not somehow special-cased.
insert into feed_reads (user_id, club_id, last_seen_at)
values ('00000000-0000-0000-0000-000000068001', null, timestamptz '3000-01-01 00:00:00+00');
select assert_eq(
  (select last_seen_at from feed_reads
    where user_id = '00000000-0000-0000-0000-000000068001' and club_id is null) = now(),
  true, '068: the app-wide watermark is stamped identically — markFeedSeen sends the same forged value markClubSeen does');

-- 015 gave the column `default now()` and the defect shipped anyway: a default
-- applies only when the column is OMITTED, and both callers name it. The
-- default is still there and is still not what makes the value true, which is
-- the trap most likely to be re-derived from reading the column definition.
select assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'feed_reads'
      and column_name = 'last_seen_at' and column_default like 'now()%'),
  1, '068: last_seen_at still carries 015''s DEFAULT — which is not what defends it, because a default applies only when the column is omitted');

-- ---------------------------------------------------------------------------
-- 068.2  Your own postcard is not news
-- ---------------------------------------------------------------------------
-- 6801 holds a watermark at `now()`. Both postcards in 68c1 are newer than it;
-- one is theirs and one is not.
select assert_eq(
  (select unread from club_unread_counts()
    where club_id = '00000000-0000-0000-0000-0000000680c1'),
  1, '068: a club badge counts the OTHER member''s postcard and only it — two postcards are newer than the watermark and one of them is the reader''s own');

-- Isolated, so nothing else can hold the number above zero and make a broken
-- exclusion look correct: the other member's postcard is moved behind the
-- watermark, leaving the reader's own as the only thing newer than it.
reset role;
update postcards set created_at = now() - interval '1 minute'
 where id = '00000000-0000-0000-0000-0000000680e2';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000068001', false);
select assert_eq(
  (select count(*)::int from postcards
    where id = '00000000-0000-0000-0000-0000000680e1' and created_at > now()), 1,
  '068: the rider''s own postcard is still there and still newer than their watermark ...');
select assert_eq(
  (select unread from club_unread_counts()
    where club_id = '00000000-0000-0000-0000-0000000680c1'),
  0, '068: ... and does not badge their own club — the author_id <> auth.uid() arm 015 was missing, reachable every time because a postcard is authored from /postcards/new rather than from inside a club');

-- ... and the same postcard DOES badge the other member, which is what stops
-- the assertion above from passing merely because nothing was unread. 6802
-- holds no watermark, so their comparison point is `joined_at` — two days back,
-- which every postcard here is newer than. Their OWN postcard is excluded by
-- the same arm, so the answer is 1 rather than 2.
select set_config('test.uid', '00000000-0000-0000-0000-000000068002', false);
select assert_eq(
  (select unread from club_unread_counts()
    where club_id = '00000000-0000-0000-0000-0000000680c1'),
  1, '068: the same postcard DOES badge another member, so the exclusion above is not vacuous — and their own is excluded from that number by the same arm');

-- ---------------------------------------------------------------------------
-- 068.3  The rides arm is deliberately NOT given the same exclusion
-- ---------------------------------------------------------------------------
-- 68d1 is 6801's own ride in 68c2, newer than their watermark there. This is
-- the one assertion in the section that pins a decision rather than a fix: 068
-- §2 records why `organizer_id <> auth.uid()` was not added — creating a ride
-- fans out to the club, so the organizer's own ride badging their own club may
-- well be wanted, and PD-253 names only the postcard arm. A session that adds
-- the exclusion must change this line, which is the point of it.
select set_config('test.uid', '00000000-0000-0000-0000-000000068001', false);
insert into feed_reads (user_id, club_id)
values ('00000000-0000-0000-0000-000000068001', '00000000-0000-0000-0000-0000000680c2');
select assert_eq(
  (select unread from club_unread_counts()
    where club_id = '00000000-0000-0000-0000-0000000680c2'),
  1, '068: a rider''s OWN ride still badges their own club — the rides arm keeps no organizer exclusion, deliberately (068 §2)');

-- ---------------------------------------------------------------------------
-- 068.4  Shape: what 068 must NOT have changed
-- ---------------------------------------------------------------------------
select assert_eq((select prosecdef from pg_proc where proname = 'stamp_feed_read'),
  false, '068: stamp_feed_read needs no elevated rights — it reads nothing and writes nothing but NEW');
select assert_eq(
  (select proconfig[1] from pg_proc where proname = 'stamp_feed_read'),
  'search_path=""', '068: ... and carries the pinned empty search_path every function in this repo does');
select assert_eq(
  has_function_privilege('authenticated', 'public.stamp_feed_read()', 'execute'),
  false, '068: no client role can call the trigger function directly — Postgres checks EXECUTE at CREATE TRIGGER time, so the revoke is free');

-- Both arms, head-on. `tgtype` bit 2 is BEFORE, bit 4 INSERT, bit 16 UPDATE. A
-- BEFORE INSERT trigger alone would impose the value on the first visit to an
-- audience and keep the client's on every visit after — it works on fresh rows
-- and drifts in use, and an INSERT-only assertion passes against it.
select assert_eq(
  (select (tgtype & 4 > 0)::int + (tgtype & 16 > 0)::int + (tgtype & 2 > 0)::int
     from pg_trigger where tgname = 'stamp_feed_read' and not tgisinternal),
  3, '068: the stamp trigger is BEFORE and fires on both INSERT and UPDATE');

-- The rewrite is a `create or replace`, which preserves the ACL — asserted
-- rather than assumed, because "preserved" is a property of the statement and
-- is invisible in the migration file.
select assert_eq((select prosecdef from pg_proc where proname = 'club_unread_counts'),
  false, '068: club_unread_counts is still SECURITY INVOKER after the rewrite, so blocks and hides still decide what it counts');
select assert_eq(
  has_function_privilege('authenticated', 'public.club_unread_counts()', 'execute'),
  true, '068: ... the replace preserved 015''s execute grant to authenticated ...');
select assert_eq(
  has_function_privilege('anon', 'public.club_unread_counts()', 'execute'),
  false, '068: ... and anon still cannot call it — decision #1');

-- 068 adds a trigger, not a surface. Scoped to the grantee, per 015's own
-- footer: the unscoped DELETE-grant count reads 2 against a correct database.
select assert_eq((select count(*)::int from pg_policies where tablename = 'feed_reads'),
  3, '068: feed_reads still carries exactly three policies — select, insert, update');
select assert_eq(has_table_privilege('authenticated', 'public.feed_reads', 'delete'),
  false, '068: ... and authenticated still holds no DELETE grant, so a watermark still cannot be reset');
select assert_eq(
  has_column_privilege('authenticated', 'public.feed_reads', 'last_seen_at', 'update'),
  true, '068: ... and KEEPS the UPDATE grant on last_seen_at, which 068 §1 requires — the column must stay nameable so the upsert body carries it into the ON CONFLICT SET list');

rollback to savepoint feed_watermark_068;

reset role;

-- Back to the identity every later block assumes. Nothing follows this today,
-- which is exactly why it is set: the next block appended here would otherwise
-- inherit …000b and read as a policy defect.
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);


-- ===========================================================================
-- 069 — the place-search spend ledger (PD-273)
-- ===========================================================================
-- `051`'s ledger section is the model, because `069` copies `051`'s shape. What
-- differs is the subject — a rider rather than a ride — and that there are
-- THREE ceilings in one policy rather than one.
--
-- The gate-trigger count and the widened place_id bounds are asserted in their
-- own sections above, beside the numbers they moved.

\echo ''
\echo '# 069: the place-search ledger is append-only and own-row'

-- The catalogue and grant assertions run as the owner; everything that depends
-- on a POLICY needs `set role authenticated` below, because the owner bypasses
-- RLS and every one of those assertions would pass while testing nothing.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

select assert_eq((select relrowsecurity from pg_class where oid = 'public.place_search_attempts'::regclass),
  true, '069: RLS is on for place_search_attempts');

-- Both halves of the refusal, asserted separately: RLS needs a table grant AND
-- a permitting policy, so the missing grant is the outer gate and the missing
-- policy the inner one. Absence is the enforcement here, which is exactly what
-- a well-meaning `grant all` puts back.
select assert_eq(has_table_privilege('authenticated', 'public.place_search_attempts', 'insert'),
  true, '069: authenticated holds the INSERT grant');
select assert_eq(has_table_privilege('authenticated', 'public.place_search_attempts', 'select'),
  true, '069: ... and SELECT, for its own rows');
select assert_eq(has_table_privilege('authenticated', 'public.place_search_attempts', 'update'),
  false, '069: ... and NO UPDATE grant — a rider must not be able to rewrite their own spend');
select assert_eq(has_table_privilege('authenticated', 'public.place_search_attempts', 'delete'),
  false, '069: ... and NO DELETE grant — erasing spend is the one direction the ceiling exists to block');
select assert_eq(has_table_privilege('anon', 'public.place_search_attempts', 'select'),
  false, '069: anon reaches nothing — decision #1');

-- The inner gate. `051`'s lesson: a grant check alone passes against a table
-- with a permissive policy nobody meant to write.
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'place_search_attempts'),
  2, '069: exactly two policies on the ledger');
select assert_eq(
  (select string_agg(cmd, ',' order by cmd)::text from pg_policies
    where schemaname = 'public' and tablename = 'place_search_attempts'),
  'INSERT,SELECT', '069: ... and they are exactly INSERT and SELECT — no UPDATE or DELETE policy either');

-- The counters. Named by ROLE rather than called, which is `031`'s shape: the
-- suite runs as the table owner, for whom neither the grant barrier nor the
-- schema barrier exists, so calling the function proves nothing about who can.
select assert_eq(
  has_function_privilege('authenticated',
    'private.place_searches_in_window(uuid, interval)', 'execute'),
  true, '069: authenticated can execute the per-rider counter — the policy is evaluated AS that role, so without this every insert fails');
select assert_eq(
  has_function_privilege('authenticated', 'private.place_searches_today()', 'execute'),
  true, '069: ... and the application-wide counter');
select assert_eq(
  has_function_privilege('anon', 'private.place_searches_in_window(uuid, interval)', 'execute'),
  false, '069: anon can execute neither counter');
select assert_eq(
  has_function_privilege('anon', 'private.place_searches_today()', 'execute'),
  false, '069: ... nor the application-wide one');

-- `service_role` reaches the counters through neither door, and the door that
-- matters is EXECUTE rather than USAGE. It DOES hold USAGE on `private` —
-- measured on both projects, `private`'s ACL is
-- {postgres=UC/postgres,service_role=U/postgres} — so an assertion written
-- against the schema grant would read a correct database as drift, which is the
-- error `031`'s finding gets remembered as.
select assert_eq(
  has_function_privilege('service_role', 'private.place_searches_today()', 'execute'),
  false, '069: service_role cannot execute the counters — the revoke from public is what stops it, NOT a missing USAGE on private, which it holds');

-- `022`'s lesson: this exact clause is the one that goes silently missing
-- between the repo and the database, and without it the counters are invoker
-- and the policy recurses (`052`).
select assert_eq(
  (select bool_and(prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'place_searches%'),
  true, '069: both counters really are security definer — without it the INSERT policy raises 42P17, which is 051''s bug');
select assert_eq(
  -- `proconfig` stores the pin as the literal search_path="" — matching on the
  -- bare `search_path=` reads false against a correct database, which is how
  -- this assertion first failed.
  (select bool_and(proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'place_searches%'),
  true, '069: ... and both pin an empty search_path');

-- The subject is forced to the caller, so one rider cannot spend another's
-- allowance. This is the conjunct the Edge Function's "takes no user id" rule
-- rests on: even a function talked into naming someone else is refused here.
set role authenticated;

select assert_rejected(
  $$insert into place_search_attempts (user_id)
    values ('00000000-0000-0000-0000-00000000000b')$$,
  '42501', '069: a rider cannot record a search against ANOTHER rider — the ceiling is per rider and this is what makes that true');

select assert_allowed(
  $$insert into place_search_attempts (user_id)
    values ('00000000-0000-0000-0000-00000000000a')$$,
  '069: ... and can record one against themselves');

-- Server-stamped time. A client that can backdate a row out of the rolling
-- window has no ceiling at all — 034's ruling, applied here as 051 applied it.
-- The grant is table-level, so the column is nameable and the TRIGGER is the
-- thing observed: the value is REPLACED rather than the statement refused.
insert into place_search_attempts (id, user_id, attempted_at)
values ('00000000-0000-0000-0000-000000069001',
        '00000000-0000-0000-0000-00000000000a', now() - interval '30 days');
select assert_eq(
  (select attempted_at > now() - interval '1 minute' from place_search_attempts
    where id = '00000000-0000-0000-0000-000000069001'),
  true, '069: a backdated attempted_at is REPLACED with server time rather than refused — the ceiling is meaningless if a rider can insert themselves out of the window');

-- Own rows only. The ledger holds no term, but a wider SELECT would still make
-- it an activity oracle: when a named rider was looking up places.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq(
  (select count(*)::int from place_search_attempts
    where user_id = '00000000-0000-0000-0000-00000000000a'),
  0, '069: a rider cannot read another rider''s search ledger');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq(
  (select count(*)::int from place_search_attempts
    where user_id = '00000000-0000-0000-0000-00000000000a') > 0,
  true, '069: ... and can read their own');

-- The ceiling actually fires, which is the assertion `051` could not make
-- because its subquery form raised 42P17 instead.
--
-- ** Top up to the ceiling by MEASURING what is there, not by counting the
-- inserts above. ** `assert_allowed` runs its statement inside a savepoint and
-- rolls it back, so a hand-written total is one row out and the ceiling test
-- then passes for the wrong reason — it did, on the first pass here.
reset role;
insert into place_search_attempts (user_id)
select '00000000-0000-0000-0000-00000000000a'
  from generate_series(1, 20 - (select count(*)::int from place_search_attempts
                                 where user_id = '00000000-0000-0000-0000-00000000000a'
                                   and attempted_at > now() - interval '1 hour'));
select assert_eq(
  private.place_searches_in_window('00000000-0000-0000-0000-00000000000a', interval '1 hour'),
  20, '069: the fixture really is at the hourly ceiling — without this the refusal below could pass because the rider is merely over some other limit');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

select assert_rejected(
  $$insert into place_search_attempts (user_id)
    values ('00000000-0000-0000-0000-00000000000a')$$,
  '42501', '069: the hourly ceiling refuses the 21st attempt in the window — the whole point of the ledger, and 051 shipped a form that could never reach this');

reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);


\echo ''
\echo '# 072/073: a postcard''s location is a place the rider NAMES, and no more than that'

-- ===========================================================================
-- 072/073.  postcards.taken_place_name, the replaced coupling and the RENAMED
--       rounding CHECK.
--
--       **Read as one unit.** `072` added `taken_place_name` and
--       `taken_place_id`; `073` dropped the provider id — it resolves through a
--       details lookup to the picked feature's exact geometry, so beside a
--       deliberately 2dp-rounded coordinate it hands back the precision the
--       rounding exists to remove — and corrected the coupling, which `072`
--       wrote with a bare `=` against a nullable marker and which therefore
--       ACCEPTED the half-populated rows it was written to refuse (a CHECK
--       treats NULL as satisfied). Assertions are labelled by the file that
--       owns the rule, not by the file that last touched the line.
--
--       The privacy rule neither file can test, stated so nobody reads the
--       absence as coverage: **the choice is made in the BROWSER, before the
--       request is built**, and a rider who picks Hide sends no location
--       columns at all. By the time a row exists that decision is already made.
--       What the database CAN own, and what is asserted below, is everything
--       that follows — which columns may ever be written, that a COARSE marker
--       really is coarse whatever produced it, that a name/coordinate/marker
--       combination the design does not list is refused, and that nobody can
--       edit any of it afterwards.
--
--       Grants are asserted BY ROLE with has_column_privilege and by a list
--       SCOPED TO `authenticated`, never by attempting a write: this suite runs
--       as the table owner, for whom no column privilege is a barrier (031's
--       lesson), and a table-wide privilege count reads 2 against a correct
--       database because postgres and service_role hold everything by Supabase
--       default (015's footer).
-- ===========================================================================
savepoint postcard_place_072;

reset role;

-- ---------------------------------------------------------------------------
-- 072.1  INSERT and SELECT reach the place name — a rider writes the place they
--        named and must be able to read back what they published.
-- ---------------------------------------------------------------------------
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'taken_place_name', 'INSERT'),
  true, '072: authenticated may INSERT the place name — the rider''s own choice is what writes it');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'taken_place_name', 'SELECT'),
  true, '072: ... and may SELECT it — the audience of a place IS the audience of the postcard, and there is no narrower one available');

-- ---------------------------------------------------------------------------
-- 073.1  THE PROVIDER ID IS GONE, as a COLUMN and not merely as a grant. A
--        revoked grant on a column that still exists is one `grant` away from
--        being back, and the reason it must not come back is a property of the
--        VALUE: a geoapify id resolves through a details lookup to the picked
--        feature's exact geometry, which is precisely the precision the 2dp
--        rounding beside it exists to remove.
--
--        Asserted against information_schema.columns rather than by a failing
--        insert, because a write naming a column that does not exist raises
--        42703 — a different rule passing under the same label.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'postcards'
      and column_name = 'taken_place_id'),
  0, '073: postcards has NO taken_place_id column — a provider id beside a deliberately blunted coordinate is a precision backdoor, and unlike clubs.location_place_id it sits next to a value whose whole point is that it has been coarsened');
select assert_eq(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and column_name = 'taken_place_id'),
  0, '073: ... so no role holds any privilege on it either, in any verb — the column going is what makes that true rather than a revoke somebody has to keep re-issuing');
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.postcards'::regclass
      and conname = 'postcards_taken_place_id_length'),
  0, '073: ... and its length bound went with it, named explicitly in 073 rather than auto-dropped, so it cannot reappear as a mystery in a later pg_constraint diff');

-- ---------------------------------------------------------------------------
-- 072.2  NO UPDATE on the place name, ever — and the UPDATE LIST HAS NOT MOVED.
--        072 and 073 between them rewrote this table's INSERT and SELECT lists,
--        which is the third and fourth time it has been done; 044 and 046 are
--        the worked example of an absolute list written from a document
--        reinstating what a previous file removed, with nothing red. The
--        per-column assertion cannot catch that on its own — only the exact
--        list can.
-- ---------------------------------------------------------------------------
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'taken_place_name', 'UPDATE'),
  false, '072: the place name holds no UPDATE — the remedy for a mis-published location is still deleting the postcard, and 072 issues no UPDATE statement of any kind while 073 issues no grant statement at all');

select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'caption,club_id,image_path',
  '072/073: the UPDATE list is UNMOVED at exactly three columns, through two files that rewrote the other two — if this goes red, one of them mentioned a verb it must not mention');

-- The SELECT list, exact and scoped to its grantee. There was no pin on this
-- list before 072 rewrote it, and the per-column assertions above cannot catch
-- a column that acquires SELECT by accident — nobody writes an assertion for a
-- column that does not exist yet.
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  'author_id,caption,club_id,created_at,id,image_path,taken_at,taken_at_offset_minutes,taken_country_code,taken_latitude,taken_location_precision,taken_longitude,taken_place_name,updated_at',
  '062/064/072/073/074: the SELECT grant list is exactly fourteen columns — the place name and the country are both on it, the provider id is not, and ride_id is STILL not among them');

select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'ride_id', 'SELECT'),
  false, '072: ... ride_id specifically, because 062 took it out deliberately and an absolute re-grant list is exactly how that gets silently reverted');
select assert_eq(has_table_privilege('authenticated', 'public.postcards', 'select'),
  false, '072: ... and the TABLE-level SELECT grant is still absent, so select(*) is still 42501 after two absolute re-grants');
select assert_eq(has_table_privilege('authenticated', 'public.postcards', 'insert'),
  false, '072: ... as is the TABLE-level INSERT grant — 072 re-issued a column list, it did not replace the list with a table grant');

-- ---------------------------------------------------------------------------
-- 072.3  anon holds nothing on the place name, in any verb. Decision #1.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select bool_or(has_column_privilege('anon', 'public.postcards', 'taken_place_name', p))
     from unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p),
  false, '072: anon holds no privilege of any kind on the place name — a named town is the last thing that should reach a role with no session');

-- ---------------------------------------------------------------------------
-- 072.4  The constraint OBJECTS. The rounding CHECK was RENAMED rather than
--        dropped, and the two are indistinguishable to any assertion that only
--        checks behaviour under `region`.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.postcards'::regclass and contype = 'c'
      and conname = 'postcards_coarse_location_is_rounded'),
  1, '072: postcards_coarse_location_is_rounded exists — the rounding CHECK gained a subject rather than losing one, and its name now says what it checks');
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.postcards'::regclass
      and conname = 'postcards_region_location_is_rounded'),
  0, '072: ... and the old name is gone, so a database carrying both would be a half-applied 072 rather than a working one');
select assert_eq(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.postcards'::regclass and contype = 'c'
      and conname = 'postcards_taken_place_name_length'),
  1, '072: the place name''s length bound exists — a text column with no bound takes a megabyte in a field a card renders on one line');

-- ---------------------------------------------------------------------------
-- 072.5  The COUPLING, arm by arm. Three nullable columns plus a marker admit
--        far more states than the design lists; the five legal ones are in
--        design.md §D3 as 073 narrowed them, and everything else is refused.
--
--        Positives first, so a constraint that refuses everything cannot pass
--        the negatives below for the wrong reason.
-- ---------------------------------------------------------------------------

-- Arm 2: a named place with NO pin. The rider typed a town and never picked
-- one. Refusing this would make the typeahead a gate rather than an
-- accelerator, which is the ride composer's existing free-text case.
insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f001',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a01.jpg',
          'Utrecht', 'place');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f001'),
  1, '072: a TYPED place with no coordinate lands — a name without a pin is a first-class stored value, not a partial row');

-- Arm 3: a named place WITH a pin, the centroid rounded to 2dp in the browser.
insert into postcards (id, author_id, image_path, taken_place_name,
                       taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f003',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a03.jpg',
          'Utrecht', 52.09, 5.12, 'place');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f003'),
  1, '072: a PICKED place — a name beside a rounded centroid — lands');

-- Arm 4: a precise photo location MAY carry a name, and the name MAY disagree
-- with the coordinate. That is deliberate and cosmetic (design.md §D5): a name
-- cannot reduce what `precise` already discloses, and the rule that must be
-- impossible is the other one — a `place` row carrying the photo's own fix,
-- which 072.6 asserts.
insert into postcards (id, author_id, image_path, taken_place_name,
                       taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f004',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a04.jpg',
          'Amsterdam', 52.370216, 4.895168, 'precise');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f004'),
  1, '072: a PRECISE row may carry a name, and it may even be the wrong one — mislabelling your own postcard is the same class of act as a wrong caption');

-- The three shapes an OLD client writes are arms 1, 4 and 5, so a client that
-- knows nothing of 072 keeps working. The all-NULL and precise shapes are
-- above and in 064's block; this is the legacy `region` marker, which stays in
-- the domain deliberately (design.md §D9) so the grandfathered rows stay legal.
insert into postcards (id, author_id, image_path,
                       taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f005',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a05.jpg',
          52.37, 4.90, 'region');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f005'),
  1, '072: the LEGACY region marker is still legal — 072 performs no backfill, so a row written under the superseded meaning must not become unwritable or unreadable');

-- --- and now the refusals ---

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f006',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a06.jpg',
          'place')$$,
  '23514', '072: the place marker with NO name is refused — the name IS the disclosure under this marker, so a marker without one describes nothing');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name,
                         taken_latitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f008',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a08.jpg',
          'Utrecht', 52.09, 'place')$$,
  '23514', '072: half a coordinate under the place marker is refused — 064''s rule survived the rewrite, and retyping a coupling is exactly where an arm loses a column');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f011',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a11.jpg',
          'Utrecht', 'town')$$,
  '23514', '072: a marker outside the three known values is refused even with a valid name — the domain is region, precise and place, and a fourth would be a mode nobody designed');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name,
                         taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f012',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a12.jpg',
          'Utrecht', 52.09, 5.12, 'region')$$,
  '23514', '072: a NAME beside the legacy region marker is refused — those rows were written under a meaning that had no name in it, and admitting one would invent a sixth arm nobody specified');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name,
                         taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f013',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a13.jpg',
          'Utrecht', 95.0, 5.12, 'place')$$,
  '23514', '072: an out-of-range latitude under the place marker is refused — 064 carried 051''s bounds and every arm of the rewrite has to carry them too');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name,
                         taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f014',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a14.jpg',
          'Utrecht', 52.09, 195.0, 'place')$$,
  '23514', '072: ... and an out-of-range longitude with it');

-- ---------------------------------------------------------------------------
-- 073.2  THE NULL-MARKER HOLE, which 072 shipped and 073 closed. A CHECK
--        constraint refuses only an explicit FALSE — NULL is ACCEPTED — so an
--        arm reading `taken_location_precision = 'precise'` evaluates to NULL
--        rather than FALSE when the marker is absent, and the whole disjunction
--        goes NULL with it. 072 split 064's single coupled arm into four
--        marker-specific ones and left 064's `is not null` guard behind; the
--        fix is `is not distinct from`, which is boolean for every input.
--
--        064's own "a coordinate with no precision marker is refused" is what
--        caught it, so THAT assertion is the regression test and it lives in
--        064's block. These are the cases 064 has no assertion for, because the
--        columns did not exist when it was written.
-- ---------------------------------------------------------------------------
select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name)
  values ('00000000-0000-0000-0000-00000073f001',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000073a01.jpg',
          'Utrecht')$$,
  '23514', '073: a NAME with no marker is refused — under 072 this SUCCEEDED, because the two arms that could have refused it compared a NULL marker with = and returned NULL, which a CHECK accepts');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name,
                         taken_latitude, taken_longitude)
  values ('00000000-0000-0000-0000-00000073f002',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000073a02.jpg',
          'Utrecht', 52.09, 5.12)$$,
  '23514', '073: ... and a name WITH a coordinate and no marker too — the marker is what says whose the location is, and without it no reader can tell a town centroid from a driveway');

-- ---------------------------------------------------------------------------
-- 072.6  A COARSE location must ACTUALLY BE COARSE, whatever produced it. This
--        is the assertion the whole middle mode leans on, and the one a
--        reviewer is most likely to assume died with `region`.
--
--        Without it a patched client sends taken_place_name = 'Utrecht',
--        taken_location_precision = 'place' and the author's own front door as
--        the coordinate — and the postcard's audience is shown a house and told
--        it is a city. That is WORSE than the outcome the constraint was
--        written for, because it arrives with a label that misdirects.
-- ---------------------------------------------------------------------------
select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name,
                         taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f015',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a15.jpg',
          'Utrecht', 52.370216, 4.895168, 'place')$$,
  '23514', '072: a PRECISE coordinate sent under the place marker is refused — the rounding happens in a browser this app does not control, so this CHECK is the only thing between a front door and a label saying Utrecht');

-- The halfway case, and the reason the predicate keeps 064's shape: it asks
-- whether the stored value IS at two decimal places, never whether it equals
-- the database's own rounding of some original. JS floors 4.895 to 4.89 and
-- Postgres's numeric round gives 4.90; both are `integer / 100`, so both land.
insert into postcards (id, author_id, image_path, taken_place_name,
                       taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f016',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a16.jpg',
          'Utrecht', 4.89, 4.90, 'place');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f016'),
  1, '072: the halfway case both languages round differently lands under the place marker too — the retarget copied the predicate rather than reinventing it');

-- A NULL coordinate passes the rounding CHECK, which is what keeps arm 2 legal.
-- Asserted here as well as in 072.5 because the two constraints could each be
-- correct alone and still make the typed-name case unwritable together.
insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f017',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a17.jpg',
          'Groningen', 'place');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f017'),
  1, '072: a named place with NO coordinate passes the rounding CHECK — the two constraints have to agree, and each could be right alone while making the typed-name case unwritable together');

-- `precise` is NOT held to the rounding rule, which is the whole point of the
-- marker. If the retarget had swept it in, every Precise postcard would be
-- refused — and the negative above would still be green.
insert into postcards (id, author_id, image_path,
                       taken_latitude, taken_longitude, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f018',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a18.jpg',
          52.370216, 4.895168, 'precise');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f018'),
  1, '072: a precise row keeps every digit — the retarget named the two COARSE markers and must not have swept precise in with them');

-- ---------------------------------------------------------------------------
-- 072.7  The length bound. 200 mirrors clubs_location_name_length against the
--        same producer — the provider's label falls back through a chain ending
--        in a whole address on one line. Asserted with a pair straddling the
--        wall, so relaxing the bound cannot pass unnoticed.
-- ---------------------------------------------------------------------------
insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f019',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a19.jpg',
          repeat('x', 200), 'place');
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f019'),
  1, '072: a place name at exactly 200 characters lands — the provider''s label runs long more readily than "a town name" suggests');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f020',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a20.jpg',
          repeat('x', 201), 'place')$$,
  '23514', '072: ... and 201 is refused, one character outside, so the bound is where the file says it is');

-- ---------------------------------------------------------------------------
-- 072.8  THE REACH. The column adds NO audience: it sits on postcards, RLS is
--        row-level, and the postcard's existing SELECT policy is the whole
--        answer. Asserted as a role reading a real row rather than as a policy
--        count, because "no policy changed" and "the column is as visible as
--        the row" are different claims and only the second is the requirement.
-- ---------------------------------------------------------------------------
insert into postcards (id, author_id, club_id, image_path, taken_place_name, taken_location_precision)
  values ('00000000-0000-0000-0000-00000072f023',
          '00000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-0000000000c1',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000072a23.jpg',
          'Utrecht', 'place');

set role authenticated;

-- The NEGATIVE first. `...000c` is in no club and is the suite's outsider.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000072f023'),
  0, '072: a NON-MEMBER reaches nothing of a private club''s postcard, so the place cannot be read — the column rides the row''s audience and adds no reach of its own');
select assert_eq(
  (select count(*)::int from postcards
    where taken_place_name = 'Utrecht' and club_id = '00000000-0000-0000-0000-0000000000c1'),
  0, '072: ... and cannot be found BY the place either — a predicate on a granted column is still evaluated under the row policy, so the town is not a way to probe for postcards you cannot see');

-- The author reads back what they published, which is why SELECT was granted.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq(
  (select taken_place_name from postcards where id = '00000000-0000-0000-0000-00000072f023'),
  'Utrecht', '072: the AUTHOR reads their own postcard''s place back — 064 granted SELECT on the location columns for exactly this reason, and the grant is worthless if the read fails');

-- A member of the club reads it exactly as they read the caption.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq(
  (select taken_place_name from postcards where id = '00000000-0000-0000-0000-00000072f023'),
  'Utrecht', '072: a MEMBER of the club reads the place exactly as they read the caption — one audience, decided by the row');

-- Neither may edit it, whatever they can see. This is the insert-only decision
-- reaching a real role rather than a privilege table.
select assert_denied($$
  update postcards set taken_place_name = 'Rotterdam'
   where id = '00000000-0000-0000-0000-00000072f023'$$,
  '072: a member who can READ the place cannot rewrite it — and the refusal is 42501 from the absent column grant, which fires before any policy is consulted');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_denied($$
  update postcards set taken_place_name = 'Rotterdam'
   where id = '00000000-0000-0000-0000-00000072f023'$$,
  '072: ... and neither can the AUTHOR — there is no UPDATE grant on the column, so a rider who regrets a disclosure deletes the postcard');

reset role;

-- ---------------------------------------------------------------------------
-- 072.9  NO POLICY MOVED. 072 is a column-grants-and-constraints change and 073
--        touches no grant at all; a policy mentioning the place would be a
--        second audience invented for a value that already has one.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'postcards'),
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'postcards'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%taken_place%'),
  '072: no postcards policy mentions the place column — the audience of a photo''s town is the audience of the photo, and adding an arm for it would be inventing a second one');

rollback to savepoint postcard_place_072;

reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);


\echo ''
\echo '# 074: a postcard''s named place carries a country too'

-- ===========================================================================
-- 074.  postcards.taken_country_code — the flag half of PD-279.
--
--       Grants are asserted BY ROLE with has_column_privilege and by a list
--       SCOPED TO `authenticated`, never by attempting a write — the same
--       reason 072's own header gives: this suite runs as the table owner,
--       for whom no column privilege is a barrier (031's lesson).
-- ===========================================================================
savepoint postcard_country_074;

reset role;

-- ---------------------------------------------------------------------------
-- 074.1  INSERT and SELECT reach the country — a rider writes the country they
--        named and must be able to read back what they published.
-- ---------------------------------------------------------------------------
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'taken_country_code', 'INSERT'),
  true, '074: authenticated may INSERT the country — the rider''s own lookup is what writes it');
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'taken_country_code', 'SELECT'),
  true, '074: ... and may SELECT it back — the audience of a country IS the audience of the postcard');

-- ---------------------------------------------------------------------------
-- 074.2  NO UPDATE on the country, ever — matching taken_place_name exactly.
-- ---------------------------------------------------------------------------
select assert_eq(has_column_privilege('authenticated', 'public.postcards', 'taken_country_code', 'UPDATE'),
  false, '074: the country holds no UPDATE — the remedy for a mis-published country is the same as for a mis-published town: delete the postcard');

-- The three grant lists, exact and scoped to their grantee — the per-column
-- assertions above cannot catch a column that acquires a privilege by
-- accident, and 044/046 are the worked example of an absolute list silently
-- reinstating what a previous file removed.
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and grantee = 'authenticated' and privilege_type = 'INSERT'),
  'author_id,caption,club_id,id,image_path,ride_id,taken_at,taken_at_offset_minutes,taken_country_code,taken_latitude,taken_location_precision,taken_longitude,taken_place_name',
  '074: the INSERT grant list is exactly thirteen columns — the country IS on it');
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and grantee = 'authenticated' and privilege_type = 'SELECT'),
  'author_id,caption,club_id,created_at,id,image_path,taken_at,taken_at_offset_minutes,taken_country_code,taken_latitude,taken_location_precision,taken_longitude,taken_place_name,updated_at',
  '074: the SELECT grant list is exactly fourteen columns — ride_id is STILL not among them');
select assert_eq(
  (select string_agg(column_name, ',' order by column_name)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postcards'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'caption,club_id,image_path',
  '074: the UPDATE list is UNMOVED at exactly three columns, through three files that rewrote the other two');

-- ---------------------------------------------------------------------------
-- 074.3  anon holds nothing on the country, in any verb. Decision #1.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select bool_or(has_column_privilege('anon', 'public.postcards', 'taken_country_code', p))
     from unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p),
  false, '074: anon holds no privilege of any kind on the country');

-- ---------------------------------------------------------------------------
-- 074.4  The format CHECK — two uppercase letters, matching
--        profile_countries_code_is_iso_alpha2 (014/020) rather than the
--        vendor's own lowercase.
-- ---------------------------------------------------------------------------
insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision, taken_country_code)
  values ('00000000-0000-0000-0000-00000074f001',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000074a01.jpg',
          'Utrecht', 'place', 'NL');
select assert_eq(
  (select taken_country_code from postcards where id = '00000000-0000-0000-0000-00000074f001'),
  'NL', '074: an uppercase two-letter code lands, beside the place it describes');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision, taken_country_code)
  values ('00000000-0000-0000-0000-00000074f002',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000074a02.jpg',
          'Utrecht', 'place', 'nl')$$,
  '23514', '074: a lowercase code is refused — the composer uppercases before this ever runs, and the database is what holds that true against a client that skips it');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision, taken_country_code)
  values ('00000000-0000-0000-0000-00000074f003',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000074a03.jpg',
          'Utrecht', 'place', 'NLD')$$,
  '23514', '074: a three-letter code is refused');

select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision, taken_country_code)
  values ('00000000-0000-0000-0000-00000074f004',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000074a04.jpg',
          'Utrecht', 'place', 'N')$$,
  '23514', '074: a one-letter code is refused');

-- ---------------------------------------------------------------------------
-- 074.5  A country needs a place to describe — postcards_taken_country_code_
--        needs_a_place. PostcardCard draws the flag immediately before the
--        town and never on its own, so a row carrying a country with no name
--        would store a value nothing can ever render.
-- ---------------------------------------------------------------------------
select assert_rejected($$
  insert into postcards (id, author_id, image_path, taken_country_code)
  values ('00000000-0000-0000-0000-00000074f005',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000074a05.jpg',
          'NL')$$,
  '23514', '074: a country with NO place name is refused — nothing on the card could ever draw it');

-- The other direction is legal: a named place with no country, exactly the
-- typed-and-never-picked shape 072's arm 2 already allows.
insert into postcards (id, author_id, image_path, taken_place_name, taken_location_precision)
  values ('00000000-0000-0000-0000-00000074f006',
          '00000000-0000-0000-0000-00000000000a',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000074a06.jpg',
          'Utrecht', 'place');
select assert_eq(
  (select taken_country_code from postcards where id = '00000000-0000-0000-0000-00000074f006'),
  null, '074: a named place with NO country lands — a typed-and-never-picked town carries no vendor data to describe a country with');

-- ---------------------------------------------------------------------------
-- 074.6  THE REACH. No new audience: the column sits on postcards, RLS is
--        row-level, and the postcard's existing SELECT policy is the whole
--        answer — same pattern as 072.8, asserted against a real role.
-- ---------------------------------------------------------------------------
insert into postcards (id, author_id, club_id, image_path, taken_place_name, taken_location_precision, taken_country_code)
  values ('00000000-0000-0000-0000-00000074f007',
          '00000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-0000000000c1',
          'postcards/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-000000074a07.jpg',
          'Utrecht', 'place', 'NL');

set role authenticated;

select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select assert_eq(
  (select count(*)::int from postcards where id = '00000000-0000-0000-0000-00000074f007'),
  0, '074: a NON-MEMBER reaches nothing of a private club''s postcard, so the country cannot be read either — the column rides the row''s audience and adds no reach of its own');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_eq(
  (select taken_country_code from postcards where id = '00000000-0000-0000-0000-00000074f007'),
  'NL', '074: the AUTHOR reads their own postcard''s country back');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select assert_eq(
  (select taken_country_code from postcards where id = '00000000-0000-0000-0000-00000074f007'),
  'NL', '074: a MEMBER of the club reads the country exactly as they read the place name — one audience, decided by the row');

select assert_denied($$
  update postcards set taken_country_code = 'BE'
   where id = '00000000-0000-0000-0000-00000074f007'$$,
  '074: a member who can READ the country cannot rewrite it — 42501 from the absent column grant, before any policy is consulted');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select assert_denied($$
  update postcards set taken_country_code = 'BE'
   where id = '00000000-0000-0000-0000-00000074f007'$$,
  '074: ... and neither can the AUTHOR');

reset role;

-- ---------------------------------------------------------------------------
-- 074.7  NO POLICY MOVED.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'postcards'),
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'postcards'
      and (coalesce(qual, '') || coalesce(with_check, '')) not like '%taken_country%'),
  '074: no postcards policy mentions the country column — same audience as the place it describes, no second one invented');

rollback to savepoint postcard_country_074;

\echo ''
\echo '# 075 — onboarding completes with no location, and a re-run never erases one (PD-286)'

-- ===========================================================================
-- 075. The location step is gone. `complete_onboarding(text)` no longer refuses
--      a NULL or blank argument, `enforce_onboarding_completion()` no longer
--      carries `new.location is null` on either arm, and `username_exists()`
--      no longer calls a rider's own name taken.
--
-- ** THE LABELS BELOW ARE PREFIXED `075:` AND SIT UNDER THIS HEADER **, per
-- 058's rule: a label is the only thing a failing run prints, so it is the only
-- place the reader learns which migration is on the hook.
--
-- ** THE ONE THAT MATTERS MOST IS 075.3, AND IT IS NOT THE HAPPY PATH. ** The
-- refusal 075 deletes was silently doing a second job. 059's body ended in an
-- unconditional `set location = p_location`, safe only because control never
-- reached it carrying a NULL. Delete the refusal on its own and the very first
-- call the new client makes writes NULL over whatever the rider had stored.
-- Every other assertion here proves the relaxation works; 075.3 proves it did
-- not cost a rider their data, and it is the only one that would notice.
--
-- ** 075.5 READS A RAISE MESSAGE AS TEXT, WHICH NOTHING ELSE IN THIS FILE
-- DOES. ** That is the gap 075 found rather than a stylistic choice: all three
-- raise sites said 'onboarding cannot be completed before username and
-- location are set' and every gate covering them matched SQLSTATE 23514, so a
-- message naming a rule the schema had just lost could not go red anywhere.
--
-- Self-contained fixtures — its own riders and its own club, like 038, 056 and
-- 058 — because this section runs last and must not depend on what the twenty
-- sections above left behind.
--   075001  username + consent, NO location, NO stamp   -- the new client's call
--   075002  the same, for the blank-argument arm
--   075003  ONBOARDED, holds 'Groningen'                -- the data-loss fixture
--   075004  consent, NO username                        -- the surviving refusal
--   075005  username, NO consent                        -- ... and the other one
--   075006  profile row deleted                         -- the trigger's INSERT arm
--   075007  holds `pd075self`                           -- username_exists, own row
--   075008  holds `pd075other`                          -- ... and somebody else's
--   075009  owner of the welcome club
--   075010  username + consent, NO location             -- the welcome-club join
--   075011  username + consent, NO location, NO stamp   -- the trigger's UPDATE arm
--   075012  profile row deleted, NO username            -- ... its INSERT refusal
-- ===========================================================================
savepoint no_location_075;

reset role;
select set_config('test.uid', '', false);

set role auth_admin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075001', 'pd075first@example.com'),
  ('00000000-0000-0000-0000-000000075002', 'pd075blank@example.com'),
  ('00000000-0000-0000-0000-000000075003', 'pd075stored@example.com'),
  ('00000000-0000-0000-0000-000000075004', 'pd075noname@example.com'),
  ('00000000-0000-0000-0000-000000075005', 'pd075noconsent@example.com'),
  ('00000000-0000-0000-0000-000000075006', 'pd075born@example.com'),
  ('00000000-0000-0000-0000-000000075007', 'pd075self@example.com'),
  ('00000000-0000-0000-0000-000000075008', 'pd075other@example.com'),
  ('00000000-0000-0000-0000-000000075009', 'pd075owner@example.com'),
  ('00000000-0000-0000-0000-000000075010', 'pd075joiner@example.com'),
  ('00000000-0000-0000-0000-000000075011', 'pd075trigger@example.com'),
  ('00000000-0000-0000-0000-000000075012', 'pd075nameless@example.com');
reset role;

update profiles set username = 'pd075first',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075001';
update profiles set username = 'pd075blank',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075002';
update profiles set username = 'pd075stored', location = 'Groningen',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075003';
update profiles set terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075004';
update profiles set username = 'pd075noconsent'
  where id = '00000000-0000-0000-0000-000000075005';
update profiles set username = 'pd075self',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075007';
update profiles set username = 'pd075other',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075008';
update profiles set username = 'pd075owner', location = 'Lisbon',
                    terms_accepted_at       = timestamptz '2026-01-01 00:00:00+00',
                    onboarding_completed_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075009';
update profiles set username = 'pd075joiner',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075010';
update profiles set username = 'pd075trigger',
                    terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075011';
update profiles set terms_accepted_at = timestamptz '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0000-000000075012';
-- 075006 keeps the row handle_new_user made until 075.6 deletes it, which is
-- the only way to reach the trigger's INSERT arm at all.

-- ---------------------------------------------------------------------------
-- 075.1  THE POSITIVE, and the call the shipped client now makes on every
--        signup: username, consent, and no location anywhere.
-- ---------------------------------------------------------------------------
set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  '075: the 075 assertions run as authenticated, or they prove nothing');
select set_config('test.uid', '00000000-0000-0000-0000-000000075001', false);

select assert_eq(public.complete_onboarding(null) is not null, true,
  '075: a rider with a username, consent and NO LOCATION AT ALL completes the wizard — this is the only call setUsername makes, and it raised 23514 until 075');
select assert_eq((select onboarding_completed_at is not null from public.my_onboarding_state()),
  true, '075: ... and the stamp really landed, read back through the accessor rather than inferred from the absence of an error');
select assert_eq((select location from profiles where id = auth.uid()),
  null::text, '075: ... while their location is still NULL — a NULL argument means "leave it alone", never "store something"');

-- Completion with no location is real completion rather than a stamp with
-- nothing behind it, and 023's gate is what says so.
savepoint first_postcard_075;
insert into postcards (author_id, image_path, caption)
values ('00000000-0000-0000-0000-000000075001',
        'postcards/00000000-0000-0000-0000-000000075001/00000000-0000-0000-0000-000000075a01.jpg', 'hi');
select assert_eq((select count(*)::int from postcards
                   where author_id = '00000000-0000-0000-0000-000000075001'),
  1, '075: ... and the participation gate opens for them, which is what makes the stamp worth having');
rollback to savepoint first_postcard_075;

-- ---------------------------------------------------------------------------
-- 075.2  The blank argument on a FIRST completion. 018's
--        profiles_location_length refuses a trimmed-empty string, so a bare
--        `coalesce(p_location, p.location)` would raise 23514 right here.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000075002', false);
select assert_eq(public.complete_onboarding('   ') is not null, true,
  '075: a location of nothing but spaces completes the wizard too — the nullif(btrim(...)) half is what turns it into "leave it alone" instead of a 23514 from 018');
select assert_eq((select location from profiles where id = auth.uid()),
  null::text, '075: ... storing NULL rather than the spaces, which is the only value 018 admits for "no location"');

-- ---------------------------------------------------------------------------
-- 075.3  ** THE DATA-LOSS PIN. ** The re-run, which is the whole reason the
--        write became conditional.
-- ---------------------------------------------------------------------------
-- 075003 was onboarded on 2026-01-01, before this transaction existed, and
-- holds 'Groningen'. Every call below is a re-run: the stamp is pinned by 003
-- §6b, so the only thing that can move is the location.
select set_config('test.uid', '00000000-0000-0000-0000-000000075003', false);
savepoint rerun_075;

select assert_eq(public.complete_onboarding(null), timestamptz '2026-01-01 00:00:00+00',
  '075: a re-run with NULL returns the ORIGINAL stamp, so the assertion below is reading the result of a real second call rather than of a refusal');
select assert_eq((select location from profiles where id = auth.uid()),
  'Groningen',
  '075: ** THE DATA-LOSS PIN ** a re-run with NULL leaves the stored location ALONE — this is the line that goes red if the write reverts to an unconditional `set location = p_location`, and nothing else in this suite would notice');
select assert_eq(public.complete_onboarding('   ') is not null, true,
  '075: ... a re-run with a blank argument is accepted rather than refused by 018''s CHECK');
select assert_eq((select location from profiles where id = auth.uid()),
  'Groningen',
  '075: ... and leaves the stored location alone too — the nullif(btrim(...)) half again, which a coalesce over the raw argument would fail while passing the NULL case above');
select assert_eq(public.complete_onboarding('Deventer') is not null, true,
  '075: ... while a REAL location still overwrites the stored one');
select assert_eq((select location from profiles where id = auth.uid()),
  'Deventer',
  '075: ... which is the assertion that fails if the coalesce is written the other way round — `coalesce(p.location, nullif(...))` passes every line above and silently freezes the column for every rider who already has one');

rollback to savepoint rerun_075;

-- ---------------------------------------------------------------------------
-- 075.4  The two rules that did NOT go, isolated by giving each fixture no
--        location — so the arm under test is the only one that can fire.
-- ---------------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-000000075004', false);
select assert_rejected($$select public.complete_onboarding(null)$$,
  '23514', '075: completion is still refused for want of a USERNAME, asserted with a NULL location — before 075 both arms fired here and either could have been the one passing this');
select set_config('test.uid', '00000000-0000-0000-0000-000000075005', false);
select assert_rejected($$select public.complete_onboarding(null)$$,
  '23514', '075: ... and still refused for want of CONSENT, same fixture shape — 023 §1.13 is untouched by this change');

-- ---------------------------------------------------------------------------
-- 075.5  ** THE MESSAGES, READ AS TEXT. ** Tasks 1.3b and 2.10.
-- ---------------------------------------------------------------------------
-- The point is not the wording, it is that SOME gate reads the string. Until
-- 075 nothing did: `rls_test.sql:3100,3102` and every sibling matched 23514
-- alone, so all three sites could have kept naming a location requirement the
-- schema no longer has and the suite would have stayed green.
--
-- The helper is local to this file because harness.sql owns the shared ones and
-- 075 changes nothing there. Promote it the day a second migration needs it.
reset role;
create function public.pd075_assert_message(stmt text, expected text, label text)
returns void
language plpgsql
as $$
declare
  v_message text;
begin
  begin
    execute stmt;
  exception
    when others then
      v_message := sqlerrm;
  end;
  if v_message is null then
    raise exception 'FAIL  % — expected the statement to raise, but it succeeded', label;
  end if;
  if v_message is distinct from expected then
    raise exception 'FAIL  % — expected message "%", got "%"', label, expected, v_message;
  end if;
  raise notice 'ok    % (message)', label;
end;
$$;

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000075004', false);
select public.pd075_assert_message($$select public.complete_onboarding(null)$$,
  'onboarding cannot be completed before a username is set',
  '075: the RPC''s username refusal says what it now MEANS, word for word — the 23514 gates in the 021 section pass just as happily against the old text, which named a location rule the schema has lost');

select set_config('test.uid', '00000000-0000-0000-0000-000000075005', false);
select public.pd075_assert_message($$select public.complete_onboarding(null)$$,
  'onboarding cannot be completed before the terms are accepted',
  '075: ... and the consent refusal is unchanged word for word, so the message edit was the username arm''s alone rather than a sweep across the body');

-- The bodies themselves, per 038.11: the assertions above say the behaviour is
-- right, these say which line broke when it is not.
reset role;
select assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('complete_onboarding', 'enforce_onboarding_completion')
      and p.prosrc like '%location are set%'),
  0, '075: neither body still carries the retired message — matched on a FRAGMENT rather than the whole string, deliberately, so a repo-wide grep for the old wording does not count this tripwire as a surviving copy (CLAUDE.md''s comment trap applies to prosrc as much as to a repo grep)');
select assert_eq(
  (select (length(prosrc) - length(replace(prosrc, 'new.location is null', '')))
            / length('new.location is null')
     from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc),
  0, '075: the trigger carries `new.location is null` on NEITHER arm — the INSERT arm is the one no prose in this repo mentioned, so it is counted rather than assumed');
select assert_eq(
  (select (length(prosrc) - length(replace(prosrc, 'new.username is null', '')))
            / length('new.username is null')
     from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc),
  2, '075: ... while BOTH `new.username is null` arms survive — the positive control, without which the line above passes just as well against a body that lost the whole test');
select assert_eq(
  (select prosrc like '%coalesce(nullif(pg_catalog.btrim(p_location), '''')%'
     from pg_proc where oid = 'public.complete_onboarding(text)'::regprocedure),
  true, '075: and the RPC''s location write is the conditional form in the body itself — 075.3 is the behavioural proof, this is the one that names the line');

-- ---------------------------------------------------------------------------
-- 075.6  The trigger's own two arms. Unreachable in production, asserted
--        anyway, because a rule left behind states something the schema no
--        longer has and would refuse a legitimate support-path write.
-- ---------------------------------------------------------------------------
-- 025 leaves `authenticated` no grant on `onboarding_completed_at` at all, so
-- no client statement ever reaches this function carrying the stamp — the first
-- assertion is the GRANT refusing, not the trigger. The grant is then simulated
-- inside a savepoint, which is the only way into the arms, and rolled back.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000075011', false);
select assert_denied($$
  update profiles set onboarding_completed_at = pg_catalog.now()
  where id = '00000000-0000-0000-0000-000000075011'$$,
  '075: a client write naming the completion stamp is still refused by the column grant, before the trigger is entered — everything below this line is reachable only because the next statement grants what production does not');

savepoint simulated_grant_075;
reset role;
grant update (onboarding_completed_at) on public.profiles to authenticated;
grant insert (id, username, location, terms_accepted_at, onboarding_completed_at)
  on public.profiles to authenticated;

-- The UPDATE arm.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000075011', false);
update profiles set onboarding_completed_at = pg_catalog.now(), bio = 'stamped'
  where id = auth.uid();
reset role;
select assert_eq(
  (select onboarding_completed_at is not null from profiles
    where id = '00000000-0000-0000-0000-000000075011'),
  true, '075: the trigger''s UPDATE arm ACCEPTS a completion stamp on a rider with NO location — it carried `new.location is null` until 075 and raised 23514 on exactly this statement');
select assert_eq(
  (select location is null from profiles where id = '00000000-0000-0000-0000-000000075011'),
  true, '075: ... with the location still NULL, so nothing quietly filled it in');
select assert_eq(
  (select bio from profiles where id = '00000000-0000-0000-0000-000000075011'),
  'stamped', '075: ... and the statement''s other column landed, so that is an accepted write rather than an UPDATE filtered to zero rows');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000075004', false);
select assert_rejected($$update profiles set onboarding_completed_at = pg_catalog.now()
  where id = '00000000-0000-0000-0000-000000075004'$$,
  '23514', '075: ... while the same write is still REFUSED for a rider with no username — the arm 075 kept, and now the only one that can be firing');
select public.pd075_assert_message($$update profiles set onboarding_completed_at = pg_catalog.now()
  where id = '00000000-0000-0000-0000-000000075004'$$,
  'onboarding cannot be completed before a username is set',
  '075: ... in the trigger''s own words — the second of the three raise sites 1.3b rewrote, and the arm no assertion had ever read');

-- The INSERT arm. A row has to be absent to be born, so the fixture's own
-- profile row (made by handle_new_user) is removed as the owner first.
reset role;
delete from profiles where id in ('00000000-0000-0000-0000-000000075006',
                                  '00000000-0000-0000-0000-000000075012');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000075006', false);
insert into profiles (id, username, terms_accepted_at, onboarding_completed_at)
values (auth.uid(), 'pd075born', pg_catalog.now(), pg_catalog.now());
reset role;
select assert_eq(
  (select onboarding_completed_at is not null from profiles
    where id = '00000000-0000-0000-0000-000000075006'),
  true, '075: the trigger''s INSERT arm accepts a row BORN complete with no location — the arm no prose in this repo mentions, which is why 075 was written against the deployed prosrc rather than 023''s text');
select assert_eq(
  (select location is null from profiles where id = '00000000-0000-0000-0000-000000075006'),
  true, '075: ... and that row really has no location, so the arm was entered rather than sidestepped');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000075012', false);
select assert_rejected($$
  insert into profiles (id, terms_accepted_at, onboarding_completed_at)
  values ('00000000-0000-0000-0000-000000075012', pg_catalog.now(), pg_catalog.now())$$,
  '23514', '075: ... while a row born complete with no USERNAME is still refused on that same arm');

rollback to savepoint simulated_grant_075;

reset role;
select assert_eq(
  has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed_at', 'update'),
  false, '075: the simulated grant is rolled back — 025 is exactly where it was, and everything in 075.6 stays unreachable from a client');

-- ---------------------------------------------------------------------------
-- 075.7  `username_exists` stops calling a rider's own name taken (§3, D7).
-- ---------------------------------------------------------------------------
-- Reachable only because of this change: the username step is the step that
-- completes onboarding now, so a rider who lands back on it already has a name,
-- and a recovery screen that opens by refusing it in red is not the clean retry
-- the proposal's safety case claims.
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000075007', false);

select assert_eq(public.username_exists('pd075self'), false,
  '075: a rider''s OWN current username reads AVAILABLE to them — it read `taken` until 075, which is the answer that cannot be right for the one row that can never collide with itself');
select assert_eq(public.username_exists('PD075SELF'), false,
  '075: ... in upper case too, so the self-exclusion is not defeated by the folding 056 added');
select assert_eq(public.username_exists('Pd075Self'), false,
  '075: ... and in mixed case');
select assert_eq(public.username_exists('pd075other'), true,
  '075: ... while another visible rider''s name still reads TAKEN — the exclusion is exactly one row wide, and without this the three lines above pass against a function that lost its predicate entirely');
select assert_eq(public.username_exists('pd075nobody'), false,
  '075: ... and a name nobody holds still reads available');

-- The database's own answer to the same question, because an availability check
-- that disagrees with what happens on submit is worse than none.
savepoint own_name_075;
update profiles set username = 'pd075self' where id = auth.uid();
select assert_eq((select username from profiles where id = auth.uid()),
  'pd075self', '075: ... and re-writing your own name really is a no-op UPDATE rather than a 23505, so the answer above matches what submitting it does');
rollback to savepoint own_name_075;

select set_config('test.uid', '00000000-0000-0000-0000-000000075008', false);
select assert_eq(public.username_exists('pd075self'), true,
  '075: the SAME name reads TAKEN to a DIFFERENT rider — the predicate keys on auth.uid(), so it can never free a name for the rider who would collide with it');
select assert_rejected($$update profiles set username = 'pd075self'
  where id = '00000000-0000-0000-0000-000000075008'$$,
  '23505', '075: ... and profiles_username_lower_key still refuses them, which is what keeps the availability check advisory rather than the decision');

-- The documented consequence of writing `<>` rather than `is distinct from`,
-- asserted rather than described. With no session `auth.uid()` is NULL, the
-- comparison is NULL, and EVERY name reads available. That caller cannot exist
-- through PostgREST — EXECUTE is revoked from `public` and `anon`, and an
-- `authenticated` JWT always carries a `sub` — so the revoke asserted below is
-- the whole reason the operator is safe, rather than a formality. This is the
-- line that goes red if someone "tidies" it in either direction without
-- deciding.
select set_config('test.uid', '', false);
select assert_eq(public.username_exists('pd075other'), false,
  '075: a caller with NO SESSION reads even a taken name as available — `<>` against a NULL auth.uid() yields NULL, which is exactly what makes the anon revoke below load-bearing rather than ceremony');
select set_config('test.uid', '00000000-0000-0000-0000-000000075008', false);
select assert_eq(public.username_exists('pd075other'), false,
  '075: ... and the very same probe from the holder''s own seat still reads available for its own reason, so the line above is not passing because the name went missing');

-- 031's lesson has two halves and this file usually asserts only the first.
-- `anon` is refused when it CALLS, not merely absent from an ACL read.
reset role;
set role anon;
select assert_denied($$select public.username_exists('pd075other')$$,
  '075: `anon` is refused when it actually calls username_exists — 075 re-issues `revoke all ... from public, anon`, and a catalog read alone cannot tell a correct revoke from a grant that never existed');
reset role;

-- The catalog half, per 031 and 058.7: 075 replaces this body and re-issues its
-- `revoke all ... from public, anon`, so the posture is re-asserted under a
-- label naming the file that last wrote it.
reset role;
select assert_eq(
  (select prosecdef from pg_proc where oid = 'public.username_exists(text)'::regprocedure),
  false, '075: username_exists is STILL security INVOKER after the replacement — as definer the new predicate would sit inside a block-piercing read, which is the opposite of what it is for');
select assert_eq(
  (select proconfig from pg_proc where oid = 'public.username_exists(text)'::regprocedure),
  array['search_path=""'], '075: ... with its search_path still pinned');
select assert_eq(
  has_function_privilege('authenticated', 'public.username_exists(text)', 'execute'),
  true, '075: ... and `authenticated` can still call it — a mistake in 075''s re-grant leaves the availability check unreachable for the only role that calls it, and 029/031 is what that costs');
select assert_eq(
  has_function_privilege('anon', 'public.username_exists(text)', 'execute'),
  false, '075: ... while `anon` still cannot, per decision #1');

-- ---------------------------------------------------------------------------
-- 075.8  The identity and the posture of the two functions 075 replaced.
-- ---------------------------------------------------------------------------
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'complete_onboarding'),
  1, '075: there is exactly ONE complete_onboarding — no overload and no DEFAULT was added, because PostgREST answers PGRST203 on an ambiguous one and every call from the client would fail at once');
select assert_eq(
  (select pg_get_function_identity_arguments(oid) from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'complete_onboarding'),
  'p_location text', '075: ... and its identity is the one 021 granted and 025''s footer names, unchanged — an old bundle still sending a real location is what makes "apply before the deploy" safe');
select assert_eq(
  (select prosecdef from pg_proc where oid = 'public.complete_onboarding(text)'::regprocedure),
  true, '075: complete_onboarding is still SECURITY DEFINER after the replacement — 025 revoked the stamp, so that keyword is the whole path back to it, and 022 shipped one of these missing');
select assert_eq(
  (select proconfig from pg_proc where oid = 'public.complete_onboarding(text)'::regprocedure),
  array['search_path=""'], '075: ... with its search_path still pinned, which every unqualified name in the body is otherwise exposed to');
select assert_eq(
  (select prosecdef from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc),
  false, '075: enforce_onboarding_completion is still SECURITY INVOKER after ITS replacement — 033''s footer requires it, and as definer its own `current_user <> ''authenticated''` gate would never fire for anyone');

-- ---------------------------------------------------------------------------
-- 075.9  058's welcome club still fires for a rider who has no location.
-- ---------------------------------------------------------------------------
-- The join hangs off the transition into completion, never off the location —
-- and 075 is the change that makes "no location" the ordinary case rather than
-- an oddity, so 058's rule is re-exercised under it rather than assumed.
reset role;
insert into clubs (id, name, is_public, owner_id, is_default) values
  ('00000000-0000-0000-0000-0000075c0001', 'PD075 Welcome', true,
   '00000000-0000-0000-0000-000000075009', true);
insert into club_members (club_id, user_id, role) values
  ('00000000-0000-0000-0000-0000075c0001', '00000000-0000-0000-0000-000000075009', 'owner');

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-000000075010', false);
select assert_eq(public.complete_onboarding(null) is not null, true,
  '075: a rider completing with a NULL location finishes the wizard, with a welcome club present');

reset role;
select assert_eq(
  (select role from club_members
    where club_id = '00000000-0000-0000-0000-0000075c0001'
      and user_id = '00000000-0000-0000-0000-000000075010'),
  'member', '075: ... and 058''s join still puts them in the welcome club as a MEMBER — a NULL argument does not short-circuit the block that runs after the update');
select assert_eq(
  (select count(*)::int from notifications
    where type = 'club_joined' and club_id = '00000000-0000-0000-0000-0000075c0001'),
  0, '075: ... and still silently, per 058 §4 — the welcome club''s owner hears nothing, which is what stops one account owning a notification list of every signup');

set role authenticated;
delete from club_members
  where club_id = '00000000-0000-0000-0000-0000075c0001' and user_id = auth.uid();
select assert_eq(public.complete_onboarding(null) is not null, true,
  '075: ... a rider who LEAVES the welcome club and re-runs the RPC with a NULL argument still completes');
reset role;
select assert_eq(
  (select count(*)::int from club_members
    where club_id = '00000000-0000-0000-0000-0000075c0001'
      and user_id = '00000000-0000-0000-0000-000000075010'),
  0, '075: ... and is NOT put back in — v_was_complete is captured before the update, which 075''s coalesce leaves exactly where 058 wrote it');

reset role;
drop function public.pd075_assert_message(text, text, text);
rollback to savepoint no_location_075;

reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);

rollback;

\echo ''
\echo 'All RLS policy assertions passed.'
