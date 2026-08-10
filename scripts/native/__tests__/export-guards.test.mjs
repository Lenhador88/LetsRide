import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  REDIRECTED,
  UNTOUCHED,
  checkRedirects,
  resolveRedirect,
  scanExportTree,
} from '../export-guards.mjs'

/**
 * Both guards in PD-142 protect against a failure that looks like success, so
 * both are asserted in **both directions**: that a clean input passes, and that
 * a planted failure is caught. A guard which has silently stopped matching
 * passes for ever and looks exactly like a clean repo — the same self-check
 * `src/__tests__/no-service-role-key.test.ts` makes, for the same reason.
 *
 * Neither of these builds anything. The real walk runs against `out/` from
 * `npm run build:native`; what is tested here is the detector that walk uses.
 */

const temporaries = []

function fixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'letsride-export-'))
  temporaries.push(dir)
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(dir, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, contents)
  }
  return dir
}

afterEach(() => {
  while (temporaries.length > 0) rmSync(temporaries.pop(), { recursive: true, force: true })
})

/** What a real export looks like, reduced: a document, a payload, a chunk. */
const CLEAN = {
  'index.html': '<!DOCTYPE html><html><body><div role="status"></div></body></html>',
  'rides/detail.html': '<!DOCTYPE html><html><body><div role="status"></div></body></html>',
  'rides/detail.txt': '3:I[12345,[],""]\n0:["",{"children":["rides",{"children":["detail"]}]}]\n',
  // The nil and max UUIDs, exactly as `z.uuid()`'s own regex carries them. A
  // bare UUID pattern reports these as rider data and makes the guard unusable
  // — measured against a real export on 2026-08-10, which is why the detector
  // is v4-shaped.
  '_next/static/chunks/zod.js':
    'const re=/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/',
  // supabase-js builds the sign path from `${url}/object/sign/…` in its own
  // source, so the short form is in every build and means nothing.
  '_next/static/chunks/supabase.js': 'await e8(s.fetch,`${s.url}/object/sign/${n}`,{expiresIn:t})',
  // React's prop and CSS's pseudo-element both contain the word.
  '_next/static/chunks/ui.js': 'placeholder:"Search",placeholderShown',
}

describe('the bundle guard', () => {
  it('passes a clean export, including the two shapes that look like findings', () => {
    const { problems, htmlCount, payloadCount } = scanExportTree(fixture(CLEAN))
    expect(problems).toEqual([])
    expect(htmlCount).toBe(2)
    expect(payloadCount).toBe(1)
  })

  it('catches a real resource id in a document', () => {
    const { problems } = scanExportTree(
      fixture({ ...CLEAN, 'clubs/detail.html': '<p>8d6e4c1a-2b3f-4a5b-9c8d-1e2f3a4b5c6d</p>' })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('clubs/detail.html')
    expect(problems[0]).toContain('v4 UUID')
  })

  it('catches a real resource id in an RSC payload, not only in HTML', () => {
    // The whole point of walking every emitted file. The payloads are what the
    // client router fetches on a navigation, and a check globbing `**/*.html`
    // leaves them unread — a guard that cannot fail.
    const { problems } = scanExportTree(
      fixture({ ...CLEAN, 'rides/detail.txt': '0:["rides","8d6e4c1a-2b3f-4a5b-9c8d-1e2f3a4b5c6d"]' })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('rides/detail.txt')
  })

  it('catches a signed Storage URL and its token', () => {
    const { problems } = scanExportTree(
      fixture({
        ...CLEAN,
        'postcards/detail.html':
          '<img src="https://x.supabase.co/storage/v1/object/sign/media/a.jpg?token=eyJhbGciOiJIUzI1NiJ9">',
      })
    )
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('a signed Supabase Storage URL')
    expect(problems[1]).toContain('the token half of a signed URL')
  })

  it('catches a prerendered placeholder path, which is the other design coming back', () => {
    const { problems } = scanExportTree(
      fixture({ ...CLEAN, 'rides/placeholder/index.html': '<html></html>' })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('a path segment named "placeholder"')
  })
})

/**
 * A `routes-manifest.json` redirect entry, built the way Next builds one, so the
 * test exercises the same regex the deployment will.
 */
function entry(source, destination, regex) {
  return { source, destination, statusCode: 307, regex }
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/** The manifest the current `next.config.ts` produces — copied off a real build. */
const GOOD_MANIFEST = [
  { source: '/:path+/', destination: '/:path+', internal: true, statusCode: 308, regex: '^(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))/$' },
  ...[
    ['/postcards', ''],
    ['/rides', ''],
    ['/rides', '/crew'],
    ['/rides', '/chat'],
    ['/rides', '/edit'],
    ['/clubs', ''],
    ['/clubs', '/rides'],
    ['/clubs', '/members'],
    ['/clubs', '/about'],
    ['/clubs', '/edit'],
  ].map(([base, tail]) =>
    entry(
      `${base}/:id(${UUID})${tail}`,
      `${base}/detail${tail}?id=:id`,
      `^(?!/_next)${base}(?:/(${UUID}))${tail}(?:/)?$`
    )
  ),
]

describe('the legacy redirect guard', () => {
  it('accepts the manifest the current config produces', () => {
    expect(checkRedirects(GOOD_MANIFEST)).toEqual([])
  })

  it('carries a case for every legacy shape, so none can be dropped unnoticed', () => {
    expect(REDIRECTED).toHaveLength(10)
  })

  it('catches an unconstrained source swallowing the routes behind it', () => {
    // The failure the UUID constraint exists for. Redirects are matched before
    // filesystem routes, so `/rides/:id` catches `/rides/new` — and
    // `/rides/detail` itself, which sends every ride screen to `?id=detail`.
    const loose = [
      entry('/rides/:id', '/rides/detail?id=:id', '^(?!/_next)/rides(?:/([^/]+?))(?:/)?$'),
      ...GOOD_MANIFEST,
    ]
    const problems = checkRedirects(loose)
    expect(problems.some((p) => p.startsWith('/rides/new:'))).toBe(true)
    expect(problems.some((p) => p.startsWith('/rides/detail:'))).toBe(true)
    expect(problems.some((p) => p.includes('not constrained to a UUID'))).toBe(true)
  })

  it('catches a dropped redirect, which is a link that used to work and now 404s', () => {
    const missing = GOOD_MANIFEST.filter((e) => !e.destination.startsWith('/postcards/detail'))
    const problems = checkRedirects(missing)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('no redirect')
  })

  it('catches a permanent redirect, which a browser caches for ever', () => {
    const permanent = GOOD_MANIFEST.map((e) =>
      e.internal ? e : { ...e, statusCode: 308 }
    )
    expect(checkRedirects(permanent).every((p) => p.includes('status 308'))).toBe(true)
    expect(checkRedirects(permanent)).toHaveLength(10)
  })

  it('leaves every current route alone', () => {
    for (const pathname of UNTOUCHED) {
      expect(resolveRedirect(GOOD_MANIFEST, pathname), pathname).toBeNull()
    }
  })

  it('redirects a well-formed id that names no row exactly like any other', () => {
    // The negative case that is easy to "fix" into a defect: the nil uuid must
    // travel the same road as a real one, all the way to the screen that finds
    // nothing. Anything telling the two apart earlier would be an existence
    // oracle, which is what `native-static-bundle` forbids the routing layer.
    expect(resolveRedirect(GOOD_MANIFEST, '/clubs/00000000-0000-0000-0000-000000000000')).toEqual({
      destination: '/clubs/detail?id=00000000-0000-0000-0000-000000000000',
      statusCode: 307,
    })
  })
})
