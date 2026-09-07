import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * PD-251 — the warm guard splash must leave nothing REACHABLE underneath it.
 *
 * `resolveGuardView` already decides `overlay`, and `guard-cache.test.ts`
 * already asserts the value it returns. What had no test at all is the half
 * `RouteGuard` owns: whether the component *honours* it. That gap is stated in
 * `RouteGuard.tsx`'s own comment — "`resolveGuardView`'s tests assert the
 * value; only this honours it" — and it is exactly the shape that survives a
 * refactor, because every other gate stays green when it breaks. `tsc` sees a
 * `div`, lint sees a `div`, and the walk asks only whether the screen rendered.
 *
 * **The defect this pins:** the cover is opaque and `fixed inset-0`, so it
 * hides the shell from sight and from a pointer and does nothing whatever
 * about the tab order or the accessibility tree. Before the fix a rider on a
 * keyboard could Tab into a `Navbar` link behind the cover, and Enter would
 * navigate an app the guard had not finished vetting them for.
 *
 * **Markup, never pixels** — `vitest.config.ts` is `environment: 'node'`, so
 * `renderToStaticMarkup` gives what the browser would parse and no layout at
 * all, matching `ClubWaveButton.test.tsx` and `SectionHeader.test.tsx`. jsdom
 * would buy a real focus traversal and is deliberately not used: **jsdom does
 * not implement `inert`**, so a jsdom test would assert the attribute exactly
 * as this one does while *looking* as though it had proved focus containment.
 * The weaker-looking test is the honest one here.
 *
 * **The two attributes are asserted separately and on purpose.** `inert` is
 * the focus and hit-testing half; `aria-hidden` is the assistive-technology
 * half. Dropping either leaves a real defect — `aria-hidden` alone leaves a
 * focusable subtree hidden from a screen reader, which is worse than neither —
 * so one assertion spanning both would let either regress silently.
 *
 * Verified both ways per CLAUDE.md §Working Principles. Five mutations against
 * `RouteGuard.tsx` — **re-measure rather than adjust these if the file
 * changes**:
 *
 * - **drop `inert`**, keeping `aria-hidden` → **1 failed, 5 passed** (only
 *   *makes the covered shell inert*);
 * - **drop `aria-hidden`**, keeping `inert` → **1 failed, 5 passed** (only
 *   *hides the covered shell from the accessibility tree*);
 * - **set both unconditionally** rather than from `view.overlay` → **1 failed,
 *   5 passed** — only *leaves the shell reachable when the guard has allowed
 *   it*;
 * - **drop the `|| undefined`**, leaving `inert={view.overlay}` and
 *   `aria-hidden={view.overlay}` → **1 failed, 5 passed** — the same assertion,
 *   because React omits `inert={false}` but renders `aria-hidden="false"`;
 * - **render `{children}` bare instead of through the wrapper** → **3 failed,
 *   3 passed** (both attribute assertions plus the structural one).
 *
 * The first three each fail exactly one assertion, and a *different* one — which
 * is what proves they are pinned separately rather than riding on each other.
 * The third is the one that matters most: the first two are the defect coming
 * back, while the third is the *over-correction* — an app inert on every screen
 * — which nothing else in the repo would catch and which would break the app for
 * every rider rather than for a minority.
 *
 * `leaves the shell reachable when the guard has allowed it` passing under the
 * fifth mutation is correct rather than a gap: bare `children` carry neither
 * attribute, so the allowed case genuinely is reachable. That mutation is caught
 * by the other three assertions.
 */

const guardCache = {
  attachGuardAuthListener: vi.fn(),
  ensureGuardState: vi.fn(),
  getGuardSnapshot: vi.fn(() => ({})),
  getServerGuardSnapshot: vi.fn(() => ({})),
  // `undefined` short-circuits `resolveDestination` in the component, so the
  // real guard rules never run and `resolveGuardView` alone decides the branch
  // — which is the thing under test.
  guardStateFrom: vi.fn(() => undefined),
  resolveGuardView: vi.fn(() => ({ kind: 'children', overlay: false })),
  retryGuardRead: vi.fn(),
  subscribeGuardCache: vi.fn(() => () => {}),
}

vi.mock('@/lib/auth/guard-cache', () => guardCache)
vi.mock('next/navigation', () => ({
  usePathname: () => '/postcards',
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/auth/GuardError', () => ({ GuardError: () => null }))

const { RouteGuard } = await import('@/components/auth/RouteGuard')

const SHELL = 'route-guard-shell-probe'

function render(view: { kind: string; overlay: boolean }): string {
  guardCache.resolveGuardView.mockReturnValue(view)
  return renderToStaticMarkup(
    <RouteGuard>
      <a href="/rides">{SHELL}</a>
    </RouteGuard>
  )
}

describe('RouteGuard — what the warm overlay leaves underneath it', () => {
  it('makes the covered shell inert', () => {
    const html = render({ kind: 'splash', overlay: true })

    expect(html).toContain(SHELL)
    expect(html).toMatch(/<div[^>]*\binert\b[^>]*>/)
  })

  it('hides the covered shell from the accessibility tree', () => {
    const html = render({ kind: 'splash', overlay: true })

    expect(html).toContain(SHELL)
    expect(html).toMatch(/<div[^>]*aria-hidden="true"[^>]*>/)
  })

  it('leaves the shell reachable when the guard has allowed it', () => {
    const html = render({ kind: 'children', overlay: false })

    expect(html).toContain(SHELL)
    // **Absent, not merely not-"true".** `aria-hidden="false"` is a different
    // thing from no attribute — it announces the shell as explicitly not
    // hidden — and it is exactly what a bare `aria-hidden={view.overlay}`
    // would emit here, since React renders `false` for `aria-*` and omits it
    // only for real boolean attributes like `inert`. `not.toContain(
    // 'aria-hidden="true"')` passes against that, which is the hole this
    // closes; do not loosen it back.
    //
    // Scoped to the wrapper rather than the whole string: `src/` is full of
    // `aria-hidden` on decorative icons (`grep -rn aria-hidden src/ | wc -l`),
    // so an unscoped match false-fails the day this fixture renders any real
    // subtree. Anchoring on `<div` is safe against the obvious escape — a
    // wrapper refactored to another element fails the two tests above first.
    expect(html).not.toMatch(/\binert\b/)
    expect(html).not.toMatch(/<div[^>]*aria-hidden/)
  })

  it('wraps the shell in the same layout-free element on both of those paths', () => {
    // The structural half of the no-remount argument in `RouteGuard.tsx`: one
    // element, one position, so flipping `overlay` changes an attribute rather
    // than the tree. A static render cannot observe reconciliation, so this
    // pins the structure that argument rests on and claims nothing more.
    // `class="contents"` is `display: contents` — the wrapper is permanent, on
    // every screen, and must generate no box.
    for (const view of [
      { kind: 'children', overlay: false },
      { kind: 'splash', overlay: true },
    ]) {
      expect(render(view)).toContain('class="contents"')
    }
  })

  it('renders no shell at all before the first decision', () => {
    // Boot: `overlay` is false because there is nothing mounted to preserve,
    // so the splash stands alone and unreachability is free.
    expect(render({ kind: 'splash', overlay: false })).not.toContain(SHELL)
  })

  it('renders no shell behind the retry screen', () => {
    // PD-122's screen holds the one control the rider is meant to press and
    // stays up until they press it, so it never overlays. This pins that the
    // wrapper did not quietly turn it into an overlay case.
    expect(render({ kind: 'retry', overlay: false })).not.toContain(SHELL)
  })
})
