import { describe, expect, it } from 'vitest'
import {
  RECOVERY_EXPIRED_MESSAGE,
  RECOVERY_PATH,
  consumePasswordResetGrant,
  hasPasswordResetGrant,
} from '@/lib/auth/recovery'

/**
 * The rule itself lives in migration `026` and is asserted in
 * `supabase/tests/rls_test.sql`. What is left to prove in TypeScript is the
 * direction these two helpers fail in — and it is the only interesting thing
 * about them, because every failure mode here reads as `{ data: null, error }`
 * and a truthiness check would turn a transport error into a granted reset.
 */
function client(response: { data: unknown; error: unknown }) {
  return { rpc: () => Promise.resolve(response) }
}

describe('hasPasswordResetGrant', () => {
  it('is true only when the database says exactly true', async () => {
    expect(await hasPasswordResetGrant(client({ data: true, error: null }))).toBe(true)
    expect(await hasPasswordResetGrant(client({ data: false, error: null }))).toBe(false)
  })

  it('fails closed when the call errors', async () => {
    expect(
      await hasPasswordResetGrant(
        client({ data: null, error: { message: 'permission denied for function', code: '42501' } }),
      ),
    ).toBe(false)
  })

  /**
   * `anon` holds no execute grant, so an unauthenticated call — the SSR pass of
   * this client page, before hydration — comes back as an error with no data.
   * It must read as "no grant", never as "unknown, so allow".
   */
  it('fails closed when the response carries neither an answer nor an error', async () => {
    expect(await hasPasswordResetGrant(client({ data: null, error: null }))).toBe(false)
    expect(await hasPasswordResetGrant(client({ data: undefined, error: null }))).toBe(false)
  })

  /**
   * A truthy non-boolean must not pass. PostgREST returning a string 'true', or
   * a row wrapper, is not the database saying yes.
   */
  it('does not accept a truthy value that is not the boolean', async () => {
    expect(await hasPasswordResetGrant(client({ data: 'true', error: null }))).toBe(false)
    expect(await hasPasswordResetGrant(client({ data: 1, error: null }))).toBe(false)
    expect(await hasPasswordResetGrant(client({ data: [{ has: true }], error: null }))).toBe(false)
  })
})

describe('consumePasswordResetGrant', () => {
  it('reports the spend only when the database confirms it', async () => {
    expect(await consumePasswordResetGrant(client({ data: true, error: null }))).toBe(true)
    expect(await consumePasswordResetGrant(client({ data: false, error: null }))).toBe(false)
  })

  /**
   * The consequence of getting this wrong is the whole feature: an errored
   * consume that read as `true` would let the password change proceed on a
   * grant that was never spent — an ordinary signed-in session resetting a
   * password it does not know.
   */
  it('fails closed on an error or a missing answer', async () => {
    expect(
      await consumePasswordResetGrant(client({ data: null, error: { message: 'timeout' } })),
    ).toBe(false)
    expect(await consumePasswordResetGrant(client({ data: null, error: null }))).toBe(false)
    expect(await consumePasswordResetGrant(client({ data: 'true', error: null }))).toBe(false)
  })
})

describe('the shared constants', () => {
  /**
   * `safeNext` falls back to this exact path, and /auth/callback compares
   * against it. A drift here is an open redirect's fallback pointing somewhere
   * unintended.
   */
  it('names the reset route', () => {
    expect(RECOVERY_PATH).toBe('/auth/reset-password')
  })

  /**
   * One message for every refusal. Distinguishing "expired" from "already used"
   * from "you are just signed in" tells a rider on a borrowed laptop which door
   * they failed at.
   */
  it('gives one message for every way of holding no grant', () => {
    expect(RECOVERY_EXPIRED_MESSAGE).toBe('That reset link has expired. Request a new one.')
  })
})
