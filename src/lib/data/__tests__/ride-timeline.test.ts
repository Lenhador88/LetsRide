import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRideJoins,
  getRideThreadCreations,
  getRideThreadReplies,
  groupRideTimeline,
  mergeRideTimeline,
  RIDE_TIMELINE_JOINS,
  RIDE_TIMELINE_REPLIES,
  RIDE_TIMELINE_THREADS,
  RIDE_TIMELINE_LIMIT,
  type RideJoin,
  type RideTimelineSources,
} from '@/lib/data/ride-timeline'
import { FEED_PAGE_SIZE } from '@/lib/data/postcards'
import type { Postcard, RideThreadListItem, RideThreadReply } from '@/types'

/**
 * `mergeRideTimeline` — the ride timeline's ordering, its horizon, and the one
 * row it deliberately never draws.
 *
 * **The horizon is why this file exists**, for `club-timeline.test.ts`' reason
 * one domain over: every other gate in the repo stays green through a merge
 * that silently drops a ride's history below the date its busiest source ran
 * out. The result is still a well-ordered array of valid events, `tsc` and
 * `next build` see nothing, and on a quiet ride — which is every ride in a
 * fixture and most rides on DEV — the wrong implementation and the right one
 * return the same list. It diverges only on a ride whose crew read comes back
 * full, and then it diverges by dropping photos that have room on screen.
 *
 * Verified both ways per CLAUDE.md §Working Principles: removing the horizon
 * filter fails `cuts the stream at a full source's oldest row` and `takes the
 * LATER horizon when both sources are full`; removing the organizer filter
 * fails `never draws the organizer arriving on their own ride`; removing the
 * `complete` guard on the floor entry fails `withholds the founding while the
 * stream is cut`.
 */

const from = vi.fn()

vi.mock('@/lib/supabase/resolve', () => ({
  resolveSupabase: async () => ({ from }),
}))

const ORGANIZER = 'organizer-1'

const postcard = (id: string, at: string): Postcard => ({ id, created_at: at }) as Postcard

const join = (userId: string, at: string): RideJoin => ({
  user_id: userId,
  status: 'going',
  joined_at: at,
  profile: { id: userId, username: userId, avatar_url: null, avatar_path: null, bike_model: null },
}) as unknown as RideJoin

const sources = (over: Partial<RideTimelineSources> = {}): RideTimelineSources => ({
  ride: {
    created_at: '2026-01-01T00:00:00.000Z',
    organizer_id: ORGANIZER,
    organizer: 'pedro',
  },
  postcards: { rows: [], horizon: null },
  joins: { rows: [], horizon: null },
  // `108`, PD-402. Empty by default so every existing case keeps asserting what
  // it asserted before the conversation sources existed — a fixture that
  // silently contributed rows would move the display cap and the horizon under
  // tests written about two sources.
  threads: { rows: [], horizon: null },
  replies: { rows: [], horizon: null },
  ...over,
})

/** A thread creation row, as `getRideThreadCreations` returns one. */
const thread = (id: string, at: string, title = `thread ${id}`): RideThreadListItem =>
  ({
    id,
    ride_id: 'ride-1',
    author_id: 'r1',
    title,
    created_at: at,
    author: { id: 'r1', username: 'r1' },
  }) as RideThreadListItem

/** The newest reply in one thread, as `getRideThreadReplies` returns one. */
const reply = (threadId: string, at: string): RideThreadReply => ({
  id: `m-${threadId}-${at}`,
  created_at: at,
  thread_id: threadId,
  thread_title: `thread ${threadId}`,
  author: 'r2',
})

describe('mergeRideTimeline — order', () => {
  it('interleaves photos and arrivals newest first', () => {
    const timeline = mergeRideTimeline(
      sources({
        postcards: { rows: [postcard('p1', '2026-03-03T00:00:00.000Z')], horizon: null },
        joins: {
          rows: [join('r1', '2026-03-04T00:00:00.000Z'), join('r2', '2026-03-02T00:00:00.000Z')],
          horizon: null,
        },
      })
    )

    expect(timeline.events.map((event) => event.key)).toEqual([
      'join:r1',
      'postcard:p1',
      'join:r2',
      `ride-planned:${ORGANIZER}`,
    ])
  })

  /**
   * `103` writes the organizer's `ride_members` row inside the ride's own
   * transaction, so this tie is the NORM on every ride rather than a
   * coincidence — and the founding must still land last, because nothing can
   * precede the ride existing. On the key tiebreak alone `join:` sorts below
   * `ride-planned:`, which is the wrong way round.
   */
  it('keeps the founding below an arrival that shares its instant', () => {
    const at = '2026-01-01T00:00:00.000Z'
    const timeline = mergeRideTimeline(sources({ joins: { rows: [join('a', at)], horizon: null } }))

    expect(timeline.events.map((event) => event.key)).toEqual([
      'join:a',
      `ride-planned:${ORGANIZER}`,
    ])
  })
})

describe('mergeRideTimeline — the organizer', () => {
  /**
   * The row `103` guarantees exists on every ride in the app. Drawn, it is
   * "Pedro joined the ride." sitting on "Pedro planned this ride." at the foot
   * of every single ride, always, at the same instant.
   */
  it('never draws the organizer arriving on their own ride', () => {
    const timeline = mergeRideTimeline(
      sources({
        joins: {
          rows: [
            join(ORGANIZER, '2026-01-01T00:00:00.000Z'),
            join('r1', '2026-02-01T00:00:00.000Z'),
          ],
          horizon: null,
        },
      })
    )

    expect(timeline.events.map((event) => event.key)).toEqual([
      'join:r1',
      `ride-planned:${ORGANIZER}`,
    ])
  })

  /** Dropping the row must not drop the READ's own answer about how far back
   *  it looked — the horizon comes from what was fetched, not from what
   *  survived. */
  it('keeps a full join read cutting the stream even when the organizer was in it', () => {
    const timeline = mergeRideTimeline(
      sources({
        postcards: { rows: [postcard('old', '2026-01-05T00:00:00.000Z')], horizon: null },
        joins: {
          rows: [join(ORGANIZER, '2026-03-01T00:00:00.000Z')],
          horizon: '2026-03-01T00:00:00.000Z',
        },
      })
    )

    expect(timeline.events).toEqual([])
    expect(timeline.complete).toBe(false)
  })
})

describe('mergeRideTimeline — the horizon', () => {
  it("cuts the stream at a full source's oldest row", () => {
    const timeline = mergeRideTimeline(
      sources({
        postcards: {
          rows: [postcard('p1', '2026-03-01T00:00:00.000Z')],
          horizon: '2026-03-01T00:00:00.000Z',
        },
        joins: { rows: [join('r1', '2026-02-01T00:00:00.000Z')], horizon: null },
      })
    )

    expect(timeline.events.map((event) => event.key)).toEqual(['postcard:p1'])
    expect(timeline.complete).toBe(false)
  })

  it('takes the LATER horizon when both sources are full', () => {
    const timeline = mergeRideTimeline(
      sources({
        postcards: {
          rows: [postcard('p1', '2026-03-01T00:00:00.000Z')],
          horizon: '2026-03-01T00:00:00.000Z',
        },
        joins: {
          rows: [join('r1', '2026-04-01T00:00:00.000Z')],
          horizon: '2026-04-01T00:00:00.000Z',
        },
      })
    )

    expect(timeline.events.map((event) => event.key)).toEqual(['join:r1'])
  })

  /** A source that came back short reaches the ride's beginning and cuts
   *  nothing — including one that came back short holding no rows at all. */
  it('is complete when neither source declared one', () => {
    const timeline = mergeRideTimeline(
      sources({ postcards: { rows: [postcard('p1', '2026-03-01T00:00:00.000Z')], horizon: null } })
    )

    expect(timeline.complete).toBe(true)
    expect(timeline.events.map((event) => event.kind)).toContain('ride-planned')
  })
})

describe('mergeRideTimeline — the founding', () => {
  /**
   * On a cut stream the floor would sit directly under an entry from last
   * Tuesday and assert nothing happened in between — a false adjacency, and a
   * worse lie than the missing rows, because it reads as the end of the story.
   */
  it('withholds the founding while the stream is cut', () => {
    const timeline = mergeRideTimeline(
      sources({
        joins: {
          rows: [join('r1', '2026-04-01T00:00:00.000Z')],
          horizon: '2026-04-01T00:00:00.000Z',
        },
      })
    )

    expect(timeline.complete).toBe(false)
    expect(timeline.events.map((event) => event.kind)).not.toContain('ride-planned')
  })

  it('withholds it when the display cap is what cut, not the horizon', () => {
    const rows = Array.from({ length: RIDE_TIMELINE_LIMIT + 1 }, (_, i) =>
      postcard(`p${i}`, new Date(Date.UTC(2026, 2, 1) - i * 60_000).toISOString())
    )
    const timeline = mergeRideTimeline(sources({ postcards: { rows, horizon: null } }))

    expect(timeline.events).toHaveLength(RIDE_TIMELINE_LIMIT)
    expect(timeline.complete).toBe(false)
  })

  /** The `profiles` policy hides a rider mid-onboarding, so the embed resolves
   *  to null. The ride still happened, and this entry is the floor of the whole
   *  stream — dropping it would leave the timeline with no end. */
  it('keeps the founding when the organizer cannot be named', () => {
    const timeline = mergeRideTimeline(
      sources({ ride: { created_at: '2026-01-01T00:00:00.000Z', organizer_id: ORGANIZER, organizer: null } })
    )

    expect(timeline.events).toEqual([
      { kind: 'ride-planned', at: '2026-01-01T00:00:00.000Z', key: `ride-planned:${ORGANIZER}`, organizer: null },
    ])
  })
})

describe('groupRideTimeline', () => {
  /** A postcard is a card and an announcement is a row in a shared grey block.
   *  The run boundaries are the thing a refactor silently gets wrong — one
   *  block per event, or one block for the whole stream — and neither
   *  misgrouping is visible to any other gate. */
  it('gives a photo its own block and collects consecutive announcements', () => {
    const timeline = mergeRideTimeline(
      sources({
        postcards: { rows: [postcard('p1', '2026-03-03T00:00:00.000Z')], horizon: null },
        joins: {
          rows: [join('r1', '2026-03-04T00:00:00.000Z'), join('r2', '2026-03-02T00:00:00.000Z')],
          horizon: null,
        },
      })
    )

    expect(
      groupRideTimeline(timeline.events).map((group) => [group.kind, group.key])
    ).toEqual([
      ['events', 'join:r1'],
      ['postcard', 'postcard:p1'],
      // The second arrival and the founding are consecutive, so they share one
      // block and it keeps the FIRST event's key.
      ['events', 'join:r2'],
    ])
  })
})

describe('the bounds this merge depends on', () => {
  /**
   * The display cap must not exceed either source's read bound, or the cap
   * stops being what cuts a busy ride and the horizon starts doing it instead
   * — a stream that is short for a reason the foot then reports as "older
   * activity", when the truth is simply that we drew everything we fetched.
   *
   * Pinned here because `FEED_PAGE_SIZE` belongs to the feed and can be
   * lowered by someone who never opens this file.
   */
  it('reads at least a page of each source', () => {
    expect(FEED_PAGE_SIZE).toBeGreaterThanOrEqual(RIDE_TIMELINE_LIMIT)
    expect(RIDE_TIMELINE_JOINS).toBeGreaterThanOrEqual(RIDE_TIMELINE_LIMIT)
  })
})


/**
 * `getRideJoins`' horizon, which is the one thing in this read a rider can
 * actually see go wrong.
 *
 * **It reads `limit + 1` and draws `limit`**, rather than using
 * `boundedHorizon`. That helper's rule — a read that came back full may have
 * more behind it — cannot separate a ride with exactly sixty riders from one
 * with more, and here that ambiguity is visible rather than academic: `103`
 * guarantees the organizer's crew row exists and is the oldest, so a phantom
 * horizon lands on ~`rides.created_at`, `mergeRideTimeline` withholds the
 * founding entry, and the foot claims the stream is cut when everything is on
 * screen. Verified both ways: dropping the `+ 1` fails
 * `reports no horizon on a ride sitting exactly on the bound`.
 */
const RIDE_ID = '11111111-1111-4111-8111-111111111111'

/** Records what the builder was asked for and resolves like `postgrest-js`. */
function crewBuilder(rows: unknown[]) {
  const limitCalls: unknown[] = []
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.limit = vi.fn((n: unknown) => {
    limitCalls.push(n)
    return builder
  })
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null })
  return { builder, limitCalls }
}

const crewRow = (i: number) => ({
  user_id: `rider-${i}`,
  status: 'going',
  joined_at: new Date(Date.UTC(2026, 8, 5, 12) - i * 60_000).toISOString(),
  profile: { id: `rider-${i}`, username: `rider${i}`, avatar_path: null, bike_model: null },
})

describe('getRideJoins — the horizon', () => {
  beforeEach(() => from.mockReset())

  it('reports no horizon on a ride sitting exactly on the bound', async () => {
    const { builder, limitCalls } = crewBuilder(
      Array.from({ length: RIDE_TIMELINE_JOINS }, (_, i) => crewRow(i))
    )
    from.mockReturnValue(builder)

    const source = await getRideJoins(RIDE_ID)

    // The probe row is asked for and never drawn.
    expect(limitCalls).toEqual([RIDE_TIMELINE_JOINS + 1])
    expect(source.rows).toHaveLength(RIDE_TIMELINE_JOINS)
    expect(source.horizon).toBeNull()
  })

  it('reports the oldest DRAWN row when the probe came back', async () => {
    const rows = Array.from({ length: RIDE_TIMELINE_JOINS + 1 }, (_, i) => crewRow(i))
    const { builder } = crewBuilder(rows)
    from.mockReturnValue(builder)

    const source = await getRideJoins(RIDE_ID)

    expect(source.rows).toHaveLength(RIDE_TIMELINE_JOINS)
    expect(source.horizon).toBe(rows[RIDE_TIMELINE_JOINS - 1].joined_at)
  })

  /** The horizon is taken before the username filter, so a rider the
   *  `profiles` policy hides cannot make a saturated read look short. */
  it('keeps the horizon when a hidden rider is dropped from a full window', async () => {
    const rows = Array.from({ length: RIDE_TIMELINE_JOINS + 1 }, (_, i) => crewRow(i))
    ;(rows[0].profile as { username: string | null }).username = null
    const { builder } = crewBuilder(rows)
    from.mockReturnValue(builder)

    const source = await getRideJoins(RIDE_ID)

    expect(source.rows).toHaveLength(RIDE_TIMELINE_JOINS - 1)
    expect(source.horizon).toBe(rows[RIDE_TIMELINE_JOINS - 1].joined_at)
  })

  it('refuses a malformed ride id without calling the database at all', async () => {
    expect(await getRideJoins('not-a-uuid')).toEqual({ rows: [], horizon: null })
    expect(from).not.toHaveBeenCalled()
  })
})

/**
 * `108` (PD-402) gave a ride a conversation, and the module header's no-paging
 * argument now rests on how those two sources are bounded. These pin the parts
 * of that a refactor reverses in silence.
 */
describe('mergeRideTimeline — threads and replies', () => {
  it('interleaves a thread, a reply, a photo and an arrival by time alone', () => {
    const timeline = mergeRideTimeline(
      sources({
        postcards: { rows: [postcard('p1', '2026-03-01T00:00:00.000Z')], horizon: null },
        joins: { rows: [join('r1', '2026-03-02T00:00:00.000Z')], horizon: null },
        threads: { rows: [thread('t1', '2026-03-03T00:00:00.000Z')], horizon: null },
        replies: { rows: [reply('t1', '2026-03-04T00:00:00.000Z')], horizon: null },
      })
    )

    // Newest first, and the founding last because the stream is complete.
    expect(timeline.events.map((event) => event.kind)).toEqual([
      'reply',
      'thread',
      'join',
      'postcard',
      'ride-planned',
    ])
  })

  it('keys a reply on its THREAD, so a second reply in the same thread cannot collide', () => {
    // The collapse guarantees one reply row per thread, and this is what makes
    // that guarantee visible: two rows for one thread would be a duplicate
    // React key rather than two entries. Keying on the message id would hide
    // the bug by making both rows legal.
    const timeline = mergeRideTimeline(
      sources({ replies: { rows: [reply('t1', '2026-03-04T00:00:00.000Z')], horizon: null } })
    )

    expect(timeline.events[0].key).toBe('reply:t1')
  })

  it('withholds the founding entry when only the reply source declared a horizon', () => {
    // The stronger `complete` derivation, which `mergeClubTimeline` did not
    // have until PD-400. A collapsing source is exactly how the weaker test
    // gets it wrong: two rows out of a two-hundred-message window, with a live
    // horizon and nothing else cut.
    const timeline = mergeRideTimeline(
      sources({
        replies: {
          rows: [reply('t1', '2026-03-04T00:00:00.000Z')],
          horizon: '2026-03-04T00:00:00.000Z',
        },
      })
    )

    expect(timeline.complete).toBe(false)
    expect(timeline.events.map((event) => event.kind)).not.toContain('ride-planned')
  })
})

describe('groupRideTimeline — a thread gets its own group', () => {
  it('breaks a run of announcements rather than joining it', () => {
    // A thread row is a destination with a title; compressed into the 44px
    // announcement strip it reads like a fact that happened once. The break is
    // the property — a regression here is invisible to `tsc` and to the merge's
    // own tests, because the events are all still present and still ordered.
    const groups = groupRideTimeline(
      mergeRideTimeline(
        sources({
          joins: {
            rows: [
              join('r1', '2026-03-05T00:00:00.000Z'),
              join('r2', '2026-03-03T00:00:00.000Z'),
            ],
            horizon: null,
          },
          threads: { rows: [thread('t1', '2026-03-04T00:00:00.000Z')], horizon: null },
        })
      ).events
    )

    expect(groups.map((group) => group.kind)).toEqual(['events', 'thread', 'events'])
  })
})

function threadBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null })
  return builder
}

const messageRow = (threadId: string, at: string) => ({
  id: `m-${threadId}-${at}`,
  created_at: at,
  thread_id: threadId,
  author: { id: 'r2', username: 'r2' },
  thread: { ride_id: RIDE_ID, title: `thread ${threadId}` },
})

describe('getRideThreadReplies — the collapse and the horizon', () => {
  beforeEach(() => from.mockReset())

  it('returns one row per thread, keeping the newest in each', async () => {
    // The bound that makes the ride timeline safe without paging: a message
    // bound whose OUTPUT is a thread bound.
    from.mockReturnValue(
      threadBuilder([
        messageRow('t1', '2026-03-05T00:00:00.000Z'),
        messageRow('t1', '2026-03-04T00:00:00.000Z'),
        messageRow('t2', '2026-03-03T00:00:00.000Z'),
        messageRow('t1', '2026-03-02T00:00:00.000Z'),
      ])
    )

    const source = await getRideThreadReplies(RIDE_ID)

    expect(source.rows.map((row) => row.thread_id)).toEqual(['t1', 't2'])
    expect(source.rows[0].created_at).toBe('2026-03-05T00:00:00.000Z')
  })

  it('takes the horizon from the WINDOW, never from the survivors', async () => {
    // The trap `TimelineSource.horizon` names by hand: with a full window
    // collapsing to one row, a horizon derived from `rows` would report that
    // thread's latest message and cut the ride's whole history to the last
    // hour. Every message here is in ONE thread, so the two answers differ by
    // the entire window.
    const window = Array.from({ length: RIDE_TIMELINE_REPLIES }, (_, i) =>
      messageRow('t1', new Date(Date.UTC(2026, 8, 5, 12) - i * 60_000).toISOString())
    )
    from.mockReturnValue(threadBuilder(window))

    const source = await getRideThreadReplies(RIDE_ID)

    expect(source.rows).toHaveLength(1)
    expect(source.horizon).toBe(window[RIDE_TIMELINE_REPLIES - 1].created_at)
    expect(source.horizon).not.toBe(source.rows[0].created_at)
  })

  it('reports no horizon when the window did not fill', async () => {
    from.mockReturnValue(threadBuilder([messageRow('t1', '2026-03-05T00:00:00.000Z')]))

    expect((await getRideThreadReplies(RIDE_ID)).horizon).toBeNull()
  })

  it('refuses a malformed ride id without calling the database at all', async () => {
    expect(await getRideThreadReplies('not-a-uuid')).toEqual({ rows: [], horizon: null })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('getRideThreadCreations', () => {
  beforeEach(() => from.mockReset())

  it('reports the oldest row as the horizon when the read filled', async () => {
    // These rows ARE the window — nothing is filtered or collapsed after the
    // read — so `boundedHorizon`'s precondition holds here, unlike above.
    const rows = Array.from({ length: RIDE_TIMELINE_THREADS }, (_, i) =>
      thread(`t${i}`, new Date(Date.UTC(2026, 8, 5, 12) - i * 60_000).toISOString())
    )
    from.mockReturnValue(threadBuilder(rows))

    const source = await getRideThreadCreations(RIDE_ID)

    expect(source.horizon).toBe(rows[RIDE_TIMELINE_THREADS - 1].created_at)
  })

  it('refuses a malformed ride id without calling the database at all', async () => {
    expect(await getRideThreadCreations('not-a-uuid')).toEqual({ rows: [], horizon: null })
    expect(from).not.toHaveBeenCalled()
  })
})
