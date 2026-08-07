import { describe, expect, it } from 'vitest'
import { groupMessages } from '@/lib/data/ride-messages'
import type { RideMessage } from '@/types'

const message = (
  id: string,
  authorId: string,
  createdAt: string
): RideMessage & { mine: boolean } => ({
  id,
  ride_id: 'ride-1',
  author_id: authorId,
  body: `message ${id}`,
  created_at: createdAt,
  author: null,
  mine: authorId === 'me',
})

describe('groupMessages', () => {
  it('has nothing to group in an empty thread', () => {
    expect(groupMessages([])).toEqual([])
  })

  it('starts a group and a day on the first message, always', () => {
    const [first] = groupMessages([message('a', 'rider-1', '2026-08-07T09:00:00Z')])
    expect(first.startsGroup).toBe(true)
    expect(first.startsDay).toBe(true)
  })

  it('runs consecutive messages from one rider together', () => {
    // The design's `Section`: the author name is drawn on the first of a run
    // and not repeated. Only the first message here should carry it.
    const grouped = groupMessages([
      message('a', 'rider-1', '2026-08-07T09:00:00Z'),
      message('b', 'rider-1', '2026-08-07T09:01:00Z'),
      message('c', 'rider-1', '2026-08-07T09:02:00Z'),
    ])
    expect(grouped.map((m) => m.startsGroup)).toEqual([true, false, false])
  })

  it('breaks the run when the author changes, and breaks it back', () => {
    const grouped = groupMessages([
      message('a', 'rider-1', '2026-08-07T09:00:00Z'),
      message('b', 'rider-2', '2026-08-07T09:01:00Z'),
      message('c', 'rider-1', '2026-08-07T09:02:00Z'),
    ])
    expect(grouped.map((m) => m.startsGroup)).toEqual([true, true, true])
  })

  it('starts a new group across a day boundary even from the same rider', () => {
    // The rule that is easy to get wrong: without it, a run spanning midnight
    // draws the author's name above the pre-midnight message only, leaving the
    // name on the far side of the day separator from the messages it labels.
    const grouped = groupMessages([
      message('a', 'rider-1', '2026-08-07T09:00:00Z'),
      message('b', 'rider-1', '2026-08-08T09:00:00Z'),
    ])
    expect(grouped.map((m) => m.startsDay)).toEqual([true, true])
    expect(grouped.map((m) => m.startsGroup)).toEqual([true, true])
  })

  it('splits the day in APP_TIME_ZONE, not in the runtime zone', () => {
    // The assertion the `TZ: 'UTC'` pin in vitest.config.ts exists to make
    // meaningful. Both instants are 7 August in UTC; in Europe/Amsterdam
    // (UTC+2 in August) the second is 08 August 00:30. A naive
    // `new Date(x).getDate()` comparison would call this one day and put no
    // separator between them, while the timestamps beside it — which ARE pinned
    // — would read 23:30 and 00:30. A separator that disagrees with the times
    // under it is worse than none.
    const grouped = groupMessages([
      message('a', 'rider-1', '2026-08-07T21:30:00Z'),
      message('b', 'rider-1', '2026-08-07T22:30:00Z'),
    ])
    expect(grouped.map((m) => m.startsDay)).toEqual([true, true])
  })

  it('leaves `mine` alone — it is resolved by the read, not by position', () => {
    const grouped = groupMessages([
      message('a', 'me', '2026-08-07T09:00:00Z'),
      message('b', 'rider-1', '2026-08-07T09:01:00Z'),
    ])
    expect(grouped.map((m) => m.mine)).toEqual([true, false])
  })

  it('carries `pending` through, so an optimistic row keeps its style', () => {
    const grouped = groupMessages([
      { ...message('a', 'me', '2026-08-07T09:00:00Z'), pending: true },
    ])
    expect(grouped[0].pending).toBe(true)
  })

  it('regroups a list that already carried flags — the optimistic-append case', () => {
    // The screen re-runs this over the fetched list plus whatever is in flight.
    // An optimistic message from the same rider as the last fetched one must
    // NOT start a group, and computing it over the fetched list alone would
    // have no way to know that.
    const grouped = groupMessages([
      message('a', 'me', '2026-08-07T09:00:00Z'),
      { ...message('b', 'me', '2026-08-07T09:00:30Z'), pending: true },
    ])
    expect(grouped.map((m) => m.startsGroup)).toEqual([true, false])
  })
})
