// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **Which path runs when a rider taps Share** — PD-451.
 *
 * `shareCard.test.ts` pins the composition and `share.test.ts` pins each
 * transport on its own. Neither can say that the *image* is tried first and the
 * link only when it is not shared, and that ordering is the entire feature: a
 * reversed version shares a link that a recipient without an account cannot
 * open, reports every outcome identically, and is invisible in a diff review.
 *
 * **jsdom rather than `renderToStaticMarkup`, and the reason is the event.**
 * The whole behaviour lives in an `onClick` handler and its `await`s; under
 * this repo's default `environment: 'node'` there is nothing to tap.
 */

const composeShareCard = vi.fn()
const shareImageFile = vi.fn()
const shareAppLink = vi.fn()
/** Records the order the two transports were reached in, which is the property
 * this file exists for — call counts alone are satisfied by either order. */
let calls: string[] = []

vi.mock('@/lib/postcards/shareCard', () => ({
  composeShareCard: (...args: unknown[]) => {
    calls.push('compose')
    return composeShareCard(...args)
  },
}))

vi.mock('@/lib/share', () => ({
  shareImageFile: (...args: unknown[]) => {
    calls.push('image')
    return shareImageFile(...args)
  },
  shareAppLink: (...args: unknown[]) => {
    calls.push('link')
    return shareAppLink(...args)
  },
}))

const { ShareButton } = await import('@/components/postcards/ShareButton')

const POSTCARD = {
  id: 'p1',
  image_url: 'https://example.test/signed.jpg',
  taken_place_name: 'Amsterdam',
  taken_country_code: 'NL',
  created_at: '2026-08-14T09:30:00.000Z',
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  calls = []
  composeShareCard.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }))
  shareImageFile.mockResolvedValue('shared')
  shareAppLink.mockResolvedValue('shared')

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<ShareButton postcard={POSTCARD} />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

function tap() {
  const button = container.querySelector('button')
  if (!button) throw new Error('The share control did not render.')
  return act(async () => {
    button.click()
  })
}

describe('ShareButton', () => {
  it('shares the composed image and does NOT also share the link', async () => {
    await tap()

    expect(calls).toEqual(['compose', 'image'])
    // The assertion that fails if someone "simplifies" this back to a link
    // share with an image alongside it. A rider who shared the picture has
    // already shared; handing them a login-gated URL as well is the defect the
    // issue opens with.
    expect(shareAppLink).not.toHaveBeenCalled()
  })

  it('composes from the postcard, not from its id', async () => {
    await tap()
    // The call site passes the whole row precisely because the card needs the
    // signed URL, the place and the date. An id would type-check against a
    // narrower prop and silently compose nothing.
    expect(composeShareCard).toHaveBeenCalledWith(POSTCARD)
  })

  it('falls back to the link when the device will not take a file', async () => {
    shareImageFile.mockResolvedValue('unavailable')

    await tap()

    expect(calls).toEqual(['compose', 'image', 'link'])
    expect(shareAppLink).toHaveBeenCalledWith('/postcards/detail?id=p1', 'A postcard on LetsRide')
  })

  it('falls back to the link when composing throws', async () => {
    // A signed URL expires hourly, so this is the ordinary case rather than an
    // exotic one: a card left open past the hour composes nothing.
    composeShareCard.mockRejectedValue(new Error('The postcard image could not be fetched (403).'))

    await tap()

    expect(calls).toEqual(['compose', 'link'])
    expect(shareAppLink).toHaveBeenCalled()
  })

  /**
   * `shareImageFile` answers `'shared'` for a dismissal, and this is where that
   * choice pays: the rider closed the sheet, and the link path must not run
   * behind them. It is the same rule PD-344 established one layer down.
   */
  it('shares nothing further when the rider dismisses the image sheet', async () => {
    shareImageFile.mockResolvedValue('shared')

    await tap()

    expect(shareAppLink).not.toHaveBeenCalled()
  })

  it('says so when neither path could share', async () => {
    shareImageFile.mockResolvedValue('unavailable')
    shareAppLink.mockResolvedValue('unavailable')

    await tap()

    // The label is this control's only channel — it has no banner to raise —
    // so an outcome the rider cannot see for themselves has to reach it.
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Could not share the link'
    )
  })

  it('reports a copied link, so a fallback the rider cannot see is still announced', async () => {
    shareImageFile.mockResolvedValue('unavailable')
    shareAppLink.mockResolvedValue('copied')

    await tap()

    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Link copied')
  })
})
