import { normaliseConfiguredOrigin } from '@/lib/origin-normalise'

/**
 * The origin to build a URL from when that URL **leaves the app**.
 *
 * ## Why this is not `window.location.origin`
 *
 * On the web those are the same thing, and that is the point of the default
 * below. Inside the native shell they are not: the webview's origin is
 * `https://localhost` (the `androidScheme: 'https'` in `capacitor.config.ts`) or
 * `capacitor://localhost`, so every URL built from it is dead the moment it
 * leaves the device.
 *
 * Two of the three call sites are worse than a dead link. `signUp` and
 * `requestPasswordReset` hand their URL to GoTrue as `emailRedirectTo` /
 * `redirectTo`, and **an unlisted origin is discarded silently rather than
 * refused** — measured against the live PROD auth server on 2026-08-12 with the
 * credential-free probe in `docs/ENVIRONMENTS.md` §The redirect allowlist:
 *
 * | `redirect_to` sent | GoTrue's `location:` |
 * |---|---|
 * | `https://app.letsride.social/auth/callback` | the same URL |
 * | `https://localhost/auth/callback` | `https://app.letsride.social` |
 * | `capacitor://localhost/auth/callback` | `https://app.letsride.social` |
 *
 * **The discard drops the path with the origin.** A rider from a shell build
 * does not land on `/auth/callback` with an error to read — they land on the
 * app root, with no `next` param and the failure only in the URL fragment,
 * which nothing in the app ever reads. A rider who installs the app and cannot
 * confirm their signup never reaches the product at all, and nothing on the
 * sending side can see it happening.
 *
 * ## Why the default is the runtime origin
 *
 * So the **web build is unchanged by construction rather than by review**. With
 * `NEXT_PUBLIC_CANONICAL_ORIGIN` unset this returns exactly what the three call
 * sites read before, on every host that serves the app — production, DEV, a
 * per-deployment Vercel preview alias, and a local dev server — which is what
 * makes the redirect allowlist's wildcard entries keep working. Only the bundle
 * overrides it, and for the bundle it is **required**: `next.config.ts` fails a
 * `CAPACITOR_BUILD=1` build when it is unset, because there is no sensible
 * runtime default inside a shell and failing closed is what stops a binary
 * shipping with dead links in it.
 *
 * `process.env.NEXT_PUBLIC_CANONICAL_ORIGIN` is written as a full member
 * expression on purpose: Next only inlines a statically analysable one, and a
 * destructured or computed read becomes `undefined` in the bundle with nothing
 * to notice it.
 *
 * **This is not a sweep of every `window.location` in the app.** An origin that
 * never leaves the process — a `router.replace`, a `boot-restore` target — must
 * stay the runtime one, or the app would navigate itself off the device.
 */
export function canonicalOrigin(): string {
  // Shared with `next.config.ts`'s two build guards rather than spelled twice —
  // see `origin-normalise.ts` for the two bugs that came from spelling it twice.
  const configured = normaliseConfiguredOrigin(process.env.NEXT_PUBLIC_CANONICAL_ORIGIN)

  // An empty or whitespace-only value falls through to the runtime origin
  // rather than producing `''`, which would build a same-origin *relative* URL
  // — silently correct on the web and silently `https://localhost/...` in the
  // shell, i.e. exactly the bug this function exists to remove, wearing a
  // configured-looking value. `"/"` is the same case and the one that got
  // through review twice: it trims to something and normalises to nothing.
  return configured ? configured : window.location.origin
}
