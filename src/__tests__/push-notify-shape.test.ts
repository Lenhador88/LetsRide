import { describe, expect, it } from 'vitest'

import {
  BATCH_SIZE,
  MAX_ATTEMPTS,
  backoffMs,
  classifyApnsOutcome,
  classifyFcmOutcome,
  fcmErrorNamesToken,
  groupByPlatform,
  isFinalAttempt,
  nextDeliveryState,
  toApnsPayload,
  toFcmMessage,
  type PushClaim,
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
 * **The classifier assertions are the point of the file.** Task 3.16 names it
 * as the thing most likely to be wrong, and the failure it describes is silent:
 * a transport error read as a dead token unsubscribes every rider on whichever
 * platform is having an outage, and reports success while doing it. So each
 * classifier is asserted in BOTH directions — that the dead-token cases are
 * caught, and that the look-alike failures are NOT.
 */

const claim = (over: Partial<PushClaim> = {}): PushClaim => ({
  deliveryId: 'd1',
  notificationId: 'n1',
  attempts: 1,
  platform: 'ios',
  installationId: 'install-1',
  token: 'tok',
  title: 'Sofia liked your postcard',
  body: 'Tap to see it',
  path: '/postcards/p1',
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

describe('the retry bound', () => {
  it('backs off exponentially from a minute and stays bounded', () => {
    expect(backoffMs(1)).toBe(60_000)
    expect(backoffMs(2)).toBe(120_000)
    expect(backoffMs(3)).toBe(240_000)
    expect(backoffMs(4)).toBe(480_000)
  })

  it('clamps out-of-range attempts rather than returning a silly number', () => {
    expect(backoffMs(0)).toBe(backoffMs(1))
    expect(backoffMs(-3)).toBe(backoffMs(1))
    expect(backoffMs(99)).toBe(backoffMs(MAX_ATTEMPTS))
  })

  it('calls the last attempt final, and not the one before it', () => {
    expect(isFinalAttempt(MAX_ATTEMPTS - 1)).toBe(false)
    expect(isFinalAttempt(MAX_ATTEMPTS)).toBe(true)
    expect(isFinalAttempt(MAX_ATTEMPTS + 1)).toBe(true)
  })

  it('keeps the batch bounded, per event-fanout-integrity', () => {
    expect(BATCH_SIZE).toBeGreaterThan(0)
    expect(BATCH_SIZE).toBeLessThanOrEqual(1000)
  })
})

describe('nextDeliveryState', () => {
  it('completes a delivered row', () => {
    expect(nextDeliveryState('delivered', 1)).toEqual({
      state: 'sent',
      invalidateDevice: false,
      retryInMs: null,
    })
  })

  /**
   * A dead token is not a failed delivery. The notification was correctly
   * addressed and there is nothing further to do with it — marking the row
   * `failed` would make an ordinary app deletion indistinguishable from an
   * outage in every count anyone later builds on this table.
   */
  it('completes the row and invalidates the device when the token is gone', () => {
    expect(nextDeliveryState('device_gone', 1)).toEqual({
      state: 'sent',
      invalidateDevice: true,
      retryInMs: null,
    })
  })

  it('retries a transport failure while attempts remain, and never touches the device', () => {
    const retry = nextDeliveryState('transport', 1)
    expect(retry.state).toBe('pending')
    expect(retry.invalidateDevice).toBe(false)
    expect(retry.retryInMs).toBe(60_000)
  })

  it('gives up on the last attempt without invalidating the device', () => {
    const final = nextDeliveryState('transport', MAX_ATTEMPTS)
    expect(final.state).toBe('failed')
    expect(final.invalidateDevice).toBe(false)
    expect(final.retryInMs).toBeNull()
  })

  it('never invalidates a device on any transport outcome, at any attempt', () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS + 2; attempt++) {
      expect(nextDeliveryState('transport', attempt).invalidateDevice).toBe(false)
    }
  })
})

describe('the provider payloads', () => {
  it('renders an APNs alert and carries the deep-link path outside aps', () => {
    const payload = toApnsPayload(claim()) as {
      aps: {
        alert: { title: string; body: string }
        'content-available'?: number
        'thread-id'?: string
      }
      path: string
    }
    expect(payload.aps.alert).toEqual({
      title: 'Sofia liked your postcard',
      body: 'Tap to see it',
    })
    expect(payload.path).toBe('/postcards/p1')
    // A visible alert must not also be a background push: iOS delivers the
    // combination at background priority, which is how a push quietly stops
    // arriving promptly.
    expect(payload.aps['content-available']).toBeUndefined()
    // And no `thread-id`: the only value available here is unique per row, so
    // grouping by it is identical to not grouping. See `toApnsPayload`.
    expect(payload.aps['thread-id']).toBeUndefined()
  })

  it('wraps FCM in the v1 message envelope, with string-valued data', () => {
    const message = toFcmMessage(claim({ platform: 'android', token: 'fcm-tok' })) as {
      message: { token: string; data: Record<string, unknown> }
    }
    expect(message.message.token).toBe('fcm-tok')
    for (const value of Object.values(message.message.data)) {
      expect(typeof value).toBe('string')
    }
  })

  it('carries no subject id beyond the rendered copy and the path', () => {
    // `push_payload_for` already decided what may leave the database. Anything
    // re-derived from an id here would be a second, ungated read path.
    const serialised = JSON.stringify(toApnsPayload(claim()))
    expect(serialised).not.toMatch(/club_id|ride_id|postcard_id|user_id/)
  })
})

describe('groupByPlatform', () => {
  it('splits by platform and preserves order', () => {
    const { ios, android } = groupByPlatform([
      claim({ deliveryId: 'a', platform: 'ios' }),
      claim({ deliveryId: 'b', platform: 'android' }),
      claim({ deliveryId: 'c', platform: 'ios' }),
    ])
    expect(ios.map((c) => c.deliveryId)).toEqual(['a', 'c'])
    expect(android.map((c) => c.deliveryId)).toEqual(['b'])
  })

  it('answers empty groups rather than throwing, so a rider with no tokens completes', () => {
    expect(groupByPlatform([])).toEqual({ ios: [], android: [] })
  })
})
