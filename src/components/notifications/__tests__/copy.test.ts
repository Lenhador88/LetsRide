import { describe, expect, it } from 'vitest'
import { notificationCopy } from '@/components/notifications/copy'
import type { NotificationRow, NotificationType } from '@/types'

const ORGANIZER = '11111111-1111-4111-8111-111111111111'
const CREW = '22222222-2222-4222-8222-222222222222'

function row(type: NotificationType, overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    type,
    created_at: '2026-08-12T09:00:00.000Z',
    read_at: null,
    actor: null,
    postcard: null,
    ride: { id: '44444444-4444-4444-8444-444444444444', title: 'Ardennes loop', organizer_id: ORGANIZER },
    club: { id: '55555555-5555-4555-8555-555555555555', name: 'Night Owls', avatar_path: null, avatar_url: null },
    ...overrides,
  }
}

/**
 * PD-129 widened the `ride_joined` fan-out from the organizer alone to the
 * whole crew, so one row now has two readers and the drawn string is true for
 * only one of them. These are the four combinations that decide which sentence
 * a reader gets, including the two where something is unknown.
 */
describe('ride_joined copy branches on the reader', () => {
  it('tells the organizer it is their ride', () => {
    expect(notificationCopy(row('ride_joined'), ORGANIZER)).toBe('joined your ride.')
  })

  it('tells the rest of the crew the drawn string', () => {
    expect(notificationCopy(row('ride_joined'), CREW)).toBe('joined a ride you also joined.')
  })

  it('does not claim the ride when the ride did not resolve', () => {
    expect(notificationCopy(row('ride_joined', { ride: null }), ORGANIZER)).toBe(
      'joined a ride you also joined.'
    )
  })

  /**
   * The trap this guard exists for: `row.ride?.organizer_id` is `undefined` for
   * an unresolvable ride, so a bare `===` against an undefined reader matches
   * and tells someone with no session that the ride is theirs.
   */
  it('does not match undefined against undefined', () => {
    expect(notificationCopy(row('ride_joined', { ride: null }), undefined)).toBe(
      'joined a ride you also joined.'
    )
  })

  it('falls back to the drawn string for a reader it cannot identify', () => {
    expect(notificationCopy(row('ride_joined'), undefined)).toBe('joined a ride you also joined.')
  })
})

describe('the other four types ignore the reader', () => {
  it.each([
    ['postcard_liked', 'liked your postcard.'],
    ['postcard_commented', 'commented on your postcard.'],
    ['ride_created_in_club', 'created a ride in Night Owls.'],
    ['club_joined', 'joined club Night Owls.'],
  ] as const)('%s', (type, expected) => {
    expect(notificationCopy(row(type), ORGANIZER)).toBe(expected)
    expect(notificationCopy(row(type), CREW)).toBe(expected)
    expect(notificationCopy(row(type), undefined)).toBe(expected)
  })

  it('names a generic club when the club did not resolve', () => {
    expect(notificationCopy(row('ride_created_in_club', { club: null }), CREW)).toBe(
      'created a ride in a club.'
    )
    expect(notificationCopy(row('club_joined', { club: null }), CREW)).toBe('joined club a club.')
  })
})

/**
 * PD-332 makes a `ride_invited` row **outlive its invite**: `090` drops `083`'s
 * retraction, so withdrawing an invitation no longer clears the notification it
 * wrote, and `036`'s uniqueness index then absorbs every re-send instead of
 * ringing the invitee's phone again.
 *
 * That trade is only safe while a row whose subject the reader can no longer
 * reach degrades to a sentence rather than to a crash or a lie. A withdrawn
 * invite to a PRIVATE ride is exactly that case — `private.can_read_ride` stops
 * answering yes the moment the invite is gone, so the join returns no ride and
 * this arm is what the invitee reads. Before `090` it was a rarity; it is now
 * the ordinary end state of every withdrawal.
 *
 * The row's destination degrades in the same breath and is not asserted here:
 * `NotificationsListItem`'s `describe` returns `href: null` for an unresolved
 * ride, so the row stops being a link rather than pointing at a screen the
 * reader would be refused. That is a null guard with its own comment beside it,
 * inside a component-local function; it is verified by reading rather than by a
 * test, and it is worth a look if this file ever grows a render.
 */
describe('the three invite types survive losing their ride', () => {
  it.each([
    ['ride_invited', 'invited you to a ride.'],
    ['ride_invite_accepted', 'accepted your invite to a ride.'],
    ['ride_invite_declined', 'declined your invite to a ride.'],
  ] as const)('%s degrades to a generic ride', (type, expected) => {
    expect(notificationCopy(row(type, { ride: null }), CREW)).toBe(expected)
  })

  it.each([
    ['ride_invited', 'invited you to Ardennes loop.'],
    ['ride_invite_accepted', 'accepted your invite to Ardennes loop.'],
    ['ride_invite_declined', 'declined your invite to Ardennes loop.'],
  ] as const)('%s names the ride when it did resolve', (type, expected) => {
    // The other half of the same guard: a fallback that had swallowed the title
    // outright would pass every case above and say "a ride" for ever.
    expect(notificationCopy(row(type), CREW)).toBe(expected)
  })
})
