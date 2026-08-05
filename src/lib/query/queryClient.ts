/**
 * A hand-rolled query cache for client components — the client-side half of
 * cache invalidation for the render migration
 * (`openspec/changes/migrate-to-client-rendered-shell`, tasks 5.2/5.3/5.9/5.11).
 * The 41 `revalidatePath` calls in `src/lib/actions/` become calls to
 * `invalidate`/`setQueryData` here once a screen moves client-side; this file
 * is the cache those calls act on.
 *
 * TanStack Query was considered and rejected, per CLAUDE.md's dependency
 * rule — "does a thirty-line helper do the job" before adding one. This is a
 * few hundred lines rather than thirty, but the app's needs are a genuinely
 * bounded subset of what that library solves: one cache, no pagination
 * cursors, no mutation queue, no devtools. Hand-rolling it keeps the
 * dependency count where CLAUDE.md wants it and keeps every behaviour this
 * app actually relies on in one file short enough to read in one sitting.
 *
 * **Deliberately free of `window`/`document`/`navigator`.** This module is
 * imported by `useQuery.ts`, which client components use, and those
 * components are still server-rendered by Next until Phase 6 (see
 * `lib/supabase/resolve.ts`) — so nothing in here may assume a browser.
 * `connectivity.ts` is the one file in this directory allowed to touch those
 * globals, and only inside functions, never at module scope. See
 * `__tests__/isomorphic.test.ts`, which asserts this by import rather than by
 * reading the source.
 */

export type QueryKey = readonly (string | number | boolean | null | undefined)[]

export type QuerySnapshot<T> = {
  data: T | undefined
  error: Error | null
  isFetching: boolean
  /** 0 means "never completed a fetch" — `isStale` below treats that as
   * always stale, which is what makes a first mount fetch at all. */
  updatedAt: number
}

export const DEFAULT_STALE_TIME = 30_000

type CacheEntry = {
  /** The raw key, kept alongside its serialised form so `invalidate` can do
   * structural prefix matching — see `keyStartsWith`. A string-prefix check
   * on the serialised form would false-match `["rides"]` against
   * `["rides2"]`, since both start with the literal characters `["rides`. */
  key: QueryKey
  data: unknown
  error: Error | null
  isFetching: boolean
  updatedAt: number
  staleTime: number
  /**
   * Bumped by `invalidate`, `setQueryData` and `clearQueryCache`, and
   * captured by `runFetch` at the moment a request starts. A fetch only
   * writes its result if the entry's generation still matches the one it
   * captured — so a slow response that started before an invalidation
   * cannot land after it and overwrite the newer state. A timestamp would
   * work for "started before/after" but not for "still the same logical
   * request", which is the actual property that matters: two fetches issued
   * in the same millisecond are indistinguishable by clock but not by
   * generation.
   */
  generation: number
  /** The fetch currently racing to fill `generation`, so a second caller in
   * the same tick joins it instead of issuing a duplicate request. */
  pending: { generation: number; promise: Promise<void> } | null
  /** The most recent fetcher a mounted `useQuery` handed this key — what
   * `invalidate` and the connectivity-triggered refetch call when nothing
   * local prompted them. `refetch()` and `ensureFetch` also refresh it, so
   * it always reflects the query currently on screen. */
  fetcher: (() => Promise<unknown>) | null
  listeners: Set<() => void>
  /**
   * Rebuilt only inside `notify`, so `getSnapshot` returns the same object
   * reference across calls that observe no change. Required for
   * `useSyncExternalStore`, which can loop if `getSnapshot` returns a fresh
   * object every call.
   */
  snapshot: QuerySnapshot<unknown>
}

const cache = new Map<string, CacheEntry>()

/** The frozen result every disabled query (`key: null`) reads — see
 * `useQuery`'s requirement 4. Returning the same frozen object rather than a
 * fresh one each call is also what lets a disabled query never allocate a
 * cache entry, so `getSnapshot(null)` costs nothing and touches the `Map`
 * not at all. */
const DISABLED_SNAPSHOT: QuerySnapshot<never> = Object.freeze({
  data: undefined,
  error: null,
  isFetching: false,
  updatedAt: 0,
})

export function serializeKey(key: QueryKey): string {
  // JSON.stringify silently turns `undefined` into `null` inside an array —
  // `["a", undefined]` and `["a", null]` would otherwise serialise
  // identically and collide into one cache entry, even though the `QueryKey`
  // type allows both as distinct segments.
  return JSON.stringify(key.map((part) => (part === undefined ? '\u0000undefined' : part)))
}

function keyStartsWith(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false
  return prefix.every((part, i) => part === key[i])
}

function buildSnapshot(entry: CacheEntry): QuerySnapshot<unknown> {
  return { data: entry.data, error: entry.error, isFetching: entry.isFetching, updatedAt: entry.updatedAt }
}

function getOrCreateEntry(key: QueryKey): CacheEntry {
  const id = serializeKey(key)
  const existing = cache.get(id)
  if (existing) return existing

  const entry: CacheEntry = {
    key,
    data: undefined,
    error: null,
    isFetching: false,
    updatedAt: 0,
    staleTime: DEFAULT_STALE_TIME,
    generation: 0,
    pending: null,
    fetcher: null,
    listeners: new Set(),
    snapshot: DISABLED_SNAPSHOT,
  }
  entry.snapshot = buildSnapshot(entry)
  cache.set(id, entry)
  return entry
}

function notify(entry: CacheEntry): void {
  entry.snapshot = buildSnapshot(entry)
  for (const listener of entry.listeners) listener()
}

/** An entry that has never completed a fetch, or is sitting on a failed one,
 * is always stale — the second half is what makes task 5.3's "automatic
 * retry when connectivity returns even for queries currently in the error
 * state" true without any special-casing at the call site. */
function isStale(entry: CacheEntry): boolean {
  return entry.error !== null || entry.updatedAt === 0 || Date.now() - entry.updatedAt >= entry.staleTime
}

export function getSnapshot<T>(key: QueryKey | null): QuerySnapshot<T> {
  if (key === null) return DISABLED_SNAPSHOT as QuerySnapshot<T>
  return getOrCreateEntry(key).snapshot as QuerySnapshot<T>
}

/** `useSyncExternalStore`'s `subscribe`. A `null` key returns a no-op
 * unsubscribe and touches the cache not at all — requirement 4, "must not
 * fetch and must not throw", satisfied by there being nothing to fetch or
 * throw from. */
export function subscribeKey(key: QueryKey | null, listener: () => void): () => void {
  if (key === null) return () => {}
  const entry = getOrCreateEntry(key)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
  }
}

function runFetch(entry: CacheEntry, fetcher: () => Promise<unknown>): Promise<void> {
  const generation = entry.generation
  entry.isFetching = true
  notify(entry)

  // `fetcher()` is called synchronously, in the same tick as `ensureFetch` —
  // that is what makes the dedup test observable without an `await`: two
  // calls in the same tick must see the *call* happen once, not just its
  // eventual resolution. `Promise.resolve(...)` around it (rather than
  // `.then(() => fetcher())`, which would defer the call itself by a
  // microtask) still catches a fetcher that throws synchronously instead of
  // returning a rejected promise, without deferring anything.
  let started: Promise<unknown>
  try {
    started = Promise.resolve(fetcher())
  } catch (err) {
    started = Promise.reject(err)
  }

  const promise = started
    .then((data) => {
      // A newer generation means invalidate/setQueryData/clear landed while
      // this request was in flight — its answer is older than what the
      // cache already holds, so it loses rather than clobbers.
      if (entry.generation !== generation) return
      entry.data = data
      entry.error = null
      entry.updatedAt = Date.now()
    })
    .catch((err: unknown) => {
      if (entry.generation !== generation) return
      entry.error = err instanceof Error ? err : new Error(String(err))
    })
    .finally(() => {
      if (entry.pending?.generation === generation) entry.pending = null
      if (entry.generation === generation) entry.isFetching = false
      notify(entry)
    })

  entry.pending = { generation, promise }
  return promise
}

/**
 * Called on mount and whenever the (key, enabled) pair changes. Fetches only
 * when there is nothing to show yet or what's cached has gone stale — a
 * fresh, non-stale entry renders immediately with no network call, which is
 * requirement 2's "cached value renders immediately" half. Joins an
 * in-flight request for the same generation rather than issuing a second
 * one, which is requirement 1's dedup.
 */
export function ensureFetch<T>(key: QueryKey, fetcher: () => Promise<T>, staleTime: number): void {
  const entry = getOrCreateEntry(key)
  entry.fetcher = fetcher as () => Promise<unknown>
  entry.staleTime = staleTime

  if (entry.pending && entry.pending.generation === entry.generation) return // an identical request is already in flight
  if (entry.data !== undefined && !isStale(entry)) return // fresh cache, nothing to do

  void runFetch(entry, fetcher as () => Promise<unknown>)
}

/**
 * The imperative `refetch()` a `useQuery` caller gets back. Clears a cached
 * error immediately, before the retry's outcome is known — requirement 7 —
 * rather than leaving the old error visible while a background attempt that
 * might repeat it runs.
 */
export function refetch<T>(key: QueryKey, fetcher: () => Promise<T>): void {
  const entry = getOrCreateEntry(key)
  entry.fetcher = fetcher as () => Promise<unknown>
  if (entry.error) {
    entry.error = null
    notify(entry)
  }
  if (entry.pending && entry.pending.generation === entry.generation) return
  void runFetch(entry, fetcher as () => Promise<unknown>)
}

/**
 * Refetches every *mounted* query whose key starts with `prefix`. An
 * unmounted match is marked stale instead of fetched — bumping its
 * generation (so a response already in flight for it cannot land afterwards)
 * and zeroing `updatedAt` (so its next mount fetches rather than trusting
 * data an action just invalidated) — because there is no listener to hand
 * the result to yet.
 *
 * `prefix: []` matches every entry, the same way an empty key would match
 * every string under a naive `startsWith` — intentional, not a footgun to
 * guard against: it is the "invalidate everything" case, e.g. sign-out
 * before `clearQueryCache` was written, or a schema-wide change.
 */
export function invalidate(prefix: QueryKey): void {
  for (const entry of cache.values()) {
    if (!keyStartsWith(entry.key, prefix)) continue
    entry.generation++
    entry.updatedAt = 0
    if (entry.listeners.size > 0 && entry.fetcher) {
      void runFetch(entry, entry.fetcher)
    } else {
      notify(entry)
    }
  }
}

/**
 * Seeds the cache directly — an optimistic update after a mutation, or a
 * server action's response written straight into the read it corresponds to.
 * Bumps the generation for the same reason `invalidate` does: a fetch that
 * started before the mutation must not resolve afterwards and overwrite it.
 *
 * The updater form can't distinguish "T is itself a function" from "T is an
 * updater for T" — the same limitation every hook with this shape has (React's
 * own `setState` included). Not a concern for this app's data: rides, clubs,
 * postcards and profiles are never function-typed.
 */
export function setQueryData<T>(key: QueryKey, updater: T | ((prev: T | undefined) => T)): void {
  const entry = getOrCreateEntry(key)
  const next =
    typeof updater === 'function' ? (updater as (prev: T | undefined) => T)(entry.data as T | undefined) : updater
  entry.generation++
  entry.data = next
  entry.error = null
  entry.updatedAt = Date.now()
  notify(entry)
}

/**
 * Sign-out (task 4.5). Resets every entry **in place** rather than deleting
 * it from the map: a component still subscribed at the instant this runs
 * (e.g. mid unmount-teardown) re-renders into the empty state through its
 * existing subscription, instead of that subscription pointing at an object
 * nothing will ever notify again. Bumping every generation discards any
 * fetch in flight, so rider A's response cannot land in rider B's session —
 * see task 4.6.
 */
export function clearQueryCache(): void {
  for (const entry of cache.values()) {
    entry.generation++
    entry.data = undefined
    entry.error = null
    entry.isFetching = false
    entry.updatedAt = 0
    entry.pending = null
    notify(entry)
  }
}

/**
 * Shared by the focus and online handlers in `connectivity.ts`, so both obey
 * the same "stale AND mounted" rule rather than each re-implementing it —
 * task 5.11's "foregrounding revalidates the visible screen" and task 5.3's
 * reconnect retry are the same sweep, triggered by two different events.
 * `isStale` already treats an error as always-stale, which is what makes a
 * failed read retry automatically here without a separate branch for it.
 */
export function refetchStaleMountedQueries(): void {
  for (const entry of cache.values()) {
    if (entry.listeners.size === 0) continue
    if (!entry.fetcher) continue
    if (!isStale(entry)) continue
    if (entry.pending && entry.pending.generation === entry.generation) continue
    void runFetch(entry, entry.fetcher)
  }
}

/** The `isLoading`/`isRefetching` split `useQuery` returns — pulled out as a
 * pure function so it has its own test independent of React. `isLoading` is
 * true only when there is nothing to show yet; once any data has landed,
 * a background refetch is `isRefetching`, not `isLoading`, so a revalidating
 * screen doesn't flash back to a full-page spinner. */
export function deriveLoadingFlags(snapshot: QuerySnapshot<unknown>): {
  isLoading: boolean
  isRefetching: boolean
} {
  return {
    isLoading: snapshot.data === undefined && snapshot.isFetching,
    isRefetching: snapshot.data !== undefined && snapshot.isFetching,
  }
}
