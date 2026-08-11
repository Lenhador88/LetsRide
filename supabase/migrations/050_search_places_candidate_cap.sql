-- Bound search_places' cost by capping candidate rows BEFORE scoring.
--
-- PD-150 option B. `049` shipped option A — a cap of eight distinct patterns —
-- and this file is the half `049`'s own comment says it does not do:
--
--   "THE FLOOR IS NOT BOUNDED and 049 does not change it: one broad token still
--    costs ~2,809 ms, because that is the data's cost rather than the caller's
--    choice — capping candidate rows before scoring is what would bound it, and
--    it is still open (PD-150 option B)."
--
-- ---------------------------------------------------------------------------
-- §1  Why now: the first real measurements, and they are much worse
-- ---------------------------------------------------------------------------
-- `places` was loaded on DEV for the first time on 2026-08-11 (PD-195):
-- **736,538 rows**, 163 MB heap, 175 MB indexes. Every timing in `037`, `039`
-- and `049` came from a 750k-row SYNTHETIC bench, and all three files say to
-- re-measure here. Measured, as `postgres`, no statement timeout:
--
--   | query                            | 039/049 predicted | measured  |
--   |----------------------------------|-------------------|-----------|
--   | ten distinct substrings of one word | 5,914 ms       | 14.6 ms   |  <- 049 works
--   | `straat`, no location            | ~2,957 ms         | 11,458 ms |
--   | `straat`, near Amsterdam         | 29-152 ms         |  4,011 ms |
--   | `Stationsplein Amsterdam`        | -                 |    330 ms |
--
-- **Two of those are 4x and 25-130x worse than documented.** The synthetic bench
-- was well calibrated on SIZE — it predicted 162 MB heap against an actual 163 —
-- and badly calibrated on TIME. Do not reuse its timings for anything.
--
-- **The threat model inverts, and that is the reason this is not a hardening
-- task.** PD-150 is written as a security finding: a crafted term, an attacker,
-- "any signed-in account can repeat it". `049` closed that. What is left is not
-- an attack at all — `straat` is ONE token, appears in 211,407 rows (28.7% of
-- the table), and is the most ordinary thing a Dutch rider types when searching
-- for a street. The feature is unusably slow on its most obvious input.
--
-- It is also past the 8 s statement timeout `authenticated` carries, so a rider
-- does not get a slow answer — they get an error, having burned 8 s of a free
-- tier's CPU. Worse outcome, same cost.
--
-- ---------------------------------------------------------------------------
-- §2  What changes: one cap, applied differently in each pass
-- ---------------------------------------------------------------------------
-- Cost is dominated by per-candidate work, not by finding candidates: the
-- `ilike all (t.pats)` lateral that computes `named`, and `similarity()` on the
-- rows where it is true. Measured at ~74 microseconds per candidate row, which
-- is 7-9x the 8-11 us `039` assumed. Capping the candidate set is therefore
-- close to linear in effect:
--
--   211,407 candidates -> 11,458 ms
--    20,000 candidates ->  1,813 ms
--     2,000 candidates ->    148 ms
--
-- **`PLACE_CANDIDATE_CAP` = 2000**, chosen against that curve for ~150 ms. It is
-- a typeahead: `PD-114`'s picker debounces at ~250 ms and fires per keystroke, so
-- the budget is a fraction of the debounce, not of a page load.
--
-- **The two passes cap differently, and that asymmetry is the whole design.**
--
--   * **local** (a location was supplied) orders by distance BEFORE the cap, so
--     the survivors are the 2,000 NEAREST matches rather than 2,000 arbitrary
--     ones. `dist2` is two multiplications and an add — cheap enough to compute
--     for every bbox match, unlike `similarity()`. So the local pass keeps its
--     contract exactly: the nearest matching places, in order. **Nothing is lost
--     here** beyond the case where more than 2,000 matches sit closer than the
--     answer, which cannot happen — the answer is one of the nearest five.
--
--   * **national** has no meaningful pre-scoring order. `named` needs the
--     lateral and `similarity()` needs `named`, so ordering before the cap would
--     cost exactly what the cap exists to avoid. Its 2,000 are therefore
--     ARBITRARY, and that is the price PD-150 named: a very broad query returns
--     five plausible rows rather than the five best.
--
-- **Where that price actually lands, stated rather than hand-waved.** It bites
-- only when a query matches more than 2,000 rows nationally with no location. At
-- that breadth the previous behaviour was already arbitrary in substance — the
-- five "best" of 211,407 `straat` matches are five streets nobody asked for.
-- Narrow queries are untouched: `Stationsplein Amsterdam` matches far fewer than
-- the cap, so it returns exactly what it returned before, and a rider typing a
-- real meeting point is in that case. The regression is confined to queries whose
-- answers were meaningless already.
--
-- ---------------------------------------------------------------------------
-- §3  What this file does NOT do
-- ---------------------------------------------------------------------------
-- No index, column, policy or grant changes. `049`'s token cap is preserved
-- verbatim — this file replaces one function body and re-issues the same ACL.
-- The function stays `security invoker` with `search_path = ''`; a
-- `statement_timeout` is NOT added, because `039` §5d measured it inert (the
-- timer is armed before the function is entered) and it would read as a bound
-- while bounding nothing.
--
-- **A cap is not a fix for the index.** The national pass seq-scans for a broad
-- token — measured — because a leading-wildcard `ilike` over 28% of the table is
-- cheaper to scan than to look up. That is a separate question about the GIN
-- index and the trigram threshold, and this file does not touch it. What the cap
-- does is make the cost independent of how many rows match, which is the
-- property the endpoint needs whatever the index does.

create or replace function public.search_places(
  q text,
  near_lat double precision default null,
  near_lon double precision default null
)
returns table (
  id text,
  label text,
  meta text,
  lat double precision,
  lon double precision
)
language sql
stable
parallel safe
security invoker
set search_path = ''
as $fn$
  with raw as (
    select
      left(btrim(search_places.q), 100) as term,
      -- Range-checked into NULL, never trusted. `between` is false for NaN and
      -- for either infinity, so all three collapse to "no location" and the
      -- national path handles them — 037 §5a, unchanged.
      case when search_places.near_lat between -90 and 90
           then search_places.near_lat end as la,
      case when search_places.near_lon between -180 and 180
           then search_places.near_lon end as lo
  ),
  t as (
    select
      raw.term,
      -- 037 §5a's guard, unchanged. An alphanumeric run of three cannot span
      -- whitespace, so this is already the per-token condition — see 039 §5.
      --
      -- ** The second conjunct is 049: at most EIGHT distinct patterns. **
      -- Preserved verbatim. It bounds the multiplier a caller controls; the
      -- candidate cap below bounds the multiplicand the DATA controls. Neither
      -- subsumes the other, which is why both are here.
      raw.term ~ '[[:alnum:]]{3}'
        and coalesce(array_length(tk.pats, 1), 0) <= 8 as searchable,
      tk.pats,
      -- Slots 2-4 pad to '%' — a no-op the index ignores, 039 §5b. Slot 1 does
      -- not, as defence in depth rather than as the barrier: the guard and the
      -- NULL array already make a token-less term unreachable here.
      tk.pats[1] as pat1,
      coalesce(tk.pats[2], '%') as pat2,
      coalesce(tk.pats[3], '%') as pat3,
      coalesce(tk.pats[4], '%') as pat4,
      raw.la,
      raw.lo,
      -- Equirectangular approximation. Only ever compared against itself, and
      -- the Netherlands is 300 km across, so the error is far below the
      -- resolution any ordering here can express.
      cos(radians(coalesce(raw.la, 0))) * 111.32 as km_per_lon
    from raw
    -- One escaped LIKE pattern per DISTINCT whitespace-separated token,
    -- indexable tokens first. `group by lower(s.tok)` is the deduplication and
    -- it is a COST fix rather than a correctness one — AND is idempotent.
    -- `lower()` and not the bare token, because the match is ILIKE: Postgres
    -- implements `x ILIKE p` as `lower(x) LIKE lower(p)` under the same
    -- collation, and `\`, `%` and `_` have no case so lowering commutes with
    -- the escaping. All unchanged from 039/049.
    left join lateral (
      select array_agg(
               '%' || replace(replace(replace(d.tok, '\', '\\'), '%', '\%'), '_', '\_') || '%'
               order by (d.tok ~ '[[:alnum:]]{3}') desc, d.ord
             ) as pats
        from (select lower(s.tok) as tok, min(s.ord) as ord
                from regexp_split_to_table(raw.term, '\s+') with ordinality as s(tok, ord)
               where s.tok <> ''
               group by lower(s.tok)) d
    ) tk on true
  ),
  -- ** THE CAP, local pass — ordered by distance FIRST, so the survivors are the
  -- nearest matches rather than arbitrary ones. ** `dist2` is squared distance
  -- throughout: monotonic in distance, so the ordering is identical and there is
  -- no sqrt per candidate row. Two multiplications and an add is cheap enough to
  -- pay for every bbox match; `similarity()` is not, which is the whole reason
  -- the cap sits between them.
  local_candidates as (
    select p.id, p.name, p.brand, p.street, p.locality, p.lat, p.lon,
           ((p.lon - t.lo) * t.km_per_lon) ^ 2 + ((p.lat - t.la) * 110.57) ^ 2 as dist2
    from t join public.places p
      on p.lat between t.la - 0.25 and t.la + 0.25
     and p.lon between t.lo - 0.40 and t.lo + 0.40
     -- ONE indexed token here, four in the national pass. Not an oversight:
     -- a second conjunct costs the planner the bbox index — 039 §5b.
     and p.search_text ilike t.pat1
     and p.search_text ilike all (t.pats)
    where t.searchable and t.la is not null and t.lo is not null
    order by dist2
    limit 2000
  ),
  local_hits as (
    select c.id, c.name, c.street, c.locality, c.lat, c.lon,
           -- 0 when the query NAMES the place, 1 when it only locates it — 039 §4.
           case when m.named then 0 else 1 end as mrank,
           case when m.named then extensions.similarity(t.term, c.name) else 0 end as score,
           c.dist2
    from t cross join local_candidates c
    cross join lateral (
      select (c.name || ' ' || coalesce(c.brand, '')) ilike all (t.pats) as named
    ) m
    order by mrank, score desc, dist2 asc, c.id
    limit 5
  ),
  -- ** THE CAP, national pass — ARBITRARY 2,000, and deliberately so. ** There is
  -- no useful pre-scoring order: `named` needs the lateral and `score` needs
  -- `named`, so ordering before the cap would spend exactly what the cap saves.
  -- See §2 for where the resulting imprecision actually lands.
  national_candidates as (
    select p.id, p.name, p.brand, p.street, p.locality, p.lat, p.lon
    from t join public.places p
      on p.search_text ilike t.pat1
     and p.search_text ilike t.pat2
     and p.search_text ilike t.pat3
     and p.search_text ilike t.pat4
     and p.search_text ilike all (t.pats)
    where t.searchable
      -- Var-free, therefore a One-Time Filter: when the local pass fills, this
      -- scan is planned and `never executed`. 037 §5b, unchanged — and it must
      -- stay in the CANDIDATE cte rather than move below the cap, or a filled
      -- local pass would pay for 2,000 candidates it then discards.
      and (select count(*) from local_hits) < 5
      and not exists (select 1 from local_hits l where l.id = p.id)
    limit 2000
  ),
  national_hits as (
    select c.id, c.name, c.street, c.locality, c.lat, c.lon,
           case when m.named then 0 else 1 end as mrank,
           case when m.named then extensions.similarity(t.term, c.name) else 0 end as score,
           case when t.la is null or t.lo is null then null
                else ((c.lon - t.lo) * t.km_per_lon) ^ 2 + ((c.lat - t.la) * 110.57) ^ 2
           end as dist2
    from t cross join national_candidates c
    cross join lateral (
      select (c.name || ' ' || coalesce(c.brand, '')) ilike all (t.pats) as named
    ) m
    order by mrank, score desc, dist2 asc nulls last, c.id
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
  order by r.tier, r.mrank, r.score desc, r.dist2 asc nulls last, r.id
  limit 5;
$fn$;

comment on function public.search_places(text, double precision, double precision) is
  'Meeting-point typeahead over public.places (037, widened by 039, bounded by 049 and 050). SECURITY INVOKER — the places SELECT policy governs it, there is nothing to re-check. Returns at most 5 rows: the design draws five. MATCHES name, brand, street and locality, PER TOKEN and ANDed: the term is split on whitespace and every token must appear somewhere in the row''s searchable text, so `Jumbo Maastricht` finds a Jumbo whose locality is Maastricht and adding a word always narrows. RANKS a place the query NAMES (every token in name or brand) above a place the query merely LOCATES; name matches are then ordered by trigram similarity and address-only matches by distance. Proximity still outranks both: matches within roughly 28 km fill the list first and the rest of the country fills only what is left — the escape hatch is to type the town. TWO REFUSALS, both returning ZERO ROWS rather than an error, so gate the input and do not render an empty state for either: the query must hold three consecutive alphanumerics, and it must carry at most EIGHT distinct tokens after case-insensitive deduplication (049). It matches PLACE_SEARCH_MAX_TOKENS in src/lib/data/places.ts, whose boundTerm() sends at most eight tokens joined by single spaces — ALWAYS, never the rider''s raw string. TWO CANDIDATE CAPS (050): each pass scores at most 2,000 candidate rows, which is what makes cost independent of how many rows a term matches. The LOCAL pass orders by distance BEFORE its cap, so it keeps its contract exactly — the nearest matching places, in order, with nothing lost. The NATIONAL pass has no useful pre-scoring order, so its 2,000 are ARBITRARY: a query matching more than 2,000 rows nationally with no location returns five plausible rows rather than the five best. That imprecision is confined to queries whose answers were already meaningless — a term matching 211,407 rows has no five best — and narrow queries are untouched. MEASURED ON REAL DATA 2026-08-11, 736,538 rows, as postgres with no timeout: `straat` was 11,458 ms before this file and matches 28.7% of the table; with a location it was 4,011 ms. Both are now bounded by the caps. DO NOT reuse the timings in 039 or in this comment''s earlier revisions: they came from a synthetic bench that was well calibrated on size and 4x to 130x optimistic on time. DEBOUNCE IT anyway — PD-114''s picker fires per keystroke and every intermediate prefix of a street name lands here. Supplying near_lat/near_lon still helps: it selects the local pass, whose cap preserves ordering. A function-level statement_timeout cannot bound any of this (measured: the timer is armed before the function is entered, so the SET is applied but inert).';

-- Idempotent, and it means this file states its own privilege model instead of
-- referring to one. `create or replace` preserved 037's, 039's and 049's ACL;
-- this re-issues it unchanged. 005's rule.
revoke all on function public.search_places(text, double precision, double precision)
  from public, anon;
grant execute on function public.search_places(text, double precision, double precision)
  to authenticated;

-- No table grant, policy, column or index changes. This file replaces one
-- function body and nothing else.

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying, not just in CI
-- ---------------------------------------------------------------------------
--   -- both caps are present, and 049's token cap survived the replace
--   select prosrc like '%limit 2000%'                                    as has_cap,
--          prosrc like '%coalesce(array_length(tk.pats, 1), 0) <= 8%'    as has_049,
--          prosrc like '%order by dist2%'                                as local_orders_first
--     from pg_proc
--    where oid = 'public.search_places(text,double precision,double precision)'::regprocedure;
--
--   -- false, and {search_path=""} — still invoker, still pinned, and NO
--   -- statement_timeout crept in (039 §5d: it would read as a bound while
--   -- bounding nothing)
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.search_places(text,double precision,double precision)'::regprocedure;
--
--   -- true, then false — riders may call it, anon may not. Unchanged by this file.
--   select has_function_privilege('authenticated',
--            'public.search_places(text,double precision,double precision)', 'execute'),
--          has_function_privilege('anon',
--            'public.search_places(text,double precision,double precision)', 'execute');
--
--   -- The cost claim this file exists for. On a LOADED database only — on an
--   -- empty one every one of these is 0 ms and proves nothing.
--   explain (analyze, timing off) select * from public.search_places('straat');
--   explain (analyze, timing off) select * from public.search_places('straat', 52.3784, 4.9031);
--
--   -- 049's refusals still refuse, and still without an error
--   select count(*) from public.search_places('a1 b2 c3 d4 e5 f6 g7 abc');       -- runs
--   select count(*) from public.search_places('a1 b2 c3 d4 e5 f6 g7 h8 abc');    -- 0
--
-- And the advisors: `get_advisors(security)` must still return the documented
-- nine. A tenth would mean search_places was replaced `security definer`.
