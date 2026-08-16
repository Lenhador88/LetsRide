/**
 * Generates `public/brand/og-card.png`, the 1200x630 image every shared link
 * unfurls with.
 *
 * **The output is a placeholder and is labelled one everywhere it is referenced.**
 * It composes an asset that already ships — `public/brand/logo-splash.png`, the
 * boot screen — onto the app's own `Grey/5` background, so a rider who taps a
 * shared link sees the card they are about to boot into. That is a defensible
 * placeholder rather than a designed one; a share card drawn in Figma should
 * replace the PNG, at which point this script goes with it.
 *
 * **No text is drawn, deliberately.** Every unfurl renders `metadata.title` and
 * `metadata.description` as live text beside the image, so words baked into the
 * artwork are the same sentence twice — and drawing them would mean shipping
 * Poppins to whatever SVG backend `sharp` resolves at run time, which is a font
 * dependency this repo does not otherwise have.
 *
 * `sharp` arrives as a transitive dependency of Next rather than a declared one.
 * That is fine for a generator run by hand and would not be fine for anything on
 * a build path, which is why the PNG is committed and this is not wired into one.
 *
 *   node scripts/brand/og-card.mjs
 */
import { statSync } from 'node:fs'
import sharp from 'sharp'

const OUT = 'public/brand/og-card.png'
const WIDTH = 1200
const HEIGHT = 630

// `Grey/5` — the app background (`design/TOKENS.md`), and `viewport.themeColor`
// in `src/app/layout.tsx`. The unfurl and the first painted frame match.
const BACKGROUND = { r: 0xf2, g: 0xec, b: 0xe6, alpha: 1 }

// Sized so a square centre-crop still lands inside the logo card. Small
// previews on iMessage and WhatsApp crop to roughly 1:1 rather than honouring
// 1.91:1, and a card that only reads at full width shows a blank cream field
// in exactly the place most people see it.
const CARD_HEIGHT = 530

// **The source ships an opaque white margin around its rounded card**, measured
// rather than assumed: pixel (0,0) is `255,255,255,255` and the green starts by
// x=60. Composited straight onto cream that margin reads as a white picture
// frame, which looks like a rendering fault rather than a design. `trim()` takes
// the straight edges off — it removes uniform border rows and columns, so it
// stops at the first row the rounded corners intrude into and leaves four white
// nubs behind. Those are what the mask below removes.
const trimmed = await sharp('public/brand/logo-splash.png').trim().toBuffer()
const { width: srcW, height: srcH } = await sharp(trimmed).metadata()
const cardWidth = Math.round(CARD_HEIGHT * (srcW / srcH))

// Proportional to the source's own corner, so rescaling the card does not
// change the shape of it.
const radius = Math.round(CARD_HEIGHT * 0.045)
const mask = Buffer.from(
  `<svg width="${cardWidth}" height="${CARD_HEIGHT}">` +
    `<rect width="${cardWidth}" height="${CARD_HEIGHT}" rx="${radius}" ry="${radius}" fill="#fff"/>` +
    `</svg>`
)

const card = await sharp(trimmed)
  .resize({ width: cardWidth, height: CARD_HEIGHT, fit: 'fill' })
  // `dest-in` keeps the card only where the mask is opaque, so the corners
  // become transparent and the cream shows through instead of white.
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer()

await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: BACKGROUND } })
  .composite([
    {
      input: card,
      left: Math.round((WIDTH - cardWidth) / 2),
      top: Math.round((HEIGHT - CARD_HEIGHT) / 2),
    },
  ])
  // `palette` keeps it well under the ~300KB some chat clients quietly refuse to
  // fetch. The source is flat colour plus one gradient, so the quantisation is
  // not visible at any size this is displayed.
  .png({ palette: true, quality: 90, compressionLevel: 9 })
  .toFile(OUT)

console.log(`${OUT} — ${WIDTH}x${HEIGHT}, ${Math.round(statSync(OUT).size / 1024)}KB`)
