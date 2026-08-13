import { describe, expect, it } from 'vitest'
import {
  BACK_ORIGIN_PARAM,
  DEFAULT_BACK_HREF,
  linkWithOrigin,
  resolveBackDestination,
  BACK_ORIGINS,
} from '@/lib/back-navigation'

describe('resolveBackDestination', () => {
  it.each(['/postcards', '/rides', '/clubs', '/profile'])(
    'returns %s — every screen that renders the mailbox',
    (origin) => {
      expect(resolveBackDestination(origin)).toBe(origin)
    }
  )

  // The cold-deeplink case, and the reason there is a default at all: a push
  // notification opens this screen with no origin to carry.
  it('falls back when the URL carries no origin', () => {
    expect(resolveBackDestination(null)).toBe(DEFAULT_BACK_HREF)
    expect(resolveBackDestination(undefined)).toBe(DEFAULT_BACK_HREF)
    expect(resolveBackDestination('')).toBe(DEFAULT_BACK_HREF)
  })

  // The parameter is rider-supplied, so handing it to `router.replace` unchecked
  // is an open redirect on a signed-in screen. Every one of these must resolve
  // to a path inside the app rather than to what it names.
  it.each([
    ['an absolute URL', 'https://example.com'],
    ['a protocol-relative URL', '//example.com'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a path traversal', '/postcards/../../etc/passwd'],
    ['an unknown in-app path', '/rides/detail?id=1'],
    ['a prefix of a real origin', '/ride'],
    ['a lookalike with a trailing slash', '/rides/'],
  ])('refuses %s', (_label, from) => {
    expect(resolveBackDestination(from)).toBe(DEFAULT_BACK_HREF)
  })
})

describe('linkWithOrigin', () => {
  it('encodes the origin into the query string', () => {
    expect(linkWithOrigin('/notifications', '/rides')).toBe('/notifications?from=%2Frides')
  })

  // The writer and the reader agree by construction, which is the whole point of
  // the two living in one module.
  it('round-trips every origin it will accept back', () => {
    for (const origin of ['/postcards', '/rides', '/clubs', '/profile']) {
      const url = new URL(linkWithOrigin('/notifications', origin), 'https://app.letsride.social')
      expect(resolveBackDestination(url.searchParams.get(BACK_ORIGIN_PARAM))).toBe(origin)
    }
  })

  it('leaves the href bare rather than writing an origin it would refuse', () => {
    expect(linkWithOrigin('/notifications', '/clubs/explore')).toBe('/notifications')
    expect(linkWithOrigin('/notifications', 'https://example.com')).toBe('/notifications')
  })
})

// **The tripwire the allowlist did not have.** `BACK_ORIGINS` is a hand-written
// copy of "which screens render the mailbox control", and nothing failed when
// the two drifted: a fifth entry point added without a line there makes
// `linkWithOrigin` refuse the origin, return the bare href, and land the rider
// on Home — the exact "screen they were never on" this module exists to
// prevent — while tsc, ESLint, the other cases here, docs:check and next build
// all stay green.
//
// Derived from the filesystem rather than restated, so the assertion cannot
// drift with the thing it measures. `/notifications` is excluded because it
// renders the control as the BACK arrow rather than as an entry point: it is a
// destination, never an origin.
describe('BACK_ORIGINS is derived, not remembered', () => {
  it('matches exactly the (app) pages that render NotificationsHeaderControl', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')

    // Walked rather than globbed: `fs.globSync` is not in this repo's Node types,
    // and `tsc` refusing an untyped callback is what caught the first draft.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) return walk(path)
        return entry.name === 'page.tsx' ? [path] : []
      })

    const root = 'src/app/(app)'
    const pages: string[] = walk(root)

    const importers: string[] = pages
      .filter((file: string) => readFileSync(file, 'utf8').includes('NotificationsHeaderControl'))
      .map((file: string) => `/${file.slice(root.length + 1).replace(/\/page\.tsx$/, '')}`)
      .filter((route: string) => route !== '/notifications')

    // Guards the guard: a walk that found nothing would make the comparison
    // vacuously true against an empty allowlist.
    expect(pages.length).toBeGreaterThan(0)
    expect(importers.length).toBeGreaterThan(0)
    expect([...importers].sort()).toEqual([...BACK_ORIGINS].sort())
  })
})
