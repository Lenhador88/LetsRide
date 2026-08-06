import { resolveSupabase } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { commentBodySchema } from '@/lib/validation/comments'
import type { ActionState } from '@/lib/actions/state'

/**
 * A comment moves the per-viewer count on the feed as well as the thread, so
 * both were revalidated by path and both are invalidated by key now.
 *
 * `postcards.all()` rather than `postcards.comments(id)`, which would be the
 * obvious narrow choice and would be wrong: the thread is only one of the two
 * things a comment changes. The other is the count the deck draws on every
 * card, which lives under `postcards.feed(filter)` — and the filter is the
 * screen's, not this action's, so there is no narrower key it could name. That
 * is precisely the case `keys.ts` widens for.
 *
 * **It takes no postcard id, and that closes a recorded gap** — see
 * `deleteComment` below.
 */
function invalidateThread() {
  invalidate(queryKeys.postcards.all())
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

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to comment.' }

  const { error } = await supabase
    .from('postcard_comments')
    .insert({ postcard_id: postcardId, author_id: user.id, body: parsed.data })

  // A refusal here is usually RLS deciding the postcard is not visible, which
  // from the rider's side looks like the postcard being gone rather than a
  // permission problem — so the message says that rather than accusing them.
  if (error) return { error: 'Could not post that comment. The postcard may no longer be available.' }

  invalidateThread()
  // `sent` is what lets the form tell "not submitted yet" from "submitted,
  // nothing to report" — both are `error: null` otherwise, so without it the
  // composer cannot know when to clear itself. This is the case state.ts
  // documents the flag for: an action that finishes without navigating.
  return { error: null, sent: true }
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
 * **The KNOWN GAP recorded here is closed, and by the cache move rather than by
 * the migration it was waiting on.** The gap was: the `select('postcard_id')`
 * below runs under the same RLS that hides the row on the `moderate_comment`
 * path, so for the one case that path exists for — an author removing a blocked
 * harasser's comment from their own photo — `existing` came back null and the
 * revalidation never fired. The delete succeeded and the screen did not update.
 * The recorded fix was to have `moderate_comment` return the postcard id
 * instead of a boolean, which is a migration.
 *
 * It is not needed. `revalidatePath` had to name a *path*, and the path
 * contains the postcard id; a cache key does not — `invalidateThread()` takes
 * no argument, so it fires on both branches unconditionally. The
 * `select('postcard_id')` this action used to open with is gone with it: it
 * existed only to build that path, and keeping a read whose one consumer left
 * is how a dead query survives a refactor.
 */
export async function deleteComment(commentId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  const { data: deleted, error } = await supabase
    .from('postcard_comments')
    .delete()
    .eq('id', commentId)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not delete that comment. Try again.' }

  if (!deleted) {
    // Not necessarily a refusal. RLS filters a DELETE by what the caller may
    // READ, and `.eq('id', …)` reads a column — so an author who blocked their
    // harasser matches zero rows against a comment sitting on their own photo.
    // 011 §1b exists for exactly that case; it is security definer and re-checks
    // `p.author_id = auth.uid()` itself, so this is not a weaker path, just one
    // that can see the row.
    const { data: moderated, error: rpcError } = await supabase.rpc('moderate_comment', {
      comment_id: commentId,
    })

    if (rpcError) return { error: 'Could not delete that comment. Try again.' }
    if (!moderated) return { error: 'That comment is not yours to delete.' }
  }

  // Unconditional, unlike the `revalidatePath` it replaces — see the note
  // above about the gap that closes.
  invalidateThread()
  return { error: null }
}
