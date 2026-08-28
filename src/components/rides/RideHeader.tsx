import { Header } from '@/components/layout/Header'
import { RideChatButton } from '@/components/rides/RideChatButton'
import { RideOptionsMenu } from '@/components/rides/RideOptionsMenu'
import { Skeleton } from '@/components/ui/Skeleton'
import { routes } from '@/lib/routes'

/**
 * The chrome the three ride screens share — title, back, and the one sub-row
 * the design still puts under a title.
 *
 * **`RidePageMenu` is deleted (PD-254) and the `current` prop outlived it.** The
 * switcher was a bottom sheet that hid its own options, and everything it listed
 * is a visible row on the ride plan now — so two of the three screens have no
 * sub-row at all and the header is 96px on both. `current` still decides two
 * things a merged screen does not remove: where **back** goes, and whether the
 * chat entry points are drawn at all (the chat screen draws no way into itself).
 *
 * **Crew's back target moved with the menu, and that is not cosmetic.** The crew
 * route used to be reachable only through the switcher, from anywhere, so `/rides`
 * was the honest answer. It is now reached from the rail on the ride plan, and
 * nowhere else, so back returns to the ride. A back button that leaves the
 * screen a rider came from is the kind of thing nothing fails on.
 *
 * **The chat button is built as of `034`.** This docstring used to explain why it
 * was omitted — "it has no tables at all… a control that renders but does
 * nothing is a worse artifact than an absent one" — and that reasoning was
 * right and is now spent: there is a table, a route and a screen behind it. The
 * *other* omission it named still stands, and for the same reason:
 *
 * - **Options** (`Element / Icon / Options`, x342) is BUILT as of PD-280, and
 *   the rows are no longer invented. This docstring used to argue it should
 *   stay absent because "inventing rows for a destructive menu is the kind of
 *   guess that gets trusted later" — sound while the ride was the only screen
 *   without one, and spent now that four other surfaces ship the same sheet and
 *   the product owner asked for it here by name (2026-08-24). `RideOptionsMenu`
 *   carries Share, Edit and Delete; its header has each row's reasoning and
 *   what it supersedes in `design.md` §D4. It renders through `secondaryAction`
 *   (x302) rather than the design's x342, which is free here — the organizer's
 *   own chat button already occupies `action` whenever this shows, since an
 *   organizer is crew by construction.
 *
 *   **The menu is drawn for every viewer, not only the organizer**, which the
 *   old pencil was not: `Share ride` is the row anyone can use, and it is the
 *   whole reason a rider can send a ride to somebody at all.
 *
 * **The chat button is shown to the crew only**, which is narrower than the
 * design draws — the frames show one header for everybody, because a mock has no
 * viewer. `034` gives the chat to the ride's crew, so a rider who has not RSVP'd
 * would tap through to a screen that can only tell them to join. Better to not
 * offer it: the design's own principle, applied to a state it does not draw.
 *
 * **It is no longer the only way in, and it never should have been.** The ride
 * plan draws a labelled `Ride chat` row on exactly this predicate — because in
 * practice nobody found the icon. `RideChatRow` carries the measurement; that
 * row is what PD-254 had to keep when it deleted the sheet that used to hold it.
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
  /**
   * Which ride screen this is. Two things still hang off it: where **back**
   * goes, and whether the chat sub-row is drawn.
   *
   * `'invite'` (`083`, PD-329) behaves exactly as `'crew'` does — back to the
   * plan, no sub-row — and is a distinct value rather than a reuse of it so the
   * prop keeps meaning "which screen" rather than "which back target". The day
   * a screen needs its own sub-row, the reuse would have been the thing in the
   * way.
   */
  current: 'plan' | 'crew' | 'chat' | 'invite'
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
      // Chat and Crew are both entered from the ride, so back returns there
      // rather than to the list — the plan is the list's child, and the other
      // two are the ride's. `Ride - Chat` draws the same arrow for all three,
      // which is exactly the kind of thing a static frame cannot distinguish.
      backHref={current === 'plan' ? '/rides' : routes.ride(rideId)}
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
        ) : // Nothing under the title on the plan and the crew screens: the
        // switcher that used to live here is deleted, and `Header` draws the
        // 96px variant when no sub-row is passed.
        undefined
      }
      secondaryAction={
        // Not on the chat screen, which draws no way into anything but the
        // conversation — the same rule the chat button follows one slot over.
        !onChat ? <RideOptionsMenu rideId={rideId} isOrganizer={isOrganizer} /> : undefined
      }
      // The button and its unread dot are one component, so this header issues
      // no query and this condition is the only gate on either. See
      // `RideChatButton` for why the badge is not a prop.
      action={!onChat && isCrew ? <RideChatButton rideId={rideId} /> : undefined}
    />
  )
}
