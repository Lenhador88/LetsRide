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
 *
 * The `near <place>` wording is `useNearLabel` below, deliberately not a field
 * here — it costs a second read that only one screen needs.
 */
export function useRiderPosition(): {
  position: RiderLocation | null
  settled: boolean
} {
  const position = useQuery(queryKeys.riderLocation(), resolveRiderLocation)

  return {
    position: position.data ?? null,
    settled: position.data !== undefined || !!position.error,
  }
}

/**
 * What to call the place distances were measured FROM — `near Utrecht`, `near
 * you`, or nothing.
 *
 * **A second hook rather than a third field on the one above**, and the reason
 * is a round trip rather than tidiness: it reads `profiles.location`, which only
 * a screen that draws the words needs. One screen does — `/rides`, for the
 * Explore strip's `near <place>` clause. The four that merely render a distance
 * would have paid for a column they never draw, on every cold load of a club or
 * a ride detail by a rider who had not passed through `/rides` first.
 *
 * `nearLabel` owns the rule this exists for: the name must come from the same
 * source as the number, so a device fix reads `near you` rather than borrowing
 * the profile city it is nowhere near.
 */
export function useNearLabel(position: RiderLocation | null): NearLabel {
  // Its own read rather than `getCurrentProfile`, which would sign an avatar and
  // a cover to render one word.
  const city = useQuery(queryKeys.profile.location(), getMyLocationText)
  return nearLabel(position, city.data)
}
