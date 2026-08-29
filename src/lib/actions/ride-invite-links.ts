import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import {
  rideIdSchema,
  rideInviteLinkIdSchema,
  rideInviteTokenSchema,
} from '@/lib/validation/rides'
import type { ActionState } from '@/lib/actions/state'
import type { RideInviteLinkClaim } from '@/types'

/**
 * The writes behind ride invite links — `091`, PD-330.
 *
 * ## One insert and two RPCs, and the split is the contract
 *
 * **Minting is an ordinary INSERT** naming `(ride_id, created_by)` and nothing
 * else, because the interesting columns are not the client's to write: `token`
 * comes from a column default and `expires_at` from a BEFORE INSERT trigger
 * reading `rides.departure_at`, and the INSERT grant names neither. So there is
 * no statement in which a client can choose a token or an expiry — the same
 * shape `083` uses to own `status`.
 *
 * **Revoking is an RPC** rather than an UPDATE grant, because a grant on
 * `(revoked_at)` lets a client un-revoke by writing NULL. `authenticated` holds
 * no UPDATE on this table at all.
 *
 * **Claiming is an RPC** because the `ride_invites` row and the `ride_members`
 * row must be one statement: two client round trips tear, and PostgREST offers
 * no transaction. It is also the only one of the three whose caller may be a
 * complete stranger to the ride.
 *
 * ## Nothing here checks who may do any of it
 *
 * The INSERT policy pins `created_by` to the caller and requires them to
 * organise the ride; the two RPCs each answer for exactly one link and have one
 * raise site apiece. Restating any of that here would be a second copy of a rule
 * the database owns, free to drift, and weaker — the publishable key ships in
 * the bundle.
 */

/**
 * The organizer mints a link.
 *
 * **Nothing is read back**, deliberately: no `.select()` is chained, because the
 * new row's token is not needed here — the list refetches on the invalidation
 * below and is where the organizer shares from. A chained `.select()` would
 * re-apply the SELECT policy on the way out, which is harmless for the organizer
 * and is still one more thing to be wrong about for no gain.
 *
 * There is deliberately **no cap on how many links one ride may have**
 * (`design.md` §Questions Closed Q4): a cap nobody can see is decision 4's own
 * argument against a max-uses ceiling, one level up.
 */
export async function createRideInviteLink(rideId: string): Promise<ActionState> {
  if (!rideIdSchema.safeParse(rideId).success) {
    return { error: 'That link could not be created.' }
  }

  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to create an invite link.' }

  const { error } = await supabase.from('ride_invite_links').insert({
    ride_id: rideId,
    // From the session, never an argument: the policy pins it to `auth.uid()`
    // anyway, and a parameter is something a caller can get wrong.
    created_by: user.id,
  })

  if (error) {
    // Usually the policy deciding this caller does not organise the ride, or the
    // participation gate refusing a rider with no consent stamp. Neither is
    // worth naming to somebody looking at their own ride's invite screen.
    return { error: 'Could not create an invite link. Try again.' }
  }

  invalidate(queryKeys.rides.inviteLinks(rideId))
  return { error: null, sent: true }
}

/**
 * The organizer kills a link.
 *
 * **It admits nobody new and removes nobody already in**, and the copy on the
 * confirmation says exactly that. The riders a link admitted hold a
 * `ride_members` row and an `accepted` invite, which are facts about a rider who
 * joined a ride rather than about a URL — and there is **no path in this app
 * that can remove a rider from a ride at all**: `ride_members`' only DELETE
 * policy is `auth.uid() = user_id`, `088`'s three RPCs are club-scoped, and
 * `083` leaves an accepted invite unanswerable. A tooltip implying otherwise
 * would be a lie, which is the one defect this control exists to avoid.
 */
export async function revokeRideInviteLink(
  linkId: string,
  rideId: string
): Promise<ActionState> {
  if (!rideInviteLinkIdSchema.safeParse(linkId).success) {
    return { error: 'That link could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('revoke_ride_invite_link', { link: linkId })

  if (error) {
    // ONE message, because the RPC has one raise site. "No such link", "not
    // yours" and "already revoked" are deliberately indistinguishable in the
    // database, and branching on anything here would put the oracle back.
    return { error: 'Could not revoke that link. It may already be revoked.' }
  }

  invalidate(queryKeys.rides.inviteLinks(rideId))
  return { error: null, sent: true }
}

/**
 * A rider spends a token — **only ever from a tap.**
 *
 * No effect, no route-guard branch and no `onAuthStateChange` listener may call
 * this. A stash is a string in a browser and the rider who *signs in* is not
 * necessarily the rider who *opened the link*: an abandoned sign-up followed by
 * somebody else signing into the same tab would auto-join that second rider to a
 * private ride they were never told about, with a `ride_members` row and a
 * `ride_joined` notification naming them. At the database layer that is a
 * **valid** claim — authenticated, onboarded, unblocked, live token — so no
 * policy, trigger or RLS assertion can catch it. Requiring a tap makes it
 * unreachable by construction, and `RideInviteJoin`'s test is what keeps it that
 * way.
 *
 * ## Two claims, and the wide one is deliberate
 *
 * `rides.all()` rather than the ride's own keys: this writes a `ride_members`
 * row, byte for byte the state change `setRideAttendance` and `acceptRideInvite`
 * make, and both already name the whole prefix for the reason
 * `acceptRideInvite` records — `detail` and `crew` do not reach `rides.list(…)`
 * or `rides.explore(…)`, so the rider would arrive at a ride list missing the
 * ride they just joined, with a public one still sitting in Explore.
 *
 * `invites.all()` reaches this token's own preview — `is_crew` has just flipped
 * — and the rider's own invite list, which now holds an `accepted` row that was
 * not there.
 *
 * **This mutation has a property no other one here has: there may be nothing
 * cached to invalidate.** The rider may have had no session when the landing
 * route first rendered, so the invalidation cannot be relied on to *cause* a
 * fetch. Every destination screen fetches on mount like any other; what this
 * stops is a **stale** entry from before the claim being served.
 */
export async function claimRideInviteLink(
  token: string
): Promise<ActionState & { claim?: RideInviteLinkClaim }> {
  if (!rideInviteTokenSchema.safeParse(token).success) {
    return { error: 'This invite link is no longer valid.' }
  }

  const supabase = await resolveSupabase()
  const { data, error } = await supabase.rpc('claim_ride_invite_link', { t: token })

  if (error) {
    // ** `23514` is the organizer tapping their OWN link, and it is the one
    // SQLSTATE that is not the RPC's raise site. ** `ride_invites` carries
    // `check (invitee_id <> inviter_id)`, so the insert refuses before the
    // crew row is written — and `091`'s own comment says the surface must not
    // leave that showing as "no longer valid", which is what it did.
    //
    // Normally unreachable: `createRide` puts the organizer in `ride_members`
    // in the same transaction, so the screen draws "you are already on this
    // ride" and never offers the button. It is reached by an organizer who
    // LEFT their own ride — `ride_members` DELETE is own-row and nothing stops
    // them — and then opened their own link to check it works. They were told
    // a live link was dead.
    //
    // ** It discloses nothing, and the ORDER inside the RPC is why. ** A
    // guessed or dead token fails `ride_invite_link_reachable_by` first and
    // gets the single `42501`; this arm is reachable only for a LIVE token on
    // a ride the caller organizes, which is a rider being told something they
    // already know about their own ride. The participation gate used to raise
    // `23514` here too and no longer can — `091` moved it into
    // `reachable_by`, one call earlier — so this SQLSTATE now has exactly one
    // meaning.
    if (error.code === '23514') {
      return { error: 'This is your own ride — share the link rather than opening it.' }
    }
    // ONE message for everything else, because the RPC has one raise site:
    // expired, revoked, deleted, departed, blocked in either direction,
    // un-onboarded and simply guessed are all indistinguishable by design.
    //
    // ** There was a `23514` arm here and `091` made it unreachable, which is
    // why it is gone rather than kept as a second line. ** The draft caught the
    // participation gate raising from `private.join_ride_from_invite` and said
    // "Finish setting up your profile first." — a fact about the CALLER rather
    // than about the token, and the one distinction the spec allowed. Then the
    // review pass moved the gate INTO `private.ride_invite_link_reachable_by`,
    // where it had to go so the *preview* was gated too, and the caller now
    // fails one call earlier with the single `42501`. `join_ride_from_invite`
    // still restates the gate and the suite still pins that, but nothing can
    // reach it un-onboarded, so the branch would have been dead code reading as
    // live cover.
    //
    // What replaces it is the guard, which is the stronger half anyway:
    // `/rides/join` is in `needsOnboardingState`, so a rider mid-wizard is sent
    // to their resume step and never taps this at all.
    return { error: 'This invite link is no longer valid.' }
  }

  const rideId = typeof data === 'string' ? data : null
  // The RPC returns the ride id and raises otherwise, so this is unreachable —
  // but the rider IS on the ride at this point, and sending them nowhere with a
  // success message would be worse than the generic refusal.
  if (!rideId) return { error: 'This invite link is no longer valid.' }

  invalidate(queryKeys.rides.all())
  invalidate(queryKeys.invites.all())
  return { error: null, claim: { ride_id: rideId } }
}
