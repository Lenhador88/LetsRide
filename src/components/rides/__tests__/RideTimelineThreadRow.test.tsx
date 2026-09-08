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
  // `116`, PD-439 — `null` is a thread nobody has replied to, which is what
  // every case below is about, so it keeps them asserting what they asserted
  // before the row grew a count.
  activity: null,
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

/**
 * The reply count — `116`, PD-439.
 *
 * **The property under test is that `partial` is never dropped**, which this
 * component's header called the defect worth preventing for as long as it had
 * no count at all. `12` and `12+` are different claims about the world, and a
 * refactor that "tidies" the `+` away is green under every other gate: the
 * number still renders, the row still lays out, and nothing in the repo knows
 * the difference. Verified in both directions — a partial count must carry the
 * `+` and an exact one must not.
 */
describe('RideTimelineThreadRow — the reply count and its floor, PD-439', () => {
  it('draws the exact count bare, and the bounded one with a +', () => {
    const exact = renderToStaticMarkup(
      <RideTimelineThreadRow {...baseProps} unread={false} activity={{ messages: 3, partial: false }} />
    )
    const floor = renderToStaticMarkup(
      <RideTimelineThreadRow {...baseProps} unread={false} activity={{ messages: 12, partial: true }} />
    )

    expect(exact).toContain('>3</span>')
    expect(exact).not.toContain('3+')
    expect(floor).toContain('12')
    expect(floor).toContain('+')
  })

  it('puts the count in the label as words, because the visible form is a glyph', () => {
    // Everything the eye reads here is `aria-hidden`, so a count that exists
    // only as an icon and a number reaches a screen reader not at all — the
    // same pairing `097` task 7.7 requires of the club's row.
    const one = renderToStaticMarkup(
      <RideTimelineThreadRow {...baseProps} unread={false} activity={{ messages: 1, partial: false }} />
    )
    const many = renderToStaticMarkup(
      <RideTimelineThreadRow {...baseProps} unread={false} activity={{ messages: 12, partial: true }} />
    )

    expect(one).toContain('aria-label="Sunday ride?, ana started this, 1 reply"')
    // Singular only when the number is exact: "1+ reply" would be wrong twice.
    const oneBounded = renderToStaticMarkup(
      <RideTimelineThreadRow {...baseProps} unread={false} activity={{ messages: 1, partial: true }} />
    )
    expect(oneBounded).toContain('1+ replies')
    expect(many).toContain('12+ replies')
  })

  it('draws no count at all for a thread nobody has replied to', () => {
    // `null` is zero replies, not a missing read — the row draws its lead alone
    // rather than a count of nothing.
    const html = renderToStaticMarkup(<RideTimelineThreadRow {...baseProps} unread={false} />)

    expect(html).not.toContain('tabular-nums')
    expect(html).toContain('aria-label="Sunday ride?, ana started this"')
  })
})
