import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CLUB_EMBED_COLUMNS,
  CLUB_FILTER_EMBED_COLUMNS,
  OWN_PROFILE_COLUMNS,
  PUBLIC_PROFILE_COLUMNS,
  VIEWED_PROFILE_COLUMNS,
} from '@/lib/data/columns'

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

  it('CLUB_FILTER_EMBED_COLUMNS carries the cover that CLUB_EMBED_COLUMNS deliberately withholds (PD-284)', () => {
    expect(CLUB_FILTER_EMBED_COLUMNS).not.toContain('avatar_url')
    expect(CLUB_FILTER_EMBED_COLUMNS).toContain('avatar_path')
    expect(CLUB_FILTER_EMBED_COLUMNS).toContain('cover_image_path')
    expect(CLUB_EMBED_COLUMNS).not.toContain('cover_image_path')
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
 * `VIEWED_PROFILE_COLUMNS` is a **subset** of the same `025` grant list,
 * unlike `OWN_PROFILE_COLUMNS`'s exact-equality assertion above — this
 * constant is a projection decision for one screen (`/profile/detail`), not
 * the whole grant. `columns.ts`'s own header says why it is not equal: it
 * deliberately omits `bike_model` even though `025` grants it, because the
 * viewed-profile header draws no Motorcycles section.
 */
describe('VIEWED_PROFILE_COLUMNS is a subset of the 025 grant list', () => {
  const migration = readFileSync(
    path.join(SRC, '..', 'supabase', 'migrations', '025_profile_column_privileges.sql'),
    'utf8'
  )

  const granted = (() => {
    const match = migration.match(
      /grant\s+select\s*\(([^)]*)\)\s*\n?\s*on\s+public\.profiles\s+to\s+authenticated/i
    )
    if (!match) throw new Error('no `grant select (...) on public.profiles` found in 025')
    return match[1]
      .split(',')
      .map((c) => c.replace(/--.*$/gm, '').trim())
      .filter(Boolean)
  })()

  const constant = VIEWED_PROFILE_COLUMNS.split(',')
    .map((c) => c.trim())
    .filter(Boolean)

  it('finds a real grant list, so this cannot pass by matching nothing', () => {
    expect(granted.length).toBeGreaterThan(4)
  })

  it('names at least one column, so the subset check below cannot pass on an empty list', () => {
    expect(constant.length).toBeGreaterThan(0)
  })

  it('selects only columns 025 actually grants', () => {
    for (const column of constant) {
      expect(granted, `${column} is not in 025's grant list`).toContain(column)
    }
  })

  it('never selects a stamp the grant deliberately withholds', () => {
    for (const withheld of ['terms_accepted_at', 'onboarding_completed_at', 'terms_version']) {
      expect(VIEWED_PROFILE_COLUMNS).not.toContain(withheld)
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

/**
 * PD-165: `041` added `postcards.ride_id`, and `POSTCARD_SELECT` used to open
 * with `*`, so every postcard read shipped the raw uuid — a value comparable
 * across postcards even by a viewer who cannot resolve any single ride it
 * points at. The select-list fix was **payload hygiene, not a security
 * boundary** (see the comment at `POSTCARD_SELECT` itself): `authenticated`
 * still held the column-level SELECT grant PostgREST honours directly.
 *
 * **PD-166 closed the grant** — `062` revokes table-level SELECT on `postcards`
 * and re-grants seven columns without `ride_id`, and the Journal filters
 * through `public.ride_journal_postcard_ids` instead. So this test is no longer
 * the only thing standing between the column and the wire. It stays because it
 * is the cheap half and it fails in the right place: a select naming `ride_id`
 * is now `42501` at runtime for every rider, and a unit test saying so beats
 * discovering it on a screen.
 *
 * **Scoped to `lib/data/postcards.ts`, unlike the `avatar_url` sweep above.**
 * `ride_id` is a legitimate column on `ride_messages`, `ride_members` and
 * `notifications`, so banning the name across every query module would fail
 * today on `rides.ts` and `ride-messages.ts` for selects that have nothing to
 * do with this defect.
 *
 * **Checks for a bare `*` too, not only the literal name.** `ride_id` never
 * appears as a substring of a wildcard select, so a name-only check would let
 * `POSTCARD_SELECT` go back to `*` — reintroducing exactly this defect —
 * without ever going red.
 */
describe('postcards reads never re-ship ride_id (PD-165)', () => {
  const postcardsData = queryModules.find((m) => m.name === path.join('lib', 'data', 'postcards.ts'))

  it('finds the module, so this cannot pass by scanning nothing', () => {
    expect(postcardsData).toBeDefined()
  })

  const selects = postcardsData ? selectLiterals(postcardsData.source) : []

  it('finds selects in the file, so this cannot pass by scanning nothing', () => {
    expect(selects.length).toBeGreaterThan(0)
  })

  it.each(selects.map((select, i) => [i, select] as const))('select #%s', (_i, select) => {
    expect(select).not.toMatch(/\bride_id\b/)
    expect(select).not.toMatch(/\*/)
  })
})

/**
 * `062` gives `postcards` the shape `025` gave `profiles`: no table-level SELECT
 * for `authenticated`, an explicit column grant instead. That makes
 * `POSTCARD_SELECT` the same kind of pair as `OWN_PROFILE_COLUMNS` — a column in
 * the select that the grant does not name is `42501` for every rider, on every
 * feed, and neither tsc nor ESLint nor the build can see it, because the row
 * type is reached through an `as unknown as PostcardRow[]` cast.
 *
 * **A subset check, not equality, unlike the `025` pair.** `POSTCARD_SELECT` is
 * one query's projection rather than the whole grant: `updated_at` is granted
 * and not selected here, because no postcard screen draws an edited-at stamp.
 *
 * Top-level columns only. The select also carries embeds —
 * `author:profiles!author_id(…)`, `likes_count:postcard_likes(count)` — whose
 * columns belong to other tables and other grants, so an entry carrying a `(`
 * is skipped rather than checked against this list.
 *
 * **The grant is read from the LAST migration that issued it, not from `062`,
 * and that is what keeps this test honest as the list grows.** Each of these
 * files issues an ABSOLUTE `revoke select` + `grant select (…)`, so only the
 * final one describes the database — `064` adds five capture columns on top of
 * `062`'s seven. Pinning `062` by name would have made this test fail the first
 * time a screen legitimately selected `taken_at`, reporting "not in the grant
 * list" about a column that is very much granted. That is the shape of failure
 * this file exists to avoid, arriving from the other direction: a wrong answer
 * that looks measured.
 */
describe('POSTCARD_SELECT names only columns the migrations grant', () => {
  /** Every `grant select (...) on public.postcards`, newest file last. */
  const grantingMigrations = readdirSync(path.join(SRC, '..', 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.join(SRC, '..', 'supabase', 'migrations', name), 'utf8'),
    }))
    .filter(({ sql }) =>
      /grant\s+select\s*\([^)]*\)\s*\n?\s*on\s+public\.postcards\s+to\s+authenticated/i.test(sql)
    )

  const granted = (() => {
    const last = grantingMigrations.at(-1)
    if (!last) throw new Error('no `grant select (...) on public.postcards` found in any migration')
    const match = last.sql.match(
      /grant\s+select\s*\(([^)]*)\)\s*\n?\s*on\s+public\.postcards\s+to\s+authenticated/i
    )!
    return match[1]
      .split(',')
      .map((c) => c.replace(/--.*$/gm, '').trim())
      .filter(Boolean)
  })()

  /** The top-level entries of `POSTCARD_SELECT`, embeds dropped. */
  const selected = (() => {
    const source = queryModules.find(
      (m) => m.name === path.join('lib', 'data', 'postcards.ts')
    )?.source
    const match = source?.match(/^const POSTCARD_SELECT = `([^`]*)`/m)
    if (!match) throw new Error('no `const POSTCARD_SELECT` found in lib/data/postcards.ts')
    // Split at depth 0 only. A naive `split(',')` cuts `club:clubs(id, name)`
    // in half and asks the grant list for a column called `name)`, which fails
    // for the wrong reason and reads exactly like a real finding.
    const entries: string[] = []
    let depth = 0
    let current = ''
    for (const ch of match[1]) {
      if (ch === '(') depth += 1
      if (ch === ')') depth -= 1
      if (ch === ',' && depth === 0) {
        entries.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    entries.push(current)

    return entries
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.includes('('))
  })()

  it('finds a real grant list, so this cannot pass by matching nothing', () => {
    expect(granted).toEqual(
      expect.arrayContaining(['id', 'author_id', 'club_id', 'image_path', 'caption'])
    )
  })

  it('finds real top-level columns, so the subset check cannot pass on an empty list', () => {
    expect(selected.length).toBeGreaterThan(4)
  })

  it('reads the newest granting migration, not the first — an absolute re-grant supersedes', () => {
    // More than one file issues this statement, and the one that counts is the
    // last. If this ever drops to one, a re-grant has been deleted rather than
    // superseded and `granted` is describing a database nobody has.
    expect(grantingMigrations.length).toBeGreaterThan(1)
    expect(grantingMigrations.at(-1)!.name >= '062').toBe(true)
  })

  it('selects only columns the grant actually names', () => {
    for (const column of selected) {
      expect(granted, `${column} is not in the postcards SELECT grant`).toContain(column)
    }
  })

  it('never grants the column the accessor exists to hold', () => {
    // `062` took `ride_id` out, and `064` re-issues the whole list. An absolute
    // re-grant is exactly how a shipped decision gets silently reverted — by
    // someone rebuilding the list from PROD, where `062` is not yet promoted and
    // `ride_id` is therefore still on it.
    expect(granted).not.toContain('ride_id')
  })

  it('grants the capture columns 064 added, so a Journal can order on them', () => {
    expect(granted).toEqual(
      expect.arrayContaining([
        'taken_at',
        'taken_at_offset_minutes',
        'taken_latitude',
        'taken_longitude',
        'taken_location_precision',
      ])
    )
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
