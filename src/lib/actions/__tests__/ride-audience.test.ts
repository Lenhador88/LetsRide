import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RIDE_AUDIENCE_REFUSAL } from '@/lib/rides/audience'
import { emptyActionState } from '@/lib/actions/state'

/**
 * `updateRide`'s half of PD-338's audience rule, against a mocked resolver.
 *
 * **Two things here that `EditRideForm`'s tests cannot cover.** The action is
 * what holds when the form is bypassed — a rider posting the payload directly —
 * so it has to reach the same answer without the component. And it has to reach
 * it from a **fresh read** rather than from the payload: the transition rule
 * compares a stored pair against a submitted one, and a client that can post
 * the submitted pair can post a claim about the stored pair with it. A guard
 * that trusted a hidden field would be decorative, and nothing else in the
 * suite would notice.
 *
 * The third assertion is the anti-drift one: the refusal must be the shared
 * constant, not a literal. Two copies of this message existed, drifted, and
 * both went on arguing from the premise `083` retired.
 */

const from = vi.fn()
const getUser = vi.fn()

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({
    from: (...args: unknown[]) => from(...args),
    rpc: vi.fn(),
    auth: { getUser },
  }),
}))

vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query')>()),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/analytics/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics/client')>()),
  capture: vi.fn(),
}))

import { updateRide } from '@/lib/actions/rides'

const USER = { id: '22222222-2222-4222-8222-222222222222' }
const RIDE_ID = '11111111-1111-4111-8111-111111111111'
const CLUB = '33333333-3333-4333-8333-333333333333'

type Result = { data: unknown; error: null | { code?: string; message?: string } }

/** The same recording builder shape `invalidation.test.ts` uses. */
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

/**
 * A valid ride payload, with the audience pair overridable. Every other field
 * has to satisfy `rideSchema`, which parses before the guard is reached — a
 * malformed payload would be refused for the wrong reason and the test would
 * pass without exercising anything.
 */
function payload(over: { club_id?: string; is_public?: boolean } = {}): FormData {
  const data = new FormData()
  data.append('title', 'Sunday run')
  data.append('meeting_point', 'Dam Square, Amsterdam')
  data.append('route_description', '')
  data.append('departure_at', '2027-05-01T09:00')
  data.append('club_id', over.club_id ?? '')
  if (over.is_public) data.append('is_public', 'on')
  return data
}

/**
 * Answers the `previous` read with `stored`, and the UPDATE that follows with a
 * returned row — **so a permitted edit runs to `{ error: null }` rather than
 * stopping at `!ride`.**
 *
 * That detail is the whole reason the permitted cases can assert `toBeNull()`
 * instead of the far weaker `not.toBe(REFUSAL)`. `not.toBe` is satisfied by any
 * *other* error, so it stays green against a guard reverted to the old
 * shape-based rule — which returns a different literal — and the headline
 * assertion would then be asserting the opposite of its own name. Answering the
 * UPDATE is what makes "no error at all" reachable and therefore assertable.
 */
function withStoredShape(stored: Record<string, unknown> | null) {
  let call = 0
  from.mockImplementation(() => {
    call += 1
    return chain({ data: call === 1 ? stored : { id: RIDE_ID }, error: null }).builder
  })
}

beforeEach(() => {
  from.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: USER } })
})

const stored = (club_id: string | null, is_public: boolean) => ({
  meeting_point: 'Dam Square, Amsterdam',
  start_place_id: null,
  map_card_path: null,
  map_detail_path: null,
  timezone: 'Europe/Amsterdam',
  club_id,
  is_public,
})

describe('updateRide refuses only the transition that empties the audience', () => {
  it('refuses detaching a private ride from its club', async () => {
    withStoredShape(stored(CLUB, false))

    const state = await updateRide(RIDE_ID, emptyActionState, payload())

    expect(state.error).toBe(RIDE_AUDIENCE_REFUSAL)
  })

  it('refuses un-publishing a ride that is in no club', async () => {
    withStoredShape(stored(null, true))

    const state = await updateRide(RIDE_ID, emptyActionState, payload())

    expect(state.error).toBe(RIDE_AUDIENCE_REFUSAL)
  })

  // **`not.toBe(REFUSAL)` is NOT enough for a permitted case, and reading it as
  // enough is how this file nearly shipped without a tripwire on its own
  // headline.** Reverting the guard to the old shape-based rule returns a
  // *different* literal, which satisfies `not.toBe` — so the assertion would
  // have stayed green while asserting the opposite of its name. Assert the
  // absence of an error instead.
  it('PERMITS an edit to a ride that already had no standing audience', async () => {
    // PD-338's headline on the action side. Before this change the same call
    // was refused, which is what made the composer's default output uneditable.
    withStoredShape(stored(null, false))

    const state = await updateRide(RIDE_ID, emptyActionState, payload())

    expect(state.error).toBeNull()
  })

  it('permits detaching together with making the ride public', async () => {
    withStoredShape(stored(CLUB, false))

    const state = await updateRide(RIDE_ID, emptyActionState, payload({ is_public: true }))

    expect(state.error).toBeNull()
  })
})

describe('where the stored pair comes from', () => {
  it('reads it from the database, never from the submitted form', async () => {
    // The bypass case: a caller posts the refused pair AND a claim that the
    // ride was already in that shape. The claim must count for nothing.
    withStoredShape(stored(CLUB, false))

    const lying = payload()
    lying.append('previous_club_id', '')
    lying.append('previous_is_public', 'off')

    const state = await updateRide(RIDE_ID, emptyActionState, lying)

    expect(state.error).toBe(RIDE_AUDIENCE_REFUSAL)
  })

  it('selects both audience columns on the read the guard depends on', async () => {
    // If the columns ever drop off that select, `previous.club_id` and
    // `previous.is_public` read `undefined`, every stored shape looks like "no
    // standing audience", and the guard silently stops refusing anything.
    const { builder, calls } = chain({ data: stored(CLUB, false), error: null })
    from.mockReturnValue(builder)

    await updateRide(RIDE_ID, emptyActionState, payload())

    const selected = calls.find((c) => c.method === 'select')?.args[0]
    expect(String(selected)).toContain('is_public')
    expect(String(selected)).toContain('club_id')
  })

  it('neither refuses nor permits when the prior row cannot be read', async () => {
    // The ride is gone, or RLS hides it. Inventing a refusal would report an
    // audience problem for a ride that does not exist; falling through lets
    // the update match zero rows, which the not-found path already reports.
    withStoredShape(null)

    const state = await updateRide(RIDE_ID, emptyActionState, payload())

    // Not `not.toBe(REFUSAL)` — see the note above; the point of this case is
    // that no refusal is invented at all, which only an absent error states.
    expect(state.error).toBeNull()
  })
})

describe('the refusal is one string', () => {
  it('returns the shared constant rather than a literal of its own', async () => {
    withStoredShape(stored(CLUB, false))

    const state = await updateRide(RIDE_ID, emptyActionState, payload())

    // The retired premise, in the words the old copy used.
    expect(state.error).not.toContain('nobody but you')
    expect(state.error).toBe(RIDE_AUDIENCE_REFUSAL)
  })
})
