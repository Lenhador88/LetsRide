import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BENIGN_ORIGINS,
  PLATFORM_BUNDLE_DIRS,
  DEAD_ORIGIN_PATTERN,
  DEV_PROJECT_REF,
  MIN_FILES,
  PROD_PROJECT_REF,
  PROJECT_REF_PATTERN,
  RELEASE_ORIGIN,
  platformCopyProblems,
  releaseProblems,
  scanReleaseBundle,
} from '../release-guards.mjs'

/**
 * The release gate protects two properties that are unfixable after a store
 * submission, and its failure mode is a bundle that looks fine on the machine
 * that built it. So every detector is asserted in **both** directions — a clean
 * bundle passes, a planted failure is caught — and, separately, that each
 * pattern still matches a real value. A guard that has silently stopped
 * matching passes for ever and looks exactly like a clean bundle; the same
 * self-check `src/__tests__/no-service-role-key.test.ts` makes.
 *
 * The bundle here is a fixture. What is tested is the detector the real walk
 * uses, not the build.
 */

const temporaries = []

function fixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'letsride-release-'))
  temporaries.push(dir)
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(dir, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, contents)
  }
  return dir
}

afterEach(() => {
  while (temporaries.length > 0) rmSync(temporaries.pop(), { recursive: true, force: true })
})

/**
 * What a release bundle looks like, reduced to the three files that carry a
 * baked value. The chunk is shaped the way Next inlines a `NEXT_PUBLIC_*` read:
 * a string literal, in the middle of minified code.
 */
const RELEASE = {
  'index.html': '<!DOCTYPE html><html><body><div role="status"></div></body></html>',
  'postcards/detail.txt': '3:I[12345,[],""]\n0:["",{"children":["postcards"]}]\n',
  '_next/static/chunks/env.js':
    `const e={u:"https://${PROD_PROJECT_REF}.supabase.co",k:"sb_publishable_x",o:"${RELEASE_ORIGIN}"};`,
  // The one localhost hit a real bundle carries, copied off `out/` on
  // 2026-08-12: the auth client's default options object, overwritten by the
  // URL the app constructs its client with and never requested. Without
  // `BENIGN_ORIGINS` this line alone made the guard red on a correct release
  // bundle — which is a guard that gets switched off.
  '_next/static/chunks/supabase.js':
    'let rF={url:"http://localhost:9999",storageKey:"supabase.auth.token",autoRefreshToken:!0};',
}

/** The `problems` shape for a bundle of the right size, so only content is judged. */
function findings(dir) {
  const result = scanReleaseBundle(dir)
  return releaseProblems(
    { ...result, files: new Array(MIN_FILES).fill('padding') },
    { expectedRef: PROD_PROJECT_REF, expectedOrigin: RELEASE_ORIGIN }
  )
}

describe('the detectors themselves', () => {
  it('matches a real production project ref', () => {
    // The self-check. If this ever stops matching, every bundle reads clean.
    const found = [
      ...`https://${PROD_PROJECT_REF}.supabase.co/rest/v1/`.matchAll(PROJECT_REF_PATTERN),
    ]
    expect(found).toHaveLength(1)
    expect(found[0][1]).toBe(PROD_PROJECT_REF)
  })

  it('matches a real DEV project ref, which is the one that must never ship', () => {
    const found = [...`https://${DEV_PROJECT_REF}.supabase.co`.matchAll(PROJECT_REF_PATTERN)]
    expect(found[0][1]).toBe(DEV_PROJECT_REF)
  })

  it('matches every shape of dead origin a shell can produce', () => {
    for (const origin of [
      'https://localhost',
      'capacitor://localhost',
      'http://localhost:3000',
      'http://localhost',
    ]) {
      expect([...`x="${origin}/auth/callback"`.matchAll(DEAD_ORIGIN_PATTERN)], origin).toHaveLength(1)
    }
  })

  it('does not match the release origin as a dead one', () => {
    expect([...`x="${RELEASE_ORIGIN}"`.matchAll(DEAD_ORIGIN_PATTERN)]).toHaveLength(0)
  })

  it('names the library constant every build carries, and only that one', () => {
    // Both directions on the exclusion: the benign value is excused, and the
    // dev-server origin one digit away from it is not. An exclusion that
    // widened to "any localhost port" would pass a bundle pointed at a laptop.
    expect(BENIGN_ORIGINS.has('http://localhost:9999')).toBe(true)
    expect(BENIGN_ORIGINS.has('http://localhost:3000')).toBe(false)
    expect(BENIGN_ORIGINS.has('https://localhost')).toBe(false)
    expect(BENIGN_ORIGINS.has('capacitor://localhost')).toBe(false)
  })
})

describe('the release bundle guard', () => {
  it('passes a bundle built from main against letsride with the canonical origin', () => {
    const dir = fixture(RELEASE)
    const { refs, originFiles } = scanReleaseBundle(dir)
    expect(findings(dir)).toEqual([])
    expect([...refs.keys()]).toEqual([PROD_PROJECT_REF])
    expect(originFiles).toBe(1)
  })

  it('catches a bundle built against DEV, and says what that costs', () => {
    const problems = findings(
      fixture({
        ...RELEASE,
        '_next/static/chunks/env.js': `const e={u:"https://${DEV_PROJECT_REF}.supabase.co",o:"${RELEASE_ORIGIN}"};`,
      })
    )
    // Both halves fire: the production ref is absent AND the DEV one is present.
    // Either alone would be a guard with a way past it.
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain(`the production ref ${PROD_PROJECT_REF}`)
    expect(problems[1]).toContain(DEV_PROJECT_REF)
    expect(problems[1]).toContain('mailer_autoconfirm')
  })

  it('catches a bundle carrying both refs, which no branch produces and no rider should get', () => {
    const problems = findings(
      fixture({
        ...RELEASE,
        '_next/static/chunks/extra.js': `const dev="https://${DEV_PROJECT_REF}.supabase.co";`,
      })
    )
    expect(problems.some((p) => p.includes(DEV_PROJECT_REF))).toBe(true)
    expect(problems.some((p) => p.includes(`production ref ${PROD_PROJECT_REF} is absent`))).toBe(
      false
    )
  })

  it('catches an undeclared third project, which a two-name list would pass', () => {
    const problems = findings(
      fixture({
        ...RELEASE,
        '_next/static/chunks/other.js': 'const u="https://ylxnicopnaroltebvfnc.supabase.co";',
      })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('an undeclared Supabase project')
  })

  it('FAILS a bundle with no ref at all, rather than reporting it clean', () => {
    // The load-bearing case. A stale, empty or unscanned out/ finds no DEV ref
    // and no wrong origin, so a naive guard reports success on nothing.
    const problems = findings(
      fixture({
        'index.html': '<!DOCTYPE html><html><body></body></html>',
        '_next/static/chunks/env.js': `const e={o:"${RELEASE_ORIGIN}"};`,
      })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('no Supabase project ref found')
  })

  it('FAILS an empty directory for the same reason, twice over', () => {
    const { problems } = scanReleaseBundle(fixture({ 'index.html': '' }))
    expect(problems.some((p) => p.includes(`expected at least ${MIN_FILES}`))).toBe(true)
    expect(problems.some((p) => p.includes('no Supabase project ref found'))).toBe(true)
  })

  it('catches a bundle with no canonical origin baked in', () => {
    // What an unset NEXT_PUBLIC_CANONICAL_ORIGIN produces. next.config.ts now
    // refuses that build outright, so this is the second line rather than the
    // first — and it is the line that still holds for a bundle built before
    // that guard existed, or with the variable set to the wrong host.
    const problems = findings(
      fixture({
        ...RELEASE,
        '_next/static/chunks/env.js': `const e={u:"https://${PROD_PROJECT_REF}.supabase.co"};`,
      })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('appears in no file')
  })

  it('catches a localhost origin baked into a bundle', () => {
    const problems = findings(
      fixture({
        ...RELEASE,
        '_next/static/chunks/env.js': `const e={u:"https://${PROD_PROJECT_REF}.supabase.co",o:"http://localhost:3000"};`,
      })
    )
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('appears in no file')
    expect(problems[1]).toContain('http://localhost:3000')
  })

  it("catches the shell's own origin, which is what a bundle falls back to", () => {
    const problems = findings(
      fixture({
        ...RELEASE,
        '_next/static/chunks/share.js': `const u="capacitor://localhost/postcards/detail";`,
      })
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('capacitor://localhost')
  })
})

/**
 * PD-204 — the gate read `out/`, and `out/` is not what a store receives.
 *
 * `cap sync` copies `out/` into the platform project, and it is the platform
 * project that is archived, signed and uploaded. So a fresh `out/` beside a
 * month-old platform copy passed every detector above while the submission
 * carried the old backend and the old origin.
 *
 * The fixture is a whole repository root rather than one bundle, because the
 * check is a comparison between two directories and the absence of one of them
 * is one of the cases.
 */
describe('platformCopyProblems', () => {
  const IOS = PLATFORM_BUNDLE_DIRS.find((target) => target.platform === 'iOS')
  const ANDROID = PLATFORM_BUNDLE_DIRS.find((target) => target.platform === 'Android')

  /** A repository root holding `out/`, and a platform copy of whatever is given. */
  function repo(outFiles, platformFiles, { project = IOS.project, bundle = IOS.bundle } = {}) {
    const files = {}
    for (const [relative, contents] of Object.entries(outFiles)) {
      files[path.join('out', relative)] = contents
    }
    if (platformFiles) {
      // A marker inside the project directory, so the project exists even when
      // its `public/` copy does not — which is one of the cases.
      files[path.join(project, '.exists')] = ''
      for (const [relative, contents] of Object.entries(platformFiles)) {
        files[path.join(bundle, relative)] = contents
      }
    }
    return fixture(files)
  }

  const outNames = Object.keys(RELEASE)

  /**
   * The fixture bundles are four files, so the platform copy trips `MIN_FILES`
   * exactly as `findings()` above has to pad around it. Dropping that one line
   * keeps every case below about the thing it is testing — and the floor gets
   * its own case, because a helper that silently swallowed it would hide the
   * empty-copy failure this check most needs to catch.
   */
  const sized = (problems) => problems.filter((p) => !p.includes('files walked'))

  it('passes a platform copy that is byte-identical to out/', () => {
    const root = repo(RELEASE, RELEASE)
    expect(sized(platformCopyProblems(root, outNames, IOS))).toEqual([])
  })

  it('applies the size floor to the platform copy as well as to out/', () => {
    const root = repo(RELEASE, RELEASE)
    const problems = platformCopyProblems(root, outNames, IOS)
    expect(problems.some((p) => p.includes(`expected at least ${MIN_FILES}`))).toBe(true)
    // And it says which bundle it is talking about — the gate now has two.
    expect(problems.find((p) => p.includes('files walked'))).toContain(IOS.bundle)
  })

  /**
   * The case the whole change exists for, and the one nothing softer catches:
   * every file in the copy is individually valid — right ref, right origin — so
   * scanning it finds nothing. It is simply not the build that was just made.
   */
  it('catches a STALE copy whose files are each individually fine', () => {
    const root = repo(RELEASE, {
      ...RELEASE,
      'postcards/detail.txt': '3:I[99999,[],""]\n0:["",{"children":["postcards"]}]\n',
    })
    const problems = sized(platformCopyProblems(root, outNames, IOS))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('1 file differs')
    expect(problems[0]).toContain('postcards/detail.txt')
    expect(problems[0]).toContain('STALE')
  })

  it('catches a copy that predates a file the build now emits', () => {
    const { 'postcards/detail.txt': _dropped, ...withoutOneFile } = RELEASE
    const root = repo(RELEASE, withoutOneFile)
    const problems = sized(platformCopyProblems(root, outNames, IOS))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('1 file from out/ is absent')
    expect(problems[0]).toContain('postcards/detail.txt')
  })

  /**
   * The copy is judged by the same rules as `out/`, so a sync made before the
   * canonical origin existed — or from a DEV build — is caught on its contents
   * as well as on its staleness.
   */
  it('scans the copy itself, so an old sync pointing at DEV is caught', () => {
    const stalePlatform = {
      ...RELEASE,
      '_next/static/chunks/env.js': `const e={u:"https://${DEV_PROJECT_REF}.supabase.co",o:"${RELEASE_ORIGIN}"};`,
    }
    const root = repo(RELEASE, stalePlatform)
    const problems = platformCopyProblems(root, outNames, IOS)
    expect(problems.some((p) => p.includes(DEV_PROJECT_REF))).toBe(true)
    // And separately reported as disagreeing with out/, which is the other half.
    expect(problems.some((p) => p.includes('files differ') || p.includes('file differs'))).toBe(
      true
    )
    // Every scan problem says which platform and which directory it is about —
    // the gate now has two bundles to talk about and an unlabelled line would
    // be ambiguous about the one thing that matters.
    for (const problem of problems) expect(problem).toContain('iOS')
  })

  /**
   * A project with no `public/` means `cap sync` has never run for it, so the
   * archive ships an empty webview — a white screen on a device.
   */
  it('refuses a platform project that has never been synced', () => {
    const root = repo(RELEASE, {})
    const problems = platformCopyProblems(root, outNames, IOS)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('cap sync has never run')
  })

  /**
   * `android/` is not generated (PD-442) and a missing platform must be SILENT.
   * The other way round, this gate is red for everybody until somebody
   * generates a platform nobody has asked for — and a gate that is always red
   * gets switched off.
   */
  it('says nothing about a platform that does not exist', () => {
    const root = repo(RELEASE, RELEASE)
    expect(platformCopyProblems(root, outNames, ANDROID)).toEqual([])
  })

  it('and the absence is decided by the PROJECT, not by the bundle directory', () => {
    // A project directory with no copy is the failure above; no project
    // directory at all is the silence above. Asserted together because reading
    // either one alone makes the other look like a bug.
    const withProject = repo(RELEASE, {})
    const withoutProject = repo(RELEASE, null)
    expect(platformCopyProblems(withProject, outNames, IOS)).toHaveLength(1)
    expect(platformCopyProblems(withoutProject, outNames, IOS)).toEqual([])
  })
})
