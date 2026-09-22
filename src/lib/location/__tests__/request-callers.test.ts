import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Who may raise the OS location dialog — `rider-position-question`.
 *
 * `requestDeviceLocation()` is the one function that can put the device's
 * one-shot permission prompt on screen, and the standing spec says no module
 * other than a tap-driven control may reach it. That sentence sat unenforced
 * until PD-477 added the second caller, `TownFromDevice`. This names both.
 *
 * **Any mention of the identifier counts, not only a call** — so an aliased
 * import (`import { requestDeviceLocation as ask }`) or the function handed
 * over as a bare reference is caught too, because each has to name it once.
 * Comment-stripped, per CLAUDE.md's comment trap: `LocationPrimingSheet.tsx`
 * describes the call in prose and does not make it.
 */

const SRC = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full)
    return /\.tsx?$/.test(full) ? [full] : []
  })
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const NAMES = /\brequestDeviceLocation\b/

const DEFINED_IN = 'lib/location/rider-location.ts'
const CALLERS = [
  'components/location/LocationQuestionRow.tsx',
  'components/location/TownFromDevice.tsx',
]

describe('requestDeviceLocation has exactly two callers', () => {
  const namers = walk(SRC)
    .filter((file) => NAMES.test(stripComments(readFileSync(file, 'utf8'))))
    .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
    .filter((file) => file !== DEFINED_IN)
    .sort()

  it('names them', () => {
    expect(namers).toEqual(CALLERS)
  })

  it('still finds the definition, so the walk is not reading an empty tree', () => {
    expect(NAMES.test(readFileSync(path.join(SRC, DEFINED_IN), 'utf8'))).toBe(true)
  })

  it('does not count the priming sheet, which only describes the call in a comment', () => {
    const sheet = readFileSync(path.join(SRC, 'components/location/LocationPrimingSheet.tsx'), 'utf8')
    expect(NAMES.test(sheet)).toBe(true)
    expect(NAMES.test(stripComments(sheet))).toBe(false)
  })
})
