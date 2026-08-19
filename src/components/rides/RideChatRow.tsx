'use client'

import Link from 'next/link'
import { ChatBubbleIcon, ChevronRightIcon } from '@/components/icons/generated'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { getRideChatUnread } from '@/lib/data/ride-messages'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/**
 * The labelled `Ride chat` row on the ride plan (PD-254).
 *
 * **This row is the point of the merge, not a decoration on it.** Deleting
 * `RidePageMenu` deletes the labelled Chat row PD-125 added, and PD-125 exists
 * because a real rider — the product owner, organizer and `going` on every ride
 * in the database — could not find the chat behind the header's bare bubble on
 * 2026-08-07. Removing the sheet without putting a labelled row back on the page
 * would re-open the exact defect the sheet was patched to close.
 *
 * **Crew only**, on the predicate that gates the header bubble, so the two
 * entry points cannot disagree about who has a chat to open. Its caller passes
 * `is_crew` straight from `getRide` — the client's mirror of
 * `private.is_ride_crew` (`034`) — rather than re-deriving it.
 *
 * ## The unread mark, and why it costs no request
 *
 * `queryKeys.rides.unread(rideId)` is the key `RideChatButton` already reads on
 * this same screen, so the second `useQuery` under it is a cache read rather
 * than a second round trip. Drawing it here as well as in the header is
 * deliberate: the mark belongs where the rider is actually looking, which after
 * PD-125 is the labelled row.
 *
 * `undefined` and a failed read both draw nothing, exactly as they do on the
 * button — a dot flashed ahead of an answer that might be zero is its own wrong
 * badge, and one the rider cannot clear. The label carries the state for anyone
 * who cannot see the dot, which is `NotificationDot`'s own `aria-hidden`
 * choice made good.
 */
export function RideChatRow({ rideId }: { rideId: string }) {
  const unread = useQuery(queryKeys.rides.unread(rideId), () => getRideChatUnread(rideId))
  const hasUnread = !unread.error && unread.data === true

  return (
    <Link
      href={routes.rideChat(rideId)}
      aria-label={hasUnread ? 'Ride chat, unread messages' : 'Ride chat'}
      className="mx-4 flex min-h-[46px] items-center gap-3 rounded-lg border border-border bg-surface px-3 transition-colors active:bg-border"
    >
      <ChatBubbleIcon className="h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
      <span aria-hidden="true" className="flex-1 text-sm font-semibold text-foreground">
        Ride chat
      </span>
      {hasUnread && <NotificationDot />}
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
    </Link>
  )
}
