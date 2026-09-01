import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Every writer under `lib/actions/` owes an invalidation, and this file is the
 * tripwire for the NEXT one rather than a test of any existing one.
 *
 * `invalidation.test.ts` next door exercises four actions; this reads all of
 * them. Two rules, both stated in CLAUDE.md and until now enforced by nothing:
 *
 * 1. §Critical: *"Any new writer of a stamp the decision reads must invalidate
 *    the cache."* A module that stamps consent (`accept_terms`), completion
 *    (`complete_onboarding`) or establishes a session (`auth.signUp`) must
 *    call `invalidateOnboardingState()`; the one that ends a session must
 *    call `clearGuardCache()` AND `clearQueryCache()`. Miss the first and the
 *    rider finishes a step and is sent straight back into it; miss the second
 *    and the next rider on the device reads the last one's cache.
 * 2. §Component & Code Conventions: the `invalidate(...)` call is *"the cache
 *    claim that replaced revalidatePath"*. A module that writes a table —
 *    insert, upsert, update, delete, or any RPC — and claims nothing leaves
 *    every screen showing the row as it was.
 *
 * Both are asserted on COMMENT-STRIPPED source, for the reason
 * `RideInviteJoin.test.tsx` learned the hard way: this repo's docstrings
 * describe what a file does NOT do, so an unstripped grep for `.update(`
 * counts the comment saying "the v1 form called `.update()` directly".
 *
 * Verified both ways, per §Working Principles: the detectors are checked
 * against the files known to carry each pattern, so a regex that quietly
 * stops matching fails here instead of passing for ever.
 */

const files = execFileSync('git', ['ls-files', 'src/lib/actions/*.ts'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.includes('__tests__'))

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const sources = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]))

const STAMP_WRITER = /\.rpc\('(?:accept_terms|complete_onboarding)'|\.auth\.signUp\(/
const SESSION_ENDER = /\.auth\.signOut\(/
const TABLE_WRITER = /\.(?:insert|upsert|update|delete)\(|\.rpc\(/
// `invalidate\w*(` rather than `invalidate(`: several modules claim through a
// named helper — `invalidateRide()` in rides.ts, `invalidateClubMembership()`
// shared from clubs.ts — and the helper's own body is where the key is spelled.
const CACHE_CLAIM = /\binvalidate\w*\(|\bclearQueryCache\(|\bsetQueryData\(/

const stampWriters = files.filter((f) => STAMP_WRITER.test(sources.get(f)!))
const sessionEnders = files.filter((f) => SESSION_ENDER.test(sources.get(f)!))
const tableWriters = files.filter((f) => TABLE_WRITER.test(sources.get(f)!))

describe('the detectors still see the files they exist for', () => {
  it('finds the action modules at all', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('finds the stamp writers — signUp, acceptTerms, setUsername', () => {
    expect(stampWriters).toEqual(
      expect.arrayContaining(['src/lib/actions/auth.ts', 'src/lib/actions/onboarding.ts'])
    )
  })

  it('finds exactly one module that ends a session', () => {
    expect(sessionEnders).toEqual(['src/lib/actions/auth.ts'])
  })

  it('finds most action modules as table writers', () => {
    // Every action module bar a couple of pure helpers writes something. A
    // detector that finds three has stopped matching, not found a clean tree.
    expect(tableWriters.length).toBeGreaterThan(files.length / 2)
  })
})

describe('every stamp writer invalidates the guard cache', () => {
  for (const file of stampWriters) {
    it(file, () => {
      const source = sources.get(file)!
      expect(source).toMatch(/\binvalidateOnboardingState\(\)/)
      expect(source).toMatch(/from '@\/lib\/auth\/guard-cache'/)
    })
  }
})

describe('the session ender clears both caches', () => {
  for (const file of sessionEnders) {
    it(file, () => {
      const source = sources.get(file)!
      expect(source).toMatch(/\bclearGuardCache\(\)/)
      expect(source).toMatch(/\bclearQueryCache\(\)/)
    })
  }
})

describe('every table writer makes a cache claim', () => {
  // Add a file here only with the reason beside it AND a check that the reason
  // still holds — an exemption with no reason is the rule going quiet.
  const exempt = new Map<string, () => void>([
    [
      // `feedback` is write-only from the app: no screen reads it back, so
      // there is no key to claim. The day `keys.ts` names it, this stops
      // being true and the exemption fails rather than lingering.
      'src/lib/actions/feedback.ts',
      () => expect(readFileSync('src/lib/query/keys.ts', 'utf8')).not.toMatch(/feedback/i),
    ],
  ])
  for (const file of tableWriters) {
    const stillExempt = exempt.get(file)
    it(file, () => {
      if (stillExempt) return stillExempt()
      const source = sources.get(file)!
      expect(CACHE_CLAIM.test(source), `${file} writes and invalidates nothing`).toBe(true)
    })
  }
})
