import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  checkUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernameSchema,
} from '@/lib/validation/profile'

const thisDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(thisDir, '../../../..')

/**
 * Pulls the reserved-username list out of the migration's CHECK constraint by
 * reading it as text, not by importing anything — 003_onboarding.sql is SQL,
 * not a module, and this file is what the running database actually enforces.
 */
function reservedNamesFromMigration(): string[] {
  const sql = readFileSync(
    path.join(repoRoot, 'supabase/migrations/003_onboarding.sql'),
    'utf-8'
  )
  const constraint = sql.match(
    /profiles_username_not_reserved[\s\S]*?not in\s*\(([\s\S]*?)\)/
  )
  if (!constraint) {
    throw new Error(
      'Could not find profiles_username_not_reserved CHECK constraint in 003_onboarding.sql — did it move or get renamed?'
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

  it('accepts 20 characters (the maximum)', () => {
    const name = 'a'.repeat(USERNAME_MAX_LENGTH)
    expect(name).toHaveLength(20)
    expect(usernameSchema.safeParse(name).success).toBe(true)
  })

  it('rejects 21 characters', () => {
    const name = 'a'.repeat(USERNAME_MAX_LENGTH + 1)
    expect(name).toHaveLength(21)
    expect(usernameSchema.safeParse(name).success).toBe(false)
  })

  it('USERNAME_MIN_LENGTH and USERNAME_MAX_LENGTH match the values used above', () => {
    // Guards the boundary tests themselves against a constant changing
    // without the literal 2/3/20/21 tests above being updated to match.
    expect(USERNAME_MIN_LENGTH).toBe(3)
    expect(USERNAME_MAX_LENGTH).toBe(20)
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
})

describe('usernameSchema — normalisation', () => {
  it('trims leading and trailing whitespace', () => {
    const result = usernameSchema.safeParse('  ripper  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('ripper')
  })

  it('lowercases rather than rejecting uppercase', () => {
    const result = usernameSchema.safeParse('RIPPER')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('ripper')
  })

  it('lowercases mixed case combined with trimming', () => {
    const result = usernameSchema.safeParse('  Road_Rash9  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('road_rash9')
  })
})

describe('usernameSchema — reserved denylist', () => {
  const reserved = reservedNamesFromMigration()

  it.each(reserved)('rejects reserved name %s', (name) => {
    expect(usernameSchema.safeParse(name).success).toBe(false)
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
  it('returns ok:true with the normalised value on success', () => {
    expect(checkUsername('  Ripper  ')).toEqual({ ok: true, username: 'ripper' })
  })

  it('returns ok:false with a message on failure', () => {
    const result = checkUsername('ab')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })
})
