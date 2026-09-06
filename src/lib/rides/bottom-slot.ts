import { routes } from '@/lib/routes'
import type { RideCreateOption } from '@/types'

/**
 * Which control owns the ride detail's sticky bottom slot, which entrance to
 * the create sheet the rider therefore gets, and what that sheet holds —
 * PD-401, widened by PD-402.
 *
 * ## Why this is a function rather than two expressions on the page
 *
 * The first two answers are **complementary**, and that is the whole property
 * worth protecting: a crew member is offered exactly one entrance to the create
 * sheet, never two and never none. Written as two conditions at two points in
 * the JSX they can drift into agreeing — the tidy-up that "simplifies"
 * `bottomSlot !== 'create'` back to `canRsvp` looks correct and re-opens it the
 * day a third thing can take the slot. Here it is one decision with one test, in
 * the shape `resolveDestination` and `resolveClubTimelineAdvance` already use.
 *
 * ## The collision this resolves
 *
 * `RideAttendanceBar` already owns that slot on every upcoming ride the viewer
 * does not organize, which is most riders on most rides — so a create bar there
 * either collides with it or replaces it. PD-401 put four ways out and this
 * takes **B**, *create only when the RSVP bar is absent*, with the timeline
 * heading's `(+)` kept as the fallback so no rider loses an entrance they had
 * before. The page's `bottomSlot` comment carries why **D** — moving the RSVP
 * into the page body, the issue's own recommendation — is not taken: it
 * contradicts an approved v2 frame, which is the owner's decision rather than a
 * build's.
 *
 * B is also where the bar does most good, which is not luck. A rider
 * photographs a ride that has **happened**; a past ride is not `is_upcoming`,
 * so it has no RSVP bar and gets the discoverable bar. The `(+)` survives for
 * the upcoming-and-not-yours case, which is posting a photo of a ride that has
 * not left yet.
 *
 * ## What PD-402 changed, and the invariant it added
 *
 * A ride used to create exactly one thing, so `bottomSlot: 'create'` was a link
 * straight to the postcard composer and `RideCreateBar`'s own docstring said the
 * sheet shape *"becomes right on the day PD-402 lands rather than before it"*.
 * `108` gives a ride threads, so it creates two things and both entrances now
 * open a sheet.
 *
 * **The added invariant: `createOptions` is non-empty if and only if either
 * entrance is drawn.** A sheet with no rows behind a control that opens it is
 * the failure this pins — it is invisible to `tsc` and to every gate but a
 * rider's tap. The test is exhaustive over the input space and asserts it in
 * both directions.
 */
export type RideBottomSlot = 'rsvp' | 'create' | null

export type RideDetailActions = {
  /** Which bar renders in the sticky slot above the navigation bar, if any. */
  bottomSlot: RideBottomSlot
  /** Whether `RideTimeline`'s heading draws its `(+)` — the fallback entrance,
   *  owed only when the create bar could not take the slot. */
  timelineAdd: boolean
  /**
   * What the create sheet holds, in the order it draws them. Empty exactly when
   * neither entrance is drawn — see the invariant above.
   *
   * **Built here rather than in the components**, so the two entrances cannot
   * offer different rows: they are one list read twice, which is the same
   * argument the two booleans above make.
   */
  createOptions: RideCreateOption[]
}

export function resolveRideDetailActions({
  rideId,
  canRsvp,
  canCreate,
}: {
  /** The ride every option's destination is scoped to. */
  rideId: string
  /** The RSVP bar's own condition: an upcoming ride the viewer does not
   *  organize. It wins the slot, because answering *are you going* is the thing
   *  that stops being possible once the ride has left. */
  canRsvp: boolean
  /**
   * Crew — `041` requires `private.is_ride_crew` to tag a postcard to a ride,
   * and `108` requires the same helper to open a thread on one. The database's
   * rule, not the composition's: false here means the rider gets **neither**
   * entrance, because every row of the sheet would be refused.
   *
   * **The two destinations share one predicate today and that is a fact rather
   * than a design.** `041` and `108` both gate on `private.is_ride_crew`, so one
   * boolean answers for both. The day a ride creates something on a *different*
   * predicate, this splits into one flag per option and the sheet filters —
   * `createOptions` is already a list so that change stays inside this file.
   */
  canCreate: boolean
}): RideDetailActions {
  if (!canCreate) {
    return { bottomSlot: canRsvp ? 'rsvp' : null, timelineAdd: false, createOptions: [] }
  }

  // Postcard first: it is the older affordance, the one the frame names in this
  // slot on the club, and the one a rider reaches for most. `ClubCreateBar`
  // orders its own sheet the same way.
  const createOptions: RideCreateOption[] = [
    { kind: 'postcard', label: 'Postcard', href: routes.newPostcardInRide(rideId) },
    { kind: 'thread', label: 'Thread', href: routes.newRideThread(rideId) },
  ]

  return canRsvp
    ? { bottomSlot: 'rsvp', timelineAdd: true, createOptions }
    : { bottomSlot: 'create', timelineAdd: false, createOptions }
}
