import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { CLUB_EMBED_COLUMNS, CLUB_FILTER_EMBED_COLUMNS, PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { unwrap, unwrapList } from '@/lib/data/unwrap'
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
 * geocode failed. `distanceKm` answers `null` for it and `nearbyRides` drops
 * it — a ride with no coordinate is never near anything, and must never be
 * counted as though it were.
 */
const RIDE_SELECT = `
  id, title, meeting_point, departure_at, organizer_id, map_card_path,
  latitude, longitude,
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
 */
async function readRides(
  supabase: DataClient,
  filter: RideFilter | undefined,
  viewerId: string | undefined,
  window: RideWindow,
  limit: number
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

  return unwrapList(await inWindow(rides(), window, limit), 'the rides list') as unknown as RideRow[]
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

  const [upcomingRows, pastRows] = await Promise.all([
    readRides(supabase, filter, user?.id, { from: dayStart }, limit),
    readRides(supabase, filter, user?.id, { before: dayStart }, PAST_RIDES_PAGE_SIZE),
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
        club_id, organizer_id, map_detail_path,
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
    club_id: row.club_id,
    organizer_id: row.organizer_id,
    organizer: row.organizer,
    club: row.club,
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
      id, title, description, route_description, meeting_point, departure_at,
      is_public, club_id, organizer_id,
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
  club: ClubFilterEmbed | null
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

  // The same boundary the list's upcoming section uses, not `now`: a tile
  // reading "2" above a section showing 3 rides is the mismatch that made
  // RIDE_FILTER_SCAN_LIMIT its own constant, arrived at from the time axis
  // instead of the row-count one.
  const dayStart = rideDayStartUtc()

  const [rows, joined] = await Promise.all([
    (async () =>
      unwrapList(
        await supabase
          .from('rides')
          .select(`id, organizer_id, club:clubs(${CLUB_FILTER_EMBED_COLUMNS})`)
          .gte('departure_at', dayStart)
          .order('departure_at', { ascending: true })
          .limit(limit),
        'your ride filters',
      ) as unknown as FilterRow[])(),
    myUpcomingRideIds(supabase, user?.id, dayStart),
  ])

  // The club tiles draw the club's avatar and, since PD-284, its cover behind
  // it — `resolveClubImageUrls` signs both in one pass, unlike
  // `resolveAvatarUrls`, which only ever touches `avatar_path` (see its own
  // header). Before the loop, because the loop copies the signed URLs into
  // each tile and a pass afterwards would sign rows nothing reads again.
  await resolveClubImageUrls(rows.map((row) => row.club), supabase)

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
          coverUrl: row.club.cover_image_url,
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
      .select('meeting_point, start_place_id, latitude, longitude')
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
    })
  }

  return starts
}

/** The postcard composer's Ride select — narrower than `RideListItem`, the
 * same shape `getMyClubs`' `ClubOption` gives the audience selector. */
export type RideOption = Pick<Ride, 'id' | 'title' | 'club_id'>

/** Bounds each of `getCrewRides`' two queries — see `RIDES_PAGE_SIZE`'s
 * own note on why an unbounded read here is the trap `FEED_PAGE_SIZE` closes
 * for postcards. */
const CREW_RIDES_SCAN_LIMIT = 30

/**
 * The rides this rider is crew of, for the postcard composer's Ride select
 * (PD-256) — exactly the set `041`'s INSERT policy admits (`private
 * .is_ride_crew`), so the picker can never offer an option the write gate will
 * refuse.
 *
 * Two queries and a merge, mirroring `readRides`'s `mine` filter: an organizer
 * who has also RSVP'd is on both arms and must appear once. `club_id` travels
 * with each row so the composer can prefill its Club select from whichever
 * ride the rider picks (`seedRideId`'s caller) — a read the postcard's own
 * audience rule never sees, since `041`'s tag and `club_id` are orthogonal
 * (design.md §D4).
 */
export async function getCrewRides(): Promise<RideOption[]> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const [organized, joined] = await Promise.all([
    supabase
      .from('rides')
      .select('id, title, club_id, created_at')
      .eq('organizer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(CREW_RIDES_SCAN_LIMIT),
    // Aliased `!inner` embed, same shape `readRides` uses for `mine`: the join
    // filters the rides rather than widening the columns selected.
    supabase
      .from('rides')
      .select('id, title, club_id, created_at, mine:ride_members!inner(user_id)')
      .eq('mine.user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(CREW_RIDES_SCAN_LIMIT),
  ])

  const rows = [
    ...unwrapList(organized, 'the rides you organise'),
    ...unwrapList(joined, 'your rides'),
  ] as unknown as (RideOption & { created_at: string })[]

  const byId = new Map<string, RideOption & { created_at: string }>()
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row)

  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, CREW_RIDES_SCAN_LIMIT)
    .map(({ id, title, club_id }) => ({ id, title, club_id }))
}
