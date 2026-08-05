'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { attachConnectivityListeners } from '@/lib/query/connectivity'
import {
  DEFAULT_STALE_TIME,
  deriveLoadingFlags,
  ensureFetch,
  getSnapshot,
  refetch as refetchEntry,
  serializeKey,
  subscribeKey,
  type QueryKey,
  type QuerySnapshot,
} from '@/lib/query/queryClient'

export type UseQueryResult<T> = {
  data: T | undefined
  error: Error | null
  isLoading: boolean
  isRefetching: boolean
  refetch: () => void
}

export type UseQueryOptions = {
  enabled?: boolean
  staleTime?: number
}

/** Stable for the app's whole lifetime — `getSnapshot(null)` always returns
 * the same frozen object (see `queryClient.ts`), so there is nothing
 * per-render to close over. This is what `useSyncExternalStore` renders
 * during a server pass and during the client's hydration pass, so both sides
 * agree with nothing ever having fetched — the disabled state, not "loading". */
function getServerSnapshot<T>(): QuerySnapshot<T> {
  return getSnapshot<T>(null)
}

/**
 * The one hook every screen reads through once its render moves client-side —
 * `openspec/changes/migrate-to-client-rendered-shell` tasks 5.2–5.11. It is a
 * thin wrapper: everything that decides *what* to do lives in
 * `queryClient.ts`, a plain module with no React import, which is what makes
 * that logic testable under Vitest's `node` environment (see
 * `__tests__/queryClient.test.ts`) without a rendered component.
 *
 * `useSyncExternalStore` is what gives requirement 5 (no `setState` after
 * unmount) for free, by construction rather than by care: React only ever
 * calls a *currently subscribed* component's `onStoreChange`, and the
 * function `subscribeKey` returns is exactly what tells it to stop being
 * subscribed. The fetch itself does not know or care whether anything is
 * still listening — it resolves into the cache either way, which is the
 * other half of requirement 5 and is proven directly in
 * `queryClient.test.ts` without needing a rendered tree at all.
 *
 * **Never call the returned `fetcher` during render.** This hook doesn't —
 * `ensureFetch` only ever runs inside `useEffect` — and it must stay that
 * way: a client component is still server-rendered until Phase 6, and
 * `resolve.browser.ts` throws if a `lib/data/` read is attempted there. See
 * that file's header for the failure this avoids.
 */
export function useQuery<T>(
  key: QueryKey | null,
  fetcher: () => Promise<T>,
  opts: UseQueryOptions = {}
): UseQueryResult<T> {
  const { enabled = true, staleTime = DEFAULT_STALE_TIME } = opts
  const active = enabled && key !== null
  const serialized = key === null ? null : serializeKey(key)

  // Only the fetcher goes through a ref. It usually closes over component
  // state and gets a new identity every render, but the effect below must
  // re-run only for a genuinely *different query* (a new `serialized`), not
  // for that. Assigned inside a dependency-less effect rather than during
  // render — the same shape `Banner.tsx` uses for `onDismiss` — because
  // `eslint-plugin-react-hooks`'s `refs` rule rejects a `.current` write in
  // the render body outright: it breaks the "render has no side effects"
  // assumption a future React Compiler pass relies on. An effect with no
  // dependency array runs after every render, so the ref is caught up
  // before anything below reads it.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  // Deliberately NOT wrapped in useCallback. `useSyncExternalStore` calls
  // `getSnapshot` synchronously *during render*, and a ref only updates
  // inside an effect — so reading `key` through a ref here would return the
  // *previous* render's key until this render's own effects had run, which
  // is exactly the kind of read useSyncExternalStore exists to catch as
  // torn. A plain closure has no such lag: it is only ever called while it
  // is the current one, so it always closes over the key that render owns.
  const subscribe = (onStoreChange: () => void) => {
    if (!active || key === null) return () => {}
    return subscribeKey(key, onStoreChange)
  }

  const getClientSnapshot = (): QuerySnapshot<T> => getSnapshot<T>(active ? key : null)

  // Wrapped rather than passed directly: `useSyncExternalStore` cannot infer
  // this hook's own `T` through a bare reference to the generic module-level
  // `getServerSnapshot`, so it would otherwise widen the whole snapshot to
  // `unknown`.
  const getServer = (): QuerySnapshot<T> => getServerSnapshot<T>()

  const snapshot = useSyncExternalStore(subscribe, getClientSnapshot, getServer)

  useEffect(() => {
    if (!active || key === null) return
    attachConnectivityListeners()
    ensureFetch(key, () => fetcherRef.current(), staleTime)
    // `serialized`, not `key`, is the real dependency: a fresh array with
    // the same contents must not retrigger the fetch. `key` is read from
    // this effect's own closure, which always belongs to the render that
    // produced this particular `serialized` — unlike the ref case above,
    // there is no lag to guard against for a plain effect, only a
    // dependency array ESLint cannot see is content-equivalent to `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, serialized, staleTime])

  const refetch = useCallback(() => {
    if (!active || key === null) return
    refetchEntry(key, () => fetcherRef.current())
    // Same reasoning as the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, serialized])

  const { isLoading, isRefetching } = deriveLoadingFlags(snapshot)

  return {
    data: snapshot.data,
    error: snapshot.error,
    isLoading,
    isRefetching,
    refetch,
  }
}
