import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClubTimelineEventRow } from '@/components/clubs/ClubTimelineEventRow'
import type { ClubIntroductionState } from '@/lib/data/club-introductions'
import type { ClubJoin, ClubTimelineEvent } from '@/lib/data/club-timeline'

/**
 * `092`'s spec: *"the affordance SHALL be absent from their own join row, so
 * the refusal is not the first the rider hears of it."* The defect here is a
 * control that RENDERS when it should not — a self-wave, refused by `092`'s
 * WITH CHECK — so an assertion that something renders cannot see it,
 * `RideInviteJoin.test.tsx`'s own precedent for exactly this shape. Both
 * cases below assert an ABSENCE, and the second case is what proves the
 * first is testing the right thing: the identical row, for a DIFFERENT
 * viewer, draws both controls.
 *
 * **`097`, PD-365 replaced "Say welcome" (the ⋯ overflow) with the
 * introduction door and count, and this file's second block is what that
 * change needs asserted.** `club-introductions`' own spec: *"No door where
 * there is nothing behind it … a tap that cannot succeed SHALL NOT be
 * drawn."* An absence is invisible to a test that only checks something
 * rendered, so the join row's own suite has to assert the absence of the ⋯
 * trigger (removed entirely, regardless of any prop) and the absence of the
 * comment door where there is no introduction — this row has lost one
 * control and gained another, and a test covering only one direction would
 * pass on a half-finished redesign.
 */
const noop = async () => ({ error: null })

function joinEvent(userId: string, username: string): ClubTimelineEvent {
  const member: ClubJoin = {
    user_id: userId,
    role: 'member',
    joined_at: '2026-08-01T10:00:00Z',
    profile: { id: userId, username, avatar_url: null, avatar_path: null, bike_model: null },
  }
  return { kind: 'join', at: '2026-08-01T10:00:00Z', key: `join:${userId}`, member }
}

const wave = { state: { count: 2, waved: false }, onWave: noop, onUnwave: noop }
const introduction: ClubIntroductionState = { threadId: 'thread-1', commentCount: 3 }

describe('ClubTimelineEventRow — the wave control is absent, not disabled, on a self-join', () => {
  it('draws no wave for the viewer’s own join row', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} viewerId="rider-1" wave={wave} />
    )

    expect(html).not.toContain('aria-label="Wave, 2 waves"')
  })

  it('draws the wave for a fellow member’s join row — proving the row is capable of drawing it at all', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} viewerId="rider-2" wave={wave} />
    )

    expect(html).toContain('aria-label="Wave, 2 waves"')
  })

  it('draws the wave while the viewer id is still unresolved — "not yet known" defaults to "not self"', () => {
    const html = renderToStaticMarkup(<ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} wave={wave} />)

    expect(html).toContain('aria-label="Wave, 2 waves"')
  })

  it('keeps the wave present on the SAME viewer’s join row whether or not an introduction exists — the two states 8.3 asks for', () => {
    const withIntro = renderToStaticMarkup(
      <ClubTimelineEventRow
        event={joinEvent('rider-1', 'ana')}
        viewerId="rider-2"
        wave={wave}
        introduction={introduction}
      />
    )
    const without = renderToStaticMarkup(
      <ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} viewerId="rider-2" wave={wave} />
    )

    expect(withIntro).toContain('aria-label="Wave, 2 waves"')
    expect(without).toContain('aria-label="Wave, 2 waves"')
  })
})

describe('ClubTimelineEventRow — a club-created entry ignores the wave and introduction props entirely', () => {
  it('renders no wave control and no comment door on the founding row even when both are supplied', () => {
    const event: ClubTimelineEvent = {
      kind: 'club-created',
      at: '2020-01-01T00:00:00Z',
      key: 'club-created:owner-1',
      founder: 'pedro',
    }

    const html = renderToStaticMarkup(
      <ClubTimelineEventRow event={event} viewerId="rider-2" wave={wave} introduction={introduction} />
    )

    expect(html).not.toContain('aria-label="Wave, 2 waves"')
    expect(html).not.toContain('3 comments')
    expect(html).toContain('pedro created the club.')
  })
})

describe('ClubTimelineEventRow — the introduction door: present with one, absent with none', () => {
  it('has no ⋯ trigger at all any more, present or absent an introduction', () => {
    const withIntro = renderToStaticMarkup(
      <ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} viewerId="rider-2" introduction={introduction} />
    )
    const without = renderToStaticMarkup(
      <ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} viewerId="rider-2" />
    )

    // `092`'s "Say welcome" trigger carried both of these; neither survives
    // `097`'s redesign in any state.
    for (const html of [withIntro, without]) {
      expect(html).not.toContain('aria-haspopup="dialog"')
      expect(html).not.toContain('Options for')
    }
  })

  it('draws no comment icon, no count and no thread link where there is no introduction', () => {
    const html = renderToStaticMarkup(<ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} />)

    expect(html).not.toContain('href="/clubs/detail/thread')
    expect(html).not.toContain('comment')
  })

  it('draws the door and the exact count — no `+` — when an introduction exists', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} introduction={introduction} />
    )

    expect(html).toContain('href="/clubs/detail/thread?id=thread-1"')
    expect(html).toContain('3')
    expect(html).not.toContain('3+')
  })

  it('draws the door on the viewer’s OWN join row too — unlike the wave, reading your own introduction is allowed', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} viewerId="rider-1" introduction={introduction} />
    )

    expect(html).toContain('href="/clubs/detail/thread?id=thread-1"')
  })
})
