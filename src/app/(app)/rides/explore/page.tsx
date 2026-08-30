'use client'

import { Header } from '@/components/layout/Header'
import { ExploreRidesList } from '@/components/rides/ExploreRidesList'
import { MapAttribution } from '@/components/rides/MapAttribution'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getExploreRides } from '@/lib/data/rides'
import { getMyLocationText } from '@/lib/data/profile'
import { nearLabel } from '@/lib/location/near-label'
import { UseMyLocationRow } from '@/components/location/UseMyLocationRow'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * `Rides - Explore` — public rides this rider is not already on.
 *
 * **There is no Figma frame for this screen.** `npm run figma -- ls xplore`
 * finds `Clubs - Explore` and nothing else, so every choice here is borrowed
 * from that screen rather than measured: the same header shape, the same
 * sectioned list, the same two placeholder treatments in the same slots. Copied
 * deliberately — the two screens are one idea on two tabs, and a rider who
 * learns Explore on Clubs should not have to learn it again here. Recorded so
 * the next `figma:pull` knows this is convention, not fidelity.
 *
 * A real route rather than `/rides?explore=1`, following `/clubs/explore` and
 * the ride detail's sub-pages. A query parameter would have to be parsed and
 * validated before it reached a query, which is the defect `?club=` shipped on
 * the rides list; a segment cannot be malformed. That is also why this is the
 * one Rides screen with no `useSearchParams()` and so no `<Suspense>` boundary
 * to arrange around.
 *
 * ## What is not here, and why each absence is deliberate
 *
 * - **No past section.** `/rides` draws one under its own header; a ride that
 *   has already happened is not a ride to explore, so `getExploreRides` has no
 *   past window at all.
 * - **No filter bar.** Every tile on it is a slice of the rider's own world —
 *   their rides, their clubs — which is the half of the app this screen is the
 *   other side of. **Not its complement, and the difference matters**: a public
 *   ride in a club the rider has joined appears on both screens, because
 *   `getExploreRides` excludes the rides they are *on* and not the rides their
 *   clubs have planned. Read that function's header for why the overlap is
 *   intended rather than tolerated.
 * - **No RSVP control on the card.** `RideCard` links to the detail screen and
 *   that is where a ride is joined, exactly as `ClubCard`'s `Join club` is the
 *   one affordance Explore clubs adds. The asymmetry is the schema's: joining a
 *   club is one idempotent row, RSVPing is a three-way choice.
 *
 * `setRideAttendance` invalidates the whole `rides` prefix, which is what makes
 * a ride joined from the detail screen leave this list — the same prefix that
 * moves the `From clubs` tile's count on the tab root.
 */
export default function ExploreRidesPage() {
  // The same two reads as `/rides`, under the same keys — which is what makes
  // arriving here from the strip a cache hit rather than a second fetch, and
  // what keeps the strip's `near <place>` clause equal to the `Near <place>`
  // section below (PD-258's second trap, inherited whole).
  const near = useQuery(queryKeys.riderLocation(), resolveRiderLocation)
  const city = useQuery(queryKeys.profile.location(), getMyLocationText)

  // Held until the position is decided — see `/clubs` for the double fetch this
  // avoids. `undefined` is "not yet"; `null` is "no position", which is a real
  // answer and gets the unmeasured list.
  // `|| !!near.error` for the reason `/rides` spells out at its own gate: a
  // rejected read leaves `data` undefined for ever, and gating on that alone
  // parks this list in the skeleton branch with no retry. `resolveRiderLocation`
  // catches its own chain, so nothing can reach it today — which is why it is
  // worth one line rather than resting on a never-rejects guarantee that lives
  // in another module and is asserted nowhere.
  const positionDecided = near.data !== undefined || !!near.error
  const position = near.data ?? null
  const rides = useQuery(
    positionDecided ? queryKeys.rides.explore(position) : null,
    () => getExploreRides(position)
  )

  return (
    <>
      <Header title="Explore rides" backHref="/rides" />

      {/* `.pb-navbar-action-extra` because the Navbar carries a sticky
          `Create ride` on this route too — without it the last card sits under
          the button.

          The two placeholder treatments sit outside the `px-4`, not inside it:
          both are built at the list's own padding, so nesting would draw them
          16px narrower than the cards they stand in for. */}
      <div className="pb-navbar-action-extra">
        {rides.error ? (
          <ErrorState onRetry={rides.refetch} />
        ) : !rides.data ? (
          // Gated on the data, never on `isLoading` — see `combineQueries` for
          // the first-render tick where `isLoading` is false and there is still
          // nothing to draw.
          <SkeletonList />
        ) : (
          <div className="px-4 pt-4 motion-safe:animate-fade-in">
            {/* Above the list rather than below it, and only when the rider has
                no position at all — which is exactly when the sections below
                collapse to one unordered list and the strip that led here had
                to drop its `near …` clause. `px-0` because this slot is already
                inside a padded block. */}
            <UseMyLocationRow
              position={positionDecided ? position : undefined}
              className="px-0"
            />

            {rides.data.length === 0 ? (
              // The honest sentence for both of this screen's zeroes, which are
              // not the same thing: there may be no public rides at all, or the
              // rider may already be on every one of them. Distinguishing them
              // would need a second count of what was excluded, to say
              // something no rider would act on differently.
              <p className="py-8 text-center text-sm font-medium text-muted">
                There are no public rides to explore, yet!
              </p>
            ) : (
              <>
                <ExploreRidesList rides={rides.data} near={nearLabel(position, city.data)} />

                {/* One credit for every tile on this screen — PD-236, and keyed
                    on any card HAVING a tile rather than on one currently
                    drawing. `/rides` carries the identical block; read its
                    comment for why the distinction matters. */}
                {rides.data.some((ride) => !!ride.map_card_url) && <MapAttribution />}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
