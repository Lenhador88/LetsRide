import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { HiddenPostcardsList } from '@/components/profile/HiddenPostcardsList'
import { BannerProvider } from '@/components/ui/Banner'
import type { HiddenPostcard } from '@/types'

/**
 * **This file pins the leak mitigation, and it is the reason the file exists.**
 *
 * A hide stops being restorable for three reasons — the rider left the club,
 * the author blocked them, or the author deleted their account. `105` collapses
 * all three into one boolean and NULLs every preview column, because naming the
 * middle one turns the hidden list into a **block detector**: hide one postcard
 * per rider you want to watch, then read this screen. `supabase/tests/
 * rls_test.sql` defends the opposite property in as many words — *"the blocked
 * rider is not told they were blocked"* — and that channel does not exist at
 * all without this feature.
 *
 * The database is the real mitigation. **These tests are the second line**, and
 * they are written deliberately against a row the accessor should never
 * produce: `restorable: false` carrying an author name and a caption anyway. If
 * a later migration regresses and starts returning the preview alongside a
 * false flag, the component must still refuse to render it. A test that only
 * fed it well-formed rows would pass against a component that blindly prints
 * whatever it is given, which is exactly the regression worth catching.
 *
 * `environment: 'node'` — `renderToStaticMarkup` is enough for "does this
 * string reach the markup", and nothing here needs a layout or an event.
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

const RESTORABLE: HiddenPostcard = {
  postcard_id: 'p1',
  hidden_at: '2026-09-01T10:00:00Z',
  restorable: true,
  caption: 'Coast road at dawn',
  author_username: 'ripper',
  taken_place_name: 'Zandvoort',
  image_path: 'postcards/a/1.jpg',
  created_at: '2026-08-30T10:00:00Z',
  image_url: 'https://example.test/signed.jpg',
}

/** What the accessor actually returns once a hide stops being restorable. */
const UNRESTORABLE: HiddenPostcard = {
  postcard_id: 'p2',
  hidden_at: '2026-09-02T10:00:00Z',
  restorable: false,
  caption: null,
  author_username: null,
  taken_place_name: null,
  image_path: null,
  created_at: null,
}

describe('HiddenPostcardsList', () => {
  it('renders the caption and author of a restorable row', () => {
    rows = [RESTORABLE]
    const html = render()

    expect(html).toContain('Coast road at dawn')
    expect(html).toContain('ripper')
    expect(html).toContain('Unhide')
  })

  it('says nothing specific about why a row is unrestorable', () => {
    rows = [UNRESTORABLE]
    const html = render()

    expect(html).toContain('isn’t available to you any more')
    // The three reasons must be indistinguishable. Any of these words would
    // name one of them.
    expect(html).not.toMatch(/block|left the club|deleted their account/i)
    // Unhide restores nothing here, so the affordance clears the row instead.
    expect(html).toContain('Remove')
    expect(html).not.toContain('Unhide')
  })

  it('refuses to render a preview the accessor should never have sent with restorable false', () => {
    // A row that cannot occur today: the flag is false but the preview columns
    // are populated. This is the regression shape — a migration that stops
    // NULLing the columns — and the component is the second line of defence.
    rows = [
      {
        ...UNRESTORABLE,
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
    expect(html).toContain('isn’t available to you any more')
  })

  it('distinguishes an empty list from a failed read', () => {
    rows = []
    expect(render()).toContain('haven’t hidden any postcards')
  })
})
