import { Capacitor } from '@capacitor/core'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'
import type { SessionStore } from '@/lib/supabase/session-store'

/**
 * The native half of `session-store.ts`'s seam: `window.__letsrideSecureStore`,
 * implemented over the iOS keychain and the Android keystore.
 *
 * `session-store.ts` has described this contract since the client-render
 * migration and nothing implemented it, so every build — including a bundled one
 * — kept the session in `localStorage`. That is the store `describeSessionStore()`
 * calls "readable by any script on this origin", and in a webview it is also
 * readable by anything that ever gets injected into one. This module is what
 * makes the `secure` branch reachable.
 *
 * ## Why the install is synchronous
 *
 * `resolveSessionStore()` resolves **once per page load** and deliberately does
 * not re-resolve — a shell that finished booting after the first resolution must
 * not change the answer, or a session written to one store is read back from
 * another. `session-store.test.ts` asserts exactly that. So a store installed
 * from an effect, a promise or a plugin `load` event is installed too late for
 * any client constructed before it, and the failure is silent: the rider signs
 * in, it works, and the token is in the weaker store.
 *
 * The install therefore has to be synchronous, which it can be because
 * `SessionStore` permits promise-returning methods. The object below goes onto
 * `window` immediately and does its asynchronous work — plugin configuration
 * included — inside each call. Nothing is awaited to decide *which* store wins.
 *
 * ## Two defaults are overridden, and both matter
 *
 * - **`afterFirstUnlockThisDeviceOnly`**, against a default of `whenUnlocked`.
 *   Two independent reasons, and the second is the one a browser mindset misses.
 *   `whenUnlocked` items are unreadable while the device is locked, so a token
 *   refresh from the background — which background location tracking, on the
 *   roadmap in `CLAUDE.md`, needs by definition — fails after a reboot until the
 *   rider next unlocks. And `whenUnlocked` items **migrate to a new device
 *   through an encrypted backup**: restoring last night's backup onto a replaced
 *   phone would carry a live refresh token onto hardware that never signed in.
 *   `ThisDeviceOnly` is what stops that, and a session credential is exactly the
 *   kind of item it exists for.
 * - **iCloud sync off.** Already the plugin's default (`this.sync = false`), so
 *   this is a restatement rather than a change — stated for the same reason
 *   `client.ts` states `flowType: 'pkce'`: it is a security-relevant default
 *   that a dependency could change in a minor version, and one that would
 *   replicate a refresh token to every device on the rider's Apple ID.
 *
 * A configuration failure rejects the operation that triggered it rather than
 * being swallowed. supabase-js reads a storage error as "no session", so the
 * rider sees a signed-out app — which is the direction to fail in.
 */

let configured: Promise<void> | null = null

function configure(): Promise<void> {
  configured ??= (async () => {
    await SecureStorage.setSynchronize(false)
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly)
  })()
  return configured
}

const secureStore: SessionStore = {
  async getItem(key) {
    await configure()
    return SecureStorage.getItem(key)
  },
  async setItem(key, value) {
    await configure()
    return SecureStorage.setItem(key, value)
  },
  async removeItem(key) {
    await configure()
    await SecureStorage.removeItem(key)
  },
  /**
   * The plugin returns keys **stripped of its storage prefix**, so these are the
   * `sb-…` names Supabase wrote and `clearSessionStore`'s prefix filter matches
   * them directly. This method is the whole reason sign-out can clear a session
   * written before a reload — without it the keychain keeps yesterday's token
   * after the rider signs out.
   */
  async keys() {
    await configure()
    return SecureStorage.keys()
  },
}

/**
 * Installs the secure store when running natively. A no-op everywhere else, and
 * safe to call more than once.
 *
 * Called from `createClient()` immediately before the store is resolved, which
 * is the only ordering that cannot race: any earlier hook (a layout effect, a
 * module side effect in the root layout) is a place the *first* client
 * construction can still get in front of.
 *
 * The browser build keeps `localStorage` deliberately — it is a development and
 * testing surface, and `describeSessionStore()` names the weaker store out loud
 * rather than letting it pass as secure.
 */
export function installSecureStore(): void {
  if (typeof window === 'undefined') return
  if (window.__letsrideSecureStore) return
  if (!Capacitor.isNativePlatform()) return

  window.__letsrideSecureStore = secureStore
}

/** Test seam, matching `resetSessionStoreForTests`. Nothing in the app calls it. */
export function resetSecureStoreConfigForTests(): void {
  configured = null
}
