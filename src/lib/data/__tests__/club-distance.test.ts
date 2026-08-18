import { describe, expect, it } from 'vitest'
import { byDistanceThenName } from '@/lib/data/clubs'
import { NEARBY_RADIUS_KM } from '@/lib/location/distance'
import type { ClubListItem } from '@/types'

/**
 * How Explore orders itself once the rider has a position (PD-259).
 *
 * The rule this protects is PD-259's own: *"a club with no location is not a
 * hidden club."* Every club created before `066` has no coordinates, so the
 * comparator is the only thing standing between that decision and a list where
 * they all sink — or, with the other obvious bug, all float.
 */
const club = (name: string, distance_km?: number): ClubListItem => ({
  id: name,
  name,
  is_public: true,
  avatar_path: null,
  cover_image_path: null,
  avatar_url: null,
  cover_image_url: null,
  location_name: distance_km === undefined ? null : name,
  location_place_id: distance_km === undefined ? null : `gers-${name}`,
  latitude: distance_km === undefined ? null : 52,
  longitude: distance_km === undefined ? null : 5,
  riders: [],
  members_count: 0,
  distance_km,
})

const order = (items: ClubListItem[]) => [...items].sort(byDistanceThenName).map((c) => c.name)

describe('byDistanceThenName', () => {
  it('puts near clubs first, nearest first', () => {
    expect(order([club('Zulu', 40), club('Alpha', 5), club('Mike', 20)])).toEqual([
      'Alpha',
      'Mike',
      'Zulu',
    ])
  })

  it('keeps an unlocated club in the list, below the near ones', () => {
    expect(order([club('Nowhere'), club('Close', 5)])).toEqual(['Close', 'Nowhere'])
  })

  it('does NOT treat a missing distance as zero', () => {
    // The bug this exists to prevent: `(a.distance_km ?? 0)` as the whole
    // comparator floats every pre-066 club above the rider's actual neighbours.
    expect(order([club('Nowhere'), club('Close', 5)])[0]).toBe('Close')
  })

  it('sorts a far club and an unlocated one by name, not by distance', () => {
    // Past the radius the number stops carrying relevance: 340 km away and
    // "no location" are equally not-near, so ordering one above the other
    // would claim something the distance does not support.
    expect(order([club('Zulu', 340), club('Alpha')])).toEqual(['Alpha', 'Zulu'])
    expect(order([club('Zulu'), club('Alpha', 340)])).toEqual(['Alpha', 'Zulu'])
  })

  it('treats the radius itself as near, and a hair past it as not', () => {
    expect(order([club('Bravo'), club('Alpha', NEARBY_RADIUS_KM)])).toEqual(['Alpha', 'Bravo'])
    expect(order([club('Bravo'), club('Alpha', NEARBY_RADIUS_KM + 0.001)])).toEqual([
      'Alpha',
      'Bravo',
    ])
    // ...and that second case is name order, not distance order — Zulu proves it.
    expect(order([club('Bravo'), club('Zulu', NEARBY_RADIUS_KM + 0.001)])).toEqual([
      'Bravo',
      'Zulu',
    ])
  })

  it('falls back to name for two equally near clubs', () => {
    expect(order([club('Zulu', 5), club('Alpha', 5)])).toEqual(['Alpha', 'Zulu'])
  })
})
