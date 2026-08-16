#!/usr/bin/env node
/**
 * Stage 3 — offline. Turns the exported SVGs in design/icons/ into one typed React
 * module at src/components/icons/generated.tsx.
 *
 * Why generate rather than hand-write: there are 53 icons, they are redrawn in
 * Figma, and `npm run figma:icons` re-exports them wholesale. A hand-maintained
 * copy would drift on the first redraw and nobody would notice which of the 53
 * moved. Regenerating is one command and the diff is the review.
 *
 * The exports carry the fill they happened to be rendered with — usually Grey/100
 * `#1A1A1A`, but a handful sit on legacy `#808080`, which CLAUDE.md forbids
 * porting. Rewriting every literal fill to `currentColor` both makes the icons
 * themeable and erases that legacy colour at the door.
 *
 * Usage:  npm run figma:components
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { exit } from 'node:process'
import { DESIGN_DIR, renderIconModule, svgToIconComponent } from './lib.mjs'

const ICONS_DIR = new URL('icons/', DESIGN_DIR)
const OUT = new URL('../../src/components/icons/generated.tsx', import.meta.url)

let files
try {
  files = (await readdir(ICONS_DIR)).filter((f) => f.endsWith('.svg')).sort()
} catch {
  console.error('design/icons/ has no exports yet. Run `npm run figma:icons` first.')
  exit(1)
}
if (!files.length) {
  console.error('design/icons/ contains no SVGs. Run `npm run figma:icons` first.')
  exit(1)
}

// The per-SVG transform and the module template both live in lib.mjs so the
// staleness alarm can rebuild this artifact with the generator's own code
// rather than a copy of it — see renderIconModule's own comment.
const components = []
for (const file of files) {
  components.push(svgToIconComponent(file, await readFile(new URL(file, ICONS_DIR), 'utf8')))
}

const source = renderIconModule(components)

await mkdir(new URL('./', OUT), { recursive: true })
await writeFile(OUT, source)
console.log(`Wrote ${components.length} icon components to src/components/icons/generated.tsx`)
