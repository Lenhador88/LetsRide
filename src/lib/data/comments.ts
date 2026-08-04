import { createClient } from '@/lib/supabase/server'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { unwrapList } from '@/lib/data/unwrap'
import type { PostcardComment } from '@/types'

/**
 * One postcard's comments, oldest first — a photo's thread reads as a
 * conversation from the top, unlike the feed itself which is newest-first.
 * Matches the `(postcard_id, created_at)` index 011 adds for exactly this.
 *
 * No `club_id` or block filtering here, and that is the point: 011's SELECT
 * policy delegates a comment's visibility to its postcard via EXISTS, so
 * "which comments may this rider see" is already answered by the time rows come
 * back. Restating any of it would be the drift trap — a second copy of a
 * predicate that can silently disagree with the policy it duplicates.
 *
 * Unbounded on purpose, for now. A thread is bounded by a single postcard
 * rather than by the whole app, so the failure mode is one unusually popular
 * photo rather than the feed's "every row, every render". Worth a cursor when
 * a real thread gets long; not worth inventing a page size the design has not
 * been read for.
 */
export async function getPostcardComments(postcardId: string): Promise<PostcardComment[]> {
  const supabase = await createClient()

  const rows = unwrapList(
    await supabase
      .from('postcard_comments')
      .select(`*, author:profiles!author_id(${PUBLIC_PROFILE_COLUMNS})`)
      .eq('postcard_id', postcardId)
      .order('created_at', { ascending: true }),
    'the comments on this postcard',
  )

  return rows as PostcardComment[]
}
