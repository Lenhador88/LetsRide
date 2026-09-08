/**
 * What, if anything, a screen should draw to ask a rider for notification
 * permission — PD-431, child B task 2.3 of `deliver-push-notifications`.
 *
 * ## Why this is a pure function rather than logic inside the component
 *
 * The same reason `locationPrimingState` was split out, and the same shape:
 * the decision has several states and exactly one of them is a rendering
 * question. Split, every state gets a named test; folded into the component,
 * only the states a `renderToStaticMarkup` pass can reach do.
 *
 * ## The four answers, and the one the location precedent has no analogue for
 *
 * - **`hidden`** — draw nothing. The default, and the answer for every state
 *   where a row would be noise or a lie. **This is also the answer on every
 *   non-native platform**, decided before any permission is read: there is no
 *   APNs or FCM in a browser, this app ships no service worker and no Web Push
 *   (`CLAUDE.md` §What Not To Do), so a row offering notifications on the web
 *   is an offer nothing could honour.
 * - **`ask`** — the OS will show its permission dialog if something asks. This
 *   is the state the priming sheet exists for.
 * - **`blocked`** — the OS has already refused. On iOS that refusal is one-way
 *   from inside the app, so the row draws the *denied* copy: what is lost and
 *   where to switch it back on.
 * - **`stalled`** — **granted, registration requested, and no token ever
 *   arrived.** This is the state with no location analogue and it is the reason
 *   this is not a three-value enum. Geolocation answers a permission grant with
 *   a position or an error; APNs and FCM answer with *neither* when an app is
 *   misprovisioned — no `aps-environment` entitlement, a bundle id that does not
 *   match the profile, a missing `google-services.json`. `didRegister` simply
 *   never fires. Without this state that device reads as `hidden` — permission
 *   granted, nothing to ask — and a rider who will never receive a notification
 *   looks identical to one who is fully set up, on the screen and in every
 *   count. It is the single most likely failure of the first device build, and
 *   the one nothing else in this system can report.
 *
 * ## The one prompt, and why `ask` is not enough on its own to prompt
 *
 * iOS grants an app exactly one notification-permission dialog for the life of
 * the install: decline it and there is no second ask, only the Settings app. So
 * `ask` says *the dialog is still available*, never *show it now*. Only
 * `requestPushPermission()` may spend it, and only from a rider's deliberate
 * tap — which is what the priming sheet is for.
 */
export type PushPrimingState = 'hidden' | 'ask' | 'blocked' | 'stalled'

/**
 * The OS-level answer, narrowed to the three cases that decide anything.
 *
 * `@capacitor/push-notifications` reports `prompt`, `prompt-with-rationale`,
 * `granted` and `denied`. The middle one is Android's "you have declined once
 * and may be asked again", which for this decision behaves exactly like
 * `prompt` — the dialog is still available — so it is mapped in the doorway
 * rather than carried through here.
 */
export type PushPermission = 'prompt' | 'granted' | 'denied'

export function pushPrimingState({
  isNative,
  permission,
  hasToken,
}: {
  /**
   * `Capacitor.isNativePlatform()`. **Read first and before anything else**,
   * because on the web the permission read is not merely unavailable — it is
   * meaningless, and a browser's own Notification API would answer it with a
   * value about a channel this app does not use.
   */
  isNative: boolean
  /** `undefined` until the plugin has answered. */
  permission: PushPermission | undefined
  /**
   * Has a provider token arrived for this installation in this app session?
   * **`undefined` is "registration has not been attempted or has not settled"
   * and `false` is a settled "asked, and nothing came back"** — the same
   * distinction every detail screen in this app makes a 404 out of. Confusing
   * them makes `stalled` flash onto the screen on every launch, between the
   * grant being read and the token arriving.
   */
  hasToken: boolean | undefined
}): PushPrimingState {
  // Before the permission read, because there is nothing on this platform to
  // read it from. See the type's own note.
  if (!isNative) return 'hidden'

  // **Nothing renders against an unread permission.** A row drawn against a
  // guess is wrong for exactly the rider who already granted, who would watch
  // an offer to enable something they enabled months ago appear and vanish.
  if (permission === undefined) return 'hidden'

  if (permission === 'granted') {
    // Granted and a token in hand is the finished state — no row, nothing to
    // ask. Granted and registration still in flight is also no row: `stalled`
    // is a claim that something is wrong, and it must not be made while the
    // ordinary path is still running.
    return hasToken === false ? 'stalled' : 'hidden'
  }

  return permission === 'denied' ? 'blocked' : 'ask'
}
