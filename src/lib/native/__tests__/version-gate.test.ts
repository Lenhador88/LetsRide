import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The native minimum-version gate — `src/lib/native/version-gate.ts`.
 *
 * Nothing here proves a rider is stopped; that needs a bundle on a device.
 * What it proves is everything around the decision, which is where this module
 * can be wrong in a way that matters:
 *
 *   1. **It fails open on every failure.** Offline, a 404, malformed JSON, a
 *      `minimum` in a shape this repo does not define — all of them let the app
 *      through. A gate that fails closed strands a rider in a valley.
 *   2. **It reads the deployed copy, not the one inside the bundle.** `public/`
 *      is emitted into the export too, so a relative fetch would be answered by
 *      Capacitor's own local server with a file that can never disagree.
 *   3. **It never runs on the web**, where the newest bundle arrives on the next
 *      load anyway and a gate could only lock people out of a working
 *      deployment.
 *   4. **One check per launch**, not one per navigation — PD-111's lesson.
 */

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform: vi.fn<() => string>(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform, getPlatform: mocks.getPlatform },
}))

import {
  ANDROID_APP_ID,
  MINIMUM_VERSION_PATH,
  checkForcedUpdate,
  readMinimumVersion,
  resetVersionGateForTests,
  resolveStoreAffordance,
} from '@/lib/native/version-gate'
import { APP_VERSION } from '@/lib/version'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

const ORIGIN = 'https://app.letsride.social'

const globals = globalThis as { window?: { location: { origin: string } } }

/** A `fetch` that answers the manifest with `body`, however malformed. */
function respondWith(body: unknown, { ok = true }: { ok?: boolean } = {}) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch
}

beforeEach(() => {
  resetVersionGateForTests()
  vi.clearAllMocks()
  // `canonicalOrigin()` falls back to the runtime origin, since a *web* build
  // refuses NEXT_PUBLIC_CANONICAL_ORIGIN and the test env is one.
  globals.window = { location: { origin: ORIGIN } }
})

afterEach(() => {
  delete globals.window
  vi.unstubAllGlobals()
})

describe('readMinimumVersion', () => {
  it('reads the minimum out of the published shape', () => {
    expect(readMinimumVersion({ minimum: '1.2.0' })).toBe('1.2.0')
  })

  it.each([
    ['an empty object', {}],
    ['null', null],
    ['a bare string', '1.2.0'],
    ['an array', ['1.2.0']],
    ['a numeric minimum', { minimum: 3 }],
    ['a nested minimum', { minimum: { version: '1.2.0' } }],
  ])('answers null for %s', (_label, payload) => {
    expect(readMinimumVersion(payload)).toBeNull()
  })
})

describe('resolveStoreAffordance', () => {
  it('deep-links Play on Android', () => {
    expect(resolveStoreAffordance('android')).toEqual({
      kind: 'store-link',
      url: `market://details?id=${ANDROID_APP_ID}`,
      label: 'Open Google Play',
    })
  })

  it('offers instructions and no dead button on iOS until PD-232 fills the id', () => {
    expect(resolveStoreAffordance('ios')).toEqual({ kind: 'instructions' })
  })

  it('deep-links the App Store once the numeric id exists', () => {
    // The branch PD-232 turns on. Parameterised so its one-line change lands on
    // a path something has executed.
    expect(resolveStoreAffordance('ios', '1234567890')).toEqual({
      kind: 'store-link',
      url: 'itms-apps://itunes.apple.com/app/id1234567890',
      label: 'Open the App Store',
    })
  })

  it('offers instructions for any other platform', () => {
    expect(resolveStoreAffordance('web')).toEqual({ kind: 'instructions' })
  })

  it('uses the bundle id capacitor.config.ts declares', () => {
    // A mismatch opens Play on "app not found", and nothing else in this
    // container would notice — the two strings live in different files and no
    // build reads both.
    const config = readFileSync(path.join(ROOT, 'capacitor.config.ts'), 'utf8')
    const declared = /^\s*appId:\s*'([^']+)'/m.exec(config)

    expect(declared?.[1]).toBe(ANDROID_APP_ID)
  })
})

describe('checkForcedUpdate', () => {
  it('never asks on the web, where the next load is already the newest build', async () => {
    mocks.isNativePlatform.mockReturnValue(false)
    const fetchMock = respondWith({ minimum: '99.0.0' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(checkForcedUpdate()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks a build below the published minimum', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    vi.stubGlobal('fetch', respondWith({ minimum: '99.0.0' }))

    await expect(checkForcedUpdate()).resolves.toBe(true)
  })

  it('lets the current build through against its own version', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    vi.stubGlobal('fetch', respondWith({ minimum: APP_VERSION }))

    await expect(checkForcedUpdate()).resolves.toBe(false)
  })

  it('reads the deployed copy at an absolute origin, uncached and time-bounded', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    const fetchMock = respondWith({ minimum: '0.0.1' })
    vi.stubGlobal('fetch', fetchMock)

    await checkForcedUpdate()

    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]
    // Absolute: a relative path is served out of the bundle's own copy of
    // public/, which agrees with itself by construction.
    expect(url).toBe(`${ORIGIN}${MINIMUM_VERSION_PATH}`)
    expect(init.cache).toBe('no-store')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['a 404', () => respondWith({}, { ok: false })],
    ['malformed JSON', () => vi.fn(async () => ({ ok: true, json: async () => JSON.parse('{') }))],
    ['a network failure', () => vi.fn(async () => Promise.reject(new Error('offline')))],
    ['a missing minimum', () => respondWith({})],
    ['an unparseable minimum', () => respondWith({ minimum: 'latest' })],
  ])('fails open on %s', async (_label, makeFetch) => {
    mocks.isNativePlatform.mockReturnValue(true)
    vi.stubGlobal('fetch', makeFetch())

    await expect(checkForcedUpdate()).resolves.toBe(false)
  })

  it('fails open when the platform check itself throws', async () => {
    mocks.isNativePlatform.mockImplementation(() => {
      throw new Error('no bridge')
    })
    vi.stubGlobal('fetch', respondWith({ minimum: '99.0.0' }))

    await expect(checkForcedUpdate()).resolves.toBe(false)
  })

  it('asks once per launch, however many times it is called', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    const fetchMock = respondWith({ minimum: '99.0.0' })
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([checkForcedUpdate(), checkForcedUpdate()])
    await checkForcedUpdate()

    expect(first).toBe(true)
    expect(second).toBe(true)
    // Including the concurrent pair: the memo holds the promise, not the
    // settled answer, so two mounts in the same tick still make one request.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches a failed check too, rather than retrying on the next call', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    const fetchMock = vi.fn(async () => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', fetchMock)

    await checkForcedUpdate()
    await checkForcedUpdate()

    // Deliberate, and the opposite of `secure-store.ts`'s cleared promise slot:
    // the answer being retried for is "do not block", and retrying is exactly
    // the per-navigation fetch this gate exists to avoid.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
