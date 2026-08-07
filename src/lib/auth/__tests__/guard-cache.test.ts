import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingState } from '@/types'

/**
 * The route guard's held state — PD-111.
 *
 * `guard.test.ts` covers the decision, which did not change: `resolveDestination`
 * is the same pure function it was, and none of its 36 cases moved. What is new
 * is that the decision's *inputs* now survive a navigation, and every case below
 * is about that surviving correctly rather than about what is decided from it.
 *
 * Two properties carry the whole fix, and they pull in opposite directions:
 *
 *   1. **A second navigation must not re-fetch.** That is the bug — one
 *      `my_onboarding_state()` round trip per tab tap, with the full-screen
 *      splash over it.
 *   2. **A stamp that has changed underneath must not be answered from cache.**
 *      Sign-out, a different rider, and each of the three onboarding writes all
 *      move something the decision reads. Cache them wrongly and the rider is
 *      stuck on a screen they have left — or waved through one they have not
 *      reached.
 *
 * The suite runs in `node`, so `document` is faked: `ensureGuardState` refuses
 * to run without one, which is what keeps the module's state out of the SSR pass
 * where it would be shared between riders.
 */

const getSession = vi.fn()
const rpc = vi.fn()
const onAuthStateChange = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession, onAuthStateChange },
    rpc,
  }),
}))

const {
  attachGuardAuthListener,
  clearGuardCache,
  ensureGuardState,
  getGuardSnapshot,
  guardStateFrom,
  hasGuardBooted,
  invalidateOnboardingState,
  resetGuardCacheForTests,
  subscribeGuardCache,
} = await import('@/lib/auth/guard-cache')

/** The decision's input for a path, read off the current snapshot — what
 * `RouteGuard` does every render. */
const peek = (pathname: string) => guardStateFrom(getGuardSnapshot(), pathname)
const booted = () => hasGuardBooted(getGuardSnapshot())

const globals = globalThis as { document?: unknown }

const ONBOARDED: OnboardingState = {
  terms_accepted_at: '2026-08-05T00:00:00Z',
  onboarding_completed_at: '2026-08-05T00:00:00Z',
  has_username: true,
}

/** Only the fields the cache reads. */
function session(userId: string) {
  return { data: { session: { user: { id: userId } } } }
}

function stamps(data: OnboardingState | null, error: unknown = null) {
  return { maybeSingle: async () => ({ data, error }) }
}

/** Everything in here resolves in microtasks — the fakes never touch a timer —
 * so awaiting the queue twice is enough to settle `getSession` then the RPC. */
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** The callback `attachGuardAuthListener` registered, so a test can fire the
 * events supabase-js would. */
function emitAuth(event: string, user: { id: string } | null) {
  const callback = onAuthStateChange.mock.calls.at(-1)?.[0] as (
    event: string,
    session: unknown
  ) => void
  callback(event, user ? { user } : null)
}

beforeEach(() => {
  globals.document = {}
  getSession.mockReset()
  rpc.mockReset()
  onAuthStateChange.mockReset()
  getSession.mockResolvedValue(session('rider-1'))
  rpc.mockReturnValue(stamps(ONBOARDED))
  resetGuardCacheForTests()
})

afterEach(() => {
  delete globals.document
})

describe('before anything has been read', () => {
  it('cannot answer, and says so as undefined rather than as anonymous', () => {
    expect(peek('/postcards')).toBeUndefined()
    expect(booted()).toBe(false)
  })
})

describe('the first read', () => {
  it('fetches the session and the stamps, and answers rider', async () => {
    ensureGuardState('/postcards')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'rider', ...ONBOARDED })
    expect(booted()).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('my_onboarding_state')
  })

  it('skips the round trip on a path that does not need the stamps', async () => {
    ensureGuardState('/legal/terms')
    await settle()

    expect(peek('/legal/terms')).toEqual({ kind: 'session' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('answers anonymous without an RPC when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })

    ensureGuardState('/postcards')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'anonymous' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('issues one read when two callers arrive in the same tick', async () => {
    ensureGuardState('/postcards')
    ensureGuardState('/postcards')
    ensureGuardState('/rides')
    await settle()

    expect(getSession).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('the second navigation — the bug this exists to fix', () => {
  it('answers from cache with no further round trip', async () => {
    ensureGuardState('/postcards')
    await settle()
    rpc.mockClear()
    getSession.mockClear()

    // Every non-public path used to re-fetch. All three of these must be free.
    for (const path of ['/rides', '/clubs/abc', '/profile']) {
      expect(peek(path)).toEqual({ kind: 'rider', ...ONBOARDED })
      ensureGuardState(path)
    }
    await settle()

    expect(rpc).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })

  it('reuses a session read taken on a path that skipped the stamps', async () => {
    ensureGuardState('/legal/terms')
    await settle()
    getSession.mockClear()

    // The session is known, the stamps are not — so this fetches the stamps and
    // must not re-read the session.
    expect(peek('/postcards')).toBeUndefined()
    ensureGuardState('/postcards')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'rider', ...ONBOARDED })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('a read that did not answer', () => {
  beforeEach(() => {
    rpc.mockReturnValue(stamps(null, { code: 'PGRST202' }))
  })

  it('decides synchronously and fails closed rather than hanging on the splash', async () => {
    ensureGuardState('/postcards')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'unavailable' })
  })

  it('is never treated as fresh — the next navigation retries it', async () => {
    ensureGuardState('/postcards')
    await settle()
    rpc.mockClear()
    rpc.mockReturnValue(stamps(ONBOARDED))

    ensureGuardState('/rides')
    await settle()

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(peek('/rides')).toEqual({ kind: 'rider', ...ONBOARDED })
  })

  it('does not retry on the same path, so a notify cannot become a render loop', async () => {
    ensureGuardState('/postcards')
    await settle()
    rpc.mockClear()

    // The guard's effect re-runs on every cache change, so this is what it does
    // after the failure notified.
    ensureGuardState('/postcards')
    ensureGuardState('/postcards')
    await settle()

    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('the onboarding writes', () => {
  it('invalidating the stamps forces exactly one re-read', async () => {
    ensureGuardState('/onboarding/username')
    await settle()
    rpc.mockClear()

    invalidateOnboardingState()
    expect(peek('/onboarding/location')).toBeUndefined()

    ensureGuardState('/onboarding/location')
    ensureGuardState('/onboarding/location')
    await settle()

    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('keeps the session — it is the stamps that moved, not who is signed in', async () => {
    ensureGuardState('/postcards')
    await settle()

    invalidateOnboardingState()

    expect(booted()).toBe(true)
    expect(peek('/legal/terms')).toEqual({ kind: 'session' })
  })
})

describe('the auth listener', () => {
  beforeEach(() => {
    attachGuardAuthListener()
  })

  it('subscribes once however often it is called', () => {
    attachGuardAuthListener()
    attachGuardAuthListener()
    expect(onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('signing out drops the rider, so no cached stamp waves them through', async () => {
    ensureGuardState('/postcards')
    await settle()

    emitAuth('SIGNED_OUT', null)

    expect(peek('/postcards')).toEqual({ kind: 'anonymous' })
  })

  it('a different rider signing in drops the previous one’s stamps', async () => {
    ensureGuardState('/postcards')
    await settle()

    emitAuth('SIGNED_IN', { id: 'rider-2' })

    // Not rider-1's stamps, and not a decision at all until they are re-read.
    expect(peek('/postcards')).toBeUndefined()
  })

  it('a token refresh for the same rider keeps them, so it costs no round trip', async () => {
    ensureGuardState('/postcards')
    await settle()
    rpc.mockClear()

    emitAuth('TOKEN_REFRESHED', { id: 'rider-1' })
    ensureGuardState('/postcards')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'rider', ...ONBOARDED })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('makes no Supabase call of its own — the auth lock is held while it runs', () => {
    getSession.mockClear()
    rpc.mockClear()

    emitAuth('SIGNED_IN', { id: 'rider-1' })

    expect(getSession).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('clearing', () => {
  it('takes the cache back to knowing nothing, not to knowing anonymous', async () => {
    ensureGuardState('/postcards')
    await settle()

    clearGuardCache()

    expect(booted()).toBe(false)
    expect(peek('/postcards')).toBeUndefined()
    expect(peek('/legal/terms')).toBeUndefined()
  })
})

describe('subscribers', () => {
  it('are notified, and the snapshot is a new object when something changed', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeGuardCache(listener)
    const before = getGuardSnapshot()

    ensureGuardState('/postcards')
    await settle()

    expect(listener).toHaveBeenCalled()
    expect(getGuardSnapshot()).not.toBe(before)

    unsubscribe()
    listener.mockClear()
    invalidateOnboardingState()
    expect(listener).not.toHaveBeenCalled()
  })

  it('hands back the same object across calls that observe no change', async () => {
    ensureGuardState('/postcards')
    await settle()

    // `useSyncExternalStore` loops if `getSnapshot` allocates every call, so
    // this is a correctness property rather than an optimisation.
    expect(getGuardSnapshot()).toBe(getGuardSnapshot())
  })
})

describe('the server pass', () => {
  it('refuses to read, which is what keeps one rider’s state out of another’s render', () => {
    delete globals.document

    expect(() => ensureGuardState('/postcards')).toThrow(/server render/)
    expect(getSession).not.toHaveBeenCalled()
  })
})
