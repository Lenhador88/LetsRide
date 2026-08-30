import { z } from 'zod'
import { POSTCARD_IMAGE_PATH_RE } from '@/lib/media/constants'

export const POSTCARD_CAPTION_MAX_LENGTH = 2000

/**
 * Mirrors postcards_caption_length (009): the column allows a NULL caption
 * but not an empty-string one being meaningfully different from "none", so an
 * empty (or all-whitespace) submission becomes null rather than ''. FormData
 * gives a missing field as null, not undefined, so the base schema accepts
 * `string | null` directly rather than layering `.optional()` on top.
 */
export const postcardCaptionSchema = z
  .string()
  .trim()
  .max(POSTCARD_CAPTION_MAX_LENGTH, `Must be ${POSTCARD_CAPTION_MAX_LENGTH} characters or fewer.`)
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value))

/**
 * '' from a "post to the app-wide feed" select option becomes null; anything
 * else must be a well-formed uuid. Shape only — "is the caller actually a
 * member of that club" is a trust boundary and belongs to 009's postcards
 * insert policy, not this schema. Restating it here would be the re-filtering
 * trap CLAUDE.md warns against: a stale or forged id fails at the database
 * with a real policy denial, not silently here.
 */
export const postcardClubIdSchema = z
  .string()
  .nullable()
  .transform((value) => (value ? value : null))
  .pipe(z.uuid('Choose a valid club.').nullable())

/**
 * `''` from the composer's "No ride" option becomes null; anything else must
 * be a well-formed uuid. Shape only, mirroring `postcardClubIdSchema` exactly
 * — "is the caller actually crew of that ride" is `041`'s INSERT policy, not
 * this schema, and restating it here would be the re-filtering trap
 * `postcardClubIdSchema`'s own comment already names.
 */
export const postcardRideIdSchema = z
  .string()
  .nullable()
  .transform((value) => (value ? value : null))
  .pipe(z.uuid('Choose a valid ride.').nullable())

/**
 * A postcard id as it arrives from a URL segment — shape only.
 *
 * Unlike the club id above, this is not guarding a trust boundary: a route
 * checks it so that `/postcards/foo` becomes a 404 rather than a 500. Postgres
 * rejects a non-uuid against a `uuid` column with `22P02`, PostgREST turns that
 * into a 400, and `unwrap` throws on it — which lands on the error boundary and
 * offers a "Try again" button for a URL that can never succeed. Checking the
 * shape first is what makes "no such postcard" and "not a postcard id at all"
 * look the same, which is also what keeps them from being told apart.
 */
export const postcardIdSchema = z.uuid()

/**
 * The object path the client already uploaded to Storage before calling
 * createPostcard. Shape-checked against the exact same regex migration 010's
 * INSERT policy and src/lib/media/constants.ts's generator use, so a
 * malformed value fails here with a field error instead of surfacing as the
 * database's raw 23514 (postcards_image_path_is_a_storage_path).
 */
export const postcardImagePathSchema = z
  .string()
  .regex(POSTCARD_IMAGE_PATH_RE, 'Not a valid postcard image path.')

/**
 * The capture fields, as they arrive from the composer's hidden inputs.
 *
 * **Zod carries the MESSAGE here; `064` carries the guarantee.** Every rule
 * below is also a CHECK constraint, and that duplication is the point rather
 * than an oversight: the app is client-rendered, so this schema runs in the
 * rider's own browser and a patched client simply does not execute it. What
 * this buys is a readable failure for an honest client — a field error instead
 * of the raw `23514` the database would otherwise surface as "Could not post
 * that."
 *
 * CLAUDE.md is explicit that a rule living only here is advisory. The reason it
 * is worth writing anyway is `postcardImagePathSchema`'s: the same pre-emption
 * of a constraint violation nobody could act on.
 *
 * FormData gives an absent field as `null`, and an empty string for a field
 * whose hidden input rendered with no value — both mean "nothing", so both
 * become `null` before anything is parsed.
 */
const emptyToNull = (value: unknown) => (value === '' || value === undefined ? null : value)

/**
 * A capture instant. Bounded rather than owned — the value comes from the
 * rider's own file and there is no server-side source for it, so unlike
 * `created_at` it cannot simply be taken away from the client (`044`). The
 * future bound is the one that matters: this is the ride Journal's sort key.
 */
export const postcardTakenAtSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .datetime({ message: 'Not a valid capture time.' })
    .nullable()
    .refine((value) => value === null || new Date(value) <= new Date(), {
      message: 'A photo cannot have been taken in the future.',
    })
    .refine((value) => value === null || new Date(value) >= new Date('1995-01-01T00:00:00Z'), {
      message: 'That capture time is too old to be real.',
    })
)

const numericField = (schema: z.ZodType<number>) =>
  z.preprocess((value) => {
    const cleaned = emptyToNull(value)
    if (cleaned === null) return null
    const parsed = typeof cleaned === 'string' ? Number(cleaned) : cleaned
    return Number.isFinite(parsed as number) ? parsed : cleaned
  }, schema.nullable())

export const postcardTakenAtOffsetSchema = numericField(
  z.number().int().min(-1440).max(1440)
)

export const postcardLatitudeSchema = numericField(z.number().min(-90).max(90))
export const postcardLongitudeSchema = numericField(z.number().min(-180).max(180))

/**
 * `'region'` is accepted and never produced. It is what one grandfathered row
 * carries; a schema that refused it would refuse to parse a postcard the
 * database is perfectly happy to hold. `072` keeps it legal for the same
 * reason.
 */
export const postcardLocationPrecisionSchema = z.preprocess(
  emptyToNull,
  z.enum(['region', 'place', 'precise']).nullable()
)

/** Mirrors `postcards_taken_place_name_length` (`072`), which mirrors
 *  `clubs_location_name_length` against the same producer: the provider's label
 *  falls back through a chain ending in a whole address on one line. */
export const POSTCARD_PLACE_NAME_MAX_LENGTH = 200

export const postcardPlaceNameSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(POSTCARD_PLACE_NAME_MAX_LENGTH, `Must be ${POSTCARD_PLACE_NAME_MAX_LENGTH} characters or fewer.`)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value))
)

/**
 * The flag half of PD-279 — vendor text stored verbatim, never parsed out of
 * the place name. Mirrors `postcards_taken_country_code_is_iso_alpha2` (`074`):
 * uppercase, two letters, matching `profile_countries_code_is_iso_alpha2`
 * (`014`/`020`) rather than the vendor's own lowercase — the composer
 * uppercases before this ever runs, so this is the client checking its own
 * work, exactly as the rounding refine below does for the coordinate.
 */
export const postcardCountryCodeSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^[A-Z]{2}$/, 'Not a valid country code.')
    .nullable()
)

export const createPostcardSchema = z
  .object({
    imagePath: postcardImagePathSchema,
    caption: postcardCaptionSchema,
    clubId: postcardClubIdSchema,
    rideId: postcardRideIdSchema,
    takenAt: postcardTakenAtSchema,
    takenAtOffsetMinutes: postcardTakenAtOffsetSchema,
    takenLatitude: postcardLatitudeSchema,
    takenLongitude: postcardLongitudeSchema,
    takenLocationPrecision: postcardLocationPrecisionSchema,
    takenPlaceName: postcardPlaceNameSchema,
    takenCountryCode: postcardCountryCodeSchema,
  })
  // The two couplings `064` enforces, restated so an honest client fails
  // readably instead of meeting a constraint violation it cannot explain.
  // Neither is a trust boundary: the database refuses these regardless.
  .refine(
    (value) => (value.takenAt === null) === (value.takenAtOffsetMinutes === null),
    { message: 'A capture time needs the zone it was read in.', path: ['takenAt'] }
  )
  .refine(
    (value) => (value.takenLatitude === null) === (value.takenLongitude === null),
    { message: 'A location needs both coordinates.', path: ['takenLatitude'] }
  )
  // **The five arms `072`'s coupling constraint allows, restated.** The old
  // version of this rule said a coordinate and a marker imply each other, which
  // `072` no longer means: a rider who TYPES a town and never picks one gets a
  // name and a marker with no coordinate at all, and that is a first-class
  // state rather than a partial row. Zod carries the message; the constraint
  // carries the guarantee.
  .refine(
    (value) => {
      const hasPin = value.takenLatitude !== null && value.takenLongitude !== null
      switch (value.takenLocationPrecision) {
        case null:
          // Arm 1 — nothing. A name or a pin with no marker is not a shape the
          // database will take.
          return !hasPin && value.takenPlaceName === null
        case 'place':
          // Arms 2 and 3 — a named place, with or without a pin.
          return value.takenPlaceName !== null
        case 'precise':
          // Arm 4 — the photo's own fix. The name may ride along as a label.
          return hasPin
        case 'region':
          // Arm 5 — legacy, and the client never writes it.
          return hasPin && value.takenPlaceName === null
      }
    },
    {
      message: 'That location is not a shape a postcard can hold.',
      path: ['takenLocationPrecision'],
    }
  )
  // Not a duplicate of the arms above: this is the one rule that says a rider
  // whose coordinate is marked COARSE actually got a coarse one. The rounding
  // happens in the browser, so this is the client checking its own work —
  // `072`'s postcards_coarse_location_is_rounded is what makes it true for a
  // client that skips this file entirely, and it is the only thing standing
  // between a patched client and a house published wearing a city's name.
  .refine(
    (value) =>
      (value.takenLocationPrecision !== 'place' && value.takenLocationPrecision !== 'region') ||
      value.takenLatitude === null ||
      value.takenLongitude === null ||
      (value.takenLatitude === Math.round(value.takenLatitude * 100) / 100 &&
        value.takenLongitude === Math.round(value.takenLongitude * 100) / 100),
    { message: 'That location is not rounded.', path: ['takenLatitude'] }
  )
  // Mirrors `postcards_taken_country_code_needs_a_place` (`074`): a country
  // with nothing for `PostcardCard` to draw it beside is not a shape the
  // database will take either. Never the other direction — a name with no
  // country is arm 2's typed-and-never-picked case, which is legal.
  .refine((value) => value.takenCountryCode === null || value.takenPlaceName !== null, {
    message: 'A country needs a place to describe.',
    path: ['takenCountryCode'],
  })

export type CreatePostcardInput = z.output<typeof createPostcardSchema>
