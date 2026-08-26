#!/usr/bin/env node
/**
 * Run immediately after a plain `npm run build`. Asserts the thing that was just
 * built is the **web** app and not the native bundle.
 *
 * ## The failure this catches
 *
 * `CAPACITOR_BUILD=1` leaking into a Vercel target. It is set in no target today
 * and "we did not set it" is not a verification — one checkbox produces a static
 * export with no server, so every legacy `/postcards/<uuid>` link 404s (the
 * redirects live in the web config only, and a static export cannot run one) and
 * `next/image` stops being optimised. The deploy goes **green**, which
 * `CLAUDE.md` §Working Principles names as the worst available failure.
 *
 * ## What it reads, and why not the config
 *
 * The built output, never `next.config.ts`. A config that *says* the right thing
 * and a build that *did* the right thing are different claims, and only the
 * second one ships. `.next/export-detail.json` is written by the export path and
 * by nothing else; `out/` is created by the export path and by nothing else.
 * Both measured on 2026-08-10 by running the two builds back to back.
 *
 * Usage: `node scripts/native/assert-web-build.mjs`
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRedirects } from './export-guards.mjs'

/**
 * The one header rule the native shell depends on, asserted for the same reason
 * the redirects above are: it is invisible when it breaks.
 *
 * `src/lib/native/version-gate.ts` fetches `app-version.json` from the web
 * origin, and the webview's own origin (`https://localhost`, or
 * `capacitor://localhost` on iOS) makes that cross-origin. Without
 * `Access-Control-Allow-Origin` the read is blocked, the gate fails open — its
 * correct behaviour on any failure — and the whole mechanism silently does
 * nothing, with nothing red anywhere. That is the failure `next.config.ts`'s own
 * comment argues against, and until this check existed a config edit could
 * reintroduce it without a single gate noticing.
 */
function checkVersionCors(headers) {
  const rule = headers.find((entry) => entry.source === '/app-version.json')
  if (!rule) {
    return [
      'no headers rule for /app-version.json — the native update gate reads that file ' +
        'cross-origin from the webview, so without Access-Control-Allow-Origin the fetch is ' +
        'blocked and the gate silently never fires. See next.config.ts.',
    ]
  }
  const allows = (rule.headers ?? []).some(
    (header) => header.key?.toLowerCase() === 'access-control-allow-origin'
  )
  return allows
    ? []
    : [
        'the headers rule for /app-version.json carries no Access-Control-Allow-Origin — ' +
          'the native update gate cannot read the file without it.',
      ]
}

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const problems = []

if (!existsSync(path.join(ROOT, '.next'))) {
  problems.push('.next/ is missing — nothing was built, so nothing here was verified')
}

if (existsSync(path.join(ROOT, '.next', 'export-detail.json'))) {
  problems.push(
    '.next/export-detail.json exists — this build ran the static export path. ' +
      'CAPACITOR_BUILD must be unset for a web build.'
  )
}

if (existsSync(path.join(ROOT, 'out'))) {
  problems.push(
    'out/ exists — the static export writes it and a web build never does. ' +
      'If you ran `CAPACITOR_BUILD=1 npm run build` locally, `rm -rf out` and build again.'
  )
}

const manifestPath = path.join(ROOT, '.next', 'routes-manifest.json')
if (!existsSync(manifestPath)) {
  problems.push('.next/routes-manifest.json is missing — the redirects cannot be checked')
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  problems.push(...checkRedirects(manifest.redirects ?? []))
  problems.push(...checkVersionCors(manifest.headers ?? []))
}

if (problems.length > 0) {
  console.error('The web build is not what it should be:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\nSee openspec/changes/add-static-export-bundle/ and docs/ENVIRONMENTS.md.')
  process.exit(1)
}

console.log(
  'web build ok — server build, no out/, all 10 legacy detail links still resolve, ' +
    'and app-version.json is readable cross-origin'
)
