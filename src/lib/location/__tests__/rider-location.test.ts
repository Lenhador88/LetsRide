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

describe('rounding a device GPS fix to ~1 km before it enters the app (PD-151)', () => {
  async function deviceFix(lat: number, lon: number) {
    const geolocation = fakeGeolocation({ kind: 'success', lat, lon })
    installNavigator(nav({ geolocation, permission: 'prompt' }))
    return requestDeviceLocation()
  }

  it('rounds rather than truncates a southern-hemisphere latitude', async () => {
    // -33.8765 * 100 = -3387.65 — nearer to -3388 (round) than -3387 (trunc).
    // Truncation would read -33.87: CLOSER to the equator than the true fix,
    // a systematic bias rather than a blur.
    const result = await deviceFix(-33.8765, 0)
    expect(result?.lat).toBe(-33.88)
  })

  it('rounds rather than truncates a western-hemisphere longitude', async () => {
    // -58.3762 * 100 = -5837.62 — nearer to -5838 (round) than -5837 (trunc).
    // Truncation would read -58.37: CLOSER to the prime meridian than the
    // true fix.
    const result = await deviceFix(0, -58.3762)
    expect(result?.lon).toBe(-58.38)
  })

  it('rounds a positive lat/lon fix to two decimal places', async () => {
    const result = await deviceFix(52.372159, 4.895168)
    expect(result).toEqual({ lat: 52.37, lon: 4.9, source: 'device' })
  })

  it('applies on the silent path too, not only the explicit "use my location" tap', async () => {
    const geolocation = fakeGeolocation({ kind: 'success', lat: 52.372159, lon: 4.895168 })
    installNavigator(nav({ geolocation, permission: 'granted' }))

    const result = await resolveRiderLocation()

    expect(result).toEqual({ lat: 52.37, lon: 4.9, source: 'device' })
  })

  it('does not round the profile fallback — it is a geocoded locality centroid, not a live device fix', async () => {
    installNavigator(nav({})) // no geolocation at all — straight to the profile source
    getMyLocationText.mockResolvedValue('Utrecht')
    getLocalityCentroid.mockResolvedValue({ lat: 52.0907006, lon: 5.1214201 })

    const result = await resolveRiderLocation()

    expect(result).toEqual({ lat: 52.0907006, lon: 5.1214201, source: 'profile' })
  })

  /**
   * The honest substitute for "the search bias still selects the same rows
   * for a representative point," which PD-151 asked for and this suite
   * refuses to write against `public.places`: that table holds 0 rows on
   * BOTH projects until the Overture load runs (CLAUDE.md's `places` entry),
   * so a same-rows assertion today compares an empty result to an empty
   * result and passes without testing anything.
   *
   * What IS honestly testable with no database: the rounding error is
   * bounded, and that bound is small next to `search_places()`'s own
   * ~0.25 deg x 0.40 deg proximity box (`037_places_index.sql`,
   * `039_places_address_search.sql`) — so the box computed from a rounded
   * point can only disagree with the box computed from the true point in a
   * sliver at the box's own edge, for every point below.
   */
  const REPRESENTATIVE_POINTS = [
    { name: 'Amsterdam', lat: 52.372159, lon: 4.895168 },
    { name: 'Sydney', lat: -33.86882, lon: 151.20929 },
    { name: 'Buenos Aires', lat: -34.603722, lon: -58.381592 },
    { name: 'London, near the prime meridian', lat: 51.507351, lon: -0.127758 },
    { name: 'Quito, near the equator', lat: -0.180653, lon: -78.467834 },
  ]

  // Half of one unit in the 2nd decimal place — the maximum possible error
  // from rounding to LOCATION_PRECISION_DP=2. Deliberately not imported from
  // the module (there is no test-only export for it, matching this file's
  // existing style of testing through the public functions only), so a
  // change to that constant must be a conscious edit here too rather than
  // one this literal silently follows.
  const MAX_ROUNDING_ERROR_DEG = 0.5 * 10 ** -2
  // search_places()'s own half-widths — 037/039.
  const BOX_HALF_WIDTH_LAT_DEG = 0.25
  const BOX_HALF_WIDTH_LON_DEG = 0.4

  it.each(REPRESENTATIVE_POINTS)(
    'shifts $name by no more than the claimed ~1 km, on both axes',
    async ({ lat, lon }) => {
      const result = await deviceFix(lat, lon)

      expect(result).not.toBeNull()
      expect(Math.abs(result!.lat - lat)).toBeLessThanOrEqual(MAX_ROUNDING_ERROR_DEG)
      expect(Math.abs(result!.lon - lon)).toBeLessThanOrEqual(MAX_ROUNDING_ERROR_DEG)
    }
  )

  it('that bound is a small fraction of the proximity box half-width, on both axes', () => {
    // A property of the constant, not of any one coordinate — the worst
    // case is the same 0.005 deg everywhere, so this needs no per-point
    // case. 0.005 / 0.25 is exactly 2% — the narrower (latitude) box edge —
    // so the bound is <=2%, not <2%.
    expect(MAX_ROUNDING_ERROR_DEG / BOX_HALF_WIDTH_LAT_DEG).toBeLessThanOrEqual(0.02)
    expect(MAX_ROUNDING_ERROR_DEG / BOX_HALF_WIDTH_LON_DEG).toBeLessThanOrEqual(0.02)
  })
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
