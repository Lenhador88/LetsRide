import { countryFlagEmoji, formatPostcardDate } from '@/lib/utils'

/**
 * Compose a postcard into an image a rider can post anywhere — PD-451.
 *
 * `ShareButton` handed out a URL, and every recipient without an account hit
 * the route guard (decision #1, and `share.ts` says so in as many words). An
 * image needs no login and no link, which is the whole point: it is ambient
 * brand exposure rather than a funnel, and the issue rates it a 6 for exactly
 * that reason.
 *
 * ## The composition is borrowed, not invented
 *
 * PD-451 is explicit that the frame is a design decision before it is a
 * render — *"take it from the owner or from an existing frame, do not draw one
 * and push it"* — because `use_figma` is gated by nothing and unreviewed
 * artwork in the canonical file is baked into the next `figma:pull`,
 * `generated.tsx` and the store build. `design/` carries `Element / Icon /
 * Share` and **no** share-card frame; check rather than trust it:
 *
 * ```bash
 * npm run figma -- ls | grep -i share      # 1: COMPONENT Element / Icon / Share
 * ```
 *
 * So the frame here is `PostcardCard`'s own on-photo treatment, settled by
 * PD-279 and already shipping: the 40px bottom gradient from `#00000000` to
 * `#000000B3`, the place on a bounded `bg-scrim` pill bottom-left with its
 * flag ahead of the town, and the date on the same pill bottom-right. Nothing
 * on the bottom row is new. **Nothing is written to Figma by this file or by
 * anything that calls it.**
 *
 * The one element the card adds is the wordmark, top-right, drawn on that same
 * pill — the issue asks for the mark and the app has no other idiom for text
 * over rider imagery. It is a word in the app's own type, not artwork.
 *
 * **It carries no URL.** The apex is a separate marketing project (PD-34) and
 * nothing here can check that it serves, so a domain printed into a JPEG that
 * outlives this session is a promise this repo cannot keep.
 *
 * ## Two facts the issue names that the schema does not have
 *
 * PD-451 asks the band to carry *"the ride name"*. There is no postcard → ride
 * read: `062` revoked `postcards.ride_id` from the client, and `from_ride` is
 * a boolean that names no ride deliberately — `062`'s own column comment says
 * a badge naming one *"needs its own accessor"*, and none exists. So the card
 * carries what the card already carries. Adding the accessor is a separate
 * change with its own audience question.
 *
 * ## Nothing is cropped
 *
 * The card is the photo at its own aspect ratio. `PostcardCard` draws the
 * photo `object-cover` into a square, which is a display crop rather than a
 * decision about the photograph, and baking one into a file the rider keeps
 * would be inventing a composition — the thing this file must not do.
 *
 * ## EXIF
 *
 * The upload already stripped it (`media/compress.ts`), and a canvas has no
 * metadata channel, so the re-encode here cannot reintroduce any. The overlay
 * shows the place name the rider chose to publish and nothing more precise —
 * no coordinate reaches this file, which is the tripwire `073` and PD-279 are
 * about.
 *
 * Browser-only: `createImageBitmap`, `document` and `canvas` do not exist in
 * the prerender pass. Import it from a `'use client'` component's event
 * handler, never during render.
 */

/** The long edge of the composed card. A postcard is uploaded at max edge 1600
 * (`media/compress.ts`), so this never upscales in practice and the guard
 * below makes sure it never does in principle either — an upscaled JPEG is
 * worse than a smaller one at every size a chat app renders. */
const MAX_LONG_EDGE = 1440

/** JPEG rather than PNG: a photograph, and a share sheet that has to hold the
 * whole file in memory. Quality matched to the upload's own starting point. */
const JPEG_QUALITY = 0.9

export type ShareCardLayout = {
  width: number
  height: number
  /** The bottom gradient, proportional to `PostcardCard`'s 40px over a card
   * roughly a phone wide. */
  scrimHeight: number
  fontSize: number
  pillPaddingX: number
  pillPaddingY: number
  pillRadius: number
  margin: number
  /** `PostcardCard` caps the place pill at half the width so a 200-character
   * vendor name truncates instead of running under the date. Same cap. */
  maxPlaceWidth: number
}

/**
 * Card geometry for a source photo, with every distance derived from the
 * **short** edge.
 *
 * Deriving from the long edge instead is the trap: a panorama would get
 * enormous text and a tall portrait would get none worth reading. The short
 * edge is what a phone screen gives the photo in both orientations.
 *
 * Pure, so the proportions have a tripwire — the same reason `resolveLocationCopy`
 * and `resolveComboboxKey` are modules rather than inline consts. A render this
 * one is wrong in is a render nobody can see is wrong by looking at it.
 */
export function resolveShareCardLayout(
  sourceWidth: number,
  sourceHeight: number
): ShareCardLayout {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error('A share card needs a source photo with a positive width and height.')
  }

  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const short = Math.min(width, height)

  return {
    width,
    height,
    scrimHeight: Math.round(short * 0.11),
    fontSize: Math.max(10, Math.round(short * 0.032)),
    pillPaddingX: Math.round(short * 0.016),
    pillPaddingY: Math.round(short * 0.008),
    pillRadius: Math.round(short * 0.008),
    margin: Math.round(short * 0.022),
    maxPlaceWidth: Math.round(width * 0.5),
  }
}

export type ShareCardText = {
  /** The flag and the town, already joined — `null` when the rider published
   * no place, which is `Hide` and every legacy `'region'` row. */
  place: string | null
  date: string
  mark: string
}

/**
 * What the card says, given a postcard's own columns.
 *
 * **Drawn on the name alone**, exactly as `PostcardCard` decides it: a non-null
 * `taken_place_name` IS the rider's decision to publish one, and the flag is
 * never drawn without a town beside it. `countryFlagEmoji` answers `null` for
 * anything that is not two letters, so a malformed code prints no flag rather
 * than mojibake.
 */
export function resolveShareCardText(postcard: {
  taken_place_name: string | null
  taken_country_code: string | null
  created_at: string
}): ShareCardText {
  const flag = postcard.taken_place_name ? countryFlagEmoji(postcard.taken_country_code) : null
  const place = postcard.taken_place_name
    ? flag
      ? `${flag} ${postcard.taken_place_name}`
      : postcard.taken_place_name
    : null

  return { place, date: formatPostcardDate(postcard.created_at), mark: 'LETSRIDE' }
}

/** The 2D measuring surface this module needs, so the pure helpers below can be
 * exercised against a fake one. */
type TextMeasurer = Pick<CanvasRenderingContext2D, 'measureText'>

/**
 * Trim `text` with an ellipsis until it measures within `maxWidth`.
 *
 * **Measured rather than counted.** A character budget is wrong by a factor of
 * two between `Amsterdam` and a Japanese locality, and `taken_place_name` is
 * vendor text stored verbatim up to 200 characters — the column is bounded at
 * 200, not at something that fits.
 *
 * Returns the ellipsis alone when even one character does not fit, never an
 * empty string: a pill drawn with nothing in it reads as a rendering bug,
 * where `…` reads as a name too long to show.
 */
export function truncateToWidth(ctx: TextMeasurer, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text

  // Surrogate pairs and combining marks: slicing by code unit splits a flag in
  // half. `Array.from` iterates code points, which is the same granularity
  // `countryFlagEmoji` composes at.
  const chars = Array.from(text)
  for (let take = chars.length - 1; take > 0; take -= 1) {
    const candidate = `${chars.slice(0, take).join('')}…`
    if (ctx.measureText(candidate).width <= maxWidth) return candidate
  }
  return '…'
}

/**
 * Fetch a signed postcard URL as a bitmap.
 *
 * **Through `fetch` rather than an `<img>` with a `src`.** A cross-origin image
 * drawn into a canvas taints it, and `toBlob` on a tainted canvas throws
 * `SecurityError` — so the `<img>` route would work in every test and fail on
 * every real device. A fetched blob has no origin to taint with.
 */
async function loadSourceBitmap(imageUrl: string): Promise<ImageBitmap> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`The postcard image could not be fetched (${response.status}).`)
  }
  return createImageBitmap(await response.blob())
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

/** One pill, positioned by which corner it belongs to. Returns nothing; the
 * three call sites differ only in text, corner and cap. */
function drawPill(
  ctx: CanvasRenderingContext2D,
  layout: ShareCardLayout,
  text: string,
  corner: 'bottom-left' | 'bottom-right' | 'top-right',
  maxTextWidth: number
) {
  const shown = truncateToWidth(ctx, text, maxTextWidth)
  const textWidth = ctx.measureText(shown).width
  const boxWidth = textWidth + layout.pillPaddingX * 2
  const boxHeight = layout.fontSize + layout.pillPaddingY * 2

  const x =
    corner === 'bottom-left' ? layout.margin : layout.width - layout.margin - boxWidth
  const y =
    corner === 'top-right' ? layout.margin : layout.height - layout.margin - boxHeight

  // `--color-scrim`, Grey/70%. It bounds the composite at `#4C4C4C` however
  // bright the photo is — 8.59:1 against White/100 — which is the measurement
  // PD-279 recorded when the 40px gradient alone came out at 2.58:1.
  ctx.fillStyle = '#000000B3'
  roundedRect(ctx, x, y, boxWidth, boxHeight, layout.pillRadius)
  ctx.fill()

  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.fillText(shown, x + layout.pillPaddingX, y + boxHeight / 2)
}

export type ShareCardSource = {
  image_url?: string | null
  taken_place_name: string | null
  taken_country_code: string | null
  created_at: string
}

/**
 * Render the card and hand back a JPEG.
 *
 * Throws rather than returning `null` on every failure — a missing signed URL,
 * a fetch that 403s once the hour is up, a browser with no 2D context. The
 * caller's answer to all of them is the same (fall back to sharing the link),
 * and a thrown error keeps that decision in one place instead of spreading a
 * nullable through it.
 */
export async function composeShareCard(postcard: ShareCardSource): Promise<Blob> {
  if (!postcard.image_url) {
    throw new Error('This postcard has no image to share.')
  }

  const bitmap = await loadSourceBitmap(postcard.image_url)
  try {
    const layout = resolveShareCardLayout(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = layout.width
    canvas.height = layout.height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context is unavailable in this browser.')

    ctx.drawImage(bitmap, 0, 0, layout.width, layout.height)

    // The same gradient `PostcardCard` lays over the photo, at the same two
    // stops. It is what keeps the bottom row legible over a bright sky before
    // the pills do their own half of the work.
    const gradient = ctx.createLinearGradient(0, layout.height - layout.scrimHeight, 0, layout.height)
    gradient.addColorStop(0, '#00000000')
    gradient.addColorStop(1, '#000000B3')
    ctx.fillStyle = gradient
    ctx.fillRect(0, layout.height - layout.scrimHeight, layout.width, layout.scrimHeight)

    const text = resolveShareCardText(postcard)
    // Poppins is the app's face; a share card composed on a device without it
    // falls back rather than failing to draw, which is why the stack is named
    // here and not assumed.
    ctx.font = `600 ${layout.fontSize}px Poppins, system-ui, sans-serif`

    drawPill(ctx, layout, text.date, 'bottom-right', layout.width)
    if (text.place) {
      drawPill(ctx, layout, text.place, 'bottom-left', layout.maxPlaceWidth)
    }
    drawPill(ctx, layout, text.mark, 'top-right', layout.width)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed.'))),
        'image/jpeg',
        JPEG_QUALITY
      )
    })
  } finally {
    bitmap.close()
  }
}
