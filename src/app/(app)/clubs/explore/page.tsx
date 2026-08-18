'use client'

import { Header } from '@/components/layout/Header'
import { ClubCard } from '@/components/clubs/ClubCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getExploreClubs } from '@/lib/data/clubs'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * `Clubs - Explore` — public clubs this rider has not joined.
 *
 * A real route rather than `/clubs?tab=explore`, following the ride detail's
 * sub-pages. A query parameter would have to be parsed and validated before it
 * reached a query, which is the defect `?club=` shipped on the rides list; a
 * segment cannot be malformed. That reasoning survives the render migration
 * intact — it is also why this is the one Clubs screen with no
 * `useSearchParams()` and so no `<Suspense>` boundary to arrange around.
 *
 * **The title and the back button are both new, and both are consequences of
 * PD-258 deleting `ClubPageMenu`.** The dropdown was this screen's only way
 * back, and it was also the only thing distinguishing it from `/clubs` — both
 * headers read `Clubs` and the sub-row said which one you were on. With it gone
 * the screen names itself and `backHref` returns to the tab root.
 *
 * Every row here is `is Joined=False`, so the trailing slot is `Join club` and
 * never the unread counter — 015 will not accept a watermark for a club the
 * rider has not joined, so the two agree by construction rather than by
 * convention.
 *
 * `joinClub` invalidates the whole `clubs` prefix, which is what makes a joined
 * row leave this list and appear on Your clubs — and, since PD-258, what moves
 * the strip's count on the tab root, because that count is `getExploreClubs`
 * read under this same key.
 */
export default function ExploreClubsPage() {
  // Same two reads as `/clubs`, in the same order and under the same keys —
  // which is what makes arriving here from the strip a cache hit rather than a
  // second fetch, and what keeps the strip's count equal to this list's length
  // (PD-258's second trap).
  const near = useQuery(queryKeys.riderLocation(), resolveRiderLocation)
  const clubs = useQuery(queryKeys.clubs.explore(near.data), () =>
    getExploreClubs(near.data)
  )

  return (
    <>
      <Header title="Explore clubs" backHref="/clubs" />

      {/* `.pb-navbar-action-extra` because the Navbar carries a sticky
          `Create club` on this route too — without it the last card sits under
          the button. Missing on both club screens until PD-258.

          The two placeholder treatments sit outside the `px-4`, not inside it:
          both are built at the list's own padding, so nesting would draw them
          16px narrower than the cards they stand in for. */}
      <div className="pb-navbar-action-extra">
        {clubs.error ? (
          <ErrorState onRetry={clubs.refetch} />
        ) : !clubs.data ? (
          <SkeletonList />
        ) : (
          <div className="px-4 pt-4 motion-safe:animate-fade-in">
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
