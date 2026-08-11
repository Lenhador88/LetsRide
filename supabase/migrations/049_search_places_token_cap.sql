-- 049: bound the ONE multiplier a caller controls in search_places().
--
-- Linear PD-150, option A. This extends 039 — read
-- supabase/migrations/039_places_address_search.sql §5d first, which is where
-- this cost was measured, named, and deliberately left OPEN. Everything 037 and
-- 039 establish survives here unchanged; the only behavioural line that moves is
-- `searchable`, and this file says exactly what it now means.
--
-- ---------------------------------------------------------------------------
-- The vector, restated only as far as it takes to justify the predicate
-- ---------------------------------------------------------------------------
-- Per-candidate work in both passes is linear in the number of DISTINCT
-- patterns: `search_text ilike all (t.pats)` and the `named` test each run once
-- per pattern per candidate row. 039 closed the two multipliers a dedup can
-- reach (repeated tokens, and the same token in fourteen casings). It cannot
-- reach the third, because nothing is duplicated:
--
--     str tra raa aat stra traa raat straa traat straat
--
-- Ten genuinely distinct tokens, every one a substring of the same word, so they
-- AND to the same ~391,586 rows while multiplying the per-row work tenfold.
-- Measured at 5,914 ms on 039's synthetic bench.
--
-- ---------------------------------------------------------------------------
-- §1. The rule: refuse above EIGHT distinct tokens
-- ---------------------------------------------------------------------------
-- ** The number is not chosen here — it is already the app's, and matching it is
-- the point rather than a coincidence. ** `PLACE_SEARCH_MAX_TOKENS` in
-- src/lib/data/places.ts is 8, and that file TRUNCATES a longer term to the
-- first eight distinct tokens before it calls this function. Its own comment
-- says why 8: "covers any real meeting-point query with room to spare (`Jumbo
-- Maastricht Stationsweg 40` is four)".
--
-- ** The two rules compose because the client NORMALISES its output, not
-- because it predicts this function's input. That distinction is the whole
-- argument, and the predicting version of it was wrong twice over. **
--
-- `boundTerm` sends at most eight tokens joined by single U+0020, always —
-- never the rider's raw string. So the split below is the split the client
-- already performed, and `group by lower(s.tok)` can then only ever REDUCE the
-- count from eight. Nothing here depends on the two runtimes agreeing about
-- Unicode.
--
-- ** They do not agree, and both disagreements were measured against DEV rather
-- than reasoned about — an earlier revision of this section asserted the
-- opposite and review disproved it: **
--
--   * THE SPLIT. `U+001C`-`U+001F` and `U+0085` separate tokens for Postgres's
--     `\s` and not for JavaScript's. A term the client counted as 8 arrived
--     here as 9.
--   * THE FOLD. `lower()` is ICU's, not V8's. 55 code points fold in V8 and not
--     in this server's ICU — `U+1C89`, seven more in the BMP, 47 across Garay
--     and Medefaidrin — so a client-deduped 8 was 9 distinct here. ** That set
--     is a function of the server's ICU version and regrows with every Unicode
--     release **, so it can never be enumerated once and pinned.
--
-- Both failures were silent and fail-closed: zero rows, which a caller cannot
-- distinguish from an honest miss. That is why the guarantee had to become a
-- property of what the client SENDS.
--
-- ** State it as the property, never as "a term from the app can never be
-- refused". ** The correct claim is: the client sends at most eight
-- space-separated tokens, so this function's count cannot exceed its own cap.
-- `src/lib/data/__tests__/places.test.ts` asserts that property on `boundTerm`'s
-- output — including both measured vectors — which is an assertion that survives
-- a server ICU upgrade. A test comparing the two NUMBERS does not.
--
-- ** Picking a SMALLER cap here was considered and rejected, so it is not
-- re-litigated. ** 6 would bound the worst term ~690 ms tighter (§3's
-- extrapolation) and would refuse `Albert Heijn XL Hoog Catharijne Utrecht`,
-- which is six tokens before a street is typed — and it would also put the
-- database's refusal BELOW the client's truncation, manufacturing exactly the
-- dead zone the paragraph above exists to rule out. A tighter cap is only
-- correct as a coordinated change to both numbers, and it buys little.
--
-- ---------------------------------------------------------------------------
-- §2. It REFUSES; it does not truncate. Deliberate, and the opposite of the
--     client's choice for a reason.
-- ---------------------------------------------------------------------------
-- Zero rows, by the same mechanism as 037 §5a's three-alphanumeric guard: this
-- is a `searchable` conjunct, so both passes return nothing and the function
-- raises no error. That is the idiom this function already has, and callers
-- already have to honour it — `PlaceSearchResult`'s doc block in
-- src/types/index.ts states it as "returns zero rows by refusal, not by no
-- matches. Gate the input; do not render an empty state."
--
-- ** Truncating server-side would be wrong here even though the client does
-- exactly that. ** Dropping a token WIDENS the result set (tokens are ANDed, so
-- removing one removes a constraint), and a silent widening inside a
-- `security invoker` function is a result the caller cannot tell from an honest
-- one. The client may truncate because the rider can see their own query and the
-- five rows it produced; the database cannot, so it fails closed. This is the
-- same argument 039 §5 makes against a per-token length floor: `Kerkstraat 40`
-- must not silently become `Kerkstraat`.
--
-- ---------------------------------------------------------------------------
-- §3. What this does NOT bound — stated because a partial fix that reads as a
--     complete one is worse than the open cost it replaces
-- ---------------------------------------------------------------------------
-- ** The floor is untouched. ** A single broad token — `straat`, matching 52% of
-- the table — measured 2,809 ms on 039's bench and still does. This file bounds
-- the caller's MULTIPLIER, not the data's cost. PD-150's option B (cap candidate
-- rows before scoring) is what lowers the floor, and it stays open.
--
-- ** The numbers below are EXTRAPOLATED, not measured, and must not be quoted as
-- measurements. ** `places` holds 0 rows on both projects, so nothing here can be
-- run against real data; the two endpoints are 039 §5d's, on a 750k-row
-- synthetic bench, and the middle is linear interpolation between them:
--
--     patterns   national pass    how it is known
--     1          2,809 ms         MEASURED (039 §5d, the floor)
--     8          ~5,200 ms        EXTRAPOLATED at ~345 ms/pattern — THE NEW CAP
--     10         5,914 ms         MEASURED (039 §5d, today's worst 49-char term)
--     ~20        ~9,400 ms        EXTRAPOLATED — see below
--
-- ** The gain is not the 700 ms between 10 patterns and 8. ** It is that 10 was
-- never the ceiling: the 100-character cap bounds the TERM, and ~20 distinct
-- co-extensive substrings fit inside 100 characters comfortably. That
-- extrapolates past `authenticated`'s 8 s statement timeout, which is a
-- different failure — a caller who can choose the cost can choose to exceed the
-- timeout, and a rider's own searches start competing with it. After this file
-- the pattern count is a constant the caller cannot move.
--
-- ** Re-measure all four rows after the first real load ** (PD-195), and replace
-- the extrapolations with measurements rather than adding a second set beside
-- them.
--
-- ---------------------------------------------------------------------------
-- Personal data: nothing new. 037 answered both of `.claude/agents/data.md`
-- §Personal data's questions — a place is a shop, not a person — and this file
-- adds no column, no table and no subject. It narrows one function's input
-- domain and touches nothing else.
--
-- ---------------------------------------------------------------------------
-- §4. The function
-- ---------------------------------------------------------------------------
-- ** Byte-identical to 039 except for the `searchable` line. ** The signature,
-- the argument names, the output column names, `security invoker`,
-- `search_path = ''`, `stable`, `parallel safe`, both passes, the one-conjunct
-- local pass and the four-conjunct national one, the `mrank` ranking and all
-- three ORDER BYs are unchanged and are still 037's and 039's for their reasons.
-- The structural needles in supabase/tests/rls_test.sql §039 read this body and
-- must all stay green; if one goes red, the body was edited beyond this file's
-- stated scope.
--
-- `create or replace` keeps the oid, so the EXECUTE grants survive. They are
-- re-issued at the bottom anyway — 005's rule, and 039's precedent: a file that
-- replaces a function states its own privilege model rather than pointing at
-- one.
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
      -- Per-candidate work is linear in the pattern count, and nothing dedups
      -- ten distinct substrings of one word because nothing is duplicated
      -- (039 §5d). This is the only thing that bounds that multiplier. It counts
      -- `tk.pats` — the array AFTER `group by lower(s.tok)` — so a repeated word
      -- costs one slot rather than spending the budget on itself, which is the
      -- same count src/lib/data/places.ts truncates to. `coalesce` because
      -- `array_agg` over no tokens is NULL, and a NULL here must not be the
      -- thing that decides `searchable` if the first conjunct is ever loosened.
      raw.term ~ '[[:alnum:]]{3}'
        and coalesce(array_length(tk.pats, 1), 0) <= 8 as searchable,
      tk.pats,
      -- Slots 2-4 pad to '%' — a no-op the index ignores, 039 §5b. Slot 1 does
      -- not, as defence in depth rather than as the barrier: the guard and the
      -- NULL array already make a token-less term unreachable here. Verified by
      -- mutation to be unobservable — see §5b before assuming otherwise.
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
    -- indexable tokens first so the four join slots go to tokens the GIN index
    -- can use. The same three replaces 037 applied to the whole term, applied
    -- per token.
    --
    -- `group by lower(s.tok)` is the deduplication, and it is a COST fix rather
    -- than a correctness one — AND is idempotent, so requiring a token twice is
    -- requiring it once, and no result can change. It is here because a rider
    -- controls the multiplier otherwise: see 039 §5d.
    --
    -- ** `lower()` and not the bare token, because the match is ILIKE. ** A
    -- byte-equality group leaves fourteen capitalisations of one word as
    -- fourteen keys and one predicate, so the dedup never fires on the vector
    -- most likely to be deliberate. Lowering is exactly equivalent here rather
    -- than approximately so: Postgres implements `x ILIKE p` as `lower(x) LIKE
    -- lower(p)` under the same collation, so two tokens with equal `lower()`
    -- are the same predicate by construction. `\`, `%` and `_` have no case, so
    -- lowering commutes with the escaping below.
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
  -- Squared distance throughout: monotonic in distance, so the ordering is
  -- identical and there is no sqrt per candidate row.
  local_hits as (
    select p.id, p.name, p.street, p.locality, p.lat, p.lon,
           -- 0 when the query NAMES the place, 1 when it only locates it — 039 §4.
           case when m.named then 0 else 1 end as mrank,
           case when m.named then extensions.similarity(t.term, p.name) else 0 end as score,
           ((p.lon - t.lo) * t.km_per_lon) ^ 2 + ((p.lat - t.la) * 110.57) ^ 2 as dist2
    from t join public.places p
      on p.lat between t.la - 0.25 and t.la + 0.25
     and p.lon between t.lo - 0.40 and t.lo + 0.40
     -- ONE indexed token here, four in the national pass. Not an oversight:
     -- a second conjunct costs the planner the bbox index — 039 §5b.
     and p.search_text ilike t.pat1
     and p.search_text ilike all (t.pats)
    cross join lateral (
      select (p.name || ' ' || coalesce(p.brand, '')) ilike all (t.pats) as named
    ) m
    where t.searchable and t.la is not null and t.lo is not null
    order by mrank, score desc, dist2 asc, p.id
    limit 5
  ),
  national_hits as (
    select p.id, p.name, p.street, p.locality, p.lat, p.lon,
           case when m.named then 0 else 1 end as mrank,
           case when m.named then extensions.similarity(t.term, p.name) else 0 end as score,
           case when t.la is null or t.lo is null then null
                else ((p.lon - t.lo) * t.km_per_lon) ^ 2 + ((p.lat - t.la) * 110.57) ^ 2
           end as dist2
    from t join public.places p
      on p.search_text ilike t.pat1
     and p.search_text ilike t.pat2
     and p.search_text ilike t.pat3
     and p.search_text ilike t.pat4
     and p.search_text ilike all (t.pats)
    cross join lateral (
      select (p.name || ' ' || coalesce(p.brand, '')) ilike all (t.pats) as named
    ) m
    where t.searchable
      -- Var-free, therefore a One-Time Filter: when the local pass fills, this
      -- scan is planned and `never executed`. 037 §5b, unchanged.
      and (select count(*) from local_hits) < 5
      and not exists (select 1 from local_hits l where l.id = p.id)
    order by mrank, score desc, dist2 asc nulls last, p.id
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
  'Meeting-point typeahead over public.places (037, widened by 039, bounded by 049). SECURITY INVOKER — the places SELECT policy governs it, there is nothing to re-check. Returns at most 5 rows: the design draws five. MATCHES name, brand, street and locality, PER TOKEN and ANDed: the term is split on whitespace and every token must appear somewhere in the row''s searchable text, so `Jumbo Maastricht` finds a Jumbo whose locality is Maastricht and adding a word always narrows. RANKS a place the query NAMES (every token in name or brand) above a place the query merely LOCATES; name matches are then ordered by trigram similarity and address-only matches by distance, so a bare city name does not bury the place actually called that. Proximity still outranks both: matches within roughly 28 km fill the list first and the rest of the country fills only what is left, so a distant branch of a nearby chain is unreachable while a location is supplied (037 §5b) — the escape hatch is to type the town, which is what 039 makes possible. TWO REFUSALS, both returning ZERO ROWS rather than an error, so gate the input and do not render an empty state for either: the query must hold three consecutive alphanumerics (per-token by construction, since such a run cannot span whitespace), and it must carry at most EIGHT distinct tokens after case-insensitive deduplication (049). The token cap is the ONLY bound on the multiplier a caller controls — per-candidate work is linear in distinct patterns, and ten distinct co-extensive substrings of one word AND to the same rows while multiplying the per-row work tenfold, which no deduplication can reach because nothing is duplicated (039 §5d). It matches PLACE_SEARCH_MAX_TOKENS in src/lib/data/places.ts, whose boundTerm() sends at most eight tokens joined by single spaces — ALWAYS, never the rider''s raw string — so this function''s count cannot exceed its own cap. State it that way round rather than as "a term from the app can never be refused": the version of that claim which predicted how Postgres would tokenise the raw term was disproved twice, once on the whitespace class (U+001C-U+001F and U+0085 split here and not in JavaScript) and once on the case fold (lower() is ICU''s, and 55 code points fold in V8 and not in ICU, a set that regrows with every Unicode release). A short token ANDed with a long one is free and is honoured, so `Kerkstraat 40` is not silently `Kerkstraat`. Non-finite or out-of-range coordinates degrade to a nationwide search instead of raising. DEBOUNCE IT — REQUIRED, not advisable: cost is roughly linear in matched rows (8-11 µs each) and the broadest tokens are Dutch street-type suffixes, not city names. On a 750k-row SYNTHETIC bench (039 §5c; this table is empty, so nothing is measured on real data) the national pass took 2,957 ms for `straat`, which matches 52% of rows, and 996 ms for `sta` — three characters, so it is the FIRST query fired the moment the guard stops refusing, for anyone typing "Stationsweg". A city name is 497 ms. Supplying a location keeps every one of those to 29-152 ms because the bbox applies, so pass `near_lat`/`near_lon` whenever you have them and fire on a pause rather than a keystroke. THE FLOOR IS NOT BOUNDED and 049 does not change it: one broad token still costs ~2,809 ms, because that is the data''s cost rather than the caller''s choice — capping candidate rows before scoring is what would bound it, and it is still open (PD-150 option B). A function-level statement_timeout cannot bound any of this (measured: the timer is armed before the function is entered, so the SET is applied but inert).';

-- Idempotent, and it means this file states its own privilege model instead of
-- referring to one. `create or replace` preserved 037's and 039's ACL; this
-- re-issues it unchanged. 005's rule.
revoke all on function public.search_places(text, double precision, double precision)
  from public, anon;
grant execute on function public.search_places(text, double precision, double precision)
  to authenticated;

-- No table grant, policy, column or index changes. This file replaces one
-- function body and nothing else.

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying, not just in CI
-- ---------------------------------------------------------------------------
--   -- the cap is present, and it counts the DEDUPED array rather than raw tokens
--   select prosrc like '%coalesce(array_length(tk.pats, 1), 0) <= 8%' from pg_proc
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
--   -- 8 distinct tokens: allowed. 9: refused, with NO error either way.
--   select count(*) from public.search_places('a1 b2 c3 d4 e5 f6 g7 abc');       -- runs
--   select count(*) from public.search_places('a1 b2 c3 d4 e5 f6 g7 h8 abc');    -- 0
--
--   -- ... and the dedup is applied FIRST, so nine tokens that are eight distinct
--   -- ones still run rather than being refused for a repeat
--   select count(*) from public.search_places('a1 A1 b2 c3 d4 e5 f6 g7 abc');    -- runs
--
-- And the advisors: `get_advisors(security)` must still return the documented
-- nine. A tenth would mean search_places was replaced `security definer`.
