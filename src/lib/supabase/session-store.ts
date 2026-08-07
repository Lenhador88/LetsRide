/**
 * Where the Supabase session lives once it stops being an httpOnly cookie.
 *
 * ## Why this exists
 *
 * The app **is** a client-rendered bundle (done 2026-08-06), headed for a native
 * shell, because store presence is a product requirement and background location
 * tracking is on the roadmap — neither of which the web platform can do
 * (CLAUDE.md §Technology Decisions). There is no server render left to set an
 * httpOnly cookie, and `@supabase/ssr` is uninstalled.
 *
 * **The refresh token is JS-readable — but it always was, and design.md §Risks
 * was wrong to present that as a reduction this change causes.** `@supabase/ssr`
 * set `sb-<ref>-auth-token` with `httpOnly=false`, because the browser client
 * had to read the session back out of `document.cookie`; measured with a real
 * sign-in. What moved is the *store*, not the exposure. It is still the reason
 * "no third-party scripts in the authenticated tree" is a hard rule rather than
 * a preference. What this module decides is *which* JS-readable store, and it
 * takes the strongest one available rather than the most convenient.
 *
 * ## The seam
 *
 * The native shell does not exist yet, so this file defines the contract and
 * nothing else. (It used to add that a `native` agent was deliberately absent;
 * that agent landed 2026-08-06 with the migration's completion, and `native.md`
 * points at this module's test as the contract to implement against. The shell
 * itself is still unbuilt — that part is unchanged.) A shell that provides
 * `window.__letsrideSecureStore`
 * gets used, and a plain browser falls back with the weaker store *named* rather
 * than assumed (Q8: the browser build is a development and testing surface, with
 * the weaker token storage stated).
 *
 * Writing the seam now rather than with the shell is deliberate. The alternative
 * is that the shell arrives and has to reach into `createClient` to change how
 * sessions are stored, which is the one place a mistake is unrecoverable.
 */

/**
 * The shape `@supabase/supabase-js` accepts for its `storage` option. Declared
 * here rather than imported so this module stays dependency-free and testable —
 * the library's own `SupportedStorage` is structurally this.
 */
export type SessionStore = {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
  /**
   * Every key the store currently holds, when it can say.
   *
   * **Optional in the type, load-bearing in practice.** `clearSessionStore`
   * cannot prove it cleared a session written before a reload unless the store
   * can be enumerated — the tracked-key set is per-page-load and the store is
   * not. `localStorage` is enumerable through `Object.keys`, which is why the
   * browser fallback was chosen over something opaque; a secure store has to
   * offer the same thing explicitly or sign-out silently leaves the keychain
   * entry behind. A store that omits this still clears what this page load
   * wrote, which is strictly weaker and is why the sweep is not optional
   * anywhere it can be had.
   */
  keys?(): string[] | Promise<string[]>
}

declare global {
  interface Window {
    /**
     * Implemented by the native shell over the platform keychain / keystore.
     * Absent in a browser, and absent during the SSR pass.
     */
    __letsrideSecureStore?: SessionStore
  }
}

/**
 * Every key this module has handed to Supabase, so sign-out can destroy the
 * session without knowing how Supabase names its keys.
 *
 * Tracked rather than derived because the library's key format
 * (`sb-<ref>-auth-token`, plus code-verifier keys during PKCE) is an internal
 * detail that has changed before. A prefix sweep runs *as well*, since a session
 * written before a page reload is not in this set — the set is per-page-load and
 * the store is not.
 */
const written = new Set<string>()

const SUPABASE_KEY_PREFIX = 'sb-'

/** Survives the SSR pass, where there is neither a secure store nor a window. */
function createMemoryStore(): SessionStore {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  }
}

function track(store: SessionStore): SessionStore {
  return {
    getItem: (key) => store.getItem(key),
    setItem: (key, value) => {
      written.add(key)
      return store.setItem(key, value)
    },
    removeItem: (key) => {
      written.delete(key)
      return store.removeItem(key)
    },
    // Forwarded rather than dropped, and conditionally so the wrapper does not
    // advertise an enumerability the wrapped store does not have — `clearSessionStore`
    // branches on the method's presence.
    //
    // `typeof … === 'function'` rather than a truthiness test, because `Storage`
    // has a named-property getter: a rider whose `localStorage` happens to hold
    // an item keyed `keys` makes `localStorage.keys` a *string*, which is truthy.
    // Forwarding that would hand `clearSessionStore` a non-callable `keys` and
    // silently disable the sweep for the one store that most needs it.
    ...(typeof store.keys === 'function' ? { keys: () => store.keys!() } : {}),
  }
}

export type SessionStoreKind = 'secure' | 'local' | 'memory'

/**
 * Resolved once per page load, at client construction, per D2. Re-resolving per
 * call would let a session written to one store be read from another the moment
 * the shell finished booting.
 */
let resolved: { kind: SessionStoreKind; store: SessionStore } | null = null

/**
 * **Whoever calls this first decides the store for the whole page load.**
 *
 * That is the invariant, and it lives here rather than at the call site that
 * happens to satisfy it today. `createClient()` installs the native secure store
 * immediately before calling this, which is currently the only path that reaches
 * it first — `clearSessionStore()` is the only other resolver-toucher, and
 * `signOut` awaits a Supabase client before it. But nothing in the type system
 * enforces that ordering, and `describeSessionStore()` below is exported for
 * rendering on a screen and has zero callers: the day a screen calls it during
 * boot, a native device silently pins `local` and every token lands in the
 * webview's `localStorage` instead of the keychain, with no error anywhere.
 *
 * So: if you add a caller that can run before the first `createClient()`, call
 * `installSecureStore()` from `@/lib/native/secure-store` before it, or move the
 * install in front of this function.
 */
export function resolveSessionStore(): { kind: SessionStoreKind; store: SessionStore } {
  if (resolved) return resolved

  if (typeof window !== 'undefined' && window.__letsrideSecureStore) {
    resolved = { kind: 'secure', store: track(window.__letsrideSecureStore) }
    return resolved
  }

  // `localStorage` can exist and still throw on access — Safari's private mode
  // has historically done exactly that, and a webview with storage disabled
  // does too. A throw here would take down client construction, which is the
  // first thing every screen depends on, so it degrades to memory instead: the
  // rider signs in, uses the app, and is signed out again by a reload. That is
  // a bad session, not a broken app.
  if (typeof window !== 'undefined') {
    try {
      const probe = '__letsride_probe__'
      window.localStorage.setItem(probe, '1')
      window.localStorage.removeItem(probe)
      resolved = { kind: 'local', store: track(window.localStorage) }
      return resolved
    } catch {
      // fall through
    }
  }

  resolved = { kind: 'memory', store: createMemoryStore() }
  return resolved
}

/**
 * What the current store is, in a sentence, for the places that have to state it
 * rather than assume it (Q8). Not decoration: "the browser build stores tokens
 * where JS can read them" is a claim the product owner accepted explicitly, and
 * a build that quietly downgraded from `secure` to `local` would otherwise be
 * indistinguishable from one that did not.
 */
export function describeSessionStore(): string {
  switch (resolveSessionStore().kind) {
    case 'secure':
      return 'Session held in the device secure store.'
    case 'local':
      return 'Session held in browser local storage, which any script on this origin can read.'
    case 'memory':
      return 'Session held in memory only, and lost on reload.'
  }
}

/**
 * Destroys every trace of the session this store holds (task 4.5).
 *
 * Two passes, and both are needed. The tracked set covers keys written during
 * *this* page load, including any the library names in a way a prefix would
 * miss. The prefix sweep covers a session written before a reload, which the set
 * cannot know about — and it is why the fallback store is `localStorage` rather
 * than something unenumerable: a store you cannot enumerate is a store you
 * cannot prove you cleared.
 *
 * **The sweep is not `localStorage`-only, and reading it that way was a real
 * hole.** It was written when the secure store was a seam with no implementation,
 * so `kind === 'local'` was the only branch that could sweep anything and the
 * restriction cost nothing. The moment a shell provides a keychain, that same
 * code signs a rider out of a *tracked* session and leaves yesterday's — the
 * exact case the paragraph above says the sweep exists for, in the store where
 * a leftover credential matters most. Any store that can enumerate itself is
 * now swept; `localStorage` is enumerated through `Object.keys` because it has
 * no `keys()` of its own.
 *
 * Errors are swallowed deliberately. Sign-out must land the rider signed out
 * even when the revocation call fails offline (4.5), so a storage exception must
 * not be the thing that keeps them signed in.
 */
export async function clearSessionStore(): Promise<void> {
  const { store } = resolveSessionStore()

  for (const key of [...written]) {
    try {
      await store.removeItem(key)
    } catch {
      /* see above */
    }
  }
  written.clear()

  for (const key of await enumerateKeys(store)) {
    if (!key.startsWith(SUPABASE_KEY_PREFIX)) continue
    try {
      await store.removeItem(key)
    } catch {
      /* see above */
    }
  }

  // `localStorage` is swept whatever the resolved store is, not only when it
  // *is* the resolved store. On a device the secure store wins, and every
  // session written by an earlier build — a browser visit, or any build before
  // the shell shipped — is sitting in the webview's `localStorage` where the
  // resolved-store sweep above will never look. Sign-out has to reach it, and
  // this is a `sb-`-prefixed sweep of a store the rider already has, not a new
  // dependency on one.
  if (typeof window !== 'undefined') {
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(SUPABASE_KEY_PREFIX)) window.localStorage.removeItem(key)
      }
    } catch {
      /* see above */
    }
  }
}

/**
 * Every key the store holds, or an empty list when it cannot say. Never throws —
 * an unenumerable store degrades to "tracked keys only", which is the behaviour
 * every store had before this existed.
 */
async function enumerateKeys(store: SessionStore): Promise<string[]> {
  if (typeof store.keys !== 'function') return []

  try {
    return await store.keys()
  } catch {
    return []
  }
}

/** Test seam. Nothing in the app calls this. */
export function resetSessionStoreForTests(): void {
  resolved = null
  written.clear()
}
