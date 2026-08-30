import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareReleaseVersions, releaseVersionProblems } from '../release-guards.mjs'
import { compareVersions, parseVersion } from '../../../src/lib/version'

const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))

/**
 * The submission-time half of the update gate.
 *
 * `src/lib/version.ts` decides whether a rider is blocked and fails **open**;
 * `release-guards.mjs` decides whether a binary may be submitted and fails
 * **closed**. Two implementations, deliberately, because one is TypeScript
 * compiled into the client bundle and the other is a build script — so the
 * first block here is what stops them drifting apart, and the rest covers the
 * asymmetry that is supposed to exist between them.
 */

/** Every pair worth disagreeing about, run through both. */
const PAIRS = [
  ['1.10.0', '1.9.0'],
  ['1.9.0', '1.10.0'],
  ['0.1.0', '0.1.0'],
  ['0.1.0', '0.1.1'],
  ['1.2', '1.2.0'],
  ['2.0.0', '1.99.99'],
  ['0.0.1', '0.0.0'],
  ['v1.2.0', '1.2.0'],
  ['1.2.0-beta', '1.2.0'],
  ['1.2.0+7', '1.2.0'],
  ['', '1.0.0'],
  ['1..2', '1.0.2'],
]

describe('the two comparators agree', () => {
  it.each(PAIRS)('%s vs %s', (a, b) => {
    const script = compareReleaseVersions(a, b)
    const app = compareVersions(a, b)
    expect(script).toBe(app)
  })
})

describe('releaseVersionProblems', () => {
  it('passes a bundle at the published minimum', () => {
    expect(releaseVersionProblems('0.1.0', '0.1.0')).toEqual([])
  })

  it('passes a bundle above it', () => {
    expect(releaseVersionProblems('0.2.0', '0.1.1')).toEqual([])
  })

  /**
   * The whole reason this guard exists: raise the minimum to stop a broken
   * build, forget to bump the version, and the fix is blocked by the gate that
   * was raised to stop the break — for every rider, with no way out from inside
   * the app.
   */
  it('refuses a bundle the gate it ships alongside would block', () => {
    const problems = releaseVersionProblems('0.1.0', '0.1.1')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('BELOW the published minimum')
  })

  /** Fails closed, unlike the runtime gate — a store binary cannot be recalled. */
  it.each([
    ['v0.2.0', '0.1.0'],
    ['0.2.0', 'latest'],
    [undefined, '0.1.0'],
    ['0.2.0', 2],
  ])('refuses rather than shrugging when it cannot compare %s against %s', (a, b) => {
    expect(releaseVersionProblems(a, b)).toHaveLength(1)
  })
})

/**
 * The published file itself, not a literal.
 *
 * `readMinimumVersion` and `parseVersion` are covered against strings; nothing
 * read the real file, so a hand edit to `"v0.2.0"`, `"latest"`, a number, or a
 * renamed key would make the gate fail open on every launch for ever — and the
 * obvious check, grepping for `"minimum"`, passes on three of those four.
 */
describe('the shipped public/app-version.json', () => {
  const payload = JSON.parse(readFileSync(path.join(ROOT, 'public', 'app-version.json'), 'utf8'))

  it('carries a minimum the gate can actually parse', () => {
    expect(typeof payload.minimum).toBe('string')
    expect(parseVersion(payload.minimum)).not.toBeNull()
  })

  it('is one this repo could submit a build against today', () => {
    const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
    expect(releaseVersionProblems(version, payload.minimum)).toEqual([])
  })
})
