import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INSTALLATION_ID_KEY,
  installationId,
  resetInstallationIdForTests,
} from '@/lib/push/installation'
import { resetSessionStoreForTests, type SessionStore } from '@/lib/supabase/session-store'

/**
 * `installationId()` — the stable name a device has, and the value `078`'s
 * `unique (installation_id)` is keyed on.
 *
 * The suite runs in `node`, so `window` is faked exactly as
 * `session-store.test.ts` fakes it: only the storage methods are read.
 */

const globals = globalThis as unknown as {
  window?: { localStorage: Storage; __letsrideSecureStore?: SessionStore }
}

function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    store: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      keys: () => [...map.keys()],
    } satisfies SessionStore,
  }
}

function install(seed: Record<string, string> = {}) {
  const backing = memoryStore(seed)
  globals.window = {
    localStorage: undefined as unknown as Storage,
    __letsrideSecureStore: backing.store,
  }
  return backing
}

beforeEach(() => {
  resetSessionStoreForTests()
  resetInstallationIdForTests()
})

afterEach(() => {
  resetSessionStoreForTests()
  resetInstallationIdForTests()
  delete globals.window
  vi.restoreAllMocks()
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('installationId', () => {
  it('mints a lowercase hex UUID and persists it', async () => {
    // The shape is `078`'s `push_devices_installation_id_shape` CHECK, not a
    // preference: a value failing it is refused by `register_push_device`, so
    // a generator change here breaks registration with nothing else red.
    const backing = install()

    const id = await installationId()

    expect(id).toMatch(UUID)
    expect(backing.map.get(INSTALLATION_ID_KEY)).toBe(id)
  })

  it('returns the same value on a second call', async () => {
    // The property `078`'s upsert depends on. Two ids for one device is two
    // rows for one device, and "one row per install" stops being true.
    install()

    expect(await installationId()).toBe(await installationId())
  })

  it('does not mint twice when two callers race on first launch', async () => {
    // The boot registration and a rider tapping the priming row can both reach
    // this in the same tick. Without the shared promise each mints its own id
    // and the second write wins, leaving a `push_devices` row nothing will ever
    // release.
    install()
    const mint = vi.spyOn(crypto, 'randomUUID')

    const [a, b] = await Promise.all([installationId(), installationId()])

    expect(a).toBe(b)
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('reads back an id an earlier app session stored', async () => {
    const stored = '0189d3a1-2b4c-4d6e-8f01-23456789abcd'
    install({ [INSTALLATION_ID_KEY]: stored })

    expect(await installationId()).toBe(stored)
  })

  it('replaces a stored value that would fail the database CHECK', async () => {
    // A malformed id can only come from a hand-edited store or a changed
    // generator, and both want the same answer: the CHECK would refuse it at
    // `register_push_device`, so a device holding one could never register.
    // Minting once is strictly better than never registering.
    const backing = install({ [INSTALLATION_ID_KEY]: 'NOT-A-UUID' })

    const id = await installationId()

    expect(id).toMatch(UUID)
    expect(backing.map.get(INSTALLATION_ID_KEY)).toBe(id)
  })

  it('does not cache a failure, so a transient store error is retryable', async () => {
    // `secure-store.ts`'s `configure()` lesson, one module along: caching a
    // rejected promise turns one keychain blip into a permanently
    // unregisterable device with no way back short of an app restart.
    const backing = install()
    const failing = vi
      .spyOn(backing.store, 'getItem')
      .mockRejectedValueOnce(new Error('keychain unavailable'))

    await expect(installationId()).rejects.toThrow('keychain unavailable')

    failing.mockRestore()
    await expect(installationId()).resolves.toMatch(UUID)
  })
})
