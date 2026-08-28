'use client'

import { getMyLocationText } from '@/lib/data/profile'
import { resolveRiderLocation, type RiderLocation } from '@/lib/location/rider-location'
import { nearLabel, type NearLabel } from '@/lib/location/near-label'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * Where the rider is, for any screen that measures a distance from it — the
 * three lines `/rides` had written out inline until PD-340 gave the same
 * question to `/clubs/detail/rides` and `/rides/detail`.
 *
 * **One key, `queryKeys.riderLocation()`, shared with `/clubs`,
 * `/clubs/explore` and `/rides/explore`.** That is the whole reason this is a
 * hook rather than a prop threaded down: a rider moving between those screens
 * pays for the position once, and — the half that actually matters — every
 * screen measures from the *same* coordinates. Two spellings of this read would
 * eventually be two answers, and a card saying `12 km away` on one screen and
 * `14 km` on the next is a bug nothing would catch.
 *
 * It never prompts. `resolveRiderLocation` answers with an already-granted
 * device position, or the geocoded profile city, or nothing at all.
 *
 * ## `settled` is not `!isLoading`, and the distinction is load-bearing
 *
 * **A failed position read is a DECIDED "no position", not "not yet".**
 * `useQuery` leaves `data` undefined for ever on a query that errored, so a
 * caller gating a second read on `data !== undefined` alone would park it in
 * flight permanently. `resolveRiderLocation` catches its own chain and resolves
 * `null`, so nothing can reach that today — which is exactly why the line is
 * worth keeping: otherwise the correctness of every caller rests on a
 * never-rejects guarantee living in another module and asserted nowhere.
 *
 * `settled` is what a caller holds a position-keyed read on. `position` alone is
 * what a caller renders from, and `null` there means "no distance to draw" — not
 * "zero kilometres". `withRideDistance` and `formatStartDistance` both take that
 * reading, so a card with no position simply draws no distance clause.
 */
export function useRiderPosition(): {
  position: RiderLocation | null
  settled: boolean
  /**
   * What to call the place distances were measured FROM, or `null` when there
   * is no position — never the profile city beside a device-measured distance.
   * `nearLabel` owns that rule; this only spares each caller the second read.
   */
  label: NearLabel
} {
  const position = useQuery(queryKeys.riderLocation(), resolveRiderLocation)
  // The rider's own city, for the `near …` label. Its own read rather than
  // `getCurrentProfile`, which would sign an avatar and a cover to render one
  // word.
  const city = useQuery(queryKeys.profile.location(), getMyLocationText)

  const value = position.data ?? null

  return {
    position: value,
    settled: position.data !== undefined || !!position.error,
    label: nearLabel(value, city.data),
  }
}
