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

const RESTORE_KEY = 'letsride:boot-restore'

/**
 * Has this boot already tried to restore `target`? Records it if not.
 *
 * One restore per target per **boot**, so a target whose own payload cannot be
 * fetched degrades to a blank screen rather than to a reload loop. Not per
 * webview session: `clearRestoreAttempt` is what makes the difference, and
 * without it this is a ban rather than a bound.
 *
 * **The record has to outlive the document, which is why this is storage and not
 * a module-scope flag.** The loop being bounded is not a second mount: it is
 * Next answering a missing RSC payload with a hard navigation, which builds a
 * *new* document and resets anything held in module scope — so a flag would be
 * in force only in the one case that cannot loop, and absent from the case it
 * was written for. `sessionStorage` is per webview session and is cleared with
 * it, which is exactly the lifetime of "this boot".
 *
 * Reachable input, so this is not theoretical: a legacy `/rides/<uuid>` link —
 * the shape `LEGACY_DETAIL_REDIRECTS` exists because those are already in the
 * wild — arriving as a deep link into the shell, where no server redirect can
 * run and no payload was ever emitted. Latent until a platform exists (PD-95),
 * wrong the day one does.
 *
 * **Fails open.** A webview with storage denied loses the guard, not the
 * restore: degrading to the pre-guard behaviour is better than a shell that
 * cannot open a deep link at all.
 *
 * **It records an *attempt*, and `clearRestoreAttempt` is what makes it not a
 * ban.** Without the clear, the guard cannot tell a restore that failed from one
 * that worked, and refuses the second — so a rider who opens a deep link, uses
 * the app, and opens the same link again gets a blank screen on a link that
 * worked a minute earlier. The record also outlives sign-out, since
 * `clearSessionStore` sweeps `localStorage` and the resolved store and never
 * touches `sessionStorage`.
 */
export function restoreAlreadyAttempted(storage: Storage, target: string): boolean {
  try {
    if (storage.getItem(RESTORE_KEY) === target) return true
    storage.setItem(RESTORE_KEY, target)
    return false
  } catch {
    return false
  }
}

/**
 * Forget the recorded attempt, because it succeeded.
 *
 * The caller signals success by *unmounting* `/` — a client-side replace that
 * works takes the root page off the screen, while the failure being bounded
 * (a hard navigation onto a document that was never emitted) tears the document
 * down without running React cleanup. So the record survives precisely the case
 * it exists for.
 */
export function clearRestoreAttempt(storage: Storage): void {
  try {
    storage.removeItem(RESTORE_KEY)
  } catch {
    // Same direction as the write: a denied store loses the guard, not the app.
  }
}
