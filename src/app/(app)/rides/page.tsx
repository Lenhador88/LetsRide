'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { RideCard } from '@/components/rides/RideCard'
import { RideFilterBar } from '@/components/rides/RideFilterBar'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getRideFilters, getRides } from '@/lib/data/rides'
import { combineQueries, useQuery } from '@/lib/query'
import { filterSegment, queryKeys } from '@/lib/query/keys'
import { parseRideFilter } from '@/lib/validation/rides'
import type { RideFilter } from '@/types'

/**
 * The rides list — `Home - Rides - All`, `… - Your rides` and `… - Rides from
 * club` in the design, which are one screen under three filters rather than
 * three screens.
 *
 * Unlike `/postcards`, this one scrolls: the design's list frame is 810 tall
 * inside a 492 viewport slot. So it keeps the shell's flow layout and only tops
 * up the bottom padding, because the nav bar on this screen carries the sticky
 * "Create ride" action and is the taller of the design's two variants.
 *
 * Every filter shows **upcoming** rides, which is what all four frames draw and
 * what the "You have no upcoming rides, yet!" empty state says. Ride history has
 * no screen in this flow; `RideCard` renders the design's past variants ("Went")
 * because a ride can pass while the page is open, but nothing here lists a ride
 * whose departure is behind us.
 *
 * ## The split, and why the padding wrapper is out here
 *
 * `useSearchParams()` requires a `<Suspense>` boundary above it — Next refuses
 * to prerender a page that reads it without one — so the filter has to be read
 * one component down from the default export. The header and the nav-bar
 * padding stay outside it: both are the same whether the list has arrived or
 * not, and the padding in particular is what keeps the skeleton clear of the
 * sticky action exactly as the loaded list is.
 */
export default function RidesPage() {
  return (
    <>
      <Header title="Rides" secondaryAction={<NotificationsHeaderControl />} />
      {/* The shell reserves the 88px nav bar; this screen's bar is the 152px
          variant, so it owes the sticky action's own height. The number lives
          in globals.css beside the other two, not here. */}
      <div className="pb-navbar-action-extra flex flex-col">
        <Suspense fallback={<SkeletonList />}>
          <RidesScreen />
        </Suspense>
      </div>
    </>
  )
}

function RidesScreen() {
  const searchParams = useSearchParams()

  // Parsed, not read: a malformed `?club=` would otherwise reach
  // `.eq('club_id', …)` and 400 the whole tab. See lib/validation/rides.ts.
  // `useSearchParams` answers a missing key with null where the server handed
  // over an absent property, and the schema's `.optional()` means undefined.
  const filter = parseRideFilter({
    filter: searchParams.get('filter') ?? undefined,
    club: searchParams.get('club') ?? undefined,
  })

  // `keys.ts` types the list key's filter segment as `string | null`, so the
  // discriminated union is flattened into one string. The kind stays part of it
  // rather than being dropped to the id: `mine` carries no id at all, and two
  // different filters sharing a cache entry is the kind of bug that only shows
  // up as somebody else's rides.
  const filterKey = filter
    ? filter.kind === 'club'
      ? filterSegment.club(filter.id)
      : filterSegment.mine()
    : null

  // The filter bar always describes every upcoming ride, never the filtered
  // slice — otherwise picking a club would erase every other tile and strand
  // you there with no way back. That is why it has its own key with no filter
  // segment, and why changing the filter refetches one of these two, not both.
  const rides = useQuery(queryKeys.rides.list(filterKey), () => getRides(filter))
  const filters = useQuery(queryKeys.rides.filters(), () => getRideFilters())

  const gate = combineQueries(rides, filters)
  if (gate.error) return <ErrorState onRetry={gate.refetch} />

  // Gated on the data, not on `isLoading` — see `combineQueries` for the tick
  // where `isLoading` is false and there is still nothing to draw.
  if (!rides.data || !filters.data) return <SkeletonList />

  return (
    <>
      <RideFilterBar filters={filters.data} active={filter} />

      {rides.data.length === 0 ? (
        <EmptyList filter={filter} />
      ) : (
        <div className="flex flex-col gap-2 px-4 py-2">
          {rides.data.map((ride) => (
            <RideCard key={ride.id} ride={ride} showClub={filter?.kind !== 'club'} />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Two of these three strings are the design's, verbatim. The club one is not
 * drawn — `Home - Rides - Rides from club` has no empty variant — so it is
 * written to match their shape rather than invented in a different voice.
 */
function EmptyList({ filter }: { filter?: RideFilter }) {
  const message =
    filter?.kind === 'mine'
      ? 'You have no upcoming rides, yet!'
      : filter?.kind === 'club'
        ? 'This club has no upcoming rides, yet!'
        : 'There are no rides, yet!'

  return (
    <p className="px-4 py-24 text-center text-sm font-medium text-muted">{message}</p>
  )
}
