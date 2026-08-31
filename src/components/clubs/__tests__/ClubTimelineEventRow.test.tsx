import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClubTimelineEventRow } from '@/components/clubs/ClubTimelineEventRow'
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

describe('ClubTimelineEventRow — the wave control and "Say welcome" are absent, not disabled, on a self-join', () => {
  it('draws neither for the viewer’s own join row', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineEventRow
        event={joinEvent('rider-1', 'ana')}
        clubId="club-1"
        viewerId="rider-1"
        wave={wave}
      />
    )

    expect(html).not.toContain('aria-label="Wave, 2 waves"')
    expect(html).not.toContain('Options for ana')
  })

  it('draws both for a fellow member’s join row — proving the row is capable of drawing them at all', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineEventRow
        event={joinEvent('rider-1', 'ana')}
        clubId="club-1"
        viewerId="rider-2"
        wave={wave}
      />
    )

    expect(html).toContain('aria-label="Wave, 2 waves"')
    expect(html).toContain('Options for ana')
  })

  it('draws both while the viewer id is still unresolved — "not yet known" defaults to "not self"', () => {
    const html = renderToStaticMarkup(
      <ClubTimelineEventRow event={joinEvent('rider-1', 'ana')} clubId="club-1" wave={wave} />
    )

    expect(html).toContain('aria-label="Wave, 2 waves"')
    expect(html).toContain('Options for ana')
  })
})

describe('ClubTimelineEventRow — a club-created entry ignores the wave prop entirely', () => {
  it('renders no wave control on the founding row even when one is supplied', () => {
    const event: ClubTimelineEvent = {
      kind: 'club-created',
      at: '2020-01-01T00:00:00Z',
      key: 'club-created:owner-1',
      founder: 'pedro',
    }

    const html = renderToStaticMarkup(
      <ClubTimelineEventRow event={event} clubId="club-1" viewerId="rider-2" wave={wave} />
    )

    expect(html).not.toContain('aria-label="Wave, 2 waves"')
    expect(html).toContain('pedro created the club.')
  })
})
