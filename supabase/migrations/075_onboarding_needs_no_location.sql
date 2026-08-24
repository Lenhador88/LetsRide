-- 075: onboarding no longer requires a location — PD-286, the schema half of
--      "drop the location step from onboarding".
--
-- Proposal: `openspec/changes/drop-onboarding-location-step/`. `design.md` §D1
-- (which copy of the invariant is load-bearing), §D4 (the data-loss line) and
-- §D5 (the ordering) are the three sections this file implements.
--
-- ---------------------------------------------------------------------------
-- The invariant lived in three places and only ONE of them decides behaviour
-- ---------------------------------------------------------------------------
-- 1. `public.complete_onboarding(p_location text)` — raises `check_violation`
--    when `p_location` is NULL or blank (`059`, restating `003` §6a). **This is
--    the load-bearing copy.** It is `security definer`, so inside it
--    `current_user` is the OWNER and `enforce_onboarding_completion`'s
--    `if current_user <> 'authenticated' then return new` short-circuits — the
--    trigger never evaluates its location arm for this function's own UPDATE.
--    A change that relaxed only the trigger would pass `tsc`, pass this repo's
--    RLS suite (which runs as the table owner, for whom neither barrier exists
--    — `031`'s lesson) and ship NOTHING.
-- 2. `public.enforce_onboarding_completion()` — refuses the stamp when
--    `new.location is null`, on **both** its INSERT arm and its UPDATE arm
--    (`023`, superseding `003`/`012`; the INSERT arm is the one no prose in this
--    repo mentions, so this file was written against the deployed `prosrc`).
--    Unreachable today by grant — `025` leaves `authenticated` with UPDATE on
--    `avatar_path`, `bike_model`, `bio`, `cover_image_path`, `location` and
--    `username`, and on NEITHER stamp — so it is defence in depth over a locked
--    door. It comes out anyway: left behind it states a rule the schema no
--    longer has, and it would refuse a legitimate support-path write for a
--    rider who has no location.
-- 3. `src/lib/auth/guard.ts` — the resume step. Code, not schema; it lands with
--    the deploy.
--
-- §3 of this file is a FOURTH edit that is not part of that invariant and is
-- here because this change is what makes it reachable — see §3's own preamble
-- and `design.md` §D7.
--
-- ---------------------------------------------------------------------------
-- THE DANGEROUS LINE — a refusal that was silently doing a second job
-- ---------------------------------------------------------------------------
-- `059`'s body ends in an unconditional `set location = p_location`, and the
-- function is re-runnable by design (`003` §6b: re-running returns the ORIGINAL
-- stamp). That assignment is safe TODAY only because the raise several lines
-- above refuses a NULL or blank argument before control ever reaches it.
--
-- Delete the raise on its own and the very first call the new client makes —
-- `rpc('complete_onboarding', { p_location: null })` — writes NULL over whatever
-- the rider had stored. So the write becomes:
--
--     location = coalesce(nullif(pg_catalog.btrim(p_location), ''), p.location)
--
--   * `nullif(btrim(...), '')` because `018`'s `profiles_location_length` CHECK
--     refuses a trimmed-empty string: storing `'   '` would raise `23514` where
--     "leave it alone" is the correct answer.
--   * `coalesce` and `nullif` are deliberately NOT schema-qualified while
--     `btrim` is. They are SQL constructs — `pg_catalog.coalesce` does not
--     exist, and writing it raises `42883` ON THE HAPPY PATH. `059`'s own
--     in-body comment records that this repo has already shipped that mistake
--     once. Do not "tidy" the qualification in either direction.
--
-- ---------------------------------------------------------------------------
-- The message, on all three sites
-- ---------------------------------------------------------------------------
-- All three raised `'onboarding cannot be completed before username and
-- location are set'`. With the location arm gone that text names a rule the
-- schema does not have, and NOTHING would have gone red: the suite asserts on
-- SQLSTATE `23514` and never on message text. Each becomes
-- `'onboarding cannot be completed before a username is set'`.
--
-- ---------------------------------------------------------------------------
-- What this file deliberately does NOT do
-- ---------------------------------------------------------------------------
-- * It does not change the identity `public.complete_onboarding(text)`. No
--   overload, no `DEFAULT`, no dropped parameter: `021`'s revoke/grant pair and
--   `025`'s footer name that exact signature, PostgREST answers `PGRST203` on an
--   ambiguous overload, and — the load-bearing part — an OLD bundle calling it
--   with a real location keeps working unchanged, which is what makes the
--   ordering below safe.
-- * It does not touch `058`'s welcome-club insert, its `when others` block,
--   `059`'s two `raise warning` calls or the silencing of `notify_club_joined`.
--   The join hangs off the transition into completion, never off the location.
-- * It does not remove the trigger's `if current_user <> 'authenticated' then
--   return new` early return and does not make it `security definer`. `033`'s
--   footer requires that function to stay `security invoker`; the standing
--   requirement — a trigger that must SKIP privileged writers SHALL be gated on
--   `current_user` — puts it squarely in that category, since the seed,
--   `handle_new_user` and a dashboard fix all have to pass through.
-- * It does not touch `018`'s `profiles_location_length`, the `location` column,
--   its grants, any policy, or `enforce_participation_gate`. `location` stays a
--   rider-editable free-text column, NULL-able exactly as it already is.
-- * The username requirement stays, and completion stays one-way.
-- * `create or replace function` keeps the OID, so
--   `enforce_onboarding_completion`'s comment (last written by `038`) survives
--   untouched — it describes the stamp rules and never claimed a location.
--
-- ---------------------------------------------------------------------------
-- ORDERING — an instruction to whoever applies this to PROD
-- ---------------------------------------------------------------------------
-- **Apply this migration BEFORE the code that depends on it serves.** Every
-- edit here strictly WIDENS what is accepted, so it is a no-op for the bundle
-- currently deployed (which always sends a location) and it survives a rollback
-- of the code. The reverse order is unrecoverable in the way that matters:
-- a new bundle against an old database calls `complete_onboarding(null)`, gets
-- `23514` on EVERY signup, and there is no location screen left to fall back to
-- — every new rider is permanently stuck on the username step.
--
-- On PROD that means applying it before the promotion build SERVES, which is
-- `069`'s precedent — not "after the merge". `070`'s header is explicit that
-- merged is not deployed.
--
-- This is NOT a `021`/`025` deadlock. That shape exists when a change has a
-- destructive half — a revoke, a drop, a narrowing. This one has none, so it
-- can sit applied for any length of time before the deploy, which is exactly
-- what DEV-ahead-of-PROD already looks like between a merge and a promotion.
-- There is deliberately no follow-up migration.

-- --- §1  The RPC: the copy that decides what the app can do ----------------
-- Reproduced whole, every comment carried verbatim from `059` except where a
-- `075:` paragraph marks a change, because `prosrc` is what
-- `docs/reference/migrations.md`'s reconciliation compares.
create or replace function public.complete_onboarding(p_location text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := (select auth.uid());
  v_username      text;
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
  select p.username, p.terms_accepted_at, p.onboarding_completed_at
    into v_username, v_terms, v_stamp
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
      on conflict do nothing;

      -- 059: zero rows is a SUCCESS, so the handler below never runs for the
      -- likeliest failure of all — nothing carries the flag, and every rider
      -- silently joins nothing for ever. See the migration header. The second
      -- conjunct keeps this quiet for `on conflict do nothing`, which also
      -- leaves `found` false and is the correct, healthy case.
      if not found
         and not exists (select 1 from public.clubs c where c.is_default) then
        raise warning 'complete_onboarding: no club carries clubs.is_default, so % joined nothing',
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

comment on function public.complete_onboarding(text) is
  'Own-row RPC and the only path to onboarding_completed_at, because 025 revokes the client''s UPDATE grant on the stamp (021). Since 075 (PD-286) completion requires a USERNAME and CONSENT only — the location arm is gone with the location step. The argument is still accepted and still stored, in the same statement as the stamp; a NULL or blank location now LEAVES THE COLUMN ALONE rather than being refused, which is what stops a re-run erasing a rider''s stored location. Restates 023''s consent rule and 003''s completion invariants itself — inside a security definer function current_user is the owner, so both triggers short-circuit. Since 058 it also joins the caller to the club carrying clubs.is_default, on the transition into completion only, in an exception block that can never take the stamp down with it; 059 adds the warning for the case that block cannot see, where no club carries the flag and the insert succeeds against zero rows.';

-- --- §2  The trigger: defence in depth, restated without the location ------
-- Reproduced whole from the DEPLOYED `prosrc` rather than from `023`'s text —
-- `038` replaced this body afterwards and added the username re-pin, which
-- `023`'s file does not contain. Every comment verbatim; the only edits are the
-- two `new.location is null` conjuncts and the two messages that named them.
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
      -- 075: the location conjunct came out of this test, and the message with
      -- it. This is the arm no prose in this repo mentioned, which is why the
      -- body was reproduced from the deployed prosrc rather than from 023.
      --
      -- Deliberately NOT quoting the removed predicate here: a comment naming a
      -- retired pattern is counted by every grep for it (CLAUDE.md's comment
      -- trap), and the footer's verification query greps this very body.
      if new.username is null then
        raise exception 'onboarding cannot be completed before a username is set'
          using errcode = 'check_violation';
      end if;
      if new.terms_accepted_at is null then
        raise exception 'onboarding cannot be completed before the terms are accepted'
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  -- 038: once set, never unset. Coerced rather than raised, matching the consent
  -- rule below — see the header for why, and for why the assertions covering this
  -- check the stored value rather than a SQLSTATE.
  --
  -- **This must stay ABOVE the `old.onboarding_completed_at` early return.**
  -- Below it, it is dead code for every already-onboarded rider, which is the
  -- entire population it protects — and it would still pass a suite that only
  -- tested a mid-wizard fixture. It is first in the UPDATE path so that a future
  -- rule arriving with an early return of its own cannot orphan it.
  --
  -- Keyed on `old.username`, so a rider mid-wizard who has chosen a name is
  -- covered too: that is the route by which a taken name could otherwise be
  -- freed and re-taken. A rename is untouched and still permitted (proposal Q1);
  -- only the removal is refused.
  if old.username is not null then
    new.username := coalesce(new.username, old.username);
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
    -- 075: the location conjunct came out of this test too, same as the INSERT
    -- arm above. What remains is the username rule and, below it, 023's consent
    -- rule. The removed predicate is not quoted, for the reason given there.
    if new.username is null then
      raise exception 'onboarding cannot be completed before a username is set'
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

-- No `comment on function public.enforce_onboarding_completion()` here on
-- purpose. `create or replace` keeps the OID and therefore the comment 038 last
-- wrote, and that comment describes the stamp rules without ever claiming a
-- location was required. Restating it would be a second copy to keep in step.

-- --- §3  The availability check stops calling a rider's own name taken -----
-- `design.md` §D7, and the one edit in this file that is not about the location
-- invariant. `056`'s `username_exists` answers "does any profile the CALLER can
-- see hold this name" with no exclusion for the caller's own row — so a rider
-- retyping the name they already hold is told it is taken, in red, by the field.
--
-- That is unreachable TODAY: the only screen calling it is the username step,
-- and a rider reaches it once, before they have a name. **This change is what
-- makes it reachable.** With the location step gone, the username step is the
-- one that completes onboarding, and the proposal's safety case for its two
-- writes (username, then the RPC) is that the recovery from a failure between
-- them is the screen the rider is already on — with a username already set. A
-- recovery screen that opens by refusing the rider's own name is not the clean
-- retry that argument claims, so the argument is repaired here rather than
-- documented.
--
-- One predicate: `and profiles.id <> (select auth.uid())`. It is the same
-- WIDENING shape as §1 and §2 — it can only turn a `true` into a `false`, for
-- exactly one row, the caller's own — so it inherits the ordering above
-- wholesale and no call site changes. `profiles_username_lower_key` is still
-- what decides, and `setUsername` still handles the 23505.
--
-- **This is NOT a fix for PD-146 and must not be described as one.** PD-146 is
-- the block-aware availability question: a name held by a rider who has blocked
-- the caller still reads free, because that is the `profiles` SELECT policy
-- rather than this predicate, and `usernameVerdict` is still what reconciles the
-- two on screen. Nothing here touches it.
--
-- Reproduced whole from `056` rather than patched, per this repo's convention.
-- `security invoker`, `stable`, `set search_path = ''` and the revoke/grant pair
-- are unchanged, and each is asserted by role in the footer rather than assumed.
create or replace function public.username_exists(p_username text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles
     where lower(profiles.username) = lower(p_username)
       -- 075: the caller's own row is not competition for the caller. Updating a
       -- row to the value it already holds raises nothing, and 038 permits a
       -- rename, so a rider's current name IS available to them — which is what
       -- this function's contract already claimed and did not deliver.
       --
       -- `<>` rather than `is distinct from`, deliberately and with a known
       -- consequence: for a caller with no session `auth.uid()` is NULL, the
       -- comparison is NULL, and every name reads available. That caller cannot
       -- exist — EXECUTE is revoked from `public` and `anon` below, and an
       -- `authenticated` JWT always carries a `sub` — and `is distinct from`
       -- would read as an exclusion this function does not make.
       and profiles.id <> (select auth.uid())
  );
$$;

comment on function public.username_exists(text) is
  'Case-insensitive availability check for the onboarding username field (056): true when a profile the CALLER can see, OTHER THAN THEIR OWN, holds this name, folded. Since 075 the caller''s own current name reads FREE — the username step is the step that completes onboarding now, so a rider returning to it already has a name and must not be told it is taken. security invoker on purpose — it answers under the block-aware profiles SELECT policy, exactly as the .eq() filter it replaced did, so a name held by a rider who has blocked the caller still reads free (PD-146, reconciled on screen by usernameVerdict, and NOT what 075''s predicate changes). Advisory only: profiles_username_lower_key is what decides, and setUsername handles the 23505.';

-- Restated from `056` because `create or replace` does not re-run them and a
-- reader should not have to prove the grants survived by absence. CREATE
-- FUNCTION grants EXECUTE to PUBLIC by default; decision #1 means no reach for
-- `anon`.
revoke all on function public.username_exists(text) from public, anon;
grant execute on function public.username_exists(text) to authenticated;

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. Neither function mentions a location requirement any more. Expected: 0.
--
--   select count(*) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('complete_onboarding', 'enforce_onboarding_completion')
--      and p.prosrc like '%username and location are set%';
--
-- 2. The RPC's write is conditional. Expected: t.
--
--   select prosrc like '%coalesce(nullif(pg_catalog.btrim(p_location), '''')%'
--     from pg_proc where oid = 'public.complete_onboarding(text)'::regprocedure;
--
-- 3. Both location conjuncts are gone from the trigger, and the username ones
--    are not. Expected: 0 and 2.
--
--   select (length(prosrc) - length(replace(prosrc, 'new.location is null', '')))
--            / length('new.location is null'),
--          (length(prosrc) - length(replace(prosrc, 'new.username is null', '')))
--            / length('new.username is null')
--     from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc;
--
-- 4. The posture did not move. Expected: t, {search_path=""}, f, f.
--
--   select prosecdef, proconfig
--     from pg_proc where oid = 'public.complete_onboarding(text)'::regprocedure;
--   select prosecdef, proconfig
--     from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc;
--
--    `enforce_onboarding_completion` MUST still be security INVOKER (033), or
--    its `current_user` gate stops meaning anything.
--
-- 5. The grants are role-named rather than counted — 031's lesson, that a
--    function nothing can call looks exactly like a working one. Expected:
--    f then t.
--
--   select has_function_privilege('anon',
--            'public.complete_onboarding(text)', 'execute');
--   select has_function_privilege('authenticated',
--            'public.complete_onboarding(text)', 'execute');
--
-- 6. The signature is still the one 021 granted and 025's footer names, and
--    there is exactly ONE of it — an overload would earn PGRST203 from
--    PostgREST. Expected: 1 row, `p_location text`.
--
--   select pg_get_function_identity_arguments(oid)
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname = 'complete_onboarding';
--
-- 7. §3's predicate landed, and §3's posture did not move. Expected: t; then
--    f (security INVOKER — as definer this becomes a block-piercing read),
--    {search_path=""}, f, t.
--
--   select prosrc like '%profiles.id <> (select auth.uid())%'
--     from pg_proc where oid = 'public.username_exists(text)'::regprocedure;
--   select prosecdef, proconfig
--     from pg_proc where oid = 'public.username_exists(text)'::regprocedure;
--   select has_function_privilege('anon',
--            'public.username_exists(text)', 'execute');
--   select has_function_privilege('authenticated',
--            'public.username_exists(text)', 'execute');
--
--    The grant pair matters more here than usual: this file re-issues a
--    `revoke all ... from public, anon`, and a mistake in the re-grant leaves
--    the availability check unreachable for the one role that calls it — 031's
--    lesson, which is why both are read by ROLE rather than counted.
