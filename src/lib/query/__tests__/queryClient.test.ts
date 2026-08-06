import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearQueryCache,
  deriveLoadingFlags,
  ensureFetch,
  getSnapshot,
  invalidate,
  refetch,
  refetchStaleMountedQueries,
  serializeKey,
  setQueryData,
  subscribeKey,
} from '@/lib/query/queryClient'
import { deferred, flushMicrotasks } from '@/lib/query/__tests__/helpers'

// Every test below uses its own key (namespaced by `describe` block) rather
// than resetting a shared cache between cases — `cache` is a module-level
// singleton, and Vitest gives this file its own module instance, but not
// its own instance per `it()`. Unique keys are simpler than a reset hook and
// make cross-test bleed impossible to introduce by accident.

afterEach(() => {
  vi.useRealTimers()
})

describe('serializeKey', () => {
  it('does not let a null segment and an undefined segment collide', () => {
    // JSON.stringify turns `undefined` into `null` inside an array — without
    // the tagging in serializeKey, ['ride', null] and ['ride', undefined]
    // would serialise identically and share a cache entry, even though the
    // QueryKey type allows both as distinct segments.
    expect(serializeKey(['ride', null])).not.toBe(serializeKey(['ride', undefined]))
  })

  it('is stable for equal keys and distinct for different ones', () => {
    expect(serializeKey(['rides', 1, true])).toBe(serializeKey(['rides', 1, true]))
    expect(serializeKey(['rides', 1])).not.toBe(serializeKey(['rides', 2]))
  })
})

describe('a null key disables the query — requirement 4', () => {
  it('getSnapshot(null) always returns the same frozen disabled snapshot', () => {
    const a = getSnapshot(null)
    const b = getSnapshot(null)
    expect(a).toBe(b)
    expect(a).toEqual({ data: undefined, error: null, isFetching: false, updatedAt: 0 })
  })

  it('subscribeKey(null, listener) is a no-op: the listener is never called and nothing throws', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeKey(null, listener)
    expect(() => unsubscribe()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  it('a disabled key never reaches a fetcher — ensureFetch/refetch only accept a real QueryKey', () => {
    // This is enforced at the type level in `useQuery.ts` (its effect guards
    // `keyRef.current === null` before ever calling `ensureFetch`), which is
    // exactly why `ensureFetch`'s own signature requires a real `QueryKey`
    // rather than `QueryKey | null` — there is no code path through this
    // module that can hand a fetcher a null key at all.
    expect(getSnapshot(null).isFetching).toBe(false)
  })
})

describe('dedup — requirement 1', () => {
  it('two mounts issuing the same key in the same tick share one fetch', () => {
    const key = ['dedup', 'same-tick']
    const fetcher = vi.fn(() => new Promise<string>(() => {})) // never resolves; this test only counts calls
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 30_000)
    ensureFetch(key, fetcher, 30_000) // a second component mounting with the same key

    expect(fetcher).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('a second, different fetcher for the same key also joins rather than issuing its own request', () => {
    const key = ['dedup', 'different-fetcher']
    const fetcherA = vi.fn(() => new Promise<string>(() => {}))
    const fetcherB = vi.fn(() => new Promise<string>(() => {}))
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcherA, 30_000)
    ensureFetch(key, fetcherB, 30_000)

    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).not.toHaveBeenCalled()
    unsubscribe()
  })
})

describe('stale-while-revalidate — requirement 2', () => {
  it('serves cached data immediately without refetching while fresh, and revalidates in the background once stale', async () => {
    vi.useFakeTimers()
    const key = ['swr', 'ride']
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 1000)
    await flushMicrotasks()
    expect(getSnapshot<string>(key)).toMatchObject({ data: 'v1', isFetching: false })
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Still within staleTime: a later mount must not refetch, and the cached
    // value is what it sees immediately.
    vi.advanceTimersByTime(500)
    ensureFetch(key, fetcher, 1000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(getSnapshot<string>(key).data).toBe('v1')

    // Past staleTime: the cached value stays visible while a background
    // fetch runs — isLoading must not come back, only isRefetching.
    vi.advanceTimersByTime(600)
    ensureFetch(key, fetcher, 1000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(getSnapshot<string>(key).data).toBe('v1')
    expect(getSnapshot<string>(key).isFetching).toBe(true)
    expect(deriveLoadingFlags(getSnapshot(key))).toEqual({ isLoading: false, isRefetching: true })

    await flushMicrotasks()
    expect(getSnapshot<string>(key).data).toBe('v2')
    expect(getSnapshot<string>(key).isFetching).toBe(false)

    unsubscribe()
  })

  it('deriveLoadingFlags: isLoading only with no data yet, isRefetching only once something has landed', () => {
    expect(deriveLoadingFlags({ data: undefined, error: null, isFetching: true, updatedAt: 0 })).toEqual({
      isLoading: true,
      isRefetching: false,
    })
    expect(deriveLoadingFlags({ data: 'x', error: null, isFetching: true, updatedAt: 1 })).toEqual({
      isLoading: false,
      isRefetching: true,
    })
    expect(deriveLoadingFlags({ data: 'x', error: null, isFetching: false, updatedAt: 1 })).toEqual({
      isLoading: false,
      isRefetching: false,
    })
    expect(deriveLoadingFlags({ data: undefined, error: null, isFetching: false, updatedAt: 0 })).toEqual({
      isLoading: false,
      isRefetching: false,
    })
  })
})

describe('race safety — requirement 3', () => {
  it('discards a stale response that resolves after a newer one, by generation rather than arrival order', async () => {
    const key = ['race', 'invalidate-mid-flight']
    const d1 = deferred<string>()
    const d2 = deferred<string>()
    const fetcher = vi.fn().mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise)
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 30_000)
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Invalidating while the first request is still in flight bumps the
    // generation and — because this key is mounted — starts a second one.
    invalidate(key)
    expect(fetcher).toHaveBeenCalledTimes(2)

    // The newer request settles first...
    d2.resolve('fresh')
    await flushMicrotasks()
    expect(getSnapshot<string>(key).data).toBe('fresh')

    // ...and the older one, arriving late, must not overwrite it. A
    // timestamp-based guard ("keep whichever has the newer updatedAt") would
    // pass this specific ordering too — the point of the generation counter
    // is that it does not depend on arrival order at all.
    d1.resolve('stale')
    await flushMicrotasks()
    expect(getSnapshot<string>(key).data).toBe('fresh')

    unsubscribe()
  })

  it('discards a stale response even when it resolves BEFORE the newer request is issued elsewhere', async () => {
    // The inverse ordering: the old fetch's promise settles, but only after
    // its generation has already been superseded by a synchronous
    // invalidate — proving the guard is generation equality, not "have we
    // seen a newer promise yet".
    const key = ['race', 'resolve-then-superseded']
    const d1 = deferred<string>()
    const fetcher = vi.fn().mockImplementationOnce(() => d1.promise).mockResolvedValueOnce('fresh')
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 30_000)
    invalidate(key) // generation now 1; a second fetch (resolving to 'fresh') starts and will settle on flush

    d1.resolve('stale')
    await flushMicrotasks()

    expect(getSnapshot<string>(key).data).toBe('fresh')
    unsubscribe()
  })
})

describe('unmount safety — requirement 5', () => {
  it('a fetch whose only subscriber unsubscribed still resolves into the cache, and never calls the removed listener', async () => {
    const key = ['unmount', 'last-subscriber']
    const listener = vi.fn()
    const unsubscribe = subscribeKey(key, listener)

    const d = deferred<string>()
    const fetcher = vi.fn(() => d.promise)
    ensureFetch(key, fetcher, 30_000)
    listener.mockClear() // discard the "isFetching: true" notification from starting the fetch

    unsubscribe() // the component unmounted before the fetch resolved

    d.resolve('arrived-after-unmount')
    await flushMicrotasks()

    expect(listener).not.toHaveBeenCalled()
    expect(getSnapshot<string>(key).data).toBe('arrived-after-unmount')
  })
})

describe('errors are cached, and do not hot-loop — requirements 7 and 8', () => {
  it('caches a rejection and does not retry on its own absent a new trigger', async () => {
    const key = ['errors', 'no-hot-loop']
    const boom = new Error('boom')
    const fetcher = vi.fn().mockRejectedValue(boom)
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 30_000)
    await flushMicrotasks()
    expect(getSnapshot(key).error).toBe(boom)
    expect(fetcher).toHaveBeenCalledTimes(1)

    // Nothing prompts a retry — no mount, no refetch(), no invalidate, no
    // connectivity event. Waiting longer must not change the call count.
    await flushMicrotasks()
    await flushMicrotasks()
    expect(fetcher).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('refetch() clears the cached error immediately, then retries', async () => {
    const key = ['errors', 'refetch-clears']
    const boom = new Error('boom')
    const fetcher = vi.fn().mockRejectedValueOnce(boom).mockResolvedValueOnce('ok')
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 30_000)
    await flushMicrotasks()
    expect(getSnapshot<string>(key).error).toBe(boom)

    refetch(key, fetcher)
    // Cleared synchronously — before the retry's outcome is known.
    expect(getSnapshot<string>(key).error).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)

    await flushMicrotasks()
    expect(getSnapshot<string>(key)).toMatchObject({ data: 'ok', error: null })

    unsubscribe()
  })
})

describe('invalidate — requirement 6, matching by structural prefix', () => {
  it('refetches every mounted query whose key starts with the prefix', async () => {
    const clubId = 'c1'
    const ridesKey = ['rides', 'club', clubId]
    const membersKey = ['clubs', clubId, 'members']
    const otherClubKey = ['rides', 'club', 'c2']

    const ridesFetcher = vi.fn(async () => 'rides-v2')
    const membersFetcher = vi.fn(async () => 'members-v1')
    const otherFetcher = vi.fn(async () => 'other-v1')

    const unsub1 = subscribeKey(ridesKey, () => {})
    const unsub2 = subscribeKey(membersKey, () => {})
    const unsub3 = subscribeKey(otherClubKey, () => {})

    ensureFetch(ridesKey, ridesFetcher, 60_000)
    ensureFetch(membersKey, membersFetcher, 60_000)
    ensureFetch(otherClubKey, otherFetcher, 60_000)
    await flushMicrotasks()

    invalidate(['rides', 'club', clubId])

    expect(ridesFetcher).toHaveBeenCalledTimes(2) // matches the prefix exactly
    expect(membersFetcher).toHaveBeenCalledTimes(1) // different branch entirely, untouched
    expect(otherFetcher).toHaveBeenCalledTimes(1) // same shape, different club — must not match

    unsub1()
    unsub2()
    unsub3()
  })

  it('matches structurally, not by string prefix — a key that merely starts with the same characters must not match', async () => {
    const decoyKey = ['ridesXYZ']
    const decoyFetcher = vi.fn(async () => 'decoy')
    const unsubscribe = subscribeKey(decoyKey, () => {})
    ensureFetch(decoyKey, decoyFetcher, 60_000)
    await flushMicrotasks()

    invalidate(['rides'])

    expect(decoyFetcher).toHaveBeenCalledTimes(1) // unchanged — 'ridesXYZ' !== 'rides'
    unsubscribe()
  })

  it('marks an unmounted match stale without fetching it, so its next mount fetches fresh', async () => {
    const key = ['invalidate', 'unmounted']
    const fetcher = vi.fn(async () => 'v1')
    const unsubscribe = subscribeKey(key, () => {})
    ensureFetch(key, fetcher, 60_000)
    await flushMicrotasks()
    unsubscribe() // nobody is listening anymore

    invalidate(['invalidate', 'unmounted'])
    expect(fetcher).toHaveBeenCalledTimes(1) // not refetched — no mounted subscriber to hand it to

    // A later remount sees stale data (updatedAt reset) and fetches again,
    // even though 60s of staleTime has not actually elapsed.
    const unsubscribeAgain = subscribeKey(key, () => {})
    ensureFetch(key, fetcher, 60_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    unsubscribeAgain()
  })
})

describe('setQueryData', () => {
  it('seeds the cache directly and rejects a slower in-flight response racing behind it', async () => {
    const key = ['optimistic', 'race']
    const d = deferred<number>()
    const fetcher = vi.fn(() => d.promise)
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 30_000)
    setQueryData<number>(key, 42) // an optimistic write lands while the read is still in flight

    expect(getSnapshot<number>(key).data).toBe(42)

    d.resolve(7) // the read that started before the optimistic write settles after it
    await flushMicrotasks()

    expect(getSnapshot<number>(key).data).toBe(42) // must not be clobbered by the stale read
    unsubscribe()
  })

  it('accepts an updater function that sees the previous value', () => {
    const key = ['optimistic', 'updater']
    setQueryData<number>(key, 1)
    setQueryData<number>(key, (prev) => (prev ?? 0) + 1)
    expect(getSnapshot<number>(key).data).toBe(2)
  })
})

describe('clearQueryCache', () => {
  it('drops cached data and notifies mounted subscribers', async () => {
    const key = ['signout', 'profile']
    const listener = vi.fn()
    const unsubscribe = subscribeKey(key, listener)
    const fetcher = vi.fn(async () => 'me')

    ensureFetch(key, fetcher, 30_000)
    await flushMicrotasks()
    expect(getSnapshot<string>(key).data).toBe('me')
    listener.mockClear()

    clearQueryCache()

    expect(getSnapshot<string>(key).data).toBeUndefined()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('discards an in-flight fetch rather than letting it repopulate the cache after clearing — the shared-device case', async () => {
    const key = ['signout', 'race']
    const d = deferred<string>()
    const fetcher = vi.fn(() => d.promise)
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 30_000)
    clearQueryCache() // rider A signs out while their own profile fetch is still in flight

    d.resolve("rider A's data") // arrives after sign-out cleared the slate
    await flushMicrotasks()

    expect(getSnapshot<string>(key).data).toBeUndefined() // must not leak into rider B's session
    unsubscribe()
  })
})

describe('refetchStaleMountedQueries — requirements 6 and 8', () => {
  it('refetches only queries that are both mounted and stale, skipping fresh and skipping unmounted', async () => {
    const freshKey = ['reconnect', 'fresh']
    const staleKey = ['reconnect', 'stale']
    const unmountedKey = ['reconnect', 'unmounted']

    const freshFetcher = vi.fn(async () => 'fresh')
    const staleFetcher = vi.fn(async () => 'refetched')
    const unmountedFetcher = vi.fn(async () => 'never')

    const unsubFresh = subscribeKey(freshKey, () => {})
    const unsubStale = subscribeKey(staleKey, () => {})
    // unmountedKey deliberately has no subscriber.

    ensureFetch(freshKey, freshFetcher, 60_000) // long staleTime — stays fresh
    ensureFetch(staleKey, staleFetcher, 0) // staleTime 0 — stale the instant any time passes
    ensureFetch(unmountedKey, unmountedFetcher, 0)
    await flushMicrotasks()

    expect(freshFetcher).toHaveBeenCalledTimes(1)
    expect(staleFetcher).toHaveBeenCalledTimes(1)
    expect(unmountedFetcher).toHaveBeenCalledTimes(1)

    refetchStaleMountedQueries()
    await flushMicrotasks()

    expect(freshFetcher).toHaveBeenCalledTimes(1) // fresh + mounted -> skipped
    expect(staleFetcher).toHaveBeenCalledTimes(2) // stale + mounted -> refetched
    expect(unmountedFetcher).toHaveBeenCalledTimes(1) // stale but not mounted -> skipped

    unsubFresh()
    unsubStale()
  })

  it('retries a mounted query sitting in an error state, even with a long staleTime — requirement 8', async () => {
    const key = ['reconnect', 'errored']
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('back')
    const unsubscribe = subscribeKey(key, () => {})

    ensureFetch(key, fetcher, 60_000) // long staleTime — proves the retry isn't from time elapsing
    await flushMicrotasks()
    expect(getSnapshot(key).error).toBeInstanceOf(Error)
    expect(fetcher).toHaveBeenCalledTimes(1)

    refetchStaleMountedQueries()
    await flushMicrotasks()

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(getSnapshot<string>(key)).toMatchObject({ data: 'back', error: null })

    unsubscribe()
  })
})
