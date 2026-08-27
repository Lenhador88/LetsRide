import type { RideListItem } from '@/types'

/**
 * How many rides the `Club rides` strip **shows**, upcoming and past together.
 * The design draws three in a horizontal scroller; five gives it something to
 * scroll without turning this section into the Rides sub-page, which `See all`
 * is one tap away from.
 *
 * It bounds the display rather than the read — `/clubs/detail` slices the same
 * `rides.list('club:<id>')` the sub-page reads in full.
 */
export const CLUB_TIMELINE_RIDES = 5

/**
 * How many of those five are held for past rides when the club has any.
 *
 * **The reserve is what stops the bound being decided by whichever half is
 * longer.** Slicing the plain concatenation would give a club with six upcoming
 * rides no history at all — which is exactly the club whose history proves it
 * rides — and, symmetrically, a club with none would fill the strip with six
 * old ones. Two is the smallest reserve that still reads as a run of past rides
 * rather than a stray chip.
 */
export const CLUB_TIMELINE_PAST_MIN = 2

/**
 * The club detail's ride strip: upcoming first, then past, bounded at
 * `CLUB_TIMELINE_RIDES` (PD-319).
 *
 * **A pure function rather than three lines inside the page**, for the reason
 * `guard.ts` and `resolveComboboxKey` are: the rule has four distinct
 * behaviours the story states in one sentence — *"a club with six upcoming
 * rides shows no history at all and a club with none shows six old ones"* —
 * and every one of them is a slice index that no other gate in this repo can
 * see. `tsc`, ESLint and `next build` all stay green through a strip that
 * silently drops a club's whole history.
 *
 * **The reserve is a floor on the past half, not a ceiling.** A club with two
 * upcoming rides and ten past ones draws three past chips, because the upcoming
 * half cannot spend the slots it does not have — so the strip is full whenever
 * there are five rides to fill it with, whichever halves they come from.
 *
 * The caller does not need to know the split, only the order: `RideChip` reads
 * `is_upcoming` off each item itself, so a past chip inverts its own fill
 * wherever it lands.
 */
export function clubTimelineRides(
  upcoming: RideListItem[],
  past: RideListItem[]
): RideListItem[] {
  const pastShown = Math.min(
    past.length,
    Math.max(CLUB_TIMELINE_PAST_MIN, CLUB_TIMELINE_RIDES - upcoming.length)
  )

  return [...upcoming.slice(0, CLUB_TIMELINE_RIDES - pastShown), ...past.slice(0, pastShown)]
}
