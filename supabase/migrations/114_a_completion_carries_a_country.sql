-- 114: a completion must carry a home country — the NARROWING half. PD-428.
--
-- Specification: `openspec/changes/require-a-home-country-at-onboarding/`.
-- `113` is the additive half and is already applied; this file is the entire
-- requirement (`design.md` §D8). One guard, in one function, and the signature
-- does not move.
--
-- ---------------------------------------------------------------------------
-- THE GATE THIS FILE WAITED ON, AND WHY IT EXISTS
-- ---------------------------------------------------------------------------
-- `113` widens; this narrows, and the two want opposite sides of the same
-- deploy. The moment this applies, `complete_onboarding({p_location: null})` —
-- the call the PRE-PD-428 bundle made at the end of the username step — starts
-- raising `check_violation` for a column that bundle has no screen to fill in,
-- and every new rider is stranded on the username step with no skip
-- (decision #5). So this file must not apply until the bundle that WRITES
-- `home_country` is SERVING, not merely merged.
--
-- Gate cleared, measured 2026-09-07T21:18Z against DEV's Vercel project:
--
--   deployment      dpl_F1kKDd1xAun2qWZzGoLBAwZ8QrnL
--   githubCommitSha c3df294fd46a0d1532bf615c9c20c0587c4c8fad  (development)
--   state           READY, ready 21:17:09Z, aliasError null
--   alias           app-dev.letsride.social
--
-- ** DEV ONLY at this revision. ** This file must not be applied to PROD until
-- the same sha is serving there — the promotion, confirmed READY with
-- `aliasError` null on `app.letsride.social`, per `docs/ENVIRONMENTS.md`
-- §Migrations. `113` alone on PROD is a safe resting state; `114` alone is not.
--
-- ---------------------------------------------------------------------------
-- THE SIGNATURE DOES NOT CHANGE, AND THE COUNTRY IS NOT AN ARGUMENT
-- ---------------------------------------------------------------------------
-- `complete_onboarding(p_location text)`, unchanged. `create or replace` cannot
-- add a parameter — it creates an OVERLOAD — and two candidates is `PGRST203`
-- on the one call every signup makes (`design.md` §D9, and `113`'s header at
-- length). The country is read from the STORED column, written by the client's
-- own preceding statement on its own row under `113`'s grants and CHECKs.
--
-- ---------------------------------------------------------------------------
-- ** THE GUARD IS NOT WHERE THE TASK LIST PUT IT, AND THAT IS THE ONE THING TO
-- READ BEFORE EDITING THIS FILE. **
-- ---------------------------------------------------------------------------
-- `tasks.md` §5.2 asked for the guard "beside the consent and username arms",
-- and §5.3 justified it with a claim that turned out to be false: that a re-run
-- by an already-onboarded rider is never refused. This function has no
-- idempotency short-circuit — completion is made one-way by a `coalesce` inside
-- the UPDATE, not by an early return — so an already-stamped caller reaches
-- every arm. Beside the other two arms, the guard would refuse every rider who
-- onboarded before `113`, which is the permanent NULL population the change
-- promised to leave alone.
--
-- It is therefore gated on `not v_was_complete`: the transition into completion.
-- The measurements and the full reasoning are on the guard itself, where the
-- next author editing it will actually be standing.
--
-- Inside a `security definer` function `current_user` is the OWNER, so
-- `enforce_onboarding_completion`'s `current_user <> 'authenticated'` gate
-- short-circuits and none of its arms run for this statement. That is why the
-- requirement is restated HERE and lives nowhere else — the same reason `023`'s
-- consent arm and `003`'s username arm are already restated in this body, and
-- the reason `113` §5 deliberately added NO `home_country` conjunct to the
-- trigger.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured on DEV (fpmrimzxadewsaiwpsel) 2026-09-07
-- ---------------------------------------------------------------------------
--   complete_onboarding(text)  prosecdef t, search_path ""      confirmed
--     md5(prosrc) 1a5aaf004acb6e68eee5039fba133ae0, 8282 bytes — the body below
--     is `107`'s file text, whose extracted body hashes to the same value, so it
--     is the DEPLOYED body and not a copy taken from an older file. `033`'s
--     reconciliation rule; the only edits are the three marked `114`.
--   profiles.home_country exists, nullable, 2 validated CHECKs  confirmed
--   25 profiles: 24 completed, 24 of those with a NULL country  confirmed
--
-- ---------------------------------------------------------------------------
-- Hand-exercise, DEV, rolled-back transaction, as `authenticated`
-- (`CLAUDE.md`: this hangs a REFUSAL off an already-shipped write path)
-- ---------------------------------------------------------------------------
--   a new rider, no country          -> 23514, stamp stays NULL, 0 rows stamped
--   a new rider, country set         -> stamped, 1 row, welcome club joined
--   an onboarded rider, NULL country -> permitted, ORIGINAL stamp returned
--   an onboarded rider, with country -> permitted, ORIGINAL stamp returned
--   a rider with no consent stamp    -> refused by the CONSENT arm, first
--   a profile edit touching nothing else is unaffected (`113`'s trigger arm)

create or replace function public.complete_onboarding(p_location text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := (select auth.uid());
  v_username      text;
  v_home_country  text;
  v_terms         timestamptz;
  v_stamp         timestamptz;
  v_was_complete  boolean;
begin
  if v_uid is null then
    raise exception 'complete_onboarding requires a session'
      using errcode = 'insufficient_privilege';
  end if;

  -- `for update` so the read and the write below cannot be split by a concurrent
  -- call. The row is the caller's own and nobody else writes it, so there is no
  -- contention to speak of; this is here to remove the question rather than to
  -- resolve a measured problem.
  --
  -- 114: `p.home_country` joins this read rather than earning a second round
  -- trip. It is inside the same `for update`, so the value the guard below tests
  -- is the value under lock — a country written by the client's own preceding
  -- statement is already committed and visible here, and nothing can clear it
  -- between the test and the stamp.
  select p.username, p.terms_accepted_at, p.onboarding_completed_at, p.home_country
    into v_username, v_terms, v_stamp, v_home_country
    from public.profiles p
   where p.id = v_uid
     for update;

  -- 058: captured BEFORE the update, because that update sets the stamp
  -- unconditionally and the `coalesce` below makes a re-run indistinguishable
  -- from a first completion afterwards. The welcome club is joined on the
  -- transition into completion and never again — otherwise a rider who joined,
  -- left, and then re-ran this function would be put straight back in, and
  -- `leaveClub` would be a button that does not work.
  v_was_complete := v_stamp is not null;

  -- 023 §1.13, carried here because the trigger that also carries it does not
  -- run for this statement (measurement 2). Without this line, the participation
  -- gate would be walked around by completing onboarding through the very RPC
  -- that 021 makes the only way to complete it.
  if v_terms is null then
    raise exception 'onboarding cannot be completed before the terms are accepted'
      using errcode = 'check_violation';
  end if;

  -- 003 §6a, same errcode, because it is the same rule minus one arm.
  --
  -- 075 (PD-286): the location arms are GONE — `p_location is null` and
  -- `length(btrim(p_location)) < 1` no longer refuse anything. Onboarding is one
  -- step now (username), and a rider who never had a location screen must be
  -- able to finish. The username arm is unchanged, word for word, and so is the
  -- consent arm above it.
  --
  -- The message changed with the rule. The old text named a location
  -- requirement; leaving it behind would have named a rule the schema no longer
  -- has, and nothing would have gone red — every assertion covering these
  -- refusals matches on SQLSTATE 23514 and none on the text.
  if v_username is null then
    raise exception 'onboarding cannot be completed before a username is set'
      using errcode = 'check_violation';
  end if;

  -- 114 (PD-428): ** THE REQUIREMENT. ** A completion must carry a home country.
  --
  -- ** Gated on `not v_was_complete`, and that placement is the whole of this
  -- file's risk. ** `tasks.md` §5.2 drafted this arm beside the consent and
  -- username arms above, on §5.3's reasoning that "a re-run by an
  -- already-onboarded rider is never refused because the guard reads the stored
  -- column, which they already have". ** That reasoning is false. ** It was
  -- measured rather than argued, and two facts kill it:
  --
  --   1. ** This function has no idempotency short-circuit. ** `003` §6b makes
  --      completion one-way by `coalesce`-ing the OLD stamp inside the UPDATE,
  --      not by returning early — so an already-stamped caller falls all the way
  --      through every arm above. Measured on DEV inside a rolled-back
  --      transaction, 2026-09-07: an already-stamped rider whose username was
  --      nulled by the owner, re-running this as `authenticated`, got
  --      `23514 onboarding cannot be completed before a username is set`. The
  --      arms are reached. Compare `enforce_onboarding_completion`, which DOES
  --      return early on `old.onboarding_completed_at` — the two functions carry
  --      the same invariants and do NOT have the same control flow, and reading
  --      the rule off the trigger is how §5.3 got it wrong.
  --   2. ** Every rider who onboarded before `113` has a NULL country, and that
  --      population is permanent by decision. ** The column comment (`113` §3)
  --      and PD-428's own Queued note both say those riders are never backfilled
  --      and never re-prompted. Measured on DEV 2026-09-07: 25 profiles, 24
  --      completed, 24 of those with a NULL `home_country`. On PROD it is the
  --      entire completed population.
  --
  -- Beside the arms above, this guard would therefore refuse a re-run for
  -- exactly the population the design promised not to touch — a `23514` raised
  -- at a rider who finished onboarding weeks ago, by a requirement that did not
  -- exist when they did. No shipped bundle re-calls this RPC for an onboarded
  -- rider today, so it would be a latent defect rather than a live outage, which
  -- is the worst kind to leave inside a `security definer` function nobody
  -- re-reads.
  --
  -- `not v_was_complete` is the TRANSITION INTO completion — the same predicate
  -- `058`'s welcome-club block already uses, for the same reason: this is a rule
  -- about BECOMING onboarded, never about BEING onboarded. A new rider has a
  -- NULL `v_stamp`, so the guard runs and refuses; an onboarded one skips it and
  -- gets their ORIGINAL stamp back, country or not.
  --
  -- BELOW the consent and username arms, so a rider with no consent stamp is
  -- still refused by the consent arm first and the error a half-finished rider
  -- sees does not change identity. ABOVE the UPDATE, so a refusal leaves
  -- `onboarding_completed_at` NULL — the refusal must not be able to stamp.
  -- ABOVE `058`'s block and outside its `when others`, which swallows everything
  -- it wraps and would turn this raise into a warning and a completed rider.
  --
  -- Read from the STORED column, never from an argument (`design.md` §D9):
  -- `create or replace` cannot add a parameter, and the overload it would create
  -- instead answers `PGRST203` on the one call every signup makes.
  if not v_was_complete and v_home_country is null then
    raise exception 'onboarding cannot be completed before a home country is set'
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
  --
  -- 075: the location assignment is now conditional, and THIS IS THE MOST
  -- DANGEROUS LINE IN THE CHANGE. It was `set location = p_location`,
  -- unconditional, and that was safe only because the raise above refused a NULL
  -- or blank argument before control reached it. With that refusal gone, the new
  -- client's `complete_onboarding(null)` would silently erase a stored location
  -- on every re-run. A NULL or blank argument now means "leave it alone", never
  -- "clear it"; a real location is still stored, in the same statement as the
  -- stamp, exactly as before. `nullif(btrim(...), '')` rather than a bare
  -- `coalesce` because 018's `profiles_location_length` refuses a trimmed-empty
  -- string, so storing '   ' would raise 23514 where doing nothing is correct.
  update public.profiles p
     set location                = coalesce(nullif(pg_catalog.btrim(p_location), ''),
                                            p.location),
         onboarding_completed_at = coalesce(p.onboarding_completed_at,
                                            pg_catalog.now())
   where p.id = v_uid
  returning p.onboarding_completed_at into v_stamp;

  -- 058: the welcome club. Everything about this block is subordinate to the
  -- stamp above — it must never be able to undo it.
  --
  -- The insert runs as the function owner, so `club_members`' INSERT policy
  -- ("Users can join public clubs…") does not apply and no policy needs
  -- widening for a rider to be placed in a club they did not ask for.
  --
  -- ** 107: which is exactly why the owner_id predicate is written HERE. ** This
  -- is the only membership-conferring definer function in the schema without
  -- one, so an ownerless club carrying clubs.is_default would be joined by every
  -- new rider through a door no policy governs — un-hiding every preserved
  -- postcard in it to the whole signup stream. 107 §4b keeps that club from
  -- going ownerless in the first place; this is the second lock, because §4b is
  -- a guarantee about something else.
  --
  -- `enforce_participation_gate` does NOT fire either, and for the reason 023
  -- and 003 already document rather than a new one: its trigger carries
  -- `when (current_user = 'authenticated')`, and inside a security definer
  -- function current_user is the owner. That is not a gap being walked
  -- through — this function restates both halves of the gate itself, above,
  -- and refuses before reaching here if either is missing. `notify_club_joined`
  -- has no such `when` clause (036 §7.8, deliberately), which is why 058 §4 is
  -- a change to the function body and not to the trigger.
  --
  -- `on conflict do nothing` covers the rider who somehow already holds the
  -- row — the welcome club's own owner re-running this, most obviously — and
  -- suppresses the AFTER trigger with it, since a row that is not inserted
  -- fires nothing.
  --
  -- The exception block is a subtransaction on every first completion, which at
  -- signup volume costs nothing worth measuring, and buys the guarantee that no
  -- failure here reaches the rider. `when others` is deliberately that wide:
  -- the set of things that could go wrong is open (the club deleted mid-signup,
  -- a future trigger on `club_members`, a constraint added later), and every
  -- member of it has the same correct handling.
  if not v_was_complete then
    begin
      insert into public.club_members (club_id, user_id, role)
      select c.id, v_uid, 'member'
        from public.clubs c
       where c.is_default
         and c.owner_id is not null
      on conflict do nothing;

      -- 059: zero rows is a SUCCESS, so the handler below never runs for the
      -- likeliest failure of all — nothing carries the flag, and every rider
      -- silently joins nothing for ever. See the migration header. The second
      -- conjunct keeps this quiet for `on conflict do nothing`, which also
      -- leaves `found` false and is the correct, healthy case.
      --
      -- ** 107 widened this condition with `and c.owner_id is not null`, and it
      -- is what makes the guard above safe to add. ** Without it, an ownerless
      -- welcome club would satisfy `is_default`, the warning would stay silent,
      -- and every rider would join nothing for ever with no signal at all —
      -- 059's own worst failure, reintroduced by a security fix.
      if not found
         and not exists (select 1 from public.clubs c
                          where c.is_default and c.owner_id is not null) then
        raise warning 'complete_onboarding: no club carries clubs.is_default with an owner, so % joined nothing',
          v_uid;
      end if;
    exception
      when others then
        raise warning 'complete_onboarding: could not join % to the default club (%): %',
          v_uid, sqlstate, sqlerrm;
    end;
  end if;

  return v_stamp;
end;
$$;

-- `create or replace` keeps the OID and therefore `021`'s comment, which states
-- in as many words that "since 075 completion requires a USERNAME and CONSENT
-- only". That sentence is false the moment this applies, and a comment that
-- enumerates the rules is exactly how the next reader concludes there are only
-- two (`028`'s lesson, and `113` §5's reason for restating its own). Restated in
-- full rather than appended to, because the false clause is mid-sentence.
comment on function public.complete_onboarding(text) is
  'Own-row RPC and the only path to onboarding_completed_at, because 025 revokes the client''s UPDATE grant on the stamp (021). Completion requires CONSENT, a USERNAME and — since 114 (PD-428) — a stored profiles.home_country, checked in that order. The location arm is gone since 075 (PD-286): the argument is still accepted and still stored in the same statement as the stamp, and a NULL or blank location LEAVES THE COLUMN ALONE rather than being refused, which is what stops a re-run erasing a rider''s stored town. The country arm is NOT symmetric with the other two — it is gated on the TRANSITION into completion (not v_was_complete), so an already-stamped rider re-running this is never refused for a country they were never asked for. That is deliberate and load-bearing: this function has no idempotency early return, and every rider who onboarded before 113 holds a NULL country permanently. The country arrives as a column write on the caller''s own row, never as an argument; the signature cannot gain one without becoming an overload (PGRST203). Restates 023''s consent rule and 003''s completion invariants itself — inside a security definer function current_user is the owner, so both triggers short-circuit. Since 058 it also joins the caller to the club carrying clubs.is_default, on the transition into completion only, in an exception block that can never take the stamp down with it; 059 adds the warning for the case that block cannot see, where no club carries the flag and the insert succeeds against zero rows.';

-- `revoke all ... from public, anon` and `grant execute ... to authenticated`
-- (`021` §3) are NOT re-issued: `create or replace` preserves a function's ACL,
-- and re-issuing them would make a second copy of the grant to keep in step.
-- The footer asserts them instead, scoped to the grantee — `postgres` and
-- `service_role` hold execute by default, so an unscoped check reads true
-- against a broken database.

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. ** STILL ONE FUNCTION, STILL ONE ARGUMENT. ** Expected: exactly 1 row,
--    `p_location text`, prosecdef t, {search_path=""}. Two rows is an overload
--    and is PGRST203 on every signup.
--
--   select pg_get_function_identity_arguments(oid), prosecdef, proconfig
--     from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'complete_onboarding';
--
-- 2. The guard is present AND gated AND positioned. Expected: t | t | t | t.
--    Presence alone is not the property — an ungated arm and one below the
--    UPDATE both contain the same string and are both wrong.
--
--   select prosrc like '%onboarding cannot be completed before a home country is set%' as present,
--          prosrc like '%not v_was_complete and v_home_country is null%'               as gated,
--          strpos(prosrc, 'v_home_country is null')
--            > strpos(prosrc, 'before the terms are accepted')                         as below_consent_arm,
--          strpos(prosrc, 'v_home_country is null')
--            < strpos(prosrc, 'update public.profiles p')                              as above_the_update
--     from pg_proc where oid = 'public.complete_onboarding(text)'::regprocedure;
--
-- 3. The grant survived the replace, scoped to the grantee. Expected: f, f, t.
--
--   select has_function_privilege('anon','public.complete_onboarding(text)','execute'),
--          has_function_privilege('public','public.complete_onboarding(text)','execute'),
--          has_function_privilege('authenticated','public.complete_onboarding(text)','execute');
--
-- 4. `113`'s work is untouched — this file names neither the trigger nor the
--    column. Expected: 283245b644a1ab4ebcd879a18a6998e7 | f, and 2 | 0.
--    ** That md5 is `113`'s value, not the one `113`'s own header quotes. **
--    `af228c43e105973fe46f02d7df8b8cd8` was the PRE-`113` body, and copying it
--    forward into this footer is the obvious mistake — it was made in this
--    file's first draft and caught by running the query. It is the md5 of the
--    body extracted from `113`'s file text, which is how the two were compared.
--
--   select md5(prosrc), prosecdef from pg_proc
--    where oid = 'public.enforce_onboarding_completion'::regproc;
--   select count(*) as triggers, count(*) filter (where tgattr <> '') as column_scoped
--     from pg_trigger
--    where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--
-- 5. No new security advisors. This file creates no function that did not
--    already exist, so the `authenticated_security_definer_function_executable`
--    count SHALL NOT move. DEV read 42 before `113` and 42 after it.
--
--   get_advisors(security)
--
-- 6. The permanent NULL population is untouched by the apply itself — this file
--    writes no rows. Expected: unchanged from the pre-flight reading above.
--
--   select count(*) filter (where onboarding_completed_at is not null
--                             and home_country is null) as completed_null_country
--     from public.profiles;
