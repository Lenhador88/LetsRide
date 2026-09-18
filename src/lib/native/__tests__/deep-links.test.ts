import { describe, expect, it } from 'vitest'
import { deepLinkTarget } from '@/lib/native/deep-links'

/**
 * The decision half of PD-205, which is the only half a container without a
 * device can assert at all.
 *
 * The origin is injected rather than read from the environment so these cases
 * exercise the comparison itself. In the app it is always `canonicalOrigin()`,
 * which a native bundle refuses to build without (`next.config.ts`).
 */
const ORIGIN = 'https://app.letsride.social'

describe('deepLinkTarget', () => {
  const ID = '11111111-2222-3333-4444-555555555555'

  it('carries a link on our own origin through as a path', () => {
    expect(deepLinkTarget(`${ORIGIN}/rides/detail?id=${ID}`, ORIGIN)).toBe(
      `/rides/detail?id=${ID}`
    )
    expect(deepLinkTarget(`${ORIGIN}/clubs/explore`, ORIGIN)).toBe('/clubs/explore')
    expect(deepLinkTarget(`${ORIGIN}/`, ORIGIN)).toBe('/')
  })

  it('keeps the query and the fragment, because the credential lives in them', () => {
    // The confirmation link the email template hands out — `/auth/confirm`
    // reads `token_hash` and `type` off the query, so dropping it would open
    // the app on a screen that cannot do its job.
    expect(deepLinkTarget(`${ORIGIN}/auth/confirm?token_hash=abc&type=signup`, ORIGIN)).toBe(
      '/auth/confirm?token_hash=abc&type=signup'
    )
    // GoTrue puts a recovery error in the fragment, and nothing reads it if it
    // is dropped here.
    expect(deepLinkTarget(`${ORIGIN}/auth/callback#error=expired`, ORIGIN)).toBe(
      '/auth/callback#error=expired'
    )
  })

  /**
   * The negative cases are the point of this function. A deep link is somebody
   * else's input — a link in a message, a page, another app — and the event it
   * arrives on is not exclusive to universal links.
   */
  it('ignores every origin that is not ours', () => {
    // A plain-HTTP downgrade of our own host. `URL.origin` compares the scheme,
    // which is why this is caught and a hostname comparison would not be.
    expect(deepLinkTarget('http://app.letsride.social/rides/detail', ORIGIN)).toBeNull()
    // A suffix that reads as ours at a glance.
    expect(deepLinkTarget('https://app.letsride.social.evil.com/rides', ORIGIN)).toBeNull()
    expect(deepLinkTarget('https://evil.com/rides/detail', ORIGIN)).toBeNull()
    // DEV is a different host, deliberately not in the entitlement.
    expect(deepLinkTarget('https://app-dev.letsride.social/rides', ORIGIN)).toBeNull()
    // The webview's own origin, and a custom scheme — `appUrlOpen` fires for
    // these too.
    expect(deepLinkTarget('https://localhost/rides/detail', ORIGIN)).toBeNull()
    expect(deepLinkTarget('capacitor://localhost/rides/detail', ORIGIN)).toBeNull()
    expect(deepLinkTarget('social.letsride.app://rides/detail', ORIGIN)).toBeNull()
  })

  /**
   * **The origin check alone is not enough, and this is the case that proves
   * it.** `https://app.letsride.social//evil.com/x` has our origin *exactly* —
   * it is a genuine link on the trusted host, so every assertion above passes
   * it. Its pathname is `//evil.com/x`, and Next reads a protocol-relative path
   * as an EXTERNAL url: `router.replace` becomes
   * `location.replace('https://evil.com/x')` and the webview leaves the app,
   * with no address bar to show the rider where they went.
   *
   * `safeNext` is what refuses it, which is why the function ends by asking it
   * rather than returning the path it built.
   */
  it('refuses a protocol-relative path, which has our origin and is not ours', () => {
    expect(deepLinkTarget(`${ORIGIN}//evil.com/x`, ORIGIN)).toBeNull()
    expect(deepLinkTarget(`${ORIGIN}//evil.com`, ORIGIN)).toBeNull()
    // The backslash form is the same case, and it is caught by the same `//`
    // check rather than by the control-character one: WHATWG path parsing folds
    // `\` to `/` for a special scheme, so `/\evil.com/x` becomes
    // `///evil.com/x` before the guard ever sees it.
    expect(deepLinkTarget(`${ORIGIN}/\\evil.com/x`, ORIGIN)).toBeNull()
    // And the guard is verified the other way: an ordinary path still passes.
    expect(deepLinkTarget(`${ORIGIN}/rides/detail?id=${ID}`, ORIGIN)).toBe(
      `/rides/detail?id=${ID}`
    )
  })

  it('ignores a URL it cannot parse rather than throwing', () => {
    expect(deepLinkTarget('', ORIGIN)).toBeNull()
    expect(deepLinkTarget('not a url', ORIGIN)).toBeNull()
    expect(deepLinkTarget('/rides/detail', ORIGIN)).toBeNull()
  })

  it('matches our origin case-insensitively in the host, as URL parsing does', () => {
    expect(deepLinkTarget('https://APP.LetsRide.social/postcards', ORIGIN)).toBe('/postcards')
  })

  /**
   * The case that makes this mapping necessary rather than tidy: without it,
   * serving `apple-app-site-association` would take a legacy link that works
   * today in Safari and send it into a bundle that never prerendered the path.
   */
  it('maps a legacy link, which on the web only works because a server redirects it', () => {
    expect(deepLinkTarget(`${ORIGIN}/postcards/${ID}`, ORIGIN)).toBe(
      `/postcards/detail?id=${ID}`
    )
    expect(deepLinkTarget(`${ORIGIN}/clubs/${ID}/members`, ORIGIN)).toBe(
      `/clubs/detail/members?id=${ID}`
    )
    expect(deepLinkTarget(`${ORIGIN}/rides/${ID}/chat`, ORIGIN)).toBe(`/rides/detail?id=${ID}`)
  })

  it('does not rewrite a live route that resembles a legacy one', () => {
    expect(deepLinkTarget(`${ORIGIN}/rides/new`, ORIGIN)).toBe('/rides/new')
    expect(deepLinkTarget(`${ORIGIN}/clubs/explore`, ORIGIN)).toBe('/clubs/explore')
    expect(deepLinkTarget(`${ORIGIN}/rides/detail?id=${ID}`, ORIGIN)).toBe(
      `/rides/detail?id=${ID}`
    )
  })
})
