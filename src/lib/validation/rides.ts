import { z } from 'zod'
import type { RideFilter } from '@/types'

/**
 * The rides list's search params, which are untrusted input like any other.
 *
 * `?club=` lands in `.eq('club_id', …)`. Postgres rejects a non-UUID with
 * `22P02`, PostgREST turns that into a 400, and `unwrapList` throws — so a
 * stale bookmark or a hand-edited URL takes down the whole rides tab and shows
 * the error boundary. "That club has no rides" is the honest answer to a
 * malformed club id, and parsing is what makes the difference.
 *
 * Shared with no client component today, but it lives here rather than in the
 * page for the reason every schema does: the page is not the only thing that
 * will ever read these params.
 */
export const rideSearchParamsSchema = z.object({
  filter: z.literal('mine').optional().catch(undefined),
  club: z.string().uuid().optional().catch(undefined),
})

/**
 * `undefined` is the "All rides" tile.
 *
 * "Mine" and a club at once is not a state the design has, and intersecting
 * them would quietly return nothing — first one wins, as on /postcards. An
 * unparseable value is dropped rather than rejected: the screen still works,
 * it just shows every ride.
 */
export function parseRideFilter(params: {
  filter?: string
  club?: string
}): RideFilter | undefined {
  const { filter, club } = rideSearchParamsSchema.parse(params)

  if (filter === 'mine') return { kind: 'mine' }
  if (club) return { kind: 'club', id: club }
  return undefined
}

/**
 * A ride id out of the URL, which is untrusted like any other segment.
 *
 * `/rides/[id]` and `/rides/[id]/crew` put this straight into `.eq('id', …)`.
 * Postgres rejects a non-UUID with `22P02`, PostgREST returns 400, and `unwrap`
 * throws — so `/rides/new/crew` answered **500** rather than 404. Found by
 * loading the app against the real database on 2026-08-05, not by review: the
 * link that produced it was the "Create ride" button's own `/rides/new`, which
 * matches `/rides/[id]` for any segment that is not a real route.
 *
 * Same reasoning as `rideSearchParamsSchema` above and `riderIdSchema` in
 * `blocks.ts`. A malformed id means "no such ride", and 404 is the honest
 * answer — which is also the answer a ride you may not see already gets, so
 * this leaks nothing new.
 */
export const rideIdSchema = z.uuid()
