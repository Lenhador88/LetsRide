'use client'

import { Suspense, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { ClubDetailHeader } from '@/components/clubs/ClubDetailHeader'
import { ClubThreadRow } from '@/components/clubs/ClubThreadRow'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getClub } from '@/lib/data/clubs'
import {
  CLUB_THREADS_PAGE_SIZE,
  getClubThreadUnread,
  getClubThreads,
} from '@/lib/data/club-threads'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import type { ClubThreadCursor, ClubThreadListItem } from '@/types'

/**
 * A club's Threads — every thread, newest created first (`081`, PD-307).
 *
 * **There is no v2 frame for this screen**, so the composition is ours,
 * assembled from `Inbox - Chats`' measured row (`2375:9518`) — see
 * `ClubThreadRow`, which carries what was measured and what was not.
 *
 * ## Newest **created**, not most recently active
 *
 * design.md §Ordering has the argument and it is a visibility one rather than a
 * preference: a stored `last_message_at` is a copy of a visibility decision — it
 * would bump a thread for the very rider who blocked its latest author — and
 * computing it live is a per-viewer aggregate over every row of the list. The
 * cost is stated rather than softened: a club's oldest thread sinks, including
 * the Welcome club's greeting.
 *
 * ## This screen does not subscribe, deliberately
 *
 * One channel per thread on a list screen multiplies subscriptions by the thread
 * count, for titles that cannot change (`081` grants no UPDATE). It refetches by
 * its own cache key instead. The **thread** screen is the one that subscribes —
 * see `useClubThreadStream`. Saying so here is what makes a screen that
 * quietly does not subscribe distinguishable from one whose channel is broken.
 *
 * ## Permission-denied and empty are the same zero rows, and the club tells them apart
 *
 * A non-member of a *public* club can open this URL: the club is visible to
 * them and `081`'s threads are not. RLS answers both with zero rows, so the
 * club's own `viewer_role` — which `getClub` already carries — is what chooses
 * between the join prompt and the empty state. That is a UX affordance and never
 * the enforcement.
 */
export default function ClubThreadsPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per club — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <ClubThreadsScreen />
    </Suspense>
  )
}

function ClubThreadsScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''
  const online = useOnlineStatus()

  const club = useQuery(queryKeys.clubs.detail(id), () => getClub(id))
  const isMember = !!club.data?.viewer_role

  // Enabled once the club has come back **and** the viewer is in it: for anyone
  // else the read is guaranteed to be zero rows, and a `null` key is `useQuery`'s
  // "must not fetch and must not throw" state. It also keeps a malformed uuid
  // from reaching two reads instead of one — `getClub` answers `null` and this
  // screen 404s.
  const first = useQuery(
    club.data && isMember ? queryKeys.clubs.threads(id) : null,
    () => getClubThreads(id)
  )
  const unread = useQuery(
    club.data && isMember ? queryKeys.clubs.threadsUnread(id) : null,
    () => getClubThreadUnread(id)
  )

  // Page one lives in the cache; later pages are appended in local state and
  // refetched from scratch on the next visit — `notifications`' trade exactly.
  const [extraPages, setExtraPages] = useState<ClubThreadListItem[]>([])
  // The **most recently fetched** page's row count, not the accumulated total:
  // `extraPages` grows with every tap, so its length stops being a full-page
  // signal after the second one.
  const [lastPageCount, setLastPageCount] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  if (club.data === null) notFound()

  const header = <ClubDetailHeader clubId={id} club={club.data} current="threads" />

  const rows = [...(first.data ?? []), ...extraPages]
  const lastCount = lastPageCount ?? first.data?.length ?? 0
  // Fewer rows than asked for means there is nothing more — the saturating
  // signal every bounded read in this app uses, applied to a page.
  const hasMore = !!first.data && lastCount === CLUB_THREADS_PAGE_SIZE

  async function loadMore() {
    const last = rows[rows.length - 1]
    if (!last) return

    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const cursor: ClubThreadCursor = { createdAt: last.created_at, id: last.id }
      const page = (await getClubThreads(id, cursor)) ?? []
      setExtraPages((prev) => [...prev, ...page])
      setLastPageCount(page.length)
    } catch {
      setLoadMoreError(
        online ? 'Could not load more threads.' : "You're offline — try again once you're back."
      )
    } finally {
      setLoadingMore(false)
    }
  }

  // **Only the club and the thread list, never the unread read.** A failed
  // unread call must leave the list rendering unmarked rather than replacing it
  // with an error — and it cannot reach here anyway, because
  // `getClubThreadUnread` resolves to `{}` instead of throwing.
  if (club.error || first.error) {
    return (
      <>
        {header}
        <div className="pt-4">
          <ErrorState
            message={online ? undefined : "You're offline — try again once you're back."}
            onRetry={() => {
              void club.refetch()
              void first.refetch()
            }}
          />
        </div>
      </>
    )
  }

  // Gated on the data, never on `isLoading` — `useQuery` starts its fetch in an
  // effect, so the first render pass has neither. A non-member never issues the
  // thread read, so their gate is the club alone.
  if (!club.data || (isMember && !first.data)) {
    return (
      <>
        {header}
        <div className="pt-4">
          <SkeletonList rows={4} />
        </div>
      </>
    )
  }

  return (
    <>
      {header}

      <div className="pt-4 pb-8 motion-safe:animate-fade-in">
        {!isMember ? (
          <p className="px-4 py-16 text-center text-sm font-medium text-muted">
            Join the club to read and start threads.
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
            <p className="text-base font-semibold text-foreground">No threads yet</p>
            <p className="text-sm text-muted">
              Start one and the whole club can answer.
            </p>
            <Button href={routes.newClubThread(id)} size="md" className="w-auto">
              Start a thread
            </Button>
          </div>
        ) : (
          <>
            <div className="px-4 pb-2">
              {/* Near-black `Grey/100`, the app's primary — never green. */}
              <Button href={routes.newClubThread(id)} size="md" className="w-auto">
                Start a thread
              </Button>
            </div>
            <ul className="flex flex-col">
              {rows.map((thread) => (
                <li key={thread.id}>
                  <ClubThreadRow
                    thread={thread}
                    hasUnread={unread.data?.[thread.id] === true}
                  />
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="flex flex-col items-center gap-2 px-4 py-4">
                <Button
                  variant="secondary"
                  size="md"
                  className="w-auto"
                  onClick={loadMore}
                  loading={loadingMore}
                >
                  Load more
                </Button>
                {loadMoreError && (
                  <p role="alert" className="text-center text-sm text-danger">
                    {loadMoreError}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
