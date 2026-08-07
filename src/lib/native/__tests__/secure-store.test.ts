import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The native half of the session-store seam — `src/lib/native/secure-store.ts`.
 *
 * Nothing here proves the keychain works; that needs a device and is explicitly
 * out of reach in this container. What it does prove is everything *around* the
 * plugin call, which is where this module can actually be wrong:
 *
 *   1. The browser build is left alone, so `describeSessionStore()` keeps naming
 *      the weaker store instead of a build silently claiming to be secure.
 *   2. The two overridden defaults are applied **before the first read**, not
 *      merely somewhere. `whenUnlocked` — the plugin's default — both blocks a
 *      background token refresh after a reboot and migrates the token to a
 *      replacement device through an encrypted backup.
 *   3. `keys()` is forwarded, which is what lets sign-out clear a session
 *      written before a reload.
 */

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  SecureStorage: {
    setSynchronize: vi.fn(async () => {}),
    setDefaultKeychainAccess: vi.fn(async () => {}),
    getItem: vi.fn(async () => null as string | null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
    keys: vi.fn(async () => [] as string[]),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: mocks.SecureStorage,
  KeychainAccess: {
    whenUnlocked: 0,
    whenUnlockedThisDeviceOnly: 1,
    afterFirstUnlock: 2,
    afterFirstUnlockThisDeviceOnly: 3,
    whenPasscodeSetThisDeviceOnly: 4,
  },
}))

import { installSecureStore, resetSecureStoreConfigForTests } from '@/lib/native/secure-store'
import type { SessionStore } from '@/lib/supabase/session-store'

const globals = globalThis as { window?: { __letsrideSecureStore?: SessionStore } }

/** The value `KeychainAccess.afterFirstUnlockThisDeviceOnly` carries above. */
const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 3

beforeEach(() => {
  resetSecureStoreConfigForTests()
  vi.clearAllMocks()
  globals.window = {}
})

afterEach(() => {
  delete globals.window
})

describe('when it installs', () => {
  it('does nothing in a plain browser, leaving the named localStorage fallback', () => {
    mocks.isNativePlatform.mockReturnValue(false)

    installSecureStore()

    expect(globals.window!.__letsrideSecureStore).toBeUndefined()
  })

  it('does nothing during the SSR pass, where there is no window', () => {
    mocks.isNativePlatform.mockReturnValue(true)
    delete globals.window

    // `output: 'export'` still runs this pass at build time, so it is reached on
    // every build rather than only on a server.
    expect(() => installSecureStore()).not.toThrow()
  })

  it('installs the store on a native platform', () => {
    mocks.isNativePlatform.mockReturnValue(true)

    installSecureStore()

    expect(globals.window!.__letsrideSecureStore).toBeDefined()
  })

  it('does not replace a store that is already there', () => {
    mocks.isNativePlatform.mockReturnValue(true)
    const existing = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    globals.window!.__letsrideSecureStore = existing

    installSecureStore()

    expect(globals.window!.__letsrideSecureStore).toBe(existing)
  })
})

describe('the store it installs', () => {
  function install(): SessionStore {
    mocks.isNativePlatform.mockReturnValue(true)
    installSecureStore()
    return globals.window!.__letsrideSecureStore!
  }

  it('pins the keychain access class before the first read completes', async () => {
    const store = install()

    await store.getItem('sb-ref-auth-token')

    expect(mocks.SecureStorage.setDefaultKeychainAccess).toHaveBeenCalledWith(
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
    )
    // Ordering, not just occurrence: configuring after the first read would
    // write the first token under the plugin's default class and leave it there.
    expect(
      mocks.SecureStorage.setDefaultKeychainAccess.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.SecureStorage.getItem.mock.invocationCallOrder[0])
  })

  it('turns iCloud keychain sync off explicitly', async () => {
    const store = install()

    await store.setItem('sb-ref-auth-token', 'the-session')

    // Already the plugin's default, asserted because it is a security-relevant
    // default a minor version could change: syncing replicates the refresh token
    // to every device on the rider's Apple ID.
    expect(mocks.SecureStorage.setSynchronize).toHaveBeenCalledWith(false)
  })

  it('configures once, not per call', async () => {
    const store = install()

    await store.getItem('a')
    await store.setItem('b', 'c')
    await store.removeItem('b')

    expect(mocks.SecureStorage.setDefaultKeychainAccess).toHaveBeenCalledTimes(1)
  })

  it('forwards keys(), which is what makes sign-out provable', async () => {
    mocks.SecureStorage.keys.mockResolvedValue(['sb-ref-auth-token'])
    const store = install()

    await expect(store.keys!()).resolves.toEqual(['sb-ref-auth-token'])
  })

  it('resolves a failed read to null rather than throwing', async () => {
    // The route guard reads the session from a `.then()` with no `.catch()`, and
    // auth-js's `__loadSession` has no catch either — so a rejecting read does
    // not sign the rider out, it hangs the splash forever with no way past it.
    // `null` is what auth-js reads as "no session", which is the intended
    // failure and the one a draft of this module wrongly assumed it already got.
    mocks.SecureStorage.getItem.mockRejectedValue(new Error('keychain unavailable'))
    const store = install()

    await expect(store.getItem('sb-ref-auth-token')).resolves.toBeNull()
  })

  it('retries configuration after a failure instead of caching the rejection', async () => {
    // `configured ??= applyPluginDefaults()` caches a *rejected* promise, so one
    // transient failure would break every read and write for the rest of the app
    // session with no way back short of a restart.
    mocks.SecureStorage.setSynchronize.mockRejectedValueOnce(new Error('transient'))
    const store = install()

    await store.setItem('a', 'b')
    expect(mocks.SecureStorage.setSynchronize).toHaveBeenCalledTimes(1)

    await store.setItem('c', 'd')
    expect(mocks.SecureStorage.setSynchronize).toHaveBeenCalledTimes(2)
    expect(mocks.SecureStorage.setDefaultKeychainAccess).toHaveBeenCalledWith(
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
    )
  })

  it('still stores when the defaults cannot be applied', async () => {
    // Taking storage down over a keychain *attribute* would be the wrong trade,
    // and the attribute that changes behaviour cannot fail on its own —
    // `setSynchronize` assigns `this.sync` before dispatching to the bridge.
    mocks.SecureStorage.setSynchronize.mockRejectedValue(new Error('nope'))
    const store = install()

    await expect(store.setItem('sb-ref-auth-token', 'the-session')).resolves.toBeUndefined()
    expect(mocks.SecureStorage.setItem).toHaveBeenCalledWith('sb-ref-auth-token', 'the-session')
  })

  it('reads and writes through to the plugin', async () => {
    mocks.SecureStorage.getItem.mockResolvedValue('the-session')
    const store = install()

    await expect(store.getItem('sb-ref-auth-token')).resolves.toBe('the-session')
    await store.setItem('sb-ref-auth-token', 'next')
    expect(mocks.SecureStorage.setItem).toHaveBeenCalledWith('sb-ref-auth-token', 'next')
    await store.removeItem('sb-ref-auth-token')
    expect(mocks.SecureStorage.removeItem).toHaveBeenCalledWith('sb-ref-auth-token')
  })
})
