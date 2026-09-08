import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { resolveSupabase } from '@/lib/supabase/resolve'
import { installationId } from '@/lib/push/installation'
import type { PushPermission } from '@/lib/push/priming'

/**
 * The doorway to `@capacitor/push-notifications` — PD-431, child B task 2.6 of
 * `deliver-push-notifications`.
 *
 * **Nothing else in `src/` imports that package**, the way nothing but
 * `src/lib/observability/*` imports Sentry or PostHog and nothing but
 * `src/lib/native/secure-store.ts` imports the keychain plugin.
 * `__tests__/doorway.test.ts` enforces it. One name, one doorway
 * (`CLAUDE.md` §Technology Decisions).
 *
 * **The plugin's justification, per `.claude/agents/native.md`:** Apple and
 * Google hand a device token only to native code, so there is no route from the
 * webview to APNs or FCM at all; this plugin is that route and nothing already
 * in the dependency tree substitutes for it. What it pulls in is the iOS Push
 * Notifications capability and the `aps-environment` entitlement, and Android
 * 13+'s `POST_NOTIFICATIONS` runtime permission — one store-review question and
 * one runtime prompt.
 *
 * ## Every export returns early on a non-native platform
 *
 * `secure-store.ts`'s shape, for a stronger reason than symmetry: in a browser
 * the plugin's web implementation talks to the *browser's* Notification API,
 * which is a different channel this app deliberately does not use — no service
 * worker, no manifest, no Web Push (`CLAUDE.md` §What Not To Do). Letting a
 * call through on the web would prompt a rider for a permission that grants
 * nothing, and spend the goodwill of the ask.
 *
 * ## NOTHING HERE CAN PROMPT UNTIL A DEVICE BUILD EXISTS, AND THAT IS THE
 * SEQUENCING ARGUMENT RATHER THAN AN ACCIDENT
 *
 * iOS grants an app **one** notification-permission dialog for the life of the
 * install: decline it and there is no second ask, only the Settings app. So
 * asking before a sender exists would spend that one dialog on a channel that
 * cannot deliver anything — child C, its credentials and its schedule, are what
 * make the ask honest.
 *
 * **That hazard is not live on either web deployment**, and the reason is one
 * line rather than a promise: `Capacitor.isNativePlatform()` is false in a
 * browser, so `pushPrimingState` returns `hidden` before it reads a permission
 * and every export below returns early. `app.letsride.social` and
 * `app-dev.letsride.social` are browsers. **`ios/` has never been compiled and
 * `android/` does not exist**, so there is today no build in which any of this
 * can prompt.
 *
 * **What that leaves is a real ordering rule for whoever compiles first:** the
 * first device build is the moment the prompt becomes spendable, so child C
 * should be decided by then. It is written here because that person will read
 * this file and will not read the PR.
 */

/**
 * Is this a platform on which a push token can exist at all?
 *
 * Exported so `pushPrimingState`'s `isNative` comes from the doorway rather
 * than being inferred by a caller. An earlier draft of `PushPrimingRow` derived
 * it from "has the permission read answered", which is wrong in the one
 * direction that matters: `checkPushPermission()` also answers `undefined` when
 * the plugin throws, so a native device with a sick plugin would have been
 * treated as a browser and drawn nothing for ever.
 */
export function isPushCapable(): boolean {
  return Capacitor.isNativePlatform()
}

/** What the plugin reports, mapped to the three cases the decision uses. */
function narrow(state: string): PushPermission {
  // `prompt-with-rationale` is Android's "declined once, may be asked again".
  // For every decision in this app that is `prompt` — the dialog is still
  // available — so it is collapsed here rather than carried through the state
  // machine, which would then have two arms that can never differ.
  if (state === 'granted') return 'granted'
  if (state === 'denied') return 'denied'
  return 'prompt'
}

/**
 * Reads the current permission **without prompting**.
 *
 * Safe to call on any screen and at any time; `checkPermissions` is a read on
 * both platforms.
 */
export async function checkPushPermission(): Promise<PushPermission | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined
  try {
    const { receive } = await PushNotifications.checkPermissions()
    return narrow(receive)
  } catch {
    // A plugin that will not answer is not a rider who refused. Returning
    // `undefined` keeps `pushPrimingState` at `hidden`, where a wrong guess
    // draws nothing rather than drawing the denied copy at someone who never
    // declined.
    return undefined
  }
}

/**
 * **The only function in this app that may show the OS permission dialog.**
 *
 * Call it from a rider's deliberate tap and nowhere else — never from an
 * effect, never from boot. iOS spends the one dialog on the first call and a
 * decline is final from inside the app.
 */
export async function requestPushPermission(): Promise<PushPermission | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined
  try {
    const { receive } = await PushNotifications.requestPermissions()
    return narrow(receive)
  } catch {
    return undefined
  }
}

/**
 * Asks the OS to register this installation with its provider.
 *
 * **Resolving says the request was made, never that a token arrived** — the
 * token comes back asynchronously on the `registration` event, and on a
 * misprovisioned build it never comes at all. That gap is what
 * `pushPrimingState`'s `stalled` reports.
 */
export async function requestProviderRegistration(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await PushNotifications.register()
}

type TokenListener = (token: string) => void

/**
 * Subscribes to the provider's answer. Returns a function that removes both
 * listeners.
 *
 * Both events are subscribed together because a caller that handles only the
 * success case cannot tell a slow provider from a failed one, which is the
 * whole of the `stalled` diagnosis.
 */
export async function onProviderToken(
  onToken: TokenListener,
  onError: (message: string) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {}

  const registration = await PushNotifications.addListener('registration', (t) => {
    onToken(t.value)
  })
  const failure = await PushNotifications.addListener('registrationError', (e) => {
    onError(String(e.error))
  })

  return () => {
    void registration.remove()
    void failure.remove()
  }
}

/**
 * Records this installation's token against the signed-in rider —
 * `078`'s `register_push_device`.
 *
 * **Call it on every cold start with a session and a granted permission, not
 * only on first grant.** That unconditional re-registration is what repairs a
 * sign-out release that could not run: because the row is keyed on the
 * installation, a re-home is total and takes whatever tokens that install has
 * ever presented with it. A caller that skips this because it believes the
 * installation is already registered is skipping it in precisely the case the
 * repair is for.
 */
export async function registerCurrentDevice(token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  const supabase = await resolveSupabase()
  const { error } = await supabase.rpc('register_push_device', {
    installation_id: await installationId(),
    token,
    platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
  })

  if (!error) return

  // **`23514` is FOUR different failures on this call, and only one of them is
  // ordinary.** An earlier version swallowed the code itself, which is wrong in
  // the one direction this module exists to make visible.
  //
  // `register_push_device` raises the participation gate with
  // `errcode = 'check_violation'` (`078` §4, restated inside the function
  // because a trigger carrying `when (current_user = 'authenticated')` could
  // never fire on a table only `security definer` functions write). But
  // `push_devices` also carries three CHECKs that raise the same 23514 — the
  // installation-id shape, `platform in ('ios','android')`, and
  // `length(token) between 1 and 4096`.
  //
  // Swallowing all four means an empty or oversized provider token is
  // discarded in silence *after* the caller has already recorded that a token
  // arrived — so the device reads `hidden` rather than `stalled`, which is
  // precisely the "looks fully set up, will never receive anything" state
  // `stalled` was invented to surface. The gate is the only one that is a
  // normal rider state, so it is the only one matched, and it is matched on the
  // message rather than the shared code.
  if (error.code === '23514' && /onboarding/i.test(error.message)) return

  throw error
}

/**
 * Removes this installation's row — `078`'s `release_push_device`.
 *
 * **Scoped to this installation and never to every row for the rider.** The
 * alternative silently unsubscribes their other phone, which is why `078`
 * refused it.
 *
 * Called by `signOut()` **before** `supabase.auth.signOut()`, because the RPC
 * needs a live session, and its failure must not block sign-out. The residual
 * is stated rather than claimed closed: when the release cannot run, the
 * previous rider's pushes may reach that device **until the app is next opened
 * with a session**, which is when `registerCurrentDevice` re-homes it.
 */
export async function releaseCurrentDevice(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  const supabase = await resolveSupabase()
  await supabase.rpc('release_push_device', { installation_id: await installationId() })
}
