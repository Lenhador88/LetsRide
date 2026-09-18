import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const AASA = path.join('public', '.well-known', 'apple-app-site-association')
const ENTITLEMENTS = path.join('ios', 'App', 'App', 'App.entitlements')
const PBXPROJ = path.join('ios', 'App', 'App.xcodeproj', 'project.pbxproj')
const CAPACITOR_CONFIG = 'capacitor.config.ts'

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

/**
 * The association file decides whether a `https://app.letsride.social/…` link
 * opens the installed app or Safari — PD-205.
 *
 * **Every assertion here exists because the failure is silent.** Apple fetches
 * this file from its own CDN at install time and reports nothing to the app, to
 * the build, or to CI. A wrong Team, a renamed bundle id or a trailing comma
 * produces an app whose universal links simply never fire, indistinguishable
 * from one where the capability was never added — and the only way to find out
 * is a device, which this container does not have and CI does not run.
 *
 * So the three values are asserted against the files that actually own them
 * rather than against a copy of the string. A bundle-id change that reaches
 * `capacitor.config.ts` and `project.pbxproj` and not this file is exactly the
 * drift that would ship.
 */
describe('apple-app-site-association', () => {
  const parsed = JSON.parse(read(AASA)) as {
    applinks: { details: { appIDs: string[]; components: Record<string, string>[] }[] }
  }

  it('is valid JSON in the shape Apple documents', () => {
    expect(parsed.applinks.details).toHaveLength(1)
    expect(parsed.applinks.details[0].appIDs).toHaveLength(1)
    expect(parsed.applinks.details[0].components.length).toBeGreaterThan(0)
  })

  it('has NO file extension, which is what makes the header in next.config.ts necessary', () => {
    expect(path.extname(AASA)).toBe('')
  })

  it('names the Team and bundle id the iOS project is actually built with', () => {
    const [appID] = parsed.applinks.details[0].appIDs

    // `DEVELOPMENT_TEAM = 6V6M44T7KV;`, in both build configurations.
    const teams = [...read(PBXPROJ).matchAll(/DEVELOPMENT_TEAM = ([A-Z0-9]+);/g)].map((m) => m[1])
    expect(new Set(teams).size).toBe(1)

    // `PRODUCT_BUNDLE_IDENTIFIER = social.letsride.app;`, likewise — and
    // `capacitor.config.ts`'s `appId` is the value both are generated from.
    const bundleIds = [
      ...read(PBXPROJ).matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g),
    ].map((m) => m[1].trim())
    expect(new Set(bundleIds).size).toBe(1)
    expect(read(CAPACITOR_CONFIG)).toContain(`appId: '${bundleIds[0]}'`)

    expect(appID).toBe(`${teams[0]}.${bundleIds[0]}`)
  })

  it('matches every path, since the app is the whole site', () => {
    expect(parsed.applinks.details[0].components).toContainEqual(
      expect.objectContaining({ '/': '/*' })
    )
  })

  /**
   * The file is inert without the entitlement: iOS never fetches it, and no
   * link ever opens the app. They are two halves of one capability and either
   * one alone is a no-op that reads as done.
   */
  it('is claimed by the entitlement, on the same host and production only', () => {
    const entitlements = read(ENTITLEMENTS)
    expect(entitlements).toContain('com.apple.developer.associated-domains')
    expect(entitlements).toContain('<string>applinks:app.letsride.social</string>')

    // `app-dev.letsride.social` sits behind Vercel SSO, so Apple's
    // unauthenticated fetch could never verify it — an entry for it would ship
    // a build whose links silently fall back to the browser.
    expect(entitlements).not.toContain('applinks:app-dev.letsride.social')
  })

  /**
   * There is deliberately no `assetlinks.json` beside it. Android App Links
   * need the signing certificate's SHA-256 fingerprint, which does not exist —
   * `android/` has never been generated (PD-442) and nothing is signed. A file
   * carrying a placeholder fingerprint would fail Google's verification while
   * reading, in the repository, as delivered.
   */
  it('has no Android counterpart yet, and the reason is that android/ does not exist', () => {
    expect(() => read(path.join('public', '.well-known', 'assetlinks.json'))).toThrow()
    expect(() => read(path.join('android', 'app', 'build.gradle'))).toThrow()
  })
})

/**
 * **A native plugin is two things, and adding only the first is silent.**
 *
 * PD-205 added `@capacitor/app` to `package.json` and left the committed
 * `ios/App/CapApp-SPM/Package.swift` listing three plugins. `cap sync` writes
 * that file and no CI job regenerates it, so an Xcode build from the committed
 * project would not have linked `AppPlugin`: the entitlement and the
 * association file would both work, the universal link would open the app, and
 * `appUrlOpen` would never fire. A silent no-op on the exact device run meant
 * to verify the story — caught by `reviewer`, not by any gate, which is why
 * this test now exists.
 *
 * `docs/reference/native-shell.md` §The shell documents the same comparison as
 * a command a session should run. A test is strictly better: nobody has to
 * remember to run it, and the failure names the fix.
 */
describe('the SPM manifest lists every Capacitor plugin', () => {
  /**
   * `@capacitor/core` is the runtime rather than a plugin and never appears in
   * `Package.swift`, so the obvious filter reports one too many on a correct
   * tree — the trap the reference doc calls out by name.
   */
  const PLUGIN_PACKAGES = /^(@capacitor\/|@aparajita\/|@sentry\/capacitor)/

  const plugins = Object.keys(
    (JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies
  ).filter((name) => PLUGIN_PACKAGES.test(name) && name !== '@capacitor/core')

  const manifest = read(path.join('ios', 'App', 'CapApp-SPM', 'Package.swift'))

  it('has one .package(name:) entry per plugin dependency', () => {
    const entries = [...manifest.matchAll(/\.package\(name: "([^"]+)"/g)].map((m) => m[1])
    expect(entries).toHaveLength(plugins.length)
  })

  it('names each plugin by its node_modules path, so a rename cannot pass on count alone', () => {
    // Counting alone would accept a manifest that still carried a REMOVED
    // plugin beside a missing new one. The path is what ties each entry to a
    // dependency that is actually installed.
    for (const plugin of plugins) {
      expect(manifest).toContain(`node_modules/${plugin}`)
    }
  })

  it('and the detector catches a manifest that is one plugin short', () => {
    // Verified both ways: the assertion above reads 0 differences whether the
    // rule holds or the regex stopped matching, and this is what tells them
    // apart. The fixture is the real manifest with one entry removed.
    const short = manifest.replace(/\n\s*\.package\(name: "[^"]+", path: "[^"]+"\),/, '')
    const entries = [...short.matchAll(/\.package\(name: "([^"]+)"/g)].map((m) => m[1])
    expect(entries.length).toBe(plugins.length - 1)
  })
})
