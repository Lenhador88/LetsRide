'use client'

import { Header } from '@/components/layout/Header'
import { RideThreadsButton } from '@/components/rides/RideThreadsButton'
import { RideOptionsMenu } from '@/components/rides/RideOptionsMenu'
import { Skeleton } from '@/components/ui/Skeleton'
import { useSwipeBack } from '@/lib/actions/navigate'
import { rideReturnTo, routes } from '@/lib/routes'

/**
 * The chrome the three ride screens share — title, back, and the one sub-row
 * the design still puts under a title.
 *
 * **`RidePageMenu` is deleted (PD-254) and the `current` prop outlived it.** The
 * switcher was a bottom sheet that hid its own options, and everything it listed
 * is a visible row on the ride plan now — so two of the three screens have no
 * sub-row at all and the header is 96px on both. `current` still decides two
 * things a merged screen does not remove: where **back** goes, and whether the
 * threads entry points are drawn at all (the threads screens draw no way into
 * themselves).
 *
 * **Crew's back target moved with the menu, and that is not cosmetic.** The crew
 * route used to be reachable only through the switcher, from anywhere, so `/rides`
 * was the honest answer. It is now reached from the rail on the ride plan, and
 * nowhere else, so back returns to the ride. A back button that leaves the
 * screen a rider came from is the kind of thing nothing fails on.
 *
 * **The chat-bubble button is built, and as of `108` (PD-402) it opens a ride's
 * THREADS rather than `034`'s single chat stream.** The button's position, size
 * and badge are what the frames measure; its destination is not, and the frames
 * draw a chat only because the chat is what existed when they were made. The
 * *other* omission this docstring once named still stands, and for the same
 * reason:
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
 *   own threads button already occupies `action` whenever this shows, since an
 *   organizer is crew by construction.
 *
 *   **The menu is drawn for every viewer, not only the organizer**, which the
 *   old pencil was not: `Share ride` is the row anyone can use, and it is the
 *   whole reason a rider can send a ride to somebody at all.
 *
 * **The button is shown to the crew only**, which is narrower than the design
 * draws — the frames show one header for everybody, because a mock has no
 * viewer. `108` gives a ride's threads to its crew, so a rider who has not
 * RSVP'd would tap through to a screen that can only tell them to join. Better
 * to not offer it: the design's own principle, applied to a state it does not
 * draw.
 *
 * **It is no longer the only way in, and it never should have been.** The ride
 * plan draws a labelled `Threads` row on exactly this predicate — because in
 * practice nobody found the icon. `RideThreadsRow` carries the measurement; that
 * row is what PD-254 had to keep when it deleted the sheet that used to hold it.
 *
 * `Ride - Ride plan - Sub pages` (`2375:9114`) also puts a 16×16 `Warning/100`
 * notification dot on this button. **Drawn since `061`, and answered per thread
 * since `108`** — it now lights when ANY of the ride's threads is unread. The
 * dot lives inside `RideThreadsButton` along with the button itself rather than
 * arriving here as a prop; that component's docstring has the reasoning, and it
 * is the same argument `isCrew` above makes about a control nobody can forget to
 * wire.
 */
export function RideHeader({
  rideId,
  title,
  current,
  isCrew,
  isOrganizer,
  ridersCount,
  clubId,
  returnAnchor,
}: {
  rideId: string
  /** `undefined` while the ride is still being read — `Header` draws a
   * placeholder bar for it. See that component's `title` prop. */
  title: string | undefined
  /**
   * Which ride screen this is. Two things still hang off it: where **back**
   * goes, and whether the threads sub-row is drawn.
   *
   * `'threads'` covers all three thread screens — the list, one thread and the
   * composer — because what the value decides is identical for them: back to
   * the plan, and no way into themselves.
   *
   * `'invite'` (`083`, PD-329) behaves exactly as `'crew'` does — back to the
   * plan, no sub-row — and is a distinct value rather than a reuse of it so the
   * prop keeps meaning "which screen" rather than "which back target". The day
   * a screen needs its own sub-row, the reuse would have been the thing in the
   * way.
   */
  current: 'plan' | 'crew' | 'threads' | 'invite'
  /**
   * Whether this rider is on the ride — organizer, or any RSVP. `undefined`
   * while the ride is still being read, which is why the chat button appears a
   * moment after the header rather than being drawn and then withdrawn.
   *
   * **Required, not optional, and that is the whole point.** It was optional
   * for one commit and *neither* caller passed it, so the button never rendered
   * on any screen and the entire chat epic shipped reachable only by typing the
   * URL — the same defect PD-392 hit again from the other direction, an optional
   * prop gating a feature's only entry point. `tsc` was green throughout — an optional prop that gates a control is
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
  /** The threads screens only, and `undefined` until the roster lands. See the
   *  sub-row below. */
  ridersCount?: number
  /**
   * The club this ride belongs to, straight off `ride.club_id` — PD-378. Only
   * the plan screen uses it, and only together with `returnAnchor`.
   *
   * **`undefined` while the ride is still being read**, which is deliberate and
   * is why `rideReturnTo` takes a fallback rather than this being required: the
   * arrow answers `/rides` for the moment before the ride lands and then
   * sharpens to the club. That is strictly better than before PD-378, when it
   * answered `/rides` always. `rideReturnTo`'s docstring prices the alternative.
   */
  clubId?: string | null
  /**
   * The club timeline row this ride was opened from — `RETURN_ANCHOR_PARAM` out
   * of the URL, PD-378. Absent for every other route into a ride (the rides
   * list, Explore, a notification, a pasted link), and absent is the ordinary
   * case: `rideReturnTo` answers the fallback for all of them.
   */
  returnAnchor?: string | null
}) {
  const onThreads = current === 'threads'

  // Threads and Crew are both entered from the ride, so back returns there
  // rather than to the list — the plan is the list's child, and the others are
  // the ride's. `Ride - Chat` drew the same arrow for all three, which is
  // exactly the kind of thing a static frame cannot distinguish.
  //
  // The plan's own back is `/rides` UNLESS the ride was opened from a club
  // timeline row, in which case it returns to that row — PD-378.
  //
  // **Every screen that returns to the plan drops the anchor, deliberately.**
  // The three this component serves (`crew`, `threads`, `invite`) go back via
  // `routes.ride`, which carries no `row`, and the links reaching them carry
  // none either — so plan → crew → back lands on a plan whose own back is
  // `/rides` again. **`/rides/detail/edit` is a fourth and is easy to miss**: it
  // draws a plain `Header` rather than this one, with the same
  // `backHref={routes.ride(id)}`, so it behaves identically and is NOT covered
  // by reading this component alone. Closing it means threading the parameter
  // through four routes and their links — wider than the one-hop this story
  // describes, so it is stated rather than left to be discovered.
  const backHref =
    current === 'plan' ? rideReturnTo(clubId, returnAnchor, '/rides') : routes.ride(rideId)

  // PD-341: the edge swipe is a second route to the arrow beside it, so it goes
  // to the same place by construction — one value, read twice. All four ride
  // screens get it, the thread included: the composer is a text field, which
  // `declinesSwipeBack` refuses on its own, and the message list scrolls
  // vertically. `/rides/detail/edit` draws a plain `Header` and is deliberately
  // not one of these — see `useSwipeBack`.
  useSwipeBack(backHref)

  return (
    <Header
      title={title}
      backHref={backHref}
      subRow={
        onThreads ? (
          // `Ride - Chat` replaced the page switcher with a crew count
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
        // Not on the threads screens, which draw no way into anything but the
        // conversation — the same rule the threads button follows one slot over.
        !onThreads ? <RideOptionsMenu rideId={rideId} isOrganizer={isOrganizer} /> : undefined
      }
      // The button and its unread dot are one component, so this header issues
      // no query and this condition is the only gate on either. See
      // `RideThreadsButton` for why the badge is not a prop.
      action={!onThreads && isCrew ? <RideThreadsButton rideId={rideId} /> : undefined}
    />
  )
}
