'use client'

import { Header } from '@/components/layout/Header'
import { RideOptionsMenu } from '@/components/rides/RideOptionsMenu'
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
 * **The chat-bubble button is DELETED — PD-426, and the frames still draw it.**
 * `Ride - Ride plan - Sub pages` (`2375:9114`) puts a chat glyph with a 16×16
 * `Warning/100` dot in this header's `action` slot, and it is deliberately not
 * built: a ride's threads are read on the ride's own timeline now, so the icon
 * was one of three entrances to the same conversations. The owner's ask,
 * 2026-09-06: *"I still see a chat icon on the header of ride detail page, we
 * are moving to threads, so that can be dropped."*
 *
 * **The measurement that decided which entrance survives is in this file's own
 * history**: the icon lost — "in practice nobody found the icon" — which is why
 * the ride plan grew a labelled row beside it. That row is deleted too, for the
 * opposite reason: it pointed at the index route PD-426 removed, and the
 * timeline shows the same threads in place. The departure is logged in
 * `docs/FIGMA-FIDELITY-TODO.md` §Ride detail.
 *
 * The *other* omission this docstring once named still stands, and for its own
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
 *   (x302) rather than the design's x342, which is now simply free — the
 *   threads button that used to occupy `action` is gone.
 *
 *   **The menu is drawn for every viewer, not only the organizer**, which the
 *   old pencil was not: `Share ride` is the row anyone can use, and it is the
 *   whole reason a rider can send a ride to somebody at all.
 *
 * **The unread dot moved rather than going with the button.** It lit when any of
 * the ride's threads was unread, and deleting its only two homes would have
 * taken ride-thread unread indication out of the app altogether. It is now on
 * `RideTimelineThreadRow`, per thread, which is what the club has always done —
 * see `RideTimeline`, which issues the one `getRideThreadUnread` read this
 * header no longer needs.
 */
export function RideHeader({
  rideId,
  title,
  current,
  isOrganizer,
  clubId,
  returnAnchor,
}: {
  rideId: string
  /** `undefined` while the ride is still being read — `Header` draws a
   * placeholder bar for it. See that component's `title` prop. */
  title: string | undefined
  /**
   * Which ride screen this is. One thing hangs off it now: where **back** goes.
   *
   * **`'threads'` is gone — PD-426 deleted the index route that was its only
   * passer**, and the three values left are the three screens that draw this
   * header. `/rides/detail/thread` and `/rides/detail/threads/new` draw a plain
   * `Header` of their own, as they always did.
   *
   * `'invite'` (`083`, PD-329) behaves exactly as `'crew'` does — back to the
   * plan — and is a distinct value rather than a reuse of it so the prop keeps
   * meaning "which screen" rather than "which back target". The day a screen
   * needs its own sub-row, the reuse would have been the thing in the way.
   */
  current: 'plan' | 'crew' | 'invite'
  /**
   * Whether this rider organises the ride — only the organizer gets Edit in the
   * options menu.
   *
   * **Required, not optional, and that is the whole point** (PD-101). The
   * sibling `isCrew` prop was optional for one commit and *neither* caller
   * passed it, so the control it gated never rendered and the entire chat epic
   * shipped reachable only by typing the URL — `tsc` green throughout, because
   * an optional prop that gates a control is indistinguishable from a control
   * nobody wanted. Required, a new ride sub-page cannot forget it; pass
   * `undefined` explicitly while loading.
   */
  isOrganizer: boolean | undefined
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
  // Threads and Crew are both entered from the ride, so back returns there
  // rather than to the list — the plan is the list's child, and the others are
  // the ride's. `Ride - Chat` drew the same arrow for all three, which is
  // exactly the kind of thing a static frame cannot distinguish.
  //
  // The plan's own back is `/rides` UNLESS the ride was opened from a club
  // timeline row, in which case it returns to that row — PD-378.
  //
  // **Every screen that returns to the plan drops the anchor, deliberately.**
  // The two this component serves beside the plan (`crew`, `invite`) go back via
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
  // to the same place by construction — one value, read twice. All three ride
  // screens this header serves get it. `/rides/detail/edit` and the two thread
  // screens draw a plain `Header` and are deliberately not among them — see
  // `useSwipeBack`.
  useSwipeBack(backHref)

  return (
    <Header
      title={title}
      backHref={backHref}
      // No sub-row on any of the three: the switcher that used to live here is
      // deleted, the crew count went with the threads screen (PD-426), and
      // `Header` draws the 96px variant when none is passed.
      secondaryAction={<RideOptionsMenu rideId={rideId} isOrganizer={isOrganizer} />}
    />
  )
}
