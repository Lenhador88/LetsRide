# The self-hosted places index

The location provider for ride meeting points (PD-140, unblocking PD-114). **Not a
third-party geocoder** — a table in our own Postgres, built from
[Overture Maps](https://overturemaps.org) open data.

## Why this is not a geocoding API

The provider comparison is in PD-114's comments. Two clauses decided it:

- **Google** — Places API §14.3 requires lat/lng to be deleted after 30 days, and
  §3.2.3(c)(iv) bans point-in-polygon on Places coordinates, which kills the
  eventual `rides` timezone column by name.
- **Mapbox** — geocoding responses may only be used *"in conjunction with a Mapbox
  map"*, and POI results specifically must be shown on one. Decision #3's Google
  Maps deeplink and the tile-less surfaces (`RideCard`, the chat header,
  notification rows) all sit outside that.

What self-hosting does buy, and these three are not in doubt: no keystroke leaves
our infrastructure, there is no key to hide in a Capacitor bundle, and there is no
per-request bill.

**It does not cover map tiles.** Overture is data, not rendered imagery — PD-104
still needs a tile provider.

## Attribution is an OPEN question — do not render a result until it is settled

**This section previously said the opposite, and it was wrong.** It asserted that
Overture is "ODbL where OSM-derived" and that any screen showing a result must
credit "© OpenStreetMap contributors". That was inferred from the theme's general
description rather than measured, and the measurement contradicts it.

A census of the `sources` column across 28 of the 84 NL row groups in release
`2026-07-22.0` — **527,725 rows** — attributes them as:

| Source | Rows |
|---|---|
| Overture | 527,725 |
| meta | 405,612 |
| Foursquare | 58,733 |
| Microsoft | 53,432 |
| AllThePlaces | 6,338 |
| PinMeTo | 3,093 |
| DAC | 505 |
| Krick | 12 |
| **OpenStreetMap** | **0** |

So crediting OpenStreetMap would credit a contributor that supplied nothing, while
the sources that did supply the rows go unnamed.

**What is still unknown is the part that matters.** The census says which sources
are *present*; it does not say what their terms *require*. Foursquare, Microsoft,
PinMeTo and Krick are commercial datasets, and that is exactly where a
redistribution or attribution obligation would live. Their terms could not be read
from any container — `overturemaps.org`, `docs.overturemaps.org`,
`opendatacommons.org` and `cdla.dev` all return `000` through the egress proxy,
while the S3 bucket and GitHub return `200`, so this is host-specific policy and
not a broken client.

**Owner action: read Overture's terms and settle the credit string before the
search sheet ships.** `sources` is not currently extracted, so provenance cannot be
recovered from `public.places` — add it to `COLUMNS` if per-row attribution turns
out to be required.

## Extracting

```bash
python3 -m pip install "fsspec[http]" aiohttp pyarrow
python3 scripts/places/extract-nl.py --out nl-places.csv
```

Measured on release `2026-07-22.0`, 2026-08-08:

| | |
|---|---|
| Theme size | 10.5 GB across 16 parquet parts |
| Row groups intersecting NL | **84 of 5,120**, in 2 of the 16 parts |
| Fetched | ~476 MB |
| Candidate rows scanned | 1,585,587 |
| **NL places written** | **736,538** |
| CSV size | 99 MB |
| Dropped | 656,712 other-country, 0 missing-country |

Data quality on that run: 483 Shell-branded gas stations, 95% carrying a street
address, and the top brands are the Dutch chains you would expect — Albert Heijn,
Jumbo, HEMA, Gall & Gall, Allego.

**Why it fetches 476 MB and not 10.5 GB.** The places theme has no useful
partitioning, but rows are spatially sorted and every row group carries `bbox`
statistics. Reading only the parquet footers identifies the row groups that can
contain a Dutch place; the rest are never requested.

**The bbox is a prune, not the filter.** The rectangle reaches into Belgium and
Germany — the first smoke run came back full of Zwevegem — so membership is
decided by `addresses[0].country`, and `--countries` is what to change when
expanding beyond NL.

## Loading

**Run the workflow — `.github/workflows/places-load.yml`, Actions → Load places
index → Run workflow.** It picks the target database from an input (DEV by
default), runs the extractor, and loads through `scripts/places/load.sql`.
**The one thing it needs is a connection-string secret per database**, which is
an owner action and a one-time paste; that workflow's header names both secrets
and says which Supabase string to copy.

**No session can run the `\copy` by hand**, and that part has not changed — it
needs a direct Postgres connection and the build container holds no database
credentials. What changed is that the runner *can*, so loading is no longer
gated on someone being at a terminal.

By hand, with a connection string, it is the same one command the workflow runs:

```bash
python3 scripts/places/extract-nl.py --out nl-places.csv
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/places/load.sql < nl-places.csv
```

`load.sql` carries its own reasoning — read it there rather than here. Four
things about it are worth knowing before you run it:

- **It is one transaction**, so a failed load or a failed assertion leaves the
  table byte-for-byte what it was. There is no half-loaded state to clean up.
- **It never leaves search empty.** `delete` inside a transaction keeps every
  concurrent reader on the pre-delete snapshot until `commit` — see §Refreshing
  for why that replaces the fresh-table-and-swap this file used to specify.
- **`ON_ERROR_STOP=1` is not optional.** Without it psql reports a failed
  statement and carries on to `commit`.
- **The detector fails the load closed**, and `-v force=1` downgrades exactly one
  of its assertions — the row-count band — to a warning. The landmark probes are
  never overridable.

**The explicit column list is required**, and `load.sql` uses `HEADER MATCH`
rather than the `HEADER true` this section used to give. A bare `\copy
public.places FROM …` demands every column in table order, which now includes the
generated `search_text`; and `HEADER true` merely *skips* the header rather than
checking it, so an extractor that reorders `CSV_HEADER` loads longitudes into
`lat` and only an out-of-range value would catch it. `HEADER MATCH` needs
PostgreSQL 16 on both ends — both projects report 17.x, measured 2026-08-09.

**So is the `analyze`.** A bulk-loaded table carries no statistics, and the
planner picks between the trigram bitmap and a sequential scan from them. Skip it
and the first searches after a load can be an order of magnitude slower,
intermittently — about the hardest thing to diagnose after the fact. `load.sql`
runs it inside the transaction and then *asserts* that the trigram index is
actually chosen, so a missing `analyze` fails the load instead of degrading it.

The load runs as the table owner, which is how it bypasses RLS and the absent
INSERT grant. That asymmetry is deliberate: the operator can write, and nothing
reachable through PostgREST can.

**The table is empty until someone runs this, and an empty index is
indistinguishable from a working search that finds nothing.** `037` creates the
schema; it cannot create the rows.

**Loading is also what arms the cost in §Searching.** Linear **PD-150** —
~5.9 s of database CPU per request from a 49-character term — is 0 ms today only
because there is nothing to scan. **`049` landed its option A**, so the
caller-chosen multiplier is now bounded at eight distinct tokens; the ~2.8 s
floor from a single broad token is option B and is **still open**. The
workflow's PROD arm still requires a typed confirmation naming PD-150, and that
wording is a human gate rather than a check — read the issue's current state
rather than the prompt.

### What it costs — measured on the real extract, 2026-08-09

The first real numbers this table has ever had. **Every size in `037`, `039` and
`040` is from a 750k-row synthetic bench and each of those files says to
re-measure here**, so these supersede them. Local PostgreSQL 16.13, 736,538 rows:

| | heap | GIN over `search_text` | all indexes | total |
|---|---|---|---|---|
| one clean load | 162 MB | 85 MB | 175 MB | **337 MB** |
| four reload cycles, `vacuum` each, no reindex | 162 MB | 207 MB | 372 MB | 533 MB |
| the same table reindexed | 162 MB | 72 MB | 141 MB | **303 MB** |
| one refresh over a full table, as `load.sql` runs it | 324 MB | — | 141 MB | **465 MB** |

Extract 54 s (~476 MB fetched); load, verify and vacuum 53 s, plus ~30 s of
reindex on a refresh.

**The heap doubles on the first refresh and then stops.** `delete` leaves 736k
dead tuples at the front of the file and the new rows are appended after them, so
`vacuum` marks that space reusable without returning it — 162 MB becomes 324 MB
once, and the refresh after that reuses it rather than growing again. That is why
the four-cycle row above still shows a 162 MB heap: its second cycle loaded a
deliberately short 400k CSV, leaving free space the next full load fitted into.

**Indexes are the half `vacuum` does not fix**, which is why `load.sql` ends with
`reindex table concurrently` — but only on a refresh. A first load has no bloat
to reclaim, and skipping the rebuild there is a disk decision rather than a
tidiness one: `REINDEX TABLE CONCURRENTLY` advances every index through each
phase together, so all four new indexes coexist with all four old ones, and
162 + 175 + 141 = 478 MB against a 500 MB cap is a quota exhaustion *after* the
commit.

**So the free tier fits the first load and nothing after it.** DEV was 13 MB
before, and a first load lands it at ~346 MB against the 500 MB database cap. A
refresh measures 465 MB before counting the reindex peak or WAL. **`PD-87` (move
off the free tier) is therefore this pipeline's precondition for refreshes**, not
only a launch concern — the first load is the only one that fits.

## Refreshing

Overture releases monthly, so the index goes stale on its own. **A refresh that
silently stops looks exactly like working search**, which is the same failure
class this repo already treats as drift for unapplied migrations — so the refresh
needs a *detector*, not just a schedule: assert the row count is within a sane
band of the previous run, and that a known landmark still resolves.

CI is the runner, and the detector is built: `.github/workflows/places-load.yml`
plus `scripts/places/load.sql`, which asserts the row count against a band and
re-resolves three landmarks through `search_places()` and `locality_centroid()`
before it commits.

**GitHub Actions does not already hold database credentials, which is what this
section claimed and is why this took a year to happen.** The only secrets any
workflow referenced were the app's publishable pair — re-derive rather than trust
either way:

```bash
grep -rho "secrets\.[A-Z_]*" .github/workflows/ | sort -u
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` could never have done this job: `anon` holds
`SELECT` and nothing else on `places`, by design (`037` §4b). The load needs the
table owner, so it needs a Postgres connection string, and that is the one secret
an owner still has to paste.

**Never `truncate` and reload.** A truncate leaves search returning nothing for
the length of a 99 MB `\copy`, which riders experience as the feature being
broken — and worse, it holds ACCESS EXCLUSIVE, so readers block past the 8 s
`statement_timeout` rather than merely seeing stale rows.

**This section used to specify "load into a fresh table and swap it in", and
`load.sql` meets the requirement by a different route** — one transaction holding
the `delete` and the `\copy`. MVCC keeps every concurrent reader on the
pre-delete snapshot until `commit`, so there is no empty window and no blocking,
and nothing has to reproduce the real table's 11 columns, 5 CHECKs, generated
column and 4 indexes in a staging copy that could drift from them. The
requirement was never the fresh table; it was that search must never be
observably empty. `load.sql`'s header carries the full comparison.

**A refresh needs `PD-87` first** — see the cost table in §Loading. One load is
303 MB and the free tier caps the database at 500 MB, so the second load is the
one that runs out of room, not the first.

## Searching

Go through `public.search_places(q, near_lat, near_lon)`, never an ad-hoc
`ILIKE`. The function carries the guard that keeps a query off a 736k-row
sequential scan, and two contracts the UI has to honour:

- **Under three consecutive alphanumerics it returns zero rows by refusal, not by
  "no matches".** Gate the input; do not render an empty state. The guard is
  `term ~ '[[:alnum:]]{3}'` rather than a length check, because
  `char_length(term) >= 3` accepts `'%%%%'` — which escapes to a pattern with no
  extractable trigram and measured **1,443 ms of sequential scan**, under the 8 s
  statement timeout and therefore silent.
- **Matching is substring, per token, ANDed — over `name`, `brand`, `street` and
  `locality`.** The term is split on whitespace and every token must appear
  somewhere in the row's searchable text, so `Jumbo Maastricht` finds a Jumbo
  whose *locality* is Maastricht, and adding a word always narrows. Not fuzzy:
  `pg_trgm`'s default `word_similarity_threshold` of 0.6 does not catch typos
  anyway — `word_similarity('jubmo', 'Jumbo Utrecht')` is 0.33 — while widening a
  selective query from 9 rows to 9,529.

  **This section said the opposite until 2026-08-08 and it was true when written.**
  It read *"`street`, `locality` and `postcode` are display-only and are **not**
  searchable, so 'Kerkstraat Amsterdam' finds nothing today"*. `039` (PD-141) made
  street and locality searchable; `Kerkstraat` returns rows now. **`postcode` is
  still excluded** — a Dutch postcode is two tokens and its digits collide with
  house numbers already inside `street` (`039` §2).

- **Ranking: a place the query NAMES beats a place it merely LOCATES.** Widening
  means `Amsterdam` matches thousands of rows whose only connection to the word is
  their address, so the function tiers them — every token in `name`/`brand` first,
  address-only matches after. Name matches are then ordered by trigram similarity,
  address matches by distance. Proximity still outranks both, per `037` §5b.

- **The result set is capped at five and the local pass short-circuits the
  national one.** Unchanged by `039`, and now more likely to bite because more
  rows match: a distant place can be crowded out by five nearby ones. The escape
  hatch is to type the town — which is exactly what `039` made possible.

- **Debounce the input — required, not advisable.** Cost is roughly linear in
  matched rows (8–11 µs each), and **the broadest tokens are street-type
  suffixes, not city names**. On a 750k-row *synthetic* bench (`039` §5c — not
  the real table, which is empty), national pass, best of five:

  | term | rows matched | national | with a location |
  |---|---|---|---|
  | `Kerkstraat` | 17,876 | 171 ms | 37 ms |
  | `Maastricht` | 45,029 | 497 ms | 51 ms |
  | `weg` | 89,200 | 740 ms | 44 ms |
  | `sta` | 101,524 | **996 ms** | 54 ms |
  | `straat` | 391,586 | **2,957 ms** | 152 ms |

  **`sta` is the case to design around**: three characters, so it is the *first*
  query the typeahead fires the moment the guard stops refusing — someone typing
  "Stationsweg". `straat` matches **52% of the table**; the biggest city matches
  6%. Fire on a pause, not a keystroke, and **always pass `near_lat`/`near_lon`
  when you have them** — the bbox is what keeps every row above under 152 ms.

  **This is a cost class `037` did not have and `039` creates.** Those tokens
  used to be matched against `name`/`brand`, where `straat` appears in a handful
  of business names; they are now matched against every row's street line.

  Nothing exceeds the 8 s statement timeout, so no rider sees an error — which is
  the hazard as much as the reassurance.

- **A long multi-token term multiplied the whole query. `049` bounds it at eight
  distinct tokens; the FLOOR it does not touch is still open.**
  Per-candidate work is linear in the *number of distinct patterns*, so a term
  that holds many patterns matching the same rows multiplies the whole query.
  `039` §5d closed one half of this and left the other open, and the README
  said the opposite for one revision:

  | payload | chars | before `lower()` | after |
  |---|---|---|---|
  | `straat` ×14, one casing | 97 | 2,899 ms | 2,838 ms |
  | `straat` ×14, **14 casings** | 97 | 7,149 ms | **2,806 ms** — closed |
  | **10 distinct substrings** of one word | 49 | 5,835 ms | **5,914 ms** — open |

  Case-insensitively repeated tokens are collapsed (`group by lower(s.tok)`),
  because `ILIKE` is case-insensitive and byte-equality dedup misses exactly the
  vector someone would choose deliberately. **Distinct co-extensive substrings
  are not collapsed by anything** — nothing is duplicated — so that row measured
  ~5.9 s from 49 characters, half the cap. A function-level `statement_timeout`
  does *not* bound it: measured on PG 16.13, the timer is armed before the
  function is entered, so the setting is applied and inert.

  **`049` closed it by refusing above eight distinct tokens** (PD-150 option A),
  which is the same number `PLACE_SEARCH_MAX_TOKENS` truncates to in
  `src/lib/data/places.ts`, so no term from the app can reach the refusal. What
  it bounds is the *multiplier a caller chooses*, not the cost of the data: a
  single broad token is still ~2.8 s, and the 100-character cap previously
  allowed roughly twice the ten patterns above. **Capping candidate rows before
  scoring is what would lower the floor, and it is still open** — PD-150
  option B.
