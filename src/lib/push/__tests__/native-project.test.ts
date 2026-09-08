import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../../..')
const PBXPROJ = path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj')
const APP_DELEGATE = path.join(ROOT, 'ios', 'App', 'App', 'AppDelegate.swift')
const ENTITLEMENTS = path.join(ROOT, 'ios', 'App', 'App', 'App.entitlements')

/**
 * The iOS project half of push registration — PD-302, task 2.14 of
 * `deliver-push-notifications`.
 *
 * **This is the only gate that can see any of it.** `tasks.md` says of child B
 * that *"nothing here is verifiable in CI"*, and for the TypeScript half that
 * remains true — a registration callback that never fires leaves `tsc`, ESLint,
 * Vitest and `next build` all green. But the three project-level facts below
 * are text in this repository, and each of them is individually sufficient to
 * make every function in `registration.ts` inert on a real device:
 *
 * 1. **No `aps-environment` entitlement** → iOS refuses
 *    `registerForRemoteNotifications()` and the token request never leaves the
 *    phone.
 * 2. **No `CODE_SIGN_ENTITLEMENTS`** → the file above exists and is not applied
 *    to the bundle, which is the same outcome with a file to point at.
 * 3. **No APNs forwarding in `AppDelegate`** → iOS answers, and the answer is
 *    delivered to a delegate method nobody wrote, so
 *    `@capacitor/push-notifications` never hears it.
 *
 * All three fail the same way — `PushNotifications.register()` resolves, the
 * `registration` listener waits for ever, and `pushPrimingState` reports
 * `stalled` — so **the diagnosis costs a provisioned device and a trip to a
 * Mac**. That asymmetry is what earns this file: the state it pins is one
 * `npx cap sync`, one Xcode capability toggle or one template regeneration away
 * from silently reverting, and nothing else in the repository would notice.
 *
 * `docs/reference/native-shell.md` §Push registration is provisioned in the
 * project has the reasoning; this file is the tripwire under it.
 */

/**
 * pbxproj and Swift both use `/* … *\/` and `//`, and this repository's
 * most-repeated measurement error is a file whose comment describes the very
 * thing being counted. **It is live here rather than hypothetical**:
 * `AppDelegate.swift`'s doc comment names both notification constants, so an
 * unstripped search for them passes on a file whose methods have been deleted.
 */
function withoutComments(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** Every `XCBuildConfiguration` block, as `{ name, body }`. */
function buildConfigurations(): { name: string; body: string }[] {
  const source = withoutComments(PBXPROJ)
  const blocks = source.split('isa = XCBuildConfiguration;').slice(1)
  return blocks.map((body) => ({
    name: /\bname = (\w+);/.exec(body)?.[1] ?? '',
    body,
  }))
}

describe('the iOS project can obtain an APNs token', () => {
  it('declares aps-environment, and as a per-configuration build variable', () => {
    const entitlements = readFileSync(ENTITLEMENTS, 'utf8')
    expect(entitlements).toContain('<key>aps-environment</key>')

    // **A literal here is the defect, not a simplification.** Automatic signing
    // picks a development profile for Debug and a distribution one for Release,
    // and an entitlement that does not match the profile fails to sign. Pinned
    // to `development` the archive is refused; pinned to `production` a device
    // build is. The variable is what lets one file serve both, and Xcode
    // expands it at `ProcessProductPackaging` the way it expands
    // `$(AppIdentifierPrefix)`.
    expect(entitlements).toMatch(/<string>\$\(APS_ENVIRONMENT\)<\/string>/)
  })

  it('applies that file in both target configurations, with opposite environments', () => {
    const signed = buildConfigurations().filter((c) =>
      /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/.test(c.body),
    )

    // Two, not one: the target's Debug and its Release. The project-level pair
    // carries no entitlement and must not grow one.
    expect(signed.map((c) => c.name).sort()).toEqual(['Debug', 'Release'])

    const environmentOf = (name: string) =>
      /\bAPS_ENVIRONMENT = (\w+);/.exec(signed.find((c) => c.name === name)!.body)?.[1]

    expect(environmentOf('Debug')).toBe('development')
    expect(environmentOf('Release')).toBe('production')
  })

  it('forwards both APNs callbacks from AppDelegate to the Capacitor plugin', () => {
    const source = withoutComments(APP_DELEGATE)

    // The success half and the failure half, subscribed together in
    // `PushNotificationsPlugin.load()`. A delegate that posts only the first
    // cannot tell a slow provider from a misprovisioned build, which is the
    // whole of the `stalled` diagnosis in `priming.ts`.
    expect(source).toContain('didRegisterForRemoteNotificationsWithDeviceToken')
    expect(source).toContain('.capacitorDidRegisterForRemoteNotifications')
    expect(source).toContain('didFailToRegisterForRemoteNotificationsWithError')
    expect(source).toContain('.capacitorDidFailToRegisterForRemoteNotifications')
  })

  it('and the comment strip still tells a real method from a description of one', () => {
    // **Verified both ways.** The assertion above reads 0 violations the same
    // way whether the rule holds or the detector is broken, and here the
    // detector is doing real work: the file it reads carries a doc comment
    // naming both constants, so without the strip this test would pass on a
    // file whose methods had been deleted entirely.
    const real = 'NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications,'
    expect(withoutCommentsIn(real)).toContain('.capacitorDidRegisterForRemoteNotifications')

    expect(withoutCommentsIn(`    // ${real}`)).not.toContain('.capacitorDidRegister')
    expect(withoutCommentsIn(`    /** ${real} */`)).not.toContain('.capacitorDidRegister')
  })
})

/** `withoutComments` on a string rather than a file, for the both-ways check. */
function withoutCommentsIn(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
