/**
 * Where the Supabase session lives once it stops being an httpOnly cookie.
 *
 * ## Why this exists
 *
 * The app is becoming a client-rendered bundle inside a native shell, because
 * store presence is a product requirement and background location tracking is
 * on the roadmap — neither of which the web platform can do (CLAUDE.md
 * §Technology Decisions). A native build has no server render, so there is
 * nothing left to set an httpOnly cookie, and `@supabase/ssr` leaves the runtime
 * path with the last server render.
 *
 * **This is a genuine reduction in security and design.md §Risks says so
 * plainly: the refresh token becomes JS-readable.** It is accepted because a
 * native build has no alternative, and it is the reason "no third-party scripts
 * in the authenticated tree" becomes a hard rule rather than a preference. What
 * this module can still decide is *which* JS-readable store, and it takes the
 * strongest one available rather than defaulting to the most convenient.
 *
 * ## The seam
 *
 * The native shell does not exist yet — CLAUDE.md records that a `native` agent
 * is deliberately absent and that Capacitor config, plugins and permission
 * strings land with the shell rather than before it. So this file defines the
 * contract and nothing else: a shell that provides `window.__letsrideSecureStore`
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
  }
}

export type SessionStoreKind = 'secure' | 'local' | 'memory'

/**
 * Resolved once per page load, at client construction, per D2. Re-resolving per
 * call would let a session written to one store be read from another the moment
 * the shell finished booting.
 */
let resolved: { kind: SessionStoreKind; store: SessionStore } | null = null

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
 * Errors are swallowed deliberately. Sign-out must land the rider signed out
 * even when the revocation call fails offline (4.5), so a storage exception must
 * not be the thing that keeps them signed in.
 */
export async function clearSessionStore(): Promise<void> {
  const { kind, store } = resolveSessionStore()

  for (const key of [...written]) {
    try {
      await store.removeItem(key)
    } catch {
      /* see above */
    }
  }
  written.clear()

  if (kind === 'local' && typeof window !== 'undefined') {
    try {
      const stale = Object.keys(window.localStorage).filter((k) =>
        k.startsWith(SUPABASE_KEY_PREFIX)
      )
      for (const key of stale) window.localStorage.removeItem(key)
    } catch {
      /* see above */
    }
  }
}

/** Test seam. Nothing in the app calls this. */
export function resetSessionStoreForTests(): void {
  resolved = null
  written.clear()
}
