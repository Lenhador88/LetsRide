import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../../..')
const PUSH = path.join('src', 'lib', 'push')

/**
 * `@capacitor/push-notifications` has exactly one importer —
 * `src/lib/push/registration.ts`. PD-431.
 *
 * The same rule Sentry, PostHog and the keychain plugin carry, and here it
 * guards two things at once:
 *
 * 1. **The one-shot dialog.** iOS grants an app a single notification-permission
 *    prompt for the life of the install. `requestPermissions()` is what spends
 *    it, and a second importer is a second place that call can be made — from
 *    an effect, from a boot path, from a screen — with no sheet in front of it
 *    and nobody reviewing the moment. Keeping the import in one file is what
 *    makes "only a rider's tap can prompt" a checkable claim rather than a
 *    convention.
 * 2. **The web return.** Every export in the doorway returns early unless
 *    `Capacitor.isNativePlatform()`, because the plugin's web implementation
 *    talks to the browser's own Notification API — a channel this app
 *    deliberately does not use. A direct import elsewhere would reach that
 *    implementation with no guard.
 */
/**
 * Built rather than written out, for the reason the fixture below explains: a
 * literal here would make this file its own first violator.
 */
const PLUGIN_IMPORT = new RegExp(`from '@capacitor/${'push-notifications'}'`)

/** The one plugin call that spends the OS dialog. Concatenated for the same reason. */
const PROMPT_CALL = new RegExp(`PushNotifications\\.${'requestPermissions'}`)

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
      if (rel === path.join(PUSH, 'registration.ts')) continue
      // Comment-stripped, the comment trap this repo names in `CLAUDE.md`: a
      // file explaining why it does NOT import the plugin reads exactly like
      // one that does, and this very file is an example.
      if (PLUGIN_IMPORT.test(sourceWithoutComments(rel))) results.push(rel)
    }
  }

  walk(path.join(ROOT, 'src'))
  return results
}

describe('one doorway', () => {
  it('nothing outside src/lib/push/registration.ts imports @capacitor/push-notifications', () => {
    expect(importersOutsideTheDoorway()).toEqual([])
  })

  it('and the detector still catches a real import', () => {
    // **Verified both ways.** A filter that reads 0 because its pattern is
    // wrong is indistinguishable from one that reads 0 because the rule holds,
    // and the assertion above is the whole of this rule's enforcement.
    //
    // **The fixture is CONCATENATED rather than written out**, and that is not
    // style: the first version of this test spelled the import in a string
    // literal, the walk above scanned this file like any other, and the suite
    // failed naming this test as the violator. Comment-stripping does not help
    // — a string is not a comment. Splitting the specifier means the file
    // genuinely does not contain the pattern, so the rule keeps covering every
    // file in `src/` including the tests, rather than buying a green run with
    // an exclusion that would also hide a real accidental import in some other
    // test.
    const specifier = '@capacitor/' + 'push-notifications'
    const real = `import { PushNotifications } from '${specifier}'\n`
    expect(PLUGIN_IMPORT.test(real)).toBe(true)

    // And it is not fooled by the comment form, which is what the strip is for.
    const commented = `// import { X } from '${specifier}'\n`
    expect(PLUGIN_IMPORT.test(commented.replace(/^\s*\/\/.*$/gm, ''))).toBe(false)
  })

  it('the doorway is the only thing that can raise the OS dialog', () => {
    // `requestPermissions` is the one plugin call that spends the prompt. It
    // appears in `registration.ts` and must appear nowhere else — including in
    // `boot.ts`, which is the path most likely to grow one by accident.
    const callers: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        const rel = path.relative(ROOT, full)
        if (rel === path.join(PUSH, 'registration.ts')) continue
        if (PROMPT_CALL.test(sourceWithoutComments(rel))) callers.push(rel)
      }
    }
    walk(path.join(ROOT, 'src'))

    expect(callers).toEqual([])
    // Both ways, and the fixture is concatenated for the same reason as above.
    expect(PROMPT_CALL.test('PushNotifications.' + 'requestPermissions()')).toBe(true)
  })
})
