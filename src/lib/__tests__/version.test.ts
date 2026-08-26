import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { APP_VERSION, compareVersions, isBuildTooOld, parseVersion } from '@/lib/version'

/**
 * The comparison behind the native update gate.
 *
 * Every case here is one a wrong implementation would actually get wrong — a
 * string sort putting `1.9.0` above `1.10.0`, a lenient parse giving
 * `1.2.0-beta` an ordering nobody defined, a missing `minimum` reading as `0`
 * and blocking nobody or as `Infinity` and blocking everybody. The direction
 * matters more than usual: the failure mode of this file is riders locked out
 * of an app they cannot fix from inside.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('APP_VERSION', () => {
  it('equals package.json version, which is what the store build must also carry', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      version: string
    }

    // Two copies of one number, so this is the thing that keeps them one
    // number. `package.json` is not imported at runtime on purpose — that
    // bundles the whole dependency list into the client.
    expect(APP_VERSION).toBe(pkg.version)
  })

  it('is a version this file can actually parse', () => {
    // A constant the comparator rejects fails open on every launch, which reads
    // exactly like a gate that is working and has nothing to block.
    expect(parseVersion(APP_VERSION)).not.toBeNull()
  })
})

describe('parseVersion', () => {
  it('reads a three-part version', () => {
    expect(parseVersion('1.10.0')).toEqual([1, 10, 0])
  })

  it('reads a version shorter than three parts', () => {
    expect(parseVersion('2')).toEqual([2])
    expect(parseVersion('2.1')).toEqual([2, 1])
  })

  it('reads a version longer than three parts', () => {
    expect(parseVersion('1.2.3.4')).toEqual([1, 2, 3, 4])
  })

  it.each([
    ['a non-string', 42],
    ['undefined', undefined],
    ['null', null],
    ['an object', { minimum: '1.0.0' }],
    ['an empty string', ''],
    ['a v prefix', 'v1.2.0'],
    ['a pre-release suffix', '1.2.0-beta'],
    ['build metadata', '1.2.0+7'],
    ['a negative part', '1.-2.0'],
    ['an empty part', '1..2'],
    ['surrounding whitespace', ' 1.2.0 '],
    ['exponent notation', '1e3.0.0'],
    ['hex', '0x10.0.0'],
    ['a part beyond a safe integer', '1.99999999999999999999.0'],
  ])('rejects %s', (_label, value) => {
    expect(parseVersion(value)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders by number, not by string — 1.10.0 is newer than 1.9.0', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
  })

  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('pads the shorter side with zeros', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0.1', '1.2.0')).toBe(1)
    expect(compareVersions('1.2.0', '1.2.0.1')).toBe(-1)
  })

  it('returns null rather than an order when either side is unparseable', () => {
    // The distinction this exists for: "the file is corrupt" must not be
    // spendable as "older" or "equal".
    expect(compareVersions('1.2.3', 'latest')).toBeNull()
    expect(compareVersions(undefined, '1.2.3')).toBeNull()
  })
})

describe('isBuildTooOld', () => {
  it('blocks a build below the minimum', () => {
    expect(isBuildTooOld('1.9.0', '1.10.0')).toBe(true)
  })

  it('lets an equal build through — a minimum is the oldest build still allowed', () => {
    expect(isBuildTooOld('1.10.0', '1.10.0')).toBe(false)
  })

  it('lets a newer build through', () => {
    expect(isBuildTooOld('2.0.0', '1.10.0')).toBe(false)
  })

  it.each([
    ['a missing minimum', undefined],
    ['a null minimum', null],
    ['a numeric minimum', 2],
    ['a malformed minimum', 'v2.0.0'],
    ['an empty minimum', ''],
  ])('fails open on %s', (_label, minimum) => {
    expect(isBuildTooOld('0.1.0', minimum)).toBe(false)
  })

  it('fails open when the running version is the unparseable one', () => {
    expect(isBuildTooOld('nightly', '1.0.0')).toBe(false)
  })
})
