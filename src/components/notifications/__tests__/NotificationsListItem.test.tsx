import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NotificationsListItem } from '@/components/notifications/NotificationsListItem'
import type { NotificationRow as NotificationRowData, NotificationType } from '@/types'

/**
 * `098`, PD-367's two new types, plus the one invariant that matters more than
 * either of them: an unknown type must degrade rather than crash.
 *
 * Markup, never pixels — `vitest.config.ts` is `environment: 'node'`, so
 * `renderToStaticMarkup` gives what a browser would parse and no layout at
 * all, matching `RideCard.test.tsx`. No `next/navigation` mock: neither new
 * type takes an actions element (`RideInviteActions`, `ClubJoinRequestActions`
 * and `ClubInviteActions` all stay unmounted for both), and this component
 * itself navigates through `next/link` and reads no router hook.
 */
const ACTOR = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'bo',
  avatar_url: null,
  avatar_path: null,
  bike_model: null,
}
const VIEWER = '22222222-2222-4222-8222-222222222222'
const THREAD = { id: '33333333-3333-4333-8333-333333333333', title: 'Sunday run' }

function row(
  type: NotificationType,
  overrides: Partial<NotificationRowData> = {}
): NotificationRowData {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    type,
    created_at: '2026-09-01T09:00:00.000Z',
    read_at: null,
    actor: ACTOR,
    postcard: null,
    ride: null,
    club: null,
    thread: THREAD,
    ...overrides,
  }
}

describe('NotificationsListItem — a reply or a wave opens the thread', () => {
  it('a reply names the actor, the copy, and links to the thread', () => {
    const html = renderToStaticMarkup(
      <NotificationsListItem row={row('club_thread_replied')} viewerId={VIEWER} />
    )
    expect(html).toContain('href="/clubs/detail/thread?id=33333333-3333-4333-8333-333333333333"')
    expect(html).toContain('>bo<')
    expect(html).toContain('replied to Sunday run.')
  })

  it('a wave links to the same thread, worded differently', () => {
    const html = renderToStaticMarkup(
      <NotificationsListItem row={row('club_thread_waved')} viewerId={VIEWER} />
    )
    expect(html).toContain('href="/clubs/detail/thread?id=33333333-3333-4333-8333-333333333333"')
    expect(html).toContain('waved at Sunday run.')
  })

  /**
   * The floor `design.md` §D10 names: the SELECT policy's `thread_id`
   * conjunct and this embed run the same predicate under the same reader, so
   * a returned row with `thread: null` should not occur in practice — but the
   * component must still degrade to an unlinked row rather than pointing at
   * the club, which is a screen the rider was never told about.
   */
  it('renders unlinked, not pointed at the club, when the thread does not resolve', () => {
    const html = renderToStaticMarkup(
      <NotificationsListItem row={row('club_thread_replied', { thread: null })} viewerId={VIEWER} />
    )
    expect(html).not.toContain('href=')
    expect(html).toContain('replied to your post.')
  })
})

describe('NotificationsListItem — an unknown type is the floor, not a crash', () => {
  it('renders the generic unlinked fallback rather than throwing', () => {
    // A type absent from both exhaustive switches — the state a bundle
    // already serving reaches the moment it meets a row of a type its own
    // build predates (`089`'s header, `design.md` §D11).
    const unknown = {
      ...row('club_thread_replied'),
      type: 'a_future_notification_type',
    } as unknown as NotificationRowData

    let html = ''
    expect(() => {
      html = renderToStaticMarkup(<NotificationsListItem row={unknown} viewerId={VIEWER} />)
    }).not.toThrow()

    expect(html).toContain('did something on LetsRide.')
    expect(html).not.toContain('href=')
  })
})
