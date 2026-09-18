import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../../..')
const DOORWAY = path.join('src', 'lib', 'native', 'deep-links.ts')

/**
 * `@capacitor/app` has exactly one importer — `src/lib/native/deep-links.ts`.
 * PD-205.
 *
 * The same rule Sentry, PostHog, the keychain plugin and
 * `@capacitor/push-notifications` carry, and `CLAUDE.md` §Technology Decisions
 * is where it is stated: each native plugin is a doorway module in `src/lib/`
 * that nothing else imports the package through, enforced by a test.
 *
 * What it buys here specifically:
 *
 * 1. **One subscriber to `appUrlOpen`.** The event is a navigation instruction
 *    from outside the app. A second listener is a second thing that can move
 *    the rider, racing the first, with no single place to read what the app
 *    does when a link arrives.
 * 2. **The web return stays checkable.** Every export in the doorway returns
 *    early unless `Capacitor.isNativePlatform()`. The plugin's web
 *    implementation reports browser page state, which this app does not use —
 *    a direct import elsewhere would reach it with no guard.
 *
 * Built rather than written out, for the reason
 * `src/lib/push/__tests__/doorway.test.ts` found the hard way: a literal here
 * would make this file its own first violator.
 */
const PLUGIN_IMPORT = new RegExp(`from '@capacitor/${'app'}'`)

function sourceWithoutComments(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function importersOutsideTheDoorway(): string[] {
  const results: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const rel = path.relative(ROOT, full)
      if (rel === DOORWAY) continue
      // Comment-stripped: `CLAUDE.md`'s comment trap. A file explaining why it
      // does NOT import the plugin reads exactly like one that does.
      if (PLUGIN_IMPORT.test(sourceWithoutComments(rel))) results.push(rel)
    }
  }

  walk(path.join(ROOT, 'src'))
  return results
}

describe('one doorway', () => {
  it('nothing outside src/lib/native/deep-links.ts imports @capacitor/app', () => {
    expect(importersOutsideTheDoorway()).toEqual([])
  })

  it('and the detector still catches a real import', () => {
    // **Verified both ways.** A filter reading 0 because its pattern is wrong
    // is indistinguishable from one reading 0 because the rule holds, and the
    // assertion above is the whole of this rule's enforcement.
    //
    // The specifier is concatenated so this file genuinely does not contain the
    // pattern — the alternative is excluding this file from the walk, which
    // would also hide a real accidental import in some other test.
    const specifier = '@capacitor/' + 'app'
    expect(PLUGIN_IMPORT.test(`import { App } from '${specifier}'\n`)).toBe(true)

    // And it is not fooled by the comment form, which is what the strip is for.
    const commented = `// import { App } from '${specifier}'\n`
    expect(PLUGIN_IMPORT.test(commented.replace(/^\s*\/\/.*$/gm, ''))).toBe(false)

    // `@capacitor/core` is a different package and must not be caught — every
    // component that asks `isNativePlatform()` imports it directly, by design.
    expect(PLUGIN_IMPORT.test(`import { Capacitor } from '@capacitor/core'\n`)).toBe(false)
  })

  it('the doorway returns early off the native platform', () => {
    // The one behaviour a node test cannot reach through the plugin itself. It
    // is asserted on the source because the alternative is mocking the bridge,
    // which would test the mock.
    expect(sourceWithoutComments(DOORWAY)).toMatch(/if \(!Capacitor\.isNativePlatform\(\)\)/)
  })
})
