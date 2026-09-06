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

/**
 * The screen function's own body, so the helper components in the same file
 * (`RidesLoading`, `RideCards`, `EmptyList`) do not contribute returns. Their
 * returns are not branches of the screen and must not be asserted against.
 */
function screenBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  expect(start, `no function ${name} in the source`).toBeGreaterThan(-1)
  const end = source.indexOf('\n}\n', start)
  expect(end, `could not find the end of ${name}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

const SCREENS = [
  { path: 'src/app/(app)/rides/page.tsx', screen: 'RidesScreen', skeleton: 'SkeletonList' },
  {
    path: 'src/app/(app)/postcards/page.tsx',
    screen: 'PostcardsScreen',
    skeleton: 'SkeletonDeck',
  },
] as const

describe('each list screen silences every skeleton and carries one LoadingRegion', () => {
  for (const { path, screen, skeleton } of SCREENS) {
    it(`${path} leaves no skeleton announcing`, () => {
      const source = stripComments(readFileSync(path, 'utf8'))

      // Every occurrence of the screen's own shape passes `announce={false}`.
      // A bare `<SkeletonList />` here is one more insertion, and it is exactly
      // what a later edit adds without noticing.
      const drawn = source.match(new RegExp(`<${skeleton}[^>]*/>`, 'g')) ?? []
      expect(drawn.length).toBeGreaterThan(0)
      for (const site of drawn) expect(site).toContain('announce={false}')

      // No hand-rolled live region in the screen either — the region is
      // `LoadingRegion` and nothing else. **The property is "no second live
      // region", not "no `role="status"` string"**, so both spellings are
      // checked: `aria-live` alone IS a live region and needs no `role` at
      // all, which is what someone hand-rolling one writes first.
      expect(source).not.toMatch(/aria-live/)
      expect(source).not.toMatch(/role=[^>\n]*status/)
    })

    it(`${path} opens EVERY branch with LoadingRegion, and carries no others`, () => {
      const source = stripComments(readFileSync(path, 'utf8'))
      const body = screenBody(source, screen)

      // **Every `return` the screen can take, found rather than counted.** The
      // count is deliberately derived here: an earlier version asserted a
      // hardcoded three and skipped any branch that had no region, so adding a
      // fourth early return — an offline state, a permission gate — passed
      // while reintroducing the defect. That branch's child 0 is a different
      // element type, so entering it unmounts `LoadingRegion` and leaving it
      // mounts a fresh one, which is the insertion that announces.
      //
      // React matches fragment children by position, so the invariant is that
      // every branch returns a fragment whose FIRST child is the region. A
      // single-line `return <X />` cannot satisfy that and fails here, which is
      // the intent rather than a limitation.
      // The floor is load-bearing twice over: it also fails if `screenBody`'s
      // `\n}\n` slice ever cuts short, since a truncated body loses returns.
      const returns = [...body.matchAll(/\breturn\s*([\s\S]{0,60})/g)]
      expect(returns.length, 'expected the screen to have branches').toBeGreaterThanOrEqual(3)

      for (const [, tail] of returns) {
        expect(tail.replace(/\s+/g, ' ').trimStart()).toMatch(/^\(\s*<>\s*<LoadingRegion\b/)
      }

      // **One region per branch and not one more, counted over the whole FILE
      // rather than the screen slice.** The branch assertion above cannot see
      // a region outside the screen function, and the dangerous place to put
      // one is `RidesLoading`/`PostcardsLoading` — which is exactly the shape
      // PD-220's body proposes, and which is rendered at BOTH cold-load
      // positions, so a region there is inserted twice and announces twice.
      // That is the original defect restored, and without this count the whole
      // suite stays green through it.
      const regions = source.match(/<LoadingRegion\b/g) ?? []
      expect(regions).toHaveLength(returns.length)
    })
  }
})
