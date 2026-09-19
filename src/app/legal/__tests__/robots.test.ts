import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { metadata } from '../layout'

/**
 * `/legal/terms` publishes the operator's home address (PD-459), and this
 * segment is in the route guard's PUBLIC denylist — no session, no account, no
 * app. The address being readable is the decision; the address being
 * **indexable** is not, and PD-462 exists to possibly take it back out, which a
 * search result and an archive survive.
 *
 * **The measurement that makes this non-obvious**: the prerendered HTML does
 * not contain the address at all, because `RouteGuard` renders the splash in
 * the prerender pass. The string lives in a static JS chunk that any
 * JS-executing crawler renders. So a grep of `.next/server/**.html` reads
 * clean and means nothing — the directive is what settles it, and it lands in
 * the shell's head where a crawler reads it before rendering.
 *
 * Asserted on the exported object rather than on built output, so it runs in the
 * unit suite rather than behind `next build`.
 */
describe('the /legal segment is not indexable', () => {
  it('declares noindex, nofollow on the layout', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('declares it on the SEGMENT, so a page nobody has written yet is covered', () => {
    // A `robots` export on `terms/page.tsx` alone would satisfy the case above
    // and leave `/legal/whatever-comes-next` open. The layout is the thing that
    // cannot be forgotten, which is the same argument `rides/join/layout.tsx`
    // (115, PD-430) makes for the ride invite preview.
    const layout = readFileSync(
      path.resolve(fileURLToPath(new URL('../layout.tsx', import.meta.url))),
      'utf8'
    )
    expect(layout).toContain('export const metadata')

    // Read off the directory rather than a literal list: a hand-written list
    // stops covering the segment the day somebody adds a page to it, which is
    // the exact failure this case exists to prevent. `/legal/support` (PD-467)
    // was the fifth and was added to the directory, not to a list.
    const SEGMENT = fileURLToPath(new URL('..', import.meta.url))
    const pages = readdirSync(SEGMENT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
      .map((entry) => entry.name)
      // A directory is not a page: a route group, a nested route whose parent
      // holds no `page.tsx`, or a `_components/` folder would make the read
      // below throw ENOENT and the case would die instead of asserting.
      .filter((name) => existsSync(path.resolve(SEGMENT, name, 'page.tsx')))

    // Both ways: a derivation that silently returns nothing passes every
    // assertion below and looks exactly like a clean segment.
    expect(pages.length).toBeGreaterThanOrEqual(5)
    expect(pages).toContain('support')

    for (const page of pages) {
      const source = readFileSync(
        path.resolve(fileURLToPath(new URL(`../${page}/page.tsx`, import.meta.url))),
        'utf8'
      )
      // Not a style rule: a page-level robots export would shadow the layout's
      // for that page, and the next edit to it would be the one that drops the
      // directive without touching this file.
      expect(source).not.toContain('robots')
    }
  })
})
