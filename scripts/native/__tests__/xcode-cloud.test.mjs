import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_ORIGIN } from '../release-guards.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const RELATIVE = 'ios/App/ci_scripts/ci_post_clone.sh'
const SCRIPT = path.join(ROOT, RELATIVE)
const NODE_MAJOR = readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim()

/**
 * The Xcode Cloud post-clone script, which nothing else in this repo can run:
 * it executes on Apple's machines, after a merge to `main`, and its first
 * failure is a red build nobody is watching.
 *
 * So it is RUN here, against stub `brew`, `node`, `npm`, `npx` and `git` that
 * record their arguments, rather than grepped. A grep for `npm run
 * release:check` passes on a commented-out line, on one behind `|| true` and on
 * one after an early `exit 0`; the call log does not. Running it directly (not
 * as `sh <file>`) also means the shebang and the working-tree execute bit are
 * exercised — on CI's Linux runner that `/bin/sh` is dash, which keeps the
 * script to POSIX sh.
 */

/** What a successful run must call, in this order and nothing interleaved. */
const STEPS = [
  `brew install node@${NODE_MAJOR}`,
  'npm ci',
  'npm run build:native',
  'npx --no cap sync ios',
  'git status --porcelain --untracked-files=all -- ios',
  'npm run release:check',
]

/** Bookkeeping calls the script makes on the way, excluded from the order. */
const BOOKKEEPING = new Set([`brew --prefix node@${NODE_MAJOR}`, 'node --version'])

const REQUIRED_ENV = {
  CI_BRANCH: 'main',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'stub',
  // The constant itself, so a drift between it and the script's literal turns
  // the good run red rather than letting either move alone.
  NEXT_PUBLIC_CANONICAL_ORIGIN: RELEASE_ORIGIN,
}

let tmp

/** A stub that logs `name args…` and honours the STUB_* knobs below. */
function writeStub(dir, name, body = '') {
  const file = path.join(dir, name)
  writeFileSync(
    file,
    [
      '#!/bin/sh',
      `printf '%s\\n' "${name} $*" >> "$CALLS"`,
      `[ "${name} $*" = "\${STUB_FAIL:-}" ] && exit 1`,
      body,
      'exit 0',
      '',
    ].join('\n')
  )
  chmodSync(file, 0o755)
}

// Once per file, not per case: macOS scans every newly written executable on
// its first exec, and fresh stubs per case measured ~12s for this file against
// ~1s shared — enough load to time out an unrelated 5s test in the full suite.
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'xcode-cloud-'))
  const bin = path.join(tmp, 'bin')
  const kegBin = path.join(tmp, 'keg', 'bin')
  mkdirSync(bin)
  mkdirSync(kegBin, { recursive: true })
  mkdirSync(path.join(tmp, 'repo'))
  writeFileSync(path.join(tmp, 'repo', '.nvmrc'), `${NODE_MAJOR}\n`)

  writeStub(bin, 'brew', `[ "$1" = --prefix ] && echo "${path.join(tmp, 'keg')}"`)
  writeStub(bin, 'npm')
  writeStub(bin, 'npx')
  writeStub(bin, 'git', '[ "$1" = status ] && printf "%s" "${STUB_GIT_STATUS:-}"')
  // Two nodes: the image's, which is the wrong major, and the keg's. A script
  // that stops putting the keg first on PATH reaches the first and must fail.
  writeStub(bin, 'node', 'echo v0.0.0')
  writeStub(kegBin, 'node', `echo "\${STUB_NODE_VERSION:-v${NODE_MAJOR}.0.0}"`)
})

beforeEach(() => {
  rmSync(path.join(tmp, 'calls.log'), { force: true })
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function run(overrides = {}) {
  const env = {
    PATH: `${path.join(tmp, 'bin')}:/usr/bin:/bin`,
    HOME: tmp,
    CALLS: path.join(tmp, 'calls.log'),
    CI_PRIMARY_REPOSITORY_PATH: path.join(tmp, 'repo'),
    ...REQUIRED_ENV,
    ...overrides,
  }
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key]
  const result = spawnSync(SCRIPT, [], { cwd: tmp, env, encoding: 'utf8' })
  const log = path.join(tmp, 'calls.log')
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []
  return { status: result.status, stderr: result.stderr, calls }
}

const steps = (calls) => calls.filter((call) => !BOOKKEEPING.has(call))

describe('ci_post_clone.sh is where Xcode Cloud looks for it', () => {
  it('sits in ci_scripts beside App.xcodeproj', () => {
    expect(existsSync(path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj'))).toBe(true)
    expect(existsSync(SCRIPT)).toBe(true)
  })

  // Without the bit Xcode Cloud ignores the shebang and runs `zsh <file>`
  // (Apple, "Writing custom build scripts") — and a checkout on another
  // machine gets the INDEX mode, not this one's, so that is what is read.
  it('is committed executable, with a shebang', () => {
    const [mode] = execFileSync('git', ['ls-files', '-s', RELATIVE], { cwd: ROOT, encoding: 'utf8' }).split(' ')
    expect(mode).toBe('100755')
    expect(readFileSync(SCRIPT, 'utf8').split('\n')[0]).toBe('#!/bin/sh')
  })
})

describe('a good run', () => {
  it('runs every step in order and exits 0', () => {
    const { status, stderr, calls } = run()
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(steps(calls)).toEqual(STEPS)
  })

  // The gate must read the copy the archive contains, which cap sync writes.
  it('runs release:check after cap sync, never before', () => {
    const { calls } = run()
    expect(calls.indexOf('npm run release:check')).toBeGreaterThan(calls.indexOf('npx --no cap sync ios'))
  })
})

describe('any failing step fails the build, and nothing after it runs', () => {
  it.each(STEPS)('%s', (failing) => {
    const { status, calls } = run({ STUB_FAIL: failing })
    expect(status).not.toBe(0)
    const ran = steps(calls)
    expect(ran.at(-1)).toBe(failing)
    expect(ran).toEqual(STEPS.slice(0, STEPS.indexOf(failing) + 1))
  })
})

describe('refuses before running anything', () => {
  it.each([...Object.keys(REQUIRED_ENV), 'CI_PRIMARY_REPOSITORY_PATH'])('when %s is unset', (name) => {
    const { status, stderr, calls } = run({ [name]: undefined })
    expect(status).toBe(1)
    expect(stderr).toContain(name)
    expect(calls).toEqual([])
  })

  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_CANONICAL_ORIGIN'])('when %s is empty', (name) => {
    const { status, stderr, calls } = run({ [name]: '' })
    expect(status).toBe(1)
    expect(stderr).toContain(name)
    expect(calls).toEqual([])
  })

  // release:check cannot see these: the og:image fallback and app-version.json
  // carry RELEASE_ORIGIN into the bundle whatever the variable says.
  it.each(['https://app-dev.letsride.social', 'https://letsride.social', `${RELEASE_ORIGIN}/`])(
    'when NEXT_PUBLIC_CANONICAL_ORIGIN is %s',
    (origin) => {
      const { status, stderr, calls } = run({ NEXT_PUBLIC_CANONICAL_ORIGIN: origin })
      expect(status).toBe(1)
      expect(stderr).toContain(origin)
      expect(calls).toEqual([])
    }
  )

  // A manual build of another branch would reach TestFlight carrying PROD's
  // backend and unreleased code; release:check cannot see the branch.
  it.each(['development', 'xcode-cloud-testflight', 'mainline'])('on branch %s', (branch) => {
    const { status, stderr, calls } = run({ CI_BRANCH: branch })
    expect(status).toBe(1)
    expect(stderr).toContain(branch)
    expect(calls).toEqual([])
  })
})

describe('refuses mid-run', () => {
  it('when the node on PATH is not the .nvmrc major', () => {
    const { status, stderr, calls } = run({ STUB_NODE_VERSION: 'v26.3.0' })
    expect(status).toBe(1)
    expect(stderr).toContain('v26.3.0')
    expect(steps(calls)).toEqual(STEPS.slice(0, 1))
  })

  // cap sync rewrote a committed file: the archive's plugin graph is not the
  // one the repo records, and SwiftPM resolves from the committed
  // Package.resolved with automatic resolution off.
  it('when cap sync leaves ios/ different from the commit, before release:check', () => {
    const { status, stderr, calls } = run({ STUB_GIT_STATUS: ' M ios/App/CapApp-SPM/Package.swift' })
    expect(status).toBe(1)
    expect(stderr).toContain('ios/App/CapApp-SPM/Package.swift')
    expect(steps(calls)).toEqual(STEPS.slice(0, -1))
  })
})
