import { afterEach, describe, expect, it } from 'vitest'
import { accountDeletionEnabled } from '@/lib/flags'

/**
 * `accountDeletionEnabled` is the only thing standing between `development`
 * and a live, one-tap, irreversible "Delete account" row rendered against a
 * function that still ignores the password (reviewer finding #2, 2026-08-16
 * — the flag's own comment argued for the shape below and nothing exercised
 * it). An edit to `!== 'false'`, or a typo in the literal it compares
 * against, opens the flow with every other gate in the repo green. This is
 * the test that would catch it.
 */

const KEY = 'NEXT_PUBLIC_ACCOUNT_DELETION_ENABLED'
const ORIGINAL = process.env[KEY]

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[KEY]
  else process.env[KEY] = ORIGINAL
})

describe('accountDeletionEnabled', () => {
  it('is closed when the variable is unset', () => {
    delete process.env[KEY]
    expect(accountDeletionEnabled()).toBe(false)
  })

  it.each(['', 'false', '0', 'True', '1', 'TRUE', 'yes', 'enabled', ' true'])(
    'is closed on %j — only the exact literal opens it',
    (value) => {
      process.env[KEY] = value
      expect(accountDeletionEnabled()).toBe(false)
    }
  )

  it('is open on exactly "true"', () => {
    process.env[KEY] = 'true'
    expect(accountDeletionEnabled()).toBe(true)
  })
})
