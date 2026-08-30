/**
 * The app's own version, and the comparison the native update gate runs on it.
 *
 * Nothing native lives here on purpose: the gate that consumes this is
 * `src/lib/native/version-gate.ts`, and the decision it makes is one comparison
 * of two strings. Splitting the comparison out is the same move
 * `resolveDestination` makes against `RouteGuard` and `resolveComboboxKey`
 * against `PlaceSearchField` — the part that can be wrong is a pure function, so
 * it has a test in a container with no device in it.
 */

/**
 * **One constant, and `src/lib/__tests__/version.test.ts` pins it to
 * `package.json`'s `version`** so the two cannot drift. Reading `package.json`
 * at runtime instead would bundle the whole dependency list into the client, so
 * the constant is the cheap half and the test is what makes it true.
 *
 * **The store build's marketing version has to match this**, and setting it is
 * an owner/native step at submission rather than anything this repo can do:
 * `CFBundleShortVersionString` in `ios/App/App/Info.plist` (Xcode's *Version*
 * field), and `versionName` in `android/app/build.gradle`. If a bundle ships
 * claiming `1.2.0` while this says `0.1.0`, the gate compares the wrong number
 * — it reads *this* constant, not the platform's — and a raise of the published
 * minimum locks out a build that was actually new enough, with no way back for
 * the rider except an update that is already installed.
 */
export const APP_VERSION = '0.1.0'

/**
 * `1.10.0` into `[1, 10, 0]`, or `null` for anything this scheme does not
 * define.
 *
 * **Strict, because the failure direction is a lockout.** Every rejection here
 * ends as "do not block" at the caller, so being fussy costs nothing and being
 * lenient costs a rider their app. `v1.2.0`, `1.2.0-beta`, `1.2.0 `, `01.2`,
 * `1..2`, `-1.2.0` and `1e3.0.0` are all `null` — a pre-release suffix has no
 * ordering defined in this file, and inventing one silently is exactly how a
 * `1.2.0-rc1` build reads as newer than `1.2.0`.
 *
 * Any number of parts is accepted rather than exactly three: the padding in
 * `compareVersions` makes `1.2` and `1.2.0` equal, which is the reading a human
 * writing a minimum into `public/app-version.json` by hand will expect.
 */
export function parseVersion(value: unknown): number[] | null {
  if (typeof value !== 'string') return null

  const parts = value.split('.')
  if (parts.length === 0) return null

  const numbers: number[] = []
  for (const part of parts) {
    // Digits only. `Number()` alone accepts ' 1 ', '0x10', '1e3' and '' — every
    // one of which would give a version an ordering nobody wrote down.
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (!Number.isSafeInteger(n)) return null
    numbers.push(n)
  }

  return numbers
}

/**
 * `-1`, `0`, `1` — or **`null` when either side is not a version at all**, which
 * is the whole reason this does not return a plain number. A comparator that
 * folded an unparseable input into `0` or `-1` would make "the file is corrupt"
 * indistinguishable from a real answer, and one of those two readings locks
 * riders out.
 *
 * The shorter side is padded with zeros, so `1.2` === `1.2.0` and
 * `1.2.0.1` > `1.2.0`.
 */
export function compareVersions(a: unknown, b: unknown): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null

  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    // Numeric comparison, not lexicographic — `10` > `9` is the case a string
    // sort gets backwards, and it arrives the first time a minor version
    // reaches double digits.
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }

  return 0
}

/**
 * Should a build reporting `current` be stopped by a published `minimum`?
 *
 * **Fails open on everything**: a missing, malformed or non-string `minimum`
 * answers `false`, as does a `current` this file cannot parse. The only `true`
 * is a comparison that succeeded and came out strictly below — equal versions
 * pass, because a minimum is the oldest build still allowed rather than the
 * oldest one refused.
 */
export function isBuildTooOld(current: string, minimum: unknown): boolean {
  const comparison = compareVersions(current, minimum)
  return comparison !== null && comparison < 0
}
