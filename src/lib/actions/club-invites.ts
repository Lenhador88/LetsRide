import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { invalidateClubMembership } from '@/lib/actions/clubs'
import { clubIdSchema, clubInviteIdSchema } from '@/lib/validation/clubs'
import type { ActionState } from '@/lib/actions/state'

/**
 * The writes behind club invites — `093`, PD-360,
 * `lib/actions/ride-invites.ts`'s shape one domain over.
 *
 * ## Two of the four are RPCs, and that is the contract rather than a
 * convenience
 *
 * `accept` and `decline` go through `accept_club_invite` / `decline_club_invite`
 * because the status change and the `club_members` row (for accept) must be
 * one statement: two client round trips tear, leaving an accepted invite with
 * no membership row or a membership with a pending invite still standing, and
 * nothing to repair either. PostgREST offers no transaction, so the
 * alternative is a lie.
 *
 * `authenticated` holds no UPDATE grant on `club_invites` at all, so those two
 * RPCs are the only writers of `status` in the system — a client `.update()`
 * would be refused whatever it sent.
 *
 * ## Nothing here checks who may invite
 *
 * `093`'s INSERT policy requires `private.may_invite_to_club(club_id)` — an
 * admin on a private club, or any member on a public one — so a rider outside
 * either set is refused by the database. Restating it here would be a second
 * copy of a rule RLS owns, free to drift, and it would be weaker: the
 * publishable key ships in the bundle.
 */

/**
 * An authorised member invites one rider to their club.
 *
 * **`23505` is "already invited", not an error.** The unique
 * `(club_id, invitee_id)` is what makes a repeat invite a no-op rather than a
 * way to ring somebody's phone twice, so hitting it means the picker offered a
 * rider it should have filtered — a race, or an invite sent on another
 * device — and the rider's intent is already satisfied.
 */
export async function inviteRiderToClub(clubId: string, inviteeId: string): Promise<ActionState> {
  if (!clubIdSchema.safeParse(clubId).success || !clubIdSchema.safeParse(inviteeId).success) {
    return { error: 'That rider could not be invited.' }
  }

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to invite riders.' }

  const { error } = await supabase.from('club_invites').insert({
    club_id: clubId,
    invitee_id: inviteeId,
    // From the session, never the argument: the policy pins it to `auth.uid()`
    // anyway, and a parameter is something a caller can get wrong.
    inviter_id: user.id,
  })

  if (error && error.code !== '23505') {
    // A refusal is usually the admissibility trigger deciding this rider is
    // already a member, the owner, or holds a pending join request, or the
    // policy deciding this caller may not invite into this club, or that the
    // two riders have blocked each other. From the inviter's side all of that
    // looks like the invite simply not being available, which is what the
    // message says rather than accusing anybody — see `036`'s comment on why
    // the admissibility trigger tests no block: naming one here would leak it
    // sideways just the same.
    return { error: 'Could not send that invite. The club may no longer be available.' }
  }

  invalidate(queryKeys.clubs.inviteList(clubId))
  // The picker must stop offering a rider who has just been invited, and its
  // key hangs off `clubInvites` rather than off the club — so the line above
  // does not reach it.
  invalidate(queryKeys.clubInvites.all())
  return { error: null, sent: true }
}

/**
 * The inviting member withdraws an invite nobody has answered.
 *
 * **No `.select()` chained onto the delete**, matching `revokeRideInvite`:
 * `RETURNING` re-attaches the SELECT policy, which is the mechanism that makes
 * a filtered delete match zero rows and still report success. Here the filter
 * is `093`'s DELETE policy, scoped to `status = 'pending'` for the inviter
 * (an admin may withdraw a `declined` one too), so an answered invite the
 * caller has no authority over matches nothing — and a delete matching zero
 * rows is not reported as an error, because the caller's intent — this
 * invite is not outstanding — is already true.
 */
export async function withdrawClubInvite(inviteId: string, clubId: string): Promise<ActionState> {
  if (!clubInviteIdSchema.safeParse(inviteId).success) {
    return { error: 'That invite could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.from('club_invites').delete().eq('id', inviteId)

  if (error) {
    return { error: 'Could not withdraw that invite.' }
  }

  invalidate(queryKeys.clubs.inviteList(clubId))
  // The withdrawn rider becomes offerable again — same reach argument as
  // `inviteRiderToClub`.
  invalidate(queryKeys.clubInvites.all())
  return { error: null, sent: true }
}

/**
 * The invitee accepts. **Takes the club id as well as the invite id**, unlike
 * `acceptRideInvite`: that action invalidates the WHOLE `rides.all()` prefix
 * because rides and their lists are not addressable any other way from the
 * notification row, while a club write can go straight through
 * `invalidateClubMembership(clubId)` — the same helper `joinClub` and
 * `leaveClub` already use — because the invite row itself names the club and
 * the caller (`ClubInviteActions`) already holds it.
 */
export async function acceptClubInvite(inviteId: string, clubId: string): Promise<ActionState> {
  if (!clubInviteIdSchema.safeParse(inviteId).success || !clubIdSchema.safeParse(clubId).success) {
    return { error: 'That invite could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('accept_club_invite', { invite: inviteId })

  if (error) {
    // ONE message, because the RPC has one raise site. "No such invite", "not
    // yours", "already answered", "the inviter's authority has ended" and "the
    // owner has blocked you" are deliberately indistinguishable in the
    // database, and repairing that here by branching on anything would put the
    // oracle back.
    return { error: 'Could not accept that invite. It may have been withdrawn.' }
  }

  invalidate(queryKeys.clubInvites.pending())
  // Reaches `clubs.all()`, this club's feed and ride list, and
  // `notifications.all()` in one call — the identical write `joinClub` makes.
  invalidateClubMembership(clubId)
  return { error: null, sent: true }
}

/**
 * The invitee declines. It writes no membership, so nothing about the club's
 * own readability changes for this rider — unlike a declined RIDE invite,
 * which takes the ride's readability with it, a private club was never
 * readable to a pending invitee in the first place (`design.md` §The invitee
 * needs no new read path), so there is no stale `clubs.detail` entry to worry
 * about here.
 *
 * **The notification must be marked read BEFORE this runs, and today it is —
 * by construction rather than by an ordering here.** On a private club the
 * `club_invited` row stops resolving the moment the invite leaves `pending`,
 * so `markNotificationsRead` afterwards matches zero rows and PostgREST
 * reports success. Nothing gets stuck (an unreadable row is not counted
 * either), and the order holds because `MarkNotificationsRead` fires once on
 * opening `/notifications` while Decline is a later tap. It is written down
 * because moving that mark-read to a per-row dismiss, or to a Stop handler,
 * silently leaves a read notification unread for ever.
 */
export async function declineClubInvite(inviteId: string): Promise<ActionState> {
  if (!clubInviteIdSchema.safeParse(inviteId).success) {
    return { error: 'That invite could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('decline_club_invite', { invite: inviteId })

  if (error) {
    return { error: 'Could not decline that invite. It may have been withdrawn.' }
  }

  invalidate(queryKeys.clubInvites.pending())
  invalidate(queryKeys.notifications.all())
  return { error: null, sent: true }
}
