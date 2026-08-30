'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreatePostcardForm } from '@/components/postcards/CreatePostcardForm'
import { Header } from '@/components/layout/Header'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getMyClubs } from '@/lib/data/clubs'
import { getCrewRides } from '@/lib/data/rides'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { CREATE_CLUB_PARAM, CREATE_RIDE_PARAM, backFromCreateScreen } from '@/lib/routes'

/**
 * `New postcard`.
 *
 * **The `Suspense` boundary is not optional** — `useSearchParams()` outside one
 * opts the whole route out of prerendering, which `output: 'export'` refuses.
 * `src/lib/routes.ts` carries the full reasoning and the measurement.
 */
export default function NewPostcardPage() {
  return (
    <Suspense fallback={null}>
      <NewPostcardScreen />
    </Suspense>
  )
}

function NewPostcardScreen() {
  // Opened from a club, or from the Home tab's create button (PD-283); or from
  // a ride's Journal `Add` tile (PD-256) — only one of the two is ever present.
  // Both ids seed their selector and decide where back goes; neither
  // authorizes anything — see `CreatePostcardForm`'s `initialClubId` and
  // `initialRideId`.
  const params = useSearchParams()
  const fromClub = params.get(CREATE_CLUB_PARAM)
  const fromRide = params.get(CREATE_RIDE_PARAM)

  const clubs = useQuery(queryKeys.clubs.mine(), getMyClubs)
  // `fromRide` travels into the read, not just into the seed: a rider crew of
  // more than the scan window would otherwise get a composer reading "No ride"
  // on the one path that named a ride explicitly. See `getCrewRides`.
  const rides = useQuery(queryKeys.rides.crewOptions(fromRide), () => getCrewRides(fromRide))
  const gate = combineQueries(clubs, rides)

  return (
    <>
      <Header
        title="New postcard"
        backHref={backFromCreateScreen({ club: fromClub, ride: fromRide }, '/postcards')}
      />

      <div className="px-4 pb-8">
        {/* The club and ride pickers are the only things this screen reads,
            and a postcard with neither is the app-wide feed with no tag rather
            than an invalid one — so a rider could in principle compose while
            the lists are still arriving. It still waits: rendering the form
            first would put both selectors under a composer already in use,
            changing what Post does after the rider had decided what it did. */}
        {gate.error ? (
          <ErrorState onRetry={gate.refetch} />
        ) : !clubs.data || !rides.data ? (
          <SkeletonForm fields={2} />
        ) : (
          // `pt-4` here rather than on the wrapper: `SkeletonForm` and
          // `ErrorState` carry their own top padding, so a wrapper paying the
          // 16px would stack it and the first skeleton field would sit twice as
          // far down as the form that replaces it.
          <div className="pt-4 motion-safe:animate-fade-in">
            <CreatePostcardForm
              clubs={clubs.data}
              rides={rides.data}
              initialClubId={fromClub}
              initialRideId={fromRide}
            />
          </div>
        )}
      </div>
    </>
  )
}
