-- 021: the two profile stamps become own-row-only.
--
-- =========================================================================
-- ** NOT APPLIED. DO NOT APPLY THIS FILE WITHOUT ITS CODE REPAIR. **
--
-- It is listed in SKIP_MIGRATIONS in supabase/tests/run.sh, so the RLS suite
-- models the database that actually runs. Its assertions live in
-- supabase/tests/rls_test_pending_021.sql; run them with `PENDING=021 npm test`.
--
-- This migration removes a grant the running application both READS and WRITES,
-- which violates group 1's own definition — "nothing in this group removes a
-- column, table or grant the application reads". It is the same class of defect
-- as the `avatar_url` drop one migration over, and it belongs with its code
-- change, in a later group, exactly as D5 moved that one.
-- =========================================================================
--
-- ---------------------------------------------------------------------------
-- What it is for
-- ---------------------------------------------------------------------------
-- RLS is row-level, not column-level. The `profiles` SELECT policy admits every
-- non-blocked rider who has a username, and therefore admits *every column* of
-- that row — including `terms_accepted_at` and `onboarding_completed_at`, a
-- rider's consent record and account lifecycle. `PUBLIC_PROFILE_COLUMNS` narrows
-- the projection in application code, which is a convention PostgREST does not
-- enforce: `select=*` on any member list returns the lot.
--
-- Measured on the hosted project 2026-08-05: `authenticated` holds SELECT,
-- INSERT and UPDATE on both columns, and table-wide SELECT, INSERT, UPDATE and
-- DELETE on `public.profiles`.
--
-- D6 rejects a view beside the table, and is right to: `public.profiles` stays
-- published by PostgREST and the grant is what decides.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1 — the statement task 1.8 specifies does not do what it says
-- ---------------------------------------------------------------------------
-- Task 1.8 gives the statement verbatim:
--
--   revoke select, insert, update (terms_accepted_at, onboarding_completed_at)
--     on public.profiles from authenticated;
--
-- Postgres parses a column list as attaching to the *immediately preceding*
-- privilege only. So that statement means: revoke SELECT **table-wide**, revoke
-- INSERT **table-wide**, and revoke UPDATE on those two columns. And the last of
-- those three is a no-op, because — PostgreSQL GRANT docs — "granting the
-- privilege at the table level and then revoking it for one column will not do
-- what one might wish: the table-level grant is unaffected by a column-level
-- operation." `authenticated` holds table-level UPDATE here, so the column-level
-- revoke is discarded with a warning.
--
-- Reproduced on Postgres 16 rather than recalled, with the grants Supabase
-- actually gives `authenticated`:
--
--   create table t (id int, stamp timestamptz, other text);
--   grant select, insert, update on t to r;
--   revoke select, insert, update (stamp) on t from r;
--
--     has_table_privilege (r, t, select)       -> f   -- the WHOLE table
--     has_table_privilege (r, t, insert)       -> f   -- the WHOLE table
--     has_column_privilege(r, t, other, select)-> f   -- an unrelated column
--     has_column_privilege(r, t, stamp, update)-> t   -- the target: UNCHANGED
--
-- So the drafted line would take SELECT away from every column of `profiles` —
-- usernames, avatars, bios — leaving the app unable to render a single byline,
-- and would leave the exposure it was written to close exactly where it was. It
-- would look applied and be worse than nothing.
--
-- The only shape that restricts a column is to revoke the table-level privilege
-- and re-grant an explicit column allowlist, which is what §1 below does. Note
-- the standing cost of that shape, because it is permanent: **every column added
-- to `profiles` from now on is invisible to `authenticated` until it is added to
-- these grants.** A migration that adds a column and forgets is a column that
-- silently does not exist for the app.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2 — four live paths break the moment this applies, three of them hard
-- ---------------------------------------------------------------------------
-- Verified against the code on `main`, not inferred:
--
--   a) THE ROUTE GUARD. src/proxy.ts:79-84 reads
--      `.select('username, location, onboarding_completed_at')` on **every
--      authenticated request**. Without SELECT on that column PostgREST answers
--      403, `error` is set, and proxy.ts:90-101 — a branch written to fail
--      closed on exactly this kind of mismatch — redirects to
--      `/auth/login?error=profile_unavailable`. Every signed-in rider is
--      bounced out of every screen. This is a total outage, on the one Supabase
--      project every environment points at, with Vercel auto-deploying `main`.
--
--   b) ONBOARDING CAN NEVER COMPLETE. src/lib/actions/onboarding.ts:71-78
--      (`setLocation`) writes `{ location, onboarding_completed_at }` in one
--      UPDATE. Without UPDATE on that column the whole statement is refused,
--      the action returns "Could not save that. Try again.", and — because
--      proxy.ts gates every route on the stamp — the rider is stuck in the
--      wizard permanently. Decision #5 turns from "not skippable" into "not
--      completable".
--
--   c) CONSENT IS NEVER RECORDED. src/lib/actions/auth.ts:70-83 (`signUp`)
--      writes `{ terms_accepted_at }` and *checks the result*, returning "Your
--      account was created but we could not record your consent." when the
--      update returns no row. Every new signup ends on that error. Worth being
--      precise about the mechanism, because the obvious repair does not work:
--      012's trigger replaces the *value* the client sends with server time, it
--      does not *supply* one when the client sends nothing. Column privileges
--      are checked against the columns named in SET, before any BEFORE trigger
--      runs. So "let 012's trigger own the stamp" is not a one-line fix — with
--      the UPDATE grant gone there is no statement left that names the column,
--      and consent stops being recorded at all rather than being recorded
--      server-side.
--
--   d) THE PROFILE SCREEN. src/lib/data/profile.ts:12 (`getMyProfile`) reads
--      `.select('*')` on the caller's own row. `select *` requires SELECT on
--      every column, so it becomes 42501, `unwrap` throws by design, and the
--      profile screen lands on the error boundary. The same shape appears ~20
--      times in supabase/tests/rls_test.sql, where 003's and 012's assertions
--      read the two stamps directly as the caller — so this migration also
--      turns the existing RLS suite red, which is the cheapest available proof
--      that (d) is real.
--
-- (c) was found by the reviewer. (a), (b) and (d) were found while verifying it.
-- (a) is the worst of the four and is not about writes at all.
--
-- ---------------------------------------------------------------------------
-- The verdict this file exists to record
-- ---------------------------------------------------------------------------
-- The requirement is right and the phase is wrong. Read the spec closely and its
-- normative content is about **reading**: "Consent and lifecycle timestamps
-- SHALL NOT be readable by other riders", and its testable scenario is that
-- `authenticated` must not retain column-level **SELECT**. D6 adds "INSERT and
-- UPDATE go the same way, since 012's trigger already overrides whatever the
-- client sends" — and that sentence is the whole error. The trigger overrides a
-- value; it does not originate one.
--
-- So there are two honest ways forward, and choosing between them is a decision
-- for the change's owner rather than for this file:
--
--   A) Ship it whole, in the group that owns the code. Repoint proxy.ts and
--      getMyProfile at §2's accessor, and give consent an own-row RPC
--      (`accept_terms()`, `complete_onboarding(location)`) so the stamps are
--      written by the database rather than granted to the client. That is the
--      strongest end state and it is four application changes, which is
--      precisely why it is not a Phase 1 migration.
--
--   B) Narrow the revoke to SELECT, now. SELECT is what the requirement is
--      about and what leaks; the write grants are already neutered by 012's
--      trigger (immutable, server-timed) and 003's completion guard. But (a)
--      and (d) still bite — proxy.ts and getMyProfile *read* the columns — so
--      even the narrow version needs its two readers repointed first. There is
--      no version of this that is additive.
--
-- Either way it leaves Phase 1. This file is written in shape (A) so that
-- whichever group takes it needs no rewriting, only an apply.

-- ---------------------------------------------------------------------------
-- §1. An explicit column allowlist, because a column-level revoke is a no-op
-- ---------------------------------------------------------------------------
--
-- DELETE is untouched: `profiles` rows are deleted by the cascade from
-- auth.users, and account deletion is a Phase 2 dependency with its own design.
--
-- `avatar_url` is granted SELECT but **not** UPDATE, which is one deliberate
-- extra over task 1.8 and is flagged rather than slipped in. The spec requires
-- that no column a rider can write is ever used as an image source in another
-- rider's client; `resolveAvatarUrls` uses this column as a fallback and it is
-- in PUBLIC_PROFILE_COLUMNS, so today a rider can point every member list at a
-- host they control and harvest IP addresses — including from riders who blocked
-- them. Nothing has ever written the column, so removing the write costs
-- nothing. Group 3 drops it entirely; until then this is the cheap half.

revoke select, insert, update on public.profiles from authenticated;

grant select (
  id, username, avatar_url, bio, bike_model, created_at, location,
  avatar_path, cover_image_path
) on public.profiles to authenticated;

-- `id` is insertable because "Users can insert their own profile" checks
-- `auth.uid() = id`, and a policy cannot check a column the role may not write.
grant insert (
  id, username, bio, bike_model, location, avatar_path, cover_image_path
) on public.profiles to authenticated;

grant update (
  username, bio, bike_model, location, avatar_path, cover_image_path
) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- §2. The accessor that supplies the row-awareness a grant cannot express
-- ---------------------------------------------------------------------------
--
-- D6's point exactly: a REVOKE is not row-aware, so the two legitimate own-row
-- readers — the route guard and the onboarding resume step — get a function
-- instead. It takes no arguments, reads two columns of `auth.uid()`'s own row,
-- and can return at most one row. That is narrower than `moderate_comment`,
-- which the security advisors already accept and which 011 §1b argues for at
-- length; expect it to appear as a new `security definer` advisory finding, and
-- expect that to be the right outcome rather than a regression.
--
-- Returns zero rows for a caller with no session, since `auth.uid()` is NULL and
-- no profile row has a NULL id.

create or replace function public.my_profile_stamps()
returns table (terms_accepted_at timestamptz, onboarding_completed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.terms_accepted_at, p.onboarding_completed_at
    from public.profiles p
   where p.id = (select auth.uid());
$$;

comment on function public.my_profile_stamps() is
  'The caller''s own consent and onboarding stamps, and nobody else''s (021). security definer because 021 revokes column SELECT on both; takes no arguments, so there is no row to choose but your own.';

revoke all on function public.my_profile_stamps() from public, anon;
grant execute on function public.my_profile_stamps() to authenticated;

-- ---------------------------------------------------------------------------
-- §Verification — run against the project after applying, do not assume
-- ---------------------------------------------------------------------------
--
-- Scope every one of these to the grantee. `postgres` and `service_role` hold
-- everything by Supabase default, so a table-wide count reads wrong against a
-- correct database — the mistake 015's footer made and documented.
--
-- Expected: f, f — the requirement's own testable scenario.
--   select has_column_privilege('authenticated','public.profiles','terms_accepted_at','select'),
--          has_column_privilege('authenticated','public.profiles','onboarding_completed_at','select');
--
-- Expected: f, f — the write half.
--   select has_column_privilege('authenticated','public.profiles','terms_accepted_at','update'),
--          has_column_privilege('authenticated','public.profiles','onboarding_completed_at','update');
--
-- Expected: t, t, t — guards against over-tightening. If these are false the app
-- cannot render a byline.
--   select has_column_privilege('authenticated','public.profiles','username','select'),
--          has_column_privilege('authenticated','public.profiles','avatar_path','select'),
--          has_column_privilege('authenticated','public.profiles','username','update');
--
-- Expected: f — nothing is readable table-wide any more.
--   select has_table_privilege('authenticated','public.profiles','select');
--
-- Expected: f — anon gains nothing here, as everywhere.
--   select has_function_privilege('anon','public.my_profile_stamps()','execute');
