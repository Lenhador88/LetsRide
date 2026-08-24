'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { NotificationsListItem } from '@/components/notifications/NotificationsListItem'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { linkWithOrigin } from '@/lib/back-navigation'
import { getCurrentProfile } from '@/lib/data/profile'
import { getNotificationsPage } from '@/lib/data/notifications'
import { combineQueries, useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * PD-285 — the mailbox opens its most recent notifications in place, with
 * `Show all` going to `/notifications`.
 *
 * **Not `ContextMenu`.** That primitive is `v2 / Component / Context Menu` —
 * a full-width sheet flush to the *bottom* edge of the screen (measured from
 * `Ride - Ride plan - Sub pages`), built for an options menu, not a
 * scrollable list anchored under the *top* header. Reusing it here would mean
 * either fighting its bottom-edge geometry or forking its internals, and
 * there is no Figma frame for this control at all — `npm run figma -- ls
 * "notification"` / `"panel"` / `"dropdown"` / `"popover"` return nothing
 * naming it — so there is no measurement `ContextMenu` would even be
 * matching. This is a bespoke small panel built only from tokens already in
 * use elsewhere in this file's neighbours (`bg-surface`, `border-border`,
 * `shadow-lg` per `Banner`, `rounded-lg`): a portal, a scrim and a focus trap
 * copied from `ContextMenu`'s own proven shape, anchored top-right under the
 * header instead of bottom-flush.
 *
 * **Five rows before it scrolls.** `NotificationRow` is a measured 72px
 * (`min-h-18`). Five rows is 360px; on the shortest viewport this app targets
 * (iPhone SE, 667px tall) that leaves roughly 200px of the calling screen
 * visible beneath the panel once the header and the footer link are
 * accounted for — enough that the panel reads as an overlay on the screen it
 * is anchored to rather than a second full-screen route, which is the
 * distinction the issue draws against `ContextMenu`'s own full-bleed sheet.
 * Five also matches `SkeletonList`'s own default row count, so the loading
 * state fills exactly the space the loaded one will.
 *
 * **Reads nothing `/notifications` does not already read, and shares both
 * keys with it.** `queryKeys.notifications.list()` and `queryKeys.profile.me()`
 * are the same two entries that screen names — PD-212 already charges that
 * screen a four-call viewer read (the list, the profile, and the two signing
 * passes `getNotificationsPage` makes internally), and duplicating either key
 * here would make opening the panel and then `Show all` pay it twice. Because
 * `useQuery` caches by key regardless of which mount asked for it, and both
 * reads are `enabled: open` so neither fires until the rider actually taps
 * the mailbox, opening the panel and then following `Show all` costs the
 * fetch exactly once — the second mount reads the same cache entry inside its
 * `staleTime` window.
 *
 * **Never marks anything read.** `MarkNotificationsRead` stays
 * `/notifications`' own effect; firing it here would clear the dot the moment
 * the panel opens, before the rider has read a single row — the exact
 * failure PD-285 exists to avoid.
 */
export function NotificationsPanel({
  open,
  onClose,
  from,
  panelId,
}: {
  open: boolean
  onClose: () => void
  /** The tab-root pathname this control renders on — `linkWithOrigin`'s origin for `Show all`. */
  from: string
  panelId: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Both gated on `open` — see the header comment on why this must not fire
  // ahead of the rider tapping the mailbox.
  const list = useQuery(queryKeys.notifications.list(), () => getNotificationsPage(), {
    enabled: open,
  })
  const profile = useQuery(queryKeys.profile.me(), getCurrentProfile, { enabled: open })

  useEffect(() => {
    if (!open) return

    triggerRef.current = document.activeElement

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      if (!focusable?.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const gate = combineQueries(list, profile)
  const viewerId = profile.data?.id

  return createPortal(
    <>
      {/* Starts below the header rather than `inset-0`, so the header —
          including the mailbox button that opened this — stays above the
          scrim and tappable, matching how a second tap on the mailbox
          toggles the panel shut. */}
      <div
        className="fixed inset-x-0 bottom-0 top-[calc(var(--header-height)+1px)] z-[60] bg-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        tabIndex={-1}
        // The `max-h` is not belt-and-braces: without it the panel has no
        // viewport-relative bound at all, and five rows plus the footer is
        // ~408px — taller than a landscape phone. Page scroll is locked while
        // this is open and the footer sits OUTSIDE the list's own scroller, so
        // `Show all` would be unreachable rather than merely off-screen.
        className="fixed inset-x-4 top-[calc(var(--header-height)+1px+0.5rem)] z-[70] flex max-h-[calc(100dvh-var(--header-height)-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none"
      >
        {gate.error ? (
          <ErrorState
            message="We could not load your notifications."
            onRetry={gate.refetch}
          />
        ) : !list.data || profile.data === undefined ? (
          <SkeletonList />
        ) : list.data.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm font-medium text-muted">
            You have no notifications yet.
          </p>
        ) : (
          // Five rows (22.5rem) visible before the list scrolls internally —
          // see the header comment for the measurement this is built on.
          // `min-h-0` so this can shrink below its content inside the bounded
          // flex column above — without it a flex item's automatic minimum size
          // keeps it at full height and pushes the footer out of the panel,
          // which is the same defect the `max-h` exists to prevent.
          <ul className="flex max-h-[22.5rem] min-h-0 flex-col overflow-y-auto">
            {list.data.map((row) => (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <NotificationsListItem row={row} viewerId={viewerId} />
              </li>
            ))}
          </ul>
        )}

        <Link
          href={linkWithOrigin('/notifications', from)}
          onClick={onClose}
          // `text-accent-strong`, not `text-accent`: 14px/600 is not WCAG large
          // text, so the bar is 4.5:1 and the brand green measures 3.52:1 on
          // `bg-surface`. `accent-strong` is 4.75:1 on white and exists for
          // exactly this — see its comment in globals.css. The existing
          // `text-accent` links sit on the cream background, which is a
          // different pairing (3.00:1) and a separate question.
          className="flex h-12 shrink-0 items-center justify-center border-t border-border text-sm font-semibold text-accent-strong transition-colors active:bg-border"
        >
          Show all
        </Link>
      </div>
    </>,
    document.body
  )
}
