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

// Named rather than inlined so the signup and reset-password screens can show
// the rule as helper text without a second, hand-typed "8" that can drift from
// the schema's own bound.
export const NEW_PASSWORD_MIN_LENGTH = 8
export const NEW_PASSWORD_MAX_LENGTH = 72

/**
 * Applies to signup and password reset only. Login deliberately does not use
 * it: an account created before these rules existed would be locked out by a
 * client-side length check its owner cannot do anything about.
 */
export const newPasswordSchema = z
  .string()
  .min(NEW_PASSWORD_MIN_LENGTH, `Must be at least ${NEW_PASSWORD_MIN_LENGTH} characters.`)
  .max(NEW_PASSWORD_MAX_LENGTH, `Must be ${NEW_PASSWORD_MAX_LENGTH} characters or fewer.`)

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
})

// Q9: the primary button is disabled until this is ticked, but the action
// re-checks it — a disabled button is not a trust boundary. Named rather than
// inlined because two screens collect consent: signup, and the standalone
// prompt for riders whose stamp predates that write (Q11).
const acceptedTermsSchema = z.literal(true, 'Accept the terms to continue.')

export const signUpSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  acceptedTerms: acceptedTermsSchema,
})

export const consentSchema = z.object({ acceptedTerms: acceptedTermsSchema })

export const resetRequestSchema = z.object({ email: emailSchema })

export const newPasswordFormSchema = z.object({ password: newPasswordSchema })
