-- Assertions for migrations 023 AND 025 applied together — the state that will
-- actually ship, and the only one of the three pending modes that models it.
--
-- ---------------------------------------------------------------------------
-- Why this file exists
-- ---------------------------------------------------------------------------
--
--   PENDING=023     npm test  # applies 023, skips 025, runs rls_test_pending_023.sql
--   PENDING=025     npm test  # applies 025, skips 023, runs rls_test_pending_025.sql
--   PENDING=023+025 npm test  # applies BOTH, runs this file
--
-- Until 2026-08-05 there was deliberately **no** mode applying both, and the
-- reason was a real finding rather than an inconvenience. Quoting the note this
-- file replaces:
--
--   "021 and 023 cannot both hold as drafted. 023 refuses every write from a
--    rider whose two stamps are not set; 021 removes the only path by which a
--    client ever sets either one. Applied together, no rider can become
--    qualified to participate and the wizard is a dead end. This was not
--    reasoned out in advance — it was found by writing a single pending suite
--    and watching the onboarding-completes assertion fail with 'permission
--    denied for table profiles'."
--
-- 021's §3 resolved it by giving the *database* the write path 025 takes away
-- from the *client*: `accept_terms()` and `complete_onboarding(text)`. Those
-- functions are now APPLIED and their behaviour is asserted in rls_test.sql;
-- what remains pending is 023's gate and 025's revoke, and **this file is the
-- proof that those two compose.** Its headline is §A, which walks a rider from two NULL stamps to a
-- published postcard using only what the shipped app will have.
--
-- All three modes run **instead of** rls_test.sql, because 025 revokes the
-- column SELECT that ~20 of rls_test.sql's 003/012 stamp assertions read
-- directly as the caller.
--
-- ---------------------------------------------------------------------------
-- What this file asserts that the two solo suites cannot
-- ---------------------------------------------------------------------------
-- Not a merge of the other two. Three things only exist in the combination:
--
--   1. The rider path end to end (§A). Neither solo mode has both halves — 025
--      has the revoke and no gate to open, 023 has the gate and the client's own
--      column grants still intact, so neither one forces the rider through the
--      RPCs *and* past the gate.
--   2. **The layer that refuses moves outward, and the SQLSTATE changes with it**
--      (§B). A direct `update profiles set onboarding_completed_at = ...` is
--      42501 here, not the 23514 the 023 solo suite expects, because 025 takes
--      the column grant away before 023's guard is ever reached. An assertion
--      copied between the two files without noticing that would be testing the
--      wrong rule.
--   3. Nobody is stranded (§E), which is the single failure mode this pair must
--      not have — and it is a harder claim here than in either solo mode,
--      because the rider now needs the accessor AND the writers AND their own
--      ordinary profile UPDATEs to all still work.
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
-- The same four the two solo suites add, for the same reason: seed.sql gives
-- every finished rider BOTH stamps and cannot express "onboarded but never
-- consented", which is the state 3 of the 4 live riders are actually in.
--
--   0011  username, location, onboarding_completed_at SET, terms NULL
--   0012  username, location, BOTH stamps set, and no content of any kind
--   0013  username, location, NEITHER stamp
--   0014  consent SET, username and location NULL
--
-- These run as the table owner, which still holds every grant after 025's
-- revoke — it names `authenticated` only. If that ever stops being true, this
-- block fails loudly rather than silently seeding nothing.

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

select assert_eq((select count(*)::int from profiles
                   where id in ('00000000-0000-0000-0000-000000000011',
                                '00000000-0000-0000-0000-000000000012',
                                '00000000-0000-0000-0000-000000000013',
                                '00000000-0000-0000-0000-000000000014')),
  4, 'the four fixtures exist — 025 revoked from authenticated, not from the owner');

-- ===========================================================================
-- §A. THE WHOLE POINT: a rider goes from two NULL stamps to a published
--     postcard, using only what the shipped app will have
-- ===========================================================================

\echo ''
\echo '# A rider with NULL stamps can still reach the far side of the wizard (023 + 025)'

set role authenticated;
select assert_eq(current_user::text, 'authenticated',
  'the path runs as authenticated, or it proves nothing');

-- 000e is seed.sql's step-1 rider: no username, no location, no stamps. The
-- worst case, and the one the old objection said was a dead end.
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);

savepoint the_whole_path;

-- Where the rider starts. Read through the accessor, which is the only path left.
select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  null::timestamptz, 'start: no consent');
select assert_eq((select onboarding_completed_at from public.my_onboarding_state()),
  null::timestamptz, 'start: not onboarded');
select assert_eq((select has_username from public.my_onboarding_state()),
  false, 'start: no username');

-- ... and the gate is shut, which is 023 doing its job.
select assert_rejected($$
  insert into postcards (author_id, image_path, caption)
  values ('00000000-0000-0000-0000-00000000000e',
          'postcards/00000000-0000-0000-0000-00000000000e/eeeeeeee-0000-4000-8000-00000000ab01.jpg', 'hi')$$,
  '23514', 'start: the gate refuses a postcard');

-- Step 1 of the wizard as it becomes once 023 §1.13 lands: consent first,
-- because completion now requires it. This is the call the new /onboarding/terms
-- screen makes.
select public.accept_terms();
select assert_eq((select terms_accepted_at is not null from public.my_onboarding_state()),
  true, 'step 1: accept_terms() records consent');

-- Step 2: the username, an ordinary UPDATE on a column 025 still grants.
update profiles set username = 'rookie' where id = auth.uid();
select assert_eq((select has_username from public.my_onboarding_state()),
  true, 'step 2: the username is an ordinary UPDATE and still works');

-- The gate is still shut, because completion has not happened. Asserted so the
-- path cannot pass by opening early.
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

-- And the gate opens. This one assertion is what the whole mode exists for: it
-- is the statement that failed with "permission denied for table profiles" when
-- the two migrations were first put in one database.
savepoint the_first_postcard;
insert into postcards (author_id, image_path, caption)
values ('00000000-0000-0000-0000-00000000000e',
        'postcards/00000000-0000-0000-0000-00000000000e/eeeeeeee-0000-4000-8000-00000000ab03.jpg', 'hi');
select assert_eq((select count(*)::int from postcards
                   where author_id = '00000000-0000-0000-0000-00000000000e'),
  1, 'THE PATH HOLDS: the rider who started with two NULL stamps has posted');
rollback to savepoint the_first_postcard;

rollback to savepoint the_whole_path;

-- ===========================================================================
-- §B. What the combination changes: the refusal moves outward
-- ===========================================================================

\echo ''
\echo '# The stamps are refused by the GRANT now, not by the trigger (023 + 025)'

-- The 023 solo suite asserts 23514 for both of these, and it is right to: without
-- 021 the client holds the column grant and reaches §4's guard. With 021 the
-- grant is gone and the statement never gets that far. Same rule, earlier layer,
-- different SQLSTATE — and asserting the old one here would silently test the
-- wrong thing.
select set_config('test.uid', '00000000-0000-0000-0000-000000000013', false);

select assert_denied($$
  update profiles set onboarding_completed_at = now()
   where id = '00000000-0000-0000-0000-000000000013'$$,
  'completion: refused as a missing column grant, before 023''s guard is reached');

select assert_denied($$
  update profiles set terms_accepted_at = now()
   where id = '00000000-0000-0000-0000-000000000013'$$,
  'consent: likewise — 012''s server-stamping is now unreachable rather than needed');

-- The upsert route to the same column, which 003, 012 and 023 all had to cover
-- separately. 021 closes it for free, because INSERT is granted by column too.
select assert_denied($$
  insert into profiles (id, onboarding_completed_at)
  values ('00000000-0000-0000-0000-000000000013', now())
  on conflict (id) do update set onboarding_completed_at = excluded.onboarding_completed_at$$,
  'and a PostgREST-style upsert cannot name the column either');

-- 023 §1.14's INSERT arm becomes belt-and-braces rather than the enforcement of
-- record: a rider cannot name the column on INSERT at all any more. It stays in
-- 023 because it is the rule that holds if a future migration ever re-grants,
-- and because it binds roles other than `authenticated`. Asserted as unreachable
-- rather than deleted as redundant.
select assert_denied($$
  insert into profiles (id, terms_accepted_at)
  values ('00000000-0000-0000-0000-00000000009e', now())$$,
  '023 §1.14''s INSERT arm is now unreachable for authenticated — grant, not trigger');

-- ===========================================================================
-- §C. The gate still holds, on both arms
-- ===========================================================================

\echo ''
\echo '# A rider with neither stamp cannot create anything (023 + 025)'

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

select assert_rejected($$
  insert into postcard_reports (reporter_id, postcard_id, reason)
  values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000e1', 'spam')$$,
  '23514', 'un-onboarded: postcard_reports refused');

\echo ''
\echo '# Onboarded but never consented is refused just the same (023 + 025)'

-- The state 3 of the 4 live riders are in, and the arm that makes the consent
-- prompt a precondition of applying 023 at all.
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
\echo '# With both stamps, all eight succeed (023 + 025)'

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

-- ===========================================================================
-- §D. The five deliberate omissions are still open
-- ===========================================================================

\echo ''
\echo '# The five uncovered tables still accept an un-onboarded rider (023 + 025)'

-- Named in 023's header with their reasons, so the omission is a decision. These
-- assertions are what stop it silently becoming an oversight later: a gate
-- landing on `blocks` would mean "finish the wizard before you can get away from
-- someone". The fifth, `profiles`, is covered by §E rather than here — a gate on
-- it would make onboarding unreachable, which is a stronger claim than an insert.
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

-- ===========================================================================
-- §E. Nobody is stranded — the failure mode this pair must not have
-- ===========================================================================

\echo ''
\echo '# A rider with NULL consent can still do everything the wizard needs (023 + 025)'

-- Three things must all be true for a NULL-consent rider, or the gate is
-- unshippable and the rider is locked out of the app by the very migration that
-- was meant to protect them. The consent prompt the route guard will send them
-- to needs all three.
select set_config('test.uid', '00000000-0000-0000-0000-000000000011', false);

-- (a) they can read their own position, which is what the guard routes on.
select assert_eq((select count(*)::int from public.my_onboarding_state()),
  1, 'stranded check (a): a NULL-consent rider can read their own state');
select assert_eq((select terms_accepted_at from public.my_onboarding_state()),
  null::timestamptz, '... and it correctly reports the missing consent');

-- (b) they can consent. This is the one the gate would otherwise make
-- impossible, since 023 refuses their writes and 021 refuses their UPDATE.
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

-- ===========================================================================
-- §F. The wiring, checked from the catalog
-- ===========================================================================

\echo ''
\echo '# Both migrations are wired the way they have to be (023 + 025)'

-- Catalog introspection, so the role is dropped back to the owner. It has to be:
-- `has_function_privilege` resolves `private.may_participate()` by name, and
-- `authenticated` has no USAGE on that schema by design (005) — the check itself
-- would answer 42501 rather than a boolean.
reset role;

select assert_eq(
  (select count(*)::int from pg_trigger
    where tgname = 'enforce_participation_gate' and not tgisinternal),
  8, 'eight gate triggers, one per gated table');

select assert_eq(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'enforce_participation_gate'
      and c.relname in ('blocks','postcard_hides','feed_reads','profile_countries','profiles')),
  0, 'and none of the five deliberate omissions acquired one');

select assert_eq(
  (select count(*)::int from pg_trigger
    where tgname = 'enforce_participation_gate' and not tgisinternal
      and pg_get_triggerdef(oid) ilike '%current_user%'),
  8, 'every gate trigger carries the WHEN guard that reads the invoking role');

-- The two halves of the security-definer question, and they point opposite ways.
-- 023's gate functions MUST be definer; 023's profile guard must NOT be, because
-- as definer its own `current_user <> 'authenticated'` early return would be true
-- on every call and it would enforce nothing while passing every positive test.
-- This is the clause 022 once shipped wrong, in the other direction.
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

-- 021's three, all definer, because 025 leaves nothing else able to reach the
-- two columns.
select assert_eq(
  (select count(*)::int from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('my_onboarding_state', 'accept_terms', 'complete_onboarding')
      and prosecdef and proconfig @> array['search_path=""']),
  3, '021''s three functions are security definer with a pinned search_path');

-- The grants, scoped to the grantee. `postgres` and `service_role` hold
-- everything by Supabase default, so anything counted table-wide reads wrong
-- against a correct database — the mistake 015's footer made and documented.
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

select assert_eq(has_function_privilege('anon', 'private.may_participate()', 'execute'),
  false, 'anon cannot call the gate helper');
select assert_eq(
  has_function_privilege('authenticated', 'public.enforce_participation_gate()', 'execute'),
  false, 'the trigger function is not callable as an RPC');
select assert_eq(has_function_privilege('anon', 'public.my_onboarding_state()', 'execute'),
  false, 'anon cannot call the accessor');
select assert_eq(has_function_privilege('anon', 'public.accept_terms()', 'execute'),
  false, 'anon cannot call accept_terms()');
select assert_eq(has_function_privilege('anon', 'public.complete_onboarding(text)', 'execute'),
  false, 'anon cannot call complete_onboarding()');

select assert_eq(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'profiles' and not t.tgisinternal),
  2, 'profiles carries the 003/012 UPDATE trigger and 023''s INSERT one');

-- The invariant every other suite section ends on. Neither migration changes a
-- policy's role targeting, and neither grants anon anything.
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
\echo 'All pending (023+025) assertions passed.'
