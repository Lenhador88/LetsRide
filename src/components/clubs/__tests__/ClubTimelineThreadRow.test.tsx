import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClubTimelineThreadRow } from '@/components/clubs/ClubTimelineThreadRow'
import type { ClubThreadActivity } from '@/lib/data/club-timeline'

/**
 * `097`, PD-365, task 7.6/8.4 — the reply count moved from words ("12+
 * replies") to a glyph and a bare number, and the floor mark has to survive
 * that move in BOTH directions.
 *
 * **The second case is the one that matters.** An implementer who re-derives
 * the rule from "mark it when the window filled" re-adds a `+` to a
 * thread-CREATION row, which `mergeClubTimeline` deliberately clears
 * (`withExactCount`) because a creation entry that survives the horizon cut
 * was created after it, so every one of its replies is inside the window and
 * the count is exact. A test asserting only the floor case (`12+` stays
 * `12+`) passes under both the correct behaviour and that regression, which
 * is why this file asserts the exact case too — reversing either one must
 * fail the corresponding test, verified by hand per CLAUDE.md §Working
 * Principles: forcing `partial: true` on the exact-count fixture fails the
 * "no mark" test below, and dropping the `+` from the floor fixture fails the
 * "keeps the mark" one.
 */
function activity(partial: boolean): ClubThreadActivity {
  return { messages: 12, participants: [], partial }
}

const baseProps = {
  threadId: 'thread-1',
  anchorKey: 'thread:thread-1',
  title: 'Sunday ride?',
  lead: 'Started by ana',
  at: '2026-08-01T10:00:00Z',
  unread: false,
}

describe('ClubTimelineThreadRow — the reply count is a glyph and a number, and the floor mark survives the redesign', () => {
  it('keeps the `+` on a PARTIAL (floor) count', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineThreadRow {...baseProps} activity={activity(true)} />
    )

    // The visible mark.
    expect(html).toContain('tabular-nums">12+<')
    // The words, still carried in the accessible name.
    expect(html).toContain('12+ replies')
  })

  it('draws NO `+` on an EXACT count — the thread-creation case `withExactCount` produces', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineThreadRow {...baseProps} activity={activity(false)} />
    )

    expect(html).toContain('tabular-nums">12<')
    expect(html).not.toContain('tabular-nums">12+<')
    expect(html).toContain('12 replies')
    expect(html).not.toContain('12+ replies')
  })

  it('draws no count at all for a thread with no replies', () => {
    const html = renderToStaticMarkup(<ClubTimelineThreadRow {...baseProps} activity={null} />)

    expect(html).not.toContain('tabular-nums')
  })
})

/**
 * `097`'s follow-up, PD-366 (`design.md` §D9, task 11.7). `anchorKey` is this
 * row's own DOM id AND its outbound link's return anchor — never the same
 * value as `threadId` for a REPLY entry, whose anchor names the message that
 * produced it rather than the thread it opens, which is why the prop is
 * required rather than derived from `threadId`.
 */
describe('ClubTimelineThreadRow — the row anchor, PD-366', () => {
  it('carries `anchorKey` as its own DOM id and as the link\'s return anchor, for a thread creation entry', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineThreadRow {...baseProps} anchorKey="thread:thread-1" activity={null} />
    )

    expect(html).toContain('id="thread:thread-1"')
    expect(html).toContain('href="/clubs/detail/thread?id=thread-1&amp;row=thread%3Athread-1"')
  })

  it('uses the REPLY\'s own anchor — a different id than the thread it links into', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineThreadRow {...baseProps} anchorKey="reply:message-9" activity={null} />
    )

    expect(html).toContain('id="reply:message-9"')
    expect(html).toContain('href="/clubs/detail/thread?id=thread-1&amp;row=reply%3Amessage-9"')
  })
})
