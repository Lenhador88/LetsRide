/**
 * Which control owns the ride detail's sticky bottom slot, and which entrance
 * to the postcard composer the rider therefore gets — PD-401.
 *
 * ## Why this is a function rather than two expressions on the page
 *
 * The two answers are **complementary**, and that is the whole property worth
 * protecting: a crew member is offered exactly one entrance to
 * `routes.newPostcardInRide`, never two and never none. Written as two
 * conditions at two points in the JSX they can drift into agreeing — the tidy-up
 * that "simplifies" `bottomSlot !== 'create'` back to `canRsvp` looks correct
 * and re-opens it the day a third thing can take the slot. Here it is one
 * decision with one test, in the shape `resolveDestination` and
 * `resolveClubTimelineAdvance` already use.
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
 */
export type RideBottomSlot = 'rsvp' | 'create' | null

export type RideDetailActions = {
  /** Which bar renders in the sticky slot above the navigation bar, if any. */
  bottomSlot: RideBottomSlot
  /** Whether `RideTimeline`'s heading draws its `(+)` — the fallback entrance,
   *  owed only when the create bar could not take the slot. */
  timelineAdd: boolean
}

export function resolveRideDetailActions({
  canRsvp,
  canCreate,
}: {
  /** The RSVP bar's own condition: an upcoming ride the viewer does not
   *  organize. It wins the slot, because answering *are you going* is the thing
   *  that stops being possible once the ride has left. */
  canRsvp: boolean
  /** Crew — `041` requires `private.is_ride_crew` to tag a postcard to a ride.
   *  The database's rule, not the composition's: false here means the rider
   *  gets **neither** entrance, because both would be refused. */
  canCreate: boolean
}): RideDetailActions {
  if (!canCreate) return { bottomSlot: canRsvp ? 'rsvp' : null, timelineAdd: false }
  return canRsvp
    ? { bottomSlot: 'rsvp', timelineAdd: true }
    : { bottomSlot: 'create', timelineAdd: false }
}
