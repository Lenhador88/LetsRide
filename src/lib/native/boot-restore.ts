/**
 * A cold start at a non-root URL, inside the native shell.
 *
 * ## The mechanism, read out of the vendors' own source
 *
 * Capacitor answers **every extensionless path with the root `index.html`**, on
 * both platforms — not `<path>/index.html`, not `<path>.html`, the root
 * document, whatever was asked for:
 *
 * - iOS — `Router.swift`, `CapacitorRouter.route(for:)`:
 *   `if pathUrl.pathExtension.isEmpty { return basePath + "/index.html" }`
 * - Android — `WebViewLocalServer.java`, `handleLocalRequest()`:
 *   `if (path.equals("/") || (!lastPathSegment.contains(".") && html5mode))` →
 *   `basePath + "/index.html"`
 *
 * So the per-route documents the export produces are never served by Capacitor
 * at all. A launch at `/rides/detail?id=…` — a deep link, a webview process
 * restore, a notification tap — loads the document for `/`, and Next boots
 * **`/`'s route tree** while the browser sits at the deep link's URL.
 *
 * `usePathname()` still reports the real URL, so the route guard decides
 * correctly and RLS is untouched; what renders is `src/app/page.tsx`, which
 * returns `null`. The rider gets a blank screen with the right address bar.
 *
 * Measured from Next 16.2.9's own `create-initial-router-state.js`, which is
 * where the two halves of that sentence come from:
 *
 *     const canonicalUrl = location ? createHrefFromUrl(location) : initialCanonicalUrl
 *
 * ## Why this is a pure function and where it is called
 *
 * The decision is one comparison, and it is the whole of the fix — so it is
 * separated from the effect that acts on it, exactly as `resolveDestination` is
 * separated from `RouteGuard`. This container has no device and never will, so
 * the only honest way to verify any of it is to make the decision testable.
 *
 * The caller is `src/app/page.tsx`. That placement is load-bearing rather than
 * convenient: `/`'s page component mounts **only when `/`'s tree is the tree
 * that rendered**, which is precisely the condition being detected. Putting it
 * in the root layout instead would fire it on every route, where it can only be
 * a no-op or a bug.
 *
 * ## What it must not disturb
 *
 * - **Zero behaviour change on the web.** On a deployment, `/`'s document is
 *   served for `/` and for nothing else, so `pathname` is always `'/'` here and
 *   this always answers `null`. The legacy redirects added by PD-142 are server
 *   redirects, so the browser has already moved to `/rides/detail` before any
 *   document loads.
 * - **`RouteGuard` still decides first.** It renders the splash *instead of*
 *   children until it has an answer, so this cannot run before the guard has
 *   already allowed the current path. A deep link into a protected route
 *   therefore lands on the guard and goes to `/auth/login` — correct behaviour,
 *   and the reason a post-auth destination is a separate piece of work rather
 *   than a new public path.
 * - **No existence oracle.** It consults nothing — not a list of ids, not a list
 *   of routes, not the database. It is a string comparison on the URL's own
 *   shape, which is what makes "a private club you may not see" and "a club that
 *   was never real" reach the same screen by the same road.
 */

/**
 * Where a boot at `url` should be sent, or `null` when it is already home.
 *
 * `null` is "the served document matches the URL", which on the web is always
 * true and in the shell is true only for `/` itself.
 */
export function bootRestoreTarget(url: {
  pathname: string
  search: string
  hash: string
}): string | null {
  if (url.pathname === '/') return null
  return `${url.pathname}${url.search}${url.hash}`
}
