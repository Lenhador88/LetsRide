import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDestination } from '@/lib/auth/guard'
import type { GuardSnapshot } from '@/lib/auth/guard-cache'
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

// Task 7.1's destruction primitives — mocked so the "gone" tests below can
// assert the CALLS rather than their real effects, which is what
// `session-store.test.ts` and `queryClient.test.ts` already cover on their
// own. None of these three is otherwise imported by anything under test here.
const clearQueryCache = vi.fn()
const clearSessionStore = vi.fn()
const clearRiderLocation = vi.fn()

vi.mock('@/lib/query', () => ({ clearQueryCache }))
vi.mock('@/lib/supabase/session-store', () => ({ clearSessionStore }))
vi.mock('@/lib/location/rider-location', () => ({ clearRiderLocation }))

const {
  attachGuardAuthListener,
  clearGuardCache,
  ensureGuardState,
  getGuardSnapshot,
  guardStateFrom,
  hasGuardBooted,
  invalidateOnboardingState,
  resetGuardCacheForTests,
  resolveGuardView,
  retryGuardRead,
  subscribeGuardCache,
} = await import('@/lib/auth/guard-cache')

/** The decision's input for a path, read off the current snapshot — what
 * `RouteGuard` does every render. */
const peek = (pathname: string) => guardStateFrom(getGuardSnapshot(), pathname)
const booted = () => hasGuardBooted(getGuardSnapshot())

/** What `RouteGuard` would draw for a path, off the current snapshot — the same
 * two lines the component runs, so a case here is a case about the screen. */
function draws(pathname: string) {
  const snapshot = getGuardSnapshot()
  const state = guardStateFrom(snapshot, pathname)
  return resolveGuardView(
    snapshot,
    state === undefined ? undefined : resolveDestination(pathname, state)
  )
}

/** A snapshot built by hand, for the mapping's own cases. */
const snapshotOf = (over: Partial<GuardSnapshot> = {}): GuardSnapshot => ({
  signedIn: undefined,
  onboarding: undefined,
  unavailable: false,
  gone: false,
  failed: false,
  ...over,
})

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
  clearQueryCache.mockReset()
  clearSessionStore.mockReset()
  clearRiderLocation.mockReset()
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

  it('never triggers the deletion destruction — a network hiccup is not a deleted account', async () => {
    ensureGuardState('/postcards')
    await settle()

    expect(clearQueryCache).not.toHaveBeenCalled()
    expect(clearSessionStore).not.toHaveBeenCalled()
    expect(clearRiderLocation).not.toHaveBeenCalled()
  })
})

describe('a read that threw — PD-122', () => {
  /** The catch logs, deliberately: it is the only trace of *why*. Silenced so a
   * green run does not read as a broken one, and asserted once below. */
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    getSession.mockRejectedValue(new Error('secure storage unavailable'))
  })

  afterEach(() => {
    logged.mockRestore()
  })

  it('draws a retry instead of hanging the splash with nothing to tap', async () => {
    ensureGuardState('/postcards')
    await settle()

    // Still undecided — a rejection before `getSession()` answers leaves no
    // session to route on, so this must NOT become a destination.
    expect(peek('/postcards')).toBeUndefined()
    expect(booted()).toBe(false)
    expect(draws('/postcards')).toEqual({ kind: 'retry', overlay: false })
    expect(logged).toHaveBeenCalledTimes(1)
  })

  it('does not retry itself once per render — the failure notifies, and the notify re-runs the effect', async () => {
    ensureGuardState('/postcards')
    await settle()
    getSession.mockClear()

    // What `RouteGuard`'s effect does after the failure notified. Without the
    // latch this is an unbounded retry loop behind the rider's own retry button.
    ensureGuardState('/postcards')
    ensureGuardState('/postcards')
    await settle()

    expect(getSession).not.toHaveBeenCalled()
  })

  it('re-attempts when the rider asks, and a read that answers clears the screen', async () => {
    ensureGuardState('/postcards')
    await settle()
    getSession.mockReset()
    getSession.mockResolvedValue(session('rider-1'))

    retryGuardRead('/postcards')
    // Back to the splash while it runs — the retry screen is no longer the truth
    // the moment a read is in flight.
    expect(draws('/postcards')).toEqual({ kind: 'splash', overlay: false })

    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'rider', ...ONBOARDED })
    expect(draws('/postcards')).toEqual({ kind: 'children', overlay: false })
  })

  it('offers the retry again when the re-attempt throws too', async () => {
    ensureGuardState('/postcards')
    await settle()

    retryGuardRead('/postcards')
    await settle()

    expect(getSession).toHaveBeenCalledTimes(2)
    expect(draws('/postcards')).toEqual({ kind: 'retry', overlay: false })
  })

  it('replaces the shell even when the throw lands after the session was read', async () => {
    getSession.mockReset()
    getSession.mockResolvedValue(session('rider-1'))
    rpc.mockReturnValue({
      maybeSingle: async () => {
        throw new Error('network')
      },
    })

    ensureGuardState('/postcards')
    await settle()

    expect(booted()).toBe(true)
    expect(peek('/postcards')).toBeUndefined()
    // Warm, so the splash would have overlaid here. The retry must not: it
    // holds the one control the rider is meant to press, and a shell left
    // mounted under it keeps its own controls in the tab order.
    expect(draws('/postcards')).toEqual({ kind: 'retry', overlay: false })
  })

  it('is released by reaching a path the cache can already answer', async () => {
    getSession.mockReset()
    getSession.mockResolvedValue(session('rider-1'))
    rpc.mockReturnValue({
      maybeSingle: async () => {
        throw new Error('network')
      },
    })

    ensureGuardState('/postcards')
    await settle()

    // A legal page needs no stamps, so the cache answers it without a read —
    // and `attemptedPath` does not move on that return. Without the release,
    // coming back re-draws the retry off a stale flag and the latch then
    // refuses to attempt anything.
    ensureGuardState('/legal/terms')
    rpc.mockReset()
    rpc.mockReturnValue(stamps(ONBOARDED))

    expect(draws('/postcards')).toEqual({ kind: 'splash', overlay: true })
    ensureGuardState('/postcards')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'rider', ...ONBOARDED })
  })

  it('still decides a path that never needed the stamps — a failure is not a blanket stop', async () => {
    getSession.mockReset()
    getSession.mockResolvedValue(session('rider-1'))
    rpc.mockReturnValue({
      maybeSingle: async () => {
        throw new Error('network')
      },
    })

    ensureGuardState('/postcards')
    await settle()

    expect(peek('/legal/terms')).toEqual({ kind: 'session' })
    expect(draws('/legal/terms')).toEqual({ kind: 'children', overlay: false })
  })

  it('is released by a new session, like the other failed-read latch', async () => {
    attachGuardAuthListener()
    ensureGuardState('/postcards')
    await settle()
    getSession.mockReset()
    getSession.mockResolvedValue(session('rider-1'))

    emitAuth('SIGNED_IN', { id: 'rider-1' })
    ensureGuardState('/postcards')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'rider', ...ONBOARDED })
  })

  it('refuses to re-attempt during a server render, like every other writer', async () => {
    ensureGuardState('/postcards')
    await settle()
    const before = getGuardSnapshot()
    getSession.mockClear()

    delete globals.document
    retryGuardRead('/postcards')

    expect(getGuardSnapshot()).toBe(before)
    expect(getSession).not.toHaveBeenCalled()
  })
})

describe('what the guard draws', () => {
  it('shows the splash alone while leaving, however much it knows', () => {
    // Never the children — that is the flash the guard exists to prevent — and
    // never the overlay either: the screen underneath is the one being left.
    expect(resolveGuardView(snapshotOf({ signedIn: true }), '/auth/login')).toEqual({
      kind: 'splash',
      overlay: false,
    })
  })

  it('shows the children once the decision is to stay', () => {
    expect(resolveGuardView(snapshotOf({ signedIn: true }), null)).toEqual({
      kind: 'children',
      overlay: false,
    })
  })

  it('replaces the page before boot and overlays it after — the PD-111 split', () => {
    expect(resolveGuardView(snapshotOf(), undefined)).toEqual({ kind: 'splash', overlay: false })
    expect(resolveGuardView(snapshotOf({ signedIn: true }), undefined)).toEqual({
      kind: 'splash',
      overlay: true,
    })
  })

  it('never overlays the retry, warm or cold — it holds a control and the shell would stay focusable', () => {
    expect(resolveGuardView(snapshotOf({ failed: true }), undefined)).toEqual({
      kind: 'retry',
      overlay: false,
    })
    expect(resolveGuardView(snapshotOf({ signedIn: true, failed: true }), undefined)).toEqual({
      kind: 'retry',
      overlay: false,
    })
  })

  it('never draws the retry over a decision — a failure that left enough to route on routes', () => {
    // The stamps threw on a path that did not need them, so the guard can still
    // answer. Stopping the rider here would be the failure spreading past what
    // it actually broke.
    expect(resolveGuardView(snapshotOf({ signedIn: true, failed: true }), null)).toEqual({
      kind: 'children',
      overlay: false,
    })
    expect(resolveGuardView(snapshotOf({ signedIn: true, failed: true }), '/postcards')).toEqual({
      kind: 'splash',
      overlay: false,
    })
  })
})

describe('an account that no longer exists — task 7.1 (PD-102)', () => {
  beforeEach(() => {
    // .maybeSingle()'s own shape for zero rows: data null, error null — the
    // one case `onboardingStateFrom` maps to `gone` rather than `unavailable`.
    rpc.mockReturnValue(stamps(null, null))
  })

  it('is a distinct decided state, not folded into unavailable', async () => {
    ensureGuardState('/postcards')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'gone' })
  })

  it('destroys the query cache, the session store and the cached location', async () => {
    ensureGuardState('/postcards')
    await settle()

    expect(clearQueryCache).toHaveBeenCalledTimes(1)
    expect(clearSessionStore).toHaveBeenCalledTimes(1)
    expect(clearRiderLocation).toHaveBeenCalledTimes(1)
  })

  it('does this without a successful round trip — the destruction is local', async () => {
    // getSession and the RPC both already answered by the time this branch
    // runs; nothing else in this path is a network call, so there is nothing
    // here that an offline device could fail to complete.
    getSession.mockResolvedValue(session('rider-1'))

    ensureGuardState('/postcards')
    await settle()

    expect(clearSessionStore).toHaveBeenCalledTimes(1)
  })

  it('does not retry — a decided `gone` answer is not re-attempted on the next navigation', async () => {
    ensureGuardState('/postcards')
    await settle()
    rpc.mockClear()
    clearQueryCache.mockClear()

    ensureGuardState('/rides')
    await settle()

    expect(rpc).not.toHaveBeenCalled()
    expect(clearQueryCache).not.toHaveBeenCalled()
    expect(peek('/rides')).toEqual({ kind: 'gone' })
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

  it('a new session clears a failed read, so signing in again can recover', async () => {
    rpc.mockReturnValue(stamps(null, { code: 'PGRST202' }))
    ensureGuardState('/postcards')
    await settle()
    expect(peek('/postcards')).toEqual({ kind: 'unavailable' })

    // The rider is parked on the one path `resolveDestination` answers `null`
    // for in this state, so no navigation is available to trigger the retry —
    // the latch has to be released by the event, or signing in fixes nothing.
    ensureGuardState('/auth/login')
    await settle()
    rpc.mockReset()
    rpc.mockReturnValue(stamps(ONBOARDED))

    emitAuth('SIGNED_IN', { id: 'rider-1' })
    ensureGuardState('/auth/login')
    await settle()

    expect(peek('/postcards')).toEqual({ kind: 'rider', ...ONBOARDED })
  })

  it('makes no Supabase call of its own — the emitter awaits this callback', () => {
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

  it('refuses every other write too, so the property holds by construction', async () => {
    ensureGuardState('/postcards')
    await settle()
    const before = getGuardSnapshot()

    delete globals.document

    // Both are reachable only from a submit handler today. The point is that
    // the safety property stops depending on that staying true.
    invalidateOnboardingState()
    clearGuardCache()

    expect(getGuardSnapshot()).toBe(before)
  })

  it('subscribing is a no-op without a document, rather than a half-installed writer', () => {
    delete globals.document

    attachGuardAuthListener()

    expect(onAuthStateChange).not.toHaveBeenCalled()
  })
})
