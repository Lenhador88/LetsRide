-- 030: consent records what it consented TO, not only when.
--
-- `012` argues at length that `terms_accepted_at` is evidence, and that evidence
-- a party can rewrite is not evidence. It then stores a bare timestamp. The
-- document at `/legal/terms` changes without leaving a trace, so a stamp from
-- last March cannot say which text it agreed to — which is `012`'s own standard,
-- applied to `012`'s own column, and it did not notice.
--
-- Cheap now. Impossible to reconstruct later: there is no archive of the terms
-- page and no column to hang one off.
--
-- ---------------------------------------------------------------------------
-- The version string is `0-placeholder`, and that is not a stub
-- ---------------------------------------------------------------------------
-- `src/app/legal/terms/page.tsx` is placeholder copy whose own second paragraph
-- reads "Do not treat this page as an agreement… must be replaced before the app
-- accepts real users." So the honest value for every consent recorded today is
-- that no binding document existed, and a plausible-looking `2026-08-06` would
-- assert the opposite of what the page says.
--
-- **This is the product owner's to replace** (proposal Q14 — "Eng, PO to supply
-- the version string"), and replacing it is one line in
-- `private.current_terms_version()` in a new migration, because that function is
-- the only place the value lives. Consents already stamped keep the version they
-- were given; that is the entire point of the column.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against the hosted project 2026-08-06
-- ---------------------------------------------------------------------------
--   profiles ....................................... 4
--   profiles.terms_version already present ......... 0 (column does not exist)
--
-- **No backfill**, the same ruling `023` records and for the same reason: a
-- version invented for a consent that predates the column is a fabricated
-- evidence record, which is worse than a NULL that honestly says "unknown". The
-- four existing rows keep NULL for ever.

-- ---------------------------------------------------------------------------
-- §1. The column
-- ---------------------------------------------------------------------------
--
-- **No grant to `authenticated`, deliberately, and the absence IS the control.**
-- `025` revoked the table-level SELECT/INSERT/UPDATE on `profiles` and re-granted
-- an explicit column allowlist, warning that "every column added to `profiles`
-- from now on is invisible to `authenticated` until it is added to these
-- grants". This column is not added to any of the three, which puts it in the
-- same position as `terms_accepted_at` and `onboarding_completed_at`: server
-- owned, reachable only through a `security definer` accessor.
--
-- That is *stronger* than the trigger guard the task list asked for. Task 1.9
-- wanted "a client-supplied version is replaced by the server's", copying `012`'s
-- shape for the timestamp. With no column grant there is nothing to replace —
-- column privileges are checked against the columns named in SET **before any
-- BEFORE trigger runs** (`025` §DEFECT 2c reasons this out in full), so a client
-- naming the column is refused with `42501` rather than silently corrected.
-- Refusal beats correction, so §3 asserts the stronger property.
--
-- It also means `public.enforce_onboarding_completion` is left alone. Three
-- migrations have layered that function (`003`, `012`, `023`) and a fourth
-- `create or replace` to add a redundant arm is risk with no coverage in return.
--
-- Nothing in `src/` reads `profiles` with `select *` — every call site uses an
-- explicit list (`OWN_PROFILE_COLUMNS`, `PUBLIC_PROFILE_COLUMNS`, or named
-- columns), verified on `main` rather than assumed. So an ungranted column is
-- invisible rather than breaking, which is exactly the failure `025` §DEFECT 2d
-- describes and this migration had to check for before it could be additive:
--
--   grep -rn "from('profiles')" -A3 src/lib/data/ src/lib/actions/ | grep "select("

alter table public.profiles add column terms_version text;

comment on column public.profiles.terms_version is
  'Which version of the T&C this rider accepted (030). Server-owned: no grant to authenticated on any of select, insert or update, so the client cannot read, set or move it — the same posture as terms_accepted_at after 025. NULL means the consent predates this column and its version is genuinely unknown; it is never backfilled.';

-- ---------------------------------------------------------------------------
-- §2. One place owns the current version, and `accept_terms()` stamps it
-- ---------------------------------------------------------------------------
--
-- In `private` for the usual reason (005): PostgREST does not publish it, so the
-- version string is not a client-readable fact and changing it is not an API
-- change. `stable` rather than `immutable` — the value is a constant today and
-- becomes a lookup the moment the terms get an archive, and `immutable` would
-- let the planner fold a stale value into a cached plan.

create or replace function private.current_terms_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '0-placeholder'::text;
$$;

comment on function private.current_terms_version() is
  'The T&C version string stamped onto new consents (030). `0-placeholder` because /legal/terms is explicitly placeholder copy that disclaims being an agreement — the product owner replaces this in a one-line migration when the binding text lands. The only place the value lives.';

revoke all on function private.current_terms_version() from public, anon, authenticated;

-- `021`'s writer, with the version added and nothing else changed.
--
-- Every existing property is preserved and each is load-bearing: no arguments,
-- so a back-dated or foreign consent is unrepresentable rather than merely
-- refused; `where terms_accepted_at is null`, so a second call is idempotent and
-- returns the first call's stamp rather than moving it — which now also pins the
-- *version*, so a rider who consented under v1 is not silently re-recorded as
-- having consented under v2; and `security definer`, because `025` took the
-- client's UPDATE grant on the stamp away and now on the version too.
--
-- `012`'s BEFORE UPDATE trigger short-circuits inside here — within a
-- `security definer` function `current_user` is the owner, so its
-- `current_user <> 'authenticated'` guard returns early. That is why this
-- function sets `terms_accepted_at` to `now()` itself rather than leaning on the
-- trigger to server-stamp it, and the same reasoning is why the version is set
-- here too. (`CLAUDE.md`: "Each restates the invariants its triggers carry, and
-- must.")

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

  update public.profiles p
     set terms_accepted_at = pg_catalog.now(),
         terms_version     = private.current_terms_version()
   where p.id = v_uid
     and p.terms_accepted_at is null
  returning p.terms_accepted_at into v_stamp;

  if v_stamp is not null then
    return v_stamp;
  end if;

  select p.terms_accepted_at into v_stamp
    from public.profiles p
   where p.id = v_uid;

  return v_stamp;
end;
$$;

comment on function public.accept_terms() is
  'Records the CALLER''s T&C acceptance at server time, once (021 §3, versioned by 030). Idempotent: a second call returns the first call''s stamp rather than moving it, and leaves the recorded terms_version alone with it. Takes no arguments, so a back-dated or foreign consent record is unrepresentable rather than merely refused. security definer because 025 revokes the client''s UPDATE on the column, and 030 never grants one for the version.';

revoke all on function public.accept_terms() from public, anon;
grant execute on function public.accept_terms() to authenticated;

-- ---------------------------------------------------------------------------
-- §3. Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- The column exists and `authenticated` holds nothing on it. Expect f, f, f:
--
--   select has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'select'),
--          has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'insert'),
--          has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'update');
--
-- No backfill happened. Expect 4 and 0 on a 4-profile project:
--
--   select count(*), count(terms_version) from public.profiles;
--
-- As a rider, all three are refused with 42501 rather than silently corrected:
--
--   select terms_version from profiles where id = auth.uid();
--   update profiles set terms_version = 'v99' where id = auth.uid();
--   insert into profiles (id, terms_version) values (auth.uid(), 'v99');
--
-- `accept_terms()` stamps both, and a second call moves neither. As a rider with
-- a NULL stamp:
--
--   select accept_terms();          -- returns now()
--   select accept_terms();          -- returns the SAME timestamp
--   -- then, as the table owner: terms_version = '0-placeholder', unchanged
--
-- The advisor count stays at eight. `current_terms_version` is in `private` with
-- no grant to `authenticated`, so it does not trip
-- `authenticated_security_definer_function_executable`; `accept_terms` already
-- trips it and is already counted.
