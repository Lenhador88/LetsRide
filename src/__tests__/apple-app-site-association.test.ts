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
