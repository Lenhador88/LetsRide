-- 021: the own-row accessors and writers for the two profile stamps.
--
-- =========================================================================
-- ** PURELY ADDITIVE. Safe to apply against the live project on its own. **
--
-- It creates three functions and changes nothing else — no grant is revoked,
-- no column is dropped, no policy or trigger moves. Nothing calls these
-- functions until the code repair deploys, so applying this file against the
-- database `main` is running today is a no-op from the application's point of
-- view. That property is the entire reason this file exists in this shape.
-- =========================================================================
--
-- =========================================================================
-- ** THIS FILE WAS SPLIT IN TWO ON 2026-08-05. READ THIS BEFORE THE REST. **
--
-- It used to be `021_profile_column_privileges.sql` and it used to contain both
-- halves of the change: these three functions AND
--
--   revoke select, insert, update on public.profiles from authenticated;
--
-- plus the column allowlist that replaces it. **Those have moved to
-- `025_profile_column_privileges.sql`, unchanged.** This file was renamed to
-- match what is left in it.
--
-- ---------------------------------------------------------------------------
-- Why — a deployment deadlock, and it is not visible from either half alone
-- ---------------------------------------------------------------------------
-- The two halves must be applied at different times *relative to the code
-- deploy*, and there is no ordering of one file that satisfies both:
--
--   New code + old database -> `proxy.ts` calls `my_onboarding_state()`, which
--     does not exist yet -> 42883 -> the guard's fail-closed branch bounces
--     EVERY signed-in rider to /auth/login?error=profile_unavailable.
--
--   Old code + new database -> the revoke lands and all four paths in §DEFECT 2
--     of 025's header break at once, starting with the same route guard.
--
-- So neither "deploy first" nor "apply first" works while both halves sit in one
-- file. The earlier header reasoned carefully about which *group* owned this
-- migration and never noticed it was two migrations. Split, each half has a
-- moment it is safe:
--
--   1. apply 021 (this file) — safe today, against `main` as it stands;
--   2. merge and deploy the code repair;
--   3. apply 023, then 025.
--
-- **Filename order equals apply order, deliberately.** `run.sh` applies by
-- filename, so a file whose local order differs from its hosted order is a class
-- of bug this repo has already hit — 025's header documents the `avatar_url`
-- case at length. 021 < 023 < 025 both here and on the hosted project.
--
-- ---------------------------------------------------------------------------
-- Editing history, since this file was revised rather than appended to
-- ---------------------------------------------------------------------------
-- The repo's rule is append-only: never edit an applied migration. Every edit
-- described above happened while this file had **never been applied to any
-- database** — `list_migrations` ended at `drop_legacy_avatar_url` and this file
-- had no row. Revising a draft is not rewriting history. Recorded loudly so a
-- later reader diffing against the first revision does not conclude the rule was
-- broken carelessly. **The moment this file appears in `list_migrations` that
-- licence expires** and every further change is a new numbered migration.
--
-- Two content changes were made in the same pass, both additive:
--   * the accessor was renamed `my_profile_stamps()` -> `my_onboarding_state()`
--     and gained a third output, `has_username`, so the route guard needs one
--     round trip rather than two. See §2.
--   * §3 is new: `accept_terms()` and `complete_onboarding(text)`.
-- =========================================================================
--
-- ---------------------------------------------------------------------------
-- What these functions are for
-- ---------------------------------------------------------------------------
-- RLS is row-level, not column-level. The `profiles` SELECT policy admits every
-- non-blocked rider who has a username, and therefore admits *every column* of
-- that row — including `terms_accepted_at` and `onboarding_completed_at`, a
-- rider's consent record and account lifecycle. `PUBLIC_PROFILE_COLUMNS` narrows
-- the projection in application code, which is a convention PostgREST does not
-- enforce: `select=*` on any member list returns the lot.
--
-- 025 closes that with a grant. A REVOKE, though, is not row-aware, and it takes
-- the two legitimate own-row *readers* down with the illegitimate ones — and it
-- takes away the wizard's only path to *writing* either stamp, which is the
-- defect that made the original single-file version unshippable in either order.
-- These three functions are what supply the row-awareness the grant cannot
-- express, in both directions:
--
--   my_onboarding_state()          read  — the caller's own position
--   accept_terms()                 write — the caller's own consent
--   complete_onboarding(text)      write — the caller's own final wizard step
--
-- They also resolve what used to be a standing incompatibility between 023 and
-- the revoke. 023 refuses every write from a rider whose two stamps are NULL;
-- the revoke removes the only path by which a *client* sets either one. §3 gives
-- the *database* that path, so the pair composes. `PENDING=023+025 npm test`
-- applies both and walks the whole rider path end to end.
--
-- **The two files ship together and are no longer independent.** §3 carries
-- 023 §1.13's rule (completion requires consent) in its own body, because §3
-- bypasses the trigger that would otherwise carry it — see the measurements in
-- §3's header.
-- ---------------------------------------------------------------------------
-- §2. The accessor that supplies the row-awareness a grant cannot express
-- ---------------------------------------------------------------------------
--
-- D6's point exactly: a REVOKE is not row-aware, so the two legitimate own-row
-- readers — the route guard and the onboarding resume step — get a function
-- instead. It takes no arguments, reads three facts about `auth.uid()`'s own row,
-- and can return at most one row. That is narrower than `moderate_comment`,
-- which the security advisors already accept and which 011 §1b argues for at
-- length; expect it to appear as a new `security definer` advisory finding, and
-- expect that to be the right outcome rather than a regression.
--
-- Returns zero rows for a caller with no session, since `auth.uid()` is NULL and
-- no profile row has a NULL id.
--
-- ---------------------------------------------------------------------------
-- Why it is named for the guard, and why `has_username` is here
-- ---------------------------------------------------------------------------
-- An earlier revision of this file called it `my_profile_stamps()` and returned
-- the two stamps only. `proxy.ts` runs on **every authenticated request** and
-- needs three facts, not two:
--
--   .select('username, location, onboarding_completed_at')
--
-- Two things about that line, both measured against `main` rather than assumed:
-- `location` is selected and never read — only `profile?.username` and
-- `profile?.onboarding_completed_at` are — so it is dead weight in the query;
-- and after 025, `onboarding_completed_at` is no longer selectable at all. A
-- two-output accessor would therefore leave the guard doing a table SELECT for
-- `username` **plus** an RPC for the stamps: two round trips on every request.
-- That is a real cost, not a stylistic one, so the accessor answers the guard's
-- whole question in one call and is named for that job.
--
-- **`has_username` widens nothing.** It is derived from `profiles.username`,
-- which 025 still grants `authenticated` column SELECT on, and it is strictly
-- less information than the column itself — a boolean about the caller's own
-- row, computed from a value that same caller may already read directly. The
-- security-relevant outputs are the two stamps, and they are exactly as narrow
-- as they were.
--
-- The consent stamp is in the return set for the same reason: with 023 §1.13 in
-- place the wizard's order is consent -> username -> location+completion, so the
-- guard has to be able to route a rider whose `terms_accepted_at` is NULL to the
-- consent step. Without it the guard can see that a rider is not finished and
-- not *where* they are stuck.

-- Belt and braces for a scratch database that applied an earlier revision of
-- this same never-applied file. `run.sh` drops and recreates its database on
-- every run, so this is a no-op there; it exists so a hand-built database does
-- not keep a second, narrower accessor alive beside the real one.
drop function if exists public.my_profile_stamps();

create or replace function public.my_onboarding_state()
returns table (
  terms_accepted_at       timestamptz,
  onboarding_completed_at timestamptz,
  has_username            boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.terms_accepted_at,
         p.onboarding_completed_at,
         p.username is not null
    from public.profiles p
   where p.id = (select auth.uid());
$$;

comment on function public.my_onboarding_state() is
  'Everything the route guard needs about the CALLER''s own onboarding position, and nobody else''s (021): both stamps plus whether a username has been chosen. security definer because 021 revokes column SELECT on the two stamps; takes no arguments, so there is no row to choose but your own. has_username is derived from a column authenticated may still read, so it widens nothing.';

revoke all on function public.my_onboarding_state() from public, anon;
grant execute on function public.my_onboarding_state() to authenticated;

-- ---------------------------------------------------------------------------
-- §3. The write side — the own-row writers
-- ---------------------------------------------------------------------------
--
-- 025 removes the client's UPDATE on both stamps. Something has to write them, or
-- decision #5 turns from "not skippable" into "not completable" (025 DEFECT 2b)
-- and consent stops being recorded at all (025 DEFECT 2c). These two functions
-- are that something: the stamps are written **by the database**, on the
-- caller's own row, with the value the server chooses.
--
-- They are additive on their own. Applied before 025, they sit unused beside the
-- column grants that still work; applied with it, they are the only path left.
--
-- ===========================================================================
-- FOUR THINGS MEASURED ON POSTGRES 16 BEFORE WRITING THIS, NOT RECALLED
-- ===========================================================================
-- Each was reproduced on a scratch database with the same shapes this schema
-- uses — a BEFORE UPDATE trigger carrying 003's `current_user <> 'authenticated'`
-- early return, a CHECK constraint in 018's shape, and an RLS policy that admits
-- one row and forbids another.
--
--   1. INSIDE A `security definer` FUNCTION, `current_user` IS THE OWNER.
--      Called by `authenticated`, the function body reports
--      `current_user = postgres`. Not `session_user`, which also reports the
--      owner here — both change.
--
--   2. THEREFORE 003's AND 012's GUARDS DO NOT RUN FOR WRITES ISSUED FROM HERE.
--      The trigger **fires** — this is not a case of the trigger being skipped —
--      and then takes its `if current_user <> 'authenticated' then return new`
--      branch and enforces nothing. Observed directly:
--
--        NOTICE:  IN SD FN: current_user=postgres
--        NOTICE:  TRIGGER FIRED: current_user=postgres
--        NOTICE:    -> guard SHORT-CIRCUITED, rule SKIPPED
--
--      This is the trap that matters, and it is invisible in a positive test:
--      every happy path passes whether or not the guard ran. So **each function
--      below re-states every invariant it depends on in its own body** —
--      username-and-location (003 §6), consent-before-completion (023 §1.13),
--      completion is one-way (003 §6b), and the consent stamp is server-timed
--      and immutable (012). Not one of them is inherited.
--
--   3. CHECK CONSTRAINTS DO STILL APPLY. `security definer` changes the *role*,
--      not the table's constraints. An empty `location` written from inside such
--      a function raised `23514 ... violates check constraint "t_loc_check"`.
--      So 018's `profiles_location_length` (1–100) is live here and this file
--      does not restate the ceiling — it restates only the floor, which it needs
--      anyway to reject a NULL argument that the CHECK deliberately permits.
--
--   4. RLS DOES NOT APPLY, AND THAT IS OWNERSHIP RATHER THAN SUPERUSER. Repeated
--      with a plain non-superuser, non-BYPASSRLS owner: the function still wrote
--      a row its caller's RLS policy explicitly forbade. Adding
--      `force row level security` to the table is what makes RLS apply again.
--      **So there is no policy backstop behind these two functions.** Every one
--      of them is pinned to `p.id = (select auth.uid())` in its own WHERE clause,
--      and that clause is the entire access control. It is the line to read
--      first in any future edit.
--
-- Their narrowness is the defence, exactly as 011 §1b argues for
-- `moderate_comment`: no arguments at all in one case, one text argument in the
-- other, no row selectable but the caller's own, and no timestamp accepted from
-- the caller in either — so a back-dated stamp is not refused, it is
-- unrepresentable.

-- Idempotent by contract: stamps the caller's consent only when it is currently
-- NULL, and returns the effective stamp either way. That is 012's rule (a)
-- "once set, the stamp is pinned" and rule (b) "the server says *when*", moved
-- into the only path that can still write the column.
--
-- `insufficient_privilege` rather than `check_violation` for the no-session case,
-- and the distinction is deliberate: a caller with no session has failed an
-- *authorization* check, not an integrity rule, and 42501 is what every other
-- refusal in this schema uses for that. It also keeps the two classes apart in
-- the suite — `assert_denied` recognises 42501, `assert_rejected('23514', ...)`
-- names the integrity rules — so an assertion cannot pass because the wrong rule
-- fired.
create or replace function public.accept_terms()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_stamp timestamptz;
begin
  if v_uid is null then
    raise exception 'accept_terms requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- The WHERE clause is the access control; see measurement 4 above.
  -- `terms_accepted_at is null` is what makes this idempotent rather than a
  -- re-stamp: a second call matches no row and falls through to the read below.
  update public.profiles p
     set terms_accepted_at = pg_catalog.now()
   where p.id = v_uid
     and p.terms_accepted_at is null
  returning p.terms_accepted_at into v_stamp;

  if v_stamp is not null then
    return v_stamp;
  end if;

  -- Either already accepted, or there is no profile row. Both return the
  -- effective value, which is the existing stamp or NULL respectively.
  select p.terms_accepted_at into v_stamp
    from public.profiles p
   where p.id = v_uid;

  return v_stamp;
end;
$$;

comment on function public.accept_terms() is
  'Records the CALLER''s T&C acceptance at server time, once (021 §3). Idempotent: a second call returns the first call''s stamp rather than moving it. Takes no arguments, so a back-dated or foreign consent record is unrepresentable rather than merely refused. security definer because 025 revokes the client''s UPDATE on the column.';

revoke all on function public.accept_terms() from public, anon;
grant execute on function public.accept_terms() to authenticated;

-- The wizard's final step, atomic: `location` and `onboarding_completed_at` land
-- in ONE statement, so there is no window in which a rider is stamped complete
-- with no location — the exact state 003 §6a exists to forbid.
--
-- Every invariant here is restated rather than inherited, per measurement 2.
-- The order of the checks is the wizard's own order — consent, then username,
-- then location — so the first thing that fails is the earliest step the rider
-- has not done, which is the one the route guard would send them back to.
create or replace function public.complete_onboarding(p_location text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_username text;
  v_terms    timestamptz;
  v_stamp    timestamptz;
begin
  if v_uid is null then
    raise exception 'complete_onboarding requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- `for update` so the read and the write below cannot be split by a concurrent
  -- call. The row is the caller's own and nobody else writes it, so there is no
  -- contention to speak of; this is here to remove the question rather than to
  -- resolve a measured problem.
  select p.username, p.terms_accepted_at, p.onboarding_completed_at
    into v_username, v_terms, v_stamp
    from public.profiles p
   where p.id = v_uid
     for update;

  -- 023 §1.13, carried here because the trigger that also carries it does not
  -- run for this statement (measurement 2). Without this line, the participation
  -- gate would be walked around by completing onboarding through the very RPC
  -- that 021 makes the only way to complete it.
  if v_terms is null then
    raise exception 'onboarding cannot be completed before the terms are accepted'
      using errcode = 'check_violation';
  end if;

  -- 003 §6a, same message and same errcode, because it is the same rule.
  -- The NULL arm is the one 018's CHECK cannot cover: `profiles_location_length`
  -- deliberately permits NULL, since every rider is NULL there between signup
  -- and step 2. The ceiling (100) is left to that CHECK, which measurement 3
  -- confirms still fires from inside a security definer function.
  if v_username is null
     or p_location is null
     or pg_catalog.length(pg_catalog.btrim(p_location)) < 1 then
    raise exception 'onboarding cannot be completed before username and location are set'
      using errcode = 'check_violation';
  end if;

  -- 003 §6b: completion is a one-way door. `coalesce` over the OLD value is what
  -- pins it — re-running this updates the location and returns the ORIGINAL
  -- stamp, so a later profile edit can never re-date a rider's completion.
  --
  -- `coalesce` is deliberately NOT schema-qualified, unlike every other name in
  -- this file. It is a SQL construct rather than a function — there is no
  -- `pg_catalog.coalesce`, and writing one raises 42883 at runtime, which is a
  -- failure the happy path reaches and no amount of reading catches. Measured:
  -- the first version of this line had it, and the 101-character location
  -- assertion is what found it. The same applies to NULLIF, GREATEST, LEAST and
  -- CASE; it does not apply to `length` or `btrim`, which are real catalog
  -- functions and are qualified above.
  update public.profiles p
     set location                = p_location,
         onboarding_completed_at = coalesce(p.onboarding_completed_at,
                                            pg_catalog.now())
   where p.id = v_uid
  returning p.onboarding_completed_at into v_stamp;

  return v_stamp;
end;
$$;

comment on function public.complete_onboarding(text) is
  'The onboarding wizard''s final step (021 §3): sets the CALLER''s location and completion stamp in one statement. Restates every invariant it depends on — consent first (023 §1.13), username and a non-empty location (003 §6a), completion one-way (003 §6b) — because a security definer function runs as its owner and 003''s trigger guard short-circuits for it. Accepts no timestamp, so completion cannot be back-dated.';

revoke all on function public.complete_onboarding(text) from public, anon;
grant execute on function public.complete_onboarding(text) to authenticated;


-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 3 rows, every `prosecdef = t` and every `proconfig` holding
-- `search_path=""` — note the literal quotes, which is how Postgres stores it;
-- matching on `search_path=` finds nothing and reads as a passing test.
--
-- This is the diff-what-landed-against-what-was-committed check, and it is not
-- ceremony: `apply_migration` takes SQL as an argument rather than a path, so the
-- file and the database can silently disagree by one clause — and on these three
-- the security-relevant clause IS `security definer`. Without it, 025 leaves
-- nothing able to write either stamp and the wizard is a dead end. 022 shipped
-- this exact class of defect once, in the other direction.
--
--   select proname, prosecdef, proconfig from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('my_onboarding_state','accept_terms','complete_onboarding');
--
-- Expected: f, f, f — anon gains nothing here, as everywhere.
--   select has_function_privilege('anon','public.my_onboarding_state()','execute'),
--          has_function_privilege('anon','public.accept_terms()','execute'),
--          has_function_privilege('anon','public.complete_onboarding(text)','execute');
--
-- Expected: t, t, t — and authenticated gains exactly these three.
--   select has_function_privilege('authenticated','public.my_onboarding_state()','execute'),
--          has_function_privilege('authenticated','public.accept_terms()','execute'),
--          has_function_privilege('authenticated','public.complete_onboarding(text)','execute');
--
-- Expected: 0 — the earlier revision's two-output accessor is not left behind
-- beside the real one.
--   select count(*) from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'my_profile_stamps';
--
-- Expected: t, t, t, t — this file is additive, so every grant the application
-- reads today is still in place after it. If any of these is false, something
-- from 025 has leaked into this file.
--   select has_table_privilege('authenticated','public.profiles','select'),
--          has_column_privilege('authenticated','public.profiles','onboarding_completed_at','select'),
--          has_column_privilege('authenticated','public.profiles','onboarding_completed_at','update'),
--          has_column_privilege('authenticated','public.profiles','terms_accepted_at','update');
--
-- Expect ONE new security-advisor finding after this applies, and expect it to
-- be correct rather than a regression: three `security definer` functions. 011
-- §1b argues the case for that shape at length for `moderate_comment`, which the
-- advisors already accept. These are narrower — no arguments at all in two of
-- them, one text argument in the third, and no row reachable but the caller's.
