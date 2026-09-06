'use client'

import { Suspense, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { RideHeader } from '@/components/rides/RideHeader'
import { RideThreadRow } from '@/components/rides/RideThreadRow'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getRide } from '@/lib/data/rides'
import {
  RIDE_THREADS_PAGE_SIZE,
  getRideThreadUnread,
  getRideThreads,
} from '@/lib/data/ride-threads'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import type { RideThreadCursor, RideThreadListItem } from '@/types'

/**
 * A ride's Threads — every thread, newest created first (`108`, PD-402).
 *
 * **There is no v2 frame for this screen.** The snapshot holds `Ride - Chat`,
 * `Ride - Chat - Options` and `Ride - Chat - Text focus` — the screens this
 * change deletes — and no frame for a thread list in either domain; the club's
 * thread screens were built without one too. So the composition is
 * `/clubs/detail/threads`' and is labelled as ours rather than as measured.
 *
 * ## Newest **created**, not most recently active
 *
 * The club's argument, and it is a visibility one rather than a preference: a
 * stored `last_message_at` is a copy of a visibility decision — it would bump a
 * thread for the very rider who blocked its latest author — and computing it
 * live is a per-viewer aggregate over every row of the list.
 *
 * ## This screen does not subscribe, deliberately
 *
 * One channel per thread on a list screen multiplies subscriptions by the thread
 * count, for titles that cannot change (`108` grants no UPDATE). It refetches by
 * its own cache key instead. The **thread** screen is the one that subscribes —
 * see `useRideThreadStream`. Saying so here is what makes a screen that quietly
 * does not subscribe distinguishable from one whose channel is broken.
 *
 * ## Permission-denied and empty are the same zero rows, and the ride tells them apart
 *
 * A rider who can see the ride but is not on its crew can open this URL: `083`
 * makes the ride readable to more riders than `private.is_ride_crew` admits to
 * its threads, and the audience here is the **intersection** of the two. RLS
 * answers both cases with zero rows, so the ride's own `is_crew` — which
 * `getRide` already carries — is what chooses between the join prompt and the
 * empty state. That is a UX affordance and never the enforcement.
 */
export default function RideThreadsPage() {
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per ride — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <RideThreadsScreen />
    </Suspense>
  )
}

function RideThreadsScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''
  const online = useOnlineStatus()

  const ride = useQuery(queryKeys.rides.detail(id), () => getRide(id))
  const isCrew = ride.data?.is_crew === true

  // Enabled once the ride has come back **and** the viewer is on its crew: for
  // anyone else the read is guaranteed to be zero rows, and a `null` key is
  // `useQuery`'s "must not fetch and must not throw" state. It also keeps a
  // malformed uuid from reaching two reads instead of one — `getRide` answers
  // `null` and this screen 404s.
  const first = useQuery(
    ride.data && isCrew ? queryKeys.rides.threads(id) : null,
    () => getRideThreads(id)
  )
  const unread = useQuery(
    ride.data && isCrew ? queryKeys.rides.threadsUnread(id) : null,
    () => getRideThreadUnread(id)
  )

  // Page one lives in the cache; later pages are appended in local state and
  // refetched from scratch on the next visit — `notifications`' trade exactly.
  const [extraPages, setExtraPages] = useState<RideThreadListItem[]>([])
  // The **most recently fetched** page's row count, not the accumulated total:
  // `extraPages` grows with every tap, so its length stops being a full-page
  // signal after the second one.
  const [lastPageCount, setLastPageCount] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  if (ride.data === null) notFound()

  const header = (
    <RideHeader
      rideId={id}
      title={ride.data?.title}
      current="threads"
      isCrew={ride.data?.is_crew}
      isOrganizer={ride.data?.is_organizer}
    />
  )

  const rows = [...(first.data ?? []), ...extraPages]
  const lastCount = lastPageCount ?? first.data?.length ?? 0
  // Fewer rows than asked for means there is nothing more — the saturating
  // signal every bounded read in this app uses, applied to a page.
  const hasMore = !!first.data && lastCount === RIDE_THREADS_PAGE_SIZE

  async function loadMore() {
    const last = rows[rows.length - 1]
    if (!last) return

    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const cursor: RideThreadCursor = { createdAt: last.created_at, id: last.id }
      const page = (await getRideThreads(id, cursor)) ?? []
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

  // **Only the ride and the thread list, never the unread read.** A failed
  // unread call must leave the list rendering unmarked rather than replacing it
  // with an error — and it cannot reach here anyway, because
  // `getRideThreadUnread` resolves to `{}` instead of throwing.
  if (ride.error || first.error) {
    return (
      <>
        {header}
        <div className="pt-4">
          <ErrorState
            message={online ? undefined : "You're offline — try again once you're back."}
            onRetry={() => {
              void ride.refetch()
              void first.refetch()
            }}
          />
        </div>
      </>
    )
  }

  // Gated on the data, never on `isLoading` — `useQuery` starts its fetch in an
  // effect, so the first render pass has neither. A non-crew rider never issues
  // the thread read, so their gate is the ride alone.
  if (!ride.data || (isCrew && !first.data)) {
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
        {!isCrew ? (
          <p className="px-4 py-16 text-center text-sm font-medium text-muted">
            Join the ride to read and start threads.
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
            <p className="text-base font-semibold text-foreground">No threads yet</p>
            <p className="text-sm text-muted">Start one and the whole crew can answer.</p>
            <Button href={routes.newRideThread(id)} size="md" className="w-auto">
              Start a thread
            </Button>
          </div>
        ) : (
          <>
            <div className="px-4 pb-2">
              {/* Near-black `Grey/100`, the app's primary — never green. */}
              <Button href={routes.newRideThread(id)} size="md" className="w-auto">
                Start a thread
              </Button>
            </div>
            <ul className="flex flex-col">
              {rows.map((thread) => (
                <li key={thread.id}>
                  <RideThreadRow
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
