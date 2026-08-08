import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `resolveRiderLocation` / `requestDeviceLocation` — the fallback chain
 * behind `searchPlaces`'s proximity bias.
 *
 * The suite runs in `node` (see `vitest.config.ts`), so both `document` and
 * `navigator` are faked. `document` is simply absent by default in Node, the
 * same as `guard-cache.test.ts` relies on; `navigator` is NOT absent — Node
 * 22 ships a real (if geolocation-less) `navigator` with only a getter, so it
 * has to be overridden with `Object.defineProperty` rather than a plain
 * assignment, which throws.
 */

const getMyLocationText = vi.fn()
const getLocalityCentroid = vi.fn()

vi.mock('@/lib/data/profile', () => ({ getMyLocationText: (...args: unknown[]) => getMyLocationText(...args) }))
vi.mock('@/lib/data/places', () => ({ getLocalityCentroid: (...args: unknown[]) => getLocalityCentroid(...args) }))

const {
  resolveRiderLocation,
  requestDeviceLocation,
  clearRiderLocation,
  resetRiderLocationCacheForTests,
} = await import('@/lib/location/rider-location')

const globals = globalThis as { document?: unknown }
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

function installNavigator(nav: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })
}

function restoreNavigator(): void {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else delete (globalThis as { navigator?: unknown }).navigator
}

type GeoOutcome =
  | { kind: 'success'; lat: number; lon: number }
  | { kind: 'error' }
  | { kind: 'hang' }

function fakeGeolocation(outcome: GeoOutcome) {
  return {
    getCurrentPosition: vi.fn(
      (onSuccess: (p: unknown) => void, onError: (e: unknown) => void) => {
        if (outcome.kind === 'success') {
          onSuccess({ coords: { latitude: outcome.lat, longitude: outcome.lon }, timestamp: Date.now() })
        } else if (outcome.kind === 'error') {
          onError({ code: 1, message: 'User denied Geolocation' })
        }
        // 'hang': never calls either callback — the case the timeout guard exists for.
      }
    ),
  }
}

/**
 * A geolocation fake that does not call back until the test tells it to —
 * standing in for a real OS permission dialog, which does not resolve the
 * moment `getCurrentPosition` is called but whenever the rider answers it.
 */
function manualGeolocation() {
  let deliver: (() => void) | undefined
  return {
    getCurrentPosition: vi.fn((onSuccess: (p: unknown) => void) => {
      deliver = () => onSuccess({ coords: { latitude: 52.09, longitude: 5.12 }, timestamp: Date.now() })
    }),
    respondWithSuccess: () => deliver?.(),
  }
}

function nav(opts: {
  geolocation?: { getCurrentPosition: unknown } | null
  permission?: PermissionState | 'unsupported' | 'throws'
}) {
  const { geolocation = null, permission } = opts
  return {
    geolocation: geolocation ?? undefined,
    permissions:
      permission === undefined || permission === 'unsupported'
        ? undefined
        : permission === 'throws'
          ? { query: vi.fn(() => { throw new Error('descriptor not supported') }) }
          : { query: vi.fn(async () => ({ state: permission })) },
  }
}

beforeEach(() => {
  globals.document = {}
  getMyLocationText.mockReset()
  getLocalityCentroid.mockReset()
  resetRiderLocationCacheForTests()
  installNavigator(nav({}))
})

afterEach(() => {
  delete globals.document
  restoreNavigator()
  vi.useRealTimers()
})

describe('during a server render', () => {
  it('resolveRiderLocation refuses, loudly, rather than reading an anonymous device', () => {
    delete globals.document
    expect(() => resolveRiderLocation()).toThrow(/effect or an event handler/)
  })

  it('requestDeviceLocation refuses too', async () => {
    // Declared `async`, so the throw surfaces as a rejection rather than a
    // synchronous throw — unlike `resolveRiderLocation`, which is not.
    delete globals.document
    await expect(requestDeviceLocation()).rejects.toThrow(/effect or an event handler/)
  })
})

describe('the silent device source', () => {
  it('never prompts: a "prompt" permission state falls through without asking', async () => {
    const geolocation = fakeGeolocation({ kind: 'success', lat: 1, lon: 2 })
    installNavigator(nav({ geolocation, permission: 'prompt' }))
    getMyLocationText.mockResolvedValue(null)

    const result = await resolveRiderLocation()

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('never prompts on "denied" either', async () => {
    const geolocation = fakeGeolocation({ kind: 'success', lat: 1, lon: 2 })
    installNavigator(nav({ geolocation, permission: 'denied' }))
    getMyLocationText.mockResolvedValue(null)

    await resolveRiderLocation()

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('reads silently when permission is already granted', async () => {
    const geolocation = fakeGeolocation({ kind: 'success', lat: 52.09, lon: 5.12 })
    installNavigator(nav({ geolocation, permission: 'granted' }))

    const result = await resolveRiderLocation()

    expect(result).toEqual({ lat: 52.09, lon: 5.12, source: 'device' })
    expect(getMyLocationText).not.toHaveBeenCalled()
  })

  it('treats a device with no Permissions API the same as "prompt" — never assumes consent', async () => {
    const geolocation = fakeGeolocation({ kind: 'success', lat: 1, lon: 2 })
    installNavigator(nav({ geolocation, permission: 'unsupported' }))
    getMyLocationText.mockResolvedValue(null)

    await resolveRiderLocation()

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('treats a Permissions API that throws the same way', async () => {
    const geolocation = fakeGeolocation({ kind: 'success', lat: 1, lon: 2 })
    installNavigator(nav({ geolocation, permission: 'throws' }))
    getMyLocationText.mockResolvedValue(null)

    await resolveRiderLocation()

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('falls through to the next source when the granted read itself fails', async () => {
    const geolocation = fakeGeolocation({ kind: 'error' })
    installNavigator(nav({ geolocation, permission: 'granted' }))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    const result = await resolveRiderLocation()

    expect(result).toEqual({ lat: 52.09, lon: 5.12, source: 'profile' })
  })

  it('a hanging GPS fix never blocks the search past its own timeout', async () => {
    vi.useFakeTimers()
    const geolocation = fakeGeolocation({ kind: 'hang' })
    installNavigator(nav({ geolocation, permission: 'granted' }))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    const pending = resolveRiderLocation()
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await pending

    expect(result).toEqual({ lat: 52.09, lon: 5.12, source: 'profile' })
  })
})

describe('the profile fallback', () => {
  beforeEach(() => {
    installNavigator(nav({})) // no geolocation at all — every case here goes straight to profile
  })

  it('resolves to null when the rider set no onboarding location', async () => {
    getMyLocationText.mockResolvedValue(null)

    await expect(resolveRiderLocation()).resolves.toBeNull()
    expect(getLocalityCentroid).not.toHaveBeenCalled()
  })

  it('resolves to null when the location text does not geocode', async () => {
    getMyLocationText.mockResolvedValue('Nowhereville')
    getLocalityCentroid.mockResolvedValue(null)

    await expect(resolveRiderLocation()).resolves.toBeNull()
  })

  it('resolves the geocoded centroid, tagged with its source', async () => {
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    await expect(resolveRiderLocation()).resolves.toEqual({ lat: 52.09, lon: 5.12, source: 'profile' })
  })

  it('degrades to null rather than throwing when locality_centroid has not shipped yet', async () => {
    // `getLocalityCentroid` itself already degrades RPC errors to null (see
    // places.test.ts) — this asserts the resolver does not add a second,
    // throwing path on top of that.
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue(null)

    await expect(resolveRiderLocation()).resolves.toBeNull()
  })
})

describe('caching for the page load', () => {
  it('resolves the chain once and reuses the answer', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    await resolveRiderLocation()
    await resolveRiderLocation()
    await resolveRiderLocation()

    expect(getMyLocationText).toHaveBeenCalledTimes(1)
  })

  it('joins an in-flight resolution rather than starting a second one', async () => {
    installNavigator(nav({}))
    let resolveText: (v: string | null) => void = () => {}
    getMyLocationText.mockReturnValue(new Promise((resolve) => { resolveText = resolve }))
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    const first = resolveRiderLocation()
    const second = resolveRiderLocation()
    resolveText('Utrecht')

    expect(await first).toEqual(await second)
    expect(getMyLocationText).toHaveBeenCalledTimes(1)
  })

  it('resetRiderLocationCacheForTests forces a fresh resolution', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    await resolveRiderLocation()
    resetRiderLocationCacheForTests()
    await resolveRiderLocation()

    expect(getMyLocationText).toHaveBeenCalledTimes(2)
  })

  /**
   * A failed attempt must not harden into a page-load-long verdict —
   * `guard-cache.ts`'s own rule, and the defect reviewer found: a
   * `getMyLocationText` rejection (a real PostgREST failure, via `unwrap`)
   * used to be memoised forever by `cachedLocation ??= resolveChain()`, so
   * one mobile network blip lost the search bias for the rest of the page
   * load. The public contract still never rejects — the caller sees `null`
   * — but the very next call must retry rather than repeat that `null`.
   */
  it('does not memoise a failed attempt — the next call retries instead of repeating null forever', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockRejectedValueOnce(new Error('network blip'))
    getMyLocationText.mockResolvedValueOnce('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    await expect(resolveRiderLocation()).resolves.toBeNull()
    await expect(resolveRiderLocation()).resolves.toEqual({ lat: 52.09, lon: 5.12, source: 'profile' })

    expect(getMyLocationText).toHaveBeenCalledTimes(2)
  })

  it('never lets a failed attempt reject the caller — it degrades to null like every other empty answer', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockRejectedValue(new Error('network blip'))

    await expect(resolveRiderLocation()).resolves.toBeNull()
  })

  /**
   * The TTL fix: "for the page load" is the app's whole lifetime in a
   * Capacitor WebView, which can live for hours. `GEOLOCATION_MAX_AGE_MS` is
   * reused as the memo's own TTL so a rider who has actually moved gets a
   * fresh bias rather than keeping their opening city forever.
   */
  it('expires the memo after GEOLOCATION_MAX_AGE_MS — a rider who has moved gets a fresh bias', async () => {
    vi.useFakeTimers()
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    await resolveRiderLocation()
    expect(getMyLocationText).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
    await resolveRiderLocation()

    expect(getMyLocationText).toHaveBeenCalledTimes(2)
  })

  it('does not re-resolve before the TTL has elapsed', async () => {
    vi.useFakeTimers()
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    await resolveRiderLocation()
    await vi.advanceTimersByTimeAsync(60_000)
    await resolveRiderLocation()

    expect(getMyLocationText).toHaveBeenCalledTimes(1)
  })

  it('a fresh explicit device fix resets the TTL too', async () => {
    vi.useFakeTimers()
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 1, lon: 1 })
    await resolveRiderLocation()

    const geolocation = fakeGeolocation({ kind: 'success', lat: 52.09, lon: 5.12 })
    installNavigator(nav({ geolocation, permission: 'granted' }))
    await requestDeviceLocation()

    // Just under the TTL measured from the device fix, well past it measured
    // from the original profile resolution — proves the timestamp moved.
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    await expect(resolveRiderLocation()).resolves.toEqual({ lat: 52.09, lon: 5.12, source: 'device' })
    expect(getMyLocationText).toHaveBeenCalledTimes(1)
  })
})

describe('clearRiderLocation — signOut\'s sweep', () => {
  it('clears the memo so the next call resolves fresh', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })

    await resolveRiderLocation()
    clearRiderLocation()
    await resolveRiderLocation()

    expect(getMyLocationText).toHaveBeenCalledTimes(2)
  })

  it('is what keeps rider A\'s coordinates out of rider B\'s session on the same device', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })
    await expect(resolveRiderLocation()).resolves.toEqual({ lat: 52.09, lon: 5.12, source: 'profile' })

    // Rider A signs out; signOut calls this. Rider B signs in — same page,
    // same module state, no reload.
    clearRiderLocation()
    getMyLocationText.mockResolvedValue(null)

    await expect(resolveRiderLocation()).resolves.toBeNull()
  })

  it('is a no-op during a server render, the same way clearGuardCache is', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.09, lon: 5.12 })
    await resolveRiderLocation()

    delete globals.document
    expect(() => clearRiderLocation()).not.toThrow()
    globals.document = {}

    // The memo survived — nothing was cleared without a document.
    await expect(resolveRiderLocation()).resolves.toEqual({ lat: 52.09, lon: 5.12, source: 'profile' })
    expect(getMyLocationText).toHaveBeenCalledTimes(1)
  })
})

describe('requestDeviceLocation — the explicit "use my location" affordance', () => {
  it('is the one path that actually asks the device, regardless of permission state', async () => {
    const geolocation = fakeGeolocation({ kind: 'success', lat: 52.09, lon: 5.12 })
    installNavigator(nav({ geolocation, permission: 'prompt' }))

    const result = await requestDeviceLocation()

    expect(result).toEqual({ lat: 52.09, lon: 5.12, source: 'device' })
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('returns null, not a throw, when the device has no geolocation at all', async () => {
    installNavigator(nav({}))

    await expect(requestDeviceLocation()).resolves.toBeNull()
  })

  it('returns null on denial without touching the profile fallback', async () => {
    const geolocation = fakeGeolocation({ kind: 'error' })
    installNavigator(nav({ geolocation, permission: 'prompt' }))

    await expect(requestDeviceLocation()).resolves.toBeNull()
    expect(getMyLocationText).not.toHaveBeenCalled()
  })

  it('on success, overwrites the page-load cache so a later resolveRiderLocation sees it', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 1, lon: 1 })

    // Primes the cache with the profile answer.
    await expect(resolveRiderLocation()).resolves.toEqual({ lat: 1, lon: 1, source: 'profile' })

    const geolocation = fakeGeolocation({ kind: 'success', lat: 52.09, lon: 5.12 })
    installNavigator(nav({ geolocation, permission: 'prompt' }))
    await requestDeviceLocation()

    await expect(resolveRiderLocation()).resolves.toEqual({ lat: 52.09, lon: 5.12, source: 'device' })
    // Not called a second time — the cache was overwritten, not invalidated.
    expect(getMyLocationText).toHaveBeenCalledTimes(1)
  })

  it('on failure, leaves whatever the cache already held untouched', async () => {
    installNavigator(nav({}))
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 1, lon: 1 })

    await resolveRiderLocation()

    const geolocation = fakeGeolocation({ kind: 'error' })
    installNavigator(nav({ geolocation, permission: 'prompt' }))
    await requestDeviceLocation()

    await expect(resolveRiderLocation()).resolves.toEqual({ lat: 1, lon: 1, source: 'profile' })
  })

  /**
   * The exact defect reviewer reproduced: a rider taps "use my location",
   * reads the OS dialog for several seconds, then taps Allow — and the fix
   * must still land. Before the fix, a JS backstop armed at call time (4.5s)
   * fired while the dialog was still open, so a real position arriving at 6s
   * landed in a `settled` no-op and the rider was told "no location" on
   * exactly the grant that matters, the first one.
   */
  it('does not give up while the OS permission dialog is still open', async () => {
    vi.useFakeTimers()
    const geolocation = manualGeolocation()
    // Before the tap, the platform legitimately does not know the answer yet
    // — that is the whole reason a dialog is about to show.
    installNavigator(nav({ geolocation, permission: 'prompt' }))

    const pending = requestDeviceLocation()
    await vi.advanceTimersByTimeAsync(6_000) // the rider reading the dialog
    geolocation.respondWithSuccess() // ...then tapping Allow

    await expect(pending).resolves.toEqual({ lat: 52.09, lon: 5.12, source: 'device' })
  })

  it('still protects against a genuinely hung acquisition when permission is already granted', async () => {
    // Unlike the case above: no dialog is possible here, so the backstop is
    // safe to arm immediately and must still cut a real hang off.
    vi.useFakeTimers()
    const geolocation = fakeGeolocation({ kind: 'hang' })
    installNavigator(nav({ geolocation, permission: 'granted' }))

    const pending = requestDeviceLocation()
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(pending).resolves.toBeNull()
  })
})
