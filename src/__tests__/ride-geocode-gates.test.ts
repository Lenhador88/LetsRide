import { describe, expect, it } from 'vitest'
import { MAP_CREDITS } from '@/components/rides/MapAttribution'
import {
  ATTRIBUTION_MODE,
  buildGeocodeUrl,
  buildRideMapPath,
  buildTileUrl,
  CONFIDENCE_FLOOR,
  distanceMetres,
  GEOCODE_CANDIDATE_LIMIT,
  MAX_TIMEZONE_CHARS,
  resolveCoordinate,
  SEPARATION_THRESHOLD_METRES,
  TILE_SPECS,
  type GeocodeFeature,
  resolvePickedCoordinate,
  MARKER_STYLE,
} from '../../supabase/functions/resolve-ride-location/gates'

/**
 * The three gates and the two outbound requests of `resolve-ride-location`.
 *
 * ---------------------------------------------------------------------------
 * Why this test reaches outside `src/`
 * ---------------------------------------------------------------------------
 * The Edge Function is Deno and `tsconfig.json` excludes `supabase/functions`,
 * so nothing in CI reads `index.ts` — it is the least-guarded code in the repo.
 * `gates.ts` is the half that was deliberately kept free of Deno globals and
 * `jsr:` imports so that this file can import it, which drags it back under both
 * `npx tsc --noEmit` and `npm run test:unit`. `exclude` stops a file being a
 * compilation root; it does not stop one being checked once an included file
 * imports it.
 *
 * The relative path is not a violation of the `@/*` rule, which is about imports
 * *within* `src/`. There is no alias that reaches out of it, and inventing one
 * would let app code import Edge Function code, which is the thing to avoid.
 *
 * ---------------------------------------------------------------------------
 * What these assertions can and cannot establish
 * ---------------------------------------------------------------------------
 * **`*.geoapify.com` is egress-blocked from this container, so every fixture
 * below is a transcription rather than a capture** — except the ambiguous pair,
 * which comes from a real response the product owner supplied (`tasks.md` §0.8).
 * Nothing here proves the vendor's parameter names, its `result_type`
 * vocabulary, or that `confidence` is on a 0–1 scale. It proves what this
 * function does with a response of a given shape, and what it asks for.
 *
 * The request assertions matter more than they look. The spec calls it out by
 * name: a fixture is a *response*, so a test built only from one passes green
 * against a pipeline whose real call asked for a single candidate — under which
 * the separation gate is structurally unable to fire while every scenario here
 * still passes.
 */

const AMSTERDAM = { latitude: 52.3784733, longitude: 4.9031499 }
/** Weesp, which merged into the Amsterdam *municipality* in 2022. */
const WEESP = { latitude: 52.3086, longitude: 5.0413 }

function feature(
  coordinate: { latitude: number; longitude: number },
  overrides: {
    result_type?: string
    confidence?: number
    confidence_street_level?: number
    timezone?: unknown
  } = {},
): GeocodeFeature {
  return {
    properties: {
      lat: coordinate.latitude,
      lon: coordinate.longitude,
      result_type: overrides.result_type ?? 'building',
      rank: {
        confidence: overrides.confidence ?? 1,
        ...(overrides.confidence_street_level === undefined
          ? {}
          : { confidence_street_level: overrides.confidence_street_level }),
      },
      ...(overrides.timezone === undefined
        ? {}
        : { timezone: overrides.timezone as { name?: unknown } }),
    },
  }
}

const response = (...features: GeocodeFeature[]) => ({ features })

describe('the outbound geocode request', () => {
  it('asks for more than one candidate, so the separation gate can fire at all', () => {
    expect(GEOCODE_CANDIDATE_LIMIT).toBeGreaterThan(1)
    const url = new URL(buildGeocodeUrl('Stationsplein 1, Amsterdam', 'test-key'))
    expect(url.searchParams.get('limit')).toBe(String(GEOCODE_CANDIDATE_LIMIT))
  })

  it('sends the meeting point as the query and the key as the key', () => {
    const url = new URL(buildGeocodeUrl('Stationsplein 1, Amsterdam', 'test-key'))
    expect(url.searchParams.get('text')).toBe('Stationsplein 1, Amsterdam')
    expect(url.searchParams.get('apiKey')).toBe('test-key')
    expect(url.origin).toBe('https://api.geoapify.com')
  })
})

describe('the outbound static map requests', () => {
  it('asks for JPEG, because the bucket refuses everything else above every policy', () => {
    for (const spec of Object.values(TILE_SPECS)) {
      const url = new URL(buildTileUrl(spec, AMSTERDAM, 'test-key'))
      expect(url.searchParams.get('format')).toBe('jpeg')
    }
  })

  it('renders two zooms at the two containers’ own dimensions', () => {
    const card = new URL(buildTileUrl(TILE_SPECS.card, AMSTERDAM, 'test-key'))
    expect(card.searchParams.get('width')).toBe('80')
    expect(card.searchParams.get('height')).toBe('148')
    // 7 on BOTH, not 13 and 15 — PD-236. Neither zoom had ever been chosen
    // against a visible tile: the burned-in credit covered the card and nobody
    // had questioned the panel. Both are marked "to try" in `gates.ts`, which
    // carries the metres-per-pixel table — if either reads as too far out, 11 is
    // the value that puts a town in frame.
    expect(card.searchParams.get('zoom')).toBe('7')

    const detail = new URL(buildTileUrl(TILE_SPECS.detail, AMSTERDAM, 'test-key'))
    expect(detail.searchParams.get('width')).toBe('358')
    expect(detail.searchParams.get('height')).toBe('160')
    expect(detail.searchParams.get('zoom')).toBe('7')
  })

  it('pins the meeting point on the detail panel and nowhere else', () => {
    // The panel had no marker at all and the product owner reported it: at z7
    // it covers a couple of hundred kilometres, so a centred tile with nothing
    // on it says nothing about where the ride starts.
    const detail = new URL(buildTileUrl(TILE_SPECS.detail, AMSTERDAM, 'test-key'))
    const marker = detail.searchParams.get('marker')
    expect(marker).toBe(`lonlat:${AMSTERDAM.longitude},${AMSTERDAM.latitude};${MARKER_STYLE}`)

    // Read back off the URL rather than off the constant: `URLSearchParams`
    // encodes `#` and `;` on the way out, and the whole point of asserting here
    // is that what leaves this function is what the vendor documents.
    expect(marker).toContain('color:#1a1a1a')
    // Longitude FIRST, which is the opposite order to every other place this
    // repo writes a coordinate — swapping them is a valid request for a
    // plausible-looking place somewhere else entirely, and it would put the pin
    // there rather than fail.
    expect(marker?.startsWith(`lonlat:${AMSTERDAM.longitude},${AMSTERDAM.latitude};`)).toBe(true)
    expect(AMSTERDAM.longitude).toBeLessThan(AMSTERDAM.latitude)

    // NOT on the card: `RideCard` draws its own pin disc in HTML, dead centre,
    // over a tile centred on the same coordinate. A burned-in marker there
    // would be a second pin a few pixels from the first.
    const card = new URL(buildTileUrl(TILE_SPECS.card, AMSTERDAM, 'test-key'))
    expect(card.searchParams.get('marker')).toBeNull()
  })

  it('writes the marker colour in LOWERCASE hex, which the vendor requires', () => {
    // Measured against the live API 2026-08-27: `color:#ff5050` renders and
    // `color:#FF5050` is a 400. It is undocumented — the schema types `color` as
    // a bounded string, which cannot express it — and it took every render on
    // both projects down for an afternoon.
    //
    // The trap is that `Grey/100` is written `#1A1A1A` everywhere else in this
    // design system, so copying the token in is the natural move and is wrong
    // here alone. This assertion is what stops a tidy-up that "matches the
    // tokens" turning every ride's map off with no visible symptom.
    const marker = new URL(buildTileUrl(TILE_SPECS.detail, AMSTERDAM, 'test-key'))
      .searchParams.get('marker')!
    for (const [, hex] of marker.matchAll(/#([0-9a-zA-Z]+)/g)) {
      expect(hex).toBe(hex.toLowerCase())
    }
    expect(marker).toContain('#1a1a1a')
  })

  it('doubles resolution with scaleFactor rather than with the pixel dimensions', () => {
    // Doubling width/height would double the map AREA at a fixed zoom and leave
    // the vendor's burned-in credit at its original size — halved once the
    // browser scales an 80-wide tile back into an 80px strip, which is straight
    // into the spec's "a credit that cannot fit means no tile" branch.
    const card = new URL(buildTileUrl(TILE_SPECS.card, AMSTERDAM, 'test-key'))
    expect(card.searchParams.get('scaleFactor')).toBe('2')
  })

  it('writes the centre as lonlat, longitude first', () => {
    const url = new URL(buildTileUrl(TILE_SPECS.detail, AMSTERDAM, 'test-key'))
    // Swapped, this is a valid request for a plausible place somewhere else.
    expect(url.searchParams.get('center')).toBe('lonlat:4.9031499,52.3784733')
  })

  it('sends attribution=none, and the app renders the credit the tile lost', () => {
    // **Inverted deliberately on 2026-08-27, and the replacement is stronger
    // than the deletion.** This used to assert the ABSENCE of every suppression
    // parameter — correct while nothing in the app rendered a credit of its own,
    // and wrong the moment `MapAttribution` existed. A test that simply loses an
    // assertion is how a suppressed credit comes back with nothing paying for
    // it, so this pins the two halves TOGETHER: the parameter is sent, and the
    // component that discharges the obligation carries the required strings.
    const url = new URL(buildTileUrl(TILE_SPECS.card, AMSTERDAM, 'test-key'))
    expect(url.searchParams.get('attribution')).toBe('none')
    expect(ATTRIBUTION_MODE).toBe('none')

    // ODbL 1.0 and OpenMapTiles are unconditional here — no plan, no vendor and
    // no subscription removes either, so these two may never leave this list
    // while `attribution=none` is sent.
    expect(MAP_CREDITS).toContain('© OpenStreetMap contributors')
    expect(MAP_CREDITS).toContain('© OpenMapTiles')

    // `Powered by Geoapify` is the ONE line a confirmed White Label removes, so
    // this is asserted as presence-or-absence rather than pinned: dropping it is
    // a legitimate edit the day the account is confirmed, and dropping either of
    // the two above never is.
    expect(MAP_CREDITS.length).toBeGreaterThanOrEqual(2)

    // The three parameters that never existed on this vendor. Kept because their
    // absence is still the invariant — `attribution` is the only real switch, and
    // a second one appearing here would be an unreviewed suppression.
    for (const parameter of ['nologo', 'no_logo', 'watermark', 'copyright']) {
      expect(url.toString()).not.toContain(parameter)
    }
  })
})

describe('the storage path', () => {
  it('matches the shape 051 pins with a CHECK and with the INSERT policy', () => {
    const organizer = '11111111-2222-3333-4444-555555555555'
    const object = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    expect(buildRideMapPath(organizer, object)).toBe(
      `ride-maps/${organizer}/${object}.jpg`,
    )
    // The regex 051 carries, verbatim.
    expect(buildRideMapPath(organizer, object)).toMatch(
      /^ride-maps\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
    )
  })
})

describe('distance', () => {
  it('reproduces the measured 12.2 km between the two Stationsplein 1s', () => {
    const metres = distanceMetres(AMSTERDAM, WEESP)
    expect(metres).toBeGreaterThan(11_500)
    expect(metres).toBeLessThan(12_900)
  })

  it('is zero for a point against itself', () => {
    expect(distanceMetres(AMSTERDAM, AMSTERDAM)).toBe(0)
  })
})

describe('the separation gate — the measured regression case', () => {
  it('resolves nothing for two maximally confident buildings 12.2 km apart', () => {
    // `Stationsplein 1, Amsterdam`, supplied by the product owner. Both features
    // are `building`, both `confidence: 1`, both `full_match`. Every other gate
    // in this change passes both of them, and a pipeline taking features[0]
    // stores a coordinate 12.2 km wrong with the highest possible confidence
    // attached — at which point it is indistinguishable from a good one.
    expect(resolveCoordinate(response(feature(AMSTERDAM), feature(WEESP)))).toEqual({
      resolved: false,
      reason: 'ambiguous',
    })
  })

  it('fires on distance rather than on a tie, so 1.00 against 0.97 still refuses', () => {
    // Confidence SATURATES. The measured pair tied at the ceiling rather than
    // because they were equally good, so a tie test is fitted to an artifact.
    const verdict = resolveCoordinate(
      response(
        feature(AMSTERDAM, { confidence: 1 }),
        feature(WEESP, { confidence: 0.97 }),
      ),
    )
    expect(verdict).toEqual({ resolved: false, reason: 'ambiguous' })
  })

  it('treats one building returned twice by two datasources as one place', () => {
    // The other direction, and the reason a count-based rule is wrong: a vendor
    // merging sources returns the same building tied exactly and 0 m apart, and a
    // count rule would refuse a perfectly unambiguous address for ever.
    const verdict = resolveCoordinate(response(feature(AMSTERDAM), feature(AMSTERDAM)))
    expect(verdict).toEqual({
      resolved: true,
      latitude: AMSTERDAM.latitude,
      longitude: AMSTERDAM.longitude,
      confidence: 1,
      timezone: null,
    })
  })

  it('admits candidates that disagree by less than the threshold', () => {
    // ~110 m north — two entrances to one building, or two datasources rounding
    // differently. One place.
    const nearby = { latitude: AMSTERDAM.latitude + 0.001, longitude: AMSTERDAM.longitude }
    expect(distanceMetres(AMSTERDAM, nearby)).toBeLessThan(SEPARATION_THRESHOLD_METRES)
    expect(resolveCoordinate(response(feature(AMSTERDAM), feature(nearby)))).toMatchObject({
      resolved: true,
    })
  })

  it('never breaks a disagreement on a relevance signal', () => {
    // `rank.importance` and `rank.popularity` are in every real response and are
    // absent from `GeocodeFeature` on purpose, so reaching for one does not
    // compile. This is the behavioural half: a far-away candidate carrying them
    // is still ambiguity, never a winner.
    const withRelevance = {
      properties: {
        ...feature(WEESP).properties,
        rank: { confidence: 1, importance: 0.99, popularity: 9.9 },
      },
    } as GeocodeFeature
    expect(resolveCoordinate(response(feature(AMSTERDAM), withRelevance))).toEqual({
      resolved: false,
      reason: 'ambiguous',
    })
  })
})

describe('the granularity gate', () => {
  it('rejects a city-level match however confident it is', () => {
    expect(
      resolveCoordinate(response(feature(AMSTERDAM, { result_type: 'city', confidence: 1 }))),
    ).toEqual({ resolved: false, reason: 'granularity' })
  })

  it('rejects an unknown result type, because the vocabulary is an allowlist', () => {
    // The vocabulary could not be measured from this container, so the unknown
    // value is the one that has to be safe: a new vendor type costs a tile rather
    // than shipping a wrong one.
    expect(
      resolveCoordinate(response(feature(AMSTERDAM, { result_type: 'hamlet_or_whatever' }))),
    ).toEqual({ resolved: false, reason: 'granularity' })
  })

  it('admits building, amenity and street', () => {
    for (const result_type of ['building', 'amenity', 'street']) {
      expect(resolveCoordinate(response(feature(AMSTERDAM, { result_type })))).toMatchObject({
        resolved: true,
      })
    }
  })

  it('runs BEFORE separation, so [building, city] resolves rather than refusing', () => {
    // An ordinary response for a street address in a named city. Separation-first
    // measures the distance to a candidate granularity is about to discard, and
    // rejects a request that had exactly one usable answer.
    const verdict = resolveCoordinate(
      response(feature(AMSTERDAM), feature(WEESP, { result_type: 'city' })),
    )
    expect(verdict).toMatchObject({ resolved: true, latitude: AMSTERDAM.latitude })
  })
})

describe('the numeric floor', () => {
  it('discards a candidate below the floor', () => {
    expect(
      resolveCoordinate(response(feature(AMSTERDAM, { confidence: CONFIDENCE_FLOOR - 0.01 }))),
    ).toEqual({ resolved: false, reason: 'confidence' })
  })

  it('admits a candidate exactly at the floor, which its own CHECK also admits', () => {
    // 051 writes `>= 0.70::real` rather than `>= 0.70` for this: a bare numeric
    // literal widens the real column and `0.70::real >= 0.70` is FALSE, so a
    // candidate at exactly the floor would pass here and then raise on the
    // UPDATE — after both renders had been paid for.
    expect(
      resolveCoordinate(response(feature(AMSTERDAM, { confidence: CONFIDENCE_FLOOR }))),
    ).toMatchObject({ resolved: true })
  })

  it('fails closed above the ceiling, so a mis-scaled vendor value stores nothing', () => {
    // The 0–1 scale is plausible rather than validated. If the vendor is really
    // emitting 0–100 this refuses every candidate — no tiles ever, loudly, rather
    // than every tile carrying a meaningless score.
    expect(resolveCoordinate(response(feature(AMSTERDAM, { confidence: 87 })))).toEqual({
      resolved: false,
      reason: 'confidence',
    })
  })

  it('uses confidence_street_level as corroboration only', () => {
    // It can remove a candidate the primary gates admitted; it can never promote
    // one they rejected, and a vendor that stops emitting it changes nothing.
    expect(
      resolveCoordinate(
        response(feature(AMSTERDAM, { confidence: 1, confidence_street_level: 0.2 })),
      ),
    ).toEqual({ resolved: false, reason: 'confidence' })

    expect(
      resolveCoordinate(response(feature(AMSTERDAM, { result_type: 'city', confidence: 1 }))),
    ).toEqual({ resolved: false, reason: 'granularity' })
  })
})

describe('the empty and malformed cases', () => {
  it('stores nothing for an empty result', () => {
    expect(resolveCoordinate(response())).toEqual({ resolved: false, reason: 'no_candidates' })
  })

  it('stores nothing for a null or absent response', () => {
    expect(resolveCoordinate(null)).toEqual({ resolved: false, reason: 'no_candidates' })
    expect(resolveCoordinate({})).toEqual({ resolved: false, reason: 'no_candidates' })
  })

  it('discards a candidate with no coordinate rather than storing a partial one', () => {
    const broken = { properties: { result_type: 'building', rank: { confidence: 1 } } }
    expect(resolveCoordinate(response(broken))).toEqual({
      resolved: false,
      reason: 'no_candidates',
    })
  })

  it('discards an out-of-range coordinate before it can cost a render', () => {
    const impossible = feature({ latitude: 152, longitude: 4.9 })
    expect(resolveCoordinate(response(impossible))).toEqual({
      resolved: false,
      reason: 'no_candidates',
    })
  })
})

/**
 * The picked-ride branch — PD-114 §D6, task 6.3.
 *
 * This is the decision that says whether a rider is BILLED for a geocode, which
 * is why it lives in `gates.ts` where this file can reach it rather than inside
 * the handler (§6.2).
 */
describe('resolvePickedCoordinate', () => {
  it('takes a picked ride at its word — no geocode, no gates', () => {
    expect(
      resolvePickedCoordinate({ start_place_id: 'gers-1', latitude: 51.885, longitude: 4.372 })
    ).toEqual({ latitude: 51.885, longitude: 4.372 })
  })

  it('is null for a ride that was only geocoded, so that path keeps its gates', () => {
    // A geocoded ride carries coordinates AND a confidence, and no place id.
    // Reading it as picked would skip the granularity gate on a guess.
    expect(resolvePickedCoordinate({ start_place_id: null, latitude: 52.37, longitude: 4.89 })).toBe(
      null
    )
  })

  it('is null for a ride with no location at all', () => {
    expect(resolvePickedCoordinate({})).toBe(null)
    expect(
      resolvePickedCoordinate({ start_place_id: null, latitude: null, longitude: null })
    ).toBe(null)
  })

  it('refuses a place id whose coordinates are missing, rather than rendering nowhere', () => {
    // `067`'s coupling CHECK makes this unstorable today. The check is here
    // anyway because a null latitude reaching `buildTileUrl` does not fail — it
    // renders a tile of the Gulf of Guinea, which is a wrong map rather than no
    // map, and no later migration can make that outcome safe.
    expect(resolvePickedCoordinate({ start_place_id: 'gers-1' })).toBe(null)
    expect(
      resolvePickedCoordinate({ start_place_id: 'gers-1', latitude: 51.885, longitude: null })
    ).toBe(null)
  })

  it('treats a blank place id as no pick', () => {
    expect(
      resolvePickedCoordinate({ start_place_id: '   ', latitude: 51.885, longitude: 4.372 })
    ).toBe(null)
  })

  it('accepts 0/0 as a real coordinate, because the emptiness test is on the place id', () => {
    // Null Island is a legal point. The pick is decided by the place id, never
    // by a falsy coordinate — which is the same trap `readRideLocation` avoids
    // by testing the STRING rather than the parsed number.
    expect(resolvePickedCoordinate({ start_place_id: 'gers-0', latitude: 0, longitude: 0 })).toEqual(
      { latitude: 0, longitude: 0 }
    )
  })
})

/**
 * `080` (PD-193) — the zone the geocode already returns, which is what let that
 * story be built without a second vendor call.
 *
 * **The rule under test is that this is carried, never gated.** Every other
 * field on a candidate can refuse it; a missing or malformed zone must not,
 * because refusing a good coordinate over a clock trades the rider's map for
 * their timezone and `APP_TIME_ZONE` is a perfectly good answer.
 *
 * Documentation-derived, like every other constant in `gates.ts`:
 * `*.geoapify.com` is egress-blocked from the build container, so no session has
 * seen this field on a live response. What is pinned here is the degradation.
 */
describe('the meeting point’s timezone', () => {
  it('rides out on the verdict, taken from the candidate that won', () => {
    const verdict = resolveCoordinate(
      response(feature(AMSTERDAM, { timezone: { name: 'Europe/Amsterdam' } })),
    )
    expect(verdict).toEqual({
      resolved: true,
      latitude: AMSTERDAM.latitude,
      longitude: AMSTERDAM.longitude,
      confidence: 1,
      timezone: 'Europe/Amsterdam',
    })
  })

  it('is NEVER a gate — a malformed zone still resolves the coordinate', () => {
    for (const timezone of [null, {}, { name: '' }, { name: 7 }, { name: 'a'.repeat(65) }, 'x']) {
      const verdict = resolveCoordinate(response(feature(AMSTERDAM, { timezone })))
      expect(verdict.resolved).toBe(true)
      expect(verdict.resolved && verdict.timezone).toBeNull()
    }
  })

  it('is null when the vendor sends no timezone at all, which is the old shape', () => {
    const verdict = resolveCoordinate(response(feature(AMSTERDAM)))
    expect(verdict.resolved && verdict.timezone).toBeNull()
  })

  it('bounds the length at the column’s CHECK', () => {
    // Over `rides_timezone_is_bounded` the write is refused, and this function's
    // caller answers a refusal by deleting both freshly uploaded tiles. So the
    // cost of not bounding it here is the rider's map, not their clock.
    const ok = `Europe/${'a'.repeat(MAX_TIMEZONE_CHARS - 7)}`
    expect(ok).toHaveLength(MAX_TIMEZONE_CHARS)
    const good = resolveCoordinate(response(feature(AMSTERDAM, { timezone: { name: ok } })))
    expect(good.resolved && good.timezone).toBe(ok)

    const over = resolveCoordinate(response(feature(AMSTERDAM, { timezone: { name: `${ok}a` } })))
    expect(over.resolved && over.timezone).toBeNull()
  })

  it('reads only `name`, so a vendor offset cannot become a stored fact', () => {
    // The offsets and abbreviations beside it are derivable from the name and go
    // stale with the tz database. `GeocodeFeature` not carrying them is the
    // enforcement; this asserts the mapping agrees.
    const verdict = resolveCoordinate(
      response(
        feature(AMSTERDAM, {
          timezone: { name: 'Europe/Lisbon', offset_STD: '+00:00', abbreviation_DST: 'WEST' },
        }),
      ),
    )
    expect(verdict.resolved && verdict.timezone).toBe('Europe/Lisbon')
  })
})
