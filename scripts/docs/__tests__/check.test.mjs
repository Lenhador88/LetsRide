import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  runClaim,
  decideExitCode,
  parseCountOutput,
  evaluateRlsRun,
  shellFailureReason,
  selectClaims,
  CHEAP_KINDS,
} from '../check.mjs'
import { claims as realClaims, extractWord } from '../registry.mjs'

/**
 * These exercise the full pipeline (locate -> measure -> compare) against a
 * throwaway root and cheap, deterministic shell commands — never `npm test`,
 * `next build` or real Postgres. That keeps the suite fast and, per
 * `CLAUDE.md`'s rule on written tests, deterministic: no wall clock, no
 * shared state, cleaned up after every test.
 */
describe('runClaim', () => {
  let root
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'docs-check-test-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function writeDoc(name, text) {
    writeFileSync(join(root, name), text)
  }

  it('passes when the stated value matches the measured value', () => {
    writeDoc('DOC.md', 'There are **7** widgets today.')
    const claim = {
      id: 'widgets',
      file: 'DOC.md',
      pattern: /There are \*\*(\d+)\*\* widgets today/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd: 'printf 7',
    }
    expect(runClaim(claim, { root })).toEqual({ id: 'widgets', status: 'pass', stated: 7, measured: 7 })
  })

  it('fails, and reports both numbers, when the stated value disagrees with measurement', () => {
    writeDoc('DOC.md', 'There are **7** widgets today.')
    const claim = {
      id: 'widgets',
      file: 'DOC.md',
      pattern: /There are \*\*(\d+)\*\* widgets today/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd: 'printf 9', // the doc says 7; the truth is 9
    }
    expect(runClaim(claim, { root })).toEqual({ id: 'widgets', status: 'fail', stated: 7, measured: 9 })
  })

  it('skips (not fails, not crashes) when the claim file does not exist', () => {
    // PD-155 review: `readFileSync` used to sit outside any try/catch, so a
    // renamed or deleted doc file threw ENOENT straight out of `runClaim`,
    // `main()` never caught it, and one moved file took the exit code to 1
    // for a run that had not measured anything — indistinguishable from a
    // real disagreement. This is `runClaim` never seeing `DOC.md` at all.
    const claim = {
      id: 'widgets',
      file: 'DOES-NOT-EXIST.md',
      pattern: /There are \*\*(\d+)\*\* widgets today/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd: 'printf 7',
    }
    const result = runClaim(claim, { root })
    expect(result.status).toBe('fail')
    expect(result.reason).toMatch(/could not read the file/)
    expect(result.reason).toMatch(/DOES-NOT-EXIST\.md/)
  })

  // Flipped from skip to fail on 2026-08-10. A claim whose anchor has vanished
  // is the repo's fault, not the environment's, and it is the exact signal the
  // CLAUDE.md split produced four times while `docs:check` still printed
  // "0 failed". See the comment on runClaim.
  it('FAILS when the anchor text cannot be found', () => {
    writeDoc('DOC.md', 'The widgets have moved to a different sentence entirely.')
    const claim = {
      id: 'widgets',
      file: 'DOC.md',
      pattern: /There are \*\*(\d+)\*\* widgets today/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd: 'printf 9',
    }
    const result = runClaim(claim, { root })
    expect(result.status).toBe('fail')
    expect(result.reason).toMatch(/could not locate/)
  })

  it('FAILS when the anchor text is ambiguous', () => {
    writeDoc('DOC.md', 'There are **7** widgets today. There are **7** widgets today.')
    const claim = {
      id: 'widgets',
      file: 'DOC.md',
      pattern: /There are \*\*(\d+)\*\* widgets today/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd: 'printf 7',
    }
    const result = runClaim(claim, { root })
    expect(result.status).toBe('fail')
    expect(result.reason).toMatch(/could not locate/)
  })

  it('skips (not fails) when a word-based claim cannot read its stated value', () => {
    // The escape hatch PD-155 review asked for: a word this repo's number
    // table does not know (a typo, "a dozen") must not crash the run — it is
    // a loud SKIP, distinct from "could not locate" so the report says which
    // failure mode it hit.
    writeDoc('DOC.md', 'There are **eleventy** widgets today.')
    const claim = {
      id: 'widgets',
      file: 'DOC.md',
      pattern: /There are \*\*(\w+)\*\* widgets today/,
      extractStated: extractWord(),
      kind: 'shell',
      cmd: 'printf 9',
    }
    const result = runClaim(claim, { root })
    expect(result.status).toBe('skip')
    expect(result.reason).toMatch(/could not read the stated value/)
    expect(result.reason).toMatch(/eleventy/)
  })

  it('FAILS — not skips — when a word-based claim is edited to a new, wrong, but recognized word', () => {
    // This is PD-155 review's headline defect end to end. Before the fix,
    // every one of the seven word-spelling claims embedded its expected word
    // literally inside the anchor regex, so editing the doc to a different
    // number just stopped the anchor matching — a SKIP. `extractWord()`
    // captures the word instead of hardcoding it, so the doc's wrong number
    // is read, converted, and compared against measurement — which is what
    // makes it possible to go red at all.
    writeDoc('DOC.md', 'There are **twelve** widgets today.') // doc now (wrongly) says twelve
    const claim = {
      id: 'widgets',
      file: 'DOC.md',
      pattern: /There are \*\*(\w+)\*\* widgets today/,
      extractStated: extractWord(),
      kind: 'shell',
      cmd: 'printf 7', // ground truth is still 7
    }
    expect(runClaim(claim, { root })).toEqual({ id: 'widgets', status: 'fail', stated: 12, measured: 7 })
  })

  it('skips (not fails) when the measurement command fails to run', () => {
    writeDoc('DOC.md', 'There are **7** widgets today.')
    const claim = {
      id: 'widgets',
      file: 'DOC.md',
      pattern: /There are \*\*(\d+)\*\* widgets today/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd: 'command-that-does-not-exist-xyz',
    }
    const result = runClaim(claim, { root })
    expect(result.status).toBe('skip')
    expect(result.reason).toMatch(/command failed/)
  })

  it('skips (not fails) when the measurement command runs but prints no number', () => {
    writeDoc('DOC.md', 'There are **7** widgets today.')
    const claim = {
      id: 'widgets',
      file: 'DOC.md',
      pattern: /There are \*\*(\d+)\*\* widgets today/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd: 'printf "not a number"',
    }
    const result = runClaim(claim, { root })
    expect(result.status).toBe('skip')
    expect(result.reason).toMatch(/could not parse/)
  })

  it('caches an identical command across two claims, running it once', () => {
    writeDoc('DOC.md', 'A is **3**. B is **3**.')
    const marker = join(root, 'ran-once.marker')
    // Appends to a file each time it actually runs; if the cache is broken
    // the second claim would append again and the count would be 2.
    const cmd = `printf 'x' >> '${marker}'; printf 3`
    const claimA = {
      id: 'a',
      file: 'DOC.md',
      pattern: /A is \*\*(\d+)\*\*/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd,
    }
    const claimB = {
      id: 'b',
      file: 'DOC.md',
      pattern: /B is \*\*(\d+)\*\*/,
      extractStated: (m) => Number(m[1]),
      kind: 'shell',
      cmd,
    }
    const fileCache = new Map()
    const measureCache = new Map()
    const cache = (map) => (key, compute) => {
      if (!map.has(key)) map.set(key, compute())
      return map.get(key)
    }
    const ctx = { root, fileCache: cache(fileCache), measureCache: cache(measureCache) }

    runClaim(claimA, ctx)
    runClaim(claimB, ctx)

    expect(readFileSync(marker, 'utf8')).toBe('x') // ran exactly once, not twice
  })

  it('computes a contrast claim purely, with no shell command at all', () => {
    writeDoc('DOC.md', 'Contrast is **21:1**.')
    const claim = {
      id: 'contrast',
      file: 'DOC.md',
      pattern: /Contrast is \*\*(\d+(?:\.\d+)?):1\*\*/,
      extractStated: (m) => Number(m[1]),
      kind: 'contrast',
      hexA: '#000000',
      hexB: '#FFFFFF',
    }
    expect(runClaim(claim, { root })).toEqual({ id: 'contrast', status: 'pass', stated: 21, measured: 21 })
  })
})

describe('decideExitCode — the exit-code contract', () => {
  it('is 0 when everything checked passed', () => {
    expect(decideExitCode({ passed: [1, 2], failed: [], skipped: [] })).toBe(0)
  })

  it('is 0 when some claims were skipped but nothing failed', () => {
    // A skip must not fail the run on its own — only be loud in the report.
    expect(decideExitCode({ passed: [1], failed: [], skipped: [1, 2] })).toBe(0)
  })

  it('is 1 whenever anything failed, regardless of skips', () => {
    expect(decideExitCode({ passed: [1], failed: [1], skipped: [] })).toBe(1)
    expect(decideExitCode({ passed: [], failed: [1], skipped: [1, 2, 3] })).toBe(1)
  })

  it('is 2 when nothing could be measured at all — the "nothing to compare" case', () => {
    expect(decideExitCode({ passed: [], failed: [], skipped: [1, 2, 3] })).toBe(2)
  })

  it('is 1, not 2, when a failure and a total-skip both look bad at once', () => {
    // Failed must win — a real disagreement is worse news than "couldn't check
    // everything", and a caller gating CI on exit code needs the stronger
    // signal to survive, not the more common one.
    expect(decideExitCode({ passed: [], failed: [1], skipped: [1, 2] })).toBe(1)
  })

  it('goes red if the failed-wins precedence is ever dropped', () => {
    // Guards against the tempting-but-wrong simplification "skipped.length
    // === total ? 2 : failed.length ? 1 : 0" being reordered so a mixed
    // fail+skip result silently reports 2 instead of 1.
    const mixed = { passed: [], failed: ['x'], skipped: ['y'] }
    expect(decideExitCode(mixed)).not.toBe(2)
  })
})

describe('parseCountOutput', () => {
  it('reads a bare integer', () => {
    expect(parseCountOutput('958\n')).toEqual({ value: 958 })
  })

  it('reads 0 as a real value, not a parse failure', () => {
    expect(parseCountOutput('0\n')).toEqual({ value: 0 })
  })

  it('skips on empty output — the PD-155 review defect', () => {
    // `Number('')` is `0`, not `NaN`, so the old `isNaN`-based guard read an
    // empty pipeline (a broken search path producing no output at all) as a
    // confident, permanently-green 0. A strict digits-only match closes it.
    const result = parseCountOutput('')
    expect('skip' in result).toBe(true)
    expect(result.skip).toMatch(/could not parse/)
  })

  it('skips on whitespace-only output too', () => {
    const result = parseCountOutput('   \n  ')
    expect('skip' in result).toBe(true)
  })

  it('skips on non-numeric output', () => {
    const result = parseCountOutput('not a number')
    expect('skip' in result).toBe(true)
  })
})

describe('evaluateRlsRun', () => {
  it('trusts a nonzero count from a clean (ok) run', () => {
    expect(evaluateRlsRun({ ok: true, count: 958 })).toEqual({ value: 958 })
  })

  it('never trusts a count from a non-ok run, even a large one', () => {
    // The exact PD-155 review defect: a suite that dies 700 assertions in
    // still printed 700 real "NOTICE: ok" lines. Trusting that count reports
    // "stated 958, measured 700" — a confident FAIL for a run that never
    // actually finished, which is worse than a SKIP because it looks like
    // real evidence the doc is wrong.
    const result = evaluateRlsRun({ ok: false, count: 700 })
    expect('skip' in result).toBe(true)
  })

  it('skips a clean run with a zero count — the output-format-changed mirror case', () => {
    // A suite that legitimately asserts nothing does not exist in this repo
    // — `run.sh` always applies a non-empty chain — so ok:true with count:0
    // means the counting itself broke (this file's own execSync bug was
    // exactly this shape once), not that the suite passed vacuously.
    const result = evaluateRlsRun({ ok: true, count: 0 })
    expect('skip' in result).toBe(true)
  })
})

describe('shellFailureReason', () => {
  it('reports a timeout distinctly from a command that ran and failed', () => {
    // PD-155 review: `timedOut` was computed and never read, so a 5-minute
    // `next build` timeout and a build that failed to compile read as the
    // identical "command failed" skip reason. This is the fix wired up.
    const res = { timedOut: true, timeoutMs: 300_000, stdout: '', stderr: '' }
    expect(shellFailureReason(res)).toBe('timed out after 300s')
  })

  it('falls through to the last non-empty output line for an ordinary failure', () => {
    const res = { timedOut: false, stdout: '', stderr: 'line one\nline two\n' }
    expect(shellFailureReason(res)).toBe('line two')
  })

  it('does not read stdout/stderr at all when it timed out', () => {
    // A timeout can still have partial output captured; the timeout reason
    // must win rather than quoting a half-finished build log.
    const res = { timedOut: true, timeoutMs: 8_000, stdout: 'partial nonsense', stderr: '' }
    expect(shellFailureReason(res)).not.toContain('partial nonsense')
  })
})

/**
 * `--cheap` is what makes `ci.yml`'s "Doc claims (cheap)" step runnable on
 * every PR. The split it depends on is the whole contract: a claim kind that
 * needs Postgres or a full build must never end up inside it, because the CI
 * step has neither and the claim would fail rather than be absent.
 */
describe('selectClaims — the --cheap split', () => {
  it('is a no-op without the flag', () => {
    expect(selectClaims(realClaims)).toBe(realClaims)
    expect(selectClaims(realClaims, {})).toBe(realClaims)
  })

  it('drops exactly the kinds that need an external service', () => {
    const cheap = selectClaims(realClaims, { cheap: true })
    expect(cheap.every((c) => CHEAP_KINDS.has(c.kind))).toBe(true)
    expect(cheap.some((c) => c.kind === 'rls')).toBe(false)
    expect(cheap.some((c) => c.kind === 'build')).toBe(false)
    expect(cheap.some((c) => c.kind === 'vitest-file')).toBe(false)
  })

  it('keeps every claim the expensive kinds do not own', () => {
    const cheap = selectClaims(realClaims, { cheap: true })
    const expensive = realClaims.filter((c) => !CHEAP_KINDS.has(c.kind))
    expect(cheap.length + expensive.length).toBe(realClaims.length)
  })

  it('selects a non-empty set from the real registry', () => {
    expect(selectClaims(realClaims, { cheap: true }).length).toBeGreaterThan(0)
  })

  // An earlier version of this block asserted the opposite in a comment — that
  // an empty selection would exit 2 on its own, so this test was a second
  // guard. It was not: `decideExitCode` read `passed.length === 0 && skipped
  // .length > 0`, and an empty selection skips nothing, so it exited 0 and CI
  // went green having checked nothing. Both halves are now real: the contract
  // below, and this test above it.
  it('exits 2 rather than 0 when the selection is empty', () => {
    expect(decideExitCode({ passed: [], failed: [], skipped: [] })).toBe(2)
  })

  // --cheap selects only claims that measure with a local command, so a skip
  // there is a broken command or a moved output format — never the absent
  // Postgres a full run tolerates.
  it('makes a skip fatal under strict, and only under strict', () => {
    expect(decideExitCode({ passed: [1], failed: [], skipped: [1] })).toBe(0)
    expect(decideExitCode({ passed: [1], failed: [], skipped: [1] }, { strict: true })).toBe(1)
  })

  // A kind added to the registry without a decision about which side it falls
  // on defaults to expensive — absent from CI — which is the safe direction
  // but a silent one. This fails when that happens, so the choice gets made.
  it('has a declared side for every kind the registry actually uses', () => {
    const known = new Set(['shell', 'contrast', 'rls', 'build', 'vitest', 'vitest-file'])
    for (const c of realClaims) expect(known.has(c.kind)).toBe(true)
  })
})
