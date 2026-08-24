'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { CreateRideForm } from '@/components/rides/CreateRideForm'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getMyClubs } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { CREATE_CLUB_PARAM, backFromCreateScreen } from '@/lib/routes'

/**
 * `Create ride`.
 *
 * **There is no v2 design for this screen**: its epic reads To do and the frame
 * is OLD-stylesheet throughout. See `CreateRideForm` for what that means and for
 * the five things the v1 frame draws that the schema cannot support.
 *
 * `getMyClubs()` already existed for the postcard composer, so offering a club
 * needed no new read — the fifth time reusing beat rebuilding here.
 *
 * ## `'use client'` again, and why that is not a return to v1
 *
 * This screen was the last one to leave the v1 pattern: a client page that
 * queried Supabase itself and then called `router.refresh()`. It is a client
 * page once more under the render migration, and **the thing that made it v1 is
 * still gone** — the read goes through `lib/data/`, the write through
 * `lib/actions/`, and neither boundary moved. What changed is only which
 * Supabase client those two construct, which is the whole reason the migration
 * is bounded.
 *
 * **The `Suspense` boundary is not optional** — `useSearchParams()` outside one
 * opts the whole route out of prerendering, which `output: 'export'` refuses.
 * `src/lib/routes.ts` carries the full reasoning and the measurement.
 */
export default function NewRidePage() {
  return (
    <Suspense fallback={null}>
      <NewRideScreen />
    </Suspense>
  )
}

function NewRideScreen() {
  const clubs = useQuery(queryKeys.clubs.mine(), getMyClubs)

  // Opened from a club, or from the Rides tab's create button (PD-283). The id
  // seeds the club selector and decides where back goes; it authorizes nothing
  // — see `CreateRideForm`'s `initialClubId`.
  const fromClub = useSearchParams().get(CREATE_CLUB_PARAM)

  return (
    <>
      <Header title="Create ride" backHref={backFromCreateScreen(fromClub, '/rides')} />

      <div className="px-4 pb-8">
        {/* The club picker is the only thing this screen reads, and a ride with
            no club is an ordinary ride rather than an invalid one — so a rider
            could in principle start typing before the list arrives. It still
            waits, for the same reason the postcard composer does: the picker
            would appear under a form already in use, and here it also decides
            what "Make this ride public" means, because 022 refuses a public
            ride in a private club. */}
        {clubs.error ? (
          <ErrorState onRetry={clubs.refetch} />
        ) : !clubs.data ? (
          <SkeletonForm />
        ) : (
          // `pt-4` here rather than on the wrapper: `SkeletonForm` and
          // `ErrorState` carry their own top padding, so a wrapper paying the
          // 16px would stack it and the first skeleton field would sit twice as
          // far down as the form that replaces it.
          <div className="pt-4 motion-safe:animate-fade-in">
            <CreateRideForm clubs={clubs.data} initialClubId={fromClub} />
          </div>
        )}
      </div>
    </>
  )
}
