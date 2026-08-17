import Link from 'next/link'
import { EditIcon } from '@/components/icons/generated'
import { Header } from '@/components/layout/Header'
import { RideChatButton } from '@/components/rides/RideChatButton'
import { RidePageMenu } from '@/components/rides/RidePageMenu'
import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/lib/routes'

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
 *   draws, and stays absent — inventing rows for a destructive menu is the kind
 *   of guess that gets trusted later. Logged in docs/FIGMA-FIDELITY-TODO.md
 *   §Ride detail. **Edit is not that menu, and PD-101 no longer names this
 *   gap**: `design.md` §D4 decided Edit belongs in the header as a single
 *   affordance and Delete belongs at the foot of the edit screen behind a
 *   second tap, not bundled into an invented overflow sheet. It renders through
 *   `secondaryAction` (x302), which is free here — the organizer's own chat
 *   button already occupies `action` (x342) whenever Edit would show, since an
 *   organizer is crew by construction.
 *
 * **The chat button is shown to the crew only**, which is narrower than the
 * design draws — the frames show one header for everybody, because a mock has no
 * viewer. `034` gives the chat to the ride's crew, so a rider who has not RSVP'd
 * would tap through to a screen that can only tell them to join. Better to not
 * offer it: the design's own principle, applied to a state it does not draw.
 *
 * **It is no longer the only way in, and it never should have been.** `isCrew`
 * is passed on to `RidePageMenu` as well, which lists Chat as a labelled row on
 * the same predicate — because in practice nobody found the icon. See that
 * component for the measurement.
 *
 * `Ride - Ride plan - Sub pages` (`2375:9114`) also puts a 16×16 `Warning/100`
 * notification dot on this button. **Drawn as of `061`** — PD-120 built the
 * watermark this paragraph used to say was missing. The dot lives inside
 * `RideChatButton` along with the button itself rather than arriving here as a
 * prop; that component's docstring has the reasoning, and it is the same
 * argument `isCrew` above makes about a control nobody can forget to wire.
 */
export function RideHeader({
  rideId,
  title,
  current,
  isCrew,
  isOrganizer,
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
  /**
   * Whether this rider organises the ride — required for the same reason
   * `isCrew` is (PD-101). Narrower than `isCrew`: every organizer is crew, not
   * every crew member is the organizer, and only the organizer gets Edit.
   */
  isOrganizer: boolean | undefined
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
      backHref={onChat ? routes.ride(rideId) : '/rides'}
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
          <RidePageMenu rideId={rideId} current={current} isCrew={isCrew} />
        )
      }
      secondaryAction={
        !onChat && isOrganizer ? (
          <Link
            href={routes.rideEdit(rideId)}
            aria-label="Edit ride"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
          >
            <EditIcon className="h-6 w-6" />
          </Link>
        ) : undefined
      }
      // The button and its unread dot are one component, so this header issues
      // no query and this condition is the only gate on either. See
      // `RideChatButton` for why the badge is not a prop.
      action={!onChat && isCrew ? <RideChatButton rideId={rideId} /> : undefined}
    />
  )
}
