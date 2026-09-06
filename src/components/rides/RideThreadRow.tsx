import Link from 'next/link'
import { ChatBubbleIcon } from '@/components/icons/generated'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { routes } from '@/lib/routes'
import { formatRelativeTime } from '@/lib/utils'
import type { RideThreadListItem } from '@/types'

/**
 * One thread in a ride's Threads list (`108`, PD-402).
 *
 * **`ClubThreadRow`'s composition one domain over**, deliberately identical so
 * the two lists read the same. There is no v2 Threads frame for either — the
 * snapshot holds `Ride - Chat`, which this change deletes, and no frame for a
 * thread list at all — so what is measured is the row it is assembled from:
 * `Inbox - Chats` (`2375:9518`) draws a 390×72 `v2 / Component / List / User`,
 * a title at `Poppins/16/Semibold` `Grey/100` with a right-hand time at
 * `Poppins/14/Regular` `Grey/80`, a second line under it, and an unread mark in
 * a trailing icon slot.
 *
 * The club's two departures from that frame hold here for the same reasons: a
 * **chat bubble rather than a 56px avatar**, because a thread is a topic with no
 * face and the author's avatar would say the thread belongs to them in a way the
 * audience rules do not; and a **dot rather than a counter**, because
 * `ride_thread_unread` answers a boolean per thread on purpose (`exists`
 * short-circuits, so it is O(1) in thread length).
 *
 * `author` is nullable because the `profiles` SELECT policy hides a row with a
 * NULL username; the thread still renders rather than vanishing.
 */
export function RideThreadRow({
  thread,
  hasUnread,
}: {
  thread: RideThreadListItem
  /** From `rides.threadsUnread`. `false` for a thread with nothing new **and**
   * for a failed unread read — the mark decorates a row that works without it. */
  hasUnread: boolean
}) {
  return (
    <Link
      href={routes.rideThread(thread.id)}
      // The whole row is the label for assistive tech, so the unread state has
      // to be in words: `NotificationDot` is `aria-hidden` by construction.
      aria-label={hasUnread ? `${thread.title}, unread messages` : thread.title}
      className="flex min-h-[72px] items-center gap-3 px-4 py-3 transition-colors active:bg-border"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-track"
      >
        <ChatBubbleIcon className="h-5 w-5 text-foreground" />
      </span>

      <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          {/* Semibold whether or not it is unread — the frame's title weight —
              with the dot carrying the state rather than a second weight. Two
              weights for one fact is how a list starts encoding unread in a way
              nothing but eyesight can read; the `aria-label` above is what
              carries it for everyone else. */}
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
            {thread.title}
          </span>
          <span className="shrink-0 text-sm font-medium text-muted">
            {/* Elapsed time, so no zone at all — see `formatRelativeTime`. This
                is the one thing on a ride screen that legitimately takes no
                `rides.timezone`: every `formatRide*` helper does, because a
                ride's times are wall-clock at its meeting point, and a
                *duration* names no instant. */}
            {formatRelativeTime(thread.created_at)}
          </span>
        </span>
        <span className="truncate text-sm font-medium text-muted">
          Started by {thread.author?.username ?? 'a rider'}
        </span>
      </span>

      {hasUnread && <NotificationDot className="shrink-0" />}
    </Link>
  )
}
