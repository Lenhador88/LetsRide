import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SectionHeader } from '@/components/ui/SectionHeader'

/**
 * PD-342 gave this component a second trailing slot, and the one thing a later
 * change can silently break is that the two do not compete.
 *
 * **`action` and `create` must both survive together.** Every call site that
 * draws a `(+)` draws `See all` in the same state — a section only gets the
 * icon once it has rows, which is the same moment its list has something to
 * open — so a refactor that collapses the two slots into one looks correct
 * against any single screenshot and quietly removes the entrance to the list on
 * all four of them.
 *
 * **The `(+)` must carry an accessible name.** It is an icon with no text, so
 * the label is the only thing a screen reader has; an `aria-label` dropped in a
 * restyle leaves four unnamed links and nothing visibly wrong.
 *
 * Markup, never pixels — `vitest.config.ts` is `environment: 'node'`, so
 * `renderToStaticMarkup` gives what the browser would have parsed and no layout
 * at all. Whether the control clears the glove floor is a screenshot's job.
 */
describe('SectionHeader', () => {
  it('draws the See all link and the (+) together', () => {
    const html = renderToStaticMarkup(
      <SectionHeader
        title="Postcards"
        action={{ label: 'See all', href: '/postcards' }}
        create={{ label: 'Add a postcard', href: '/postcards/new' }}
      />
    )

    expect(html).toContain('See all')
    expect(html).toContain('href="/postcards"')
    expect(html).toContain('href="/postcards/new"')
  })

  it('names the (+) for a screen reader, since it draws no text', () => {
    const html = renderToStaticMarkup(
      <SectionHeader title="Club rides" create={{ label: 'Plan a ride', href: '/rides/new' }} />
    )

    expect(html).toContain('aria-label="Plan a ride"')
  })

  it('draws neither slot when the section offers neither', () => {
    const html = renderToStaticMarkup(<SectionHeader title="Journal" />)

    expect(html).not.toContain('<a')
    expect(html).not.toContain('aria-label')
  })
})
