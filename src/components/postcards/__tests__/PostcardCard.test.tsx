import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Postcard } from '@/types'

// Stands in for a provider rather than for behaviour: the card's own
// `PostcardMenu` calls `useRouter`/`usePathname`, which throw outside a Next
// tree. Nothing here navigates, and no effect runs under a static render.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/postcards',
}))

const { PostcardCard } = await import('@/components/postcards/PostcardCard')
const { BannerProvider } = await import('@/components/ui/Banner')

// The shell's own provider, mounted for the same reason the mock above exists:
// `PostcardMenu` calls `useBanner`, which throws outside one. It is always
// mounted in the app, so this is the real tree rather than a stub.
const render = (fill: boolean) =>
  renderToStaticMarkup(
    <BannerProvider>
      <PostcardCard postcard={postcard()} fill={fill} />
    </BannerProvider>
  )

/**
 * PD-343 made the photo the row that absorbs a card's spare height, and the
 * invariant worth a test is the **direction** of that: which of the two rows is
 * `flex-1`.
 *
 * It is one class either way, it reverses silently, and both directions render
 * a card that looks plausible in a screenshot of a short caption — which is
 * exactly the state the defect shipped in. The card was `shrink-0` photo +
 * `flex-1` caption for months and nobody reading the file noticed that every
 * pixel a tall phone offered went to text on a photo screen.
 *
 * The two modes assert opposite things on purpose:
 *
 *   `fill`   the photo grows and the caption is capped — the deck, where a card
 *            is handed a height it did not choose
 *   flow     the photo is a square and the caption is unbounded — the popup and
 *            `/postcards/detail`, where there is no parent height to divide and
 *            `flex-1` on the photo would collapse it to nothing
 *
 * **Classes, not pixels.** `vitest.config.ts` is `environment: 'node'`, so
 * `renderToStaticMarkup` gives what the browser would have parsed and no layout
 * at all — the same limit `PostcardAction.test.tsx` records. That the photo is
 * *bigger* is a screenshot's job; that it is the element being grown is this
 * file's.
 *
 * Rendered with no `PostcardViewerProvider`, which is `usePostcardViewer`'s
 * documented `null` fallback — so the photo carries no overlay button and the
 * only element matching the wrapper's selector is the wrapper itself.
 */
const postcard = (over: Partial<Postcard> = {}): Postcard => ({
  id: '11111111-1111-4111-8111-111111111111',
  author_id: '22222222-2222-4222-8222-222222222222',
  club_id: null,
  image_path: 'rider/photo.jpg',
  caption: 'Coffee stop',
  created_at: '2026-08-01T09:00:00Z',
  updated_at: '2026-08-01T09:00:00Z',
  taken_place_name: null,
  taken_country_code: null,
  image_url: 'https://example.test/signed.jpg',
  author: {
    id: '22222222-2222-4222-8222-222222222222',
    username: 'pedro',
    avatar_url: null,
  } as Postcard['author'],
  ...over,
})

/** The photo's own wrapper — the element carrying the ratio or the growth. */
const photoClasses = (html: string) => {
  const match = html.match(/class="([^"]*relative[^"]*overflow-hidden[^"]*rounded[^"]*)"/)
  expect(match, 'the photo wrapper should still be the first `relative` box').not.toBeNull()
  return match![1]
}

describe('PostcardCard — which row absorbs the height (PD-343)', () => {
  it('grows the photo and caps the caption in the deck', () => {
    const html = render(true)

    expect(photoClasses(html)).toContain('flex-1')
    // The cap is what hands the growth over; without it the caption takes it
    // back and the photo is a fixed remainder again.
    expect(html).toContain('max-h-20')
  })

  it('draws the photo as a square in flow, where flex-1 would collapse it', () => {
    const html = render(false)

    expect(photoClasses(html)).toContain('aspect-square')
    expect(photoClasses(html)).not.toContain('flex-1')
    // The popup is where a rider READS a caption, so nothing bounds it there.
    expect(html).not.toContain('max-h-20')
  })

  it('keeps the caption scrollable and swipe-proof in the deck (PD-224)', () => {
    // `touch-none` on the caption is what stops the browser claiming a swipe
    // that starts on it — see the component, which carries the measurement.
    // It rides on the same className as the cap, so a change to one can drop
    // the other without any test noticing.
    const html = render(true)

    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('touch-none')
  })
})
