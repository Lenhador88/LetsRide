import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FloatingAction } from '@/components/ui/FloatingAction'

/**
 * Three things a later refactor reverses in silence, each pinned once:
 *
 * **It stays under the navigation bar.** `z-40` against the navbar's `z-50`
 * (`globals.css`) is what keeps the tabs reachable if the two ever overlap —
 * a value bump here is invisible on any screenshot where the two do not
 * currently intersect. Verified both ways: with `z-50` swapped in for `z-40`
 * (so this control would sit ON TOP of the navbar instead of under it), this
 * suite's first assertion fails — 1 failed / 3 passed in this file, the
 * `z-40` one — where the unmutated source is 4 passed / 0 failed.
 *
 * **The hit target clears the 44×44 glove floor.** `h-14 w-14` is 56px. Swapping
 * to `h-10 w-10` (40px, under the floor) fails the second assertion the same
 * way — 1 failed / 3 passed.
 *
 * **It carries an accessible name**, since it draws an icon and no text — an
 * `aria-label` dropped in a restyle leaves an unnamed control with nothing
 * visibly wrong. Dropping the `aria-label={label}` line fails the third
 * assertion — 1 failed / 3 passed.
 *
 * Markup, not pixels — `vitest.config.ts` is `environment: 'node'`, so
 * `renderToStaticMarkup` gives what the browser would parse and no layout at
 * all; whether the control visually clears the navbar or the floor is a
 * screenshot's job, not this test's.
 */
describe('FloatingAction', () => {
  it('sits under the navigation bar (z-40, never z-50) and above it (.bottom-navbar)', () => {
    const html = renderToStaticMarkup(
      <FloatingAction label="Create" icon={<span data-testid="icon" />} onClick={() => {}} />
    )

    expect(html).toMatch(/\bz-40\b/)
    expect(html).not.toMatch(/\bz-50\b/)
    expect(html).toMatch(/\bbottom-navbar\b/)
  })

  it('clears the 44×44 glove floor', () => {
    const html = renderToStaticMarkup(
      <FloatingAction label="Create" icon={<span data-testid="icon" />} onClick={() => {}} />
    )

    expect(html).toMatch(/\bh-14\b/)
    expect(html).toMatch(/\bw-14\b/)
  })

  it('names itself for a screen reader, since it draws an icon and no text', () => {
    const html = renderToStaticMarkup(
      <FloatingAction label="Create" icon={<span data-testid="icon" />} onClick={() => {}} />
    )

    expect(html).toContain('aria-label="Create"')
  })

  it('draws the caller-supplied icon rather than one of its own', () => {
    const html = renderToStaticMarkup(
      <FloatingAction label="Create" icon={<span data-testid="icon" />} onClick={() => {}} />
    )

    expect(html).toContain('data-testid="icon"')
  })
})
