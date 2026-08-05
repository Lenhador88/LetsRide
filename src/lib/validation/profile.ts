import { z } from 'zod'
import { COUNTRY_CODES } from '@/lib/countries'

/**
 * These rules are enforced twice: here, and as CHECK constraints in
 * supabase/migrations/003_onboarding.sql. They must agree exactly — if this
 * list drifts from the migration's denylist, the client accepts a username the
 * database then rejects, and the user gets a Postgres error instead of a field
 * message.
 */
const RESERVED_USERNAMES: readonly string[] = [
  'admin', 'support', 'letsride', 'me', 'new', 'settings',
  'auth', 'onboarding', 'legal', 'api',
  'dashboard', 'rides', 'clubs', 'friends', 'profile', 'inbox', 'garage',
]

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

/**
 * Trims and lowercases before validating rather than rejecting on case. The
 * database enforces uniqueness on lower(username), so normalising here is
 * consistent with it, and a rider who types a capital gets their name rather
 * than an error.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(USERNAME_MIN_LENGTH, `Must be at least ${USERNAME_MIN_LENGTH} characters.`)
      .max(USERNAME_MAX_LENGTH, `Must be ${USERNAME_MAX_LENGTH} characters or fewer.`)
      .regex(/^[a-z0-9_]+$/, 'Use letters, numbers and underscores only.')
      .refine((value) => !RESERVED_USERNAMES.includes(value), 'That username is not available.')
  )

export const locationSchema = z
  .string()
  .trim()
  .min(1, 'Tell us where you ride from.')
  .max(100, 'Must be 100 characters or fewer.')

export const BIO_MAX_LENGTH = 500
export const BIKE_MODEL_MAX_LENGTH = 60

/**
 * Bio and bike are **optional**, so an empty field means "clear it" rather than
 * "you missed one" — hence the empty string maps to `null` instead of failing a
 * `min(1)`. Storing `''` would make a rider who cleared their bio
 * indistinguishable from one who never wrote one only by inspection, and every
 * render site already branches on null.
 *
 * **No CHECK constraint stands behind either** — `001` declares both columns as
 * bare `text`. The length limits are an application rule: enforced on the server
 * because the action parses `FormData`, but not by the database, so a direct
 * PostgREST call with a 10 MB bio would be accepted. Worth a constraint if it
 * ever matters; stated rather than silently assumed.
 *
 * Only `usernameSchema` is genuinely doubled in the database — `003` gives it a
 * format CHECK and a reserved-name CHECK. **`locationSchema` is not**, which an
 * earlier revision of this comment claimed by grouping the two together. The
 * only database rule touching `location` is `003`'s completion trigger, and it
 * guards the *stamp* — refusing `onboarding_completed_at` while `location` is
 * NULL — which says nothing about length or content, and stops applying at all
 * once onboarding is complete.
 */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || null)

export const bioSchema = optionalText(
  BIO_MAX_LENGTH,
  `Must be ${BIO_MAX_LENGTH} characters or fewer.`
)

export const bikeModelSchema = optionalText(
  BIKE_MODEL_MAX_LENGTH,
  `Must be ${BIKE_MODEL_MAX_LENGTH} characters or fewer.`
)

/**
 * The editable surface of a profile, and deliberately not all of it.
 *
 * `username` is absent: it is unique, reserved-word checked, and rendered as
 * every rider's identity across postcards, crews and member lists, so changing
 * it is a flow with a conflict path — not a field on a settings form. Onboarding
 * owns it today. `avatar_url` is absent because uploading is Storage work that
 * belongs with the `media` agent. Both are logged in
 * docs/FIGMA-FIDELITY-TODO.md §Profile rather than half-built.
 */
export const profileEditSchema = z.object({
  location: locationSchema,
  bio: bioSchema,
  bike_model: bikeModelSchema,
})

/**
 * Shared by the live availability check and the onboarding action, so the
 * field-level message a rider sees while typing is the same one the server
 * would produce.
 */
export function checkUsername(value: string): { ok: true; username: string } | { ok: false; error: string } {
  const result = usernameSchema.safeParse(value)
  return result.success
    ? { ok: true, username: result.data }
    : { ok: false, error: result.error.issues[0].message }
}

/**
 * One ISO 3166-1 alpha-2 code, matching 014's CHECK constraint character for
 * character. Uppercased rather than rejected on case for the same reason
 * `usernameSchema` lowercases: the database is strict, so normalising here is
 * consistent with it and a caller that sends `nl` gets their country rather
 * than an error.
 *
 * Membership of the list is checked too. The constraint only knows the shape,
 * so without this `ZZ` would be stored happily and then render as a blank flag
 * and its own code forever.
 */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}$/, 'Use a two-letter country code.')
      .refine((value) => COUNTRY_CODES.includes(value), 'That is not a country we know.')
  )
