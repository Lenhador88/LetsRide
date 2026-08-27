import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { rideIdSchema, rideInviteIdSchema } from '@/lib/validation/rides'
import type { ActionState } from '@/lib/actions/state'

/**
 * The writes behind ride invites — `083`, PD-329.
 *
 * ## Two of the four are RPCs, and that is the contract rather than a
 * convenience
 *
 * `accept` and `decline` go through `accept_ride_invite` / `decline_ride_invite`
 * because the status change and the `ride_members` row must be one statement:
 * two client round trips tear, leaving an accepted invite with no crew row or a
 * crew row with a pending invite, and nothing to repair either. PostgREST
 * offers no transaction, so the alternative is a lie.
 *
 * `authenticated` holds no UPDATE grant on `ride_invites` at all, so those two
 * RPCs are the only writers of `status` in the system — a client `.update()`
 * would be refused whatever it sent.
 *
 * ## Nothing here checks who may invite
 *
 * `083`'s INSERT policy pins `inviter_id` to the caller and requires them to be
 * the ride's organizer, so a crew member or a club member is refused by the
 * database. Restating it here would be a second copy of a rule RLS owns, free
 * to drift, and it would be weaker: the publishable key ships in the bundle.
 */

/**
 * The organizer invites one rider to their ride.
 *
 * **`23505` is "already invited", not an error.** The unique
 * `(ride_id, invitee_id)` is what makes a repeat invite a no-op rather than a
 * way to ring somebody's phone twice, so hitting it means the picker offered a
 * rider it should have filtered — a race, not a failure — and the rider's
 * intent is already satisfied.
 */
export async function inviteRiderToRide(
  rideId: string,
  inviteeId: string
): Promise<ActionState> {
  if (!rideIdSchema.safeParse(rideId).success || !rideIdSchema.safeParse(inviteeId).success) {
    return { error: 'That rider could not be invited.' }
  }

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to invite riders.' }

  const { error } = await supabase.from('ride_invites').insert({
    ride_id: rideId,
    invitee_id: inviteeId,
    // From the session, never the argument: the policy pins it to `auth.uid()`
    // anyway, and a parameter is something a caller can get wrong.
    inviter_id: user.id,
  })

  if (error && error.code !== '23505') {
    // A refusal is usually the policy deciding this caller is not the ride's
    // organizer, or that the two riders have blocked each other. From the
    // rider's side both look like the invite simply not being available, which
    // is what the message says rather than accusing them of anything — and
    // saying "you have been blocked" would be the disclosure decision #2
    // forbids.
    return { error: 'Could not send that invite. The ride may no longer be available.' }
  }

  invalidate(queryKeys.rides.invites(rideId))
  // The picker must stop offering a rider who has just been invited, and its
  // key hangs off `invites` rather than off the ride — so the line above does
  // not reach it. `invites.all()` rather than one query string: the rider is
  // one keystroke away from a different one.
  invalidate(queryKeys.invites.all())
  return { error: null, sent: true }
}

/**
 * The invitee accepts. **Five keys move, across two domains.**
 *
 * The one that gets missed is `rides.detail` — the rider is navigated straight
 * to a screen that reads it, and a stale entry shows them a ride they have just
 * joined with themselves absent from the crew. It is named here rather than
 * left to `rides.all()` so the reason survives.
 */
export async function acceptRideInvite(inviteId: string, rideId: string): Promise<ActionState> {
  if (!rideInviteIdSchema.safeParse(inviteId).success) {
    return { error: 'That invite could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('accept_ride_invite', { invite: inviteId })

  if (error) {
    // ONE message, because the RPC has one raise site. "No such invite", "not
    // yours", "already answered" and "the organizer has blocked you" are
    // deliberately indistinguishable in the database, and repairing that here
    // by branching on anything would put the oracle back.
    return { error: 'Could not accept that invite. It may have been withdrawn.' }
  }

  invalidate(queryKeys.invites.pending())
  invalidate(queryKeys.notifications.all())
  invalidate(queryKeys.rides.detail(rideId))
  invalidate(queryKeys.rides.crew(rideId))
  invalidate(queryKeys.rides.invites(rideId))
  return { error: null, sent: true }
}

/**
 * The invitee declines. **Deliberately does NOT invalidate the ride.**
 *
 * Declining changes nothing a ride screen renders — no crew row is written or
 * removed — and the rider is not navigated there. What it does change is the
 * ride's *readability*, which is why they are not sent there either: a declined
 * invite grants nothing, so the ride they just refused is gone from them.
 */
export async function declineRideInvite(inviteId: string, rideId: string): Promise<ActionState> {
  if (!rideInviteIdSchema.safeParse(inviteId).success) {
    return { error: 'That invite could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('decline_ride_invite', { invite: inviteId })

  if (error) {
    return { error: 'Could not decline that invite. It may have been withdrawn.' }
  }

  invalidate(queryKeys.invites.pending())
  invalidate(queryKeys.notifications.all())
  invalidate(queryKeys.rides.invites(rideId))
  return { error: null, sent: true }
}

/**
 * The organizer withdraws an invite nobody has answered.
 *
 * **No `.select()` chained onto the delete.** `RETURNING` re-attaches the
 * SELECT policy, which is the mechanism that makes a filtered delete match zero
 * rows and still report success — `add-club-threads` measured it. Here the
 * filter is `083`'s DELETE policy, scoped to `status = 'pending'`, so an
 * answered invite matches nothing and the absence of a chained select is what
 * keeps that honest.
 *
 * A delete matching zero rows is not reported as an error, and that is the
 * right answer rather than a gap: the organizer's intent — this invite is not
 * outstanding — is already true.
 */
export async function revokeRideInvite(inviteId: string, rideId: string): Promise<ActionState> {
  if (!rideInviteIdSchema.safeParse(inviteId).success) {
    return { error: 'That invite could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.from('ride_invites').delete().eq('id', inviteId)

  if (error) {
    return { error: 'Could not withdraw that invite.' }
  }

  invalidate(queryKeys.rides.invites(rideId))
  // The withdrawn rider becomes offerable again — same reach argument as
  // `inviteRiderToRide`.
  invalidate(queryKeys.invites.all())
  return { error: null, sent: true }
}
