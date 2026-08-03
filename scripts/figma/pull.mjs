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
  let limit = null

  for (const route of ROUTES) {
    process.stdout.write(`Trying ${route.label} (/${route.path.split('?')[0]}) … `)
    try {
      const json = await figmaFetch(route.path)
      console.log('200')
      return { json, route }
    } catch (error) {
      if (!error.rateLimited) throw error
      console.log(`429 — ${error.rateLimit.readableWait} left`)
      failures.push(route.label)
      // The longest wait across the routes is the one that actually gates a pull.
      if (!limit || (error.rateLimit.seconds ?? 0) > (limit.seconds ?? 0)) limit = error.rateLimit
    }
  }

  console.error(`\nEvery node-reading route is rate limited (${failures.join(', ')}).`)

  if (limit?.seconds !== null && limit?.seconds !== undefined) {
    console.error(
      `\nRetry-After: ${limit.readableWait} — clears around ${limit.resetsAt.toISOString().slice(0, 16)}Z.\n` +
        `Plan tier ${limit.planTier ?? 'unknown'}, limit type ${limit.limitType ?? 'unknown'}.\n` +
        'Verified in seconds and counting down in real time; requests neither reset nor\n' +
        'shorten it, so there is nothing to gain by trying again before then.',
    )
  }

  console.error(
    '\ndesign/ stays usable meanwhile, and `npm run figma:check` tells you whether the\n' +
      'committed snapshot is even stale.',
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
