#!/usr/bin/env node
/**
 * Stage 1 — the only script that reads design data over the network.
 *
 * Pulls the whole file in one request and writes it to .figma-raw/. Nothing here
 * interprets the response; `extract.mjs` does that offline. Run this at most once
 * a month, or whenever `figma:check` reports the snapshot is stale.
 *
 * Usage:  npm run figma:pull
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { argv, exit } from 'node:process'
import { FILE_KEY, RAW_DIR, figmaFetch } from './lib.mjs'

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * The whole-file route and the /nodes route have been observed refusing and
 * recovering independently, so a 429 on one is not evidence about the other.
 * Whole-file first: it returns every page at once for the same single request.
 */
const ROUTES = [
  { label: 'whole file', path: `files/${FILE_KEY}` },
  { label: 'Components page only', path: `files/${FILE_KEY}/nodes?ids=50:559` },
]

async function pullDocument() {
  const failures = []

  for (const route of ROUTES) {
    process.stdout.write(`Trying ${route.label} (/${route.path.split('?')[0]}) … `)
    try {
      const json = await figmaFetch(route.path)
      console.log('200')
      return { json, route }
    } catch (error) {
      if (!error.rateLimited) throw error
      console.log('429')
      failures.push(route.label)
    }
  }

  console.error(
    `\nEvery node-reading route is rate limited (${failures.join(', ')}).\n\n` +
      'This budget is inherited across sessions and windows have lasted over two hours.\n' +
      'Polling does not shorten it. Re-run later — design/ stays usable meanwhile, and\n' +
      '`npm run figma:check` tells you whether the committed snapshot is even stale.',
  )
  exit(1)
}

const { json, route } = await pullDocument()

// Provenance for the manifest. /versions sits in a different bucket and has stayed
// 200 throughout every outage so far, which is what makes cheap staleness checks work.
let versions = null
try {
  versions = await figmaFetch(`files/${FILE_KEY}/versions`)
} catch (error) {
  console.warn(`Could not read version history: ${error.message.split('\n')[0]}`)
}

await mkdir(RAW_DIR, { recursive: true })

const body = JSON.stringify(json)
await writeFile(new URL('file.json', RAW_DIR), body)
await writeFile(
  new URL('provenance.json', RAW_DIR),
  JSON.stringify(
    {
      fileKey: FILE_KEY,
      route: route.path,
      pulledAt: new Date().toISOString(),
      name: json.name ?? null,
      lastModified: json.lastModified ?? null,
      version: json.version ?? null,
      latestVersionId: versions?.versions?.[0]?.id ?? null,
      latestVersionCreatedAt: versions?.versions?.[0]?.created_at ?? null,
    },
    null,
    2,
  ),
)

console.log(`\nWrote ${mb(body.length)} to .figma-raw/file.json (${json.name ?? 'unnamed file'})`)
console.log(`Last modified in Figma: ${json.lastModified ?? 'unknown'}`)

if (!argv.includes('--no-extract')) {
  console.log('\nRunning extract …\n')
  await import('./extract.mjs')
}
