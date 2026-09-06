import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FloatingAction } from '@/components/ui/FloatingAction'

/**
 * Five things a later refactor reverses in silence, each pinned once:
 *
 * **It stays under the navigation bar.** `z-40` against the navbar's `z-50`
 * (`globals.css`) is what keeps the tabs reachable if the two ever overlap —
 * a value bump here is invisible on any screenshot where the two do not
 * currently intersect. Verified both ways: with `z-50` swapped in for `z-40`
 * (so this control would sit ON TOP of the navbar instead of under it), this
 * suite's first assertion fails — 1 failed / 5 passed in this file, the
 * `z-40` one — where the unmutated source is 6 passed / 0 failed.
 *
 * **It uses its OWN bottom offset, never the bar's** — PD-423. `.bottom-navbar`
 * is right for a full-width bar and wrong for a circle, and reverting to it is
 * a one-token edit that looks like a tidy-up. Both directions are asserted,
 * because the regression is the *presence* of the old class rather than the
 * absence of the new one. Reverting the class in the source fails that
 * assertion — 1 failed / 5 passed.
 *
 * **The offset's arithmetic is pinned against `globals.css` itself**, since the
 * markup test above can only see a class name and the defect lived in the
 * class's `bottom` value. `environment: 'node'` computes no CSS at all, so this
 * reads the stylesheet as text — **comment-stripped first**, per `CLAUDE.md`
 * §the comment trap: that file's own prose names `.bottom-navbar` a dozen times
 * explaining why this control no longer uses it, and an unstripped grep would
 * match its obituaries. Dropping the `1px` term fails it — 1 failed / 5 passed —
 * and so does restating `--floating-action-clearance` as a literal, which is
 * what lets the reserved space drift away from the offset it is derived from.
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
/** `globals.css` with every comment removed — see the note above on why. */
const globalsCss = readFileSync(
  new URL('../../../app/globals.css', import.meta.url),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('FloatingAction', () => {
  it('sits under the navigation bar (z-40, never z-50) and clear of it', () => {
    const html = renderToStaticMarkup(
      <FloatingAction label="Create" icon={<span data-testid="icon" />} onClick={() => {}} />
    )

    expect(html).toMatch(/\bz-40\b/)
    expect(html).not.toMatch(/\bz-50\b/)
    expect(html).toMatch(/\bbottom-floating-action\b/)
    // The regression PD-423 fixed, and the direction that actually matters: the
    // bar's offset gave this control a -1px gap (measured, 390x844).
    expect(html).not.toMatch(/\bbottom-navbar\b/)
  })

  it('clears the navigation bar by its hairline plus a real gap', () => {
    const rule = globalsCss.match(/\.bottom-floating-action\s*\{([^}]*)\}/)?.[1]

    expect(rule).toBeDefined()
    // The nav's own `border-t`, which `--navbar-tabs` excludes. Without it the
    // circle's lower arc sits inside the bar and `z-50` paints over it.
    expect(rule).toContain('1px')
    expect(rule).toContain('var(--floating-action-gap)')
    expect(rule).toContain('var(--navbar-tabs)')
    expect(rule).toContain('var(--safe-bottom)')
  })

  it('derives its reserved clearance from that same offset, never a literal', () => {
    const clearance = globalsCss.match(/--floating-action-clearance:([^;]*);/)?.[1]

    expect(clearance).toBeDefined()
    // A literal here is how the space a page reserves drifts away from where
    // the control actually sits — which is what left it at 80px for an offset
    // that had moved to 81.
    expect(clearance).toContain('var(--floating-action-gap)')
    expect(clearance).toContain('1px')
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
