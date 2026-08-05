import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { CLUB_EMBED_COLUMNS, PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import { rideIdSchema } from '@/lib/validation/rides'
import { resolveAvatarUrls } from '@/lib/data/media'
import type {
  EmbeddedClub,
  PublicProfile,
  RideAttendance,
  RideCrew,
  RideCrewMember,
  RideDetail,
  RideFilter,
  RideFilterOption,
  RideFilters,
  RideListItem,
} from '@/types'


/**
 * Provisional, and bounded on purpose. The design does not say whether the list
 * pages or infinite-scrolls, but unbounded it would select every ride the
 * viewer can see on every render — the same trap FEED_PAGE_SIZE closes for
 * postcards.
 */
export const RIDES_PAGE_SIZE = 30

/** How many faces the design's avatar row shows before it becomes `+N`. */
export const RIDE_AVATAR_LIMIT = 5

/**
 * How far the filter bar scans to build its tiles, and deliberately far larger
 * than a page of the list.
 *
 * The first version of this counted tiles over `RIDES_PAGE_SIZE`, the same 30
 * the *unfiltered* list reads — which is wrong the moment a filter is active,
 * because `/rides?club=X` reads 30 rides *of that club*. A club whose soonest
 * ride sorted 31st overall got no tile at all while its filtered list would
 * have rendered rides, so the only route to it was a hand-typed URL. That is
 * the same defect as "private clubs are unreachable from /clubs", arrived at
 * from the opposite direction, and it is why the two windows are now named
 * separately instead of sharing one constant.
 *
 * Beyond this bound the counts saturate rather than mislead — a tile can still
 * go missing, just at 500 concurrent upcoming rides instead of 31. The exact
 * fix is a `group by club_id` behind an RPC; it is a migration, so it waits
 * until the numbers justify it.
 */
export const RIDE_FILTER_SCAN_LIMIT = 500

/**
 * How much of a crew `/rides/[id]/crew` will read, and **not** because a
 * motorcycle ride has 200 riders.
 *
 * Nothing caps `ride_members`. `max_riders` has existed since 001 and has never
 * been enforced by the action, a policy or a trigger, so roster size is
 * unbounded *by construction* rather than merely large in theory. Unbounded,
 * the crew read selects every row plus a joined profile each and renders one
 * list item per row with no virtualisation, on a 390px screen.
 *
 * Beyond this the list truncates rather than misleads — the same saturating
 * trade `RIDE_FILTER_SCAN_LIMIT` makes above, and the honest one until either
 * pagination gets a design or the schema starts enforcing capacity.
 */
export const RIDE_CREW_LIMIT = 200

/**
 * The crew is embedded whole and counted in JS rather than read as a separate
 * `ride_members(count)` aggregate, because the card needs both the number and
 * the first five profiles, and a bounded embed would truncate the two
 * inconsistently.
 *
 * That makes the row count proportional to crew size. At the scale of a
 * motorcycle ride that is a handful of rows; if crews ever run to hundreds, the
 * fix is a `riders_count:ride_members(count)` aggregate beside a
 * `.limit(RIDE_AVATAR_LIMIT, { referencedTable: 'riders' })` embed — named here
 * so it does not have to be rediscovered.
 */
const RIDE_SELECT = `
  id, title, meeting_point, departure_at, organizer_id,
  organizer:profiles!organizer_id(${PUBLIC_PROFILE_COLUMNS}),
  club:clubs(id, name),
  riders:ride_members(user_id, status, profile:profiles(${PUBLIC_PROFILE_COLUMNS}))
`

export type RideRow = {
  id: string
  title: string
  meeting_point: string
  departure_at: string
  organizer_id: string
  organizer: PublicProfile | null
  club: Pick<EmbeddedClub, 'id' | 'name'> | null
  riders: { user_id: string; status: 'going' | 'maybe'; profile: PublicProfile | null }[] | null
}

/**
 * Turns a row into a card.
 *
 * The organizer leads the avatar row whether or not they hold a `ride_members`
 * row — they are on the ride by construction — and is de-duplicated against the
 * crew so organising *and* RSVPing does not draw them twice.
 *
 * `attendance` follows the same rule: an explicit row wins, and an organizer
 * without one reads as `going`. The alternative is a blank pill on a ride you
 * created yourself, which is not a state the design draws.
 */
export function toRideListItem(
  row: RideRow,
  viewerId: string | undefined,
  now: number
): RideListItem {
  const crew = row.riders ?? []
  const others = crew.filter((member) => member.user_id !== row.organizer_id)

  const riders = [
    row.organizer,
    ...others.map((member) => member.profile),
  ].filter((profile): profile is PublicProfile => !!profile)

  const ownRow = viewerId ? crew.find((member) => member.user_id === viewerId) : undefined
  const attendance: RideAttendance =
    ownRow?.status ?? (viewerId && viewerId === row.organizer_id ? 'going' : null)

  return {
    id: row.id,
    title: row.title,
    meeting_point: row.meeting_point,
    departure_at: row.departure_at,
    club: row.club,
    organizer: row.organizer,
    riders: riders.slice(0, RIDE_AVATAR_LIMIT),
    // The organizer counts even when their profile is not readable, which is
    // why this is not `riders.length`.
    riders_count: others.length + 1,
    attendance,
    is_upcoming: new Date(row.departure_at).getTime() >= now,
  }
}

/**
 * The **upcoming** ride ids this viewer has RSVP'd to.
 *
 * The `departure_at` bound is not cosmetic. These ids go into an `id.in.(...)`
 * predicate, so an unbounded read puts every ride the rider has ever joined
 * into the query string: at ~37 bytes a UUID, a few hundred joined rides
 * crosses the usual 8 KB request-line limit and `/rides?filter=mine` starts
 * returning 414 — the rider's most-used filter, failing hard, only for the
 * riders who use the app most. `rides!inner` makes it a join so the cutoff can
 * apply to the parent, and it is the *same* cutoff the outer query uses.
 *
 * Filtering on `user_id` is business logic, not a re-filter of RLS: the
 * ride_members SELECT policy scopes *visibility* (rosters of rides you can
 * see), so "which of these are mine" is a question it has no opinion on —
 * the same distinction attachLikeState draws in lib/data/postcards.ts.
 */
async function myUpcomingRideIds(
  supabase: DataClient,
  viewerId: string | undefined,
  nowIso: string
): Promise<string[]> {
  if (!viewerId) return []

  const rows = unwrapList(
    await supabase
      .from('ride_members')
      .select('ride_id, rides!inner(departure_at)')
      .eq('user_id', viewerId)
      .gte('rides.departure_at', nowIso)
      .limit(RIDE_FILTER_SCAN_LIMIT),
    'your rides',
  )
  return rows.map((row) => row.ride_id)
}

/**
 * Upcoming rides, soonest first.
 *
 * Deliberately has no `is_public` filter. The v1 page carried one, and it was a
 * bug rather than a safeguard: the rides SELECT policy already unions public
 * with "organised by you" and "belongs to a club you are in", so `is_public`
 * here *subtracted* from what the policy allows — a member of a private club
 * could not see their own club's rides, and nor could you see a private ride
 * you had created. Restating a policy predicate in application code is the
 * exact drift 009 warns about; the only correct place for it is the policy.
 */
export async function getRides(
  filter?: RideFilter,
  limit = RIDES_PAGE_SIZE
): Promise<RideListItem[]> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  // One clock reading for the whole response: the cutoff the query applies and
  // the `is_upcoming` each card carries must be the same instant, or a ride
  // departing this second can arrive already flagged as past.
  const now = Date.now()

  let query = supabase
    .from('rides')
    .select(RIDE_SELECT)
    .gte('departure_at', new Date(now).toISOString())
    .order('departure_at', { ascending: true })
    .limit(limit)

  if (filter?.kind === 'club') {
    query = query.eq('club_id', filter.id)
  } else if (filter?.kind === 'mine') {
    if (!user) return []
    const joined = await myUpcomingRideIds(supabase, user.id, new Date(now).toISOString())
    // `id.in.()` with an empty list is a syntax error, so a rider who has
    // joined nothing asks only about the rides they organise.
    query = joined.length
      ? query.or(`organizer_id.eq.${user.id},id.in.(${joined.join(',')})`)
      : query.eq('organizer_id', user.id)
  }

  const rows = unwrapList(await query, 'the rides list') as unknown as RideRow[]

  // Before mapping, not after: `toRideListItem` copies profile objects into
  // `riders`, and resolving afterwards would sign the originals while the card
  // rendered the copies. Same object identity either way here — the copies are
  // references — but relying on that is a trap the next edit springs.
  // The club is deliberately absent here. `RideCard` draws it as a text chip,
  // not an avatar, so selecting and signing a club image for every row in the
  // list would be a round trip for something nothing renders — the same reason
  // the postcard deck embeds `id, name`. The three surfaces that *do* draw a
  // club image are the ride detail chip and the two filter bars.
  await resolveAvatarUrls(
    rows.flatMap((row) => [row.organizer, ...(row.riders ?? []).map((member) => member.profile)]),
    supabase
  )

  return rows.map((row) => toRideListItem(row, user?.id, now))
}

/**
 * One ride, for `/rides/[id]`.
 *
 * Returns `null` for both "no such ride" and "you may not see this one", and
 * that conflation is deliberate: PostgREST answers a row hidden by RLS exactly
 * as it answers a row that does not exist, and telling the two apart in the UI
 * would leak the existence of private rides to anyone who can guess a UUID. The
 * page renders `notFound()` either way.
 *
 * `maybeSingle` rather than `single`, because `single` treats zero rows as a
 * query *error* — which `unwrap` would then correctly throw on, turning every
 * stale ride link into a 500 instead of a 404.
 *
 * **The crew is not read here at all.** An earlier version embedded every
 * `ride_members` row to derive a headline count, which was unbounded on a table
 * nothing constrains — `max_riders` has never been enforced — and produced a
 * number labelled "going" that also counted `maybe`, contradicting the crew
 * page one tap away. Both problems were the same mistake: deriving a summary
 * from a full roster read that this screen does not otherwise need. The crew
 * page owns the roster and its two counts; this page links to it.
 *
 * That leaves one thing to fetch, the viewer's own RSVP, which is a primary-key
 * lookup on `(ride_id, user_id)` rather than a scan.
 */
export async function getRide(id: string): Promise<RideDetail | null> {
  // A non-UUID segment reaches `.eq('id', …)` as `22P02`, which PostgREST turns
  // into a 400 and `unwrap` throws — so `/rides/new/crew` answered 500 instead
  // of 404. Returning null routes it through the same `notFound()` a hidden
  // ride gets, which is both honest and leaks nothing new.
  if (!rideIdSchema.safeParse(id).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const [rideResult, ownResult] = await Promise.all([
    supabase
      .from('rides')
      .select(`
        id, title, description, route_description, meeting_point, departure_at,
        max_riders, club_id, organizer_id,
        organizer:profiles!organizer_id(${PUBLIC_PROFILE_COLUMNS}),
        club:clubs(${CLUB_EMBED_COLUMNS})
      `)
      .eq('id', id)
      .maybeSingle(),
    // A separate read rather than a filtered embed: `ride_members!inner` scoped
    // to this viewer would drop the ride itself for anyone who has not RSVP'd,
    // turning "no answer yet" into a 404.
    user
      ? supabase
          .from('ride_members')
          .select('status')
          .eq('ride_id', id)
          .eq('user_id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const row = unwrap(rideResult, 'this ride') as unknown as
    | Omit<RideDetail, 'attendance' | 'is_organizer' | 'is_upcoming'>
    | null

  if (!row) return null

  const ownRow = unwrap(ownResult, 'your RSVP') as { status: 'going' | 'maybe' } | null
  const isOrganizer = !!user && user.id === row.organizer_id

  await resolveAvatarUrls([row.organizer, row.club], supabase)

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    route_description: row.route_description,
    meeting_point: row.meeting_point,
    departure_at: row.departure_at,
    max_riders: row.max_riders,
    club_id: row.club_id,
    organizer_id: row.organizer_id,
    organizer: row.organizer,
    club: row.club,
    // Same rule as the list card: an explicit row wins, and an organizer
    // without one reads as `going` rather than as unanswered.
    attendance: ownRow?.status ?? (isOrganizer ? 'going' : null),
    is_organizer: isOrganizer,
    is_upcoming: new Date(row.departure_at).getTime() >= Date.now(),
  }
}

/**
 * The crew roster for `/rides/[id]/crew`, split the way the design's two
 * sections are: `Going` and `May be going`.
 *
 * There is no block filtering here and there must not be. 009 put
 * `private.is_blocked` on the `ride_members` SELECT policy itself, so a blocked
 * rider is already absent from the rows this reads — re-filtering in
 * application code would be a second copy of that rule, free to drift, and is
 * the same mistake as the `is_public` filter this file's header describes.
 *
 * A rider who declined is not a third section: `No` deletes the row, so the
 * only states a roster can hold are the two the design draws.
 *
 * Bounded — see `RIDE_CREW_LIMIT`.
 */
export async function getRideCrew(rideId: string): Promise<RideCrew> {
  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('ride_members')
      .select(`user_id, status, profile:profiles(${PUBLIC_PROFILE_COLUMNS})`)
      .eq('ride_id', rideId)
      .order('joined_at', { ascending: true })
      .limit(RIDE_CREW_LIMIT),
    'this ride crew',
  ) as unknown as {
    user_id: string
    status: 'going' | 'maybe'
    profile: PublicProfile | null
  }[]

  await resolveAvatarUrls(rows.map((row) => row.profile), supabase)

  const going = rows.filter((row) => row.status === 'going')
  const maybe = rows.filter((row) => row.status === 'maybe')

  return {
    going: going.map((row) => ({ user_id: row.user_id, profile: row.profile })),
    maybe: maybe.map((row) => ({ user_id: row.user_id, profile: row.profile })),
  }
}

/**
 * Puts the organizer at the head of `going` and marks them the host.
 *
 * Separate from `getRideCrew` and pure, because it encodes a rule rather than a
 * query: the organizer is on their own ride by construction, whether or not
 * they ever pressed `Yes!`. Reading the roster alone would drop the host off
 * their own crew list — which is the state the design's `Ride host` row exists
 * to draw.
 *
 * De-duplicates, so an organizer who also RSVP'd appears once. If that RSVP was
 * `maybe`, `going` still wins: the design has one host row and it sits in the
 * first section.
 */
export function withOrganizer(
  crew: RideCrew,
  organizerId: string,
  organizer: PublicProfile | null
): RideCrew {
  const host: RideCrewMember = {
    user_id: organizerId,
    profile: organizer ?? crew.going.concat(crew.maybe).find((m) => m.user_id === organizerId)?.profile ?? null,
    is_host: true,
  }

  return {
    going: [host, ...crew.going.filter((member) => member.user_id !== organizerId)],
    maybe: crew.maybe.filter((member) => member.user_id !== organizerId),
  }
}

type FilterRow = {
  id: string
  organizer_id: string
  club: EmbeddedClub | null
}

/**
 * The tiles above the list: your rides, all rides, then one per club.
 *
 * Read through `rides` rather than `clubs`, so one policy decides both what a
 * tile offers and what the list then shows. Asking `clubs` directly would be a
 * second visibility predicate to keep in step — and it would offer club tiles
 * with no rides behind them, which the design's empty frame explicitly does not
 * draw.
 *
 * Scanned over RIDE_FILTER_SCAN_LIMIT, **not** the list's page size — see the
 * constant for why the two must not be the same number.
 */
export async function getRideFilters(limit = RIDE_FILTER_SCAN_LIMIT): Promise<RideFilters> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const nowIso = new Date().toISOString()

  const [rows, joined] = await Promise.all([
    (async () =>
      unwrapList(
        await supabase
          .from('rides')
          .select(`id, organizer_id, club:clubs(${CLUB_EMBED_COLUMNS})`)
          .gte('departure_at', nowIso)
          .order('departure_at', { ascending: true })
          .limit(limit),
        'your ride filters',
      ) as unknown as FilterRow[])(),
    myUpcomingRideIds(supabase, user?.id, nowIso),
  ])

  // The club tiles draw the club's avatar, so they need the same signing pass
  // the cards get. Before the loop, because the loop copies `avatar_url` into
  // each tile and a pass afterwards would sign rows nothing reads again.
  await resolveAvatarUrls(rows.map((row) => row.club), supabase)

  const joinedIds = new Set(joined)
  const clubs = new Map<string, RideFilterOption>()
  let mine = 0

  for (const row of rows) {
    if (user && (row.organizer_id === user.id || joinedIds.has(row.id))) mine += 1

    // A ride with no club is not an unnamed club — it has no tile, the same way
    // a null club_id on a postcard is the app-wide feed.
    if (row.club) {
      const existing = clubs.get(row.club.id)
      if (existing) existing.count += 1
      else
        clubs.set(row.club.id, {
          id: row.club.id,
          name: row.club.name,
          imageUrl: row.club.avatar_url,
          count: 1,
        })
    }
  }

  return {
    mine,
    total: rows.length,
    collage: await collageAvatars(supabase, rows),
    clubs: [...clubs.values()],
  }
}

/**
 * The "All rides" tile's 2×2.
 *
 * The design fills it with ride photos; `rides` has no image column, so it is
 * the organizers' faces instead — real data in the right shape, rather than
 * four grey squares that would read as "empty". See docs/FIGMA-FIDELITY-TODO.md.
 *
 * Its own query rather than an embed on the scan above, because the scan now
 * covers up to 500 rows and this needs four faces: embedding `profiles` on
 * every scanned ride to read four avatars is 496 joins of pure waste.
 */
async function collageAvatars(
  supabase: DataClient,
  rows: FilterRow[]
): Promise<string[]> {
  const organizerIds = [...new Set(rows.map((row) => row.organizer_id))].slice(0, 4)
  if (organizerIds.length === 0) return []

  const profiles = unwrapList(
    await supabase.from('profiles').select('id, avatar_path').in('id', organizerIds),
    'the ride filter avatars',
  ) as { id: string; avatar_path: string | null; avatar_url?: string | null }[]

  // Signed like every other avatar. Missed on the first pass, and the miss was
  // invisible rather than loud: back when `avatar_url` was a column it was NULL
  // on every row, so the tile rendered zero faces and looked like a design that
  // simply has no collage — not like a bug. It is a synthesised field now, so
  // skipping this pass leaves it undefined on every profile instead.
  await resolveAvatarUrls(profiles, supabase)

  // Kept in ride order — soonest first — rather than the order Postgres
  // returned the profiles in.
  const byId = new Map(profiles.map((profile) => [profile.id, profile.avatar_url]))
  return organizerIds
    .map((id) => byId.get(id))
    .filter((url): url is string => !!url)
}
