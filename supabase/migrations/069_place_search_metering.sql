-- 069: The place-search spend ledger, and the place_id columns widened. PD-273.
--
-- Additive only. Nothing in this file drops or narrows anything, which is what
-- lets it apply BEFORE the code that uses it — `design.md` §D7's sequencing, and
-- the reason the destructive half is `070` in its own PR.
--
-- ---------------------------------------------------------------------------
-- Part 1 — why the ceiling cannot live in the Edge Function
-- ---------------------------------------------------------------------------
-- `search-places` is stateless and multi-instance, so it cannot count for
-- itself; two concurrent invocations share no memory. `052` reached the same
-- conclusion for the same reason and its shape is copied here wholesale, with
-- the subject changed from a ride to a rider.
--
-- ** And copied INCLUDING the recursion fix, which is the part that looks
-- optional and is not. ** `051` shipped its ceiling as a `count(*)` subquery
-- inside the ledger's own INSERT policy and Postgres refused it outright:
--
--   ERROR:  infinite recursion detected in policy for relation ...
--
-- The detection is STRUCTURAL. Expanding the INSERT policy for relation R
-- requires expanding a query against R, which requires R's policies again; that
-- the inner expansion would terminate is not something the planner inspects. So
-- the counting helpers below live in `private` and are `security definer`, and
-- writing them any other way produces a ledger no insert can ever succeed
-- against. `052`'s header is the full account.
--
-- ** These bound SPEND, never visibility. ** A `security definer` function
-- deciding who may see what is forbidden in this schema and stays forbidden.
-- Nothing in this file touches a SELECT policy on any other table.
--
-- ---------------------------------------------------------------------------
-- Part 2 — why the place_id columns move from 100 to 512
-- ---------------------------------------------------------------------------
-- `066` and `067` bounded `clubs.location_place_id` and `rides.start_place_id`
-- at 100 characters, sized for an Overture GERS uuid. The replacement provider's
-- ids are longer and VARIABLE, measured against live responses on 2026-08-19:
--
--   | Place                                          | id  | stored | Fits 100? |
--   |------------------------------------------------|-----|--------|-----------|
--   | `Shell Energy & Chemicals Park ... Wesseling`   | 182 |    191 | no        |
--   | `Shell Deutschland Oil GmbH, Werk Sud, Hafen`   | 162 |    171 | no        |
--   | `Amsterdam-Purmerend`                           | 112 |    121 | no        |
--   | `Willem Claijstraat`                            | 110 |    119 | no        |
--   | `Shell Pernis`                                  |  98 |    107 | no        |
--   | `Berkhout`                                      |  90 |     99 | YES       |
--   | `Jumbo`                                         |  84 |     93 | YES       |
--
-- ** The break is INTERMITTENT, and that is why this cannot wait. ** A rider
-- picking a short-named village succeeds; the same rider picking a street gets
-- a raw `23514` on a value they can neither see nor shorten. Nothing
-- distinguishes the two attempts from their side, so it cannot be found by
-- trying it once and would survive a smoke test that happened to pick a village.
--
-- 512 is a bound rather than a fitted maximum. Every live id carries a 74-hex
-- prefix, so length is `74 + 2 x name bytes` and the longest observed — a real
-- result the picker would offer — stores at 191. That leaves ~2.7x headroom.
-- **Do not trim this toward 191**: the input is a place name, and the formula is
-- only as good as the longest one anyone has seen.
--
-- ** This migration must be applied BEFORE the code that writes a new id
-- deploys, on each project. ** That inverts `docs/ENVIRONMENTS.md` §Migrations'
-- numbered order on purpose: merging to `main` IS the PROD code deploy, so
-- applying after it leaves a window in which every long-named pick fails.
-- `design.md`'s Migration Plan step 4 carries the reasoning.

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table public.place_search_attempts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  -- Written by the BEFORE INSERT trigger below, never by the client. `default
  -- now()` is the VALUE and not the guarantee — a default applies only when the
  -- column is OMITTED, and PostgREST lets a client name it (034 §4b, 044, 051).
  attempted_at timestamptz default now() not null
);

alter table public.place_search_attempts enable row level security;

comment on table public.place_search_attempts is
  'Append-only spend ledger bounding third-party place lookups per rider (069, PD-273). `authenticated` holds INSERT and SELECT only — no UPDATE grant or policy, no DELETE grant or policy — because the rider is the party the limit is aimed at. Two per-rider ceilings (hourly and daily) and one application-wide ceiling live in the INSERT policy via `private` helpers; they OVERSHOOT under concurrency, permissively, and the RLS suite runs serially and cannot demonstrate that either way. ** It records THAT a rider searched and never WHAT they searched for ** — a place-search term is frequently a home address, and there is deliberately no column that could hold one. Rows older than 7 days are swept by the insert that follows.';

comment on column public.place_search_attempts.attempted_at is
  'Server time, written by the BEFORE INSERT trigger (069). A client that can backdate a row out of the rolling window has no ceiling at all — 034''s ruling for a conversation''s created_at, applied here as 051 applied it.';

-- Both ceilings count one rider over a time window, so one index serves both.
create index place_search_attempts_user_id_attempted_at_idx
  on public.place_search_attempts (user_id, attempted_at desc);

-- The application-wide ceiling and the retention sweep both scan by time alone.
create index place_search_attempts_attempted_at_idx
  on public.place_search_attempts (attempted_at desc);

-- ---------------------------------------------------------------------------
-- The counters — `private`, `security definer`, per Part 1
-- ---------------------------------------------------------------------------

-- ONE helper with the window as a parameter, rather than two helpers. The two
-- per-rider ceilings differ only in their window, and two functions is two
-- places for the definition of "an attempt" to drift apart.
create or replace function private.place_searches_in_window(rider uuid, window_length interval)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.place_search_attempts a
   where a.user_id = rider
     and a.attempted_at > now() - window_length;
$$;

comment on function private.place_searches_in_window(uuid, interval) is
  'How many place lookups this rider has recorded inside the given rolling window (069). `security definer` because a policy on place_search_attempts cannot aggregate over place_search_attempts — Postgres raises "infinite recursion detected in policy" structurally (052). Lives in `private` so PostgREST cannot publish it, which also stops it becoming an oracle for another rider''s activity. It bounds SPEND, never visibility.';

create or replace function private.place_searches_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.place_search_attempts a
   where a.attempted_at > now() - interval '24 hours';
$$;

comment on function private.place_searches_today() is
  'How many place lookups the WHOLE APPLICATION has recorded in the last 24 hours (069). The vendor quota is shared across every rider and with the map tiles, so a per-rider ceiling alone cannot protect it. Takes no argument and reveals no rider. `security definer` and in `private` for the same reasons as place_searches_in_window.';

-- RLS expressions are evaluated as the querying role, so that role needs
-- execute. Everyone else is cut off — 005's rule.
revoke all on function private.place_searches_in_window(uuid, interval) from public, anon;
revoke all on function private.place_searches_today() from public, anon;
grant execute on function private.place_searches_in_window(uuid, interval) to authenticated;
grant execute on function private.place_searches_today() to authenticated;

-- ---------------------------------------------------------------------------
-- Server-stamped time, and the participation gate
-- ---------------------------------------------------------------------------

create or replace function public.set_place_search_attempted_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.attempted_at := now();
  return new;
end;
$$;

comment on function public.set_place_search_attempted_at() is
  'Stamps place_search_attempts.attempted_at with server time on every insert, discarding whatever the client supplied (069). Both rolling ceilings are meaningless if a caller can backdate rows out of the window.';

revoke all on function public.set_place_search_attempted_at() from public, anon, authenticated;

create trigger set_place_search_attempted_at
  before insert on public.place_search_attempts
  for each row
  execute function public.set_place_search_attempted_at();

-- The ELEVENTH participation-gate trigger. 023 put this on eight tables, 034
-- made it nine, 051 ten. A rider who has not accepted the terms must not be able
-- to spend our vendor budget — and this closes, for this surface only, the hole
-- CLAUDE.md documents: an account created by calling GoTrue's /auth/v1/signup
-- directly can still write a username and a bio, because `profiles` UPDATE
-- carries no gate. It cannot spend a credit.
--
-- The WHEN clause is not decoration: 023 §2 measured that inside a
-- `security definer` function `current_user` is the OWNER, so a guard in the
-- body would be true on every call and the gate would never fire. It is
-- evaluated in the caller's context, before the function is entered.
drop trigger if exists enforce_participation_gate on public.place_search_attempts;
create trigger enforce_participation_gate
  before insert on public.place_search_attempts
  for each row when (current_user = 'authenticated')
  execute function public.enforce_participation_gate();

-- 051's comment says "ten BEFORE INSERT triggers" and there are eleven now. A
-- database comment is the `data` agent's first read via `list_tables`, so it is
-- the one piece of documentation no edit to CLAUDE.md can reach — 028 and 033
-- exist for exactly this.
comment on function public.enforce_participation_gate() is
  'Decision #5 and T&C consent, enforced where they are actually broken rather than by a redirect (023). One function, eleven BEFORE INSERT triggers — the ninth is ride_messages (034), the tenth ride_map_render_attempts (051), the eleventh place_search_attempts (069); the five uncovered INSERT-policy tables are named in 023''s header with their reasons.';

-- ---------------------------------------------------------------------------
-- Retention — 7 days, swept by the insert that follows (§D11)
-- ---------------------------------------------------------------------------
-- Comfortably past the 24-hour counting window, so no expiry can move a ceiling
-- decision.
--
-- ** The retention is INSERT-DRIVEN, so it is a ceiling on an active rider's
-- rows rather than a promise that no row outlives 7 days. ** A rider who
-- searches once and never searches again keeps those rows indefinitely, because
-- the only thing that deletes them is their own next insert. Stated rather than
-- hidden: `design.md` §D11 says "rows expire after 7 days", and that sentence is
-- true only of riders who come back.
--
-- Accepted at this size for now. The rows hold no term and no coordinate — a
-- user id and a timestamp — so what leaks with age is "this rider looked
-- something up on this day", and account deletion still takes them all (the FK
-- is ON DELETE CASCADE). Closing it properly wants a scheduled job, which is an
-- Edge Function on a cron and therefore an owner deploy; it is not worth one on
-- its own. **If a term or a coordinate is ever added to this table, this
-- paragraph stops being an acceptable trade and the sweep must stop depending on
-- the subject returning.** The sweep deletes THE INSERTING RIDER'S OWN expired rows only,
-- bounded by the (user_id, attempted_at) index, so its cost never grows with the
-- table and one rider's sweep cannot fail another rider's search.
--
-- AFTER INSERT rather than BEFORE, and the ordering matters: a BEFORE-insert
-- sweep would delete rows the ceiling is about to count, handing a rider back
-- allowance in the same statement that was meant to spend it.
--
-- `security definer` because the rider holds no DELETE grant on this table and
-- must not — the whole point is that they cannot erase their own spend. The
-- function is narrow enough for that to be safe: it deletes rows for exactly one
-- user id, taken from NEW rather than from any argument, and only rows already
-- outside the retention window.
create or replace function public.sweep_place_search_attempts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.place_search_attempts a
   where a.user_id = new.user_id
     and a.attempted_at < now() - interval '7 days';
  return null;
exception
  -- A failed sweep must never fail the rider's search. Retention is
  -- housekeeping; refusing a lookup because housekeeping broke would be the
  -- feature failing for a reason that has nothing to do with the rider.
  --
  -- ** `others` does NOT catch query_canceled (57014), and that is the ONE
  -- realistic failure. ** PL/pgSQL excludes it from OTHERS by design, and
  -- `authenticated` runs under a statement_timeout — so a slow DELETE under lock
  -- contention is precisely the case that escapes this block, aborts the insert,
  -- and fails the rider's search. Caught by name for that reason. `assert_failure`
  -- is the other OTHERS exclusion and cannot arise here: nothing asserts.
  when query_canceled then
    return null;
  when others then
    return null;
end;
$$;

comment on function public.sweep_place_search_attempts() is
  'Deletes the inserting rider''s own place-search ledger rows older than 7 days (069). AFTER INSERT, so it cannot hand back allowance the ceiling was about to count. `security definer` because riders deliberately hold no DELETE grant here; it is bounded to one user id taken from NEW and to rows already outside the window. Swallows every error — a failed sweep must not fail a rider''s search.';

revoke all on function public.sweep_place_search_attempts() from public, anon, authenticated;

create trigger sweep_place_search_attempts
  after insert on public.place_search_attempts
  for each row
  execute function public.sweep_place_search_attempts();

-- ---------------------------------------------------------------------------
-- Grants and policies
-- ---------------------------------------------------------------------------
-- INSERT and SELECT, and nothing else. Both halves of the refusal matter and are
-- asserted separately in `supabase/tests/rls_test.sql`'s `069` section: RLS needs
-- a table grant AND a permitting policy, so the missing grant is the outer gate
-- and the missing policy the inner one. Absence is the enforcement here, which is
-- exactly the kind of thing a well-meaning `grant all` puts back.
--
-- Table-level INSERT rather than a per-column grant excluding `attempted_at`,
-- which would also work — `051`'s reasoning, and `design.md` §D3 is reconciled to
-- it: the requirement is that a caller NAMING `attempted_at` has the value
-- replaced by server time, and a column grant refuses the statement outright
-- instead. The trigger is the mandated mechanism, so the grant is left wide
-- enough for it to be the thing observed, and the suite asserts the replacement.
revoke all on public.place_search_attempts from anon, authenticated;
grant select, insert on public.place_search_attempts to authenticated;

-- SELECT: own rows only. A rider's search ledger says when they were looking up
-- places and is nobody else's business — and a wider policy would make this an
-- activity oracle even though it holds no term.
create policy "Riders read their own place search attempts"
  on public.place_search_attempts for select to authenticated
  using (user_id = auth.uid());

-- INSERT: four conjuncts, and each one is load-bearing.
--
--   1. The subject is forced to the caller. A rider cannot spend another
--      rider's allowance, and the Edge Function cannot be talked into it by a
--      body parameter — there is no body parameter.
--   2. The burst arm. 60 credits spent in a minute is the pattern a script
--      makes, not a rider typing.
--   3. The daily arm. About ten completed fields, well past honest use.
--   4. The application-wide arm, which is the one that protects the map: the
--      vendor quota is shared, `resolve-ride-location` fails OPEN (no tile, no
--      message, nobody told) and search fails LOUDLY, so an unrationed typeahead
--      degrades the thing with no error path at all.
--
-- ** Unlike 051's, this ceiling does NOT depend on the SELECT policy. ** The
-- helpers are `security definer` and count every row, so narrowing SELECT later
-- cannot silently under-count and widen the ceiling. 052 removed that coupling
-- for the render ledger; this table never has it.
--
-- The numbers live in `supabase/functions/search-places/shape.ts` beside the
-- arithmetic that chose them. They must move together.
create policy "Riders record their own place searches, up to the ceilings"
  on public.place_search_attempts for insert to authenticated
  with check (
    user_id = auth.uid()
    and private.place_searches_in_window(auth.uid(), interval '1 hour') < 20
    and private.place_searches_in_window(auth.uid(), interval '24 hours') < 60
    and private.place_searches_today() < 2000
  );

-- ---------------------------------------------------------------------------
-- The place_id columns — Part 2
-- ---------------------------------------------------------------------------
-- `066` and `067` are applied and must not be edited; dropped and recreated
-- here, which is the same rule and the same remedy `010` used for `009` and
-- `052` used for `051`. Widening only: every value that satisfied the old
-- constraint satisfies the new one, so no existing row can be invalidated and
-- there is nothing to migrate. DEV holds one Overture id; PROD holds none.
alter table public.clubs drop constraint if exists clubs_location_place_id_length;
alter table public.clubs add constraint clubs_location_place_id_length
  check (location_place_id is null or char_length(location_place_id) <= 512);

alter table public.rides drop constraint if exists rides_start_place_id_length;
alter table public.rides add constraint rides_start_place_id_length
  check (start_place_id is null or char_length(start_place_id) <= 512);

comment on column public.clubs.location_place_id is
  'Opaque provider id for the picked location — provenance, NEVER a join key (066, widened 069). Namespaced by provider (`geoapify:...`) so a row''s source is readable from the value itself and a later provider change is a new prefix rather than archaeology. Bounded at 512: the provider''s ids are variable-length and the live ones follow 74 + 2 x name bytes, so 512 is a bound rather than a fitted maximum.';

comment on column public.rides.start_place_id is
  'Opaque provider id for the picked start — provenance, NEVER a join key (067, widened 069). See clubs.location_place_id for the namespacing and the bound. A row carrying this and no geocode_confidence is a rider''s pick; one carrying geocode_confidence and no place id is a geocoder''s guess.';

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying
-- ---------------------------------------------------------------------------
--   -- exactly SELECT and INSERT policies, no UPDATE or DELETE
--   select cmd from pg_policies
--    where schemaname = 'public' and tablename = 'place_search_attempts';
--
--   -- true, true — reachable by the role that evaluates the policy
--   select has_function_privilege('authenticated',
--            'private.place_searches_in_window(uuid, interval)', 'execute'),
--          has_function_privilege('authenticated',
--            'private.place_searches_today()', 'execute');
--
--   -- false, false — and by nobody else. anon is decision #1; service_role is
--   -- stopped by the EXECUTE revoke above, NOT by a missing USAGE on `private`.
--   --
--   -- ** service_role DOES hold USAGE on `private`, on both projects. ** Measured
--   -- 2026-08-19: private's ACL is {postgres=UC/postgres,service_role=U/postgres}.
--   -- 031's finding is about PostgREST refusing to ROUTE to a non-public schema,
--   -- which is a different barrier and still holds. Writing this check against
--   -- has_schema_privilege reads a correct database as drift — which is exactly
--   -- the trap CLAUDE.md's own restatement of 031 falls into today.
--   select has_function_privilege('anon',
--            'private.place_searches_today()', 'execute'),
--          has_function_privilege('service_role',
--            'private.place_searches_today()', 'execute');
--
--   -- true — they really are definer, and 022's lesson is that this exact
--   -- clause is the one that silently goes missing between repo and database
--   select proname, prosecdef, proconfig from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'private' and p.proname like 'place_searches%';
--
--   -- 11 — the participation gate reached its eleventh table
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
--   -- both 512 — and re-check on PROD separately, since a CHECK is exactly the
--   -- kind of object that gets applied to one project and forgotten on the other
--   select conrelid::regclass, conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conname in ('clubs_location_place_id_length',
--                      'rides_start_place_id_length');
--
--   -- The ceilings actually fire: insert 20 rows as the owner for one rider,
--   -- then as that rider attempt a 21st and expect 42501.
--
--   -- And the advisors stay at the documented ten: a function in `private` is
--   -- not on PostgREST's search path, so it raises no
--   -- authenticated_security_definer_function_executable WARN — the same reason
--   -- 034's is_ride_crew and 052's helper added none.
