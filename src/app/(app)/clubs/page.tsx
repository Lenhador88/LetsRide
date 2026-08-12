'use client'

import { Header } from '@/components/layout/Header'
import { ClubCard } from '@/components/clubs/ClubCard'
import { ClubPageMenu } from '@/components/clubs/ClubPageMenu'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getYourClubs } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * `Clubs - Your clubs` (`1914:6862`) — every club this rider has joined.
 *
 * The Clubs tab is two sub-pages behind the header's dropdown, the same
 * mechanism the ride detail uses, and `/clubs/explore` is the other one. The
 * `Create club` primary sits in the Navbar's sticky action slot, which is where
 * the design puts it: inside the bar, above the tabs.
 *
 * `.pt-header-sub-extra` on top of the shell's `.pt-header`, because the
 * sub-page row makes the header 120 tall rather than 96. It is a 24px top-up
 * rather than a replacement — omitting it leaves 24px of content underneath.
 *
 * The read is `useQuery`, which issues it from an effect. That is not a style
 * choice: a `'use client'` component is still server-rendered until Phase 6,
 * and in that pass there is no session for the browser client to find, so a
 * read during render fails closed at RLS. See `lib/supabase/resolve.ts`.
 *
 * `markClubSeen` invalidates `clubs.yours()`, so opening a club and coming back
 * redraws this list with its badge cleared — the freshness
 * `revalidatePath('/clubs')` used to claim.
 */
export default function ClubsPage() {
  const clubs = useQuery(queryKeys.clubs.yours(), getYourClubs)

  return (
    <>
      <Header
        title="Clubs"
        subRow={<ClubPageMenu current="yours" />}
        secondaryAction={<NotificationsHeaderControl />}
      />

      {/* The two placeholder treatments carry their own horizontal padding —
          `SkeletonList` is built at the list's own `px-4` — so they replace the
          padded block rather than sit inside it. Nested, the placeholder rows
          would lay out 16px narrower than the cards that replace them. */}
      <div className="pt-header-sub-extra">
        {clubs.error ? (
          <ErrorState onRetry={clubs.refetch} />
        ) : !clubs.data ? (
          // Gated on the data, never on `isLoading` — see `combineQueries` for
          // the first-render tick where `isLoading` is false and there is still
          // nothing to draw. An empty array is data, so the empty state below
          // still gets its turn.
          <SkeletonList />
        ) : (
          <div className="px-4 motion-safe:animate-fade-in">
            {clubs.data.length === 0 ? (
              // The design's empty state is one line of Grey/80 at
              // Poppins/14/Medium and nothing else — no illustration, and no
              // second Create button, since the sticky action is already on
              // screen.
              <p className="py-8 text-center text-sm font-medium text-muted">
                You have no clubs, yet!
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {clubs.data.map((club) => (
                  <li key={club.id}>
                    <ClubCard club={club} joined />
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
