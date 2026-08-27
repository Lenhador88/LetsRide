'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { MapAttribution } from '@/components/rides/MapAttribution'
import { RideCard } from '@/components/rides/RideCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub } from '@/lib/data/clubs'
import { getRides } from '@/lib/data/rides'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM } from '@/lib/routes'
import type { RideListItem } from '@/types'

/**
 * `Private club - Rides` (`2059:6390`) — reached only from the merged club
 * detail's Upcoming rides section (`See all`), which is why
 * `ClubDetailHeader`'s back button returns there rather than to `/clubs`.
 *
 * `showClub={false}` for the same reason `/rides?club=` drops the chip: every
 * card here belongs to the club already named in the header, and the design's
 * card is 128 tall rather than 156 when the chip is absent.
 *
 * Past rides sit under their own header, which is what `Private club - Rides`
 * draws — two `Section / Header` instances, "Upcoming rides" over "Past rides".
 * `/rides` borrows the same string rather than wording a club's history and a
 * rider's own differently, which would be the same string decided twice.
 *
 * The upcoming section keeps the design's header off. On `/rides` the list has
 * a filter bar over it and on the club page a `See all`, but here the header
 * already names the club and the tab, so a second "Upcoming rides" line
 * restates it. The Past rides header earns its place by separating two
 * lists; a header over the first one would only label what is already the
 * screen.
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
          <div className="motion-safe:animate-fade-in px-4">
            {rides.data.upcoming.length === 0 && rides.data.past.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-muted">
                No rides are planned, yet!
              </p>
            ) : (
              <>
                {rides.data.upcoming.length === 0 ? (
                  // Not the same sentence as the branch above, which claims the
                  // club has no rides at all: there are rides right under this
                  // one. Only the upcoming half is empty, and it has to say so.
                  <p className="py-8 text-center text-sm font-medium text-muted">
                    No upcoming rides are planned, yet!
                  </p>
                ) : (
                  <RideList rides={rides.data.upcoming} />
                )}

                {rides.data.past.length > 0 && (
                  <>
                    {/* `px-0`: this screen's own wrapper already carries the
                        `px-4` the header would otherwise double. */}
                    <SectionHeader title="Past rides" className="px-0 pb-2 pt-4" />
                    <RideList rides={rides.data.past} />
                  </>
                )}

                {/* **The third tile surface, and the one that had no credit at
                    all** — PD-236. This screen draws `RideCard` off the same
                    `getRides` read as `/rides`, so its strips are the same
                    Geoapify imagery with the burned-in credit suppressed. It was
                    missed on the first pass because the credit followed the
                    screens the issue named rather than the component that draws
                    a tile.

                    **That is the rule to apply to the next one:** anything
                    rendering `map_card_url` or `map_detail_url` owes this, and
                    the count is three today — here, `/rides`, and `/rides/detail`
                    via `RideMap`. Re-derive it rather than trusting the number:
                    `git grep -l "map_card_url\|map_detail_url" -- 'src/app' 'src/components'`.

                    `px-0` for this screen's own wrapper, as above. */}
                {[...rides.data.upcoming, ...rides.data.past].some(
                  (ride) => !!ride.map_card_url,
                ) && <MapAttribution className="px-0 pt-2" />}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/** One section of the screen. Both draw the same card, with the club chip off. */
function RideList({ rides }: { rides: RideListItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rides.map((ride) => (
        <li key={ride.id}>
          <RideCard ride={ride} showClub={false} />
        </li>
      ))}
    </ul>
  )
}
