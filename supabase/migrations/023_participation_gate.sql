-- 023: onboarding and consent gate participation, not just navigation.
--
-- =========================================================================
-- ** APPLIED 2026-08-05, after the consent prompt deployed. **
--
-- Everything below the next rule is the header as written *before* it was
-- applied, kept because its reasoning is the record of why the order was what
-- it was. Read it as history, not as instructions. Two of its claims are now
-- false and would mislead:
--
--   * "NOT APPLIED" — it is. `list_migrations` shows 27 rows against 27 files,
--     zero drift. Do not apply it again.
--   * "Its assertions live in supabase/tests/rls_test_pending_023.sql; run them
--     with PENDING=023 npm test" — that file is gone and the PENDING modes with
--     it. The assertions are in `rls_test.sql` and `npm test` runs them, along
--     with every other migration's, against the full 27-file chain. `run.sh`
--     refuses a `PENDING=` invocation rather than ignoring it.
--
-- The banner is added rather than the text corrected in place because a
-- migration file is append-only by CLAUDE.md's rule, and because the sequencing
-- argument below is the most reusable thing in it.
-- =========================================================================
--
-- ** NOT APPLIED. DO NOT APPLY THIS FILE UNTIL A CONSENT PROMPT EXISTS. **
--
-- All 4 riders on the hosted project have `terms_accepted_at` NULL (measured
-- 2026-08-05, again at write time). Applying this locks every one of them out
-- of creating anything — including the product owner.
--
-- The proposal's ruling is explicit and this file obeys it: **NO BACKFILL. No
-- migration may write a consent timestamp on a rider's behalf.** A fabricated
-- consent record is worse than a missing one, which is 012's own argument —
-- evidence a party can write is not evidence. So the sequence is: a minimal
-- consent prompt for a rider whose stamp is NULL ships first (one screen, one
-- user — task 2.3), then this applies.
--
-- Listed in SKIP_MIGRATIONS in supabase/tests/run.sh. Its assertions live in
-- supabase/tests/rls_test_pending_023.sql; run them with `PENDING=023 npm test`.
--
-- ** RESOLVED 2026-08-05 — 023 and the profile revoke are no longer incompatible. **
-- This file used to say "021 and 023 cannot both be applied as drafted — 023
-- requires two stamps that 021 removes the only client path to setting. That is
-- why there is no mode applying both, and it is 021's problem to resolve rather
-- than this file's." It was resolved, and then `021` was split in two, so the
-- names have moved — read the resolution rather than the old numbers:
--
--   021_onboarding_state_accessors      APPLIED, purely additive. Holds
--                                       `accept_terms()` and
--                                       `complete_onboarding(text)`, which give
--                                       the *database* the write path to the two
--                                       stamps.
--   025_profile_column_privileges       PENDING. Holds the revoke that takes that
--                                       path away from the *client*.
--
-- So the pair that must compose is **023 and 025**, and there is a mode applying
-- both — `PENDING=023+025 npm test` — which walks the whole rider path end to
-- end. 021 is no longer pending at all.
--
-- Nothing in this file changed to achieve that. What changed is that the wizard
-- has a way to reach the stamps this gate requires. Two consequences worth
-- carrying, both asserted in the combined suite:
--
--   * With 025 applied, a direct `update profiles set onboarding_completed_at`
--     is refused as **42501** (no column grant) rather than reaching §4's guard
--     and being refused as 23514. The rule is unchanged; the layer that enforces
--     it moves outward, and it fails *earlier*.
--   * §4's guard therefore stops being the enforcement of record for anything
--     the client can reach. `complete_onboarding()` restates §1.13's rule in its
--     own body, because a `security definer` function runs as its owner and this
--     guard's `current_user <> 'authenticated'` early return short-circuits for
--     it. Measured, not assumed — see 021's §3.
-- =========================================================================
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against the hosted project 2026-08-05
-- ---------------------------------------------------------------------------
--   profiles .................................................. 4
--   with terms_accepted_at NULL ............................... 4   <-- all
--   with onboarding_completed_at NULL ......................... 1
--   onboarded but with no consent ............................. 3
--
--   select count(*) from public.profiles where terms_accepted_at is null;
--
-- ** NOT RE-MEASURED 2026-08-05 (second pass). ** The session that added 021's §3
-- had no credential able to read these counts: `anon` holds zero grants on
-- `public.profiles` (verified live — 42501, which is decision #1 holding), and
-- reading them needs a rider session or `service_role`, which must never enter
-- this repo. The numbers above are therefore CARRIED FORWARD, not confirmed.
-- **Re-run the count at apply time**; it is the check that decides whether
-- applying this file is safe, and a stale 4-of-4 would be exactly as misleading
-- as a stale 0-of-4.
--
-- Q12 established that this is provenance rather than a broken write: the owner
-- predates 003 by two days, two rows are `.test` fixtures SQL-inserted straight
-- into auth.users, and the fourth matches signUp's own documented consent-failure
-- path exactly. Recorded here because "4 of 4" reads like an alarm and is not one.
--
-- ---------------------------------------------------------------------------
-- What is wrong today
-- ---------------------------------------------------------------------------
-- Decision #5 says onboarding is required and not skippable, and `proxy.ts` is
-- its **only** enforcement. No policy stops a rider whose `onboarding_completed_at`
-- is NULL from inserting a postcard, creating a club or a ride, or joining
-- anything; 003's trigger guards the *stamp*, never the participation. The
-- client-rendered shell demotes that route guard to a UX affordance — so
-- decision #5 would be held up by nothing at all.
--
-- It is not only a rule violation, it is visibly broken data: an un-onboarded
-- rider has a NULL username, which the `profiles` SELECT policy uses to hide
-- them — so their postcards would render for everyone else with an author
-- nobody can resolve.
--
-- Consent is the second half and is stronger than a product rule. CLAUDE.md
-- names three things the client must not own: username charset, the completion
-- stamp, and T&C acceptance. 003 delivered the first two. 012 made the consent
-- stamp immutable and server-timed **once written** — but nothing anywhere ever
-- *requires* it to be written. The rule lives in `signUpSchema`'s
-- `z.literal(true)` and in the `signUp` action, both of which are client-side
-- the moment the client owns signup. This is an EU project and the column is
-- evidence.
--
-- ---------------------------------------------------------------------------
-- One helper, eight triggers — and why not eight WITH CHECKs
-- ---------------------------------------------------------------------------
-- A `WITH CHECK` addition on eight INSERT policies is eight policy edits to keep
-- in step forever, and each one would restate the same predicate. A BEFORE
-- INSERT trigger calling one `security definer` helper is one rule in one place.
-- The helper reads the caller's own `profiles` row, which the caller can already
-- read, so it is `security definer` for *stability* rather than for privilege —
-- a narrower case than `moderate_comment`, which the advisors already accept.
--
-- ---------------------------------------------------------------------------
-- Which tables, and — stated rather than left as silence — which not
-- ---------------------------------------------------------------------------
-- Thirteen tables carry an INSERT policy. This gate names eight:
--
--   postcards, clubs, rides, club_members, ride_members, postcard_comments,
--   postcard_likes, postcard_reports
--
-- The five it does not, each with its reason:
--
--   blocks ............. safety, and it protects the un-onboarded rider too. A
--                        gate here would mean "finish the wizard before you can
--                        get away from someone".
--   postcard_hides ..... per-viewer. A row only ever removes a postcard from its
--                        own user_id's feed; nobody else can observe it.
--   feed_reads ......... a read watermark. Produces nothing anyone sees.
--   profile_countries .. a fact about the rider's own profile, on the profile
--                        the wizard is in the middle of building.
--   profiles ........... the row the wizard itself writes. Gating it would make
--                        onboarding unreachable, which is the one failure mode
--                        this whole change must not have.
--
-- `postcard_reports` is in the gated list by explicit decision rather than by
-- pattern-matching. A report names another rider in a record nobody can triage —
-- there is no admin role — and with email confirmation off (decision #6) an
-- account can be created with an address nobody controls. An un-onboarded rider
-- filing reports is the cheapest abuse path in the schema.
--
-- ---------------------------------------------------------------------------
-- Reads are untouched, so nobody is stranded
-- ---------------------------------------------------------------------------
-- This restricts INSERT only. Every SELECT policy is unchanged, and the two
-- onboarding writes are UPDATEs to the rider's own `profiles` row, which the
-- gate does not cover. The design's pre-flight confirms there is nothing to
-- reject retroactively: the one live un-onboarded rider owns zero postcards,
-- clubs, rides, memberships and comments.

-- ---------------------------------------------------------------------------
-- §1. The helper
-- ---------------------------------------------------------------------------
--
-- Both stamps, one function, because "may this rider participate" is one
-- question. Returns false for a caller with no session — `auth.uid()` is NULL
-- and no profile row has a NULL id — which is the right answer and not an
-- accident of the query shape.
--
-- `security definer` is for stability today and for privilege the moment 025
-- lands, which revokes column SELECT on both stamps from `authenticated`. Worth
-- stating both ways round: an earlier draft justified it as "stability only,
-- since the caller can already read their own row", and that sentence stops
-- being true one migration away.

create or replace function private.may_participate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.onboarding_completed_at is not null
       and p.terms_accepted_at is not null
  );
$$;

comment on function private.may_participate() is
  'Has the caller finished onboarding AND accepted the terms (023)? security definer for stability rather than privilege — the caller can already read their own row. In `private` so PostgREST does not publish it.';

revoke all on function private.may_participate() from public, anon;
grant execute on function private.may_participate() to authenticated;

-- ---------------------------------------------------------------------------
-- §2. The trigger function the eight tables share
-- ---------------------------------------------------------------------------
--
-- Bound to `authenticated`, exactly as 012's guard is, and for the same reason:
-- everything here is a rule about what the *client* may write. The seed, the
-- migration role and any future admin repair run as other roles and pass
-- straight through, which is what keeps the database fixable from the dashboard.
-- (022's trigger deliberately does *not* have this escape, because that one is
-- an invariant about what the table may contain rather than about who is asking.
-- The difference is worth noticing before copying either.)
--
-- **But the role guard cannot live in the body, and that is not a style choice.**
-- The function must be `security definer` for two independent reasons: `private`
-- has no USAGE for `authenticated` (005), and a plpgsql body resolves
-- `private.may_participate` by name at prepare time — the same failure 022 hit;
-- and once 025 lands, `authenticated` has no column SELECT on the two stamps at
-- all, so an invoker-rights read of them is 42501. Inside a `security definer`
-- function `current_user` is the function's owner, so a body-level
-- `current_user <> 'authenticated'` check would be true on **every** call and the
-- gate would never fire once — passing every positive test and enforcing nothing.
--
-- So the guard moves to the trigger's WHEN clause, which is evaluated in the
-- *caller's* context before the function is entered. Verified on Postgres 16:
-- with `when (current_user = 'r')`, an insert by the table owner skips the
-- trigger entirely and an insert by `r` fires it and resolves the private schema
-- correctly.
--
-- `check_violation` rather than `insufficient_privilege`: an assertion that
-- accepted "any error" would pass when the wrong rule fired, and 42501 is
-- indistinguishable from an ordinary RLS denial. 003's completion guard already
-- uses 23514 for the same reason.

create or replace function public.enforce_participation_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.may_participate() then
    raise exception
      'complete onboarding and accept the terms before writing to %', tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- It is a trigger function; nothing should ever call it directly, and leaving it
-- executable would put a security definer function on the exposed API surface
-- for no reason. 022 does the same for its two.
revoke all on function public.enforce_participation_gate() from public, anon, authenticated;

comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, eight BEFORE INSERT triggers; the five uncovered INSERT-policy tables are named in the migration header with their reasons.';

-- ---------------------------------------------------------------------------
-- §3. The eight triggers
-- ---------------------------------------------------------------------------

drop trigger if exists enforce_participation_gate on public.postcards;
create trigger enforce_participation_gate
  before insert on public.postcards
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.clubs;
create trigger enforce_participation_gate
  before insert on public.clubs
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.rides;
create trigger enforce_participation_gate
  before insert on public.rides
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.club_members;
create trigger enforce_participation_gate
  before insert on public.club_members
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.ride_members;
create trigger enforce_participation_gate
  before insert on public.ride_members
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.postcard_comments;
create trigger enforce_participation_gate
  before insert on public.postcard_comments
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.postcard_likes;
create trigger enforce_participation_gate
  before insert on public.postcard_likes
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

drop trigger if exists enforce_participation_gate on public.postcard_reports;
create trigger enforce_participation_gate
  before insert on public.postcard_reports
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- ---------------------------------------------------------------------------
-- §4. Completion requires consent (task 1.13), and the INSERT arm 012 deferred
--     (task 1.14)
-- ---------------------------------------------------------------------------
--
-- Two changes to `enforce_onboarding_completion`, and the whole function is
-- restated because that is what `create or replace` means.
--
-- **1.13** — 003's completion guard checks `username` and `location`. It now
-- also checks `terms_accepted_at`, in the same `check_violation` shape, so the
-- gate above cannot be walked around by completing onboarding without ever
-- having consented. Without it §1's two conditions collapse into one in
-- practice, since completion is the easier of the two to reach.
--
-- **1.14** — 012 §KNOWN LIMIT recorded that its consent guard is a BEFORE
-- **UPDATE** trigger, and that 002's "Users can insert their own profile" policy
-- still exists. Nothing fires on the INSERT path. That is unreachable *today*
-- only because `handle_new_user` guarantees the row already exists, so a rider's
-- own INSERT dies on 23505 — not because anything checks. Account deletion is a
-- Phase 2 dependency of this very change, and the day it removes a `profiles`
-- row without its `auth.users` row, that rider can insert a fresh one carrying
-- any consent timestamp they like.
--
-- 012 left it because "an assertion cannot currently be written against a path
-- 23505 blocks". That is no longer true: the fixture can be deleted and
-- re-inserted inside a savepoint, which is what the pending suite does.
--
-- ORDER IS STILL LOAD-BEARING, and 012's warning applies unchanged: the consent
-- block sits **above** the `old.onboarding_completed_at is not null` early
-- return. Below it, the guard would never run for an onboarded rider — that is,
-- for every rider it is meant to protect.
--
-- `handle_new_user` is unaffected: it is `security definer` owned by `postgres`,
-- so `current_user` is not `authenticated` while it runs and the guard returns
-- early. Signup is untouched.

create or replace function public.enforce_onboarding_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Everything below is a rule about what the *client* may write. The seed, the
  -- signup trigger and any future admin task run as other roles and pass
  -- straight through, which is what keeps this fixable from the dashboard.
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- 023 §1.14: the INSERT arm. `old` does not exist here, hence the TG_OP guard
  -- 012 named as the reason it deferred this.
  if tg_op = 'INSERT' then
    -- A row cannot be born with a chosen consent timestamp. Same rule as the
    -- first-acceptance branch below: the client says *that* it accepted, the
    -- server says *when*.
    if new.terms_accepted_at is not null then
      new.terms_accepted_at := pg_catalog.now();
    end if;

    if new.onboarding_completed_at is not null then
      if new.username is null or new.location is null then
        raise exception 'onboarding cannot be completed before username and location are set'
          using errcode = 'check_violation';
      end if;
      if new.terms_accepted_at is null then
        raise exception 'onboarding cannot be completed before the terms are accepted'
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  if old.terms_accepted_at is not null then
    -- One-way, exactly like completion below: consent already given cannot be
    -- withdrawn by rewriting the record of it. Withdrawing consent is a real
    -- product action and would be a deletion flow, not a null.
    new.terms_accepted_at := old.terms_accepted_at;
  elsif new.terms_accepted_at is not null then
    -- First acceptance: the client says *that* it accepted, the server says
    -- *when*. src/lib/actions/auth.ts sends its own ISO string; it is discarded
    -- here on purpose, so the two do not have to be trusted to agree.
    new.terms_accepted_at := pg_catalog.now();
  end if;

  if old.onboarding_completed_at is not null then
    new.onboarding_completed_at := old.onboarding_completed_at;
    return new;
  end if;

  if new.onboarding_completed_at is not null then
    if new.username is null or new.location is null then
      raise exception 'onboarding cannot be completed before username and location are set'
        using errcode = 'check_violation';
    end if;

    -- 023 §1.13. Note this reads `new`, not `old`: the branch above has already
    -- resolved what the row's consent stamp will actually be, so a rider
    -- accepting the terms and finishing the wizard in one statement is
    -- permitted, and one who never accepted is not.
    if new.terms_accepted_at is null then
      raise exception 'onboarding cannot be completed before the terms are accepted'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_onboarding_completion() is
  'Guards the two profile stamps the client must not own (CLAUDE.md): onboarding_completed_at cannot be claimed early, cleared or back-dated (003) and now cannot be claimed without consent (023 §1.13); terms_accepted_at is server-stamped on first write and immutable thereafter (012), on INSERT as well as UPDATE (023 §1.14). Named for the first only; see 012.';

drop trigger if exists enforce_onboarding_completion_insert on public.profiles;

create trigger enforce_onboarding_completion_insert
  before insert on public.profiles
  for each row execute function public.enforce_onboarding_completion();

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 8 — one gate trigger per gated table, and no ninth.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
-- Expected: 8 — every one of them carries the WHEN guard. Without it the gate
-- fires for the seed and the migration role too; with the guard in the function
-- body instead it fires for nobody, because the function is security definer.
-- Neither failure is visible in a positive test, which is why this is asserted.
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal
--      and pg_get_triggerdef(oid) ilike '%current_user%';  -- ilike: Postgres renders it CURRENT_USER
--
-- Expected: 0 — none of the five deliberate omissions acquired one. The list is
-- the assertion; a bare total would not notice a gate landing on `blocks`.
--   select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where t.tgname = 'enforce_participation_gate'
--      and c.relname in ('blocks','postcard_hides','feed_reads','profile_countries','profiles');
--
-- Expected: 2 — profiles carries the 003/012 UPDATE trigger and 023's INSERT one.
--   select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where c.relname = 'profiles' and not t.tgisinternal;
--
-- Expected: f — anon cannot call the helper, and `private` is not in PostgREST's
-- exposed schemas at all.
--   select has_function_privilege('anon','private.may_participate()','execute');
--
-- Expected: 0. **This is the check that decides whether applying this file is
-- safe**, and it is the one number in this migration that must be re-measured
-- rather than read off the pre-flight above. Any rider still NULL here is locked
-- out of creating anything the moment this applies — including the owner.
--   select count(*) from public.profiles where terms_accepted_at is null;
--
-- Expected: t, t — 021's writers must already be applied, and without them the
-- count above can never reach 0, because nothing else can write the column.
--   select has_function_privilege('authenticated','public.accept_terms()','execute'),
--          has_function_privilege('authenticated','public.complete_onboarding(text)','execute');
--
-- Expected: t — §4's guard is `security invoker`, and it has to stay that way.
-- As `security definer` its own `current_user <> 'authenticated'` early return
-- would be true on every call and it would enforce nothing, while passing every
-- positive test. This is the shape 022 got wrong in the opposite direction; check
-- it rather than assume the file that was applied matches the file in git.
--   select not prosecdef from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname = 'enforce_onboarding_completion';
--
-- Expected: t, t — and the two gate functions are the reverse, definer by
-- design, for the reasons §1 and §2 give.
--   select prosecdef from pg_proc where proname = 'may_participate'
--     and pronamespace = 'private'::regnamespace;
--   select prosecdef from pg_proc where proname = 'enforce_participation_gate'
--     and pronamespace = 'public'::regnamespace;
