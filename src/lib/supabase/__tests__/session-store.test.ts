import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearSessionStore,
  describeSessionStore,
  resetSessionStoreForTests,
  resolveSessionStore,
  type SessionStore,
} from '@/lib/supabase/session-store'

/**
 * Where the session lives once it stops being a cookie — tasks 4.1, 4.2 and 4.5.
 *
 * **This module shipped with no caller and no test.** It was written with the
 * seam deliberately ahead of the shell, which was right; what was not right is
 * that group 6 wired it in without ever asserting the two properties the whole
 * design rests on:
 *
 *   1. A shell that provides a secure store gets used, and **nothing lands in
 *      `localStorage`** when one is present. Task 4.2 is unsatisfiable in a
 *      browser build by construction — there is no secure store to use — so the
 *      honest form of that requirement is this one, and it is the one the native
 *      build will depend on.
 *   2. Sign-out destroys the session, **including a session written before a
 *      reload**, which the tracked-key set cannot know about. That is the whole
 *      reason `clearSessionStore` sweeps by prefix as well, and the reason the
 *      fallback is `localStorage` rather than something unenumerable: a store
 *      you cannot enumerate is a store you cannot prove you cleared.
 *
 * The suite runs in `node`, so `window` is faked. Only the three storage methods
 * and `localStorage`'s enumerability are read.
 */

type FakeWindow = {
  __letsrideSecureStore?: SessionStore
  localStorage?: Record<string, string> & {
    getItem(k: string): string | null
    setItem(k: string, v: string): void
    removeItem(k: string): void
  }
}

const globals = globalThis as { window?: FakeWindow }

function fakeLocalStorage(seed: Record<string, string> = {}) {
  const map: Record<string, string> = { ...seed }
  return Object.assign(map, {
    getItem: (k: string) => (k in map ? map[k] : null),
    setItem: (k: string, v: string) => {
      map[k] = v
    },
    removeItem: (k: string) => {
      delete map[k]
    },
  })
}

/** Keys only, so `Object.keys` on the fake sees storage entries and not methods. */
function storedKeys(store: NonNullable<FakeWindow['localStorage']>): string[] {
  return Object.keys(store).filter((k) => typeof store[k] === 'string')
}

function memorySecureStore() {
  const map = new Map<string, string>()
  return {
    map,
    store: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    } satisfies SessionStore,
  }
}

/**
 * What the native shell actually provides — the same store plus `keys()`, which
 * is what `src/lib/native/secure-store.ts` implements over the keychain. Kept
 * separate from `memorySecureStore` so both halves of the optional method stay
 * covered: a store that can enumerate itself gets swept, one that cannot still
 * clears what this page load wrote.
 */
function enumerableSecureStore(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    map,
    store: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      keys: () => [...map.keys()],
    } satisfies SessionStore,
  }
}

beforeEach(() => {
  resetSessionStoreForTests()
  globals.window = { localStorage: fakeLocalStorage() }
})

afterEach(() => {
  resetSessionStoreForTests()
  delete globals.window
})

describe('which store is chosen', () => {
  it('prefers the shell secure store, and puts nothing in localStorage', async () => {
    const secure = memorySecureStore()
    globals.window!.__letsrideSecureStore = secure.store

    const { kind, store } = resolveSessionStore()
    expect(kind).toBe('secure')

    await store.setItem('sb-ref-auth-token', 'the-session')

    // Task 4.2, in the only form a test can state it: with a secure store
    // present, the weaker one is untouched.
    expect(secure.map.get('sb-ref-auth-token')).toBe('the-session')
    expect(storedKeys(globals.window!.localStorage!)).toEqual([])
  })

  it('falls back to localStorage in a plain browser, and says so out loud', () => {
    expect(resolveSessionStore().kind).toBe('local')
    expect(describeSessionStore()).toMatch(/any script on this origin can read/)
  })

  it('degrades to memory rather than throwing when storage is unavailable', () => {
    // Safari private mode has historically had a `localStorage` that exists and
    // throws on access, and a webview with storage disabled does too. A throw
    // here would take down client construction, which is the first thing every
    // screen depends on.
    globals.window!.localStorage = Object.assign({} as Record<string, string>, {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    })

    expect(resolveSessionStore().kind).toBe('memory')
    expect(describeSessionStore()).toMatch(/lost on reload/)
  })

  it('resolves once per page load, not per call', () => {
    const first = resolveSessionStore()
    // A shell that finishes booting *after* the first resolution must not change
    // the answer, or a session written to one store is read from another.
    globals.window!.__letsrideSecureStore = memorySecureStore().store
    expect(resolveSessionStore()).toBe(first)
    expect(resolveSessionStore().kind).toBe('local')
  })
})

describe('sign-out destroys the session', () => {
  it('removes what this page load wrote', async () => {
    const { store } = resolveSessionStore()
    await store.setItem('sb-ref-auth-token', 'the-session')
    expect(storedKeys(globals.window!.localStorage!)).toContain('sb-ref-auth-token')

    await clearSessionStore()
    expect(storedKeys(globals.window!.localStorage!)).toEqual([])
  })

  it('also removes a session written before a reload, which the tracked set cannot know about', async () => {
    // The case the prefix sweep exists for, and the one a per-page-load key set
    // gets wrong on its own: the rider signed in yesterday, reloaded, and signed
    // out today. Nothing in this process ever wrote that key.
    globals.window!.localStorage = fakeLocalStorage({
      'sb-zwprydcyryvudhurbnye-auth-token': 'yesterday',
      'sb-zwprydcyryvudhurbnye-auth-token-code-verifier': 'pkce',
    })
    resolveSessionStore()

    await clearSessionStore()
    expect(storedKeys(globals.window!.localStorage!)).toEqual([])
  })

  it('leaves everything that is not Supabase alone', async () => {
    globals.window!.localStorage = fakeLocalStorage({
      'sb-ref-auth-token': 'session',
      'letsride:last-seen-tip': 'keep me',
    })
    resolveSessionStore()

    await clearSessionStore()
    expect(storedKeys(globals.window!.localStorage!)).toEqual(['letsride:last-seen-tip'])
  })

  it('sweeps a secure store for a session written before a reload', async () => {
    // The hole this closes: the sweep used to run only for `kind === 'local'`,
    // which was invisible while the secure store was an unimplemented seam and
    // became a real leak the moment a shell provided one. Yesterday's keychain
    // entry is in no tracked set — nothing in this process ever wrote it — so
    // without enumeration it survives sign-out, in the store where a leftover
    // credential matters most.
    const secure = enumerableSecureStore({
      'sb-zwprydcyryvudhurbnye-auth-token': 'yesterday',
      'sb-zwprydcyryvudhurbnye-auth-token-code-verifier': 'pkce',
    })
    globals.window!.__letsrideSecureStore = secure.store
    expect(resolveSessionStore().kind).toBe('secure')

    await clearSessionStore()
    expect([...secure.map.keys()]).toEqual([])
  })

  it('leaves everything that is not Supabase alone in the secure store too', async () => {
    const secure = enumerableSecureStore({
      'sb-ref-auth-token': 'session',
      'letsride:device-id': 'keep me',
    })
    globals.window!.__letsrideSecureStore = secure.store
    resolveSessionStore()

    await clearSessionStore()
    expect([...secure.map.keys()]).toEqual(['letsride:device-id'])
  })

  it('still clears tracked keys when the secure store cannot enumerate itself', async () => {
    // `keys()` is optional on the type. A store without it degrades to exactly
    // the behaviour every store had before the sweep generalised — strictly
    // weaker, and the reason the native implementation provides one.
    const secure = memorySecureStore()
    globals.window!.__letsrideSecureStore = secure.store

    const { store } = resolveSessionStore()
    await store.setItem('sb-ref-auth-token', 'the-session')

    await clearSessionStore()
    expect(secure.map.size).toBe(0)
  })

  it('survives a secure store whose keys() throws', async () => {
    const secure = enumerableSecureStore({ 'sb-ref-auth-token': 'yesterday' })
    globals.window!.__letsrideSecureStore = {
      ...secure.store,
      keys: () => {
        throw new Error('keychain unavailable')
      },
    }
    resolveSessionStore()

    // Sign-out must still resolve (4.5) — a store that cannot be enumerated must
    // not be the thing that keeps a rider signed in.
    await expect(clearSessionStore()).resolves.toBeUndefined()
  })

  it('sweeps localStorage even when the secure store is the resolved one', async () => {
    // On a device the keychain wins, but a session written by an *earlier* build
    // — a browser visit, or anything before the shell shipped — is sitting in
    // the webview's localStorage, where a sweep that follows only the resolved
    // store will never look. Sign-out has to reach both.
    globals.window!.localStorage = fakeLocalStorage({
      'sb-zwprydcyryvudhurbnye-auth-token': 'left by the browser build',
      'letsride:last-seen-tip': 'keep me',
    })
    const secure = enumerableSecureStore({ 'sb-ref-auth-token': 'the-session' })
    globals.window!.__letsrideSecureStore = secure.store
    expect(resolveSessionStore().kind).toBe('secure')

    await clearSessionStore()

    expect([...secure.map.keys()]).toEqual([])
    expect(storedKeys(globals.window!.localStorage!)).toEqual(['letsride:last-seen-tip'])
  })

  it('is not disabled by a stored item that happens to be named "keys"', async () => {
    // `Storage` has a named-property getter, so `localStorage.keys` is the
    // *string* here, not a method. A truthiness feature-detect would forward it
    // as `keys`, hand `clearSessionStore` something non-callable, and silently
    // turn the sweep off for the store that most needs it.
    globals.window!.localStorage = fakeLocalStorage({
      keys: 'not a method',
      'sb-ref-auth-token': 'the-session',
    })
    resolveSessionStore()

    await clearSessionStore()
    expect(storedKeys(globals.window!.localStorage!)).toEqual(['keys'])
  })

  it('clears the secure store too, and survives one that throws', async () => {
    const secure = memorySecureStore()
    globals.window!.__letsrideSecureStore = {
      ...secure.store,
      // Sign-out must land the rider signed out even when the store misbehaves
      // (4.5). A storage exception must not be the thing that keeps them in.
      removeItem: (k: string) => {
        secure.map.delete(k)
        throw new Error('keychain unavailable')
      },
    }

    const { store } = resolveSessionStore()
    await store.setItem('sb-ref-auth-token', 'the-session')

    await expect(clearSessionStore()).resolves.toBeUndefined()
    expect(secure.map.size).toBe(0)
  })
})
