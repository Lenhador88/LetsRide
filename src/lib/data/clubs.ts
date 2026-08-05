import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { unwrapList } from '@/lib/data/unwrap'
import { resolveAvatarUrls, signImagePaths } from '@/lib/data/media'
import type { Club, ClubDetail, ClubListItem, ClubRosterMember, PublicProfile } from '@/types'

type ClubOption = Pick<Club, 'id' | 'name'>

/** How many faces the design's overlapping avatar row shows before it becomes `+N`. */
export const CLUB_AVATAR_LIMIT = 5

/**
 * How much of Explore one page reads. The design neither paginates nor
 * infinite-scrolls, and unbounded this selects every public club on every
 * render — the same trap `FEED_PAGE_SIZE` and `RIDES_PAGE_SIZE` close.
 */
export const CLUBS_PAGE_SIZE = 50

/**
 * How many memberships are read to build "your clubs", and the bound that keeps
 * the `in` / `not.in` filters below from becoming a URL long enough to 414.
 *
 * That is not hypothetical here: `myRideIds` shipped an `id.in.(…)` with no
 * bound and would have failed at a few hundred joined rides. The difference is
 * that club membership is bounded by something a rider does by hand — nobody
 * joins a hundred clubs — where ride attendance accumulates on its own. The cap
 * is stated rather than assumed, so that if it is ever reached the result is a
 * truncated list rather than a broken page.
 */
export const CLUB_MEMBERSHIP_LIMIT = 100

/**
 * Pinned rather than `*`, for the reason `columns.ts` exists: `*` on a table
 * ships every column added later to the browser the day it is added, with no
 * diff to notice it in.
 *
 * The two embeds read the same relation twice on purpose. `members_count` is an
 * aggregate, so the number is the *whole* club, while `riders` is capped at five
 * by the caller's `referencedTable` limit — embedding the roster whole and
 * counting it in JS would make the row count proportional to club size, which
 * for a 5,000-member club is 5,000 rows fetched to draw five faces. This is
 * exactly the shape `lib/data/rides.ts` names as the fix it deferred; clubs are
 * where it stops being theoretical.
 */
const CLUB_LIST_SELECT = `
  id, name, is_public, avatar_path, cover_image_path,
  members_count:club_members(count),
  riders:club_members(user_id, profile:profiles(${PUBLIC_PROFILE_COLUMNS}))
`

export type ClubListRow = {
  id: string
  name: string
  is_public: boolean
  avatar_path: string | null
  cover_image_path: string | null
  members_count: { count: number }[] | null
  riders: { user_id: string; profile: PublicProfile | null }[] | null
}

/**
 * Turns a row into a card. Exported for the unit tests, which is the only way
 * to cover the shape without a database.
 */
export function toClubListItem(row: ClubListRow, unread?: number): ClubListItem {
  const riders = (row.riders ?? [])
    .map((member) => member.profile)
    .filter((profile): profile is PublicProfile => !!profile)

  return {
    id: row.id,
    name: row.name,
    is_public: row.is_public,
    avatar_path: row.avatar_path,
    cover_image_path: row.cover_image_path,
    // Filled by signClubImages, which runs once per page rather than per row.
    avatar_url: null,
    cover_image_url: null,
    riders: riders.slice(0, CLUB_AVATAR_LIMIT),
    // The aggregate, not `riders.length` — the embed is capped at five, and a
    // member whose profile the policies hide still counts towards the club.
    members_count: row.members_count?.[0]?.count ?? 0,
    unread,
  }
}

/** The club ids this rider belongs to. Both sub-pages need it, from opposite sides. */
async function myClubIds(supabase: DataClient, userId: string): Promise<string[]> {
  const rows = unwrapList(
    await supabase
      .from('club_members')
      .select('club_id')
      .eq('user_id', userId)
      .limit(CLUB_MEMBERSHIP_LIMIT),
    'your club memberships',
  ) as unknown as { club_id: string }[]

  return rows.map((row) => row.club_id)
}

/**
 * Unread activity per joined club, from 015's `club_unread_counts()`.
 *
 * One round trip for every badge on the screen rather than one per club. The
 * function is SECURITY INVOKER, so the counts obey the same policies the feed
 * does — a blocked rider's postcard is not counted, and neither is a hidden
 * one. A failure costs the badges and never the list, which is why the error
 * lands as an empty map rather than an exception.
 */
async function unreadByClub(supabase: DataClient): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('club_unread_counts')
  if (error || !data) return new Map()

  return new Map(
    (data as { club_id: string; unread: number }[]).map((row) => [row.club_id, row.unread])
  )
}

/**
 * Signs every rider avatar across a page of clubs in one request.
 *
 * The fan-out trap `resolveAvatarUrls` documents: it writes the signed URL into
 * `avatar_url`, so a screen that forgets to call it falls back to initials and
 * looks like a design choice rather than a bug.
 */
async function signRiderAvatars(items: ClubListItem[], supabase: DataClient) {
  await resolveAvatarUrls(
    items.flatMap((item) => item.riders),
    supabase
  )
}

/**
 * Signs both club images for a whole page in one request.
 *
 * Not `resolveAvatarUrls`, even though the avatar half is now the same
 * operation: this signs the cover in the same request, and splitting it would
 * turn one round trip into two on every Clubs load. The rule the two share is
 * that `avatar_url` and `cover_image_url` hold signed URLs and nothing else —
 * `024` dropped the legacy `clubs.avatar_url` column, so the ambiguity 014 had
 * to unpick on profiles can no longer arise here either.
 *
 * A path that will not sign lands as null and the card falls back to initials.
 * That is the correct outcome for a private club's cover seen by someone the
 * policy excludes, and signing is not the check — 016's SELECT policy is.
 */
async function signClubImages(items: ClubListItem[], supabase: DataClient) {
  const paths = items.flatMap((item) =>
    [item.avatar_path, item.cover_image_path].filter((path): path is string => !!path)
  )
  if (paths.length === 0) return

  const urls = await signImagePaths(paths, supabase)
  for (const item of items) {
    item.avatar_url = item.avatar_path ? (urls.get(item.avatar_path) ?? null) : null
    item.cover_image_url = item.cover_image_path ? (urls.get(item.cover_image_path) ?? null) : null
  }
}

/** Alphabetical. The design specifies no order, and a list scanned by name should not reshuffle. */
function byName(a: ClubListItem, b: ClubListItem) {
  return a.name.localeCompare(b.name)
}

/**
 * `Clubs - Your clubs` — every club this rider has joined, with its unread badge.
 *
 * Membership is the signal rather than `owner_id`, because `/clubs/new` writes
 * both rows and the design's own empty state is "You have no clubs, yet!". A
 * club owned without a membership row would appear on neither sub-page; that is
 * a create-flow integrity question, not something this read should paper over
 * by unioning two definitions of "yours".
 */
export async function getYourClubs(): Promise<ClubListItem[]> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const ids = await myClubIds(supabase, user.id)
  if (ids.length === 0) return []

  const [rows, unread] = await Promise.all([
    (async () =>
      unwrapList(
        await supabase
          .from('clubs')
          .select(CLUB_LIST_SELECT)
          .in('id', ids)
          .limit(CLUB_AVATAR_LIMIT, { referencedTable: 'riders' }),
        'your clubs',
      ) as unknown as ClubListRow[])(),
    unreadByClub(supabase),
  ])

  const items = rows.map((row) => toClubListItem(row, unread.get(row.id) ?? 0)).sort(byName)
  await Promise.all([signRiderAvatars(items, supabase), signClubImages(items, supabase)])
  return items
}

/**
 * `Clubs - Explore` — public clubs this rider has not joined.
 *
 * **`.eq('is_public', true)` here is the screen's definition, not a re-filter of
 * RLS**, and the distinction matters because getting it wrong is the one defect
 * this repo has shipped twice: `/rides` and `/clubs` both filtered `is_public`
 * in application code and thereby *subtracted* from a SELECT policy that already
 * unions public with owned and joined, making private clubs unreachable from
 * their own list.
 *
 * What makes it safe this time is that nothing is subtracted. A private club the
 * rider cannot see is already gone by policy; a private club they *can* see is
 * one they belong to, and belongs on Your clubs. Explore is *defined* as the
 * public clubs you are not in, so both predicates describe the screen rather
 * than the visibility rule.
 *
 * The exclusion runs server-side rather than as a JS filter afterwards so that
 * `CLUBS_PAGE_SIZE` means what it says. Filtering after the fact returns a short
 * page whenever the newest public clubs happen to be ones the rider has already
 * joined — the same class of silent truncation as the ride filter tiles that
 * went missing past the page boundary.
 */
export async function getExploreClubs(): Promise<ClubListItem[]> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const rows = unwrapList(
    await supabase
      .from('clubs')
      .select(CLUB_LIST_SELECT)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(CLUBS_PAGE_SIZE)
      .limit(CLUB_AVATAR_LIMIT, { referencedTable: 'riders' }),
    'clubs to explore',
  ) as unknown as ClubListRow[]

  /**
   * The exclusion is checked **against this page**, not against a list of the
   * rider's memberships, and that ordering is the fix for a real defect.
   *
   * The first version excluded server-side with `.not('id','in',(…myClubIds))`,
   * reasoning that a JS filter after the fact makes `CLUBS_PAGE_SIZE` mean less
   * than it says. True, but `myClubIds` is capped at `CLUB_MEMBERSHIP_LIMIT`
   * with no `order by` — so past 100 memberships the exclusion list was an
   * arbitrary 100 and the rest of the rider's own clubs reappeared on Explore
   * with a `Join club` button that upserts, succeeds, changes nothing and does
   * not remove the row. **Wrong rows, not fewer rows** — the one degradation a
   * cap must never produce.
   *
   * Asking "which of these fifty am I in" is bounded by the page instead of by
   * membership, so it cannot go wrong at any number of clubs. The page may come
   * back shorter than `CLUBS_PAGE_SIZE`; short is the honest failure.
   */
  const ids = rows.map((row) => row.id)
  const joined = new Set<string>()

  if (ids.length > 0) {
    const memberships = unwrapList(
      await supabase
        .from('club_members')
        .select('club_id')
        .eq('user_id', user.id)
        .in('club_id', ids),
      'your membership of these clubs',
    ) as unknown as { club_id: string }[]

    for (const membership of memberships) joined.add(membership.club_id)
  }

  // No unread. The design puts `Join club` in the slot the counter occupies,
  // and 015 refuses a watermark for a club you have not joined anyway.
  const items = rows
    .filter((row) => !joined.has(row.id))
    .map((row) => toClubListItem(row))
    .sort(byName)
  await Promise.all([signRiderAvatars(items, supabase), signClubImages(items, supabase)])
  return items
}

/**
 * One club, for the detail screens.
 *
 * `notFound()` is the caller's job, not this function's — it returns null for
 * "no such club" *and* for "a club the policy hides", which are deliberately the
 * same answer. Distinguishing them would confirm a private club exists to
 * someone who cannot see it, which is the whole point of decision #1.
 */
export async function getClub(id: string): Promise<ClubDetail | null> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const { data } = await supabase
    .from('clubs')
    .select(
      `id, name, description, is_public, owner_id, created_at, avatar_path, cover_image_path,
       owner:profiles!owner_id(${PUBLIC_PROFILE_COLUMNS}),
       members_count:club_members(count)`
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) return null

  const row = data as unknown as {
    id: string
    name: string
    description: string | null
    is_public: boolean
    owner_id: string
    created_at: string
    avatar_path: string | null
    cover_image_path: string | null
    owner: PublicProfile | null
    members_count: { count: number }[] | null
  }

  // Membership is read separately rather than as an embed filtered by user_id:
  // the club_members SELECT policy scopes *visibility*, so an embed would return
  // the whole roster to find one row.
  const { data: membership } = user
    ? await supabase
        .from('club_members')
        .select('role')
        .eq('club_id', id)
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null }

  const club: ClubDetail = {
    id: row.id,
    name: row.name,
    description: row.description,
    is_public: row.is_public,
    owner_id: row.owner_id,
    created_at: row.created_at,
    avatar_path: row.avatar_path,
    cover_image_path: row.cover_image_path,
    avatar_url: null,
    cover_image_url: null,
    owner: row.owner,
    members_count: row.members_count?.[0]?.count ?? 0,
    viewer_role: (membership?.role as ClubDetail['viewer_role']) ?? null,
  }

  const paths = [club.avatar_path, club.cover_image_path].filter((p): p is string => !!p)
  if (paths.length > 0) {
    const urls = await signImagePaths(paths, supabase)
    club.avatar_url = club.avatar_path ? (urls.get(club.avatar_path) ?? null) : null
    club.cover_image_url = club.cover_image_path
      ? (urls.get(club.cover_image_path) ?? null)
      : null
  }
  if (club.owner) await resolveAvatarUrls([club.owner], supabase)

  return club
}

/**
 * A club's roster.
 *
 * Bounded for the same reason `RIDE_CREW_LIMIT` is: nothing caps `club_members`,
 * so an unbounded read selects every row plus a joined profile each and renders
 * one list item per row with no virtualisation. Beyond the bound the list
 * truncates rather than misleads, which is the honest trade until pagination
 * gets a design.
 */
export const CLUB_ROSTER_LIMIT = 200

export async function getClubMembers(clubId: string): Promise<ClubRosterMember[]> {
  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('club_members')
      .select(`user_id, role, joined_at, profile:profiles(${PUBLIC_PROFILE_COLUMNS})`)
      .eq('club_id', clubId)
      .order('joined_at', { ascending: true })
      .limit(CLUB_ROSTER_LIMIT),
    "this club's members",
  ) as unknown as ClubRosterMember[]

  // A membership whose profile the policies hide is dropped rather than drawn
  // as a nameless row — the same rule getMyClubs applies to a missing club.
  const members = rows.filter((member) => !!member.profile)
  await resolveAvatarUrls(members.map((member) => member.profile), supabase)
  return members
}

/**
 * The clubs this rider belongs to, for the postcard audience selector.
 *
 * Filtering on `user_id` is business logic, not a re-filter of RLS: the
 * club_members SELECT policy scopes *visibility* (members of clubs you can
 * see), so "which of these memberships are mine" is a question the policy has
 * no opinion on — the same distinction attachLikeState draws in
 * lib/data/postcards.ts.
 *
 * Membership is still not the authority on whether a post lands: 009's
 * postcards INSERT policy decides that. This only shapes the menu.
 */
export async function getMyClubs(): Promise<ClubOption[]> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const data = unwrapList(
    await supabase.from('club_members').select('club:clubs(id, name)').eq('user_id', user.id),
    'your clubs',
  )

  // PostgREST types a to-one embed as possibly-array; a membership row whose
  // club is missing (deleted, or hidden by the clubs policy) is dropped rather
  // than rendered as an empty option.
  return data
    .flatMap((row) => {
      const club = row.club as unknown as ClubOption | ClubOption[] | null
      if (!club) return []
      return Array.isArray(club) ? club : [club]
    })
    .filter((club) => club?.id && club?.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}
