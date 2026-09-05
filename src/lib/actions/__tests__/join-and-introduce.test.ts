import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `joinAndIntroduceToClub` — PD-392's `Post`, in the sheet's pre-join mode.
 *
 * **The ordering is the thing under test, and it is not a preference.**
 * `introduce_to_club` (`097`) refuses a caller who is not a member, so the
 * membership has to land first. A refactor that swaps the two calls type-checks,
 * renders identically, and fails only against the real database — which no gate
 * in this repo runs for a client action. So it is asserted here.
 *
 * **The second thing under test is the not-attempted case.** When the join
 * fails, the introduction must never be issued: attempting it would raise
 * `097`'s single collapsed error and hand the sheet a message about
 * introductions for a failure that was about joining. That branch is invisible
 * to a caller reading only the outcome, because both would be a failure.
 *
 * **The third is that `introduction-failed` stays its own outcome.** Collapsing
 * it into a plain error is the tempting simplification and it is what makes the
 * sheet lie: the membership exists, so the second control must stop saying
 * `Join later` and the rider must be told they joined. `design.md` §D1.
 *
 * Both writers are mocked, because each already owns its own enforcement and
 * its own cache claims and neither is this function's business — what belongs
 * to this function is the order, the short-circuit, and the three outcomes.
 */

const joinClub = vi.fn()
// The indirection is not decoration: `vi.mock`'s factory is hoisted above these
// declarations, so a bare `() => ({ joinClub })` reads the binding before it is
// initialised. Referencing it inside a function body defers that to call time —
// the same shape `ride-audience.test.ts` uses for its resolver.
vi.mock('@/lib/actions/clubs', () => ({
  joinClub: (...args: unknown[]) => joinClub(...args),
}))

const rpc = vi.fn()
vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({
    from: vi.fn(),
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getUser: vi.fn() },
  }),
}))

vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query')>()),
  invalidate: vi.fn(),
}))

import { joinAndIntroduceToClub } from '@/lib/actions/club-introductions'

const CLUB = '11111111-1111-4111-8111-111111111111'

/** Every call, in order, across both writers — the sequence is the assertion. */
const calls: string[] = []

beforeEach(() => {
  calls.length = 0
  joinClub.mockReset()
  rpc.mockReset()
  joinClub.mockImplementation(async () => {
    calls.push('join')
    return { error: null }
  })
  rpc.mockImplementation(async () => {
    calls.push('introduce')
    return { error: null }
  })
})

describe('joinAndIntroduceToClub — both writes succeed', () => {
  it('joins BEFORE it introduces, and reports one outcome', async () => {
    const result = await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.')

    expect(result).toEqual({ outcome: 'joined-and-introduced' })
    // Not "both were called" — the ORDER. `097` refuses the introduction of a
    // non-member, so a swap here is a feature that never works.
    expect(calls).toEqual(['join', 'introduce'])
  })
})

describe('joinAndIntroduceToClub — the join fails', () => {
  it('never attempts the introduction, and reports the join as the failure', async () => {
    joinClub.mockImplementation(async () => {
      calls.push('join')
      return { error: 'That club could not be joined.' }
    })

    const result = await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.')

    expect(result).toEqual({ outcome: 'join-failed', error: 'That club could not be joined.' })
    // The short-circuit. Issuing the introduction here would answer a failed
    // join with `097`'s introduction error, which names the wrong thing.
    expect(calls).toEqual(['join'])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses an empty body before writing anything at all', async () => {
    // The membership must not be a side effect of a body the database would
    // have refused anyway. `introduceToClub` parses it too — that is the
    // enforcement; this is the ordering guard, and only this one runs first.
    const result = await joinAndIntroduceToClub(CLUB, '   ')

    expect(result.outcome).toBe('join-failed')
    expect(calls).toEqual([])
    expect(joinClub).not.toHaveBeenCalled()
  })
})

describe('joinAndIntroduceToClub — the join lands and the introduction does not', () => {
  it('reports a distinct outcome rather than a plain error', async () => {
    rpc.mockImplementation(async () => {
      calls.push('introduce')
      return { error: { message: 'nope' } }
    })

    const result = await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.')

    // NOT `join-failed`, and not a bare error. The membership exists: the sheet
    // has to relabel its second control and tell the rider they joined, and
    // both of those key off this outcome. Collapsing the three into two is the
    // refactor this assertion refuses.
    expect(result.outcome).toBe('introduction-failed')
    expect(calls).toEqual(['join', 'introduce'])
  })

  it('does not undo the membership', async () => {
    rpc.mockImplementation(async () => {
      calls.push('introduce')
      return { error: { message: 'nope' } }
    })

    await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.')

    // A compensating delete would write a `club_joined` notification to the
    // club and remove the member underneath it — the wake PD-392 refuses in
    // "Defer the join; do not undo it". The rider is left in `097`'s
    // first-class "joined, owes an introduction" state instead.
    expect(calls).not.toContain('leave')
    expect(calls.filter((call) => call === 'join')).toHaveLength(1)
  })
})
