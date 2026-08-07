import Link from 'next/link'
import { ChatBubbleIcon } from '@/components/icons/generated'
import { Header } from '@/components/layout/Header'
import { RidePageMenu } from '@/components/rides/RidePageMenu'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * The chrome the three ride sub-pages share — title, back, and whatever the
 * design puts in the 20px row under the title.
 *
 * **The chat button is built as of `034`.** This docstring used to explain why it
 * was omitted — "it has no tables at all… a control that renders but does
 * nothing is a worse artifact than an absent one" — and that reasoning was
 * right and is now spent: there is a table, a route and a screen behind it. The
 * *other* omission it named still stands, and for the same reason:
 *
 * - **Options** (`Element / Icon / Options`, x342) opens a sheet this flow never
 *   draws. Ride overflow is presumably edit / cancel / leave, and "no edit or
 *   delete UI for rides or clubs" is a standing known issue (Linear PD-101) —
 *   inventing three rows for a destructive menu is the kind of guess that gets
 *   trusted later. Logged in docs/FIGMA-FIDELITY-TODO.md §Ride detail.
 *
 * **The chat button is shown to the crew only**, which is narrower than the
 * design draws — the frames show one header for everybody, because a mock has no
 * viewer. `034` gives the chat to the ride's crew, so a rider who has not RSVP'd
 * would tap through to a screen that can only tell them to join. Better to not
 * offer it: the design's own principle, applied to a state it does not draw.
 *
 * `Ride - Ride plan - Sub pages` (`2375:9114`) also puts a 16×16 `Warning/100`
 * notification dot on this button. **Not drawn** — there is no unread model yet
 * (Linear PD-120 extends `015`'s watermark) and a badge that is always absent is
 * indistinguishable from one that is broken.
 */
export function RideHeader({
  rideId,
  title,
  current,
  isCrew,
  ridersCount,
}: {
  rideId: string
  /** `undefined` while the ride is still being read — `Header` draws a
   * placeholder bar for it. See that component's `title` prop. */
  title: string | undefined
  current: 'plan' | 'crew' | 'chat'
  /**
   * Whether this rider is on the ride — organizer, or any RSVP. `undefined`
   * while the ride is still being read, which is why the chat button appears a
   * moment after the header rather than being drawn and then withdrawn.
   *
   * **Required, not optional, and that is the whole point.** It was optional
   * for one commit and *neither* caller passed it, so the button never rendered
   * on any screen and the entire chat epic shipped reachable only by typing the
   * URL. `tsc` was green throughout — an optional prop that gates a control is
   * indistinguishable from a control nobody wanted. Required, a new ride
   * sub-page cannot forget it. Pass `undefined` explicitly while loading.
   */
  isCrew: boolean | undefined
  /** Chat only, and `undefined` until the roster lands. See the sub-row below. */
  ridersCount?: number
}) {
  const onChat = current === 'chat'

  return (
    <Header
      title={title}
      // Chat is entered from the ride, so back returns there rather than to the
      // list — the plan and crew pages are the list's children, and chat is the
      // ride's. `Ride - Chat` draws the same arrow for both, which is exactly
      // the kind of thing a static frame cannot distinguish.
      backHref={onChat ? `/rides/${rideId}` : '/rides'}
      subRow={
        onChat ? (
          // `Ride - Chat` replaces the page switcher with a crew count
          // (`10 riders`, Poppins/14/Medium, Grey/80). Sized to its own line box
          // while it loads so the header does not change height when it lands —
          // the same treatment `Header` gives the title.
          ridersCount === undefined ? (
            <Skeleton className="h-3 w-16" />
          ) : (
            <span className="text-sm font-medium text-muted">
              {ridersCount} {ridersCount === 1 ? 'rider' : 'riders'}
            </span>
          )
        ) : (
          <RidePageMenu rideId={rideId} current={current} />
        )
      }
      action={
        !onChat && isCrew ? (
          <Link
            href={`/rides/${rideId}/chat`}
            aria-label="Ride chat"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
          >
            <ChatBubbleIcon className="h-6 w-6" />
          </Link>
        ) : undefined
      }
    />
  )
}
