# Postcard location defaults to a Region

## Why

The composer's location control ships three modes — `Hide`, `Region`, `Precise` — with `Hide` as
the default (`DEFAULT_PHOTO_LOCATION_MODE` in `src/lib/media/location.ts`). The product owner
settled on 2026-08-27 that this is the wrong floor for a product about *where you rode*: the
default answer is "nothing", so the overwhelmingly common postcard carries no place at all, and
`PostcardCard`'s town-and-flag row — shipped 2026-08-24 by PD-279 — draws on almost nothing.

Measured on DEV (`fpmrimzxadewsaiwpsel`) 2026-08-27: **10 postcards, 1 with a
`taken_place_name`, 0 with a `taken_country_code`, 1 legacy `'region'` row.**

Four decisions follow, all the owner's:

1. The three modes become **`Country` / `Region` / `Precise`**. `Hide` is dropped.
2. The default becomes **`Region`**, with two guardrails written into the spec rather than left
   as current behaviour.
3. The place-search **query criteria split between the two callers** — a ride's meeting point
   wants a specific findable pin, a postcard's Region wants a coarse evocative place. Same
   component, same proxy, same ledger, same rate limit; different query.
4. The prefill offers **two or three landmark candidates** rather than auto-filling one town, and
   a **"Load current location"** action sits beside the Location label.

## The objection, recorded once

Raised before the decision and **reaffirmed by the product owner**. Per `CLAUDE.md` §Working With
the Product Owner it is recorded here once and is not re-raised anywhere else in this change; the
tasks build the request as asked.

**(i) `Country` is not always available, so an unlabelled no-location state returns anyway.** A
country has to be derived from something. The only sources are the photo's own EXIF fix and a
place the rider names — and `072`'s header is explicit that a photo carrying no fix is *the
common case rather than the edge*: HEIC, screenshots, and anything already through another app's
share sheet. For those photos, with the rider naming nothing, the row is still all-NULL. So the
floor is `Country` **only for photos that carry a fix**, and the schema keeps a state that means
"we have nothing" while the UI no longer has a button for it.

**(ii) It flips the default from "publish nothing" to "publish something", and ends the property
that no geocoder is contacted until the rider asks.** `locationCopy.ts` records that the owner
chose on 2026-08-20 to fire the reverse lookup only once the rider taps the middle mode, so the
sentence *"the location never leaves your phone"* stayed true for a rider who touched nothing.
With `Region` as the default the lookup has to fire on upload, which sends a ~1 km cell derived
from the rider's photo to a third party on the strength of them having selected a file. It also
spends one of `069`'s **20 lookups per rider per hour** per photo, automatically.

Both are stated. The build proceeds.

## What Changes

### The control

- **Three modes: `Country`, `Region`, `Precise`.** `Hide` is removed from `LOCATION_MODES`, from
  `PhotoLocationMode` and from `resolvePhotoLocation`'s branch table.
- **`Region` is the default**, replacing `DEFAULT_PHOTO_LOCATION_MODE = 'hide'`.
- **Two guardrails are requirements, not inherited behaviour.** The reverse lookup keeps
  `type=city` so an auto-filled value can never be a street, and the resolved place must be
  **visible on the composer before Post is reachable** — the control may not move behind a "more
  options" disclosure.
- **The copy contract survives.** `resolveLocationCopy` exists because a mode whose sentence is
  wrong is the one defect on this screen that cannot be seen by looking at it. Every new state
  below gets its own sentence, computed from what will *actually* be stored.

### The schema

- **A `'country'` marker joins `taken_location_precision`.** `postcards_taken_location_coupling`
  gains a sixth arm (or is restructured — `design.md` D3 argues for restructuring).
- **`postcards_taken_country_code_needs_a_place` is dropped.** It currently refuses a country with
  no name, which is exactly the `Country` mode's row.
- **`PostcardCard` must draw a flag alone.** It draws the flag inside a
  `{postcard.taken_place_name && …}` gate today, so a country-only postcard renders nothing.
- **`'region'` stays legacy and unbackfilled**, exactly as `072`/`073` left it. One DEV row
  carries it.

### The place search

- **`buildAutocompleteUrl` gains a criteria parameter.** It sends no `type` at all today, so a
  ride's meeting point and a postcard's Region get the same undifferentiated list.
- **The two callers ask for opposite things** — a meeting point must be findable and specific
  (café, car park, address; the ride stores its pin exactly), a postcard Region must be coarse
  and evocative (range, valley, pass, river, town; its coordinate is rounded to 2dp).
- **Everything else is reused**: `PlaceSearchField`, the `search-places` proxy, `069`'s ledger and
  its three ceilings.

### The prefill and the new action

- **Landmark candidates.** When the photo carries a fix, offer two or three candidates — the town
  plus a nearby named natural feature — and let the rider pick. **The rider makes the "what is
  remarkable" judgement; the app does not rank.**
- **A "Load current location" action beside the Location label.** An action, not a suggestion: it
  asserts nothing until tapped.

## What Does NOT Change

- **No new audience, on any column.** Every value here sits on `postcards`, RLS is row-level, and
  the postcard's existing SELECT policy is the whole answer. Blocked riders, non-members, riders
  who hid the postcard and `anon` reach exactly what they reach today.
- **No UPDATE grant.** `authenticated` holds UPDATE on `caption, club_id, image_path` and nothing
  else — measured on DEV 2026-08-27, unmoved through `072`, `073` and `074`. The remedy for a
  mis-published location stays deleting the postcard, and no task here may touch UPDATE.
- **No provider id.** `073` dropped `taken_place_id` as a precision backdoor. It does not come
  back, and no candidate returned by the landmark prefill may carry one into the row.
- **No backfill.** Nothing attaches a place to a postcard whose author never asked us to name one.
- **No second coordinate pair.** One pair, and `taken_location_precision` says whose it is —
  `064`'s central property, restated because a `Country` mode is exactly where somebody reaches
  for "store the precise one and hide it".
- **No `countrycode` filter on the ride search.** `search-places/shape.ts` §D8: the bias reorders,
  it does not exclude. Splitting the criteria must not narrow what an organizer can find.
- **The audience, the club field and the ride field.** Those are
  `postcard-audience-follows-its-entry-point`'s. The two changes ship independently.

## Blocking dependency — the deployed proxy

**`search-places` on both projects is stale against `shape.ts` and does not return
`country_code`.** `CLAUDE.md` §Supabase Rules records it (PD-279 added the field; neither project
has been redeployed since), and DEV corroborates: 1 postcard carries a `taken_place_name` and
**0** carry a `taken_country_code`.

So the `Country` mode — and the flag on every other mode — stores NULL until each project is
redeployed. **Deploying is an owner action**: there is no `supabase` CLI in the build container
and `deploy_edge_function` is on `.claude/settings.json`'s `deny` list. See `tasks.md` group 0 and
Q1.

## Open Questions

Every question carries a recommended default so the build is never blocked on an answer. **B** and
**F** are the product owner's alone.

**A) The `Country` arm's shape.** *(blocking, `data` can decide)* Recommended default: marker
`'country'`, `taken_country_code` set, `taken_place_name` NULL, **no coordinate**. A country is a
name-level disclosure and a coordinate under it would be the only coarse marker
`postcards_coarse_location_is_rounded` does not cover.

**B) Does `Country` need its own "we could not tell" copy?** *(blocking, product owner)* A photo
with no fix and no named place produces an all-NULL row whichever mode is selected. Recommended
default: yes — `resolveLocationCopy` gains a `country`-with-`null`-stored branch reading *"Nothing
to save yet."*, matching what `Region` and `Precise` already do.

**C) Natural features in the postcard typeahead.** *(non-blocking, DEV/owner research — see D5)*
Whether ranges, valleys, passes and rivers are reachable through a `type`/filter on Geoapify's
geocoding autocomplete, or need the separate Places endpoint with categories, and what that costs.
**`*.geoapify.com` is egress-blocked from this container, so this is UNVERIFIED and no answer is
guessed here.** Recommended default: ship the split as *structure* — a `criteria` field on the
proxy request, with the **ride** caller keeping today's unfiltered behaviour byte-for-byte (so
nothing regresses) and the **postcard** caller sending a value the research task fills in. The
value becomes a one-line change once measured.

**D) How many landmark candidates, and from how many requests.** *(non-blocking, `rider-ux`)*
Recommended default: two to three candidates from **one** reverse request with a raised `limit`,
never a second request — a second is a second `069` ledger row, so a photo would cost 2 of 20 per
hour. Whether a raised `limit` returns distinct feature types is part of C.

**E) What "Load current location" may feed.** *(blocking, `rider-ux` — see D6)* Recommended
default: `Country` and `Region` only, never `Precise`. `requestDeviceLocation()` rounds to 2
decimal places before returning, so a position from it is already ~1 km blunt; writing it under
`'precise'` would store a blurred coordinate the database calls exact.

**F) Revisit the reverse endpoint's `type=city` after the redeploy.** *(non-blocking, product
owner + owner deploy)* `shape.ts` says no session has ever observed that parameter being honoured
on the reverse endpoint, and a `type` the vendor ignores returns a well-shaped feature whose label
is the nearest **address**. With `Region` as the default this stops being a convenience and
becomes the default disclosure path.
