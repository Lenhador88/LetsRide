import { describe, expect, it } from 'vitest'
import { crewRailSummary } from '@/components/rides/RideCrewRail'
import { RIDE_AVATAR_LIMIT, withOrganizer } from '@/lib/data/rides'
import type { PublicProfile, RideCrew } from '@/types'

/**
 * The rail's count is the thing this file exists for.
 *
 * A crew count sat on the ride plan once before and was removed: it counted
 * `maybe` RSVPs under a "going" label, so the screen said `5 going` while the
 * roster one tap away said three. PD-254 lets the count back on the explicit
 * condition that it is derived from the crew page's own read — so the assertions
 * below run the **whole pipeline** the screen runs, `getRideCrew`'s shape
 * through `withOrganizer` into `crewRailSummary`, rather than testing the last
 * function against a hand-made input it would never receive. A summary that is
 * right about a fabricated `RideCrew` and wrong about the one the page composes
 * is the bug, not the guard.
 */

function rider(id: string): { user_id: string; profile: PublicProfile } {
  return {
    user_id: id,
    profile: { id, username: id, avatar_url: null, avatar_path: null, bike_model: null },
  }
}

function crew(going: string[], maybe: string[] = []): RideCrew {
  return { going: going.map(rider), maybe: maybe.map(rider) }
}

describe('crewRailSummary', () => {
  it('counts the going list the crew page renders, organizer included', () => {
    const composed = withOrganizer(crew(['mk', 'tv']), 'pl', rider('pl').profile)

    expect(crewRailSummary(composed, true).label).toBe('3 going')
  })

  it('does NOT count the maybes — the defect this screen shipped once', () => {
    const composed = withOrganizer(crew(['mk'], ['tv', 'jr']), 'pl', rider('pl').profile)

    // Two going (host + mk), two maybe. The removed version said `4 going`.
    expect(crewRailSummary(composed, true).label).toBe('2 going')
  })

  it('counts an organizer who also RSVP’d exactly once', () => {
    const composed = withOrganizer(crew(['pl', 'mk']), 'pl', rider('pl').profile)

    expect(crewRailSummary(composed, true).label).toBe('2 going')
  })

  it('reads in the past tense for a ride that has happened', () => {
    const composed = withOrganizer(crew(['mk', 'tv']), 'pl', rider('pl').profile)

    expect(crewRailSummary(composed, false).label).toBe('3 rode')
  })

  it('shows the host first and caps the avatars, with the rest as an overflow', () => {
    const others = Array.from({ length: 11 }, (_, i) => `r${i}`)
    const composed = withOrganizer(crew(others), 'pl', rider('pl').profile)
    const { shown, overflow, label } = crewRailSummary(composed, true)

    expect(label).toBe('12 going')
    expect(shown).toHaveLength(RIDE_AVATAR_LIMIT)
    expect(shown[0].user_id).toBe('pl')
    expect(shown[0].is_host).toBe(true)
    // Every rider not drawn is in the bubble: the two numbers must reconcile,
    // which is what stops a `+N` computed from a different list than the stack.
    expect(overflow).toBe(12 - RIDE_AVATAR_LIMIT)
    expect(shown.length + overflow).toBe(12)
  })

  it('draws no overflow bubble when everyone fits', () => {
    const composed = withOrganizer(crew(['mk']), 'pl', rider('pl').profile)

    expect(crewRailSummary(composed, true).overflow).toBe(0)
  })

  it('counts a ride nobody has answered as the organizer alone', () => {
    const composed = withOrganizer(crew([]), 'pl', rider('pl').profile)

    expect(crewRailSummary(composed, true).label).toBe('1 going')
    expect(crewRailSummary(composed, true).shown).toHaveLength(1)
  })
})
