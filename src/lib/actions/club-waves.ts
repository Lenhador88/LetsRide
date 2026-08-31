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
 * Only the club's own wave key is invalidated — `client-cache-invalidation`'s
 * "SHALL NOT invalidate `clubs.detail(clubId).threads`", whose rows have not
 * changed, and SHALL NOT invalidate the unread map, a different fact about
 * the same thread.
 */
export async function waveThread(clubId: string, threadId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to wave.' }

  const { error } = await supabase
    .from('club_thread_waves')
    .upsert(
      { thread_id: threadId, user_id: user.id },
      { onConflict: 'thread_id,user_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not wave at that. Try again.' }

  invalidate(queryKeys.clubs.threadWaves(clubId))
  return { error: null }
}

/**
 * No `.eq('user_id', ...)` — the DELETE policy is already `user_id =
 * auth.uid()`, and restating it here would be the re-filtering trap
 * `unlikePostcard` avoids for the identical reason: a second copy of a rule
 * RLS already owns, free to drift from the policy silently.
 */
export async function unwaveThread(clubId: string, threadId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase.from('club_thread_waves').delete().eq('thread_id', threadId)

  if (error) return { error: 'Could not remove your wave. Try again.' }

  invalidate(queryKeys.clubs.threadWaves(clubId))
  return { error: null }
}

/**
 * `092`'s WITH CHECK additionally refuses `subject_user_id = user_id` — a
 * self-welcome — so a rider attempting to wave their own join is refused by
 * the database. The affordance is never drawn on a rider's own row
 * (`ClubTimelineEventRow`), so this refusal is not the first the rider hears
 * of it; this action does not restate the check.
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
