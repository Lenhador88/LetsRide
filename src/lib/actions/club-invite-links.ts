import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { invalidateClubMembership } from '@/lib/actions/clubs'
import {
  clubIdSchema,
  clubInviteLinkIdSchema,
  clubInviteTokenSchema,
} from '@/lib/validation/clubs'
import type { ActionState } from '@/lib/actions/state'
import type { ClubInviteLinkClaim } from '@/types'

/**
 * The writes behind club invite links — `093`, PD-360,
 * `lib/actions/ride-invite-links.ts`'s shape one domain over.
 *
 * ## One insert and two RPCs, and the split is the contract
 *
 * **Minting is an ordinary INSERT** naming `(club_id, created_by)` and nothing
 * else, because the interesting columns are not the client's to write: `token`
 * comes from a column default and `expires_at` from a plain column default too
 * (`now() + 14 days`) — unlike a ride's, which needs a BEFORE INSERT trigger
 * to read the ride's own departure, a club has no natural death to read. So
 * there is no statement in which a client can choose a token or an expiry.
 *
 * **Revoking is an RPC** rather than an UPDATE grant, because a grant on
 * `(revoked_at)` lets a client un-revoke by writing NULL. `authenticated`
 * holds no UPDATE on this table at all.
 *
 * **Claiming is an RPC** because the `club_members` row and the pending
 * `club_join_requests` row it clears must be one statement — two client round
 * trips tear, and PostgREST offers no transaction. It is also the only one of
 * the three whose caller may be a complete stranger to the club.
 *
 * ## Nothing here checks who may do any of it
 *
 * The INSERT policy pins `created_by` to the caller and requires
 * `private.may_mint_club_link(club_id)` — an admin, and never on a public
 * club (decision 1); the two RPCs each answer for exactly one link and have
 * one raise site apiece. Restating any of that here would be a second copy of
 * a rule the database owns, free to drift, and weaker.
 */

/**
 * An admin mints a link.
 *
 * **Nothing is read back**, deliberately: no `.select()` is chained, matching
 * `createRideInviteLink` — the new row's token is not needed here, the
 * section refetches on the invalidation below and is where the admin shares
 * from.
 *
 * **No cap on how many links one club may have**, on `createRideInviteLink`'s
 * own precedent (`design.md` §Expiry): a cap nobody can see is not a bound.
 */
export async function createClubInviteLink(clubId: string): Promise<ActionState> {
  if (!clubIdSchema.safeParse(clubId).success) {
    return { error: 'That link could not be created.' }
  }

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to create an invite link.' }

  const { error } = await supabase.from('club_invite_links').insert({
    club_id: clubId,
    // From the session, never an argument: the policy pins it to `auth.uid()`
    // anyway, and a parameter is something a caller can get wrong.
    created_by: user.id,
  })

  if (error) {
    // Usually the policy deciding this caller is not an admin, that the club
    // is public (decision 1 refuses a token there), or the participation gate
    // refusing a rider with no consent stamp. Neither is worth naming to
    // somebody looking at their own club's invite screen.
    return { error: 'Could not create an invite link. Try again.' }
  }

  invalidate(queryKeys.clubs.inviteLinks(clubId))
  return { error: null, sent: true }
}

/**
 * An admin kills a link.
 *
 * **It admits nobody new and removes nobody already in**, matching
 * `revokeRideInviteLink` — and here that second half is a stronger claim than
 * the ride one, because `088`'s `remove_club_member` exists and this control
 * is deliberately not it. The copy at the call site says exactly that; see
 * `design.md` §What removal does not do for the gap this leaves and why it is
 * PD-361 rather than something to build here.
 */
export async function revokeClubInviteLink(linkId: string, clubId: string): Promise<ActionState> {
  if (!clubInviteLinkIdSchema.safeParse(linkId).success) {
    return { error: 'That link could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('revoke_club_invite_link', { link: linkId })

  if (error) {
    // ONE message, because the RPC has one raise site. "No such link", "not
    // yours" and "already revoked" are deliberately indistinguishable in the
    // database, and branching on anything here would put the oracle back.
    return { error: 'Could not revoke that link. It may already be revoked.' }
  }

  invalidate(queryKeys.clubs.inviteLinks(clubId))
  return { error: null, sent: true }
}

/**
 * A rider spends a token — **only ever from a tap.**
 *
 * No effect, no route-guard branch and no `onAuthStateChange` listener may
 * call this. A stash is a string in a browser and the rider who *signs in* is
 * not necessarily the rider who *opened the link*: an abandoned sign-up
 * followed by somebody else signing into the same tab would auto-join that
 * second rider to a private club they were never told about, with a
 * `club_members` row and a `club_joined` notification naming them to the
 * club's admins. At the database layer that is a **valid** claim —
 * authenticated, onboarded, unblocked, live token — so no policy, trigger or
 * RLS assertion can catch it. Requiring a tap makes it unreachable by
 * construction, and `ClubInviteJoin`'s test is what keeps it that way.
 *
 * ## Unlike `claimRideInviteLink`, no `23514` self-invite branch
 *
 * "The caller is the owner" is folded into `private.club_invite_link_reachable_by`
 * itself, alongside expiry and revoke — see `ClubInviteLinkPreview`'s own
 * docstring. So there is exactly one error shape here, never two.
 *
 * ## The claim clears a pending join request, not the picture on screen
 *
 * `private.join_club_from_invite` deletes any pending `club_join_requests` row
 * for the pair after writing the membership (`design.md` §The two mechanisms
 * meet) — a database-side fact this action does not need to know, because
 * nothing on the client caches a join-request row keyed to a stranger the way
 * it caches this rider's own invites.
 */
export async function claimClubInviteLink(
  token: string
): Promise<ActionState & { claim?: ClubInviteLinkClaim }> {
  if (!clubInviteTokenSchema.safeParse(token).success) {
    return { error: 'This invite link is no longer valid.' }
  }

  const supabase = await resolveSupabase()
  const { data, error } = await supabase.rpc('claim_club_invite_link', { t: token })

  if (error) {
    // ONE message for everything, because the RPC has one raise site:
    // expired, revoked, the club deleted, the minter demoted or departed,
    // blocked in either direction, un-onboarded, already a member, the owner,
    // and simply guessed are all indistinguishable by design.
    return { error: 'This invite link is no longer valid.' }
  }

  const clubId = typeof data === 'string' ? data : null
  // The RPC returns the club id and raises otherwise, so this is
  // unreachable — but the rider IS on the club at this point, and sending
  // them nowhere with a success message would be worse than the generic
  // refusal.
  if (!clubId) return { error: 'This invite link is no longer valid.' }

  invalidate(queryKeys.clubInvites.all())
  // Reaches `clubs.all()`, this club's feed and ride list, and
  // `notifications.all()` in one call — the identical write `joinClub` makes.
  invalidateClubMembership(clubId)
  return { error: null, claim: { club_id: clubId } }
}
