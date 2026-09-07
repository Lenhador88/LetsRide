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
 * **The offset's arithmetic is pinned by PINNING THE DECLARATION'S EXACT
 * TEXT, and every attempt to be cleverer than that failed.** `environment:
 * 'node'` computes no CSS, so the stylesheet is read as text — comment-stripped
 * first, per `CLAUDE.md` §the comment trap, since `globals.css`'s own prose
 * names `.bottom-navbar` repeatedly while explaining why this control no longer
 * uses it.
 *
 * **Why an exact string rather than a pattern for the `1px` hairline term.**
 * Four patterns were tried and each passed a mutation that broke the geometry.
 * The one that generalises: **every term in both declarations is a `var()`, so
 * CSS subtraction here is always a `-` before a LETTER** — which is why "no `-`
 * before a digit" waved `- var(--navbar-action)` straight through. Indirection
 * (`--hairline: -1px`) defeats any text pattern outright, because the sign can
 * live in a different declaration. No pattern over a `calc()` of `var()`s can
 * see the value; only computing it can, and that is `npm run walk`'s job, not
 * this file's environment.
 *
 * So the assertion pins the whole expression. Any edit fails loudly and has to
 * be made here too — which is the property actually wanted, since these two
 * numbers are a decision rather than something to infer.
 *
 * **Each declaration is extracted on its own, never from the rule body.** An
 * earlier version matched `\{([^}]*)\}` for the offset, so a `border: 1px`
 * added anywhere in the rule satisfied a `1px` assertion while the hairline
 * term was gone — and, in the other direction, any future declaration carrying
 * a negative number would have turned the suite red with the `bottom` calc
 * perfectly correct.
 *
 * **The hit target clears the 44×44 glove floor — AND is the control height
 * `--floating-action-clearance` is derived from.** `h-14 w-14` is 56px, and
 * `globals.css` hardcodes that same `3.5rem` as the control's height in the
 * clearance a page reserves. **So this assertion guards two different things
 * and the second one has no other guard.** Bump the control to `h-16` and the
 * honest reading of the failure is *"64px also clears 44px, relax it"* — which
 * leaves the reserved clearance 8px short with every gate green. Change one,
 * change the other. Swapping to `h-10 w-10` (40px, under the floor) fails it —
 * 1 failed / 5 passed.
 *
 * **It carries an accessible name**, since it draws an icon and no text — an
 * `aria-label` dropped in a restyle leaves an unnamed control with nothing
 * visibly wrong. Dropping the `aria-label={label}` line fails that assertion —
 * 1 failed / 5 passed.
 *
 * **Verified both ways.** Nine mutations fail (`1F/5P`, except the two that
 * trip both clearance assertions at `2F/4P`): the offset gaining
 * `- var(--navbar-action)`; the clearance gaining `- var(--navbar-tabs)`; a
 * stray `border: 1px` in the rule with the hairline term deleted; the hairline
 * replaced by `var(--hairline)` where that is `-1px`; `1px` → `0.1px`; `+ 1px`
 * → `- 1px`; the clearance restated as the literal `5.0625rem`; `h-14` → `h-16`
 * with the clearance untouched; and the clearance's `3.5rem` → `4rem` with the
 * control untouched. The first four all passed before this file stopped
 * pattern-matching.
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

  /**
   * One declaration's value, whitespace-collapsed. Extracted per DECLARATION
   * rather than from the rule body: an earlier version matched the whole
   * `{ … }`, so a `border: 1px` anywhere in the rule satisfied a `1px`
   * assertion while the hairline term was gone.
   */
  const declaration = (name: string, within: string | undefined = globalsCss) => {
    if (within === undefined) return undefined
    const body = within.match(new RegExp(`(?:^|[;{])\\s*${name}\\s*:([^;]*);`))?.[1]
    return body?.replace(/\s+/g, ' ').trim()
  }

  const floatingRule = globalsCss.match(/\.bottom-floating-action\s*\{([^}]*)\}/)?.[1]

  it('clears the navigation bar by its hairline plus a real gap', () => {
    expect(floatingRule).toBeDefined()
    // The whole expression, exactly. `--navbar-tabs` is the tab ROW and
    // excludes the bar's own `border-t`, so the `1px` is that hairline;
    // without it the circle's lower arc sits inside the bar and `z-50` paints
    // over it. Changing this is a decision and has to be made here too.
    expect(declaration('bottom', floatingRule)).toBe(
      'calc( var(--safe-bottom) + var(--navbar-tabs) + 1px + var(--floating-action-gap) )'
    )
  })

  it('derives its reserved clearance from that same offset, never a literal', () => {
    // Pinned the same way and for the same reason. A literal here is how the
    // space a page reserves drifts from where the control actually sits, and a
    // subtracted term is how it silently under-reserves — `- var(--navbar-tabs)`
    // takes 56px off and the last content row is clipped by the control, which
    // is the defect PD-423 exists to remove arriving through the clearance.
    expect(declaration('--floating-action-clearance')).toBe(
      'calc( 1px + var(--floating-action-gap) + 3.5rem + 0.5rem )'
    )
  })

  it('clears the 44×44 glove floor, and is the height the clearance is keyed to', () => {
    const html = renderToStaticMarkup(
      <FloatingAction label="Create" icon={<span data-testid="icon" />} onClick={() => {}} />
    )

    expect(html).toMatch(/\bh-14\b/)
    expect(html).toMatch(/\bw-14\b/)
    // The second thing this pins, and the one with no other guard: the same
    // 56px is written into `--floating-action-clearance` as the control's
    // height, where it is `3.5rem`. Moving one without the other leaves a page
    // reserving the wrong amount, silently — so the two are asserted together.
    expect(declaration('--floating-action-clearance')).toContain('3.5rem')
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
