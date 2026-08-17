'use client'

import Link from 'next/link'
import { ChatBubbleIcon } from '@/components/icons/generated'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { getRideChatUnread } from '@/lib/data/ride-messages'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/**
 * The header's chat-bubble button, and the unread mark on it (`061`, PD-120).
 *
 * The design draws a 16×16 `Warning/100` `v2 / Component / Notification` over
 * this button — measured **visible** in `Ride - Ride plan - Sub pages`
 * (`2375:9114`) and `Ride - Crew (Riders)` (`2375:9212`), while the same
 * component instance sits `[hidden]` on those frames' back and Options buttons,
 * which is the design saying no in the two places it says no.
 *
 * ## Why the button moved here rather than the dot going into `RideHeader`
 *
 * This is `NotificationsHeaderControl`'s shape, deliberately: a self-contained
 * control that owns its link, its label, its badge and its own failure mode,
 * mounted by a header that knows nothing about any of them. Three things follow
 * from keeping them together that a `hasUnread` prop could not give:
 *
 * - **The mount condition is the access rule.** `RideHeader` renders this only
 *   under `!onChat && isCrew`, so a rider who is not on the crew issues no query
 *   at all, and the chat screen issues none because it draws no chat button. The
 *   permission-denied case can never reach a rider as an empty state, because
 *   the control that would carry it is absent.
 * - **The accessible name can carry the state.** The dot is `aria-hidden`
 *   (`NotificationDot`'s own choice, and right — it is decoration), so a screen
 *   reader learns about unread messages from this label or not at all. A prop
 *   threaded through `RideHeader` would have put the label and the value that
 *   determines it in two different components.
 * - **No screen can forget it.** `RideHeader`'s docstring records `isCrew` being
 *   optional for one commit: neither caller passed it, the chat button never
 *   rendered anywhere, the whole chat epic was reachable only by typing the URL,
 *   and `tsc` was green throughout. A dot has no required-prop defence available
 *   at all — a screen that forgets to *read* a prop still passes one, and a
 *   header with no dot looks exactly right.
 *
 * ## A dot is drawn only for a fresh `true`
 *
 * `undefined` — the first render tick, or a refetch in flight — draws nothing,
 * exactly as a failed read does. `NotificationsHeaderControl` gives the reason:
 * *"flashing a dot in ahead of an answer that might turn out to be zero is its
 * own kind of wrong badge"*, and a dot the rider cannot clear by visiting the
 * screen is worse than a missing one. So the two states that cannot be trusted
 * render identically to `false`, and a failed read costs the decoration and
 * never the screen — it does not reach the ride plan's error state, offers no
 * retry, and the button it decorates works without it.
 *
 * **The answer is fetched when this mounts and is stale-bounded thereafter**; it
 * does not update live. `keys.ts` §`rides.unread` has the whole boundary and why
 * the key's nesting is not what delivers freshness. In practice the dot moves on
 * navigation, which is when a rider can see this button at all.
 */
export function RideChatButton({ rideId }: { rideId: string }) {
  const unread = useQuery(queryKeys.rides.unread(rideId), () => getRideChatUnread(rideId))
  const hasUnread = !unread.error && unread.data === true

  return (
    <Link
      href={routes.rideChat(rideId)}
      aria-label={hasUnread ? 'Ride chat, unread messages' : 'Ride chat'}
      className="relative flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
    >
      <ChatBubbleIcon className="h-6 w-6" />
      {hasUnread && <NotificationDot className="absolute top-1.5 right-1.5" />}
    </Link>
  )
}
