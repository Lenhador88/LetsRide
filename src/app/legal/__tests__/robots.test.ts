import { readFileSync } from 'node:fs'
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

    const pages = ['terms', 'privacy', 'account-deletion', 'attributions']
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
