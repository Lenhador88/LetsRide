/**
 * The decisions `resolve-ride-location` makes, split out from the Deno wiring
 * so that something can actually check them.
 *
 * ---------------------------------------------------------------------------
 * Why this is a second file when `delete-account/` is one
 * ---------------------------------------------------------------------------
 * `index.ts` is Deno — `Deno.env`, `Deno.serve`, `jsr:` specifiers — and
 * `tsconfig.json` excludes `supabase/functions` for exactly that reason, so
 * nothing in CI reads it. That is tolerable for `delete-account`, whose logic is
 * three ordered calls. It is not tolerable here: `add-ride-map-tiles`'
 * `specs/ride-map-tiles/spec.md` requires the ambiguity gate to be asserted
 * against a measured response **and** the outbound request to be asserted
 * against the number of candidates it asks for, because
 *
 *   > a fixture cannot observe a request that asked for one candidate
 *
 * So everything with a decision in it lives here, with **no Deno global, no
 * `jsr:` import and no network call anywhere in the file**. That is what lets
 * `src/__tests__/ride-geocode-gates.test.ts` import it, and it is what drags
 * this half of the function back under `npx tsc --noEmit`: `exclude` stops a
 * file being a compilation *root*, it does not stop one being type-checked once
 * an included file imports it.
 *
 * **`index.ts` is still unchecked by anything.** Keep the split that way — a
 * decision that moves into `index.ts` is a decision that leaves the test suite.
 *
 * ---------------------------------------------------------------------------
 * What is measured here and what is assumed — read this before trusting a value
 * ---------------------------------------------------------------------------
 * Per `CLAUDE.md`'s rule that an inferred value must never pass silently as a
 * known one, each constant below says which it is.
 *
 * **Both halves of this file have now been exercised against the live vendor**
 * — DEV, 2026-08-27, one picked ride and one typed one, both returning
 * `{"rendered":true}` with two objects in Storage and both path columns
 * written. So the static-map endpoint, its parameter names, `MAP_STYLE` and
 * `SCALE_FACTOR` are MEASURED rather than assumed — which matters more than the
 * text they replace allowed, because a **misspelled query parameter on this API
 * is IGNORED rather than rejected**. A wrong `scaleFactor` would have returned
 * 200 with a 1× image and stored it, not a non-2xx and no tile. Only a wrong
 * *endpoint* fails open through `index.ts`'s "every non-2xx is no tile" path.
 *
 * Two things remain genuinely unmeasured, and both are about the *vocabulary*
 * of a response rather than the shape of a request — one successful geocode
 * cannot enumerate either:
 *
 *   - `STREET_LEVEL_RESULT_TYPES` is an **allowlist** precisely because the
 *     vocabulary is unmeasured — see its own comment.
 *   - `CONFIDENCE_FLOOR`'s scale. Two observations of the value `1` are equally
 *     consistent with 0–1, 0–10 and 0–100.
 *
 * `*.geoapify.com` was egress-blocked from the build container when this file
 * was written, which is why so much of it was inferred. **It is not blocked
 * now** — `apidocs.geoapify.com` and `www.geoapify.com` both answer 200 as of
 * 2026-08-27, so a session can read the vendor's own documentation rather than
 * a search summary of it. Check before inheriting the older claim.
 */

/* -------------------------------------------------------------------------- */
/* The vendor's surface                                                        */
/* -------------------------------------------------------------------------- */

/** Geocoding. The measured response in `tasks.md` §0.8 came from this endpoint. */
export const GEOCODE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/search'

/** Static Maps. Exercised 2026-08-27 — see the header. */
export const STATIC_MAP_ENDPOINT = 'https://maps.geoapify.com/v1/staticmap'

/**
 * MEASURED 2026-08-27: the style exists and renders. It was chosen unmeasured,
 * and the reason it could be is unchanged — a light OSM raster style, with both
 * containers putting text over the tile (`RideMap`'s `bg-scrim`, `RideCard`'s
 * `White/100` pin disc), so the style only has to be neutral, not chosen.
 */
export const MAP_STYLE = 'osm-bright'

/**
 * 2× device pixel ratio, `design.md` §D4: an 80×148 CSS-pixel tile drawn 1:1 on
 * a 3× phone is mush.
 *
 * **Expressed as `scaleFactor` rather than by doubling `width`/`height`.**
 * Doubling the pixel dimensions doubles the *map area* at a fixed zoom;
 * `scaleFactor` renders the same map area at twice the resolution. MEASURED on
 * DEV 2026-08-16: `80×148 scaleFactor=2` returned 160×296 and `358×160
 * scaleFactor=2` returned 716×320. The documented range is **1..2**, "greater
 * values available on request", so 2 is the ceiling as well as the choice.
 *
 * **It does NOT scale the vendor's burned-in credit**, which was a fixed
 * absolute size independent of both the dimensions and the factor — so the
 * credit spanned and clipped the 160-wide card image while remaining legible on
 * the 716-wide detail panel. That is recorded because it is the trap: raising
 * `scaleFactor` is the obvious lever and it moves the credit the *opposite* way
 * from the one that helps, making it occupy less of the tile and so less
 * legible, which is the axis the obligation is measured on.
 *
 * It is history rather than a live constraint now — `ATTRIBUTION_MODE` means
 * nothing is burned in at all — and it becomes live again the moment anyone
 * sets that back to `default`.
 */
export const SCALE_FACTOR = 2

/**
 * **`attribution=none` — the credit is ours to render, and this constant is one
 * half of a two-part obligation.** The other half is `MapAttribution` in
 * `src/components/rides/`, drawn once on each of the THREE screens that display
 * a tile — `/rides`, `/rides/detail` and `/clubs/detail/rides` — never per tile
 * and never over one. **A new surface rendering `map_card_url` or
 * `map_detail_url` owes one and nothing enforces that**, so re-derive the set
 * with `git grep -l "map_card_url\|map_detail_url" -- 'src/app' 'src/components'`
 * rather than trusting the count here. Neither half may
 * ship without the other, and the ORDER matters in one direction only: the app
 * gaining a credit before the image loses one is a harmless duplicate, while the
 * image losing one before the app gains one is a breach. So deploy this function
 * AFTER the app change is serving, never before.
 *
 * MEASURED, twice. The parameter is real — Geoapify's own OpenAPI spec at
 * `apidocs.geoapify.com/assets/openapi/specs/static-maps-api-openapi-specs.json`
 * declares it `in: query`, `enum: [default, mandatory, none]`, `default:
 * default` — and the product owner rendered a tile with it on the upgraded
 * account: *"no more text on top of the image."* PD-236 carries both.
 *
 * **`mandatory` is the third mode and we are deliberately not using it.** Its
 * name suggests it renders whatever the caller's plan legally requires, which
 * would be a smaller burned-in block rather than none — and a smaller block is
 * still a block the 80-wide strip cannot carry legibly. `none` plus our own
 * credit is the only combination that gets a clean card.
 *
 * What the account being a paid package changes is the *content* of the credit,
 * never whether one is shown: White Label drops `Powered by Geoapify`, while the
 * OpenStreetMap (ODbL 1.0) and OpenMapTiles credits survive every plan and every
 * OSM-based vendor. `MapAttribution` holds the exact strings.
 */
export const ATTRIBUTION_MODE = 'none'

/**
 * **The pin on the detail panel.** Product owner, 2026-08-27: *"on the ride
 * details I do not see the pin on the map highlighting the meeting point."*
 * They were right and it had never been sent — the tile was centred on the
 * meeting point and nothing marked it, which reads as a map of nowhere in
 * particular. `TILE_SPECS`'s zoom table is why it now matters more than it did:
 * at z7 the panel covers a couple of hundred kilometres.
 *
 * **`color` MUST be LOWERCASE hex. Uppercase A–F is a 400.** This is the whole
 * bug that took every render on both projects down for an afternoon, and it is
 * undocumented: the schema types `color` as `string, minLength 3, maxLength 10`,
 * which cannot express it, and the vendor's examples happen to be lowercase
 * without saying why. Measured against the live API 2026-08-27:
 *
 *   color:#ff5050  200      color:#FF5050  400
 *   color:#abcdef  200      color:#ABCDEF  400
 *   color:#111111  200      (digits only — no letters to case)
 *
 * **`Grey/100` is written `#1A1A1A` everywhere else in this design system**, so
 * the trap is that copying the token in is the natural thing to do and is wrong
 * here alone. `ride-geocode-gates.test.ts` asserts the absence of uppercase hex
 * for exactly that reason — a future tidy-up that "matches the tokens" turns
 * every ride's map off, silently, with the only symptom a `nothing_to_write` in
 * a log nobody reads.
 *
 * **The error message names the property by INDEX and reading it wrongly cost
 * two attempts.** `"marker[0][1]" does not match any of the allowed types` is
 * marker 0, property 1 — counting from `lonlat` at 0 — so it was always naming
 * `color`. It was read first as `icon` and then, on the strength of `size` being
 * the schema's only `oneOf`, as `size`. Both were wrong and both were plausible.
 * **Bisect against the API instead**: send one property at a time.
 *
 * Two things measured on the way that contradict what this file used to say.
 * `size` accepts a plain integer as well as the named enum — `size:40` renders
 * 200 on its own — so the `oneOf` was never the problem. And **a bogus `icon`
 * name does NOT 400, it renders a default**, so an unknown icon fails silently
 * rather than loudly; that is a reason to distrust `icon`, but not the reason
 * this was broken.
 *
 * What ships is a plain teardrop — `type` defaults to `material`, `whitecircle`
 * to `yes` — in `Grey/100`. That IS the v2 pin the card strip already draws in
 * HTML, so the glyph was never load-bearing. A glyph does work
 * (`icontype:material;icon:place` renders), and adding one still wants a real
 * render behind it because of the silent-fallback above.
 */
export const MARKER_STYLE = 'color:#1a1a1a;size:x-large'

/* -------------------------------------------------------------------------- */
/* The three gates                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How many candidates the geocode asks for.
 *
 * **Stated, per the spec, because narrowing it to 1 is the natural
 * optimisation** — this change bounds vendor spend everywhere else — and it
 * would leave the separation gate below structurally unable to fire while every
 * scenario still passed. Five is enough to see a second town without paying for
 * a page of them; the measured ambiguous case returned two.
 */
export const GEOCODE_CANDIDATE_LIMIT = 5

/**
 * The numeric floor, `design.md` §D3. **Chosen, not measured** — a starting
 * value, deliberately conservative. `051`'s CHECK carries the same number as
 * `>= 0.70::real`, and the two must move together or a candidate this gate
 * admits is refused by its own constraint.
 */
export const CONFIDENCE_FLOOR = 0.7

/**
 * The fail-closed upper arm, matching `051`'s `<= 1.0::real`.
 *
 * The 0–1 scale is plausible rather than validated, so if the vendor is really
 * emitting 0–100 every candidate is rejected here and no tile is ever stored —
 * which is the direction that fails loudly rather than storing every tile with a
 * meaningless score. Without this the same value would reach the `UPDATE` and
 * raise a `23514` **after** both uploads had been paid for.
 */
export const CONFIDENCE_CEILING = 1.0

/**
 * Street-level or better, read from `properties.result_type`.
 *
 * **An allowlist, and that is the whole design.** The spec asks for the
 * vocabulary to be established before the gate is written; it cannot be, from
 * this container. So the unknown value is the one that must be safe: an
 * allowlist rejects anything it has not been told about, which costs a tile,
 * where a denylist would admit it, which is the confident-wrong tile this whole
 * change exists to prevent. A new vendor type therefore shows up as "no tile"
 * and never as "wrong tile".
 *
 * `building` is the only value anyone here has observed (`tasks.md` §0.8).
 * `amenity` and `street` come from the vendor's documented `result_type` list.
 * Everything else on that list — `postcode`, `suburb`, `district`, `city`,
 * `county`, `state`, `country`, `unknown` — is deliberately absent. `postcode`
 * is the interesting rejection: a Dutch postcode is one side of one street and
 * would be fine, a UK or US one is a district and would not, and the field does
 * not say which country's convention produced it.
 */
export const STREET_LEVEL_RESULT_TYPES: readonly string[] = ['building', 'amenity', 'street']

/**
 * The separation gate's threshold, **500 metres**.
 *
 * Chosen against what it protects rather than against anything in the geocoder:
 * how far wrong a rider can be sent before the tile is worse than no tile. Three
 * things fix it at roughly this size.
 *
 *   - **The panel is 1.05 km wide at z15.** Two candidates 500 m apart put the
 *     rider's actual meeting point at the very edge of the tile drawn for the
 *     other one; past that the panel is centred on somewhere they are not going.
 *   - **A wrong tile misleads orientation, not navigation.** `Get directions`
 *     deeplinks the `meeting_point` **text**, never the coordinate, so the harm
 *     is "this ride starts over there" pointing at the wrong there.
 *   - **It has to clear the duplicate-datasource case comfortably.** A vendor
 *     merging sources returns one building two or three times, metres apart;
 *     500 m keeps those together as one place, which is what stops a
 *     count-based rule refusing a perfectly unambiguous address for ever.
 *
 * The measured ambiguous case — Amsterdam and Weesp, 12.2 km — clears it by a
 * factor of 24, so the threshold is not finely balanced against the one sample
 * that motivated it.
 */
export const SEPARATION_THRESHOLD_METRES = 500

/**
 * `080`'s `rides_timezone_is_bounded`, restated for the same reason
 * `search-places/shape.ts` restates it: a value that overruns the CHECK turns a
 * good geocode into `column_write_refused`, which deletes both freshly uploaded
 * tiles. The longest name in the IANA database is
 * `America/Argentina/ComodRivadavia` at 32 characters.
 */
export const MAX_TIMEZONE_CHARS = 64

/* -------------------------------------------------------------------------- */
/* The two tiles                                                               */
/* -------------------------------------------------------------------------- */

export type TileSpec = {
  /** CSS pixels, before `SCALE_FACTOR`. */
  readonly width: number
  readonly height: number
  readonly zoom: number
  /** Burn a pin into the tile. False where the container draws its own. */
  readonly marker: boolean
}

/**
 * Two renders at two zooms, `design.md` §D4 — **not** one render cropped twice.
 * Zoom is not scale: at z15 an 80px-wide crop covers ~235 m and reads as
 * texture rather than as a place, and the strip's job is "this ride starts over
 * there", which needs the town in frame.
 *
 * The dimensions are the containers' own: `RideCard`'s strip is `w-20` (80) by
 * 148, `RideMap`'s panel is `h-40` (160) across the page's 358.
 *
 * **Both zooms are 7, and both are marked "to try" rather than settled.**
 * Product owner, 2026-08-27, on the first tiles they could actually see —
 * *"zoom 7 seems okay to try"* for the card, then *"Both maps seem to be very
 * zoomed in. Can we zoom out to 7?"* for both. They were 13 and 15, and neither
 * had ever been judged against a visible map: the burned-in credit covered the
 * card and nobody had questioned the panel.
 *
 * **What z7 actually shows, MEASURED against real renders rather than derived.**
 * The obvious calculation is wrong here and wrong in the alarming direction:
 * Web-Mercator's `156543.03 / 2^zoom` metres per pixel, times `cos(52°)`, says a
 * 358px panel covers ~270 km at z7 — country scale, useless. Real renders on
 * 2026-08-27 put it nearer **65 km**, about 4× tighter, because `scaleFactor`
 * and this vendor's zoom origin both cut against the naive figure.
 *
 * So, from images rather than arithmetic, at 358×160 `scaleFactor=2`:
 *
 *   z7  → Alkmaar to Utrecht, coast to Lelystad — the city AND its region
 *   z11 → central Amsterdam, canals and district names
 *   z13 → streets
 *
 * And at the 80×148 card, z7 keeps two town names legible, which is the strip's
 * whole job — "this ride starts over there".
 *
 * **Do not re-derive this from the formula.** It is the trap this comment
 * exists for: the number it gives looks measured, is four times too big, and
 * argues for a zoom nobody wants.
 */
export const TILE_SPECS = {
  card: { width: 80, height: 148, zoom: 7, marker: false },
  detail: { width: 358, height: 160, zoom: 7, marker: true },
} as const satisfies Record<string, TileSpec>

export type TileKind = keyof typeof TILE_SPECS

/* -------------------------------------------------------------------------- */
/* Storage paths                                                               */
/* -------------------------------------------------------------------------- */

export const RIDE_MAPS_FOLDER = 'ride-maps'

/**
 * `ride-maps/<organizer uuid>/<object uuid>.jpg` — the shape `051` pins with a
 * CHECK on both path columns *and* with the filename regex in its Storage INSERT
 * policy, and the same shape every other folder in the bucket uses.
 *
 * `.jpg`, never `.png`: the `media` bucket carries
 * `allowed_mime_types = ['image/jpeg']`, which refuses at the bucket, **above
 * every policy**, with nothing in the policy set to explain it.
 *
 * The names are generated by the caller and held for the whole flow, because the
 * compensating delete in `index.ts` needs them at a moment when no row records
 * them — see that file's §8.
 */
export function buildRideMapPath(organizerId: string, objectId: string): string {
  return `${RIDE_MAPS_FOLDER}/${organizerId}/${objectId}.jpg`
}

/* -------------------------------------------------------------------------- */
/* The outbound requests                                                       */
/* -------------------------------------------------------------------------- */

export function buildGeocodeUrl(meetingPoint: string, apiKey: string): string {
  const url = new URL(GEOCODE_ENDPOINT)
  url.searchParams.set('text', meetingPoint)
  url.searchParams.set('limit', String(GEOCODE_CANDIDATE_LIMIT))
  url.searchParams.set('format', 'geojson')
  url.searchParams.set('apiKey', apiKey)
  return url.toString()
}

/**
 * **This sends `attribution=none`, so the tile carries no credit and the app
 * carries it instead.** The obligation is unchanged and undischargeable by any
 * plan — Geoapify's own instruction is that *"you need to care about
 * attributions yourself when you hide the automatically added attribution"* —
 * and `MapAttribution` is where this repo takes it. See `ATTRIBUTION_MODE`.
 *
 * Until 2026-08-27 this comment said the opposite, on the reasoning that
 * suppression *"would move the obligation onto an 80px strip that cannot carry
 * the string"*. The premise was right and the conclusion was not: the string
 * does not have to sit inside the image. Rendered as HTML over the tile it is
 * legible at any tile size, which is the Leaflet pattern the vendor's own
 * guidance names — *"the credit should typically appear in the corner of the
 * map"*.
 */
export function buildTileUrl(
  spec: TileSpec,
  coordinate: { latitude: number; longitude: number },
  apiKey: string,
): string {
  const url = new URL(STATIC_MAP_ENDPOINT)
  url.searchParams.set('style', MAP_STYLE)
  url.searchParams.set('width', String(spec.width))
  url.searchParams.set('height', String(spec.height))
  url.searchParams.set('scaleFactor', String(SCALE_FACTOR))
  // `lonlat:` — longitude first, which is the opposite order to every other
  // place this repo writes a coordinate. Swapping them yields a valid request
  // for a plausible-looking place somewhere else entirely.
  url.searchParams.set('center', `lonlat:${coordinate.longitude},${coordinate.latitude}`)
  url.searchParams.set('zoom', String(spec.zoom))
  // The card draws its own pin in HTML over the tile — see `MARKER_STYLE`.
  if (spec.marker) {
    url.searchParams.set(
      'marker',
      `lonlat:${coordinate.longitude},${coordinate.latitude};${MARKER_STYLE}`,
    )
  }
  // JPEG, never PNG — see `buildRideMapPath`.
  url.searchParams.set('format', 'jpeg')
  // Ships with `MapAttribution` or not at all — see `ATTRIBUTION_MODE`.
  url.searchParams.set('attribution', ATTRIBUTION_MODE)
  url.searchParams.set('apiKey', apiKey)
  return url.toString()
}

/* -------------------------------------------------------------------------- */
/* The response, and what this file refuses to read from it                    */
/* -------------------------------------------------------------------------- */

/**
 * **`rank.importance` and `rank.popularity` are deliberately absent from this
 * type.** Both are in every response and both are vendor *relevance* signals —
 * how prominent a place is — which carry no information about which town the
 * rider meant. Breaking a disagreement on either stores a coordinate
 * indistinguishable from a correct one, which is the exact failure the
 * separation gate exists to prevent. Leaving them out of the type is the cheapest
 * possible enforcement: reaching for one does not compile.
 *
 * `rank.match_type` is absent for the same reason. It describes how the *query*
 * matched and returns `full_match` for a city as readily as for a building, so a
 * gate reading it admits precisely the city-level match this change rejects.
 */
export type GeocodeFeature = {
  properties?: {
    lat?: unknown
    lon?: unknown
    /** The granularity field, and note it is NOT inside `rank`. */
    result_type?: unknown
    rank?: {
      confidence?: unknown
      /** Corroboration only — never the primary granularity test. */
      confidence_street_level?: unknown
    }
    /**
     * The IANA zone the point is in — PD-193's half, and the reason that story
     * could be built at all: it arrives on a call this function already makes
     * and already pays for.
     *
     * **Only `name` is read.** The vendor documents `offset_STD`, `offset_DST`
     * and two abbreviations beside it; all four are derivable from the name and
     * all four go stale with the tz database, so storing one would be storing a
     * fact with an expiry date. Absent from the type for the same reason
     * `rank.importance` is: reaching for one does not compile.
     *
     * Documentation-derived and unverified against a live response —
     * `*.geoapify.com` is egress-blocked from the build container. A shape
     * guessed wrong yields `null`, which is `rides.timezone`'s own "we do not
     * know" and the clock every ride had before this.
     */
    timezone?: { name?: unknown }
  }
}

export type GeocodeResponse = { features?: GeocodeFeature[] | null }

export type Candidate = {
  latitude: number
  longitude: number
  confidence: number
  resultType: string
  streetLevelConfidence: number | null
  /**
   * **Not a gate, and it must never become one.** Every other field on a
   * candidate can refuse it; this one is carried through the gates and read off
   * the winner. A missing or malformed zone is a ride on `APP_TIME_ZONE`, which
   * is where every ride was until `080` — refusing a good coordinate over it
   * would trade a map for a clock.
   */
  timezone: string | null
}

export type GeocodeVerdict =
  | {
      resolved: true
      latitude: number
      longitude: number
      confidence: number
      /** The winner's zone, or `null`. See `Candidate.timezone`. */
      timezone: string | null
    }
  | {
      resolved: false
      /**
       * Why nothing was stored. Carried for the function's log line only — every
       * value produces the identical rider-visible outcome, which is the ride
       * saving normally with NULL columns and both screens on their fallback.
       */
      reason: 'no_candidates' | 'granularity' | 'confidence' | 'ambiguous'
    }

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function toCandidate(feature: GeocodeFeature): Candidate | null {
  const properties = feature?.properties
  const latitude = properties?.lat
  const longitude = properties?.lon
  const resultType = properties?.result_type
  const confidence = properties?.rank?.confidence
  const streetLevel = properties?.rank?.confidence_street_level

  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null
  if (!isFiniteNumber(confidence)) return null
  if (typeof resultType !== 'string') return null
  // Out-of-range coordinates would be refused by `051`'s coupling CHECK anyway;
  // catching them here means the refusal costs no render rather than two.
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null

  // Shape only, never membership: whether this names a REAL zone is `080`'s
  // `enforce_ride_timezone`, against `pg_timezone_names`. What is bounded here
  // is the two things that would reach the rider as a refused write rather than
  // a missing clock — `rides_timezone_is_bounded`'s 64 characters, and anything
  // that is not an `Area/Location` name at all.
  const zone = properties?.timezone?.name
  const timezone =
    typeof zone === 'string' &&
    zone.trim().length > 0 &&
    zone.trim().length <= MAX_TIMEZONE_CHARS &&
    /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(zone.trim())
      ? zone.trim()
      : null

  return {
    latitude,
    longitude,
    confidence,
    resultType,
    streetLevelConfidence: isFiniteNumber(streetLevel) ? streetLevel : null,
    timezone,
  }
}

/** Haversine, metres. Earth radius 6 371 008.8 m (IUGG mean). */
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_008.8
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The three gates, **in this order**, on the candidates the vendor returned.
 *
 * **The order is correctness, not cost**, and the first draft of `design.md`
 * §D3 had it the other way round on the reasoning that separation is the
 * cheapest test. Testing separation across *raw* candidates measures the
 * distance between things granularity is about to discard: `[building, city]` is
 * an ordinary response for a street address in a named city, and separation-first
 * rejects it although exactly one usable candidate existed.
 *
 * Failing any gate writes nothing, renders nothing, and leaves all five columns
 * NULL. That is not an error path — an ambiguous address is a legitimate thing
 * to type, and today's screens print the rider's own words and are never wrong.
 *
 * **What this does not do, stated so it is not assumed.** It bounds *ambiguity*
 * and *granularity*, never *wrongness*. A response containing only Weesp passes
 * every gate here and the tile ships. The asymmetry — no tile for an ambiguous
 * address, a wrong tile for one that resolves cleanly to the wrong building — is
 * a KNOWN GAP in the spec rather than something this function solves.
 */
export function resolveCoordinate(response: GeocodeResponse | null | undefined): GeocodeVerdict {
  const candidates = (response?.features ?? [])
    .map(toCandidate)
    .filter((candidate): candidate is Candidate => candidate !== null)

  if (candidates.length === 0) return { resolved: false, reason: 'no_candidates' }

  // 1. Granularity, from `result_type`.
  const streetLevel = candidates.filter((candidate) =>
    STREET_LEVEL_RESULT_TYPES.includes(candidate.resultType),
  )
  if (streetLevel.length === 0) return { resolved: false, reason: 'granularity' }

  // 2. The numeric floor, with its fail-closed upper arm. `confidence_street_level`
  //    is corroboration and nothing more: it can only ever *remove* a candidate
  //    the primary gates already admitted, never promote one they rejected, so a
  //    vendor that stops emitting it changes nothing.
  const confident = streetLevel.filter(
    (candidate) =>
      candidate.confidence >= CONFIDENCE_FLOOR &&
      candidate.confidence <= CONFIDENCE_CEILING &&
      (candidate.streetLevelConfidence === null ||
        candidate.streetLevelConfidence >= CONFIDENCE_FLOOR),
  )
  if (confident.length === 0) return { resolved: false, reason: 'confidence' }

  // 3. Separation, among the survivors of 1 and 2 only, keyed on DISTANCE and
  //    never on a tie in the score. Confidence SATURATES — the measured pair tied
  //    at the ceiling rather than because they were equally good — so the same two
  //    towns returned as 1.00 and 0.97 carry the identical harm and would sail past
  //    a tie test, while two datasource copies of one building tie exactly at 0 m
  //    and are not ambiguous at all.
  for (let i = 0; i < confident.length; i += 1) {
    for (let j = i + 1; j < confident.length; j += 1) {
      if (distanceMetres(confident[i], confident[j]) > SEPARATION_THRESHOLD_METRES) {
        return { resolved: false, reason: 'ambiguous' }
      }
    }
  }

  // Every survivor is within the threshold of every other, so they describe one
  // place and the vendor's own ordering picks among equals. This is NOT breaking
  // a disagreement — there is none left — and it reads no relevance signal to do
  // it, because `GeocodeFeature` does not carry one.
  const best = confident[0]
  return {
    resolved: true,
    latitude: best.latitude,
    longitude: best.longitude,
    confidence: best.confidence,
    timezone: best.timezone,
  }
}

/* -------------------------------------------------------------------------- */
/* The picked-ride branch                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a ride carries before anything is geocoded — PD-114 §D6.
 *
 * A rider who picked a place from the search sheet has already given us an
 * exact coordinate, so geocoding their free text can only produce a worse
 * answer and would be paid for. `067` records the pick as a `start_place_id`
 * beside the coordinate and NO `geocode_confidence`, which is what makes
 * "the rider chose this" and "a geocoder guessed it" different rows rather than
 * a convention.
 *
 * **All three or none, and the check is deliberately not just the place id.**
 * `rides_location_coupling`'s picked arm requires the trio, so a place id
 * without coordinates cannot be stored — but this function runs against rows a
 * future migration might reshape, and a `null` latitude reaching `buildTileUrl`
 * renders a tile of the Gulf of Guinea rather than failing. Reading all three is
 * one comparison and removes that class of outcome entirely.
 *
 * Lives here rather than in `index.ts` for §6.2's reason: a decision that moves
 * into the handler leaves `ride-geocode-gates.test.ts` behind, and this is the
 * branch that decides whether a rider is billed.
 */
export type PickedRide = { latitude: number; longitude: number }

export function resolvePickedCoordinate(ride: {
  start_place_id?: string | null
  latitude?: number | null
  longitude?: number | null
}): PickedRide | null {
  const placeId = ride.start_place_id?.trim()
  if (!placeId) return null
  if (typeof ride.latitude !== 'number' || typeof ride.longitude !== 'number') return null
  if (!Number.isFinite(ride.latitude) || !Number.isFinite(ride.longitude)) return null
  return { latitude: ride.latitude, longitude: ride.longitude }
}
