import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EVERYTHING, filterSegment, queryKeys } from '@/lib/query/keys'
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

  it('nests the club timeline\'s own postcard window under the club feed\'s key — PD-375', () => {
    // `joinClub`/`leaveClub` invalidate `postcards.feed(filterSegment.club(id))`
    // directly and need no edit for the timeline's own window to move with it.
    const feed = queryKeys.postcards.feed(filterSegment.club('c1'))
    const window = queryKeys.postcards.clubWindow('c1')
    expect(window.slice(0, feed.length)).toEqual(feed)
  })

  it('reaches every depth of a paged decoration key from its depth-less form — PD-375', () => {
    // `waveJoin`/`unwaveJoin`/`introduceToClub` keep invalidating the
    // depth-less form and rely on `invalidate`'s prefix match to reach every
    // depth a paged club timeline has fetched — task 3.2's own claim, checked
    // rather than assumed.
    const waves = queryKeys.clubs.joinWaves('c1')
    const deepWaves = queryKeys.clubs.joinWaves('c1', 3)
    expect(deepWaves.slice(0, waves.length)).toEqual(waves)
    expect(deepWaves).not.toEqual(waves)

    const introductions = queryKeys.clubs.joinIntroductions('c1')
    const deepIntroductions = queryKeys.clubs.joinIntroductions('c1', 2)
    expect(deepIntroductions.slice(0, introductions.length)).toEqual(introductions)
    expect(deepIntroductions).not.toEqual(introductions)
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
      // `invalidateClubMembership` is named EXPLICITLY rather than matched by a
      // widened `invalidate[A-Za-z]*\(` pattern, and the difference is measured
      // rather than stylistic: that wider form also matches
      // `invalidateOnboardingState`, which is the GUARD cache (`guard-cache.ts`)
      // and not this one — so it would silently drop `onboarding.ts` off the
      // deliberate-silence list below and read a module that claims nothing as
      // one that claims something.
      //
      // `club-members.ts` (`088`) claims through the helper `clubs.ts` exports
      // and `joinClub`/`leaveClub` already share; pasting a second copy of that
      // rule into it is exactly what the shared helper exists to prevent.
      .filter(
        ([, source]) =>
          !/\binvalidate\(|\binvalidateClubMembership\(|clearQueryCache\(/.test(source)
      )
      .map(([name]) => name)

    // Two deliberate silences, and they are silent for different reasons.
    //
    // `onboarding.ts` writes the two profile stamps through RPCs and navigates
    // away from every screen that could show them, so it claims nothing.
    //
    // `feedback.ts` (`084`, PD-321) has nothing to claim: `authenticated` holds
    // INSERT on four columns of `feedback` and NO SELECT grant, and there is no
    // SELECT policy either — so no screen reads the table, there is no key for
    // it in `keys.ts`, and adding one to invalidate would be a freshness claim
    // about a read that does not exist. **If a reading story is ever built, it
    // arrives with a key and this list gets shorter.**
    expect(writesWithoutInvalidation).toEqual(['feedback.ts', 'onboarding.ts'])
  })

  // PD-177. `notifications.list()` had no writer at all: `markNotificationsRead`
  // was the table's only claimant and it names `unread()`. The gap is not
  // visible from `keys.ts` — a key with no invalidator looks exactly like a key
  // nothing makes stale — so the audit's conclusion is pinned here instead.
  //
  // Each name below is a write that moves this rider's OWN list, by cascading a
  // subject row away (`036` §1) or by changing whether one resolves (`036` §3).
  // The negative half — every write that deliberately claims nothing, and why —
  // is the table in `keys.ts`'s `notifications` block; it cannot be asserted
  // here, because "does not mention a key" is what a forgotten call site looks
  // like too.
  it('claims a notifications key from every write that moves the actor’s own list', () => {
    // The VALUE is asserted, not just the presence of some notifications key.
    // `all()` against `list()` is the whole content of the rule PD-177 adds to
    // keys.ts — rows appearing or disappearing move the unread count, a changed
    // embed does not — so a test matching any notifications key would stay green
    // through exactly the flip the rule exists to prevent: `deleteRide` narrowed
    // to `list()` leaves a stale badge counting a notification whose ride is gone.
    const claimants: Record<string, Record<string, 'all' | 'list' | 'unread'>> = {
      'clubs.ts': {
        invalidateClubMembership: 'all', // resolvability — rows leave the list
        updateClub: 'all', // privacy flip can strand an owner with no membership row
        deleteClub: 'all', // cascade
      },
      'rides.ts': {
        updateRide: 'list', // embedded title only; no row appears or vanishes
        deleteRide: 'all', // cascade
      },
      'postcards.ts': { deletePostcard: 'all' },
      'comments.ts': { deleteComment: 'all' },
      'notifications.ts': { markNotificationsRead: 'unread' },
    }

    const missing: string[] = []

    for (const [file, fns] of Object.entries(claimants)) {
      const source = sources.find(([name]) => name === file)?.[1]
      expect(source, `${file} is gone — the audit moved and this list did not`).toBeDefined()

      for (const [fn, expected] of Object.entries(fns)) {
        // From the declaration to the next top-level one, which is where a
        // function's own invalidations live. `stripComments` already ran, so a
        // doc block naming the key cannot stand in for a call — the comment
        // trap CLAUDE.md documents four times over.
        const start = source!.search(new RegExp(`(export )?(async )?(function|const) ${fn}\\b`))
        if (start === -1) {
          missing.push(`${file}: ${fn} not found`)
          continue
        }
        // `const ` is in the boundary too, not only `function `. Converting any
        // action to `export const deleteRide = async () => {}` would otherwise
        // stop terminating the PREVIOUS claimant's body, which would run on and
        // absorb this one's invalidations — leaving the earlier function green
        // with no call of its own.
        const next = source!.slice(start + 1).search(/\n(export )?(async )?(function|const) /)
        const body = next === -1 ? source!.slice(start) : source!.slice(start, start + 1 + next)

        const claimed = [...body.matchAll(/invalidate\(queryKeys\.notifications\.(\w+)\(/g)].map(
          (m) => m[1]
        )
        if (!claimed.includes(expected)) {
          missing.push(`${file}: ${fn} claims [${claimed.join(', ') || 'nothing'}], wants ${expected}()`)
        }
      }
    }

    expect(missing).toEqual([])
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
