'use client'

import { Header } from '@/components/layout/Header'
import { ClubCard } from '@/components/clubs/ClubCard'
import { ClubPageMenu } from '@/components/clubs/ClubPageMenu'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getExploreClubs } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * `Clubs - Explore` (`1918:9610`) — public clubs this rider has not joined.
 *
 * A real route rather than `/clubs?tab=explore`, following the ride detail's
 * sub-pages. A query parameter would have to be parsed and validated before it
 * reached a query, which is the defect `?club=` shipped on the rides list; a
 * segment cannot be malformed. That reasoning survives the render migration
 * intact — it is also why this is the one Clubs screen with no
 * `useSearchParams()` and so no `<Suspense>` boundary to arrange around.
 *
 * Every row here is `is Joined=False`, so the trailing slot is `Join club` and
 * never the unread counter — 015 will not accept a watermark for a club the
 * rider has not joined, so the two agree by construction rather than by
 * convention.
 *
 * `joinClub` invalidates the whole `clubs` prefix, which is what makes a joined
 * row leave this list and appear on Your clubs — the pair of `revalidatePath`
 * calls it replaces did the same thing by naming both routes.
 */
export default function ExploreClubsPage() {
  const clubs = useQuery(queryKeys.clubs.explore(), getExploreClubs)

  return (
    <>
      <Header title="Clubs" subRow={<ClubPageMenu current="explore" />} />

      {/* Outside the `px-4`, not inside it: both treatments are built at the
          list's own padding, so nesting would draw them 16px narrower than the
          cards they stand in for. */}
      <div className="pt-header-sub-extra">
        {clubs.error ? (
          <ErrorState onRetry={clubs.refetch} />
        ) : !clubs.data ? (
          <SkeletonList />
        ) : (
          <div className="px-4">
            {clubs.data.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-muted">
                There are no public clubs, yet!
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {clubs.data.map((club) => (
                  <li key={club.id}>
                    <ClubCard club={club} joined={false} />
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
