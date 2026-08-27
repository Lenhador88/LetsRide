import { z } from 'zod'

/**
 * Mirrors `feedback_body_length` in migration `084`, and the asymmetry is
 * deliberate there so it must be deliberate here: the **floor is on the trimmed
 * length** so a submission of nothing but spaces is refused, while the
 * **ceiling is on the raw length** so padding cannot smuggle a longer body past
 * a trimmed check.
 *
 * Zod's `.trim()` transforms before validating, so a naive
 * `.trim().min(1).max(2000)` would check the ceiling against the *trimmed*
 * string and disagree with the database. The raw length is checked first —
 * `commentBodySchema`'s shape, for its reason.
 *
 * **2000 rather than the comment field's 1000.** A comment is a reply on
 * somebody's postcard; this is the only channel a rider has for describing
 * something that went wrong, and the cost of a ceiling that truncates a useful
 * bug report is higher than the cost of a longer column.
 */
export const FEEDBACK_BODY_MAX_LENGTH = 2000

export const feedbackBodySchema = z
  .string()
  .max(FEEDBACK_BODY_MAX_LENGTH, `Must be ${FEEDBACK_BODY_MAX_LENGTH} characters or fewer.`)
  .transform((value) => value.trim())
  .refine((value) => value.length >= 1, 'Write something first.')
