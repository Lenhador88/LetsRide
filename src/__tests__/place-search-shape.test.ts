import { describe, expect, it } from 'vitest'
import {
  APP_DAILY_SEARCH,
  boundTerm,
  buildAutocompleteUrl,
  buildLocalityUrl,
  CANDIDATE_LIMIT,
  ID_NAMESPACE,
  isSearchable,
  MAX_PLACE_ID_CHARS,
  MAX_TERM_CHARS,
  MIN_TERM_CHARS,
  parseRequest,
  PER_RIDER_DAILY,
  PER_RIDER_HOURLY,
  toLocalityResult,
  toPlaceResult,
  toPlaceResults,
  type AutocompleteFeature,
  type PlaceResult,
} from '../../supabase/functions/search-places/shape'
import type { PlaceSearchResult } from '@/types'

/**
 * `search-places/shape.ts` — every decision the typeahead proxy makes.
 *
 * ---------------------------------------------------------------------------
 * Why this test reaches outside `src/`, and why it is the only guard there is
 * ---------------------------------------------------------------------------
 * `tsconfig.json` excludes `supabase/functions`, so `npx tsc --noEmit` does not
 * type-check the proxy and neither does `next build`. Importing `shape.ts` from
 * here is what drags it back under the compiler *and* under Vitest — the same
 * arrangement `ride-geocode-gates.test.ts` has with `gates.ts`, for the same
 * reason. `index.ts` stays unreachable from here on purpose: it holds Deno
 * globals and `jsr:` specifiers, and the split is what keeps every decision
 * testable.
 *
 * ---------------------------------------------------------------------------
 * What this CANNOT tell you
 * ---------------------------------------------------------------------------
 * **Not one request has been issued to the vendor.** `*.geoapify.com` is
 * egress-blocked from the build container, so every payload below is
 * hand-written against the vendor's *documented* GeoJSON shape rather than
 * captured from a response. Tasks 0.1 and 0.3 in
 * `openspec/changes/replace-places-index-with-geocoder/tasks.md` are the live
 * calls that replace them, and both are still open.
 *
 * So these tests prove the mapping does what this repo intends. They cannot
 * prove the vendor sends what this repo expects. **Do not read "the tests pass"
 * as "the vendor agrees"** — the same warning `resolve-ride-location` carries,
 * and it is more load-bearing here, because that function had at least been
 * called in production by the time its constants were written.
 */

/** A key-shaped literal. 32 lowercase hex, the vendor's real format. */
const KEY = '0123456789abcdef0123456789abcdef'

const feature = (properties: Record<string, unknown>): AutocompleteFeature => ({ properties })

describe('the outbound request', () => {
  it('carries the key, the term and the candidate limit', () => {
    const url = new URL(buildAutocompleteUrl('Willem Claijstraat Berkhout', null, KEY))

    expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/autocomplete')
    expect(url.searchParams.get('text')).toBe('Willem Claijstraat Berkhout')
    expect(url.searchParams.get('apiKey')).toBe(KEY)
    expect(url.searchParams.get('limit')).toBe(String(CANDIDATE_LIMIT))
    expect(url.searchParams.get('format')).toBe('geojson')
  })

  it('biases by proximity with longitude FIRST', () => {
    // The opposite order to every other coordinate this repo writes, and the
    // same trap `buildTileUrl` carries. Swapping them yields a valid request
    // biased toward a plausible-looking place somewhere else entirely — so this
    // asserts the literal string rather than "contains both numbers".
    const url = new URL(buildAutocompleteUrl('Berkhout', { lat: 52.63, lon: 4.99 }, KEY))
    expect(url.searchParams.get('bias')).toBe('proximity:4.99,52.63')
  })

  it('omits the bias entirely when no location is known', () => {
    const url = new URL(buildAutocompleteUrl('Berkhout', null, KEY))
    expect(url.searchParams.has('bias')).toBe(false)
  })

  it('filters by no country', () => {
    // §D8. An NL-only filter would preserve today's accident (the extract is an
    // NL extract) as a rule, and return nothing for a ride into Belgium, which
    // reads to the rider as "no matches" and cannot be fixed by typing
    // differently. Bias reorders; it must never exclude.
    const url = new URL(buildAutocompleteUrl('Zwevegem', { lat: 52.63, lon: 4.99 }, KEY))
    expect(url.searchParams.has('filter')).toBe(false)
    expect(url.searchParams.has('countrycode')).toBe(false)
    expect(url.toString()).not.toMatch(/countrycode/i)
  })

  it('sends no rider identity of any kind', () => {
    const url = buildAutocompleteUrl('Kerkstraat 40', { lat: 52.63, lon: 4.99 }, KEY)
    for (const forbidden of ['user', 'uid', 'session', 'token', 'authorization', 'email']) {
      expect(url.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('asks the locality mode for one city and nothing else', () => {
    const url = new URL(buildLocalityUrl('Amsterdam', KEY))
    expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/search')
    expect(url.searchParams.get('limit')).toBe('1')
    expect(url.searchParams.get('type')).toBe('city')
    expect(url.searchParams.get('apiKey')).toBe(KEY)
  })

  it('escapes a term rather than letting it build the query', () => {
    const url = new URL(buildAutocompleteUrl('Kerk&apiKey=stolen straat', null, KEY))
    expect(url.searchParams.get('apiKey')).toBe(KEY)
    expect(url.searchParams.get('text')).toBe('Kerk&apiKey=stolen straat')
  })
})

describe('the term bound', () => {
  it('truncates an over-long term rather than refusing it', () => {
    // Truncating means a rider who pastes something long still gets an answer.
    const long = 'a'.repeat(MAX_TERM_CHARS + 500)
    expect(boundTerm(long)).toHaveLength(MAX_TERM_CHARS)
    expect(new URL(buildAutocompleteUrl(long, null, KEY)).searchParams.get('text')).toHaveLength(
      MAX_TERM_CHARS,
    )
  })

  it('normalises every separator the two runtimes disagree about', () => {
    // U+0085 and the C0 separators are token separators to some parsers and are
    // NOT matched by JavaScript's `\s`. Splitting on a superset and rejoining
    // with U+0020 means whatever receives this cannot split it differently
    // than we did.
    expect(boundTerm('Kerkstraat\t40\u001cBerkhout\u0085test')).toBe(
      'Kerkstraat 40 Berkhout test',
    )
  })

  it('leaves format characters alone', () => {
    // `\p{Cf}` is deliberately absent from the split class: stripping format
    // characters corrupts legitimate text, ZWJ sequences most obviously.
    expect(boundTerm('a\u200bb')).toBe('a\u200bb')
  })

  it('refuses below the floor and admits at it, in search mode', () => {
    expect(MIN_TERM_CHARS).toBe(4)
    expect(isSearchable('sta')).toBe(false)
    expect(isSearchable('stat')).toBe(true)
    // Whitespace does not buy a rider past the floor.
    expect(isSearchable('  a  ')).toBe(false)
  })

  it('does NOT apply the floor to the locality mode', () => {
    // The floor is about typing. A locality term is a stored, complete
    // `profiles.location`, and carrying the floor across would silently drop
    // real Dutch cities — `Ede` is ~120k people — taking the "X km away" labels
    // and near-first ordering off `/clubs` for everyone who lives in one.
    for (const city of ['Ede', 'Oss', 'Epe', 'Ens', 'Hem']) {
      expect(isSearchable(city, 'locality')).toBe(true)
      expect(isSearchable(city, 'search')).toBe(false)
    }
    // Empty is still refused in both — there is nothing to resolve.
    expect(isSearchable('', 'locality')).toBe(false)
    expect(isSearchable('   ', 'locality')).toBe(false)
  })

  it('defaults to the stricter mode when none is named', () => {
    // A caller that forgets the argument must get the floor, not lose it.
    expect(isSearchable('Ede')).toBe(false)
  })

  it('does not bound by token count', () => {
    // The eight-token cap was a property of `search_places()`'s per-token ILIKE
    // plan. The vendor charges one credit whatever the token count, so a token
    // cap here would bound a cost that is gone while narrowing a long address.
    const many = 'Jumbo Maastricht Stationsweg 40 near the second roundabout by the church'
    expect(boundTerm(many)).toBe(many)
  })
})

describe('mapping a vendor feature to this repo own shape', () => {
  const full = feature({
    place_id: '514533f150acfb1e4059b3e2',
    name: 'Jumbo',
    address_line1: 'Jumbo',
    address_line2: 'Stationsweg 40, Maastricht',
    formatted: 'Jumbo, Stationsweg 40, Maastricht',
    lat: 50.85,
    lon: 5.69,
  })

  it('maps to exactly the fields the client already consumes', () => {
    expect(toPlaceResult(full)).toEqual({
      id: `${ID_NAMESPACE}514533f150acfb1e4059b3e2`,
      label: 'Jumbo',
      meta: 'Stationsweg 40, Maastricht',
      lat: 50.85,
      lon: 5.69,
    })
  })

  it('namespaces the id so a row provider is readable from the value', () => {
    expect(toPlaceResult(full)!.id.startsWith('geoapify:')).toBe(true)
  })

  it('falls back through name, then address_line1, then formatted', () => {
    const bare = feature({
      place_id: 'x1',
      formatted: 'Willem Claijstraat 22, Berkhout',
      lat: 1,
      lon: 2,
    })
    expect(toPlaceResult(bare)!.label).toBe('Willem Claijstraat 22, Berkhout')

    const line1 = feature({
      place_id: 'x2',
      address_line1: 'Willem Claijstraat 22',
      formatted: 'ignored',
      lat: 1,
      lon: 2,
    })
    expect(toPlaceResult(line1)!.label).toBe('Willem Claijstraat 22')
  })

  it('returns a null meta rather than repeating the label as its own second line', () => {
    const echo = feature({ place_id: 'x3', name: 'Berkhout', address_line2: 'Berkhout', lat: 1, lon: 2 })
    expect(toPlaceResult(echo)!.meta).toBeNull()
  })

  it('returns a null meta when the place has no second line at all', () => {
    const none = feature({ place_id: 'x4', name: 'Berkhout', lat: 1, lon: 2 })
    // A first-class case the surface already handles: it draws one line rather
    // than an empty second one, exactly as `search_places()`'s `nullif` did.
    expect(toPlaceResult(none)!.meta).toBeNull()
  })
})

describe('what the mapping DROPS rather than coerces', () => {
  // The contract: a result that reaches the client is one that can be stored,
  // biased from and put on a map. Coercing instead would render a tappable row
  // that silently writes a broken ride.
  it('drops a feature with no coordinate rather than mapping it to NaN', () => {
    expect(toPlaceResult(feature({ place_id: 'x', name: 'Nowhere' }))).toBeNull()
  })

  it('drops a coordinate that arrives as a string', () => {
    expect(toPlaceResult(feature({ place_id: 'x', name: 'N', lat: '52.6', lon: 4.9 }))).toBeNull()
  })

  it('drops a non-finite coordinate', () => {
    expect(toPlaceResult(feature({ place_id: 'x', name: 'N', lat: NaN, lon: 4.9 }))).toBeNull()
    expect(toPlaceResult(feature({ place_id: 'x', name: 'N', lat: Infinity, lon: 4.9 }))).toBeNull()
  })

  it('drops a coordinate the destination column would refuse', () => {
    // Finite is not the same as valid. `rides_location_coupling` and
    // `clubs_location_coupling` both require lat within ±90 and lon within
    // ±180, so a finite-but-out-of-range value maps cleanly, renders as a
    // tappable result, and raises `23514` at write time on a value the rider
    // can neither see nor shorten.
    expect(toPlaceResult(feature({ place_id: 'x', name: 'N', lat: 91, lon: 4 }))).toBeNull()
    expect(toPlaceResult(feature({ place_id: 'x', name: 'N', lat: -90.1, lon: 4 }))).toBeNull()
    expect(toPlaceResult(feature({ place_id: 'x', name: 'N', lat: 52, lon: 180.5 }))).toBeNull()
    expect(toPlaceResult(feature({ place_id: 'x', name: 'N', lat: 52, lon: -181 }))).toBeNull()
    // The boundaries themselves are valid.
    expect(toPlaceResult(feature({ place_id: 'x', name: 'N', lat: 90, lon: -180 }))).not.toBeNull()
  })

  it('bounds the locality centroid the same way', () => {
    // Quieter failure, same cause: this coordinate feeds the distance
    // arithmetic behind "X km away", so out of range is a wrong number rather
    // than a refused write.
    expect(toLocalityResult({ features: [feature({ lat: 91, lon: 4 })] })).toBeNull()
    expect(toLocalityResult({ features: [feature({ lat: 52.4, lon: 4.9 })] })).toEqual({
      lat: 52.4,
      lon: 4.9,
    })
  })

  it('drops a feature with no id, and one with no usable label', () => {
    expect(toPlaceResult(feature({ name: 'N', lat: 1, lon: 2 }))).toBeNull()
    expect(toPlaceResult(feature({ place_id: 'x', lat: 1, lon: 2 }))).toBeNull()
  })

  it('drops an id that would not fit the column', () => {
    // `069` widens both CHECKs to 512. An id past that is refused HERE, because
    // the alternative is a `23514` at write time on a value the rider can
    // neither see nor shorten.
    const huge = 'a'.repeat(MAX_PLACE_ID_CHARS + 1)
    expect(toPlaceResult(feature({ place_id: huge, name: 'N', lat: 1, lon: 2 }))).toBeNull()
  })

  it('keeps the vendor order and drops only the unusable rows', () => {
    const results = toPlaceResults({
      features: [
        feature({ place_id: 'a', name: 'First', lat: 1, lon: 2 }),
        feature({ place_id: 'b', name: 'Broken' }),
        feature({ place_id: 'c', name: 'Third', lat: 3, lon: 4 }),
      ],
    })
    expect(results.map((r) => r.label)).toEqual(['First', 'Third'])
  })

  it('survives a response that is empty, malformed or absent', () => {
    expect(toPlaceResults(null)).toEqual([])
    expect(toPlaceResults(undefined)).toEqual([])
    expect(toPlaceResults({})).toEqual([])
    expect(toPlaceResults({ features: null })).toEqual([])
    expect(toLocalityResult({ features: [] })).toBeNull()
    expect(toLocalityResult(null)).toBeNull()
  })
})

describe('the request this function accepts', () => {
  it('has no field for a user id, in either mode', () => {
    // Rule 2. The subject comes from the verified JWT and nowhere else, so a
    // body naming a user must not be able to move it.
    const parsed = parseRequest({ mode: 'search', text: 'Berkhout', user_id: 'someone-else' })
    expect(parsed).toEqual({ mode: 'search', text: 'Berkhout', near: null })
    expect(Object.keys(parsed!)).toEqual(['mode', 'text', 'near'])
  })

  it('refuses a body that names no valid mode', () => {
    expect(parseRequest({ text: 'Berkhout' })).toBeNull()
    expect(parseRequest({ mode: 'delete', text: 'Berkhout' })).toBeNull()
    expect(parseRequest(null)).toBeNull()
    expect(parseRequest('search')).toBeNull()
  })

  it('collapses an out-of-range bias to no bias rather than refusing', () => {
    // What `search_places()` did with the same values: `between` is false for
    // NaN and either infinity, so all three become "no location" and the
    // unbiased path handles them.
    for (const near of [
      { lat: 91, lon: 4 },
      { lat: 52, lon: 181 },
      { lat: NaN, lon: 4 },
      { lat: Infinity, lon: 4 },
      { lat: '52', lon: 4 },
      'nearby',
    ]) {
      expect(parseRequest({ mode: 'search', text: 'Berkhout', near })?.near).toBeNull()
    }
  })

  it('accepts a bias at the range boundaries', () => {
    expect(parseRequest({ mode: 'search', text: 'x', near: { lat: -90, lon: 180 } })?.near).toEqual({
      lat: -90,
      lon: 180,
    })
  })
})

describe('the ceilings', () => {
  it('are ordered so the burst arm binds first', () => {
    // A rider who trips the hourly ceiling has not exhausted the daily one, and
    // the surface tells them apart because "wait" means an hour under one and
    // until tomorrow under the other.
    expect(PER_RIDER_HOURLY).toBeLessThan(PER_RIDER_DAILY)
  })

  it('leave the map a real reserve out of the shared daily quota', () => {
    // Search fails loudly; `resolve-ride-location` fails OPEN — no map, no
    // message, nobody told. So an unrationed typeahead degrades the thing with
    // no error path at all. 3,000 is the vendor's documented free-plan quota.
    const VENDOR_DAILY_CREDITS = 3000
    expect(APP_DAILY_SEARCH).toBeLessThan(VENDOR_DAILY_CREDITS)
    expect(VENDOR_DAILY_CREDITS - APP_DAILY_SEARCH).toBeGreaterThanOrEqual(1000)
  })

  it('cannot be reached by one rider alone', () => {
    // Whatever the ceiling, one rider must not be able to spend the app's day.
    expect(PER_RIDER_DAILY).toBeLessThan(APP_DAILY_SEARCH)
  })
})

describe('the contract with the client', () => {
  it('is structurally the type the client already consumes', () => {
    // `shape.ts` cannot import from `src/` — the Deno runtime does not resolve
    // the `@/` alias — so `PlaceResult` is declared structurally there and
    // pinned to the real type HERE. Without this the two drift silently, and
    // the failure is a screen rendering `undefined`.
    const mapped = toPlaceResult(
      feature({ place_id: 'x', name: 'Jumbo', address_line2: 'Maastricht', lat: 1, lon: 2 }),
    )!
    const asClientType: PlaceSearchResult = mapped
    const backAgain: PlaceResult = asClientType
    expect(backAgain).toBe(mapped)
  })
})
