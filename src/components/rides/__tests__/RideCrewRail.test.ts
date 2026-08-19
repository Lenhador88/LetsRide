import { readFileSync } from 'node:fs'
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

/**
 * The cases above pin the **arithmetic**. This one pins the **source**, and the
 * distinction is the whole defect.
 *
 * `crewRailSummary` takes a `RideCrew`, so every assertion above stays green if
 * someone later feeds the rail `RideListItem.riders_count` — "the number is
 * already on the card, why issue a second read". That value is
 * `others.length + 1` over **going AND maybe** (`src/lib/data/rides.ts`), which
 * is character-for-character the arithmetic that got the count removed from this
 * screen the first time: a ride with 4 going and 3 maybe would read `7 going`
 * beside a roster one tap away that says 4.
 *
 * Scanning the source is not elegant, and it is the only thing that can fail on
 * that edit — the same reasoning `no-service-role-key.test.ts` uses, one
 * directory over. If the rail is ever legitimately rewritten to read elsewhere,
 * this test failing is the conversation, not an obstacle.
 */
describe('the rail reads the crew page’s own source', () => {
  const source = readFileSync(new URL('../RideCrewRail.tsx', import.meta.url), 'utf8')

  /**
   * **This first version failed, and it failed the way this repo's most-repeated
   * measurement error always fails.** `RideCrewRail`'s own docstring says *"do
   * not accept `riders_count` as a prop"* — so a bare scan for the retired
   * pattern matched the sentence forbidding it. That is CLAUDE.md §Technology
   * Decisions' comment trap exactly: a file's description of what it must not do
   * looks identical to it doing that thing.
   *
   * So the scan strips comments first, and the mutation case below is what keeps
   * the strip honest — a filter that has quietly stopped matching passes for ever
   * and looks exactly like a clean file.
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  it('fetches through queryKeys.rides.crew and getRideCrew', () => {
    expect(code).toContain('queryKeys.rides.crew(rideId)')
    expect(code).toContain('getRideCrew(rideId)')
  })

  it('never reads riders_count, the maybe-inclusive count', () => {
    expect(code).not.toContain('riders_count')
  })

  it('strips comments without stripping the code it must scan', () => {
    // The strip is only trustworthy if it left the executable half behind.
    expect(code).toContain('crew.going.length')
    expect(source).toContain('riders_count') // the docstring forbidding it
  })

  it('would still catch a riders_count rewrite', () => {
    const rewritten = code.replace('crew.going.length', 'ride.riders_count')
    expect(rewritten).toContain('riders_count')
    expect(rewritten).not.toBe(code)
  })
})
