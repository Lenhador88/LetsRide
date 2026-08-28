import { describe, expect, it } from 'vitest'
import {
  CLUB_TIMELINE_PAST_MIN,
  CLUB_TIMELINE_RIDES,
  clubTimelineRides,
} from '@/components/clubs/clubTimeline'
import type { RideListItem } from '@/types'

/**
 * The `Club rides` strip's split (PD-319) — how many upcoming and how many past
 * rides one bounded scroller draws.
 *
 * **The rule is four slice indices and no other gate can see any of them.**
 * `tsc`, ESLint, `next build` and the walk all stay green through a strip that
 * silently drops a club's whole history, because the wrong answer is still a
 * valid array of rides. The story states both failures in one sentence — *"a
 * club with six upcoming rides shows no history at all and a club with none
 * shows six old ones"* — and each is asserted below by the case that produces
 * it.
 */

function ride(id: string, isUpcoming: boolean): RideListItem {
  return {
    id,
    is_upcoming: isUpcoming,
  } as RideListItem
}

const upcoming = (n: number) =>
  Array.from({ length: n }, (_, i) => ride(`u${i}`, true))
const past = (n: number) => Array.from({ length: n }, (_, i) => ride(`p${i}`, false))

const ids = (rides: RideListItem[]) => rides.map((r) => r.id)

describe('clubTimelineRides', () => {
  it('never draws more than the bound', () => {
    expect(clubTimelineRides(upcoming(20), past(20))).toHaveLength(CLUB_TIMELINE_RIDES)
  })

  it('puts every upcoming ride before every past one', () => {
    const out = clubTimelineRides(upcoming(2), past(4))
    const firstPast = out.findIndex((r) => !r.is_upcoming)
    expect(firstPast).toBeGreaterThan(0)
    expect(out.slice(firstPast).every((r) => !r.is_upcoming)).toBe(true)
  })

  it('holds slots for history when the upcoming half would fill the strip', () => {
    // The failure the reserve exists for: a plain `[...upcoming,
    // ...past].slice(0, 5)` here draws five upcoming rides and no history at
    // all — on exactly the club whose history is worth showing.
    const out = clubTimelineRides(upcoming(6), past(4))
    expect(ids(out)).toEqual(['u0', 'u1', 'u2', 'p0', 'p1'])
    expect(out.filter((r) => !r.is_upcoming)).toHaveLength(CLUB_TIMELINE_PAST_MIN)
  })

  it('gives the whole strip to history when there is nothing planned', () => {
    // The reserve is a floor, not a ceiling — a club that has stopped planning
    // still fills its strip rather than showing the two the floor names.
    expect(ids(clubTimelineRides([], past(6)))).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
  })

  it('gives the whole strip to upcoming rides when there is no history', () => {
    // The other half of the same sentence: a club with no past rides must not
    // be short-changed by slots reserved for rides that do not exist.
    expect(ids(clubTimelineRides(upcoming(6), []))).toEqual(['u0', 'u1', 'u2', 'u3', 'u4'])
  })

  it('lets the past half spend the slots the upcoming half cannot', () => {
    // Two upcoming and ten past fills the strip at 2 + 3 rather than stopping
    // at the two-slot floor.
    const out = clubTimelineRides(upcoming(2), past(10))
    expect(ids(out)).toEqual(['u0', 'u1', 'p0', 'p1', 'p2'])
  })

  it('shows one past ride when that is all there is', () => {
    // `Math.max` raises the reserve to 2 here; `Math.min` against the real
    // length is what stops it inventing a second chip.
    expect(ids(clubTimelineRides(upcoming(5), past(1)))).toEqual([
      'u0',
      'u1',
      'u2',
      'u3',
      'p0',
    ])
  })

  it('is empty only when the club has never ridden', () => {
    // What the strip's empty state now claims — the sentence changed with it,
    // from "No rides are planned, yet!" to one about the club never having
    // ridden.
    expect(clubTimelineRides([], [])).toEqual([])
    expect(clubTimelineRides([], past(1))).toHaveLength(1)
    expect(clubTimelineRides(upcoming(1), [])).toHaveLength(1)
  })
})
