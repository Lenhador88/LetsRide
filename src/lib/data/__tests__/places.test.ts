import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `search-places` (PD-273), read through `searchPlaces`/`getLocalityCentroid`
 * in `lib/data/places.ts`. Replaces the `search_places()`/`locality_centroid()`
 * RPC-era suite this file used to hold — the token cap and `boundTerm` are
 * gone with the query plan they bounded, and the seven-state contract
 * (`PlaceSearchCeilingError`/`PlaceSearchUnavailableError`/
 * `PlaceSearchOfflineError`) is what replaces "throws honestly" for the cases
 * a rider needs told apart.
 *
 * A thenable stub rather than a mock of `@supabase/supabase-js`'s client —
 * `media.test.ts`'s reasoning: what is worth pinning is the contract
 * `searchPlaces`/`getLocalityCentroid` rely on (`functions.invoke`'s
 * `{data, error}` shape), not the library's internals. `FunctionsHttpError`
 * itself is real, imported from the real package, because `edgeFunctionErrorCode`
 * narrows on `instanceof` — a structural stand-in would defeat the very check
 * being tested.
 */

const invoke = vi.fn()

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({ functions: { invoke } }),
}))

const {
  PLACE_SEARCH_MIN_CHARS,
  PLACE_SEARCH_MAX_CHARS,
  PlaceSearchCeilingError,
  PlaceSearchOfflineError,
  PlaceSearchUnavailableError,
  searchPlaces,
  getLocalityCentroid,
  resetPlaceSearchCeilingHeuristic,
} = await import('@/lib/data/places')

/** A `FunctionsHttpError` whose `.context` is a real `Response`-shaped object
 *  carrying the function's own JSON body — exactly what `edgeFunctionErrorCode`
 *  reads. */
function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError({
    status,
    json: async () => body,
  } as unknown as Response)
}

beforeEach(() => {
  invoke.mockReset()
  resetPlaceSearchCeilingHeuristic()
  invoke.mockResolvedValue({ data: { results: [] }, error: null })
})

describe('the 4-character gate', () => {
  it('is 4', () => {
    // Carried over from the RPC era deliberately — `lib/data/places.ts`'s own
    // doc block on the constant explains why the number survives even though
    // the reason (a credit, not a sequential scan) changed underneath it.
    expect(PLACE_SEARCH_MIN_CHARS).toBe(4)
  })

  it('returns empty with no round trip below the floor', async () => {
    await expect(searchPlaces('sta', null)).resolves.toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('fires at exactly the floor', async () => {
    invoke.mockResolvedValue({
      data: { results: [{ id: 'geoapify:1', label: 'Stationsweg', meta: null, lat: 1, lon: 2 }] },
      error: null,
    })

    const results = await searchPlaces('stat', null)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
  })

  it('gates on the trimmed length, not the raw one', async () => {
    await expect(searchPlaces('  ab  ', null)).resolves.toEqual([])
    expect(invoke).not.toHaveBeenCalled()

    await searchPlaces('  abcd  ', null)
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

describe('the character bound — replaces the retired token cap', () => {
  it('sends the mode, the text and the bias — no rider identity', async () => {
    await searchPlaces('Stationsweg', { lat: 52.09, lon: 5.12 })

    expect(invoke).toHaveBeenCalledWith('search-places', {
      body: { mode: 'search', text: 'Stationsweg', near: { lat: 52.09, lon: 5.12 } },
      signal: undefined,
    })
  })

  it('truncates a pasted essay before it is sent, at PLACE_SEARCH_MAX_CHARS', async () => {
    const long = 'x'.repeat(PLACE_SEARCH_MAX_CHARS + 50)

    await searchPlaces(long, null)

    const body = invoke.mock.calls[0][1].body as { text: string }
    expect(body.text).toHaveLength(PLACE_SEARCH_MAX_CHARS)
  })

  it('passes null when there is no bias', async () => {
    await searchPlaces('Stationsweg', null)

    expect(invoke).toHaveBeenCalledWith('search-places', {
      body: { mode: 'search', text: 'Stationsweg', near: null },
      signal: undefined,
    })
  })
})

describe('cancellation', () => {
  it('passes the signal through to functions.invoke', async () => {
    const controller = new AbortController()

    await searchPlaces('Stationsweg', null, controller.signal)

    expect(invoke).toHaveBeenCalledWith('search-places', expect.objectContaining({ signal: controller.signal }))
  })

  it('surfaces an aborted request as AbortError, not as a data-read failure', async () => {
    const controller = new AbortController()
    controller.abort()
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new DOMException('', 'AbortError')) })

    await expect(searchPlaces('Stationsweg', null, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('the seven-state contract — searchPlaces throws a named error per state', () => {
  it('throws PlaceSearchCeilingError on a 429, never a generic failure', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'ceiling' }) })

    await expect(searchPlaces('Stationsweg', null)).rejects.toBeInstanceOf(PlaceSearchCeilingError)
  })

  it('the two rider ceilings do NOT share a message — the requirement place-search states explicitly', async () => {
    // No local evidence of a burst -> the safe default, 'daily'.
    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'ceiling' }) })
    const daily = await searchPlaces('Stationsweg', null).catch((e) => e)
    expect(daily).toBeInstanceOf(PlaceSearchCeilingError)
    expect(daily.scope).toBe('daily')

    // Local evidence of a burst (20 accepted attempts in the last hour) ->
    // 'hourly'. Each accepted attempt is a successful (or ledger-accepted)
    // response, which is what a real search actually looks like before a
    // ceiling bites.
    resetPlaceSearchCeilingHeuristic()
    invoke.mockResolvedValue({ data: { results: [] }, error: null })
    for (let i = 0; i < 20; i++) await searchPlaces('Stationsweg', null)

    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'ceiling' }) })
    const hourly = await searchPlaces('Stationsweg', null).catch((e) => e)
    expect(hourly).toBeInstanceOf(PlaceSearchCeilingError)
    expect(hourly.scope).toBe('hourly')

    expect(daily.message).not.toBe(hourly.message)
  })

  it('a 403 (the participation gate) reads the same as a ceiling, never disclosing which gate refused', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'forbidden' }) })

    await expect(searchPlaces('Stationsweg', null)).rejects.toBeInstanceOf(PlaceSearchCeilingError)
  })

  it('a vendor/ledger outage (502) throws PlaceSearchUnavailableError, not a ceiling', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(502, { error: 'unavailable' }) })

    await expect(searchPlaces('Stationsweg', null)).rejects.toBeInstanceOf(PlaceSearchUnavailableError)
  })

  it('a network failure that never reached the function also reads as unavailable', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('fetch failed')) })

    await expect(searchPlaces('Stationsweg', null)).rejects.toBeInstanceOf(PlaceSearchUnavailableError)
  })

  it('an offline device is refused before functions.invoke is ever called', async () => {
    // No `original` guard — Node's built-in `navigator` carries no `onLine`
    // property at all until this defines one, so a guard that skips
    // restoration when there was nothing to restore FROM leaves `onLine`
    // permanently `false` for every test file after this one. Deleting is
    // the correct undo for "the property did not exist before".
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine')
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true })
    try {
      await expect(searchPlaces('Stationsweg', null)).rejects.toBeInstanceOf(PlaceSearchOfflineError)
      expect(invoke).not.toHaveBeenCalled()
    } finally {
      if (original) {
        Object.defineProperty(globalThis.navigator, 'onLine', original)
      } else {
        delete (globalThis.navigator as { onLine?: boolean }).onLine
      }
    }
  })

  it('no message ever names the vendor, a status code, or a quota number', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'ceiling' }) })
    let ceiling: Error | undefined
    try {
      await searchPlaces('Stationsweg', null)
    } catch (e) {
      ceiling = e as Error
    }

    invoke.mockResolvedValue({ data: null, error: httpError(502, { error: 'unavailable' }) })
    let unavailable: Error | undefined
    try {
      await searchPlaces('Stationsweg', null)
    } catch (e) {
      unavailable = e as Error
    }

    expect(ceiling).toBeDefined()
    expect(unavailable).toBeDefined()
    for (const message of [ceiling!.message, unavailable!.message]) {
      expect(message.toLowerCase()).not.toMatch(/geoapify|429|502|quota|credit/)
    }
  })
})

describe('the ordinary success path', () => {
  it('returns the rows as the function gave them', async () => {
    const rows = [{ id: 'geoapify:1', label: 'Café de Molen', meta: 'Kerkstraat 1, Utrecht', lat: 52.09, lon: 5.12 }]
    invoke.mockResolvedValue({ data: { results: rows }, error: null })

    await expect(searchPlaces('Café de Molen', null)).resolves.toEqual(rows)
  })

  it('falls back to [] when the response body carries no results array', async () => {
    invoke.mockResolvedValue({ data: {}, error: null })

    await expect(searchPlaces('Café de Molen', null)).resolves.toEqual([])
  })
})

describe('getLocalityCentroid', () => {
  it('does not call out for an empty or whitespace-only query', async () => {
    expect(await getLocalityCentroid('')).toBeNull()
    expect(await getLocalityCentroid('   ')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('resolves a locality to {lat, lon} — no place_count any more, the table that counted rows is gone', async () => {
    invoke.mockResolvedValue({ data: { centroid: { lat: 52.09, lon: 5.12 } }, error: null })

    await expect(getLocalityCentroid('Utrecht')).resolves.toEqual({ lat: 52.09, lon: 5.12 })
    expect(invoke).toHaveBeenCalledWith('search-places', { body: { mode: 'locality', text: 'Utrecht', near: null } })
  })

  it('degrades to null on ANY failure — a ceiling, an outage, or a malformed body — and warns rather than staying silent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'ceiling' }) })
      await expect(getLocalityCentroid('Utrecht')).resolves.toBeNull()
      expect(warn).toHaveBeenCalled()

      warn.mockClear()
      invoke.mockResolvedValue({ data: null, error: httpError(502, { error: 'unavailable' }) })
      await expect(getLocalityCentroid('Utrecht')).resolves.toBeNull()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('returns null for "no centroid", never a row of nulls', async () => {
    invoke.mockResolvedValue({ data: { centroid: null }, error: null })
    await expect(getLocalityCentroid('Nowhereville')).resolves.toBeNull()
  })

  it('sanity-checks lat/lon rather than trusting a malformed pair blindly', async () => {
    invoke.mockResolvedValue({ data: { centroid: { lat: null, lon: null } }, error: null })
    await expect(getLocalityCentroid('Nowhereville')).resolves.toBeNull()

    invoke.mockResolvedValue({ data: { centroid: { lat: NaN, lon: 5.12 } }, error: null })
    await expect(getLocalityCentroid('Nowhereville')).resolves.toBeNull()
  })
})

describe('resetPlaceSearchCeilingHeuristic — the sign-out sweep', () => {
  it('clears the local evidence, so a fresh ceiling reads as the safe default again', async () => {
    invoke.mockResolvedValue({ data: { results: [] }, error: null })
    for (let i = 0; i < 20; i++) await searchPlaces('Stationsweg', null)

    resetPlaceSearchCeilingHeuristic()

    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'ceiling' }) })
    const outcome = await searchPlaces('Stationsweg', null).catch((e) => e)
    expect(outcome.scope).toBe('daily')
  })
})
