-- Load public.places from the extractor's CSV, transactionally, with a detector.
--
-- Invocation — the CSV arrives on psql's stdin, so this script is
-- path-independent and can be run from anywhere:
--
--   psql "$URL" -v ON_ERROR_STOP=1 -f scripts/places/load.sql < nl-places.csv
--   psql "$URL" -v ON_ERROR_STOP=1 -v force=1 -f scripts/places/load.sql < nl-places.csv
--
-- `force=1` downgrades the row-count band from an error to a warning and nothing
-- else — the landmark probes below are never overridable, because they are
-- correctness rather than policy. `.github/workflows/places-load.yml` runs this
-- exact command; scripts/places/README.md §Loading is the operator's copy.
--
-- ON_ERROR_STOP is not optional. Without it psql reports a failed statement and
-- carries on to `commit`, so a load that violated a constraint commits anyway
-- and the job goes green.
--
-- ---------------------------------------------------------------------------
-- Why ONE TRANSACTION rather than a staging table and a rename
-- ---------------------------------------------------------------------------
-- The requirement this has to meet is that search must never be observably
-- empty: a `truncate` followed by a 99 MB `\copy` leaves every rider's search
-- returning nothing for the length of the copy, which reads as the feature being
-- broken rather than as a maintenance window. scripts/places/README.md
-- §Refreshing states that requirement as "load into a fresh table and swap it
-- in", which is one mechanism for it. This is another, and it is strictly less
-- machinery:
--
--   * `delete` inside a transaction takes ROW EXCLUSIVE, which does NOT conflict
--     with ACCESS SHARE. So concurrent readers neither block nor see zero rows —
--     MVCC keeps them on the pre-delete snapshot until `commit`, at which point
--     they see the complete new set. There is no window in between.
--   * `truncate` would take ACCESS EXCLUSIVE for the whole transaction, so
--     readers would BLOCK rather than see stale rows — and block for minutes,
--     well past the 8 s `statement_timeout` `authenticated` runs under. That is
--     why the README forbids it, and the reason survives the change of mechanism.
--   * A staging table has to reproduce the real table's definition (11 columns, 5
--     CHECKs, a generated column, 4 indexes) or diverge from it silently. `like
--     public.places` does NOT copy generation expressions, RLS, policies or
--     grants, so the copy would need hand-maintained DDL living outside the
--     migration chain. Loading the live table exercises the real constraints on
--     the real rows instead.
--   * Peak disk is lower: old rows + new rows, with no third copy in a staging
--     heap. That matters on the free tier — see §Cost below.
--
-- Everything below `begin` is one unit. If any statement or any assertion fails,
-- the transaction rolls back and `public.places` is byte-for-byte what it was.
-- So a bad CSV cannot leave a half-loaded table, and the detector running AFTER
-- the load rather than before it costs nothing.

\if :{?force}
\else
  \set force 0
\endif

-- A 736k-row load with four indexes and a generated column takes minutes, and
-- the 8 s ceiling `authenticated` carries would kill it. `postgres` normally has
-- no limit, but the pooler and the project settings can both supply one, so this
-- is set rather than assumed. Reset to something finite around the probes.
set statement_timeout = 0;
set idle_in_transaction_session_timeout = 0;

-- Bounded on purpose: if some other session is holding a conflicting lock on
-- `places` we want to fail in half a minute with a lock error, not sit inside an
-- open transaction against a live database indefinitely.
set lock_timeout = '30s';

begin;

select set_config('places.force', :'force', true);

-- The "previous run" the band compares against is simply what is in the table
-- right now, so there is no state file to keep and nothing to go stale. On the
-- first load this is 0, which selects the absolute floor instead of the band.
--
-- Deliberately NOT `on commit drop`: the reindex decision after the commit reads
-- it back. A temp table lives for the session either way, so it still cannot
-- outlive this psql invocation.
create temp table _places_load_state as
  select count(*)::bigint as prev_rows from public.places;

delete from public.places;

-- **The explicit column list is required**, and for two separate reasons. A bare
-- `\copy public.places from …` demands every column in table order — which now
-- includes `search_text`, a generated column that rejects any supplied value
-- (039). And `header match` (PG 16+) asserts that the CSV's header line equals
-- this list, in this order: without it, `header true` merely SKIPS the header and
-- maps the columns positionally, so an extractor that reorders `CSV_HEADER`
-- loads longitudes into `lat` and the CHECKs only catch it if the values happen
-- to fall out of range. That is the one failure in this file that would be
-- silent, so it is asserted rather than trusted.
\copy public.places (id, name, brand, category, lon, lat, street, locality, postcode, country, confidence) from pstdin with (format csv, header match)

-- **Before the probes, not after the commit.** A bulk-loaded table carries no
-- statistics and the planner chooses between the trigram bitmap and a sequential
-- scan from them, so the first searches after a load can be an order of
-- magnitude slower, intermittently — and running `analyze` here means the index
-- probe below is checking the plan riders will actually get.
analyze public.places;

do $detect$
declare
  -- The measured NL extract is 736,538 rows (release 2026-07-22.0, README
  -- §Extracting). 500k is ~68% of that: low enough that ordinary release churn
  -- never trips it, high enough to catch the realistic truncation — the fetch
  -- reads 2 of 16 parquet parts, so losing one loses roughly half the rows and
  -- the extractor exits 0 having written a perfectly valid short CSV.
  floor_first constant bigint := 500000;

  -- Asymmetric on purpose. A shrink is the failure mode worth catching (a
  -- dropped row group, a country filter regression, a partial fetch); growth is
  -- what a dataset that keeps adding sources actually does. Neither bound has
  -- ever been exercised against two real releases — there has only been one —
  -- so they are reasoned, not measured, and `force=1` exists for the first
  -- legitimate release that disagrees.
  band_lo_pct constant numeric := 0.90;
  band_hi_pct constant numeric := 1.25;

  prev     bigint;
  loaded   bigint;
  lo       bigint;
  hi       bigint;
  forced   boolean := coalesce(current_setting('places.force', true), '0')
                        not in ('0', 'off', 'false', 'no', '');
  n        bigint;
  nl       bigint;
  cent     record;
  plan     json;
begin
  select prev_rows into prev from _places_load_state;
  select count(*)  into loaded from public.places;

  raise notice 'places: % rows before, % rows loaded', prev, loaded;

  -- §1. The row-count band — the only overridable assertion in this block.
  if prev = 0 then
    if loaded < floor_first then
      if forced then
        raise warning 'FORCED: first load is only % rows, under the % floor', loaded, floor_first;
      else
        raise exception
          'first load is only % rows, under the % floor. The measured NL extract is 736,538; a short CSV is what a partial parquet fetch produces, and it exits 0. Check the extractor output, or re-run with -v force=1 if this is genuinely the whole dataset.',
          loaded, floor_first;
      end if;
    end if;
  else
    lo := floor(prev * band_lo_pct);
    hi := ceil(prev * band_hi_pct);
    if loaded < lo or loaded > hi then
      if forced then
        raise warning 'FORCED: % rows is outside the %..% band for a previous run of %', loaded, lo, hi, prev;
      else
        raise exception
          '% rows is outside the %..% band for a previous run of % rows. A refresh that silently stops looks exactly like working search, so this fails closed. Inspect the extract, then re-run with -v force=1 to accept it.',
          loaded, lo, hi, prev;
      end if;
    end if;
  end if;

  -- Probes get a finite ceiling: a pathological plan should fail the load, not
  -- hold an open transaction against a live database for ever.
  perform set_config('statement_timeout', '60s', true);

  -- §2. The landmarks, through the app's own entry points rather than a
  -- hand-written ILIKE — so a load that succeeded while `search_places` or
  -- `locality_centroid` regressed still fails here. Not overridable.
  --
  -- All three are NL-specific, as is the country distribution in §3. Widening
  -- the extractor's `--countries` means revisiting this block in the same
  -- change; that is deliberate, because a detector whose landmarks no longer
  -- describe the data is worse than no detector.

  -- A name/brand match served from the local pass. ~483 Shell stations and
  -- Albert Heijn among the top brands on the measured run, so one row is a very
  -- low bar — which is the point: this asks whether search resolves at all.
  select count(*) into n from public.search_places('Albert Heijn', 52.3676, 4.9041);
  if n = 0 then
    raise exception 'landmark probe failed: search_places(''Albert Heijn'', Amsterdam) returned no rows';
  end if;

  -- An address match with no coordinates — the national pass, and 039's whole
  -- point. Under 037 this returned nothing by design, so it is also the
  -- assertion that `search_text` is being matched rather than `name`.
  select count(*) into n from public.search_places('Kerkstraat');
  if n = 0 then
    raise exception 'landmark probe failed: search_places(''Kerkstraat'') returned no rows — street is not searchable, so search_text or its index is wrong';
  end if;

  -- 040's reverse lookup, and a coordinate sanity check in one. The bounds are
  -- the extractor's NL_BBOX: a centroid outside it means lat/lon are swapped or
  -- the locality is aggregating rows from somewhere else.
  select * into cent from public.locality_centroid('Amsterdam');
  if cent.place_count is null or cent.place_count < 100 then
    raise exception 'landmark probe failed: locality_centroid(''Amsterdam'') aggregated % rows', coalesce(cent.place_count, 0);
  end if;
  if cent.lat not between 50.75 and 53.56 or cent.lon not between 3.36 and 7.23 then
    raise exception 'landmark probe failed: Amsterdam centroid (%, %) is outside the Dutch bbox', cent.lat, cent.lon;
  end if;

  -- §3. Structural checks the table's own CHECKs cannot make.

  -- `places_country_code` only asserts two uppercase letters. The bbox is a
  -- prune and not the filter — the first smoke run of the extractor came back
  -- full of Belgian places — so this is the assertion that the country filter
  -- is still doing its job. A margin is allowed rather than demanding 100%,
  -- because widening `--countries` is a supported change.
  select count(*) into nl from public.places where country = 'NL';
  if nl < loaded * 0.90 then
    raise exception 'only % of % rows are NL. The bbox reaches into Belgium and Germany and is only a prune; addresses[0].country is what decides membership.', nl, loaded;
  end if;

  -- The generated column has to actually contain the address half, or address
  -- search degrades to name search and nothing errors. Checked by containment
  -- rather than by reading the expression, so a future redefinition that drops
  -- `locality` fails here.
  select count(*) into n
    from public.places
   where locality ~ '\S' and position(locality in search_text) = 0;
  if n > 0 then
    raise exception '% rows have a locality that is absent from search_text — the generated column no longer covers the address fields (039)', n;
  end if;

  -- A load where `locality` came through systematically NULL still satisfies
  -- every CHECK and still answers the Kerkstraat probe. The real extract is
  -- ~99% populated across thousands of towns; 500 distinct is a floor, not an
  -- expectation.
  select count(distinct lower(btrim(locality))) into n
    from public.places where locality ~ '\S';
  if n < 500 then
    raise exception 'only % distinct localities — locality is not populated, so town-qualified search and locality_centroid() are both dead', n;
  end if;

  -- §4. Did `analyze` above actually give the planner what it needs? Skipping it
  -- costs an order of magnitude, intermittently, and nothing else in this file
  -- would notice.
  --
  -- ** Asserted as "statistics exist", NOT as "the planner chose the index". **
  -- The second is the tempting version and it is the wrong contract to fail a
  -- load on: a plan is a costing judgement against `random_page_cost`,
  -- `effective_cache_size` and the parallel-worker settings, and this script was
  -- only ever measured on local PG 16.13 while both targets are Supabase PG 17.6
  -- with their own values. Worse, the probe necessarily runs INSIDE the load
  -- transaction, where the heap still carries every pre-delete tuple — so a
  -- sequential scan is priced higher here than it will be a minute later, which
  -- biases the check toward passing in the state it was tested in and toward
  -- failing in the state nobody has tested. A false failure would roll back a
  -- good 736k-row load with no override, since `force` deliberately does not
  -- reach this far.
  --
  -- Statistics on `search_text` are what `analyze` is actually here to produce,
  -- they are what their absence would cost, and their presence is a fact rather
  -- than a judgement.
  select count(*) into n
    from pg_stats
   where schemaname = 'public' and tablename = 'places' and attname = 'search_text';
  if n = 0 then
    raise exception 'ANALYZE produced no statistics for places.search_text — the planner would be choosing between the trigram bitmap and a sequential scan blind, which costs an order of magnitude intermittently';
  end if;

  -- The plan is still worth SEEING, so it is reported and not asserted. Gated on
  -- size because below it a sequential scan is genuinely the right answer and the
  -- warning would be noise.
  if loaded >= 100000 then
    execute 'explain (format json) select 1 from public.places where search_text ilike ''%kerkstraat%'''
       into plan;
    if plan::text not like '%places_search_text_trgm_idx%' then
      raise warning 'the trigram index was NOT chosen for a substring search. Not fatal — the load is correct and this is a planner judgement, measured inside a transaction still holding the pre-delete tuples — but if searches are slow after this, start here. Plan: %', plan::text;
    end if;
  end if;

  perform set_config('statement_timeout', '0', true);
  raise notice 'places: all detector assertions passed';
end
$detect$;

commit;

-- After the commit, so neither can roll it back and both are honest about a
-- table that is now live.
--
-- `vacuum` cannot run inside a transaction, which is why the `analyze` above is
-- separate from this one: that one is the load-bearing statistics refresh, this
-- one reclaims the dead tuples the `delete` left so the NEXT load reuses the
-- space instead of extending the heap again. A refresh therefore sits at roughly
-- 2x the steady-state size until this completes.
--
-- ** If this step fails, the swap has already committed. ** The rows are live and
-- correct; only the vacuum did not run. Re-run `vacuum (analyze) public.places`
-- rather than the whole load.
vacuum (analyze) public.places;

-- **`vacuum` does not reclaim index bloat, and a monthly refresh accumulates it.**
-- Measured on the real 736,538-row extract, local PG 16.13, with this script's
-- `vacuum (analyze)` running after every cycle:
--
--   one clean load          heap 162 MB   GIN 85 MB    all indexes 175 MB   total 337 MB
--   after four load cycles  heap 162 MB   GIN 207 MB   all indexes 372 MB   total 533 MB
--   reindexed               heap 162 MB   GIN 72 MB    all indexes 141 MB   total 303 MB
--
-- So the heap is stable — `vacuum` does hand the deleted tuples' space back for
-- the next load to reuse — while every index grows on every refresh and only a
-- rebuild recovers it. Unchecked, that is a table which silently doubles over a
-- year of refreshes, on a project whose free tier caps the whole database at
-- 500 MB.
--
-- CONCURRENTLY because the plain form takes ACCESS EXCLUSIVE and would block
-- every rider's search for the length of the rebuild — the same objection that
-- rules out `truncate` at the top of this file.
--
-- ** SKIPPED ON A FIRST LOAD, and that is a disk-space decision rather than a
-- tidiness one. ** `REINDEX TABLE CONCURRENTLY` advances every index of the
-- table through each phase together, so all four new indexes exist alongside all
-- four old ones at the peak. On the measured numbers that peak is
-- 162 heap + 175 old + 141 new = 478 MB, and against the free tier's 500 MB
-- database cap a first load would exhaust the quota DURING the rebuild — after
-- the commit, so the rows would be live, the project restricted, and an invalid
-- index left on disk.
--
-- Skipping it costs nothing, because a first load has no bloat to reclaim: the
-- indexes were just built by the `\copy` itself. It buys 85 MB -> 72 MB on the
-- GIN index and nothing else. Bloat is a property of the delete-and-reload
-- cycle, so the rebuild belongs exactly where the cycle is — see the measured
-- table above, where four cycles take the table from 337 MB to 533 MB.
--
-- ** The one hazard, and it is quiet: a FAILED concurrent reindex leaves an
-- invalid `*_ccnew` index behind. ** The planner ignores it, so search keeps
-- working at full speed and nothing goes red — it just occupies disk until
-- someone drops it:
--
--   select indexrelid::regclass from pg_index
--    where not indisvalid and indrelid = 'public.places'::regclass;
--
-- The 30 s `lock_timeout` set at the top of this file is still in force here and
-- would be the wrong bound: a rebuild that has to wait behind one long-lived
-- reader would abort AFTER the swap committed, which is the messiest place to
-- fail. Widened for this statement only.
set lock_timeout = '5min';

select case when prev_rows = 0 then 'off' else 'on' end as do_reindex
  from _places_load_state \gset

\if :do_reindex
reindex table concurrently public.places;
\else
\echo '(first load — skipping the reindex: freshly built indexes carry no bloat, and the concurrent rebuild would double index disk to reclaim nothing)'
\endif

-- §Cost — printed rather than described, because these are the first real
-- numbers this table will ever have. Every size in 037, 039 and 040 comes from a
-- 750k-row SYNTHETIC bench and each of those files says to re-measure here.
select
  (select count(*) from public.places)                    as rows,
  pg_size_pretty(pg_relation_size('public.places'))       as heap,
  pg_size_pretty(pg_indexes_size('public.places'))        as indexes,
  pg_size_pretty(pg_total_relation_size('public.places')) as places_total,
  pg_size_pretty(pg_database_size(current_database()))    as database_total;
