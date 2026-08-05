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
 * The count `keys.ts` is written around. If a Server Action gains or loses a
 * `revalidatePath`, this fails and whoever changed it has to decide which cache
 * key covers the new claim — which is the whole point of the file.
 *
 * Anchored on `revalidatePath(`, not the bare word: the bare word is 41,
 * because each of the 8 files also imports it, and that off-by-eight is
 * currently written into `design.md` and `tasks.md`.
 */
describe('the invalidation claims keys.ts maps', () => {
  const actions = path.join(SRC, 'lib', 'actions')
  const callSites = readdirSync(actions)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(path.join(actions, f), 'utf8'))
    .reduce((n, source) => n + (source.match(/revalidatePath\(/g)?.length ?? 0), 0)

  it('is still 33', () => {
    expect(callSites).toBe(33)
  })

  it('is not the 41 that counting lines rather than calls produces', () => {
    const byLine = readdirSync(actions)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(path.join(actions, f), 'utf8'))
      .reduce(
        (n, source) => n + source.split('\n').filter((l) => l.includes('revalidatePath')).length,
        0
      )
    expect(byLine).toBe(41)
    expect(byLine - callSites).toBe(8)
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
