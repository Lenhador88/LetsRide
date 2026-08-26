import { describe, expect, it } from 'vitest'
import {
  RIDE_TIMEZONE_FIELD_NAME,
  parseRideFilter,
  readRideLocation,
  resolveDepartureZone,
  rideIdSchema,
} from '@/lib/validation/rides'

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('parseRideFilter', () => {
  it('reads the three filters the screen has', () => {
    expect(parseRideFilter({})).toBeUndefined()
    expect(parseRideFilter({ filter: 'mine' })).toEqual({ kind: 'mine' })
    expect(parseRideFilter({ club: UUID })).toEqual({ kind: 'club', id: UUID })
  })

  it('drops a club id that is not a uuid, rather than passing it to the query', () => {
    // The whole point: this used to reach `.eq('club_id', …)`, and Postgres
    // answers a malformed uuid with 22P02 → 400 → the rides tab's error
    // boundary. "No filter" is the honest response to a stale link.
    expect(parseRideFilter({ club: 'not-a-uuid' })).toBeUndefined()
    expect(parseRideFilter({ club: '' })).toBeUndefined()
    expect(parseRideFilter({ club: "'; drop table rides; --" })).toBeUndefined()
  })

  it('ignores a filter value it does not know', () => {
    expect(parseRideFilter({ filter: 'everyone' })).toBeUndefined()
  })

  it('lets "mine" win over a club, rather than intersecting them', () => {
    expect(parseRideFilter({ filter: 'mine', club: UUID })).toEqual({ kind: 'mine' })
  })

  it('still returns the club when only the filter value is junk', () => {
    expect(parseRideFilter({ filter: 'bogus', club: UUID })).toEqual({ kind: 'club', id: UUID })
  })
})

describe('rideIdSchema', () => {
  it('accepts a uuid', () => {
    expect(rideIdSchema.safeParse('dd7c6d53-3a12-481c-96f6-efd5249693b4').success).toBe(true)
  })

  it('rejects the segments that actually reached it in production', () => {
    // `/rides/new` is the Create-ride button's own href, and it matched the
    // then-dynamic `/rides/[id]` route for any segment that was not a real
    // sub-route. Before this schema, `/rides/new/crew` answered 500 — Postgres
    // 22P02 through PostgREST as a 400, thrown by unwrap. Found by loading the
    // app, not by review.
    //
    // `'new'` is kept after PD-142 moved the id to `?id=`, where that collision
    // can no longer happen: these are the values that have reached the schema,
    // and dropping one because its old route is gone loses the case rather than
    // the risk. `''` is the one that matters most now — it is what an absent
    // `?id=` becomes on all ten screens.
    for (const bad of ['new', 'not-a-uuid', '', '123', 'undefined', 'null']) {
      expect(rideIdSchema.safeParse(bad).success).toBe(false)
    }
  })
})

/**
 * What the two ride forms actually post, read back the way the actions read it.
 *
 * The same contract `place-search-field.test.tsx` covers for the field's own
 * four inputs, on the fifth one the ride forms render themselves (`080`,
 * PD-193) — and it is worth its own test for the reason that one is: nothing
 * else in the repo connects the input's NAME to the column the action writes,
 * so a rename on either side compiles and silently stops storing the zone.
 */
describe('readRideLocation', () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData()
    for (const [key, value] of Object.entries(entries)) data.append(key, value)
    return data
  }

  const pick = { start_place_id: 'geoapify:abc', latitude: '38.71', longitude: '-9.14' }

  it('reads the zone off the input the ride forms render', () => {
    expect(readRideLocation(form({ ...pick, [RIDE_TIMEZONE_FIELD_NAME]: 'Europe/Lisbon' }))).toEqual(
      { start_place_id: 'geoapify:abc', latitude: 38.71, longitude: -9.14, timezone: 'Europe/Lisbon' }
    )
  })

  it('is `start_timezone`, and a bare `timezone` is NOT read', () => {
    // Named for the START rather than for the column, so it groups with
    // `start_place_id` on the form. The action maps it; the form does not.
    expect(readRideLocation(form({ ...pick, timezone: 'Europe/Lisbon' }))?.timezone).toBeNull()
  })

  it('keeps the pick when the place has no zone, which is the ordinary case', () => {
    // The zone is deliberately OUTSIDE the all-or-nothing test: a provider that
    // sent no zone must not cost the rider their coordinate. It is also what
    // every pick answers until `search-places` is redeployed.
    for (const zone of [undefined, '', '   ']) {
      const data = form(pick)
      if (zone !== undefined) data.append(RIDE_TIMEZONE_FIELD_NAME, zone)
      const location = readRideLocation(data)
      expect(location?.start_place_id).toBe('geoapify:abc')
      expect(location?.timezone).toBeNull()
    }
  })

  it('answers null for a zone with no pick behind it, so it cannot be stored alone', () => {
    // `080` writes the zone through the location group. A zone with no
    // coordinate is a form the rider never completed.
    expect(readRideLocation(form({ [RIDE_TIMEZONE_FIELD_NAME]: 'Europe/Lisbon' }))).toBeNull()
  })
})

/**
 * `080` (PD-193). Four call sites answer this question — both ride forms, to
 * LABEL the departure field, and both ride actions, to RESOLVE it through
 * `wallClockToUtc` — and a rider must never be told one zone and have another
 * one stored. Extracted here so there is one rule rather than four copies that
 * "have to agree".
 */
describe('resolveDepartureZone', () => {
  it('takes the picked place’s zone when the rider picked one', () => {
    expect(resolveDepartureZone({ timezone: 'Europe/Lisbon' }, null)).toBe('Europe/Lisbon')
    expect(resolveDepartureZone({ timezone: 'Europe/Lisbon' }, 'Europe/Berlin')).toBe(
      'Europe/Lisbon'
    )
  })

  it('falls back to the ride’s stored zone when there is no pick — the typed start', () => {
    expect(resolveDepartureZone(null, 'Europe/Berlin')).toBe('Europe/Berlin')
    expect(resolveDepartureZone(undefined, 'Europe/Berlin')).toBe('Europe/Berlin')
  })

  /**
   * **The case this function exists for, and the reason it is not
   * `pick?.timezone ?? stored`.** A place whose provider sent no zone is
   * ordinary — it is every place until `search-places` is redeployed — and `??`
   * falls straight through it to the ride's stored zone. On an edit that labels
   * the field `APP_TIME_ZONE` while the action resolves against the ride's OLD
   * zone, so a rider who also changed the time gets back an hour they never
   * typed. The pick wins whenever there is one, `null` included.
   */
  it('lets a ZONELESS pick win over the stored zone, rather than falling through it', () => {
    expect(resolveDepartureZone({ timezone: null }, 'Europe/Lisbon')).toBeNull()
    expect(resolveDepartureZone({}, 'Europe/Lisbon')).toBeNull()
  })

  it('answers null when there is neither, which is a typed start on a new ride', () => {
    expect(resolveDepartureZone(null, null)).toBeNull()
  })
})
