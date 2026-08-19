import { resolveSupabase } from '@/lib/supabase/resolve'
import { CLUB_EMBED_COLUMNS, PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { resolveAvatarUrls, signImagePaths } from '@/lib/data/media'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import type { NotificationCursor, NotificationRow } from '@/types'

/**
 * How much of the list one read returns. Bounded for the reason every other
 * page size in this app is: `036`'s own retention window is "as long as the
 * subject exists", which is unbounded, so an unbounded read here selects every
 * like, comment, RSVP, ride and join a rider has ever received. Matches
 * `RIDES_PAGE_SIZE` / `FEED_PAGE_SIZE` rather than inventing a third number.
 */
export const NOTIFICATIONS_PAGE_SIZE = 30

/**
 * `organizer_id` is here for the copy, not for a filter: `ride_joined` reaches
 * the whole crew, and the sentence the organizer reads is not the one everyone
 * else reads (PD-129, `NotificationsListItem`). It is read live through this
 * embed rather than stamped on the notification, which is what `036` §2 asks of
 * every string drawn from one — a reader who loses the ride loses the row.
 *
 * No new exposure: the column already ships on every card `RIDE_SELECT` draws,
 * and this embed only resolves for a ride `036` §3's SELECT policy already lets
 * this reader see.
 */
const NOTIFICATION_SELECT = `
  id, type, created_at, read_at,
  actor:profiles!actor_id(${PUBLIC_PROFILE_COLUMNS}),
  postcard:postcards(id, image_path),
  ride:rides(id, title, organizer_id),
  club:clubs(${CLUB_EMBED_COLUMNS})
`

type NotificationRawRow = Omit<NotificationRow, 'postcard'> & {
  postcard: { id: string; image_path: string } | null
}

/**
 * One page of this rider's notifications, newest first — the read half of
 * `036`. **Deliberately filters nothing beyond the cursor and the page size.**
 * No `.eq('user_id', …)`, no block filter, no resolvability check: `036` §3's
 * SELECT policy already carries the recipient scope, the block conjunct and a
 * resolvability `EXISTS` per rendered resource, and restating any of it here
 * would be a second copy of a visibility rule free to drift from the one the
 * count RPC also reads through — the exact defect `event-fanout-integrity` and
 * `client-cache-invalidation`'s new requirements both name. See task 6.7.
 *
 * `cursor` is a keyset pair, not an offset — `(created_at, id)` both
 * descending, matching the index `036` §9 adds. PostgREST has no row-wise
 * comparison operator, so the boundary is expressed as the equivalent OR:
 * `created_at < cursor.createdAt`, or equal on `created_at` and `id <
 * cursor.id`. Interpolated directly, which is safe for the reason rather than
 * by precedent: both halves are values this app generated a moment earlier — a
 * UUID and a timestamp this same function returned — never rider-typed text.
 * (It used to cite `getRides`' own interpolated `.or()` id list as the
 * precedent. That list is gone, so the reason has to stand on its own, which is
 * what it was doing all along.)
 */
export async function getNotificationsPage(
  cursor?: NotificationCursor,
  limit = NOTIFICATIONS_PAGE_SIZE
): Promise<NotificationRow[]> {
  const supabase = await resolveSupabase()

  let query = supabase
    .from('notifications')
    .select(NOTIFICATION_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    )
  }

  const rows = unwrapList(await query, 'your notifications') as unknown as NotificationRawRow[]

  // One batched signing pass each, the same shape `getFeed`/`getRides` use:
  // the postcard photo is a `postcards/` Storage path (signed URLs), while the
  // actor's and the club's avatars are `resolveAvatarUrls`' structural shape.
  const imageUrls = await signImagePaths(
    rows.map((row) => row.postcard?.image_path).filter((path): path is string => !!path),
    supabase
  )
  await resolveAvatarUrls([...rows.map((row) => row.actor), ...rows.map((row) => row.club)], supabase)

  return rows.map((row) => ({
    ...row,
    postcard: row.postcard
      ? { ...row.postcard, image_url: imageUrls.get(row.postcard.image_path) ?? null }
      : null,
  }))
}

/**
 * The header dot's count — a thin wrapper on `036`'s
 * `unread_notification_count()`, `security invoker` so it reads through the
 * same predicate `getNotificationsPage` does. **Do not add a client-side
 * filter here or there** — `design.md` §D2/§D5 and the count-and-list
 * requirement in `client-cache-invalidation` both exist specifically to keep
 * the two answering the same question, and a filter applied to only one of
 * them is how a nonzero badge ends up over an empty list.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await resolveSupabase()
  return unwrap(await supabase.rpc('unread_notification_count'), 'your unread notification count') ?? 0
}
