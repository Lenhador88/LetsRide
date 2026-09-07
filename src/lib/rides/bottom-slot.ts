import { routes } from '@/lib/routes'
import type { RideAttendance, RideCreateOption } from '@/types'

/**
 * Which control owns the ride detail's sticky bottom slot, whether the rider's
 * answer is drawn as a chip on the first content line, and what the create
 * sheet holds — PD-401, widened by PD-402, reshaped by PD-404.
 *
 * ## Why this is a function rather than three expressions on the page
 *
 * The answers are **mutually constraining**, and that is the property worth
 * protecting: the RSVP bar and the create affordance are never both drawn, and
 * the chip is the only route back to a bar that has collapsed. Written as
 * separate conditions at separate points in the JSX they drift into agreeing —
 * the tidy-up that "simplifies" `bottomSlot !== 'create'` back to `canRsvp`
 * looks correct and re-opens it. Here it is one decision with one test, in the
 * shape `resolveDestination` and `resolveClubTimelineAdvance` already use.
 *
 * ## What PD-404 changed: answering the RSVP replaces the bar
 *
 * Product owner, 2026-09-06, deciding a question this screen had been parked on
 * since PD-401. The RSVP bar and the floating action are **never both
 * present**, because answering the RSVP collapses the bar into a status chip on
 * the ride's first content line and hands the bottom corner to the create
 * action. Tapping the chip brings the bar back, so the answer stays changeable.
 *
 * - answered `Going` or `Maybe` → chip drawn, create action owns the slot;
 * - answered nothing → RSVP bar, no create action. Today's behaviour;
 * - tapped `No` → RSVP bar stays, exactly as it does today.
 *
 * **The `No` asymmetry is deliberate and must not be "fixed" here.**
 * `setRideAttendance` **deletes** the `ride_members` row for `null`, so a rider
 * who declined is byte-for-byte identical to one who never answered and nothing
 * can draw them a `Not going` chip. Symmetry needs a real `no` status — a
 * migration *and* a change to `private.is_ride_crew`, which `034` defines as
 * the organizer or a row of either status and which now gates ride threads
 * (`108`) as well as postcard tagging (`041`). The owner chose the cheap route
 * knowingly.
 *
 * ## Why the rider's rule and the database's rule compose
 *
 * `private.is_ride_crew` is true for the organizer or **any** `ride_members`
 * row, either status. So Going and Maybe can both tag a postcard and open a
 * thread, and No — no row — can do neither. **The create action therefore
 * appears exactly when the write would succeed**, which is the property PD-401
 * pinned: a control the database refuses is worse than no control. Nothing here
 * weakens it.
 *
 * ## `timelineAdd` is GONE, and it is unreachable rather than unwanted
 *
 * PD-401 kept a `(+)` on the timeline heading as the fallback for *upcoming +
 * crew + the RSVP bar owns the slot*. Under this design that state cannot
 * exist, and the proof is in the read rather than in the composition:
 *
 * ```
 * src/lib/data/rides.ts:618   is_crew: isRideCrew(isOrganizer, ownRow?.status ?? null)
 * src/lib/data/rides.ts:692   isOrganizer || attendance !== null
 * ```
 *
 * So for a non-organizer, **crew ⟺ `attendance !== null`**. `rsvpApplies`
 * excludes the organizer, and the bar is owed only while the answer is still
 * `null` — which is exactly when that rider is *not* crew. `canCreate` and an
 * unanswered RSVP are therefore contradictory, the `(+)`'s case is empty, and a
 * fallback nothing can reach is furniture that reads as a live affordance to
 * the next person editing this screen. The invariant it protected survives in a
 * sharper form below.
 *
 * **The one state with no create entrance is `reopened`**, and it is
 * rider-initiated, transient and reversible by the same tap that caused it: a
 * crew member who taps their chip to change their answer gets the bar back and
 * the create action steps aside until they are done. Resurrecting the `(+)` for
 * that state alone would put an affordance on the timeline heading that appears
 * and disappears as the bar toggles, which is worse than the gap it fills.
 *
 * **The invariant, restated for this shape: `createOptions` is non-empty if and
 * only if `bottomSlot` is `'create'`.** A sheet with no rows behind a control
 * that opens it is invisible to `tsc` and to every gate but a rider's tap. The
 * test is exhaustive over the input space and asserts it in both directions.
 */
export type RideBottomSlot = 'rsvp' | 'create' | null

export type RideDetailActions = {
  /** Which control renders in the sticky slot above the navigation bar, if any. */
  bottomSlot: RideBottomSlot
  /**
   * The rider's stored answer, drawn as a chip on the ride's first content
   * line — `null` draws nothing.
   *
   * **It is a control, not a badge.** Once the bar has collapsed this is the
   * only route back to it, so it stays drawn while the bar is reopened and
   * toggles it shut again. A rider who could not close the bar they opened
   * would be stuck with no create affordance.
   */
  statusChip: RideAttendance
  /**
   * What the create sheet holds, in the order it draws them. Empty exactly when
   * the create action is not drawn — see the invariant above.
   *
   * **Built here rather than in the components**, so nothing can offer
   * different rows from a second entrance if one is ever added back.
   */
  createOptions: RideCreateOption[]
}

export function resolveRideDetailActions({
  rideId,
  rsvpApplies,
  attendance,
  canCreate,
  reopened,
}: {
  /** The ride every option's destination is scoped to. */
  rideId: string
  /**
   * Whether the RSVP question applies to this viewer at all: an upcoming ride
   * they do not organize.
   *
   * **Not the same as "the bar is drawn"** — that is this plus an unanswered
   * or reopened RSVP, and keeping the two apart is what lets the chip be drawn
   * for the answered case without re-deriving the eligibility test beside it.
   */
  rsvpApplies: boolean
  /**
   * The stored answer. `null` is *unanswered* — and for a non-organizer it is
   * also *not crew*, which is the identity the `timelineAdd` proof above rests
   * on.
   *
   * **`RideDetail.attendance` is the FOLDED field and passing it here is
   * deliberate rather than an oversight.** `getRide` returns
   * `ownRow?.status ?? (isOrganizer ? 'going' : null)`, so it reads `going` for
   * an organizer holding no row — but `rsvpApplies` is false for every
   * organizer, and both outputs that consume this input are behind it. The fold
   * is therefore unreachable, and threading a second unfolded field down from
   * the data layer would add a column to `RideDetail` that nothing could
   * observe a difference from.
   *
   * **What that costs, stated so it is a decision rather than luck**: the
   * safety is `rsvpApplies`', not this input's. If a later change ever lets the
   * organizer answer — `103`'s `protect_ride_organizer_membership` is what
   * stops it today — this must become the raw `ride_members.status` in the same
   * commit, or the organizer gets a chip offering a bar the database refuses.
   */
  attendance: RideAttendance
  /**
   * Crew — `041` requires `private.is_ride_crew` to tag a postcard to a ride,
   * and `108` requires the same helper to open a thread on one. The database's
   * rule, not the composition's: false here means no create entrance at all,
   * because every row of the sheet would be refused.
   */
  canCreate: boolean
  /**
   * The rider tapped their chip to change their answer, so the bar comes back
   * for as long as they leave it open. Page state rather than a stored fact —
   * it resets when a new answer lands, which is what collapses the bar again.
   */
  reopened: boolean
}): RideDetailActions {
  // Drawn whenever the question applies and there is an answer to show, INCLUDING
  // while the bar is reopened — see `statusChip`'s note on why it must not hide
  // itself there.
  const statusChip: RideAttendance = rsvpApplies && attendance !== null ? attendance : null

  const barDrawn = rsvpApplies && (attendance === null || reopened)

  if (barDrawn) return { bottomSlot: 'rsvp', statusChip, createOptions: [] }
  if (!canCreate) return { bottomSlot: null, statusChip, createOptions: [] }

  // Postcard first: it is the older affordance, the one the frame names in this
  // slot on the club, and the one a rider reaches for most. `ClubCreateAction`
  // orders its own sheet the same way.
  return {
    bottomSlot: 'create',
    statusChip,
    createOptions: [
      { kind: 'postcard', label: 'Postcard', href: routes.newPostcardInRide(rideId) },
      { kind: 'thread', label: 'Thread', href: routes.newRideThread(rideId) },
    ],
  }
}
