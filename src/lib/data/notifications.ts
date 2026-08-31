import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { CLUB_EMBED_COLUMNS, PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { resolveAvatarUrls, signImagePaths } from '@/lib/data/media'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import type { EmbeddedClub, NotificationCursor, NotificationRow } from '@/types'

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
/**
 * `089`, PD-335. The one type whose club does NOT arrive through the embed
 * below, and the reason it does not is the whole of that change: the embed
 * runs under the reader's own RLS on `clubs`, and a declined requester of a
 * private club reads nothing there — which is exactly why `085` wrote no such
 * notification at all. `089` makes the ROW resolve with a type-scoped disjunct
 * on `036` §3's club conjunct; it deliberately does NOT widen `clubs` SELECT,
 * because `016`'s two storage policies delegate to that expression and an arm
 * there would ship the club's cover, which the product owner excluded.
 *
 * So the club comes from `public.discoverable_private_clubs` — `085`'s
 * accessor, the one path by which a non-member reads a private club, and the
 * one this rider already reaches every other way (the Explore card, the reduced
 * club screen).
 *
 * **`093`, PD-360 adds a second and a third type to the same fallback.**
 * `club_invited`'s recipient is exactly as likely to be a non-member of a
 * private club as a decline's requester is — `design.md` §The invitee needs
 * no new read path is what says this is safe: the invitee can already read
 * the club through this same accessor, so resolving it here discloses
 * nothing new. `club_invite_declined`'s recipient is the inviter, who is
 * ordinarily still a member and needs no widening at all — it rides along in
 * the same fallback for the one case that is not ordinary, an inviter who has
 * since left the club, so the row still names it rather than degrading to
 * `notificationCopy`'s generic "a club" for no reason.
 */
const TYPES_NEEDING_PRIVATE_CLUB_LOOKUP = new Set([
  'club_join_request_declined',
  'club_invited',
  'club_invite_declined',
])

const NOTIFICATION_SELECT = `
  id, type, created_at, read_at, club_id,
  actor:profiles!actor_id(${PUBLIC_PROFILE_COLUMNS}),
  postcard:postcards(id, image_path),
  ride:rides(id, title, organizer_id),
  club:clubs(${CLUB_EMBED_COLUMNS})
`

type NotificationRawRow = Omit<NotificationRow, 'postcard'> & {
  postcard: { id: string; image_path: string } | null
  /** `089`'s decline needs the raw column, because its embed cannot resolve. */
  club_id: string | null
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

  const privateClubs = await resolvePrivateClubEmbeds(rows, supabase)

  return rows.map((row) => ({
    ...row,
    postcard: row.postcard
      ? { ...row.postcard, image_url: imageUrls.get(row.postcard.image_path) ?? null }
      : null,
    // Only for the three types, and only when the embed came back empty —
    // which for a private club is always. A row whose club the reader CAN see
    // keeps the embed's answer, so this never overwrites a live join with a
    // second read of the same thing.
    club: row.club ?? privateClubs.get(row.id) ?? null,
  }))
}

/**
 * The clubs behind this page's decline and invite notifications, by
 * notification id.
 *
 * **One call per distinct club, in parallel, rather than one call for all of
 * them.** `discoverable_private_clubs` takes a single `target_club` or none at
 * all, and the un-narrowed form is page-capped at 100 — so a single unnarrowed
 * call would silently MISS a club beyond that cap and draw the row with no
 * name, which is the failure mode a cap must never have. A new accessor
 * returning only the caller's own such clubs would be one round trip and one
 * more permanent `authenticated_security_definer_function_executable`
 * advisor; these three types are rare per rider and a page holds at most
 * `NOTIFICATIONS_PAGE_SIZE` of them, so the round trips are the cheaper side
 * of that trade.
 *
 * A failure costs the club's NAME and never the list: the row still renders,
 * degrading to "a club" through `notificationCopy`'s own fallback, exactly as
 * every other type degrades when its subject does not resolve.
 */
async function resolvePrivateClubEmbeds(
  rows: NotificationRawRow[],
  supabase: DataClient
): Promise<Map<string, EmbeddedClub>> {
  const wanted = new Map<string, string[]>()
  for (const row of rows) {
    if (!TYPES_NEEDING_PRIVATE_CLUB_LOOKUP.has(row.type) || row.club) continue
    // **`NOTIFICATION_SELECT` asks for the raw `club_id` as well as the embed,
    // and that column is on the select FOR THIS.** Every other type reads its
    // club through the embed alone; a private club's embed is null by
    // construction for these three, because it runs under the reader's own
    // RLS on `clubs` and a private club refuses a non-member — which is why
    // `085` wrote no `club_join_request_declined` notification through the
    // ordinary conjunct at all, and why `093`'s `club_invited` needed its own
    // type-scoped disjunct on `notifications` itself (`design.md` §Why the
    // notification arm is type-scoped). The column is what says which club a
    // resolved ROW is about; the embed staying null is what says to look here.
    const clubId = row.club_id
    if (!clubId) continue
    wanted.set(clubId, [...(wanted.get(clubId) ?? []), row.id])
  }
  if (wanted.size === 0) return new Map()

  const resolved = new Map<string, EmbeddedClub>()
  const clubs = await Promise.all(
    [...wanted.keys()].map(async (clubId) => {
      const { data, error } = await supabase.rpc('discoverable_private_clubs', {
        target_club: clubId,
      })
      if (error || !data) return null
      const club = (data as DiscoverableClubRow[])[0]
      return club ? { clubId, club } : null
    })
  )

  const found = clubs.filter((entry): entry is { clubId: string; club: DiscoverableClubRow } => !!entry)
  const embedded = found.map(({ club }) => ({
    id: club.id,
    name: club.name,
    avatar_path: club.avatar_path,
    avatar_url: null as string | null,
  }))
  // `089` part 2 is what makes this sign at all: before it, `016`'s policy
  // refused a private club's avatar object to a non-member and every attempt
  // was a round trip spent on a guaranteed null.
  await resolveAvatarUrls(embedded, supabase)

  found.forEach(({ clubId }, index) => {
    for (const notificationId of wanted.get(clubId) ?? []) {
      resolved.set(notificationId, embedded[index] as EmbeddedClub)
    }
  })
  return resolved
}

/** The seven columns `public.discoverable_private_clubs` returns — `085`. */
type DiscoverableClubRow = {
  id: string
  name: string
  avatar_path: string | null
  location_name: string | null
  latitude: number | null
  longitude: number | null
  members_count: number
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
