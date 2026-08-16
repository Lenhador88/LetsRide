import { describe, expect, it } from 'vitest'
import { AUTH_NOTICES, authNotice } from '@/lib/auth/notices'
import { RECOVERY_PATH, callbackFailureDestination } from '@/lib/auth/recovery'

describe('authNotice', () => {
  it('renders the message for every code it declares', () => {
    for (const [code, message] of Object.entries(AUTH_NOTICES)) {
      expect(authNotice(code)).toBe(message)
    }
  })

  it('renders nothing for an absent code', () => {
    expect(authNotice(null)).toBeNull()
    expect(authNotice(undefined)).toBeNull()
    expect(authNotice('')).toBeNull()
  })

  it('renders nothing for a code it does not know', () => {
    expect(authNotice('not_a_code')).toBeNull()
  })

  // The value arrives in a URL the rider can edit. A bare `AUTH_NOTICES[code]`
  // lookup resolves Object.prototype's own keys, so this would put a function's
  // source on the screen.
  it('renders nothing for an inherited Object.prototype key', () => {
    expect(authNotice('toString')).toBeNull()
    expect(authNotice('constructor')).toBeNull()
    expect(authNotice('hasOwnProperty')).toBeNull()
    expect(authNotice('__proto__')).toBeNull()
  })

  // A code with no message is a redirect that lands on a silent screen — the
  // whole defect PD-225 found, reintroduced one emitter at a time.
  it('every message is non-empty', () => {
    for (const message of Object.values(AUTH_NOTICES)) {
      expect(message.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('callbackFailureDestination', () => {
  // The regression itself: a signup confirmation carries next=/postcards, and
  // sending it into password recovery is what the product owner reported.
  it('sends a failed signup confirmation to login, not into recovery', () => {
    expect(callbackFailureDestination('/postcards')).toBe('/auth/login?error=invalid_confirmation')
  })

  it('sends a failed recovery link to forgot-password', () => {
    expect(callbackFailureDestination(RECOVERY_PATH)).toBe(
      '/auth/forgot-password?error=invalid_link',
    )
  })

  // safeNext returns null for a stripped or refused `next`, and a link whose
  // flow is unknown is likelier a confirmation than a reset — a rider who asked
  // for a reset can always ask again from login, where this lands them.
  it('sends a link with no usable next to login', () => {
    expect(callbackFailureDestination(null)).toBe('/auth/login?error=invalid_confirmation')
  })

  it('every destination it can return carries a code that renders a message', () => {
    for (const next of ['/postcards', RECOVERY_PATH, null, '/rides']) {
      const code = new URL(callbackFailureDestination(next), 'https://app.letsride.social')
        .searchParams.get('error')
      expect(authNotice(code)).not.toBeNull()
    }
  })
})
