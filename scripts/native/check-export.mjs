#!/usr/bin/env node
/**
 * Run immediately after `CAPACITOR_BUILD=1 npm run build`. Asserts the bundle
 * `npx cap sync` is about to copy carries no rider data and no real resource id.
 *
 * ## Why this is a check and not a property to infer
 *
 * It is true today for a reason — every detail screen is `'use client'`, reads
 * in an effect, and `RouteGuard` renders the splash instead of children during
 * the prerender pass, so the emitted documents contain no visible text at all
 * (measured: the rendered text of every document in `out/` is the empty string).
 * But "it is true because of how we render" is exactly the sentence that stops
 * being true the day somebody prerenders "just the public clubs" to make first
 * paint faster, and the bundle is a file on thousands of devices that cannot be
 * revoked. A real id in it discloses that a row existed on build day — about a
 * private club to someone who was never a member, and about a postcard to
 * someone the author has blocked.
 *
 * Usage: `node scripts/native/check-export.mjs` — or `npm run build:native`,
 * which runs the export and this together so a bundle cannot be produced
 * unchecked.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanExportTree } from './export-guards.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const OUT = path.join(ROOT, 'out')

/**
 * A floor, so a walk of nothing cannot report clean. The 2026-08-10 export was
 * 384 files — 33 documents, 274 RSC payloads and the static assets — and a build
 * that produced a tenth of that is a failed build rather than a tidy one.
 */
const MIN_FILES = 100

if (!existsSync(OUT)) {
  console.error(
    'out/ does not exist. `CAPACITOR_BUILD=1 npm run build` writes it; a missing ' +
      'webDir is a failed build, not a clean one — cap sync copies it without ' +
      'complaint and it fails on a device as a white screen.'
  )
  process.exit(1)
}

if (!existsSync(path.join(OUT, 'index.html'))) {
  console.error('out/index.html is missing — Capacitor serves it for every extensionless path')
  process.exit(1)
}

const { files, htmlCount, payloadCount, problems } = scanExportTree(OUT)

if (files.length < MIN_FILES) {
  console.error(`out/ holds ${files.length} files, expected at least ${MIN_FILES}`)
  process.exit(1)
}

// Both, and named separately: "every emitted file" means the router's payloads
// too, and a run that inspected only documents has not covered the bundle.
if (htmlCount === 0 || payloadCount === 0) {
  console.error(
    `walked ${htmlCount} documents and ${payloadCount} RSC payloads — a bundle has both, ` +
      'so this walk did not see what it is meant to check'
  )
  process.exit(1)
}

if (problems.length > 0) {
  console.error('The bundle carries something it must not:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  `bundle ok — ${files.length} files walked (${htmlCount} documents, ${payloadCount} RSC payloads), ` +
    'no resource id, no signed URL, no placeholder path'
)
