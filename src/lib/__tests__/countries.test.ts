import { describe, expect, it } from 'vitest'
import { COUNTRY_CODES, COUNTRY_TOTAL, countryFlag, countryName } from '@/lib/countries'
import { countryCodeSchema } from '@/lib/validation/profile'

describe('COUNTRY_CODES', () => {
  it('is every code in ISO 3166-1 alpha-2 shape', () => {
    // The same shape 014's CHECK constraint enforces. A code failing here would
    // be offered by the picker and then rejected by the database with a raw
    // 23514 — the exact split this schema exists to pre-empt.
    const malformed = COUNTRY_CODES.filter((code) => !/^[A-Z]{2}$/.test(code))
    expect(malformed).toEqual([])
  })

  it('has no duplicates', () => {
    // A duplicate would be harmless in the database (the primary key absorbs
    // it) and visible in the picker as the same country twice.
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length)
  })

  it('carries the countries the design draws', () => {
    // The 22 flags in `Profile / View your profile / Profile`, spot-checked.
    for (const code of ['NL', 'DE', 'FR', 'IT', 'PL', 'BE', 'ES', 'PT', 'GB', 'NO']) {
      expect(COUNTRY_CODES).toContain(code)
    }
  })

  it('reports a total that matches the list the picker offers', () => {
    // Deliberately not the design's 195: see the note on COUNTRY_TOTAL. What
    // must never happen is a denominator smaller than what can be selected.
    expect(COUNTRY_TOTAL).toBe(COUNTRY_CODES.length)
    expect(COUNTRY_TOTAL).toBeGreaterThan(195)
  })
})

describe('countryFlag', () => {
  it('turns a code into its regional-indicator pair', () => {
    expect(countryFlag('NL')).toBe('🇳🇱')
    expect(countryFlag('PT')).toBe('🇵🇹')
  })

  it('produces two code points, never a literal string', () => {
    expect([...countryFlag('DE')]).toHaveLength(2)
  })

  it('falls back to the input for anything that is not two uppercase letters', () => {
    // Renders visibly wrong rather than as a broken glyph.
    expect(countryFlag('nl')).toBe('nl')
    expect(countryFlag('NLD')).toBe('NLD')
    expect(countryFlag('')).toBe('')
  })

  it('has a flag for every code in the list', () => {
    const missing = COUNTRY_CODES.filter((code) => countryFlag(code) === code)
    expect(missing).toEqual([])
  })
})

describe('countryName', () => {
  it('resolves a code to an English region name', () => {
    expect(countryName('NL')).toBe('Netherlands')
    expect(countryName('PT')).toBe('Portugal')
  })

  it('never returns empty, so a picker row is always labelled', () => {
    const blank = COUNTRY_CODES.filter((code) => !countryName(code).trim())
    expect(blank).toEqual([])
  })
})

describe('countryCodeSchema', () => {
  it('accepts a known code', () => {
    expect(countryCodeSchema.parse('NL')).toBe('NL')
  })

  it('uppercases rather than rejecting on case', () => {
    // The database is strict; normalising here is what keeps the two agreeing.
    expect(countryCodeSchema.parse('nl')).toBe('NL')
    expect(countryCodeSchema.parse(' pt ')).toBe('PT')
  })

  it('rejects a well-shaped code that is not a real country', () => {
    // The CHECK constraint only knows the shape, so without the membership
    // refinement `ZZ` would store happily and render as its own code forever.
    expect(countryCodeSchema.safeParse('ZZ').success).toBe(false)
  })

  it('rejects the wrong length', () => {
    expect(countryCodeSchema.safeParse('N').success).toBe(false)
    expect(countryCodeSchema.safeParse('NLD').success).toBe(false)
    expect(countryCodeSchema.safeParse('').success).toBe(false)
  })
})
