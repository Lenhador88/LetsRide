#!/usr/bin/env python3
"""Extract Dutch places from Overture Maps into a CSV ready for `COPY` into Postgres.

**Why this exists.** The location provider for ride meeting points is a
self-hosted index rather than a third-party geocoder (see PD-114). Overture's
places theme is open data, so there is no 30-day deletion clause, no "must be
shown on our map" restriction, and no per-keystroke bill.

**The exact licence and the attribution it requires are an OPEN question** — see
scripts/places/README.md §Attribution. An earlier version of this docstring said
"CDLA-Permissive for the Overture-contributed parts, ODbL where it derives from
OSM"; a census of 527,725 rows found **zero** attributed to OpenStreetMap, and
the commercial sources that do appear (Foursquare, Microsoft, PinMeTo, Krick)
have terms nobody has read, because their hosts are egress-blocked. Do not
restate a licence position here — that duplication is how the wrong one survived
a retraction.

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
import urllib.parse
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

# How wide a bbox may be before we stop believing it describes a point.
#
# The bbox is stored float32 and rounded OUTWARD, so even a true point gets a
# non-empty envelope: 15,836 of 15,943 sampled rows have xmin != xmax.
#
# Two figures for how wide that envelope is, and they disagree, so both are
# recorded rather than one quietly replacing the other:
#
#   * MODELLED — one float32 ULP at Dutch latitudes is 3.815e-6 deg, an envelope
#     ~0.42 m wide, putting a corner at most 0.262 m from the true point and a
#     midpoint at most 0.100 m.
#   * MEASURED — sampled against the decoded WKB, the corner is 0.633 m out at
#     the median and 0.846 m at the worst.
#
# The measurement is ~3x the model, so Overture pads by more than a single ULP.
# The model has the mechanism right and the margin wrong, which is exactly why
# the threshold is set off the MEASURED figure: 1e-4 deg is ~11 m, about 13x the
# observed worst case and 26x the modelled envelope, and far below any real
# polygon. So it trips on a genuine non-point and never on float32 rounding.
#
# It matters because the coordinate we write is the bbox MIDPOINT. For a rounded
# point that is the true location to within half an ULP; for an actual polygon it
# is the centre of the envelope, which may be nowhere near the place and may not
# even be on it. Rather than let that arrive silently, the run fails.
MAX_POINT_EXTENT_DEG = 1e-4

CSV_HEADER = [
    "id", "name", "brand", "category", "lon", "lat",
    "street", "locality", "postcode", "country", "confidence",
]


def list_parts(release: str, theme: str, type_: str) -> list[str]:
    """Return every parquet key under a theme, via the S3 REST list API.

    Paginated, because "every" has to mean every. S3 caps a ListObjectsV2
    response at 1,000 keys and signals more with `IsTruncated`; the theme has 16
    parts today, so one page is enough and the loop has never run twice. That is
    exactly why it is worth having: the day a release ships more than 1,000
    parts, an unpaginated version does not fail — it silently returns a prefix
    of the theme and the extract quietly loses places.
    """
    prefix = f"release/{release}/theme={theme}/type={type_}/"
    keys: list[str] = []
    token: str | None = None

    while True:
        url = f"{BUCKET}/?list-type=2&prefix={prefix}&max-keys=1000"
        if token:
            url += f"&continuation-token={urllib.parse.quote(token, safe='')}"
        with urllib.request.urlopen(url, timeout=60) as resp:
            root = ET.fromstring(resp.read())

        keys += [c.findtext(f"{S3_NS}Key") for c in root.findall(f"{S3_NS}Contents")]

        if root.findtext(f"{S3_NS}IsTruncated") != "true":
            break
        token = root.findtext(f"{S3_NS}NextContinuationToken")
        if not token:
            # Truncated but no token to continue with: S3 should never do this,
            # and silently returning a partial listing is the one outcome this
            # function must not have.
            raise SystemExit("S3 reported a truncated listing with no continuation token")

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
    # The coordinate is the bbox MIDPOINT, and taking a corner instead was a
    # measured bug rather than a stylistic choice.
    #
    # This used to read "Overture places are points, so the bbox degenerates to
    # the coordinate itself" and take xmin/ymin. The bbox does not degenerate:
    # 15,836 of 15,943 sampled rows have xmin != xmax, because the struct is
    # float32 and rounded OUTWARD so that it is guaranteed to contain the true
    # point. Taking the low corner therefore put every single coordinate
    # systematically SOUTH-WEST of the truth — median 0.633 m, max 0.846 m
    # against the decoded WKB. A consistent bias, not noise, and `.7f` below was
    # writing seven decimals of a number that did not have them.
    #
    # The midpoint recovers the true coordinate to within half an ULP and still
    # needs no WKB decode, so it keeps the reason the corner was chosen (no
    # shapely, no geo dependency) without the error.
    xmins = pc.struct_field(table["bbox"], "xmin").to_pylist()
    xmaxs = pc.struct_field(table["bbox"], "xmax").to_pylist()
    ymins = pc.struct_field(table["bbox"], "ymin").to_pylist()
    ymaxs = pc.struct_field(table["bbox"], "ymax").to_pylist()
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

        # Counted, not raised on the spot: main() fails the run at the end, so
        # the operator learns HOW MANY non-point places appeared rather than
        # only that a first one did.
        extent = max(xmaxs[i] - xmins[i], ymaxs[i] - ymins[i])
        if extent > MAX_POINT_EXTENT_DEG:
            stats["oversized_bbox"] += 1
            stats["max_extent"] = max(stats["max_extent"], extent)

        writer.writerow([
            ids[i], names[i], brands[i], cats[i],
            f"{(xmins[i] + xmaxs[i]) / 2:.7f}", f"{(ymins[i] + ymaxs[i]) / 2:.7f}",
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
    stats = {"no_country": 0, "other_country": 0, "oversized_bbox": 0, "max_extent": 0.0}

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

    # The centroid assumption, asserted rather than trusted. Every coordinate in
    # the CSV is a bbox midpoint, which is the true point for a rounded point and
    # merely the centre of an envelope for anything else. If Overture ever ships
    # a place with real extent, the file is still written — someone may decide
    # the centre is good enough — but the run is RED, so it cannot be loaded by
    # a script that checks its exit code, and nobody inherits the assumption
    # silently.
    if stats["oversized_bbox"]:
        print(
            f"\nFAIL: {stats['oversized_bbox']:,} places have a bbox wider than "
            f"{MAX_POINT_EXTENT_DEG} deg (largest {stats['max_extent']:.6f} deg). "
            "The written coordinate is the bbox midpoint, which is only the true "
            "location for a point. Decide what these should resolve to before "
            "loading; see the note beside MAX_POINT_EXTENT_DEG.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
