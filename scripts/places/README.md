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

Overture is CDLA-Permissive where Overture-contributed and ODbL where OSM-derived.
So the coordinates are ours to keep, no keystroke leaves our infrastructure, there
is no key to hide in a Capacitor bundle, and there is no per-request bill.

**It does not cover map tiles.** Overture is data, not rendered imagery — PD-104
still needs a tile provider.

## Attribution is not optional

ODbL requires it. Any screen rendering these results must credit
**© OpenStreetMap contributors** and **Overture Maps Foundation**. That is a
product requirement, not a footnote — check it before the search sheet ships.

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

**No session can do this step.** Bulk-loading 736k rows needs a direct Postgres
connection, and the build container holds no database credentials — the Supabase
MCP is fine for DDL but not for a load of this size.

```bash
psql "$DEV_DATABASE_URL" -c "\copy places_import FROM 'nl-places.csv' WITH (FORMAT csv, HEADER true)"
```

## Refreshing

Overture releases monthly, so the index goes stale on its own. **A refresh that
silently stops looks exactly like working search**, which is the same failure
class this repo already treats as drift for unapplied migrations — so the refresh
needs a *detector*, not just a schedule: assert the row count is within a sane
band of the previous run, and that a known landmark still resolves.

CI is the natural runner, since GitHub Actions already holds DEV credentials and
the extract needs only Python.
