import type { NextConfig } from "next";

// The same normalisation `canonicalOrigin()` applies, imported rather than
// re-spelled: the two guards below are only fail-closed if "set" means to them
// exactly what it means to the code that reads the value. `origin-normalise.ts`
// carries the two escapes that bought this.
//
// **Relative, not the `@/` alias — and the reason is not that the alias fails
// today.** Measured on Next 16.2.9: `resolveSWCOptions` feeds tsconfig `paths`
// to SWC precisely so a TS config can use aliases, and both forms load. The
// reason is `--experimental-next-config-strip-types`, where Node's native type
// stripping does no path mapping and only the relative form survives. Stated
// because the obvious test — swap in `@/` and watch it work — argues for
// exactly the change that breaks under that loader.
import { normaliseConfiguredOrigin } from './src/lib/origin-normalise'

/**
 * Fail the build when a `NEXT_PUBLIC_SUPABASE_*` variable is missing.
 *
 * **This has to live here, because nothing else in the app can catch it.** The
 * obvious place is `lib/supabase/client.ts`, and it does guard there — but that
 * guard can only ever fire in the browser: `createClient()` is called from an
 * effect or an event handler and never during render (CLAUDE.md §Read in an
 * effect), so the prerender pass never reaches it. Measured 2026-08-06 by
 * building with the key unset: `next build` compiles, prerenders all 22 static
 * pages and exits **0**. The deployment then goes green and every screen fails
 * in the browser with supabase-js's `supabaseKey is required`, from inside a
 * dependency, naming neither the variable nor the environment.
 *
 * A green deploy of a completely broken app is the worst of the available
 * failures, and it is reachable by one wrong checkbox: splitting the Vercel
 * variables between the PROD and DEV projects briefly left Preview holding the
 * URL and not the key, which is exactly this.
 *
 * Both are `NEXT_PUBLIC_*` and therefore inlined at build time, so build time
 * is also the only honest place to assert them — a build carries whichever
 * values it was built with, permanently (docs/ENVIRONMENTS.md §Never use
 * Vercel's promote or instant-rollback to cross the boundary).
 */
const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const

const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name])

if (missingEnv.length > 0) {
  throw new Error(
    `Missing required environment ${missingEnv.length === 1 ? 'variable' : 'variables'}: ` +
      `${missingEnv.join(', ')}.\n\n` +
      'Both must be set for every environment the app builds in. On Vercel that ' +
      'is Production, Preview and Development — and a Preview variable scoped to ' +
      'a single git branch leaves every other branch without it. Locally, copy ' +
      '.env.local.example to .env.local.\n\n' +
      'See docs/ENVIRONMENTS.md.'
  )
}

/**
 * The two build shapes, and why they are two whole objects rather than one with
 * fields spliced onto it.
 *
 * `CAPACITOR_BUILD=1` produces the static bundle `capacitor.config.ts`'s
 * `webDir: 'out'` names; anything else produces the web app Vercel deploys. They
 * are written as **alternatives** so the web build is unchanged by construction
 * rather than by review — a spread with three conditional keys is one `??` away
 * from shipping `output: 'export'` to production, and that failure is a green
 * deploy of an app with no server behind it.
 *
 * `CAPACITOR_BUILD` is set in **no** Vercel target and must stay that way
 * (docs/ENVIRONMENTS.md §The native build flag). `next build` writing `out/`
 * instead of a server build is the observable symptom, and
 * `scripts/native/assert-web-build.mjs` is what turns it red in CI rather than
 * on a rider's phone.
 */
const isCapacitorBuild = process.env.CAPACITOR_BUILD === '1'

/**
 * A native build additionally requires `NEXT_PUBLIC_CANONICAL_ORIGIN`, and the
 * asymmetry with the web build is the whole design.
 *
 * `src/lib/origin.ts` defaults to `window.location.origin`, so the web build
 * keeps following whichever host served it — production, DEV, a per-deployment
 * preview alias — and needs no variable at all. Inside a bundle that runtime
 * origin is `https://localhost`, and there is no value it could sensibly fall
 * back to: a shared postcard link built from it is dead the moment it leaves
 * the device, and a signup or recovery link built from it is **discarded** by
 * GoTrue and replaced by the Site URL — path included, so the rider lands on
 * the app root with the failure in a fragment nothing reads (measured against
 * the live PROD auth server 2026-08-12, `docs/ENVIRONMENTS.md` §The redirect
 * allowlist).
 *
 * So the bundle fails closed. A binary is not a deployment: the fix for a
 * wrong origin baked into one is a new store review, which is days, and until
 * then every rider who installs it and signs up is stranded.
 *
 * **It asks `normaliseConfiguredOrigin()` rather than testing the variable, so
 * that "set" cannot mean one thing here and another in `canonicalOrigin()`.**
 * Not defensive style — the fix for two measured escapes, both of which built
 * and shipped clean off one stray character in a CI secret.
 * `src/lib/origin-normalise.ts` carries them; do not re-spell the check here.
 */
if (isCapacitorBuild && !normaliseConfiguredOrigin(process.env.NEXT_PUBLIC_CANONICAL_ORIGIN)) {
  throw new Error(
    'Missing required environment variable: NEXT_PUBLIC_CANONICAL_ORIGIN.\n\n' +
      'A CAPACITOR_BUILD=1 build needs it because the webview origin is ' +
      'https://localhost, which is on no GoTrue redirect allowlist and resolves ' +
      'to nothing off the device. The web build does not need it and must keep ' +
      'building without it.\n\n' +
      'For a release bundle:\n' +
      '  NEXT_PUBLIC_CANONICAL_ORIGIN=https://app.letsride.social npm run build:native\n\n' +
      'See docs/ENVIRONMENTS.md §The native build flag.'
  )
}

/**
 * And the mirror image: a **web** build refuses the variable rather than
 * tolerating it, closing the one hazard the variable itself introduces — set on
 * a Vercel Preview target it would have DEV and feature-branch builds email
 * confirmation links pointing at production, where the token is invalid.
 * `docs/ENVIRONMENTS.md` §The native build flag carries the full case and the
 * two commands that check both directions.
 *
 * Tolerating it would be *pointless* rather than merely risky: on the web
 * `window.location.origin` is already the host that served the app, so a
 * configured value can only ever agree with the default or contradict it.
 *
 * **This is a throw rather than a grep of the built output**, which is the
 * opposite of `assert-web-build.mjs`'s doctrine and deliberately so. That file
 * reads artifacts because a config that *says* the right thing and a build that
 * *did* it are different claims — but a throw here is stronger than either: the
 * build produces no artifact at all, so there is nothing that can ship wrong.
 * An assertion is only needed where a wrong build can still finish.
 */
if (!isCapacitorBuild && normaliseConfiguredOrigin(process.env.NEXT_PUBLIC_CANONICAL_ORIGIN)) {
  throw new Error(
    'NEXT_PUBLIC_CANONICAL_ORIGIN is set, but this is a web build.\n\n' +
      `It is set to: ${process.env.NEXT_PUBLIC_CANONICAL_ORIGIN}\n\n` +
      'The variable exists for the native bundle only. On the web, src/lib/origin.ts ' +
      'follows window.location.origin, which is already the host that served the app — ' +
      'so setting it here can only pin every deployment to one origin. On a Preview ' +
      'target that means DEV and feature-branch builds emailing signup-confirmation and ' +
      'password-recovery links that point at production, where the token is invalid.\n\n' +
      'If this is a Vercel variable, remove it from every target. If you exported it in ' +
      'your shell for a native build, run that build with CAPACITOR_BUILD=1 (npm run ' +
      'build:native).\n\n' +
      'See docs/ENVIRONMENTS.md §The native build flag.'
  )
}

/**
 * The route shapes that shipped before PD-142, kept alive for links already
 * sitting in people's messages — `ShareButton` has been handing out
 * `/postcards/<uuid>` since it was written.
 *
 * **Web only, and that is the point.** A static export has no server to run a
 * redirect, and a redirect *page* in the bundle would be a dynamic segment
 * again, which is the whole thing option B removed. So the old shape resolves on
 * `app.letsride.social` and does not exist inside the app.
 *
 * **Each `source` is constrained to a UUID, and an unconstrained one would be a
 * live bug rather than a loose end.** Redirects are matched before the
 * filesystem, so `/rides/:id` would swallow `/rides/new`, `/clubs/:id` would
 * swallow `/clubs/new` and `/clubs/explore`, and `/rides/:id` would swallow
 * `/rides/detail` itself — sending every detail screen to
 * `/rides/detail?id=detail` in a loop. Verified against the built app rather
 * than reasoned about: `assert-web-build.mjs` reads `.next/routes-manifest.json`
 * and hands the entries to `checkRedirects` in `scripts/native/export-guards.mjs`,
 * which matches on each entry's compiled `regex` — the manifest's, not this
 * file's `source` string, so it tests what Next built rather than what was
 * written. It asserts both directions: that every legacy shape redirects with a
 * 307 to the right destination, and that none of `/rides/new`, `/rides/detail`,
 * `/clubs/new`, `/clubs/explore` or `/postcards/new` is touched. Its cases,
 * including planted failures for a dropped redirect and an unconstrained
 * source, are in `scripts/native/__tests__/export-guards.test.mjs`.
 *
 * `permanent: false` (307) rather than 308: a 301/308 is cached by the browser
 * effectively for ever, and this shape has now moved once.
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

const LEGACY_DETAIL_REDIRECTS = [
  ['/postcards', ''],
  ['/rides', ''],
  ['/rides', '/crew'],
  ['/rides', '/chat'],
  ['/rides', '/edit'],
  ['/clubs', ''],
  ['/clubs', '/rides'],
  ['/clubs', '/members'],
  ['/clubs', '/about'],
  ['/clubs', '/edit'],
].map(([base, tail]) => ({
  source: `${base}/:id(${UUID})${tail}`,
  destination: `${base}/detail${tail}?id=:id`,
  permanent: false,
}))

const webConfig: NextConfig = {
  async redirects() {
    return LEGACY_DETAIL_REDIRECTS
  },
  /**
   * The one file the native shell reads from the web origin, and the one that
   * therefore needs a CORS header.
   *
   * `src/lib/native/version-gate.ts` fetches `app-version.json` from
   * `canonicalOrigin()` so a build already on a phone can be told it is too old.
   * The webview's own origin is `https://localhost` (`capacitor.config.ts`'s
   * `androidScheme`) or `capacitor://localhost` on iOS, so that is a
   * **cross-origin** read, and this app has never made one to its own web host
   * before — every other cross-origin call goes to Supabase or an Edge Function,
   * both of which answer with their own CORS headers.
   *
   * Nothing here answered with one: this config declared no `headers()` at all,
   * and files under `public/` are served as plain static assets. So the fetch
   * would have been blocked, the gate would have failed open — which is its
   * correct behaviour on any failure — and it would have done nothing, for ever,
   * with nothing red anywhere. A feature that silently no-ops is worse than an
   * absent one, because it reads as covered.
   *
   * **Scoped to the one path, and `*` is right for it.** The file holds a single
   * version string, it is already world-readable at that URL, and the shell's
   * origin is not a value this can enumerate — `capacitor://localhost` and
   * `https://localhost` differ by platform and by Capacitor version, so naming
   * them is a list that goes stale into a lockout rather than an error.
   *
   * **`webConfig` only, deliberately.** `headers()` is inert under
   * `output: 'export'` — there is no server in a bundle to send them — and the
   * bundle carries its own copy of this file anyway. It is the *deployed* copy
   * that matters, which is what an absolute origin fetches.
   *
   * Not measured against the live host: `app.letsride.social` is outside this
   * container's network policy (`connect_rejected`, 403 at CONNECT). What is
   * measured is this repo — no `headers()` existed — and the fix costs nothing
   * if the platform were somehow already sending one.
   */
  async headers() {
    return [
      {
        source: '/app-version.json',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
    ]
  },
}

const capacitorConfig: NextConfig = {
  output: 'export',
  /**
   * `next/image`'s default loader is a server route, and there is no server in a
   * bundle. Without this the export fails outright rather than degrading.
   */
  images: { unoptimized: true },
  /**
   * Deliberately **no `trailingSlash`** and **no `distDir`**, and both absences
   * are load-bearing rather than defaults nobody got round to:
   *
   * - `trailingSlash: true` breaks `src/lib/auth/guard.ts`, whose public-path
   *   list is exact-string matching, while `router.replace` normalises *towards*
   *   the slash. The guard asks for `/auth/login`, the router delivers
   *   `/auth/login/`, and `RouteGuard` renders the splash for as long as it has
   *   a destination — a permanent green screen with no login form. All 36 guard
   *   cases pass, because every one of them feeds a slashless path. It buys
   *   nothing under Capacitor either: both platform routers short-circuit on the
   *   file extension and never try `<path>/index.html`.
   * - a custom `distDir` **becomes** the export directory under
   *   `output: 'export'`, and `out/` is then never created at all — leaving
   *   `capacitor.config.ts`'s `webDir` pointing at nothing, which `cap sync`
   *   copies without complaint and which fails on a device as a white screen.
   *
   * `openspec/changes/add-static-export-bundle/design.md` §D2 and §D4 carry the
   * measurements.
   */
}

export default isCapacitorBuild ? capacitorConfig : webConfig

