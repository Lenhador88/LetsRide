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

/** `067`'s `rides_start_place_id_length`, restated for the message. */
export const RIDE_START_PLACE_ID_MAX = 100

/**
 * The place a rider picked for the ride's start, or none — `067`, PD-114.
 *
 * **Only three fields, where a club's location has four.** A club's location
 * *is* a place, so its name comes from the picker. A ride's start is free text
 * the rider may have typed — `meeting_point` above owns that string and is
 * `NOT NULL` — so what a pick adds is the coordinate and its provenance, never
 * the text. That asymmetry is the whole difference between the two forms.
 *
 * Nullable object rather than three nullable fields, for `clubLocationSchema`'s
 * reason: the illegal state (a place id with no coordinate) is unrepresentable
 * here instead of being a `.refine` that has to remember every combination.
 *
 * The bounds are `067`'s `rides_location_coupling`, restated for the message.
 * A rider drives the browser, so this is what they read and `067` is the rule.
 */
export const rideLocationSchema = z
  .object({
    start_place_id: z
      .string()
      .trim()
      .min(1, 'Pick a place from the list.')
      .max(RIDE_START_PLACE_ID_MAX, 'That place could not be attached.'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .nullable()

export type RideLocationInput = z.infer<typeof rideLocationSchema>

/**
 * What the picker's inputs are called on a ride form.
 *
 * `name` is `meeting_point` — the field the rider can type in — so a pick
 * writes through to the same input a typed answer uses, and `readRideLocation`
 * deliberately does **not** read it: the text is `rideSchema`'s, under its own
 * bound, whether or not a place was ever picked.
 */
export const RIDE_LOCATION_FIELD_NAMES = {
  name: 'meeting_point',
  placeId: 'start_place_id',
  lat: 'latitude',
  lon: 'longitude',
} as const

/**
 * The pick, read back off `FormData` as one nullable object.
 *
 * **Anything short of all three present and numeric is `null`** — not a partial
 * object and not an error. The picker writes all three together and clears all
 * three together, so a half-filled set can only be a form the rider never
 * completed, and `067`'s coupling CHECK means a partial write could not land.
 *
 * `Number('')` is `0`, a real coordinate in the Gulf of Guinea, so emptiness is
 * tested on the STRING and never on the parsed number. That is why this is a
 * function rather than a `z.coerce.number()` per field.
 */
export function readRideLocation(formData: FormData): RideLocationInput {
  const placeId = (formData.get('start_place_id') as string | null)?.trim() ?? ''
  const lat = (formData.get('latitude') as string | null)?.trim() ?? ''
  const lon = (formData.get('longitude') as string | null)?.trim() ?? ''

  if (!placeId || !lat || !lon) return null

  const latitude = Number(lat)
  const longitude = Number(lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  return { start_place_id: placeId, latitude, longitude }
}

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
   * These bounds mirror `018`'s `rides_max_riders_range`, and since `063` the
   * number they bound is one the database keeps: `enforce_ride_capacity` counts
   * `ride_members` against it. So this is the ordinary split — the schema owns
   * the message, `018` owns what can be stored, and `063` owns what the cap
   * means.
   *
   * `.positive()` rather than `.min(1)` is load-bearing for the walk, which
   * submits `max_riders = 0` in two phases precisely because it is refused here
   * *and* by `018` and so cannot write a ride at either layer.
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
  /**
   * The picked place, or none. A ride whose start was typed rather than picked
   * carries `null` here and is completely valid — picking is the fast path,
   * never a gate, because "the layby past the second roundabout" is a real
   * meeting point.
   */
  location: rideLocationSchema,
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
 * A ride id out of the URL, which is untrusted whatever part of the URL it
 * arrives in.
 *
 * `/rides/detail` and `/rides/detail/crew` put `?id=` straight into
 * `.eq('id', …)`. Postgres rejects a non-UUID with `22P02`, PostgREST returns
 * 400, and `unwrap` throws — a "Try again" button on a URL that can never
 * succeed, where the honest answer is 404.
 *
 * **The route that produced it is gone and the schema is not obsolete with it.**
 * This was found on 2026-08-05 by loading the app against the real database, not
 * by review: `/rides/new/crew` answered **500**, because the "Create ride"
 * button's own `/rides/new` matched the then-dynamic `/rides/[id]` for any
 * segment that was not a real route. PD-142 moved the id into `?id=`, so that
 * particular collision cannot happen again — and the input got *easier* to
 * malform, because a query parameter is the part of a URL a person edits by
 * hand.
 *
 * Same reasoning as `rideSearchParamsSchema` above and `riderIdSchema` in
 * `blocks.ts`. A malformed id means "no such ride", and 404 is the honest
 * answer — which is also the answer a ride you may not see already gets, so
 * this leaks nothing new.
 */
export const rideIdSchema = z.uuid()

/**
 * Mirrors `ride_messages_body_length` in migration `034`, and the asymmetry is
 * deliberate there so it must be deliberate here: the **floor is on the trimmed
 * length** so a message of nothing but spaces is refused, while the **ceiling is
 * on the raw length** so padding cannot smuggle a longer body past a trimmed
 * check.
 *
 * Zod's `.trim()` transforms before validating, so a naive
 * `.trim().min(1).max(1000)` would check the ceiling against the *trimmed*
 * string and disagree with the database. The raw length is checked first —
 * exactly as `commentBodySchema` does, for exactly the same constraint shape.
 *
 * Same 1000 as a comment rather than the 2000 a caption gets. `034` §2 has the
 * argument: a chat thread holds far more rows than a comment thread, so the
 * per-row bound should be tighter, not looser.
 *
 * Per CLAUDE.md this schema owns the **message**, never the guarantee — `034`'s
 * CHECK is what a rider cannot decline to run.
 */
export const RIDE_MESSAGE_MAX_LENGTH = 1000

export const rideMessageBodySchema = z
  .string()
  .max(RIDE_MESSAGE_MAX_LENGTH, `Must be ${RIDE_MESSAGE_MAX_LENGTH} characters or fewer.`)
  .transform((value) => value.trim())
  .refine((value) => value.length >= 1, 'Write something first.')
