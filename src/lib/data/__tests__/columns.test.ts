import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLUB_EMBED_COLUMNS, PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'

const DATA_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const dataModules = readdirSync(DATA_DIR)
  .filter((entry) => entry.endsWith('.ts'))
  .map((entry) => ({ name: entry, source: readFileSync(path.join(DATA_DIR, entry), 'utf8') }))

describe('the column allowlists', () => {
  it('never ship a rider\'s consent or lifecycle stamps', () => {
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
describe('no query in the data layer names a dropped column', () => {
  it('finds the modules, so this cannot pass by scanning nothing', () => {
    expect(dataModules.length).toBeGreaterThanOrEqual(6)
  })

  it.each(dataModules.map(({ name, source }) => [name, source]))('%s', (_name, source) => {
    // Only inside a select — `avatar_url` remains a perfectly good field name on
    // the objects this layer returns, holding the signed URL, and half the
    // module bodies assign to it.
    const selects = [
      ...source.matchAll(/\.select\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g),
      ...source.matchAll(/^const \w*SELECT\w* = (`[^`]*`)/gm),
    ].map((match) => match[1])

    for (const select of selects) {
      expect(select, `a select in this module names a column 024 dropped`).not.toMatch(
        /\bavatar_url\b/
      )
    }
  })

  it('would catch the literal that was actually there, so the scan is not vacuous', () => {
    const before = "  club:clubs(id, name, avatar_url),\n"
    const source = `const RIDE_SELECT = \`\n  id, title,\n${before}\`\n`
    const selects = [...source.matchAll(/^const \w*SELECT\w* = (`[^`]*`)/gm)].map((m) => m[1])

    expect(selects).toHaveLength(1)
    expect(selects[0]).toMatch(/\bavatar_url\b/)
  })
})
