import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RideTimelineThreadRow } from '@/components/rides/RideTimelineThreadRow'

/**
 * PD-426 — the unread dot's ONLY remaining home on a ride.
 *
 * **This file exists because the dot arrived by deletion, not by design.** It
 * lived on `RideThreadsButton` (the header's chat icon) and `RideThreadsRow`
 * (the labelled row on the ride plan) as a single aggregate mark. PD-426 deleted
 * both along with the thread index they pointed at, and moved the mark here, per
 * thread. Nothing else in the tree would notice if it were dropped again: the
 * row renders, the link works, the timeline is complete, and a rider is simply
 * never told a conversation has moved on. That is the regression this pins.
 *
 * Two assertions rather than one, and the second is the one that matters.
 *
 * **The dot is `aria-hidden` by construction** — every child of this row is, so
 * a screen reader reaches the row's `aria-label` and nothing else. An
 * implementer who renders the dot and forgets the label ships an unread state
 * that exists only as a coloured circle, which passes a "draws the dot" test.
 * `ClubTimelineThreadRow` composes its label the same way and for the same
 * reason.
 *
 * Verified both ways per `CLAUDE.md` §Working Principles, by mutation rather
 * than by reading: dropping `{unread && <NotificationDot …>}` fails the first
 * test only; dropping `unread ? 'unread messages' : null` from the label fails
 * the second only. So neither passes under the other's cover. The first test's
 * comment carries why that check was not a formality.
 */
const baseProps = {
  threadId: '11111111-2222-4333-8444-555555555555',
  anchorKey: 'thread:11111111-2222-4333-8444-555555555555',
  title: 'Sunday ride?',
  lead: 'ana started this',
  at: '2026-08-01T10:00:00Z',
}

describe('RideTimelineThreadRow — the unread dot, PD-426', () => {
  it('draws a dot on an unread thread and none on a read one', () => {
    const unread = renderToStaticMarkup(<RideTimelineThreadRow {...baseProps} unread />)
    const read = renderToStaticMarkup(<RideTimelineThreadRow {...baseProps} unread={false} />)

    // **Matched on the dot's own markup, and the first draft of this test was
    // not.** It asserted `unread !== read` plus a length comparison, which
    // passes with the dot DELETED — the `aria-label` below differs between the
    // two renders on its own, so both held against a row drawing no dot at all.
    // Measured, not reasoned: removing the element left this test green.
    // `NotificationDot` is a bare `<span>` with `bg-danger`, which is the one
    // token nothing else in this row carries.
    expect(unread).toContain('bg-danger')
    expect(read).not.toContain('bg-danger')
  })

  it('says "unread messages" in the label, because the dot itself is aria-hidden', () => {
    const unread = renderToStaticMarkup(<RideTimelineThreadRow {...baseProps} unread />)
    const read = renderToStaticMarkup(<RideTimelineThreadRow {...baseProps} unread={false} />)

    expect(unread).toContain('aria-label="Sunday ride?, ana started this, unread messages"')
    // The read row's label stops at the lead — no empty trailing clause, which
    // is what the `.filter(Boolean)` in the composition is for.
    expect(read).toContain('aria-label="Sunday ride?, ana started this"')
    expect(read).not.toContain('unread messages')
  })

  it('links to the thread itself, not to an index that no longer exists', () => {
    const html = renderToStaticMarkup(<RideTimelineThreadRow {...baseProps} unread={false} />)

    // PD-426 deleted `/rides/detail/threads`. A row still pointing at it would
    // render, and 404 on tap.
    expect(html).toContain(`href="/rides/detail/thread?id=${baseProps.threadId}"`)
    expect(html).not.toContain('/rides/detail/threads')
  })
})
