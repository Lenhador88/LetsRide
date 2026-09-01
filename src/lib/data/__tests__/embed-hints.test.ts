import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every embed of `profiles` in `lib/data/` names its foreign key.
 *
 * WHY THIS EXISTS. PostgREST resolves `alias:profiles(…)` by counting the
 * relationships between the two tables, and it counts a *many-to-many* one
 * through a third table when that table is a JUNCTION: two foreign keys, and a
 * primary key that is exactly the union of their columns. So a migration that
 * adds a perfectly ordinary join table makes an unrelated, untouched embed
 * ambiguous — `PGRST201`, HTTP 300 — on a query whose columns, policies and
 * types did not change. (`columns.ts` carries the SQL that lists the real ones,
 * and why the looser "any third table holding a key to both" is false.)
 *
 * That is not hypothetical. `092` created `club_join_waves`, whose keys are
 * `(club_id, subject_user_id) -> club_members` and `user_id -> profiles.id`,
 * because a wave is at a membership and by a rider. From the moment it applied to DEV,
 * `club_members` and `profiles` had two candidate relationships and every
 * unhinted embed of the pair started failing: Your clubs, Explore clubs, the
 * club roster and the club timeline, all at once.
 *
 * NO OTHER GATE IN THIS REPO CAN SEE IT. `tsc` type-checks a template string,
 * ESLint reads no SQL, Vitest mocks the client, `next build` never issues the
 * query, and the RLS suite runs on plain Postgres where PostgREST — and
 * therefore its relationship cache — does not exist. The break reached DEV
 * green.
 *
 * `profiles` is the table this rule is worth spending on: it is the most
 * embedded table in the app, and it is what a junction table joins *to* by
 * definition, so it is where the next collision lands. A hinted embed cannot
 * become ambiguous, whatever a later migration adds.
 *
 * The scan runs on COMMENT-STRIPPED source, which is this repo's standing trap
 * (`CLAUDE.md` §Technology Decisions, *the comment trap*): the constant this
 * rule is enforced through documents the defect using the very syntax it
 * forbids, so a naive scan fails against a correct tree.
 */

/**
 * Both doorways, not just one. `lib/actions/` holds no `profiles` embed today,
 * but `columns.test.ts` already walks it for `.select(` literals and a boundary
 * that disagrees with its own sibling is one nobody can remember. Recursive for
 * the same reason: `lib/data/` has no `.ts` subdirectory yet, and a flat scan
 * goes quiet the day it gets one.
 */
const SCANNED_DIRS = ['src/lib/data', 'src/lib/actions'].map((d) => join(process.cwd(), d))

/** Line and block comments, and nothing else — string contents are left alone. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

function dataFiles(): string[] {
  // `__tests__` is excluded because this very file holds unhinted embeds as
  // fixtures — the detector would otherwise be caught by itself, which is the
  // comment trap wearing a directory instead of a comment.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full)
      return entry.name.endsWith('.ts') ? [full] : []
    })

  return SCANNED_DIRS.flatMap(walk)
}

/**
 * Every `profiles` embed in the source, as the hint it carries — `null` when it
 * carries none. `.from('profiles')` is not an embed and has no `(` after the
 * table name, so it does not match.
 *
 * **`!inner` and `!left` are JOIN MODIFIERS, not hints**, and reading one as a
 * hint is how this test passed on a genuinely unhinted embed. That is not
 * hypothetical syntax: `club-timeline.ts` already writes `club_threads!inner`
 * and `rides.ts` writes `ride_members!inner`, so the most likely way somebody
 * adds a `profiles` embed here is the way a naive regex waves through. Both
 * spellings are handled — `profiles!inner(…)` is unhinted and must fail,
 * `profiles!user_id!inner(…)` is hinted and must pass.
 */
const JOIN_MODIFIERS = new Set(['inner', 'left'])

function profileEmbeds(source: string): (string | null)[] {
  return [...source.matchAll(/\bprofiles((?:![A-Za-z0-9_]+)*)\(/g)].map((m) => {
    const parts = m[1].split('!').filter(Boolean)
    const hint = parts.find((part) => !JOIN_MODIFIERS.has(part))
    return hint ?? null
  })
}

describe('PostgREST embed hints', () => {
  it('every profiles embed in lib/data names its foreign key', () => {
    const unhinted: string[] = []

    for (const file of dataFiles()) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const hint of profileEmbeds(source)) {
        if (hint === null) unhinted.push(file.replace(process.cwd() + '/', ''))
      }
    }

    expect(unhinted).toEqual([])
  })

  it('finds embeds at all, so a passing run is not an empty scan', () => {
    const hints = dataFiles().flatMap((file) =>
      profileEmbeds(stripComments(readFileSync(file, 'utf8')))
    )

    // The assertion above passes vacuously if the regex ever stops matching —
    // the failure mode a scan-based test has and a value-based one does not.
    expect(hints.length).toBeGreaterThan(8)
    expect(hints).toContain('user_id')
    expect(hints).toContain('author_id')
  })

  it('catches an unhinted embed, and is not fooled by one in a comment', () => {
    // Verified both ways, per CLAUDE.md §Working Principles: the detector must
    // fire on a real instance and stay silent on an obituary. `columns.ts`
    // documents this defect using the syntax it forbids, which is the case that
    // failed the first version of this file.
    expect(profileEmbeds(stripComments('.select(`profile:profiles(id)`)'))).toEqual([null])
    expect(profileEmbeds(stripComments('.select(`profile:profiles!user_id(id)`)'))).toEqual([
      'user_id',
    ])
    expect(profileEmbeds(stripComments('/* was profile:profiles(id) */'))).toEqual([])
    expect(profileEmbeds(stripComments('  // was profile:profiles(id)'))).toEqual([])
    expect(profileEmbeds(stripComments("supabase.from('profiles')"))).toEqual([])
  })

  it('does not accept a join modifier as a hint', () => {
    // `!inner` is PostgREST's join modifier. An embed carrying only that is
    // UNHINTED and answers 300 exactly like a bare one, so counting it as a
    // hint is a green test over a live defect — and `!inner` is already written
    // in this directory on two other tables, so it is the likely spelling.
    expect(profileEmbeds('profile:profiles!inner(id)')).toEqual([null])
    expect(profileEmbeds('profile:profiles!left(id)')).toEqual([null])

    // The correct form of the same embed, which must be recognised as hinted
    // rather than falling outside the scan entirely.
    expect(profileEmbeds('profile:profiles!user_id!inner(id)')).toEqual(['user_id'])
    expect(profileEmbeds('profile:profiles!inner!user_id(id)')).toEqual(['user_id'])
  })
})
