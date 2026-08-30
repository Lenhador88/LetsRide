import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidateClubMembership } from '@/lib/actions/clubs'
import { clubIdSchema } from '@/lib/validation/clubs'
import { profileIdSchema } from '@/lib/validation/profile'
import type { ActionState } from '@/lib/actions/state'

/**
 * The three writes behind Manage riders — `088`, PD-326.
 *
 * ## All three are RPCs, and that is the contract rather than a convenience
 *
 * `club_members` has **no UPDATE policy at all** — the absence `036` §7.6
 * relies on for *"nobody can promote an admin"* — and its DELETE policy is
 * `auth.uid() = user_id`, which says you may remove only yourself. So none of
 * these three is expressible as a client statement, whatever it sends.
 *
 * The alternative was a policy, and `088`'s header prices it: RLS cannot see
 * WHICH column an UPDATE changed, so the same policy that permits a promotion
 * permits rewriting `club_id` and `user_id` — the three columns `048` grants
 * together.
 *
 * ## Nothing here checks who may act
 *
 * Each RPC re-checks `private.is_club_admin_for` and the target's own role in
 * its own body, where it is load-bearing because a `security definer` function
 * bypasses RLS. A copy of that rule here would be a second place for it to
 * drift, and a weaker one — it would run in the browser, under a publishable
 * key that ships in the bundle.
 *
 * `ClubDetail.viewer_role` decides what the SCREEN draws and nothing else; its
 * own docstring says so. These functions do not consult it.
 *
 * ## One error string per action, and it never says which rule refused
 *
 * Every RPC has ONE raise site, so "no such club", "not your club", "that
 * rider is not in it" and "that rider is an admin and you are not the owner"
 * are the same `42501`. Reporting them apart here would reconstruct in the
 * browser exactly the distinction the database refuses to make.
 */

/**
 * An owner or admin removes one rider. Only the owner may remove an admin, and
 * nobody removes the club's owner or themselves — leaving is `leaveClub`.
 */
export async function removeClubMember(clubId: string, riderId: string): Promise<ActionState> {
  if (!clubIdSchema.safeParse(clubId).success || !profileIdSchema.safeParse(riderId).success) {
    return { error: 'That rider could not be removed.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('remove_club_member', {
    target_club: clubId,
    target_rider: riderId,
  })
  if (error) return { error: 'That rider could not be removed.' }

  invalidateClubMembership(clubId)
  return { error: null }
}

/**
 * An owner or admin promotes one member to admin.
 *
 * **The target must currently be a `member`**, which the RPC enforces — so a
 * second tap on a rider who is already an admin is refused rather than a
 * no-op, and the screen must not offer the control for one.
 */
export async function promoteClubMember(clubId: string, riderId: string): Promise<ActionState> {
  if (!clubIdSchema.safeParse(clubId).success || !profileIdSchema.safeParse(riderId).success) {
    return { error: 'That rider could not be promoted.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('promote_club_member', {
    target_club: clubId,
    target_rider: riderId,
  })
  if (error) return { error: 'That rider could not be promoted.' }

  invalidateClubMembership(clubId)
  return { error: null }
}

/**
 * The owner takes admin away, or an admin steps down themselves.
 *
 * **No admin demotes a peer.** Removal is a superset of demotion, so an admin
 * who could demote could remove in two steps and `removeClubMember`'s refusal
 * would be decorative — `088`'s header has the whole argument.
 */
export async function demoteClubAdmin(clubId: string, riderId: string): Promise<ActionState> {
  if (!clubIdSchema.safeParse(clubId).success || !profileIdSchema.safeParse(riderId).success) {
    return { error: 'That admin could not be changed.' }
  }

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('demote_club_admin', {
    target_club: clubId,
    target_rider: riderId,
  })
  if (error) return { error: 'That admin could not be changed.' }

  invalidateClubMembership(clubId)
  return { error: null }
}
