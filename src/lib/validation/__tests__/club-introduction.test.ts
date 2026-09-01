import { describe, expect, it } from 'vitest'
import {
  CLUB_INTRODUCTION_MAX_LENGTH,
  CLUB_INTRODUCTION_STARTER,
  clubIntroductionSchema,
} from '@/lib/validation/clubs'

/**
 * `clubIntroductionSchema` — `097`, PD-365, task 8.1.
 *
 * These cover the MESSAGE layer, matching `club-location.test.ts`'s own
 * framing: the GUARANTEE is `club_threads_introduction_length` (`097` §1),
 * asserted against the live database rather than here. What these prove is
 * that the two bounds agree — the failure that would otherwise put a raw
 * `23514` in front of a rider instead of a sentence — and that the floor is
 * on the TRIMMED value while the ceiling is on the RAW length, matching
 * `clubMessageBodySchema`'s own asymmetry.
 */
describe('clubIntroductionSchema', () => {
  it('accepts an ordinary introduction', () => {
    const parsed = clubIntroductionSchema.safeParse("Hi, I'm new here!")
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toBe("Hi, I'm new here!")
  })

  it('refuses an empty string', () => {
    expect(clubIntroductionSchema.safeParse('').success).toBe(false)
  })

  it('refuses whitespace only, matching the database whitespace floor', () => {
    expect(clubIntroductionSchema.safeParse('   ').success).toBe(false)
    expect(clubIntroductionSchema.safeParse('\n\t  \n').success).toBe(false)
  })

  it('trims leading and trailing whitespace from an otherwise valid value', () => {
    const parsed = clubIntroductionSchema.safeParse('  Hello club  ')
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toBe('Hello club')
  })

  it('accepts exactly the maximum length', () => {
    expect(clubIntroductionSchema.safeParse('x'.repeat(CLUB_INTRODUCTION_MAX_LENGTH)).success).toBe(
      true
    )
  })

  it('refuses one character past the maximum length, matching the CHECK', () => {
    expect(
      clubIntroductionSchema.safeParse('x'.repeat(CLUB_INTRODUCTION_MAX_LENGTH + 1)).success
    ).toBe(false)
  })

  it('checks the ceiling against the RAW length, not the trimmed one — padding cannot smuggle a longer value past it', () => {
    // Padding either side of one real character with the max length in spaces
    // is well past the bound before trimming, and must be refused on the raw
    // length exactly as `clubThreadTitleSchema` and `clubMessageBodySchema`
    // are.
    const padded =
      ' '.repeat(CLUB_INTRODUCTION_MAX_LENGTH) + 'x' + ' '.repeat(CLUB_INTRODUCTION_MAX_LENGTH)
    expect(clubIntroductionSchema.safeParse(padded).success).toBe(false)
  })

  it('accepts the suggested starter verbatim, per Q3', () => {
    // Q3's own requirement: a rider who posts this unedited has posted an
    // ordinary introduction and nothing may be able to tell.
    const parsed = clubIntroductionSchema.safeParse(CLUB_INTRODUCTION_STARTER)
    expect(parsed.success).toBe(true)
  })

  it('the starter itself satisfies both bounds, so the sheet never suggests wording the database would refuse', () => {
    expect(CLUB_INTRODUCTION_STARTER.trim().length).toBeGreaterThan(0)
    expect(CLUB_INTRODUCTION_STARTER.length).toBeLessThanOrEqual(CLUB_INTRODUCTION_MAX_LENGTH)
  })
})
