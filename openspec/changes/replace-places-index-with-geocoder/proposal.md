## Why

**The index cannot find where riders live, and no amount of tuning fixes that.** `public.places`
is Overture's **Places** theme — POIs, businesses and amenities. It structurally holds no
addresses. Measured on PROD this session: `street ilike '%claijstraat%'` returns **0 rows
nationally**, Berkhout holds **91 rows and every one is a business**, and
`search_places('Willem Claijstraat Berkhout')` returns `[]`. The product owner's own home street
is unfindable and always will be, because the data set does not contain streets as findable
objects — only as an address line hanging off a shop.

**A meeting point is most often a home address.** That is not incidental to this app; it is stated
in `add-ride-map-tiles`' own tasks and in `/legal/privacy`. A place picker that can find the Jumbo
and not the house is the wrong tool, and PD-114 shipped it because it was the tool that existed.

**The replacement is already in the stack.** `supabase/functions/resolve-ride-location/` has
geocoded typed meeting points through **Geoapify** since 2026-08-09, with the key in that
function's secret store and never in the bundle. Adding Autocomplete is the same vendor, the same
key, the same secret store, and one more endpoint.

**Google and Mapbox stay rejected** on the clauses in `scripts/places/README.md` §Why this is not a
geocoding API — Google's 30-day deletion rule and its point-in-polygon ban (which kills the
eventual `rides` timezone column by name), and Mapbox's "only in conjunction with a Mapbox map",
which decision #3's deeplink and every tile-less surface violate. **The direction was approved by
the product owner this session and is not reopened here.**

**Two things PD-114's comments already establish, read from the issue rather than re-derived.**
The provider comparison lives there, and it ran twice:

- **Storage rights are the reason Geoapify was chosen in the first place.** PD-104's choice is
  recorded as *"OSM-derived so storing coordinates is permitted"*, and the second research pass is
  blunter: *"the only candidates whose storage rights genuinely do not lapse are the ODbL/OSM-derived
  ones (Geoapify) and self-hosting."* Stadia's and LocationIQ's rights lapse with the subscription;
  Geoapify's do not. That is the question this repo spent a week on for Overture, and for this vendor
  it is already answered — **search-derived rather than read verbatim**, because every provider host
  is egress-blocked from a build container, which is still true today.
- **The free plan requires a Geoapify credit on top of OpenStreetMap's**, per the same pass. That is
  the obligation this change has to pay on a surface with no tile to burn it into.

Two facts that make the switch pay for itself beyond search quality, both measured today:

- **`places` is 337 MB of a 350 MB PROD database** (DEV: 338 of 352), against a free-tier ceiling of
  500 MB. Dropping it takes the database to roughly 13 MB. The index is 96% of everything this app
  stores.
- **Nothing references it.** No foreign key anywhere names `public.places` (`pg_constraint.confrelid`),
  by design — `066` and `067` both refuse one, because the index is reloaded wholesale.

## What Changes

- **A new Edge Function, `search-places`, becomes the only path to place lookup.** It verifies the
  caller's JWT itself, holds no service-role key, and holds the Geoapify key in its own secret store.
  **No vendor hostname and no key ever reaches `src/`** — `src/__tests__/no-geoapify-key.test.ts` is
  the existing tripwire and the new function stays inside it.
- **`searchPlaces()` calls the proxy instead of `search_places()`.** The **result shape does not
  change**: the proxy returns `PlaceSearchResult` — our type, not the vendor's — so `PlaceSearchField`
  and both of its modes are untouched apart from copy, and a later vendor swap is a change to one
  function.
- **`getLocalityCentroid()` becomes a second mode on the same proxy, and does NOT go away.** It is
  not only a search bias: `/clubs` and `/clubs/explore` measure "near you" from
  `resolveRiderLocation()`, whose only source for a rider who has not already granted device
  location is this centroid. Measured today: **5 PROD profiles and 7 DEV profiles carry a
  `location`**, and the app never prompts for GPS, so for most riders the profile centroid *is* the
  location. Dropping it silently degrades a shipped screen.
- **Per-rider metering is part of this change, not a follow-up.** An authenticated proxy over a
  shared 3,000-credit/day quota is a quota-exhaustion vector for any signed-in rider. A new
  `place_search_attempts` ledger carries the count and **its ceiling lives in the INSERT policy**,
  exactly as `052` does for map renders — the function is stateless and multi-instance, so it cannot
  count for itself, and it holds no service-role key with which to bypass anything.
- **The global quota is rationed, not just the rider's share.** Search, geocoding and static map
  tiles all draw on the same 3,000 credits/day, and the tiles fail *open* (no map, no error), so an
  unrationed typeahead starves the map silently. The policy reserves a floor for
  `resolve-ride-location`.
- **The client floors change reason rather than disappearing.** `PLACE_SEARCH_MIN_CHARS` (4) stays,
  and stops being about a sequential scan and starts being about a credit. `PLACE_SEARCH_MAX_TOKENS`
  and `boundTerm()` **go** — they exist to bound a per-token ANDed `ILIKE` that no longer exists —
  and are replaced by a plain character bound.
- **Results are cached, for the first time.** `keys.places.search` is declared in `keys.ts` and
  **has no caller today** (`grep -rn "keys.places" src/ | grep -v keys.ts` is empty): the sheet calls
  `searchPlaces` directly, so retyping a term re-issues the query. Free against our own Postgres;
  a credit each against a vendor.
- **The stored id changes namespace and stays provenance-only.** `rides.start_place_id` and
  `clubs.location_place_id` are loose `text` with no FK. New picks store a **namespaced** id
  (`geoapify:<id>`); existing Overture ids stay valid provenance markers that resolve to nothing —
  which is already true of them. **One row exists**: DEV ride `987a85c6…` carries
  `90f7f9bc-9562-4af1-9c7d-8f0a2f8b85bd` ("De Hoorn, Alphen aan den Rijn"). PROD carries **zero**
  ids on 2 rides and 1 club, so no PROD backfill exists to run.
- **The two length bounds are raised, and this is the one that breaks everything if it is wrong.**
  `clubs_location_place_id_length`/`CLUB_LOCATION_PLACE_ID_MAX` are 100 and
  `rides_start_place_id_length` matches. A Geoapify `place_id` is materially longer than an Overture
  GERS uuid. **Unmeasurable from here** — `*.geoapify.com` is egress-blocked from the build container
  — so the length is a task with a measurement in front of it, not a number invented in this file.
- **Attribution moves.** The Overture credit comes off `/legal/attributions` with the table, and the
  Geoapify/OpenStreetMap credit — which is unconditional (`PD-104`) — now covers **search results in
  a list** as well as tiles. A list carries no burned-in credit, so the sheet's footer pays it
  visibly rather than only linking out.
- **Copy, approved by the product owner this session:** the field placeholder is
  **"Search for a town or place"** on the ride forms too (they say "Search location" today; the club
  form and the component default already say the right thing), and the ride form gains one line
  saying a typed meeting point is fine.
- **REMOVED, in a later PR than the code:** `public.places`, `search_places()`,
  `locality_centroid()`, `scripts/places/`, `.github/workflows/places-load.yml`, and the
  `037`/`039`/`040`/`049`/`050` assertion sections in `supabase/tests/rls_test.sql`.
- **BREAKING for nothing a rider holds.** No ride, club or profile row loses a value. What breaks is
  a stored id's resolvability, which was never resolvable.
- **BREAKING for some branded searches, and this is the trade the switch actually makes.** PD-114's
  second research pass rates Geoapify's POI coverage **"patchy — only if it's present in the
  OpenStreetMap database"**, against an index whose 736,538 rows are Foursquare-, Meta- and
  Microsoft-sourced as well. The design's own sample — `Shell Pernis Werk` — and today's documented
  `Jumbo Maastricht` case are exactly the queries that could get worse while every address gets
  better. **Measure it before building** (task 0.6), and if branded POIs collapse, that is a finding
  for the product owner rather than something to build past: the switch is still right for meeting
  points, and the cost is stated rather than discovered by a rider.

## Capabilities

### New Capabilities

- `place-search`: how a rider finds a place — who may search and who must not, what the surface
  shows in each of its six states, what stops one rider draining a shared quota, what the vendor is
  and is not told, what a stored place id means after the index is gone, and what a club or a ride
  can still be created without.

### Modified Capabilities

- `database-enforced-integrity`: two added requirements — a shared, metered third-party quota SHALL
  be rationed by the database rather than by the client of the metered service; and an opaque
  third-party identifier stored on a row SHALL be provenance, namespaced, and never a join key.
- `client-cache-invalidation`: one added requirement — a read that costs money SHALL be answered
  from cache when it has already been answered, with a stated lifetime, and SHALL be destroyed at
  sign-out.
- `client-render-shell`: one added requirement — a surface backed by a third party SHALL tell
  *no matches*, *unavailable*, *you have searched too much*, *the app has searched too much* and
  *offline* apart, because a rider's next action differs for every one of them.

## Impact

- **Edge Function** — new `supabase/functions/search-places/{index,shape}.ts`, split the way
  `resolve-ride-location/{index,gates}.ts` is split, so the decisions are type-checked and tested
  while the Deno wiring is not. **Deploying is an OWNER action** — `deploy_edge_function` is on
  `.claude/settings.json`'s `deny` list and there is no `supabase` CLI in the container — and it is
  **on the critical path**: the client cannot be switched before the function answers. The queue is
  already backed up: **PD-267** carries two undeployed function changes (`resolve-ride-location`'s
  picked-start arm from `067`, and the `src/lib/actions/rides.ts` guard that must come out with it).
  This adds a third.
- **Schema** — `069` (additive: the ledger, its policies, its ceiling functions, the participation
  gate trigger, the widened id bounds) and `070` (destructive: drop `places`, `search_places`,
  `locality_centroid`). Assertions in `supabase/tests/rls_test.sql` in both directions.
- **Code** — `src/lib/data/places.ts` (rewritten), `src/lib/query/keys.ts` (the unused key gains a
  caller and a lifetime), `src/components/ui/PlaceSearchField.tsx` (states and copy),
  `src/components/rides/CreateRideForm.tsx` and `EditRideForm.tsx` (copy), `src/lib/validation/clubs.ts`
  and `rides.ts` (the id bound), `src/types/index.ts` (`PlaceSearchResult`'s doc block),
  `src/app/legal/attributions/page.tsx`, `src/app/legal/privacy/page.tsx` (the processor now
  receives search terms, not only saved meeting points).
- **Deleted** — `scripts/places/` (extractor, loader, README), `.github/workflows/places-load.yml`,
  `src/lib/data/__tests__/places.test.ts`'s `boundTerm` coverage, and five assertion sections.
- **Docs** — `docs/reference/schema.md`'s `places` row, `CLAUDE.md`'s `places` licence paragraph and
  its ten-table participation-gate list (eleven after `069`), `docs/reference/repo-layout.md`,
  `docs/HANDOFF.md`. Several `docs:check` claims move: `migrations-count-*`, `rls-count-*`,
  `unit-tests-count-*` and `unit-tests-files-*`.
- **No new runtime dependency.** Nine today, nine after — the proxy is called through
  `supabase.functions.invoke`, which `deleteAccount` already uses.
- **No mapping SDK.** Decision #3 is untouched. Decision #8 is unchanged and this is its *first*
  reading — more server compute, same database.
