import { distanceKm, isNearby, NEARBY_RADIUS_KM } from '@/lib/location/distance'
import type { Coordinates } from '@/lib/location/distance'
import type { RideListItem } from '@/types'

/**
 * Which of the rides already on screen are near the rider — PD-260's whole
 * predicate, as a pure function over a list the page has already read.
 *
 * ## Why this filters a fetched list rather than querying for one
 *
 * `getRides` reads a bounded page (`RIDES_PAGE_SIZE`), exactly as
 * `getExploreClubs` does, so measuring that page costs one `Math` call per row
 * and no second round trip. `distance.ts` carries the fuller argument and the
 * trigger for moving it into SQL: a ride count that outgrows the page, at which
 * point the question stops being "which of these thirty" and becomes "find the
 * nearest thirty of five thousand", which no client-side helper can answer.
 *
 * There is a second reason here that Clubs does not have. The rider's position
 * resolves in the browser, asynchronously, *after* the list read is already in
 * flight — so a position-keyed query would fetch the list under `unlocated`,
 * then fetch it again under a coordinate the moment the position landed, and
 * the rider would watch the list blank back to a skeleton. `/clubs` documents
 * that double fetch and holds its explore query on a `null` key to avoid it.
 * Filtering in place sidesteps it entirely: **toggling near-you issues no query
 * at all**, because the rows are already here.
 *
 * ## What it deliberately does not do
 *
 * **It does not re-sort.** The list stays in departure order, because a ride is
 * a thing to turn up to on a date and the near filter answers *where*, not
 * *when*. Sorting by distance would put next month's ride two towns over above
 * tomorrow's ride three towns over — nearer, and useless.
 */

/**
 * The rides within `NEARBY_RADIUS_KM` of `position`, in the order they arrived.
 *
 * An empty array when there is no position, and that conflation with "none are
 * near" is deliberate at *this* layer: both mean "nothing to show under a near
 * heading". The **caller** must still tell them apart, because they draw
 * differently — `undefined` from `resolveRiderLocation` is "not yet", and
 * `NearbyRidesStrip` is what owns that distinction.
 *
 * A ride whose coordinate is null is dropped rather than kept: `distanceKm`
 * answers `null` for it, `isNearby` answers false, and a ride nothing can
 * measure must never be counted as near. That is the same rule
 * `withDistance` applies on the clubs side, and it is why the count this
 * produces can be lower than the list the rider is looking at.
 */
export function nearbyRides(
  rides: RideListItem[] | undefined,
  position: Coordinates | null | undefined
): RideListItem[] {
  if (!rides || !position) return []

  return rides.filter((ride) =>
    isNearby(
      distanceKm(position, rideCoordinates(ride))
    )
  )
}

/**
 * A ride's start as a coordinate pair, or `null` when it has neither.
 *
 * Both columns are nullable independently in the schema, so this refuses a half
 * pair rather than passing a `NaN` down. `067`'s `rides_location_coupling`
 * makes a half pair unreachable through the app's own writes; this does not
 * rely on that, because the type says nothing about it and a CHECK is not a
 * type.
 */
function rideCoordinates(ride: RideListItem): Coordinates | null {
  if (ride.latitude === null || ride.longitude === null) return null
  return { lat: ride.latitude, lon: ride.longitude }
}

export { NEARBY_RADIUS_KM }
