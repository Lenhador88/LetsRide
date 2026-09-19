import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * **`ignoreDuplicates: true` on every report upsert is a PRIVILEGE requirement,
 * and this file is the only thing that can see it go.**
 *
 * `011`, `094`, `122` and `123` each grant `authenticated` INSERT and SELECT on
 * their report table and **no UPDATE**, at table level or column level. supabase-js's
 * `upsert` default is merge-duplicates, which emits `on conflict … do update` —
 * and Postgres checks the UPDATE privilege at executor start-up, *before* any
 * RLS evaluation. So deleting the option does not degrade a duplicate report;
 * it makes a rider's **first** report fail `42501`.
 *
 * ## Why the RLS suite cannot be this tripwire, and said it was
 *
 * `122.3` and `123.6` assert the two emitted forms — `on conflict do nothing`
 * allowed, `on conflict … do update` rejected — which proves the *mechanism* and
 * is worth keeping. What they cannot see is **which form the client sends**:
 * they issue hand-written SQL, so removing the option from the action leaves
 * them green and ships the bug. `reviewer` caught that overclaim on PR #469;
 * this file is what makes the claim true, and the two SQL labels now point
 * here rather than at themselves.
 *
 * `addCountry` shipped exactly this class of defect — a client sending a form
 * the grants refuse, with every gate green.
 *
 * Read on COMMENT-STRIPPED source, the same way `writers-invalidate.test.ts`
 * reads the same directory: this repo's docstrings describe what a file does
 * NOT do, so an unstripped match counts a sentence about the bug as the fix.
 *
 * Verified both ways — the detector is asserted to find the real calls, and
 * asserted to fail on a copy with the option removed, so a regex that quietly
 * stops matching fails here instead of passing for ever.
 */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Every table whose report upsert must carry the option, with the module that writes it. */
const REPORT_UPSERTS = [
  { table: 'postcard_reports', file: 'src/lib/actions/moderation.ts', migration: '011' },
  { table: 'postcard_comment_reports', file: 'src/lib/actions/moderation.ts', migration: '123' },
  { table: 'club_thread_reports', file: 'src/lib/actions/club-threads.ts', migration: '094' },
  { table: 'ride_thread_reports', file: 'src/lib/actions/ride-threads.ts', migration: '122' },
] as const

/**
 * The `.from('<table>').upsert( … )` call as written, from the table name to the
 * closing brace of the options object. Deliberately anchored on the table rather
 * than on the function name: a rename of the action must not make this stop
 * looking.
 */
function upsertCall(source: string, table: string): string | undefined {
  const match = new RegExp(
    `\\.from\\('${table}'\\)[\\s\\S]{0,600}?\\.upsert\\(([\\s\\S]{0,600}?)\\n\\s*\\)`
  ).exec(source)
  return match?.[1]
}

const sources = new Map(
  [...new Set(REPORT_UPSERTS.map((r) => r.file))].map((f) => [
    f,
    stripComments(readFileSync(f, 'utf8')),
  ])
)

describe('every report upsert passes ignoreDuplicates', () => {
  for (const { table, file, migration } of REPORT_UPSERTS) {
    it(`${table} (${migration}) upserts with ignoreDuplicates: true`, () => {
      const call = upsertCall(sources.get(file)!, table)

      // The detector itself, before its assertion: a null here means the shape
      // moved, which must fail loudly rather than vacuously pass.
      expect(call, `no .from('${table}').upsert(...) found in ${file}`).toBeTruthy()
      expect(call).toContain('ignoreDuplicates: true')
      expect(call).toContain('onConflict:')
    })
  }

  it('the detector fails when the option is removed — verified both ways', () => {
    const real = sources.get('src/lib/actions/ride-threads.ts')!
    const tampered = real.replace('ignoreDuplicates: true', 'ignoreDuplicates: false')

    expect(upsertCall(real, 'ride_thread_reports')).toContain('ignoreDuplicates: true')
    expect(upsertCall(tampered, 'ride_thread_reports')).not.toContain('ignoreDuplicates: true')
  })

  it('names every table that has a report upsert, so a fifth one cannot slip past', () => {
    const declared = new Set(REPORT_UPSERTS.map((r) => r.table))
    const found = new Set<string>()

    for (const source of sources.values()) {
      for (const [, table] of source.matchAll(/\.from\('(\w*reports)'\)/g)) found.add(table)
    }

    // Only the modules above are read, so this catches a table added to one of
    // them; a report upsert in a NEW module is caught by the list itself going
    // stale against the migration that adds the table.
    expect([...found].sort()).toEqual([...declared].filter((t) => found.has(t)).sort())
    expect(found.size).toBeGreaterThan(0)
  })
})
