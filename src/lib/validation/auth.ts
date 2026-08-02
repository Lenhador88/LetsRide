import { z } from 'zod'

/**
 * Trim and lowercase run BEFORE the format check, not after. Chaining
 * `z.email().trim()` validates the raw value first, so a trailing space from a
 * mobile keyboard's autocomplete fails as "invalid email".
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'))

/**
 * Applies to signup and password reset only. Login deliberately does not use
 * it: an account created before these rules existed would be locked out by a
 * client-side length check its owner cannot do anything about.
 */
export const newPasswordSchema = z
  .string()
  .min(8, 'Must be at least 8 characters.')
  .max(72, 'Must be 72 characters or fewer.')

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
})

export const signUpSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  // Q9: the primary button is disabled until this is ticked, but the action
  // re-checks it — a disabled button is not a trust boundary.
  acceptedTerms: z.literal(true, 'Accept the terms to continue.'),
})

export const resetRequestSchema = z.object({ email: emailSchema })

export const newPasswordFormSchema = z.object({ password: newPasswordSchema })
