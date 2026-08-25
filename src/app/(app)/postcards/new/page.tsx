'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreatePostcardForm } from '@/components/postcards/CreatePostcardForm'
import { Header } from '@/components/layout/Header'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getMyClubs } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { CREATE_CLUB_PARAM, backFromCreateScreen } from '@/lib/routes'

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
  const clubs = useQuery(queryKeys.clubs.mine(), getMyClubs)

  // Opened from a club, or from the Home tab's create button (PD-283). The id
  // seeds the audience selector and decides where back goes; it authorizes
  // nothing — see `CreatePostcardForm`'s `initialClubId`.
  const fromClub = useSearchParams().get(CREATE_CLUB_PARAM)

  return (
    <>
      <Header title="New postcard" backHref={backFromCreateScreen(fromClub, '/postcards')} />

      <div className="px-4 pb-8">
        {/* The club picker is the only thing this screen reads, and a postcard
            with no club is the app-wide feed rather than an invalid one — so a
            rider could in principle compose while the list is still arriving. It
            still waits: rendering the form first would put the audience selector
            under a composer already in use, changing what Post does after the
            rider had decided what it did. */}
        {clubs.error ? (
          <ErrorState onRetry={clubs.refetch} />
        ) : !clubs.data ? (
          <SkeletonForm fields={2} />
        ) : (
          // `pt-4` here rather than on the wrapper: `SkeletonForm` and
          // `ErrorState` carry their own top padding, so a wrapper paying the
          // 16px would stack it and the first skeleton field would sit twice as
          // far down as the form that replaces it.
          <div className="pt-4 motion-safe:animate-fade-in">
            <CreatePostcardForm clubs={clubs.data} initialClubId={fromClub} />
          </div>
        )}
      </div>
    </>
  )
}
