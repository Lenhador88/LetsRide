import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `LocationQuestionRow` draws on the two Explore screens and nowhere else —
 * PD-447.
 *
 * ## What this is the negative half of
 *
 * The row and the Explore strip are both 56px, both on `bg-surface`, both with
 * a `LocationFilledIcon` and a trailing chevron, and both name the rider's
 * town. Stacked in one slot on `/rides` and `/clubs` they read as one control
 * drawn twice — product owner, 2026-09-08: *"2 labels on the top don't look
 * great."* The fix was to move the question to the screens it affects, so the
 * defect this refuses is **a second row reappearing in the strip's slot**.
 *
 * ## A source scan rather than a render
 *
 * Both tab roots are `'use client'` pages built out of `useQuery` and
 * `useSearchParams`, so rendering one to assert the absence of a row would mean
 * standing up the cache, the router and three reads — to check something the
 * import graph already decides. The row cannot draw on a screen that does not
 * import it, and an import is exactly what a later session adds when it wants
 * the row back. `no-service-role-key.test.ts` is the same shape for the same
 * reason.
 *
 * **Verified both ways**: adding the import back to either tab root fails the
 * first case, and deleting it from either Explore screen fails the second.
 */

const app = (p: string) => fileURLToPath(new URL(`../app/${p}`, import.meta.url))

const TAB_ROOTS = ['(app)/rides/page.tsx', '(app)/clubs/page.tsx']
const EXPLORE_SCREENS = ['(app)/rides/explore/page.tsx', '(app)/clubs/explore/page.tsx']

describe('the strip slot on a tab root holds exactly one row', () => {
  it.each(TAB_ROOTS)('%s does not draw the location question', (file) => {
    const source = readFileSync(app(file), 'utf8')

    // The whole component name, so a comment mentioning it in passing — and
    // both of these files carry one explaining why the row is gone — does not
    // count as drawing it.
    expect(source).not.toContain('<LocationQuestionRow')
    expect(source).not.toContain("from '@/lib/location/dismissal'")
    expect(source).not.toMatch(/^import .*LocationQuestionRow/m)
  })
})

describe('the Explore screens are where the question is asked', () => {
  it.each(EXPLORE_SCREENS)('%s draws it, outside its list gate', (file) => {
    const source = readFileSync(app(file), 'utf8')
    expect(source).toContain('<LocationQuestionRow')

    // **Outside the read gate**, which on `/rides/explore` it was not until
    // PD-447: a rider whose list was failing or still loading was never asked
    // the question that fixes that list's distances. Both screens now mount it
    // directly under the `.pb-navbar-action-extra` wrapper, before the first
    // branch on the list read — so the row appears earlier in the file than the
    // gate does.
    const row = source.indexOf('<LocationQuestionRow')
    const gate = source.search(/\{\s*(rides|clubs)\.error \?/)
    expect(gate).toBeGreaterThan(-1)
    expect(row).toBeLessThan(gate)
  })

  it.each(EXPLORE_SCREENS)('%s passes the raw column, never nearLabel', (file) => {
    const source = readFileSync(app(file), 'utf8')

    // `nearLabel` answers the literal `you` for a device fix and for a city
    // `localityOf` will not shorten, which renders as `Still in you?`. Both
    // screens still call `nearLabel` for their list heading, so this asserts
    // the prop rather than the import.
    expect(source).toContain('town={city.data}')
    expect(source).not.toMatch(/town=\{nearLabel\(/)
  })
})
