import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  composeShareCard,
  resolveShareCardLayout,
  resolveShareCardText,
  truncateToWidth,
} from '@/lib/postcards/shareCard'

/**
 * The share card's pure half — PD-451.
 *
 * `composeShareCard` itself needs `createImageBitmap`, a canvas and a 2D
 * context, none of which exist under `environment: 'node'`, and a jsdom canvas
 * is a stub that draws nothing — so a test of the *render* would assert that a
 * mock was called, which pins nothing a refactor could reverse. What a session
 * can genuinely verify is the geometry, the copy, the truncation — each a
 * module for exactly that reason — and the orchestration around the drawing,
 * which is ordinary control flow and has its own block at the bottom.
 *
 * The device half — whether iOS's share sheet accepts the file — is the same
 * verification boundary the push epic has and is not claimed here.
 */
describe('resolveShareCardLayout', () => {
  it('never upscales a photo smaller than the cap', () => {
    // A postcard is uploaded at max edge 1600 (`media/compress.ts`), so this is
    // the small-source case — an old row, or a photo that was already small.
    // Upscaling it would produce a bigger, blurrier file for no gain.
    const layout = resolveShareCardLayout(800, 600)
    expect(layout.width).toBe(800)
    expect(layout.height).toBe(600)
  })

  it('caps the long edge and keeps the aspect ratio exactly — nothing is cropped', () => {
    const layout = resolveShareCardLayout(3200, 2400)
    expect(Math.max(layout.width, layout.height)).toBe(1440)
    // 4:3 in, 4:3 out. A crop here would be this file inventing a composition,
    // which is the one thing PD-451 forbids.
    expect(layout.width / layout.height).toBeCloseTo(3200 / 2400, 5)
  })

  it('is scaled by the SHORT edge, so a panorama does not get enormous text', () => {
    const square = resolveShareCardLayout(1440, 1440)
    const panorama = resolveShareCardLayout(1440, 360)

    // The trap this pins: deriving from `Math.max` reads naturally and gives a
    // panorama the same 46px type as a square four times its height, where the
    // text then occupies a third of the picture.
    expect(panorama.fontSize).toBeLessThan(square.fontSize)
  })

  it('gives the same metrics to a portrait and a landscape sharing a short edge', () => {
    // The other half of the rule above, and the one that fails if someone
    // switches to `height` rather than `Math.min` — which looks right for every
    // portrait photo and is wrong for every landscape one.
    const portrait = resolveShareCardLayout(360, 1440)
    const landscape = resolveShareCardLayout(1440, 360)

    expect(portrait.fontSize).toBe(landscape.fontSize)
    expect(portrait.scrimHeight).toBe(landscape.scrimHeight)
    expect(portrait.margin).toBe(landscape.margin)
  })

  it('caps the place pill at half the card width, as PostcardCard does', () => {
    const layout = resolveShareCardLayout(1200, 1200)
    expect(layout.maxPlaceWidth).toBe(600)
  })

  it('keeps a font size legible even on a tiny source', () => {
    // 3.2% of a 64px short edge is 2px. A floor is what stops the card being
    // technically correct and completely unreadable.
    expect(resolveShareCardLayout(64, 64).fontSize).toBeGreaterThanOrEqual(10)
  })

  it('refuses a source with no dimensions rather than drawing a zero-sized card', () => {
    // `canvas.toBlob` on a 0×0 canvas answers a blob, so this would otherwise
    // fail silently and hand the rider a file that renders as nothing.
    expect(() => resolveShareCardLayout(0, 600)).toThrow()
    expect(() => resolveShareCardLayout(600, -1)).toThrow()
    expect(() => resolveShareCardLayout(Number.NaN, 600)).toThrow()
  })
})

describe('resolveShareCardText', () => {
  const CREATED = '2026-08-14T09:30:00.000Z'

  it('puts the flag ahead of the town, as PD-279 settled it', () => {
    expect(
      resolveShareCardText({
        taken_place_name: 'Amsterdam',
        taken_country_code: 'NL',
        created_at: CREATED,
      }).place
    ).toBe('🇳🇱 Amsterdam')
  })

  it('draws NO flag without a town beside it', () => {
    // `PostcardCard` gates the whole pill on the name alone, and `074`'s CHECK
    // makes a country without a place unwritable — but a card renders whatever
    // a row actually holds. A lone flag in the corner names a country the
    // rider never published.
    expect(
      resolveShareCardText({
        taken_place_name: null,
        taken_country_code: 'NL',
        created_at: CREATED,
      }).place
    ).toBeNull()
  })

  it('shows the town alone when the country code is malformed', () => {
    // `countryFlagEmoji` answers null for anything that is not two letters,
    // which is what keeps a stray value from printing as mojibake over the
    // photo instead of as no flag at all.
    for (const code of ['NLD', 'n', '', '12', null]) {
      expect(
        resolveShareCardText({
          taken_place_name: 'Amsterdam',
          taken_country_code: code,
          created_at: CREATED,
        }).place
      ).toBe('Amsterdam')
    }
  })

  it('stamps the date with the postcard formatter, not a second one', () => {
    // There is deliberately no generic `formatDate` in this repo; every
    // formatter is named for the screen it serves. A share card that invented
    // its own would drift from the card it is a picture of.
    expect(resolveShareCardText({
      taken_place_name: null,
      taken_country_code: null,
      created_at: CREATED,
    }).date).toBe('14 Aug 2026')
  })
})

describe('truncateToWidth', () => {
  /**
   * Widths proportional to UTF-16 length.
   *
   * **A code-point measurer looks more principled here and makes the surrogate
   * case below unobservable** — measured, not assumed. Under it a candidate cut
   * mid-pair measures exactly as wide as the whole pair, so the downward scan
   * always returns the even boundary first and a code-unit `split('')`
   * implementation passes every assertion. The bug this fake exists to expose
   * only shows where width tracks UTF-16 length, which is the shape a real
   * engine has when it renders a lone surrogate as its own tofu glyph.
   */
  const ctx = { measureText: (text: string) => ({ width: text.length * 10 }) } as unknown as CanvasRenderingContext2D

  it('leaves text that fits completely alone', () => {
    expect(truncateToWidth(ctx, 'Amsterdam', 200)).toBe('Amsterdam')
  })

  it('truncates with an ellipsis rather than overflowing the pill', () => {
    const out = truncateToWidth(ctx, 'Amsterdam', 55)
    expect(out.endsWith('…')).toBe(true)
    expect(ctx.measureText(out).width).toBeLessThanOrEqual(55)
  })

  it('measures rather than counting characters', () => {
    // `taken_place_name` is vendor text stored verbatim up to 200 characters —
    // the column is bounded at 200, not at something that fits — and a
    // character budget is wrong by a factor of two between `Amsterdam` and a
    // Japanese locality.
    const long = 'A'.repeat(200)
    expect(ctx.measureText(truncateToWidth(ctx, long, 100)).width).toBeLessThanOrEqual(100)
  })

  it('never leaves a lone surrogate behind, at any width', () => {
    // The naive `text.slice(0, take)` splits a flag's regional indicators
    // mid-surrogate and the pill renders a replacement glyph. Every width is
    // checked rather than one, because the defect appears only at the widths
    // that cut inside the pair.
    const text = '🇳🇱 Amsterdam'
    for (let maxWidth = 0; maxWidth <= 140; maxWidth += 5) {
      const out = truncateToWidth(ctx, text, maxWidth)
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false)
    }
  })

  it('answers the ellipsis alone rather than an empty pill', () => {
    // A pill drawn with nothing in it reads as a rendering bug; `…` reads as a
    // name too long to show.
    expect(truncateToWidth(ctx, 'Amsterdam', 1)).toBe('…')
  })
})

/**
 * `composeShareCard` itself — the orchestration, not the pixels.
 *
 * The header is right that a *render* assertion would pin nothing: canvas is a
 * stub under jsdom and absent under `environment: 'node'`, so a test of the
 * drawing would only prove a mock was called. But two things in this function
 * are ordinary control flow, and review found both deletable with the whole
 * suite green — which is the definition of untested.
 */
describe('composeShareCard', () => {
  const originalDocument = globalThis.document
  const originalFetch = globalThis.fetch
  const originalCreateImageBitmap = globalThis.createImageBitmap

  let close: ReturnType<typeof vi.fn>
  let toBlob: ReturnType<typeof vi.fn>

  beforeEach(() => {
    close = vi.fn()
    toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })))

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['src']) }))
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1600, height: 1200, close }))
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
          fillRect: vi.fn(),
          fillText: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          arcTo: vi.fn(),
          closePath: vi.fn(),
          fill: vi.fn(),
          createLinearGradient: () => ({ addColorStop: vi.fn() }),
          measureText: (t: string) => ({ width: t.length * 10 }),
        }),
        toBlob,
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    globalThis.document = originalDocument
    globalThis.fetch = originalFetch
    globalThis.createImageBitmap = originalCreateImageBitmap
  })

  const postcard = (overrides = {}) => ({
    image_url: 'https://example.test/signed.jpg',
    taken_place_name: 'Amsterdam',
    taken_country_code: 'NL',
    created_at: '2026-08-14T09:30:00.000Z',
    ...overrides,
  })

  it('refuses a postcard whose signed URL is missing rather than fetching undefined', async () => {
    // `image_url` is nullable — `lib/data/postcards.ts` sets it null when
    // signing failed — so this is a state the card genuinely reaches. Without
    // the guard it becomes `fetch(undefined)`, which resolves against the
    // app's own origin and decodes an HTML page as an image.
    await expect(composeShareCard(postcard({ image_url: null }))).rejects.toThrow()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('reports a signed URL that has expired rather than drawing a blank card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    await expect(composeShareCard(postcard())).rejects.toThrow(/403/)
  })

  it('closes the bitmap even when encoding fails', async () => {
    // The `finally` is the whole point: an ImageBitmap holds decoded pixels
    // outside the JS heap, and a feed where every failed share leaks one is a
    // browser tab that grows until it is killed.
    toBlob.mockImplementation((cb: (b: Blob | null) => void) => cb(null))

    await expect(composeShareCard(postcard())).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes the bitmap on the happy path too, and answers a JPEG', async () => {
    const blob = await composeShareCard(postcard())

    expect(blob.type).toBe('image/jpeg')
    expect(close).toHaveBeenCalledTimes(1)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9)
  })
})
