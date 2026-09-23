import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `profiles.rides_from` is the rider's own words and never a position — PD-476.
 *
 * `127`'s column comment and `rider-profile-viewing` both say nothing may
 * geocode it, measure from it, or fall back to it when `location` is NULL. The
 * mistake to expect is exactly that fallback: a resolver that finds no placed
 * town and "helpfully" tries the other column. A sentence cannot stop it; an
 * allowlist of the files that may name the column can, because the diff that
 * adds a reader also has to add it here, in front of a reviewer.
 *
 * Comment-stripped, per CLAUDE.md's comment trap — `rider-location.ts` or a
 * header elsewhere may well mention the column to say it is NOT read, and that
 * must not count as reading it. The stripper's own two directions are pinned
 * in the last block.
 */

const SRC = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : walk(full)
    return /\.tsx?$/.test(full) ? [full] : []
  })
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const MENTIONS = /\brides_from\b/

const ALLOWED = [
  'components/profile/EditProfileForm.tsx',
  'lib/actions/profile.ts',
  'lib/data/columns.ts',
  'lib/profile-line.ts',
  'lib/validation/profile.ts',
  'types/index.ts',
]

describe('rides_from is named only where it is written, typed or displayed', () => {
  const readers = walk(SRC)
    .filter((file) => MENTIONS.test(stripComments(readFileSync(file, 'utf8'))))
    .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
    .sort()

  it('matches the allowlist exactly', () => {
    expect(readers).toEqual(ALLOWED)
  })

  it('reaches nothing under lib/location/, the place search, or an Explore screen', () => {
    for (const file of readers) {
      expect(file).not.toMatch(/^lib\/location\//)
      expect(file).not.toMatch(/places/)
      expect(file).not.toMatch(/explore/)
    }
  })
})

describe('the comment stripper', () => {
  it('still sees a real mention', () => {
    expect(MENTIONS.test(stripComments("const x = profile.rides_from ?? null"))).toBe(true)
    expect(MENTIONS.test(stripComments("select('id, rides_from')"))).toBe(true)
  })

  it('drops a mention that is only prose', () => {
    expect(MENTIONS.test(stripComments('// never reads rides_from\nconst y = 1'))).toBe(false)
    expect(MENTIONS.test(stripComments('/**\n * not rides_from\n */\nconst y = 1'))).toBe(false)
    expect(MENTIONS.test(stripComments('{/* rides_from is display-only */}'))).toBe(false)
  })

  it('does not treat a URL in a string as a comment', () => {
    expect(stripComments("fetch('https://x.test/rides_from')")).toContain('rides_from')
  })
})
