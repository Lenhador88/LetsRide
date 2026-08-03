#!/usr/bin/env node
/**
 * Is the committed snapshot still current, and what is Figma actually serving?
 *
 * The staleness check costs one request to /versions, which sits in a different
 * rate-limit bucket from the node routes and has stayed 200 through every outage
 * recorded in docs/HANDOFF.md. So "is my snapshot stale?" is answerable even when
 * "give me the file" is not.
 *
 * Usage:
 *   npm run figma:check            compare design/manifest.json against Figma
 *   npm run figma:check -- --probe sweep every endpoint and report status codes
 */
import { readFile } from 'node:fs/promises'
import { argv, env, exit } from 'node:process'
import { DESIGN_DIR, FILE_KEY, figmaFetch } from './lib.mjs'

const PROBES = [
  ['me', 'auth only — 200 here proves nothing about design reads'],
  [`files/${FILE_KEY}/versions`, 'version history — the cheap staleness signal'],
  [`files/${FILE_KEY}?depth=1`, 'node tree, shallow — the route that gates figma:pull'],
  [`files/${FILE_KEY}/nodes?ids=50:559`, 'node tree, Components page'],
  [`images/${FILE_KEY}?ids=50:559&format=svg`, 'render endpoint — gates figma:icons'],
  [`files/${FILE_KEY}/styles`, 'published styles — empty while the library is unpublished'],
  [`files/${FILE_KEY}/components`, 'published components — same'],
]

if (argv.includes('--probe')) {
  if (!env.FIGMA_ACCESS_TOKEN) {
    console.error('FIGMA_ACCESS_TOKEN is not set.')
    exit(1)
  }

  console.log('Rate limits are per endpoint family — one 429 is not evidence about another.\n')
  for (const [path, note] of PROBES) {
    const res = await fetch(`https://api.figma.com/v1/${path}`, {
      headers: { 'X-Figma-Token': env.FIGMA_ACCESS_TOKEN },
    })
    const mark = res.ok ? 'ok  ' : res.status === 429 ? '429 ' : 'fail'
    console.log(`${mark} ${String(res.status).padEnd(4)} /${path.split('?')[0].padEnd(46)} ${note}`)
  }
  exit(0)
}

let manifest = null
try {
  manifest = JSON.parse(await readFile(new URL('manifest.json', DESIGN_DIR), 'utf8'))
} catch {
  console.log('No snapshot committed yet (design/manifest.json is missing).')
  console.log('Run `npm run figma:pull` when the node routes are reachable.')
  exit(1)
}

console.log(`Snapshot: ${manifest.fileName ?? FILE_KEY}`)
console.log(`  pulled     ${manifest.pulledAt ?? 'unknown'}`)
console.log(`  figma said ${manifest.lastModified ?? 'unknown'} (lastModified at pull time)`)
console.log(`  contents   ${manifest.counts.frames} frames, ${manifest.counts.components} components, ` +
  `${manifest.counts.colorTokens} colors, ${manifest.counts.typeTokens} type, ` +
  `${manifest.counts.iconsExported}/${manifest.counts.iconsFound} icons exported`)

let versions
try {
  versions = await figmaFetch(`files/${FILE_KEY}/versions`)
} catch (error) {
  console.log(`\nCould not reach version history: ${error.message.split('\n')[0]}`)
  exit(2)
}

const latest = versions.versions?.[0]
if (!latest) {
  console.log('\nFigma returned no version history — cannot judge staleness.')
  exit(2)
}

console.log(`\nFigma latest version: ${latest.id} (${latest.created_at})${latest.label ? ` — ${latest.label}` : ''}`)

if (!manifest.latestVersionId) {
  console.log('The snapshot predates version tracking; re-pull to start comparing.')
  exit(0)
}

if (manifest.latestVersionId === latest.id) {
  console.log('\nUp to date. Nothing to re-pull — work from design/.')
  exit(0)
}

console.log(`\nSTALE. Snapshot is at ${manifest.latestVersionId}, Figma is at ${latest.id}.`)
console.log('Run `npm run figma:pull` to refresh, then commit design/.')
exit(1)
