'use client'

import { Header } from '@/components/layout/Header'
import { CreateRideForm } from '@/components/rides/CreateRideForm'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getMyClubs } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

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
 */
export default function NewRidePage() {
  const clubs = useQuery(queryKeys.clubs.mine(), getMyClubs)

  return (
    <>
      <Header title="Create ride" backHref="/rides" />

      <div className="px-4 pt-4 pb-8">
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
          <div className="motion-safe:animate-fade-in">
            <CreateRideForm clubs={clubs.data} />
          </div>
        )}
      </div>
    </>
  )
}
