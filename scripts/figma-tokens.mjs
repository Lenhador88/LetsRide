#!/usr/bin/env node
/**
 * Prints the v2 design tokens as they currently exist in Figma, in the markdown
 * shape CLAUDE.md uses, so drift can be spotted with a diff.
 *
 * These tokens are Figma paint and text *styles*, not variables. That is the only
 * reason this script can exist: the Variables REST API is Enterprise-only and 403s
 * on this plan, but style names ship in the `styles` map of any /nodes response.
 * If the design file ever migrates styles to variables, this breaks and there is
 * no workaround short of an Enterprise seat.
 *
 * Usage:  npm run figma:tokens  [-- --refresh]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { env, argv, exit } from 'node:process'

const FILE_KEY = 'gDoteM1ow1AZpSEGSNhpc7'
const COMPONENTS_NODE = '50:559'
const CACHE = new URL('../.figma-cache.json', import.meta.url)

/**
 * Figma throttles hard: one large pull can 429 the token for upwards of ten
 * minutes, so this fetches once and works from disk. A single /nodes response for
 * the Components page carries every fill, style reference and text style there is.
 */
async function load(refresh) {
  if (!refresh) {
    try {
      return JSON.parse(await readFile(CACHE, 'utf8'))
    } catch {
      // no cache yet — fall through and fetch
    }
  }

  const token = env.FIGMA_ACCESS_TOKEN
  if (!token) {
    console.error('FIGMA_ACCESS_TOKEN is not set. It lives in the environment config, not the repo.')
    exit(1)
  }

  const res = await fetch(
    `https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${COMPONENTS_NODE}`,
    { headers: { 'X-Figma-Token': token } },
  )

  if (res.status === 429) {
    console.error('Figma returned 429. The window can last ten minutes or more — wait it out rather than retrying in a loop.')
    exit(1)
  }
  if (!res.ok) {
    console.error(`Figma returned ${res.status}: ${await res.text()}`)
    exit(1)
  }

  const json = await res.json()
  await writeFile(CACHE, JSON.stringify(json))
  return json
}

const channel = (v) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase()
const toHex = (c, opacity) => {
  const rgb = `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`
  // Figma stores opacity as float32, so a designer's 70% arrives as 0.69999999 and
  // would render as B2 rather than the intended B3. Snap to the authored percent.
  const authored = Math.round(opacity * 100) / 100
  return authored >= 0.999 ? rgb : `${rgb}${channel(authored)}`
}

function collect(node, styles, fills, text) {
  const refs = node.styles ?? {}

  if (refs.fill && styles[refs.fill]) {
    for (const paint of node.fills ?? []) {
      if (paint.type !== 'SOLID' || paint.visible === false) continue
      const value = toHex(paint.color, paint.opacity ?? paint.color.a ?? 1)
      const name = styles[refs.fill].name
      fills.set(name, fills.get(name) ?? new Map())
      fills.get(name).set(value, (fills.get(name).get(value) ?? 0) + 1)
    }
  }

  if (refs.text && styles[refs.text] && node.style) {
    const { fontSize, lineHeightPx, fontWeight } = node.style
    const name = styles[refs.text].name
    const key = `${fontSize} / ${lineHeightPx} | ${fontWeight}`
    text.set(name, text.get(name) ?? new Map())
    text.get(name).set(key, (text.get(name).get(key) ?? 0) + 1)
  }

  for (const child of node.children ?? []) collect(child, styles, fills, text)
}

const total = (counts) => [...counts.values()].reduce((a, b) => a + b, 0)
const dominant = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]

const refresh = argv.includes('--refresh')
const data = await load(refresh)
const entry = data.nodes[COMPONENTS_NODE]

const fills = new Map()
const text = new Map()
collect(entry.document, entry.styles, fills, text)

const live = (name) => !name.includes('(OLD)')
const byUse = (a, b) => total(b[1]) - total(a[1])

console.log('**Colors:**\n')
console.log('| Token | Value | n |')
console.log('|---|---|---|')
for (const [name, counts] of [...fills].filter(([n]) => live(n)).sort(byUse)) {
  console.log(`| \`${name}\` | \`${dominant(counts)}\` | ${total(counts)} |`)
}

console.log('\n**Type — Poppins:**\n')
console.log('| Token | Size / LH | Weight | n |')
console.log('|---|---|---|---|')
for (const [name, counts] of [...text].sort(byUse)) {
  const [size, weight] = dominant(counts).split(' | ')
  console.log(`| \`${name}\` | ${size} | ${weight} | ${total(counts)} |`)
}

const legacy = [...fills].filter(([n]) => !live(n)).sort(byUse)
console.log(`\nLegacy v1 styles still live inside v2 components: ${legacy.length}`)
for (const [name, counts] of legacy) {
  console.log(`  ${name} ${dominant(counts)} (${total(counts)})`)
}

console.log(`\nThe Use column in CLAUDE.md is written by hand — this only reports what Figma holds.`)
if (!refresh) console.log('Read from cache. Pass --refresh to re-fetch.')
