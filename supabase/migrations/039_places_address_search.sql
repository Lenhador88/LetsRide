-- 039: make `street` and `locality` searchable in search_places().
--
-- Linear PD-141, decided by the product owner 2026-08-08. This extends 037 —
-- read supabase/migrations/037_places_index.sql first, especially §5a (the
-- guard), §5b (the two passes) and §5c (the id tiebreak). Everything those
-- three sections establish survives here unchanged; this file says exactly what
-- moved and why.
--
-- ---------------------------------------------------------------------------
-- The two symptoms this fixes
-- ---------------------------------------------------------------------------
--   1. `Kerkstraat` returned nothing. 037 filtered on `name` and `brand` only,
--      so a street name matched no row even though thousands sit on one.
--   2. A rider in Utrecht could not reach the Maastricht Jumbo. The ~28 km
--      local pass filled all five slots with Utrecht Jumbos and short-circuited
--      the national pass (037 §5b, a KNOWN LIMITATION it states explicitly),
--      and `Jumbo Maastricht` did not rescue it because locality was not
--      matched.
--
-- ** The second is fixed BY the first, without touching the two-pass design. **
-- Once tokens are ANDed (below), `Jumbo Maastricht` matches nothing inside the
-- Utrecht box, the local pass returns zero, the `count(*) < 5` short-circuit
-- lets the national pass run, and it finds Maastricht. The bbox, the cap and
-- the short-circuit are all byte-for-byte what 037 shipped.
--
-- ---------------------------------------------------------------------------
-- SCOPE: POI rows only. Overture's addresses theme is NOT imported.
-- ---------------------------------------------------------------------------
-- Deferred deliberately, with a measurement behind it: the addresses theme for
-- NL is **17.8M candidate rows and 1.5 GB**, against 736k places at 99 MB. That
-- is its own epic — a second extractor, a second table, a second refresh job
-- and a rethink of the ranking. What lands here is the address text the POI
-- rows *already carry*: `street` and `locality`, which the 2026-07-22.0 extract
-- populates on ~95% and ~99% of rows respectively.
--
-- So `Kerkstraat 12` finds a shop at Kerkstraat 12. It does not find the
-- residential address Kerkstraat 12, because no such row exists.
--
-- ---------------------------------------------------------------------------
-- Personal data: unchanged, and still nothing to do
-- ---------------------------------------------------------------------------
-- `.claude/agents/data.md` §Personal data asks two questions at creation time.
-- 037 answered both — a place is a shop, not a person — and 039 introduces no
-- new subject: `search_text` is derived from four columns that were already
-- there, and `postcode` is deliberately NOT in it (see §2). Retention: still
-- not applicable, the index is replaced wholesale on refresh. Reach of account
-- deletion: still nothing to reach, `private.delete_account` needs no new arm.
-- No `updated_at` and no client-generated id, for 037's reason — there is no
-- INSERT grant and no INSERT policy, so a client can create nothing here.

-- ---------------------------------------------------------------------------
-- §1. What "matching" now means: PER TOKEN, ANDed — not one substring
-- ---------------------------------------------------------------------------
-- This is the part that is easy to get wrong, and the obvious version is wrong.
--
-- ** A single `ILIKE '%Jumbo Maastricht%'` against a concatenated search text
-- does NOT match a row named `Jumbo` in `Maastricht`, ** because the
-- concatenation puts the street between the two: the text is
-- `Jumbo  Wycker Brugstraat 7 Maastricht`, and the query string does not occur
-- in it. Concatenating and then substring-matching looks like it widens the
-- search and actually just moves the failure.
--
-- So the term is split on whitespace and **every token must be contained in the
-- searchable text**. `Jumbo Maastricht` becomes `%Jumbo%` AND `%Maastricht%`,
-- which the row above satisfies.
--
-- Two consequences worth stating because they are behaviour changes, not
-- implementation details:
--
--   * Adding a word NARROWS. `Jumbo` returns Jumbos; `Jumbo Maastricht`
--     returns fewer, never more. That is what makes symptom 2 above resolve.
--   * Token ORDER does not matter. `Maastricht Jumbo` returns the same rows.
--     Ranking can differ only through `similarity()`, which reads the term as
--     one string.
--
-- ---------------------------------------------------------------------------
-- §2. public.places.search_text — a stored generated column
-- ---------------------------------------------------------------------------
-- The four searchable columns, space-joined, so one trigram index can serve a
-- token wherever it occurs.
--
-- ** `concat_ws` cannot be used here and that is not a style choice. **
-- `concat_ws` is STABLE, not IMMUTABLE, so Postgres refuses it in a generated
-- column and in an expression index. `||` (textcat) and `coalesce` are both
-- immutable, hence the longer form. 037's function body uses `concat_ws` for
-- the returned `meta` string, where stability is fine; do not copy that form up
-- here.
--
-- ** The separator is load-bearing. ** Without it, a place named `Jumb` on
-- `oostlaan` would concatenate to `Jumboostlaan` and match `Jumbo`. A space
-- between every field means a token can never bridge two of them.
--
-- ** `postcode` is deliberately excluded. ** A Dutch postcode is `1234 AB` —
-- two tokens, the first four digits. Including it would make every numeric
-- token a postcode lookup and, worse, `%12%` would match a quarter of the
-- country through house numbers that are already inside `street`. Postcode
-- search is a separate feature with a separate (exact-match) shape.
--
-- ** COST — from a SYNTHETIC BENCH, not from this table. ** `places` holds 0
-- rows on DEV and does not exist on PROD, so nothing here has been measured
-- against the real extract. 750,000 generated rows on a local Postgres 16.13,
-- 2026-08-08, with a distribution built to resemble the measured extract:
-- brand on 8.3%, street on 95%, locality on 99%, 6,860 distinct names, one
-- locality carrying 5% of all rows. Mean `search_text` length 44 characters.
--
-- ** This is a DIFFERENT bench generation from 037 §3 ** — the ids are longer,
-- so the numbers are not comparable to that table row by row. Both columns
-- below come from this one bench, which is the only comparison that means
-- anything:
--
--                                 037 shape      039 shape
--     heap                          125 MB         161 MB
--     places_pkey                    49 MB          49 MB
--     places_name_trgm_idx           23 MB              —   (dropped, §3)
--     places_brand_trgm_idx         2.1 MB              —   (dropped, §3)
--     places_lat_lon_idx             23 MB          23 MB
--     places_search_text_trgm_idx        —          58 MB
--     TOTAL                         221 MB         290 MB
--
-- **+69 MB, not the ~+35 MB the change was scoped at.** The estimate covered
-- the heap (+36 MB) and missed that a trigram index over text 2.7x longer than
-- `name` is 58 MB rather than 23 MB. Re-measure after the first real load;
-- these are the right order of magnitude and nothing more.
--
-- The load also gets slower: the column is computed per row at INSERT time and
-- the GIN index is built over it. Unmeasured on real data.
alter table public.places
  add column search_text text
  generated always as (
    coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' ||
    coalesce(street, '') || ' ' || coalesce(locality, '')
  ) stored;

comment on column public.places.search_text is
  'Generated, stored: name, brand, street and locality space-joined — the single column search_places() matches tokens against (039). `postcode` is deliberately absent: a Dutch postcode is two tokens and its digits would collide with house numbers already inside `street`. Built with `||` and `coalesce` rather than `concat_ws`, which is STABLE and therefore illegal in a generated column. The space separator stops a token bridging two fields. Never write to it and never add it to the `\copy` column list — a generated column rejects both.';

comment on column public.places.street is
  'Overture''s street line, house number included. SEARCHABLE as of 039, through `search_text` — it was display-only under 037. Ranks BELOW a name match: see search_places() and 039 §4.';

comment on column public.places.locality is
  'The town or city. SEARCHABLE as of 039, through `search_text` — it was display-only under 037. This is what makes `Jumbo Maastricht` reach a Maastricht branch from Utrecht. Ranks BELOW a name match: see search_places() and 039 §4.';

-- ---------------------------------------------------------------------------
-- §3. Indexes — one trigram GIN, and TWO ARE DROPPED
-- ---------------------------------------------------------------------------
-- ** LOUD, per `.claude/agents/data.md`: this migration DROPS
-- `places_name_trgm_idx` and `places_brand_trgm_idx`. ** Not additive, and
-- deliberately so.
--
-- Safe here for three reasons that all have to hold, and will not hold again:
--   * `search_text` begins with `name` then `brand`, so every pattern those two
--     indexes could serve, the new one serves. Nothing loses an access path.
--   * `search_places()` is the only reader of this table and it no longer
--     issues a `name ilike` or a `brand ilike` at all. There is no
--     `src/lib/data/places.ts` — nothing in the app queries `places` directly.
--   * The table holds 0 rows on DEV and does not exist on PROD, so the drop
--     rewrites nothing and cannot interrupt a query in flight.
--
-- Keeping them would cost 25 MB of index that no plan can choose, rebuilt on
-- every monthly reload — the dead-column trap one level down, where it is
-- harder to notice because an unused index still looks like tuning.
create index places_search_text_trgm_idx
  on public.places using gin (search_text extensions.gin_trgm_ops);

drop index public.places_name_trgm_idx;
drop index public.places_brand_trgm_idx;

-- ---------------------------------------------------------------------------
-- §4. RANKING — `mrank`, and why widening needs it
-- ---------------------------------------------------------------------------
-- Widening the match set is the easy half. `Amsterdam` now matches every place
-- that merely SITS in Amsterdam — thousands of rows that have nothing to do
-- with the word except their address. Without a ranking rule the feature makes
-- search worse, not better.
--
-- ** The rule: a place the query NAMES outranks a place the query only LOCATES. **
--
--   mrank 0 — every token occurs in `name || ' ' || brand`. The query names it.
--   mrank 1 — otherwise. At least one token was found only in the address.
--
-- So `Vondel` puts a place *called* Vondel above a place *on* Vondelstraat, and
-- `Amsterdam` puts `Amsterdam Bierhuis` above the thousands merely located
-- there. `brand` sits in the top tier with `name` because a brand is what a
-- place IS, not where it is — which also preserves 037's brand behaviour whole.
--
-- ** `score` is now tier-conditional, and that is the second half of the rule. **
-- It is `similarity(term, name)` for an mrank-0 row and **0** for an mrank-1
-- row. Two reasons, and the first is about relevance rather than speed:
--
--   * For an address match, `similarity(term, name)` is noise. Searching
--     `Kerkstraat` scores `Bakkerij` above `Café Q` purely because `bakkerij`
--     and `kerkstraat` share the trigram `ker`. Ordering five results by that
--     is worse than ordering them by nothing. Pinning it to 0 hands the
--     ordering to `dist2` — nearest first — which is exactly what a
--     meeting-point picker wants from "places on a Kerkstraat".
--   * It also skips a `similarity()` call per candidate row on precisely the
--     broad queries this migration creates. Worth 15-20% on the bench; that is
--     the tiebreak, not the argument.
--
--   With NO location every `dist2` is NULL, so mrank-1 rows fall through to
--   `id`. That is arbitrary but STABLE, which is 037 §5c's whole point: there
--   is no meaningful order among "every place on a Kerkstraat in the country",
--   and a typeahead that reshuffles under the rider's finger is worse than one
--   that picks five and keeps them.
--
-- ** `mrank` sits AFTER `tier`, not before, and that is a choice. ** Proximity
-- stays the primary key: a nearby address match outranks a distant name match,
-- because the pooled order is `tier, mrank, score, dist2, id`. 037 §5b's
-- statement that "proximity is the primary key, not a tiebreak" is preserved
-- literally. The alternative — `mrank` first — would let a national name match
-- jump above a local address match, and that is a change to the two-pass design
-- rather than an addition to it. Not made here.
--
-- ** KNOWN LIMITATION, AMPLIFIED — 037 §5b's, made more likely by this file. **
-- The local pass short-circuits the national one whenever the box yields five.
-- Widening the match set means the box yields five far more often, so a distant
-- place is now unreachable in more cases than before: searching `Vondel` from
-- Utrecht can fill all five slots with Utrecht Vondelstraat businesses and
-- never reach Amsterdam's Vondelpark.
--
-- ** The widening also supplies its own escape hatch, which 037 did not have. **
-- Typing `Vondel Amsterdam` matches nothing near Utrecht, so the local pass
-- returns zero and the national pass runs. That is the same mechanism that
-- fixes symptom 2, and it is now the recommended answer for a rider looking
-- somewhere else — better than 037's "call it without a location", which is not
-- something a rider can express in a text field.
--
-- ---------------------------------------------------------------------------
-- §5. The guard: UNCHANGED, and the measurement that decided it
-- ---------------------------------------------------------------------------
-- 037 §5a's `term ~ '[[:alnum:]]{3}'` stays exactly as it is. Per-token
-- matching raises an obvious question — a token can now be shorter than three
-- characters, so does each token need its own floor? — and the answer is no, on
-- two grounds, one logical and one measured.
--
-- ** The logical half: the guard already IS a per-token guard. ** An
-- alphanumeric run of three cannot span whitespace, because whitespace is not
-- alphanumeric. So `term ~ '[[:alnum:]]{3}'` holds if and only if **some token**
-- contains such a run. A query of three short tokens — `ab 40 cd` — carries no
-- run anywhere and is refused by the line 037 already wrote. Nothing had to be
-- added for the case the question was worried about.
--
-- ** The measured half: a short token ANDed with an indexable one is free. **
-- On the bench (750k rows, and see §2 for why that is not this table):
--
--     search_text ilike '%40%'                          819 ms, sequential scan
--     search_text ilike '%Jumbo%' AND ilike '%40%'       12 ms, bitmap index scan
--
-- The first is the failure mode the guard exists for: `40` is two characters, no
-- trigram can be extracted, and the pattern degenerates to a full scan. The
-- second is the same short token in the shape this function actually produces —
-- and pg_trgm folds it into the GIN scan as an index recheck (`Index Cond` names
-- both patterns), so it costs nothing and cannot widen anything. AND only ever
-- narrows.
--
-- A per-token floor would therefore buy no safety and would cost real
-- behaviour: `Kerkstraat 40` would silently become `Kerkstraat`, quietly
-- returning the wrong house.
--
-- The 100-character cap, the LIKE metacharacter escaping and the NULL-ing of
-- non-finite coordinates are all unchanged. Escaping is now applied PER TOKEN,
-- which is the same three replaces in a different place.
--
-- ---------------------------------------------------------------------------
-- §5b. Why the two passes index DIFFERENT numbers of tokens
-- ---------------------------------------------------------------------------
-- The local pass puts ONE token in the join condition; the national pass puts
-- four. That asymmetry looks like an oversight and is the opposite — it was
-- measured, and getting it wrong cost 6x.
--
-- pg_trgm's GIN index ANDs several `ILIKE` conjuncts inside a single index scan,
-- which is excellent: `Jumbo` AND `Maastricht` returns 82 rows from the index
-- rather than 1,021 from `Jumbo` alone. So the national pass, whose only
-- selective thing is the text, lists all four.
--
-- ** But in the local pass each extra conjunct talks the planner out of the
-- bbox. ** The patterns are runtime values from a CTE, so the planner cannot
-- estimate their selectivity; it assumes each conjunct is selective, multiplies,
-- concludes the trigram bitmap alone will return almost nothing, and drops
-- `places_lat_lon_idx` from the plan. Measured on the bench, local pass,
-- `Maastricht` (45,029 matching rows) at the Utrecht probe:
--
--     1 conjunct    BitmapAnd(trgm, lat_lon), bbox as an INDEX COND     53 ms
--     2 conjuncts   trgm only, bbox demoted to a filter                274 ms
--     3 conjuncts   ... same                                           312 ms
--     4 conjuncts   ... same                                           343 ms
--
-- One conjunct, and the bbox does the work it exists to do. The remaining
-- tokens are still enforced — by `ilike all (pats)`, which is correct and
-- unindexable, applied to the ~1,600 rows the BitmapAnd already narrowed to.
--
-- ** `ilike all (array)` never uses the index — verified, not assumed. ** On its
-- own it is a parallel sequential scan (300 ms). That is why it appears only
-- alongside an explicit conjunct, in both passes, and why the national pass
-- spells out four patterns instead of relying on the array.
--
-- The `'%'` padding in slots 2-4 is a no-op sentinel for a query with fewer than
-- four tokens: it extracts no trigram, so GIN ignores it, and it is true for
-- every row. Measured at no cost (9.3 ms against 9.9 ms).
--
-- ** Slot 1 is left un-padded, and that is defence in depth rather than the
-- barrier — stated carefully because the obvious reading is wrong. ** It looks
-- like the line that stops a token-less term matching every row, and it is not:
-- such a term cannot reach the join at all, because `searchable` is false for it
-- AND `ilike all (NULL)` is NULL besides. MEASURED by mutation — padding slot 1
-- to '%' as well changes no observable behaviour, on any query the suite makes.
-- Kept because it costs nothing and it is the right shape if the guard is ever
-- loosened; do not write an assertion claiming it is load-bearing, because such
-- an assertion passes either way.
--
-- Tokens are ordered indexable-first (`(tok ~ '[[:alnum:]]{3}') desc, ord`), so
-- the four slots are filled with tokens the index can actually use before any
-- short one gets a place. Within that group the order is irrelevant: GIN ANDs
-- them all in one scan.
--
-- ---------------------------------------------------------------------------
-- §5c. What this costs — measured, and it is worse than a city name
-- ---------------------------------------------------------------------------
-- ** An earlier revision of this section put the worst case at 541 ms, from a
-- bare CITY NAME. That was understated by more than 5x, because a city name is
-- nowhere near the broadest token in Dutch address text. ** Review caught it and
-- the figures below are a re-measurement on the same synthetic bench (750k rows,
-- PG 16.13, best of five warm runs; §2 says why that is not this table).
--
-- The broadest tokens are the STREET-TYPE SUFFIXES, and one of them is three
-- characters — which makes it the **first** query a typeahead fires, the instant
-- the guard passes, for anyone typing "Stationsweg":
--
--     term                    rows matched    local      national
--     'Kerkstraat'                  17,876    37 ms        171 ms
--     'Cafe'                        34,641    29 ms        427 ms
--     'Maastricht'                  45,029    51 ms        497 ms
--     'weg'                         89,200    44 ms        740 ms
--     'sta'                        101,524    54 ms        996 ms
--     'straat'                     391,586   152 ms      2,957 ms
--     guard-refused                      —     5 ms            —
--
-- and the deliberately-hostile end of the same scale, which §5d owns:
--
--     'straat' x14, 14 casings     391,586        —      2,806 ms  (closed)
--     10 substrings of one word    391,586        —      5,914 ms  (OPEN)
--
-- Cost is close to linear in matched rows — 8-11 µs each — so the ranking is not
-- doing anything pathological; there are simply far more rows. `straat` matches
-- **52% of the table**, where the biggest city matches 6%.
--
-- ** This is a COST CLASS 037 did not have, and 039 creates it. ** Under 037
-- those tokens were matched against `name` and `brand` only, where `straat`
-- appears in a handful of business names; now they are matched against every
-- row's street line, where it appears in half of them. The fix is not free
-- performance — it is a deliberate trade, and this is its price.
--
-- `Cafe` is the only honest like-for-like line: the same 34,641 rows match under
-- both functions, and 039 costs **1.7x** (251 ms against 427 ms) — a longer
-- trigram scan plus the `named` test per candidate. Every other row where 037
-- looked fast is 037 matching far fewer rows, which is the defect being fixed
-- rather than a regression.
--
-- ** Two things keep this tolerable, and one of them is the client's job. **
--
--   * **The bbox.** Every term above is 29-152 ms with a location supplied, and
--     that is the path the app takes — `navigator.geolocation` then the RPC. The
--     national pass only runs when the box yields fewer than five.
--   * **Debouncing, which is now REQUIRED rather than advisable.** A three-
--     character token can cost a second of database CPU, and three characters is
--     exactly where the guard stops refusing. Fire on a pause, not a keystroke.
--
-- Nothing here exceeds `authenticated`'s 8 s statement timeout, so no rider sees
-- an error. That is the reassurance and also the hazard: the failure mode is a
-- slow screen and a large bill, not a red mark anyone will notice.
--
-- ---------------------------------------------------------------------------
-- §5d. Term-length abuse: ONE multiplier closed, ONE LEFT OPEN
-- ---------------------------------------------------------------------------
-- ** Read this section as a partial mitigation. An earlier revision titled it
-- "the one multiplier a caller controls" and claimed the remaining floor was
-- 2,784 ms; both were wrong, and the second was wrong by 2x. ** There are two
-- independent multipliers, the dedup closes one, and the one it does not close
-- is the larger. Named here rather than implied away.
--
-- The 100-character cap bounds the TERM, not the WORK. Per-candidate cost is
-- linear in the number of distinct patterns — `ilike all (pats)` and the
-- `named` test both run once per pattern per candidate row — so a caller who
-- can raise the pattern count while holding the candidate count at 391,586
-- multiplies the whole query.
--
-- ** Multiplier 1 — repeated tokens. CLOSED. ** Repeating a token narrows
-- nothing, because AND is idempotent, so `group by lower(s.tok)` collapses it
-- with no result change. Measured nationally on the bench:
--
--                                          byte-equality      lower()
--     'straat' x14, one casing                2,899 ms       2,838 ms
--     'straat' x14, FOURTEEN CASINGS          7,149 ms       2,806 ms
--     'straat' alone (the floor)              2,813 ms       2,809 ms
--
-- ** The middle row is why the group-by key is `lower()` and not the raw
-- token. ** `ILIKE` is case-insensitive, so fourteen capitalisations are one
-- predicate — but fourteen distinct group-by keys under byte equality, which
-- meant the dedup never fired on the vector most likely to be deliberate. It
-- was shipped that way for one revision and review caught it.
--
-- ** Multiplier 2 — distinct co-extensive substrings. NOT CLOSED. ** `str tra
-- raa aat stra traa raat straa traat straat` is ten genuinely distinct tokens,
-- every one of them a substring of the same word, so they AND to the same
-- 391,586 rows while multiplying the per-row work by ten. No deduplication of
-- any kind reaches this, because nothing is duplicated. Measured:
--
--     10 substrings, 49 chars      5,835 ms  ->  5,914 ms   (dedup does nothing)
--     mixed case + substrings      6,539 ms  ->  4,720 ms   (only the case half)
--
-- **So the worst measured vector after this migration is ~5.9 s from 49
-- characters — half the cap — and the honest floor is not 2.8 s.** Under
-- `authenticated`'s 8 s statement timeout it completes, so it is CPU burn
-- rather than an error: on a free-tier project, several seconds of database
-- CPU per request from any signed-in account.
--
-- ** A function-level `statement_timeout` does NOT bound this, and that is
-- measured rather than assumed — do not reach for it. ** `alter function ...
-- set statement_timeout` is applied but inert: the timeout timer is armed once
-- when the top-level statement starts, before the function is entered, and
-- Postgres never re-arms it when the GUC changes mid-statement. Proven on
-- PG 16.13 four ways — a session-level 300 ms DOES cancel a 2 s function (so
-- the mechanism works), the same 300 ms as a function-level SET does not, in
-- both `sql` and `plpgsql`, and `current_setting('statement_timeout')` reads
-- `300ms` *inside* the function while it runs. **It is worse than a no-op: an
-- assertion on `proconfig` would pass, so it would read as a bound while
-- bounding nothing** — the "guard that has quietly stopped matching" shape this
-- repo already warns about.
--
-- What actually bounds multiplier 2 is a cap — on distinct tokens, or on
-- candidate rows — and both change behaviour, so neither is applied here
-- unilaterally. **Recorded as an open cost, not as covered.**
--
-- The dedup itself changes no result, and that is provable rather than hopeful:
-- `x AND x` is `x`, and `x ILIKE p` is `lower(x) LIKE lower(p)` under one
-- collation, so equal-`lower()` tokens are the same predicate by construction.
-- Verified anyway — 25 term shapes across both passes, zero differences, and
-- zero rows where `ILIKE` and the lowered `LIKE` disagree across 3.75M
-- row-pattern combinations. Asserted in supabase/tests/rls_test.sql §039 so a
-- later "simplification" back to byte equality fails rather than silently
-- restoring the case multiplier.
--
-- ---------------------------------------------------------------------------
-- §6. The function
-- ---------------------------------------------------------------------------
-- `security invoker`, `search_path = ''`, `stable`, `parallel safe` — all
-- unchanged from 037, and all for 037 §5's reasons. The signature, the argument
-- names and the output column names are byte-identical, because they are the
-- wire contract PostgREST publishes: `supabase.rpc('search_places', { q,
-- near_lat, near_lon })` routes on the argument names. `lon`, never `lng`.
--
-- `create or replace` keeps the function's oid, so 037's EXECUTE grants survive
-- untouched. They are re-issued at the bottom anyway — idempotent, and it means
-- this file states its own privilege model instead of referring to one.
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
      raw.term ~ '[[:alnum:]]{3}' as searchable,
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
  'Meeting-point typeahead over public.places (037, widened by 039). SECURITY INVOKER — the places SELECT policy governs it, there is nothing to re-check. Returns at most 5 rows: the design draws five. MATCHES name, brand, street and locality, PER TOKEN and ANDed: the term is split on whitespace and every token must appear somewhere in the row''s searchable text, so `Jumbo Maastricht` finds a Jumbo whose locality is Maastricht and adding a word always narrows. RANKS a place the query NAMES (every token in name or brand) above a place the query merely LOCATES; name matches are then ordered by trigram similarity and address-only matches by distance, so a bare city name does not bury the place actually called that. Proximity still outranks both: matches within roughly 28 km fill the list first and the rest of the country fills only what is left, so a distant branch of a nearby chain is unreachable while a location is supplied (037 §5b) — the escape hatch is to type the town, which is what 039 makes possible. Returns ZERO rows unless the query holds three consecutive alphanumerics; that guard is per-token by construction, since such a run cannot span whitespace. A short token ANDed with a long one is free and is honoured, so `Kerkstraat 40` is not silently `Kerkstraat`. Non-finite or out-of-range coordinates degrade to a nationwide search instead of raising. DEBOUNCE IT — REQUIRED, not advisable: cost is roughly linear in matched rows (8-11 µs each) and the broadest tokens are Dutch street-type suffixes, not city names. On a 750k-row SYNTHETIC bench (039 §5c; this table is empty, so nothing is measured on real data) the national pass took 2,957 ms for `straat`, which matches 52% of rows, and 996 ms for `sta` — three characters, so it is the FIRST query fired the moment the guard stops refusing, for anyone typing "Stationsweg". A city name is 497 ms. Supplying a location keeps every one of those to 29-152 ms because the bbox applies, so pass `near_lat`/`near_lon` whenever you have them and fire on a pause rather than a keystroke. Case-insensitively duplicate tokens are collapsed before matching (039 §5d), so a repeated word cannot multiply the work — but DISTINCT co-extensive substrings still can, and that is an OPEN cost rather than a closed one: ten substrings of one word inside 49 characters measured 5,914 ms, because they AND to the same 391,586 rows while multiplying the per-row work by ten. A function-level statement_timeout does not bound it (measured: the timer is armed before the function is entered, so the SET is applied but inert). Nothing exceeds the 8 s statement timeout, which means the failure mode is a slow screen and a large bill rather than an error anyone notices — so treat a long multi-token term from the client as a thing to gate, not merely to debounce.';

comment on table public.places is
  'Self-hosted place index for ride meeting points (037), built from Overture Maps open data — NOT rider content: no owner, no author, loaded out of band by `\copy` and readable by every signed-in rider. ATTRIBUTION IS AN OPEN QUESTION, not a settled one: measured over 527,725 sampled rows, ZERO cite OpenStreetMap — the sources present are Overture, meta, Foursquare, Microsoft, AllThePlaces, PinMeTo, DAC and Krick — so an "© OpenStreetMap contributors" credit would be wrong. What those eight require has NOT been read from Overture''s own attribution terms (unreachable from the build container), and doing so is an owner action that gates the search UI, not this table. Search it through public.search_places(), never with an ad-hoc ILIKE — the function carries the guard that keeps a broad query off a full-table scan, and since 039 it also carries the per-token AND and the name-over-address ranking that make a widened search useful rather than merely wider. `search_text` is generated from name, brand, street and locality; never write to it and never name it in a `\copy` column list. POI rows only — Overture''s addresses theme (17.8M NL rows, 1.5 GB) is deliberately not imported, so a residential address is not findable here.';

-- Default EXECUTE goes to PUBLIC on creation. `create or replace` preserves the
-- existing ACL, so 037's revoke still stands — re-issued so this file states its
-- own privilege model rather than pointing at another one. 005's rule.
revoke all on function public.search_places(text, double precision, double precision)
  from public, anon;
grant execute on function public.search_places(text, double precision, double precision)
  to authenticated;

-- No table grant changes. `authenticated` holds SELECT on `public.places` and
-- a table-level grant covers columns added later, so `search_text` is readable
-- without a new grant and — the half that matters — without a new write path.
-- `anon` still holds nothing. Asserted in supabase/tests/rls_test.sql §039.

-- ---------------------------------------------------------------------------
-- Verification — run against the live project after applying, not just in CI
-- ---------------------------------------------------------------------------
--   -- stored generated column, present and ALWAYS generated
--   select attgenerated from pg_attribute
--    where attrelid = 'public.places'::regclass and attname = 'search_text';   -- 's'
--
--   -- 1 trigram GIN index now, not two, and it is on search_text
--   select indexname from pg_indexes
--    where schemaname='public' and tablename='places' and indexdef like '%gin_trgm_ops%';
--   -- -> places_search_text_trgm_idx, and nothing else
--
--   -- 3 — pkey, the coordinate btree, and the one above
--   select count(*) from pg_indexes where schemaname='public' and tablename='places';
--
--   -- false, and {search_path=""} — still invoker, still pinned
--   select prosecdef, proconfig from pg_proc
--    where oid = 'public.search_places(text,double precision,double precision)'::regprocedure;
--
--   -- true, then false — riders may call it, anon may not
--   select has_function_privilege('authenticated',
--            'public.search_places(text,double precision,double precision)', 'execute'),
--          has_function_privilege('anon',
--            'public.search_places(text,double precision,double precision)', 'execute');
--
--   -- exactly {SELECT}, and 0 — no write path arrived with the column
--   select privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='places' and grantee='authenticated';
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='places'
--      and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';
--
--   -- 1 policy, SELECT, {authenticated}; RLS on. Untouched by this file.
--   select cmd, roles::text from pg_policies
--    where schemaname='public' and tablename='places';
--
--   -- 0 rows and NO error, four times over — a broken GPS still degrades
--   select count(*) from public.search_places('abc', 'Infinity'::double precision, 5.1);
--   select count(*) from public.search_places('abc', 'NaN'::double precision, 5.1);
--   select count(*) from public.search_places('abc', 1e308, 5.1);
--   select count(*) from public.search_places('ab 40', 52.09, 5.11);
--
-- And the advisors: `get_advisors(security)` must still return the documented
-- eight. A ninth would mean search_places was created `security definer`.
