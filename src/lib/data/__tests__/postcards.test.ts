import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLUB_FEED_HORIZON_ESCALATIONS, FEED_PAGE_SIZE, getClubFeedWindow, getRideJournal } from '@/lib/data/postcards'

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
  const limitCalls: unknown[][] = []
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
  builder.limit = vi.fn((...args: unknown[]) => {
    limitCalls.push(args)
    return builder
  })
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null })
  return { builder, inCalls, orderCalls, limitCalls }
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
    const { builder, inCalls, orderCalls, limitCalls } = postcardsBuilder([])
    from.mockReturnValue(builder)

    await getRideJournal(RIDE_ID)

    expect(from).toHaveBeenCalledWith('postcards')
    expect(limitCalls).toEqual([[FEED_PAGE_SIZE]])
    // `.in(…)` does not preserve the accessor's own order — this is the query
    // that actually orders the page, and it must key on both columns or a
    // `created_at` tie inside one rider's own transaction is unspecified.
    expect(inCalls).toEqual([['id', ['postcard-2', 'postcard-1']]])
    expect(orderCalls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
  })

  /**
   * The cap goes on the IDS as well as on the query, and a limit on the query
   * alone would not be caught by asserting the returned length: `.in(…)`
   * serialises every id it is given into the PostgREST query string, so an
   * unbounded list meets a URL-length wall rather than degrading. This is the
   * assertion that fails if the slice is dropped and only `.limit()` kept.
   */
  it('never sends more ids than the page it is going to read', async () => {
    const ids = Array.from({ length: FEED_PAGE_SIZE + 5 }, (_, i) => `postcard-${i}`)
    rpc.mockResolvedValue({ data: ids, error: null })
    const { builder, inCalls } = postcardsBuilder([])
    from.mockReturnValue(builder)

    await getRideJournal(RIDE_ID)

    expect(inCalls).toEqual([['id', ids.slice(0, FEED_PAGE_SIZE)]])
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

/**
 * `getClubFeedWindow` — `design.md` §D3's fix, and the TWO further findings
 * a reviewer pass on PD-375 caught in it, in order:
 *
 * 1. A saturated accessor page whose every row the caller's own RLS then
 *    refuses used to read as SHORT, because the horizon was still measured
 *    on `withFlag` (the second, RLS-filtered read) once nothing survived —
 *    the identical false-complete signal this function exists to close, one
 *    level down.
 * 2. The FIX for (1) guessed a horizon instead of looking for one — `now()`
 *    on the first page (newer than every real event, so the merge's
 *    `max(horizons)` cut wipes the whole timeline) or `before` on a deeper
 *    page (pins the accumulated horizon there for ever, freezing every
 *    other source behind it via the same `max(horizons)`). The fix for
 *    THAT is escalation: re-ask the same accessor for a bigger page before
 *    guessing anything, and guess only once that has genuinely failed.
 *
 * A postcard row built with `image_path: ''` and `author: null` throughout —
 * `attachLikeState`'s `signImagePaths`/`resolveAvatarUrls` both short-circuit
 * on an empty/absent path, so a survivor fixture needs no Storage stub.
 */
function survivorRow(id: string, createdAt: string) {
  return {
    id,
    author_id: 'author-1',
    club_id: null,
    image_path: '',
    caption: null,
    created_at: createdAt,
    updated_at: createdAt,
    taken_place_name: null,
    taken_country_code: null,
    author: null,
    club: null,
    likes_count: null,
    comments_count: null,
  }
}

describe('getClubFeedWindow', () => {
  const CLUB_ID = '22222222-2222-4222-8222-222222222222'

  function accessorIds(count: number) {
    return Array.from({ length: count }, (_, i) => ({ id: `p${i}`, from_ride: false }))
  }

  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    getUser.mockReset()
    getUser.mockResolvedValue({ data: { user: null } })
  })

  it('imposes no horizon when the accessor itself comes back short, on the first try', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'p1', from_ride: false }], error: null })
    const { builder } = postcardsBuilder([])
    from.mockReturnValue(builder)

    const window = await getClubFeedWindow(CLUB_ID, { limit: FEED_PAGE_SIZE })

    expect(window.horizon).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  /**
   * Case (1) from `design.md`/task list: a saturated DEEPER page with zero
   * survivors escalates and finds one on the second accessor call. `before`
   * stays IDENTICAL across the escalation — the escalation looks further
   * INTO the same window, never past it — and the horizon comes from the
   * escalated round's own survivor, never a guess.
   */
  it('escalates a saturated deeper page with zero survivors, and derives the horizon from the round that finds one', async () => {
    const before = '2026-01-10T00:00:00.000Z'
    const survivorCreatedAt = '2026-01-05T00:00:00.000Z'

    rpc.mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE), error: null })
      .mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE * 2), error: null })

    const { builder: emptyBuilder } = postcardsBuilder([])
    const { builder: survivorBuilder } = postcardsBuilder([survivorRow('p5', survivorCreatedAt)])
    from.mockReturnValueOnce(emptyBuilder).mockReturnValueOnce(survivorBuilder)

    const window = await getClubFeedWindow(CLUB_ID, { before, limit: FEED_PAGE_SIZE })

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(1, 'club_stamp_postcard_ids', {
      club: CLUB_ID,
      before,
      page_size: FEED_PAGE_SIZE,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'club_stamp_postcard_ids', {
      club: CLUB_ID,
      before,
      page_size: FEED_PAGE_SIZE * 2,
    })
    // Not `now()`, not `before` — the escalated round's own survivor.
    expect(window.horizon).toBe(survivorCreatedAt)
    expect(window.rows).toHaveLength(1)
  })

  /**
   * The same escalation on the FIRST page (`before` undefined) — the case
   * that used to fall back to `new Date().toISOString()` and blank the
   * whole merged timeline via `max(horizons)`.
   */
  it('escalates a saturated FIRST page with zero survivors, and derives the horizon from the round that finds one', async () => {
    const survivorCreatedAt = '2026-01-05T00:00:00.000Z'

    rpc.mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE), error: null })
      .mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE * 2), error: null })

    const { builder: emptyBuilder } = postcardsBuilder([])
    const { builder: survivorBuilder } = postcardsBuilder([survivorRow('p5', survivorCreatedAt)])
    from.mockReturnValueOnce(emptyBuilder).mockReturnValueOnce(survivorBuilder)

    const window = await getClubFeedWindow(CLUB_ID, { limit: FEED_PAGE_SIZE })

    expect(rpc).toHaveBeenCalledTimes(2)
    // Concrete, not merely `not.toBeNull()` — the trap the original version
    // of this test could not catch, because a fabricated `now()` also
    // passes a bare non-null assertion. The fixture's own survivor is from
    // 2026-01-05, well in the past relative to whenever this suite runs.
    expect(window.horizon).toBe(survivorCreatedAt)
    expect(new Date(window.horizon!).getTime()).toBeLessThan(Date.now())
  })

  /**
   * The accessor genuinely runs out DURING escalation: the escalated call
   * (`page_size` doubled once) returns fewer ids than it asked for — real
   * completion, horizon `null`, and `rows` reflects that FINAL round's own
   * full read rather than the first (empty) round's.
   */
  it('reports null once the accessor itself comes back short at an escalated page size, with rows from that round', async () => {
    const survivorCreatedAt = '2026-01-03T00:00:00.000Z'
    // Round 1: saturated (FEED_PAGE_SIZE ids), zero survivors. Round 2:
    // escalated to FEED_PAGE_SIZE * 2, but the accessor only had
    // FEED_PAGE_SIZE + 3 to give — short of what it was asked for, so this
    // is genuine completion even though ONE of those ids survives RLS.
    rpc.mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE), error: null })
      .mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE + 3), error: null })

    const { builder: emptyBuilder } = postcardsBuilder([])
    const { builder: survivorBuilder } = postcardsBuilder([survivorRow('p5', survivorCreatedAt)])
    from.mockReturnValueOnce(emptyBuilder).mockReturnValueOnce(survivorBuilder)

    const window = await getClubFeedWindow(CLUB_ID, { limit: FEED_PAGE_SIZE })

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(window.horizon).toBeNull()
    expect(window.rows).toHaveLength(1)
    expect(window.rows[0].id).toBe('p5')
  })

  /**
   * The exhaustion case: every escalation round saturates and every one
   * comes back with zero survivors, all the way to the cap
   * (`CLUB_FEED_HORIZON_ESCALATIONS`). This is the one place a guess is
   * unavoidable, and it must still be BOUNDED — the accessor is called
   * `1 + CLUB_FEED_HORIZON_ESCALATIONS` times and no more, never hangs or
   * escalates without limit.
   */
  it('stops escalating at the bound and falls back to `before` only once every round has failed', async () => {
    const before = '2026-01-10T00:00:00.000Z'
    const totalRounds = 1 + CLUB_FEED_HORIZON_ESCALATIONS

    for (let round = 0; round < totalRounds; round++) {
      rpc.mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE * 2 ** round), error: null })
      const { builder } = postcardsBuilder([])
      from.mockReturnValueOnce(builder)
    }

    const window = await getClubFeedWindow(CLUB_ID, { before, limit: FEED_PAGE_SIZE })

    expect(rpc).toHaveBeenCalledTimes(totalRounds)
    expect(from).toHaveBeenCalledTimes(totalRounds)
    // The documented last resort — "no progress" rather than a guess with no
    // basis at all — reached only after real escalation failed throughout.
    expect(window.horizon).toBe(before)
    expect(window.rows).toEqual([])
  })

  it('falls back to "now" on the exhausted FIRST page (no `before` to fall back to)', async () => {
    const totalRounds = 1 + CLUB_FEED_HORIZON_ESCALATIONS
    const beforeCall = Date.now()

    for (let round = 0; round < totalRounds; round++) {
      rpc.mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE * 2 ** round), error: null })
      const { builder } = postcardsBuilder([])
      from.mockReturnValueOnce(builder)
    }

    const window = await getClubFeedWindow(CLUB_ID, { limit: FEED_PAGE_SIZE })

    expect(rpc).toHaveBeenCalledTimes(totalRounds)
    expect(window.horizon).not.toBeNull()
    expect(new Date(window.horizon!).getTime()).toBeGreaterThanOrEqual(beforeCall)
  })
})
