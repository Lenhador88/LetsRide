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
 * match its obituaries.
 *
 * **The sign is asserted as a PROPERTY OF THE DECLARATION, not as a pattern
 * around the term — after three attempts at the latter each passed the
 * mutation it was written for.** Worth keeping in full, because the third one
 * looked airtight:
 *
 * 1. `toContain('1px')` — a substring test, satisfied by `- 1px`, `11px`,
 *    `0.1px`. Flipping the offset to `- 1px` puts the control 2px INSIDE the
 *    nav, worse than the defect this fixes, and passed green.
 * 2. `/\+\s*1px\b|1px\s*\+/` — the second alternative matches the `1px +`
 *    sitting *inside* `-1px + …`, so it passed the exact mutation it replaced 1
 *    to catch.
 * 3. `/(?<![-\d.])1px\b/` — a **one-character** lookbehind, so it rejects
 *    `-1px` and accepts `- 1px` with a space, which is the spelling its own
 *    comment named. Caught by the delta review, not by me.
 *
 * What holds is `not.toMatch(/-\s*[\d.]/)`: the declaration is a sum of
 * positive lengths, so a `-` before a digit is always wrong however it is
 * spelled, while `--safe-bottom` and friends are a `-` before a letter. It
 * needs no cleverness about where the term sits.
 *
 * **The measured set — ten mutations against `globals.css` and the component,
 * with the one that is not 1F/5P stated rather than rounded:**
 *
 * | Mutation | Result |
 * |---|---|
 * | offset `+ 1px` → `- 1px` (spaced) | 1F/5P |
 * | offset `+ 1px` → `-1px` (tight) | 1F/5P |
 * | offset term dropped | 1F/5P |
 * | clearance `1px` → `- 1px` (spaced) | 1F/5P |
 * | clearance `1px` → `-1px` (tight) | 1F/5P |
 * | clearance term dropped | 1F/5P |
 * | clearance restated as a literal `5.0625rem` | **2F/4P** |
 * | control `h-14` → `h-16`, clearance untouched | 1F/5P |
 * | clearance `3.5rem` → `4rem`, control untouched | 1F/5P |
 * | clearance `3.5rem` → `13.5rem` | 1F/5P |
 *
 * **They are not disjoint and an earlier note claimed they were.** The ten land
 * on three `it` blocks, and the literal mutation trips both the derivation
 * assertion and the coupling one — which is correct behaviour (a literal has no
 * `3.5rem` in it either) rather than a redundancy to remove.
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
    expect(rule).toMatch(/\b1px\b/)
    // **Every term is ADDITIVE, asserted as its own property rather than by
    // pattern-matching the one term.** Three attempts at "1px, with its sign"
    // failed here, each passing the mutation it was written for: `toContain`
    // took `- 1px`; `/1px\s*\+/` took the `1px +` inside `-1px + …`; and
    // `/(?<![-\d.])1px\b/` is a ONE-CHARACTER lookbehind, so it took `- 1px`
    // with the space — the very spelling its own comment named. All three
    // measured, none reasoned.
    //
    // This is not a fourth pattern for the term. It says what is actually
    // true of the whole declaration: it is a sum of positive lengths. A `-`
    // before a digit is therefore always wrong, which `- 1px`, `-1px` and
    // `+ 1px * -1` all are, while `--safe-bottom` and friends are a `-`
    // before a letter and unaffected.
    expect(rule).not.toMatch(/-\s*[\d.]/)
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
    expect(clearance).toMatch(/\b1px\b/)
    // The same additive rule as the offset above, and it is owed here for a
    // sharper reason: `gap - 1px + 3.5rem + 0.5rem` reserves 79px against an
    // 81px offset, so the last content row is clipped by the control — the
    // defect PD-423 exists to remove, arriving through the clearance instead.
    expect(clearance).not.toMatch(/-\s*[\d.]/)
  })

  it('clears the 44×44 glove floor, and is the height the clearance is keyed to', () => {
    const html = renderToStaticMarkup(
      <FloatingAction label="Create" icon={<span data-testid="icon" />} onClick={() => {}} />
    )

    expect(html).toMatch(/\bh-14\b/)
    expect(html).toMatch(/\bw-14\b/)
    // The second thing this pins, and the one with no other guard: the same
    // 56px is written into `--floating-action-clearance` as the control's
    // height. Moving one without the other leaves a page reserving the wrong
    // amount, silently.
    // The left boundary is load-bearing: without it `13.5rem` and `23.5rem`
    // satisfy the match while the control's own height has gone.
    expect(globalsCss).toMatch(/--floating-action-clearance:[^;]*(?<![\d.])3\.5rem/)
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
