'use client'

import { useEffect } from 'react'
import { useBanner } from '@/components/ui/Banner'
import { isOnline } from '@/lib/query/connectivity'
import { markNotificationsRead } from '@/lib/actions/notifications'

/**
 * Marks every unread notification read the moment this rider opens the
 * screen — `MarkClubSeen`/`MarkFeedSeen`'s shape, applied to `036`'s
 * `read_at` watermark. Renders nothing.
 *
 * There is no per-row dismiss and no "mark all read" control anywhere in
 * `Inbox - Notifications` — visiting the screen is the only affordance the
 * design offers, so it is the mark point, matching how the club and feed
 * watermarks advance on open rather than on a button.
 *
 * **Unlike its two precedents, this reports a failure rather than firing and
 * forgetting.** Task 6.4 requires the offline case say so specifically and not
 * be queued — `markNotificationsRead` is not retried here, and nothing shows
 * a row as read and then reverts it, because `NotificationRow` carries no
 * per-row read/unread treatment at all (the design draws none) for this to
 * optimistically flip in the first place. `isOnline()` is read at the moment
 * the write fails rather than gating the call up front, so a connection lost
 * mid-request is reported the same way as one lost before it started.
 */
export function MarkNotificationsRead() {
  const showBanner = useBanner()

  useEffect(() => {
    void markNotificationsRead().then((result) => {
      if (!result.error) return
      showBanner(
        isOnline()
          ? result.error
          : "You're offline — your notifications will stay unread until you're back.",
        'error'
      )
    })
  }, [showBanner])

  return null
}
