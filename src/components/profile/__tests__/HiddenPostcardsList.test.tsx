import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { HiddenPostcardsList } from '@/components/profile/HiddenPostcardsList'
import { BannerProvider } from '@/components/ui/Banner'
import type { HiddenPostcard } from '@/types'

/**
 * **This file pins one property: no row on this list may vary with another
 * rider's actions.**
 *
 * The first cut showed a preview for a postcard the rider could still see and a
 * neutral row for one they could not. A pre-merge review showed that is a
 * **block detector** — the unrestorable state has one cause for a postcard with
 * no club, because the club arm is vacuous there and account deletion cascades
 * the hide row away entirely. Beside `BlockedRidersList`, which tells a rider
 * their own outbound blocks, a row going quiet said "that rider blocked you".
 *
 * `106` removed the differentiation rather than the copy, because no predicate
 * fixes it. **The regression this file catches is somebody making the screen
 * more helpful again** — and it is written to catch that even from a database
 * that has regressed: the third test hands the component fields the accessor
 * can no longer return, because the client is the second line of defence and a
 * test that only fed it two-column rows would pass against a component that
 * prints whatever it is given.
 *
 * `environment: 'node'` — `renderToStaticMarkup` answers "does this string
 * reach the markup", and nothing here needs a layout or an event.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/profile',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))

let rows: HiddenPostcard[] = []

vi.mock('@/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query')>()
  return {
    ...actual,
    useQuery: () => ({ data: rows, error: null, isLoading: false, refetch: () => {} }),
  }
})

function render() {
  return renderToStaticMarkup(
    <BannerProvider>
      <HiddenPostcardsList />
    </BannerProvider>
  )
}

describe('HiddenPostcardsList', () => {
  it('offers an unhide for each row', () => {
    rows = [{ postcard_id: 'p1', hidden_at: '2026-09-01T10:00:00Z' }]
    const html = render()

    expect(html).toContain('Unhide')
    expect(html).toContain('Hidden 1 Sept 2026')
  })

  it('renders two rows identically apart from their date', () => {
    // The whole security property, stated as an assertion: whatever differs
    // between two hidden postcards must not reach the markup.
    rows = [{ postcard_id: 'a', hidden_at: '2026-09-01T10:00:00Z' }]
    const first = render()
    rows = [{ postcard_id: 'b', hidden_at: '2026-09-01T10:00:00Z' }]
    const second = render()

    expect(first).toBe(second)
  })

  it('renders nothing extra even if the accessor regresses and sends a preview', () => {
    // Shapes `106` cannot produce. If a later migration puts them back, the
    // component must still refuse to draw them.
    rows = [
      {
        postcard_id: 'p2',
        hidden_at: '2026-09-02T10:00:00Z',
        // @ts-expect-error — deliberately not on HiddenPostcard any more
        restorable: false,
        caption: 'Coast road at dawn',
        author_username: 'ripper',
        taken_place_name: 'Zandvoort',
        image_url: 'https://example.test/leaked.jpg',
      },
    ]
    const html = render()

    expect(html).not.toContain('ripper')
    expect(html).not.toContain('Coast road at dawn')
    expect(html).not.toContain('Zandvoort')
    expect(html).not.toContain('leaked.jpg')
    // And no "this one is gone" state, which is the shape that carried the leak.
    expect(html).not.toMatch(/no longer|isn’t available|unavailable/i)
    expect(html).toContain('Unhide')
  })

  it('distinguishes an empty list from a failed read', () => {
    rows = []
    expect(render()).toContain('haven’t hidden any postcards')
  })
})
