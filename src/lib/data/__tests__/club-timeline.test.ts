import { describe, expect, it } from 'vitest'
import { CLUB_THREADS_PAGE_SIZE } from '@/lib/data/club-threads'
import { FEED_PAGE_SIZE } from '@/lib/data/postcards'
import {
  boundedHorizon,
  collapseToNewestPerThread,
  CLUB_TIMELINE_JOINS,
  CLUB_TIMELINE_LIMIT,
  CLUB_TIMELINE_RIDES,
  groupClubTimeline,
  mergeClubTimeline,
  type ClubJoin,
  type ClubRideAnnouncement,
  type ClubMessageRow,
  type ClubThreadReply,
  type ClubTimelineSources,
} from '@/lib/data/club-timeline'
import type { ClubThreadListItem, Postcard } from '@/types'

/**
 * `mergeClubTimeline` — the club timeline's ordering and, above all, its
 * horizon.
 *
 * **The horizon is why this file exists.** Every other gate in the repo stays
 * green through a merge that silently drops a club's whole history below the
 * date its busiest source ran out: the result is still a well-ordered array of
 * valid events, `tsc` and `next build` see nothing, and on a quiet club — which
 * is every club in a fixture and most clubs in DEV — the wrong implementation
 * and the right one return the same list. It only diverges on a club whose join
 * read comes back full, and then it diverges by dropping rides and postcards
 * that have room on screen.
 *
 * Verified both ways per CLAUDE.md §Working Principles: removing the horizon
 * filter from `mergeClubTimeline` fails `cuts the timeline at a full source's
 * oldest row` and `takes the LATEST horizon when two sources are full`, and
 * removing the `rows.length === 0` guard in `horizonOf` fails `a full read that
 * returned nothing hides nothing`.
 */

const ride = (id: string, at: string): ClubRideAnnouncement => ({
  id,
  created_at: at,
  title: `Ride ${id}`,
  departure_at: at,
  timezone: null,
  organizer: null,
})

const postcard = (id: string, at: string): Postcard =>
  ({ id, created_at: at }) as Postcard

const thread = (id: string, at: string): ClubThreadListItem =>
  ({ id, created_at: at, title: `Thread ${id}` }) as ClubThreadListItem

const reply = (id: string, at: string, threadId = 't1'): ClubThreadReply => ({
  id,
  created_at: at,
  thread_id: threadId,
  thread_title: `Thread ${threadId}`,
  author: 'ana',
})

const join = (userId: string, at: string): ClubJoin =>
  ({
    user_id: userId,
    joined_at: at,
    role: 'member',
    profile: { id: userId, username: `rider-${userId}`, avatar_url: null },
  }) as ClubJoin

/** The merged stream's events with the club's own founding dropped — that
 *  floor entry is asserted on its own below, and threading it through every
 *  ordering case would say nothing about ordering. */
function eventsOf(...args: Parameters<typeof mergeClubTimeline>) {
  return mergeClubTimeline(...args).events.filter((event) => event.kind !== 'club-created')
}

function sources(over: Partial<ClubTimelineSources> = {}): ClubTimelineSources {
  return {
    club: { created_at: '2020-01-01T00:00:00Z', owner_id: 'owner' },
    rides: { rows: [], horizon: null },
    postcards: { rows: [], horizon: null },
    threads: { rows: [], horizon: null },
    joins: { rows: [], horizon: null },
    replies: { rows: [], horizon: null },
    unread: {},
    ...over,
  }
}

describe('mergeClubTimeline', () => {
  it('interleaves all four kinds newest first', () => {
    const merged = eventsOf(
      sources({
        rides: { rows: [ride('r1', '2026-08-03T10:00:00Z')], horizon: null },
        postcards: { rows: [postcard('p1', '2026-08-04T10:00:00Z')], horizon: null },
        threads: { rows: [thread('t1', '2026-08-01T10:00:00Z')], horizon: null },
        joins: { rows: [join('u1', '2026-08-02T10:00:00Z')], horizon: null },
      })
    )

    expect(merged.map((event) => event.kind)).toEqual(['postcard', 'ride', 'join', 'thread'])
  })

  it('places a ride by when it was announced, not when it departs', () => {
    // The ride leaves next year; it was announced before the postcard was
    // posted, so it sits below it. A merge keying on `departure_at` would put
    // it at the top of a feed of things that have already happened.
    const upcoming: ClubRideAnnouncement = {
      ...ride('r1', '2026-08-01T10:00:00Z'),
      departure_at: '2027-01-01T10:00:00Z',
    }

    const merged = eventsOf(
      sources({
        rides: { rows: [upcoming], horizon: null },
        postcards: { rows: [postcard('p1', '2026-08-02T10:00:00Z')], horizon: null },
      })
    )

    expect(merged.map((event) => event.kind)).toEqual(['postcard', 'ride'])
  })

  it('cuts the timeline at a full source\'s oldest row', () => {
    // The busy club: joins came back full at 2026-08-10, so nothing is known
    // about who joined before then. The June ride has room on screen and is
    // dropped anyway, because drawing it would assert that nobody joined
    // between June and August.
    const merged = eventsOf(
      sources({
        joins: {
          rows: [join('u1', '2026-08-12T10:00:00Z'), join('u2', '2026-08-10T10:00:00Z')],
          horizon: '2026-08-10T10:00:00Z',
        },
        rides: {
          rows: [ride('r1', '2026-08-11T10:00:00Z'), ride('r2', '2026-06-01T10:00:00Z')],
          horizon: null,
        },
      })
    )

    expect(merged.map((event) => event.key)).toEqual(['join:u1', 'ride:r1', 'join:u2'])
  })

  it('lets a short read reach back past a full one\'s oldest row', () => {
    // The same two sources, with the joins read NOT full: it is complete to the
    // beginning of the club, so the June ride is honest and stays.
    const merged = eventsOf(
      sources({
        joins: {
          rows: [join('u1', '2026-08-12T10:00:00Z'), join('u2', '2026-08-10T10:00:00Z')],
          horizon: null,
        },
        rides: {
          rows: [ride('r1', '2026-08-11T10:00:00Z'), ride('r2', '2026-06-01T10:00:00Z')],
          horizon: null,
        },
      })
    )

    expect(merged.map((event) => event.key)).toEqual([
      'join:u1',
      'ride:r1',
      'join:u2',
      'ride:r2',
    ])
  })

  it('takes the LATEST horizon when two sources are full', () => {
    // Postcards stop at August, threads at July. The timeline is complete only
    // above August — taking the earliest horizon, or the first one found, would
    // draw a July thread with no postcards beside it.
    const merged = eventsOf(
      sources({
        postcards: {
          rows: [postcard('p1', '2026-08-20T10:00:00Z'), postcard('p2', '2026-08-01T10:00:00Z')],
          horizon: '2026-08-01T10:00:00Z',
        },
        threads: {
          rows: [thread('t1', '2026-08-15T10:00:00Z'), thread('t2', '2026-07-01T10:00:00Z')],
          horizon: '2026-07-01T10:00:00Z',
        },
      })
    )

    expect(merged.map((event) => event.key)).toEqual(['postcard:p1', 'thread:t1', 'postcard:p2'])
  })

  it('a full read that returned nothing hides nothing', () => {
    // Unreachable from the data layer — a read cannot be both full and empty —
    // but a horizon of `undefined` from an empty reduce would compare false
    // against every timestamp and silently empty the whole timeline, so the
    // guard is asserted rather than trusted.
    const merged = eventsOf(
      sources({
        postcards: { rows: [], horizon: null },
        rides: { rows: [ride('r1', '2020-01-01T10:00:00Z')], horizon: null },
      })
    )

    expect(merged.map((event) => event.key)).toEqual(['ride:r1'])
  })

  it('applies the display limit after the horizon', () => {
    const merged = eventsOf(
      sources({
        rides: {
          rows: [
            ride('r1', '2026-08-04T10:00:00Z'),
            ride('r2', '2026-08-03T10:00:00Z'),
            ride('r3', '2026-08-02T10:00:00Z'),
          ],
          horizon: null,
        },
      }),
      2
    )

    expect(merged.map((event) => event.key)).toEqual(['ride:r1', 'ride:r2'])
  })

  it('orders events sharing one timestamp stably', () => {
    // A ride created in the same transaction as its club row shares `now()`
    // with it to the microsecond. Without the tiebreak the two swap on every
    // sort, which reads as the list flickering between renders.
    const at = '2026-08-04T10:00:00Z'
    const first = eventsOf(
      sources({
        rides: { rows: [ride('r1', at)], horizon: null },
        joins: { rows: [join('u1', at)], horizon: null },
      })
    )
    const second = eventsOf(
      sources({
        joins: { rows: [join('u1', at)], horizon: null },
        rides: { rows: [ride('r1', at)], horizon: null },
      })
    )

    expect(first.map((event) => event.key)).toEqual(second.map((event) => event.key))
  })

  it('marks a thread unread from the map, and reads a missing id as read', () => {
    const merged = eventsOf(
      sources({
        threads: {
          rows: [thread('t1', '2026-08-04T10:00:00Z'), thread('t2', '2026-08-03T10:00:00Z')],
          horizon: null,
        },
        unread: { t1: true },
      })
    )

    expect(merged.map((event) => event.kind === 'thread' && event.unread)).toEqual([true, false])
  })

  it('ends a COMPLETE stream on the club\'s own founding, named from the roster', () => {
    const merged = mergeClubTimeline(
      sources({
        // The club and its owner's membership share one instant, which is the
        // ordinary case — `001` writes them in one statement pair — and is the
        // pair `byNewestThenKey` has to break the right way round.
        club: { created_at: '2020-01-01T00:00:00Z', owner_id: 'u1' },
        joins: { rows: [join('u1', '2020-01-01T00:00:00Z')], horizon: null },
      })
    )

    expect(merged.complete).toBe(true)
    const floor = merged.events.at(-1)
    expect(floor?.kind).toBe('club-created')
    expect(floor?.kind === 'club-created' && floor.founder).toBe('rider-u1')
  })

  it('withholds the founding entry from a stream the horizon cut', () => {
    // The whole point of the entry is that it is the end of the story. Under a
    // cut it would sit directly beneath an event from this week and assert that
    // nothing happened in between — a false adjacency, and a worse lie than the
    // missing rows, because it reads as complete.
    const merged = mergeClubTimeline(
      sources({
        club: { created_at: '2020-01-01T00:00:00Z', owner_id: 'u1' },
        joins: {
          rows: [join('u1', '2026-08-12T10:00:00Z'), join('u2', '2026-08-10T10:00:00Z')],
          horizon: '2026-08-10T10:00:00Z',
        },
        // Older than the horizon the full join read sets, so the merge drops it
        // — which is what makes this stream incomplete.
        rides: { rows: [ride('r1', '2026-06-01T10:00:00Z')], horizon: null },
      })
    )

    expect(merged.complete).toBe(false)
    expect(merged.events.some((event) => event.kind === 'club-created')).toBe(false)
  })

  it('withholds the founding entry from a stream the LIMIT cut', () => {
    // The other way a stream can be short, and the one a `complete` derived
    // from `events.length` would get wrong: exactly `limit` entries can mean
    // either.
    const merged = mergeClubTimeline(
      sources({
        rides: {
          rows: [
            ride('r1', '2026-08-04T10:00:00Z'),
            ride('r2', '2026-08-03T10:00:00Z'),
            ride('r3', '2026-08-02T10:00:00Z'),
          ],
          horizon: null,
        },
      }),
      2
    )

    expect(merged.events).toHaveLength(2)
    expect(merged.complete).toBe(false)
  })

  it('leaves the founder unnamed when the owner holds no readable roster row', () => {
    // Legal since `054`: a club's owner reaches it through `clubs.owner_id`
    // whether or not they hold a `club_members` row, so the roster read can
    // simply not contain them.
    const merged = mergeClubTimeline(
      sources({ club: { created_at: '2020-01-01T00:00:00Z', owner_id: 'nobody' } })
    )

    const floor = merged.events.at(-1)
    expect(floor?.kind === 'club-created' && floor.founder).toBe(null)
  })

  it('places a reply at its own instant, leaving the thread where it started', () => {
    // The defect this whole event kind exists for: a thread begun three weeks
    // ago and busy this morning. The reply surfaces at the top; the thread's
    // own entry stays three weeks down, where it is TRUE — moving it there
    // instead would date "ana started a thread" to today.
    const merged = eventsOf(
      sources({
        threads: { rows: [thread('t1', '2026-08-01T10:00:00Z')], horizon: null },
        replies: { rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')], horizon: null },
      })
    )

    expect(merged.map((event) => event.key)).toEqual(['reply:m1', 'thread:t1'])
  })

  it('marks a reply unread off the thread it belongs to', () => {
    // Keyed on `thread_id`, not on the message: `club_thread_unread` answers
    // per thread, and a reply that read as unread only when its own id happened
    // to be in the map would never be marked at all.
    const merged = eventsOf(
      sources({
        replies: { rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')], horizon: null },
        unread: { t1: true },
      })
    )

    expect(merged.map((event) => event.kind === 'reply' && event.unread)).toEqual([true])
  })

  it('cuts on the reply read\'s OWN horizon, not on the one row it kept', () => {
    // The defect this replaced: `getClubThreadReplies` collapses its window to
    // one row per thread, so sixty messages in one argument come back as a
    // single entry. Deriving the horizon from that entry claimed the club's
    // picture stopped at that thread's latest message and cut its whole
    // history to the last hour. The source declares how far back it LOOKED —
    // here a week — and only that far back is cut.
    const merged = mergeClubTimeline(
      sources({
        replies: {
          rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')],
          horizon: '2026-08-15T10:00:00Z',
        },
        rides: {
          rows: [ride('r1', '2026-08-18T10:00:00Z'), ride('r2', '2026-06-01T10:00:00Z')],
          horizon: null,
        },
      })
    )

    expect(merged.events.map((event) => event.key)).toEqual(['reply:m1', 'ride:r1'])
    expect(merged.complete).toBe(false)
  })

  it('is empty for a club with nothing in it', () => {
    expect(eventsOf(sources())).toEqual([])
  })
})

/**
 * `groupClubTimeline` — the run boundaries the frame draws.
 *
 * `Private club - Timeline` (`2043:10604`) puts consecutive events in ONE
 * `Grey/10` block and each postcard in a card of its own. Both misgroupings —
 * a block per event, and one block for the whole stream — render a plausible
 * screen that no other gate in this repo can distinguish from the right one,
 * and each is one line away from the correct implementation.
 *
 * Verified both ways per CLAUDE.md §Working Principles: pushing a new group per
 * event fails `collects a RUN of events into one block`, and never opening a
 * second block fails `starts a new block after a postcard breaks the run`.
 */
describe('groupClubTimeline', () => {
  const events = (...kinds: ('event' | 'postcard')[]) =>
    kinds.map((kind, i) =>
      kind === 'postcard'
        ? ({ kind: 'postcard', at: `${i}`, key: `p${i}`, postcard: postcard(`p${i}`, `${i}`) } as const)
        : ({ kind: 'join', at: `${i}`, key: `j${i}`, member: join(`u${i}`, `${i}`) } as const)
    )

  it('collects a RUN of events into one block', () => {
    const groups = groupClubTimeline([...events('event', 'event', 'event')])

    expect(groups).toHaveLength(1)
    expect(groups[0].kind === 'events' && groups[0].events).toHaveLength(3)
  })

  it('starts a new block after a postcard breaks the run', () => {
    const groups = groupClubTimeline([
      ...events('event', 'event', 'postcard', 'event'),
    ])

    expect(groups.map((group) => group.kind)).toEqual(['events', 'postcard', 'events'])
    expect(groups[0].kind === 'events' && groups[0].events).toHaveLength(2)
    expect(groups[2].kind === 'events' && groups[2].events).toHaveLength(1)
  })

  it('gives every postcard its own card', () => {
    const groups = groupClubTimeline([...events('postcard', 'postcard')])

    expect(groups.map((group) => group.kind)).toEqual(['postcard', 'postcard'])
  })

  it('keys a run on its FIRST event, so appending to it does not remount it', () => {
    const groups = groupClubTimeline([...events('event', 'event')])

    expect(groups[0].key).toBe('j0')
  })

  it('is empty for an empty stream', () => {
    expect(groupClubTimeline([])).toEqual([])
  })
})

/**
 * The relationship between the display cap and the four source bounds.
 *
 * **This is the one assertion here whose failure is not a bug report.** While
 * every source reads at least as many rows as the timeline draws, the horizon
 * in `mergeClubTimeline` cannot remove a row that would have been rendered —
 * the proof is in `CLUB_TIMELINE_LIMIT`'s own docstring. Break the
 * relationship and the horizon starts deciding what a rider sees, which is
 * exactly what it is there for; the test exists so that switch is deliberate
 * and visible in a diff rather than a side effect of tuning a page size.
 *
 * **Two of the four bounds are not this module's.** `CLUB_THREADS_PAGE_SIZE`
 * belongs to the Threads list screen and `FEED_PAGE_SIZE` to the postcard feed,
 * so the number that breaks this can be changed by someone who never opens
 * `club-timeline.ts`. That is the whole reason it is pinned from here rather
 * than trusted to a comment.
 */
describe('the display cap against the source bounds', () => {
  it('reads at least as many rows of every source as it draws', () => {
    const bounds = {
      rides: CLUB_TIMELINE_RIDES,
      postcards: FEED_PAGE_SIZE,
      threads: CLUB_THREADS_PAGE_SIZE,
      joins: CLUB_TIMELINE_JOINS,
      // `CLUB_TIMELINE_REPLIES` is deliberately absent and must stay absent.
      // The invariant is about ROWS RETURNED when a source is full, and that
      // read collapses its window to one row per thread — no bound on messages
      // can promise a row count after it. Its horizon is genuinely live; the
      // case above is what covers it.
    }

    for (const [source, bound] of Object.entries(bounds)) {
      expect(
        bound,
        `${source} reads ${bound} rows but the timeline draws ${CLUB_TIMELINE_LIMIT}. ` +
          'Below the display cap the coherence horizon becomes live — which is what it ' +
          'is for, so this is a decision rather than a defect. Read CLUB_TIMELINE_LIMIT ' +
          'before changing either number.'
      ).toBeGreaterThanOrEqual(CLUB_TIMELINE_LIMIT)
    }
  })

  it('cuts the stream once a source reads FEWER rows than the timeline draws', () => {
    // The configuration the assertion above forbids, exercised so the guard is
    // known to work at the moment it starts being needed rather than only in
    // the small fixtures above: a source truncated at 3 against a display cap
    // of 10 drops the older events of every other source.
    const merged = mergeClubTimeline(
      sources({
        joins: {
          rows: [
            join('u1', '2026-08-12T10:00:00Z'),
            join('u2', '2026-08-11T10:00:00Z'),
            join('u3', '2026-08-10T10:00:00Z'),
          ],
          horizon: '2026-08-10T10:00:00Z',
        },
        rides: {
          rows: [ride('r1', '2026-08-11T12:00:00Z'), ride('r2', '2026-06-01T10:00:00Z')],
          horizon: null,
        },
      }),
      10
    )

    expect(merged.events.map((event) => event.key)).toEqual([
      'join:u1',
      'ride:r1',
      'join:u2',
      'join:u3',
    ])
    expect(merged.complete).toBe(false)
  })
})

/**
 * `boundedHorizon` — the horizon for a read whose rows ARE its window.
 *
 * A read that post-processes (`getClubJoins` filters, `getClubThreadReplies`
 * collapses) must NOT use it on its survivors, which is what the club-timeline
 * horizon case above exists to protect. This covers the plain case those two
 * pass their raw window to.
 */
describe('boundedHorizon', () => {
  const at = (row: { at: string }) => row.at
  const rows = (...stamps: string[]) => stamps.map((s) => ({ at: s }))

  it('is the oldest row read when the window came back full', () => {
    expect(boundedHorizon(rows('2026-08-04', '2026-08-03'), 2, at)).toBe('2026-08-03')
  })

  it('is null when the window came back short, however short', () => {
    // A read that did not fill its bound has reached the beginning of time for
    // its kind, so it hides nothing and must impose nothing on the others.
    expect(boundedHorizon(rows('2026-08-04'), 2, at)).toBe(null)
  })

  it('is null for an empty window even at a bound of zero', () => {
    // Unreachable from the data layer — a read cannot be both full and empty —
    // but `rows[rows.length - 1]` on an empty array is `undefined`, and an
    // undefined horizon compares false against every timestamp and would empty
    // the whole timeline rather than fail.
    expect(boundedHorizon([], 0, at)).toBe(null)
  })
})

/**
 * `collapseToNewestPerThread` — one entry per thread, and the horizon that has
 * to survive the collapse.
 *
 * **The second case is the one this file exists for.** It reproduces the defect
 * a review caught: sixty messages in a single argument collapse to one row, and
 * a horizon read off that row cuts the club's rides, postcards and joins back
 * to that thread's latest message. Verified both ways per CLAUDE.md §Working
 * Principles — deriving the horizon from the collapsed rows instead of the
 * window fails exactly that case and nothing else in the repo notices.
 */
describe('collapseToNewestPerThread', () => {
  const message = (id: string, at: string, threadId: string): ClubMessageRow => ({
    id,
    created_at: at,
    thread_id: threadId,
    author: { username: 'ana' },
    thread: { club_id: 'c1', title: `Thread ${threadId}` },
  })

  it('keeps the newest message per thread and drops the rest of its history', () => {
    const { rows } = collapseToNewestPerThread(
      [
        message('m3', '2026-08-04T12:00:00Z', 't1'),
        message('m2', '2026-08-04T11:00:00Z', 't1'),
        message('m1', '2026-08-03T10:00:00Z', 't2'),
      ],
      10
    )

    expect(rows.map((row) => [row.thread_id, row.id])).toEqual([
      ['t1', 'm3'],
      ['t2', 'm1'],
    ])
  })

  it('takes the horizon from the WINDOW, not from the one row it kept', () => {
    // Four messages, all in one thread, filling a bound of four. The collapse
    // yields a single row at 12:00; the read looked back to 09:00, and 09:00 is
    // what the rest of the timeline may be cut at. Reading it off the survivor
    // would cut three hours of the club's history instead.
    const { rows, horizon } = collapseToNewestPerThread(
      [
        message('m4', '2026-08-04T12:00:00Z', 't1'),
        message('m3', '2026-08-04T11:00:00Z', 't1'),
        message('m2', '2026-08-04T10:00:00Z', 't1'),
        message('m1', '2026-08-04T09:00:00Z', 't1'),
      ],
      4
    )

    expect(rows).toHaveLength(1)
    expect(horizon).toBe('2026-08-04T09:00:00Z')
  })

  it('imposes no horizon when the window came back short', () => {
    const { horizon } = collapseToNewestPerThread(
      [message('m1', '2026-08-04T12:00:00Z', 't1')],
      10
    )

    expect(horizon).toBe(null)
  })

  it('drops a message whose thread the policy did not return', () => {
    // `!inner` makes this unreachable in practice; typed as nullable because
    // the embed is, and a row with no thread has no title to draw.
    const orphan = { ...message('m1', '2026-08-04T12:00:00Z', 't1'), thread: null }

    expect(collapseToNewestPerThread([orphan], 10).rows).toEqual([])
  })
})
