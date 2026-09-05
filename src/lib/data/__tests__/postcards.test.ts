import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE,
  CLUB_FEED_HORIZON_ESCALATIONS,
  FEED_PAGE_SIZE,
  getClubFeedWindow,
  getRideJournal,
} from '@/lib/data/postcards'

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

    expect(await getRideJournal(RIDE_ID)).toEqual({ rows: [], horizon: null })
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
    expect(await getRideJournal('not-a-uuid')).toEqual({ rows: [], horizon: null })
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

  /**
   * The horizon — PD-393. It says how far back this source's picture reaches,
   * and `mergeRideTimeline` cuts the whole stream at the newest such point, so
   * getting it wrong does not shorten the timeline, it makes it **wrong**: a
   * horizon claimed where there is nothing behind cuts the join stream at that
   * instant for no reason a rider could see.
   *
   * Counted from the IDS rather than from the rows, which is what these two
   * cases separate — `boundedHorizon` over the rows would report one in the
   * second case, where the accessor has already said there is nothing behind.
   */
  it('reports no horizon when the accessor returned no more ids than the page', async () => {
    const ids = Array.from({ length: FEED_PAGE_SIZE }, (_, i) => `postcard-${i}`)
    rpc.mockResolvedValue({ data: ids, error: null })
    const { builder } = postcardsBuilder(journalRows(FEED_PAGE_SIZE))
    from.mockReturnValue(builder)

    expect((await getRideJournal(RIDE_ID)).horizon).toBeNull()
  })

  it('reports the oldest row it drew as the horizon when ids remain behind it', async () => {
    const ids = Array.from({ length: FEED_PAGE_SIZE + 5 }, (_, i) => `postcard-${i}`)
    rpc.mockResolvedValue({ data: ids, error: null })
    const { builder } = postcardsBuilder(journalRows(FEED_PAGE_SIZE))
    from.mockReturnValue(builder)

    const source = await getRideJournal(RIDE_ID)
    expect(source.rows).toHaveLength(FEED_PAGE_SIZE)
    expect(source.horizon).toBe(source.rows[FEED_PAGE_SIZE - 1].created_at)
  })
})

/**
 * Rows shaped only as far as this file needs them: newest first, and every
 * media path null so `signImagePaths` and `resolveAvatarUrls` short-circuit on
 * their own `length === 0` guards rather than this file having to stub Storage
 * — the same trick the empty-rows builder above relies on.
 */
function journalRows(count: number) {
  // Strictly descending, because the query's own `created_at desc, id desc`
  // is what the real read returns and the horizon is "the oldest row we drew".
  // A fixture in any other order would let an implementation taking the FIRST
  // row pass this file while cutting every ride's timeline at its newest photo.
  return Array.from({ length: count }, (_, i) => ({
    id: `postcard-${i}`,
    created_at: new Date(Date.UTC(2026, 8, 5, 12) - i * 60_000).toISOString(),
    image_path: null,
    author: null,
    likes_count: null,
    comments_count: null,
  }))
}

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

  /**
   * A FAITHFUL accessor stub — it enforces the SAME clamp `086` line 135
   * does (`least(page_size, 100)`), as well as "cannot return more than
   * actually exists". This is the fix for the mock mistake that let the
   * ceiling bug ship invisibly: a stub that echoed back whatever `page_size`
   * it was asked for could return 120 ids for a 120-id ask, which the real
   * `club_stamp_postcard_ids` can never do — so a test built on it could not
   * see a caller that failed to clamp its own request before comparing
   * against it.
   */
  function mockAccessorWithAvailable(available: number) {
    rpc.mockImplementation(async (_fn: string, args: { page_size: number }) => ({
      data: accessorIds(Math.min(args.page_size, available, CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE)),
      error: null,
    }))
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
   * The bug a fourth review pass found in the escalation fix itself: the raw
   * ladder is 30 → 60 → 120, but the accessor can never serve more than
   * `CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE` (100) regardless of what it is asked
   * for (`086` line 135) — asking for 120 and comparing the reply against
   * 120 made a page the accessor answered IN FULL (its own 100-row hard
   * maximum) read as SHORT, which is the exact false-completeness defect
   * this whole fix chain exists to close, one rung deeper. It fires whether
   * zero or a few rows survive that round, because the un-clamped
   * `!saturated` check ran before the survivor check.
   *
   * A precise `mockResolvedValueOnce` sequence rather than
   * `mockAccessorWithAvailable` below, so the assertion on round 3's own
   * `page_size` argument is the thing pinning the fix — the caller must ask
   * for the clamped 100, never the raw 120.
   */
  it('does not mistake the accessor\'s own 100-row ceiling for a short (complete) page', async () => {
    rpc.mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE), error: null }) // round 0: 30, saturated
      .mockResolvedValueOnce({ data: accessorIds(FEED_PAGE_SIZE * 2), error: null }) // round 1: 60, saturated
      // round 2: asked for the CLAMPED 100 (never the raw 120) and the
      // accessor answers IN FULL — its own hard maximum, not a short page.
      .mockResolvedValueOnce({ data: accessorIds(CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE), error: null })

    const { builder: empty1 } = postcardsBuilder([])
    const { builder: empty2 } = postcardsBuilder([])
    const { builder: empty3 } = postcardsBuilder([])
    from.mockReturnValueOnce(empty1).mockReturnValueOnce(empty2).mockReturnValueOnce(empty3)

    const window = await getClubFeedWindow(CLUB_ID, { limit: FEED_PAGE_SIZE })

    expect(rpc).toHaveBeenCalledTimes(3)
    expect(rpc).toHaveBeenNthCalledWith(3, 'club_stamp_postcard_ids', {
      club: CLUB_ID,
      before: null,
      page_size: CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE,
    })
    // The bug: `window.length(100) >= pageSize(120)` is false, so this used
    // to read as short/complete. Fixed: compared against the clamped 100,
    // `100 >= 100` is saturated — the ceiling is recognised rather than
    // mistaken for completeness, so the honest last-resort fallback runs
    // instead of a false `null`.
    expect(window.horizon).not.toBeNull()
  })

  /**
   * The exhaustion case, end to end: every round saturates and every one
   * comes back with zero survivors, all the way to the accessor's OWN
   * ceiling. `mockAccessorWithAvailable` enforces the real accessor's clamp
   * on every call — including the last one, which asks for 100 (not 120)
   * and is genuinely told there are 500 more where that came from, so it
   * answers with exactly 100, its own hard maximum. This is the one place a
   * guess is unavoidable, and it must still be BOUNDED: the accessor is
   * called `1 + CLUB_FEED_HORIZON_ESCALATIONS` times and no more, and the
   * ladder climbs 30 → 60 → 100, never past the accessor's own ceiling.
   */
  it('stops escalating at the accessor\'s own ceiling and falls back to `before` only once every round has failed', async () => {
    const before = '2026-01-10T00:00:00.000Z'
    const totalRounds = 1 + CLUB_FEED_HORIZON_ESCALATIONS
    mockAccessorWithAvailable(500) // far more than any one call will ever be served

    for (let round = 0; round < totalRounds; round++) {
      const { builder } = postcardsBuilder([])
      from.mockReturnValueOnce(builder)
    }

    const window = await getClubFeedWindow(CLUB_ID, { before, limit: FEED_PAGE_SIZE })

    expect(rpc).toHaveBeenCalledTimes(totalRounds)
    expect(rpc).toHaveBeenNthCalledWith(1, 'club_stamp_postcard_ids', { club: CLUB_ID, before, page_size: FEED_PAGE_SIZE })
    expect(rpc).toHaveBeenNthCalledWith(2, 'club_stamp_postcard_ids', { club: CLUB_ID, before, page_size: FEED_PAGE_SIZE * 2 })
    // The last rung is the accessor's own ceiling, not the raw 120 the
    // doubling ladder would otherwise ask for.
    expect(rpc).toHaveBeenNthCalledWith(totalRounds, 'club_stamp_postcard_ids', {
      club: CLUB_ID,
      before,
      page_size: CLUB_FEED_ACCESSOR_MAX_PAGE_SIZE,
    })
    expect(from).toHaveBeenCalledTimes(totalRounds)
    // The documented last resort — "no progress" rather than a guess with no
    // basis at all — reached only after real escalation failed throughout.
    expect(window.horizon).toBe(before)
    expect(window.rows).toEqual([])
  })

  it('falls back to "now" on the exhausted FIRST page (no `before` to fall back to)', async () => {
    const totalRounds = 1 + CLUB_FEED_HORIZON_ESCALATIONS
    const beforeCall = Date.now()
    mockAccessorWithAvailable(500)

    for (let round = 0; round < totalRounds; round++) {
      const { builder } = postcardsBuilder([])
      from.mockReturnValueOnce(builder)
    }

    const window = await getClubFeedWindow(CLUB_ID, { limit: FEED_PAGE_SIZE })

    expect(rpc).toHaveBeenCalledTimes(totalRounds)
    expect(window.horizon).not.toBeNull()
    expect(new Date(window.horizon!).getTime()).toBeGreaterThanOrEqual(beforeCall)
  })
})
