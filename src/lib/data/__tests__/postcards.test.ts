import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRideJournal } from '@/lib/data/postcards'

/**
 * `getRideJournal`'s two-step shape (`041`, PD-256): an id lookup through
 * `public.ride_journal_postcard_ids` — the one thing still holding the column
 * grant `062` revoked — followed by an ordinary `postcards` read filtered to
 * those ids. What is worth pinning here is the *shape* of that call sequence,
 * not the audience rule itself: which conjuncts admit a tag is `041`'s INSERT
 * policy and is asserted in `supabase/tests/rls_test.sql`, not here.
 *
 * The stub `postcards` builder always resolves empty rows, the same trick
 * `ride-messages.test.ts` avoids needing for `getRideChatUnread` — an empty
 * result means `attachLikeState`'s `postcard_likes` lookup, `signImagePaths`
 * and `resolveAvatarUrls` all short-circuit on their own `length === 0`
 * guards, so this file does not have to stub Storage or a second table just
 * to observe the two calls this function actually makes.
 */
const RIDE_ID = '11111111-1111-4111-8111-111111111111'

const rpc = vi.fn()
const getUser = vi.fn()
const from = vi.fn()

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({ rpc, from, auth: { getUser } }),
}))

/** Records the calls a real `postgrest-js` builder would receive, and
 * resolves like one — `unwrapList` awaits the builder directly. */
function postcardsBuilder(rows: unknown[]) {
  const inCalls: unknown[][] = []
  const orderCalls: unknown[][] = []
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.in = vi.fn((...args: unknown[]) => {
    inCalls.push(args)
    return builder
  })
  builder.order = vi.fn((...args: unknown[]) => {
    orderCalls.push(args)
    return builder
  })
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null })
  return { builder, inCalls, orderCalls }
}

describe('getRideJournal', () => {
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    getUser.mockReset()
    getUser.mockResolvedValue({ data: { user: null } })
  })

  it('asks the accessor first, by ride, through the one RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await getRideJournal(RIDE_ID)

    expect(rpc).toHaveBeenCalledWith('ride_journal_postcard_ids', { ride: RIDE_ID })
  })

  it('returns nothing, and never reaches postcards, when the accessor finds no tag', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    expect(await getRideJournal(RIDE_ID)).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('reads the returned ids back through postcards, both keys descending', async () => {
    rpc.mockResolvedValue({ data: ['postcard-2', 'postcard-1'], error: null })
    const { builder, inCalls, orderCalls } = postcardsBuilder([])
    from.mockReturnValue(builder)

    await getRideJournal(RIDE_ID)

    expect(from).toHaveBeenCalledWith('postcards')
    // `.in(…)` does not preserve the accessor's own order — this is the query
    // that actually orders the page, and it must key on both columns or a
    // `created_at` tie inside one rider's own transaction is unspecified.
    expect(inCalls).toEqual([['id', ['postcard-2', 'postcard-1']]])
    expect(orderCalls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
  })

  it('refuses a malformed ride id without calling the database at all', async () => {
    expect(await getRideJournal('not-a-uuid')).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  /**
   * The failure this pins: "no postcards exist" and "the query failed" must
   * not collapse into the same empty array — `unwrap.ts`'s own header names
   * this as the defect the whole module exists to avoid, and the ride
   * Journal's own spec requires a failed read to render `ErrorState` rather
   * than the empty state.
   */
  it('throws rather than reporting an accessor failure as an empty journal', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } })

    await expect(getRideJournal(RIDE_ID)).rejects.toThrow()
  })
})
