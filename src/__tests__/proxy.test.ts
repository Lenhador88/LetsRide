import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// proxy.ts builds its own Supabase client, so the client is the seam. Each test
// declares what `auth.getUser()` and the profile read return, and asserts only
// on the redirect decision.
let user: { id: string } | null = null
let profileResult: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => profileResult }) }),
    }),
  }),
}))

const { proxy } = await import('@/proxy')

const go = async (path: string) => {
  const res = await proxy(new NextRequest(`https://letsride.app${path}`))
  return { status: res.status, location: res.headers.get('location') }
}

beforeEach(() => {
  user = null
  profileResult = { data: null, error: null }
})

describe('proxy — signed out', () => {
  it('lets public paths through', async () => {
    for (const p of ['/', '/auth/login', '/auth/signup', '/legal/terms']) {
      expect((await go(p)).location, p).toBeNull()
    }
  })

  it('sends every other path to login', async () => {
    for (const p of ['/postcards', '/rides', '/onboarding/username']) {
      expect((await go(p)).location, p).toContain('/auth/login')
    }
  })

  it('does not treat /legalfoo as public', async () => {
    expect((await go('/legalfoo')).location).toContain('/auth/login')
  })
})

describe('proxy — onboarding gate', () => {
  beforeEach(() => {
    user = { id: 'u1' }
  })

  it('sends an un-onboarded rider to the step they left off at', async () => {
    profileResult = { data: { username: null, location: null, onboarding_completed_at: null }, error: null }
    expect((await go('/postcards')).location).toContain('/onboarding/username')

    profileResult = { data: { username: 'ripper', location: null, onboarding_completed_at: null }, error: null }
    expect((await go('/postcards')).location).toContain('/onboarding/location')
  })

  it('lets an un-onboarded rider stay inside the wizard', async () => {
    profileResult = { data: { username: null, location: null, onboarding_completed_at: null }, error: null }
    expect((await go('/onboarding/username')).location).toBeNull()
  })

  it('refuses step 2 before step 1 is done, rather than letting it dead-end', async () => {
    // The database trigger rejects completion while username is NULL, so a
    // rider who deep-links here would submit into a check violation with no
    // way forward.
    profileResult = { data: { username: null, location: null, onboarding_completed_at: null }, error: null }
    expect((await go('/onboarding/location')).location).toContain('/onboarding/username')
  })

  it('still allows going back to step 1 once a username exists', async () => {
    profileResult = { data: { username: 'ripper', location: null, onboarding_completed_at: null }, error: null }
    expect((await go('/onboarding/username')).location).toBeNull()
    expect((await go('/onboarding/location')).location).toBeNull()
  })

  it('bounces a finished rider out of the wizard and off the auth entry paths', async () => {
    profileResult = {
      data: { username: 'ripper', location: 'Porto', onboarding_completed_at: '2026-01-01T00:00:00Z' },
      error: null,
    }
    expect((await go('/onboarding/username')).location).toContain('/postcards')
    expect((await go('/auth/login')).location).toContain('/postcards')
  })

  it('does not bounce a signed-in rider off the recovery flow', async () => {
    profileResult = {
      data: { username: 'ripper', location: 'Porto', onboarding_completed_at: '2026-01-01T00:00:00Z' },
      error: null,
    }
    // Bouncing all of /auth/* is what broke password recovery (Q1): the link
    // establishes a session before the reset page loads.
    expect((await go('/auth/reset-password')).location).toBeNull()
    expect((await go('/auth/callback')).location).toBeNull()
  })
})

describe('proxy — profile read fails (the 003-not-applied case)', () => {
  beforeEach(() => {
    user = { id: 'u1' }
    profileResult = { data: null, error: { code: '42703', message: 'column does not exist' } }
  })

  it('does NOT redirect /auth/login to itself', async () => {
    // The regression that matters. /auth/login is public but still reaches the
    // profile read, so redirecting it to /auth/login on failure is an infinite
    // loop — and it fires on exactly the deploy mismatch this path exists for,
    // locking every signed-in rider out with no way to sign out.
    const res = await go('/auth/login')
    expect(res.location).toBeNull()
  })

  it('does NOT redirect /auth/signup to itself either', async () => {
    expect((await go('/auth/signup')).location).toBeNull()
  })

  it('sends other paths to login with a reason, rather than into the wizard', async () => {
    const res = await go('/postcards')
    expect(res.location).toContain('/auth/login')
    expect(res.location).toContain('profile_unavailable')
  })
})
