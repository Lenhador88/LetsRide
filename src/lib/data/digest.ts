import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { CLUB_EMBED_COLUMNS } from '@/lib/data/columns'
import type { RiderPosition } from '@/lib/data/clubs'
import { RIDE_SELECT, toRideListItem, withRideDistance, type RideRow } from '@/lib/data/rides'
import { resolveAvatarUrls, resolveRideMapUrls } from '@/lib/data/media'
import { unwrapList } from '@/lib/data/unwrap'
import { rideDayStartUtc } from '@/lib/utils'
import type { EmbeddedClub, WeekendDigest, WeekendDigestClub } from '@/types'

/**
 * `public.my_weekend_digest`'s row shape (`129`, PD-450 part 1) — ids, an
 * ordering key and counts, never content. `design.md` §D2 states why: a
 * `security definer` body may return identifiers and an ordering key, never a
 * merged view of several tables' content, so the rider's own row security
 * stays the last gate on everything this screen renders.
 *
 * **Which section a row belongs to is read off which id is non-null, not off
 * `section`.** The column exists for a human reading the table; filtering on
 * it would pin this file to a literal the migration is free to spell
 * differently, where `ride_id`/`club_id` are the columns the requirement
 * itself names.
 */
type DigestRow = {
  section: string
  ordinal: number
  ride_id: string | null
  club_id: string | null
  new_rides: number
  new_threads: number
}

/**
 * The weekend digest, hydrated — PD-450, part 1.
 *
 * **Ids in, rows out, and every id RLS withholds is dropped rather than
 * gapped.** `my_weekend_digest` runs `security definer` and can name a ride or
 * a club the caller's own SELECT policy would refuse; the two hydration reads
 * below run as the caller, under that same policy, so such an id simply finds
 * no row and disappears from the result — never a placeholder, never a thrown
 * "not found". That is the one narrowing decision D allows: the reader may
 * only ever produce a leak of an id and a count, never of a title or a name.
 *
 * **All or nothing.** The RPC and the two hydration reads all throw through
 * `unwrapList` on failure, and both hydration reads run inside one
 * `Promise.all`, so a failure in any of the three rejects this call. There is
 * no partial digest — the screen's error state covers all three, and a rider
 * is never shown two clubs while the rides half silently came up empty.
 *
 * **No position sends `{}`, not `{ near_lat: null, near_lon: null }`.** Both
 * mean the same thing to `129`'s wrapper — both arguments default to NULL —
 * but PostgREST would otherwise have to be trusted to encode an explicit null
 * the same way twice; omitting the keys removes the question.
 */
export async function getWeekendDigest(near: RiderPosition | null): Promise<WeekendDigest> {
  const supabase = await resolveSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const rows = unwrapList(
    await supabase.rpc('my_weekend_digest', near ? { near_lat: near.lat, near_lon: near.lon } : {}),
    'this weekend’s round-up'
  ) as unknown as DigestRow[]

  const rideEntries = rows
    .filter((row) => row.ride_id !== null)
    .sort((a, b) => a.ordinal - b.ordinal)
  const clubEntries = rows
    .filter((row) => row.club_id !== null)
    .sort((a, b) => a.ordinal - b.ordinal)

  const rideIds = rideEntries.map((row) => row.ride_id as string)
  const clubIds = clubEntries.map((row) => row.club_id as string)

  const dayStart = rideDayStartUtc()
  const dayStartMs = new Date(dayStart).getTime()

  const [rideRows, clubRows] = await Promise.all([
    readRidesByIds(supabase, rideIds),
    readClubsByIds(supabase, clubIds),
  ])

  const rideById = new Map(rideRows.map((row) => [row.id, row]))
  const rides = rideIds
    .map((id) => rideById.get(id))
    .filter((row): row is RideRow => !!row)
    .map((row) => withRideDistance(toRideListItem(row, user?.id, dayStartMs), near))

  const clubById = new Map(clubRows.map((row) => [row.id, row]))
  const clubs = clubEntries
    .map((entry): WeekendDigestClub | null => {
      const club = clubById.get(entry.club_id as string)
      return club ? { club, newRides: entry.new_rides, newThreads: entry.new_threads } : null
    })
    .filter((row): row is WeekendDigestClub => !!row)

  return { rides, clubs }
}

async function readRidesByIds(supabase: DataClient, ids: string[]): Promise<RideRow[]> {
  if (ids.length === 0) return []

  const rows = unwrapList(
    await supabase.from('rides').select(RIDE_SELECT).in('id', ids),
    'this weekend’s rides'
  ) as unknown as RideRow[]

  await Promise.all([
    resolveAvatarUrls(
      rows.flatMap((row) => [row.organizer, ...(row.riders ?? []).map((member) => member.profile)]),
      supabase
    ),
    resolveRideMapUrls(rows, supabase),
  ])

  return rows
}

async function readClubsByIds(supabase: DataClient, ids: string[]): Promise<EmbeddedClub[]> {
  if (ids.length === 0) return []

  const rows = unwrapList(
    await supabase.from('clubs').select(CLUB_EMBED_COLUMNS).in('id', ids),
    'your clubs’ activity'
  ) as unknown as EmbeddedClub[]

  await resolveAvatarUrls(rows, supabase)

  return rows
}
