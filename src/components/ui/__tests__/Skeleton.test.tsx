import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkeletonDeck, SkeletonFilterBar, SkeletonList } from '@/components/ui/Skeleton'

/**
 * PD-220 — a cold load announced *"loading"* twice on both list screens, and
 * the two halves of the fix fail in different files, so they are pinned
 * separately here.
 *
 * **The primitive half**: `announce={false}` has to remove the live region
 * while leaving the geometry alone. A variant that quietly drew a different
 * shape would reintroduce PD-217/PD-218's cold-load jump at the one boundary
 * those issues exist to hold still, and nothing about the announcement would
 * look wrong.
 *
 * **The wiring half**: which of the two positions passes it. `announce={false}`
 * on the `<Suspense>` fallback fixes the double announcement; the same prop on
 * the `!filters.data` gate instead *also* silences one of the two, so the count
 * looks fixed — and leaves a rider who navigates in from another tab with no
 * announcement at all, because the fallback only renders in the prerendered
 * HTML. Both states are one token apart, neither is visible on any screenshot,
 * and no render test can tell them apart, since it would have to drive a
 * Suspense boundary to resolve. So that half is asserted against the source.
 *
 * Markup, not pixels — `vitest.config.ts` is `environment: 'node'`, so
 * `renderToStaticMarkup` gives what a browser would parse and no layout at all.
 */

const ROLE_STATUS = /role="status"/g

function countRegions(html: string): number {
  return html.match(ROLE_STATUS)?.length ?? 0
}

/** Every shape is built out of the base `Skeleton`, which is the pulse class. */
function countBars(html: string): number {
  return html.match(/motion-safe:animate-pulse/g)?.length ?? 0
}

describe('SkeletonRegion opt-out', () => {
  it('SkeletonList announces once by default and not at all when silenced', () => {
    const announcing = renderToStaticMarkup(<SkeletonList />)
    const silent = renderToStaticMarkup(<SkeletonList announce={false} />)

    expect(countRegions(announcing)).toBe(1)
    expect(announcing).toContain('aria-label="Loading list"')

    expect(countRegions(silent)).toBe(0)
    expect(silent).toContain('aria-hidden')
  })

  it('SkeletonDeck announces once by default and not at all when silenced', () => {
    const announcing = renderToStaticMarkup(<SkeletonDeck />)
    const silent = renderToStaticMarkup(<SkeletonDeck announce={false} />)

    expect(countRegions(announcing)).toBe(1)
    expect(announcing).toContain('aria-label="Loading postcards"')

    expect(countRegions(silent)).toBe(0)
    expect(silent).toContain('aria-hidden')
  })

  it('draws the same geometry either way, so the fallback still reserves the shape', () => {
    // The silent variant stands at the `<Suspense>` fallback, where its whole
    // remaining job is to be the same size as the gate below it. Same bar count
    // and same root classes; only the accessibility attributes differ.
    for (const [announcing, silent] of [
      [renderToStaticMarkup(<SkeletonList />), renderToStaticMarkup(<SkeletonList announce={false} />)],
      [renderToStaticMarkup(<SkeletonDeck />), renderToStaticMarkup(<SkeletonDeck announce={false} />)],
    ]) {
      expect(countBars(silent)).toBe(countBars(announcing))
      expect(countBars(silent)).toBeGreaterThan(0)

      const classes = (html: string) => html.match(/class="([^"]*)"/g)
      expect(classes(silent)).toEqual(classes(announcing))
    }
  })

  it('SkeletonFilterBar still carries no region at all', () => {
    // Pre-existing and load-bearing: it reserves height and describes nothing,
    // so a region here would be the second announcement all over again, this
    // time inside a single position.
    const html = renderToStaticMarkup(<SkeletonFilterBar />)
    expect(countRegions(html)).toBe(0)
    expect(html).toContain('aria-hidden')
  })
})

/**
 * `queryKeys`-style source assertions: the two list screens, read off disk with
 * comments stripped, because a `<Suspense fallback>` cannot be rendered to the
 * point of resolving from a static render.
 *
 * **Comments are stripped for the reason `CLAUDE.md` §Technology Decisions
 * calls the comment trap** — both files now carry prose explaining which
 * position takes `announce={false}` and why, so an unstripped search for it
 * matches the explanation as readily as the code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const SCREENS = [
  { path: 'src/app/(app)/rides/page.tsx', loading: 'RidesLoading' },
  { path: 'src/app/(app)/postcards/page.tsx', loading: 'PostcardsLoading' },
] as const

describe('the live region sits at the gate, not at the Suspense fallback', () => {
  for (const { path, loading } of SCREENS) {
    it(`${path} silences only the fallback`, () => {
      const source = stripComments(readFileSync(path, 'utf8'))

      // Exactly one silenced position on the screen. Two would mean the gate
      // was silenced as well, which is the no-announcement failure.
      const silenced = source.match(/announce=\{false\}/g) ?? []
      expect(silenced).toHaveLength(1)

      // ...and it is the one inside the boundary's `fallback`, not the gate.
      const boundary = source.slice(source.indexOf('<Suspense'), source.indexOf('</Suspense>'))
      expect(boundary).toContain('announce={false}')

      // The gate renders the same component and must NOT carry the prop: it is
      // the position every path into a loading state passes through.
      const gate = source.match(new RegExp(`if \\(!filters\\.data\\) return <${loading}[^>]*>`))
      expect(gate).not.toBeNull()
      expect(gate![0]).not.toContain('announce')
    })
  }
})
