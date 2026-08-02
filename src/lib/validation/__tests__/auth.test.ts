import { describe, expect, it } from 'vitest'
import {
  emailSchema,
  loginSchema,
  newPasswordSchema,
  signUpSchema,
} from '@/lib/validation/auth'

describe('emailSchema', () => {
  it('trims and lowercases before the format check runs', () => {
    // Regression for the real bug the module comment calls out: chaining
    // z.email().trim() checks the raw value first, so this exact input — a
    // mobile keyboard's auto-capitalised, space-padded email — would fail as
    // "invalid email" under the reversed order. If trim/lowercase ever moves
    // after the pipe, this goes red.
    const result = emailSchema.safeParse('  A@B.com  ')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe('a@b.com')
  })

  it('rejects a value that is not an email even after normalising', () => {
    expect(emailSchema.safeParse('  not an email  ').success).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(emailSchema.safeParse('').success).toBe(false)
  })
})

describe('newPasswordSchema — length boundaries', () => {
  it('rejects 7 characters', () => {
    expect(newPasswordSchema.safeParse('a'.repeat(7)).success).toBe(false)
  })

  it('accepts 8 characters (the minimum)', () => {
    expect(newPasswordSchema.safeParse('a'.repeat(8)).success).toBe(true)
  })

  it('accepts 72 characters (the maximum)', () => {
    expect(newPasswordSchema.safeParse('a'.repeat(72)).success).toBe(true)
  })

  it('rejects 73 characters', () => {
    expect(newPasswordSchema.safeParse('a'.repeat(73)).success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('accepts a password that would fail newPasswordSchema length rules', () => {
    // The whole point of loginSchema having its own password rule: an
    // account created before the 8-character minimum existed must still be
    // able to log in with its original short password.
    const result = loginSchema.safeParse({ email: 'rider@example.com', password: 'ab' })
    expect(result.success).toBe(true)
  })

  it('accepts a very long password too — no upper bound on login', () => {
    const result = loginSchema.safeParse({
      email: 'rider@example.com',
      password: 'a'.repeat(200),
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'rider@example.com', password: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing/invalid email even though the password is fine', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'whatever' })
    expect(result.success).toBe(false)
  })
})

describe('signUpSchema', () => {
  const base = { email: 'rider@example.com', password: 'a'.repeat(10) }

  it('rejects acceptedTerms: false', () => {
    const result = signUpSchema.safeParse({ ...base, acceptedTerms: false })
    expect(result.success).toBe(false)
  })

  it('rejects acceptedTerms missing entirely', () => {
    const result = signUpSchema.safeParse(base)
    expect(result.success).toBe(false)
  })

  it('accepts acceptedTerms: true with a valid email/password', () => {
    const result = signUpSchema.safeParse({ ...base, acceptedTerms: true })
    expect(result.success).toBe(true)
  })

  it('still enforces newPasswordSchema on signup (unlike login)', () => {
    const result = signUpSchema.safeParse({
      email: base.email,
      password: 'short1',
      acceptedTerms: true,
    })
    expect(result.success).toBe(false)
  })
})
