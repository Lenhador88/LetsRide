import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { reportPostcardSchema } from '@/lib/validation/comments'
import type { ActionState } from '@/lib/actions/state'

/**
 * Hiding and reporting are separate rights on purpose — 011 keeps them in
 * separate tables for the same reason. A rider may want one, the other, or
 * both, and an action that quietly does both takes that choice away. If a
 * screen wants "report and hide" as one tap, it calls both.
 */

/**
 * Per-viewer and one-directional: this only ever removes the postcard from
 * *your* feed. That is the whole difference from a block, which is symmetric
 * and needs a security definer helper to resolve a row the blocked party
 * cannot read.
 *
 * `ignoreDuplicates` for the same reason as likes and blocks: 011 grants no
 * UPDATE on `postcard_hides`, so the default `on conflict do update` would fail
 * 42501, and pressing Hide twice should be a no-op rather than an error.
 *
 * Hiding your own postcard is accepted and inert — 009 made the author branch
 * of the postcards SELECT policy unconditional so a rider never loses their own
 * photo, and 011 deliberately kept the hide predicate inside the *other*
 * branch. Delete is the affordance for not wanting your own post.
 */
export async function hidePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase
    .from('postcard_hides')
    .upsert(
      { postcard_id: postcardId, user_id: user.id },
      { onConflict: 'postcard_id,user_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not hide that postcard. Try again.' }

  invalidate(queryKeys.postcards.all())
  return { error: null }
}

/**
 * No `.eq('user_id', ...)` — 011's DELETE policy already scopes this to the
 * caller's own hide. Unhiding restores the postcard along with its likes,
 * comments and image in one go, because all of those delegate to the postcards
 * SELECT policy this predicate lives in. Nothing was ever deleted.
 */
export async function unhidePostcard(postcardId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { error } = await supabase.from('postcard_hides').delete().eq('postcard_id', postcardId)

  if (error) return { error: 'Could not unhide that postcard. Try again.' }

  invalidate(queryKeys.postcards.all())
  return { error: null }
}

/**
 * **A report currently goes nowhere anyone can read.** 011 grants SELECT only
 * to the reporter, because this project has no admin role and no moderator
 * claim to key a policy on. The table exists because a Report button that
 * writes nothing is worse, and because the moderator path is additive later —
 * but nobody should believe a filed report gets triaged today. The KNOWN GAP
 * at the top of migration 011 says the same thing.
 *
 * A duplicate report is a no-op, not an error: `unique (reporter_id,
 * postcard_id)` is the anti-brigading mechanism, and telling a rider "you
 * already reported this" is friendlier than a constraint violation — and it
 * does not leak anything, since they can read their own reports anyway.
 */
export async function reportPostcard(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = reportPostcardSchema.safeParse({
    postcardId: formData.get('postcardId'),
    reason: formData.get('reason'),
    note: formData.get('note'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { postcardId, reason, note } = parsed.data

  const { error } = await supabase
    .from('postcard_reports')
    .upsert(
      { reporter_id: user.id, postcard_id: postcardId, reason, note },
      { onConflict: 'reporter_id,postcard_id', ignoreDuplicates: true }
    )

  if (error) return { error: 'Could not send that report. Try again.' }

  return { error: null }
}
