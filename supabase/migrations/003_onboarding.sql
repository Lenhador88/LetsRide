-- 003: Login & Onboarding schema
--
-- Spec: docs/specs/login-onboarding.md (§Data, Q2/Q3/Q4/Q9/Q11/Q22).
-- The spec calls this migration "002"; 002 was taken by the anon lockdown, so
-- the same content lands here as 003. Q23 (pin the profiles select policy to
-- `authenticated`) was already delivered by 002 and is not repeated.
--
-- !! COORDINATED DEPLOY !!  This migration DROPS profiles.full_name, which is
-- referenced 29 times across 10 application files (src/types/index.ts, the
-- dashboard / profile / friends / rides / rides[id] / clubs[id] pages, the
-- signup page, EditProfileForm.tsx, SearchRiders.tsx). SearchRiders.tsx also
-- filters on `full_name.ilike.%...%`, which becomes a hard Postgres error the
-- moment the column is gone. Apply this ONLY together with the call-site fixes
-- in the same PR — see Q5. Applying 003 against the current `main` breaks the
-- running app.
--
-- Settled decisions carried in here:
--   #5 onboarding is required and not skippable -> the gate lives in the schema
--   #6 email confirmation is off               -> signup yields a live session
--   #7 username replaces full_name             -> username is the only display name

-- ---------------------------------------------------------------------------
-- 1. profiles: drop full_name
-- ---------------------------------------------------------------------------
-- Q22: no backfill. Pre-launch, there are no real users and nothing in
-- full_name is worth preserving. Username is the display name everywhere.

alter table public.profiles drop column if exists full_name;

-- ---------------------------------------------------------------------------
-- 2. profiles: username becomes nullable
-- ---------------------------------------------------------------------------
-- Q2: the profile row is created by a trigger the instant auth.users gets a
-- row, but the username is not chosen until onboarding step 1. NULL is the
-- honest representation of "not chosen yet" — inventing a placeholder would
-- burn a name the user never picked and make "has this user onboarded?"
-- unanswerable. Postgres unique indexes permit unlimited NULLs, so uniqueness
-- is unaffected.

alter table public.profiles alter column username drop not null;

-- ---------------------------------------------------------------------------
-- 3. profiles: new columns
-- ---------------------------------------------------------------------------
-- onboarding_completed_at (Q3) — the gate. NULL = incomplete. A timestamp
--   rather than a boolean gives a free audit trail at identical cost.
--   Resume *position* is derived from field nullness (username -> location ->
--   done), but *completion* is stored explicitly. If completion were also
--   derived, a user who later cleared their location from the profile editor
--   would be thrown back into the wizard. Derived position, explicit completion.
--
-- location (Q11) — onboarding step 2. Free text, no geocoding, no structured
--   city/country. Revisit when rider-ux needs proximity search.
--
-- terms_accepted_at (Q9) — the signup checkbox is a consent record and has to
--   outlive the client-side form state. Written by the signup flow right after
--   sign-up succeeds (the "Users can update their own profile" policy from 002
--   covers it); deliberately NOT written by the trigger, see §5.

alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;

comment on column public.profiles.onboarding_completed_at is
  'NULL = onboarding incomplete; proxy.ts gates every app route on this. Set once, at the end of the wizard; enforced one-way by enforce_onboarding_completion().';

-- ---------------------------------------------------------------------------
-- 4. username: case-insensitive uniqueness, charset and length
-- ---------------------------------------------------------------------------
-- Q4. The `unique` constraint from 001 is case-SENSITIVE, so `Ripper` and
-- `ripper` can both exist today. Usernames are the only display name in the
-- app (#7) — they appear on postcard bylines, chat, member lists and ride
-- crews with no other identifier alongside them. Two names that differ only by
-- case are indistinguishable to a human reading a member list, which makes
-- registering the case-variant of an existing rider a working impersonation
-- vector. Uniqueness must therefore be enforced on lower(username), not on the
-- raw value.
--
-- Existing rows may violate the new rules: 001's trigger derived usernames from
-- the email local part, which can contain dots, plus signs and capitals. Rather
-- than mangle them into something the user never chose, any non-conforming
-- username is set back to NULL — that row simply resumes at onboarding step 1
-- and picks a real name. Safe pre-launch (Q22); it would be a data-loss event
-- with real users and must not be re-run against a populated database.

update public.profiles
   set username = null
 where username is not null
   and username !~ '^[a-z0-9_]{3,20}$';

alter table public.profiles drop constraint if exists profiles_username_key;

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- Not partial (`where username is not null`) on purpose: the availability
-- check runs `where lower(username) = $1`, and relying on the planner to prove
-- that predicate implies NOT NULL is a needless bet. NULL entries cost little.

alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');

-- Reserved names (Q4). In the database rather than only in the client because
-- the client is not a trust boundary — a direct PostgREST call would otherwise
-- register `admin`. Trade-off: extending the list needs a migration. That is
-- the right side of the trade for a list this stable; if it starts churning,
-- move it to a `reserved_usernames` table and check it from a trigger.
-- The charset constraint above already forces lowercase, so a lowercase list
-- is exhaustive.

alter table public.profiles
  add constraint profiles_username_not_reserved
  check (
    username is null or username not in (
      'admin', 'support', 'letsride', 'me', 'new', 'settings',
      'auth', 'onboarding', 'legal', 'api',
      'dashboard', 'rides', 'clubs', 'friends', 'profile', 'inbox', 'garage'
    )
  );

-- ---------------------------------------------------------------------------
-- 5. handle_new_user(): minimal insert
-- ---------------------------------------------------------------------------
-- The old body wrote full_name (dropped above) and fell back to
-- split_part(new.email, '@', 1) for the unique username. That fallback is a
-- live bug: dave@gmail.com and dave@yahoo.com both resolve to `dave`, the
-- second signup's trigger raises a unique violation, the whole auth.users
-- insert rolls back, and Supabase surfaces it as "Database error saving new
-- user". The account is never created and the message tells the user nothing.
--
-- The fix is to stop guessing. The trigger's only job is to guarantee a
-- profile row exists for every auth user; onboarding owns every field in it.
--
-- security definer + `set search_path = ''` are carried over from 002: without
-- a pinned search_path a caller could shadow `profiles` with their own table
-- and have it written with the function owner's rights. Every name stays
-- schema-qualified so an empty search_path still resolves.
--
-- `on conflict do nothing` because anything this trigger raises aborts account
-- creation entirely. There is no failure mode here worth blocking a signup for.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The trigger from 001 (on_auth_user_created) is unchanged and still bound to
-- this function; create or replace keeps it wired.

-- ---------------------------------------------------------------------------
-- 6. The onboarding gate must not be client-writable
-- ---------------------------------------------------------------------------
-- Decision #5: a user who has not completed onboarding cannot reach any app
-- route. The spec rejects storing that flag in user_metadata because the client
-- can write it via supabase.auth.updateUser() and mark itself onboarded — but
-- profiles.onboarding_completed_at has exactly the same exposure, since the
-- "Users can update their own profile" policy lets a rider PATCH any column on
-- their own row. Without this trigger the gate is decorative: a hand-rolled
-- PostgREST call sets the timestamp and walks past the wizard with a NULL
-- username, producing precisely the broken rows Q5 describes.
--
-- Two rules, enforced only for the `authenticated` role so that service_role
-- and the table owner can still fix rows during support work:
--   a) completion cannot be claimed before username and location are set;
--   b) completion is a one-way door — it cannot be cleared or back-dated, so a
--      later profile edit can never re-gate a rider (the reason completion is
--      stored rather than derived in the first place).

create or replace function public.enforce_onboarding_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if old.onboarding_completed_at is not null then
    new.onboarding_completed_at := old.onboarding_completed_at;
    return new;
  end if;

  if new.onboarding_completed_at is not null
     and (new.username is null or new.location is null) then
    raise exception 'onboarding cannot be completed before username and location are set'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_onboarding_completion on public.profiles;

create trigger enforce_onboarding_completion
  before update on public.profiles
  for each row execute function public.enforce_onboarding_completion();

-- ---------------------------------------------------------------------------
-- 7. Half-finished profiles are visible only to their owner
-- ---------------------------------------------------------------------------
-- A row with a NULL username is a rider who has not chosen a name yet. It has
-- nothing worth showing and would surface as a blank entry in rider search and
-- any member list. Tightened rather than left to UI filtering, so no future
-- query can leak the ghost rows. Still `to authenticated` — 002's rule stands,
-- no policy on this schema ever names `anon`.
--
-- Safe by construction: a rider mid-onboarding cannot reach any app route
-- (#5), so they cannot yet be an organizer, club owner or crew member, and no
-- join can be starved by hiding them. They can always read their own row,
-- which is what every onboarding step needs.

drop policy if exists "Profiles are viewable by signed-in riders" on public.profiles;

create policy "Profiles are viewable by signed-in riders"
  on public.profiles for select to authenticated
  using (auth.uid() = id or username is not null);

-- ---------------------------------------------------------------------------
-- Verification (run manually against the hosted project after apply)
-- ---------------------------------------------------------------------------
-- This migration is written and has not yet been applied to the hosted
-- project. It was validated on a throwaway Postgres cluster with a stub `auth`
-- schema and the anon/authenticated/service_role roles: 001 -> 002 -> 003
-- applied in order, both pre-existing bugs reproduced first (case-variant
-- `Ripper`/`ripper` coexisting, and dave@yahoo.com failing with "duplicate key
-- ... profiles_username_key" from inside the trigger), then shown fixed.
--
-- Every negative case below is now also an assertion in
-- supabase/tests/rls_test.sql, which applies the whole chain to a scratch
-- database on every PR. The checks are kept here because the suite runs on
-- plain Postgres and cannot see role grants, PostgREST exposure or Supabase
-- defaults — re-run them against the real project after apply, and check the
-- security advisors, because a local stub is not the production environment.
--
-- Shape — expect username nullable, no full_name, three new columns:
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles'
--   order by ordinal_position;
--
-- Case-insensitive uniqueness. Note what actually rejects what: the charset
-- constraint forbids uppercase, and Postgres evaluates CHECK constraints before
-- it reaches the index, so `Ripper` fails as a check_violation (23514) and
-- never touches profiles_username_lower_key. The two rules overlap on purpose —
-- the index is the one that would still hold if the charset rule were ever
-- relaxed to allow capitals — but a verification that only tries `Ripper` is
-- testing the check constraint, not the index, and would pass just as happily
-- against 001's case-sensitive unique(username).
--
-- Uniqueness itself, expect "duplicate key value violates unique constraint
-- profiles_username_lower_key" on the second statement:
--
--   update public.profiles set username = 'ripper' where id = '<uuid-a>';
--   update public.profiles set username = 'ripper' where id = '<uuid-b>';
--
-- The case-folding half cannot be observed while the charset check is in place.
-- supabase/tests/rls_test.sql isolates it by dropping profiles_username_format
-- inside a savepoint and then attempting `Clubowner` against an existing
-- `clubowner`; that is the assertion to trust, not a manual `Ripper` attempt.
--
-- Charset / length / reserved — every one of these must fail:
--
--   update public.profiles set username = 'ab'                    where id = '<uuid>';  -- too short
--   update public.profiles set username = 'twenty_one_chars_long_' where id = '<uuid>';  -- too long
--   update public.profiles set username = 'has space'             where id = '<uuid>';  -- illegal char
--   update public.profiles set username = 'Ripper'                where id = '<uuid>';  -- uppercase
--   update public.profiles set username = 'admin'                 where id = '<uuid>';  -- reserved
--
-- Trigger no longer guesses a username — expect one row, username NULL:
--
--   select id, username, onboarding_completed_at from public.profiles
--   where id = (select id from auth.users order by created_at desc limit 1);
--
-- The email-collision bug is gone — both signups must succeed and yield two
-- profile rows with NULL usernames (run via the auth API, not raw SQL):
--
--   signup dave@gmail.com ; signup dave@yahoo.com
--
-- NEGATIVE: the onboarding gate cannot be forged from the client. Expect
-- "onboarding cannot be completed before username and location are set":
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<uuid-mid-onboarding>","role":"authenticated"}';
--     update public.profiles set onboarding_completed_at = now()
--     where id = '<uuid-mid-onboarding>';
--   rollback;
--
-- NEGATIVE: completion cannot be cleared to re-trigger the wizard. Expect the
-- select to still show the ORIGINAL timestamp, not NULL:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<uuid-onboarded>","role":"authenticated"}';
--     update public.profiles set onboarding_completed_at = null
--     where id = '<uuid-onboarded>';
--     select onboarding_completed_at from public.profiles where id = '<uuid-onboarded>';
--   rollback;
--
-- NEGATIVE: another signed-in rider cannot see a profile that has no username
-- yet. Expect zero rows:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<uuid-other-rider>","role":"authenticated"}';
--     select id from public.profiles where id = '<uuid-mid-onboarding>';
--   rollback;
--
-- NEGATIVE: the same rider CAN see their own unfinished row. Expect one row:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<uuid-mid-onboarding>","role":"authenticated"}';
--     select id, username from public.profiles where id = '<uuid-mid-onboarding>';
--   rollback;
--
-- NEGATIVE: anon still holds nothing (002's guarantee, re-checked because this
-- migration recreated a policy). Both must return zero rows:
--
--   select tablename, policyname, roles from pg_policies
--   where schemaname = 'public' and not (roles = '{authenticated}');
--
--   select table_name, privilege_type from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';
