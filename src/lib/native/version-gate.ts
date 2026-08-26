import { Capacitor } from '@capacitor/core'
import { canonicalOrigin } from '@/lib/origin'
import { APP_VERSION, isBuildTooOld } from '@/lib/version'

/**
 * The one lever that still works after a bundle has shipped.
 *
 * ## Why this exists before anything needs it
 *
 * A native bundle bakes in its backend and its canonical origin, and neither is
 * fixable afterwards (PD-188) — the repair is a new store review, which is days,
 * and until then every rider on that build is stranded with nothing on screen
 * saying so. A web deploy has no such problem, which is why this is native-only.
 * It is worthless unless it is *in* the build it will one day have to stop, so
 * it lands now rather than when it is needed.
 *
 * ## Where the answer comes from, and why it is a static file
 *
 * `public/app-version.json`, fetched from `canonicalOrigin()` as an absolute
 * URL. Three alternatives were considered and all three fail on the same point
 * — **the build that must be stopped is exactly the build that may be unable to
 * sign in**:
 *
 * - a Supabase table needs a grant to read it, and decision #1 forbids `anon`
 *   grants outright, so an un-signed-in bundle could not read it;
 * - an Edge Function with `verify_jwt` wants a session for the same reason, and
 *   deploying one is an owner action on top;
 * - the copy inside the bundle answers with whatever was true on build day,
 *   which is the one answer that can never stop that bundle.
 *
 * **The absolute origin is what makes this read the deployed copy.** `public/`
 * is emitted into the static export too, so `fetch('/app-version.json')` from
 * inside the shell would be served by Capacitor's local server out of the app's
 * own bundle — a check that always agrees with itself.
 *
 * ## It fails open, on everything
 *
 * Offline, a timeout, a 404, a redirect to a login wall, malformed JSON, a
 * `minimum` this repo's scheme cannot parse, a plugin that throws: every one of
 * those answers "do not block". A rider in a valley with no signal must not be
 * stopped by the thing that checks whether they should be stopped, and the cost
 * of failing open is that a broken build keeps running for one more launch —
 * against a lockout with no way out of it from inside the app.
 */

/** Where the published minimum lives, relative to the canonical origin. */
export const MINIMUM_VERSION_PATH = '/app-version.json'

/**
 * Short, because this runs at boot and every millisecond of it is a millisecond
 * the app has already painted and is usable in. It is not a correctness bound —
 * the timeout path is the fail-open path — it is a bound on how long a dead
 * network keeps a fetch alive behind a working app.
 */
export const VERSION_CHECK_TIMEOUT_MS = 4000

/**
 * Must equal `capacitor.config.ts`'s `appId`, which is what Play resolves a
 * `market://details?id=…` against. `version-gate.test.ts` reads that file and
 * asserts it rather than trusting this comment, because a mismatch is a button
 * that opens Play on "app not found" and there is nothing in a container that
 * would otherwise notice.
 */
export const ANDROID_APP_ID = 'social.letsride.app'

/**
 * **`null` until the App Store listing exists — PD-232.** `itms-apps://` needs
 * the numeric Apple ID that App Store Connect assigns when the listing is
 * created, and there is no way to derive it from the bundle id. So iOS gets
 * honest instructions and no button rather than an invented URL that opens the
 * App Store on nothing; filling this constant is the whole change on the day
 * PD-232 lands.
 */
const APPLE_APP_ID: string | null = null

export type StoreAffordance =
  | { kind: 'store-link'; url: string; label: string }
  | { kind: 'instructions' }

/**
 * What the blocking screen can offer on this platform.
 *
 * Pure and parameterised on the Apple id rather than reading the constant
 * directly, so the branch that does not exist yet still has a test — otherwise
 * PD-232's one-line change would land on a path nothing has ever executed.
 */
export function resolveStoreAffordance(
  platform: string,
  appleAppId: string | null = APPLE_APP_ID
): StoreAffordance {
  if (platform === 'android') {
    return {
      kind: 'store-link',
      // `market://` rather than an https Play URL: Capacitor's Android bridge
      // hands any non-app scheme to `Intent.ACTION_VIEW`
      // (`Bridge.launchIntent`), so this opens the Play app directly instead of
      // a browser that then has to bounce into it.
      url: `market://details?id=${ANDROID_APP_ID}`,
      label: 'Open Google Play',
    }
  }

  if (platform === 'ios' && appleAppId) {
    return {
      kind: 'store-link',
      url: `itms-apps://itunes.apple.com/app/id${appleAppId}`,
      label: 'Open the App Store',
    }
  }

  return { kind: 'instructions' }
}

/**
 * The `minimum` field, or `null` for anything that is not a string in that slot.
 *
 * Split out so the shape of the file is asserted separately from the fetch:
 * `{}`, `null`, an array, a number and a nested object all have to reach the
 * same fail-open answer, and none of those needs a network to test.
 */
export function readMinimumVersion(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const minimum = (payload as { minimum?: unknown }).minimum
  return typeof minimum === 'string' ? minimum : null
}

/**
 * One check per **document load**, held here rather than re-run per navigation.
 *
 * Same reasoning as `guard-cache.ts`'s: PD-111 is what a boot-time read costs
 * once it becomes a per-route one. **A failed check caches its answer too**,
 * deliberately unlike `secure-store.ts`'s `configured` slot — there the retry
 * is the point, here retrying is precisely the per-navigation fetch this
 * avoids, and the answer it would be retrying for is "do not block".
 *
 * **"Document load" is weaker than "launch" and the difference is days.** A
 * Capacitor app resumed from the background does not reload its webview on
 * either platform, so a rider who cold-started on Tuesday and has only
 * backgrounded since never re-runs this — a newly published minimum reaches
 * them when the OS evicts the process, not when it is published. There is
 * deliberately no `resume` or `visibilitychange` listener: re-checking would
 * mean blocking a rider **mid-use**, on a screen they were already reading, and
 * the builds this exists to stop are the ones that fail badly enough to be
 * cold-started soon anyway. Said plainly rather than left as an implied
 * guarantee, because "once per launch" reads like a promise this does not make.
 */
let launchCheck: Promise<boolean> | null = null

/**
 * Is this build below the published minimum? Resolves `false` for every failure
 * and for every non-native platform, and **never rejects** — the caller renders
 * on the answer, so a rejection here would be an unhandled rejection in a boot
 * effect.
 */
export function checkForcedUpdate(): Promise<boolean> {
  launchCheck ??= runCheck()
  return launchCheck
}

async function runCheck(): Promise<boolean> {
  try {
    // The web always gets the newest bundle on the next load, so gating it buys
    // nothing and adds a way to lock everyone out of a working deployment.
    if (!Capacitor.isNativePlatform()) return false

    // **This cannot bootstrap off an origin it does not trust, and that bounds
    // what the gate can stop.** `canonicalOrigin()` inside a bundle is the baked
    // `NEXT_PUBLIC_CANONICAL_ORIGIN` — the very value PD-188 §2 calls unfixable
    // after shipping. So a bundle built against the *wrong backend* is
    // stoppable (the origin is still production, the fetch succeeds, the
    // comparison runs), and a bundle built against the *wrong origin* is not:
    // it asks a host that answers an SSO page or nothing, and fails open for
    // ever. `scripts/native/assert-release-bundle.mjs` is what catches that one,
    // before submission, which is the only place it can be caught.
    const response = await fetch(`${canonicalOrigin()}${MINIMUM_VERSION_PATH}`, {
      // A cached copy is a stale copy, and the one moment this file matters is
      // the moment it has just changed.
      cache: 'no-store',
      // `AbortSignal.timeout` is absent on old webviews; the `TypeError` that
      // would raise lands in the same catch as everything else, which is the
      // fail-open path.
      signal: AbortSignal.timeout(VERSION_CHECK_TIMEOUT_MS),
    })
    if (!response.ok) return false

    const payload: unknown = await response.json()
    return isBuildTooOld(APP_VERSION, readMinimumVersion(payload))
  } catch {
    // Deliberately silent about which failure it was: this runs on every
    // launch, and a rider with no signal would otherwise fill the console on
    // every one of them. Nothing downstream can act on the distinction — every
    // branch is "do not block".
    return false
  }
}

/** Test seam, matching `resetSecureStoreConfigForTests`. Nothing in the app calls it. */
export function resetVersionGateForTests(): void {
  launchCheck = null
}
