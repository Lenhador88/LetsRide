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
 * The object path the client already uploaded to Storage before calling
 * createPostcard. Shape-checked against the exact same regex migration 010's
 * INSERT policy and src/lib/media/constants.ts's generator use, so a
 * malformed value fails here with a field error instead of surfacing as the
 * database's raw 23514 (postcards_image_path_is_a_storage_path).
 */
export const postcardImagePathSchema = z
  .string()
  .regex(POSTCARD_IMAGE_PATH_RE, 'Not a valid postcard image path.')

export const createPostcardSchema = z.object({
  imagePath: postcardImagePathSchema,
  caption: postcardCaptionSchema,
  clubId: postcardClubIdSchema,
})

export type CreatePostcardInput = z.output<typeof createPostcardSchema>
