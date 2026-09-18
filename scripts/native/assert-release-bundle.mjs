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

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLATFORM_BUNDLE_DIRS,
  PROD_PROJECT_REF,
  RELEASE_ORIGIN,
  platformCopyProblems,
  releaseVersionProblems,
  scanReleaseBundle,
} from './release-guards.mjs'

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

// The update gate eating its own fix — see `releaseVersionProblems`. Read from
// the SOURCE files rather than from `out/`: `package.json`'s version is what
// `src/lib/version.ts` reports (its test pins them together), and
// `public/app-version.json` is the copy about to be deployed alongside this
// submission.
const bundleVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const publishedMinimum = JSON.parse(
  readFileSync(path.join(ROOT, 'public', 'app-version.json'), 'utf8')
).minimum
problems.push(...releaseVersionProblems(bundleVersion, publishedMinimum))

// **`out/` is not the artifact — PD-204.** What a store receives is the copy
// `cap sync` made into the platform project, so everything above is a check on
// the wrong directory unless this runs too. A platform that does not exist
// (`android/`, PD-442) contributes nothing and says nothing.
const platformsChecked = []
for (const target of PLATFORM_BUNDLE_DIRS) {
  if (!existsSync(path.join(ROOT, target.project))) continue
  platformsChecked.push(target)
  problems.push(...platformCopyProblems(ROOT, files, target))
}

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
    `version ${bundleVersion} at or above the published minimum ${publishedMinimum}; ` +
    `no localhost origin.\n` +
    `Refs found: ${[...refs.keys()].join(', ')}\n` +
    // Named rather than implied: "no platform problems" and "no platform was
    // looked at" read identically, and the second is what this check exists to
    // stop being invisible.
    (platformsChecked.length > 0
      ? `Platform copies verified against out/: ${platformsChecked
          .map((target) => `${target.platform} (${target.bundle})`)
          .join(', ')}`
      : 'No platform project exists, so NOTHING that a store would receive was checked — ' +
        'out/ is not the artifact. Generate a platform and run this again before submitting.')
)
