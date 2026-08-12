import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalOrigin } from '@/lib/origin'
import { normaliseConfiguredOrigin } from '@/lib/origin-normalise'

/**
 * The suite runs under `environment: 'node'`, so there is no `window` — which
 * is the right shape here: the fallback branch has to be *given* a runtime
 * origin rather than inheriting jsdom's, so a test can tell "read the runtime
 * origin" apart from "read the configured one" without either being ambient.
 *
 * The fixture origins are deliberately real LetsRide hosts rather than a dev
 * server or a deployment alias: `docs:check`'s `hardcoded-origin-src` claim
 * greps all of `src/`, tests and comments included, and must stay 0. Naming
 * those two shapes even in a comment is enough to break it — this file did,
 * once, which is the comment trap arriving in the file that was warning about
 * it.
 */
const RUNTIME = 'https://app-dev.letsride.social'

function withRuntimeOrigin(origin: string) {
  vi.stubGlobal('window', { location: { origin } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('canonicalOrigin', () => {
  it('returns the runtime origin when nothing is configured', () => {
    // The web build's whole behaviour, and the reason the default is what it
    // is: with the variable unset this is byte-for-byte what the three call
    // sites read before there was a helper at all.
    withRuntimeOrigin(RUNTIME)
    expect(canonicalOrigin()).toBe(RUNTIME)
  })

  it('returns the configured origin when one is set, ignoring the runtime one', () => {
    withRuntimeOrigin('https://localhost')
    vi.stubEnv('NEXT_PUBLIC_CANONICAL_ORIGIN', 'https://app.letsride.social')
    expect(canonicalOrigin()).toBe('https://app.letsride.social')
  })

  it('strips a trailing slash, so a rooted path cannot produce a doubled one', () => {
    withRuntimeOrigin('https://localhost')
    vi.stubEnv('NEXT_PUBLIC_CANONICAL_ORIGIN', 'https://app.letsride.social/')
    expect(`${canonicalOrigin()}/auth/callback`).toBe('https://app.letsride.social/auth/callback')
  })

  it('strips several trailing slashes and surrounding whitespace', () => {
    // A value pasted into a Vercel variable field or a CI secret carries
    // whatever the paste carried. Neither shape is exotic and both are
    // invisible in a dashboard.
    withRuntimeOrigin('https://localhost')
    vi.stubEnv('NEXT_PUBLIC_CANONICAL_ORIGIN', '  https://app.letsride.social//  ')
    expect(canonicalOrigin()).toBe('https://app.letsride.social')
  })

  it('treats an empty or whitespace-only value as unset', () => {
    // The failure this decision closes: returning `''` builds a relative URL,
    // which is silently right on the web and silently `https://localhost/...`
    // in the shell — the original bug wearing a configured-looking value.
    for (const value of ['', '   ', '/']) {
      withRuntimeOrigin(RUNTIME)
      vi.stubEnv('NEXT_PUBLIC_CANONICAL_ORIGIN', value)
      expect(canonicalOrigin(), JSON.stringify(value)).toBe(RUNTIME)
    }
  })

  it('does not normalise the runtime origin, which never carries a trailing slash', () => {
    withRuntimeOrigin(RUNTIME)
    expect(canonicalOrigin()).toBe(RUNTIME)
  })
})

describe('normaliseConfiguredOrigin — the definition the build guards share', () => {
  // `next.config.ts` fails a CAPACITOR_BUILD=1 build when the origin is unset
  // and a web build when it is set. Those guards are only fail-closed while
  // "set" means to them exactly what it means to `canonicalOrigin()`, and this
  // is the assertion that keeps that true — a divergence is not a style
  // difference, it is a bundle whose links are `https://localhost`.
  //
  // Twice measured, twice the same defect one value narrower: `" "` escaped a
  // raw-truthiness guard, then `"/"` escaped a `.trim()` one. Both built and
  // shipped clean. A third spelling would be a third escape, so both callers
  // ask this function instead.
  it.each([undefined, '', '   ', '/', '//', '  //  '])('treats %j as not configured', (value) => {
    expect(normaliseConfiguredOrigin(value)).toBe('')
    // The property that matters is the *pair*: the guard sees falsy and the
    // consumer falls back, for the same input.
    withRuntimeOrigin(RUNTIME)
    if (value === undefined) vi.stubEnv('NEXT_PUBLIC_CANONICAL_ORIGIN', '')
    else vi.stubEnv('NEXT_PUBLIC_CANONICAL_ORIGIN', value)
    expect(canonicalOrigin()).toBe(RUNTIME)
  })

  it.each([
    ['https://app.letsride.social', 'https://app.letsride.social'],
    ['https://app.letsride.social/', 'https://app.letsride.social'],
    ['  https://app.letsride.social//  ', 'https://app.letsride.social'],
  ])('treats %j as configured, as %j', (value, expected) => {
    expect(normaliseConfiguredOrigin(value)).toBe(expected)
    withRuntimeOrigin('https://localhost')
    vi.stubEnv('NEXT_PUBLIC_CANONICAL_ORIGIN', value)
    expect(canonicalOrigin()).toBe(expected)
  })
})
