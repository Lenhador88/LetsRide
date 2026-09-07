import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `joinAndIntroduceToClub` — the sheet's pre-join primary (PD-392, PD-418).
 *
 * **The fourth thing under test is PD-418's inversion.** An empty body used to
 * refuse the join outright, which made writing an introduction the price of
 * membership; it now joins and writes no thread. Both directions are asserted,
 * because the two differ only in an outcome string and a call that did not
 * happen — nothing about the rendered result tells them apart.
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
 * `Cancel` and the rider must be told they joined. `design.md` §D1.
 *
 * Both writers are mocked, because each already owns its own enforcement and
 * its own cache claims and neither is this function's business — what belongs
 * to this function is the order, the short-circuit, and the three outcomes.
 */

/** Every call, in order, across both writers — the sequence is the assertion. */
const calls: string[] = []

const joinClub = vi.fn()
// `leaveClub` is mocked even though nothing under test may call it — that is
// the point. It is what gives the "no compensating delete" assertion something
// that CAN fail: a reachable spy on the real module's real export.
const leaveClub = vi.fn()
// The indirection is not decoration: `vi.mock`'s factory is hoisted above these
// declarations, so a bare `() => ({ joinClub })` reads the binding before it is
// initialised. Referencing it inside a function body defers that to call time —
// the same shape `ride-audience.test.ts` uses for its resolver.
vi.mock('@/lib/actions/clubs', () => ({
  joinClub: (...args: unknown[]) => joinClub(...args),
  leaveClub: (...args: unknown[]) => {
    calls.push('leave')
    return leaveClub(...args)
  },
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

/** The callback is REQUIRED, so a case with nothing to observe says so. */
const noop = () => {}

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
    const result = await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.', noop)

    expect(result).toEqual({ outcome: 'joined-and-introduced' })
    // Not "both were called" — the ORDER. `097` refuses the introduction of a
    // non-member, so a swap here is a feature that never works.
    expect(calls).toEqual(['join', 'introduce'])
  })
})

describe('joinAndIntroduceToClub — it reports the membership landing mid-flight', () => {
  it('fires onMembershipExists AFTER the join and BEFORE the introduction', async () => {
    // The sheet cannot observe the intermediate state any other way: from the
    // outside this is one awaited call, so without the callback there is one
    // pending window spanning both writes. Two rules ride on the boundary — the
    // second control must stop saying `Cancel` the instant the join
    // commits, and the dismissal lock must release there rather than holding
    // shut for the introduction's flight.
    await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.', () =>
      calls.push('membership-reported')
    )

    expect(calls).toEqual(['join', 'membership-reported', 'introduce'])
  })

  it('does not fire it when the join failed', async () => {
    joinClub.mockImplementation(async () => {
      calls.push('join')
      return { error: 'That club could not be joined.' }
    })

    await joinAndIntroduceToClub(CLUB, 'Hi.', () => calls.push('membership-reported'))

    // No membership exists, so nothing may relabel `Cancel` or release the
    // lock — both would be claiming a join that did not happen.
    expect(calls).toEqual(['join'])
  })
})

describe('joinAndIntroduceToClub — the join fails', () => {
  it('never attempts the introduction, and reports the join as the failure', async () => {
    joinClub.mockImplementation(async () => {
      calls.push('join')
      return { error: 'That club could not be joined.' }
    })

    const result = await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.', noop)

    expect(result).toEqual({ outcome: 'join-failed', error: 'That club could not be joined.' })
    // The short-circuit. Issuing the introduction here would answer a failed
    // join with `097`'s introduction error, which names the wrong thing.
    expect(calls).toEqual(['join'])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a body the database would reject before writing anything at all', async () => {
    // The membership must not be a side effect of a body the database would
    // have refused anyway. `introduceToClub` parses it too — that is the
    // enforcement; this is the ordering guard, and only this one runs first.
    //
    // **This case is now a too-LONG body, not an empty one** — PD-418 made
    // emptiness a decision rather than an error (see the suite below), so
    // over-length text is what still has to be refused ahead of the join. The
    // guard did not go away; the set of things reaching it shrank.
    const result = await joinAndIntroduceToClub(CLUB, 'x'.repeat(1001), noop)

    expect(result.outcome).toBe('join-failed')
    expect(calls).toEqual([])
    expect(joinClub).not.toHaveBeenCalled()
  })
})

describe('joinAndIntroduceToClub — an empty body joins and writes no thread (PD-418)', () => {
  it.each([
    ['empty', ''],
    ['whitespace only', '   \n\t '],
  ])('joins on a %s body and never attempts the introduction', async (_label, body) => {
    const result = await joinAndIntroduceToClub(CLUB, body, noop)

    // The membership is what the rider asked for; the introduction is what they
    // declined. Under PD-392 this same input returned `join-failed` and wrote
    // nothing at all — that inversion IS the story.
    expect(result).toEqual({ outcome: 'joined-without-introduction' })
    expect(calls).toEqual(['join'])

    // **Not attempted, rather than attempted and caught.**
    // `club_threads_introduction_length` refuses whitespace-only text, so an
    // attempt would come back as `introduction-failed` and tell the rider
    // something went wrong on the one path where everything went as asked.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('still reports the membership landing, so the sheet can relabel', async () => {
    await joinAndIntroduceToClub(CLUB, '', () => calls.push('membership-reported'))

    // The callback is not skipped just because there is no second write behind
    // it — the sheet's latch and its dismissal lock both key off this, and the
    // caller closes on it.
    expect(calls).toEqual(['join', 'membership-reported'])
  })

  it('reports the join failing rather than a phantom membership', async () => {
    joinClub.mockImplementation(async () => {
      calls.push('join')
      return { error: 'That club could not be joined.' }
    })

    const result = await joinAndIntroduceToClub(CLUB, '', noop)

    // The empty-body path must not swallow a failed join into a success just
    // because it has no introduction to report on.
    expect(result).toEqual({ outcome: 'join-failed', error: 'That club could not be joined.' })
  })
})

describe('joinAndIntroduceToClub — the join lands and the introduction does not', () => {
  it('reports a distinct outcome rather than a plain error', async () => {
    rpc.mockImplementation(async () => {
      calls.push('introduce')
      return { error: { message: 'nope' } }
    })

    const result = await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.', noop)

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

    await joinAndIntroduceToClub(CLUB, 'Hi, I ride a Ténéré.', noop)

    // A compensating delete would write a `club_joined` notification to the
    // club and remove the member underneath it — the wake PD-392 refuses in
    // "Defer the join; do not undo it". The rider is left in `097`'s
    // first-class "joined, owes an introduction" state instead.
    //
    // `leaveClub` is mocked into the same `calls` log precisely so this can
    // fail: an earlier version asserted `not.toContain('leave')` against a log
    // nothing could ever push 'leave' into, which passes against every
    // implementation and reads as coverage that is not there.
    expect(calls).not.toContain('leave')
    expect(leaveClub).not.toHaveBeenCalled()
    expect(calls.filter((call) => call === 'join')).toHaveLength(1)
  })
})
