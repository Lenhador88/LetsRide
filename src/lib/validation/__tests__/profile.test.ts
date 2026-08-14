import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BIKE_MODEL_MAX_LENGTH,
  BIO_MAX_LENGTH,
  bikeModelSchema,
  bioSchema,
  checkUsername,
  profileEditSchema,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernameSchema,
} from '@/lib/validation/profile'

const thisDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(thisDir, '../../../..')

/**
 * Pulls the reserved-username list out of the migration's CHECK constraint by
 * reading it as text, not by importing anything — the migration is SQL, not a
 * module, and it is what the running database actually enforces.
 *
 * **Pointed at 056, not at 003.** `003` added `profiles_username_not_reserved`
 * and `056` replaced it with a case-blind comparison against the same names, so
 * `003`'s copy is now a superseded definition that happens to parse. Reading it
 * would keep this test green while the live constraint drifted.
 */
const LIVE_RESERVED_CONSTRAINT = 'supabase/migrations/056_username_keeps_its_case.sql'

function reservedNamesFromMigration(): string[] {
  const sql = readFileSync(path.join(repoRoot, LIVE_RESERVED_CONSTRAINT), 'utf-8')
  const constraint = sql.match(
    /add constraint profiles_username_not_reserved[\s\S]*?not in\s*\(([\s\S]*?)\)/
  )
  if (!constraint) {
    throw new Error(
      `Could not find the profiles_username_not_reserved CHECK constraint in ${LIVE_RESERVED_CONSTRAINT} — did it move or get renamed?`
    )
  }
  const names = [...constraint[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
  if (names.length === 0) {
    throw new Error('Parsed zero reserved usernames out of the migration — the regex is broken.')
  }
  return names
}

/**
 * Same idea for the TS side. RESERVED_USERNAMES is intentionally not exported
 * from profile.ts (this test suite isn't allowed to add exports outside the
 * callback route), so it's read out of the source text instead of imported.
 */
function reservedNamesFromValidationModule(): string[] {
  const source = readFileSync(
    path.join(repoRoot, 'src/lib/validation/profile.ts'),
    'utf-8'
  )
  const declaration = source.match(
    /RESERVED_USERNAMES:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\]/
  )
  if (!declaration) {
    throw new Error(
      'Could not find RESERVED_USERNAMES in profile.ts — did the declaration shape change?'
    )
  }
  const names = [...declaration[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
  if (names.length === 0) {
    throw new Error('Parsed zero reserved usernames out of profile.ts — the regex is broken.')
  }
  return names
}

describe('usernameSchema — length boundaries', () => {
  it('rejects 2 characters', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false)
  })

  it('accepts 3 characters (the minimum)', () => {
    const result = usernameSchema.safeParse('abc')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('abc')
  })

  it('accepts 25 characters (the maximum)', () => {
    const name = 'a'.repeat(USERNAME_MAX_LENGTH)
    expect(name).toHaveLength(25)
    expect(usernameSchema.safeParse(name).success).toBe(true)
  })

  it('rejects 26 characters', () => {
    const name = 'a'.repeat(USERNAME_MAX_LENGTH + 1)
    expect(name).toHaveLength(26)
    expect(usernameSchema.safeParse(name).success).toBe(false)
  })

  it('USERNAME_MIN_LENGTH and USERNAME_MAX_LENGTH match the values used above', () => {
    // Guards the boundary tests themselves against a constant changing
    // without the literal 2/3/25/26 tests above being updated to match.
    //
    // It is also half of the pairing with the database: `057` writes 25 into
    // `profiles_username_format`, and the RLS suite asserts that constraint's
    // definition verbatim. Change one bound and exactly one of the two suites
    // goes red, which is the point — a client bound quietly below the
    // database's costs a rider nothing, and one quietly above it hands them a
    // Postgres error in place of a field message.
    expect(USERNAME_MIN_LENGTH).toBe(3)
    expect(USERNAME_MAX_LENGTH).toBe(25)
  })
})

describe('usernameSchema — charset', () => {
  it('rejects hyphens', () => {
    expect(usernameSchema.safeParse('road-rash').success).toBe(false)
  })

  it('rejects spaces', () => {
    expect(usernameSchema.safeParse('road rash').success).toBe(false)
  })

  it('rejects dots', () => {
    expect(usernameSchema.safeParse('road.rash').success).toBe(false)
  })

  it('accepts underscores', () => {
    const result = usernameSchema.safeParse('road_rash')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('road_rash')
  })

  it('accepts capitals, matching 056’s relaxed profiles_username_format', () => {
    expect(usernameSchema.safeParse('Pedro').success).toBe(true)
    expect(usernameSchema.safeParse('PEDRO').success).toBe(true)
    expect(usernameSchema.safeParse('PeDrO').success).toBe(true)
  })
})

describe('usernameSchema — normalisation', () => {
  it('trims leading and trailing whitespace', () => {
    const result = usernameSchema.safeParse('  ripper  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('ripper')
  })

  /**
   * PD-226. The schema used to lowercase, and a `.toLowerCase()` reappearing
   * here would undo the whole change with nothing else going red — the database
   * would still accept the write, the rider would just never be able to make it.
   */
  it('keeps the case the rider typed rather than lowercasing it', () => {
    const result = usernameSchema.safeParse('Pedro')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('Pedro')
  })

  it('keeps mixed case combined with trimming', () => {
    const result = usernameSchema.safeParse('  Road_Rash9  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('Road_Rash9')
  })
})

describe('usernameSchema — reserved denylist', () => {
  const reserved = reservedNamesFromMigration()

  it.each(reserved)('rejects reserved name %s', (name) => {
    expect(usernameSchema.safeParse(name).success).toBe(false)
  })

  /**
   * The trap PD-226 had to close in both places at once. The denylist is written
   * in lowercase because `003`'s charset forced lowercase; relax the charset and
   * leave the comparison exact, and `Admin` is a registerable username that
   * renders as `Admin` on every byline. `056` folds the column, this refine
   * folds the value, and these are the assertions that hold them together.
   */
  it.each(reserved)('rejects reserved name %s in title case', (name) => {
    const titleCase = name[0].toUpperCase() + name.slice(1)
    expect(usernameSchema.safeParse(titleCase).success).toBe(false)
  })

  it.each(reserved)('rejects reserved name %s in upper case', (name) => {
    expect(usernameSchema.safeParse(name.toUpperCase()).success).toBe(false)
  })

  it('rejects a reserved name even after case/whitespace normalisation', () => {
    expect(usernameSchema.safeParse('  Admin  ').success).toBe(false)
  })
})

describe('the TS denylist and the migration denylist', () => {
  it('contain exactly the same names', () => {
    const fromMigration = reservedNamesFromMigration()
    const fromModule = reservedNamesFromValidationModule()

    // Sorted-array equality rather than Set equality so a duplicate entry in
    // either list (which would still pass a Set comparison) also fails this.
    expect([...fromModule].sort()).toEqual([...fromMigration].sort())
  })
})

describe('checkUsername', () => {
  it('returns ok:true with the trimmed value, capitals intact', () => {
    expect(checkUsername('  Ripper  ')).toEqual({ ok: true, username: 'Ripper' })
  })

  it('returns ok:false with a message on failure', () => {
    const result = checkUsername('ab')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })
})

/**
 * Bio and bike are the fields the profile edit form owns. Unlike `username` and
 * `location` they have **no CHECK constraint behind them** — `001` declares both
 * columns as bare `text` — so these assertions are the only thing pinning the
 * rule, and they are the whole enforcement outside the action that parses them.
 */
describe('bioSchema / bikeModelSchema', () => {
  it('turns an empty field into null, so clearing a bio is not storing ""', () => {
    expect(bioSchema.parse('')).toBeNull()
    expect(bikeModelSchema.parse('')).toBeNull()
  })

  it('treats whitespace-only as cleared too', () => {
    // The trap the ride's `meeting_point` fell into: `required` accepts "   ",
    // and an untrimmed insert stores it.
    expect(bioSchema.parse('   ')).toBeNull()
    expect(bikeModelSchema.parse('\n\t ')).toBeNull()
  })

  it('trims the value it does keep', () => {
    expect(bioSchema.parse('  Rides at dawn.  ')).toBe('Rides at dawn.')
  })

  it('accepts the maximum length and rejects one past it', () => {
    expect(bioSchema.parse('x'.repeat(BIO_MAX_LENGTH))).toHaveLength(BIO_MAX_LENGTH)
    expect(bioSchema.safeParse('x'.repeat(BIO_MAX_LENGTH + 1)).success).toBe(false)

    expect(bikeModelSchema.parse('x'.repeat(BIKE_MODEL_MAX_LENGTH))).toHaveLength(
      BIKE_MODEL_MAX_LENGTH
    )
    expect(bikeModelSchema.safeParse('x'.repeat(BIKE_MODEL_MAX_LENGTH + 1)).success).toBe(false)
  })

  it('measures length after trimming, so trailing spaces cannot fail a valid bio', () => {
    expect(bioSchema.safeParse(`${'x'.repeat(BIO_MAX_LENGTH)}   `).success).toBe(true)
  })
})

describe('profileEditSchema', () => {
  const valid = { location: 'Amsterdam', bio: 'Rides at dawn.', bike_model: 'Kawasaki Z900' }

  it('accepts the three fields the form submits', () => {
    expect(profileEditSchema.parse(valid)).toEqual(valid)
  })

  it('still requires a location — it is the one field onboarding made mandatory', () => {
    expect(profileEditSchema.safeParse({ ...valid, location: '' }).success).toBe(false)
  })

  it('allows bio and bike to be cleared independently of location', () => {
    expect(profileEditSchema.parse({ location: 'Utrecht', bio: '', bike_model: '' })).toEqual({
      location: 'Utrecht',
      bio: null,
      bike_model: null,
    })
  })

  it('does not accept a username, so the form cannot smuggle one past the action', () => {
    // Renaming is a flow with a uniqueness conflict path, not a form field.
    // `.parse` strips unknown keys rather than throwing, which is exactly the
    // property worth pinning: the extra key reaches the database as nothing.
    const parsed = profileEditSchema.parse({ ...valid, username: 'someone_else' })
    expect(parsed).not.toHaveProperty('username')
  })
})
