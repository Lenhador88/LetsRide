import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RideTimelineEventRow } from '@/components/rides/RideTimelineEventRow'
import type { RideJoin, RideTimelineEvent } from '@/lib/data/ride-timeline'

/**
 * The two announcement rows on a ride's timeline (PD-393), each pinned on the
 * one thing a refactor reverses in silence.
 *
 * - **A join names the rider and goes to them.** Nothing else in the row
 *   carries content, so a sentence that lost its subject would render as
 *   punctuation and every other gate would stay green.
 * - **The founding names nobody when the `profiles` policy hides the
 *   organizer, and still renders.** The opposite rule to the join, on the same
 *   screen: this entry is the floor of the whole stream, so dropping it would
 *   leave the timeline with no end. A test asserting only the happy path would
 *   pass on an implementation that dropped it.
 * - **The founding is not a link.** It is the one row whose destination would
 *   be the screen the rider is already on, and "renders as a link" is
 *   invisible to any assertion that only checks the text.
 *
 * Static markup under `environment: 'node'` — nothing here needs a layout or
 * an event, which is this repo's bar for reaching for jsdom.
 */
const RIDER = '22222222-2222-4222-8222-222222222222'
const ORGANIZER = '33333333-3333-4333-8333-333333333333'

function joinEvent(username: string | null): RideTimelineEvent {
  const member = {
    user_id: RIDER,
    status: 'going',
    joined_at: '2026-09-01T10:00:00Z',
    profile: { id: RIDER, username, avatar_url: null, avatar_path: null, bike_model: null },
  } as unknown as RideJoin
  return { kind: 'join', at: '2026-09-01T10:00:00Z', key: `join:${RIDER}`, member }
}

const planned = (organizer: string | null): RideTimelineEvent => ({
  kind: 'ride-planned',
  at: '2026-08-01T10:00:00Z',
  key: `ride-planned:${ORGANIZER}`,
  organizer,
})

describe('RideTimelineEventRow — a rider arriving', () => {
  it('names the rider and links to their profile', () => {
    const html = renderToStaticMarkup(<RideTimelineEventRow event={joinEvent('ana')} />)

    expect(html).toContain('ana joined the ride.')
    expect(html).toContain(`id=${RIDER}`)
  })

  /**
   * `going` and `maybe` read identically on purpose — `joined_at` records
   * arrival, not the current answer, so a sentence naming the status would be
   * a claim about the present made from a past timestamp. The crew rail one
   * section up is where the current answer lives.
   */
  it('says nothing about the RSVP itself', () => {
    const html = renderToStaticMarkup(<RideTimelineEventRow event={joinEvent('ana')} />)

    expect(html).not.toContain('going')
    expect(html).not.toContain('maybe')
  })
})

describe('RideTimelineEventRow — the ride being planned', () => {
  it('names the organizer when it can', () => {
    expect(renderToStaticMarkup(<RideTimelineEventRow event={planned('pedro')} />)).toContain(
      'pedro planned this ride.'
    )
  })

  it('still renders, subjectless, when the organizer cannot be named', () => {
    const html = renderToStaticMarkup(<RideTimelineEventRow event={planned(null)} />)

    expect(html).toContain('The ride was planned.')
  })

  /** A link back to the screen you are already on is worse than plain text —
   *  and this is the assertion that fails if the row is refactored into one
   *  anchor for every kind. */
  it('is not a link', () => {
    expect(renderToStaticMarkup(<RideTimelineEventRow event={planned('pedro')} />)).not.toContain(
      '<a'
    )
  })
})

describe('RideTimelineEventRow — the row carries the merge key as its DOM id', () => {
  /** What a return anchor would scroll to. Nothing reads it yet; the point of
   *  pinning it is that the id must be `mergeRideTimeline`'s own key rather
   *  than a second identity invented in the component. */
  it('uses the event key, not a key of its own', () => {
    expect(renderToStaticMarkup(<RideTimelineEventRow event={joinEvent('ana')} />)).toContain(
      `id="join:${RIDER}"`
    )
    expect(renderToStaticMarkup(<RideTimelineEventRow event={planned('pedro')} />)).toContain(
      `id="ride-planned:${ORGANIZER}"`
    )
  })
})
