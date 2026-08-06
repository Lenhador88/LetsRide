import { refetchStaleMountedQueries } from './queryClient'

/**
 * The window/document/navigator boundary for `lib/query/` — see
 * `queryClient.ts`'s header for why the rest of the directory stays free of
 * it. Every reference to those globals lives inside a function here, never
 * at module scope, so importing this file during a server render (still
 * happening throughout Phase 4 — see `lib/supabase/resolve.ts`) is safe.
 *
 * Registered **once per module**, not once per `useQuery` mount — a screen
 * with a dozen live queries must not attach a dozen `visibilitychange`
 * listeners all doing the same global sweep. `useQuery`'s mount effect calls
 * `attachConnectivityListeners()` unconditionally; the flag below is what
 * makes every call after the first a no-op.
 */
let attached = false

function handleVisibilityChange(): void {
  // Hiding the tab is not a signal to do anything — only becoming visible
  // again is, matching task 5.11's "foregrounding revalidates".
  if (document.visibilityState === 'visible') refetchStaleMountedQueries()
}

function handleOnline(): void {
  refetchStaleMountedQueries()
}

export function attachConnectivityListeners(): void {
  if (attached || typeof document === 'undefined') return
  attached = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('online', handleOnline)
}

/**
 * Exported for tests, which need the module-level `attached` flag reset
 * between cases — production never calls this, since the listeners are
 * meant to live for the app's lifetime once the first query mounts.
 */
export function detachConnectivityListeners(): void {
  if (!attached) return
  attached = false
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('online', handleOnline)
}

/** `true` when `navigator` is unavailable (SSR) — matches `getServerSnapshot`
 * in `useOnlineStatus`, which assumes online rather than flashing an offline
 * state on every server render. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}
