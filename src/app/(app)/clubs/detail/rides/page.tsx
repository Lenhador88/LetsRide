'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { RideCard } from '@/components/rides/RideCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub } from '@/lib/data/clubs'
import { getRides } from '@/lib/data/rides'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'

/**
 * `Private club - Rides` (`2059:6390`) — reached only from the merged club
 * detail's Upcoming rides section (`See all`), which is why
 * `ClubDetailHeader`'s back button returns there rather than to `/clubs`.
 *
 * `showClub={false}` for the same reason `/rides?club=` drops the chip: every
 * card here belongs to the club already named in the header, and the design's
 * card is 128 tall rather than 156 when the chip is absent.
 *
 * Past rides are not shown, because `getRides` filters to upcoming and the
 * design draws no past section here. `RideCard` can render the `Went` variants,
 * so the day a history screen is designed it needs a query, not a component.
 *
 * The rides read shares `rides.list('club:<id>')` with the club page's own
 * `RideChip` strip and with `/rides?club=<id>`: one club's upcoming rides is
 * one list, so arriving here from any of those draws from cache. See the club
 * page for why its strip slices this list rather than asking for a shorter
 * one.
 */
export default function ClubRidesPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubRidesScreen />
    </Suspense>
  )
}

function ClubRidesScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))
  // Enabled only once the club is known to exist and be visible. `getRides`
  // raises on a malformed uuid, so issuing it eagerly would answer
  // `/clubs/not-a-uuid/rides` with an error screen where the server page
  // answered 404 — see the Timeline page for the full reasoning.
  const rides = useQuery(club.data ? queryKeys.rides.list(filterSegment.club(id)) : null, () =>
    getRides({ kind: 'club', id })
  )

  // `null` is "no such club, or one you may not see" — the same answer on
  // purpose. `undefined` is only "not yet", and 404-ing on it would flash a 404
  // on every load.
  if (club.data === null) notFound()

  // Above both gates: back comes from the URL via `current`, so it stays
  // usable while the club is arriving and when it has failed.
  const header = <ClubDetailHeader clubId={id} club={club.data} current="rides" />

  const gate = combineQueries(club, rides)

  return (
    <>
      {header}

      {/* No `.pt-header-sub-extra`: the sub-page switcher that made this
          header the 120px variant is deleted (the club detail merge), so the
          shell's own 96px is the whole of it and this owns its own 16px gap
          under that, matching the ride sub-pages' own `pt-4`. */}
      <div className="pt-4">
        {gate.error ? (
          <ErrorState onRetry={gate.refetch} />
        ) : !club.data || !rides.data ? (
          <SkeletonList rows={3} />
        ) : (
          <div className="px-4 motion-safe:animate-fade-in">
            {rides.data.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-muted">
                No rides are planned, yet!
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rides.data.map((ride) => (
                  <li key={ride.id}>
                    <RideCard ride={ride} showClub={false} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  )
}
