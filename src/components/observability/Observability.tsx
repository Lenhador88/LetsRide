'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useSyncExternalStore } from 'react'

import {
  applyAnalyticsPreference,
  capturePageview,
  initAnalytics,
} from '@/lib/analytics/client'
import { getGuardSnapshot, getServerGuardSnapshot, subscribeGuardCache } from '@/lib/auth/guard-cache'
import { getAnalyticsOptOut } from '@/lib/data/profile'
import { initErrorReporting } from '@/lib/observability/sentry'

/**
 * Where error reporting and analytics start — PD-315 and PD-353.
 *
 * ## Error reporting is at MODULE scope, and this is the one place that is right
 *
 * `CLAUDE.md` §Technology Decisions says to read in an effect and never during
 * render. That rule is about **Supabase reads**: a read issued from a component
 * body runs in the SSR pass with no `localStorage` to find a session in, so it
 * is anonymous, and `anon` holds zero grants, so it fails closed at RLS.
 * `initErrorReporting` reads nothing, touches no database and holds no session
 * — it installs `window.onerror` — so none of that applies, and it guards
 * `typeof window` itself for the prerender pass.
 *
 * What module scope buys is the window an effect cannot cover. A client chunk
 * evaluates before React's first render; an effect runs after the first commit.
 * A throw *between* those two points takes the whole app down — it is the exact
 * failure `global-error.tsx` exists for — and an effect that never ran because
 * the render before it threw cannot report the throw that stopped it. Wiring
 * this in an effect would leave the single most important error class silently
 * unreported while looking completely correct.
 *
 * ## Analytics is in an effect, and the asymmetry is deliberate
 *
 * Error reporting is racing the first render because the throw it exists to
 * catch happens there. Analytics has nothing to catch, and it is capture-off
 * until a round trip returns anyway (see `applyAnalyticsPreference`), so an
 * effect costs it nothing and keeps a third-party SDK out of the prerender pass
 * entirely. Both `init` functions are idempotent, so StrictMode's double-invoke
 * is a no-op.
 *
 * ## Why a component at all, when half the work happens at import time
 *
 * A bare `import '@/lib/observability/boot'` in the layout is legal and is what
 * a bundler is entitled to treeshake, since it has no observable value — and
 * the failure mode of that is a feature that silently does nothing, which this
 * repo has shipped once already. Rendering an element makes the import
 * load-bearing.
 *
 * Renders `null`: there is nothing to draw, and it must never be able to affect
 * layout. It sits **outside** `RouteGuard` in the root layout so that a throw
 * inside the guard itself — which renders on every route, signed in or out — is
 * already being watched by the time it happens.
 */
initErrorReporting()

export function Observability() {
  const pathname = usePathname()

  // The guard cache rather than a second `onAuthStateChange` listener or a
  // second Supabase client: it already holds the session for the page load, it
  // is documented as the single writer for that half, and `@/lib/supabase/client`'s
  // importer count is a live review heuristic that this deliberately does not move.
  const signedIn = useSyncExternalStore(
    subscribeGuardCache,
    getGuardSnapshot,
    getServerGuardSnapshot
  ).signedIn

  useEffect(() => {
    initAnalytics()
  }, [])

  useEffect(() => {
    // `undefined` is "the guard has not answered yet" — not "signed out". The
    // distinction is this repo's `null` vs `undefined` rule, and conflating it
    // here would read a boot tick as a sign-out.
    if (signedIn === undefined) return

    if (!signedIn) {
      // Nothing to read — the accessor is `security definer` on the caller's own
      // row and there is no caller. Leave capture where it starts, which is off.
      return
    }

    let cancelled = false
    // Fire-and-forget from an effect, and the failure direction is the point:
    // `getAnalyticsOptOut` THROWS when the read fails, so the catch applies
    // nothing and capture stays where it started, which is off. A network blip
    // therefore leaves a rider un-recorded rather than recorded without an
    // answer — `applyAnalyticsPreference` turns capture on for an explicit
    // `false` alone.
    void getAnalyticsOptOut()
      .then((optedOut) => {
        if (!cancelled) applyAnalyticsPreference(optedOut)
      })
      .catch(() => {
        // Deliberately silent, and deliberately not retried. The cost of a
        // missed read is one session's data; the cost of guessing is a rider
        // recorded against their stated wish.
      })

    return () => {
      cancelled = true
    }
  }, [signedIn])

  useEffect(() => {
    // **By hand, because nothing else fires one.** PostHog captures a pageview
    // on document load; this app is a client-rendered SPA, so every navigation
    // after the first is invisible without this — and the failure is silent:
    // events arrive, funnels build, and the screen dimension is simply empty.
    //
    // `pathname` and not `window.location.href`: every detail route in this app
    // carries its subject's id in `?id=`, and `usePathname` has already dropped
    // it. `capturePageview` strips it again anyway, because this is not the only
    // caller PostHog has.
    capturePageview(pathname)
  }, [pathname])

  return null
}
