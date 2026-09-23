import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RideRow } from '@/lib/data/rides'
import type { EmbeddedClub } from '@/types'

/**
 * `getWeekendDigest` — PD-450, part 1, task 4.3.
 *
 * **The reader returns ids and an ordinal; this file's whole job is proving
 * the two hydration reads respect both rather than their own fetch order.**
 * `.in('id', ids)` makes no promise about row order, and RLS can legitimately
 * return fewer rows than ids were asked for — an id the caller's own SELECT
 * policy withholds. Both are exercised below with ids **deliberately out of
 * ordinal order and one short**, so a build that reordered by fetch order, or
 * left a `undefined` gap instead of dropping it, fails here rather than on a
 * screen.
 *
 * **All-or-nothing** is asserted three times, once per read in
 * `getWeekendDigest`'s own `Promise.all` plus the RPC ahead of it, rather than
 * once — a data layer that fans out is exactly the shape where "the first two
 * of three reads failed silently" is invisible to a single combined assertion.
 */

function result(data: unknown, error: { message: string; code?: string } | null = null) {
  return { data, error }
}

const rideRow = (overrides: Partial<RideRow> = {}): RideRow => ({
  id: 'ride-1',
  title: 'Coastal loop',
  meeting_point: 'IJmuiden',
  departure_at: '2026-09-26T09:00:00Z',
  created_at: '2026-09-20T09:00:00Z',
  timezone: null,
  organizer_id: 'organizer-1',
  map_card_path: null,
  latitude: null,
  longitude: null,
  organizer: null,
  club: null,
  riders: [],
  ...overrides,
})

const clubRow = (overrides: Partial<EmbeddedClub> = {}): EmbeddedClub => ({
  id: 'club-1',
  name: 'Dune Riders',
  avatar_path: null,
  avatar_url: null,
  ...overrides,
})

let rpcResult: unknown
let ridesResult: unknown
let clubsResult: unknown

const rpc = vi.fn(async () => rpcResult)
const from = vi.fn((table: string) => ({
  select: () => ({
    in: async () => (table === 'rides' ? ridesResult : clubsResult),
  }),
}))

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({
    rpc,
    from,
    auth: { getUser: async () => ({ data: { user: { id: 'viewer-1' } } }) },
  }),
}))

const { getWeekendDigest } = await import('@/lib/data/digest')

describe('getWeekendDigest', () => {
  beforeEach(() => {
    rpc.mockClear()
    from.mockClear()
    rpcResult = result([])
    ridesResult = result([])
    clubsResult = result([])
  })

  it('sends {} for no position, not explicit nulls', async () => {
    await getWeekendDigest(null)
    expect(rpc).toHaveBeenCalledWith('my_weekend_digest', {})
  })

  it('sends the position under near_lat/near_lon', async () => {
    await getWeekendDigest({ lat: 52.37, lon: 4.9 })
    expect(rpc).toHaveBeenCalledWith('my_weekend_digest', { near_lat: 52.37, near_lon: 4.9 })
  })

  it('drops a ride id RLS withheld and keeps the reader’s ordinal order, not the fetch order', async () => {
    rpcResult = result([
      { section: 'rides', ordinal: 2, ride_id: 'ride-2', club_id: null, new_rides: 0, new_threads: 0 },
      { section: 'rides', ordinal: 1, ride_id: 'ride-1', club_id: null, new_rides: 0, new_threads: 0 },
      // Ordinal 3, but the hydration read below never returns it — RLS
      // withheld it, and it must vanish rather than leave a gap.
      { section: 'rides', ordinal: 3, ride_id: 'ride-3', club_id: null, new_rides: 0, new_threads: 0 },
    ])
    // Fetch order deliberately disagrees with ordinal order.
    ridesResult = result([rideRow({ id: 'ride-2' }), rideRow({ id: 'ride-1' })])

    const digest = await getWeekendDigest(null)

    expect(digest.rides.map((r) => r.id)).toEqual(['ride-1', 'ride-2'])
  })

  it('drops a club id RLS withheld and pairs each survivor with its own counts', async () => {
    rpcResult = result([
      { section: 'clubs', ordinal: 1, ride_id: null, club_id: 'club-1', new_rides: 2, new_threads: 1 },
      { section: 'clubs', ordinal: 2, ride_id: null, club_id: 'club-2', new_rides: 5, new_threads: 0 },
    ])
    // club-2 is withheld — only club-1 comes back.
    clubsResult = result([clubRow({ id: 'club-1' })])

    const digest = await getWeekendDigest(null)

    expect(digest.clubs).toEqual([{ club: clubRow({ id: 'club-1' }), newRides: 2, newThreads: 1 }])
  })

  it('issues no hydration read at all when the reader returns nothing', async () => {
    rpcResult = result([])
    await getWeekendDigest(null)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects when the reader itself fails', async () => {
    rpcResult = result(null, { message: 'boom', code: 'XXX' })
    await expect(getWeekendDigest(null)).rejects.toThrow()
  })

  it('rejects when the ride hydration read fails, even though the club read would have succeeded', async () => {
    rpcResult = result([
      { section: 'rides', ordinal: 1, ride_id: 'ride-1', club_id: null, new_rides: 0, new_threads: 0 },
      { section: 'clubs', ordinal: 1, ride_id: null, club_id: 'club-1', new_rides: 1, new_threads: 0 },
    ])
    ridesResult = result(null, { message: 'boom', code: 'XXX' })
    clubsResult = result([clubRow()])

    await expect(getWeekendDigest(null)).rejects.toThrow()
  })

  it('rejects when the club hydration read fails, even though the ride read would have succeeded', async () => {
    rpcResult = result([
      { section: 'rides', ordinal: 1, ride_id: 'ride-1', club_id: null, new_rides: 0, new_threads: 0 },
      { section: 'clubs', ordinal: 1, ride_id: null, club_id: 'club-1', new_rides: 1, new_threads: 0 },
    ])
    ridesResult = result([rideRow()])
    clubsResult = result(null, { message: 'boom', code: 'XXX' })

    await expect(getWeekendDigest(null)).rejects.toThrow()
  })
})
