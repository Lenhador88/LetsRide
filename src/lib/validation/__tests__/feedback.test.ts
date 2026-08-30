import { describe, expect, it } from 'vitest'
import { FEEDBACK_BODY_MAX_LENGTH, feedbackBodySchema } from '@/lib/validation/feedback'

describe('feedbackBodySchema', () => {
  it('trims the stored value', () => {
    const result = feedbackBodySchema.safeParse('  The map tile never loads.  ')
    expect(result.success && result.data).toBe('The map tile never loads.')
  })

  it('rejects an empty or whitespace-only body', () => {
    for (const value of ['', '   ', '\n\t ']) {
      expect(feedbackBodySchema.safeParse(value).success, JSON.stringify(value)).toBe(false)
    }
  })

  it('accepts a body exactly at the limit', () => {
    expect(feedbackBodySchema.safeParse('x'.repeat(FEEDBACK_BODY_MAX_LENGTH)).success).toBe(true)
  })

  it('rejects one character over', () => {
    expect(feedbackBodySchema.safeParse('x'.repeat(FEEDBACK_BODY_MAX_LENGTH + 1)).success).toBe(
      false
    )
  })

  /**
   * The rule that keeps this schema in step with `084`'s CHECK: the ceiling is
   * on the RAW length, so padding cannot smuggle a longer body past a trimmed
   * check. A naive `.trim().max(2000)` would accept this — and so would a
   * constraint written `length(btrim(body)) <= 2000`, which is why `084.7`
   * asserts the same case on the SQL side rather than trusting this one.
   */
  it('rejects a body over the limit even when the excess is whitespace', () => {
    expect(
      feedbackBodySchema.safeParse('x'.repeat(FEEDBACK_BODY_MAX_LENGTH) + '  ').success
    ).toBe(false)
  })
})
