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

/**
 * `067`'s `rides_start_place_id_length`, restated for the message —
 * `CLUB_LOCATION_PLACE_ID_MAX`'s own doc block in `lib/validation/clubs.ts`
 * carries the reasoning: 100 was sized for an Overture GERS uuid, and `069`
 * (PD-273) raises both columns' bounds to 512 for the geocoder switch, whose
 * ids are variable-length and materially longer.
 */
export const RIDE_START_PLACE_ID_MAX = 512

/**
 * `080`'s `rides_timezone_is_bounded`, restated for the message. The longest
 * name in the IANA database is `America/Argentina/ComodRivadavia` at 32
 * characters, so this is headroom rather than a fit.
 */
export const RIDE_TIMEZONE_MAX = 64

/**
 * The place a rider picked for the ride's start, or none — `067`, PD-114,
 * carrying its zone since `080` (PD-193).
 *
 * **Only three POSITIONAL fields, where a club's location has four.** A club's location
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
    /**
     * The IANA zone the picked place is in (`080`, PD-193), or `null`.
     *
     * **Nullable INSIDE a pick, unlike the three above.** All-or-nothing is
     * `067`'s coupling rule about the coordinate; a zone is an enrichment the
     * provider may simply not have sent, and refusing the whole pick over it
     * would cost the rider their coordinate to save their clock.
     *
     * The bound matches `rides_timezone_is_bounded`. Zod owns the message and
     * the database owns the guarantee: `080`'s trigger normalises anything it
     * cannot resolve to NULL, so a name that passes here and is unknown to
     * Postgres is stored as "we do not know" rather than as itself.
     */
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(RIDE_TIMEZONE_MAX, 'That place could not be attached.')
      .nullable(),
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
 * The zone input, which is **not** in the map above and must not be.
 *
 * `PlaceSearchField` renders exactly the four inputs `RIDE_LOCATION_FIELD_NAMES`
 * names, and `place-search-field.test.tsx` asserts that set per mode — including
 * the composer's nameless mode, where it must write *nothing*. Adding a fifth
 * would change a contract three callers share to serve one of them. The two ride
 * forms render this input themselves, from the same `PlaceValue` they hand the
 * field.
 */
export const RIDE_TIMEZONE_FIELD_NAME = 'start_timezone'

/**
 * Which zone a ride form's `datetime-local` string means — the one rule, in one
 * place, because FOUR call sites have to give the same answer and two of them
 * are on opposite sides of the network (`080`, PD-193).
 *
 * `CreateRideForm` and `EditRideForm` use it to label the field ("Times are in
 * Lisbon time"); `createRide` and `updateRide` use it to resolve the string
 * through `wallClockToUtc`. **A rider must never be told one zone and have
 * another one stored**, and before this was extracted the two sides were a pair
 * of one-liners with a comment saying they had to agree.
 *
 * **The pick WINS whenever there is one, including when its zone is `null`, and
 * that is the whole reason this is not `pick?.timezone ?? stored`.** A place
 * whose provider sent no zone is an ordinary case — it is every place until
 * `search-places` is redeployed — and `??` falls through it to the ride's
 * stored zone. On an edit that would label the field `APP_TIME_ZONE` while the
 * action resolved it against the ride's old zone, so a rider who also changed
 * the time would get back an hour they never typed.
 *
 * `stored` is the ride's own `timezone` on an edit and `null` on a create,
 * where there is no ride yet to have one.
 */
export function resolveDepartureZone(
  pick: { timezone?: string | null } | null | undefined,
  stored: string | null
): string | null {
  return pick ? (pick.timezone ?? null) : stored
}

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

  // Deliberately NOT part of the all-or-nothing test above: a pick with no zone
  // is a place whose provider sent none, which is ordinary, and dropping the
  // whole pick for it would lose the coordinate too.
  const zone = (formData.get(RIDE_TIMEZONE_FIELD_NAME) as string | null)?.trim() ?? ''

  return { start_place_id: placeId, latitude, longitude, timezone: zone || null }
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
   * **`080` (PD-193) is that zone column, and this comment is now about which
   * zone rather than whether there is one.** The string is still zone-less and
   * still parsed as wall-clock; what decides the instant is `rides.timezone`
   * when the rider picked their start, and `APP_TIME_ZONE` when they typed it
   * and the geocode has not landed yet. The action passes it; see
   * `wallClockToUtc`.
   */
  departure_at: z
    .string()
    .min(1, 'Pick a departure date and time.')
    .refine((value) => !Number.isNaN(Date.parse(value)), 'That is not a valid date and time.'),
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

/**
 * **`near` is gone from this schema (2026-08-27), and a stale `?near=1` in a
 * bookmark is now simply ignored** — an unknown key is not an error here, so
 * such a link lands on the unfiltered tab rather than failing. That is the
 * right outcome: the near-you *filter* it named (PD-260) became the door to
 * `/rides/explore`, and there is nothing left on this screen for it to turn on.
 */
export const rideSearchParamsSchema = z.object({
  filter: z.literal('mine').optional().catch(undefined),
  club: z.string().uuid().optional().catch(undefined),
})

/**
 * `undefined` is the "From clubs" tile.
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
 * A `ride_invites.id`, for the same reason and with the same failure: it comes
 * out of a notification row rather than out of the URL, but the two RPCs that
 * consume it take one argument and a malformed value would reach PostgREST as
 * `22P02` and land the rider on the error boundary rather than on the ordinary
 * refusal.
 */
export const rideInviteIdSchema = z.uuid()

/**
 * The minimum the rider picker will search on.
 *
 * **This bound has NO database counterpart, and saying so is the point.** Every
 * other schema in this directory mirrors a CHECK, per CLAUDE.md's rule that Zod
 * owns the message and the database owns the guarantee. There is no CHECK to
 * mirror here because the thing being bounded is a *query*, not a stored value
 * — so a rider using the publishable key directly can search on one character,
 * and the only thing that would change is how much of the directory one
 * keystroke enumerates. The real defences are the ones the database does carry:
 * `profiles` SELECT, which has permitted username lookup since `002`, and
 * `025`'s per-column grants, which cap what a hit can return.
 *
 * Two characters, and prefix-anchored at the read (`searchRidersToInvite`).
 * One character enumerates a thirty-sixth of the platform per keystroke.
 */
export const RIDER_SEARCH_MIN_LENGTH = 2

export const riderSearchQuerySchema = z
  .string()
  .transform((value) => value.trim())
  .refine(
    (value) => value.length >= RIDER_SEARCH_MIN_LENGTH,
    `Type at least ${RIDER_SEARCH_MIN_LENGTH} characters.`
  )

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
