'use client'

import Link from 'next/link'
import { ChatBubbleIcon } from '@/components/icons/generated'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { getRideThreadUnread } from '@/lib/data/ride-threads'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/**
 * The header's chat-bubble button into a ride's threads, and the unread mark on
 * it — `108`, PD-402, replacing `RideChatButton` (`061`, PD-120).
 *
 * The design draws a 16×16 `Warning/100` `v2 / Component / Notification` over
 * this button — measured **visible** in `Ride - Ride plan - Sub pages`
 * (`2375:9114`) and `Ride - Crew (Riders)` (`2375:9212`), while the same
 * component instance sits `[hidden]` on those frames' back and Options buttons,
 * which is the design saying no in the two places it says no. The frames draw a
 * chat because the chat is what existed when they were made; the button's
 * position, size and badge are what is measured, and its destination is not.
 *
 * ## The one thing this changes from `RideChatButton`, and why the dot is an OR
 *
 * `061` answered one boolean for one conversation. A ride now has a *list* of
 * threads, so `ride_thread_unread` answers `(thread_id, has_unread)` per thread
 * and this button draws a dot when **any** of them is unread. That is the same
 * aggregate `ClubOptionsMenu`'s `Threads` row already does one domain over.
 *
 * **The club's aggregate-dot hazard does not reach here, and the reason is worth
 * stating because it is the kind of thing a later change re-opens.** That dot
 * could name a thread its own list did not show — an unread comment on an
 * introduction — and so could not be cleared by visiting the list. A ride has no
 * announcements: `getRideThreads` filters nothing, so every thread the RPC can
 * mark is a thread the list draws, and the dot always clears by visiting it. If
 * a ride ever grows a thread kind the list hides, this becomes unclearable and
 * `getRideThreadUnread` needs the club's corrective read.
 *
 * ## Why the button owns its query rather than taking a `hasUnread` prop
 *
 * `NotificationsHeaderControl`'s shape, and `RideChatButton` carried the same
 * three reasons: **the mount condition is the access rule** (`RideHeader`
 * renders this only under `!onThreads && isCrew`, so a rider who is not crew
 * issues no query at all and the permission-denied case can never reach them as
 * an empty state); **the accessible name can carry the state**, the dot being
 * `aria-hidden` decoration, so a screen reader learns about unread messages from
 * this label or not at all; and **no screen can forget it**, where a `hasUnread`
 * prop has no required-prop defence available — a screen that forgets to *read*
 * a prop still passes one, and a header with no dot looks exactly right.
 *
 * ## A dot is drawn only for a fresh `true`
 *
 * A read still in flight draws nothing, exactly as a failed read does —
 * `getRideThreadUnread` resolves a failure to `{}` rather than throwing, so both
 * land on the same empty map. *"Flashing a dot in ahead of an answer that might
 * turn out to be zero is its own kind of wrong badge"*, and a dot the rider
 * cannot clear by visiting the screen is worse than a missing one. A failed read
 * costs the decoration and never the screen.
 *
 * **The answer is fetched when this mounts and is stale-bounded thereafter**; it
 * does not update live. In practice the dot moves on navigation, which is when a
 * rider can see this button at all.
 */
export function RideThreadsButton({ rideId }: { rideId: string }) {
  const unread = useQuery(queryKeys.rides.threadsUnread(rideId), () =>
    getRideThreadUnread(rideId)
  )
  const hasUnread = !unread.error && Object.values(unread.data ?? {}).some(Boolean)

  return (
    <Link
      href={routes.rideThreads(rideId)}
      aria-label={hasUnread ? 'Ride threads, unread messages' : 'Ride threads'}
      className="relative flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
    >
      <ChatBubbleIcon className="h-6 w-6" />
      {hasUnread && <NotificationDot className="absolute top-1.5 right-1.5" />}
    </Link>
  )
}
