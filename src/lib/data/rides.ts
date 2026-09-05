import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { CLUB_EMBED_COLUMNS, CLUB_FILTER_EMBED_COLUMNS, MEMBER_PROFILE_EMBED, PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { myClubIds, type RiderPosition } from '@/lib/data/clubs'
import { distanceKm } from '@/lib/location/distance'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
import { clubIdSchema } from '@/lib/validation/clubs'
import { rideIdSchema } from '@/lib/validation/rides'
import { resolveAvatarUrls, resolveClubImageUrls, resolveRideMapUrls } from '@/lib/data/media'
import { rideDayStartUtc } from '@/lib/utils'
import type {
  ClubFilterEmbed,
  EmbeddedClub,
  PublicProfile,
  RecentRideStart,
  Ride,
  RideAttendance,
  RideCrew,
  RideCrewMember,
  RideDetail,
  RideFilter,
  RideFilterOption,
  RideFilters,
  RideForEdit,
  RideList,
  RideListItem,
} from '@/types'


/**
 * Provisional, and bounded on purpose. The design does not say whether the list
 * pages or infinite-scrolls, but unbounded it would select every ride the
 * viewer can see on every render — the same trap FEED_PAGE_SIZE closes for
 * postcards.
 */
export const RIDES_PAGE_SIZE = 30

/**
 * How many **previous** rides `/rides` carries under its own header, and
 * deliberately smaller than a page of upcoming ones.
 *
 * The two windows are not symmetrical. Upcoming rides are a plan and there are
 * only ever as many as riders have scheduled; past rides accumulate for
 * ever, so an unbounded read grows without limit on a screen whose purpose is
 * still "what am I riding next". Twenty is roughly a season of Sundays — enough
 * to answer "where did we go last month" from the list itself, and short enough
 * that the section stays a footnote to the list rather than becoming it.
 *
 * Beyond this the section truncates rather than misleads, which is the same
 * saturating trade `RIDE_FILTER_SCAN_LIMIT` and `RIDE_CREW_LIMIT` make. Real
 * history wants a screen of its own with pagination; this is the label the
 * design asks for, not that screen.
 */
export const PAST_RIDES_PAGE_SIZE = 20

/**
 * How many rows `/rides/explore` scans before excluding the viewer's own rides
 * and slicing back to `RIDES_PAGE_SIZE`.
 *
 * **Headroom, not a bigger page.** The exclusion cannot run in Postgres — it is
 * checked against the fetched page on purpose, see `getExploreRides` — so the
 * rider's own rides are paid for out of the limit, and they are precisely the
 * rows that sort to the front of "soonest first". Half a page again is enough
 * that a rider on every one of the next fifteen public rides still gets a full
 * screen rather than an empty state.
 *
 * Deliberately a ratio of `RIDES_PAGE_SIZE` rather than an independent number,
 * so the two cannot drift into the shape where the scan is *smaller* than the
 * page it feeds.
 */
export const EXPLORE_RIDES_SCAN_LIMIT = Math.ceil(RIDES_PAGE_SIZE * 1.5)

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
 * How much of a crew `/rides/detail/crew` will read, and **not** because a
 * motorcycle ride has 200 riders.
 *
 * **Nothing bounds `ride_members` in the database, and since `077` (PD-293)
 * nothing ever did for long.** `063` capped a crew at `rides.max_riders` for
 * six days; `077` dropped both the column and the trigger, because a cap the
 * design never draws is a refusal a rider cannot see coming. So this constant
 * is the ONLY ceiling on what this screen reads, which is the thing worth
 * stating: unbounded, the crew read selects every row plus a joined profile
 * each and renders one list item per row with no virtualisation, on a 390px
 * screen.
 *
 * Beyond this the list truncates rather than misleads — the same saturating
 * trade `RIDE_FILTER_SCAN_LIMIT` makes above, and the honest one until
 * pagination gets a design.
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
/**
 * `map_card_path`, plus the coordinate pair — and `geocode_confidence` and
 * `map_detail_path` are still deliberately absent.
 *
 * **`latitude` and `longitude` are selected now because something finally reads
 * them** (PD-260). Nothing draws them — decision #3 is a static thumbnail, so
 * there is still no client-side map to hand a coordinate to — but the near-you
 * strip measures against them, so they are the query's outputs rather than only
 * the render function's inputs. The other two remain out under the rule that
 * survives this change unaltered: selecting a column nothing reads is a column
 * the next rename has to find.
 *
 * **A NULL pair is the ordinary case, not a fault.** Every ride created before
 * `resolve-ride-location` deployed carries one, and so does any ride whose
 * geocode failed. `distanceKm` answers `null` for it and `isNearby` therefore
 * answers false — a ride with no coordinate is never near anything, and must
 * never be counted as though it were.
 */
const RIDE_SELECT = `
  id, title, meeting_point, departure_at, created_at, timezone, organizer_id, map_card_path,
  latitude, longitude,
  organizer:profiles!organizer_id(${PUBLIC_PROFILE_COLUMNS}),
  club:clubs(id, name),
  riders:ride_members(user_id, status, ${MEMBER_PROFILE_EMBED})
`

export type RideRow = {
  id: string
  title: string
  meeting_point: string
  departure_at: string
  /** When the ride was ANNOUNCED — see `RideListItem.created_at`. */
  created_at: string
  /** `080`'s zone for the meeting point, NULL when the ride does not carry one.
   *  Every `formatRide*` call on this row takes it — see `rideZone`. */
  timezone: string | null
  organizer_id: string
  map_card_path: string | null
  /** `051`'s pair, null on any ride the geocoder never resolved. */
  latitude: number | null
  longitude: number | null
  /** Synthesised by `resolveRideMapUrls`, never selected — see `avatar_url`. */
  map_card_url?: string | null
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
  dayStartMs: number
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
    created_at: row.created_at,
    timezone: row.timezone,
    club: row.club,
    latitude: row.latitude,
    longitude: row.longitude,
    organizer: row.organizer,
    riders: riders.slice(0, RIDE_AVATAR_LIMIT),
    // The organizer counts even when their profile is not readable, which is
    // why this is not `riders.length`.
    riders_count: others.length + 1,
    // Whatever `resolveRideMapUrls` wrote onto the row, and null when it wrote
    // nothing — a ride with no tile, or a tile this viewer may not sign. This
    // function stays pure: it copies the field rather than deciding it, the
    // same way it copies `organizer.avatar_url`.
    map_card_url: row.map_card_url ?? null,
    attendance,
    // Against the start of today in APP_TIME_ZONE, never against the clock —
    // see `rideDayStartUtc`, and `RideListItem.is_upcoming` for why the pill
    // and the section header have to be cut at the same instant.
    is_upcoming: new Date(row.departure_at).getTime() >= dayStartMs,
  }
}

/**
 * The **upcoming** ride ids this viewer has RSVP'd to, for the filter bar's
 * "Yours" count.
 *
 * The list itself no longer reads this — `readRides` joins instead, for the
 * reason `mergeMine` gives — and the bound is why this one still can. These ids
 * go into an `id.in.(...)` predicate, so an unbounded read puts every ride the
 * rider has ever joined into the query string: at ~37 bytes a UUID, a few
 * hundred joined rides crosses the usual 8 KB request-line limit and the filter
 * bar starts returning 414. The cutoff keeps it to rides that have not happened
 * yet, which is bounded by what riders actually have planned. `rides!inner`
 * makes it a join so the cutoff can apply to the parent, and it is the *same*
 * cutoff the tile scan uses.
 *
 * Filtering on `user_id` is business logic, not a re-filter of RLS: the
 * ride_members SELECT policy scopes *visibility* (rosters of rides you can
 * see), so "which of these are mine" is a question it has no opinion on —
 * the same distinction attachLikeState draws in lib/data/postcards.ts.
 */
async function myUpcomingRideIds(
  supabase: DataClient,
  viewerId: string | undefined,
  fromIso: string
): Promise<string[]> {
  if (!viewerId) return []

  const rows = unwrapList(
    await supabase
      .from('ride_members')
      .select('ride_id, rides!inner(departure_at)')
      .eq('user_id', viewerId)
      .gte('rides.departure_at', fromIso)
      .limit(RIDE_FILTER_SCAN_LIMIT),
    'your rides',
  )
  return rows.map((row) => row.ride_id)
}

/** Which side of today a read wants, and how it therefore sorts. */
export type RideWindow = { from: string } | { before: string }

/**
 * A rides read before its window is applied.
 *
 * Named through the client rather than by importing PostgREST's builder types,
 * which are five generic parameters wide and would mean importing from
 * `@supabase/supabase-js` in a file whose whole job is to go through
 * `resolveSupabase`.
 */
function ridesQuery(supabase: DataClient, select: string) {
  return supabase.from('rides').select(select)
}

type RidesQuery = ReturnType<typeof ridesQuery>

/**
 * Applies the day boundary and the ordering that goes with it.
 *
 * The two windows sort in opposite directions, and both sort *away from today*:
 * upcoming is soonest-first because the next ride is the one being looked for,
 * past is newest-first because the last ride is. Sorting past rides
 * ascending would put the oldest ride the list is allowed to carry at the top
 * and truncate the recent ones, which is the wrong end of the history.
 *
 * Filters go on before this: `.order()` returns a transform builder, so a
 * `.eq()` chained after it does not type-check.
 */
function inWindow(query: RidesQuery, window: RideWindow, limit: number) {
  return 'from' in window
    ? query.gte('departure_at', window.from).order('departure_at', { ascending: true }).limit(limit)
    : query.lt('departure_at', window.before).order('departure_at', { ascending: false }).limit(limit)
}

/**
 * The two arms of the `mine` filter, merged.
 *
 * A rider's rides are the ones they organise plus the ones they hold a
 * `ride_members` row on, and those are two different queries. Each arm is
 * ordered and bounded by Postgres, so the union of two correctly-ordered
 * `limit`-length lists contains the true first `limit` of the whole — which is
 * what makes merging in JS honest rather than a sample.
 *
 * **This replaced an id list, and the reason is the past-rides window.** The
 * old shape read the viewer's joined ride ids and put them in an `id.in.(...)`
 * predicate, which is bounded only by how many rides they have joined: at ~37
 * bytes a UUID a few hundred crosses the usual 8 KB request-line limit and the
 * filter starts answering 414. Upcoming rides kept that small by accident —
 * there are only so many rides ahead of you — and past rides have no such
 * ceiling, they are every ride the rider has ever been on. Two joins instead of
 * one predicate removes the hazard from both windows rather than working around
 * it in one.
 */
export function mergeMine(rows: RideRow[], window: RideWindow, limit: number): RideRow[] {
  // An organizer who also RSVP'd is on both arms, and is one ride.
  const byId = new Map<string, RideRow>()
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row)

  const ascending = 'from' in window
  return [...byId.values()]
    .sort((a, b) => {
      const delta = new Date(a.departure_at).getTime() - new Date(b.departure_at).getTime()
      return ascending ? delta : -delta
    })
    .slice(0, limit)
}

/**
 * One window of the rides list, under whichever filter is active.
 *
 * Deliberately has no `is_public` filter. The v1 page carried one, and it was a
 * bug rather than a safeguard: the rides SELECT policy already unions public
 * with "organised by you" and "belongs to a club you are in", so `is_public`
 * here *subtracted* from what the policy allows — a member of a private club
 * could not see their own club's rides, and nor could you see a private ride
 * you had created. Restating a policy predicate in application code is the
 * exact drift 009 warns about; the only correct place for it is the policy.
 *
 * **`getExploreRides` is the one read that DOES carry `is_public`, and it is
 * not a counter-example.** There the word is the product's own — the strip says
 * *Explore public rides* — so the predicate is what the screen promises rather
 * than a restatement of a policy. It also only ever narrows what RLS already
 * returned, which is the property that keeps every filter in this file unable
 * to disclose a row.
 *
 * ## The default arm is `From clubs`, not "every ride"
 *
 * Product owner, 2026-08-27. The unfiltered tab used to be every ride RLS would
 * hand over — which included the rides the viewer organises and the ones they
 * had already RSVP'd to, so the tab and `Your rides` overlapped almost
 * completely, and there was no screen anywhere for *finding* a ride. The tab is
 * now the rides from the clubs this rider has joined, and discovery moved to
 * `/rides/explore`.
 *
 * A ride with no club is therefore **not** on the default tab. That is the
 * intended reading rather than an omission: a clubless ride is either the
 * rider's own — `Your rides` has it — or a stranger's, and a stranger's ride is
 * what Explore is for.
 */
async function readRides(
  supabase: DataClient,
  filter: RideFilter | undefined,
  viewerId: string | undefined,
  window: RideWindow,
  limit: number,
  /**
   * The viewer's club ids, resolved **once** by `getRides` and handed to both
   * windows — not read here.
   *
   * `myClubIds` is capped with no `order by`, so two calls may legitimately
   * answer with two different arbitrary subsets. Read per window, the upcoming
   * and past sections of one screen could therefore be drawn from different
   * club sets: the cap's own rule is *fewer rows, never wrong ones*, and it
   * holds per call rather than across three of them. One read is what makes it
   * hold for the screen, and it saves two round trips on the way.
   */
  clubIds: string[]
): Promise<RideRow[]> {
  const rides = () => ridesQuery(supabase, RIDE_SELECT)

  if (filter?.kind === 'club') {
    return unwrapList(
      await inWindow(rides().eq('club_id', filter.id), window, limit),
      'the rides list',
    ) as unknown as RideRow[]
  }

  if (filter?.kind === 'mine') {
    if (!viewerId) return []

    const [organized, joined] = await Promise.all([
      inWindow(rides().eq('organizer_id', viewerId), window, limit),
      // A second embed of `ride_members`, aliased and `!inner`, so the join
      // filters the rides rather than the crew. `riders:` above still embeds the
      // whole roster — two aliases of one relation, which resolves unambiguously
      // because `ride_members` has exactly one FK to `rides`.
      inWindow(
        ridesQuery(supabase, `${RIDE_SELECT}, mine:ride_members!inner(user_id)`)
          .eq('mine.user_id', viewerId),
        window,
        limit,
      ),
    ])

    const rows = [
      ...unwrapList(organized, 'the rides you organise'),
      ...unwrapList(joined, 'your rides'),
    ] as unknown as RideRow[]

    return mergeMine(rows, window, limit)
  }

  // No filter — the `From clubs` tile. An id list rather than a nested
  // `club_members!inner` embed, because `myClubIds` is the shape `getYourClubs`
  // and `getExploreClubs` already ship and a two-level embedded filter is one
  // more PostgREST behaviour to be sure of. It is bounded at
  // `CLUB_MEMBERSHIP_LIMIT`, so the degradation past that many memberships is
  // *fewer* rides, never somebody else's — the rule that constant carries.
  //
  // 100 UUIDs in `club_id=in.(…)` is ~3.9 KB encoded against the usual 8 KB
  // request line, so the cap that bounds the subset also bounds the URL — the
  // hazard `mergeMine`'s header records, with about half the budget spare.
  if (!viewerId || clubIds.length === 0) return []

  return unwrapList(
    await inWindow(rides().in('club_id', clubIds), window, limit),
    'rides from your clubs',
  ) as unknown as RideRow[]
}

/**
 * The rides list, in the two sections `/rides` draws: upcoming, then previous.
 *
 * **One clock reading for the whole response.** The cutoff both queries apply
 * and the `is_upcoming` every card carries are the same instant, so a ride
 * cannot arrive in the upcoming half already flagged as past — and, since the
 * cutoff is midnight rather than now, cannot cross it while the two queries are
 * in flight either.
 */
export async function getRides(
  filter?: RideFilter,
  limit = RIDES_PAGE_SIZE
): Promise<RideList> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const dayStart = rideDayStartUtc()
  const dayStartMs = new Date(dayStart).getTime()

  // Once, before both windows — see `readRides`'s `clubIds` parameter for why
  // the two must be handed the same list rather than each reading its own.
  // Only the unfiltered arm consults it, so the read is skipped entirely for
  // `mine` and `club`.
  const clubIds = !filter && user ? await myClubIds(supabase, user.id) : []

  const [upcomingRows, pastRows] = await Promise.all([
    readRides(supabase, filter, user?.id, { from: dayStart }, limit, clubIds),
    readRides(supabase, filter, user?.id, { before: dayStart }, PAST_RIDES_PAGE_SIZE, clubIds),
  ])

  const rows = [...upcomingRows, ...pastRows]

  // Before mapping, not after: `toRideListItem` copies profile objects into
  // `riders`, and resolving afterwards would sign the originals while the card
  // rendered the copies. Same object identity either way here — the copies are
  // references — but relying on that is a trap the next edit springs.
  //
  // Both windows in one pass rather than one pass each: `createSignedUrls`
  // takes a list, so signing them together is one round trip instead of two,
  // and the rows are the same objects the two arrays hold.
  //
  // The club is deliberately absent here. `RideCard` draws it as a text chip,
  // not an avatar, so selecting and signing a club image for every row in the
  // list would be a round trip for something nothing renders — the same reason
  // the postcard deck embeds `id, name`. The three surfaces that *do* draw a
  // club image are the ride detail chip and the two filter bars.
  //
  // Concurrent, because the two are independent and each is its own
  // `createSignedUrls` call.
  await Promise.all([
    resolveAvatarUrls(
      rows.flatMap((row) => [row.organizer, ...(row.riders ?? []).map((member) => member.profile)]),
      supabase
    ),
    resolveRideMapUrls(rows, supabase),
  ])

  return {
    upcoming: upcomingRows.map((row) => toRideListItem(row, user?.id, dayStartMs)),
    past: pastRows.map((row) => toRideListItem(row, user?.id, dayStartMs)),
  }
}

/**
 * One ride, for `/rides/detail`.
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
 * nothing constrained — and still is for the uncapped rides `063` leaves
 * untouched, per `RIDE_CREW_LIMIT` above — and produced a
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
      // `map_detail_path` only, for the reason RIDE_SELECT gives: this screen
      // draws the 358×160 panel and nothing else `051` added.
      .select(`
        id, title, description, route_description, meeting_point, departure_at,
        created_at, timezone, club_id, organizer_id, map_detail_path,
        latitude, longitude,
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
    | (Omit<
        RideDetail,
        'attendance' | 'is_organizer' | 'is_upcoming' | 'is_crew' | 'map_detail_url'
      > & {
        map_detail_path: string | null
        /** Synthesised by `resolveRideMapUrls` — see `avatar_url`. */
        map_detail_url?: string | null
      })
    | null

  if (!row) return null

  const ownRow = unwrap(ownResult, 'your RSVP') as { status: 'going' | 'maybe' } | null
  const isOrganizer = !!user && user.id === row.organizer_id

  // Concurrent and independent — see `getRides`. The tile pass issues no
  // request at all while `map_detail_path` is NULL, which is every ride today.
  await Promise.all([
    resolveAvatarUrls([row.organizer, row.club], supabase),
    resolveRideMapUrls([row], supabase),
  ])

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    route_description: row.route_description,
    meeting_point: row.meeting_point,
    departure_at: row.departure_at,
    // When the ride was ANNOUNCED, which is not when it departs — PD-393's
    // timeline floor. `RideListItem.created_at` carries the same distinction
    // and the same warning.
    created_at: row.created_at,
    timezone: row.timezone,
    club_id: row.club_id,
    organizer_id: row.organizer_id,
    organizer: row.organizer,
    club: row.club,
    // `051`'s pair, for the location row's `12 km away` (PD-340). Copied rather
    // than measured here: `getRide` takes no position, so the distance is the
    // screen's to compute against whatever the rider's position turns out to be.
    latitude: row.latitude,
    longitude: row.longitude,
    // Same rule as the list card: an explicit row wins, and an organizer
    // without one reads as `going` rather than as unanswered.
    attendance: ownRow?.status ?? (isOrganizer ? 'going' : null),
    map_detail_url: row.map_detail_url ?? null,
    is_organizer: isOrganizer,
    // The day boundary, not the clock — the same cutoff the list cuts its two
    // sections at, so a ride cannot read "Going" on the list and "Rode" here.
    // It also means a rider can still answer for a ride that left this
    // morning, which no policy refuses.
    is_upcoming: new Date(row.departure_at).getTime() >= new Date(rideDayStartUtc()).getTime(),
    is_crew: isRideCrew(isOrganizer, ownRow?.status ?? null),
  }
}

/**
 * One ride, for `/rides/detail/edit` (PD-101). Narrower than `getRide` — no
 * RSVP read, no `is_upcoming` — and returns the editable columns rather than
 * the display shape.
 *
 * `null` is the same conflation `getRide` makes: no such ride, or one this
 * viewer's RLS hides. `is_organizer` is computed here, the same way
 * `getRide`'s is, so the edit screen can tell "not found" from "not yours"
 * without a second `auth.getUser()` round trip — the ride SELECT policy
 * already admits crew and club members who are not the organizer, so a row
 * coming back is not by itself permission to edit it.
 *
 * `club` can be null while `club_id` is not: the ride's club policy is its
 * own, and an organizer who has left a private club they still organise a
 * ride in no longer satisfies it (`ride-lifecycle`'s ex-member requirement).
 * The edit form must read that as "name unknown", never as "no club" — only
 * `club_id` says which one it is.
 */
export async function getRideForEdit(id: string): Promise<RideForEdit | null> {
  if (!rideIdSchema.safeParse(id).success) return null

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const result = await supabase
    .from('rides')
    .select(`
      id, title, route_description, meeting_point, departure_at,
      timezone, is_public, club_id, organizer_id,
      start_place_id, latitude, longitude,
      club:clubs(id, name)
    `)
    .eq('id', id)
    .maybeSingle()

  const row = unwrap(result, 'this ride') as unknown as Omit<RideForEdit, 'is_organizer'> | null
  if (!row) return null

  return { ...row, is_organizer: !!user && user.id === row.organizer_id }
}

/**
 * `private.is_ride_crew`'s two arms — organizer, or a `ride_members` row of
 * **either** status — as one named, tested expression.
 *
 * Pure and exported for the same reason `toRideListItem` and `withOrganizer`
 * are: it is a rule rather than a query, so it is the part worth asserting. It
 * mirrors a predicate that lives in Postgres and can narrow there — `maybe`
 * losing chat access, or the organizer arm going with
 * `enforce-creator-membership` — and until 2026-08-07 it was spelled out by
 * hand in three page files, where a narrowing would have been applied to two of
 * them with `tsc` green either way.
 *
 * Takes the raw RSVP rather than `RideDetail['attendance']`, which already
 * folds the organizer in: reading the folded field would make one arm redundant
 * by coincidence, and one edit to that fallback would silently change what this
 * means.
 *
 * **Sound only after the rides policy has been passed.** `034`'s SELECT is
 * `EXISTS(rides under the caller's RLS) AND is_ride_crew(...)`, and `getRide`
 * returns null for a ride this viewer may not see, so the caller has already
 * cleared the first half. Membership alone is the trap `034`'s header names —
 * a `ride_members` row outlives a club membership, so an ex-member's row would
 * otherwise reopen a private club ride's chat. Never call this without that
 * check in front of it.
 *
 * **A UX affordance, never the enforcement.** A rider who defeats it reaches a
 * thread whose every query returns nothing and whose every send is refused.
 */
export function isRideCrew(isOrganizer: boolean, attendance: RideAttendance): boolean {
  return isOrganizer || attendance !== null
}

/**
 * The crew roster for `/rides/detail/crew`, split the way the design's two
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
  // An empty crew, not a throw: `.eq('ride_id', <not a uuid>)` is a guaranteed
  // `22P02`, which `unwrapList` turns into an error boundary. The screen already
  // reaches `notFound()` because `getRide` refuses the same id without any I/O,
  // but that is resolution order rather than a gate — this read is issued in
  // parallel and must not depend on losing a race.
  if (!rideIdSchema.safeParse(rideId).success) return { going: [], maybe: [] }

  const supabase = await resolveSupabase()

  const rows = unwrapList(
    await supabase
      .from('ride_members')
      .select(`user_id, status, ${MEMBER_PROFILE_EMBED}`)
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
  club: ClubFilterEmbed | null
}

/**
 * The tiles above the list: your rides, the clubs you are in as one tile, then
 * one tile per club.
 *
 * Read through `rides` rather than `clubs`, so one policy decides both what a
 * tile offers and what the list then shows. Asking `clubs` directly would be a
 * second visibility predicate to keep in step — and it would offer club tiles
 * with no rides behind them, which the design's empty frame explicitly does not
 * draw.
 *
 * ## Two scans, because the two counts are no longer the same question
 *
 * `From clubs` replaced `All rides` on 2026-08-27, so the tile scan is narrowed
 * to the rider's own clubs. That breaks the old arithmetic, which derived the
 * `Your rides` count from the very same rows: a ride the rider organises in no
 * club at all is not in this scan and never was in that club, so counting it
 * off the scan would report zero for a rider whose whole riding life is
 * clubless. The `mine` count is therefore its own pair of reads, unioned by id
 * — the union matters, because organising a ride *and* RSVPing to it is one
 * ride and two rows.
 *
 * Scanned over RIDE_FILTER_SCAN_LIMIT, **not** the list's page size — see the
 * constant for why the two must not be the same number.
 */
export async function getRideFilters(limit = RIDE_FILTER_SCAN_LIMIT): Promise<RideFilters> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  // The same boundary the list's upcoming section uses, not `now`: a tile
  // reading "2" above a section showing 3 rides is the mismatch that made
  // RIDE_FILTER_SCAN_LIMIT its own constant, arrived at from the time axis
  // instead of the row-count one.
  const dayStart = rideDayStartUtc()

  const clubIds = user ? await myClubIds(supabase, user.id) : []

  const [rows, organized, joined] = await Promise.all([
    (async () => {
      // No clubs, no scan. `.in('club_id', [])` is a valid query returning
      // nothing, so this is a saved round trip rather than a correctness fix —
      // but it is the ordinary state of a rider who has left the Welcome club.
      if (clubIds.length === 0) return [] as FilterRow[]
      return unwrapList(
        await supabase
          .from('rides')
          .select(`id, organizer_id, club:clubs(${CLUB_FILTER_EMBED_COLUMNS})`)
          .in('club_id', clubIds)
          .gte('departure_at', dayStart)
          .order('departure_at', { ascending: true })
          .limit(limit),
        'your ride filters',
      ) as unknown as FilterRow[]
    })(),
    myUpcomingOrganizedRideIds(supabase, user?.id, dayStart),
    myUpcomingRideIds(supabase, user?.id, dayStart),
  ])

  // The club tiles draw the club's avatar and, since PD-284, its cover behind
  // it — `resolveClubImageUrls` signs both in one pass, unlike
  // `resolveAvatarUrls`, which only ever touches `avatar_path` (see its own
  // header). Before the loop, because the loop copies the signed URLs into
  // each tile and a pass afterwards would sign rows nothing reads again.
  await resolveClubImageUrls(rows.map((row) => row.club), supabase)

  const clubs = new Map<string, RideFilterOption>()

  for (const row of rows) {
    // A ride with no club is not an unnamed club — it has no tile, the same way
    // a null club_id on a postcard is the app-wide feed. It also cannot reach
    // this loop any more, since the scan filters on `club_id`; the branch stays
    // because the embed's type still admits null and a silent `undefined.id` is
    // a worse way to learn that.
    if (row.club) {
      const existing = clubs.get(row.club.id)
      if (existing) existing.count += 1
      else
        clubs.set(row.club.id, {
          id: row.club.id,
          name: row.club.name,
          imageUrl: row.club.avatar_url,
          coverUrl: row.club.cover_image_url,
          count: 1,
        })
    }
  }

  return {
    // A set, not `organized.length + joined.length`: a ride the rider organises
    // and has also RSVP'd to holds a row on both sides and is one ride. The old
    // single-scan version got this right by construction, so the union is where
    // that correctness had to be rebuilt.
    mine: new Set([...organized, ...joined]).size,
    fromClubs: rows.length,
    collage: collageClubImages([...clubs.values()]),
    clubs: [...clubs.values()],
  }
}

/**
 * The **upcoming** ride ids this viewer organises, for the `Your rides` count.
 *
 * The sibling of `myUpcomingRideIds`, and bounded the same way and for the same
 * reason — see that function's header. Ids rather than a `head: true` count
 * because the two sets overlap and only ids can be unioned.
 */
async function myUpcomingOrganizedRideIds(
  supabase: DataClient,
  viewerId: string | undefined,
  fromIso: string
): Promise<string[]> {
  if (!viewerId) return []

  const rows = unwrapList(
    await supabase
      .from('rides')
      .select('id')
      .eq('organizer_id', viewerId)
      .gte('departure_at', fromIso)
      .limit(RIDE_FILTER_SCAN_LIMIT),
    'the rides you organise',
  ) as unknown as { id: string }[]

  return rows.map((row) => row.id)
}

/**
 * The `From clubs` tile's 2×2 — one cell per club the rider is in, up to four.
 *
 * **It draws the clubs, not the organizers, and that is what the tile means.**
 * Until 2026-08-27 this tile was `All rides` and its collage was four organizer
 * faces, which was the right filler for "every ride in the app" and is the
 * wrong one for "the clubs you are in": the tile now sits immediately left of
 * the per-club tiles and reads as *all of these at once*, so it is those clubs
 * that belong in it. That also retires a whole round trip — the faces needed
 * their own `profiles` read, and these images are already on the tiles.
 *
 * A cover before an avatar, because a cover is a photograph and fills a 30px
 * cell legibly where a centred logo does not. A club with neither contributes
 * nothing to the list rather than a grey cell.
 *
 * **Two things this does NOT do, both easy to assume from the shape.** The
 * input is the tile map, which is built from the ride scan — so it is one cell
 * per club with an **upcoming ride**, not per club joined; a club that has
 * scheduled nothing has no tile and no cell, which is the same rule that keeps
 * it out of the bar. And `FilterCollage` fills all four quadrants with
 * `images[i % images.length]`, so fewer than four images **repeat** rather than
 * leaving blanks — one club draws its cover four times. Only an empty list
 * reaches `FilterCollage`'s placeholder, which is the honest picture of a rider
 * whose clubs have uploaded nothing.
 */
export function collageClubImages(clubs: RideFilterOption[]): string[] {
  return clubs
    .map((club) => club.coverUrl ?? club.imageUrl)
    .filter((url): url is string => !!url)
    .slice(0, 4)
}

/**
 * `/rides/explore` — public rides this rider is not already on.
 *
 * The rides sibling of `getExploreClubs`, and deliberately built to the same
 * rules about *bounding* and *exclusion order*, because the two screens are one
 * idea on two tabs.
 *
 * **The exclusions themselves are NOT the same, and the difference is not an
 * oversight.** Explore clubs drops the clubs you have joined; this drops the
 * rides you are *on*, which is what the product owner asked for in those words.
 * It does not drop rides belonging to your clubs — so a public ride in a club
 * you are in, that you have not answered yet, appears here **and** under `From
 * clubs`. That overlap is intended: `From clubs` is what your clubs have
 * planned, this is everything still open to you, and a ride can honestly be
 * both. A rider who has said nothing about a ride has not finished with it, and
 * hiding it from the screen for finding rides would be the narrower reading of
 * the ask, not the more careful one.
 *
 * ## What it excludes, and why the exclusion is not a security predicate
 *
 * Two things come out: rides the viewer **organises**, and rides they hold a
 * `ride_members` row on at any status. Both are already on `Your rides`, and a
 * discovery screen that lists what the rider has already committed to is the
 * defect this function exists to fix — the product owner's words, 2026-08-27:
 * *"exploring rides should not display rides I am already going or that I
 * own."*
 *
 * None of that is enforcement. Every row here already passed the `rides` SELECT
 * policy; this only ever *narrows* what RLS returned, so no arrangement of
 * these predicates can disclose a ride, and the screen needs no policy of its
 * own. `is_public` is in the same category — it is what the strip promises
 * ("Explore **public** rides"), not a restatement of a policy arm.
 *
 * **It is NOT what keeps a private club's ride off this screen, and reading it
 * that way is a trap the policy invites.** `rides.is_public` and
 * `clubs.is_public` are independent columns, and the SELECT policy's second arm
 * is `club_id is not null and private.is_club_member(club_id)` — so a ride
 * flagged public inside a *private* club is visible to that club's members and
 * passes this predicate too. It reaches their Explore list. That is a rider
 * seeing a ride they may genuinely join, so it is neither a leak nor a defect;
 * what it is not is the guarantee the obvious reading of `.eq('is_public',
 * true)` suggests. If Explore ever has to mean "open to anyone signed in", the
 * predicate that expresses it is the club's flag, not the ride's.
 *
 * ## The exclusion is checked against THIS PAGE
 *
 * `getExploreClubs`'s rule, and it is load-bearing for the same reason: the
 * alternative reads the viewer's own ride ids and puts them in a
 * `not.in.(…)` predicate, which is bounded by how many rides they have ever
 * joined — an unbounded set with no `order by`, so past the cap the exclusion
 * list is an arbitrary subset and the rider's own rides start reappearing here
 * with a "Join" affordance that changes nothing. **Wrong rows, not fewer rows**
 * — the one degradation a cap must never produce. Asking "which of these thirty
 * am I on" is bounded by the page instead, so it cannot go wrong at any number
 * of rides.
 *
 * ## Upcoming only, and one page of them
 *
 * A ride that already happened is not a ride to explore, so there is no past
 * window here at all — unlike `getRides`, which draws one under its own header.
 *
 * The page is the **soonest** `RIDES_PAGE_SIZE`, and that bound is visible in
 * the product: a ride near the rider that sits beyond it is not counted and not
 * listed. That is the honest failure rather than a bug, and it is why nothing
 * upstream may derive a near-count any other way — the strip's `near <place>`
 * clause reads this same array, so the row and the screen it leads to cannot
 * disagree. `getExploreClubs` carries the identical property; `PD-254`'s crew
 * count is what both are avoiding.
 *
 * **It scans a page and a half and slices back, and that headroom is the one
 * place this differs from the clubs side.** The exclusion runs *after* the
 * limit, so the rider's own rides consume slots — and unlike a club, a ride the
 * rider is on is exactly the kind of row that sorts to the very front of
 * "soonest first". A rider who organised or RSVP'd to the next thirty public
 * rides would otherwise be told *"There are no public rides to explore, yet!"*
 * directly under a strip that had just invited them to explore. **Short is the
 * honest failure; empty is a different claim**, and the headroom is what keeps
 * a busy rider out of it. It is still a bound and can still be exhausted — a
 * screen with pagination is what actually retires this.
 *
 * **The order stays departure-ascending and is never re-sorted by distance.**
 * The rule, stated once here because nothing else enforces it: a ride is a
 * thing to turn up to on a date, so distance answers *where* and must not
 * reorder *when*. `ExploreRidesList`
 * sections the near ones above the rest and keeps each section in departure
 * order, which is how both questions get answered without either lying.
 */
export async function getExploreRides(near?: RiderPosition | null): Promise<RideListItem[]> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const dayStart = rideDayStartUtc()
  const dayStartMs = new Date(dayStart).getTime()

  const rows = unwrapList(
    await supabase
      .from('rides')
      .select(RIDE_SELECT)
      .eq('is_public', true)
      .gte('departure_at', dayStart)
      .order('departure_at', { ascending: true })
      .limit(EXPLORE_RIDES_SCAN_LIMIT),
    'rides to explore',
  ) as unknown as RideRow[]

  // The organizer arm needs no round trip — `organizer_id` is on the row — so
  // it is applied first and the membership probe only asks about what is left.
  const candidates = rows.filter((row) => row.organizer_id !== user.id)
  const joined = new Set<string>()

  if (candidates.length > 0) {
    const memberships = unwrapList(
      await supabase
        .from('ride_members')
        .select('ride_id')
        .eq('user_id', user.id)
        .in('ride_id', candidates.map((row) => row.id)),
      'your place on these rides',
    ) as unknown as { ride_id: string }[]

    for (const membership of memberships) joined.add(membership.ride_id)
  }

  // Sliced to the page only after the exclusion, so the headroom above buys
  // rides rather than blanks. The rider still sees at most `RIDES_PAGE_SIZE`.
  const keep = candidates.filter((row) => !joined.has(row.id)).slice(0, RIDES_PAGE_SIZE)

  // Signed after the exclusion rather than before it: signing is a round trip
  // per bucket, and a ride the rider is already on is not going to be drawn.
  await Promise.all([
    resolveAvatarUrls(
      keep.flatMap((row) => [row.organizer, ...(row.riders ?? []).map((member) => member.profile)]),
      supabase
    ),
    resolveRideMapUrls(keep, supabase),
  ])

  return keep.map((row) => withRideDistance(toRideListItem(row, user.id, dayStartMs), near))
}

/**
 * Attaches how far a ride's meeting point is from the rider, when both ends of
 * the question have an answer.
 *
 * Exported for the unit tests, like `mergeMine` and `toRideListItem` and for
 * the same reason: it is a whole rule, and there is no other way to cover it
 * without a database.
 *
 * The rule, restated once here — `withDistance`'s twin in `lib/data/clubs.ts`,
 * and the same three-way conflation is deliberate: no position, no coordinate,
 * or the caller did not ask all collapse to `undefined`, because a screen can
 * only do one thing with any of them.
 *
 * A null coordinate pair is the ordinary case, not a fault — every ride created
 * before `resolve-ride-location` deployed has one, and so does any ride whose
 * geocode failed. Such a ride is never near anything and must never be counted
 * as though it were.
 */
export function withRideDistance(item: RideListItem, near?: RiderPosition | null): RideListItem {
  if (!near || item.latitude === null || item.longitude === null) return item
  const km = distanceKm(near, { lat: item.latitude, lon: item.longitude })
  return km === null ? item : { ...item, distance_km: km }
}

/**
 * How many of the rider's own rides the recents read scans before it dedupes.
 *
 * **The bound is on the SCAN, not on the answer** — `RECENT_STARTS_LIMIT` below
 * is what a rider sees. The two differ because the same start is the common
 * case rather than the exception: an organizer who meets their crew at the same
 * café every Sunday has twenty rides and one distinct place, and a read bounded
 * at three would then offer one row and call it "your last three". Twenty is
 * the smallest window that still answers with three distinct places for a rider
 * who alternates between a handful of regular starts, and it is a fixed,
 * index-supported read (`rides_organizer_id_idx`) rather than a growing one.
 *
 * Beyond it the list saturates rather than misleads — the same trade
 * `RIDE_FILTER_SCAN_LIMIT` makes above.
 */
export const RECENT_STARTS_SCAN_LIMIT = 20

/** How many recent starts the field offers. Three — the product owner's. */
export const RECENT_STARTS_LIMIT = 3

/**
 * The rider's own recent start locations, newest first — PD-274, the list the
 * place field shows the moment it is focused with an empty input.
 *
 * **The `organizer_id` filter is the rule, not a redundant belt.** RLS admits
 * every ride this rider may *read* — rides they joined, and their clubs' rides —
 * and offering one of those back as "your recent start" would be offering
 * somebody else's choice. The policy is what stops another rider's rows being
 * readable; this filter is what stops a readable row being treated as a
 * recent.
 *
 * **Only picked starts, which is what makes the shape total.** `067`'s
 * `rides_location_coupling` makes `start_place_id IS NOT NULL` imply a complete
 * coordinate, so the null checks below narrow a nullable column rather than
 * defending against a row the database can produce. A ride whose free text a
 * geocoder resolved carries a confidence and no place id and is not a recent:
 * re-offering a *guess* as the rider's own pick is the same relabelling
 * `getRideForEdit` refuses to do.
 *
 * **Ordered by `created_at`, deliberately, and it is a trade.** That is when
 * the rider *chose* the place; `departure_at` is when the ride happens and can
 * be a year out, so ordering by it would float next summer's plan above this
 * morning's. The accepted cost is that editing an old ride's start does not
 * move it up the list — the row is old even though the choice is fresh.
 *
 * Deduped here rather than in SQL because PostgREST cannot express
 * `DISTINCT ON`, and an RPC for three rows would be a migration this change
 * exists to avoid.
 */
export async function getRecentRideStarts(): Promise<RecentRideStart[]> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const rows = unwrapList(
    await supabase
      .from('rides')
      .select('meeting_point, start_place_id, latitude, longitude, timezone')
      .eq('organizer_id', user.id)
      .not('start_place_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(RECENT_STARTS_SCAN_LIMIT),
    'your recent start locations',
  ) as RecentStartRow[]

  return dedupeRecentStarts(rows)
}

type RecentStartRow = {
  meeting_point: string
  start_place_id: string | null
  latitude: number | null
  longitude: number | null
  timezone: string | null
}

/**
 * Newest-first rows in, at most `RECENT_STARTS_LIMIT` distinct places out.
 *
 * Pure and exported for the reason `isRideCrew` and `toRideListItem` are: the
 * dedupe is the rule, the query is only how the rows arrive. Keeping the first
 * occurrence is what makes "newest first" survive the dedupe — the last one
 * would answer with the oldest ride that used each place.
 */
export function dedupeRecentStarts(rows: RecentStartRow[]): RecentRideStart[] {
  const seen = new Set<string>()
  const starts: RecentRideStart[] = []

  for (const row of rows) {
    if (starts.length === RECENT_STARTS_LIMIT) break
    if (!row.start_place_id || row.latitude === null || row.longitude === null) continue
    if (seen.has(row.start_place_id)) continue

    seen.add(row.start_place_id)
    starts.push({
      name: row.meeting_point,
      placeId: row.start_place_id,
      lat: row.latitude,
      lon: row.longitude,
      // Unlike the three above this is NOT part of what makes a start distinct
      // — the dedupe is on `start_place_id` alone, so the newest ride at this
      // place decides the zone, exactly as it already decides the name.
      timezone: row.timezone,
    })
  }

  return starts
}

/** The postcard composer's Ride select — narrower than `RideListItem`, the
 * same shape `getMyClubs`' `ClubOption` gives the audience selector. */
export type RideOption = Pick<Ride, 'id' | 'title' | 'club_id'>

/**
 * Bounds each of `getCrewRides`' arms.
 *
 * **A cap on a picker misleads where a cap on a feed only truncates**, which is
 * why this one is paired with the `only` escape below rather than justified by
 * `RIDES_PAGE_SIZE`'s "saturates rather than misleads". A ride missing from a
 * `<select>` is indistinguishable from a ride the rider is not crew of, and
 * there is no "load more" on a dropdown to correct it.
 */
const CREW_RIDES_SCAN_LIMIT = 30

/** `departure_at` is read for ordering only and never reaches `RideOption` —
 * the composer's `<select>` shows a title. */
const CREW_RIDE_COLUMNS = 'id, title, club_id, departure_at'

type CrewRideRow = RideOption & { departure_at: string }

/**
 * The rides this rider is crew of, for the postcard composer's Ride select
 * (PD-256) — exactly the set `041`'s INSERT policy admits, so the picker can
 * never offer an option the write gate will refuse.
 *
 * **The equality is exact in both directions, and `private.is_ride_crew` alone
 * is not what makes it so.** That helper is `security definer`, so it will
 * confirm the crew row of a rider who can no longer see the ride. The INSERT
 * `with_check` is `is_ride_crew(ride_id)` **AND** an `EXISTS` on `rides` that
 * *is* RLS-checked — so the gate is *visible AND crew*, which is precisely what
 * these two arms read: `rides` under the caller's own RLS, filtered to organizer
 * or any `ride_members` row of either status (`034:108` has no status
 * predicate, and neither does the embed).
 *
 * Two queries and a merge, mirroring `readRides`'s `mine` filter: an organizer
 * who has also RSVP'd is on both arms and must appear once. `club_id` travels
 * with each row so the composer can prefill its Club select from whichever ride
 * the rider picks — a read the postcard's own audience rule never sees, since
 * `041`'s tag and `club_id` are orthogonal (design.md §D4).
 *
 * **`only` is what stops the cap re-creating the defect this story exists to
 * fix.** `RideJournal`'s `Add` deep-links to a specific ride, and `seedRideId`
 * falls back to no-ride for any id the list does not carry — so without this, a
 * rider crew of more than `CREW_RIDES_SCAN_LIMIT` rides taps `Add` inside ride
 * X, gets a composer reading "No ride", posts, and the photo never appears in
 * the Journal they added it from. Silently, which is PD-256's own framing of
 * the bug. The extra pair of point lookups runs only when the named ride missed
 * the window, and goes through the same two arms — so an id the rider is not
 * crew of is still absent, exactly as the write gate requires.
 *
 * Ordered by `departure_at`, the column every other ride list in this file
 * orders on (`readRides`, `getRecentRideStarts`) and the one that means
 * something to the question the select asks. Row-creation order does not: a
 * ride planned this morning for next spring is not a better answer to "which
 * ride was this photo from" than the one that departed last weekend.
 */
export async function getCrewRides(only?: string | null): Promise<RideOption[]> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const organized = supabase
    .from('rides')
    .select(CREW_RIDE_COLUMNS)
    .eq('organizer_id', user.id)
  // Aliased `!inner` embed, same shape `readRides` uses for `mine`: the join
  // filters the rides rather than widening the columns selected.
  const joined = supabase
    .from('rides')
    .select(`${CREW_RIDE_COLUMNS}, mine:ride_members!inner(user_id)`)
    .eq('mine.user_id', user.id)

  const [organizedRows, joinedRows] = await Promise.all([
    organized.order('departure_at', { ascending: false }).limit(CREW_RIDES_SCAN_LIMIT),
    joined.order('departure_at', { ascending: false }).limit(CREW_RIDES_SCAN_LIMIT),
  ])

  const rows = [
    ...unwrapList(organizedRows, 'the rides you organise'),
    ...unwrapList(joinedRows, 'your rides'),
  ] as unknown as CrewRideRow[]

  const byId = new Map<string, CrewRideRow>()
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row)

  if (only && !byId.has(only)) {
    const [organizedOne, joinedOne] = await Promise.all([
      supabase
        .from('rides')
        .select(CREW_RIDE_COLUMNS)
        .eq('organizer_id', user.id)
        .eq('id', only)
        .maybeSingle(),
      supabase
        .from('rides')
        .select(`${CREW_RIDE_COLUMNS}, mine:ride_members!inner(user_id)`)
        .eq('mine.user_id', user.id)
        .eq('id', only)
        .maybeSingle(),
    ])
    const named = (unwrap(organizedOne, 'that ride') ??
      unwrap(joinedOne, 'that ride')) as unknown as CrewRideRow | null
    if (named) byId.set(named.id, named)
  }

  return [...byId.values()]
    .sort((a, b) => new Date(b.departure_at).getTime() - new Date(a.departure_at).getTime())
    .map(({ id, title, club_id }) => ({ id, title, club_id }))
}

/**
 * The rides one club has ANNOUNCED, newest announcement first — the club
 * timeline's ride source.
 *
 * **Not `getRides({ kind: 'club', id })`, and the difference is the ORDER
 * rather than the columns.** That read splits and bounds on `departure_at` for
 * the strip at the top of the club screen: what is coming, and what the club
 * has already ridden. This one asks when each ride was *planned*, which is where
 * the timeline places it — so it orders and bounds on `created_at`, and that is
 * what makes its coherence horizon mean anything. Bounded by `departure_at`,
 * the rides withheld could have been created at any moment, including this
 * morning, so "the oldest row we were handed" would guarantee nothing.
 *
 * **It lives here rather than in `club-timeline.ts` because it returns a full
 * `RideListItem`** — the timeline draws `RideCard` under its own label since
 * 2026-08-31 — and everything that takes a `RideRow` the rest of the way is in
 * this module: `RIDE_SELECT`, `toRideListItem`, the avatar and map-tile signing,
 * and `rideDayStartUtc`, which has to be read once per list so every card on one
 * screen agrees where the upcoming/past boundary is.
 *
 * No audience predicate: `022`'s `rides` SELECT policy owns it, so a private
 * club's rides come back for its members and nobody else.
 *
 * **`until` is PD-375's paging bound** — inclusive (`design.md` §D3), so a
 * `limit` slicing through rides sharing one instant cannot drop the ones below
 * the cut; `ClubTimeline` wraps this into a `ClubTimelineWindow` itself, since
 * the shape returned here is unchanged and shared with nothing else.
 */
export async function getClubRideAnnouncements(
  clubId: string,
  limit = RIDES_PAGE_SIZE,
  until?: string
): Promise<RideListItem[]> {
  // The guard every club-scoped read carries, and it moved with the function: a
  // non-uuid reaches `.eq('club_id', …)` as `22P02`, PostgREST turns it into a
  // 400 and `unwrapList` throws — which would put a rider on an error boundary
  // offering `Try again` on an address that can never succeed (PD-142). Its one
  // caller resolves `getClub` first, so this is defence in depth; the read is
  // exported from a module with no such convention, and `combineQueries` would
  // turn one throw into an `ErrorState` over the whole timeline.
  if (!clubIdSchema.safeParse(clubId).success) return []

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const dayStartMs = new Date(rideDayStartUtc()).getTime()

  let query = supabase
    .from('rides')
    .select(RIDE_SELECT)
    .eq('club_id', clubId)
    // `id` as the tiebreak for `getClubThreads`' reason: two rides sharing a
    // `now()` would otherwise page in an order Postgres does not promise, so
    // the bound could drop one and repeat the other.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (until) query = query.lte('created_at', until)

  const rows = unwrapList(
    await query.limit(limit),
    "this club's rides",
  ) as unknown as RideRow[]

  // Before mapping, for the reason `getRides` gives at its own call: the mapper
  // copies profile references into `riders`, and signing afterwards would sign
  // the originals while the card rendered the copies.
  await Promise.all([
    resolveAvatarUrls(
      rows.flatMap((row) => [row.organizer, ...(row.riders ?? []).map((member) => member.profile)]),
      supabase
    ),
    resolveRideMapUrls(rows, supabase),
  ])

  return rows.map((row) => toRideListItem(row, user?.id, dayStartMs))
}
