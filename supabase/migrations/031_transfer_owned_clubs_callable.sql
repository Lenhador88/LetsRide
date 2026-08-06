-- 031: give the deletion function a door it can actually open.
--
-- **This corrects a defect in `029`, found by measurement rather than review.**
-- `029` put `private.transfer_owned_clubs` in `private` and revoked EXECUTE from
-- `public`, `anon` and `authenticated`, reasoning that the deletion Edge
-- Function would reach it as `service_role`. It cannot. Two independent
-- barriers, either of which alone is fatal:
--
--   select has_schema_privilege('service_role', 'private', 'usage');            -- false
--   select has_function_privilege('service_role',
--            'private.transfer_owned_clubs(uuid)', 'execute');                  -- false
--
-- and, separately, **PostgREST only exposes `public`** (plus `graphql_public`).
-- supabase-js's `.schema('private')` sets the `Content-Profile` header, and
-- PostgREST refuses a schema that is not in its exposed list — so even with both
-- grants the call would never reach Postgres. `005` put the helpers in `private`
-- precisely so PostgREST could not publish them, and that worked exactly as
-- designed against the caller we now want.
--
-- The mistake worth naming, because it is the reusable part: `029` deferred the
-- wrapper on the grounds that it "belongs with the Edge Function that calls it
-- and can be exercised". That was the right instinct and the wrong conclusion —
-- deferring the *callable surface* meant shipping a function with no caller and
-- no way to discover it had none, since nothing in the RLS suite calls it the
-- way production would. The suite runs as the table owner, for whom every
-- barrier above is absent.
--
-- ---------------------------------------------------------------------------
-- Why a `public` wrapper rather than the alternatives
-- ---------------------------------------------------------------------------
-- Considered, and rejected:
--
--   - **Grant `service_role` USAGE on `private` and EXECUTE on the function.**
--     Does not help on its own — PostgREST still will not route to `private` —
--     and it widens `private` for every helper in it, including
--     `is_blocked`, which is the one schema-level boundary `009` and `005` built
--     deliberately. Rejected as strictly worse than a named door.
--   - **Expose `private` to PostgREST.** Publishes `is_blocked`,
--     `is_club_member`, `is_club_public`, `may_participate` and
--     `password_reset_session` as REST endpoints in one setting change. No.
--   - **Connect to Postgres directly from the Edge Function.** Needs the
--     database password or a pooler URL — a second secret, of a broader kind
--     than the service-role key, to avoid one wrapper. Rejected.
--
-- **The wrapper is `security invoker` and does nothing but call the worker.**
-- It adds no privilege of its own: the elevation lives where `029` put it, in
-- the `security definer` worker, and this file only decides *who may knock*. So
-- the blast radius is unchanged and the audit surface is one four-line function.
--
-- **`authenticated` gets nothing**, which is what keeps `D1`'s objection
-- answered. `D1` refuses to put a row-deleting privileged function on
-- PostgREST's published surface; a function published but executable only by
-- `service_role` answers a client call with `42501` before any row is read, the
-- same posture `026` gives `password_reset_grants`. It is published in the sense
-- that a URL exists and refuses everyone who can reach it.
--
-- It also does not add a security advisor:
-- `authenticated_security_definer_function_executable` fires on functions
-- `authenticated` may execute, and this one it may not. Expect the count to stay
-- at eight.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against the hosted project 2026-08-06
-- ---------------------------------------------------------------------------
--   service_role USAGE on private ............................ false
--   service_role EXECUTE on private.transfer_owned_clubs ..... false
--   pgrst.db_schemas set at database level ................... not set (default: public)
--   existing functions in public named transfer_* ............ 0

create or replace function public.transfer_owned_clubs_for_deletion(departing uuid)
returns table (object_path text)
language sql
volatile
security invoker
set search_path = ''
as $$
  select t.object_path from private.transfer_owned_clubs(departing) t;
$$;

comment on function public.transfer_owned_clubs_for_deletion(uuid) is
  'The deletion Edge Function''s door to private.transfer_owned_clubs (031). security INVOKER and privilege-free: it exists because PostgREST only routes to `public` and service_role holds no USAGE on `private`, not to grant anything. EXECUTE is service_role only — an authenticated caller gets 42501 before a row is read. Takes a uuid because the caller is a trusted server holding the service-role key and has already resolved the subject from a verified JWT; the no-id rule is enforced at the Edge Function boundary, which is the only place a rider''s identity exists.';

revoke all on function public.transfer_owned_clubs_for_deletion(uuid) from public, anon, authenticated;
grant execute on function public.transfer_owned_clubs_for_deletion(uuid) to service_role;

-- `security invoker` means the worker runs with the *caller's* privileges at the
-- schema level, so service_role still needs to be able to resolve
-- `private.transfer_owned_clubs`. USAGE on the schema is the minimum that
-- permits name resolution; EXECUTE on the function is granted with it. This is
-- narrower than it looks — schema USAGE does not grant EXECUTE on anything else
-- in `private`, and every other helper there keeps its own revoke.
grant usage on schema private to service_role;
grant execute on function private.transfer_owned_clubs(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- The door opens for exactly one role. Expect t, f, f, f:
--
--   select has_function_privilege('service_role',   'public.transfer_owned_clubs_for_deletion(uuid)', 'execute'),
--          has_function_privilege('authenticated',  'public.transfer_owned_clubs_for_deletion(uuid)', 'execute'),
--          has_function_privilege('anon',           'public.transfer_owned_clubs_for_deletion(uuid)', 'execute'),
--          has_function_privilege('authenticator',  'public.transfer_owned_clubs_for_deletion(uuid)', 'execute');
--
-- The worker is reachable by service_role and still nobody else. Expect t, f, f:
--
--   select has_function_privilege('service_role',  'private.transfer_owned_clubs(uuid)', 'execute'),
--          has_function_privilege('authenticated', 'private.transfer_owned_clubs(uuid)', 'execute'),
--          has_function_privilege('anon',          'private.transfer_owned_clubs(uuid)', 'execute');
--
-- Widening `private` for service_role did not widen it for the client. Expect
-- f, f — this is the assertion that matters most in this file:
--
--   select has_schema_privilege('authenticated', 'private', 'usage'),
--          has_schema_privilege('anon',          'private', 'usage');
--
-- And through PostgREST, as a rider, the endpoint now exists and refuses:
--
--   curl -X POST "$URL/rest/v1/rpc/transfer_owned_clubs_for_deletion" \
--     -H "apikey: $PUBLISHABLE" -H "Authorization: Bearer $RIDER_JWT" \
--     -H 'content-type: application/json' -d '{"departing":"<any uuid>"}'
--   -- -> 42501, and no club changes hands
