import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/lib/query/keys'
import { USERNAME_TAKEN_MESSAGE } from '@/lib/validation/profile'
import { emptyActionState } from '@/lib/actions/state'

/**
 * The write path's contract with the two caches, exercised rather than read.
 *
 * `lib/actions/` is where every mutation lives and, since the render moved
 * into the browser, where the two invalidations live with it: the query cache
 * claim that replaced each `revalidatePath` (`keys.ts`'s header table) and
 * the guard cache's `invalidateOnboardingState()` / `clearGuardCache()`, which
 * CLAUDE.md §Critical names as the one thing a new stamp writer owes. Both
 * fail the same way — silently, with a rider shown stale data or sent back
 * into a step they just finished — and no gate before this file ran an
 * action at all: the data side has thirteen test files, the write side had
 * one, and it covered a pure helper.
 *
 * What is pinned is the ORDER and the CONDITION, not the SQL. A refused write
 * must not invalidate — a cache cleared on a failed RSVP re-fetches and shows
 * the rider the row they did not get. `setUsername` must write the username
 * before the completion RPC and invalidate once, after both: a refused
 * username can never leave a rider stamped complete with no username. The
 * signed-out branch of every action must return before the first write.
 *
 * `resolveSupabase` is mocked the way `data/__tests__/postcards.test.ts`
 * does it — a recording builder that resolves like `postgrest-js` — and the
 * guard cache is mocked rather than reset, because its two invalidators
 * refuse without a `document` and this suite runs under `environment: 'node'`.
 * Everything `signOut` clears beside the two caches is mocked for the same
 * reason: each reaches `localStorage` or the keychain, and none is this
 * file's subject.
 */

const rpc = vi.fn()
const from = vi.fn()
const getUser = vi.fn()
const authSignOut = vi.fn()

/** Every call, in order, across `from`, `rpc` and the guard cache — so a test
 * can assert "username UPDATE, then RPC, then invalidate" rather than three
 * unrelated `toHaveBeenCalled`s that pass in any order. */
const timeline: string[] = []

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({
    rpc: (...args: unknown[]) => {
      timeline.push(`rpc:${String(args[0])}`)
      return rpc(...args)
    },
    from: (...args: unknown[]) => {
      timeline.push(`from:${String(args[0])}`)
      return from(...args)
    },
    auth: { getUser, signOut: authSignOut },
  }),
}))

vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query')>()),
  invalidate: vi.fn((key: unknown) => {
    timeline.push(`invalidate:${JSON.stringify(key)}`)
  }),
  clearQueryCache: vi.fn(() => {
    timeline.push('clearQueryCache')
  }),
}))

vi.mock('@/lib/auth/guard-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/guard-cache')>()),
  invalidateOnboardingState: vi.fn(() => {
    timeline.push('invalidateOnboardingState')
  }),
  clearGuardCache: vi.fn(() => {
    timeline.push('clearGuardCache')
  }),
}))

vi.mock('@/lib/analytics/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics/client')>()),
  capture: vi.fn(),
}))

vi.mock('@/lib/invites/pending-token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/invites/pending-token')>()),
  takeAnyStashedInviteToken: () => null,
  clearAllStashedInviteTokens: vi.fn(),
}))

vi.mock('@/lib/location/rider-location', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/location/rider-location')>()),
  clearRiderLocation: vi.fn(),
}))

vi.mock('@/lib/clubs/introduction-dismissal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clubs/introduction-dismissal')>()),
  clearIntroductionDismissals: vi.fn(),
}))

vi.mock('@/lib/supabase/session-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/session-store')>()),
  clearSessionStore: vi.fn(async () => {}),
}))

// Imported after the mocks are declared — `vi.mock` is hoisted, but keeping
// the order visible is what makes the file readable.
import { setRideAttendance } from '@/lib/actions/rides'
import { acceptTerms, setUsername } from '@/lib/actions/onboarding'
import { signOut } from '@/lib/actions/auth'
import { invalidate, clearQueryCache } from '@/lib/query'
import { clearGuardCache, invalidateOnboardingState } from '@/lib/auth/guard-cache'

const USER = { id: '22222222-2222-4222-8222-222222222222' }
const RIDE_ID = '11111111-1111-4111-8111-111111111111'

type Result = { data: unknown; error: null | { code?: string; message?: string } }

/** A chainable builder that records every method call and resolves to
 * `result` when awaited, wherever in the chain the `await` lands. */
function chain(result: Result) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const builder: Record<string, unknown> = {}
  for (const method of [
    'select', 'insert', 'upsert', 'update', 'delete',
    'eq', 'in', 'order', 'limit', 'maybeSingle', 'single',
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.then = (resolve: (value: Result) => void) => resolve(result)
  return { builder, calls }
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(entries)) data.append(name, value)
  return data
}

beforeEach(() => {
  rpc.mockReset()
  from.mockReset()
  getUser.mockReset()
  authSignOut.mockReset()
  vi.mocked(invalidate).mockClear()
  vi.mocked(clearQueryCache).mockClear()
  vi.mocked(invalidateOnboardingState).mockClear()
  vi.mocked(clearGuardCache).mockClear()
  timeline.length = 0
  getUser.mockResolvedValue({ data: { user: USER } })
})

describe('setRideAttendance', () => {
  it('refuses a signed-out caller before touching the table', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const state = await setRideAttendance(RIDE_ID, 'going')

    expect(state.error).toBe('Sign in to RSVP.')
    expect(from).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('upserts on the (ride, rider) pair for going and maybe, then invalidates rides', async () => {
    const { builder, calls } = chain({ data: null, error: null })
    from.mockReturnValue(builder)

    const state = await setRideAttendance(RIDE_ID, 'maybe')

    expect(state).toEqual({ error: null, sent: true })
    expect(from).toHaveBeenCalledWith('ride_members')
    expect(calls).toEqual([
      {
        method: 'upsert',
        args: [
          { ride_id: RIDE_ID, user_id: USER.id, status: 'maybe' },
          { onConflict: 'ride_id,user_id' },
        ],
      },
    ])
    expect(invalidate).toHaveBeenCalledWith(queryKeys.rides.all())
    expect(timeline).toEqual(['from:ride_members', `invalidate:${JSON.stringify(queryKeys.rides.all())}`])
  })

  it('deletes the rider’s own row for a withdrawal, scoped to both keys', async () => {
    const { builder, calls } = chain({ data: null, error: null })
    from.mockReturnValue(builder)

    await setRideAttendance(RIDE_ID, null)

    expect(calls.map((c) => c.method)).toEqual(['delete', 'eq', 'eq'])
    expect(calls[1].args).toEqual(['ride_id', RIDE_ID])
    expect(calls[2].args).toEqual(['user_id', USER.id])
    expect(invalidate).toHaveBeenCalledWith(queryKeys.rides.all())
  })

  it('does NOT invalidate when the write is refused', async () => {
    // RLS refusing is the ordinary reason — the ride stopped being visible.
    // Invalidating here re-fetches and shows the rider a crew they are not in.
    const { builder } = chain({ data: null, error: { code: '42501' } })
    from.mockReturnValue(builder)

    const state = await setRideAttendance(RIDE_ID, 'going')

    expect(state.error).toMatch(/Could not update your RSVP/)
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('acceptTerms', () => {
  it('records consent through the one RPC and then invalidates the guard cache', async () => {
    rpc.mockResolvedValue({ data: true, error: null })

    const state = await acceptTerms(emptyActionState, form({ acceptedTerms: 'on' }))

    expect(state.error).toBeNull()
    expect(rpc).toHaveBeenCalledWith('accept_terms')
    expect(from).not.toHaveBeenCalled()
    expect(timeline).toEqual(['rpc:accept_terms', 'invalidateOnboardingState'])
  })

  it('refuses an unticked box before the RPC', async () => {
    const state = await acceptTerms(emptyActionState, form({}))

    expect(state.error).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
    expect(invalidateOnboardingState).not.toHaveBeenCalled()
  })

  it('leaves the guard cache alone when the RPC refuses or stamps nothing', async () => {
    rpc.mockResolvedValue({ data: false, error: null })

    const state = await acceptTerms(emptyActionState, form({ acceptedTerms: 'on' }))

    expect(state.error).toBe('Could not record that. Try again.')
    expect(invalidateOnboardingState).not.toHaveBeenCalled()
  })

  it('sends a signed-out caller to login without calling anything', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const state = await acceptTerms(emptyActionState, form({ acceptedTerms: 'on' }))

    expect(state).toEqual({ error: null, redirectTo: '/auth/login' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('setUsername', () => {
  it('writes the username FIRST, stamps completion SECOND, invalidates ONCE after both', async () => {
    const { builder, calls } = chain({ data: { id: USER.id }, error: null })
    from.mockReturnValue(builder)
    rpc.mockResolvedValue({ data: true, error: null })

    const state = await setUsername(emptyActionState, form({ username: 'dawnrider' }))

    expect(state.error).toBeNull()
    expect(from).toHaveBeenCalledWith('profiles')
    expect(calls[0]).toEqual({ method: 'update', args: [{ username: 'dawnrider' }] })
    expect(calls[1]).toEqual({ method: 'eq', args: ['id', USER.id] })
    expect(rpc).toHaveBeenCalledWith('complete_onboarding', { p_location: null })
    expect(timeline).toEqual([
      'from:profiles',
      'rpc:complete_onboarding',
      'invalidateOnboardingState',
    ])
    expect(invalidateOnboardingState).toHaveBeenCalledTimes(1)
  })

  it('returns the taken message with the rejected value on 23505, and stops there', async () => {
    const { builder } = chain({ data: null, error: { code: '23505' } })
    from.mockReturnValue(builder)

    const state = await setUsername(emptyActionState, form({ username: 'dawnrider' }))

    expect(state).toEqual({ error: USERNAME_TAKEN_MESSAGE, taken: 'dawnrider' })
    expect(rpc).not.toHaveBeenCalled()
    expect(invalidateOnboardingState).not.toHaveBeenCalled()
  })

  it('never stamps completion, and never invalidates, when the username UPDATE matched no row', async () => {
    // PostgREST reports no error for a zero-row update; `.select().maybeSingle()`
    // is what makes this branch reachable at all.
    const { builder } = chain({ data: null, error: null })
    from.mockReturnValue(builder)

    const state = await setUsername(emptyActionState, form({ username: 'dawnrider' }))

    expect(state.error).toBe('Your profile could not be found. Sign in again.')
    expect(rpc).not.toHaveBeenCalled()
    expect(invalidateOnboardingState).not.toHaveBeenCalled()
  })

  it('does not invalidate when the completion RPC refuses (consent still missing)', async () => {
    const { builder } = chain({ data: { id: USER.id }, error: null })
    from.mockReturnValue(builder)
    rpc.mockResolvedValue({ data: null, error: { code: '23514' } })

    const state = await setUsername(emptyActionState, form({ username: 'dawnrider' }))

    expect(state.error).toBe('Finish the earlier steps first.')
    expect(invalidateOnboardingState).not.toHaveBeenCalled()
  })

  it('refuses an invalid username before reaching the database', async () => {
    const state = await setUsername(emptyActionState, form({ username: 'no spaces' }))

    expect(state.error).toBeTruthy()
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('signOut', () => {
  it('clears BOTH caches after the session is revoked', async () => {
    authSignOut.mockResolvedValue({ error: null })

    const state = await signOut()

    expect(state).toEqual({ error: null, redirectTo: '/auth/login' })
    expect(authSignOut).toHaveBeenCalledTimes(1)
    expect(clearQueryCache).toHaveBeenCalledTimes(1)
    expect(clearGuardCache).toHaveBeenCalledTimes(1)
  })

  it('falls back to a local sign-out when the global one fails, and still clears both', async () => {
    // Offline, the revocation call cannot reach GoTrue; the rider still has
    // to end up signed out on this device, with nothing cached.
    authSignOut
      .mockResolvedValueOnce({ error: { message: 'fetch failed' } })
      .mockResolvedValueOnce({ error: null })

    await signOut()

    expect(authSignOut).toHaveBeenCalledTimes(2)
    expect(authSignOut).toHaveBeenLastCalledWith({ scope: 'local' })
    expect(clearQueryCache).toHaveBeenCalledTimes(1)
    expect(clearGuardCache).toHaveBeenCalledTimes(1)
  })
})
