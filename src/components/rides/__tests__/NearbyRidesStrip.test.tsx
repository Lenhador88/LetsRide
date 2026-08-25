import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NearbyRidesStrip } from '@/components/rides/NearbyRidesStrip'

/**
 * PD-260's strip renders in some states and not others, and getting that wrong
 * is not cosmetic in either direction: hidden when the filter is on, the rider
 * is left on a filtered — often empty — list with nothing on screen to turn it
 * off; shown at a zero, it is a row whose only function is to strand them.
 *
 * **These assert which states draw and what they say, never the pixels.**
 * Vitest runs `environment: 'node'`, so `renderToStaticMarkup` gives the markup
 * the browser would have used and no layout at all — the same limit
 * `PostcardAction.test.tsx` records. The geometry is `ExploreClubsStrip`'s by
 * copy, and nothing here can confirm it.
 */

const html = (props: Parameters<typeof NearbyRidesStrip>[0]) =>
  renderToStaticMarkup(<NearbyRidesStrip {...props} />)

const OFF = { active: false, href: '/rides?near=1' }
const ON = { active: true, href: '/rides' }

describe('NearbyRidesStrip — when it is off', () => {
  it('draws the count and the place', () => {
    const out = html({ ...OFF, count: 3, near: { name: 'Utrecht' } })
    expect(out).toContain('3 rides near Utrecht')
    expect(out).toContain('href="/rides?near=1"')
  })

  it('says ride, singular, at one', () => {
    expect(html({ ...OFF, count: 1, near: { name: 'you' } })).toContain('1 ride near you')
  })

  /**
   * The clubs strip's rule, arrived at from the other direction: a zero row
   * exists only to be tapped, and tapping it lands on an empty list.
   */
  it('draws nothing at a zero count', () => {
    expect(html({ ...OFF, count: 0, near: { name: 'Utrecht' } })).toBe('')
  })

  /** `undefined` is "not yet" — promising a filter that is not there. */
  it('draws nothing before the count is known', () => {
    expect(html({ ...OFF, count: undefined, near: { name: 'Utrecht' } })).toBe('')
  })

  /** No position means no place to name, so no claim of proximity at all. */
  it('draws nothing without a position', () => {
    expect(html({ ...OFF, count: 3, near: null })).toBe('')
  })
})

describe('NearbyRidesStrip — when it is on', () => {
  it('reads as the way out, not as a count', () => {
    const out = html({ ...ON, count: 3, near: { name: 'Utrecht' } })
    expect(out).toContain('Showing rides near Utrecht')
    expect(out).toContain('Show all rides')
    expect(out).toContain('href="/rides"')
  })

  /**
   * **The stranding case.** A rider arrives on `?near=1` with no position —
   * a shared link, a reload after revoking permission, a profile city that
   * stopped geocoding. Every off-state rule above would hide the row on exactly
   * that load, and the list underneath it is empty.
   */
  it('still renders with no position at all', () => {
    const out = html({ ...ON, count: undefined, near: null })
    expect(out).toContain('Showing rides near you')
    expect(out).toContain('Show all rides')
  })

  /** And with a near-set that has emptied under the active filter. */
  it('still renders at a zero count', () => {
    expect(html({ ...ON, count: 0, near: { name: 'Utrecht' } })).toContain('Showing rides near')
  })
})
