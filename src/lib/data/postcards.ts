import { createClient } from '@/lib/supabase/server'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import type { Postcard } from '@/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// The raw shape PostgREST returns before the like state is folded in:
// `likes_count` arrives as the one-row aggregate array Supabase's `(count)`
// embed always produces, and `is_liked` does not exist yet.
type PostcardRow = Omit<Postcard, 'likes_count' | 'is_liked'> & {
  likes_count: { count: number }[] | null
}

const POSTCARD_SELECT = `
  *,
  author:profiles!author_id(${PUBLIC_PROFILE_COLUMNS}),
  club:clubs(id, name),
  likes_count:postcard_likes(count)
`

/**
 * Folds two per-viewer things into a page of postcards: the like count (an
 * aggregate over whatever `postcard_likes` rows RLS lets this viewer see, so a
 * blocked rider's like never counts for the rider who blocked them — see 009
 * §4) and `is_liked` (did *this* viewer like it). The count is read straight
 * off the embed; `is_liked` needs its own query because the embed answers "who
 * liked this that I can see", not "did I".
 *
 * That second query filters on `user_id`, which looks like the re-filtering
 * trap the brief warns against — it isn't. The postcard_likes SELECT policy
 * scopes *visibility* (your own rows, plus anyone else's you're not blocked
 * by); it does not scope to "mine only". Asking "which of these are mine" is
 * business logic the policy has no opinion on.
 */
async function attachLikeState(
  supabase: SupabaseServerClient,
  rows: PostcardRow[],
  viewerId: string | undefined
): Promise<Postcard[]> {
  const likedIds = new Set<string>()

  if (viewerId && rows.length > 0) {
    const { data: ownLikes } = await supabase
      .from('postcard_likes')
      .select('postcard_id')
      .eq('user_id', viewerId)
      .in('postcard_id', rows.map((row) => row.id))
    ownLikes?.forEach((like) => likedIds.add(like.postcard_id))
  }

  return rows.map((row) => ({
    ...row,
    likes_count: row.likes_count?.[0]?.count ?? 0,
    is_liked: likedIds.has(row.id),
  }))
}

/**
 * The app-wide feed, newest first. Deliberately has no `club_id` filter: the
 * postcards SELECT policy already unions "club_id is null" (the app-wide
 * feed) with "club_id the viewer belongs to" (their clubs' posts) with "authored
 * by the viewer" (even a club they've since left), so restating any of that
 * here would be the exact drift trap 009 warns about — a second copy of a
 * predicate that can silently disagree with the policy it duplicates.
 */
export async function getFeed(): Promise<Postcard[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data } = await supabase
    .from('postcards')
    .select(POSTCARD_SELECT)
    .order('created_at', { ascending: false })

  return attachLikeState(supabase, (data ?? []) as PostcardRow[], user?.id)
}

/** The same feed, scoped to one club. RLS still decides whether the viewer
 * may see club-scoped rows at all; `club_id` here just picks which club. */
export async function getClubFeed(clubId: string): Promise<Postcard[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data } = await supabase
    .from('postcards')
    .select(POSTCARD_SELECT)
    .eq('club_id', clubId)
    .order('created_at', { ascending: false })

  return attachLikeState(supabase, (data ?? []) as PostcardRow[], user?.id)
}

export async function getPostcard(id: string): Promise<Postcard | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data } = await supabase
    .from('postcards')
    .select(POSTCARD_SELECT)
    .eq('id', id)
    .single()

  if (!data) return null

  const [postcard] = await attachLikeState(supabase, [data as PostcardRow], user?.id)
  return postcard
}
