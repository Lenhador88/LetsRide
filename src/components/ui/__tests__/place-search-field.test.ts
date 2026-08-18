import { describe, expect, it } from 'vitest'
import { boundName, placeLabel } from '@/components/ui/PlaceSearchField'
import type { PlaceSearchResult } from '@/types'

/**
 * What a picked place is STORED as (PD-259). Only the pure half is covered —
 * the sheet itself needs a layout and an event loop, and this repo's Vitest
 * environment is `node` (see `CLAUDE.md`'s test table: jsdom is the answer only
 * when something needs a layout, and one label function does not).
 */
const place = (over: Partial<PlaceSearchResult> = {}): PlaceSearchResult => ({
  id: 'gers-1',
  label: 'Shell Pernis Werk',
  meta: 'Petroleumweg, Vondelingenplaat',
  lat: 51.88,
  lon: 4.36,
  ...over,
})

describe('placeLabel', () => {
  it('appends the locality, because a place name alone is often unplaceable', () => {
    expect(placeLabel(place())).toBe('Shell Pernis Werk, Vondelingenplaat')
  })

  it('does not stutter when the place IS its locality', () => {
    expect(placeLabel(place({ label: 'Utrecht', meta: 'Utrecht' }))).toBe('Utrecht')
  })

  it('matches the locality case-insensitively — Overture disagrees with itself', () => {
    expect(placeLabel(place({ label: 'Utrecht', meta: 'utrecht' }))).toBe('Utrecht')
  })

  it('falls back to the label alone when there is no meta line', () => {
    expect(placeLabel(place({ meta: null }))).toBe('Shell Pernis Werk')
    expect(placeLabel(place({ meta: '' }))).toBe('Shell Pernis Werk')
  })

  it('takes the LAST segment of meta, which is the locality rather than the street', () => {
    expect(placeLabel(place({ label: 'Bar', meta: 'Kerkstraat, Weena, Rotterdam' }))).toBe(
      'Bar, Rotterdam'
    )
  })

  it('ignores a trailing comma rather than appending an empty locality', () => {
    expect(placeLabel(place({ label: 'Bar', meta: 'Kerkstraat,' }))).toBe('Bar')
  })
})

describe('boundName', () => {
  it('leaves a name inside the bound alone', () => {
    expect(boundName('Utrecht', 200)).toBe('Utrecht')
    expect(boundName('x'.repeat(200), 200)).toBe('x'.repeat(200))
  })

  it('never returns more characters than the bound', () => {
    // The whole point: `places.name` reaches 203 on the real index and the
    // label built from it reaches 214, against a CHECK of 200. A picker that
    // can return an unstorable value is a dead end the rider cannot escape.
    const bounded = boundName('x'.repeat(214), 200)
    expect(bounded.length).toBe(200)
    expect(bounded.endsWith('\u2026')).toBe(true)
  })

  it('keeps the ellipsis INSIDE the budget rather than adding to it', () => {
    // Overshooting by one is the same bug arriving through the fix for it.
    expect(boundName('abcdef', 4)).toBe('abc\u2026')
    expect(boundName('abcdef', 4).length).toBe(4)
  })

  it('does not leave a dangling space before the ellipsis', () => {
    expect(boundName('Shell Pernis Werk', 7)).toBe('Shell\u2026')
  })

  it('applies no bound when the caller has no column limit', () => {
    expect(boundName('x'.repeat(500))).toBe('x'.repeat(500))
  })
})
