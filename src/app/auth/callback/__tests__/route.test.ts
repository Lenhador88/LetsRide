import { describe, expect, it } from 'vitest'
import { safeNext } from '@/app/auth/callback/route'

const FALLBACK = '/auth/reset-password'

describe('safeNext — required cases', () => {
  it('passes through an ordinary in-app path', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard')
  })

  it('falls back on a protocol-relative URL (//host)', () => {
    expect(safeNext('//evil.example')).toBe(FALLBACK)
  })

  it('falls back on a full https:// URL', () => {
    expect(safeNext('https://evil.example')).toBe(FALLBACK)
  })

  it('falls back on a single-slash scheme (http:/evil)', () => {
    expect(safeNext('http:/evil')).toBe(FALLBACK)
  })

  it('falls back on the literal string "null"', () => {
    expect(safeNext('null')).toBe(FALLBACK)
  })

  it('falls back on an empty string', () => {
    expect(safeNext('')).toBe(FALLBACK)
  })

  it('falls back on actual null', () => {
    expect(safeNext(null)).toBe(FALLBACK)
  })
})

describe('safeNext — bypass attempts', () => {
  it('falls back on three slashes', () => {
    expect(safeNext('///evil.example')).toBe(FALLBACK)
  })

  it('falls back on a value with no leading slash at all', () => {
    expect(safeNext('evil.example')).toBe(FALLBACK)
  })

  it('falls back on a scheme-relative URL with an @ trick (//user@evil.example)', () => {
    expect(safeNext('//user@evil.example')).toBe(FALLBACK)
  })

  it('falls back on backslash-backslash, browsers that fold \\ to / would treat it as //', () => {
    expect(safeNext('\\\\evil.example')).toBe(FALLBACK)
  })

  // Neither of these starts with "//", so an unhardened guard lets them
  // through. They are not exploitable through route.ts as written — it builds
  // `${origin}${next}`, where the host is fixed by literal text before any
  // parsing happens — but URL parsers fold `\` to `/` and strip tabs, so
  // `new URL('/\\evil.example', origin).host` is `evil.example`. The guard
  // rejects them so it holds on its own, rather than depending on how a future
  // caller assembles the redirect.
  it('rejects a single backslash after the leading slash', () => {
    expect(safeNext('/\\evil.example')).toBe(FALLBACK)
  })

  it('rejects an embedded tab', () => {
    expect(safeNext('/\t/evil.example')).toBe(FALLBACK)
  })

  it('rejects an embedded newline and carriage return', () => {
    expect(safeNext('/dash\nboard')).toBe(FALLBACK)
    expect(safeNext('/dash\r\nboard')).toBe(FALLBACK)
  })

  it('rejects a NUL byte', () => {
    expect(safeNext('/dashboard\x00')).toBe(FALLBACK)
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
      const next = safeNext(candidate)
      const resolved = new URL(`${origin}${next}`)
      expect(resolved.host).toBe(new URL(origin).host)
    }
  })
})
