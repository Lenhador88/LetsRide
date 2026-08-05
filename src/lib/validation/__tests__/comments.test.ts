import { describe, expect, it } from 'vitest'
import { REPORT_REASON_WHEN_UNDRAWN } from '@/lib/validation/comments'
import {
  COMMENT_BODY_MAX_LENGTH,
  commentBodySchema,
  reportNoteSchema,
  reportPostcardSchema,
  reportReasonSchema,
} from '@/lib/validation/comments'



describe('commentBodySchema', () => {
  it('trims the stored value', () => {
    const result = commentBodySchema.safeParse('  Beautiful light on that road.  ')
    expect(result.success && result.data).toBe('Beautiful light on that road.')
  })

  it('rejects an empty or whitespace-only body', () => {
    for (const value of ['', '   ', '\n\t ']) {
      expect(commentBodySchema.safeParse(value).success, JSON.stringify(value)).toBe(false)
    }
  })

  it('accepts a body exactly at the limit', () => {
    expect(commentBodySchema.safeParse('x'.repeat(COMMENT_BODY_MAX_LENGTH)).success).toBe(true)
  })

  it('rejects one character over', () => {
    expect(commentBodySchema.safeParse('x'.repeat(COMMENT_BODY_MAX_LENGTH + 1)).success).toBe(false)
  })

  /**
   * The rule this whole schema exists to keep in step with 011's CHECK: the
   * ceiling is on the RAW length, so padding cannot smuggle a longer body past
   * a trimmed check. A naive `.trim().max(1000)` would accept this, and so
   * would a constraint written as `length(btrim(body)) <= 1000` — which is the
   * mutation that passed the entire RLS suite until an assertion was added for
   * it on the SQL side too.
   */
  it('counts whitespace padding against the ceiling', () => {
    const padded = ' '.repeat(500) + 'x'.repeat(COMMENT_BODY_MAX_LENGTH)
    expect(padded.trim().length).toBe(COMMENT_BODY_MAX_LENGTH)
    expect(commentBodySchema.safeParse(padded).success).toBe(false)
  })
})

describe('reportReasonSchema', () => {
  it.each(['spam', 'harassment', 'hate', 'nudity', 'violence', 'other'])('accepts %s', (reason) => {
    expect(reportReasonSchema.safeParse(reason).success).toBe(true)
  })

  it('rejects anything outside the constrained set', () => {
    for (const value of ['because', '', 'SPAM', null]) {
      expect(reportReasonSchema.safeParse(value).success, JSON.stringify(value)).toBe(false)
    }
  })
})

describe('reportNoteSchema', () => {
  it('turns an absent, empty or whitespace-only note into null', () => {
    for (const value of [null, '', '   ']) {
      const result = reportNoteSchema.safeParse(value)
      expect(result.success && result.data, JSON.stringify(value)).toBeNull()
    }
  })

  it('trims a real note', () => {
    const result = reportNoteSchema.safeParse('  they keep posting this  ')
    expect(result.success && result.data).toBe('they keep posting this')
  })

  it('rejects a note over the limit', () => {
    expect(reportNoteSchema.safeParse('x'.repeat(COMMENT_BODY_MAX_LENGTH + 1)).success).toBe(false)
  })
})

describe('reportPostcardSchema', () => {
  /**
   * A real v4 uuid, not one of the RLS suite's `00000000-…-0000000000e1`
   * fixtures. Zod 4's `z.uuid()` enforces the RFC 4122 version and variant
   * nibbles, so those fixture ids fail it — harmless in the app, where every id
   * comes from `uuid_generate_v4()`, but it will catch anyone who reaches for a
   * fixture id in a JS test.
   */
  const postcardId = '3f2a1c8e-5b7d-4e91-a2c6-8d4f0b1e7a53'

  it('accepts a well-formed report with no note', () => {
    const result = reportPostcardSchema.safeParse({ postcardId, reason: 'spam', note: null })
    expect(result.success && result.data).toEqual({ postcardId, reason: 'spam', note: null })
  })

  it('rejects a postcard id that is not a uuid', () => {
    expect(reportPostcardSchema.safeParse({ postcardId: 'nope', reason: 'spam', note: null }).success).toBe(false)
  })

  it('rejects a missing reason — a report with no stated reason is unactionable', () => {
    expect(reportPostcardSchema.safeParse({ postcardId, reason: null, note: null }).success).toBe(false)
  })
})

// Guards the hand-maintained half of the boundary: this list and 011's CHECK
// constraint must agree, and nothing enforces that automatically — the same
// standing risk RESERVED_USERNAMES carries against 003's denylist.
describe('the reason list and the migration', () => {
  it('matches the six values 011 constrains to', async () => {
    const { readFile } = await import('node:fs/promises')
    const sql = await readFile('supabase/migrations/011_postcard_interactions.sql', 'utf8')
    const match = sql.match(/reason in \(([^)]+)\)/)
    expect(match, 'the CHECK constraint should still be findable').not.toBeNull()

    const fromSql = [...match![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
    const { REPORT_REASONS } = await import('@/lib/validation/comments')
    expect(fromSql).toEqual([...REPORT_REASONS].sort())
  })
})

describe('REPORT_REASON_WHEN_UNDRAWN', () => {
  it('is a member of the enum the CHECK constraint enforces', async () => {
    const { REPORT_REASONS, REPORT_REASON_WHEN_UNDRAWN, reportReasonSchema } = await import(
      '@/lib/validation/comments'
    )

    // The point of the constant is that the one caller cannot send a value the
    // database will reject — the overflow menu has no reason picker to fall
    // back to, so a bad default would fail at the insert with no UI to correct.
    expect(REPORT_REASONS).toContain(REPORT_REASON_WHEN_UNDRAWN)
    expect(reportReasonSchema.safeParse(REPORT_REASON_WHEN_UNDRAWN).success).toBe(true)
  })

  it('is `other`, and changing it is a product decision rather than a rename', () => {
    // Asserted by value on purpose. Any other member would put a claim the
    // rider never made — "spam", "harassment" — into a moderation record.
    // If the design ever grows a reason step, this constant should be deleted,
    // not repointed.
    expect(REPORT_REASON_WHEN_UNDRAWN).toBe('other')
  })
})
