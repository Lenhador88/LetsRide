'use client'

import { RideCard } from '@/components/rides/RideCard'
import { isNearby } from '@/lib/location/distance'
import type { NearLabel } from '@/lib/location/near-label'
import type { RideListItem } from '@/types'

/**
 * The Explore list, split into what is near the rider and what is not — the
 * rides twin of `ExploreClubsList`, built to the same two rules for the same
 * two reasons.
 *
 * ## Why sectioned rather than merely sorted
 *
 * - **The strip's `near <place>` clause counts the near ones, and this screen
 *   would otherwise show all of them.** The row reads `Explore public rides
 *   near Hoorn`, the tap lands on thirty, and nothing says which of them are
 *   near Hoorn. That is PD-258's second trap — *a count that can disagree with
 *   the list one tap away* — in the shape it takes when the count has been
 *   replaced by a word. The heading is what makes the word true, because the
 *   first section is exactly what justified it.
 * - **Nothing renders a kilometre figure**, deliberately, so an order the
 *   rider cannot perceive as an order is not a feature.
 *
 * ## The order inside each section is departure, never distance
 *
 * `getExploreRides` states the rule this inherits: a ride is a thing to turn up
 * to on a date, so distance answers *where* and must not be allowed to reorder
 * *when*. Sorting by distance would put next month's ride two towns over above
 * tomorrow's ride three towns over — nearer, and useless. `getExploreRides`
 * returns departure order and this only partitions it, so both sections stay
 * soonest-first.
 *
 * ## Both headings, or neither
 *
 * Drawn only when there is a `near` label AND at least one ride under it.
 * Otherwise this is one plain list with no headings at all — a `More rides`
 * heading with nothing above it says a rider missed something.
 */
export function ExploreRidesList({
  rides,
  near,
}: {
  rides: RideListItem[]
  /** Where distances were measured from, or null when there is no position. */
  near: NearLabel
}) {
  const nearby = near ? rides.filter((ride) => isNearby(ride.distance_km)) : []
  const rest = near ? rides.filter((ride) => !isNearby(ride.distance_km)) : rides

  if (nearby.length === 0) {
    return <RideList rides={rest} />
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="px-2 text-sm font-semibold text-foreground">Near {near!.name}</h3>
        <RideList rides={nearby} />
      </section>

      {rest.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="px-2 text-sm font-semibold text-muted">More rides</h3>
          <RideList rides={rest} />
        </section>
      )}
    </div>
  )
}

/**
 * `showClub` stays on, unlike the club-filtered rides list. A rider exploring
 * has no context saying which club a ride belongs to, and for a public ride
 * from a club they have not joined that chip is most of what makes it
 * recognisable.
 */
function RideList({ rides }: { rides: RideListItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rides.map((ride) => (
        <li key={ride.id}>
          <RideCard ride={ride} showClub />
        </li>
      ))}
    </ul>
  )
}
