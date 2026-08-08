-- 037: The self-hosted NL places index — the location provider for ride
-- meeting points.
--
-- Linear PD-140, unblocking PD-114. The extractor and its rationale are in
-- scripts/places/ — read scripts/places/README.md before this file.
--
-- ---------------------------------------------------------------------------
-- What this table is, and what it is NOT
-- ---------------------------------------------------------------------------
-- **Reference data, loaded out of band.** Every other table in this schema
-- holds rider content and answers "whose row is this". This one has no owner,
-- no author and no `user_id`, because nobody in the app creates a place: the
-- rows come from an Overture Maps extract run against S3 and `\copy`'d in by an
-- operator. That is the whole shape of its security model — `authenticated`
-- reads, nobody writes, `anon` holds nothing.
--
-- **It holds no personal data**, so CLAUDE.md's two schema-time questions for a
-- personal-data table are answered rather than skipped:
--
--   * Retention — not applicable. A row describes a shop or a fuel station, not
--     a person, and the index is replaced wholesale on refresh rather than
--     accumulating. The retention question lands on `rides.meeting_place_id`
--     when that column arrives (PD-114) and on the eventual GPS-track table,
--     neither of which is here.
--   * Reach of account deletion — nothing to reach. `private.delete_account`
--     (029) needs no new arm, and adding one would be wrong: erasing a rider
--     must not delete the petrol station they were going to meet at.
--
-- **No `updated_at` and no client-generated id.** CLAUDE.md's offline-write
-- conventions are about rows a client may create while offline and replay. A
-- client can create nothing here — there is no INSERT grant and no INSERT
-- policy — so both columns would document an intention the grants contradict,
-- which is the dead-column trap 034 §2 names.
--
-- ---------------------------------------------------------------------------
-- Attribution is a licence obligation, not a footnote
-- ---------------------------------------------------------------------------
-- Overture is CDLA-Permissive where Overture-contributed and **ODbL where it
-- derives from OSM**, and ODbL requires attribution. Any screen that renders a
-- result from this table must credit "© OpenStreetMap contributors" and
-- "Overture Maps Foundation". It is carried in the table comment below as well
-- as here, because a database comment is the one piece of documentation that
-- survives every edit to CLAUDE.md and is the `data` agent's first read.
--
-- ---------------------------------------------------------------------------
-- Settled decisions carried in here
-- ---------------------------------------------------------------------------
--   #1 no anonymous access  -> the one policy is `to authenticated`, anon revoked
--   #2 blocking is in RLS   -> nothing here is a person, so no block predicate
--   #8 Supabase IS the backend -> a Postgres function called via rpc(), tier 2;
--                              no Edge Function, because nothing here needs a
--                              secret, the outside world or a schedule

-- ---------------------------------------------------------------------------
-- §1. pg_trgm, in `extensions` and not in `public`
-- ---------------------------------------------------------------------------
-- Measured on `letsride-dev` before choosing (list_extensions, 2026-08-08):
-- `pg_trgm` is AVAILABLE at 1.6 and NOT INSTALLED, and the same is true of
-- PostGIS. So this is the migration that installs it.
--
-- `with schema extensions` rather than the bare `create extension` 001 used for
-- uuid-ossp: Supabase's own security advisor flags `extension_in_public`, the
-- `extensions` schema already exists on both hosted projects with USAGE granted
-- to anon, authenticated and service_role (measured), and `postgres`'s
-- role-level search_path already ends in `extensions`. supabase/tests/harness.sql
-- creates the schema for the CI run, in the same spirit as its
-- `supabase_realtime` stub — a Supabase artifact reproduced rather than a
-- migration made conditional, so this statement is identical in every
-- environment.
--
-- The operator class below is schema-qualified (`extensions.gin_trgm_ops`) for
-- the same reason: it must resolve whatever the applying role's search_path is.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- §2. public.places
-- ---------------------------------------------------------------------------
-- Column order matches scripts/places/extract-nl.py's CSV_HEADER exactly, so
-- the file and the table can be read side by side. Nullability matches the
-- MEASURED data rather than a guess (release 2026-07-22.0, 736,538 NL rows):
--
--   name        always present  — the extractor drops unnamed rows       -> not null
--   brand       null on 92%     -> nullable
--   category    empty on ~21k   -> nullable (CSV writes '', COPY reads it as NULL)
--   lon, lat    always present  — Overture places are points             -> not null
--   street      null on ~5%     -> nullable
--   locality    not measured    -> nullable
--   postcode    not measured    -> nullable
--   country     always present, always 'NL' today                        -> not null
--   confidence  0..1 float, may be null                                  -> nullable
--
-- `id` is `text`, not `uuid`, although every id in the 2026-07-22.0 release is
-- UUID-shaped. Overture documents a GERS id as an **opaque string**; typing it
-- `uuid` buys ~15 MB across 736k rows and costs a failed load on the first
-- release that ships anything else, at a point where the fix is a migration
-- against a table nobody can write to. Opaque in the spec, opaque in the column.
--
-- The CHECKs are load insurance, not client validation — no client can write
-- here. `lat`/`lon` are bounded because a column-order slip in a hand-run
-- `\copy` is the realistic failure mode for an out-of-band load, and a swapped
-- pair is exactly what a range check catches.
create table public.places (
  id text primary key,
  name text not null,
  brand text,
  category text,
  lon double precision not null,
  lat double precision not null,
  street text,
  locality text,
  postcode text,
  country text not null,
  confidence double precision,

  constraint places_name_present check (name ~ '\S'),
  constraint places_lat_range    check (lat between -90 and 90),
  constraint places_lon_range    check (lon between -180 and 180),
  constraint places_country_code check (country ~ '^[A-Z]{2}$'),
  constraint places_confidence_range check (confidence is null or confidence between 0 and 1)
);

alter table public.places enable row level security;

comment on table public.places is
  'Self-hosted place index for ride meeting points (037), built from Overture Maps open data — NOT rider content: no owner, no author, loaded out of band by `\copy` and readable by every signed-in rider. LICENCE: CDLA-Permissive where Overture-contributed and ODbL where OSM-derived, so any screen rendering a result MUST credit "© OpenStreetMap contributors" and "Overture Maps Foundation". Search it through public.search_places(), never with an ad-hoc ILIKE — the function carries the guard that keeps a query off a 736k-row sequential scan.';

comment on column public.places.id is
  'The Overture GERS id, verbatim. `text` rather than `uuid` on purpose: GERS ids are documented as opaque strings and only happen to be UUID-shaped today.';

comment on column public.places.confidence is
  'Overture''s 0..1 confidence that the place exists. Deliberately NOT part of search_places() ranking — it measures source agreement, so ranking on it would systematically bury small independent businesses under chains, which is the opposite of what a meeting-point picker wants.';

-- ---------------------------------------------------------------------------
-- §3. Indexes — trigram for the text half, plain btree for the spatial half
-- ---------------------------------------------------------------------------
-- **PostGIS is deliberately not enabled.** It is available on the platform and
-- it is the reflex answer, but the spatial half of this query is a rectangle
-- around a point on a 736k-row table. A btree on (lat, lon) answers that; PostGIS
-- would add a geometry type, a second coordinate representation to keep in step
-- with lat/lon, ~1,000 functions in a new schema, and its own advisor surface,
-- for a bounding box. If the roadmap's background location tracking ever needs
-- real geodesy, that is the change that should carry the dependency, and it can
-- add a geometry column beside these two.
--
-- Sizes and timings below are MEASURED, but on 750k synthetic rows in a local
-- Postgres 16 — not on the real extract, which does not exist in any database
-- yet. They are the right order of magnitude, not a promise; re-measure after
-- the first load.
--
--   heap                                    122 MB
--   places_pkey                              55 MB
--   places_name_trgm_idx                     32 MB
--   places_brand_trgm_idx (partial)         2.0 MB
--   places_lat_lon_idx                       23 MB
--
-- The brand index is partial because `brand` is null on 92% of rows; the
-- predicate takes it from ~30 MB to 2 MB and costs nothing, since a search for a
-- null brand is not a thing.
create index places_name_trgm_idx
  on public.places using gin (name extensions.gin_trgm_ops);

create index places_brand_trgm_idx
  on public.places using gin (brand extensions.gin_trgm_ops)
  where brand is not null;

-- Leading column `lat` because the bbox in search_places() is symmetric and
-- either order works; the pair is what lets the planner BitmapAnd this with the
-- trigram bitmap instead of rechecking coordinates on every text match. Measured
-- on the bench: a broad term ('shell', 10,714 matching rows) is 22 ms through
-- the bbox pass against 55 ms nationally.
--
-- It is also the index a future "places near here" lookup with no text at all
-- would need — the reverse-geocode half of PD-114 — so it is not solely the
-- typeahead's.
create index places_lat_lon_idx on public.places (lat, lon);

-- ---------------------------------------------------------------------------
-- §4. RLS — read by any signed-in rider, written by nobody
-- ---------------------------------------------------------------------------
-- `using (true)` is the whole predicate and it is correct rather than lazy: a
-- place is public reference data, there is no audience to compute and no person
-- to block. Decision #1 is what makes `true` safe — the policy is scoped
-- `to authenticated`, so "everyone" means every signed-in rider and never the
-- internet.
create policy "Places are readable by any signed-in rider"
  on public.places for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- §4b. NO INSERT, UPDATE OR DELETE — no policy AND no grant
-- ---------------------------------------------------------------------------
-- Both halves, asserted separately, for 034 §4's reason: RLS needs a table grant
-- AND a permitting policy, so the missing grant is the outer gate and the
-- missing policy the inner one. Absence is the enforcement here, and absence is
-- what a well-meaning `grant all` restores without anyone noticing.
--
-- The revoke is not decoration. Supabase's default privileges grant every DML
-- right in `public` to anon and authenticated on table creation — that is why
-- 007 exists — so without this line a signed-in rider could rewrite the map.
revoke all on public.places from anon, authenticated;
grant select on public.places to authenticated;

-- No `enforce_participation_gate` trigger, and that is a decision rather than an
-- omission: 023's gate is a BEFORE INSERT guard on tables a rider writes to, and
-- there is no write path here at all to gate. The count stays at nine
-- (`select count(*) from pg_trigger where tgname = 'enforce_participation_gate'
-- and not tgisinternal`).

-- ---------------------------------------------------------------------------
-- §5. public.search_places — the typeahead, tier 2
-- ---------------------------------------------------------------------------
-- CLAUDE.md's three tiers: this is tier 2 rather than tier 1 because a plain
-- PostgREST select cannot express "rank by text similarity, then by distance,
-- preferring what is nearby" in one round trip, and cannot carry the guard in
-- §5a. It is NOT tier 3 — nothing here needs a secret, an outbound call or a
-- schedule.
--
-- **`security invoker`, and that is the important word.** There is no
-- authorization to re-check inside the body, so a definer would buy nothing and
-- cost a seventh `authenticated_security_definer_function_executable` advisor
-- for CLAUDE.md's table to explain. Invoker also means the SELECT policy in §4
-- governs the function exactly as it governs a direct select: if the policy is
-- ever narrowed, the search narrows with it, with no second copy of the rule.
--
-- `set search_path = ''` and every non-pg_catalog name schema-qualified, per
-- 005's rule. `ilike`, `~`, `^`, `left`, `btrim`, `replace`, `concat_ws`,
-- `nullif`, `cos` and `radians` are all pg_catalog and resolve regardless;
-- `extensions.similarity` is the one that would not.
--
-- ---------------------------------------------------------------------------
-- §5a. The guard: an alphanumeric run of THREE, not a length of three
-- ---------------------------------------------------------------------------
-- This is the line that keeps the function off a sequential scan, and the
-- obvious version of it is wrong.
--
-- A GIN trigram index can only serve `ILIKE '%needle%'` when the pattern
-- contains three consecutive *known* characters, because a trigram needs three
-- adjacent characters and pg_trgm treats non-alphanumerics as word separators.
-- A pattern with no extractable trigram does not fail — it degenerates to a full
-- scan, silently.
--
-- Measured on the 750k-row bench: `char_length(term) >= 3` looks like the guard
-- and is not. `search_places('%%%%')` passed it, escaped to a literal
-- `%\%\%\%\%%`, extracted no trigrams and took **1,443 ms**. Every signed-in
-- rider can call this function; `authenticated` carries an 8 s statement_timeout,
-- so that is not an error anyone would see — it is 1.4 s of database CPU per
-- keystroke, on demand. `'____'`, `'a-b-c'` and any punctuation run do the same.
--
-- `term ~ '[[:alnum:]]{3}'` is the condition that actually maps to index
-- usability, and it implies the length rule. Verified under C.UTF-8 that
-- `[[:alnum:]]` matches accented Latin and CJK, so it does not quietly refuse
-- 'Café' or a non-Latin name.
--
-- The 100-character cap is the other half: a typeahead never needs more, and it
-- bounds both the LIKE pattern and the per-row `similarity()` call against a
-- pasted megabyte.
--
-- LIKE metacharacters are escaped, so a rider typing `%` searches for a percent
-- sign instead of matching every row in the country.
--
-- ---------------------------------------------------------------------------
-- §5b. Two passes: nearby first, then the rest of the country
-- ---------------------------------------------------------------------------
-- Proximity has to be a BIAS, not a filter — a rider in Utrecht planning a ride
-- to Maastricht must still find Maastricht — so the bbox cannot go in the WHERE
-- clause of a single query. But a bbox that only *reorders* buys nothing either:
-- an unrestricted pass already contains every row the local pass would find, so
-- pooling the two and ranking by one key makes the local pass dead weight.
--
-- So: the local pass fills the list, and the national pass fills whatever is
-- left. `Zeldzaamplek` with two matches near the rider and four in Maastricht
-- returns the two local ones first and then the three nearest of the rest —
-- verified on the bench.
--
-- The national pass is guarded by `(select count(*) from local_hits) < 5`, which
-- is Var-free and therefore a **One-Time Filter**: when the local pass fills,
-- the national scan is planned and `never executed`. Confirmed in EXPLAIN
-- ANALYZE rather than assumed.
--
-- ~0.25° of latitude and ~0.40° of longitude is roughly a 28 km box at Dutch
-- latitudes — a plausible "somewhere near me" for a bike, and a small enough
-- slice of the country to be worth an index scan.
--
-- ---------------------------------------------------------------------------
-- §5c. What the ranking deliberately does NOT do
-- ---------------------------------------------------------------------------
-- **No fuzzy/typo branch.** `name %> term` (word similarity) was written,
-- measured and removed. At pg_trgm's default `word_similarity_threshold` of 0.6
-- it does not catch the thing it is for — `word_similarity('jubmo', 'Jumbo
-- Utrecht')` is 0.33 — while widening a selective query from 9 rows to 9,529 and
-- taking it from 4.8 ms to 91 ms. A branch that costs 20x and misses the
-- transposition is not typo tolerance. `similarity()` still drives the *order*,
-- so a shorter, closer name outranks a longer one; the filter is honest
-- containment.
--
-- **`street`, `locality` and `postcode` are display-only, not searchable.** The
-- filter is `name` and `brand`, per PD-140. So "Vrijthof" finds nothing today
-- even though four fixtures sit on it. That is a scope line, not an oversight —
-- see the report accompanying this migration.
create or replace function public.search_places(
  q text,
  near_lat double precision default null,
  near_lng double precision default null
)
returns table (
  id text,
  label text,
  meta text,
  lat double precision,
  lng double precision
)
language sql
stable
parallel safe
security invoker
set search_path = ''
as $fn$
  with raw as (
    select left(btrim(search_places.q), 100) as term
  ),
  t as (
    select
      raw.term,
      '%' || replace(replace(replace(raw.term, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
      raw.term ~ '[[:alnum:]]{3}' as searchable,
      search_places.near_lat as la,
      search_places.near_lng as lo,
      -- Equirectangular approximation. Only ever compared against itself, and
      -- the Netherlands is 300 km across, so the error is far below the
      -- resolution any ordering here can express.
      cos(radians(coalesce(search_places.near_lat, 0))) * 111.32 as km_per_lon
    from raw
  ),
  -- Squared distance throughout: monotonic in distance, so the ordering is
  -- identical and there is no sqrt per candidate row.
  local_hits as (
    select p.id, p.name, p.street, p.locality, p.lat, p.lon,
           extensions.similarity(t.term, p.name) as score,
           ((p.lon - t.lo) * t.km_per_lon) ^ 2 + ((p.lat - t.la) * 110.57) ^ 2 as dist2
    from t join public.places p
      on p.lat between t.la - 0.25 and t.la + 0.25
     and p.lon between t.lo - 0.40 and t.lo + 0.40
     and (p.name ilike t.pat or p.brand ilike t.pat)
    where t.searchable and t.la is not null and t.lo is not null
    order by score desc, dist2 asc
    limit 5
  ),
  national_hits as (
    select p.id, p.name, p.street, p.locality, p.lat, p.lon,
           extensions.similarity(t.term, p.name) as score,
           case when t.la is null or t.lo is null then null
                else ((p.lon - t.lo) * t.km_per_lon) ^ 2 + ((p.lat - t.la) * 110.57) ^ 2
           end as dist2
    from t join public.places p
      on (p.name ilike t.pat or p.brand ilike t.pat)
    where t.searchable
      and (select count(*) from local_hits) < 5
      and not exists (select 1 from local_hits l where l.id = p.id)
    order by score desc, dist2 asc nulls last
    limit 5
  ),
  pooled as (
    select 0 as tier, * from local_hits
    union all
    select 1 as tier, * from national_hits
  )
  -- `meta` is the design's second line on a Label-over-Meta result row. A null
  -- street collapses rather than leaving a leading comma, and a row with neither
  -- street nor locality returns NULL so the UI draws one line instead of an
  -- empty one.
  select r.id,
         r.name,
         nullif(concat_ws(', ', r.street, r.locality), ''),
         r.lat,
         r.lon
  from pooled r
  order by r.tier, r.score desc, r.dist2 asc nulls last
  limit 5;
$fn$;

comment on function public.search_places(text, double precision, double precision) is
  'Meeting-point typeahead over public.places (037). SECURITY INVOKER — the places SELECT policy governs it, there is nothing to re-check. Returns at most 5 rows: the design draws five. Ranks nearby matches ahead of distant ones by filling from a ~28 km box first and falling back to the whole country. Returns ZERO rows unless the query holds three consecutive alphanumerics — below that a trigram index cannot serve the ILIKE and the query becomes a 736k-row sequential scan (measured: 1,443 ms for ''%%%%'').';

-- Default EXECUTE goes to PUBLIC on creation, and Supabase's default privileges
-- in `public` grant it to anon as well. 005's rule: take it away, then hand it
-- back to exactly one role.
revoke all on function public.search_places(text, double precision, double precision)
  from public, anon;
grant execute on function public.search_places(text, double precision, double precision)
  to authenticated;

-- ---------------------------------------------------------------------------
-- §6. Loading the data — NOT part of this migration
-- ---------------------------------------------------------------------------
-- 736,538 rows is not an `apply_migration` payload and there are no database
-- credentials in the build container, so the load is an operator step. This
-- migration creates the table and the function; the table is EMPTY until
-- somebody runs the two commands below, and an empty table looks exactly like a
-- working search that finds nothing.
--
--   python3 scripts/places/extract-nl.py --out nl-places.csv
--
--   psql "$DEV_DATABASE_URL" \
--     -c "\copy public.places (id, name, brand, category, lon, lat, street, locality, postcode, country, confidence) FROM 'nl-places.csv' WITH (FORMAT csv, HEADER true)" \
--     -c "analyze public.places"
--
-- **The column list is required**, and scripts/places/README.md's shorter form
-- is not runnable as written — it names a `places_import` table that does not
-- exist, and a bare `\copy public.places FROM ...` would demand every column in
-- table order anyway.
--
-- **`analyze` is required too.** A bulk-loaded table has no statistics, and the
-- planner's choice between the trigram bitmap and a sequential scan is made from
-- them. Without it the first searches after a load can be slower than the
-- numbers in §3 by an order of magnitude, intermittently, which is the hardest
-- possible thing to diagnose later.
--
-- The load runs as the owner, which bypasses RLS and the missing INSERT grant.
-- That is the point of §4b: the operator can write, and nothing reachable
-- through PostgREST can.
--
-- **Refreshing** (Overture releases monthly) should load into a fresh table and
-- swap it in, not `delete` and re-insert: a truncate-and-reload leaves search
-- returning nothing for the length of the load, and it is a `\copy` of 99 MB.
-- The detector scripts/places/README.md asks for — row count within a band of
-- the previous run, plus a known landmark still resolving — belongs with that
-- job, and neither exists yet.

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying, not just in CI
-- ---------------------------------------------------------------------------
-- The suite runs on plain Postgres as the table owner and cannot see role
-- grants, PostgREST exposure or Supabase defaults. Each of these predicts a
-- number:
--
--   -- 1 policy, SELECT, {authenticated}
--   select cmd, roles::text, qual from pg_policies
--    where schemaname = 'public' and tablename = 'places';
--
--   -- true — RLS is on
--   select relrowsecurity from pg_class where oid = 'public.places'::regclass;
--
--   -- 0 — anon holds nothing at all, decision #1
--   select count(*) from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'places' and grantee = 'anon';
--
--   -- exactly {SELECT} — no INSERT, UPDATE or DELETE for authenticated
--   select privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'places' and grantee = 'authenticated';
--
--   -- 0 — and no column-level write grant hiding behind that, 034 §4b's trap
--   select count(*) from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'places'
--      and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT';
--
--   -- true, then false — the function is reachable by riders and not by anon
--   select has_function_privilege('authenticated',
--            'public.search_places(text,double precision,double precision)', 'execute'),
--          has_function_privilege('anon',
--            'public.search_places(text,double precision,double precision)', 'execute');
--
--   -- false, and {search_path=""} — invoker, with the path pinned
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.search_places(text,double precision,double precision)'::regprocedure;
--
--   -- 4 — pkey plus the three from §3
--   select indexname from pg_indexes where schemaname='public' and tablename='places';
--
--   -- extensions, not public
--   select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
--    where e.extname = 'pg_trgm';
--
--   -- 9 — the participation-gate count is UNCHANGED; places has no write path
--   select count(*) from pg_trigger
--    where tgname = 'enforce_participation_gate' and not tgisinternal;
--
-- And the advisors: `get_advisors(security)` must still return the documented
-- eight. A ninth would mean either the extension landed in `public` or
-- search_places was created `security definer`.
