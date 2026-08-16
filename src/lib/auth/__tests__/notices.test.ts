import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTH_NOTICES, authNotice } from '@/lib/auth/notices'
import {
  RECOVERY_PATH,
  callbackFailureDestination,
  confirmableOtpType,
} from '@/lib/auth/recovery'

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

  it('every message is non-empty', () => {
    for (const message of Object.values(AUTH_NOTICES)) {
      expect(message.trim().length).toBeGreaterThan(0)
    }
  })

  // **This is the assertion that gates the defect; the one above does not.**
  // Checking that the declared messages are non-empty says nothing about an
  // EMITTER whose code was never declared — which is exactly how PD-225
  // happened, four `?error=` redirects landing on screens that rendered
  // nothing. So read the emitters out of the tree rather than listing them
  // here: a list would be one more thing to keep in step with the code.
  it('every ?error= code emitted anywhere in src/ renders a message', () => {
    const emitted = new Map<string, string>()

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          // **The comment trap, CLAUDE.md §Technology Decisions.** This sweep
          // counted its own documentation on the first run: `notices.ts`
          // explains that `?error=toString` must render nothing, and the
          // matcher read that sentence as a fifth emitter. A description of a
          // pattern looks exactly like the pattern.
          if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue
          for (const [, code] of line.matchAll(/\?error=([A-Za-z0-9_]+)/g)) {
            emitted.set(code, full)
          }
        }
      }
    }
    walk(join(process.cwd(), 'src'))

    // **Verifies the filter in the other direction too.** A sweep that finds
    // nothing passes for ever and looks exactly like a clean tree — and the
    // comment filter above is the thing most likely to cause that, by eating
    // the real emitters along with the prose about them.
    expect(emitted.size).toBeGreaterThan(0)

    for (const [code, file] of emitted) {
      expect(authNotice(code), `${file} redirects with ?error=${code} and nothing renders it`).not.toBeNull()
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

describe('confirmableOtpType', () => {
  it('accepts the two types an emailed confirmation link carries', () => {
    expect(confirmableOtpType('signup')).toBe('signup')
    expect(confirmableOtpType('email')).toBe('email')
  })

  // The value picks which verification flow the token is spent on, and it
  // arrives in a URL. `recovery` in particular must NOT pass: the reset screen
  // gates on 026's grant, and whether a verifyOtp-minted session carries the
  // `amr` claim that grant reads is unmeasured — see the function's header.
  it('refuses recovery, so the reset flow stays on /auth/callback', () => {
    expect(confirmableOtpType('recovery')).toBeNull()
  })

  it('refuses every other verifyOtp type', () => {
    for (const type of ['magiclink', 'invite', 'email_change', 'phone_change', 'sms']) {
      expect(confirmableOtpType(type)).toBeNull()
    }
  })

  it('refuses an absent or nonsense value', () => {
    expect(confirmableOtpType(null)).toBeNull()
    expect(confirmableOtpType('')).toBeNull()
    expect(confirmableOtpType('SIGNUP')).toBeNull()
    expect(confirmableOtpType('signup ')).toBeNull()
  })
})
