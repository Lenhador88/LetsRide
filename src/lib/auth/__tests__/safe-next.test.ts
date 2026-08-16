import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/auth/recovery'

// PD-225: safeNext no longer names a destination. `null` means "not usable", and
// the caller decides what that implies — see callbackFailureDestination and the
// grant read in /auth/callback.
const REFUSED = null

describe('safeNext — required cases', () => {
  it('passes through an ordinary in-app path', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard')
  })

  it('refuses a protocol-relative URL (//host)', () => {
    expect(safeNext('//evil.example')).toBe(REFUSED)
  })

  it('refuses a full https:// URL', () => {
    expect(safeNext('https://evil.example')).toBe(REFUSED)
  })

  it('refuses a single-slash scheme (http:/evil)', () => {
    expect(safeNext('http:/evil')).toBe(REFUSED)
  })

  it('refuses the literal string "null"', () => {
    expect(safeNext('null')).toBe(REFUSED)
  })

  it('refuses an empty string', () => {
    expect(safeNext('')).toBe(REFUSED)
  })

  it('refuses actual null', () => {
    expect(safeNext(null)).toBe(REFUSED)
  })
})

describe('safeNext — bypass attempts', () => {
  it('refuses three slashes', () => {
    expect(safeNext('///evil.example')).toBe(REFUSED)
  })

  it('refuses a value with no leading slash at all', () => {
    expect(safeNext('evil.example')).toBe(REFUSED)
  })

  it('refuses a scheme-relative URL with an @ trick (//user@evil.example)', () => {
    expect(safeNext('//user@evil.example')).toBe(REFUSED)
  })

  it('refuses backslash-backslash, browsers that fold \\ to / would treat it as //', () => {
    expect(safeNext('\\\\evil.example')).toBe(REFUSED)
  })

  // Neither of these starts with "//", so an unhardened guard lets them
  // through. They are not exploitable through route.ts as written — it builds
  // `${origin}${next}`, where the host is fixed by literal text before any
  // parsing happens — but URL parsers fold `\` to `/` and strip tabs, so
  // `new URL('/\\evil.example', origin).host` is `evil.example`. The guard
  // rejects them so it holds on its own, rather than depending on how a future
  // caller assembles the redirect.
  it('refuses a single backslash after the leading slash', () => {
    expect(safeNext('/\\evil.example')).toBe(REFUSED)
  })

  it('refuses an embedded tab', () => {
    expect(safeNext('/\t/evil.example')).toBe(REFUSED)
  })

  it('refuses an embedded newline and carriage return', () => {
    expect(safeNext('/dash\nboard')).toBe(REFUSED)
    expect(safeNext('/dash\r\nboard')).toBe(REFUSED)
  })

  it('refuses a NUL byte', () => {
    expect(safeNext('/dashboard\x00')).toBe(REFUSED)
  })

  it('percent-encoded slashes are NOT rejected by the guard (benign: %2F never decodes back to a path separator)', () => {
    expect(safeNext('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example')
  })

  it('composed with the route\'s actual concatenation pattern, none of the accepted values change the host', () => {
    // This is the property that actually matters for route.ts: no output of
    // safeNext, concatenated onto a real origin the way the route does it,
    // can ever produce a URL whose host differs from that origin's host.
    const origin = 'https://letsride.app'
    const candidates = [
      '/dashboard',
      '/\\evil.example',
      '/\t/evil.example',
      '/%2F%2Fevil.example',
      '//evil.example', // rejected by the guard, included as a control case
      'https://evil.example', // rejected by the guard, included as a control case
    ]

    for (const candidate of candidates) {
      // `?? '/postcards'` stands in for what the caller now does with a refusal
      // — the point of the test is that no ACCEPTED value moves the host, and
      // a refused one never reaches a URL at all.
      const next = safeNext(candidate) ?? '/postcards'
      const resolved = new URL(`${origin}${next}`)
      expect(resolved.host).toBe(new URL(origin).host)
    }
  })
})
