#!/usr/bin/env node
/**
 * The pre-submission gate. Run against `out/` after building the bundle that is
 * about to be signed and uploaded:
 *
 *   NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native
 *   npm run release:check
 *
 * ## Why this is not part of `npm run build:native`
 *
 * `scripts/native/check-export.mjs` already runs there, on every native build
 * including the local and on-device ones `design.md` §D7 allows to point at DEV.
 * This one asserts the bundle is a **release** bundle, which is only true of the
 * one being submitted — wiring it into `build:native` would either block every
 * test build or get switched off, and a gate that gets switched off is not one.
 *
 * ## What it catches, and why nothing else can
 *
 * Both properties are baked in at build time and unfixable after submission
 * without a new store review:
 *
 * - **the backend** — a bundle built from `development` points every install at
 *   `letsride-dev` for ever;
 * - **the origin** — a bundle without the canonical origin emails riders links
 *   GoTrue discards, and shares links that resolve to nothing.
 *
 * Neither is visible on the machine that produced it: the app runs, signs in
 * against DEV, and looks perfectly healthy. "We were on the right branch" is
 * not a verification; this reads the artifact.
 *
 * Its detectors are tested against planted failures — a DEV-ref bundle, a
 * bundle with no ref at all, a localhost origin — in
 * `scripts/native/__tests__/release-guards.test.mjs`.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROD_PROJECT_REF, RELEASE_ORIGIN, scanReleaseBundle } from './release-guards.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const OUT = path.join(ROOT, 'out')

if (!existsSync(OUT)) {
  console.error(
    'out/ does not exist. Build the bundle first:\n\n' +
      `  NEXT_PUBLIC_CANONICAL_ORIGIN=${RELEASE_ORIGIN} npm run build:native\n`
  )
  process.exit(1)
}

const { files, refs, originFiles, problems } = scanReleaseBundle(OUT)

if (problems.length > 0) {
  console.error('This bundle must not be submitted:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    '\nA store submission is permanent in a way a deploy is not: there is no promote, ' +
      'no redeploy and no dashboard toggle, only a new binary through review.\n' +
      'See docs/ENVIRONMENTS.md §The native build flag.'
  )
  process.exit(1)
}

console.log(
  `release bundle ok — ${files.length} files walked; ` +
    `Supabase ref ${PROD_PROJECT_REF} (letsride) and no other; ` +
    `canonical origin ${RELEASE_ORIGIN} in ${originFiles} ${originFiles === 1 ? 'file' : 'files'}; ` +
    `no localhost origin.\n` +
    `Refs found: ${[...refs.keys()].join(', ')}`
)
