import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `search_places()` (`037`/`039`) and `locality_centroid()` (`040`), read
 * through `lib/data/places.ts`.
 *
 * The client is a thenable stub rather than a mock of `@supabase/supabase-js`
 * — same reasoning as `media.test.ts`'s header: what is worth pinning is the
 * contract `searchPlaces`/`getLocalityCentroid` rely on (one `.rpc()` call,
 * `.abortSignal()` chaining, `{ data, error }`), not the library's internals.
 */

type RpcResult = { data: unknown; error: unknown }

function fakeQuery(result: RpcResult) {
  const query = {
    abortSignal: vi.fn(() => query),
    then(onFulfilled: (v: RpcResult) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }
  return query
}

const rpc = vi.fn()

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({ rpc }),
}))

const { PLACE_SEARCH_MIN_CHARS, PLACE_SEARCH_MAX_TOKENS, searchPlaces, getLocalityCentroid } =
  await import('@/lib/data/places')

beforeEach(() => {
  rpc.mockReset()
  rpc.mockReturnValue(fakeQuery({ data: [], error: null }))
})

describe('the 4-character gate', () => {
  it('is 4, not the database\'s 3', () => {
    // The database's own floor is a *security* guard (`term ~
    // '[[:alnum:]]{3}'`), refused rather than "no matches". This constant is
    // a stricter, unrelated performance/UX choice layered on top — see the
    // constant's own doc comment for why collapsing the two would be wrong in
    // either direction.
    expect(PLACE_SEARCH_MIN_CHARS).toBe(4)
  })

  it('returns empty with no round trip below the floor', async () => {
    await expect(searchPlaces('sta', null)).resolves.toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fires at exactly the floor', async () => {
    rpc.mockReturnValue(fakeQuery({ data: [{ id: '1', label: 'Stationsweg', meta: null, lat: 1, lon: 2 }], error: null }))

    const results = await searchPlaces('stat', null)

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
  })

  it('gates on the trimmed length, not the raw one', async () => {
    // Three visible characters padded with whitespace must not sneak past the
    // floor by counting the padding.
    await expect(searchPlaces('  ab  ', null)).resolves.toEqual([])
    expect(rpc).not.toHaveBeenCalled()

    await searchPlaces('  abcd  ', null)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('the token cap', () => {
  it('truncates rather than refusing a long term', async () => {
    const tokens = Array.from({ length: PLACE_SEARCH_MAX_TOKENS + 5 }, (_, i) => `word${i}`)

    await searchPlaces(tokens.join(' '), null)

    expect(rpc).toHaveBeenCalledWith(
      'search_places',
      expect.objectContaining({ q: tokens.slice(0, PLACE_SEARCH_MAX_TOKENS).join(' ') })
    )
  })

  it('leaves a short term untouched', async () => {
    await searchPlaces('Jumbo Maastricht', null)

    expect(rpc).toHaveBeenCalledWith('search_places', expect.objectContaining({ q: 'Jumbo Maastricht' }))
  })

  /**
   * The nit reviewer flagged: `039` §5d dedups case-insensitively before
   * building patterns, so the CAP must do the same before slicing — otherwise
   * eight repeats of one word (case-varied, so a naive dedup would miss it)
   * fill the whole budget and a genuinely distinct final word never reaches
   * the database at all.
   */
  it('dedupes case-insensitively before truncating, so a repeated word cannot push out a distinct one', async () => {
    const repeated = ['Jumbo', 'jumbo', 'JUMBO', 'Jumbo', 'jumbo', 'JUMBO', 'Jumbo', 'jumbo']
    expect(repeated).toHaveLength(PLACE_SEARCH_MAX_TOKENS)

    await searchPlaces([...repeated, 'Maastricht'].join(' '), null)

    // Under the cap once deduped (2 unique tokens), so nothing is truncated —
    // the original term, repeats and all, is sent unchanged and the database
    // does its own dedup on the far side (`039` §5d).
    expect(rpc).toHaveBeenCalledWith(
      'search_places',
      expect.objectContaining({ q: [...repeated, 'Maastricht'].join(' ') })
    )
  })

  it('still truncates once the number of genuinely distinct tokens exceeds the cap', async () => {
    const distinct = Array.from({ length: PLACE_SEARCH_MAX_TOKENS + 2 }, (_, i) => `word${i}`)

    await searchPlaces(distinct.join(' '), null)

    expect(rpc).toHaveBeenCalledWith(
      'search_places',
      expect.objectContaining({ q: distinct.slice(0, PLACE_SEARCH_MAX_TOKENS).join(' ') })
    )
  })
})

describe('the proximity bias', () => {
  it('passes near_lat/near_lon through when supplied', async () => {
    await searchPlaces('Stationsweg', { lat: 52.09, lon: 5.12 })

    expect(rpc).toHaveBeenCalledWith('search_places', {
      q: 'Stationsweg',
      near_lat: 52.09,
      near_lon: 5.12,
    })
  })

  it('passes null coordinates rather than omitting them when there is no bias', async () => {
    await searchPlaces('Stationsweg', null)

    expect(rpc).toHaveBeenCalledWith('search_places', {
      q: 'Stationsweg',
      near_lat: null,
      near_lon: null,
    })
  })
})

describe('cancellation', () => {
  it('chains abortSignal onto the query only when one is given', async () => {
    const query = fakeQuery({ data: [], error: null })
    rpc.mockReturnValue(query)
    const controller = new AbortController()

    await searchPlaces('Stationsweg', null, controller.signal)

    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal)
  })

  it('does not call abortSignal without one', async () => {
    const query = fakeQuery({ data: [], error: null })
    rpc.mockReturnValue(query)

    await searchPlaces('Stationsweg', null)

    expect(query.abortSignal).not.toHaveBeenCalled()
  })

  it('surfaces a cancelled request as AbortError, not as a data-read failure', async () => {
    const controller = new AbortController()
    controller.abort()
    rpc.mockReturnValue(
      fakeQuery({ data: null, error: { message: 'AbortError: The user aborted a request.' } })
    )

    await expect(searchPlaces('Stationsweg', null, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('a genuine failure', () => {
  it('throws honestly, the same way every other read in this directory does', async () => {
    rpc.mockReturnValue(fakeQuery({ data: null, error: { message: 'connection refused', code: '08006' } }))

    await expect(searchPlaces('Stationsweg', null)).rejects.toThrow(/Could not read places/)
  })
})

describe('the ordinary success path', () => {
  it('returns the rows as the RPC gave them', async () => {
    const rows = [{ id: 'gers-1', label: 'Café de Molen', meta: 'Kerkstraat 1, Utrecht', lat: 52.09, lon: 5.12 }]
    rpc.mockReturnValue(fakeQuery({ data: rows, error: null }))

    await expect(searchPlaces('Café de Molen', null)).resolves.toEqual(rows)
  })
})

describe('getLocalityCentroid', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('does not call out for an empty or whitespace-only query', async () => {
    expect(await getLocalityCentroid('')).toBeNull()
    expect(await getLocalityCentroid('   ')).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('resolves a locality to its full row — lat, lon AND place_count', async () => {
    // `LocalityCentroid` (`src/types/index.ts`, `040`) is the canonical type;
    // this returns the row as-is rather than narrowing it to `{lat, lon}`.
    rpc.mockReturnValue(fakeQuery({ data: [{ lat: 52.09, lon: 5.12, place_count: 431 }], error: null }))

    await expect(getLocalityCentroid('Utrecht')).resolves.toEqual({ lat: 52.09, lon: 5.12, place_count: 431 })
    expect(rpc).toHaveBeenCalledWith('locality_centroid', { q: 'Utrecht' })
  })

  /**
   * The behaviour this accessor is *for*: a function that is renamed,
   * dropped, or refused by a role grant must degrade the resolver to "no
   * bias" rather than take a search sheet down. Deliberately not narrowed to
   * a specific error code, because a broken deploy can surface as several
   * different shapes depending on what PostgREST's schema cache currently
   * holds. Also asserts the `console.warn` fires — the thing that keeps that
   * kind of break from being invisible forever.
   */
  it('degrades to null on any RPC error, not only "function missing" — and warns rather than staying silent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      rpc.mockReturnValue(fakeQuery({ data: null, error: { message: 'could not find function', code: '42883' } }))
      await expect(getLocalityCentroid('Utrecht')).resolves.toBeNull()
      expect(warn).toHaveBeenCalled()

      warn.mockClear()
      rpc.mockReturnValue(fakeQuery({ data: null, error: { message: 'PGRST202', code: 'PGRST202' } }))
      await expect(getLocalityCentroid('Utrecht')).resolves.toBeNull()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('returns null for a locality with no matching rows (zero rows, never a row of nulls)', async () => {
    rpc.mockReturnValue(fakeQuery({ data: [], error: null }))
    await expect(getLocalityCentroid('Nowhereville')).resolves.toBeNull()
  })

  it('sanity-checks lat/lon rather than trusting a malformed row blindly', async () => {
    rpc.mockReturnValue(fakeQuery({ data: [{ lat: null, lon: null, place_count: 0 }], error: null }))
    await expect(getLocalityCentroid('Nowhereville')).resolves.toBeNull()

    rpc.mockReturnValue(fakeQuery({ data: [{ lat: NaN, lon: 5.12, place_count: 1 }], error: null }))
    await expect(getLocalityCentroid('Nowhereville')).resolves.toBeNull()
  })

  it('takes the first row when more than one comes back', async () => {
    rpc.mockReturnValue(
      fakeQuery({
        data: [
          { lat: 52.09, lon: 5.12, place_count: 10 },
          { lat: 1, lon: 1, place_count: 999 },
        ],
        error: null,
      })
    )
    await expect(getLocalityCentroid('Utrecht')).resolves.toEqual({ lat: 52.09, lon: 5.12, place_count: 10 })
  })
})
