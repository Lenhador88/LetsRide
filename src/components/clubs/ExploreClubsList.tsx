'use client'

import { ClubCard } from '@/components/clubs/ClubCard'
import { isNearby } from '@/lib/location/distance'
import type { NearLabel } from '@/lib/location/near-label'
import type { ClubListItem } from '@/types'

/**
 * The Explore list, split into what is near the rider and what is not
 * (PD-259).
 *
 * ## Why this is sectioned rather than merely sorted
 *
 * `getExploreClubs` already returns near clubs first. Sorting alone was the
 * first build and review killed it, for two reasons that compound:
 *
 * - **The strip counts the near ones and this screen showed all of them.** The
 *   row reads `Explore 3 clubs near Utrecht`, the tap lands on twelve, and
 *   nothing marks which three. That is PD-258's second trap — *"a count that
 *   can disagree with the list one tap away"* — in a new shape: same query,
 *   an extra predicate applied on one side only. The heading is what makes the
 *   number true again, because the first section is exactly what was counted.
 * - **A distance-ordered list nobody can perceive as distance-ordered is not a
 *   feature.** Nothing renders a kilometre figure (deliberately — a precise
 *   distance to a club is a false precision, since a club's location is a town
 *   rather than a doorstep), so without a heading the order is invisible.
 *
 * ## Both headings, or neither
 *
 * The sections are drawn only when there is a `near` label AND at least one
 * club under it. Otherwise this is one plain list with no headings at all —
 * a `More clubs` heading with nothing above it says a rider missed something.
 */
export function ExploreClubsList({
  clubs,
  near,
  onJoined,
}: {
  clubs: ClubListItem[]
  /** Where distances were measured from, or null when there is no position. */
  near: NearLabel
  /** Forwarded to every `JoinClubButton` on this list — see its own header. */
  onJoined?: (clubId: string) => void
}) {
  const nearby = near ? clubs.filter((club) => isNearby(club.distance_km)) : []
  const rest = near ? clubs.filter((club) => !isNearby(club.distance_km)) : clubs

  if (nearby.length === 0) {
    return <ClubList clubs={rest} onJoined={onJoined} />
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="px-2 text-sm font-semibold text-foreground">Near {near!.name}</h3>
        <ClubList clubs={nearby} onJoined={onJoined} />
      </section>

      {rest.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="px-2 text-sm font-semibold text-muted">More clubs</h3>
          <ClubList clubs={rest} onJoined={onJoined} />
        </section>
      )}
    </div>
  )
}

function ClubList({
  clubs,
  onJoined,
}: {
  clubs: ClubListItem[]
  onJoined?: (clubId: string) => void
}) {
  return (
    <ul className="flex flex-col gap-2">
      {clubs.map((club) => (
        <li key={club.id}>
          <ClubCard club={club} joined={false} onJoined={onJoined} />
        </li>
      ))}
    </ul>
  )
}
