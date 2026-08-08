#!/usr/bin/env python3
"""Extract Dutch places from Overture Maps into a CSV ready for `COPY` into Postgres.

**Why this exists.** The location provider for ride meeting points is a
self-hosted index rather than a third-party geocoder (see PD-114). Overture's
places theme is open data — CDLA-Permissive for the Overture-contributed parts,
ODbL where it derives from OSM — so the coordinates we store are ours to keep,
with no 30-day deletion clause, no "must be shown on our map" restriction, and
no per-keystroke bill.

**Why it does not download 10.5 GB.** The theme is 16 parquet parts totalling
10.5 GB, partitioned by nothing useful — but the rows are spatially sorted and
every row group carries `bbox` min/max statistics. Reading only the footer of
each part (a few hundred KB) tells us which row groups can possibly contain a
Dutch place: measured 2026-08-08, that is **84 of 5,120**, across just 2 of the
16 parts. So the fetch is ~476 MB rather than 10.5 GB.

The bbox test is deliberately a *superset* — a row group is kept if its envelope
merely intersects the Netherlands, so the rows it yields still need the exact
per-row filter below.

Usage:
    python3 scripts/places/extract-nl.py --out nl-places.csv
    python3 scripts/places/extract-nl.py --release 2026-07-22.0 --limit-groups 4
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

import fsspec
import pyarrow.compute as pc
import pyarrow.parquet as pq

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"

# Mainland Netherlands. Deliberately a rectangle rather than the actual border:
# the exact-shape test would need a polygon and PostGIS, and the cost of a
# rectangle is a thin margin of Belgian and German places, which are harmless
# in a meeting-point search and arguably useful near the border.
NL_BBOX = dict(xmin=3.36, xmax=7.23, ymin=50.75, ymax=53.56)

# Only the columns the search index needs. Parquet is columnar, so naming them
# here is what keeps the transfer at ~476 MB instead of the full row width.
COLUMNS = ["id", "names", "categories", "brand", "addresses", "confidence", "bbox"]

CSV_HEADER = [
    "id", "name", "brand", "category", "lon", "lat",
    "street", "locality", "postcode", "country", "confidence",
]


def list_parts(release: str, theme: str, type_: str) -> list[str]:
    """Return every parquet key under a theme, via the S3 REST list API."""
    prefix = f"release/{release}/theme={theme}/type={type_}/"
    url = f"{BUCKET}/?list-type=2&prefix={prefix}&max-keys=1000"
    with urllib.request.urlopen(url, timeout=60) as resp:
        root = ET.fromstring(resp.read())
    keys = [c.findtext(f"{S3_NS}Key") for c in root.findall(f"{S3_NS}Contents")]
    return [k for k in keys if k and k.endswith(".parquet")]


def intersecting_row_groups(md, bbox: dict) -> list[int]:
    """Row groups whose bbox envelope overlaps `bbox`, from footer stats alone."""
    paths = [md.schema.column(i).path for i in range(len(md.schema))]
    idx = {p: i for i, p in enumerate(paths)}
    for needed in ("bbox.xmin", "bbox.xmax", "bbox.ymin", "bbox.ymax"):
        if needed not in idx:
            raise SystemExit(f"parquet is missing {needed}; Overture schema changed?")

    hits = []
    for rg in range(md.num_row_groups):
        g = md.row_group(rg)
        xmin = g.column(idx["bbox.xmin"]).statistics.min
        xmax = g.column(idx["bbox.xmax"]).statistics.max
        ymin = g.column(idx["bbox.ymin"]).statistics.min
        ymax = g.column(idx["bbox.ymax"]).statistics.max
        if (xmax >= bbox["xmin"] and xmin <= bbox["xmax"]
                and ymax >= bbox["ymin"] and ymin <= bbox["ymax"]):
            hits.append(rg)
    return hits


def first_address_field(addresses, field: str):
    """Overture stores addresses as a list; the search index uses the first."""
    if not addresses:
        return None
    return addresses[0].get(field)


def write_rows(table, writer, bbox: dict, countries: set[str], stats: dict) -> int:
    """Filter one row-group batch down to the wanted places and write CSV rows.

    Three filters, and the country one is the load-bearing filter rather than the
    bbox. The rectangle unavoidably reaches into Belgium and Germany — the first
    smoke run came back full of Zwevegem — so the bbox is only there to prune row
    groups cheaply, and `country` is what actually decides membership.
    """
    xs = pc.struct_field(table["bbox"], "xmin")
    ys = pc.struct_field(table["bbox"], "ymin")

    inside = pc.and_(
        pc.and_(pc.greater_equal(xs, bbox["xmin"]), pc.less_equal(xs, bbox["xmax"])),
        pc.and_(pc.greater_equal(ys, bbox["ymin"]), pc.less_equal(ys, bbox["ymax"])),
    )
    named = pc.is_valid(pc.struct_field(table["names"], "primary"))
    table = table.filter(pc.and_(inside, named))
    if table.num_rows == 0:
        return 0

    ids = table["id"].to_pylist()
    names = pc.struct_field(table["names"], "primary").to_pylist()
    brands = pc.struct_field(pc.struct_field(table["brand"], "names"), "primary").to_pylist()
    cats = pc.struct_field(table["categories"], "primary").to_pylist()
    # Overture places are points, so the bbox degenerates to the coordinate
    # itself — cheaper and dependency-free next to decoding the WKB geometry.
    lons = pc.struct_field(table["bbox"], "xmin").to_pylist()
    lats = pc.struct_field(table["bbox"], "ymin").to_pylist()
    confs = table["confidence"].to_pylist()
    addrs = table["addresses"].to_pylist()

    # `addresses` is a *list* of structs, so this filter cannot be an Arrow
    # compute expression the way the bbox one is — `struct_field` has no kernel
    # for list<struct>. It runs per row instead, which costs nothing here because
    # the rows are already materialised for the CSV writer.
    written = 0
    for i in range(table.num_rows):
        a = addrs[i]
        country = first_address_field(a, "country")
        if country is None:
            # Overture knows where it is but not its address. Dropped and
            # counted rather than silently kept — an unaddressed place cannot
            # render the design's Meta line anyway.
            stats["no_country"] += 1
            continue
        if country not in countries:
            stats["other_country"] += 1
            continue

        writer.writerow([
            ids[i], names[i], brands[i], cats[i],
            f"{lons[i]:.7f}", f"{lats[i]:.7f}",
            first_address_field(a, "freeform"),
            first_address_field(a, "locality"),
            first_address_field(a, "postcode"),
            country,
            f"{confs[i]:.4f}" if confs[i] is not None else None,
        ])
        written += 1
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", default="2026-07-22.0")
    ap.add_argument("--theme", default="places")
    ap.add_argument("--type", dest="type_", default="place")
    ap.add_argument("--out", default="nl-places.csv")
    ap.add_argument("--countries", default="NL",
                    help="comma-separated ISO country codes to keep")
    ap.add_argument("--limit-groups", type=int, default=0,
                    help="read at most N row groups in total (for a smoke run)")
    args = ap.parse_args()

    # The agent proxy terminates TLS, so requests need its CA bundle.
    ca = "/root/.ccr/ca-bundle.crt"
    if os.path.exists(ca):
        os.environ.setdefault("REQUESTS_CA_BUNDLE", ca)
        os.environ.setdefault("SSL_CERT_FILE", ca)

    parts = list_parts(args.release, args.theme, args.type_)
    if not parts:
        raise SystemExit(f"no parquet parts under release {args.release}")
    print(f"release {args.release}: {len(parts)} parts", file=sys.stderr)

    countries = {c.strip().upper() for c in args.countries.split(",") if c.strip()}
    print(f"keeping countries: {sorted(countries)}", file=sys.stderr)

    fs = fsspec.filesystem("https")
    written = scanned = groups_read = 0
    stats = {"no_country": 0, "other_country": 0}

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_HEADER)

        for key in parts:
            with fs.open(f"{BUCKET}/{key}", "rb") as f:
                pf = pq.ParquetFile(f)
                groups = intersecting_row_groups(pf.metadata, NL_BBOX)
                if not groups:
                    continue
                if args.limit_groups:
                    remaining = args.limit_groups - groups_read
                    if remaining <= 0:
                        break
                    groups = groups[:remaining]

                name = key.rsplit("/", 1)[-1][:17]
                print(f"  {name}… reading {len(groups)} row groups", file=sys.stderr)

                # One row group at a time: a batch of 50 would materialise
                # several GB before the filter ever runs.
                for rg in groups:
                    table = pf.read_row_groups([rg], columns=COLUMNS)
                    scanned += table.num_rows
                    written += write_rows(table, writer, NL_BBOX, countries, stats)
                    groups_read += 1

    print(f"\nscanned {scanned:,} candidate rows -> wrote {written:,} places",
          file=sys.stderr)
    print(f"dropped: {stats['no_country']:,} no country, "
          f"{stats['other_country']:,} other country", file=sys.stderr)
    print(f"output: {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
