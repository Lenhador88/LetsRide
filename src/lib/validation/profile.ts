import { z } from 'zod'

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
