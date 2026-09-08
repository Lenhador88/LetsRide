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
// `invalidateOnboardingState` is excluded by name: it clears the GUARD cache,
// not the query cache, and counting it would let a table writer pass rule 2 on
// rule 1's call (review of PR #373 found onboarding.ts passing exactly so).
const CACHE_CLAIM = /\binvalidate(?!OnboardingState\b)\w*\(|\bclearQueryCache\(|\bsetQueryData\(/

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

  it('tells a query-cache claim from a guard-cache one', () => {
    // The negative half for CACHE_CLAIM, against literal source rather than
    // the tree: a detector that matched everything would pass every writer.
    expect(CACHE_CLAIM.test("invalidate(queryKeys.rides.all())")).toBe(true)
    expect(CACHE_CLAIM.test("invalidateClubMembership(clubId)")).toBe(true)
    expect(CACHE_CLAIM.test("clearQueryCache()")).toBe(true)
    expect(CACHE_CLAIM.test("invalidateOnboardingState()")).toBe(false)
    expect(CACHE_CLAIM.test("await supabase.from('rides').insert(row)")).toBe(false)
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

/**
 * The same rule, per EXPORTED FUNCTION rather than per file — PD-428.
 *
 * **The file-granular check above cannot see a writer that loses its
 * invalidation while a sibling in the same module keeps one**, and PD-428 is
 * what made that matter: `onboarding.ts` now holds three writers of fields the
 * guard reads (`acceptTerms`, `setUsername`, `setHomeCountry`), so deleting any
 * one call still leaves the file matching and every assertion above green.
 * Measured before this block existed: removing `setHomeCountry`'s invalidation
 * left 30/30 passing.
 *
 * `setUsername` is the case that shows why the pattern list is wider than the
 * two RPCs. It writes no stamp — since PD-428 it does not call
 * `complete_onboarding` at all — but it writes `username`, and `has_username`
 * is exactly what the guard's resume branch reads to choose between the two
 * wizard steps. A writer of any field the decision reads owes the
 * invalidation, and the decision reads three.
 */
const GUARD_FIELD_WRITER =
  /\.rpc\('(?:accept_terms|complete_onboarding)'|\.auth\.signUp\(|\.update\(\{\s*username:|\.update\(\{\s*home_country:/

function exportedFunctions(source: string): Map<string, string> {
  const out = new Map<string, string>()
  // Split on the export boundary rather than brace-matching: these modules are
  // a flat list of exported async functions, and a parser here would be more
  // machinery than the rule is worth.
  const parts = source.split(/^export\s+(?:async\s+)?function\s+/m).slice(1)
  for (const part of parts) {
    const name = part.match(/^(\w+)/)?.[1]
    if (name) out.set(name, part)
  }
  return out
}

describe('every writer of a field the guard reads invalidates it — per function', () => {
  const found: string[] = []
  for (const [file, source] of sources) {
    for (const [name, body] of exportedFunctions(source)) {
      if (!GUARD_FIELD_WRITER.test(body)) continue
      found.push(`${file}:${name}`)
      it(`${file} — ${name}`, () => {
        expect(body).toMatch(/\binvalidateOnboardingState\(\)|\bclearGuardCache\(\)/)
      })
    }
  }

  it('the per-function detector still finds the writers it exists for', () => {
    // The both-ways half, per this file's own standing rule: a regex that
    // quietly stops matching must fail here rather than pass for ever. These
    // four are the whole population — if one disappears, either it was renamed
    // or the splitter stopped working, and both are worth failing over.
    expect(found).toEqual(
      expect.arrayContaining([
        'src/lib/actions/auth.ts:signUp',
        'src/lib/actions/onboarding.ts:acceptTerms',
        'src/lib/actions/onboarding.ts:setUsername',
        'src/lib/actions/onboarding.ts:setHomeCountry',
      ])
    )
  })

  it('splits a module into its exported functions rather than returning one blob', () => {
    // The failure that would make every assertion above vacuous: a splitter
    // returning the whole file as one entry passes for exactly the reason the
    // file-granular check already did.
    const fns = exportedFunctions(sources.get('src/lib/actions/onboarding.ts')!)
    expect(fns.size).toBeGreaterThan(2)
    expect(fns.has('setHomeCountry')).toBe(true)
    expect(fns.get('setHomeCountry')).not.toMatch(/export\s+(?:async\s+)?function\s+setUsername/)
  })
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
    [
      // Onboarding writes the username and the two stamps before any screen
      // has cached anything — the rider is inside the wizard, and the only
      // cache holding state there is the guard's, which it does invalidate.
      // The check: it still claims through the guard cache and still reaches
      // for no query-cache import; the day it does, it owes a real claim.
      'src/lib/actions/onboarding.ts',
      () => {
        const source = sources.get('src/lib/actions/onboarding.ts')!
        expect(source).toMatch(/\binvalidateOnboardingState\(\)/)
        expect(source).not.toMatch(/from '@\/lib\/query'/)
      },
    ],
  ])

  it('exempts only files that are still table writers', () => {
    // An exemption for a file that stopped writing is never evaluated and
    // never fails; keep the map honest.
    for (const file of exempt.keys()) expect(tableWriters).toContain(file)
  })

  for (const file of tableWriters) {
    const stillExempt = exempt.get(file)
    it(file, () => {
      if (stillExempt) return stillExempt()
      const source = sources.get(file)!
      expect(CACHE_CLAIM.test(source), `${file} writes and invalidates nothing`).toBe(true)
    })
  }
})
