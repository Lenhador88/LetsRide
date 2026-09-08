## Why

A ride's starting location is a bare text input today, so what an organizer types is whatever they
typed — and the one thing that could turn it into a place, `resolve-ride-location`, refuses vague
text by design. Measured on DEV 2026-08-18: **every** ride on the project carries
`latitude`/`longitude`/`geocode_confidence` NULL, and `ride_map_render_attempts` holds two rows for
the two rides created 2026-08-17 (`Amsterdam north`, `Amsterdam north plekk`), both refused at the
granularity gate. The map exists and nothing ever reaches it.

PD-259 shipped the control that fixes this on 2026-08-18 (`#265`, `664caa7`):
`src/components/ui/PlaceSearchField.tsx` searches our own `public.places` index through
`search_places()`. This change applies it to rides — which is a different problem from clubs,
because a ride's coordinates **already have a writer** and this adds a second one.

Two corrections to PD-114's body, which predates the code:

- **The provider question is closed.** Geoapify was picked and deployed 2026-08-09. The body's
  Mapbox recommendation is superseded and no provider comparison is reopened here.
- **The privacy paragraph is moot, and is answered rather than dropped.** The body says every
  keystroke would reach a third party. It does not: the typeahead reads `public.search_places()`
  against 736,538 self-hosted Overture rows on both projects. **No keystroke leaves our
  infrastructure.** The vendor is contacted only by the Edge Function, only after a save, and only
  for a ride whose location was *not* picked.
- The body's step 3 proposes `meeting_point_lat`/`meeting_point_lng`. `051` already added
  `latitude`, `longitude` and `geocode_confidence`; those are the columns, and only one new column
  is added here.

Read from the issue and its comments directly, 2026-08-18. Three things they carry that the relay
into this proposal did not:

- **Storage rights, which the body names as load-bearing** — *"'We may keep the lat/lng' is
  load-bearing for all three payoffs, so verify it before the migration lands."* Answered: Overture
  Places is **CDLA Permissive 2.0 + Apache 2.0**, not ODbL — no share-alike, no deletion clause, no
  rights that lapse, and no per-result credit (PD-191, 2026-08-18). Written into the spec rather than
  inherited.
- **A hard requirement nobody has built: the search sheet must link to `/legal/attributions`.**
  Carried by PD-114 and PD-259 in the same words, because the licence argument depends on that page
  being reachable and it is currently linked only from Terms and Privacy. **PD-259 shipped the
  control without it** — `grep -rn "attributions" src/` finds it only in `types/index.ts`,
  `legal/terms` and `legal/privacy`. This change adds it to the shared control, so clubs gain it too.
- **The provenance question the issue assigns to this story** (comment, 2026-08-12): confidence
  saturates, so a picked coordinate and a maximally-confident geocode are indistinguishable, and it
  offers "either a `location_source` column, or a CHECK-admitted sentinel". This proposal takes
  neither — see `design.md` §D2.
- The comment's *"the coordinates may not be landing"* suspicion is **traced**: the function fires and
  refuses at the granularity gate. PD-260 depends on the same answer.

## What Changes

- **`meeting_point` stays free text and stays required.** Search is an accelerator on top of it,
  never a gate. "The layby past the second roundabout" remains a legal, unpickable meeting point,
  and a ride SHALL never be refused for having no pick.
- **`PlaceSearchField` gains a free-text mode** — an editable input plus a search affordance that
  opens the same sheet — rather than a second picker being written. This is the extension its own
  header already anticipates for PD-114.
- **One new column on `rides`: `start_place_id`** (the Overture GERS id of the picked row, `text`,
  **no foreign key** to `places`), alongside `051`'s existing `latitude`/`longitude`.
- **Provenance becomes a database fact, not a convention.** `start_place_id IS NOT NULL` means a
  rider picked this point; `geocode_confidence IS NOT NULL` means the vendor guessed it. A
  replacement CHECK makes the two arms **mutually exclusive**, so a row can never claim both or
  neither.
- **The geocoder is stopped from overwriting a pick — in the database.** A picked coordinate is
  restored by a trigger if any later UPDATE tries to move it. This is not left to the Edge
  Function, which nothing in CI type-checks and which only the owner can deploy.
- **`051`'s stale-tile trigger is corrected.** Measured today: it is a BEFORE trigger that NULLs all
  five columns on any `meeting_point` change, so an UPDATE carrying a picked coordinate *and* the
  new text **loses the coordinate in the same statement**. Without this fix the edit path cannot
  work at all.
- **INSERT grants.** `051` granted UPDATE on `latitude`/`longitude` and no INSERT at all, so
  picking a place at ride creation raises `42501` today. Additive INSERT grants are added.
- **The sheet gains a link to `/legal/attributions`**, on the shared control, closing a requirement
  both this story and PD-259 carry and neither has built.
- **Typing over a pick throws the pick away** — product owner, 2026-08-18: *"Lets throw away the pin
  if the rider types more."*
- **What this change does NOT close, stated rather than implied**: `authenticated` keeps
  `update (geocode_confidence)` from `051`, so the *geocoded* arm remains self-asserted. It cannot be
  revoked here — `resolve-ride-location` writes as the **caller**, not `service_role`, so a revoke
  ahead of a redeployed function silently stops every tile. The fix and its fixed ordering are named
  in the spec and scheduled in `tasks.md` §8.
- **BREAKING for nothing shipped**: no rider-visible behaviour is removed, no existing ride changes,
  and no backfill is run.

## Capabilities

### New Capabilities

- `ride-start-location`: how a ride's starting point is set, who may set it, what distinguishes a
  rider's pick from a vendor's guess, what happens to the pick when the text changes, and every
  state the search surface can be in.

### Modified Capabilities

- `database-enforced-integrity`: two added requirements — a coordinate must name the writer that
  produced it and a rider's pick outranks a vendor's guess; and a trigger that clears a column must
  not clear a value supplied by the same statement.

## Impact

- **Schema** — `067` (next number; `066` is the tip on files and on DEV, PROD is at `059`): one
  column, a replaced coupling CHECK, a length CHECK, a rewritten `clear_ride_map_tiles()`, one new
  protective trigger, additive INSERT/UPDATE grants. Assertions in `supabase/tests/rls_test.sql`.
- **Code** — `src/components/ui/PlaceSearchField.tsx` (extended), `src/components/rides/CreateRideForm.tsx`,
  `EditRideForm.tsx`, `src/lib/validation/rides.ts`, `src/lib/actions/rides.ts`, `src/lib/data/rides.ts`,
  `src/types/index.ts`.
- **Docs** — `docs/reference/schema.md`'s `rides` row is falsified by `067` in three places (the
  `insert` list, the `update` list, and *"a coordinate needs a confidence at or above the floor"*) and
  is updated in the same change, as `066` did for clubs.
- **Edge Function** — `supabase/functions/resolve-ride-location/` skips a ride that carries a pick,
  renders its tiles from the stored coordinate, and guards its write against a pick that arrived
  mid-flight. **Deploying is an owner action**, so this is drift from the moment it merges; the
  interim state — including the two JPEGs that race can orphan — is stated in the spec rather than
  assumed away.
- **No new runtime dependency.** Nine today, nine after.
- **No mapping SDK** — decision #3 is untouched. This adds a search, not a map.
