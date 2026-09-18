-- 118: the terms name a person, so the version stops saying they do not.
--
-- `030` set `private.current_terms_version()` to `0-placeholder` and said why in
-- its own comment: `/legal/terms` was "explicitly placeholder copy that
-- disclaims being an agreement", so the honest thing to record against a consent
-- was that no binding document existed. PD-459 replaced that page with a twelve
-- section agreement, and the product owner supplied the one thing a session
-- cannot invent — the operator's legal name and postal address, which art. 3:15d
-- BW requires an information society service to publish. Both halves are now
-- true, so the placeholder has nothing left to stand for.
--
-- **This is the one-line migration `030` predicted**, and it is deliberately
-- only that: the string, and the comment that explains it. Nothing about the
-- column, the grants or `accept_terms()` moves.
--
-- ---------------------------------------------------------------------------
-- Sequencing: MIGRATION FIRST, and the two directions are not symmetric
-- ---------------------------------------------------------------------------
-- Neither side of the pipe reads the other at runtime — the page renders
-- `TERMS_VERSION` from `src/lib/legal/terms.ts` and the database stamps this
-- function — so the window between them writes a consent row whose version and
-- whose text disagree. Which way round decides how bad that row is:
--
--   migration first → the row says `1.0` for a rider who saw the older page.
--                     Under-claims: a text that says less than `1.0` does.
--   deploy first    → the row says `0-placeholder` for a rider who saw and
--                     accepted the real agreement. The consent is unreadable
--                     as evidence, which is the failure `030` exists to avoid.
--
-- So this applies to DEV ahead of the merge, and reaches PROD **with the
-- promotion that carries the page**, never before it: PROD serves `main`, whose
-- `/legal/terms` is still the disclaimer, and stamping `1.0` against that text
-- is precisely the fabricated evidence record `030` refused to backfill.
--
-- ---------------------------------------------------------------------------
-- No backfill, again, and for the third time the same reason
-- ---------------------------------------------------------------------------
-- Every rider carrying `0-placeholder` keeps it. They accepted a document that
-- disclaimed being one; that is what happened, and a row saying `1.0` would be
-- a claim nobody made. `030`: "a version invented for a consent that predates
-- the column is a fabricated evidence record." The same sentence covers a
-- version invented for a consent that predates the *text*.
--
-- **Whether those riders should be asked to accept the real terms is a separate
-- decision, and this migration does not make it.** It also cannot be delivered
-- by a page edit: `accept_terms()` is `where terms_accepted_at is null`, so a
-- second call returns the first stamp and leaves the old version, and
-- `my_onboarding_state()` returns no version for a client to compare against.
-- Re-consent is a migration plus a guard change, and `/legal/terms` §11 is
-- written to what exists rather than to that.
--
-- ---------------------------------------------------------------------------
-- Pre-flight, measured against DEV (fpmrimzxadewsaiwpsel) 2026-09-18
-- ---------------------------------------------------------------------------
--   private.current_terms_version() ............. '0-placeholder'
--   profiles ..................................... 30
--   profiles with terms_version = '0-placeholder'  17
--   profiles with terms_version is null .......... 13  (consents predating 030)

create or replace function private.current_terms_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '1.0'::text;
$$;

comment on function private.current_terms_version() is
  'The T&C version string stamped onto new consents (030, set to 1.0 by 118). 1.0 is the first binding text: twelve sections at /legal/terms naming the operator, which is what art. 3:15d BW requires and what 030 was waiting for. Consents already stamped 0-placeholder keep it — they agreed to a page that disclaimed being an agreement, and that is what the record should say. The only place the value lives; changing it is a new migration and an edit to TERMS_VERSION in src/lib/legal/terms.ts, which src/lib/legal/__tests__/terms.test.ts refuses to let happen one at a time.';

-- `create or replace` preserves privileges, so this changes nothing today. It is
-- restated because the absence of an EXECUTE grant is the control that keeps the
-- version out of PostgREST (`030` §2), and a control nobody re-states is a
-- control the next `create or replace` can drop without anyone noticing.
revoke all on function private.current_terms_version() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
--   select private.current_terms_version();          -- 1.0
--
-- Nothing already stamped moved. Expect the pre-flight counts unchanged, and
-- ZERO rows at the new version until a rider consents after this applies:
--
--   select terms_version, count(*) from public.profiles group by 1 order by 1;
--
-- Still unreachable from the client, and still not a PostgREST endpoint:
--
--   select has_function_privilege('authenticated', 'private.current_terms_version()', 'execute');  -- f
--   select has_function_privilege('anon',          'private.current_terms_version()', 'execute');  -- f
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'current_terms_version';                           -- 0
--
-- The advisor count does not move: this function is in `private` with no grant
-- to `authenticated`, so it never tripped
-- `authenticated_security_definer_function_executable` and still does not.
