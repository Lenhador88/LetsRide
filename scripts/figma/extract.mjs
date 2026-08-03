#!/usr/bin/env node
/**
 * Stage 2 — offline. Turns .figma-raw/file.json into the committed snapshot under
 * design/. Touches no network, is a pure function of its input, and is safe to
 * re-run at any time.
 *
 * Usage:  npm run figma:extract
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { exit } from 'node:process'
import {
  DESIGN_DIR, FILE_KEY, RAW_DIR,
  collectGeometry, collectTokens, dominant, isLegacy, pruneNode, slug, total, walk,
} from './lib.mjs'

const ICON_PREFIX = 'Element / Icon / '

let raw
try {
  raw = JSON.parse(await readFile(new URL('file.json', RAW_DIR), 'utf8'))
} catch {
  console.error(
    'No raw pull found at .figma-raw/file.json.\n' +
      'Run `npm run figma:pull` first — that is the stage that needs the network.',
  )
  exit(1)
}

let provenance = {}
try {
  provenance = JSON.parse(await readFile(new URL('provenance.json', RAW_DIR), 'utf8'))
} catch {
  // A raw pull without provenance still extracts; the manifest just says less.
}

/**
 * Normalises the two response shapes. /files/:key returns one document; /nodes
 * returns a map of them, each carrying its own styles and components maps.
 */
function documents(payload) {
  if (payload.document) {
    return [{
      root: payload.document,
      styles: payload.styles ?? {},
      components: payload.components ?? {},
      componentSets: payload.componentSets ?? {},
    }]
  }
  return Object.values(payload.nodes ?? {}).map((entry) => ({
    root: entry.document,
    styles: entry.styles ?? {},
    components: entry.components ?? {},
    componentSets: entry.componentSets ?? {},
  }))
}

const docs = documents(raw)
if (!docs.length || !docs[0].root) {
  console.error('The raw pull contains no document node — it may be a truncated or error response.')
  exit(1)
}

// The maps are per-document in the /nodes shape; merge so lookups work uniformly.
const styles = Object.assign({}, ...docs.map((d) => d.styles))
const components = Object.assign({}, ...docs.map((d) => d.components))
const componentSets = Object.assign({}, ...docs.map((d) => d.componentSets))
const lookup = { styles, components, componentSets }

// A fresh extract must not leave last month's frames behind — a renamed screen
// would otherwise linger as a file nobody notices is orphaned.
for (const dir of ['frames', 'components']) {
  await rm(new URL(`${dir}/`, DESIGN_DIR), { recursive: true, force: true })
}
await mkdir(new URL('frames/', DESIGN_DIR), { recursive: true })
await mkdir(new URL('components/', DESIGN_DIR), { recursive: true })
await mkdir(new URL('icons/', DESIGN_DIR), { recursive: true })

const written = []
async function emit(relative, data) {
  const body = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`
  await writeFile(new URL(relative, DESIGN_DIR), body)
  written.push({ path: relative, bytes: Buffer.byteLength(body) })
  return body
}

/** Sections are organisational wrappers; their children are the real top-level items. */
function topLevel(page) {
  return (page.children ?? []).flatMap((child) =>
    child.type === 'SECTION' ? (child.children ?? []) : [child],
  )
}

const index = { fileKey: FILE_KEY, frames: [], components: [] }
const seen = new Set()

/** Slugs collide (`Card` on two pages); disambiguate rather than silently overwrite. */
function uniqueSlug(name) {
  const base = slug(name)
  if (!seen.has(base)) {
    seen.add(base)
    return base
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!seen.has(candidate)) {
      seen.add(candidate)
      return candidate
    }
  }
}

const pages = docs.flatMap((doc) =>
  doc.root.type === 'DOCUMENT' ? (doc.root.children ?? []) : [doc.root],
)

for (const page of pages) {
  for (const node of topLevel(page)) {
    const isComponent = node.type === 'COMPONENT_SET' || node.type === 'COMPONENT'
    const dir = isComponent ? 'components' : 'frames'
    const name = uniqueSlug(node.name)
    const pruned = pruneNode(node, lookup)

    await emit(`${dir}/${name}.json`, { page: page.name, ...pruned })
    index[isComponent ? 'components' : 'frames'].push({
      name: node.name,
      page: page.name,
      id: node.id,
      type: node.type,
      file: `${dir}/${name}.json`,
      variants: node.type === 'COMPONENT_SET' ? (node.children ?? []).length : undefined,
    })
  }
}

// ---- Tokens -----------------------------------------------------------------

const tokens = { fills: new Map(), text: new Map() }
for (const doc of docs) {
  const found = collectTokens(doc.root, styles)
  for (const [key, map] of Object.entries(found)) {
    for (const [name, counts] of map) {
      if (!tokens[key].has(name)) tokens[key].set(name, new Map())
      const into = tokens[key].get(name)
      for (const [value, n] of counts) into.set(value, (into.get(value) ?? 0) + n)
    }
  }
}

const byUse = (a, b) => total(b[1]) - total(a[1])

const serialiseFills = (entries) =>
  entries.map(([name, counts]) => {
    const value = dominant(counts)
    const all = [...counts.keys()]
    return {
      name,
      value,
      n: total(counts),
      // More than one resolved value under one style name means the file itself has
      // drifted. Surfacing it beats silently picking the winner.
      ambiguous: all.length > 1 ? all : undefined,
    }
  })

const fillEntries = [...tokens.fills].sort(byUse)
const textEntries = [...tokens.text].sort(byUse)

const colors = serialiseFills(fillEntries.filter(([n]) => !isLegacy(n)))
const legacyColors = serialiseFills(fillEntries.filter(([n]) => isLegacy(n)))

const type = textEntries.map(([name, counts]) => {
  const [fontSize, lineHeight, fontWeight] = dominant(counts).split('/').map(Number)
  return { name, fontSize, lineHeight, fontWeight, n: total(counts) }
})

const geometry = Object.assign({}, ...docs.map((doc) => collectGeometry(doc.root)))

await emit('tokens.json', {
  source: `figma:${FILE_KEY}`,
  lastModified: raw.lastModified ?? null,
  colors,
  type,
  geometry,
  legacy: legacyColors,
})

// Reproduces the shape of the CLAUDE.md tables so drift is a plain `diff`.
const table = [
  '# Design tokens — generated by `npm run figma:extract`',
  '',
  'Do not hand-edit. Regenerate from the snapshot; if this disagrees with',
  '`CLAUDE.md` §Design System, this file is right and CLAUDE.md is stale.',
  '',
  `Figma file \`${FILE_KEY}\`, last modified ${raw.lastModified ?? 'unknown'}.`,
  '',
  '**Colors:**',
  '',
  '| Token | Value | n |',
  '|---|---|---|',
  ...colors.map((c) => `| \`${c.name}\` | \`${c.value}\` | ${c.n} |`),
  '',
  '**Type — Poppins:**',
  '',
  '| Token | Size / LH | Weight | n |',
  '|---|---|---|---|',
  ...type.map((t) => `| \`${t.name}\` | ${t.fontSize} / ${t.lineHeight} | ${t.fontWeight} | ${t.n} |`),
  '',
  `**Legacy v1 styles still live inside v2 components: ${legacyColors.length}.** Do not port these;`,
  'resolve to the v2 token nearest in intent.',
  '',
  '| Token | Value | n |',
  '|---|---|---|',
  ...legacyColors.map((c) => `| \`${c.name}\` | \`${c.value}\` | ${c.n} |`),
  '',
].join('\n')
await emit('TOKENS.md', table)

// ---- Icons ------------------------------------------------------------------

const icons = []
for (const doc of docs) {
  for (const node of walk(doc.root)) {
    if (typeof node.name === 'string' && node.name.startsWith(ICON_PREFIX)) {
      icons.push({ id: node.id, name: node.name.slice(ICON_PREFIX.length), slug: slug(node.name.slice(ICON_PREFIX.length)) })
    }
  }
}
// Component sets repeat their name on each variant; one entry per icon name.
const uniqueIcons = [...new Map(icons.map((i) => [i.name, i])).values()].sort((a, b) =>
  a.name.localeCompare(b.name),
)
await emit('icons/index.json', { prefix: ICON_PREFIX, count: uniqueIcons.length, icons: uniqueIcons })

// ---- Manifest and index -----------------------------------------------------

await emit('index.json', index)

const svgs = (await readdir(new URL('icons/', DESIGN_DIR))).filter((f) => f.endsWith('.svg'))

await emit('manifest.json', {
  fileKey: FILE_KEY,
  fileName: raw.name ?? provenance.name ?? null,
  lastModified: raw.lastModified ?? null,
  version: raw.version ?? null,
  latestVersionId: provenance.latestVersionId ?? null,
  pulledAt: provenance.pulledAt ?? null,
  pulledVia: provenance.route ?? null,
  extractedAt: new Date().toISOString(),
  counts: {
    pages: pages.length,
    frames: index.frames.length,
    components: index.components.length,
    componentSets: index.components.filter((c) => c.type === 'COMPONENT_SET').length,
    namedStyles: Object.keys(styles).length,
    colorTokens: colors.length,
    typeTokens: type.length,
    legacyStyles: legacyColors.length,
    iconsFound: uniqueIcons.length,
    iconsExported: svgs.length,
  },
})

// ---- Report -----------------------------------------------------------------

const bytes = written.reduce((sum, f) => sum + f.bytes, 0)
const biggest = [...written].sort((a, b) => b.bytes - a.bytes).slice(0, 5)

console.log(`Pages           ${pages.length}`)
console.log(`Frames          ${index.frames.length}`)
console.log(`Components      ${index.components.length} (${index.components.filter((c) => c.type === 'COMPONENT_SET').length} sets)`)
console.log(`Color tokens    ${colors.length} (+${legacyColors.length} legacy)`)
console.log(`Type tokens     ${type.length}`)
console.log(`Icons           ${uniqueIcons.length} found, ${svgs.length} exported as SVG`)
console.log(`\nWrote ${written.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB total. Largest:`)
for (const f of biggest) console.log(`  ${(f.bytes / 1024).toFixed(0).padStart(7)} KB  ${f.path}`)

const ambiguous = colors.filter((c) => c.ambiguous)
if (ambiguous.length) {
  console.log(`\n${ambiguous.length} style(s) resolve to more than one value — the Figma file has drifted:`)
  for (const c of ambiguous) console.log(`  ${c.name}: ${c.ambiguous.join(', ')} (using ${c.value})`)
}

if (!svgs.length && uniqueIcons.length) {
  console.log('\nNo icon SVGs yet. Run `npm run figma:icons` — that stage needs the network.')
}
