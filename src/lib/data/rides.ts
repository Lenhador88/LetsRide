import { createClient } from '@/lib/supabase/server'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { unwrapList } from '@/lib/data/unwrap'
import type {
  PublicProfile,
  RideAttendance,
  RideFilter,
  RideFilterOption,
  RideFilters,
  RideListItem,
} from '@/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

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
  club:clubs(id, name, avatar_url),
  riders:ride_members(user_id, status, profile:profiles(${PUBLIC_PROFILE_COLUMNS}))
`

export type RideRow = {
  id: string
  title: string
  meeting_point: string
  departure_at: string
  organizer_id: string
  organizer: PublicProfile | null
  club: { id: string; name: string; avatar_url: string | null } | null
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

/** The ride ids this viewer has RSVP'd to. Empty for a signed-out request. */
async function myRideIds(
  supabase: SupabaseServerClient,
  viewerId: string | undefined
): Promise<string[]> {
  if (!viewerId) return []

  // Filtering on `user_id` is business logic, not a re-filter of RLS: the
  // ride_members SELECT policy scopes *visibility* (rosters of rides you can
  // see), so "which of these are mine" is a question it has no opinion on —
  // the same distinction attachLikeState draws in lib/data/postcards.ts.
  const rows = unwrapList(
    await supabase.from('ride_members').select('ride_id').eq('user_id', viewerId),
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
  const supabase = await createClient()
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
    const joined = await myRideIds(supabase, user.id)
    // `id.in.()` with an empty list is a syntax error, so a rider who has
    // joined nothing asks only about the rides they organise.
    query = joined.length
      ? query.or(`organizer_id.eq.${user.id},id.in.(${joined.join(',')})`)
      : query.eq('organizer_id', user.id)
  }

  const rows = unwrapList(await query, 'the rides list') as unknown as RideRow[]
  return rows.map((row) => toRideListItem(row, user?.id, now))
}

type FilterRow = {
  id: string
  organizer_id: string
  organizer: { avatar_url: string | null } | null
  club: { id: string; name: string; avatar_url: string | null } | null
}

/**
 * The tiles above the list: your rides, all rides, then one per club.
 *
 * Counted over the same bounded window of upcoming rides the list reads, and
 * through the same table, so one policy decides both what a tile offers and
 * what the list then shows. Asking `clubs` directly would be a second
 * visibility predicate to keep in step — and it would offer club tiles with no
 * rides behind them, which the design's empty frame explicitly does not draw.
 */
export async function getRideFilters(limit = RIDES_PAGE_SIZE): Promise<RideFilters> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [rows, joined] = await Promise.all([
    (async () =>
      unwrapList(
        await supabase
          .from('rides')
          .select('id, organizer_id, organizer:profiles!organizer_id(avatar_url), club:clubs(id, name, avatar_url)')
          .gte('departure_at', new Date().toISOString())
          .order('departure_at', { ascending: true })
          .limit(limit),
        'your ride filters',
      ) as unknown as FilterRow[])(),
    myRideIds(supabase, user?.id),
  ])

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
    // The design fills this 2×2 with ride photos. `rides` has no image column,
    // so it is the organizers' faces instead — real data in the right shape,
    // rather than four grey squares that would read as "empty". See
    // docs/FIGMA-FIDELITY-TODO.md.
    collage: rows
      .map((row) => row.organizer?.avatar_url)
      .filter((url): url is string => !!url)
      .slice(0, 4),
    clubs: [...clubs.values()],
  }
}
