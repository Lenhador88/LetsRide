'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { commentBodySchema } from '@/lib/validation/comments'
import type { ActionState } from '@/lib/actions/state'

/**
 * A comment moves the per-viewer count on the feed as well as the thread, so
 * both paths are revalidated. `/postcards/[id]` has no route yet; revalidating
 * a path with no matching route is a harmless no-op and saves the next person
 * remembering to add it.
 */
function revalidateThread(postcardId: string) {
  revalidatePath('/postcards')
  revalidatePath(`/postcards/${postcardId}`)
}

/**
 * There is no `club_id` check and no block check here, deliberately. 011's
 * INSERT policy delegates "can I comment on this" to the postcards SELECT
 * policy via EXISTS, so a rider who cannot see the postcard — wrong club,
 * blocked, or they hid it — is refused by the database. Restating any of that
 * would be a second copy of a rule RLS owns, free to drift from it silently.
 */
export async function addComment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const postcardId = formData.get('postcardId')
  if (typeof postcardId !== 'string' || !postcardId) {
    return { error: 'That postcard could not be found.' }
  }

  const parsed = commentBodySchema.safeParse(formData.get('body') ?? '')
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to comment.' }

  const { error } = await supabase
    .from('postcard_comments')
    .insert({ postcard_id: postcardId, author_id: user.id, body: parsed.data })

  // A refusal here is usually RLS deciding the postcard is not visible, which
  // from the rider's side looks like the postcard being gone rather than a
  // permission problem — so the message says that rather than accusing them.
  if (error) return { error: 'Could not post that comment. The postcard may no longer be available.' }

  revalidateThread(postcardId)
  return { error: null }
}

/**
 * Two rights, one action: your own comment, or any comment on a postcard you
 * authored. 011's DELETE policy owns that distinction, so nothing here filters
 * on `author_id`.
 *
 * `.select()` is what makes a refusal detectable — PostgREST reports no error
 * when a delete matches nothing, so without it a rider deleting someone else's
 * comment would be told it worked. This is the same trap the data agent found
 * in the RLS suite itself, where `assert_allowed` on a DELETE passes against
 * zero rows.
 *
 * The postcard id is read first because it is needed to revalidate and is gone
 * once the row is.
 */
export async function deleteComment(commentId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { data: existing } = await supabase
    .from('postcard_comments')
    .select('postcard_id')
    .eq('id', commentId)
    .maybeSingle()

  const { data: deleted, error } = await supabase
    .from('postcard_comments')
    .delete()
    .eq('id', commentId)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not delete that comment. Try again.' }
  if (!deleted) return { error: 'That comment is not yours to delete.' }

  if (existing?.postcard_id) revalidateThread(existing.postcard_id)
  return { error: null }
}
