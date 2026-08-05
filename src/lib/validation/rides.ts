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
/**
 * Bounds for the create-ride form.
 *
 * Like `clubSchema`, these live only here: `001` declares `title`,
 * `description`, `meeting_point` and `route_description` as bare `text` with no
 * CHECK, so the Server Action parsing this is the whole enforcement. 80 / 500 /
 * 120 / 1000 are chosen, not measured — `Create ride` is drawn in the OLD
 * stylesheet and its epic reads **To do**, so the design specifies none of them.
 */
export const RIDE_TITLE_MAX = 80
export const RIDE_DESCRIPTION_MAX = 500
export const RIDE_MEETING_POINT_MAX = 120
export const RIDE_ROUTE_MAX = 1000

const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, message).transform((value) => value || null).nullable()

export const rideSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Give your ride a title.')
    .max(RIDE_TITLE_MAX, `Keep the title under ${RIDE_TITLE_MAX} characters.`),
  description: optionalText(
    RIDE_DESCRIPTION_MAX,
    `Keep the description under ${RIDE_DESCRIPTION_MAX} characters.`
  ),
  meeting_point: z
    .string()
    .trim()
    .min(1, 'Say where the ride starts.')
    .max(RIDE_MEETING_POINT_MAX, `Keep the meeting point under ${RIDE_MEETING_POINT_MAX} characters.`),
  route_description: optionalText(
    RIDE_ROUTE_MAX,
    `Keep the route under ${RIDE_ROUTE_MAX} characters.`
  ),
  /**
   * A `datetime-local` value carries no zone, so it is parsed as **wall-clock
   * in `APP_TIME_ZONE`** rather than in whatever zone the server happens to run
   * in — which on Vercel is UTC, and which is exactly the two-hour error #37
   * fixed on the reading side. Storing the browser's zone would be the other
   * half of that bug: an organizer in Amsterdam and one in London would mean
   * different instants by the same string.
   *
   * The correct model is still a zone column on `rides` — see CLAUDE.md. This
   * keeps the write consistent with `formatRide*` until that lands.
   */
  departure_at: z
    .string()
    .min(1, 'Pick a departure date and time.')
    .refine((value) => !Number.isNaN(Date.parse(value)), 'That is not a valid date and time.'),
  /**
   * `max_riders` has never been enforced — not by the action, not by a policy,
   * not by a trigger, since `001`. This bounds what can be *typed*, which is not
   * the same thing, and the column stays a promise the database does not keep.
   */
  max_riders: z
    .number()
    .int()
    .positive('A ride needs room for at least one rider.')
    .max(999, 'That is more riders than a ride can hold.')
    .nullable(),
  is_public: z.boolean(),
  /** NULL is a ride with no club, exactly as `postcards.club_id` NULL is the app-wide feed. */
  club_id: z.string().uuid('Pick a club from the list.').nullable(),
})

export type RideInput = z.infer<typeof rideSchema>

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
