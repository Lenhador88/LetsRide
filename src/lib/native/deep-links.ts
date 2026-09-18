import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { canonicalOrigin } from '@/lib/origin'
import { legacyRouteTarget } from '@/lib/legacy-routes'
import { safeNext } from '@/lib/auth/recovery'

/**
 * A universal link, arriving in the running shell — PD-205.
 *
 * ## What iOS has already done by the time this file runs
 *
 * The entitlement (`ios/App/App/App.entitlements`) makes iOS fetch
 * `https://app.letsride.social/.well-known/apple-app-site-association` at
 * install time. From then on a tap on any `https://app.letsride.social/…` link
 * launches or foregrounds this app instead of Safari, and iOS delivers the URL
 * as an `NSUserActivity`.
 *
 * **The Swift side is already wired and no file under `ios/` needed changing
 * for it.** `SceneDelegate.swift` forwards `scene(_:continue:)` and
 * `scene(_:willConnectTo:options:)` to `SceneDelegateProxy.shared`, which is
 * Capacitor's own dispatcher — so the activity reaches the bridge, which turns
 * it into the `appUrlOpen` event this file listens for. Worth stating because
 * the obvious assumption is the opposite one: the APNs half of this app *did*
 * need hand-written delegate methods (`AppDelegate.swift` §APNs), for the
 * different reason that remote-notification registration has no scene
 * equivalent.
 *
 * ## Why the decision is a pure function
 *
 * `RouteGuard` and `boot-restore.ts` set the pattern and the reason is the
 * same: this container has no device and never will, so the only honest way to
 * verify any of it is to make the decision testable without one.
 * `deepLinkTarget` is a string-to-string function over the URL; the plugin
 * subscription below is the part that cannot be tested here, and it is
 * deliberately three lines with no logic in it.
 *
 * ## What it must not do
 *
 * - **Never navigate off a URL this app does not own.** The `appUrlOpen` event
 *   also fires for custom-scheme URLs, and a future plugin or an OAuth
 *   round-trip can deliver one. An origin that is not `canonicalOrigin()`
 *   answers `null` and the app stays where it is.
 * - **Never widen the guard's public paths.** A deep link into a protected
 *   route is handed to `RouteGuard` like any other navigation and bounces to
 *   `/auth/login` for a rider with no session. That is correct, and carrying
 *   the rider onward after they sign in is separate work — it needs the guard
 *   to see the query string, which `resolveDestination(pathname, state)` does
 *   not take.
 * - **Never assume the path is one the bundle prerendered.** A legacy
 *   `/postcards/<uuid>` link — the shape `ShareButton` handed out before
 *   PD-142, and the shape still sitting in people's messages — resolves on the
 *   web through `next.config.ts`'s `redirects()`. There is no server in a
 *   bundle to run one, so this maps it itself, from the same table
 *   (`src/lib/legacy-routes.ts`). Without that, shipping universal links would
 *   make those links *worse* than leaving them in the browser.
 */

/**
 * Where a deep link at `url` should put the app, or `null` to ignore it.
 *
 * `origin` is injected rather than read, so the negative cases can be exercised
 * without a build-time environment variable. Callers pass `canonicalOrigin()`.
 */
export function deepLinkTarget(url: string, origin: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // A malformed URL is not an error to report: the event is fire-and-forget
    // and there is no rider waiting on an answer. Ignoring it leaves the app
    // exactly where the rider left it.
    return null
  }

  // `URL.origin` compares scheme, host and port in one go, already normalised —
  // so `https://APP.letsride.social` matches and `http://app.letsride.social`,
  // `https://app.letsride.social.evil.com` and `capacitor://localhost` do not.
  // Comparing hostnames instead would accept the plain-HTTP one, which is the
  // form a downgrade attack has to use.
  if (parsed.origin !== origin) return null

  const legacy = legacyRouteTarget(parsed.pathname, parsed.search)
  const target = legacy ?? `${parsed.pathname}${parsed.search}${parsed.hash}`

  // **The origin matching is not enough, and this is the case that proves it.**
  // `https://app.letsride.social//evil.com/x` has our origin exactly — it is a
  // link on the trusted host — and a pathname of `//evil.com/x`. Handed to
  // `router.replace`, Next reads a protocol-relative path as an EXTERNAL url
  // and calls `location.replace('https://evil.com/x')`: the webview leaves the
  // app, with no address bar to show where it went.
  //
  // `safeNext` is the repo's existing answer to exactly this shape — it is what
  // guards the `next` parameter on `/auth/confirm` and `/auth/callback` — so it
  // is reused rather than re-spelled. Same rule, one definition, one set of
  // tests: a fix to either flows to both.
  //
  // **It is very slightly over-strict here, and that is the direction to err
  // in.** `safeNext` rejects any backslash anywhere, while `URL` folds `\` to
  // `/` only inside the *path* of a special scheme — so a literal backslash in
  // a query or fragment survives parsing and is refused here while the same URL
  // resolves on the web. The link does nothing rather than doing something
  // wrong, and no URL this app generates contains one.
  return safeNext(target)
}

/**
 * Call `onTarget` for every deep link that opens this app while it is running.
 *
 * Resolves to an unsubscribe function. **On the web it resolves to a no-op and
 * subscribes to nothing** — the plugin's web implementation reports browser
 * page state, which this app has no use for, and the `appUrlOpen` event cannot
 * fire there at all.
 *
 * **This covers a cold start too, and the obvious reading — that it cannot —
 * is wrong in a way worth writing down.** Capacitor 8.5.0 does not drop the
 * launch activity: `CAPSceneDelegateProxy.swift` defers
 * `connectionOptions.userActivities` to `capacitorViewDidAppear` precisely
 * because plugins have not loaded yet at `willConnectTo`, and `AppPlugin.swift`
 * posts it with `retainUntilConsumed: true`. So the event is held until the
 * first JS listener exists and is then delivered to it.
 *
 * **`boot-restore.ts` is NOT the cold-start half of this**, which is the other
 * direction of the same mistake. A cold-started webview boots at the
 * *configured start URL*, so `window.location.pathname` is `/` and
 * `bootRestoreTarget` answers `null`; it exists for a webview **process
 * restore**, where the URL really is the deep one and the served document is
 * the root's. The two modules answer different questions and neither is a
 * fallback for the other.
 *
 * **One consequence of `retainUntilConsumed`, dev-only but confusing by hand:**
 * the first `addListener` consumes the retained event, so a React strict-mode
 * double-mount consumes it on the subscription that is about to be torn down
 * and the surviving one receives nothing. A cold-start deep link can therefore
 * look flaky in development and be correct in a release build.
 */
export async function subscribeToDeepLinks(
  onTarget: (target: string) => void
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {}

  const handle = await App.addListener('appUrlOpen', ({ url }) => {
    const target = deepLinkTarget(url, canonicalOrigin())
    if (target) onTarget(target)
  })

  return () => {
    void handle.remove()
  }
}
