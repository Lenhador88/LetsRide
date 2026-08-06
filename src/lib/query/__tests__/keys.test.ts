import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EVERYTHING, queryKeys } from '@/lib/query/keys'
import { invalidate, setQueryData, type QueryKey } from '@/lib/query/queryClient'

const SRC = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))

/**
 * Every key factory in `keys.ts`, flattened, called with placeholder arguments.
 *
 * Walked from the object rather than listed, so a key added to `keys.ts` is
 * covered here without anyone remembering to add it — the failure this whole
 * file exists to prevent is a key nobody thought about.
 */
function allKeys(): { path: string; key: QueryKey }[] {
  const out: { path: string; key: QueryKey }[] = []
  for (const [group, factories] of Object.entries(queryKeys)) {
    for (const [name, factory] of Object.entries(factories as Record<string, unknown>)) {
      const fn = factory as (...args: unknown[]) => QueryKey
      // One placeholder per declared parameter. Every factory takes ids or a
      // serialised filter, so a single string stands in for all of them.
      const args = Array.from({ length: fn.length }, (_, i) => `arg${i}`)
      out.push({ path: `${group}.${name}`, key: fn(...args) })
    }
  }
  return out
}

describe('the cache-key contract', () => {
  it('enumerates something, so nothing below can pass by scanning an empty object', () => {
    expect(allKeys().length).toBeGreaterThanOrEqual(15)
  })

  it('gives every key a distinct serialisation', () => {
    const seen = new Map<string, string>()
    for (const { path: name, key } of allKeys()) {
      const id = JSON.stringify(key)
      // Two factories colliding means one screen's invalidation silently
      // refreshes another's data, or fails to refresh its own.
      expect(seen.get(id), `${name} collides with ${seen.get(id)}`).toBeUndefined()
      seen.set(id, name)
    }
  })

  it('nests every key under its own domain prefix', () => {
    // `invalidate` matches on prefix, so `postcards.all()` must reach every
    // postcard key and reach nothing else. A key whose first segment did not
    // match its group would be invisible to its own domain's invalidation.
    for (const { path: name, key } of allKeys()) {
      const group = name.split('.')[0]
      expect(key[0], `${name} does not start with ${group}`).toBe(group)
    }
  })

  it('makes each domain\'s all() a prefix of that domain and no other', () => {
    const domains = ['profile', 'clubs', 'postcards', 'rides'] as const
    for (const domain of domains) {
      const prefix =
        domain === 'profile' ? queryKeys.profile.all() : queryKeys[domain].all()
      for (const { path: name, key } of allKeys()) {
        const covered = prefix.every((part, i) => part === key[i])
        expect(covered, `${prefix.join('/')} vs ${name}`).toBe(name.startsWith(`${domain}.`))
      }
    }
  })

  it('nests comments under their postcard and crew under their ride', () => {
    // Both were deliberate: deleting a postcard must drop its thread in the same
    // call, and joinRide invalidated all three ride routes together.
    const postcard = queryKeys.postcards.detail('p1')
    expect(queryKeys.postcards.comments('p1').slice(0, postcard.length)).toEqual(postcard)

    const ride = queryKeys.rides.detail('r1')
    expect(queryKeys.rides.crew('r1').slice(0, ride.length)).toEqual(ride)

    const club = queryKeys.clubs.detail('c1')
    expect(queryKeys.clubs.members('c1').slice(0, club.length)).toEqual(club)
  })

  it('uses the empty key for the two claims that mean everything', () => {
    // revalidatePath('/', 'layout') in signOut and blockRider. An empty prefix
    // matches every key, which is what those two claims say.
    expect(EVERYTHING).toEqual([])
    for (const { key } of allKeys()) {
      expect(EVERYTHING.every((part, i) => part === key[i])).toBe(true)
    }
  })
})

/**
 * The claims `keys.ts` was written to absorb — task 5.9.
 *
 * There were **33** `revalidatePath(` call sites across the 8 Server Action
 * files (not the 41 that `git grep -c` reports, which counts the 8 `import`
 * lines too — the counting trap CLAUDE.md documents three times over). Every
 * one of them is now either a `queryKeys.*` invalidation or recorded at its
 * site as deliberately dropped.
 *
 * This block used to assert those two numbers. It cannot any more — they are
 * both zero — so it asserts the property they were standing in for, which is
 * the stronger one and the one that can still regress:
 *
 * 1. No `revalidatePath` survives anywhere under `lib/actions/`. It is a no-op
 *    in a client-rendered app, so a stray one is a freshness claim that silently
 *    does nothing — exactly the failure `keys.ts` exists to prevent.
 * 2. Every `invalidate(...)` argument comes from `queryKeys` or is `EVERYTHING`.
 *    A key spelled inline is a bug even when the string happens to be right,
 *    because nothing then ties the write back to the read it invalidates.
 */
/**
 * Comments are stripped before any of the scans below run, and that is not
 * fastidiousness — every module in `lib/actions/` documents the
 * `revalidatePath` claim it replaced, by name, in prose. Scanning the raw
 * source finds four files' worth of those and reports a completed migration as
 * an incomplete one. `columns.test.ts` hit the same thing from the other side:
 * a `.select()` matcher review defeated with a comment between the paren and
 * the literal. This repo comments densely enough that a source scan which does
 * not account for it is measuring the prose.
 *
 * Block comments first, then line comments — the other order leaves the `//`
 * inside a `/* … *\/` block behind. Naive about `//` inside a string literal,
 * which `lib/actions/` contains none of; it is a tripwire, not a parser.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('the invalidation claims keys.ts maps', () => {
  const actions = path.join(SRC, 'lib', 'actions')
  const sources = readdirSync(actions)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, stripComments(readFileSync(path.join(actions, f), 'utf8'))] as const)

  it('has no revalidatePath left to be a no-op', () => {
    const offenders = sources
      .filter(([, source]) => /revalidatePath\(/.test(source))
      .map(([name]) => name)
    expect(offenders).toEqual([])
  })

  it('spells every invalidation from keys.ts, never inline', () => {
    const offenders: string[] = []

    for (const [name, source] of sources) {
      // The argument up to the first `)` — enough to tell `queryKeys.rides.all()`
      // from `['rides']`, which is the whole distinction being policed.
      for (const [, argument] of source.matchAll(/\binvalidate\(([^)]*)/g)) {
        const arg = argument.trim()
        if (arg === '' || arg.startsWith('queryKeys.') || arg === 'EVERYTHING') continue
        offenders.push(`${name}: invalidate(${arg}…`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('leaves no action module without a way to claim freshness', () => {
    // Every module that writes must either invalidate or say why it does not.
    // `reportPostcard` is the one deliberate silence — a report changes nothing
    // any screen renders — and `moderation.ts` invalidates for its other two.
    const writesWithoutInvalidation = sources
      .filter(([name]) => name !== 'state.ts' && name !== 'navigate.ts')
      .filter(([, source]) => /\.from\(|\.rpc\(|auth\.signOut/.test(source))
      .filter(([, source]) => !/\binvalidate\(|clearQueryCache\(/.test(source))
      .map(([name]) => name)

    // onboarding.ts writes the two profile stamps through RPCs and navigates
    // away from every screen that could show them, so it claims nothing.
    expect(writesWithoutInvalidation).toEqual(['onboarding.ts'])
  })
})

describe('invalidate reaches what the keys promise', () => {
  it('refreshes a nested key from its domain prefix, and leaves other domains alone', () => {
    setQueryData(queryKeys.postcards.comments('p1'), 'thread')
    setQueryData(queryKeys.rides.crew('r1'), 'crew')

    // No mounted subscriber, so this is really asserting that invalidate accepts
    // the prefix and does not throw on an unmounted key — the shape every
    // Server Action will call it with.
    expect(() => invalidate(queryKeys.postcards.all())).not.toThrow()
    expect(() => invalidate(EVERYTHING)).not.toThrow()
  })
})
