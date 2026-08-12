'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { MarkNotificationsRead } from '@/components/notifications/MarkNotificationsRead'
import { NotificationsListItem } from '@/components/notifications/NotificationsListItem'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getNotificationsPage, NOTIFICATIONS_PAGE_SIZE } from '@/lib/data/notifications'
import { getCurrentProfile } from '@/lib/data/profile'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { notificationSection } from '@/lib/utils'
import type { NotificationCursor, NotificationRow } from '@/types'

const SECTIONS = ['Today', 'Yesterday', 'This week', 'All time'] as const

/**
 * `Inbox - Notifications`, reached from the `secondaryAction` mailbox on the
 * four tab-root headers rather than from a nav tab of its own — Inbox was
 * dropped 2026-08-07 (PD-100) and this change does not restore it.
 *
 * **No `backHref`.** Every tab-root screen this is reached from renders none
 * either, because the bottom nav bar (fixed, on every `(app)` screen) is
 * always the way off. A static `backHref` would have to pick one of four
 * origins arbitrarily; this screen simply has none, matching its own
 * departure points rather than inventing a "came from" it cannot know without
 * `router.back()`, which `Header`'s `backHref` does not model.
 *
 * `MarkNotificationsRead` mounts unconditionally, independent of whether the
 * list has loaded — the same shape `MarkClubSeen`/`MarkFeedSeen` use — so
 * opening this screen clears the badge even if the list read itself is still
 * in flight or later fails.
 */
export default function NotificationsPage() {
  return (
    <>
      <Header title="Notifications" />
      <MarkNotificationsRead />
      <NotificationsScreen />
    </>
  )
}

function NotificationsScreen() {
  const online = useOnlineStatus()
  const first = useQuery(queryKeys.notifications.list(), () => getNotificationsPage())
  // A `ride_joined` row reads differently to the ride's organizer than to the
  // rest of its crew (PD-129), so the list needs the reader's own id. Shares
  // `profile.me()` with `/profile` and the postcard thread rather than adding a
  // narrower read of its own, so a rider arriving from either already has it.
  const profile = useQuery(queryKeys.profile.me(), getCurrentProfile)

  // Pages beyond the first are **not** cached under a key — `keys.ts`'s
  // `notifications.list()` covers page one only, matching the shape every
  // other unbounded read in this app takes rather than one held here for a
  // list with no natural "page 2" a second visit would want back. Appended in
  // local state and refetched from scratch on the next visit, the same
  // trade-off `getRideMessages`' own bounded window makes.
  const [extraPages, setExtraPages] = useState<NotificationRow[]>([])
  // The **most recently fetched** page's row count, not the accumulated
  // total — `extraPages` grows across every "Load more" tap, so its length
  // stops being a full-page signal after the second one. `null` means no
  // extra page has been fetched yet, so the first page's own count is what
  // decides whether a second page could exist.
  const [lastPageCount, setLastPageCount] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  const rows = [...(first.data ?? []), ...extraPages]
  const lastCount = lastPageCount ?? first.data?.length ?? 0
  // Fewer rows than asked for means there is nothing more — the same
  // saturating signal `RIDE_CREW_LIMIT` and its siblings use, applied here to
  // a page rather than to the whole list.
  const hasMore = first.data !== undefined && lastCount === NOTIFICATIONS_PAGE_SIZE

  async function loadMore() {
    const last = rows[rows.length - 1]
    if (!last) return

    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const cursor: NotificationCursor = { createdAt: last.created_at, id: last.id }
      const page = await getNotificationsPage(cursor)
      setExtraPages((prev) => [...prev, ...page])
      setLastPageCount(page.length)
    } catch {
      setLoadMoreError(
        online ? 'Could not load more notifications.' : "You're offline — try again once you're back."
      )
    } finally {
      setLoadingMore(false)
    }
  }

  const gate = combineQueries(first, profile)
  if (gate.error) {
    return (
      <ErrorState
        message={online ? undefined : "You're offline — try again once you're back."}
        onRetry={gate.refetch}
      />
    )
  }

  // Gated on the data, never on `isLoading` — `useQuery` starts its fetch in
  // an effect, so the first render pass has neither.
  //
  // **The profile is in this gate, where the postcard thread deliberately keeps
  // it out of its own, and the difference is a control against a sentence.**
  // There it decides whether a delete affordance is drawn, so arriving late
  // costs nothing. Here it decides whether a row claims "your ride" — a
  // statement about the reader, which would render wrong for one round trip and
  // then silently rewrite itself, which is the defect PD-129 exists to remove.
  // `null` is a decided answer and passes; only `undefined` holds the screen.
  if (!first.data || profile.data === undefined) return <SkeletonList />

  if (rows.length === 0) {
    // **The three kinds of zero rows collapse to one empty state,
    // deliberately.** Nothing has happened, everything is hidden by a block,
    // or every subject has become unresolvable all read identically from
    // here — this is the one screen in the app where permission-denied and
    // empty are not told apart, because distinguishing them would disclose a
    // block. Spec requirement, not an oversight.
    return (
      <p className="px-4 py-24 text-center text-sm font-medium text-muted">
        You have no notifications yet.
      </p>
    )
  }

  const viewerId = profile.data?.id
  const sections = SECTIONS.map((label) => ({
    label,
    rows: rows.filter((row) => notificationSection(row.created_at) === label),
  })).filter((section) => section.rows.length > 0)

  return (
    <div className="flex flex-col pb-8">
      {sections.map((section) => (
        <section key={section.label}>
          <SectionHeader title={section.label} />
          <ul className="flex flex-col">
            {section.rows.map((row) => (
              <li key={row.id}>
                <NotificationsListItem row={row} viewerId={viewerId} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 px-4 py-4">
          <Button variant="secondary" size="md" className="w-auto" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
          {loadMoreError && (
            <p role="alert" className="text-center text-sm text-danger">
              {loadMoreError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
