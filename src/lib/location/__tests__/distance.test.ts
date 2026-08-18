import { describe, expect, it } from 'vitest'
import { NEARBY_RADIUS_KM, distanceKm, isNearby } from '@/lib/location/distance'

/**
 * The distances behind "clubs near you" (PD-259).
 *
 * **Every expected value here is an independently-known real-world distance**,
 * not a number this implementation produced and was then pinned to. A test
 * written the other way round passes against a haversine with a wrong radius,
 * a swapped argument order, or degrees fed in where radians belong — which are
 * exactly the three ways this function goes wrong.
 */
describe('distanceKm', () => {
  const utrecht = { lat: 52.0907, lon: 5.1214 }
  const amsterdam = { lat: 52.3676, lon: 4.9041 }
  const maastricht = { lat: 50.8514, lon: 5.691 }

  it('measures Utrecht to Amsterdam at the ~35 km everyone knows it to be', () => {
    const km = distanceKm(utrecht, amsterdam)
    expect(km).toBeGreaterThan(33)
    expect(km).toBeLessThan(37)
  })

  it('measures Utrecht to Maastricht at ~145 km — past the nearby radius', () => {
    const km = distanceKm(utrecht, maastricht)
    expect(km).toBeGreaterThan(140)
    expect(km).toBeLessThan(150)
    expect(isNearby(km)).toBe(false)
  })

  it('is symmetric — swapping the arguments cannot change a distance', () => {
    expect(distanceKm(utrecht, maastricht)).toBeCloseTo(distanceKm(maastricht, utrecht)!, 9)
  })

  it('is zero for a point and itself', () => {
    expect(distanceKm(utrecht, { ...utrecht })).toBeCloseTo(0, 9)
  })

  it('gets a degree of latitude right at ~111 km, anywhere', () => {
    // The check that catches a wrong Earth radius: a degree of latitude is
    // ~111.2 km at the equator and at the pole alike.
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1)
    expect(distanceKm({ lat: 60, lon: 30 }, { lat: 61, lon: 30 })).toBeCloseTo(111.19, 1)
  })

  it('shrinks a degree of longitude with latitude, which a flat model would not', () => {
    // This is the assertion that fails against the equirectangular
    // approximation the module's header explains it did not use.
    const atEquator = distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })!
    const atFiftyTwo = distanceKm({ lat: 52, lon: 0 }, { lat: 52, lon: 1 })!
    expect(atFiftyTwo).toBeLessThan(atEquator)
    expect(atFiftyTwo / atEquator).toBeCloseTo(Math.cos((52 * Math.PI) / 180), 2)
  })

  it('crosses the antimeridian the short way rather than the long way round', () => {
    // 179°E to 179°W is two degrees apart, not 358. Haversine handles this
    // without a special case; a naive `lon2 - lon1` in a flat model does not.
    const km = distanceKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })
    expect(km).toBeCloseTo(222.39, 0)
  })

  it('answers null for a missing endpoint rather than guessing one', () => {
    expect(distanceKm(null, utrecht)).toBeNull()
    expect(distanceKm(utrecht, null)).toBeNull()
    expect(distanceKm(null, null)).toBeNull()
  })

  it('answers null for NaN and infinity instead of propagating them', () => {
    // NaN would sail through every later comparison as `false`, so a club with
    // one corrupt coordinate would silently never be near anything.
    expect(distanceKm({ lat: NaN, lon: 5 }, utrecht)).toBeNull()
    expect(distanceKm(utrecht, { lat: 52, lon: Infinity })).toBeNull()
  })

  it('survives antipodal points without returning NaN', () => {
    // The reason the implementation uses atan2 rather than asin: floating-point
    // error can push the intermediate above 1 here.
    const km = distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })
    expect(km).not.toBeNull()
    expect(Number.isNaN(km!)).toBe(false)
    expect(km!).toBeCloseTo(20015.1, 0)
  })
})

describe('isNearby', () => {
  it('treats the radius itself as near — the boundary is inclusive', () => {
    expect(isNearby(NEARBY_RADIUS_KM)).toBe(true)
    expect(isNearby(NEARBY_RADIUS_KM + 0.001)).toBe(false)
  })

  it('treats "no answer" as not near, and never as zero', () => {
    // The distinction `ClubListItem.distance_km` documents: undefined means the
    // rider has no position, or the club has no location. Read as 0 it would
    // sort every unlocated club above the rider's actual neighbours.
    expect(isNearby(undefined)).toBe(false)
    expect(isNearby(null)).toBe(false)
    expect(isNearby(0)).toBe(true)
  })
})
