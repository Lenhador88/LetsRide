import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { distanceKm, isNearby } from '@/lib/location/distance'
import { MEMBER_PROFILE_EMBED } from '@/lib/data/columns'
import { unwrapCount, unwrapList } from '@/lib/data/unwrap'
import { resolveAvatarUrls, signImagePaths } from '@/lib/data/media'
import { clubIdSchema } from '@/lib/validation/clubs'
import type {
  Club,
  ClubDeletionImpact,
  ClubDetail,
  ClubForEdit,
  ClubJoinRequestStatus,
  ClubListItem,
  ClubPreview,
  ClubRosterMember,
  PublicProfile,
} from '@/types'

type ClubOption = Pick<Club, 'id' | 'name'>

/**
 * Where the rider is, for the Explore sort. Structurally `RiderLocation` minus
 * its `source`, and typed here rather than imported so that `lib/data/` does
 * not depend on `lib/location/rider-location.ts` — that module reads
 * `navigator` and throws by design during the SSR pass, and nothing in this
 * directory may drag it into a module graph the prerender walks.
 */
export type RiderPosition = { lat: number; lon: number }

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
  location_name, location_place_id, latitude, longitude,
  members_count:club_members(count),
  riders:club_members(user_id, ${MEMBER_PROFILE_EMBED})
`

export type ClubListRow = {
  id: string
  name: string
  is_public: boolean
  avatar_path: string | null
  cover_image_path: string | null
  location_name: string | null
  location_place_id: string | null
  latitude: number | null
  longitude: number | null
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
    location_name: row.location_name,
    location_place_id: row.location_place_id,
    latitude: row.latitude,
    longitude: row.longitude,
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

/**
 * The club ids this rider belongs to. Both sub-pages need it, from opposite
 * sides, and since the `From clubs` filter (`getRides`, `getRideFilters`) the
 * rides tab needs it too — which is why it is exported rather than local.
 *
 * Bounded by `CLUB_MEMBERSHIP_LIMIT` with no `order by`, so past that many
 * memberships the answer is an arbitrary subset. Every caller must therefore
 * degrade to *fewer* rows and never to *wrong* ones — see `getExploreClubs`
 * for the defect that rule was written after.
 */
export async function myClubIds(supabase: DataClient, userId: string): Promise<string[]> {
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
/**
 * **"Near you" is computed over a RECENCY window, and the threshold is 50 —
 * not "thousands".** The page is selected by `created_at desc` and only then
 * sorted by distance, so with 60 public clubs the rider's nearest club can be
 * the 55th newest and be absent from the page, from the near count and from the
 * list — while the strip says `50+`. `066` §4 and `distance.ts` both name the
 * trigger for moving the predicate into SQL as "a club count that outgrows the
 * page"; this is what that number actually is, stated here rather than left to
 * be discovered from the query.
 *
 * It is a bound rather than a bug at today's scale (tens of clubs, all of them
 * on the page), and the honest description of what ships is *the newest fifty,
 * nearest first* rather than *the nearest fifty*.
 */
export async function getExploreClubs(near?: RiderPosition | null): Promise<ClubListItem[]> {
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

  /**
   * **The private half — `085`, PD-325.** A second read rather than a
   * relaxation of the first, because `.eq('is_public', true)` above is the
   * PUBLIC HALF'S DEFINITION and not a re-filter of RLS. Removing it would be
   * the defect this file already records twice (`/rides` and `/clubs`
   * subtracting from a policy that already unions public with owned and
   * joined) — and it would not work anyway, since a private club is not in the
   * `clubs` policy's answer to be removed FROM.
   *
   * `public.discoverable_private_clubs` returns SEVEN columns and no roster, so
   * these rows carry an empty `riders` array and a `members_count` computed
   * inside the function. It already excludes membership, ownership, public
   * clubs, the default club and anyone blocked with the owner, so no JS filter
   * is applied to it here.
   *
   * **`CLUBS_PAGE_SIZE` therefore bounds each half rather than the union**, and
   * the honest description of what ships is *the newest fifty public clubs plus
   * the newest fifty requestable private ones, nearest first*. The recency-window
   * note above applies unchanged to both halves.
   */
  const previews = unwrapList(
    await supabase.rpc('discoverable_private_clubs', { page_size: CLUBS_PAGE_SIZE }),
    'private clubs to explore',
  ) as unknown as DiscoverableClubRow[]

  const requestStatus = await myRequestStatuses(supabase, user.id, previews.map((row) => row.id))

  // No unread on either half. The design puts `Join club` in the slot the
  // counter occupies, and 015 refuses a watermark for a club you have not
  // joined anyway.
  const items = [
    ...rows.filter((row) => !joined.has(row.id)).map(toClubListItem),
    ...previews.map((row) => toDiscoverableListItem(row, requestStatus.get(row.id) ?? null)),
  ]
    .map((item) => withDistance(item, near))
    .sort(near ? byDistanceThenName : byName)

  await Promise.all([signRiderAvatars(items, supabase), signClubImages(items, supabase)])
  return items
}

/** The seven columns `public.discoverable_private_clubs` returns. */
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
 * The viewer's own outstanding asks, scoped to the private clubs on THIS page.
 *
 * Bounded by the page for exactly the reason the membership read above is —
 * that read's header records the defect a membership-scoped list caused — and
 * read under the caller's own SELECT policy with no accessor, because these are
 * their own rows.
 *
 * A failure costs the trailing control on those cards and never the list, which
 * is why it lands as an empty map rather than an exception: a rider who cannot
 * see whether they already asked is better served by a card than by an error
 * screen, and the duplicate ask they might then make is refused by `23505`.
 */
async function myRequestStatuses(
  supabase: DataClient,
  userId: string,
  clubIds: string[]
): Promise<Map<string, ClubJoinRequestStatus>> {
  if (clubIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('club_join_requests')
    .select('club_id, status')
    .eq('user_id', userId)
    .in('club_id', clubIds)

  if (error || !data) return new Map()
  return new Map(
    (data as { club_id: string; status: ClubJoinRequestStatus }[]).map((row) => [
      row.club_id,
      row.status,
    ])
  )
}

/**
 * A discoverable private club as a `ClubListItem`, so `ClubCard` draws one
 * component rather than two.
 *
 * **`riders` is empty and stays empty** — the accessor returns no roster at
 * all, so the card falls back to the member COUNT with no faces, which is the
 * design's own empty treatment rather than a degraded one.
 *
 * **`avatar_url` is null HERE and is filled in by `signClubImages` below**,
 * which is a change from `085`: that policy refused a private club's avatar
 * object to a non-member and the card drew initials. `089` (PD-335) adds the
 * third disjunct on `016`'s avatar policy, on the product owner's decision of
 * 2026-08-28, so the same batched signing pass the public half already goes
 * through now returns a URL for these rows too. The cover is still null and is
 * still not asked for.
 *
 * `is_public` is `false` by construction — the accessor returns nothing else —
 * so the card's `Private club` type line is right without asking.
 */
function toDiscoverableListItem(
  row: DiscoverableClubRow,
  requestStatus: ClubJoinRequestStatus | null
): ClubListItem {
  return {
    id: row.id,
    name: row.name,
    is_public: false,
    avatar_path: row.avatar_path,
    cover_image_path: null,
    avatar_url: null,
    cover_image_url: null,
    riders: [],
    members_count: row.members_count,
    location_name: row.location_name,
    // The accessor deliberately does not return it. `066` calls it provenance
    // rather than a join key and nothing renders it, so leaving it out of the
    // seven columns keeps the disclosure narrower for free.
    location_place_id: null,
    latitude: row.latitude,
    longitude: row.longitude,
    request_status: requestStatus,
  }
}

/**
 * One private club, for the reduced club screen — `085`, PD-325.
 *
 * The same accessor as Explore, narrowed to one club. `null` means "no such
 * club, or not one you may discover", deliberately conflated exactly as
 * `getClub` conflates its own two cases: distinguishing them would confirm a
 * private club exists to somebody the accessor is refusing.
 *
 * **The request status comes with it**, and it is still what the screen's own
 * sentence is drawn from. It is no longer the ONLY way a declined rider learns
 * the answer — `089` (PD-335) writes them a notification, on the product
 * owner's decision of 2026-08-28 — but the two agree by construction, because
 * that notification's destination is this very screen. `private.club_takes_join_requests_for`
 * still has no declined conjunct: the club has to stay discoverable for this
 * screen to be reachable at all, and `089`'s policy disjunct now depends on
 * that same property.
 */
export async function getClubPreview(id: string): Promise<ClubPreview | null> {
  // Before `resolveSupabase()`, following `getClub` and `getRideForEdit`: a
  // non-uuid reaches the RPC as `22P02`, PostgREST turns it into a 400 and
  // `unwrap` throws, so the rider gets the error boundary where a not-found
  // belongs (PD-142).
  if (!clubIdSchema.safeParse(id).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const rows = unwrapList(
    await supabase.rpc('discoverable_private_clubs', { target_club: id }),
    'that club',
  ) as unknown as DiscoverableClubRow[]

  const row = rows[0]
  if (!row) return null

  const status = await myRequestStatuses(supabase, user.id, [row.id])

  const preview = {
    id: row.id,
    name: row.name,
    avatar_path: row.avatar_path,
    // **Signed since `089`** (PD-335), where it used to be null by design. The
    // product owner decided on 2026-08-28 that a private club's avatar is
    // readable to every rider who can discover it, so `016`'s avatar policy now
    // carries a third disjunct and this attempt is no longer a round trip spent
    // on a guaranteed null. **The COVER is still not readable and is not asked
    // for** — an avatar is the club's identity, a cover is its content.
    avatar_url: null as string | null,
    location_name: row.location_name,
    latitude: row.latitude,
    longitude: row.longitude,
    members_count: row.members_count,
    request_status: status.get(row.id) ?? null,
  }

  await resolveAvatarUrls([preview], supabase)
  return preview
}

/**
 * Attaches how far this club is from the rider, when both ends of the question
 * have an answer.
 *
 * Three different "no" collapse to the same `undefined` and that is deliberate:
 * the rider has no resolvable position, the club has no location, or the caller
 * did not ask. A screen can only usefully do one thing with any of them — not
 * draw a distance — and `ClubListItem.distance_km` says so in its own doc.
 */
function withDistance(item: ClubListItem, near?: RiderPosition | null): ClubListItem {
  if (!near || item.latitude === null || item.longitude === null) return item
  const km = distanceKm(near, { lat: item.latitude, lon: item.longitude })
  return km === null ? item : { ...item, distance_km: km }
}

/**
 * Near clubs first, nearest first; everything else after, by name.
 *
 * **A club with no location keeps its place in the list rather than dropping
 * out of it** — PD-259's own rule: *"a club with no location is not a hidden
 * club."* Every club that predates `066` has none, so a comparator that treated
 * missing as far away would be right, and one that treated it as zero would
 * float every one of them above the rider's actual neighbours.
 *
 * Exported for the unit tests, like `toClubListItem` and for the same reason:
 * it is the whole ordering rule and there is no other way to cover it without a
 * database.
 *
 * Beyond `NEARBY_RADIUS_KM` the distance stops being the sort key at all, and
 * that is the half worth stating: a club 340 km away and a club with no
 * location are equally "not near you", so ordering the first above the second
 * would claim a relevance the number does not carry at that range. Both fall
 * through to name.
 */
export function byDistanceThenName(a: ClubListItem, b: ClubListItem): number {
  const aNear = isNearby(a.distance_km)
  const bNear = isNearby(b.distance_km)
  if (aNear !== bNear) return aNear ? -1 : 1
  if (aNear && bNear) {
    // Name breaks a tie rather than `Array.prototype.sort`'s stability, which
    // would leave two clubs in the same town in whatever order the query
    // returned them — a list that reorders itself between loads for no reason
    // the rider can see. Same distance is the common case, not the edge one:
    // every club picked from the same place row has an identical coordinate.
    const byDistance = (a.distance_km ?? 0) - (b.distance_km ?? 0)
    if (byDistance !== 0) return byDistance
  }
  return byName(a, b)
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
  // Before `resolveSupabase()`, not after — following `getRide`, so no round
  // trip is issued at all. A non-uuid id reaches `.eq('id', …)` as `22P02`,
  // which PostgREST turns into a 400 and `unwrap` throws, and the rider gets the
  // error boundary where every other detail screen renders not-found. This is
  // the read that had no such guard until PD-142; see `clubIdSchema`.
  if (!clubIdSchema.safeParse(id).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const { data } = await supabase
    .from('clubs')
    .select(
      `id, name, description, is_public, owner_id, created_at, avatar_path, cover_image_path,
       location_name, location_place_id, latitude, longitude,
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
    location_name: string | null
    location_place_id: string | null
    latitude: number | null
    longitude: number | null
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
    members_count: row.members_count?.[0]?.count ?? 0,
    viewer_role: (membership?.role as ClubDetail['viewer_role']) ?? null,
    // The column, not the roster row — see the type. Free here because `user`
    // is already in hand for the membership read above, which is the same
    // argument `ClubForEdit.is_owner` makes for computing it rather than
    // spending a second `auth.getUser()`.
    viewer_is_owner: !!user && row.owner_id === user.id,
    location_name: row.location_name,
    location_place_id: row.location_place_id,
    latitude: row.latitude,
    longitude: row.longitude,
  }

  const paths = [club.avatar_path, club.cover_image_path].filter((p): p is string => !!p)
  if (paths.length > 0) {
    const urls = await signImagePaths(paths, supabase)
    club.avatar_url = club.avatar_path ? (urls.get(club.avatar_path) ?? null) : null
    club.cover_image_url = club.cover_image_path
      ? (urls.get(club.cover_image_path) ?? null)
      : null
  }
  return club
}

/**
 * One club, for `/clubs/detail/edit` (PD-101). Narrower than `getClub` — no
 * `members_count`, no `viewer_role` — because the edit screen needs the
 * editable columns and nothing a member list would want.
 *
 * `is_owner` is computed here the same way `RideForEdit.is_organizer` is, so
 * the edit screen can tell "not found" from "not yours" without a second
 * `auth.getUser()` round trip — the clubs SELECT policy already admits every
 * member and every public club, so a row coming back is not by itself
 * permission to edit it.
 *
 * Mirrors `getClub`'s own choice not to distinguish a missing row from a
 * read error — see that function's header.
 */
export async function getClubForEdit(id: string): Promise<ClubForEdit | null> {
  // The same guard `getClub` and `getRideForEdit` carry, for the same reason.
  if (!clubIdSchema.safeParse(id).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const { data } = await supabase
    .from('clubs')
    .select(
      'id, name, description, is_public, avatar_path, cover_image_path, owner_id, ' +
        'location_name, location_place_id, latitude, longitude'
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) return null

  const row = data as unknown as {
    id: string
    name: string
    description: string | null
    is_public: boolean
    avatar_path: string | null
    cover_image_path: string | null
    owner_id: string
    location_name: string | null
    location_place_id: string | null
    latitude: number | null
    longitude: number | null
  }

  const club: ClubForEdit = {
    ...row,
    avatar_url: null,
    cover_image_url: null,
    is_owner: !!user && user.id === row.owner_id,
  }

  const paths = [club.avatar_path, club.cover_image_path].filter((p): p is string => !!p)
  if (paths.length > 0) {
    const urls = await signImagePaths(paths, supabase)
    club.avatar_url = club.avatar_path ? (urls.get(club.avatar_path) ?? null) : null
    club.cover_image_url = club.cover_image_path
      ? (urls.get(club.cover_image_path) ?? null)
      : null
  }

  return club
}

/**
 * How many of a club's rides are currently public — read only when the owner
 * is about to flip a public club private, so `EditClubForm` can name the
 * count `propagate_club_privacy_to_rides` (`022`) is about to rewrite
 * one-directionally. Not scoped to upcoming rides: the trigger rewrites every
 * public ride in the club regardless of `departure_at`, so a count bounded to
 * upcoming ones would understate what the toggle actually does.
 */
export async function getClubPublicRideCount(clubId: string): Promise<number> {
  const supabase = await resolveSupabase()

  return unwrapCount(
    await supabase
      .from('rides')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('is_public', true),
    "this club's public rides",
  )
}

/**
 * The delete confirmation's blast-radius counts (`club-lifecycle`'s delete
 * requirement) — read under the OWNER's own RLS, which is why both are a
 * floor rather than a total. See `ClubDeletionImpact`.
 *
 * `ridesToDelete` is scoped to `is_public = false`: `delete_owned_club`
 * (`043`) only ever removes the rides `ON DELETE SET NULL` would zombify, so
 * a public ride is not part of what this confirmation discloses as
 * "will be deleted" even though it does leave the club.
 *
 * Throws rather than returning zeros on a failed read — `unwrapCount`'s whole
 * reason to exist — because `club-lifecycle` requires the confirmation to
 * refuse when it cannot count, not to show an all-clear it never measured.
 */
export async function getClubDeletionImpact(clubId: string): Promise<ClubDeletionImpact> {
  const supabase = await resolveSupabase()

  const [postcards, rides, members] = await Promise.all([
    supabase.from('postcards').select('id', { count: 'exact', head: true }).eq('club_id', clubId),
    supabase
      .from('rides')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('is_public', false),
    supabase
      .from('club_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('club_id', clubId),
  ])

  return {
    postcards: unwrapCount(postcards, 'postcards this club holds'),
    ridesToDelete: unwrapCount(rides, "this club's rides that would be deleted"),
    members: unwrapCount(members, "this club's members"),
  }
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
      .select(`user_id, role, joined_at, ${MEMBER_PROFILE_EMBED}`)
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
