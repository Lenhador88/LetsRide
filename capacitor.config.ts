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
 */
const config: CapacitorConfig = {
  /**
   * **Owner decision, and it is permanent.** A bundle id cannot be changed after
   * the first App Store or Play submission — a new one is a new app, with a new
   * listing and no reviews or installs carried over. `com.letsride.app` is a
   * placeholder chosen to be valid, not chosen by anyone who owns the domain.
   * Confirm it before the first `cap add`, because both native projects bake it
   * into their manifests, signing identities and keychain access groups.
   */
  appId: 'com.letsride.app',
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
