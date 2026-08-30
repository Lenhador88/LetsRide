import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { invalidateClubMembership } from '@/lib/actions/clubs'
import { clubIdSchema, clubJoinRequestIdSchema } from '@/lib/validation/clubs'
import type { ActionState } from '@/lib/actions/state'

/**
 * The writes behind club join requests — `085`, PD-325.
 *
 * ## Two of the four are RPCs, and that is the contract rather than a
 * convenience
 *
 * Approving has to write a `club_members` row, delete the request and write a
 * notification as ONE statement: `club_members`' own INSERT policy admits only
 * a public or self-owned club, so an approver simply cannot insert that row
 * from the client, and even if they could, three client round trips tear —
 * leaving a member with a live request, or a deleted request with no member,
 * and nothing to repair either.
 *
 * `authenticated` holds no UPDATE grant on `club_join_requests` and the table
 * has no UPDATE policy, so `decline_club_join_request` is the only writer of
 * `status` in the system. A client `.update()` is refused whatever it sends.
 *
 * ## Nothing here checks who may answer
 *
 * The two RPCs re-check `private.is_club_admin_for` in their own bodies, where
 * it is load-bearing because a `security definer` function bypasses RLS. A copy
 * of that check here would be a second place for the rule to drift, and a
 * weaker one — it would run in the browser.
 */

/**
 * A rider asks to join a private club.
 *
 * **`23505` is "already asked", not an error**, and it covers both statuses.
 * The unique `(club_id, user_id)` is what makes a refusal stick and what makes
 * a repeat ask a no-op rather than a way to ring a club's admins twice, so
 * hitting it means the card offered a control it should not have — a race, or a
 * refusal answered on another device — and the rider's intent is either already
 * recorded or already answered.
 */
export async function requestToJoinClub(clubId: string): Promise<ActionState> {
  if (!clubIdSchema.safeParse(clubId).success) {
    return { error: 'That club could not be found.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to ask to join a club.' }

  const { error } = await supabase
    .from('club_join_requests')
    // From the session, never an argument: the policy pins it to `auth.uid()`
    // anyway, and a parameter is something a caller can get wrong.
    .insert({ club_id: clubId, user_id: user.id })

  if (error && error.code !== '23505') return { error: 'That request could not be sent.' }

  invalidateJoinRequests(clubId)
  return { error: null }
}

/**
 * A rider withdraws their own PENDING ask.
 *
 * **No `.select()` is chained onto the delete, and that is not style.**
 * `RETURNING` re-attaches the SELECT policy, which is the mechanism that makes
 * a delete match zero rows and still report success — `add-club-threads` 7.4b's
 * measured finding. Here it would also hide the one case this function must not
 * lie about: `085`'s DELETE arm for the requester is scoped to `status =
 * 'pending'`, so a DECLINED row matches nothing and a rider clearing their own
 * refusal is silently a no-op. The refusal is the club's to clear.
 */
export async function withdrawJoinRequest(clubId: string): Promise<ActionState> {
  if (!clubIdSchema.safeParse(clubId).success) {
    return { error: 'That request could not be withdrawn.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase
    .from('club_join_requests')
    .delete()
    .eq('club_id', clubId)
    .eq('user_id', user.id)

  if (error) return { error: 'That request could not be withdrawn.' }

  invalidateJoinRequests(clubId)
  return { error: null }
}

/**
 * An owner or admin approves one request — `public.approve_club_join_request`.
 *
 * Takes the REQUEST id and never a rider's, matching the RPC. The RPC has one
 * raise site, so an ordinary member, the requester themselves, a foreign club's
 * owner and a nonexistent id all come back the same way — which is the point,
 * and why this function does not try to say which.
 */
export async function approveClubJoinRequest(
  requestId: string,
  clubId: string
): Promise<ActionState> {
  if (!clubJoinRequestIdSchema.safeParse(requestId).success) {
    return { error: 'That request could not be approved.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('approve_club_join_request', { request: requestId })
  if (error) return { error: 'That request could not be approved.' }

  // The whole `clubs` prefix rather than an enumeration of keys: an approval
  // adds a member, so the roster, the member count, both club lists and
  // `clubs.mine()` — the picker on the create-ride and create-postcard forms —
  // all move. `joinClub` claims the same breadth for the same recorded reason.
  invalidateClubMembership(clubId)
  invalidateJoinRequests(clubId)
  return { error: null }
}

/** An owner or admin declines one request — `public.decline_club_join_request`.
 *
 * Writes no membership row and NO notification: `036` §3's SELECT policy
 * conjuncts the club's readability under the READER's own RLS, so a decline
 * notification would be written and never returned to the very rider it
 * addresses. The requester learns the answer from their own request row, which
 * the club's reduced screen renders — so this invalidates that read and no
 * membership key. */
export async function declineClubJoinRequest(
  requestId: string,
  clubId: string
): Promise<ActionState> {
  if (!clubJoinRequestIdSchema.safeParse(requestId).success) {
    return { error: 'That request could not be declined.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('decline_club_join_request', { request: requestId })
  if (error) return { error: 'That request could not be declined.' }

  invalidateJoinRequests(clubId)
  return { error: null }
}

/**
 * An owner or admin CLEARS a declined request — the "you may ask again"
 * affordance, deliberately in the club's hands (`085`, and its surface is
 * `088`'s Manage riders screen).
 *
 * **A plain DELETE and not an RPC**, unlike the two answers above, because
 * `085`'s DELETE policy already admits exactly this: its admin arm is scoped
 * to the club rather than to a status, so an admin may delete a row of either
 * status while the requester's own arm is scoped to `pending`. There is no
 * authority for an RPC to re-check that the policy is not already checking.
 *
 * **No `.select()` chained on**, for the reason `withdrawJoinRequest` records:
 * `RETURNING` re-attaches the SELECT policy, which is how a delete matches
 * zero rows and still reports success.
 *
 * Deleting the row also fires `089`'s retraction, which takes the requester's
 * own "declined" notification away at the same moment they become able to ask
 * again — a rider who may ask again must not still be holding the "no".
 */
export async function clearClubJoinRequest(
  requestId: string,
  clubId: string
): Promise<ActionState> {
  if (!clubJoinRequestIdSchema.safeParse(requestId).success) {
    return { error: 'That request could not be cleared.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.from('club_join_requests').delete().eq('id', requestId)
  if (error) return { error: 'That request could not be cleared.' }

  invalidateJoinRequests(clubId)
  return { error: null }
}

/**
 * What a request write makes stale: the club's own pending list, the reduced
 * screen's copy of the viewer's status, and Explore — whose cards carry
 * `request_status` and would otherwise keep offering `Request to join` to a
 * rider who has just asked.
 */
function invalidateJoinRequests(clubId: string) {
  invalidate(queryKeys.clubs.joinRequests(clubId))
  invalidate(queryKeys.clubs.declinedRequests(clubId))
  invalidate(queryKeys.clubs.preview(clubId))
  // **The whole `clubs` prefix rather than `clubs.explore(...)`.** That key
  // carries the rider's rounded position as a segment, so there is no argument
  // this function could pass that reaches the entry the screen actually filled
  // — `explore()` with no argument builds the `unlocated` variant and would
  // invalidate a list nobody is looking at, silently, leaving Explore offering
  // `Request to join` to a rider who has just asked.
  invalidate(queryKeys.clubs.all())
}
