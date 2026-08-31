import { describe, expect, it } from 'vitest'
import {
  groupClubTimeline,
  mergeClubTimeline,
  type ClubJoin,
  type ClubRideAnnouncement,
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
    rides: { rows: [], truncated: false },
    postcards: { rows: [], truncated: false },
    threads: { rows: [], truncated: false },
    joins: { rows: [], truncated: false },
    unread: {},
    ...over,
  }
}

describe('mergeClubTimeline', () => {
  it('interleaves all four kinds newest first', () => {
    const merged = eventsOf(
      sources({
        rides: { rows: [ride('r1', '2026-08-03T10:00:00Z')], truncated: false },
        postcards: { rows: [postcard('p1', '2026-08-04T10:00:00Z')], truncated: false },
        threads: { rows: [thread('t1', '2026-08-01T10:00:00Z')], truncated: false },
        joins: { rows: [join('u1', '2026-08-02T10:00:00Z')], truncated: false },
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
        rides: { rows: [upcoming], truncated: false },
        postcards: { rows: [postcard('p1', '2026-08-02T10:00:00Z')], truncated: false },
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
          truncated: true,
        },
        rides: {
          rows: [ride('r1', '2026-08-11T10:00:00Z'), ride('r2', '2026-06-01T10:00:00Z')],
          truncated: false,
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
          truncated: false,
        },
        rides: {
          rows: [ride('r1', '2026-08-11T10:00:00Z'), ride('r2', '2026-06-01T10:00:00Z')],
          truncated: false,
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
          truncated: true,
        },
        threads: {
          rows: [thread('t1', '2026-08-15T10:00:00Z'), thread('t2', '2026-07-01T10:00:00Z')],
          truncated: true,
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
        postcards: { rows: [], truncated: true },
        rides: { rows: [ride('r1', '2020-01-01T10:00:00Z')], truncated: false },
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
          truncated: false,
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
        rides: { rows: [ride('r1', at)], truncated: false },
        joins: { rows: [join('u1', at)], truncated: false },
      })
    )
    const second = eventsOf(
      sources({
        joins: { rows: [join('u1', at)], truncated: false },
        rides: { rows: [ride('r1', at)], truncated: false },
      })
    )

    expect(first.map((event) => event.key)).toEqual(second.map((event) => event.key))
  })

  it('marks a thread unread from the map, and reads a missing id as read', () => {
    const merged = eventsOf(
      sources({
        threads: {
          rows: [thread('t1', '2026-08-04T10:00:00Z'), thread('t2', '2026-08-03T10:00:00Z')],
          truncated: false,
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
        joins: { rows: [join('u1', '2020-01-01T00:00:00Z')], truncated: false },
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
          truncated: true,
        },
        // Older than the horizon the full join read sets, so the merge drops it
        // — which is what makes this stream incomplete.
        rides: { rows: [ride('r1', '2026-06-01T10:00:00Z')], truncated: false },
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
          truncated: false,
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

