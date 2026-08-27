import { resolveSupabase } from '@/lib/supabase/resolve'
import { decorateChat } from '@/lib/data/chat'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import { clubDiscussionIdSchema, clubIdSchema } from '@/lib/validation/clubs'
import type {
  ClubChatMessage,
  ClubDiscussion,
  ClubDiscussionCursor,
  ClubDiscussionListItem,
  ClubMessage,
} from '@/types'

/**
 * How many threads one page of the Discussions list reads.
 *
 * Bounded and keyset-paged rather than truncated, unlike the ride chat's window:
 * a thread list grows for the life of a club and its oldest rows are still worth
 * reaching, so `(created_at, id)` carries a cursor. 20 fills a 390px screen with
 * room to scroll.
 */
export const CLUB_DISCUSSIONS_PAGE_SIZE = 20

/**
 * How much of one thread the screen reads — `RIDE_MESSAGES_PAGE_SIZE`'s number
 * and its whole argument, including that this is the **newest** N rather than
 * the oldest. See the two-`order` dance below.
 */
export const CLUB_MESSAGES_PAGE_SIZE = 200

const DISCUSSION_SELECT = `
  id, club_id, author_id, title, created_at,
  author:profiles!author_id(id, username)
`

/**
 * One page of a club's discussion threads, newest created first.
 *
 * ## What is deliberately NOT here
 *
 * No membership check, no club-visibility predicate, no block filter. `081`'s
 * SELECT policy owns all three — the `clubs` EXISTS, `private.is_club_member`
 * and the symmetric `private.is_blocked` arm on `author_id` — so "which threads
 * may this rider see" is answered by the time rows come back. Restating any of
 * it here would be a second copy of a policy, free to drift, and the copy that
 * drifts is always the one nobody reads.
 *
 * **The audience is narrower than the club's own**, which is the whole point of
 * `081` and the one thing to hold while reading this file: a public club admits
 * every signed-in rider to its *detail screen* and none of them to its threads.
 * So a non-member of a public club gets `[]` here, indistinguishable from a club
 * nobody has posted in — the screens tell those apart with the club's own
 * `viewer_role`, which `getClub` already carries, exactly as the ride chat uses
 * `is_crew`. That is a UX affordance and never the enforcement.
 *
 * `created_at DESC, id DESC` matches `081`'s index and is a total order; a
 * cursor over `created_at` alone would skip or repeat rows exactly at the
 * boundary where two threads share one `now()`.
 */
export async function getClubDiscussions(
  clubId: string,
  cursor?: ClubDiscussionCursor,
  limit = CLUB_DISCUSSIONS_PAGE_SIZE
): Promise<ClubDiscussionListItem[] | null> {
  // Same guard, same reason as `getClub`: a non-uuid segment reaches
  // `.eq('club_id', …)` as `22P02`, PostgREST turns it into a 400 and
  // `unwrapList` throws — so a hand-edited URL would land on the error boundary
  // offering "Try again" on an address that can never succeed. `null` routes it
  // through the same `notFound()` a club nobody may see gets.
  if (!clubIdSchema.safeParse(clubId).success) return null

  const supabase = await resolveSupabase()

  let query = supabase
    .from('club_discussions')
    .select(DISCUSSION_SELECT)
    .eq('club_id', clubId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    )
  }

  return unwrapList(await query, "this club's discussions") as unknown as ClubDiscussionListItem[]
}

/**
 * One thread, or `null` for one that does not exist **or** that this rider may
 * not see — deliberately indistinguishable, the same refusal `getClub` makes.
 *
 * The thread screen needs `club_id` from this rather than from the URL: the
 * route names the discussion, and the club is what `Back`, the watermark's cache
 * key and the moderation affordance are all built from.
 */
export async function getClubDiscussion(id: string): Promise<ClubDiscussion | null> {
  if (!clubDiscussionIdSchema.safeParse(id).success) return null

  const supabase = await resolveSupabase()

  return unwrap(
    await supabase
      .from('club_discussions')
      .select('id, club_id, author_id, title, created_at')
      // `maybeSingle`, not `single`: RLS answers a thread this rider may not
      // read with zero rows, and `single` turns that into a PostgREST error
      // (`PGRST116`) which `unwrap` would throw — an error screen where the rest
      // of the app renders not-found.
      .eq('id', id)
      .maybeSingle(),
    'this discussion'
  ) as ClubDiscussion | null
}

/**
 * One thread's messages, oldest first, as the screen renders them.
 *
 * `getRideMessages`' shape exactly, including the two-`order` dance: PostgREST
 * applies `limit` after `order`, so reading the *newest* 200 means ordering
 * descending and rendering them means ascending. The reverse happens here rather
 * than in the component because the grouping walks the list in render order.
 *
 * `username` only on the embed — no `avatar_path`, because the design draws no
 * avatar on a bubble and signing one would be a round trip per distinct author
 * on a screen that refetches on every arrival.
 *
 * **A blocked pair both writing in one thread is a designed state, not a gap.**
 * `081` carries no block arm in either WITH CHECK, so both inserts succeed and
 * each rider's SELECT hides the other's row. The screen must not present the
 * resulting one-sided conversation as an error.
 */
export async function getClubDiscussionMessages(
  discussionId: string
): Promise<ClubChatMessage[] | null> {
  if (!clubDiscussionIdSchema.safeParse(discussionId).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const rows = unwrapList(
    await supabase
      .from('club_messages')
      .select(`id, discussion_id, author_id, body, created_at, author:profiles!author_id(id, username)`)
      .eq('discussion_id', discussionId)
      // Both columns, matching `081`'s index. `created_at` alone is not a total
      // order — two messages written in one transaction carry an identical
      // `now()` and the same thread renders differently on two devices.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CLUB_MESSAGES_PAGE_SIZE),
    'this discussion'
  ) as unknown as ClubMessage[]

  rows.reverse()

  return decorateChat(rows, user?.id)
}

/**
 * Which of a club's threads hold a message this rider has not read (`081`).
 *
 * One RPC for the whole list, answering `(discussion_id, has_unread)`.
 * `club_discussion_unread` is `security invoker`, so `081`'s SELECT policies
 * decide what counts and blocks are honoured by the same policy the thread
 * obeys. **No block filter, no membership check and no visibility predicate
 * appear here**, for the reason `getClubDiscussions` gives at length.
 *
 * A failure resolves to "nothing is unread" rather than throwing, and that is a
 * product decision rather than defensive coding — `getRideChatUnread` rules the
 * same way. The marks decorate a list that works without them, so a failed
 * unread call must cost the decoration and nothing else: the list still renders,
 * unmarked. The reverse is what must never be drawn, and cannot be from here — a
 * mark can only ever appear beside a thread the list itself returned.
 */
export async function getClubDiscussionUnread(clubId: string): Promise<Record<string, boolean>> {
  if (!clubIdSchema.safeParse(clubId).success) return {}

  const supabase = await resolveSupabase()
  const { data, error } = await supabase.rpc('club_discussion_unread', { club: clubId })

  if (error || !data) return {}

  const rows = data as { discussion_id: string; has_unread: boolean }[]
  return Object.fromEntries(rows.map((row) => [row.discussion_id, row.has_unread]))
}
