/**
 * The one Storage bucket every upload surface in the app is meant to share —
 * see migration 010's header comment for the reasoning (one bucket, one
 * folder per surface, rather than a bucket per surface). Only `postcards/`
 * has storage.objects policies today, because postcards is the only surface
 * with a feature behind it; a future surface adds its own folder and its own
 * policies in the migration that builds it, not a new bucket.
 *
 * Deliberately free of imports so both client components and Server Actions
 * can use it — see columns.ts for the same reasoning.
 */
export const MEDIA_BUCKET = 'media'

export const POSTCARDS_FOLDER = 'postcards'

const UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * `postcards/<uploader uuid>/<object uuid>.jpg` — the exact layout 009's own
 * column comment commits to. Migration 010's INSERT policy enforces the same
 * shape in SQL; this regex and that one must agree, or a legitimately
 * uploaded object fails validation here with a confusing field error instead
 * of the raw 23514 this schema exists to pre-empt. There is no automated
 * check that the two stay in sync — a person has to keep them matching, the
 * same risk RESERVED_USERNAMES in validation/profile.ts already carries
 * against 003's denylist.
 */
export const POSTCARD_IMAGE_PATH_RE = new RegExp(
  `^${POSTCARDS_FOLDER}/${UUID_SRC}/${UUID_SRC}\\.jpg$`
)

/**
 * Builds a fresh, well-formed postcard image path for this uploader. The
 * object id defaults to a fresh random uuid rather than taking one as a
 * required argument, so an ordinary call site can't accidentally reuse a
 * path (and collide with 010's INSERT policy having no upsert path to fall
 * back on).
 */
export function buildPostcardImagePath(userId: string, objectId: string = crypto.randomUUID()): string {
  return `${POSTCARDS_FOLDER}/${userId}/${objectId}.jpg`
}
