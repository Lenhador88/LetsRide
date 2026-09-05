import { describe, expect, it } from 'vitest'
import {
  groupRideTimeline,
  mergeRideTimeline,
  RIDE_TIMELINE_JOINS,
  RIDE_TIMELINE_LIMIT,
  type RideJoin,
  type RideTimelineSources,
} from '@/lib/data/ride-timeline'
import { FEED_PAGE_SIZE } from '@/lib/data/postcards'
import type { Postcard } from '@/types'

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
  ...over,
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
