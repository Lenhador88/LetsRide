'use client'

import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Button } from '@/components/ui/Button'
import { checkForcedUpdate, resolveStoreAffordance } from '@/lib/native/version-gate'

/**
 * Stops a native build that the published minimum says must not run
 * (`src/lib/native/version-gate.ts` for why this exists at all).
 *
 * ## It renders `children` until it knows otherwise
 *
 * The check is a network round trip and the app must not wait on it — a gate
 * that delayed first paint would cost every rider a boot window on every launch
 * to catch a case that has never happened. So this is not `RouteGuard`'s shape:
 * there is no third "deciding" state on screen, because the app underneath is
 * already correct and already vetted by the guard.
 *
 * The consequence is deliberate and worth stating: a rider on a blocked build
 * gets a second or two of the real app before this replaces it. That is the
 * right trade — the alternative pays a splash on every launch of every healthy
 * build to make one broken build fail a second earlier.
 *
 * ## It replaces rather than overlays
 *
 * Same reasoning as `GuardError`, and stronger here: this screen holds the only
 * control the rider is meant to press and never goes away by itself, so
 * anything left mounted underneath would keep its place in the tab order and
 * the accessibility tree behind an opaque cover. `RouteGuard` is mounted
 * *inside* this, so unmounting it takes the whole app with it — which is the
 * point of a block, and is why this sits outside the guard rather than under
 * it: a rider who is signed out or halfway through onboarding is on the same
 * broken build as everybody else.
 *
 * ## Where it is mounted
 *
 * The root layout, wrapping `RouteGuard`. Once per launch, because
 * `checkForcedUpdate` memoises for the lifetime of the document — this
 * component's effect runs on mount and nothing re-runs it on navigation.
 */
export function UpdateGate({ children }: { children: React.ReactNode }) {
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    let live = true
    // Read in an effect, never during render: this touches `window.location`
    // through `canonicalOrigin()`, and the prerender pass `output: 'export'`
    // still runs at build time has no window in it.
    void checkForcedUpdate().then((tooOld) => {
      if (live && tooOld) setBlocked(true)
    })
    return () => {
      live = false
    }
  }, [])

  if (!blocked) return <>{children}</>

  return <UpdateRequired />
}

/**
 * `role="alert"` rather than a heading landmark: this arrives *after* the app
 * has painted, so a screen-reader user is mid-screen when it replaces
 * everything, and the announcement is the whole point.
 *
 * The store affordance is a `<button>` and not `Button`'s link branch, which is
 * `next/link`. A `market://` href is external, so Link would hand the click to
 * the browser correctly — but it would also register the href for prefetching,
 * and a prefetch of a scheme the fetch layer cannot resolve is noise at best.
 * An `onClick` navigation from inside a user gesture is what Capacitor's
 * `BridgeWebViewClient.shouldOverrideUrlLoading` sees, and that is what hands
 * the URL to `Intent.ACTION_VIEW`.
 */
function UpdateRequired() {
  const affordance = resolveStoreAffordance(Capacitor.getPlatform())

  return (
    <div
      role="alert"
      className="bg-background fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-2xl font-semibold text-foreground">Time to update LetsRide</h1>
      <p className="text-sm text-muted">
        This version of the app is out of date and can no longer be used. Install the latest
        version to carry on riding.
      </p>
      {affordance.kind === 'store-link' ? (
        <Button
          onClick={() => {
            window.location.href = affordance.url
          }}
          size="md"
          className="mt-2 w-auto"
        >
          {affordance.label}
        </Button>
      ) : (
        // No button, because there is no URL to put behind one until PD-232
        // creates the App Store listing — see `APPLE_APP_ID` in
        // `version-gate.ts`. A dead button is worse than a sentence.
        <p className="text-sm text-muted">
          Open the App Store, search for LetsRide, and tap Update.
        </p>
      )}
    </div>
  )
}
