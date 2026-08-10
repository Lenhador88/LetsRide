/**
 * Runs the declared registry of numeric doc claims (`registry.mjs`) against
 * measured ground truth and reports every disagreement.
 *
 * ## Why this exists
 *
 * `npm run db:drift` is the precedent this matches: automates exactly one
 * claim class (does the migration chain the repo, DEV and PROD each think
 * they have actually agree?) rather than trying to read every claim in the
 * docs. This does the same for numeric claims — the largest sub-class of what
 * `reviewer` finds, per Linear PD-155 — and it inherits `db:drift`'s shape:
 * a declared comparison, a table, a summary line, an exit code a CI step
 * could gate on later.
 *
 * ## Three outcomes, not two
 *
 * A claim either PASSES (measured equals stated), FAILS, or is SKIPPED.
 *
 * FAILS covers two shapes: measured but different, and — since 2026-08-10 — a
 * claim whose anchor cannot be located or whose file is missing. A vanished
 * anchor is the repo's fault, not the environment's, which is the line between
 * the two; `runClaim` carries the full reasoning.
 *
 * SKIPPED means could not be measured at all: no Postgres, a build that would
 * not complete, or a stated *word* the number table cannot parse. The contract
 * PD-155 sets is explicit:
 * a skip must never read as a pass. So the summary line reports all three
 * separately, and the exit code distinguishes "everything I could check
 * agreed" (0) from "something disagreed" (1) from "I could not check
 * anything at all" (2) — the last one is `db:drift`'s "nothing to compare"
 * case, read onto a per-claim registry instead of a single URL pair.
 *
 * ## What is expensive, and why it still runs by default
 *
 * Two claim kinds shell out to something slow: `kind: 'rls'` needs a scratch
 * Postgres database (`npm test` itself creates and tears it down), and
 * `kind: 'build'` runs a full `next build`. Both are cached per distinct
 * command (see `makeCache` below) so N claims citing the same measurement
 * cost one real run, and both degrade to a clean SKIP — never a crash, never a
 * false FAIL — when the environment cannot supply them. That degradation is
 * not a nicety for the RLS suite specifically: PD-155 asks for it by name,
 * because a script that throws when Postgres is down is worse than one that
 * silently never gets run in CI.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import {
  claims as defaultClaims,
  findOnce,
  ClaimLocateError,
  ClaimExtractError,
  contrastRatio,
  roundTo,
  countLines,
} from './registry.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Runs `cmd` under bash, capturing stdout AND stderr regardless of exit code.
 *
 * `spawnSync` rather than `execSync`, deliberately: `execSync`'s return value
 * on the success path is stdout *only* — there is no way to also read stderr
 * without it throwing. That is a real bug this file shipped and caught on its
 * own first run: `npm test`'s `NOTICE: ok` lines are `RAISE NOTICE` output,
 * which psql writes to stderr, so the RLS claims measured a confident `0`
 * against a healthy suite. `spawnSync` returns both streams unconditionally,
 * which is what a "did the docs get it right" check actually needs — psql's
 * own stream split is not a boundary this tool should have to know about.
 *
 * Never throws — a failed command is data (it is how a SKIP gets its reason),
 * not an exception a caller has to remember to catch. `stdio: ['ignore', ...]`
 * matters as much as that: a `psql` with no password piped in blocks on a
 * prompt forever rather than failing fast, exactly the trap `db:drift`'s
 * `run.sh` precedent already avoids.
 */
function runShell(cmd, { cwd = ROOT, timeout = 60_000, env = process.env } = {}) {
  const res = spawnSync(cmd, {
    cwd,
    shell: '/bin/bash',
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    env,
  })
  return {
    ok: res.status === 0 && !res.error,
    stdout: res.stdout ?? '',
    stderr: res.error ? String(res.error.message || res.error) : res.stderr ?? '',
    timedOut: res.signal === 'SIGTERM' || res.error?.code === 'ETIMEDOUT',
    timeoutMs: timeout,
  }
}

/**
 * Last non-empty line of stderr, else stdout — matches `db:drift`'s error
 * reporting — EXCEPT for a timeout, which is reported distinctly rather than
 * falling through to whatever partial output happened to be captured. A
 * `next build` that hits the 5-minute ceiling and one that fails to compile
 * both leave `res.ok === false`, and without this they read as the same
 * "command failed" skip reason — worth telling apart, since one means "the
 * environment is slow right now" and the other means "the build is broken".
 */
export function shellFailureReason(res) {
  if (res.timedOut) {
    return `timed out after ${Math.round(res.timeoutMs / 1000)}s`
  }
  const text = (res.stderr || res.stdout || 'no output').trim()
  const lastLine = text.split('\n').filter(Boolean).pop()
  return lastLine || 'unknown error'
}

/**
 * Is a live Postgres reachable? A dedicated, fast precheck rather than
 * inferring availability from the RLS suite's own failure text — the suite
 * can fail for reasons that are NOT "Postgres is absent" (a real regression,
 * say), and conflating the two would turn an environment gap into a false
 * FAIL. `stdio: ['ignore', ...]` means a missing `PGPASSWORD` fails fast
 * ("no password supplied") instead of hanging on a prompt.
 */
function postgresAvailable(root) {
  const host = process.env.PGHOST || 'localhost'
  const port = process.env.PGPORT || '5432'
  const user = process.env.PGUSER || 'postgres'
  const password = process.env.PGPASSWORD || 'postgres'
  const res = runShell(
    `psql -h '${host}' -p '${port}' -U '${user}' -d postgres -At -c "select 1"`,
    { cwd: root, timeout: 8_000, env: { ...process.env, PGPASSWORD: password } }
  )
  if (res.ok && res.stdout.trim() === '1') return { available: true }
  return { available: false, reason: shellFailureReason(res) }
}

/** Memoizes a measurement by key, so N claims citing the same command run it once. */
function makeCache() {
  const store = new Map()
  return (key, compute) => {
    if (!store.has(key)) store.set(key, compute())
    return store.get(key)
  }
}

/**
 * Turns raw shell output into a trusted count, or a reason it isn't one.
 * Pure and exported so PD-155's review comment on it — `Number('')` is `0`,
 * not `NaN`, so the old `isNaN` guard let empty output through as a
 * confident, permanently-green `0` — has a direct test rather than only a
 * live demonstration. Every shell claim here is a `wc -l`/`grep -c` count,
 * so a strict digits-only match is the right shape, not `Number(x)` +
 * `isNaN(x)`: `Number('')` is `0`, `Number(' ')` is `0`, `Number('12abc')`
 * is `NaN` but `Number('  12  ')` is `12` — none of that ambiguity belongs
 * in "did the command print a count".
 */
export function parseCountOutput(stdout) {
  const trimmed = stdout.trim()
  if (!/^\d+$/.test(trimmed)) {
    return { skip: `could not parse a number from output: ${JSON.stringify(stdout.slice(0, 200))}` }
  }
  return { value: Number(trimmed) }
}

/**
 * Decides whether an `npm test` (RLS suite) run's "NOTICE: ok" count can be
 * trusted at all. Pure and exported for the same reason as `parseCountOutput`
 * — PD-155's review found the count was trusted whenever it was nonzero,
 * even from a run that never exited 0. A suite that dies 700 assertions in
 * still printed 700 real "NOTICE: ok" lines first, and `700 !== 958` reports
 * as a FAIL — which is exactly the shape that has previously tempted a
 * session to "correct" `CLAUDE.md` to a broken run's number instead of
 * re-running it (`CLAUDE.md`'s own history section records this happening
 * with the 641/647 mismatch). Only a clean exit makes the count meaningful;
 * a clean exit with a zero count is the mirror failure — the output format
 * changed (this file's own `execSync`→`spawnSync` fix was exactly that,
 * once) — not a suite that legitimately asserted nothing.
 */
export function evaluateRlsRun({ ok, count }) {
  if (!ok) return { skip: 'RLS suite did not complete' }
  if (count === 0) return { skip: 'RLS suite completed but produced no "NOTICE: ok" lines to count' }
  return { value: count }
}

/**
 * Runs the measurement side of one claim. Returns `{ value }` on success or
 * `{ skip: reason }` — never throws, so one bad claim cannot take the whole
 * report down with it.
 */
function measure(claim, cache, root) {
  switch (claim.kind) {
    // Measured exactly like 'shell'. The separate name is the whole point: it
    // keeps a claim that SPAWNS VITEST out of CHEAP_KINDS, which two red CI
    // runs argued for more convincingly than reasoning did. `npx vitest`
    // failed on the runner in under a second, and after switching to the local
    // binary the summary line the command greps for did not appear either —
    // green locally both times, including under CI=true GITHUB_ACTIONS=true.
    // A claim whose ground truth is a human-readable summary from a test
    // runner is not "a local command" in the sense --cheap means, and the
    // difference is not a thing to keep re-diagnosing from a CI log.
    case 'vitest-file':
    case 'shell': {
      // `claim.timeoutMs` overrides runShell's 60s default, which was chosen
      // for greps. A claim that spawns a real process needs its own ceiling:
      // under --cheap a timeout is no longer a green skip but a red build, so
      // a 60s bound on a cold CI runner would turn a slow machine into a
      // failed PR on a diff that changed nothing about the claim.
      const res = cache(`shell:${claim.cmd}`, () => runShell(claim.cmd, { cwd: root, timeout: claim.timeoutMs }))
      if (!res.ok) return { skip: `command failed: ${shellFailureReason(res)}` }
      return parseCountOutput(res.stdout)
    }

    case 'rls': {
      const pg = cache('pg-precheck', () => postgresAvailable(root))
      if (!pg.available) return { skip: `Postgres unavailable — ${pg.reason}` }

      const res = cache('rls-suite', () =>
        runShell('npm test', {
          cwd: root,
          timeout: 5 * 60_000,
          env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' },
        })
      )
      const combined = `${res.stdout}\n${res.stderr}`
      const count = countLines(combined, /NOTICE:\s+ok/)
      const outcome = evaluateRlsRun({ ok: res.ok, count })
      // Only a non-ok run has a shell failure worth appending — the
      // clean-but-zero case already says everything there is to say, and
      // `shellFailureReason` on a successful run would just print the tail
      // of the suite's own (normal) stderr noise, not a cause.
      if ('skip' in outcome) {
        return { skip: res.ok ? outcome.skip : `${outcome.skip}: ${shellFailureReason(res)}` }
      }
      return outcome
    }

    case 'vitest': {
      const res = cache('vitest', () => runShell('npm run test:unit', { cwd: root, timeout: 3 * 60_000 }))
      const combined = `${res.stdout}\n${res.stderr}`
      if (!/Test Files/.test(combined)) return { skip: `vitest did not produce a summary: ${shellFailureReason(res)}` }
      const n = claim.parseMeasured(combined)
      if (n == null) return { skip: 'could not parse the vitest summary line' }
      return { value: n }
    }

    case 'build': {
      const res = cache('build', () =>
        runShell(
          'NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build',
          { cwd: root, timeout: 5 * 60_000 }
        )
      )
      if (!res.ok) return { skip: `build did not complete: ${shellFailureReason(res)}` }
      const n = claim.parseMeasured(res.stdout)
      if (n == null) return { skip: 'could not parse the build output' }
      return { value: n }
    }

    case 'contrast': {
      return { value: roundTo(contrastRatio(claim.hexA, claim.hexB), 2) }
    }

    default:
      return { skip: `unknown claim kind: ${claim.kind}` }
  }
}

/**
 * Reads `claim.file` under `root`, cached. A renamed or deleted doc file
 * (`ENOENT`) is exactly the same class of problem as an anchor that no
 * longer matches — the claim cannot be checked, not "cannot be checked and
 * therefore the whole run should crash". `measure`'s own docstring already
 * promises "never throws"; this is that same promise for the file-read half,
 * which read outside any try/catch until PD-155's review caught it — a
 * single moved file took the exit code straight to 1 ("something disagreed")
 * for a run that had not actually measured anything.
 */
function readClaimFile(claim, root, fileCache) {
  return fileCache(claim.file, () => {
    try {
      return { ok: true, content: readFileSync(join(root, claim.file), 'utf8') }
    } catch (err) {
      return { ok: false, reason: err.code === 'ENOENT' ? `file not found: ${claim.file}` : String(err.message || err) }
    }
  })
}

/**
 * Runs one claim end to end: locate the stated value, measure the truth,
 * compare. Exported so tests can exercise it against a fake root/claim
 * without going through `main()`'s printing and `process.exit`.
 */
export function runClaim(claim, { root = ROOT, fileCache = makeCache(), measureCache = makeCache() } = {}) {
  // A missing file, or a claim whose anchor no longer matches, is a FAILURE.
  //
  // Both read as a skip until 2026-08-10, on the reasoning that a skip means
  // "could not check". That is true of Postgres being down and false here, and
  // the difference is whose fault it is: an unavailable measurement is the
  // environment's, while a vanished anchor is the repo's — and the repo is what
  // this script exists to police. It showed up under the CLAUDE.md split, where
  // four claims moved to a new file: `docs:check` printed "0 failed" with them
  // sitting quietly in the skip list, and only `registry.test.mjs`'s separate
  // locate sweep went red. A hand-run must not be gentler than CI about the one
  // thing it is uniquely placed to catch.
  //
  // ClaimExtractError deliberately stays a SKIP. That one is not the same
  // animal: it fires when the *stated* text is a word the number table does not
  // know ("a dozen", a typo), and PD-155's review asked for it explicitly so an
  // unparseable word cannot take down the run. Failing it would push authors
  // into a restricted vocabulary, which is a cost this check should not impose.
  const file = readClaimFile(claim, root, fileCache)
  if (!file.ok) {
    return { id: claim.id, status: 'fail', reason: `could not read the file — ${file.reason}` }
  }

  let stated
  try {
    const m = findOnce(file.content, claim.pattern)
    stated = claim.extractStated(m)
  } catch (err) {
    if (err instanceof ClaimLocateError) {
      return { id: claim.id, status: 'fail', reason: `could not locate the claim — ${err.message}` }
    }
    if (err instanceof ClaimExtractError) {
      return { id: claim.id, status: 'skip', reason: `could not read the stated value — ${err.message}` }
    }
    throw err
  }

  const result = measure(claim, measureCache, root)
  if ('skip' in result) {
    return { id: claim.id, status: 'skip', stated, reason: result.skip }
  }
  const status = result.value === stated ? 'pass' : 'fail'
  return { id: claim.id, status, stated, measured: result.value }
}

function printReport(results, claims) {
  const byId = new Map(claims.map((c) => [c.id, c]))
  const passed = results.filter((r) => r.status === 'pass')
  const failed = results.filter((r) => r.status === 'fail')
  const skipped = results.filter((r) => r.status === 'skip')

  console.log()
  console.log('  docs:check — numeric doc-claims sweep')
  console.log()

  if (failed.length) {
    console.log('  FAILURES:')
    for (const r of failed) {
      const c = byId.get(r.id)
      console.log(`    - [${r.id}] ${c.file}`)
      console.log(`        ${c.about}`)
      // Two shapes of failure now land here. A disagreement has both numbers; a
      // claim that could not be located has neither, only a reason — printing
      // "stated undefined, measured undefined" for it would bury the one line
      // that says what to do about it.
      console.log(r.reason ? `        ${r.reason}` : `        stated ${r.stated}, measured ${r.measured}`)
    }
    console.log()
  }

  if (skipped.length) {
    console.log('  SKIPPED (not counted as passing):')
    for (const r of skipped) {
      const c = byId.get(r.id)
      console.log(`    - [${r.id}] ${c.file} — ${r.reason}`)
    }
    console.log()
  }

  console.log(
    `  ${results.length} checked, ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`
  )
  console.log()

  return { passed, failed, skipped }
}

/**
 * Three outcomes, three exit codes — pure and exported so the exit-code
 * contract (PD-155's headline requirement) is tested directly rather than by
 * spawning a process and reading its return code:
 *
 *   - 1 if anything disagreed — the interesting case, and the one that must
 *     win even if other claims were also skipped.
 *   - 2 if NOTHING could be measured — the `db:drift` "nothing to compare"
 *     case. Distinct from 0 on purpose: an environment so broken that every
 *     claim skips must not look like a clean run.
 *   - 0 otherwise — every claim that could be measured agreed. Claims that
 *     skipped are reported but do not, on their own, fail the run; PD-155's
 *     exit-code contract asks for them to be loud, not for them to block a
 *     merge on their own.
 */
export function decideExitCode({ passed, failed, skipped }, { strict = false } = {}) {
  if (failed.length > 0) return 1
  // Under --cheap a skip is a defect, not a shrug. The cheap set is BY
  // DEFINITION the claims needing no external service, so there is no
  // legitimate reason for one to be unmeasurable — a skip there means the
  // command broke, timed out, or its output format moved. Review found the
  // concrete case: both guard-cases claims parse vitest's `Tests N passed`
  // summary, so a vitest upgrade rewording it turns them into permanently
  // green skips. Which of the three it was is in the skip line, never here. The un-strict default keeps a hand-run's Postgres-absent skips
  // non-fatal, which is what PD-155 asked for.
  if (strict && skipped.length > 0) return 1
  // `passed.length === 0` alone, not `&& skipped.length > 0`: an empty
  // selection measured nothing either, and exiting 0 on it would make a CI
  // step that checks NOTHING indistinguishable from one that checked
  // everything and agreed.
  if (passed.length === 0) return 2
  return 0
}

/**
 * The claims a run should attempt, given `--cheap`.
 *
 * Four kinds are out. Three for cost — `rls` wants a scratch Postgres (it
 * lives in the *other* workflow), `build` wants a second full `next build`,
 * and `vitest` wants a second full `npm run test:unit`, the last two on top of
 * steps the same job runs a minute earlier. That expense was the stated reason
 * `ci.yml` gates on `registry.test.mjs`'s anchor sweep rather than on this
 * script.
 *
 * The fourth, `vitest-file`, is out for a different and harder reason: it
 * spawns a test runner and reads its human-readable summary, and that turned
 * out not to be portable. Two CI runs failed on it while passing locally —
 * see the `case` in `measure`. What is left is greps, `jq` and arithmetic on
 * two hex values, which is why `--cheap` can run on every PR.
 *
 * The split is by cost, not by importance: the unit-test counts are checked
 * as thoroughly as ever by a full `npm run docs:check`, which is what a
 * session runs locally and what the doc-claims review pass still has.
 *
 * Filtering rather than skipping, deliberately: a skip is a *loud* outcome
 * here (PD-155's contract), and eleven permanent skips printed on every green
 * CI run is how the whole report stops being read. A cheap run reports only
 * what it genuinely attempted.
 *
 * Pure and exported so the split is pinned by a test rather than by reading
 * a workflow file.
 */
export const CHEAP_KINDS = new Set(['shell', 'contrast'])

export function selectClaims(claims, { cheap = false } = {}) {
  return cheap ? claims.filter((c) => CHEAP_KINDS.has(c.kind)) : claims
}

export function main(claims = defaultClaims, { strict = false } = {}) {
  const fileCache = makeCache()
  const measureCache = makeCache()
  const results = claims.map((claim) => runClaim(claim, { root: ROOT, fileCache, measureCache }))

  const { passed, failed, skipped } = printReport(results, claims)
  const code = decideExitCode({ passed, failed, skipped }, { strict })

  if (code === 2) {
    console.error('  Nothing could be measured. Check the environment (Postgres? node_modules?) and re-run.\n')
  }
  if (strict && skipped.length > 0 && failed.length === 0) {
    // Deliberately does NOT name the cause. Every cheap claim measures with a
    // local command, so a skip is always a defect — but which defect is in the
    // skip line above, which carries `shellFailureReason`'s actual reason
    // (`timed out after 60s`, `command failed: …`). An earlier version
    // asserted "a broken command or a changed output format" here and would
    // have contradicted a timeout printed two lines up.
    console.error('  A claim skipped under --cheap, where every claim measures with a local command.\n' +
      '  Read the SKIPPED reason above: that is the defect, and it is not a missing service.\n')
  }

  process.exit(code)
}

// Only when invoked directly, so `runClaim`/`main` can be imported and pinned
// by a test without this file spawning `npm test` or `next build`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cheap = process.argv.includes('--cheap')
  main(selectClaims(defaultClaims, { cheap }), { strict: cheap })
}
