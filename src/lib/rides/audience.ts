/**
 * A ride's audience rule, in one place, because it is stated to the rider by a
 * component and enforced again by an action — and the two copies of it drifted
 * once already (PD-338).
 *
 * **The rule is about the TRANSITION, not the shape.** `ride-lifecycle`
 * §*Editing a ride SHALL NOT be able to strand its crew* used to refuse the
 * shape outright: neither public nor in a club. PD-320 then made exactly that
 * combination the ride composer's default output, so the ordinary ride created
 * outside a club became one its organizer could only edit by publishing it to
 * every signed-in rider. The rule now refuses an edit that *reduces* a ride's
 * standing audience to the organizer alone, and permits any edit to a ride that
 * was already there.
 *
 * **Standing audience** is the set of riders who reach the ride by a standing
 * rule rather than by an invitation the organizer issued one at a time:
 *
 * | Stored shape | Standing audience |
 * |---|---|
 * | `is_public` | every signed-in rider not blocked with the organizer |
 * | `club_id` not null | that club's members |
 * | neither | nobody but the organizer |
 *
 * Riders holding a live invite are deliberately not counted. `083`'s fourth
 * `rides` SELECT arm (`private.has_live_ride_invite`) is what makes the
 * clubless private shape legitimate at all — it is why `createRide` may produce
 * it — but each of those riders was named by the organizer, so an invite grants
 * *reach* without giving the ride an audience they did not personally choose.
 *
 * **This rule is advisory and that is a decision rather than a gap.** It lives
 * here and in `updateRide`; no CHECK, trigger or policy expresses it, and the
 * `rides` UPDATE `WITH CHECK` permits the shape. `CLAUDE.md` §Technology
 * Decisions is why that has to be written down: a rule reaching only client
 * code is one a rider can simply not run.
 */

export type RideAudienceShape = {
  club_id: string | null
  is_public: boolean
}

/** No club and not public: the only shape with no standing audience at all. */
function hasNoStandingAudience(shape: RideAudienceShape): boolean {
  return !shape.club_id && !shape.is_public
}

/**
 * True when `submitted` would take a ride that HAS a standing audience and
 * leave it with none — the one transition the edit path refuses.
 *
 * Two edits produce it: detaching a private ride from its club, and
 * un-publishing a ride that is in no club. Everything else saves, including
 * every field on a ride that arrived clubless and private.
 *
 * **The stored pair must come from the database, never from a form field.** A
 * client that can post the payload can post a claim about the prior state with
 * it, which would make the action's copy of this rule decorative.
 */
export function narrowsToNobody(
  stored: RideAudienceShape,
  submitted: RideAudienceShape
): boolean {
  return hasNoStandingAudience(submitted) && !hasNoStandingAudience(stored)
}

/**
 * The refusal, rendered by `EditRideForm` and returned by `updateRide`. **One
 * string, and that is the point** — there were two, they had already drifted,
 * and both argued from a premise `083` retired.
 *
 * It names who loses what rather than claiming the ride would be invisible to
 * everyone: since ride invites shipped, a rider can disprove an absolute
 * nobody-can-see-it claim by opening their own ride. It reads correctly for
 * both refused transitions, so one sentence covers detaching and un-publishing
 * with nothing left to drift.
 */
export const RIDE_AUDIENCE_REFUSAL =
  'Riders already in this ride’s crew would lose sight of it. With no club and not public, only you and the riders you invite can see a ride. Pick a club, or make it public.'

/**
 * The audience hint under the "Make this ride public" box, rendered by **both**
 * ride forms.
 *
 * A rider who creates a ride and then edits it reads both screens, so the two
 * sentences have to agree. They drifted once and a read caught it rather than a
 * gate (PD-320's review). A shared constant beats an assertion over two
 * literals: the assertion detects drift after someone writes it, the constant
 * makes it unwritable. The accepted cost is that a design wanting the two
 * screens to differ has to split this deliberately — which is the review this
 * pair has needed twice.
 */
export const RIDE_AUDIENCE_HINT =
  'Anyone signed in can see and join a public ride. A private ride is visible to its club, and to riders you invite.'
