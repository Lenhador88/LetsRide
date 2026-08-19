import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The service-role key bypasses every RLS policy in the schema. `CLAUDE.md`
 * §What Not To Do puts it plainly — "don't introduce a service-role key into
 * the app" — and decision #8 explains what it would cost: every visibility rule
 * currently living in the policy set, reimplemented in application code where an
 * unstated rule fails silently instead of loudly.
 *
 * `supabase/functions/delete-account/` needs one, and that is allowed precisely
 * because **the function is not the app**. This test is what keeps that
 * distinction real rather than a sentence in a comment: the key may exist in the
 * function's own secret store, and nowhere this repo can reach.
 *
 * It is a source scan, not a secret scanner. It cannot prove a key is absent
 * from git history or from someone's shell; it catches the ordinary case, which
 * is a key pasted into a file while debugging and committed by accident. That is
 * the case that has actually happened to other projects, and it is the one no
 * reviewer catches twice.
 *
 * ---------------------------------------------------------------------------
 * Comment lines are stripped first, and that is not a convenience
 * ---------------------------------------------------------------------------
 * `CLAUDE.md` calls this repo's most-repeated measurement error by name: a
 * file's description of what it must not contain looks exactly like the thing it
 * must not contain, so any grep for a forbidden pattern counts its own warnings.
 * It has produced a wrong number four times here. The rule it draws is followed
 * below — exclude comment lines, and **verify the filter both ways**: that it
 * reads zero now, and that it still catches a real instance. The second half is
 * the last test in this file, and without it a detector that matches nothing at
 * all would pass silently for ever.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

/** This file legitimately contains every pattern it hunts for. */
const SELF = path.resolve(here, 'no-service-role-key.test.ts')

const SCANNED_DIRS = ['src', 'scripts']
const SCANNED_FILES = ['.env.local.example', 'vercel.json', 'next.config.ts']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage'])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * Strip whole-line comments in every syntax this repo commits: `//`, `#`, `--`,
 * and `*` continuation lines inside a block comment. Deliberately conservative —
 * it only strips lines that are ENTIRELY a comment, so `const k = '...' // note`
 * is still scanned. Hiding a key behind a trailing comment should not work.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (t === '') return false
      return !(
        t.startsWith('//') ||
        t.startsWith('#') ||
        t.startsWith('--') ||
        t.startsWith('*') ||
        t.startsWith('/*') ||
        t.startsWith('{/*')
      )
    })
    .join('\n')
}

/** A JWT: three base64url segments, payload starting `eyJ`. */
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

/**
 * Every way a service-role credential shows up, checked against real code
 * rather than imagined:
 *
 *   - `sb_secret_…`      — the current Supabase secret-key format
 *   - a JWT whose payload decodes to `"role":"service_role"` — the legacy format,
 *     and the one that looks harmless because it looks like the publishable key
 *   - `service_role` as a bare identifier in live code
 *   - a `NEXT_PUBLIC_*` variable whose name mentions the secret, which would ship
 *     it in the bundle even if the value were injected at build time
 */
function findViolations(source: string): string[] {
  const found: string[] = []
  const code = stripCommentLines(source)

  if (/sb_secret_[A-Za-z0-9_-]+/.test(code)) found.push('an sb_secret_ key literal')

  for (const jwt of code.match(JWT) ?? []) {
    const payload = jwt.split('.')[1]
    let decoded = ''
    try {
      decoded = Buffer.from(payload, 'base64url').toString('utf8')
    } catch {
      continue
    }
    if (decoded.includes('service_role')) found.push('a JWT whose payload claims service_role')
  }

  if (/\bservice_role\b/.test(code)) found.push('the identifier service_role')
  if (/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(code)) found.push('a NEXT_PUBLIC_ service-role variable')

  return found
}

describe('the service-role key never reaches the app', () => {
  const targets = [
    ...SCANNED_DIRS.flatMap((d) => walk(path.join(repoRoot, d))),
    ...SCANNED_FILES.map((f) => path.join(repoRoot, f)),
  ].filter((f) => existsSync(f) && f !== SELF)

  it('scans a non-trivial number of files, so a broken walk fails loudly', () => {
    // Without this, a bad path makes every assertion below pass over an empty
    // list — the failure mode where a guard reports success having checked
    // nothing at all.
    expect(targets.length).toBeGreaterThan(50)
  })

  it.each(targets.map((f) => [path.relative(repoRoot, f), f]))(
    '%s holds no service-role credential',
    (_label, file) => {
      let source: string
      try {
        source = readFileSync(file, 'utf8')
      } catch {
        return // binary or unreadable; nothing to scan
      }
      expect(findViolations(source)).toEqual([])
    },
  )

  it('the Edge Function is the one place allowed to name the key, and it does not inline one', () => {
    const fn = path.join(repoRoot, 'supabase/functions/delete-account/index.ts')
    expect(existsSync(fn)).toBe(true)
    const source = readFileSync(fn, 'utf8')

    // It reads the key from the environment...
    expect(source).toMatch(/Deno\.env\.get\('SERVICE_ROLE_KEY'\)/)
    // ...and never carries one.
    const code = stripCommentLines(source)
    expect(/sb_secret_[A-Za-z0-9_-]+/.test(code)).toBe(false)
    expect((code.match(JWT) ?? []).length).toBe(0)
  })

  it('takes no user id from the request, which is what makes it safe to expose', () => {
    // Design D1: a service-role endpoint that accepts an id is
    // account-deletion-as-a-service for whoever finds the URL.
    //
    // **PD-102 (2026-08-16) made the strict "no body read at all" version of
    // this control false, on purpose** — `req.json()` now reads the D6
    // re-authentication proof, so the assertion moved from "the body is never
    // read" to the actual invariant D1 states: the body never supplies an
    // IDENTIFIER. `uid` is pinned to `subject.id`, which comes from the
    // verified JWT four lines above and nowhere else, and the body is read
    // only into a `password` field that is never used to select an account.
    const source = readFileSync(
      path.join(repoRoot, 'supabase/functions/delete-account/index.ts'),
      'utf8',
    )
    const code = stripCommentLines(source)

    expect(code).not.toMatch(/req\.text\(\)/)
    expect(code).not.toMatch(/searchParams/)

    // No id-shaped field is ever read off the parsed body — the one thing
    // read out of it is `password`.
    expect(code).not.toMatch(/body\.(id|uid|sub|subject|user_id|userId|email)\b/)

    // `uid` is assigned exactly once, from the verified subject, and never
    // reassigned from anything the request supplied.
    const uidAssignments = code.match(/\buid\s*=/g) ?? []
    expect(uidAssignments).toHaveLength(1)
    expect(code).toMatch(/const uid = subject\.id/)
  })

  /**
   * The other half of the filter check. A detector that has quietly stopped
   * matching anything passes every assertion above, for ever, and looks exactly
   * like a clean repo. These are the real formats, not approximations.
   */
  it('the detector catches a real key in each of its formats', () => {
    expect(findViolations("const k = 'sb_secret_AbCdEf0123456789'")).toContain(
      'an sb_secret_ key literal',
    )

    // A genuine legacy service-role JWT shape: {"role":"service_role","iss":"supabase"}
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')
    const payload = Buffer.from(
      '{"iss":"supabase","role":"service_role","exp":2000000000}',
    ).toString('base64url')
    const jwt = `${header}.${payload}.c2lnbmF0dXJlc2lnbmF0dXJl`
    expect(findViolations(`const k = '${jwt}'`)).toContain(
      'a JWT whose payload claims service_role',
    )

    expect(findViolations('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=x')).toContain(
      'a NEXT_PUBLIC_ service-role variable',
    )

    // And the comment strip works: the same key in a comment is not a finding.
    expect(findViolations("// never put an sb_secret_AbCdEf0123456789 here")).toEqual([])
    expect(findViolations('const ok = "publishable"')).toEqual([])
  })
})
