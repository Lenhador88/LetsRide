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

// PD-431. Mocked rather than exercised because the real one reaches the
// Capacitor bridge; what this file pins is that `signOut` CALLS it and where in
// the order, which is the half that can regress silently.
vi.mock('@/lib/push/registration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push/registration')>()),
  releaseCurrentDevice: vi.fn(async () => {
    timeline.push('releaseCurrentDevice')
  }),
}))

// Imported after the mocks are declared — `vi.mock` is hoisted, but keeping
// the order visible is what makes the file readable.
import { setRideAttendance } from '@/lib/actions/rides'
import { leaveClub } from '@/lib/actions/clubs'
import { acceptTerms, setHomeCountry, setUsername } from '@/lib/actions/onboarding'
import { signOut } from '@/lib/actions/auth'
import { releaseCurrentDevice } from '@/lib/push/registration'
import { invalidate, clearQueryCache } from '@/lib/query'
import { clearGuardCache, invalidateOnboardingState } from '@/lib/auth/guard-cache'

const USER = { id: '22222222-2222-4222-8222-222222222222' }
const RIDE_ID = '11111111-1111-4111-8111-111111111111'
const CLUB_ID = '33333333-3333-4333-8333-333333333333'

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
  vi.mocked(releaseCurrentDevice).mockClear()
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

  /**
   * `103`'s organizer guard, read through its MESSAGE rather than its SQLSTATE.
   *
   * Both halves are load-bearing and each pins a way this silently degrades:
   *
   * 1. A refusal carrying the guard's phrase must produce the organizer copy.
   *    ** This test does NOT compare itself to the migration ** — it hardcodes
   *    the message, so rewording `103`'s raise would leave it green. The gate
   *    that actually pins the two together is `rls_test.sql` 103.4, which
   *    asserts the raised text `like '%cannot leave its crew%'`. What this
   *    test pins is the other half: that the client still recognises the
   *    phrase. Both are needed and neither substitutes for the other.
   * 2. A `23514` that is NOT the guard — `018`'s text bounds raise the same
   *    code — must fall through to the generic message. A code-only branch
   *    would tell a rider who overran a field that they organize the ride.
   *
   * The third case is the one that already bit: a refusal with no `message` at
   * all must not throw. `error?.message?.includes` rather than
   * `error?.message.includes`, caught by the test above this one.
   */
  it('names the organizer refusal from the guard’s message, not from its SQLSTATE', async () => {
    const { builder } = chain({
      data: null,
      error: {
        code: '23514',
        // Verbatim from `103_creator_membership.sql`'s raise.
        message:
          "a ride's organizer cannot leave its crew; set your status to 'maybe' instead, or delete the ride",
      },
    })
    from.mockReturnValue(builder)

    const state = await setRideAttendance(RIDE_ID, null)

    expect(state.error).toMatch(/You organize this ride/)
    // The copy must NOT forward the migration's "set your status to maybe"
    // suggestion: `withOrganizer` renders the organizer as Going whatever the
    // row says, so offering it would promise something no screen delivers.
    expect(state.error).not.toMatch(/[Mm]aybe/)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('falls through to the generic message for a 23514 that is not the guard', async () => {
    const { builder } = chain({
      data: null,
      error: { code: '23514', message: 'new row violates check constraint "rides_title_length"' },
    })
    from.mockReturnValue(builder)

    const state = await setRideAttendance(RIDE_ID, null)

    expect(state.error).toMatch(/Could not update your RSVP/)
    expect(state.error).not.toMatch(/You organize this ride/)
  })
})

describe('leaveClub', () => {
  /**
   * The club-side twin of the organizer branch above, and it existed with a
   * gate on NEITHER side until a review caught the asymmetry: `095` shipped
   * the guard, PD-103 wired `leaveClub` to its message, and nothing compared
   * them. `rls_test.sql` 095.5 now pins the SQL half; this pins the client's.
   *
   * The owner path normally goes through `leaveOwnedClub` (`095`'s transfer),
   * so this branch is defence for a direct call — which is exactly why no
   * screen would ever reveal it broken.
   */
  it('names the ownership refusal from the guard\u2019s message, not from its SQLSTATE', async () => {
    const { builder } = chain({
      data: null,
      // Verbatim from `095_an_owner_leaves_their_club.sql`'s raise.
      error: {
        code: '23514',
        message:
          "a club's owner cannot leave its roster; hand the club on with public.leave_owned_club, or delete it with public.delete_owned_club",
      },
    })
    from.mockReturnValue(builder)

    const state = await leaveClub(CLUB_ID)

    expect(state.error).toMatch(/You own this club/)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('falls through to the generic message for a 23514 that is not the guard', async () => {
    const { builder } = chain({
      data: null,
      error: { code: '23514', message: 'new row violates check constraint "clubs_name_length"' },
    })
    from.mockReturnValue(builder)

    const state = await leaveClub(CLUB_ID)

    expect(state.error).toMatch(/could not be removed/)
    expect(state.error).not.toMatch(/You own this club/)
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
  it('writes the username, invalidates, and does NOT stamp completion', async () => {
    // PD-428 moved the completion stamp to `setHomeCountry`. Leaving the RPC
    // here would be refused for every new rider once `114` applies — it
    // refuses to stamp while `home_country` is NULL — so the username step
    // would fail with a message about a country nobody has asked for yet.
    //
    // The invalidation stays and is asserted on its own, because its reason
    // changed rather than went away: it now publishes `has_username`, which is
    // what the guard's resume branch reads to pick between the two steps.
    const { builder, calls } = chain({ data: { id: USER.id }, error: null })
    from.mockReturnValue(builder)

    const state = await setUsername(emptyActionState, form({ username: 'dawnrider' }))

    expect(state).toEqual({ error: null, redirectTo: '/onboarding/country' })
    expect(from).toHaveBeenCalledWith('profiles')
    expect(calls[0]).toEqual({ method: 'update', args: [{ username: 'dawnrider' }] })
    expect(calls[1]).toEqual({ method: 'eq', args: ['id', USER.id] })
    expect(rpc).not.toHaveBeenCalled()
    expect(timeline).toEqual(['from:profiles', 'invalidateOnboardingState'])
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

  it('hands the rider to the country step rather than to /postcards', async () => {
    // The wizard's exit moved with the stamp. A redirect straight to
    // `/postcards` would be undone by the guard — `onboarding_completed_at` is
    // still NULL at this point — so the rider would see the home screen flash
    // and then land back in the wizard.
    const { builder } = chain({ data: { id: USER.id }, error: null })
    from.mockReturnValue(builder)

    const state = await setUsername(emptyActionState, form({ username: 'dawnrider' }))

    expect(state.redirectTo).toBe('/onboarding/country')
  })

  it('refuses an invalid username before reaching the database', async () => {
    const state = await setUsername(emptyActionState, form({ username: 'no spaces' }))

    expect(state.error).toBeTruthy()
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('setHomeCountry', () => {
  // The wizard's terminal writer since PD-428, and it inherited the ordering
  // contract `setUsername` used to carry: the column write FIRST, the
  // completion RPC SECOND, one invalidation after both. `114` refuses to stamp
  // while `home_country` is NULL, so the reverse order is refused every time.

  it('writes the country FIRST, stamps completion SECOND, invalidates ONCE after both', async () => {
    const { builder, calls } = chain({ data: { id: USER.id }, error: null })
    from.mockReturnValue(builder)
    rpc.mockResolvedValue({ data: true, error: null })

    const state = await setHomeCountry(emptyActionState, form({ country: 'NL' }))

    expect(state).toEqual({ error: null, redirectTo: '/postcards' })
    expect(from).toHaveBeenCalledWith('profiles')
    expect(calls[0]).toEqual({ method: 'update', args: [{ home_country: 'NL' }] })
    expect(calls[1]).toEqual({ method: 'eq', args: ['id', USER.id] })
    expect(rpc).toHaveBeenCalledWith('complete_onboarding', { p_location: null })
    expect(timeline).toEqual([
      'from:profiles',
      'rpc:complete_onboarding',
      'invalidateOnboardingState',
    ])
    expect(invalidateOnboardingState).toHaveBeenCalledTimes(1)
  })

  it('normalises the code rather than refusing it on case', async () => {
    // `countryCodeSchema` uppercases, because the column stores `NL` and
    // nothing else. A rider whose client sends `nl` gets their country.
    const { builder, calls } = chain({ data: { id: USER.id }, error: null })
    from.mockReturnValue(builder)
    rpc.mockResolvedValue({ data: true, error: null })

    await setHomeCountry(emptyActionState, form({ country: ' nl ' }))

    expect(calls[0]).toEqual({ method: 'update', args: [{ home_country: 'NL' }] })
  })

  it('refuses an unassigned code before reaching the database', async () => {
    // `ZZ` matches the shape and is not a country. Zod owns this message;
    // `113`'s membership CHECK owns the guarantee.
    const state = await setHomeCountry(emptyActionState, form({ country: 'ZZ' }))

    expect(state.error).toBeTruthy()
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(invalidateOnboardingState).not.toHaveBeenCalled()
  })

  it('refuses an empty submission before reaching the database', async () => {
    const state = await setHomeCountry(emptyActionState, form({ country: '' }))

    expect(state.error).toBeTruthy()
    expect(from).not.toHaveBeenCalled()
  })

  it('never stamps completion, and never invalidates, when the UPDATE matched no row', async () => {
    // PostgREST reports no error for a zero-row update; `.select().maybeSingle()`
    // is what makes it distinguishable. Stamping completion for a rider whose
    // row does not exist is the trap `setUsername` documents.
    const { builder } = chain({ data: null, error: null })
    from.mockReturnValue(builder)

    const state = await setHomeCountry(emptyActionState, form({ country: 'NL' }))

    expect(state.error).toBe('Your profile could not be found. Sign in again.')
    expect(rpc).not.toHaveBeenCalled()
    expect(invalidateOnboardingState).not.toHaveBeenCalled()
  })

  it('does not invalidate when the completion RPC refuses (an earlier step is missing)', async () => {
    const { builder } = chain({ data: { id: USER.id }, error: null })
    from.mockReturnValue(builder)
    rpc.mockResolvedValue({ data: null, error: { code: '23514' } })

    const state = await setHomeCountry(emptyActionState, form({ country: 'NL' }))

    expect(state.error).toBe('Finish the earlier steps first.')
    expect(invalidateOnboardingState).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller before touching the table', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const state = await setHomeCountry(emptyActionState, form({ country: 'NL' }))

    expect(state).toEqual({ error: null, redirectTo: '/auth/login' })
    expect(from).not.toHaveBeenCalled()
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

  it('releases this device BEFORE the session is revoked — PD-431', async () => {
    // The ordering is not a preference: `release_push_device` is a server write
    // and `auth.uid()` is its whole subject, so after the revocation there is
    // no session to resolve it against and the row survives naming the
    // departing rider. On a shared phone that is their notifications on
    // somebody else's lock screen.
    //
    // Pinned on the timeline rather than on a call count, because a count
    // passes with the call in the wrong place — which is the only way this
    // regresses.
    authSignOut.mockResolvedValue({ error: null })

    await signOut()

    // The release leads, and the two clears follow the revocation as before.
    expect(timeline).toEqual(['releaseCurrentDevice', 'clearQueryCache', 'clearGuardCache'])

    // **The claim that matters is against `auth.signOut()`, which is not on the
    // timeline** — so it is read off the invocation order rather than inferred
    // from the two clears, which sit on the far side of the revocation anyway
    // and would pass with the release moved after it.
    expect(releaseCurrentDevice).toHaveBeenCalledTimes(1)
    expect(releaseCurrentDevice).toHaveBeenCalledWith()
    expect(vi.mocked(releaseCurrentDevice).mock.invocationCallOrder[0]).toBeLessThan(
      authSignOut.mock.invocationCallOrder[0],
    )
  })

  it('signs the rider out even when the device release rejects', async () => {
    // The offline case, one step earlier than the existing fallback above. A
    // rider who pressed Sign out and is still signed in because a push RPC
    // could not reach the network is the worst available outcome, so the
    // failure is swallowed and the window is closed at the next boot instead.
    vi.mocked(releaseCurrentDevice).mockRejectedValueOnce(new Error('fetch failed'))
    authSignOut.mockResolvedValue({ error: null })

    const state = await signOut()

    expect(state).toEqual({ error: null, redirectTo: '/auth/login' })
    expect(authSignOut).toHaveBeenCalledTimes(1)
    expect(clearQueryCache).toHaveBeenCalledTimes(1)
    expect(clearGuardCache).toHaveBeenCalledTimes(1)
  })
})
