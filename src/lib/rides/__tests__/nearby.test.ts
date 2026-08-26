import { describe, expect, it } from 'vitest'
import { NEARBY_RADIUS_KM, nearbyRides } from '@/lib/rides/nearby'
import { parseRideNear } from '@/lib/validation/rides'
import type { RideListItem } from '@/types'

/**
 * PD-260's predicate. The distance maths itself is `distance.test.ts`'s; what
 * is asserted here is everything around it — which rows are dropped, what an
 * absent position means, and the order the survivors come back in.
 */

const UTRECHT = { lat: 52.09, lon: 5.12 }

/** ~57 km north-west of Utrecht. */
const AMSTERDAM = { lat: 52.37, lon: 4.9 }

/** ~600 km south, comfortably outside the radius. */
const LYON = { lat: 45.76, lon: 4.84 }

function ride(overrides: Partial<RideListItem> = {}): RideListItem {
  return {
    id: 'ride-1',
    title: 'Weekend cruise',
    meeting_point: 'Leiderdorp',
    departure_at: '2026-08-16T10:00:00Z',
    timezone: null,
    club: null,
    latitude: null,
    longitude: null,
    organizer: null,
    riders: [],
    riders_count: 1,
    attendance: null,
    map_card_url: null,
    is_upcoming: true,
    ...overrides,
  }
}

const at = (id: string, point: { lat: number; lon: number }): RideListItem =>
  ride({ id, latitude: point.lat, longitude: point.lon })

describe('nearbyRides', () => {
  it('keeps a ride inside the radius', () => {
    expect(nearbyRides([at('a', AMSTERDAM)], UTRECHT).map((r) => r.id)).toEqual(['a'])
  })

  it('drops a ride beyond the radius', () => {
    expect(nearbyRides([at('a', LYON)], UTRECHT)).toEqual([])
  })

  it('answers empty when the rider has no position', () => {
    const rides = [at('a', AMSTERDAM)]
    expect(nearbyRides(rides, null)).toEqual([])
    expect(nearbyRides(rides, undefined)).toEqual([])
  })

  it('answers empty when the list has not loaded', () => {
    expect(nearbyRides(undefined, UTRECHT)).toEqual([])
  })

  /**
   * The case every ride in both databases was in until the geocoder deployed —
   * and still the case for any ride whose geocode failed. Counting one of these
   * as near would put a ride on a "near you" list that nothing can place.
   */
  it('drops a ride with no coordinate', () => {
    expect(nearbyRides([ride({ id: 'a' })], UTRECHT)).toEqual([])
  })

  /**
   * `067`'s CHECK makes a half pair unreachable through the app's own writes.
   * This does not lean on that: the type permits it, and a half pair reaching
   * `distanceKm` as a `NaN` would silently never match anything.
   */
  it('drops a ride with only one half of the pair', () => {
    expect(nearbyRides([ride({ id: 'a', latitude: 52.09 })], UTRECHT)).toEqual([])
    expect(nearbyRides([ride({ id: 'b', longitude: 5.12 })], UTRECHT)).toEqual([])
  })

  it('keeps a ride exactly at the radius', () => {
    // One degree of latitude is ~111.19 km on this sphere, so this lands a hair
    // inside NEARBY_RADIUS_KM rather than on a floating-point knife edge.
    const justInside = { lat: UTRECHT.lat + (NEARBY_RADIUS_KM - 1) / 111.19, lon: UTRECHT.lon }
    expect(nearbyRides([at('a', justInside)], UTRECHT).map((r) => r.id)).toEqual(['a'])
  })

  /**
   * The filter answers *where*; the list stays in departure order, which is
   * *when*. A distance sort would raise next month's ride two towns over above
   * tomorrow's ride three towns over.
   */
  it('preserves the incoming order rather than sorting by distance', () => {
    const near = { lat: 52.1, lon: 5.13 }
    const rides = [at('further', AMSTERDAM), at('nearer', near)]
    expect(nearbyRides(rides, UTRECHT).map((r) => r.id)).toEqual(['further', 'nearer'])
  })
})

describe('parseRideNear', () => {
  it('is on only for the value the strip writes', () => {
    expect(parseRideNear({ near: '1' })).toBe(true)
  })

  /**
   * The whole reason this is a literal rather than `Boolean(param)`: under a
   * coercion every one of these reads as ON, so a link that means "turn it off"
   * silently does nothing.
   */
  it.each(['0', 'false', 'no', '', 'true', 'yes'])('is off for %o', (value) => {
    expect(parseRideNear({ near: value })).toBe(false)
  })

  it('is off when the parameter is absent', () => {
    expect(parseRideNear({})).toBe(false)
  })
})
