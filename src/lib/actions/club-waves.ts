import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { ActionState } from '@/lib/actions/state'

/**
 * `on conflict do nothing` via `ignoreDuplicates`, not a plain upsert —
 * `092` grants no UPDATE on either wave table (`club-timeline-engagement`'s
 * "No UPDATE policy and no UPDATE grant on either"), so the default `on
 * conflict do update` resolution would fail `42501`. A duplicate wave is a
 * no-op by the composite PK, so ignoring the conflict is correct — the same
 * reasoning `likePostcard` carries for `postcard_likes`.
 *
 * `092`'s WITH CHECK additionally refuses `subject_user_id = user_id` — a
 * self-welcome — so a rider attempting to wave their own join is refused by
 * the database. The affordance is never drawn on a rider's own row
 * (`ClubTimelineEventRow`), so this refusal is not the first the rider hears
 * of it; this action does not restate the check.
 *
 * Only the club's own wave key is invalidated — `client-cache-invalidation`'s
 * "SHALL NOT invalidate `clubs.detail(clubId).joins`", whose rows have not
 * changed.
 *
 * **Nor `notifications.list()` / `notifications.unread()`.** The row
 * `private.notify_club_waved` fans out is addressed to the rider whose join
 * was waved, not the waver whose client runs this invalidation — so there is
 * nothing of the waver's own to refetch, and no mechanism in this hand-rolled
 * cache to reach the recipient's. Their badge is stale until their own next
 * navigation; `unwaveJoin` below carries the identical absence for the
 * retraction.
 */
export async function waveJoin(clubId: string, subjectUserId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to wave.' }

  const { error } = await supabase
    .from('club_join_waves')
    .upsert(
      { club_id: clubId, subject_user_id: subjectUserId, user_id: user.id },
      { onConflict: 'club_id,subject_user_id,user_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not wave hello. Try again.' }

  invalidate(queryKeys.clubs.joinWaves(clubId))
  return { error: null }
}

/**
 * No `.eq('user_id', ...)` — the DELETE policy is already `user_id =
 * auth.uid()`, and restating it here would be the re-filtering trap
 * `unlikePostcard` avoids for the identical reason: a second copy of a rule
 * RLS already owns, free to drift from the policy silently. The two `.eq`s
 * below are the wave's own composite key, not an ownership predicate.
 */
export async function unwaveJoin(clubId: string, subjectUserId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase
    .from('club_join_waves')
    .delete()
    .eq('club_id', clubId)
    .eq('subject_user_id', subjectUserId)

  if (error) return { error: 'Could not remove your wave. Try again.' }

  invalidate(queryKeys.clubs.joinWaves(clubId))
  return { error: null }
}
