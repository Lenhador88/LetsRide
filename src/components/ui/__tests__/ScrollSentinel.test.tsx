import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScrollSentinel } from '@/components/ui/ScrollSentinel'

/**
 * `client-render-shell`'s "a browser observer SHALL be created in an effect
 * and torn down with its component" — this is the repo's first
 * `IntersectionObserver`, so this is also the first test pinning that rule
 * against a real component rather than by inspection.
 *
 * **Verified both ways per CLAUDE.md §Working Principles**: a version that
 * constructs the observer at module scope or during render fails
 * `'constructs no observer under renderToStaticMarkup'` below (`environment:
 * 'node'` has no `IntersectionObserver` global at all, so a naive version
 * throws on import or on render rather than merely failing quietly).
 */
describe('ScrollSentinel', () => {
  it('renders an ordinary element under renderToStaticMarkup, with no observer constructed', () => {
    // No global to stub: `environment: 'node'` has no `IntersectionObserver`
    // at all, so a version that reaches for one during render or at module
    // scope throws here rather than merely failing an assertion.
    const html = renderToStaticMarkup(<ScrollSentinel onVisible={() => {}} />)
    expect(html).toContain('aria-hidden="true"')
  })

  it('never calls onVisible during a render with no effects', () => {
    const onVisible = vi.fn()
    renderToStaticMarkup(<ScrollSentinel onVisible={onVisible} />)
    expect(onVisible).not.toHaveBeenCalled()
  })
})
