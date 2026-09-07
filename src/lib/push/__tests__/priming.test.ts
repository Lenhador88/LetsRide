import { describe, expect, it } from 'vitest'
import { pushPrimingState } from '@/lib/push/priming'

/**
 * Every state of `pushPrimingState`, including the two the location precedent
 * has no analogue for — a non-native platform, and `stalled`.
 *
 * Each case names the trap it avoids rather than restating the branch, per
 * `guard.test.ts`'s convention: a test whose name is the code it tests fails
 * without telling anyone what broke.
 */
describe('pushPrimingState', () => {
  it('draws nothing on the web, before the permission is even read', () => {
    // The trap: reading the permission first. A browser's Notification API
    // would answer, and it answers about Web Push — a channel this app
    // deliberately does not use (no service worker, no manifest). A row here
    // offers something nothing could honour.
    expect(pushPrimingState({ isNative: false, permission: 'prompt', hasToken: false })).toBe(
      'hidden',
    )
    expect(pushPrimingState({ isNative: false, permission: 'denied', hasToken: undefined })).toBe(
      'hidden',
    )
    expect(pushPrimingState({ isNative: false, permission: 'granted', hasToken: false })).toBe(
      'hidden',
    )
  })

  it('draws nothing while the permission read is still in flight', () => {
    // The trap: guessing. The guess is wrong for exactly the rider who granted
    // months ago, who would watch an offer to enable it appear and vanish.
    expect(pushPrimingState({ isNative: true, permission: undefined, hasToken: undefined })).toBe(
      'hidden',
    )
    expect(pushPrimingState({ isNative: true, permission: undefined, hasToken: false })).toBe(
      'hidden',
    )
  })

  it('offers the ask when the dialog is still available', () => {
    expect(pushPrimingState({ isNative: true, permission: 'prompt', hasToken: undefined })).toBe(
      'ask',
    )
  })

  it('draws the denied copy once the OS has refused', () => {
    expect(pushPrimingState({ isNative: true, permission: 'denied', hasToken: undefined })).toBe(
      'blocked',
    )
    // A refusal is a refusal whatever the token state says — there is no token
    // to have, and `hasToken: false` must not divert this to `stalled`.
    expect(pushPrimingState({ isNative: true, permission: 'denied', hasToken: false })).toBe(
      'blocked',
    )
  })

  it('draws nothing once granted and a token has arrived', () => {
    expect(pushPrimingState({ isNative: true, permission: 'granted', hasToken: true })).toBe(
      'hidden',
    )
  })

  it('does NOT claim stalled while registration is still in flight', () => {
    // The trap this exists for: treating `undefined` as `false`. `stalled` is
    // an accusation that the build is misprovisioned, and made too early it
    // fires on every single launch in the gap between reading the grant and
    // the provider answering.
    expect(pushPrimingState({ isNative: true, permission: 'granted', hasToken: undefined })).toBe(
      'hidden',
    )
  })

  it('reports stalled when permission is granted and no token ever came', () => {
    // The state with no location analogue. Geolocation answers a grant with a
    // position or an error; APNs and FCM answer with neither when an app is
    // misprovisioned — `didRegister` simply never fires. Without this the
    // device reads as fully set up and the rider never receives anything.
    expect(pushPrimingState({ isNative: true, permission: 'granted', hasToken: false })).toBe(
      'stalled',
    )
  })
})
