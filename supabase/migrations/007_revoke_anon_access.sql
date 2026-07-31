-- Strip anon's table privileges outright.
--
-- This is layer 1 of 002_restrict_to_authenticated.sql, repeated here because
-- 004–006 landed on the database before 002 did, and this half needed to go out
-- on its own the moment the gap was found: anon could read every profile row
-- through the anon key that ships in the client bundle.
--
-- RLS needs both a table grant and a permitting policy, so removing the grant
-- closes anonymous access regardless of what any policy says. Keeping it as a
-- separate step means the guarantee does not depend on getting every policy
-- right — a future permissive policy still cannot leak to anon.
--
-- Safe because no signed-out surface reads tables: the public landing page
-- issues no Supabase queries, /auth/* uses only supabase.auth.*, and proxy.ts
-- gates every other route.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all routines in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on routines from anon;
