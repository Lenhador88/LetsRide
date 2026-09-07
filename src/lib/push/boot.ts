import { installationId } from '@/lib/push/installation'
import {
  checkPushPermission,
  isPushCapable,
  onProviderToken,
  registerCurrentDevice,
  releaseCurrentDevice,
  requestProviderRegistration,
} from '@/lib/push/registration'

/**
 * Cold-start re-registration — PD-431, child B task 2.7 of
 * `deliver-push-notifications`, and the other end of the sign-out window.
 *
 * ## It runs unconditionally, and that is the entire point
 *
 * `register_push_device` is called on **every** cold start with a session and a
 * granted permission — not only on first grant, and specifically **not** gated
 * on any local belief that this installation is already registered. That belief
 * is exactly what is wrong in the case this repairs:
 *
 * > A rider signs out with no network. `release_push_device` cannot run, so
 * > their row survives naming their `user_id`. They hand the phone to another
 * > rider, who signs in. Without this call, the row still names the previous
 * > rider and their notifications render on someone else's lock screen — with
 * > every RLS policy in this schema working exactly as designed.
 *
 * Because `push_devices` is keyed on `installation_id` rather than on the token
 * (`078` §1), the re-home is **total**: it takes whatever tokens that install
 * has ever presented with it. Under a token-keyed table the same call would
 * move one token and leave any other row for the same device behind, and the
 * window would be the 60-day idle sweep rather than the next launch.
 *
 * **So the residual is stated rather than claimed closed:** when a release
 * cannot run, the previous rider's pushes may reach that device *until the app
 * is next opened with a session*. Nothing can release a device without a
 * session, so that bound is the honest one.
 *
 * ## It never prompts
 *
 * The permission is **read**, never requested — `requestPushPermission()` is
 * reachable only from a rider's tap on the priming sheet. A boot path that
 * could raise the OS dialog would spend the one-shot ask on app launch, which
 * is the single worst moment for it.
 *
 * ## Never blocks a boot
 *
 * Every failure is swallowed. A rider whose device cannot register must still
 * get an app; the cost of a swallowed error is one launch's delay before the
 * next attempt, and the next launch retries unconditionally by construction.
 */
export async function registerOnBoot(): Promise<void> {
  if (!isPushCapable()) return

  try {
    if ((await checkPushPermission()) !== 'granted') {
      // **Task 2.12 — a revoked permission releases this installation.**
      //
      // The failure this closes is silent on every side. A rider turns
      // notifications off in the OS settings app; nothing tells the app, and
      // APNs and FCM go on *accepting* sends for that token and dropping them.
      // So the row survives, every fan-out pays for it, and the delivery log
      // says success. This read is the only moment the app learns.
      //
      // **This installation only.** Clearing every row for the rider would
      // unsubscribe their other phone, which is the alternative `078` §11
      // refused for `release_push_device` itself.
      //
      // A rider who never granted in the first place reaches this too, and the
      // call is a no-op for them: the RPC deletes by `(auth.uid(),
      // installation_id)` and there is no row to match.
      await releaseCurrentDevice().catch(() => {})
      return
    }

    // Minted here rather than inside the listener so a store failure is caught
    // by this function's own guard, before a provider event can arrive.
    await installationId()

    // **A holder object rather than the `await`'s own binding.** A provider
    // that answers before `onProviderToken` resolves would otherwise reach for
    // a binding that is not assigned yet — a use-before-assignment in exactly
    // the fast case, which no test on a machine with no device could ever
    // reach. `answered` makes the teardown correct whichever side wins the
    // race, and idempotent if both do.
    const listener: { stop?: () => void; answered: boolean } = { answered: false }

    // **Idempotent, because both events can fire.** A provider that answers
    // `registration` and then `registrationError` — or the reverse — runs this
    // twice, and `remove()` is `void`-ed, so a second call that rejects is an
    // unhandled rejection rather than a caught one. The flag makes the teardown
    // run once whichever combination arrives.
    const settle = () => {
      if (listener.answered) return
      listener.answered = true
      listener.stop?.()
    }

    listener.stop = await onProviderToken((token) => {
      void registerCurrentDevice(token).catch(() => {})
      settle()
    }, settle)

    if (listener.answered) listener.stop()

    await requestProviderRegistration()
  } catch {
    // See §Never blocks a boot.
  }
}
