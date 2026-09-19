import { describe, expect, it } from 'vitest'

import { routes } from '@/lib/routes'

import {
  BATCH_SIZE,
  SEND_CONCURRENCY,
  classifyApnsOutcome,
  classifyFcmOutcome,
  fcmErrorNamesToken,
  groupByDelivery,
  mapWithConcurrency,
  pathForPayload,
  resolveDeliveryOutcome,
  toApnsPayload,
  toFcmMessage,
  type PushClaimRow,
  type PushPayload,
} from '../../supabase/functions/push-notify/shape'

/**
 * `push-notify/shape.ts` — every decision the push sender makes.
 *
 * This file is the only reason `tsc` and Vitest see that module at all:
 * `tsconfig.json` excludes `supabase/functions`, so the sibling `index.ts` is
 * unchecked by every gate in the repo. The split, and this test holding the
 * other end of it, is copied from `search-places/shape.ts` +
 * `place-search-shape.test.ts`.
 *
 * **Two groups here are load-bearing rather than coverage.** The classifier
 * assertions, because task 3.16 names it as the thing most likely to be wrong
 * and its failure is silent — a transport error read as a dead token
 * unsubscribes every rider on whichever platform is having an outage, and
 * reports success while doing it. And `pathForPayload`, because it duplicates
 * `src/lib/routes.ts` by necessity (Deno cannot resolve the `@/` alias) and
 * nothing else would notice the two drifting apart.
 */

const payload = (over: Partial<PushPayload> = {}): PushPayload => ({
  id: 'n1',
  recipient_id: 'r1',
  type: 'postcard_liked',
  title: 'Sofia liked your postcard',
  body: 'Tap to see it',
  postcard_id: null,
  comment_id: null,
  ride_id: null,
  club_id: null,
  thread_id: null,
  ...over,
})

const claimRow = (over: Partial<PushClaimRow> = {}): PushClaimRow => ({
  delivery_id: 'd1',
  notification_id: 'n1',
  recipient_id: 'r1',
  installation_id: 'install-1',
  token: 'tok',
  platform: 'ios',
  ...over,
})

describe('classifyApnsOutcome', () => {
  it('reads a 200 as delivered', () => {
    expect(classifyApnsOutcome(200)).toBe('delivered')
  })

  it('reads the dead-token cases as device_gone', () => {
    expect(classifyApnsOutcome(410, 'Unregistered')).toBe('device_gone')
    expect(classifyApnsOutcome(400, 'BadDeviceToken')).toBe('device_gone')
    expect(classifyApnsOutcome(400, 'DeviceTokenNotForTopic')).toBe('device_gone')
  })

  it('reads a 410 with an unparseable body as device_gone on the status alone', () => {
    expect(classifyApnsOutcome(410, null)).toBe('device_gone')
    expect(classifyApnsOutcome(410)).toBe('device_gone')
  })

  /**
   * The assertion this whole file exists for. A 403 about our own signing key
   * arrives for EVERY device at once, and the word "token" is in its reason —
   * which is what makes it the tempting wrong entry on the dead-token list.
   */
  it('never reads a provider-key failure as a dead device token', () => {
    expect(classifyApnsOutcome(403, 'ExpiredProviderToken')).toBe('transport')
    expect(classifyApnsOutcome(403, 'InvalidProviderToken')).toBe('transport')
    expect(classifyApnsOutcome(403, 'MissingProviderToken')).toBe('transport')
  })

  it('reads an outage or a throttle as transport, never as a dead token', () => {
    expect(classifyApnsOutcome(429, 'TooManyRequests')).toBe('transport')
    expect(classifyApnsOutcome(500, 'InternalServerError')).toBe('transport')
    expect(classifyApnsOutcome(503, 'ServiceUnavailable')).toBe('transport')
  })

  it('defaults an unrecognised status to transport', () => {
    expect(classifyApnsOutcome(418, 'Teapot')).toBe('transport')
    expect(classifyApnsOutcome(400, 'PayloadTooLarge')).toBe('transport')
  })
})

describe('classifyFcmOutcome', () => {
  it('reads a 200 as delivered', () => {
    expect(classifyFcmOutcome(200)).toBe('delivered')
  })

  it('reads UNREGISTERED and NOT_FOUND as device_gone', () => {
    expect(classifyFcmOutcome(404, 'NOT_FOUND')).toBe('device_gone')
    expect(classifyFcmOutcome(404)).toBe('device_gone')
    expect(classifyFcmOutcome(400, 'UNREGISTERED')).toBe('device_gone')
  })

  /**
   * FCM returns `INVALID_ARGUMENT` both for a dead registration token and for a
   * malformed message — our own payload bug. The first time someone ships a bad
   * field, reading the whole status as `device_gone` deletes every token in the
   * batch and reports success.
   */
  it('splits INVALID_ARGUMENT on whether the error names the token', () => {
    expect(classifyFcmOutcome(400, 'INVALID_ARGUMENT', true)).toBe('device_gone')
    expect(classifyFcmOutcome(400, 'INVALID_ARGUMENT', false)).toBe('transport')
    // Unspecified is the safe direction.
    expect(classifyFcmOutcome(400, 'INVALID_ARGUMENT')).toBe('transport')
  })

  it('reads our own credential failures as transport', () => {
    expect(classifyFcmOutcome(401, 'UNAUTHENTICATED')).toBe('transport')
    expect(classifyFcmOutcome(403, 'PERMISSION_DENIED')).toBe('transport')
  })

  it('reads an outage or a throttle as transport', () => {
    expect(classifyFcmOutcome(429, 'RESOURCE_EXHAUSTED')).toBe('transport')
    expect(classifyFcmOutcome(503, 'UNAVAILABLE')).toBe('transport')
    expect(classifyFcmOutcome(500, 'INTERNAL')).toBe('transport')
  })
})

describe('fcmErrorNamesToken', () => {
  it('finds a violation naming the token field', () => {
    expect(
      fcmErrorNamesToken({
        error: {
          status: 'INVALID_ARGUMENT',
          details: [{ fieldViolations: [{ field: 'message.token' }] }],
        },
      }),
    ).toBe(true)
  })

  it('does not fire on a violation naming anything else', () => {
    expect(
      fcmErrorNamesToken({
        error: {
          status: 'INVALID_ARGUMENT',
          details: [{ fieldViolations: [{ field: 'message.android.priority' }] }],
        },
      }),
    ).toBe(false)
  })

  it('answers false for every unparseable shape, which routes to transport', () => {
    expect(fcmErrorNamesToken(null)).toBe(false)
    expect(fcmErrorNamesToken(undefined)).toBe(false)
    expect(fcmErrorNamesToken('not json')).toBe(false)
    expect(fcmErrorNamesToken({})).toBe(false)
    expect(fcmErrorNamesToken({ error: {} })).toBe(false)
    expect(fcmErrorNamesToken({ error: { details: 'nope' } })).toBe(false)
    expect(fcmErrorNamesToken({ error: { details: [{}] } })).toBe(false)
  })

  it('does not match a field that merely ends in something token-like', () => {
    expect(
      fcmErrorNamesToken({
        error: { details: [{ fieldViolations: [{ field: 'message.data.providerToken' }] }] },
      }),
    ).toBe(false)
  })
})

/**
 * The interlock. `pathForPayload` cannot import `src/lib/routes.ts` — Deno does
 * not resolve the `@/` alias, and pulling it in would drag Next's module graph
 * into an Edge Function — so the detail-route shape is written out twice. This
 * is the only thing that would notice the two diverging, and the symptom it
 * prevents is a push that opens the wrong screen or nothing at all, on a
 * device, weeks after the route changed.
 */
describe('pathForPayload agrees with the real routes helper', () => {
  it('sends the postcard types to the postcard', () => {
    for (const type of ['postcard_liked', 'postcard_commented']) {
      expect(pathForPayload(payload({ type, postcard_id: 'p1' }))).toBe(routes.postcard('p1'))
    }
  })

  it('sends every ride type to the ride', () => {
    for (const type of [
      'ride_joined',
      'ride_created_in_club',
      'ride_invited',
      'ride_invite_accepted',
      'ride_invite_declined',
    ]) {
      expect(pathForPayload(payload({ type, ride_id: 'ride1' }))).toBe(routes.ride('ride1'))
    }
  })

  it('sends the club types to the club', () => {
    for (const type of [
      'club_joined',
      'club_waved',
      'club_join_request_approved',
      'club_join_request_declined',
      'club_invited',
      'club_invite_declined',
    ]) {
      expect(pathForPayload(payload({ type, club_id: 'c1' }))).toBe(routes.club('c1'))
    }
  })

  it('sends a pending join request to the roster, not the club front page', () => {
    // The thing being reported is actionable only there.
    expect(pathForPayload(payload({ type: 'club_join_requested', club_id: 'c1' }))).toBe(
      routes.clubManage('c1'),
    )
  })

  it('sends the thread types to the THREAD id, not the club', () => {
    for (const type of ['club_thread_replied', 'club_thread_waved']) {
      expect(pathForPayload(payload({ type, thread_id: 't1' }))).toBe(routes.clubThread('t1'))
    }
  })

  it('escapes the id the same way the routes helper does', () => {
    const awkward = 'a b/c&d'
    expect(pathForPayload(payload({ type: 'postcard_liked', postcard_id: awkward }))).toBe(
      routes.postcard(awkward),
    )
  })

  it('answers null rather than a broken path when the subject is missing', () => {
    expect(pathForPayload(payload({ type: 'postcard_liked', postcard_id: null }))).toBeNull()
    expect(pathForPayload(payload({ type: 'club_thread_replied', thread_id: null }))).toBeNull()
  })

  it('answers null for an unknown type rather than guessing', () => {
    expect(pathForPayload(payload({ type: 'ride_upcoming', ride_id: 'r1' }))).toBeNull()
  })

  /**
   * Every type `notifications_type_check` admits has an arm. Measured against
   * DEV on 2026-09-19 — sixteen, not the five `036` shipped with. A new type
   * added without an arm here is a push that opens nothing; the SQL's own
   * `else` raises on unknown copy, but the path is this file's.
   */
  it('covers every live notification type', () => {
    const LIVE_TYPES: [string, Partial<PushPayload>][] = [
      ['postcard_liked', { postcard_id: 'x' }],
      ['postcard_commented', { postcard_id: 'x', comment_id: 'y' }],
      ['ride_joined', { ride_id: 'x' }],
      ['club_joined', { club_id: 'x' }],
      ['ride_created_in_club', { ride_id: 'x', club_id: 'y' }],
      ['ride_invited', { ride_id: 'x' }],
      ['ride_invite_accepted', { ride_id: 'x' }],
      ['ride_invite_declined', { ride_id: 'x' }],
      ['club_join_requested', { club_id: 'x' }],
      ['club_join_request_approved', { club_id: 'x' }],
      ['club_join_request_declined', { club_id: 'x' }],
      ['club_waved', { club_id: 'x' }],
      ['club_invited', { club_id: 'x' }],
      ['club_invite_declined', { club_id: 'x' }],
      ['club_thread_replied', { thread_id: 'x' }],
      ['club_thread_waved', { thread_id: 'x' }],
    ]
    expect(LIVE_TYPES).toHaveLength(16)
    for (const [type, subject] of LIVE_TYPES) {
      expect(pathForPayload(payload({ type, ...subject }))).not.toBeNull()
    }
  })
})

describe('the provider payloads', () => {
  it('renders an APNs alert and carries the deep-link path outside aps', () => {
    const body = toApnsPayload(payload({ postcard_id: 'p1' })) as {
      aps: {
        alert: { title: string; body: string }
        'content-available'?: number
        'thread-id'?: string
      }
      path?: string
    }
    expect(body.aps.alert).toEqual({
      title: 'Sofia liked your postcard',
      body: 'Tap to see it',
    })
    expect(body.path).toBe(routes.postcard('p1'))
    // A visible alert must not also be a background push: iOS delivers the
    // combination at background priority, which is how a push quietly stops
    // arriving promptly.
    expect(body.aps['content-available']).toBeUndefined()
    // And no `thread-id`: the only value available is unique per row, so
    // grouping by it is identical to not grouping.
    expect(body.aps['thread-id']).toBeUndefined()
  })

  it('omits the path entirely when there is no destination', () => {
    const body = toApnsPayload(payload({ postcard_id: null })) as { path?: string }
    expect('path' in body).toBe(false)
  })

  it('wraps FCM in the v1 message envelope, with string-valued data', () => {
    const message = toFcmMessage(payload({ postcard_id: 'p1' }), 'fcm-tok') as {
      message: { token: string; data: Record<string, unknown> }
    }
    expect(message.message.token).toBe('fcm-tok')
    for (const value of Object.values(message.message.data)) {
      expect(typeof value).toBe('string')
    }
  })

  it('carries no raw subject id beyond the path the rider taps', () => {
    // `push_payload_for` already decided what may leave the database; the
    // provider gets the rendered copy and a destination, not a row.
    const serialised = JSON.stringify(toApnsPayload(payload({ club_id: 'secret-club' })))
    expect(serialised).not.toContain('secret-club')
  })
})

describe('groupByDelivery', () => {
  it('collapses the claim cross-product into one entry per outbox row', () => {
    const grouped = groupByDelivery([
      claimRow({ delivery_id: 'd1', installation_id: 'i1' }),
      claimRow({ delivery_id: 'd1', installation_id: 'i2', platform: 'android' }),
      claimRow({ delivery_id: 'd2', notification_id: 'n2', installation_id: 'i3' }),
    ])
    expect(grouped).toHaveLength(2)
    expect(grouped[0].deliveryId).toBe('d1')
    expect(grouped[0].devices.map((d) => d.installation_id)).toEqual(['i1', 'i2'])
    expect(grouped[1].devices).toHaveLength(1)
  })

  it('answers an empty list rather than throwing', () => {
    expect(groupByDelivery([])).toEqual([])
  })
})

describe('resolveDeliveryOutcome', () => {
  it('is sent when any device took it, whatever the others did', () => {
    const verdict = resolveDeliveryOutcome([
      { installation_id: 'i1', outcome: 'delivered' },
      { installation_id: 'i2', outcome: 'transport' },
    ])
    expect(verdict.outcome).toBe('sent')
    expect(verdict.deliveredInstallations).toEqual(['i1'])
  })

  /**
   * A dead token is not a failed delivery. The notification was correctly
   * addressed and there is nothing further to do — `failed` would make an
   * ordinary app deletion indistinguishable from an outage in every count
   * built on this table, and `retry` would re-send to a device that is gone.
   */
  it('is sent, not failed, when every device is simply gone', () => {
    const verdict = resolveDeliveryOutcome([
      { installation_id: 'i1', outcome: 'device_gone' },
      { installation_id: 'i2', outcome: 'device_gone' },
    ])
    expect(verdict.outcome).toBe('sent')
    expect(verdict.deliveredInstallations).toEqual([])
    expect(verdict.deadInstallations).toEqual(['i1', 'i2'])
  })

  it('retries when nothing landed and something was a transport failure', () => {
    const verdict = resolveDeliveryOutcome([{ installation_id: 'i1', outcome: 'transport' }])
    expect(verdict.outcome).toBe('retry')
    expect(verdict.deadInstallations).toEqual([])
  })

  it('completes a recipient with no devices at all rather than failing', () => {
    // Task 3.10h. There is nothing to retry, ever.
    expect(resolveDeliveryOutcome([]).outcome).toBe('sent')
  })

  /**
   * The property the whole classifier exists to protect, asserted directly:
   * nothing but `device_gone` can ever reach `invalidate_push_device`.
   */
  it('never puts a transport failure in the list that deletes a token', () => {
    const verdict = resolveDeliveryOutcome([
      { installation_id: 'i1', outcome: 'transport' },
      { installation_id: 'i2', outcome: 'delivered' },
      { installation_id: 'i3', outcome: 'device_gone' },
      { installation_id: 'i4', outcome: 'transport' },
    ])
    expect(verdict.deadInstallations).toEqual(['i3'])
    expect(verdict.deliveredInstallations).toEqual(['i2'])
  })
})

describe('mapWithConcurrency', () => {
  it('visits every item exactly once', async () => {
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      seen.push(n)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('never exceeds the limit in flight', async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency(
      Array.from({ length: 30 }, (_, i) => i),
      4,
      async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight--
      },
    )
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('handles an empty list and a silly limit without hanging', async () => {
    await expect(mapWithConcurrency([], 10, async () => {})).resolves.toBeUndefined()
    const seen: number[] = []
    await mapWithConcurrency([1, 2], 0, async (n) => {
      seen.push(n)
    })
    expect(seen).toEqual([1, 2])
  })

  it('keeps the batch bounded and the concurrency well under it', () => {
    // `event-fanout-integrity`: bounded and not assumed small. And a burst of
    // the whole batch is the shape that earns a provider 429.
    expect(BATCH_SIZE).toBeGreaterThan(0)
    expect(BATCH_SIZE).toBeLessThanOrEqual(1000)
    expect(SEND_CONCURRENCY).toBeGreaterThan(1)
    expect(SEND_CONCURRENCY).toBeLessThan(BATCH_SIZE)
  })
})
