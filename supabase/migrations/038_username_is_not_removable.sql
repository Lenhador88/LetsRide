-- 038: a username cannot be removed once it is set.
--
-- Linear PD-127. Specification: openspec/changes/forbid-username-removal/.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
-- A rider can delete themselves from every other rider's view in one request:
--
--   PATCH /rest/v1/profiles?id=eq.<me>   {"username": null}
--
-- The `profiles` SELECT policy is
--
--   (auth.uid() = id) OR (username IS NOT NULL AND NOT private.is_blocked(auth.uid(), id))
--
-- so username-nullness is the predicate that hides an unfinished signup from
-- everyone else. Null your own username and your row leaves every other rider's
-- read — bylines, comment authors, club member lists, ride crews, and the
-- availability check that tells the next rider the name is free. You still see
-- your own row, so from inside the app nothing looks broken.
--
-- Four facts, each measured on both projects rather than inferred:
--
--   has_column_privilege('authenticated','public.profiles','username','UPDATE')
--     --> true   (025 re-granted it per column)
--   profiles_username_format      username IS NULL OR username ~ '^[a-z0-9_]{3,20}$'
--     --> NULL passes
--   profiles_username_not_reserved  username IS NULL OR username <> ALL (...)
--     --> NULL passes
--   enforce_onboarding_completion   guards terms_accepted_at and
--                                   onboarding_completed_at only
--
-- Reproduced end to end on letsride-dev (fpmrimzxadewsaiwpsel) 2026-08-08, as
-- `authenticated` with request.jwt.claims.sub set to the row's own id, inside a
-- DO block that raised at the end so the whole thing rolled back:
--
--   PROBE-PRE-038 before=devrider093453 after=<NULL> upd_rows=1 own_delete_rows=0
--
-- `own_delete_rows=0` is the second half of that probe and is NOT fixed here:
-- `authenticated` holds a table-level DELETE grant on profiles and there is no
-- DELETE policy, so deleting your own row affects zero rows. The refusal rests
-- on the ABSENCE of a policy rather than on the absence of a grant. That is
-- asserted in the suite by this change and the revoke is left to its own
-- migration (design.md §Follow-ups A) — a grant change bundled into a trigger
-- change makes both harder to review and to roll back.
--
-- Why it is worse than a self-inflicted foot-gun: 003 makes
-- `onboarding_completed_at` one-way and requires a username to reach it, so this
-- leaves the row in a state onboarding declares impossible, with no repair path
-- inside the app. The completion stamp survives, so `my_onboarding_state()`
-- returns has_username=false beside a completion stamp and the route guard sends
-- the rider to /postcards rather than back into /onboarding/username. No screen
-- writes `username` outside the wizard — it is deliberately absent from
-- `profileEditSchema`. Decision #7 makes the username the only display name there
-- is; there is no full_name to fall back to.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured 2026-08-08 immediately before writing this
-- ---------------------------------------------------------------------------
--   select count(*) from public.profiles
--    where onboarding_completed_at is not null and username is null;
--
--   letsride     (PROD, zwprydcyryvudhurbnye)   profiles 4, username null 1, violating 0
--   letsride-dev (DEV,  fpmrimzxadewsaiwpsel)   profiles 4, username null 1, violating 0
--
-- The single NULL-username row on each is a rider mid-wizard with
-- `onboarding_completed_at` NULL — the legitimate state, and the reason the guard
-- keys on `old.username` rather than forbidding NULL outright.
--
-- **Re-run it against the project immediately before applying.** If it is not 0,
-- an operator sets a username on that row FIRST. This migration must not invent
-- one — same rule as 023 and consent.
--
-- ---------------------------------------------------------------------------
-- The fix, and why its PLACEMENT is the whole story
-- ---------------------------------------------------------------------------
--   if old.username is not null then
--     new.username := coalesce(new.username, old.username);
--   end if;
--
-- It sits in the UPDATE path **above**
--
--   if old.onboarding_completed_at is not null then
--     new.onboarding_completed_at := old.onboarding_completed_at;
--     return new;
--   end if;
--
-- Below that early return the branch is dead code for every already-onboarded
-- rider — which is the entire population this change exists to protect, and
-- exactly why the defect exists at all: for an onboarded rider the function has
-- always returned there having examined `username` never. A guard placed below it
-- would still pass a suite that only tested a mid-wizard fixture, so the suite's
-- load-bearing assertion uses an ONBOARDED fixture specifically.
--
-- It is placed as the FIRST rule of the UPDATE path — immediately after the
-- `tg_op = 'INSERT'` branch — rather than immediately above the early return, so
-- that a future rule arriving with an early return of its own cannot orphan it.
--
-- **Keyed on `old.username`, not on `old.onboarding_completed_at`.** The rule is
-- "once set, never unset". That is strictly stronger and one word shorter: it
-- also covers a rider who chose a name at step 1 and is sitting on step 2, which
-- is the route by which a taken name could be freed and re-taken. Nothing in the
-- app has ever offered to clear a username at either point in the wizard.
--
-- **Removal is coerced, not raised**, matching 012's treatment of
-- `terms_accepted_at` one branch below it in this same function. Three reasons,
-- argued in full in design.md §D2: a function whose two one-way rules behave
-- differently makes its next reader check which is which; nothing legitimate
-- sends NULL, so nobody needs the error message (`setUsername` sends a Zod-parsed
-- non-empty string and `updateProfile` does not name the column); and raising
-- would make a future multi-column profile write fail on a field it did not mean
-- to change, where coercion degrades to a no-op.
--
-- The cost, stated because it is real: the attacker's request returns 200 and
-- looks like it worked. **So the assertions for this rule check the STORED VALUE,
-- never an error code.** An assertion written as assert_rejected(..., '23514', ...)
-- would fail against a correct implementation. The assertions in the suite that
-- DO name a SQLSTATE are each pinning a refusal that predates this change — the
-- unique index (23505), the format CHECK (23514), and complete_onboarding's own
-- guard.
--
-- Not a CHECK constraint, deliberately: a CHECK binds every role including the
-- ones that have to be able to fix things, and it cannot read `old`, so it could
-- only express the weaker "is complete and NULL" rule. See design.md §D1.
--
-- ---------------------------------------------------------------------------
-- Who deliberately passes straight through
-- ---------------------------------------------------------------------------
-- The existing `current_user <> 'authenticated'` gate at the top of the function
-- is PRESERVED, not narrowed. `service_role`, `postgres`, the seed, the signup
-- trigger and any dashboard repair still write `username` freely, including
-- writing NULL. That is the operator escape hatch, and it is what keeps a rider
-- stranded by any future defect repairable at all. It is also the reason this
-- rule is a trigger rather than a constraint.
--
-- **A `security definer` function is NOT covered, and that is stated rather than
-- closed.** Inside one, `current_user` is the function's owner, so the gate above
-- returns early. Six functions reference public.profiles and every one of them is
-- `security definer` — measured against pg_proc 2026-08-08, not recalled:
--
--   private.may_participate ......... does not write profiles
--   private.transfer_owned_clubs .... does not write profiles
--   public.accept_terms ............. writes terms_accepted_at, terms_version
--   public.complete_onboarding ...... writes location, onboarding_completed_at
--   public.handle_new_user .......... INSERTs the row at signup
--   public.my_onboarding_state ...... does not write profiles
--
-- None writes `username`, so the gap is an empty intersection rather than an
-- unexplored one. **`handle_new_user` is the one to watch**: it creates the
-- profile row and deliberately leaves `username` NULL (rls_test.sql:105, "the
-- signup trigger no longer invents a username"). Seeding a username there from
-- OAuth or user_metadata — the obvious future extension — is a write this guard
-- does not reach, and that change must carry the rule in its own body, the way
-- `complete_onboarding` already restates 003's and 023's guards for exactly this
-- reason. Closing it speculatively would mean deleting the `current_user` gate,
-- trading three real capabilities for a hypothetical.
--
-- ---------------------------------------------------------------------------
-- THIS FILE RESTATES THE WHOLE FUNCTION BODY — read this before restating it again
-- ---------------------------------------------------------------------------
-- 033:311-313 carries the warning this file inherits and must pass on: *"copying
-- 003's or 012's body here would silently drop both."* 038 is named for a
-- username rule but replaces the entire body, so the next author restating it
-- will reach for 033 or for this file and needs to be told which arm came from
-- where:
--
--   the `current_user <> 'authenticated'` gate ....... 003 (kept by 012, 023)
--   the `tg_op = 'INSERT'` branch, both its arms ..... 023 §1.14
--   the username coercion (NEW) ...................... 038
--   the terms_accepted_at one-way / server-stamp ..... 012
--   the onboarding_completed_at one-way early return . 003 §6b
--   the completion guard's username+location arm ..... 003
--   the completion guard's consent arm ............... 023 §1.13
--
-- The RLS suite catches a dropped arm, so this is a convention gap rather than a
-- hole — and the header costs nothing.
--
-- It stays `security invoker` (no `security definer`), which is NOT an oversight:
-- the body opens by returning early unless `current_user` is `authenticated`,
-- which as `security definer` would be false on every call, so the guard would
-- never fire for anyone. That is the exact defect 022 shipped in the opposite
-- direction. `prosecdef` must still read `false` after this applies — it is in
-- the footer.
--
-- Both triggers already point at this function by name and are NOT recreated
-- (design.md §D5): recreating them churns pg_trigger for nothing and risks a
-- window in which the table has no BEFORE trigger at all. Confirmed 2026-08-08 on
-- both projects that neither is column-scoped — `pg_get_triggerdef` reads a bare
-- `BEFORE UPDATE ON public.profiles`, with no `OF <columns>`. That is
-- load-bearing: a column-scoped trigger would never fire for a username-only
-- PATCH and this whole approach would be silently dead.
--
-- ---------------------------------------------------------------------------
-- Ordering: no constraint in either direction, and PROD is the owner's call
-- ---------------------------------------------------------------------------
-- This file may be applied before or after any code deploy, in either order. No
-- application code changes: `setUsername` (src/lib/actions/onboarding.ts) keeps
-- its direct `.from('profiles').update({ username })`, its column grant and its
-- 23505/23514 branches. Nothing in src/ ever sends a NULL username.
--
-- That is the argument for this shape over revoking the column grant and routing
-- writes through a `set_username()` RPC: the revoke does not close the hole, it
-- relocates the write (an RPC can be called with NULL too — what forbids removal
-- is a guard inside it, which is this guard by a longer road), and it would be a
-- two-phase deploy of exactly the kind that split 021 and made applying 025 early
-- "an instant outage". design.md §D1 has the full argument; §Follow-ups B records
-- the day it becomes right — when a rename flow gives the channel some
-- server-owned logic to hold.
--
-- **PROD apply order is BLOCKED on the owner (proposal.md Q3) and this file must
-- not be applied to letsride until that is answered.** As of 2026-08-08 PROD is
-- at 035; both 036 and 037 are unapplied there, for OPPOSITE reasons —
-- 036_notifications is held back DELIBERATELY (it hangs six triggers off five
-- already-shipped write paths), 037_places_index is merely unshipped and purely
-- additive. docs/HANDOFF.md §Two migrations: "conflating them is how the wrong one
-- gets applied." Three orders are available and the recommended default is `037`
-- then `038`, deviating from filename order by a single file that nothing is
-- holding back. 038 touches public.profiles only and 036/037 touch neither
-- `profiles` nor this function, so they are independent in every direction —
-- which is what makes any of the three safe. Record whichever is chosen in
-- docs/ENVIRONMENTS.md so the next `npm run db:drift` reading is expected rather
-- than alarming.
--
-- Rollback is a CREATE OR REPLACE of the previous body, which is 033 §3 verbatim
-- — captured 2026-08-08 from `pg_get_functiondef` on both projects, identical on
-- each (md5 a68eae68547d98eead8d2397fcbf5550) and byte-identical to the file. No
-- data is written by this migration, so nothing needs undoing beyond the body.

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

-- The function's comment enumerates the rules it carries, and 028's lesson is
-- that a database comment is the one piece of documentation no edit to CLAUDE.md
-- can reach — it is what `list_tables` shows first. An enumeration that omits the
-- third rule is how the next reader concludes there are only two.
comment on function public.enforce_onboarding_completion() is
  'Guards the profile fields the client must not own (CLAUDE.md): onboarding_completed_at cannot be claimed early, cleared or back-dated (003) and cannot be claimed without consent (023 §1.13); terms_accepted_at is server-stamped on first write and immutable thereafter (012), on INSERT as well as UPDATE (023 §1.14); username cannot be removed once set (038) — silently coerced back, keyed on old.username so it covers a rider mid-wizard, and placed above the completion early return because below it the rule would never run for an onboarded rider. Named for the first only; see 012.';

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- 1. The invariant, unchanged. Expected 0, same as pre-flight.
--
--   select count(*) from public.profiles
--    where onboarding_completed_at is not null and username is null;
--
-- 2. The function is still security invoker with its search_path pinned.
--    Expected: prosecdef f, proconfig {search_path=""}.
--
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.enforce_onboarding_completion'::regproc;
--
-- 3. The new arm is in the body, and it is above the early return. Expected
--    t | t — the second is a position comparison, not a presence one, because
--    "the arm exists" passes just as well when it is dead code.
--
--   select prosrc like '%coalesce(new.username, old.username)%'                as arm_present,
--          strpos(prosrc, 'coalesce(new.username, old.username)')
--            < strpos(prosrc, 'new.onboarding_completed_at := old.onboarding_completed_at') as above_early_return
--     from pg_proc where oid = 'public.enforce_onboarding_completion'::regproc;
--
-- 4. Both triggers still present, still not column-scoped. Expected 2 | 0.
--    `tgattr <> ''` is the column-scoping test; a trigger scoped `OF username`
--    would still be BEFORE UPDATE and would still read correctly at a glance.
--
--   select count(*) filter (where true)          as triggers,
--          count(*) filter (where tgattr <> '')  as column_scoped
--     from pg_trigger
--    where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--
-- 5. Nothing else moved. Expected 3 | 0 | t | t — three policies on profiles as
--    before, still no DELETE policy, and the two grants this change deliberately
--    leaves alone. Scoped to the grantee, per 015's recorded footer bug: postgres
--    and service_role hold everything by Supabase default, so a table-wide count
--    reads wrong against a correct database.
--
--   select (select count(*) from pg_policies
--            where schemaname='public' and tablename='profiles')                as policies,
--          (select count(*) from pg_policies
--            where schemaname='public' and tablename='profiles' and cmd='DELETE') as delete_policies,
--          has_column_privilege('authenticated','public.profiles','username','update') as still_writable,
--          has_column_privilege('authenticated','public.profiles','username','insert') as still_insertable;
--
-- 6. The reproduction probe, which must now report the username UNCHANGED.
--    Runs as `authenticated` with the row's own id in request.jwt.claims, and
--    raises at the end so the whole block rolls back — the raise IS the rollback,
--    not a failure. Substitute a real onboarded id.
--
--   do $probe$
--   declare
--     uid constant text := '<an onboarded profile id>';
--     before_u text; after_u text; upd_rows int; del_rows int;
--   begin
--     execute 'set local role authenticated';
--     perform set_config('request.jwt.claims', '{"sub":"<the same id>"}', true);
--     select username into before_u from public.profiles where id = uid::uuid;
--     update public.profiles set username = null where id = uid::uuid;
--     get diagnostics upd_rows = row_count;
--     select username into after_u from public.profiles where id = uid::uuid;
--     delete from public.profiles where id = uid::uuid;
--     get diagnostics del_rows = row_count;
--     raise exception 'PROBE before=% after=% upd_rows=% own_delete_rows=%',
--       before_u, coalesce(after_u,'<NULL>'), upd_rows, del_rows;
--   end $probe$;
--
--    Before this migration: before=<name> after=<NULL>.
--    After it:              before=<name> after=<name>, upd_rows still 1 (the
--                           write lands and is coerced, it is not refused) and
--                           own_delete_rows still 0.
--
-- 7. The advisors must still return the documented eight. This changes no policy,
--    no grant and no function's security attributes, so a new WARN means
--    something other than this was applied.
