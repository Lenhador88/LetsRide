import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LoadingRegion,
  SkeletonDeck,
  SkeletonFilterBar,
  SkeletonList,
} from '@/components/ui/Skeleton'

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
 * **The wiring half**: each list screen must silence *every* skeleton it draws
 * and carry exactly one `LoadingRegion`. Those screens draw a skeleton at three
 * positions during one cold load — the `<Suspense>` fallback, the
 * `!filters.data` gate, and the list/deck slot while the second read is in
 * flight — and no two of them reconcile, so any region left inside one is
 * inserted afresh and announces again. Leaving a single position announcing
 * looks correct in every render and is audible only to a screen reader, so it
 * is asserted against the source: no static render can drive a Suspense
 * boundary to resolve, and the failing and passing states produce identical
 * markup at every individual position.
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

  it('draws the same geometry either way, so a silenced shape still reserves it', () => {
    // The silenced variants stand at the `<Suspense>` fallback and the gate,
    // where their whole remaining job is to be the same size as what replaces
    // them. Same bar count and same classes; only the accessibility attributes
    // differ.
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
    // so a region here would be one more insertion on the two screens that draw
    // it, which are the two this issue is about.
    const html = renderToStaticMarkup(<SkeletonFilterBar />)
    expect(countRegions(html)).toBe(0)
    expect(html).toContain('aria-hidden')
  })
})

describe('LoadingRegion', () => {
  it('announces by its text content and is out of flow', () => {
    const loading = renderToStaticMarkup(<LoadingRegion label="Loading rides" />)

    expect(countRegions(loading)).toBe(1)
    expect(loading).toContain('Loading rides')
    // Text, not `aria-label`: a live region announces the content that changed,
    // and an empty region with a label has nothing to change.
    expect(loading).not.toContain('aria-label')
    // `sr-only` is `position: absolute`, so this reserves no space on two
    // layouts PD-217 and PD-218 pinned to the pixel.
    expect(loading).toContain('sr-only')
  })

  it('renders the same element when idle, so finishing a load is silent', () => {
    // A null label must EMPTY the region, never unmount it. Unmounting and
    // remounting is the insertion that announces, which is the whole defect.
    const idle = renderToStaticMarkup(<LoadingRegion label={null} />)

    expect(countRegions(idle)).toBe(1)
    expect(idle).not.toContain('Loading')
  })
})

/**
 * Source assertions for the wiring, read off disk with comments stripped.
 *
 * **Comments are stripped for the reason `CLAUDE.md` §Technology Decisions
 * calls the comment trap** — both files now carry prose explaining the three
 * positions and the silencing, so an unstripped search for `announce={false}`
 * or `role="status"` matches the explanation as readily as the code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const SCREENS = [
  { path: 'src/app/(app)/rides/page.tsx', skeleton: 'SkeletonList', branches: 3 },
  { path: 'src/app/(app)/postcards/page.tsx', skeleton: 'SkeletonDeck', branches: 3 },
] as const

describe('each list screen silences every skeleton and carries one LoadingRegion', () => {
  for (const { path, skeleton, branches } of SCREENS) {
    it(`${path} leaves no skeleton announcing`, () => {
      const source = stripComments(readFileSync(path, 'utf8'))

      // Every occurrence of the screen's own shape passes `announce={false}`.
      // A bare `<SkeletonList />` here is one more insertion, and it is exactly
      // what a later edit adds without noticing.
      const drawn = source.match(new RegExp(`<${skeleton}[^>]*/>`, 'g')) ?? []
      expect(drawn.length).toBeGreaterThan(0)
      for (const site of drawn) expect(site).toContain('announce={false}')

      // No `role="status"` written into the screen itself either — the region
      // is `LoadingRegion` and nothing else.
      expect(source).not.toContain('role="status"')
    })

    it(`${path} renders LoadingRegion once per branch, first`, () => {
      const source = stripComments(readFileSync(path, 'utf8'))

      // One per returnable branch — the error branch, the gate and the loaded
      // branch — because React matches fragment children by position: the same
      // child index in every branch is what makes it one element that persists
      // rather than three that each announce on mount.
      const regions = source.match(/<LoadingRegion label=/g) ?? []
      expect(regions).toHaveLength(branches)

      // ...and it leads each of them. A `LoadingRegion` after a conditional
      // sibling reconciles against a different element and remounts.
      for (const branch of source.split('return (').slice(1)) {
        if (!branch.includes('<LoadingRegion')) continue
        const opener = branch.slice(branch.indexOf('<>') + 2).trimStart()
        expect(opener.startsWith('<LoadingRegion')).toBe(true)
      }
    })
  }
})
