import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLUB_EMBED_COLUMNS, OWN_PROFILE_COLUMNS, PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'

const SRC = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))

/**
 * Every module that can issue a PostgREST query, not only `lib/data/`.
 *
 * `lib/actions/` writes and reads too, and the route guard reads on **every
 * navigation** — so scoping this to the data layer would leave the most-executed
 * query in the app outside the guard.
 *
 * **That most-executed query used to be `src/proxy.ts`'s**, which selected
 * profile columns on every authenticated request. Group 6 deleted it; the read
 * moved to `components/auth/RouteGuard.tsx`, which is scanned in its place. The
 * guard reads through `my_onboarding_state()` rather than a column select, so it
 * currently contributes nothing to find — which is the point of scanning it: the
 * day someone adds a `.select()` there, it is already covered rather than
 * needing to be remembered.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full)
    return /\.tsx?$/.test(full) ? [full] : []
  })
}

const queryModules = [
  ...walk(path.join(SRC, 'lib', 'data')),
  ...walk(path.join(SRC, 'lib', 'actions')),
  path.join(SRC, 'components', 'auth', 'RouteGuard.tsx'),
].map((file) => ({ name: path.relative(SRC, file), source: readFileSync(file, 'utf8') }))

/**
 * The string literals that make up a query's column list.
 *
 * Two shapes, because the codebase uses both: a literal passed to `.select(`,
 * and a `const *SELECT*` template the call sites interpolate.
 *
 * **Comments and newlines are skipped between `(` and the literal.** An earlier
 * version required whitespace only, and review defeated it in one line by
 * writing the perfectly ordinary
 *
 *   .select(
 *     // the id is all we need, plus the legacy avatar
 *     'id, avatar_url'
 *   )
 *
 * which left a dropped column in a live select with the suite green. This file
 * comments query shapes routinely, so that was not an exotic formatting case —
 * it was the house style.
 */
export function selectLiterals(source: string): string[] {
  const gap = String.raw`(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*`
  const literal = String.raw`(\`[^\`]*\`|'[^']*'|"[^"]*")`

  return [
    ...source.matchAll(new RegExp(String.raw`\.select\(${gap}${literal}`, 'g')),
    ...source.matchAll(new RegExp(String.raw`^const \w*SELECT\w* =${gap}${literal}`, 'gm')),
  ].map((match) => match[1])
}

describe('the column allowlists', () => {
  it("never ship a rider's consent or lifecycle stamps", () => {
    // The reason `columns.ts` exists: RLS is row-level, so `select('*')` on a
    // joined profile hands these to anyone who can see that rider at all.
    for (const forbidden of ['terms_accepted_at', 'onboarding_completed_at']) {
      expect(PUBLIC_PROFILE_COLUMNS).not.toContain(forbidden)
    }
  })

  it('name only columns that exist after 024', () => {
    expect(PUBLIC_PROFILE_COLUMNS).not.toContain('avatar_url')
    expect(CLUB_EMBED_COLUMNS).not.toContain('avatar_url')
    expect(PUBLIC_PROFILE_COLUMNS).toContain('avatar_path')
    expect(CLUB_EMBED_COLUMNS).toContain('avatar_path')
  })
})

/**
 * `025` revokes table-level SELECT on `profiles` from `authenticated` and
 * re-grants an explicit column allowlist, because a column-level revoke against
 * a table-level grant is a documented no-op. `OWN_PROFILE_COLUMNS` is that same
 * list spelled from the client side, and **the two must agree exactly**:
 *
 * - a column in the constant but not the grant → `getCurrentProfile` returns
 *   `42501` the moment `025` applies, `unwrap` throws, and the profile screen
 *   lands on the error boundary;
 * - a column in the grant but not the constant → dead grant, and a column the
 *   app cannot see for a reason nobody will find.
 *
 * `025`'s own header calls this out as the standing, permanent cost of the
 * allowlist shape: *every column added to `profiles` from now on is invisible to
 * `authenticated` until it is added to these grants.* A comment saying so is not
 * a guard. This is — it reads the migration and compares.
 */
describe('OWN_PROFILE_COLUMNS matches 025 grant list', () => {
  const migration = readFileSync(
    path.join(SRC, '..', 'supabase', 'migrations', '025_profile_column_privileges.sql'),
    'utf8'
  )

  /** The first `grant select (...) on public.profiles to authenticated`. */
  const granted = (() => {
    const match = migration.match(
      /grant\s+select\s*\(([^)]*)\)\s*\n?\s*on\s+public\.profiles\s+to\s+authenticated/i
    )
    if (!match) throw new Error('no `grant select (...) on public.profiles` found in 025')
    return match[1]
      .split(',')
      .map((c) => c.replace(/--.*$/gm, '').trim())
      .filter(Boolean)
      .sort()
  })()

  const constant = OWN_PROFILE_COLUMNS.split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .sort()

  it('finds a real grant list, so this cannot pass by matching nothing', () => {
    expect(granted.length).toBeGreaterThan(4)
    expect(granted).toContain('username')
  })

  it('grants exactly what the client selects, and nothing more', () => {
    expect(constant).toEqual(granted)
  })

  it('never selects a stamp the grant deliberately withholds', () => {
    for (const withheld of ['terms_accepted_at', 'onboarding_completed_at']) {
      expect(OWN_PROFILE_COLUMNS).not.toContain(withheld)
      expect(granted).not.toContain(withheld)
    }
  })
})

/**
 * `024` dropped `profiles.avatar_url` and `clubs.avatar_url`. A query that still
 * names either gets `42703` from PostgREST, `unwrap` throws by design, and the
 * screen lands on the error boundary — on a production database, for every
 * signed-in rider.
 *
 * The plan's repair list named `PUBLIC_PROFILE_COLUMNS` and `resolveAvatarUrls`.
 * It was **six query sites short**: three club embeds in `rides.ts`, two in
 * `postcards.ts`, and one profile select in `rides.ts` that spelled its columns
 * out by hand instead of using the constant. That is what this test guards — not
 * the constants, which are easy to remember, but the literals that quietly do
 * not go through them.
 *
 * Textual, like `use-server-exports.test.ts`, and for the same reason: a
 * tripwire for the ordinary case is worth more than a parser dependency, and the
 * ordinary case here is someone typing a column name into a template literal.
 */
describe('no query names a dropped column', () => {
  const found = queryModules.flatMap(({ name, source }) =>
    selectLiterals(source).map((select) => ({ name, select }))
  )

  it('finds selects across the modules, so this cannot pass by scanning nothing', () => {
    // Both halves matter: a broken *file* walk and a broken *regex* fail
    // differently, and only the second is invisible in the per-module cases —
    // a module whose selects all stop matching simply reports zero and passes.
    expect(queryModules.length).toBeGreaterThanOrEqual(10)
    expect(found.length).toBeGreaterThanOrEqual(20)
  })

  it.each(found.map(({ name, select }) => [name, select]))('%s', (_name, select) => {
    // Only inside a select — `avatar_url` remains a perfectly good field name on
    // the objects this layer returns, holding the signed URL, and half the
    // module bodies assign to it.
    expect(select as string).not.toMatch(/\bavatar_url\b/)
  })
})

describe('selectLiterals', () => {
  it('catches the template literal that was actually there', () => {
    const source = 'const RIDE_SELECT = `\n  id, title,\n  club:clubs(id, name, avatar_url),\n`\n'
    expect(selectLiterals(source)).toHaveLength(1)
    expect(selectLiterals(source)[0]).toMatch(/\bavatar_url\b/)
  })

  it('catches a plain .select() call', () => {
    expect(selectLiterals(`.select('id, avatar_url')`)[0]).toMatch(/\bavatar_url\b/)
  })

  it('is not defeated by a line comment between the paren and the literal', () => {
    const source = ".select(\n  // the id is all we need, plus the legacy avatar\n  'id, avatar_url'\n)"
    expect(selectLiterals(source)).toHaveLength(1)
    expect(selectLiterals(source)[0]).toMatch(/\bavatar_url\b/)
  })

  it('is not defeated by a block comment, or by both', () => {
    const source = ".select(/* legacy */\n  // still legacy\n  `id, avatar_url`\n)"
    expect(selectLiterals(source)).toHaveLength(1)
    expect(selectLiterals(source)[0]).toMatch(/\bavatar_url\b/)
  })

  it('finds nothing in a module with no query', () => {
    expect(selectLiterals('export const A = 1\n')).toEqual([])
  })
})
