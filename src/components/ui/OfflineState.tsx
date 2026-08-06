'use client'

import { useSyncExternalStore } from 'react'
import { isOnline } from '@/lib/query/connectivity'

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)
  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

/**
 * Raw connectivity, for anything that wants to react to it without the
 * banner below — e.g. disabling a submit control while offline. Colocated
 * with `OfflineState` rather than under `lib/query/`, the same way
 * `useBanner` is colocated with `Banner` rather than split into its own
 * file: one export a caller needs, one import.
 *
 * `getServerSnapshot` always reports online — matching `isOnline()`'s own
 * SSR default in `lib/query/connectivity.ts` — so hydration never has to
 * reconcile a mismatch; `useSyncExternalStore` re-renders on its own the
 * moment the real value is available client-side.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}

/**
 * Renders only while the device is actually offline (task 5.3). Nothing has
 * to poll it back away: `lib/query/connectivity.ts` retries every stale
 * mounted query — including one sitting in an error state — on the same
 * `online` event this banner listens for, so the banner and the data behind
 * it recover together.
 */
export function OfflineState({ children }: { children?: React.ReactNode }) {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-foreground px-4 py-2 text-center text-xs font-medium text-white"
    >
      {children ?? "You're offline — we'll try again once you're back."}
    </div>
  )
}
