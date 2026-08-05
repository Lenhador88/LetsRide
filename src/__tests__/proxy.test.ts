import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// proxy.ts builds its own Supabase client, so the client is the seam. Each test
// declares what `auth.getUser()` and the onboarding-state read return, and
// asserts only on the redirect decision.
//
// The read is `rpc('my_onboarding_state')` rather than a table select because
// 021 revokes column SELECT on both stamps — see the note at the call site. The
// mock deliberately exposes no `from()`, so a future edit that reaches for the
// table again fails here rather than in production with a 403 the error branch
// would read as a deploy mismatch.
let user: { id: string } | null = null
let stateResult: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: () => ({ maybeSingle: async () => stateResult }),
  }),
}))

const { proxy } = await import('@/proxy')

const go = async (path: string) => {
  const res = await proxy(new NextRequest(`https://letsride.app${path}`))
  return { status: res.status, location: res.headers.get('location') }
}

/** The three fields `my_onboarding_state()` returns, with sane defaults. */
const state = (over: Partial<{
  terms_accepted_at: string | null
  onboarding_completed_at: string | null
  has_username: boolean
}> = {}) => ({
  data: {
    terms_accepted_at: '2026-01-01T00:00:00Z',
    onboarding_completed_at: null,
    has_username: false,
    ...over,
  },
  error: null,
})

const DONE = state({
  onboarding_completed_at: '2026-01-01T00:00:00Z',
  has_username: true,
})

beforeEach(() => {
  user = null
  stateResult = { data: null, error: null }
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

describe('proxy — consent gate', () => {
  beforeEach(() => {
    user = { id: 'u1' }
  })

  it('sends a rider with no consent stamp to the prompt', async () => {
    stateResult = state({ terms_accepted_at: null })
    expect((await go('/postcards')).location).toContain('/onboarding/terms')
  })

  it('lets that rider stay on the prompt', async () => {
    stateResult = state({ terms_accepted_at: null })
    expect((await go('/onboarding/terms')).location).toBeNull()
  })

  it('gates consent ahead of the wizard, because 023 refuses completion without it', async () => {
    // A rider who has a username but no consent must still be sent to the
    // prompt, not to step 2 — complete_onboarding() would refuse the stamp and
    // the rider would dead-end on a screen that can never succeed.
    stateResult = state({ terms_accepted_at: null, has_username: true })
    expect((await go('/postcards')).location).toContain('/onboarding/terms')
    expect((await go('/onboarding/location')).location).toContain('/onboarding/terms')
  })

  it('does not strand a consented rider on the prompt', async () => {
    // The prompt is a one-way door: once the stamp is set the screen would
    // no-op, so it must not be reachable. Both resume positions are covered.
    stateResult = state({ has_username: false })
    expect((await go('/onboarding/terms')).location).toContain('/onboarding/username')

    stateResult = state({ has_username: true })
    expect((await go('/onboarding/terms')).location).toContain('/onboarding/location')

    stateResult = DONE
    expect((await go('/onboarding/terms')).location).toContain('/postcards')
  })

  it('does not gate consent on public paths that are not a way back into signup', async () => {
    stateResult = state({ terms_accepted_at: null })
    expect((await go('/legal/terms')).location).toBeNull()
    expect((await go('/auth/reset-password')).location).toBeNull()
  })
})

describe('proxy — onboarding gate', () => {
  beforeEach(() => {
    user = { id: 'u1' }
  })

  it('sends an un-onboarded rider to the step they left off at', async () => {
    stateResult = state({ has_username: false })
    expect((await go('/postcards')).location).toContain('/onboarding/username')

    stateResult = state({ has_username: true })
    expect((await go('/postcards')).location).toContain('/onboarding/location')
  })

  it('lets an un-onboarded rider stay inside the wizard', async () => {
    stateResult = state({ has_username: false })
    expect((await go('/onboarding/username')).location).toBeNull()
  })

  it('refuses step 2 before step 1 is done, rather than letting it dead-end', async () => {
    // complete_onboarding() rejects the stamp while username is NULL, so a
    // rider who deep-links here would submit into a check violation with no
    // way forward.
    stateResult = state({ has_username: false })
    expect((await go('/onboarding/location')).location).toContain('/onboarding/username')
  })

  it('still allows going back to step 1 once a username exists', async () => {
    stateResult = state({ has_username: true })
    expect((await go('/onboarding/username')).location).toBeNull()
    expect((await go('/onboarding/location')).location).toBeNull()
  })

  it('bounces a finished rider out of the wizard and off the auth entry paths', async () => {
    stateResult = DONE
    expect((await go('/onboarding/username')).location).toContain('/postcards')
    expect((await go('/auth/login')).location).toContain('/postcards')
  })

  it('does not bounce a signed-in rider off the recovery flow', async () => {
    stateResult = DONE
    // Bouncing all of /auth/* is what broke password recovery (Q1): the link
    // establishes a session before the reset page loads.
    expect((await go('/auth/reset-password')).location).toBeNull()
    expect((await go('/auth/callback')).location).toBeNull()
  })
})

describe('proxy — the state read fails (the migration-not-applied case)', () => {
  beforeEach(() => {
    user = { id: 'u1' }
    // 42883 is what PostgREST answers before 021 creates the function — the
    // 021-shaped version of the 42703 this branch was originally written for.
    stateResult = { data: null, error: { code: '42883', message: 'function does not exist' } }
  })

  it('does NOT redirect /auth/login to itself', async () => {
    // The regression that matters. /auth/login is public but still reaches the
    // state read, so redirecting it to /auth/login on failure is an infinite
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

  it('fails closed rather than into the consent prompt', async () => {
    // A failed read leaves `terms_accepted_at` undefined, which is falsy — so
    // without the error branch running first, a deploy mismatch would send
    // every rider to a consent screen whose action cannot succeed either.
    expect((await go('/rides')).location).not.toContain('/onboarding/terms')
  })
})
