-- 052: The render ceiling cannot be an aggregate over its own table. PD-104.
--
-- `051` shipped the ceiling as a subquery inside the ledger's own INSERT policy:
--
--   and (select count(*) from public.ride_map_render_attempts a
--         where a.ride_id = ride_map_render_attempts.ride_id
--           and a.attempted_at > now() - interval '24 hours') < 10
--
-- ** Postgres refuses that outright. ** Measured on Postgres 16 and 17, by the
-- RLS suite rather than by reasoning:
--
--   ERROR:  infinite recursion detected in policy for relation
--           "ride_map_render_attempts"
--
-- The detection is STRUCTURAL, not semantic. Expanding the INSERT policy for
-- relation R requires expanding a query against R, which requires R's policies
-- again; that the inner expansion would reach the SELECT policy — which does not
-- reference the ledger and would terminate — is not something the planner
-- inspects. So the design is not merely fragile here, it is unimplementable in
-- the form `design.md` §D10 and tasks.md §1.4 describe, and no ledger insert
-- could EVER have succeeded against `051` as applied.
--
-- `051` is applied to DEV and must not be edited (the same rule and the same
-- remedy `010` used for the hole `009` left: drop and recreate here). This file
-- is the smallest change that makes the ceiling work, and it is additive —
-- nothing has ever inserted a ledger row, so there is no data to migrate.
--
-- ---------------------------------------------------------------------------
-- The fix, and the one property it deliberately CHANGES
-- ---------------------------------------------------------------------------
-- The count moves into a `security definer` helper in `private`, which is the
-- standing remedy for the recursion trap in this schema (`005` created the
-- schema for it; `034`'s `private.is_ride_crew` is the worked example).
--
-- ** This is NOT a `security definer` function deciding visibility. ** That is
-- forbidden here and stays forbidden — `specs/ride-map-tiles` requires the
-- Storage read to be a bare EXISTS under the caller's own RLS, and nothing in
-- this file touches a SELECT policy. What moves into the definer is a SPEND
-- LIMIT on an INSERT, which is a different question from who may see what.
--
-- ** The property that changes: the count is no longer RLS-scoped. ** §D10
-- recorded a hazard in the original shape — "the count is only as wide as the
-- ledger's SELECT policy... Narrowing SELECT later, for any unrelated reason,
-- silently under-counts and WIDENS the ceiling with nothing failing." That
-- coupling is now GONE rather than merely documented: the helper counts every
-- attempt against the ride, so the ceiling means the same thing whatever the
-- SELECT policy is later narrowed to. The change is in the safe direction, and
-- it removes a hazard the design could only warn about.
--
-- ** What does NOT change: the overshoot under concurrency. ** Under READ
-- COMMITTED two concurrent inserts still each evaluate the count before either
-- commits, both see ceiling - 1, and the window still ends one row over. The
-- failure is still PERMISSIVE, still bounded by the number of genuinely
-- concurrent callers, and still accepted at that size. The RLS suite runs
-- serially and still cannot demonstrate it either way.
--
-- ** Why the helper takes a ride id, and why that is contained. ** Unlike
-- `is_club_member` and `is_ride_crew`, which report only on the caller, this one
-- is asked about a named ride, so it COULD answer for a ride the caller does not
-- organise. Two things bound that, and the second is the real one:
--   * it returns a count of render attempts and nothing else — no address, no
--     coordinate, no identity;
--   * it lives in `private`, which PostgREST does not route to at all, so no
--     client can call it. `031` is the reminder that this barrier is real: it
--     is the same one that stopped the deletion function reaching a `private`
--     worker, and it applies to every caller outside the database.
-- It is `stable` and reads one indexed range, so it costs the same as the
-- subquery it replaces.

create or replace function private.ride_map_renders_in_window(ride uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.ride_map_render_attempts a
   where a.ride_id = ride
     and a.attempted_at > now() - interval '24 hours';
$$;

comment on function private.ride_map_renders_in_window(uuid) is
  'How many render attempts this ride has recorded inside the rolling 24-hour window (052). `security definer` because a policy on ride_map_render_attempts cannot aggregate over ride_map_render_attempts — Postgres raises "infinite recursion detected in policy" structurally, whatever the inner query would have done. Lives in `private` so PostgREST cannot publish it. It bounds SPEND, never visibility.';

-- RLS expressions are evaluated as the querying role, so that role needs
-- execute. Everyone else is cut off — 005's rule.
revoke all on function private.ride_map_renders_in_window(uuid) from public, anon;
grant execute on function private.ride_map_renders_in_window(uuid) to authenticated;

-- The policy belongs to 051, which is applied and must not be edited. Dropped
-- and recreated here. Everything about it is unchanged except the ceiling
-- expression: the entitlement arm is still an EXISTS against `rides` evaluated
-- under the CALLER's own row security, so an organizer who cannot see their own
-- ride cannot record an attempt against it either.
drop policy if exists "Organizers record render attempts on their own rides, up to the ceiling"
  on public.ride_map_render_attempts;

create policy "Organizers record render attempts on their own rides, up to the ceiling"
  on public.ride_map_render_attempts for insert to authenticated
  with check (
    exists (
      select 1 from public.rides r
      where r.id = ride_map_render_attempts.ride_id
        and r.organizer_id = auth.uid()
    )
    and private.ride_map_renders_in_window(ride_id) < 10
  );

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying
-- ---------------------------------------------------------------------------
--   -- 2 — still exactly SELECT and INSERT policies, no UPDATE or DELETE
--   select cmd from pg_policies
--    where schemaname = 'public' and tablename = 'ride_map_render_attempts';
--
--   -- true — the helper is reachable by the role that evaluates the policy
--   select has_function_privilege('authenticated',
--     'private.ride_map_renders_in_window(uuid)', 'execute');
--
--   -- false, false — and by nobody else. anon is decision #1; service_role
--   -- holds no USAGE on `private` at all, which is 031's finding restated.
--   select has_function_privilege('anon',
--            'private.ride_map_renders_in_window(uuid)', 'execute'),
--          has_schema_privilege('service_role', 'private', 'usage');
--
--   -- true — it really is definer, and 022's lesson is that this exact clause
--   -- is the one that silently goes missing between the repo and the database
--   select prosecdef, proconfig from pg_proc
--    where oid = 'private.ride_map_renders_in_window(uuid)'::regprocedure;
--
--   -- The ceiling actually fires now, which 051 could not:
--   --   insert 10 rows for a ride as the owner, then as its organizer attempt
--   --   an eleventh and expect 42501 rather than 42P17.
--
--   -- And the advisors stay at the documented nine: a function in `private` is
--   -- not on PostgREST's search path, so it raises no
--   -- authenticated_security_definer_function_executable WARN. That is the same
--   -- reason 034's is_ride_crew added none.
