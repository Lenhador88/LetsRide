'use client'

import { useSyncExternalStore } from 'react'
import { authNotice } from '@/lib/auth/notices'

/**
 * Nothing to subscribe to: the `?error=` code is fixed for the life of the
 * mount. A rider arriving with a different one arrives by navigation, which
 * re-renders the screen and re-reads the snapshot.
 */
function subscribe(): () => void {
  return () => {}
}

/**
 * `null` during the prerender pass, which has no `window` — the same thing an
 * ordinary visit renders, so there is nothing for hydration to disagree about.
 */
function serverSnapshot(): null {
  return null
}

function clientSnapshot(): string | null {
  return authNotice(new URLSearchParams(window.location.search).get('error'))
}

/**
 * The message for the `?error=` code this screen was redirected in with, or
 * `null` on an ordinary visit.
 *
 * **`useSyncExternalStore` rather than an effect or `useSearchParams`**, and
 * both alternatives were tried first:
 *
 * - An effect writing state is a synchronous `setState` on every mount of both
 *   auth screens, for a value that is null on all but a redirected visit. ESLint
 *   refuses it outright (`Calling setState synchronously within an effect`).
 * - `useSearchParams` would need a `<Suspense>` boundary around each screen,
 *   whose fallback becomes the *prerendered* markup under `output: 'export'` —
 *   which `scripts/native/check-export.mjs` reads, and which every ordinary
 *   visit would then flash through.
 *
 * The snapshot is a constant from `AUTH_NOTICES`, so its identity is stable
 * across renders and React does not loop.
 */
export function useAuthNotice(): string | null {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
}
