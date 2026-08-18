'use client'

import { Header } from '@/components/layout/Header'
import { ClubCard } from '@/components/clubs/ClubCard'
import { ExploreClubsStrip } from '@/components/clubs/ExploreClubsStrip'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getExploreClubs, getYourClubs } from '@/lib/data/clubs'
import { useQuery, type UseQueryResult } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { ClubListItem } from '@/types'

/**
 * The Clubs tab — one screen (PD-258).
 *
 * `ClubPageMenu` is gone: the tab was two sub-pages behind a `Your clubs ⌄`
 * dropdown and the product owner's objection to it was the same one PD-254
 * acted on for the ride detail — the control hides the destination it exists to
 * offer. So the header is the plain 96px title again (no `subRow`, and no
 * `.pt-header-sub-extra` on top of the shell's `.pt-header`), and `Explore` is
 * reached from the strip instead.
 *
 * **With no clubs joined, the explore list *is* this screen.** Rendered in
 * place, on this route — not a redirect to `/clubs/explore`, which was the
 * alternative considered and rejected: the decision reads from data rather than
 * session, so it cannot live in `lib/auth/guard.ts` and would have to fire from
 * an effect after the read lands — skeleton, then empty, then a jump, then a
 * second skeleton. It also reverses the moment a rider leaves their last club,
 * so the tab would start bouncing with nothing on screen saying why. Same
 * destination, one render, no history to reason about.
 *
 * That deletes the `You have no clubs, yet!` empty state rather than restyling
 * it. A screen whose whole content is a sentence telling a rider what they do
 * not have is the one this app most wants back.
 *
 * **Both reads issue on every load, and the explore one is not waste.** It is
 * the strip's count, and it has to be *this* read rather than a cheaper
 * `head: true` count: `getExploreClubs` excludes clubs you have joined in JS,
 * against the page it fetched, so no server-side count can reproduce the
 * predicate. A number derived any other way is PD-254's crew-count bug again —
 * a count that disagrees with the list one tap away. Same key as
 * `/clubs/explore` uses, so navigating there is a cache hit rather than a
 * second fetch.
 */
export default function ClubsPage() {
  const yours = useQuery(queryKeys.clubs.yours(), getYourClubs)
  const explore = useQuery(queryKeys.clubs.explore(), getExploreClubs)

  return (
    <>
      <Header title="Clubs" secondaryAction={<NotificationsHeaderControl />} />

      {/* The two placeholder treatments carry their own horizontal padding —
          `SkeletonList` is built at the list's own `px-4` — so they replace the
          padded block rather than sit inside it. Nested, the placeholder rows
          would lay out 16px narrower than the cards that replace them. */}
      {yours.error ? (
        <ErrorState onRetry={yours.refetch} />
      ) : !yours.data ? (
        // Gated on the data, never on `isLoading` — see `combineQueries` for
        // the first-render tick where `isLoading` is false and there is still
        // nothing to draw. An empty array is data, so the branch below still
        // gets its turn.
        <SkeletonList />
      ) : yours.data.length === 0 ? (
        <NoClubsYet explore={explore} />
      ) : (
        <div className="flex flex-col gap-4 px-4 motion-safe:animate-fade-in">
          {/* `explore.data?.length` rather than a gate: the strip draws itself
              without a number until the count lands, and keeps the route
              reachable if that read fails outright. */}
          <ExploreClubsStrip count={explore.data?.length} />

          <ul className="flex flex-col gap-2">
            {yours.data.map((club) => (
              <li key={club.id}>
                <ClubCard club={club} joined />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

/**
 * The screen a rider sees before they have joined anything: the clubs they
 * could join, under one line saying why they are looking at them.
 *
 * Its own gate rather than one `if` over both reads at the top — the rule
 * `combineQueries` states, and here it is what stops a rider *with* clubs
 * waiting on the explore read to see their own list.
 */
function NoClubsYet({ explore }: { explore: UseQueryResult<ClubListItem[]> }) {
  if (explore.error) return <ErrorState onRetry={explore.refetch} />
  if (!explore.data) return <SkeletonList />

  return (
    <div className="flex flex-col gap-4 px-4 motion-safe:animate-fade-in">
      <div className="flex flex-col gap-0.5 px-2">
        <h2 className="text-xl font-semibold text-foreground">Clubs near you</h2>
        <p className="text-sm font-medium text-muted">You have not joined a club yet.</p>
      </div>

      {explore.data.length === 0 ? (
        // Both lists empty. The heading above already says what this screen is
        // for, so this is the one line that is left to say.
        <p className="py-8 text-center text-sm font-medium text-muted">
          There are no public clubs, yet!
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {explore.data.map((club) => (
            <li key={club.id}>
              <ClubCard club={club} joined={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
