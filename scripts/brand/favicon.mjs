/**
 * Generates `src/app/icon.png`, the browser tab icon (PD-305).
 *
 * **Why a script rather than a hand-exported file.** The artwork already exists
 * and needs no design work — `resources/icon-only.png` is the 1024x1024 store
 * icon master, the motorcycle on `Accent Brand/100`. Downscaling it is the whole
 * job, and doing it here means the tab icon and the launcher icon can never
 * drift: re-run this and they are the same mark again.
 *
 * **`src/app/`, not `public/`.** Next's App Router picks `icon.png` up by
 * convention and emits the `<link rel="icon">` tags itself, which is also what
 * stops Chromium issuing its automatic `GET /favicon.ico` — the 404 the walk had
 * to filter. A `public/favicon.ico` would need a hand-written `<head>` entry and
 * would ship at whatever size it was saved at.
 *
 * **Read `resources/README.md` before touching the source.** The basenames in
 * that directory are load-bearing: `@capacitor/assets` matches them exactly and
 * treats `icon.png` as a *Logo*, which generates splash screens instead of
 * icons. This reads `icon-only.png` and writes elsewhere, so nothing there
 * moves.
 *
 * **Not a PWA.** No manifest and no service worker — CLAUDE.md is explicit that
 * all three belong to a render model this app has left. A favicon is none of
 * them.
 *
 * `sharp` arrives as an **optional** transitive dependency of Next, exactly as
 * `og-card.mjs` describes — so this is wired into no build path, fails loudly
 * with `ERR_MODULE_NOT_FOUND` when it is absent, and the PNG it produces is
 * committed.
 *
 *   node scripts/brand/favicon.mjs
 */
import { statSync } from 'node:fs'
import sharp from 'sharp'

const SOURCE = 'resources/icon-only.png'
const OUT = 'src/app/icon.png'

// Large enough for a 2x tab icon and a bookmark tile, small enough that the
// whole file is a few kilobytes. Browsers render it at 16-32px; the headroom is
// for the displays that ask for more.
const SIZE = 192

const { width, height, channels } = await sharp(SOURCE).metadata()
if (width !== height) throw new Error(`${SOURCE} is ${width}x${height}, expected a square master`)

await sharp(SOURCE)
  // `fit: 'cover'` would crop on a non-square source; the guard above means it
  // never has to, and `contain` would letterbox rather than fail if it ever did.
  .resize({ width: SIZE, height: SIZE, fit: 'contain' })
  .png({ compressionLevel: 9 })
  .toFile(OUT)

console.log(
  `${OUT}: ${SIZE}x${SIZE}, ${statSync(OUT).size} bytes, ` +
    `from ${SOURCE} (${width}x${height}, ${channels} channels)`
)
