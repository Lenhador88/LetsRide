-- 026: The password-recovery grant — a Supabase-signed proof, not a cookie.
--
-- Replaces the httpOnly `lr-recovery` cookie that /auth/callback sets today and
-- `updatePassword` requires. The cookie cannot survive the client-rendered
-- shell: there is no Route Handler to set it and no httpOnly store to put it
-- in. This migration moves the same two properties into the database.
--
-- The properties, unchanged from the cookie:
--
--   1. Only a session established by a recovery link may change the password
--      without knowing the old one.
--   2. The ability to reset is spent by the reset. One link, one reset.
--
-- The threat is NOT "an attacker holds a recovery link". It is that a recovery
-- link produces an *ordinary* session, indistinguishable from signing in, and
-- proxy.ts deliberately does not bounce signed-in riders off
-- /auth/reset-password (Q1 — doing so broke recovery, because Supabase's link
-- establishes a session before the reset page loads). Without a marker, anyone
-- holding a live session — a shared device, a borrowed laptop — can set a new
-- password without knowing the old one.
--
-- ---------------------------------------------------------------------------
-- §1  Why this is not the Edge Function design.md D3 specifies
-- ---------------------------------------------------------------------------
-- D3 chose "an Edge Function exchanges the recovery code and returns a
-- short-lived, single-use grant". **The first half of that cannot be built**,
-- and the reason is PKCE.
--
-- Measured, not recalled:
--
--   * `@supabase/ssr` 0.12.4 hardcodes `flowType: "pkce"` in BOTH
--     createBrowserClient and createServerClient (dist/main/createBrowserClient.js:40,
--     createServerClient.js:33). It is not a default this app chose or can drop
--     without replacing the client factory.
--   * `resetPasswordForEmail` therefore sends a `code_challenge` and stores the
--     verifier in *its own* storage (auth-js 2.111.0 GoTrueClient.js).
--   * `exchangeCodeForSession` reads that verifier back out of the same storage
--     (`retrievePKCEVerifier(this.storage, ...)`) and refuses without it
--     (`AuthPKCECodeVerifierMissingError`).
--
-- So the exchange can only be performed by the client that asked for the link.
-- An Edge Function holds no verifier and cannot obtain one — and shipping the
-- verifier to it would move a client secret to a server for no gain. D3's
-- chosen mechanism is not implementable as written.
--
-- What D3 actually wanted from the Edge Function was **a proof the client
-- cannot forge**. That already exists, signed by Supabase, in the access token:
--
--   * The project mints ES256 tokens with a published JWKS
--     (/auth/v1/.well-known/jwks.json, `"alg":"ES256"`). Asymmetric — the client
--     holds no key that could sign one.
--   * GoTrue records *how* a session was established. `POST /recover` creates a
--     PKCE flow state with authentication method `Recovery`
--     (internal/api/recover.go:60, v2.195.0 — the version /auth/v1/health
--     reports for this project). The PKCE token exchange parses that method off
--     the flow state and issues the session with it (internal/api/token.go),
--     which writes an `mfa_amr_claims` row (internal/tokens/service.go:925),
--     which is what the `amr` array in the access token is built from
--     (internal/models/sessions.go:390). `models.Recovery.String()` is
--     `"recovery"` (internal/models/factor.go).
--   * A password sign-in on this project decodes to
--     `"amr":[{"method":"password","timestamp":...}]` — measured against the
--     live project with the qa-verify fixture.
--
-- PostgREST verifies that signature before it opens a transaction and puts the
-- whole payload in `request.jwt.claims`, which is where `auth.jwt()` reads it
-- and where `auth.uid()` already gets `sub` on every policy in this schema. So
-- the check belongs in Postgres, and needs no secret, no service-role key, no
-- Edge Function and no deploy of anything but SQL. Decision #8's second bullet
-- never has to be opened.
--
-- This is tier 2 in CLAUDE.md's three tiers, and D3's own reasoning read
-- literally: the proof is server-issued, it is just issued by the auth server
-- rather than by one we write.
--
-- ---------------------------------------------------------------------------
-- §2  What this does NOT close, and who has to close it
-- ---------------------------------------------------------------------------
-- **The cookie never enforced property 1 against a determined caller, and
-- neither does this.** The password change itself happens at GoTrue's
-- `PUT /auth/v1/user`, not in Postgres. Any holder of a live session can call
-- it directly with the publishable key that already ships in the bundle. The
-- cookie gated the app's Server Action; this gates the app's RPC. Both gate the
-- front door.
--
-- Measured against the live project, safely — `PUT /auth/v1/user` with the
-- fixture's *existing* password from an ordinary password session returns
-- `422 same_password`. That check sits AFTER both platform gates in
-- internal/api/user.go (reauthentication at :151, current-password at :172,
-- same-password at :193), so reaching it proves both gates are currently OFF.
--
-- The gate that closes it is GoTrue's own, and it already implements property 1
-- exactly:
--
--     if config.Security.UpdatePasswordRequireCurrentPassword {
--         // ensure user is not in a password recovery flow
--         if !session.IsRecovery() {  ... require current_password ... }
--     }
--
-- `Session.IsRecovery()` is true for amr methods `recovery`, `otp` and
-- `magiclink` (internal/models/factor.go). Turning that setting on is a
-- **project-configuration change the product owner has to make** — it cannot be
-- done from a migration. Until it is, this grant is the app's own discipline,
-- which is exactly what the cookie was.
--
-- ---------------------------------------------------------------------------
-- §3  Why the accepted method is `recovery` alone, and not GoTrue's set
-- ---------------------------------------------------------------------------
-- GoTrue treats `otp` and `magiclink` as recovery too. This migration does not,
-- deliberately:
--
--   * The app has exactly one path that mints a recovery session, and it
--     records `recovery`. Nothing here signs in by OTP or magic link.
--   * `otp` is what the *implicit* flow and the `verifyOtp({type:'recovery'})`
--     token-hash path record instead (internal/api/verify.go issues
--     `models.OTP` on both). If the native shell ever moves the recovery email
--     to `{{ .TokenHash }}` — a plausible choice for a deep link — this stops
--     matching and **password reset fails closed and loudly** rather than
--     quietly widening. That is the failure direction to want, and the fix is
--     one word in §5 plus an assertion.
--   * Being narrower than the platform is never a security regression.
--
-- ---------------------------------------------------------------------------
-- §4  The table: what it records, its retention, and its reach
-- ---------------------------------------------------------------------------
-- The *grant* is the Supabase-signed `recovery` entry in the caller's own
-- token. Nothing in this schema issues it and nothing here could forge it. The
-- table records only that a grant has been **spent**, which is the one piece of
-- state property 2 needs and the one piece the JWT cannot carry — `amr`
-- describes how a session started and does not change when it is used.
--
-- Keyed on `session_id` because that is what "one link, one reset" means:
-- GoTrue consumes the one-time token at /verify and destroys the flow state at
-- the exchange, so one link yields exactly one session, and a session's id is
-- stable across token refresh. The refresh path does not touch mfa_amr_claims
-- (internal/tokens/service.go RefreshTokenGrant passes models.TokenRefresh to
-- GenerateAccessToken and never calls AddClaimToSession), so the recovery
-- entry's timestamp is the instant the session was minted and cannot be slid
-- forward by refreshing. That is what makes the fifteen-minute window in §5
-- mean fifteen minutes.
--
-- RETENTION — 24 hours. A row is (session id, rider id, when) and says "this
-- rider reset their password at this time", which is personal data under an EU
-- project. It is useful for exactly the fifteen minutes the window is open;
-- everything beyond that is slack for clock skew and curiosity. The mechanism
-- is a sweep inside consume_password_reset_grant, so it needs no scheduler.
-- KNOWN LIMIT, stated rather than left to be discovered: the sweep only runs
-- when some rider resets a password, so in a quiet month the last few rows
-- outlive the window. A pg_cron job is the complete answer and is deliberately
-- not added here — supabase/tests runs on plain Postgres without the extension,
-- and a migration the suite cannot apply is worse than a documented limit.
--
-- REACH — `user_id references auth.users(id) on delete cascade`. Account
-- deletion (roadmapped, not built) reaches this table on the day it lands,
-- without anyone having to remember it exists.
--
-- OFFLINE — no client-generated UUID and no `updated_at`, and both omissions
-- are deliberate. Nothing here is client-created or editable: the only writer is
-- a security definer function, the only key is minted by the auth server, and a
-- replayed consume is idempotent by primary key rather than by convention.

create table public.password_reset_grants (
  session_id uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.password_reset_grants enable row level security;

comment on table public.password_reset_grants is
  'One row per recovery session that has been spent on a password reset. The grant itself is the Supabase-signed `recovery` entry in the caller''s access token; this records only that it has been used. Reached exclusively through consume_password_reset_grant() and has_password_reset_grant() — no role holds a grant on it and it carries no policies, both on purpose.';

comment on column public.password_reset_grants.session_id is
  'auth.jwt() ->> ''session_id'' of the recovery session. Stable across token refresh, so it identifies the link rather than the token.';

comment on column public.password_reset_grants.claimed_at is
  'Retention: swept 24h after this instant by consume_password_reset_grant(). See the migration header.';

-- The sweep's index. Small table, but the sweep runs on the hot path of a reset
-- and a sequential scan there is a needless one.
create index password_reset_grants_claimed_at_idx
  on public.password_reset_grants (claimed_at);

-- RLS is on and there are NO policies, which is the intended access: none. The
-- table is reached only by the two security definer functions below, which run
-- as the owner and are not subject to policies. A policy here would describe
-- direct access that must not exist, and the assertions in rls_test.sql fail if
-- one appears.
revoke all on public.password_reset_grants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- §5  The rule, written once
-- ---------------------------------------------------------------------------
-- Returns the caller's recovery session id, or NULL if this session may not
-- reset a password. Every way of not qualifying returns NULL — no exceptions
-- escape, no partial answers — because the two callers below both treat NULL as
-- "refuse" and a raise would turn a malformed token into a 500 instead of a
-- refusal.
--
-- security INVOKER: it reads nothing but the caller's own verified claims, so
-- there is no privilege to elevate. It lives in `private` so PostgREST does not
-- publish it, and no role is granted execute — the two entry points below run
-- as the owner and reach it that way. Same shape as private.is_blocked, one
-- notch narrower.
create or replace function private.password_reset_session()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  claims  jsonb := auth.jwt();
  amr     jsonb;
  sid     uuid;
  granted timestamptz;
begin
  if claims is null then
    return null;
  end if;

  -- A malformed session_id is a refusal, not an error. 22P02 out of here would
  -- surface as a 500 on the reset screen.
  begin
    sid := (claims ->> 'session_id')::uuid;
  exception when others then
    return null;
  end;

  if sid is null then
    return null;
  end if;

  amr := claims -> 'amr';

  -- `amr` is optional in the token and may be an array of plain strings rather
  -- than objects when a custom access token hook is installed (none is, today).
  -- Both shapes fail closed here.
  if amr is null or jsonb_typeof(amr) <> 'array' then
    return null;
  end if;

  select to_timestamp(max((e ->> 'timestamp')::numeric))
    into granted
    from jsonb_array_elements(amr) as e
   where jsonb_typeof(e) = 'object'
     and e ->> 'method' = 'recovery'
     and jsonb_typeof(e -> 'timestamp') = 'number';

  if granted is null then
    return null;
  end if;

  -- Fifteen minutes, matching the cookie's maxAge exactly. Only the lower bound
  -- is checked: a timestamp in the future can only come from skew between two
  -- Supabase-managed clocks, since the claim is signed and the client cannot
  -- move it, and rejecting on skew would break recovery for a threat that does
  -- not exist.
  if now() - granted > interval '15 minutes' then
    return null;
  end if;

  return sid;
end;
$$;

revoke all on function private.password_reset_session() from public, anon, authenticated;

comment on function private.password_reset_session() is
  'The recovery-grant rule, written once: the caller''s session id if their token carries a `recovery` amr entry less than 15 minutes old, else NULL. Never raises.';

-- ---------------------------------------------------------------------------
-- §6  The two entry points
-- ---------------------------------------------------------------------------
-- Both are security definer for one reason: they read and write a table no role
-- holds a grant on. Both take **no arguments**, so neither can be asked about
-- anyone but its own caller — the same narrowness argument 011 §1b makes for
-- moderate_comment, one step stronger, because there is no id to pass.
--
-- Expect the security advisors to list both alongside moderate_comment. That is
-- this migration's deliberate choice, not a regression to fix.

-- Read-only. The reset screen calls this to decide between the form and the
-- expired notice, and must not spend the grant to find out it has one.
create or replace function public.has_password_reset_grant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from (select private.password_reset_session() as sid) s
     where s.sid is not null
       and not exists (
         select 1 from public.password_reset_grants g where g.session_id = s.sid
       )
  );
$$;

revoke all on function public.has_password_reset_grant() from public, anon;
grant execute on function public.has_password_reset_grant() to authenticated;

comment on function public.has_password_reset_grant() is
  'True if the caller''s session may still change the password without knowing the old one. Read-only — does not spend the grant.';

-- Spends it. Returns true exactly once per recovery session; every later call,
-- and every call from a session that never had a grant, returns false.
--
-- The insert IS the single-use enforcement — the primary key makes a second
-- consume a no-op rather than a race — so nothing here needs to lock or read
-- before writing.
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

revoke all on function public.consume_password_reset_grant() from public, anon;
grant execute on function public.consume_password_reset_grant() to authenticated;

comment on function public.consume_password_reset_grant() is
  'Spends the caller''s recovery grant. True exactly once per recovery session; false for an ordinary session, an expired grant, or a second attempt. Call it BEFORE updating the password — see updatePassword.';

-- ---------------------------------------------------------------------------
-- §Verification — run these against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Expected: 0 — the table carries no policies at all. Access is via the two
-- functions or not at all.
--   select count(*) from pg_policies where tablename = 'password_reset_grants';
--
-- Expected: t — RLS is on, so the absence of policies denies rather than allows
--   select relrowsecurity from pg_class
--    where oid = 'public.password_reset_grants'::regclass;
--
-- Expected: f, f, f, f — scoped to the grantee on purpose. The unscoped form
-- ("no grants on the table") always returns rows, because postgres owns it and
-- service_role is granted everything by Supabase default. 015's footer got this
-- wrong once; do not repeat it.
--   select has_table_privilege('authenticated', 'public.password_reset_grants', p)
--     from unnest(array['select','insert','update','delete']) p;
--
-- Expected: 0 — anon holds nothing
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'password_reset_grants' and grantee = 'anon';
--
-- Expected: t, t, f — the two entry points are DEFINER, the rule is INVOKER
--   select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where (n.nspname, p.proname) in (('public','has_password_reset_grant'),
--                                     ('public','consume_password_reset_grant'),
--                                     ('private','password_reset_session'))
--    order by p.proname;
--
-- Expected: {search_path=} on all three — a definer function with a mutable
-- search_path is the advisor finding this migration must not add
--   select proname, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where (n.nspname, p.proname) in (('public','has_password_reset_grant'),
--                                     ('public','consume_password_reset_grant'),
--                                     ('private','password_reset_session'));
--
-- Expected: f, f — anon cannot call either entry point
--   select has_function_privilege('anon', 'public.has_password_reset_grant()', 'execute'),
--          has_function_privilege('anon', 'public.consume_password_reset_grant()', 'execute');
--
-- Expected: f — authenticated cannot reach the rule directly, only through the
-- two entry points
--   select has_function_privilege('authenticated', 'private.password_reset_session()', 'execute');
--
-- ---------------------------------------------------------------------------
-- The one thing the local suite cannot prove, and how to prove it here
-- ---------------------------------------------------------------------------
-- rls_test.sql sets `request.jwt.claims` itself, so it proves the SQL is right
-- and proves nothing about whether PostgREST actually puts `amr` there. Run
-- this against the hosted project to close that — it is the hosted idiom from
-- CLAUDE.md §After every migration, and it writes nothing (the second statement
-- is read-only; the third rolls back):
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"efc542b8-8286-48eb-8b16-26b652e43d5a",
--     "session_id":"11111111-1111-1111-1111-111111111111",
--     "amr":[{"method":"recovery","timestamp":<extract epoch from now()>}]}';
--   select public.has_password_reset_grant();      -- expect t
--   select public.consume_password_reset_grant();  -- expect t
--   select public.consume_password_reset_grant();  -- expect f  (single use)
--   select public.has_password_reset_grant();      -- expect f
--   rollback;
--
-- And with "recovery" swapped for "password", the first call must return f.
--
-- **Neither of those is the end-to-end proof.** The only thing that proves a
-- real recovery link mints `amr:[{"method":"recovery"}]` on THIS project is
-- clicking one, and that needs a mailbox no session here can read. It is the
-- last gate before this ships; see the report.
