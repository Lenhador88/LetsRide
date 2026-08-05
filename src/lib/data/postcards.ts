import { createClient } from '@/lib/supabase/server'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { resolveAvatarUrls, signImagePaths } from '@/lib/data/media'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import type { Postcard, FeedPage, PostcardFilterOption, PostcardFilters } from '@/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Which slice of the feed the home screen is showing. */
export type FeedFilter = { kind: 'rider' | 'club'; id: string }

type FilterRow = {
  image_path: string
  author: { id: string; username: string | null; avatar_url: string | null } | null
  club: { id: string; name: string; avatar_url: string | null } | null
}

// The raw shape PostgREST returns before the like state is folded in:
// `likes_count` arrives as the one-row aggregate array Supabase's `(count)`
// embed always produces, and `is_liked` does not exist yet.
type PostcardRow = Omit<Postcard, 'likes_count' | 'comments_count' | 'is_liked' | 'is_own'> & {
  likes_count: { count: number }[] | null
  comments_count: { count: number }[] | null
}

/**
 * Provisional. The design decides whether the feed pages or infinite-scrolls
 * and how many cards a screen shows, and the Figma file is currently
 * unreadable — see docs/FIGMA-FIDELITY-TODO.md. What is NOT provisional is
 * that the query is bounded at all: unbounded, the home screen selects every
 * postcard the viewer can see, on every render, forever.
 */
export const FEED_PAGE_SIZE = 30

const POSTCARD_SELECT = `
  *,
  author:profiles!author_id(${PUBLIC_PROFILE_COLUMNS}),
  club:clubs(id, name, avatar_url),
  likes_count:postcard_likes(count),
  comments_count:postcard_comments(count)
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
    const ownLikes = unwrapList(
      await supabase
        .from('postcard_likes')
        .select('postcard_id')
        .eq('user_id', viewerId)
        .in('postcard_id', rows.map((row) => row.id)),
      'your likes',
    )
    ownLikes.forEach((like) => likedIds.add(like.postcard_id))
  }

  // Signed on the way out rather than at the call site: the `media` bucket is
  // private, so a postcard without `image_url` renders nothing at all. Doing it
  // here means a future screen cannot forget, and one batched request covers
  // the whole page.
  const imageUrls = await signImagePaths(rows.map((row) => row.image_path), supabase)

  // The byline avatar, signed alongside the photos. A separate pass rather than
  // one merged batch because the two are different Storage folders with
  // different SELECT policies — a postcard you may see does not imply its
  // author's avatar is readable (they may have blocked you since), and 014's
  // policy is what decides.
  await resolveAvatarUrls(rows.map((row) => row.author), supabase)

  return rows.map((row) => ({
    ...row,
    // Both counts arrive as the one-row aggregate array Supabase's `(count)`
    // embed always produces, and both are counted under RLS — so a blocked
    // rider's like or comment never counts for the rider who blocked them.
    likes_count: row.likes_count?.[0]?.count ?? 0,
    comments_count: row.comments_count?.[0]?.count ?? 0,
    is_liked: likedIds.has(row.id),
    // Which overflow menu the card shows. Computed here rather than passed down
    // as a viewer id, because the deck is a client component two levels below
    // the only place the session is known — and because it is the same shape as
    // `is_liked`: a per-viewer answer the card renders rather than derives.
    //
    // It decides presentation only. `deletePostcard` is authorized by 009's
    // DELETE policy, so a forged `is_own` changes which rows are drawn and not
    // which rows can be destroyed.
    is_own: !!viewerId && row.author_id === viewerId,
    image_url: imageUrls.get(row.image_path) ?? null,
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
export async function getFeed(
  { before, limit = FEED_PAGE_SIZE }: FeedPage = {},
  filter?: FeedFilter
): Promise<Postcard[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let query = supabase
    .from('postcards')
    .select(POSTCARD_SELECT)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) query = query.lt('created_at', before)

  // Narrowing *within* what the policy already allows. Neither of these restates
  // the audience rule — a rider filter still cannot surface a club postcard the
  // viewer is not a member of, because the policy runs first either way.
  if (filter?.kind === 'rider') query = query.eq('author_id', filter.id)
  if (filter?.kind === 'club') query = query.eq('club_id', filter.id)

  const rows = unwrapList(await query, 'the postcard feed')
  return attachLikeState(supabase, rows as PostcardRow[], user?.id)
}

/**
 * The riders and clubs behind the current feed window, for the filter bar.
 *
 * Derived from the same bounded window the feed itself reads rather than from
 * separate `profiles` / `clubs` queries. Two reasons: the filter bar must never
 * offer a filter that yields an empty deck, and going through `postcards` means
 * one policy decides what appears here and what appears in the deck. Asking
 * `clubs` directly would be a second visibility predicate to keep in step.
 */
export async function getPostcardFilters(limit = FEED_PAGE_SIZE): Promise<PostcardFilters> {
  const supabase = await createClient()

  const rows = unwrapList(
    await supabase
      .from('postcards')
      .select(
        `image_path, author:profiles!author_id(id, username, avatar_url, avatar_path), club:clubs(id, name, avatar_url)`
      )
      .order('created_at', { ascending: false })
      .limit(limit),
    'your postcard filters',
  ) as unknown as FilterRow[]

  // The filter bar draws a rider's face on their tile, so it needs the same
  // signing pass the deck gets. Missed on the first pass, which would have left
  // every tile showing initials the moment avatars started being uploaded.
  await resolveAvatarUrls(rows.map((row) => row.author), supabase)

  const riders = new Map<string, PostcardFilterOption>()
  const clubs = new Map<string, PostcardFilterOption>()

  for (const row of rows) {
    if (row.author) {
      const existing = riders.get(row.author.id)
      if (existing) existing.count += 1
      else
        riders.set(row.author.id, {
          kind: 'rider',
          id: row.author.id,
          name: row.author.username ?? 'Rider',
          imageUrl: row.author.avatar_url,
          count: 1,
        })
    }
    // A null club is the app-wide feed, not an unnamed club — it has no tile.
    if (row.club) {
      const existing = clubs.get(row.club.id)
      if (existing) existing.count += 1
      else
        clubs.set(row.club.id, {
          kind: 'club',
          id: row.club.id,
          name: row.club.name,
          imageUrl: row.club.avatar_url,
          count: 1,
        })
    }
  }

  const collagePaths = rows.slice(0, 4).map((row) => row.image_path)
  const signed = await signImagePaths(collagePaths, supabase)

  return {
    total: rows.length,
    collage: collagePaths.map((path) => signed.get(path)).filter((url): url is string => !!url),
    riders: [...riders.values()],
    clubs: [...clubs.values()],
  }
}

/** The same feed, scoped to one club. RLS still decides whether the viewer
 * may see club-scoped rows at all; `club_id` here just picks which club. */
export async function getClubFeed(
  clubId: string,
  { before, limit = FEED_PAGE_SIZE }: FeedPage = {}
): Promise<Postcard[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let query = supabase
    .from('postcards')
    .select(POSTCARD_SELECT)
    .eq('club_id', clubId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) query = query.lt('created_at', before)

  const rows = unwrapList(await query, "this club's postcards")
  return attachLikeState(supabase, rows as PostcardRow[], user?.id)
}

export async function getPostcard(id: string): Promise<Postcard | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // maybeSingle, not single: `single()` treats "no row" as an error, which
  // would now throw for a postcard the viewer simply may not see. Not found and
  // could-not-ask stay distinct.
  const data = unwrap(
    await supabase.from('postcards').select(POSTCARD_SELECT).eq('id', id).maybeSingle(),
    'that postcard',
  )

  if (!data) return null

  const [postcard] = await attachLikeState(supabase, [data as PostcardRow], user?.id)
  return postcard
}
