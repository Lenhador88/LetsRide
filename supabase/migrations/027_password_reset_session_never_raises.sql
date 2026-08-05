-- 027: make `private.password_reset_session()` keep the contract it documents.
--
-- =========================================================================
-- ** PURELY ADDITIVE — one `create or replace`, no grant and no policy moves.
-- Safe to apply on its own, in either order relative to a deploy. **
-- =========================================================================
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- `026` gives the function this contract, in its own comment and twice in its
-- header: "Never raises." Both callers are built on it — the whole design is
-- that every way of *not* qualifying for a grant returns NULL, because a raise
-- turns a malformed token into a 500 on the password-reset screen instead of a
-- refusal.
--
-- It did not hold. The `begin/exception` block guarded exactly one thing, the
-- `session_id` cast, and two other paths could raise straight through it.
-- Found by review, then reproduced against a scratch database rather than
-- argued:
--
--   a) `amr: [{"method":"recovery","timestamp":1e300}]` -> `22008 timestamp out
--      of range`, from `to_timestamp`. The `jsonb_typeof(e -> 'timestamp') =
--      'number'` filter *admits* it — 1e300 is a perfectly good JSON number and
--      a perfectly impossible instant.
--
--   b) `request.jwt.claims` that is not valid JSON -> `22P02`, raised by
--      `auth.jwt()` itself, which runs in the variable's default expression and
--      therefore *before* the `claims is null` check could ever run.
--
-- Neither is reachable through a Supabase-signed token today: GoTrue writes
-- int64 timestamps and PostgREST writes the claims JSON itself. So this is
-- robustness rather than a live hole — but the asymmetry is the defect. A
-- function whose entire job is to fail closed, and whose callers do no error
-- handling of their own, must not have one guarded cast and two unguarded ones.
--
-- ---------------------------------------------------------------------------
-- The fix, and why it is shaped this way
-- ---------------------------------------------------------------------------
-- The body moves inside a single `begin ... exception when others then return
-- null end`. That is deliberately blunt: the function has exactly one caller-
-- visible outcome that is not NULL, and every input that fails to produce it —
-- malformed, out of range, absent, wrong type, or something not yet imagined —
-- means the same thing, which is "no grant". Enumerating the SQLSTATEs would be
-- a list to keep in step with a structure the app does not control.
--
-- `to_timestamp` is additionally range-guarded rather than left to the handler,
-- so the ordinary case does not depend on an exception block for its answer.
-- Postgres timestamps run to 294276 AD; the bound below is far inside that and
-- far outside any epoch second a real token can carry.
--
-- **`min()` rather than `max()` on a duplicated `recovery` entry.** `026` took
-- the newest, which is the most *permissive* reading — a stale entry beside a
-- fresh one yielded a grant. GoTrue upserts one `mfa_amr_claims` row per method
-- per session, so a duplicate is not reachable either; but where two readings
-- are both unreachable, the conservative one is free. Same reasoning as `026`
-- §3 accepting only `recovery` where the platform accepts three methods: being
-- narrower than the platform is never a security regression.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT changed
-- ---------------------------------------------------------------------------
-- The 15-minute window, the lower-bound-only expiry check, the `recovery`-only
-- method list, and both public wrappers. `026`'s reasoning for each stands, and
-- its §2 limit — that this gates the app's front door and not GoTrue's
-- `PUT /auth/v1/user` — is unchanged and still needs the project setting an
-- owner has to turn on.

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

comment on function private.password_reset_session() is
  'The recovery-grant rule, written once: the caller''s session id if their token carries a `recovery` amr entry less than 15 minutes old, else NULL. Never raises — and as of 027 that is enforced by a handler around the whole body rather than by one guarded cast (see the migration header for the two inputs that escaped 026).';

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying
-- ---------------------------------------------------------------------------
--
-- These need a JWT to be meaningful; the suite exercises them properly under
-- `set request.jwt.claims`. See supabase/tests/rls_test.sql, §password reset.
--
-- Expected: NULL, not an error — the two inputs that raised before.
--   set local request.jwt.claims = '{"sub":"...","session_id":"...","amr":[{"method":"recovery","timestamp":1e300}]}';
--   select private.password_reset_session();
--
--   set local request.jwt.claims = 'not json at all';
--   select private.password_reset_session();
--
-- Expected: f — the function stays private and unpublished, so PostgREST
-- cannot reach it and no role but the definer's callers can execute it.
--   select has_function_privilege('authenticated','private.password_reset_session()','execute');
