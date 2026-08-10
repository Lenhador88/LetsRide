/**
 * The two guards PD-142 needs, as pure functions so both a CI script and a unit
 * test can use them.
 *
 * ## Why this is a module and not two `grep`s in a workflow
 *
 * Both guards fail in the direction where nothing looks wrong. A bundle that
 * quietly carries a real ride id is a file on thousands of devices that cannot
 * be revoked; a web build that quietly became a static export is a **green
 * deploy** of an app with no server, where every legacy link 404s and
 * `next/image` has stopped being optimised. Neither shows up as a broken screen
 * on the machine that produced it.
 *
 * So each guard is written so its *detector* can be tested against a planted
 * failure. `src/__tests__/no-service-role-key.test.ts` is the precedent and the
 * reasoning is its: a guard that has silently stopped matching passes for ever
 * and looks exactly like a clean repo.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * What must not be in the bundle, and why each pattern is shaped the way it is.
 * Every one was measured against a real export on 2026-08-10 — the naive
 * version of the first two matched library source and would have been a guard
 * nobody could keep green.
 */
export const BUNDLE_PATTERNS = [
  {
    id: 'resource-id',
    // **Version 4 specifically.** A bare UUID pattern matches the nil and max
    // UUIDs that Zod's own `z.uuid()` regex carries as literal alternatives
    // inside a client chunk, so it reports a real export as dirty. Postgres'
    // `gen_random_uuid()` produces v4, which is what every `clubs.id`,
    // `rides.id` and `postcards.id` in this database is.
    pattern:
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/,
    describe: 'a v4 UUID — a real club, ride, postcard or rider id',
  },
  {
    id: 'signed-storage-url',
    // The full path, not `object/sign`: supabase-js builds the latter from
    // `${url}/object/sign/…` in its own source, so the short form is present in
    // every build and means nothing. The full one only appears in a URL that
    // was actually signed.
    pattern: /storage\/v1\/object\/sign/,
    describe: 'a signed Supabase Storage URL',
  },
  {
    id: 'signed-url-token',
    pattern: /token=eyJ/,
    describe: 'a JWT in a query string — the token half of a signed URL',
  },
]

/**
 * A path segment named `placeholder` in the output tree.
 *
 * There is no placeholder mechanism under the shape that shipped — the ids left
 * the path entirely, so nothing enumerates them — and this exists to keep it
 * that way. The alternative design prerendered `out/rides/placeholder/…`, and
 * the failure it could not detect on its own was that same directory reaching a
 * Vercel deployment.
 */
export const PLACEHOLDER_SEGMENT = 'placeholder'

/** Every file under `dir`, recursively, as paths relative to it. */
export function walkFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walkFiles(full).map((p) => path.join(entry, p))
    return [entry]
  })
}

/**
 * Walks **every** emitted file, rather than a glob of one extension.
 *
 * The export writes ~274 `__next.*.txt` RSC segment payloads beside its 33
 * documents, and those are the files the client router fetches on a navigation.
 * A check scoped to one extension inspects the documents and leaves the
 * payloads unread, which is the shape of a guard that cannot fail.
 *
 * Returns `{ files, htmlCount, payloadCount, problems }` so the caller can also
 * refuse a walk that inspected nothing — an empty or missing `out/` is a failed
 * build, never a clean one.
 */
export function scanExportTree(dir) {
  const files = walkFiles(dir)
  const problems = []
  let htmlCount = 0
  let payloadCount = 0

  for (const relative of files) {
    if (relative.split(path.sep).includes(PLACEHOLDER_SEGMENT)) {
      problems.push(`${relative}: a path segment named "${PLACEHOLDER_SEGMENT}"`)
    }
    if (relative.endsWith('.html')) htmlCount += 1
    if (relative.endsWith('.txt')) payloadCount += 1

    const contents = readFileSync(path.join(dir, relative), 'utf8')
    for (const { pattern, describe } of BUNDLE_PATTERNS) {
      const hit = contents.match(pattern)
      if (hit) problems.push(`${relative}: ${describe} — ${hit[0].slice(0, 80)}`)
    }
  }

  return { files, htmlCount, payloadCount, problems }
}

/**
 * A sample URL per legacy route shape, and the shape each must land on.
 *
 * The uuid is v4-shaped so it exercises the same constraint a real link would.
 * It names no row — it is all `a`s and `1`s — and never reaches the database.
 */
const SAMPLE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'

export const REDIRECTED = [
  [`/postcards/${SAMPLE_ID}`, `/postcards/detail?id=${SAMPLE_ID}`],
  [`/rides/${SAMPLE_ID}`, `/rides/detail?id=${SAMPLE_ID}`],
  [`/rides/${SAMPLE_ID}/crew`, `/rides/detail/crew?id=${SAMPLE_ID}`],
  [`/rides/${SAMPLE_ID}/chat`, `/rides/detail/chat?id=${SAMPLE_ID}`],
  [`/rides/${SAMPLE_ID}/edit`, `/rides/detail/edit?id=${SAMPLE_ID}`],
  [`/clubs/${SAMPLE_ID}`, `/clubs/detail?id=${SAMPLE_ID}`],
  [`/clubs/${SAMPLE_ID}/rides`, `/clubs/detail/rides?id=${SAMPLE_ID}`],
  [`/clubs/${SAMPLE_ID}/members`, `/clubs/detail/members?id=${SAMPLE_ID}`],
  [`/clubs/${SAMPLE_ID}/about`, `/clubs/detail/about?id=${SAMPLE_ID}`],
  [`/clubs/${SAMPLE_ID}/edit`, `/clubs/detail/edit?id=${SAMPLE_ID}`],
]

/**
 * The paths an unconstrained `source` would swallow, and this is a measured
 * hazard rather than a hypothetical one: **redirects are matched before
 * filesystem routes**, so `/rides/:id` catches `/rides/new` and — worse —
 * `/rides/detail` itself, sending every ride screen to `?id=detail`. Constraining
 * each `source` to a UUID is what stops it, and this list is how that is
 * verified rather than assumed.
 */
export const UNTOUCHED = [
  '/rides',
  '/rides/new',
  '/rides/detail',
  '/rides/detail/crew',
  '/rides/detail/chat',
  '/rides/detail/edit',
  '/clubs',
  '/clubs/new',
  '/clubs/explore',
  '/clubs/detail',
  '/clubs/detail/about',
  '/clubs/detail/members',
  '/clubs/detail/rides',
  '/clubs/detail/edit',
  '/postcards',
  '/postcards/new',
  '/postcards/detail',
  // A malformed id is a not-found on the detail screen, not a redirect target.
  // A *well-formed* one that names no row is NOT in this list on purpose: the
  // nil uuid redirects like any other, lands on the detail screen, and 404s
  // there. Refusing to redirect it would be the shell deciding which ids exist,
  // which is the existence oracle `native-static-bundle` forbids.
  '/rides/not-a-uuid',
  '/clubs/new-club',
]

/**
 * Applies a `routes-manifest.json` redirect list to a pathname the way Next's
 * router does — first match wins, `:id` filled from the capture group.
 */
export function resolveRedirect(redirects, pathname) {
  for (const entry of redirects) {
    if (entry.internal) continue
    const match = new RegExp(entry.regex).exec(pathname)
    if (!match) continue
    return {
      destination: entry.destination.replace(/:id\b/g, match[1] ?? ''),
      statusCode: entry.statusCode,
    }
  }
  return null
}

/**
 * The web build's redirect contract, checked against the manifest the build
 * actually wrote rather than against the config that was meant to produce it.
 */
export function checkRedirects(redirects) {
  const problems = []

  for (const [from, to] of REDIRECTED) {
    const result = resolveRedirect(redirects, from)
    if (!result) {
      problems.push(`${from}: no redirect — a link already in someone's messages now 404s`)
      continue
    }
    if (result.destination !== to) {
      problems.push(`${from}: redirects to ${result.destination}, expected ${to}`)
    }
    // 307 rather than 308: a permanent redirect is cached by the browser
    // effectively for ever, and this shape has now moved once.
    if (result.statusCode !== 307) {
      problems.push(`${from}: status ${result.statusCode}, expected 307`)
    }
  }

  for (const pathname of UNTOUCHED) {
    const result = resolveRedirect(redirects, pathname)
    if (result) {
      problems.push(
        `${pathname}: swallowed by a redirect to ${result.destination} — the source is not constrained to a UUID`
      )
    }
  }

  return problems
}
