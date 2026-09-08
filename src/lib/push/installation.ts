import { INSTALLATION_ID_KEY, resolveSessionStore } from '@/lib/supabase/session-store'

/**
 * The stable name a device has — `push_devices.installation_id`, generated here
 * and nowhere else. PD-431, child B task 2.5 of `deliver-push-notifications`.
 *
 * ## Why this is a value we mint rather than one the platform gives us
 *
 * `078`'s §1 is the argument and it is not restated here. What that argument
 * needs from this module is one property: **the id's lifetime is exactly this
 * install on this device**. A platform-vendor identifier — `identifierForVendor`
 * on iOS, an Android id — does not have that lifetime, and the two platforms do
 * not agree on what theirs *does* have, so every rule in `078` would have to be
 * re-reasoned per platform. `crypto.randomUUID()` into storage that dies with
 * the app has one meaning on both.
 *
 * **The shape is load-bearing, not cosmetic.** `078` carries
 * `push_devices_installation_id_shape`, a CHECK for a lowercase hex UUID, and
 * its header says why: whoever presents an installation id re-homes that
 * device, so a guessable id would let any rider take over a registration.
 * `crypto.randomUUID()` is what that CHECK was written against — 122 bits — and
 * a change of generator here is a change to that constraint's premise.
 *
 * ## No new plugin, and that is a decision rather than an omission
 *
 * The id lives in `resolveSessionStore()`'s store, which is the keychain under
 * the native shell (`src/lib/native/secure-store.ts`) and `localStorage` in a
 * browser. That store already holds the refresh token, so it already has the
 * lifetime this value needs and already fails in the ways callers handle.
 * Adding a device-id plugin for three lines would be a permission prompt, a
 * review question and a supply-chain surface bought for nothing —
 * `CLAUDE.md` §Technology Decisions, and `.claude/agents/native.md`'s rule that
 * every plugin owes a one-sentence justification.
 *
 * ## The single-flight cache, and why a rejection is not cached
 *
 * Two callers racing on first launch — the boot registration and a rider
 * tapping the priming row — must not mint two ids, or the second write creates
 * a second `push_devices` row for one device and `078`'s "one row per install"
 * stops being true. So the promise is shared.
 *
 * **A failure clears the slot**, which is `secure-store.ts`'s `configure()`
 * lesson: caching a rejected promise turns one transient keychain error into a
 * permanently unregisterable device with no retry and no way back short of a
 * restart.
 */

/**
 * The store key. Named for what it identifies — the installation — rather than
 * for push, because the value outlives any one channel or rider.
 *
 * **It survives `clearSessionStore()` on sign-out**, which is the correct
 * direction and the opposite of the four things sign-out clears: those are
 * traces of a *rider*, and this names a *device*. Clearing it would mint a fresh
 * id on the next sign-in, which makes every sign-in look like a reinstall — a
 * new `push_devices` row each time, the old one surviving until a provider
 * refuses its token, and `078`'s "one row per install, for the life of the
 * install" quietly false. `release_push_device` is what sign-out owes here, and
 * it needs this value to name the row it removes.
 *
 * **The `sb-` prefix is not what protects it, and believing it was is PD-443.**
 * That is true of `clearSessionStore`'s prefix sweep and was false of its
 * tracked-key pass, which removed every key written during the page load
 * whatever its name — so on the one load that mints this id, sign-out destroyed
 * it. The protection is now explicit: the constant is declared in
 * `session-store.ts` and listed in its `DEVICE_SCOPED_KEYS`, which is the set
 * that keeps it out of the tracked pass. Re-exported here so callers and the
 * existing tests are unchanged.
 */
export { INSTALLATION_ID_KEY }

/** Lowercase hex UUID — `078`'s `push_devices_installation_id_shape`, restated. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let pending: Promise<string> | null = null

async function readOrMint(): Promise<string> {
  // `resolveSessionStore()` is synchronous and resolves once per page load —
  // its own header explains why re-resolving would let a value be written to
  // one store and read back from another.
  const { store } = resolveSessionStore()

  const existing = await store.getItem(INSTALLATION_ID_KEY)
  // **A stored value that fails the shape is replaced rather than returned.**
  // The CHECK would refuse it at `register_push_device`, and a device that can
  // never register is worse than one that mints a second id once. The only way
  // to hold a malformed value is a hand-edited store or a generator that
  // changed, and both want the same answer.
  if (typeof existing === 'string' && UUID.test(existing)) return existing

  const minted = crypto.randomUUID()
  await store.setItem(INSTALLATION_ID_KEY, minted)
  return minted
}

/**
 * This installation's id, minting one on first call.
 *
 * Two calls in the same app session return the same value — the property
 * `078`'s upsert depends on, and the one a test can actually pin.
 */
export function installationId(): Promise<string> {
  if (!pending) {
    pending = readOrMint().catch((error: unknown) => {
      pending = null
      throw error
    })
  }
  return pending
}

/** Test seam, matching `resetSecureStoreConfigForTests`. Nothing in the app calls it. */
export function resetInstallationIdForTests(): void {
  pending = null
}
