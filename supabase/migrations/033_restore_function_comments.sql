-- 033: restore six function bodies on PRODUCTION so their stored source matches
--      the repo. Comment text only — no behaviour changes.
--
-- =========================================================================
-- ** PURELY ADDITIVE — six `create or replace function`, each a verbatim copy
-- of the definition already in the chain. No signature, no `security definer`
-- flag, no `search_path`, no grant, no policy, no trigger and no data is
-- touched. `create or replace` (never `drop`), so every dependent trigger and
-- every existing ACL entry survives untouched. Safe to apply on its own, in
-- either order relative to a deploy. **
-- =========================================================================
--
-- ---------------------------------------------------------------------------
-- What was found
-- ---------------------------------------------------------------------------
-- A schema census across both projects (2026-08-06) compared `pg_proc.prosrc`
-- for every function on `letsride` (PROD, `zwprydcyryvudhurbnye`) against
-- `Letsride-dev` (DEV, `fpmrimzxadewsaiwpsel`). Six differed:
--
--   function                                  DEV    PROD   delta
--   ---------------------------------------------------------------
--   public.complete_onboarding(text)          2942   1169   -1773
--   public.enforce_onboarding_completion()    2786   1511   -1275
--   private.transfer_owned_clubs(uuid)        2459   1999    -460
--   private.password_reset_session()          1966   1386    -580
--   public.consume_password_reset_grant()      540    473     -67
--   public.enforce_participation_gate()        222    221      -1
--
-- PROD's copies were applied **condensed**: the in-body `--` comments were
-- dropped. DEV's are correct, because its chain was replayed from these files.
--
-- The cause is the hazard `CLAUDE.md` §Supabase Rules already names:
-- `apply_migration` takes SQL as an *argument*, not a path, so the file and the
-- database can silently diverge when the SQL is retyped or condensed into the
-- call instead of being passed verbatim. `022` sprang the same trap in the
-- dangerous direction — it lost a `security definer` clause. This time only
-- prose was lost, which is why it survived this long.
--
-- The sixth row is not a comment at all. `enforce_participation_gate` has no
-- in-body comments; PROD's copy is missing the blank line between `end if;` and
-- `return new;`. One byte of whitespace, same cause.
--
-- ---------------------------------------------------------------------------
-- This changes no behaviour, and that was proved before it was applied
-- ---------------------------------------------------------------------------
-- Normalise each body by stripping `--` comments and collapsing whitespace.
-- All six then hash **identically** on PROD and DEV:
--
--   private.password_reset_session         244b8a548abb73eebf1023b81221c650  (824)
--   private.transfer_owned_clubs           bc8bd096e2b46065dee0f505831dfb1d (1144)
--   public.complete_onboarding             4a7119bd66d5c7ad67900e6cf3d9a7d1  (991)
--   public.consume_password_reset_grant    11256ff6baa9451177c211e2eba21137  (429)
--   public.enforce_onboarding_completion   876b868143dd5a7cff624a80fe5f1dfa (1330)
--   public.enforce_participation_gate      41b884d4635339fa6e9aca31ddb31cad  (197)
--
-- So no statement, no predicate, no errcode and no control-flow branch differs.
-- `prosecdef`, `proconfig`, `provolatile`, the result type and the ACL were
-- already identical on both projects before this file existed.
--
-- The normalisation is safe rather than merely convenient: stripping `--` could
-- in principle mask a real difference by eating a `--` inside a string literal.
-- Every literal in all six bodies was enumerated and none contains `--`, so the
-- comparison cannot produce a false pass. (The literals are all short: errcodes,
-- role names, `'admin'`/`'member'`/`'owner'`, `'recovery'`, two intervals and the
-- five `raise exception` messages.)
--
-- ---------------------------------------------------------------------------
-- Where each definition came from, and why that one
-- ---------------------------------------------------------------------------
-- Four of the six were defined once and then **replaced** by a later migration.
-- The authoritative source is therefore the LAST `create or replace` for that
-- function in filename order — taking an earlier one would be a real regression
-- rather than a cosmetic fix:
--
--   public.complete_onboarding(text)         021 line 306   only definition
--   public.enforce_participation_gate()      023 line 239   only definition
--   public.enforce_onboarding_completion()   023 line 352   supersedes 003, 012
--   public.consume_password_reset_grant()    026 line 314   only definition
--   private.password_reset_session()         027 line  69   supersedes 026
--   private.transfer_owned_clubs(uuid)       032 line 107   supersedes 029
--
-- Note the last two especially: `027` rewrote `password_reset_session` so it can
-- never raise, and `032` reshaped `transfer_owned_clubs`'s failure handling.
-- Copying `026`'s or `029`'s body here would have quietly reverted both.
--
-- That selection is not asserted by eye. Each extracted body was hashed and
-- compared against DEV's live `prosrc`, and all six matched **byte for byte** —
-- raw md5, not normalised. Since DEV is the chain replayed in filename order,
-- that is a direct proof both that the right definition was chosen and that it
-- was copied verbatim rather than reflowed.
--
-- ---------------------------------------------------------------------------
-- Why no assertion is added to supabase/tests/
-- ---------------------------------------------------------------------------
-- Same reasoning as `028`. The repo's rule is that a migration changing a
-- **policy** must add an assertion; this changes no policy, no grant and no
-- constraint. And the suite builds its scratch database from these very files,
-- so its function bodies come from the chain by construction — an assertion on
-- body text would test this file against itself and would have been incapable of
-- catching the drift it is meant to guard. The drift lives between the files and
-- a *hosted* project, which only the query below reaches.
--
-- The behaviour of all six is already asserted: `003`/`012`/`023` cover the two
-- profile stamps and the participation gate, `026`/`027` the recovery grant, and
-- `029`/`031`/`032` the club transfer.
--
-- ---------------------------------------------------------------------------
-- How to re-verify (run against BOTH projects — this is the whole point)
-- ---------------------------------------------------------------------------
-- 1. Bodies agree. Expect the six normalised hashes above on each project, and
--    after this migration the RAW hashes agree too, so `raw_md5` is identical
--    across PROD and DEV for all six:
--
--      select n.nspname || '.' || p.proname as fn,
--             length(p.prosrc) as raw_len, md5(p.prosrc) as raw_md5,
--             md5(btrim(regexp_replace(regexp_replace(
--               p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))) as norm_md5
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where (n.nspname, p.proname) in (
--              ('public','complete_onboarding'),
--              ('public','enforce_onboarding_completion'),
--              ('private','transfer_owned_clubs'),
--              ('private','password_reset_session'),
--              ('public','consume_password_reset_grant'),
--              ('public','enforce_participation_gate'))
--       order by 1;
--
-- 2. Flags unchanged. `prosecdef` must read exactly:
--      complete_onboarding            t     enforce_onboarding_completion  f
--      consume_password_reset_grant   t     password_reset_session         f
--      enforce_participation_gate     t     transfer_owned_clubs           t
--    and every `proconfig` must be `{"search_path=\"\""}` — note the literal
--    quotes, which is how Postgres stores it; matching on `search_path=` alone
--    finds nothing and reads as a passing test.
--
--    The two `f` rows are deliberate and load-bearing.
--    `enforce_onboarding_completion` MUST stay `security invoker` (`023` footer):
--    its body opens with `if current_user <> 'authenticated' then return new`,
--    which short-circuits for the owner — as `security definer` the guard would
--    never fire for anyone. `password_reset_session` MUST stay invoker so
--    `auth.jwt()` resolves the CALLER's token (`026` §3).
--
-- 3. Grants unchanged. `create or replace` preserves the ACL; confirm anyway,
--    by role rather than by counting rows (`015`'s footer got that wrong once,
--    because `postgres` and `service_role` hold everything by Supabase default):
--
--      select p.proname,
--             has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
--             has_function_privilege('service_role',  p.oid, 'execute') as svc_x,
--             has_function_privilege('anon',          p.oid, 'execute') as anon_x
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where (n.nspname, p.proname) in ( ...as above... );
--
--    Measured on BOTH projects before this file was applied, and identical on
--    each — this is the baseline it must not move:
--
--      fn                                    auth_x  svc_x  anon_x
--      ----------------------------------------------------------
--      private.password_reset_session          f       f       f
--      private.transfer_owned_clubs            f       t       f
--      public.complete_onboarding              t       t       f
--      public.consume_password_reset_grant     t       t       f
--      public.enforce_onboarding_completion    t       t       t
--      public.enforce_participation_gate       f       t       f
--
--    The `t t t` row is NOT a typo and NOT something this file introduces.
--    `enforce_onboarding_completion` carries `=X/postgres` in its ACL — PUBLIC
--    holds EXECUTE, inherited by every role — because `003` created it and,
--    unlike `023` §2 for `enforce_participation_gate`, never revoked the default.
--    It has been that way on both projects since `003` and is unchanged here.
--
--    It is close to harmless and deliberately still logged: it returns `trigger`,
--    so a direct call fails with 0A000 ("trigger functions can only be called as
--    triggers") before a line of the body runs, and it is `security invoker`, so
--    it carries no privilege of its own. Worth a `revoke` in a later migration
--    for symmetry with `023`; NOT done here, because this file changes no grant.
--
-- 4. Triggers survived. `create or replace` cannot detach them, but the cost of
--    checking is one query. Expect 8 + 1 + 1:
--
--      select tgname, count(*) from pg_trigger
--       where not tgisinternal
--         and tgname in ('enforce_participation_gate',
--                        'enforce_onboarding_completion',
--                        'enforce_onboarding_completion_insert')
--       group by 1;
--
-- 5. Advisors. `get_advisors(security)` must still return exactly the eight
--    documented in `CLAUDE.md` — six `security definer` functions, the
--    `password_reset_grants` INFO, and the leaked-password WARN. No NEW
--    `authenticated_security_definer_function_executable`: this file adds no
--    function and grants nothing to `authenticated`.


-- -------------------------------------------------------------------------
-- §1. public.complete_onboarding — verbatim from 021_onboarding_state_accessors.sql line 306
-- -------------------------------------------------------------------------
--
-- The onboarding wizard's final step. Only definition in the chain.
-- PROD lost 1773 bytes of comment, including the `coalesce` note — the one
-- recording that `coalesce` is deliberately NOT schema-qualified because
-- `pg_catalog.coalesce` does not exist and raises 42883 on the happy path.
-- That note exists precisely so a later session does not "fix" the
-- inconsistency and break the wizard.

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

-- -------------------------------------------------------------------------
-- §2. public.enforce_participation_gate — verbatim from 023_participation_gate.sql line 239
-- -------------------------------------------------------------------------
--
-- The participation gate. Only definition in the chain.
-- The single-byte case: no in-body comments to lose, so what PROD is missing
-- is the blank line before `return new;`.
--
-- Stays `security definer` — its guard lives in the trigger's WHEN clause
-- (`current_user = 'authenticated'`), evaluated in the caller's context, not
-- in this body. See 023 §2.

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

-- -------------------------------------------------------------------------
-- §3. public.enforce_onboarding_completion — verbatim from 023_participation_gate.sql line 352
-- -------------------------------------------------------------------------
--
-- Supersedes the definitions in 003 (line 178) and 012 (line 74). 023 added
-- the INSERT arm (§1.14) and the consent check (§1.13); copying 003's or
-- 012's body here would silently drop both.
--
-- Stays `security invoker` — NOT a mistake. The body opens by returning
-- early unless `current_user` is `authenticated`, which as `security definer`
-- would be false on every call, so the guard would never fire for anyone.
-- This is the exact defect 022 shipped in the opposite direction.

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

-- -------------------------------------------------------------------------
-- §4. public.consume_password_reset_grant — verbatim from 026_password_reset_grant.sql line 314
-- -------------------------------------------------------------------------
--
-- Spends the recovery grant. Only definition in the chain.
-- Calls private.password_reset_session() (§5) — replace order is irrelevant,
-- both already exist and plpgsql resolves the call at execution time.

create or replace function public.consume_password_reset_grant()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid      uuid := private.password_reset_session();
  uid      uuid := auth.uid();
  consumed integer;
begin
  if sid is null or uid is null then
    return false;
  end if;

  -- Retention, on the only path that writes here. See the header.
  delete from public.password_reset_grants
   where claimed_at < now() - interval '24 hours';

  insert into public.password_reset_grants (session_id, user_id)
  values (sid, uid)
  on conflict (session_id) do nothing;

  get diagnostics consumed = row_count;
  return consumed > 0;
end;
$$;

-- -------------------------------------------------------------------------
-- §5. private.password_reset_session — verbatim from 027_password_reset_session_never_raises.sql line 69
-- -------------------------------------------------------------------------
--
-- Supersedes 026 line 205. 027 rewrote it so it can never raise, moving the
-- `auth.jwt()` assignment inside the block (a declaration's default is
-- evaluated before the exception handler is in scope) and switching max() to
-- min(). Copying 026's body here would reintroduce both bugs.
--
-- Stays `security invoker` so `auth.jwt()` resolves the CALLER's token.

create or replace function private.password_reset_session()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  claims  jsonb;
  amr     jsonb;
  sid     uuid;
  epoch   numeric;
  granted timestamptz;
begin
  -- Assigned inside the block rather than in the declaration, because a
  -- declaration's default expression is evaluated BEFORE the exception handler
  -- is in scope — which is how (b) escaped 026's guard.
  claims := auth.jwt();

  if claims is null or jsonb_typeof(claims) <> 'object' then
    return null;
  end if;

  sid := (claims ->> 'session_id')::uuid;
  if sid is null then
    return null;
  end if;

  amr := claims -> 'amr';

  -- `amr` is optional in the token and may be an array of plain strings rather
  -- than objects when a custom access token hook is installed (none is, today).
  -- Both shapes fall through to zero matching elements below.
  if amr is null or jsonb_typeof(amr) <> 'array' then
    return null;
  end if;

  -- min(), not max() — see the header. Range-guarded so the ordinary path does
  -- not lean on the handler.
  select min((e ->> 'timestamp')::numeric)
    into epoch
    from jsonb_array_elements(amr) as e
   where jsonb_typeof(e) = 'object'
     and e ->> 'method' = 'recovery'
     and jsonb_typeof(e -> 'timestamp') = 'number';

  if epoch is null or epoch < 0 or epoch > 253402300800 then
    return null;
  end if;

  granted := pg_catalog.to_timestamp(epoch);

  -- Fifteen minutes, matching the cookie 026 replaced. Only the lower bound is
  -- checked: a timestamp in the future can only come from skew between two
  -- Supabase-managed clocks, since the claim is signed and the client cannot
  -- move it, and rejecting on skew would break recovery for a threat that does
  -- not exist.
  if pg_catalog.now() - granted > interval '15 minutes' then
    return null;
  end if;

  return sid;
exception
  when others then
    -- Blunt on purpose. Every input that does not yield a grant means the same
    -- thing, and this function's callers do no error handling of their own.
    return null;
end;
$$;

-- -------------------------------------------------------------------------
-- §6. private.transfer_owned_clubs — verbatim from 032_transfer_owned_clubs_failure_shape.sql line 107
-- -------------------------------------------------------------------------
--
-- Supersedes 029 line 149. 032 reshaped the failure handling — the `for
-- update of p` successor lock and the private-rides-only delete. Copying
-- 029's body here would revert the correction that 032 exists to make.
--
-- Reached only through 031's service_role-only public wrapper; this file
-- does not touch that wrapper or its grant.

create or replace function private.transfer_owned_clubs(departing uuid)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  club record;
  successor uuid;
begin
  for club in
    select c.id, c.avatar_path, c.cover_image_path
      from public.clubs c
     where c.owner_id = departing
     order by c.id
     for update
  loop
    if club.avatar_path is not null then
      object_path := club.avatar_path;
      return next;
    end if;
    if club.cover_image_path is not null then
      object_path := club.cover_image_path;
      return next;
    end if;

    -- admin, then member, then anything else — total over the enum, so a stray
    -- second 'owner' row sorts last rather than being picked at random.
    --
    -- `for update of p` makes the selection sound WITHIN this transaction: a
    -- candidate whose own deletion is committing concurrently is skipped in
    -- favour of the next, rather than being misread as "no successor". It does
    -- NOT prevent selecting someone whose deletion starts a moment later — see
    -- §3 above, which states that race rather than pretending it is closed.
    select m.user_id into successor
      from public.club_members m
      join public.profiles p on p.id = m.user_id
     where m.club_id = club.id
       and m.user_id <> departing
     order by case m.role when 'admin' then 0 when 'member' then 1 else 2 end,
              m.joined_at,
              m.user_id
     limit 1
       for update of p;

    if successor is not null then
      update public.clubs
         set owner_id         = successor,
             avatar_path      = null,
             cover_image_path = null
       where id = club.id;

      update public.club_members
         set role = 'owner'
       where club_id = club.id
         and user_id = successor;

      -- DEMOTED, not deleted — §1. This transaction commits before the rest of
      -- the deletion runs, so the row has to survive a failure in between.
      update public.club_members
         set role = 'member'
       where club_id = club.id
         and user_id = departing;
    else
      -- No member remains, so the club goes — 009's original case.
      --
      -- Only the rides that `SET NULL` would turn into zombies. A public ride
      -- survives the club perfectly well; deleting it destroys another rider's
      -- content for no reason D3 ever gave. §2.
      delete from public.rides
       where club_id = club.id
         and is_public = false;
      delete from public.clubs where id = club.id;
    end if;

    successor := null;
  end loop;
end;
$$;
