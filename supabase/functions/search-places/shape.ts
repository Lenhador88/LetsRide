/**
 * search-places — every decision the proxy makes, in plain TypeScript.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 * `tsconfig.json` excludes `supabase/functions`, because Deno's `Deno.env`,
 * `Deno.serve` and `jsr:` specifiers do not resolve under the Next compiler and
 * would take CI's whole Type Check job down. So **nothing type-checks
 * `index.ts`** — not `tsc`, not `next build`, not Vitest, not the RLS suite.
 *
 * `resolve-ride-location/gates.ts` answers that by splitting the decisions out
 * of the wiring, and this is the same split for the same reason:
 * `src/__tests__/place-search-shape.test.ts` imports this file, so `tsc`
 * follows it in and Vitest asserts it. **Keep the split.** A decision that
 * migrates into `index.ts` is a decision that leaves the test suite, silently.
 *
 * Nothing here imports a Deno global, a `jsr:` specifier, or issues a request.
 *
 * ---------------------------------------------------------------------------
 * NOT ONE REQUEST IN THIS FILE HAS BEEN ISSUED
 * ---------------------------------------------------------------------------
 * `*.geoapify.com` is egress-blocked from the build container — `WebFetch`
 * returns `EGRESS_BLOCKED` and so does `curl` through the agent proxy. Every
 * constant below is marked **measured**, **documentation-derived** or
 * **assumed**, and the middle one is the common case here: better than a guess,
 * not a substitute for a response. `openspec/changes/…/tasks.md` §0 carries the
 * live calls that convert them, and **task 0.1 is still open — the premise that
 * this vendor can find a residential street is evidenced, not exercised.**
 *
 * Do not read "the tests pass" as "the vendor agrees."
 */

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Autocomplete rather than the forward-geocoding endpoint `resolve-ride-location`
 * uses. Different job: this one is called per keystroke and is built to rank
 * partial input, where `/geocode/search` expects a complete address.
 *
 * Documentation-derived. <https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/>
 */
export const AUTOCOMPLETE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/autocomplete'

/**
 * The `locality` mode's endpoint — full geocoding, not autocomplete, because the
 * input is a complete free-text city from onboarding rather than partial typing.
 * Same host, same key, same credit.
 */
export const GEOCODE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/search'

/* -------------------------------------------------------------------------- */
/* The term bound                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Below this the proxy returns `[]` without calling the vendor at all.
 *
 * **Carried over from `src/lib/data/places.ts` deliberately, and the reason has
 * changed underneath it.** Four characters was a cost rule about a shared
 * database: `search_places()`'s national pass measured 996 ms for `sta`, so the
 * client chose not to fire the worst common case. The database's own floor —
 * three consecutive alphanumerics — was the *security* half, and it goes away
 * with the function.
 *
 * The number survives because the new cost is a credit rather than a
 * round trip, which makes the argument stronger rather than weaker: a
 * three-character term is both expensive and almost never what the rider meant.
 *
 * **It now lives on BOTH sides.** The client keeps its copy so a short term
 * costs no round trip; this copy is the one that binds, because a caller can
 * reach the function without going through our client at all. The client-side
 * floor is an optimisation; this is the rule.
 */
export const MIN_TERM_CHARS = 4

/**
 * The upper bound, in characters rather than tokens.
 *
 * **This is deliberately NOT `PLACE_SEARCH_MAX_TOKENS`, and the change of unit
 * is the point.** That eight-token cap existed because `search_places()` ANDed
 * one `ILIKE` per token, so ten tokens multiplied the per-row work tenfold —
 * a property of a Postgres query plan that no longer exists. The vendor charges
 * one credit for a one-token query and one credit for a twenty-token query, so
 * token count now costs nothing and only length does, by way of what a URL and
 * the vendor's own parser will accept.
 *
 * Keeping a token cap here would be cargo-cult: it would bound a cost that is
 * gone while silently narrowing a legitimate long address. `resolve-ride-location`
 * bounds its own text the same way, by length.
 *
 * Assumed. 200 is comfortably past any real address and short enough that a
 * pasted paragraph cannot build a pathological URL.
 */
export const MAX_TERM_CHARS = 200

/**
 * Normalises whitespace and bounds the length, unconditionally.
 *
 * **The unconditional part is inherited from `boundTerm()` in
 * `src/lib/data/places.ts` and the reason survives the move**, in a weaker form
 * that is still worth keeping: that function had to guarantee a token count
 * across two runtimes that disagree about which code points are whitespace, and
 * the fix was to split on a superset and rejoin with U+0020 so the receiver
 * could only ever agree. There is no token count to guarantee any more, but
 * normalising still means the outbound URL carries no C0 separator or U+0085
 * that a vendor parser might treat as a delimiter we did not intend.
 *
 * `\p{Cf}` stays deliberately absent, exactly as it is there: stripping format
 * characters would corrupt legitimate text, ZWJ sequences most obviously.
 *
 * Truncation is by characters and can therefore split a grapheme cluster. That
 * is acceptable here and would not be in a display string: the result is sent to
 * a search parser, never rendered, and a term this long is already not an
 * address.
 */
export function boundTerm(term: string): string {
  return term
    .split(/[\s\p{Zs}\p{Cc}]+/u)
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_TERM_CHARS)
}

/** Whether the term is worth a credit at all. Checked before anything billable. */
export function isSearchable(term: string): boolean {
  return boundTerm(term).length >= MIN_TERM_CHARS
}

/* -------------------------------------------------------------------------- */
/* The ceilings                                                                */
/* -------------------------------------------------------------------------- */

/**
 * **These constants are NOT the enforcement.** `069`'s INSERT policy on
 * `public.place_search_attempts` is, because this function is stateless and
 * multi-instance and cannot count for itself — the same reason `052` puts
 * `ride_map_render_attempts`' ceiling in its own policy rather than in
 * `resolve-ride-location`. They are here so the arithmetic that chose the
 * numbers lives beside the code that spends against it, and so a test can assert
 * the two files agree.
 *
 * ---------------------------------------------------------------------------
 * The arithmetic
 * ---------------------------------------------------------------------------
 * **Vendor inputs, all three DOCUMENTATION-DERIVED and none measured** — the
 * free plan is 3,000 credits/day and 5 requests/second
 * (<https://www.geoapify.com/pricing/>), and an Autocomplete request costs 1
 * credit, the same as a Geocoding request
 * (<https://apidocs.geoapify.com/docs/geocoding/pricing/>). Task 0.4 is what
 * makes them measured. **Paid tier: unknown, and left unknown.**
 *
 * Derived from those:
 *
 *   - A completed field costs roughly 3–8 credits: a 250 ms debounce, the
 *     four-character floor, one credit per pause in typing, plus one for a
 *     correction.
 *   - `resolve-ride-location` costs up to 3 credits per attempt — one geocode
 *     plus two static maps — and `052` permits 10 attempts per ride per 24 h, so
 *     one heavily-edited ride can cost 30.
 *   - So ~350–700 completed searches a day app-wide, once the map's share is
 *     reserved.
 *
 * **The reserve is the part that is not obvious.** Search fails LOUDLY — the
 * rider reads a message. `resolve-ride-location` fails OPEN: every vendor
 * failure returns `rendered: false`, the ride saves, no map appears and nobody
 * is told. An unrationed typeahead therefore does not degrade itself first, it
 * silently degrades the thing with no error path at all.
 */
export const PER_RIDER_HOURLY = 20

/** See `PER_RIDER_HOURLY`. About ten completed fields — well past honest use. */
export const PER_RIDER_DAILY = 60

/** Leaves 1,000 credits/day for geocoding and tiles. See `PER_RIDER_HOURLY`. */
export const APP_DAILY_SEARCH = 2000

/* -------------------------------------------------------------------------- */
/* The outbound requests                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How many candidates to ask for. Five is what the design's result sheet draws
 * and what `search_places()` returned, so the surface does not change shape.
 */
export const CANDIDATE_LIMIT = 5

/**
 * **No country filter, bias only — `design.md` §D8.** Today's search is NL-only
 * by accident, because the extract is an NL extract. A `countrycode` filter
 * would preserve that accident as a rule and return nothing for a ride into
 * Belgium or Germany, which reads to the rider as "no matches" and cannot be
 * fixed by typing differently.
 *
 * `bias=proximity:` widens rather than narrows: it reorders, it does not
 * exclude. Nothing findable today stops being findable.
 *
 * **`lon,lat` — longitude first**, which is the opposite order to every other
 * place this repo writes a coordinate, and the same trap `buildTileUrl` carries.
 * Swapping them yields a valid request biased toward a plausible-looking place
 * somewhere else entirely.
 */
export function buildAutocompleteUrl(
  term: string,
  near: { lat: number; lon: number } | null,
  apiKey: string,
): string {
  const url = new URL(AUTOCOMPLETE_ENDPOINT)
  url.searchParams.set('text', boundTerm(term))
  url.searchParams.set('limit', String(CANDIDATE_LIMIT))
  url.searchParams.set('format', 'geojson')
  if (near) url.searchParams.set('bias', `proximity:${near.lon},${near.lat}`)
  url.searchParams.set('apiKey', apiKey)
  return url.toString()
}

/**
 * The `locality` mode. One result is enough — the caller wants a centroid to
 * bias by, not a list to choose from — and `type=city` keeps a street from
 * answering a question about a town.
 */
export function buildLocalityUrl(term: string, apiKey: string): string {
  const url = new URL(GEOCODE_ENDPOINT)
  url.searchParams.set('text', boundTerm(term))
  url.searchParams.set('limit', '1')
  url.searchParams.set('type', 'city')
  url.searchParams.set('format', 'geojson')
  url.searchParams.set('apiKey', apiKey)
  return url.toString()
}

/* -------------------------------------------------------------------------- */
/* The response, and what this file refuses to read from it                    */
/* -------------------------------------------------------------------------- */

/**
 * **Written against the vendor's documented GeoJSON shape, NOT against a real
 * response** — task 0.3 is what replaces it with a measured payload, and until
 * then this type is the single most likely thing in the directory to be wrong.
 *
 * Every field is `unknown` rather than its expected type, for the reason
 * `GeocodeFeature` does the same: a documented field that arrives as a string
 * where a number was expected must fail the guard rather than reach a caller as
 * `NaN`.
 *
 * **`rank.importance`, `rank.popularity` and `rank.match_type` are deliberately
 * absent**, exactly as they are from `GeocodeFeature`. They are vendor relevance
 * signals, and this proxy does not re-rank: the vendor's own order is the order
 * the rider sees. Leaving them out of the type is the cheapest enforcement —
 * reaching for one does not compile.
 */
export type AutocompleteFeature = {
  properties?: {
    place_id?: unknown
    lat?: unknown
    lon?: unknown
    /** The display name — a POI or building name where one exists. */
    name?: unknown
    /** The whole address on one line. The fallback when `name` is absent. */
    formatted?: unknown
    /** The design's Label line, per the vendor's own split. */
    address_line1?: unknown
    /** The design's Meta line — street and locality, already comma-joined. */
    address_line2?: unknown
  }
}

export type AutocompleteResponse = { features?: AutocompleteFeature[] | null }

/** What the client already consumes. Structural, so `shape.ts` needs no import
 *  from `src/` — the Deno runtime cannot resolve the `@/` alias. The test file
 *  is what pins it to the real `PlaceSearchResult`. */
export type PlaceResult = {
  id: string
  label: string
  meta: string | null
  lat: number
  lon: number
}

/**
 * **The namespace is provenance and it is not decoration — `design.md` §D6.**
 * `rides.start_place_id` and `clubs.location_place_id` already hold Overture
 * GERS uuids on DEV. Prefixing every new id means a row's provider is readable
 * from the value itself for ever, so a later provider change is a new prefix
 * rather than an archaeology problem, and neither column ever needs a
 * migration to tell the two apart.
 */
export const ID_NAMESPACE = 'geoapify:'

/**
 * **The length this must fit is a CHECK, and the current one is too small.**
 * `066` and `067` bound both columns at 100 characters; the vendor's documented
 * sample `place_id` is **126 lowercase hex characters**, so on today's schema
 * every pick would raise `23514` on a value the rider can neither see nor
 * shorten. `069` widens both to 512.
 *
 * **512 is a bound, not the observed 126, and must not be trimmed toward it.**
 * The sample decodes to a 34-byte binary prefix (68 hex characters) followed by
 * the place name as hex-encoded UTF-8 — its tail is `Monument du Général Kléber`,
 * 29 bytes, and 68 + 2 × 29 = 126. So length is `68 + 2 × name bytes` and grows
 * with the name: a long Dutch name reaches ~175 before this prefix. That is a
 * formula read off one documented sample, not a maximum the vendor states.
 */
export const MAX_PLACE_ID_CHARS = 512

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

/**
 * Maps one vendor feature to this repo's own shape, or **drops it**.
 *
 * Dropping rather than coercing is the whole contract. A feature with no
 * coordinate cannot be stored, cannot be biased from and cannot be put on a map,
 * so a row that reached the client as `NaN` would render as a tappable result
 * that silently writes a broken ride. Four things are required and the rest is
 * cosmetic: an id that fits the column, a label, and two finite coordinates.
 *
 * **`label` falls back through three fields and `meta` is allowed to be null.**
 * `name` exists for a POI and not for a bare address; `address_line1` is the
 * vendor's own idea of the headline; `formatted` is the whole thing on one line
 * and always present. A null `meta` is a first-class case the surface already
 * handles — `search_places()` returned `nullif(concat_ws(…), '')` for exactly
 * this — and it draws one line instead of an empty second one.
 */
export function toPlaceResult(feature: AutocompleteFeature): PlaceResult | null {
  const properties = feature.properties ?? {}

  const rawId = asNonEmptyString(properties.place_id)
  if (!rawId) return null
  const id = `${ID_NAMESPACE}${rawId}`
  if (id.length > MAX_PLACE_ID_CHARS) return null

  const label =
    asNonEmptyString(properties.name) ??
    asNonEmptyString(properties.address_line1) ??
    asNonEmptyString(properties.formatted)
  if (!label) return null

  const lat = asFiniteNumber(properties.lat)
  const lon = asFiniteNumber(properties.lon)
  if (lat === null || lon === null) return null

  // Never repeat the label as its own second line: a POI whose address_line1 IS
  // the name renders as the same string twice, which reads as a duplicate result.
  const rawMeta = asNonEmptyString(properties.address_line2)
  const meta = rawMeta && rawMeta !== label ? rawMeta : null

  return { id, label, meta, lat, lon }
}

/** The vendor's order is preserved — this proxy does not re-rank. */
export function toPlaceResults(response: AutocompleteResponse | null | undefined): PlaceResult[] {
  const features = response?.features
  if (!Array.isArray(features)) return []
  return features.map(toPlaceResult).filter((r): r is PlaceResult => r !== null)
}

/**
 * The `locality` mode's answer. `place_count` is gone with the table that could
 * count rows, and nothing read it — `LocalityCentroid`'s own doc block describes
 * it as "a row count, not a confidence score".
 */
export type LocalityResult = { lat: number; lon: number }

export function toLocalityResult(
  response: AutocompleteResponse | null | undefined,
): LocalityResult | null {
  const properties = response?.features?.[0]?.properties
  if (!properties) return null
  const lat = asFiniteNumber(properties.lat)
  const lon = asFiniteNumber(properties.lon)
  if (lat === null || lon === null) return null
  return { lat, lon }
}

/* -------------------------------------------------------------------------- */
/* The request this function accepts                                           */
/* -------------------------------------------------------------------------- */

export type SearchMode = 'search' | 'locality'

export type ProxyRequest = {
  mode: SearchMode
  text: string
  near: { lat: number; lon: number } | null
}

/**
 * **No user id is read from the body, and there is no field for one.** The
 * subject comes from the verified JWT and nowhere else — rule 2 of
 * `resolve-ride-location`'s header, and the reason a confused function cannot
 * exceed its caller.
 *
 * A bias outside the valid coordinate range collapses to `null` rather than
 * being refused, which is what `search_places()` did with the same values:
 * `between` is false for NaN and for either infinity, so all three become "no
 * location" and the unbiased path handles them.
 */
export function parseRequest(body: unknown): ProxyRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = body as Record<string, unknown>

  const mode = raw.mode === 'locality' ? 'locality' : raw.mode === 'search' ? 'search' : null
  if (!mode) return null

  const text = typeof raw.text === 'string' ? raw.text : null
  if (text === null) return null

  const nearRaw = raw.near
  let near: { lat: number; lon: number } | null = null
  if (typeof nearRaw === 'object' && nearRaw !== null) {
    const candidate = nearRaw as Record<string, unknown>
    const lat = asFiniteNumber(candidate.lat)
    const lon = asFiniteNumber(candidate.lon)
    if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      near = { lat, lon }
    }
  }

  return { mode, text, near }
}
