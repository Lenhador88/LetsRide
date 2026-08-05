import { z } from 'zod'

/**
 * Mirrors `postcard_comments_body_length` in migration 011, and the asymmetry
 * is deliberate there so it must be deliberate here: the **floor is on the
 * trimmed length** so a comment of nothing but spaces is refused, while the
 * **ceiling is on the raw length** so padding cannot smuggle a longer body past
 * a trimmed check.
 *
 * Zod's `.trim()` transforms before validating, so a naive
 * `.trim().min(1).max(1000)` would check the ceiling against the *trimmed*
 * string and disagree with the database. The raw length is checked first.
 */
export const COMMENT_BODY_MAX_LENGTH = 1000

export const commentBodySchema = z
  .string()
  .max(COMMENT_BODY_MAX_LENGTH, `Must be ${COMMENT_BODY_MAX_LENGTH} characters or fewer.`)
  .transform((value) => value.trim())
  .refine((value) => value.length >= 1, 'Write something first.')

/**
 * The six values 011's CHECK allows. Kept in step by hand — there is no
 * automated check that this list and the constraint agree, the same standing
 * risk `RESERVED_USERNAMES` carries against 003's denylist.
 */
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'nudity', 'violence', 'other'] as const

/**
 * What the postcard overflow menu sends, because **the design collects no
 * reason.** `Home / Report post` is marked Done and has four frames — feed,
 * options sheet, confirmation banner — with no reason step between them, so
 * reporting is one tap. The schema still demands a value: `reason` is a CHECK
 * constraint in `011` and the enum above.
 *
 * `other` is the only member that asserts nothing the rider did not say.
 * Picking `spam` or `harassment` on their behalf would put words in a
 * moderation record.
 *
 * **The consequence is that the column carries no signal** while this is the
 * only caller — every report arrives identical. That is a design gap, not a
 * schema one, and the fix is a reason step in Figma rather than a guess here.
 * Logged in docs/FIGMA-FIDELITY-TODO.md §Postcard overflow menu.
 */
export const REPORT_REASON_WHEN_UNDRAWN = 'other' satisfies (typeof REPORT_REASONS)[number]

export const reportReasonSchema = z.enum(REPORT_REASONS, {
  message: 'Choose a reason.',
})

/** Optional, and an empty string is not a note — same shape as the constraint. */
export const reportNoteSchema = z
  .string()
  .max(COMMENT_BODY_MAX_LENGTH, `Must be ${COMMENT_BODY_MAX_LENGTH} characters or fewer.`)
  .nullable()
  .transform((value) => {
    const trimmed = value?.trim() ?? ''
    return trimmed === '' ? null : trimmed
  })

export const reportPostcardSchema = z.object({
  postcardId: z.uuid('That postcard could not be found.'),
  reason: reportReasonSchema,
  note: reportNoteSchema,
})
