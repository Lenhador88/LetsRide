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
 * ## Failing closed means returning `null`, not throwing
 *
 * **A draft of this module claimed that "supabase-js reads a storage error as
 * 'no session', so the rider sees a signed-out app". That is false**, and review
 * caught it. `auth-js`'s `__loadSession` is `try/finally` with no `catch`, so a
 * rejecting read propagates out of `getSession()`; `RouteGuard` calls it from a
 * `.then()` with no `.catch()`, and its `allowed !== pathname` test then never
 * flips. The rider gets a splash that never resolves — not a signed-out app, and
 * not something they can retry past. That is the worst available outcome and it
 * was reasoned into the design rather than measured.
 *
 * So `getItem` **makes the claim true by construction**: a failed read resolves
 * to `null`, which auth-js does read as "no session", and the rider is asked to
 * sign in again. Writes and removals still propagate — `clearSessionStore`
 * already wraps every `removeItem` in its own `try`, and a silently-dropped
 * write would leave a rider believing they are signed in until the next reload.
 * The asymmetry is deliberate: only the read sits on the route guard's path.
 */

let configured: Promise<void> | null = null

async function applyPluginDefaults(): Promise<void> {
  await SecureStorage.setSynchronize(false)
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly)
}

/**
 * Applies the two overridden defaults once, and **never caches a failure**.
 *
 * `configured ??= applyPluginDefaults()` — the first version of this — caches a
 * *rejected* promise, so a single transient plugin error makes every subsequent
 * read and write reject for the rest of the app session, with no retry and no
 * way back short of a restart. Clearing the slot on failure costs one retry per
 * operation in the broken case and nothing at all in the normal one.
 *
 * It resolves even when the defaults could not be applied. The alternative is
 * taking storage down over a keychain *attribute*, and the attribute that
 * actually changes behaviour cannot fail on its own: `setDefaultKeychainAccess`
 * only assigns a local field, and `setSynchronize` assigns `this.sync` before
 * dispatching to the native bridge — so even a rejected native call leaves the
 * value that governs every later operation already set to `false`.
 */
function configure(): Promise<void> {
  if (!configured) {
    configured = applyPluginDefaults().catch(() => {
      configured = null
    })
  }
  return configured
}

const secureStore: SessionStore = {
  async getItem(key) {
    try {
      await configure()
      return await SecureStorage.getItem(key)
    } catch {
      // See §Failing closed above — a throw here hangs the route guard forever.
      return null
    }
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
