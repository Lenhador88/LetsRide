'use client'

import { useId, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MailboxIcon } from '@/components/icons/generated'
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { getUnreadNotificationCount } from '@/lib/data/notifications'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * The header's `secondaryAction` (x302) on the four tab-root screens —
 * `/postcards`, `/rides`, `/clubs`, `/profile` — and nowhere else. Not
 * rendered on `/notifications` itself: Q5's default is that the screen is its
 * own destination, so the control that opens it has nothing to do there.
 *
 * **A failed count draws no dot, never a stale one** — task 6.3, and the same
 * reasoning `client-cache-invalidation`'s new requirement gives for the count
 * and the list: a dot the rider cannot clear by visiting the screen is worse
 * than a missing one. `unread.data === undefined` (the first render tick, or a
 * query that has not resolved) reads the same as zero on purpose — flashing a
 * dot in ahead of an answer that might turn out to be zero is its own kind of
 * wrong badge.
 *
 * **PD-285: opens `NotificationsPanel` in place rather than navigating
 * straight to `/notifications`.** The button toggles `open`; the panel itself
 * owns the portal, the scrim and the focus trap, and reads through
 * `useQuery` with keys shared with the screen — see that file's header for
 * why opening the panel costs no extra read. This control is mounted once per
 * tab root (four times total), so `open` is local to each mount and never
 * shared across them — no coordination needed, since only one tab root is
 * rendered at a time.
 *
 * `linkWithOrigin` moved into `NotificationsPanel`'s own `Show all` link —
 * this control no longer navigates directly, but the screen it eventually
 * links to still needs its origin, so `pathname` is threaded through
 * unchanged.
 */
export function NotificationsHeaderControl() {
  const unread = useQuery(queryKeys.notifications.unread(), getUnreadNotificationCount)
  const hasUnread = !unread.error && !!unread.data && unread.data > 0
  // The screen this opens has four entry points and is not a tab, so its back
  // control cannot infer where the rider came from — the linking screen is the
  // only place that knows, and `NotificationsPanel`'s `Show all` link is where
  // this says so (PD-209).
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={hasUnread ? 'Notifications, unread' : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <MailboxIcon className="h-6 w-6" />
        {hasUnread && <NotificationDot className="absolute top-1.5 right-1.5" />}
      </button>
      <NotificationsPanel open={open} onClose={() => setOpen(false)} from={pathname} panelId={panelId} />
    </>
  )
}
