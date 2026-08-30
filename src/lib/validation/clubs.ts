import { z } from 'zod'
import { CLUB_AVATAR_PATH_RE, CLUB_COVER_PATH_RE } from '@/lib/media/constants'

/**
 * Club name and description bounds.
 *
 * **These live only here.** `001` declares both as bare `text` with no CHECK, so
 * the database will accept a megabyte of name — the same gap `bio`,
 * `bike_model` and `location` carry on `profiles`, recorded rather than quietly
 * assumed. If a length rule ever needs to be load-bearing it belongs in a
 * migration; until then the Server Action parsing this is the only enforcement,
 * which is why no client may write `clubs` directly.
 *
 * 60 and 500 are chosen, not measured: `Create club` is drawn in the OLD
 * stylesheet and marked **To do**, so the design specifies neither. Named here
 * so the next person knows which numbers came from Figma and which did not.
 */
export const CLUB_NAME_MAX = 60
export const CLUB_DESCRIPTION_MAX = 500

/**
 * The two location bounds, and **unlike the two above these are NOT chosen
 * here** — `066` declares both as CHECK constraints on `clubs`, so these
 * numbers are a copy of a rule the database already owns. That is the shape
 * CLAUDE.md asks for: Zod owns the *message*, the database owns the
 * *guarantee*. Change one and the other refuses the write with a raw 23514.
 *
 * 200 is generous against the longest label the picker builds (a name plus a
 * street plus a locality). `CLUB_LOCATION_PLACE_ID_MAX` was 100, sized for an
 * Overture GERS uuid; `069` (PD-273) raises it to 512 for the geocoder
 * switch — the new provider's ids are variable-length and materially longer,
 * measured up to 191 stored characters on a real result the picker would
 * offer (`069`'s own header carries the table). **The break against 100 was
 * intermittent, not universal** — a short-named village fit, a long street
 * name did not — which is why it could not be found by trying it once.
 */
export const CLUB_LOCATION_NAME_MAX = 200
export const CLUB_LOCATION_PLACE_ID_MAX = 512

/**
 * A club's location, or none — `066`, PD-259.
 *
 * **All four move together or none does**, which is `clubs_location_coupling`
 * restated for the message rather than for the guarantee. Expressed as a
 * nullable object rather than four nullable fields precisely so the illegal
 * state (a name with no coordinates) is unrepresentable here, instead of being
 * a `.refine` that has to remember all four combinations.
 *
 * The coordinate bounds are the CHECK's, not a sanity check: a rider drives the
 * browser, so this is the message and `066` is the rule.
 */
export const clubLocationSchema = z
  .object({
    location_name: z
      .string()
      .trim()
      .min(1, 'Pick a place from the list.')
      .max(CLUB_LOCATION_NAME_MAX, 'That place name is too long.'),
    location_place_id: z
      .string()
      .trim()
      .min(1, 'Pick a place from the list.')
      .max(CLUB_LOCATION_PLACE_ID_MAX, 'That place could not be attached.'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .nullable()

export type ClubLocationInput = z.infer<typeof clubLocationSchema>

/**
 * The four hidden fields the place picker writes, read back off `FormData` as
 * one nullable object.
 *
 * **Anything short of all four present and numeric is `null`**, not a partial
 * object and not an error. A half-filled set can only come from a form the
 * rider never completed — the picker writes all four together or clears all
 * four together — so "no location" is the honest reading, and the CHECK behind
 * it means a partial write could not land anyway.
 *
 * `Number('')` is `0`, which is a real coordinate in the Gulf of Guinea, so the
 * emptiness test is on the STRING and never on the parsed number. That is the
 * whole reason this is a function rather than a `z.coerce.number()` on each
 * field.
 */
/**
 * What the picker's four hidden inputs are called, so the form that writes them
 * and the function that reads them back cannot drift apart.
 *
 * `PlaceSearchField` takes the names as a prop rather than defaulting to these
 * — two different tables want that control, and a shared default would silently
 * write a club's column names onto a ride.
 */
export const CLUB_LOCATION_FIELD_NAMES = {
  name: 'location_name',
  placeId: 'location_place_id',
  lat: 'latitude',
  lon: 'longitude',
} as const

export function readClubLocation(formData: FormData): ClubLocationInput {
  const name = (formData.get('location_name') as string | null)?.trim() ?? ''
  const placeId = (formData.get('location_place_id') as string | null)?.trim() ?? ''
  const lat = (formData.get('latitude') as string | null)?.trim() ?? ''
  const lon = (formData.get('longitude') as string | null)?.trim() ?? ''

  if (!name || !placeId || !lat || !lon) return null

  const latitude = Number(lat)
  const longitude = Number(lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  return { location_name: name, location_place_id: placeId, latitude, longitude }
}

export const clubSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give your club a name.')
    .max(CLUB_NAME_MAX, `Keep the name under ${CLUB_NAME_MAX} characters.`),
  description: z
    .string()
    .trim()
    .max(CLUB_DESCRIPTION_MAX, `Keep the description under ${CLUB_DESCRIPTION_MAX} characters.`)
    // An empty textarea is NULL in the column, not ''. The distinction is the
    // one the card reads: `description && <p>` must not render an empty line.
    .transform((value) => value || null)
    .nullable(),
  /**
   * No default here: the checkbox always sends a boolean, so a Zod default
   * would be dead code that reads like the decision. **Public is the default**,
   * set by `defaultChecked` on the form and by `001`'s column default, and
   * confirmed by the product owner.
   *
   * The design's `View not joined public club` epic carries a note — "Public
   * clubs are Post-MVP. Until then we only have private clubs" — and both
   * public-club epics are On hold. That note is **out of date rather than
   * binding**: public clubs are in scope, which is also what `/clubs/explore`
   * being marked Done already implied. Recorded because a future session
   * reading that frame will have the same question.
   */
  is_public: z.boolean(),
  /**
   * Paths, never URLs, and shape-checked here so a malformed one fails as a
   * field error rather than as `016`'s raw 23514. Both regexes come from
   * `lib/media/constants`, which is the same source the uploader builds from —
   * the SQL side is a third copy that nothing automatically reconciles, the
   * standing risk `constants.ts` already documents.
   */
  avatar_path: z.string().regex(CLUB_AVATAR_PATH_RE, 'That image could not be attached.').nullable(),
  cover_image_path: z
    .string()
    .regex(CLUB_COVER_PATH_RE, 'That image could not be attached.')
    .nullable(),
  /**
   * Optional, and that is a product decision rather than a gap — Create club is
   * the app's shortest creation flow and a required field is a new wall in
   * front of it. Every club that predates `066` carries null and keeps
   * appearing on Explore: a club with no location is not a hidden club.
   */
  location: clubLocationSchema,
})

export type ClubInput = z.infer<typeof clubSchema>

/**
 * A club id out of the URL, which is untrusted like any other query parameter.
 *
 * **This was the one detail read with no id guard, and the asymmetry was a real
 * defect rather than an inconsistency.** `getRide` and the postcard thread each
 * parse their id and answer "no such row"; `getClub` passed the segment straight
 * to `.eq('id', …)`, so a malformed one reached Postgres as `22P02`, PostgREST
 * turned it into a 400, `unwrap` threw, and the rider got the error boundary —
 * a "Try again" button on a URL that can never succeed — where every other
 * detail screen renders not-found. Added with PD-142 because moving the id into
 * `?id=` makes it far easier to hand-edit into something that is not a uuid.
 *
 * Same reasoning as `rideIdSchema`: a malformed id means "no such club", and 404
 * is the honest answer — which is also the answer a private club already gets,
 * so this leaks nothing new.
 */
export const clubIdSchema = z.uuid()

/**
 * Mirrors `club_threads_title_length` and `club_messages_body_length` in
 * `081`, and the asymmetry inside each is deliberate there so it is deliberate
 * here: the **floor is on the trimmed value** so a title or body of nothing but
 * whitespace is refused, while the **ceiling is on the raw length** so padding
 * cannot smuggle a longer value past a trimmed check.
 *
 * Zod's `.trim()` transforms before validating, so a naive `.trim().min(1).max()`
 * would check the ceiling against the *trimmed* string and disagree with the
 * database. The raw length is checked first, exactly as `rideMessageBodySchema`
 * does for the identical constraint shape.
 *
 * **The database's floor is `~ '\S'`, not `length(btrim(...)) >= 1`** — `btrim`
 * with no second argument strips spaces only, so the btrim form accepts a title
 * of newlines while `.trim()` here refuses it: the client stricter than the
 * database, which is the inversion CLAUDE.md's "no new integrity rule may live
 * only in a Zod schema" exists to prevent. `081` uses `~ '\S'` for that reason,
 * so these two agree with it exactly.
 *
 * 80 is `rides_title_length`'s bound from `018` (design.md §Questions Closed,
 * D5); 1000 matches `ride_messages`. Per CLAUDE.md these own the **message**,
 * never the guarantee.
 */
export const CLUB_THREAD_TITLE_MAX = 80
export const CLUB_MESSAGE_MAX_LENGTH = 1000

export const clubThreadTitleSchema = z
  .string()
  .max(CLUB_THREAD_TITLE_MAX, `Keep the title under ${CLUB_THREAD_TITLE_MAX} characters.`)
  .transform((value) => value.trim())
  .refine((value) => value.length >= 1, 'Give the thread a title.')

export const clubMessageBodySchema = z
  .string()
  .max(CLUB_MESSAGE_MAX_LENGTH, `Must be ${CLUB_MESSAGE_MAX_LENGTH} characters or fewer.`)
  .transform((value) => value.trim())
  .refine((value) => value.length >= 1, 'Write something first.')

/**
 * A thread id out of the URL, untrusted like any other query parameter —
 * `clubIdSchema`'s reasoning, applied to the thread screen's own `?id=`. A
 * malformed id means "no such thread", and 404 is the honest answer.
 */
export const clubThreadIdSchema = z.uuid()

/**
 * A join-request id, on the way into `approve_club_join_request` and
 * `decline_club_join_request` — `085`, PD-325.
 *
 * `clubIdSchema`'s reasoning again, and the RPCs take the REQUEST id rather
 * than a rider's for a reason worth stating here too: the subject is the row,
 * so "we check the id belongs to your club" is one refactor away from not
 * doing that. Zod owns the message; the RPC's single raise site owns the
 * guarantee, and a malformed id reaching it would be a 400 on the error
 * boundary where a refusal belongs.
 */
export const clubJoinRequestIdSchema = z.uuid()
