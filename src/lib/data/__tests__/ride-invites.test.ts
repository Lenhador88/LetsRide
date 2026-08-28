import { describe, expect, it } from 'vitest'
import { riderSearchPattern } from '@/lib/data/ride-invites'

/**
 * The rider picker's exposure argument rests on three bounds — prefix only,
 * two characters minimum, capped at 20 — and two of them live in this one
 * string transformation. These are the cases that defeat them.
 */
describe('riderSearchPattern', () => {
  it('anchors the query as a prefix', () => {
    expect(riderSearchPattern('pedro')).toBe('pedro%')
  })

  /**
   * `%` and `_` are LIKE's own wildcards. Escaped rather than stripped: `_` is
   * legal in a username, so dropping it would return hits the rider did not
   * ask for.
   */
  it('escapes LIKE’s own wildcards rather than stripping them', () => {
    expect(riderSearchPattern('a%b')).toBe('a\\%b%')
    expect(riderSearchPattern('a_b')).toBe('a\\_b%')
    expect(riderSearchPattern('a\\b')).toBe('a\\\\b%')
  })

  /**
   * **The case this test exists for.** `*` is PostgREST's documented alias for
   * `%` in its `like`/`ilike` operators, substituted server-side, and
   * postgrest-js passes the pattern through untouched — so an unescaped `*`
   * is a `%` that no amount of reading the LIKE documentation would flag.
   *
   * Each of the three below defeats a bound the picker's own docstring offers
   * as the reason its exposure is acceptable, and none of them crosses an RLS
   * line, so nothing else in the stack would go red.
   */
  it('escapes `*`, which PostgREST substitutes for `%` server-side', () => {
    // Infix over the whole rider directory — the bound is "prefix, never infix".
    expect(riderSearchPattern('*a')).toBe('\\*a%')
    // The first page of every username on the platform.
    expect(riderSearchPattern('**')).toBe('\\*\\*%')
    // The one-character prefix the two-character minimum exists to refuse.
    expect(riderSearchPattern('a*')).toBe('a\\*%')
  })

  it('leaves an ordinary query untouched apart from the anchor', () => {
    for (const value of ['pe', 'pedro88', 'a-b', 'RiderOne']) {
      expect(riderSearchPattern(value), value).toBe(`${value}%`)
    }
  })
})
