#!/usr/bin/env node
/**
 * Offline-ish. Measures the stroke weight and ink of exported icons by
 * rasterising them in Chromium and scanning horizontal runs of ink. Needs the
 * pre-installed browser, nothing else.
 *
 *   npm run figma:measure -- wave chat-bubble paper-plane
 *   npm run figma:measure                      # every icon in design/icons/
 *
 * ## Why this exists
 *
 * The wave icon (PD-228) shipped twice at the wrong weight, because "does this
 * look as heavy as its neighbours" was answered by eye — once by an agent and
 * once after the product owner said it looked light and the correction was
 * still guessed rather than measured. Measured, it was 1.4px against Chat
 * Bubble's 2.2: obvious in a number, arguable in a screenshot.
 *
 * `strokePx24` is the median run of ink across all rows, scaled to the 24px
 * box. For a uniform line icon that is its stroke width. It is meaningless for
 * a solid glyph — `heart-filled` reports its own width — so read it only for
 * outline icons, and compare against the icons a glyph will actually sit
 * beside rather than against a global average.
 *
 * `inkPct` is total ink over the whole box and is NOT interchangeable with
 * stroke weight: a narrow, detailed glyph can match on stroke and still carry
 * more ink than a simple round one. The wave does exactly that.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = fileURLToPath(new URL('../../design/icons/', import.meta.url))
const S = 480 // 20x the 24px box — enough that a 2px stroke is 40 pixels wide

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(DIR).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, ''))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
const rows = []

for (const name of names) {
  let svg
  try {
    svg = readFileSync(`${DIR}${name}.svg`, 'utf8')
  } catch {
    rows.push({ icon: name, strokePx24: null, inkPct: null, bbox24: 'missing' })
    continue
  }
  svg = svg
    .replace(/width="\d+"/, `width="${S}"`)
    .replace(/height="\d+"/, `height="${S}"`)
    .replace(/currentColor/g, '#000')

  const r = await page.evaluate(async ({ svg, S }) => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
    await img.decode()
    const c = document.createElement('canvas')
    c.width = S
    c.height = S
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, S, S)
    ctx.drawImage(img, 0, 0, S, S)
    const d = ctx.getImageData(0, 0, S, S).data

    let count = 0
    const runs = []
    let minX = S, maxX = -1, minY = S, maxY = -1
    for (let y = 0; y < S; y++) {
      let run = 0
      for (let x = 0; x < S; x++) {
        if (d[(y * S + x) * 4] < 128) {
          count++
          run++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        } else if (run) {
          runs.push(run)
          run = 0
        }
      }
      if (run) runs.push(run)
    }
    runs.sort((a, b) => a - b)
    return {
      coverage: count / (S * S),
      medianRun: runs[Math.floor(runs.length / 2)] ?? 0,
      bbox: { w: maxX - minX + 1, h: maxY - minY + 1 },
    }
  }, { svg, S })

  const k = 24 / S
  rows.push({
    icon: name,
    strokePx24: +(r.medianRun * k).toFixed(2),
    inkPct: +(r.coverage * 100).toFixed(2),
    bbox24: `${(r.bbox.w * k).toFixed(1)}x${(r.bbox.h * k).toFixed(1)}`,
  })
}

await browser.close()
console.table(rows)
