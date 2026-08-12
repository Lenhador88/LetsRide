'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MailboxIcon } from '@/components/icons/generated'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { linkWithOrigin } from '@/lib/back-navigation'
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
 */
export function NotificationsHeaderControl() {
  const unread = useQuery(queryKeys.notifications.unread(), getUnreadNotificationCount)
  const hasUnread = !unread.error && !!unread.data && unread.data > 0
  // The screen this opens has four entry points and is not a tab, so its back
  // control cannot infer where the rider came from — the linking screen is the
  // only place that knows, and this is where it says so (PD-209).
  const pathname = usePathname()

  return (
    <Link
      href={linkWithOrigin('/notifications', pathname)}
      aria-label={hasUnread ? 'Notifications, unread' : 'Notifications'}
      className="relative flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
    >
      <MailboxIcon className="h-6 w-6" />
      {hasUnread && <NotificationDot className="absolute top-1.5 right-1.5" />}
    </Link>
  )
}
