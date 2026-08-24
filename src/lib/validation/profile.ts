import { z } from 'zod'
import { COUNTRY_CODES } from '@/lib/countries'

/**
 * These rules are enforced twice: here, and as CHECK constraints in
 * supabase/migrations/056_username_keeps_its_case.sql — which is where the live
 * `profiles_username_not_reserved` is defined, `003` having been superseded.
 * They must agree exactly, in **membership**: if this list drifts from the
 * migration's denylist, the client accepts a username the database then rejects,
 * and the user gets a Postgres error instead of a field message.
 *
 * Both sides compare case-blind and both lists are written lowercase. That is
 * the pairing rather than a coincidence — `056` folds the column precisely
 * because a lowercase list stopped being exhaustive the moment the charset
 * admitted capitals, and a `.includes(value)` here would let `Admin` through in
 * the same way.
 */
const RESERVED_USERNAMES: readonly string[] = [
  'admin', 'support', 'letsride', 'me', 'new', 'settings',
  'auth', 'onboarding', 'legal', 'api',
  'dashboard', 'rides', 'clubs', 'friends', 'profile', 'inbox', 'garage',
]

export const USERNAME_MIN_LENGTH = 3
/**
 * 25 since `057`. It must equal the upper bound of `profiles_username_format`
 * or the client accepts a name the database then refuses with a raw `23514`
 * instead of a field message — the same failure the reserved-list comment above
 * describes, by way of a number rather than a list.
 */
export const USERNAME_MAX_LENGTH = 25

/**
 * The one wording for "somebody already has this name", shared by the live
 * availability check, the submit boundary that handles the unique violation,
 * and the field verdict that renders whichever of the two spoke last.
 *
 * It is a constant rather than three string literals because those three
 * disagree in the one case that matters. `profiles_username_lower_key` is a
 * plain unique index on `lower(username)` — global, and neither partial nor
 * RLS-aware — while `isUsernameTaken` reads through the block-aware `profiles`
 * SELECT policy. So a rider blocked by the holder of a name is told it is free
 * and is then refused `23505` on submit (PD-146; asserted from both sides in
 * `supabase/tests/rls_test.sql` §038.3). The rider must not be able to tell
 * that apart from an ordinary collision, and two literals that drift are
 * exactly how they would.
 */
export const USERNAME_TAKEN_MESSAGE = 'That username is taken.'

/**
 * Trims, and **deliberately does not lowercase**. `056` relaxed
 * `profiles_username_format` to `^[A-Za-z0-9_]{3,25}$` (`{3,20}` until `057`
 * widened the bound) so a username stores the
 * case the rider typed: `Pedro` has to survive this schema as `Pedro`, and a
 * `.toLowerCase()` here would silently undo the whole change while every test
 * still passed.
 *
 * Case-insensitive **uniqueness** is untouched and is not this file's job:
 * `profiles_username_lower_key` is a unique index on `lower(username)`, so
 * `pedro`, `PEDRO` and `PeDrO` remain unavailable to everyone else.
 *
 * The reserved check folds before comparing, matching
 * `profiles_username_not_reserved` — which `056` made case-blind for exactly
 * this reason. `003` could write the list in lowercase and call it exhaustive
 * *because* the charset forced lowercase; relax one without the other and
 * `Admin` walks through both.
 */
export const usernameSchema = z
  .string()
  .trim()
  .pipe(
    z
      .string()
      .min(USERNAME_MIN_LENGTH, `Must be at least ${USERNAME_MIN_LENGTH} characters.`)
      .max(USERNAME_MAX_LENGTH, `Must be ${USERNAME_MAX_LENGTH} characters or fewer.`)
      .regex(/^[A-Za-z0-9_]+$/, 'Use letters, numbers and underscores only.')
      .refine(
        (value) => !RESERVED_USERNAMES.includes(value.toLowerCase()),
        'That username is not available.'
      )
  )

export const BIO_MAX_LENGTH = 500
export const BIKE_MODEL_MAX_LENGTH = 60
const LOCATION_MAX_LENGTH = 100

/**
 * Bio, bike and location are all **optional** on the profile editor, so an
 * empty field means "clear it" rather than "you missed one" — hence the empty
 * string maps to `null` instead of failing a `min(1)`. Storing `''` would make
 * a rider who cleared a field indistinguishable from one who never filled it
 * in only by inspection, and every render site already branches on null.
 *
 * **No CHECK constraint stands behind `bio` or `bike_model`** — `001`
 * declares both columns as bare `text`. The length limits are an application
 * rule: enforced on the server because the action parses `FormData`, but not
 * by the database, so a direct PostgREST call with a 10 MB bio would be
 * accepted. Worth a constraint if it ever matters; stated rather than
 * silently assumed. `location` does carry one — `018`'s
 * `profiles_location_length` bounds its length and refuses a trimmed-empty
 * string, which is exactly what `|| null` here avoids ever sending.
 *
 * **`location` used to be mandatory on this form**, because `003`'s
 * completion trigger refused the onboarding stamp while `location` was
 * NULL, so no rider could reach this form with one missing. `075` (PD-286)
 * dropped that requirement from `complete_onboarding` — onboarding no longer
 * collects a location at all — so a rider onboarded under it carries NULL
 * here from the start, and the field has to accept that rather than refuse
 * the whole form until they invent a city.
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
 *
 * `location` is inlined here rather than its own export — this is its only
 * caller since onboarding stopped collecting one (PD-286).
 */
export const profileEditSchema = z.object({
  location: optionalText(LOCATION_MAX_LENGTH, 'Must be 100 characters or fewer.'),
  bio: bioSchema,
  bike_model: bikeModelSchema,
})

/**
 * Shared by the live availability check and the onboarding action, so the
 * field-level message a rider sees while typing is the same one the submit
 * would produce.
 *
 * Both really do call it — `checkUsernameAvailability` and `setUsername`, in
 * `src/lib/actions/onboarding.ts`. It sat here with no caller outside its own
 * test for long enough that the sentence above was aspirational; if a boundary
 * ever parses `usernameSchema` itself again, this claim goes with it.
 */
export function checkUsername(value: string): { ok: true; username: string } | { ok: false; error: string } {
  const result = usernameSchema.safeParse(value)
  return result.success
    ? { ok: true, username: result.data }
    : { ok: false, error: result.error.issues[0].message }
}

/**
 * A rider id in `/profile/detail?id=`. Same reasoning as `rideIdSchema`/
 * `clubIdSchema`: a malformed id means "no such rider", and not-found is the
 * honest answer for a route that already renders the same state for a block.
 */
export const profileIdSchema = z.uuid()

/**
 * One ISO 3166-1 alpha-2 code, matching 014's CHECK constraint character for
 * character. Uppercased rather than rejected on case because the database is
 * strict — `014` stores `NL` and nothing else — so normalising here is
 * consistent with it and a caller that sends `nl` gets their country rather
 * than an error.
 *
 * **`usernameSchema` no longer works this way and the two are not a pair**, which
 * this comment used to claim. A country code has one correct spelling and the
 * column enforces it; a username's case is the rider's and `056` stores it.
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
