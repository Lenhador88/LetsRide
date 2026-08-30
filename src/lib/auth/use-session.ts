'use client'

import { useSyncExternalStore } from 'react'
import {
  getGuardSnapshot,
  getServerGuardSnapshot,
  subscribeGuardCache,
} from '@/lib/auth/guard-cache'

/**
 * Is there a session? `undefined` until the guard's first read lands.
 *
 * ## Why a screen would ever ask
 *
 * Almost none do. Every route but `/legal/*` and the auth screens is behind the
 * route guard, so a mounted screen has a session by construction and asking
 * would be asking a question with one answer. `/rides/join` (`091`, PD-330) is
 * the first screen in this app that a stranger can open, and it has to draw two
 * genuinely different things: a generic invite and two buttons for a visitor
 * with no session, and the ride's preview for a rider with one.
 *
 * ## Why the guard cache rather than a read of its own
 *
 * `guard-cache.ts` is already the single writer of session state — it holds the
 * session for the page load and takes `onAuthStateChange` as its only source —
 * so a second reader costs nothing and cannot disagree with the guard about
 * whether somebody is signed in. A component calling `auth.getUser()` itself
 * would be a second answer to the same question, arriving a round trip later,
 * and it would put a Supabase call in a component, which this app does not do.
 *
 * **It reads no stamps and makes no decision.** `resolveDestination` owns every
 * routing consequence of a session, including sending a rider mid-wizard out of
 * this screen; this answers the one thing the screen needs in order to know
 * whether it may issue its read.
 *
 * `undefined` is "not yet" here as everywhere else, and it is barely reachable:
 * `RouteGuard` renders the splash instead of children until it has decided, so
 * a screen asking this has almost always been mounted after the answer landed.
 */
export function useSignedIn(): boolean | undefined {
  return useSyncExternalStore(
    subscribeGuardCache,
    () => getGuardSnapshot().signedIn,
    () => getServerGuardSnapshot().signedIn
  )
}
