import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExploreRidesStrip } from '@/components/rides/ExploreRidesStrip'

/**
 * The successor to `NearbyRidesStrip.test.tsx`, and the invariants inverted
 * with the component. That one asserted which states the row stayed *silent*
 * for, because it was a filter with nothing behind it. This one is the only
 * route to `/rides/explore`, so the interesting assertion is the opposite: it
 * must draw in every state, including the three where it has nothing to say
 * about proximity.
 *
 * The remaining risk is the `near <place>` clause, which is a claim about a
 * screen this component cannot see. It may only appear when the position
 * resolved AND at least one ride behind the row is actually near it — otherwise
 * the row promises `near Hoorn` over a list with nothing near Hoorn, which a
 * rider cannot discover until they tap. That is PD-258's count-disagrees-with-
 * the-list trap in the shape it takes once the count has been replaced by a
 * word, and it is the whole reason `nearCount` is a prop rather than something
 * derived here.
 *
 * **These assert which states draw and what they say, never the pixels.**
 * Vitest runs `environment: 'node'`, so `renderToStaticMarkup` gives the markup
 * the browser would have used and no layout at all — the same limit
 * `PostcardAction.test.tsx` records. The geometry is `ExploreClubsStrip`'s by
 * copy, and nothing here can confirm it.
 */

const html = (props: Parameters<typeof ExploreRidesStrip>[0]) =>
  renderToStaticMarkup(<ExploreRidesStrip {...props} />)

const UTRECHT = { name: 'Utrecht' }

describe('ExploreRidesStrip — the place clause', () => {
  it('names the place when the position resolved and rides are near it', () => {
    const out = html({ near: UTRECHT, nearCount: 3 })
    expect(out).toContain('Explore public rides near Utrecht')
  })

  it('names it for a single near ride too — the clause is not a plural', () => {
    expect(html({ near: UTRECHT, nearCount: 1 })).toContain('Explore public rides near Utrecht')
  })

  it('drops the place when nothing is near it, rather than claiming it', () => {
    const out = html({ near: UTRECHT, nearCount: 0 })
    expect(out).toContain('Explore public rides')
    expect(out).not.toContain('Utrecht')
  })

  it('drops the place while the count is still undecided', () => {
    // `undefined` is "no answer yet" — the position has not resolved, or the
    // explore read has not landed. Drawing `near Utrecht` here would be
    // inventing the answer a tick before it arrives.
    const out = html({ near: UTRECHT, nearCount: undefined })
    expect(out).not.toContain('Utrecht')
  })

  it('drops the place when there is no place to name', () => {
    // `nearLabel` answers null when the name would not match the number — a
    // profile city beside a device-measured distance. A count alone never
    // earns the clause.
    expect(html({ near: null, nearCount: 5 })).not.toContain(' near ')
  })
})

describe('ExploreRidesStrip — the door', () => {
  // Each of these is a state the filter this replaced would have rendered
  // nothing for. Hidden, they make /rides/explore unreachable: there is no
  // navbar entry for it and no other link to it anywhere in the app.
  const states = [
    ['no position, no count', { near: null, nearCount: undefined }],
    ['a position but nothing near it', { near: UTRECHT, nearCount: 0 }],
    ['a position and rides near it', { near: UTRECHT, nearCount: 2 }],
  ] as const

  it.each(states)('renders and links to /rides/explore with %s', (_label, props) => {
    const out = html({ ...props })
    expect(out).toContain('href="/rides/explore"')
    expect(out).toContain('Explore public rides')
  })

  it('offers no way to turn anything off', () => {
    // The filter version drew a cross in its active state and an `aria`
    // -less "Show all rides" label beside it. A door has no off.
    const out = html({ near: UTRECHT, nearCount: 2 })
    expect(out).not.toContain('Show all rides')
  })
})
