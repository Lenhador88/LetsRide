import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every embed of `profiles` in `lib/data/` names its foreign key.
 *
 * WHY THIS EXISTS. PostgREST resolves `alias:profiles(…)` by looking for
 * relationships between the two tables, and it counts a *many-to-many* one
 * whenever some third table holds a foreign key to each of them. So a migration
 * that adds a perfectly ordinary join table makes an unrelated, untouched embed
 * ambiguous — `PGRST201`, HTTP 300 — on a query whose columns, policies and
 * types did not change.
 *
 * That is not hypothetical. `092` created `club_join_waves`, which references
 * `club_members (club_id, subject_user_id)` and `profiles (user_id)` because a
 * wave is at a membership and by a rider. From the moment it applied to DEV,
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

const DATA_DIR = join(process.cwd(), 'src/lib/data')

/** Line and block comments, and nothing else — string contents are left alone. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

function dataFiles(): string[] {
  return readdirSync(DATA_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(DATA_DIR, name))
}

/**
 * Every `profiles` embed in the source, as the hint it carries — `null` when it
 * carries none. `.from('profiles')` is not an embed and has no `(` after the
 * table name, so it does not match.
 */
function profileEmbeds(source: string): (string | null)[] {
  return [...source.matchAll(/\bprofiles(?:!([A-Za-z0-9_]+))?\(/g)].map((m) => m[1] ?? null)
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
})
