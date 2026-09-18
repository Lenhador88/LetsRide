'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeToDeepLinks } from '@/lib/native/deep-links'

/**
 * Puts the running app on the path a universal link names — PD-205.
 *
 * Renders nothing, ever. It is mounted for its effect, in the root layout
 * beside `UpdateGate`, because a deep link can arrive on any screen and must be
 * honoured from all of them.
 *
 * ## Why `replace` and not `push`
 *
 * `boot-restore.ts`'s reasoning, one case over: the screen the rider was on
 * when they tapped a link in another app is not a place the back button should
 * return them to *through* the link. Replacing keeps the history stack the one
 * the rider built by navigating.
 *
 * ## Why this does not decide anything about auth
 *
 * It hands the path to the router, and `RouteGuard` decides exactly as it does
 * for a tap inside the app — including bouncing a rider with no session to
 * `/auth/login`. A deep link is not a credential and must not be treated as
 * one; `src/lib/native/deep-links.ts` carries the rest of that argument.
 *
 * ## Mounted outside `UpdateGate`, which is deliberate
 *
 * `UpdateGate` unmounts the whole app when the build is too old to run, and a
 * blocked build should not be silently navigating in the background — but nor
 * should a deep link be *lost* if it arrives while that screen is up. Neither
 * matters enough to nest this inside the gate: the listener costs nothing when
 * no link arrives, and on a blocked build the navigation is invisible under a
 * screen that covers it.
 */
export function DeepLinkListener() {
  const router = useRouter()

  useEffect(() => {
    // The subscription is asynchronous, so the effect can be cleaned up before
    // it exists. `cancelled` is what stops a listener being registered onto an
    // unmounted component — `unsubscribe` alone cannot, because there is
    // nothing to call yet at the moment cleanup runs.
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    subscribeToDeepLinks((target) => router.replace(target))
      .then((off) => {
        if (cancelled) {
          off()
          return
        }
        unsubscribe = off
      })
      // Swallowed on purpose, and the module's own doctrine is the argument:
      // a deep link that does not work is not an error to report, because
      // there is no rider waiting on an answer and the app is already on a
      // valid screen. The realistic rejection is the plugin not being
      // registered in the native project, which is a build-time mistake that
      // `npx cap sync` fixes and that no amount of runtime reporting would —
      // and without this, it arrives in Sentry as a bare unhandled rejection
      // with no context at all.
      .catch(() => {})

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [router])

  return null
}
