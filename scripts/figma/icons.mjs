#!/usr/bin/env node
/**
 * Stage 1b — network. Exports the `Element / Icon / *` set as SVG into design/icons/.
 *
 * Separate from `pull.mjs` because /v1/images is a different rate-limit bucket:
 * it has been observed alive while the node routes were refusing, and dead while
 * they worked. Run whichever one is open.
 *
 * Needs design/icons/index.json, which `extract.mjs` writes — the node ids have to
 * come from the tree before anything can be rendered.
 *
 * Usage:  npm run figma:icons
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { exit } from 'node:process'
import { DESIGN_DIR, FILE_KEY, figmaFetch } from './lib.mjs'

/** Figma renders in batches; comma-separated ids, never one request per icon. */
const BATCH = 25

let index
try {
  index = JSON.parse(await readFile(new URL('icons/index.json', DESIGN_DIR), 'utf8'))
} catch {
  console.error(
    'design/icons/index.json is missing — run `npm run figma:pull` (or `figma:extract`) first.\n' +
      'Icon node ids only exist once the node tree has been read.',
  )
  exit(1)
}

if (!index.icons?.length) {
  console.error('The icon index is empty. Nothing to export.')
  exit(1)
}

await mkdir(new URL('icons/', DESIGN_DIR), { recursive: true })

const urls = new Map()
for (let i = 0; i < index.icons.length; i += BATCH) {
  const batch = index.icons.slice(i, i + BATCH)
  const ids = batch.map((icon) => icon.id).join(',')
  console.log(`Requesting render URLs for ${batch.length} icons …`)

  const res = await figmaFetch(`images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=svg`)
  if (res.err) throw new Error(`Figma image render failed: ${res.err}`)
  for (const [id, url] of Object.entries(res.images ?? {})) {
    if (url) urls.set(id, url)
  }
}

let written = 0
const missing = []

for (const icon of index.icons) {
  const url = urls.get(icon.id)
  if (!url) {
    missing.push(icon.name)
    continue
  }

  // Render URLs point at s3-alpha-sig.figma.com, which this environment's network
  // policy blocked at CONNECT until it was allowlisted on 2026-08-03. A 403 here is
  // that policy, not Figma.
  const res = await fetch(url)
  if (!res.ok) {
    missing.push(`${icon.name} (download ${res.status})`)
    continue
  }

  await writeFile(new URL(`icons/${icon.slug}.svg`, DESIGN_DIR), await res.text())
  written += 1
}

console.log(`\nExported ${written}/${index.icons.length} icons to design/icons/`)
if (missing.length) {
  console.log(`Missing: ${missing.join(', ')}`)
  console.log('Decision #4 forbids lookalike substitutes — ship a screen without an icon rather than with the wrong one.')
}
console.log('\nRe-run `npm run figma:extract` to refresh the manifest counts.')
