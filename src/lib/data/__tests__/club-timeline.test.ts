import { describe, expect, it } from 'vitest'
import { CLUB_THREADS_PAGE_SIZE } from '@/lib/data/club-threads'
import { FEED_PAGE_SIZE } from '@/lib/data/postcards'
import {
  absorbClubReplyWindow,
  absorbClubTimelineWindow,
  boundedHorizon,
  chunkIds,
  collapseToNewestPerThread,
  pendingClubTimelineSources,
  resolveClubTimelineAdvance,
  resolveClubTimelineTailState,
  CLUB_TIMELINE_JOINS,
  CLUB_TIMELINE_LIMIT,
  CLUB_TIMELINE_RIDES,
  groupClubTimeline,
  mergeClubTimeline,
  type ClubJoin,
  type ClubMessageRow,
  type ClubThreadReply,
  type ClubTimeline,
  type ClubTimelineSources,
} from '@/lib/data/club-timeline'
import type { ClubThreadListItem, Postcard, PublicProfile, RideListItem } from '@/types'

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

const ride = (id: string, at: string): RideListItem =>
  ({ id, created_at: at, title: `Ride ${id}`, departure_at: at }) as RideListItem

const postcard = (id: string, at: string): Postcard =>
  ({ id, created_at: at }) as Postcard

/**
 * A thread row, as `getClubThreads` returns one.
 *
 * **`at` is the thread's newest activity, and `createdAt` defaults to it** —
 * `116` (PD-439) defaults `last_activity_at` to the thread's own creation, so a
 * two-argument call is a thread nobody has replied to and every case written
 * before that migration keeps meaning what it meant. Pass `createdAt` for the
 * case this change is about: an old thread bumped by a fresh reply, where the
 * two stamps differ and only one of them answers the exactness question.
 */
const thread = (id: string, at: string, createdAt = at): ClubThreadListItem =>
  ({
    id,
    created_at: createdAt,
    last_activity_at: at,
    title: `Thread ${id}`,
  }) as ClubThreadListItem

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
    activity: {},
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
    const upcoming: RideListItem = {
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

  it('withholds the founding entry when a source declared a horizon it happened to hold every row above', () => {
    // PD-400, and the case a `complete` derived from "the horizon filter dropped
    // nothing" gets exactly backwards. A source's horizon is the OLDEST row it
    // returned, so every row it holds sits at or above it and the filter drops
    // nothing — while the source's own picture demonstrably stops there.
    //
    // **The vehicle changed in `116` (PD-439) and the rule did not.** This used
    // to be driven by the reply source, the only COLLAPSING one, which could
    // return two rows out of a two-hundred-message window with a live horizon.
    // `116` took the reply horizon out of the merge entirely — a source that
    // draws no row makes no claim about the stream — so the case is reproduced
    // here with the thread source instead. It is not a weaker case: any bounded
    // source declaring a horizon reproduces it, which is why the old expression
    // was wrong rather than merely imprecise.
    //
    // Verified both ways per CLAUDE.md §Working Principles: under the old
    // `inside.length === events.length && shown.length === ordered.length` this
    // reads `complete: true` and appends `club-created` under a stream with
    // threads still behind it.
    const merged = mergeClubTimeline(
      sources({
        club: { created_at: '2020-01-01T00:00:00Z', owner_id: 'u1' },
        threads: {
          rows: [thread('t1', '2026-08-20T10:00:00Z'), thread('t2', '2026-08-19T10:00:00Z')],
          horizon: '2026-08-19T10:00:00Z',
        },
      })
    )

    // Nothing was dropped by either cut — which is precisely why the old
    // expression could not tell this stream from a finished one.
    expect(merged.events.filter((event) => event.kind !== 'club-created')).toHaveLength(2)
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

  it('draws ONE row for a busy thread, at its newest activity', () => {
    // PD-439's report, as one assertion. A thread begun three weeks ago and
    // busy this morning used to draw TWO rows — `reply:m1` at the top and
    // `thread:t1` three weeks down — and the product owner read that as the
    // same conversation listed twice.
    //
    // **The old test asserted exactly the opposite and its reasoning was
    // sound**: dating "ana started a thread" to today is a small lie, so the
    // reply got its own entry. What it missed is that the lead answers that
    // objection more cheaply than a second row does — a bumped row reads
    // "ana replied" — and that the thread's own row already carried the count
    // and the faces summarising the reply row beside it.
    const merged = eventsOf(
      sources({
        threads: {
          rows: [thread('t1', '2026-08-22T10:00:00Z', '2026-08-01T10:00:00Z')],
          horizon: null,
        },
        replies: { rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')], horizon: null },
      })
    )

    expect(merged.map((event) => event.key)).toEqual(['thread:t1'])
    expect(merged[0].at).toBe('2026-08-22T10:00:00Z')
    expect(merged[0].kind === 'thread' && merged[0].latestReply?.id).toBe('m1')
  })

  it('leaves a thread nobody replied to exactly where it was', () => {
    // The negative case the whole design is sized around: `last_activity_at`
    // defaults to the thread's creation, so an unanswered thread must not move.
    const merged = eventsOf(
      sources({
        threads: { rows: [thread('t1', '2026-08-01T10:00:00Z')], horizon: null },
        joins: { rows: [join('u1', '2026-08-05T10:00:00Z')], horizon: null },
      })
    )

    expect(merged.map((event) => event.key)).toEqual(['join:u1', 'thread:t1'])
    expect(merged[1].at).toBe('2026-08-01T10:00:00Z')
    expect(merged[1].kind === 'thread' && merged[1].latestReply).toBe(null)
  })

  it('marks the thread row unread off the thread id', () => {
    // `club_thread_unread` answers per thread. This was two assertions before
    // `116` — one per event kind — and the one that mattered was the reply's,
    // because a row keyed on the message id would never have found the map.
    const merged = eventsOf(
      sources({
        threads: { rows: [thread('t1', '2026-08-22T10:00:00Z')], horizon: null },
        replies: { rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')], horizon: null },
        unread: { t1: true },
      })
    )

    expect(merged.map((event) => event.kind === 'thread' && event.unread)).toEqual([true])
  })

  it('does NOT cut the stream on the reply source horizon', () => {
    // `116` took the reply horizon out of the merge's horizon list, because a
    // source that draws no row cannot claim the stream's picture stops
    // anywhere. Before it, a club with one busy thread reported a
    // two-hundred-message horizon and cut its own rides, postcards and joins
    // beneath it — for entries the timeline no longer draws at all.
    const timeline = mergeClubTimeline(
      sources({
        postcards: { rows: [postcard('p1', '2026-01-02T10:00:00Z')], horizon: null },
        threads: { rows: [thread('t1', '2026-08-22T10:00:00Z')], horizon: null },
        replies: {
          rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')],
          horizon: '2026-08-21T10:00:00Z',
        },
      })
    )

    expect(timeline.complete).toBe(true)
    expect(timeline.events.map((event) => event.kind)).toContain('club-created')
    // The January postcard is the damage this is really about: the reply
    // horizon used to drop it.
    expect(timeline.events.map((event) => event.kind)).toContain('postcard')
  })

  it('keeps ONE row when a bumped thread is held in two paging windows at once', () => {
    // The cost of a row whose position moves — `newestPerThreadRow`. The
    // accumulated thread source is several windows folded together, and the
    // fold is silent outside each window's own interval, so a thread paged to
    // deep and then replied to survives at BOTH stamps. Two rows for one
    // conversation under one React key is the exact defect this story fixes,
    // reintroduced by paging, and nothing else in the repo can see it.
    const merged = eventsOf(
      sources({
        threads: {
          rows: [
            thread('t1', '2026-08-01T10:00:00Z'),
            thread('t1', '2026-08-22T10:00:00Z', '2026-08-01T10:00:00Z'),
          ],
          horizon: null,
        },
      })
    )

    expect(merged.map((event) => event.key)).toEqual(['thread:t1'])
    // The FRESHER stamp wins — the window that saw the reply is the one telling
    // the truth. Order is not relied on: the fold puts the stale copy first.
    expect(merged[0].at).toBe('2026-08-22T10:00:00Z')
  })

  it('spends the reply read\'s horizon on the COUNT, never on the cut', () => {
    // **This test used to assert the opposite, and both versions are about the
    // same measurement.** `getClubThreadReplies` declares how far back it
    // LOOKED rather than where its surviving row sits — the defect that made a
    // sixty-message argument claim the club's picture stopped an hour ago. That
    // horizon was then used to cut the stream, and this case pinned the cut.
    //
    // `116` (PD-439) kept the measurement and changed what it buys. The reply
    // source draws no row now, so cutting four other sources on its bound would
    // drop a June ride over the message volume of a thread nobody is looking at
    // — the very over-cutting the old defect caused, arriving by a different
    // route. The bound instead decides whether the count on the row is exact,
    // which is the only thing it can honestly speak to.
    const merged = mergeClubTimeline(
      sources({
        threads: {
          rows: [thread('t1', '2026-08-22T10:00:00Z', '2026-08-01T10:00:00Z')],
          horizon: null,
        },
        replies: {
          rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')],
          horizon: '2026-08-15T10:00:00Z',
        },
        activity: { t1: { messages: 12, participants: [], partial: false } },
        rides: {
          rows: [ride('r1', '2026-08-18T10:00:00Z'), ride('r2', '2026-06-01T10:00:00Z')],
          horizon: null,
        },
      })
    )

    // The June ride survives — under the old rule it was cut.
    expect(merged.events.map((event) => event.key)).toEqual([
      'thread:t1',
      'ride:r1',
      'ride:r2',
      'club-created:owner',
    ])
    expect(merged.complete).toBe(true)
    // And the bound is not discarded: it is what makes the count a floor.
    const event = merged.events.find((e) => e.kind === 'thread')
    expect(event?.kind === 'thread' && event.activity?.partial).toBe(true)
  })

  it('renders a thread CREATION\'s reply count as exact, never as a floor', () => {
    // The horizon is what makes this true rather than optimistic: the stream is
    // cut at the newest source horizon, and the reply source's is the oldest
    // message it read — so a creation row that survives the cut was created
    // after that instant and every one of its replies is inside the window.
    // Carrying the window's `partial` here renders `2+ replies` on a thread
    // that has exactly two.
    const merged = eventsOf(
      sources({
        threads: { rows: [thread('t1', '2026-08-04T10:00:00Z')], horizon: null },
        activity: { t1: { messages: 2, participants: [], partial: true } },
      })
    )

    const event = merged.find((e) => e.kind === 'thread')
    expect(event?.kind === 'thread' && event.activity?.partial).toBe(false)
    expect(event?.kind === 'thread' && event.activity?.messages).toBe(2)
  })

  // PD-375, `design.md` §D5, task 1.6 — exact-versus-floor moved out of the
  // accumulation and into this function, derived from the reply source's
  // ACCUMULATED horizon and the thread's own creation date rather than
  // latched at collapse time. The old version of this test set
  // `replies.horizon: null` and still expected a floor, which the new rule
  // makes definitionally wrong: a `null` reply horizon means the reply source
  // has read to the club's beginning, so nothing of any thread can be outside
  // it and every count IS exact. These four replace it.
  it('renders a floor for a BUMPED thread that predates the reply horizon', () => {
    // **The trap `116` created, and the reason `resolveThreadCountExactness`
    // takes `created_at` rather than the row's own `at`.** This thread is drawn
    // at 08-22 because somebody replied this morning; it was STARTED on 08-01,
    // and the reply window only reaches back to 08-15, so twelve is a floor.
    // Feeding the row's `at` into the exactness test — the obvious tidy-up now
    // that the two are on the same row — reads 08-22 >= 08-15 and prints `12`
    // as a total. It lies in the direction nothing can catch: the number looks
    // more precise, not less.
    const merged = eventsOf(
      sources({
        threads: {
          rows: [thread('t1', '2026-08-22T10:00:00Z', '2026-08-01T10:00:00Z')],
          horizon: null,
        },
        replies: { rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')], horizon: '2026-08-15T10:00:00Z' },
        activity: { t1: { messages: 12, participants: [], partial: true } },
      })
    )

    const event = merged.find((e) => e.kind === 'thread')
    expect(event?.kind === 'thread' && event.activity?.partial).toBe(true)
  })

  it('renders exact for a thread created at or after the reply horizon', () => {
    const merged = eventsOf(
      sources({
        threads: { rows: [thread('t1', '2026-08-20T10:00:00Z')], horizon: null },
        replies: { rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')], horizon: '2026-08-15T10:00:00Z' },
        activity: { t1: { messages: 12, participants: [], partial: true } },
      })
    )

    const event = merged.find((e) => e.kind === 'thread')
    expect(event?.kind === 'thread' && event.activity?.partial).toBe(false)
  })

  it('improves a floor to exact once the reply source\'s accumulated horizon clears — the same thread, before and after', () => {
    const bumped = thread('t1', '2026-08-22T10:00:00Z', '2026-08-01T10:00:00Z')
    const stillPaging = eventsOf(
      sources({
        threads: { rows: [bumped], horizon: null },
        replies: { rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')], horizon: '2026-08-15T10:00:00Z' },
        activity: { t1: { messages: 12, participants: [], partial: true } },
      })
    )
    const reachedFounding = eventsOf(
      sources({
        threads: { rows: [bumped], horizon: null },
        replies: { rows: [reply('m1', '2026-08-22T10:00:00Z', 't1')], horizon: null },
        activity: { t1: { messages: 12, participants: [], partial: true } },
      })
    )

    const floorEvent = stillPaging.find((e) => e.kind === 'thread')
    expect(floorEvent?.kind === 'thread' && floorEvent.activity?.partial).toBe(true)

    const exactEvent = reachedFounding.find((e) => e.kind === 'thread')
    expect(exactEvent?.kind === 'thread' && exactEvent.activity?.partial).toBe(false)
    expect(exactEvent?.kind === 'thread' && exactEvent.activity?.messages).toBe(12)
  })

  it('is empty for a club with nothing in it', () => {
    expect(eventsOf(sources())).toEqual([])
  })
})

/**
 * `092` (PD-356) added two wave tables and NOTHING to this file's function —
 * `mergeClubTimeline` is task 8.4's "unchanged", pinned rather than merely
 * true by omission. The regression this guards: a wave read acquiring a
 * `horizon` field and being folded into the `horizons` array above, which
 * would let a DECORATION on an entry — never a source of one — truncate the
 * stream it is meant only to decorate. `attachClubWaveState` (`lib/data/
 * club-waves.ts`) declares no `TimelineSource` and contributes no
 * `ClubTimelineEvent`, so `ClubTimelineSources` itself is the thing this
 * pins: it still has exactly the five source keys `sources()` has always
 * built, plus `club`, `unread` and `activity`, never a sixth `waves` key.
 */
describe('mergeClubTimeline stays undecorated after club-timeline-engagement (092)', () => {
  it('the sources object carries no sixth "waves" source', () => {
    expect(Object.keys(sources()).sort()).toEqual(
      ['activity', 'club', 'joins', 'postcards', 'replies', 'rides', 'threads', 'unread'].sort()
    )
  })

  it('a full JOIN source still sets the horizon that cuts the stream, unmoved by any wave decoration', () => {
    // The exact scenario `cuts the timeline at a full source's oldest row`
    // asserts above, restated here under this change's own name: nothing a
    // wave read could contribute reaches this call at all, so the cut is
    // still the join source's own horizon and nothing else's.
    const merged = mergeClubTimeline(
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

    expect(merged.events.map((event) => event.key)).toEqual(['join:u1', 'ride:r1', 'join:u2'])
    expect(merged.complete).toBe(false)
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

  it('gives a ride and a thread each their own block, out of the run', () => {
    // 2026-08-31: a ride draws a full `RideCard` under a label and a thread
    // draws its own row, so neither can sit inside the shared grey block. A
    // refactor that puts them back collects four events into one block and
    // screenshots plausibly — every row is still there, in the right order.
    const groups = groupClubTimeline([
      { kind: 'join', at: '4', key: 'j0', member: join('u0', '4') },
      { kind: 'ride', at: '3', key: 'r0', ride: ride('r0', '3') },
      {
        kind: 'thread',
        at: '2',
        key: 't0',
        thread: thread('t0', '2'),
        unread: false,
        activity: null,
        latestReply: null,
      },
      { kind: 'join', at: '1', key: 'j1', member: join('u1', '1') },
    ])

    expect(groups.map((group) => group.kind)).toEqual(['events', 'ride', 'thread', 'events'])
    expect(groups[0].kind === 'events' && groups[0].events).toHaveLength(1)
    expect(groups[3].kind === 'events' && groups[3].events).toHaveLength(1)
  })

  it('gives a replied-to thread the same block as a quiet one', () => {
    // One event kind since `116`, so what this pins is that a thread carrying a
    // reply is still routed OUT of the announcement run — the grouping must key
    // off the kind and not off whether the row has activity on it.
    const groups = groupClubTimeline([
      {
        kind: 'thread',
        at: '2',
        key: 't0',
        thread: thread('t0', '2'),
        unread: false,
        activity: { messages: 3, participants: [], partial: false },
        latestReply: reply('m0', '2', 't0'),
      },
    ])

    expect(groups.map((group) => group.kind)).toEqual(['thread'])
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
    author: { id: 'ana', username: 'ana' } as PublicProfile,
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

/**
 * `absorbClubTimelineWindow` — PD-375, `design.md` §D0. The one function the
 * whole paging model rests on: it decides which rows a fresh window replaces,
 * which it may not touch, and where the accumulated horizon lands. A stream
 * assembled from windows with a hole in it is still a well-ordered array of
 * valid events, so this is exactly the class of defect `tsc`, ESLint and
 * `next build` cannot see — the same reason `club-timeline.test.ts` exists at
 * all.
 *
 * **Verified both ways per CLAUDE.md §Working Principles**: replacing the
 * absorb with plain concatenation fails 'drops a row missing from the
 * covered interval' (the stale row would survive instead), and treating the
 * exclusive postcard bound as inclusive fails the boundary-retention case
 * below (the accumulated row at the boundary instant would be dropped instead
 * of kept).
 */
describe('absorbClubTimelineWindow', () => {
  const row = (id: string, at: string) => ({ id, at })
  const at = (row: { at: string }) => row.at
  const rowId = (row: { id: string }) => row.id

  function window(
    rows: { id: string; at: string }[],
    over: { horizon?: string | null; until?: string | null; untilInclusive?: boolean } = {}
  ) {
    return {
      rows,
      horizon: over.horizon ?? null,
      until: over.until ?? null,
      untilInclusive: over.untilInclusive ?? true,
    }
  }

  it('extends coverage with a deeper window and supplies the shared boundary row exactly once', () => {
    const accumulated = { rows: [row('a', '2026-08-10')], horizon: '2026-08-10' }
    const deeper = window(
      [row('a', '2026-08-10'), row('b', '2026-08-05'), row('c', '2026-08-01')],
      { horizon: '2026-08-01', until: '2026-08-10', untilInclusive: true }
    )

    const { source, removed } = absorbClubTimelineWindow(accumulated, deeper, at, rowId)

    expect(source.rows.map(rowId).sort()).toEqual(['a', 'b', 'c'])
    expect(source.horizon).toBe('2026-08-01')
    expect(removed).toBe(false)
  })

  it('a window that came back short of its own bound imposes no horizon — null wins over the accumulated value', () => {
    const accumulated = { rows: [row('a', '2026-08-10')], horizon: '2026-08-10' }
    const shortDeeper = window([row('b', '2026-08-05')], {
      horizon: null,
      until: '2026-08-10',
      untilInclusive: true,
    })

    const { source } = absorbClubTimelineWindow(accumulated, shortDeeper, at, rowId)

    expect(source.horizon).toBe(null)
  })

  it('a refetched first window whose horizon moved UP keeps the rows beneath it and keeps the deep horizon', () => {
    // The rider has already paged to 2026-06-01; a new row pushed the first
    // window's own horizon up to 2026-08-10. There must be no hole between
    // the two.
    const accumulated = { rows: [row('deep', '2026-06-01')], horizon: '2026-06-01' }
    const refetchedFirst = window([row('new', '2026-08-20')], {
      horizon: '2026-08-10',
      until: null,
      untilInclusive: true,
    })

    const { source, removed } = absorbClubTimelineWindow(accumulated, refetchedFirst, at, rowId)

    expect(source.rows.map(rowId).sort()).toEqual(['deep', 'new'])
    expect(source.horizon).toBe('2026-06-01')
    expect(removed).toBe(false)
  })

  it('drops an accumulated row missing from the covered interval and reports it as removed', () => {
    const accumulated = {
      rows: [row('a', '2026-08-10'), row('b', '2026-08-05')],
      horizon: '2026-08-01',
    }
    // The window's own interval is [2026-08-05, +inf) — `b` sits exactly on
    // the floor and this window did not return it, so it was removed (a
    // block, a hide, a deletion) rather than merely un-fetched.
    const refetchedFirst = window([row('a', '2026-08-10')], {
      horizon: '2026-08-05',
      until: null,
      untilInclusive: true,
    })

    const { source, removed } = absorbClubTimelineWindow(accumulated, refetchedFirst, at, rowId)

    expect(source.rows.map(rowId)).toEqual(['a'])
    expect(removed).toBe(true)
  })

  it('keeps an accumulated row OUTSIDE the interval untouched, and does not report it as removed', () => {
    const accumulated = { rows: [row('old', '2026-06-01'), row('a', '2026-08-10')], horizon: '2026-06-01' }
    const refetchedFirst = window([row('a', '2026-08-10')], {
      horizon: '2026-08-10',
      until: null,
      untilInclusive: true,
    })

    const { source, removed } = absorbClubTimelineWindow(accumulated, refetchedFirst, at, rowId)

    expect(source.rows.map(rowId).sort()).toEqual(['a', 'old'])
    expect(removed).toBe(false)
  })

  it('an EXCLUSIVE until retains the accumulated row at the boundary instant; an INCLUSIVE one replaces it', () => {
    const accumulated = { rows: [row('boundary', '2026-08-10')], horizon: '2026-08-01' }

    const exclusive = window([row('older', '2026-08-05')], {
      horizon: '2026-08-05',
      until: '2026-08-10',
      untilInclusive: false,
    })
    const { source: keptBoundary } = absorbClubTimelineWindow(accumulated, exclusive, at, rowId)
    expect(keptBoundary.rows.map(rowId).sort()).toEqual(['boundary', 'older'])

    const inclusive = window([row('older', '2026-08-05')], {
      horizon: '2026-08-05',
      until: '2026-08-10',
      untilInclusive: true,
    })
    const { source: replacedBoundary, removed } = absorbClubTimelineWindow(accumulated, inclusive, at, rowId)
    expect(replacedBoundary.rows.map(rowId)).toEqual(['older'])
    expect(removed).toBe(true)
  })
})

/**
 * `absorbClubReplyWindow` — `design.md` §D5. Needs its own absorb because it
 * carries `activity` alongside `rows`: a thread's message count is the SUM of
 * its per-window counts, derived from the whole window list rather than
 * accumulated in place, which is what keeps a refetched first window from
 * double-counting.
 *
 * **Verified both ways**: taking the newest window's count instead of summing
 * fails 'sums a thread's message count across two windows' — it would report
 * the shallower window's count alone.
 */
describe('absorbClubReplyWindow', () => {
  function replyWindow(
    rows: ClubThreadReply[],
    activity: Record<string, { messages: number; participants: PublicProfile[]; partial: boolean }>,
    over: { horizon?: string | null; until?: string | null } = {}
  ) {
    return {
      rows,
      activity,
      horizon: over.horizon ?? null,
      until: over.until ?? null,
      untilInclusive: true,
    }
  }

  it('sums a thread\'s message count across two windows', () => {
    const shallow = replyWindow([reply('m2', '2026-08-10T00:00:00Z', 't1')], {
      t1: { messages: 5, participants: [], partial: false },
    })
    const deep = replyWindow(
      [reply('m1', '2026-08-01T00:00:00Z', 't1')],
      { t1: { messages: 3, participants: [], partial: false } },
      { horizon: '2026-08-01T00:00:00Z', until: '2026-08-05T00:00:00Z' }
    )

    const result = absorbClubReplyWindow([shallow, deep])

    expect(result.activity.t1.messages).toBe(8)
  })

  it('unions participants in shallowest-window-first order', () => {
    const bram = { id: 'bram', username: 'bram' } as PublicProfile
    const ana = { id: 'ana', username: 'ana' } as PublicProfile
    const shallow = replyWindow([reply('m2', '2026-08-10T00:00:00Z', 't1')], {
      t1: { messages: 1, participants: [bram], partial: false },
    })
    const deep = replyWindow(
      [reply('m1', '2026-08-01T00:00:00Z', 't1')],
      { t1: { messages: 1, participants: [ana], partial: false } },
      { horizon: '2026-08-01T00:00:00Z', until: '2026-08-05T00:00:00Z' }
    )

    const result = absorbClubReplyWindow([shallow, deep])

    expect(result.activity.t1.participants.map((p) => p.id)).toEqual(['bram', 'ana'])
  })

  it('does not double a count when the first window is refetched — recomputed from the window list, not accumulated in place', () => {
    const before = replyWindow([reply('m2', '2026-08-10T00:00:00Z', 't1')], {
      t1: { messages: 5, participants: [], partial: false },
    })
    // The refetch REPLACES windows[0] entirely, matching how a shared
    // `useQuery` key's latest data is used every render.
    const after = replyWindow([reply('m2', '2026-08-10T00:00:00Z', 't1'), reply('m3', '2026-08-11T00:00:00Z', 't1')], {
      t1: { messages: 6, participants: [], partial: false },
    })

    expect(absorbClubReplyWindow([before]).activity.t1.messages).toBe(5)
    expect(absorbClubReplyWindow([after]).activity.t1.messages).toBe(6)
  })

  it('a saturated FIRST window keeps its OWN horizon — folding must not start from a fake empty accumulator', () => {
    // A club busy enough that its very first reply window saturates, with no
    // deeper window fetched yet (PD-375's whole reason to exist: a busy
    // club's first page is short of the truth). `foldWindows`'
    // (`ClubTimeline.tsx`) sibling for the other four sources shares this
    // exact seed and the exact bug — this is the one half of the pair that is
    // exported and can be pinned directly.
    const firstWindow = replyWindow([reply('m1', '2026-08-10T00:00:00Z', 't1')], {
      t1: { messages: 60, participants: [], partial: true },
    }, { horizon: '2026-08-01T00:00:00Z', until: null })

    const result = absorbClubReplyWindow([firstWindow])

    // Verified both ways per CLAUDE.md §Working Principles: the code this
    // replaces folds every window — including the first — through
    // `absorbClubTimelineWindow` starting from `{ rows: [], horizon: null }`.
    // Since that function's own rule is "null wins", the empty seed's horizon
    // beats the first window's real one on the very first fold, and every
    // later fold inherits the poisoned `null` too (`accumulated.horizon ===
    // null` short-circuits `absorbClubTimelineWindow`'s min forever after).
    // A club whose first window saturates would report `complete: true` and
    // draw the club-created floor entry under content it never saw.
    expect(result.horizon).toBe('2026-08-01T00:00:00Z')
  })

  it('dedups a boundary message both windows independently collapsed to', () => {
    const shallow = replyWindow([reply('boundary', '2026-08-05T00:00:00Z', 't1')], {
      t1: { messages: 1, participants: [], partial: false },
    }, { horizon: '2026-08-05T00:00:00Z', until: null })
    const deep = replyWindow([reply('boundary', '2026-08-05T00:00:00Z', 't1')], {
      t1: { messages: 1, participants: [], partial: false },
    }, { horizon: '2026-08-01T00:00:00Z', until: '2026-08-05T00:00:00Z' })

    const result = absorbClubReplyWindow([shallow, deep])

    expect(result.rows.filter((row) => row.id === 'boundary')).toHaveLength(1)
  })
})

/**
 * `pendingClubTimelineSources` — `design.md` §D0's per-source guard. A stream-
 * wide verdict cannot decide which reads to issue, because a source with a
 * `null` horizon has read to the club's beginning, and asking it for `until:
 * null` re-reads page one rather than reaching older rows.
 */
describe('pendingClubTimelineSources', () => {
  it('excludes a source whose accumulated horizon is null', () => {
    expect(pendingClubTimelineSources(sources())).not.toContain('rides')
  })

  it('includes a source that is still saturated', () => {
    const pending = pendingClubTimelineSources(
      sources({
        rides: { rows: [ride('r1', '2026-08-01T00:00:00Z')], horizon: '2026-08-01T00:00:00Z' },
      })
    )
    expect(pending).toContain('rides')
  })

  it('is empty when every source has gone short — the stream is complete and no step can fetch', () => {
    expect(pendingClubTimelineSources(sources())).toEqual([])
  })

  it('names only the one source still saturated when four of five have gone short', () => {
    const pending = pendingClubTimelineSources(
      sources({
        joins: { rows: [join('u1', '2026-08-01T00:00:00Z')], horizon: '2026-08-01T00:00:00Z' },
      })
    )
    expect(pending).toEqual(['joins'])
  })
})

/**
 * `resolveClubTimelineAdvance` — decides the TAIL, never which reads to
 * issue. `design.md` §D0 is explicit that conflating the two is what produces
 * the `until = null` defect: a stream-wide verdict cannot know which of the
 * five sources are still saturated.
 */
describe('resolveClubTimelineAdvance', () => {
  const timelineOf = (count: number, complete: boolean): ClubTimeline => ({
    events: Array.from({ length: count }, (_, i) => ({
      kind: 'join',
      at: `${i}`,
      key: `join:${i}`,
      member: join(`u${i}`, `${i}`),
    })),
    complete,
  })

  it('is complete when the stream is complete, regardless of the other arguments', () => {
    expect(resolveClubTimelineAdvance(timelineOf(0, true), 20, 10, 10)).toBe('complete')
  })

  it('raises the cap without fetching when the CAP is what cut', () => {
    expect(resolveClubTimelineAdvance(timelineOf(20, false), 20, 0, 10)).toBe('draw-more')
  })

  it('asks for a window when the HORIZON is what cut, below the ceiling', () => {
    expect(resolveClubTimelineAdvance(timelineOf(5, false), 20, 0, 10)).toBe('fetch-window')
  })

  it('is capped once the ceiling is already spent', () => {
    expect(resolveClubTimelineAdvance(timelineOf(5, false), 20, 10, 10)).toBe('capped')
  })
})

/**
 * `resolveClubTimelineTailState` — `design.md` §D2's four-row table, as a
 * pure decision so the priority between its rows (complete beats offline
 * beats failed/capped beats extendable) is one thing to read rather than
 * four `if`s assembled differently at each call site.
 */
describe('resolveClubTimelineTailState', () => {
  it('is complete when the stream is complete, regardless of connectivity or failure', () => {
    expect(resolveClubTimelineTailState(true, false, true, 'capped')).toBe('complete')
  })

  it('is offline when the device has no connectivity, even if a fetch also failed', () => {
    expect(resolveClubTimelineTailState(false, false, true, 'fetch-window')).toBe('offline')
  })

  it('is cannot-get-more on a failure while online', () => {
    expect(resolveClubTimelineTailState(false, true, true, 'fetch-window')).toBe('cannot-get-more')
  })

  it('is cannot-get-more once the ceiling is reached, even with no failure', () => {
    expect(resolveClubTimelineTailState(false, true, false, 'capped')).toBe('cannot-get-more')
  })

  it('is more-coming while online, unfailed and under the ceiling', () => {
    expect(resolveClubTimelineTailState(false, true, false, 'fetch-window')).toBe('more-coming')
    expect(resolveClubTimelineTailState(false, true, false, 'draw-more')).toBe('more-coming')
  })
})

/**
 * `chunkIds` — the bound that keeps a decoration read's `.in()` list from
 * growing with paging depth (`design.md` §D5, task 3.5/3.6).
 */
describe('chunkIds', () => {
  it('splits a list longer than the bound into several chunks, in order', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `id${i}`)
    expect(chunkIds(ids, 2)).toEqual([['id0', 'id1'], ['id2', 'id3'], ['id4']])
  })

  it('returns exactly one chunk for a list at or under the bound', () => {
    expect(chunkIds(['a', 'b'], 5)).toEqual([['a', 'b']])
  })

  it('returns no chunks for an empty list', () => {
    expect(chunkIds([], 5)).toEqual([])
  })
})
