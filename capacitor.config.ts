import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native shell's configuration. Written 2026-08-07; **no native project has
 * been generated from it and none can be here** — this container has no Android
 * SDK (`ANDROID_HOME` unset, no `sdkmanager`), no Xcode and no CocoaPods, so
 * `npx cap add ios` cannot finish its `pod install` and `npx cap add android`
 * would scaffold something nothing can build. Both belong on a Mac. Per
 * `.claude/agents/native.md`, this file is **written and unverified**, not
 * verified-in-container and not verified-on-device.
 *
 * ## `webDir` does not exist yet, and that is the epic's real gate
 *
 * Capacitor serves a **static** bundle from the filesystem, so `out/` has to be
 * produced by `next build` with `output: 'export'`. Measured 2026-08-07, that
 * build fails:
 *
 *     Error: Page "/postcards/[id]" is missing "generateStaticParams()"
 *     so it cannot be used with "output: export" config.
 *
 * Seven routes hit it — `/postcards/[id]`, `/rides/[id]`, `/rides/[id]/crew`,
 * `/clubs/[id]` and its three sub-routes — and none can supply
 * `generateStaticParams`, because the ids are per-rider RLS-scoped content that
 * does not exist at build time. Returning `[]` does not help: `output: 'export'`
 * forces `dynamicParams: false`, so every unknown id 404s. Resolving what shape
 * those routes take in a bundle is the prerequisite for `cap sync`, and it is a
 * routing decision with real negative cases (deep links, the guard's public-path
 * denylist, `notFound()` semantics) rather than a config tweak.
 *
 * Until then `npx cap sync` has nothing to copy. That is expected, not a
 * misconfiguration in this file.
 *
 * ## `'out'` is only right while `distDir` is untouched — read this before setting one
 *
 * `out/` is not a fixed name. Read out of `next/dist/esm/export/utils.js` and
 * `next/dist/esm/build/index.js` at the pinned 16.2.9, the export directory is
 * chosen like this (the ESM copies — the CJS `dist/build/index.js` is the same
 * logic through `(0, _utils2.hasCustomExportOutput)(config)`, so quote whichever
 * you actually opened):
 *
 *     // hasCustomExportOutput()
 *     return config.output === 'export' && config.distDir !== '.next'
 *
 *     let configOutDir = 'out'
 *     if (hasCustomExportOutput(config)) {
 *       configOutDir = config.distDir   // the export lands HERE
 *       config.distDir = '.next'        // build artifacts go back to .next
 *     }
 *
 * So under `output: 'export'` a custom `distDir` **becomes** the export
 * directory and **`out/` is never created at all**. Next's own comment says it:
 * *"when `output: export` is configured, `next build` does both steps. So the
 * user-configured distDir is actually the outDir."*
 *
 * That matters because setting a `distDir` is the obvious, correct-looking move
 * when the native export arrives — it keeps the export's build cache out of
 * `.next` so a plain `npm run build` and a native build cannot hand each other a
 * half-static cache. Doing that without changing this line leaves `webDir`
 * pointing at a directory that does not exist, and **an empty `webDir` fails at
 * launch, on a device, as a white screen** — the most expensive place in this
 * epic to find a one-word mistake. `npx cap sync` copies whatever is there and
 * does not check that it is a site.
 *
 * The rule, either way round: **`webDir` must equal `distDir` whenever one is
 * set, and `'out'` only when one is not.**
 *
 * Verified 2026-08-08 by reading the pinned Next source, not by running a native
 * build — no platform has ever run here (see the header). The mechanism came
 * from `claude/store-submission-prep-6o1q3d`, an unmerged branch that measured
 * it empirically on 2026-08-06 and found the HTML at
 * `.next-capacitor/postcards/placeholder/index.html` with no `out/` present.
 */
const config: CapacitorConfig = {
  /**
   * **Owner decision, and it is permanent.** A bundle id cannot be changed after
   * the first App Store or Play submission — a new one is a new app, with a new
   * listing and no reviews or installs carried over. Both native projects bake it
   * into their manifests, signing identities and keychain access groups, so it
   * has to be right before the first `cap add`, not before the first submission.
   *
   * `com.letsride.app` was a placeholder "chosen to be valid, not chosen by
   * anyone who owns the domain". `letsride.social` was bought 2026-08-07, so the
   * convention now has an answer: a bundle id is the owned domain reversed, which
   * makes this `social.letsride.app`. That is a real claim of ownership rather
   * than a squat on a `com.letsride` nobody holds — and Apple checks it, because
   * the same domain has to serve
   * `https://app.letsride.social/.well-known/apple-app-site-association` before
   * any universal link resolves (docs/ENVIRONMENTS.md §Domains).
   *
   * **Still a placeholder until the owner confirms it**, for one reason worth
   * writing down: the App Store Connect and Play Console records are created
   * from it, and neither can be renamed afterwards. Changing this line today
   * costs nothing — `cap add` has never run (see the header) — and changing it
   * after the first submission costs the listing.
   */
  appId: 'social.letsride.app',
  appName: 'LetsRide',
  webDir: 'out',

  /**
   * `https` rather than Capacitor's older `http` default. The webview then runs
   * in a secure context, which `localStorage` availability, the Web Share API
   * that `ShareButton` already uses, and geolocation all depend on — and the
   * app's own fallback path assumes: `session-store.ts` degrades to an
   * in-memory store when `localStorage` throws, which would silently sign a
   * rider out on every reload rather than fail loudly.
   */
  server: {
    androidScheme: 'https',
  },

  /**
   * The splash is flat `Accent Brand/100` `#3D996B` (`design/TOKENS.md`), and it
   * is the one screen that does not instance the app background gradient. This
   * is the colour behind the webview before first paint, so anything else shows
   * as a flash between the native splash and the app.
   */
  backgroundColor: '#3D996B',
}

export default config
