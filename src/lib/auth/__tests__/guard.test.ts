import { describe, expect, it } from 'vitest'
import {
  AUTH_ENTRY_PATHS,
  PUBLIC_PATHS,
  isPublicPath,
  needsOnboardingState,
  onboardingStateFrom,
  resolveDestination,
  type GuardState,
} from '@/lib/auth/guard'
import { RIDE_JOIN_PATH } from '@/lib/routes'

/**
 * The routing rules `proxy.ts` carried, now testable.
 *
 * That file interleaved reading state with deciding on it, so **not one of its
 * branches had a test** — and it carries five comments describing traps found by
 * reasoning alone: the two redirect loops, the `!state` case that sends a rider
 * to a screen whose submit can never succeed, step 2 before step 1, and the
 * `/auth/*` bounce that broke password recovery. Each of those is a case below.
 * Splitting the decision out from the read is what made that possible, and it is
 * the main reason the move is an improvement rather than a relocation.
 */

const anonymous: GuardState = { kind: 'anonymous' }
const sessionOnly: GuardState = { kind: 'session' }
const unavailable: GuardState = { kind: 'unavailable' }
const gone: GuardState = { kind: 'gone' }

function rider(overrides: Partial<Omit<Extract<GuardState, { kind: 'rider' }>, 'kind'>> = {}): GuardState {
  return {
    kind: 'rider',
    terms_accepted_at: '2026-08-05T00:00:00Z',
    onboarding_completed_at: '2026-08-05T00:00:00Z',
    has_username: true,
    ...overrides,
  }
}

describe('isPublicPath', () => {
  it.each(PUBLIC_PATHS)('%s is public', (path) => {
    expect(isPublicPath(path)).toBe(true)
  })

  it.each(['/postcards', '/rides', '/clubs/abc', '/profile', '/onboarding/username'])(
    '%s is not',
    (path) => {
      expect(isPublicPath(path)).toBe(false)
    }
  )

  it('matches /legal/* but not a route that merely starts with the letters', () => {
    expect(isPublicPath('/legal')).toBe(true)
    expect(isPublicPath('/legal/terms')).toBe(true)
    expect(isPublicPath('/legal/privacy')).toBe(true)
    // `legalbeagle` is a legal username under 003's rules, and `/[username]` is
    // a plausible next route. A `startsWith('/legal')` guard would make it
    // public.
    expect(isPublicPath('/legalbeagle')).toBe(false)
  })
})

describe('an anonymous visitor', () => {
  it('is sent to login from every protected path', () => {
    for (const path of ['/postcards', '/rides/abc', '/clubs', '/profile', '/onboarding/username']) {
      expect(resolveDestination(path, anonymous)).toBe('/auth/login')
    }
  })

  it('stays on the public ones', () => {
    for (const path of ['/auth/login', '/auth/signup', '/auth/forgot-password', '/legal/terms']) {
      expect(resolveDestination(path, anonymous)).toBeNull()
    }
  })

  it('is sent to login from the splash, which is public but has nothing to show', () => {
    expect(resolveDestination('/', anonymous)).toBe('/auth/login')
  })

  it('reaches the recovery screen, which a session gate would have broken (Q1)', () => {
    expect(resolveDestination('/auth/reset-password', anonymous)).toBeNull()
    expect(resolveDestination('/auth/callback', anonymous)).toBeNull()
  })
})

describe('a signed-in rider whose onboarding state did not answer', () => {
  it('is sent to login with a reason, not into the wizard', () => {
    // Bouncing into the wizard is the failure this branch exists to prevent: a
    // missing accessor answers PGRST202, and a guard that reads that as "not
    // onboarded" sends every rider to a screen that cannot help them.
    expect(resolveDestination('/postcards', unavailable)).toBe(
      '/auth/login?error=profile_unavailable'
    )
  })

  it.each(AUTH_ENTRY_PATHS)('does not redirect %s to itself', (path) => {
    // The infinite loop. These are public but still reach this branch, so
    // sending /auth/login to /auth/login locks every signed-in rider out with no
    // way to sign out — on exactly the deploy mismatch this is meant to survive.
    expect(resolveDestination(path, unavailable)).toBeNull()
  })
})

describe('a session naming an account that no longer exists (PD-102)', () => {
  it('resolves to the exact same destination as an unread stamp', () => {
    // `unavailable` and `gone` must never be confused about WHEN to destroy
    // local state (that split lives in guard-cache.ts), but resolveDestination
    // is not where that distinction matters — both are "cannot proceed",
    // and both must land the rider on the same signed-out entry point.
    expect(resolveDestination('/postcards', gone)).toBe(
      resolveDestination('/postcards', unavailable)
    )
    expect(resolveDestination('/postcards', gone)).toBe('/auth/login?error=profile_unavailable')
  })

  it.each(AUTH_ENTRY_PATHS)('does not redirect %s to itself either', (path) => {
    expect(resolveDestination(path, gone)).toBeNull()
  })

  it('is never reached with an un-onboarded rider’s treatment', () => {
    // The failure this state exists to prevent: reading zero rows as
    // "not onboarded" would send a deleted account into the consent prompt,
    // where accept_terms() has no row to update.
    expect(resolveDestination('/postcards', gone)).not.toBe('/onboarding/terms')
    expect(resolveDestination('/postcards', gone)).not.toBe('/onboarding/username')
  })
})

describe('onboardingStateFrom distinguishes zero rows from a failed read (PD-102)', () => {
  it('maps zero rows — data null, error null — to gone, not unavailable', () => {
    // .maybeSingle()'s own shape for "no such row": this is what the accessor
    // answers for a caller with no profiles row, and it must never be folded
    // into the same state as a read that genuinely failed to run.
    expect(onboardingStateFrom({ data: null, error: null })).toEqual({ kind: 'gone' })
  })

  it('maps any error to unavailable, never to gone', () => {
    expect(onboardingStateFrom({ data: null, error: { code: 'PGRST202' } })).toEqual({
      kind: 'unavailable',
    })
  })

  it('maps a real row to rider, unaffected by the split', () => {
    const row = {
      terms_accepted_at: '2026-08-05T00:00:00Z',
      onboarding_completed_at: '2026-08-05T00:00:00Z',
      has_username: true,
    }
    expect(onboardingStateFrom({ data: row, error: null })).toEqual({ kind: 'rider', ...row })
  })
})

describe('the session-only state', () => {
  it('allows the paths that deliberately skip the round trip', () => {
    for (const path of ['/legal/terms', '/auth/reset-password', '/auth/forgot-password']) {
      expect(needsOnboardingState(path)).toBe(false)
      expect(resolveDestination(path, sessionOnly)).toBeNull()
    }
  })

  it('fails closed if it ever reaches a path that needed the state', () => {
    // Not reachable through `readGuardState`, which asks `needsOnboardingState`
    // first. This asserts the two cannot drift apart silently: if one gains a
    // path the other does not, the answer is a refusal rather than a screen
    // rendered on an unread stamp.
    expect(needsOnboardingState('/postcards')).toBe(true)
    expect(resolveDestination('/postcards', sessionOnly)).toBe(
      '/auth/login?error=profile_unavailable'
    )
  })
})

describe('consent comes before the wizard', () => {
  const noConsent = rider({ terms_accepted_at: null, onboarding_completed_at: null })

  it('sends a rider with no consent stamp to the prompt from anywhere', () => {
    for (const path of ['/postcards', '/onboarding/username', '/onboarding/whatever-comes-next', '/profile']) {
      expect(resolveDestination(path, noConsent)).toBe('/onboarding/terms')
    }
  })

  it('lets them stay on the prompt itself', () => {
    expect(resolveDestination('/onboarding/terms', noConsent)).toBeNull()
  })

  it('gates a fully-onboarded rider whose consent predates the write', () => {
    // The population this screen exists for: onboarded long ago, no stamp.
    // Ordering matters — 023 refuses to stamp completion while consent is NULL,
    // so a rider sent to the wizard first would dead-end.
    expect(
      resolveDestination('/postcards', rider({ terms_accepted_at: null }))
    ).toBe('/onboarding/terms')
  })
})

describe('an un-onboarded rider resumes where they left off', () => {
  // PD-286 dropped the location step. `setUsername` now stamps completion
  // itself, right after the username write, so `has_username: true` with no
  // completion stamp is the two-round-trip window design.md §D3 describes —
  // the completion RPC failed after the username landed — rather than a
  // second step to move on to. Both states resume at the same place.
  const noUsername = rider({ onboarding_completed_at: null, has_username: false })
  const hasUsername = rider({ onboarding_completed_at: null, has_username: true })

  it('resumes at /onboarding/username whether or not a username is already set', () => {
    expect(resolveDestination('/postcards', noUsername)).toBe('/onboarding/username')
    expect(resolveDestination('/postcards', hasUsername)).toBe('/onboarding/username')
  })

  it('stays on the resume step itself, for either state', () => {
    expect(resolveDestination('/onboarding/username', noUsername)).toBeNull()
    expect(resolveDestination('/onboarding/username', hasUsername)).toBeNull()
  })

  it('is moved on from the consent prompt, which is behind them', () => {
    expect(resolveDestination('/onboarding/terms', noUsername)).toBe('/onboarding/username')
    expect(resolveDestination('/onboarding/terms', hasUsername)).toBe('/onboarding/username')
  })

  it('redirects a deleted step’s surviving URL rather than leaving the rider on a 404 the guard insists is correct', () => {
    // /onboarding/location is gone (design.md §D6) — a bookmark, a stale tab,
    // or a native shell restoring its last path can still request it, and
    // without the catch-all below `resolveDestination` used to answer `null`
    // — "stay here" — for exactly this path when `has_username` was true.
    expect(resolveDestination('/onboarding/location', noUsername)).toBe('/onboarding/username')
    expect(resolveDestination('/onboarding/location', hasUsername)).toBe('/onboarding/username')
  })

  it('resolves any other unknown path under /onboarding to the resume step — the catch-all', () => {
    expect(resolveDestination('/onboarding/whatever-comes-next', noUsername)).toBe(
      '/onboarding/username'
    )
    expect(resolveDestination('/onboarding/whatever-comes-next', hasUsername)).toBe(
      '/onboarding/username'
    )
  })
})

describe('a fully onboarded rider', () => {
  it('is bounced off the two auth entry paths', () => {
    for (const path of AUTH_ENTRY_PATHS) {
      expect(resolveDestination(path, rider())).toBe('/postcards')
    }
  })

  it('is bounced off the wizard, including a deleted step’s surviving URL', () => {
    for (const path of ['/onboarding/username', '/onboarding/location', '/onboarding/terms']) {
      expect(resolveDestination(path, rider())).toBe('/postcards')
    }
  })

  it('is resolved off the splash', () => {
    expect(resolveDestination('/', rider())).toBe('/postcards')
  })

  it('is NOT bounced off the recovery screen — Q1, and it broke recovery once', () => {
    // A Supabase recovery link establishes an ordinary session before landing
    // here. Bouncing every /auth/* path sent the rider to the home screen with
    // their old password still live and no error shown.
    expect(resolveDestination('/auth/reset-password', rider())).toBeNull()
  })

  it('is left alone everywhere else', () => {
    for (const path of ['/postcards', '/postcards/new', '/rides/abc/crew', '/clubs/x/members']) {
      expect(resolveDestination(path, rider())).toBeNull()
    }
  })
})

describe('needsOnboardingState', () => {
  it('is true for every protected path, and for the two ways back into signup', () => {
    expect(needsOnboardingState('/postcards')).toBe(true)
    for (const path of AUTH_ENTRY_PATHS) expect(needsOnboardingState(path)).toBe(true)
  })

  it('is true for the splash, which has to know the resume step', () => {
    expect(needsOnboardingState('/')).toBe(true)
  })

  it('is false for the legal pages and the recovery flow', () => {
    for (const path of ['/legal/terms', '/legal/privacy', '/auth/reset-password', '/auth/callback']) {
      expect(needsOnboardingState(path)).toBe(false)
    }
  })

  // /auth/confirm spends a one-use token the moment it loads. Reading the
  // onboarding stamps first would put a round trip — and a failure mode — in
  // front of a link the rider cannot click twice, and the answer would change
  // nothing: this route always navigates onward itself.
  it('is false for the emailed-confirmation route', () => {
    expect(needsOnboardingState('/auth/confirm')).toBe(false)
  })
})

/**
 * The invite link's landing route — `091`, PD-330, and the change that needs
 * **two** edits to `guard.ts` rather than one.
 *
 * `/rides/join` goes into `PUBLIC_PATHS` *and* into `needsOnboardingState()`'s
 * set. The first alone leaves the second answering `false` — its opening line is
 * `if (!isPublicPath(pathname)) return true` — so the onboarding stamps are
 * never read, the state stays `{ kind: 'session' }`, the guard answers "stay",
 * and a rider who has just signed up is parked on the preview tapping a Join
 * button whose RPC raises `check_violation` for ever, with no route into the
 * wizard.
 *
 * That failure is **invisible to the two cases either side of it**: an
 * anonymous visitor stays either way, and an onboarded rider stays either way.
 * Only the middle case moves, which is why all three are asserted together
 * rather than the one that looks interesting.
 */
describe('the invite link landing route', () => {
  it('lets an anonymous visitor stay, because the page must mount to stash the token', () => {
    expect(isPublicPath(RIDE_JOIN_PATH)).toBe(true)
    expect(resolveDestination(RIDE_JOIN_PATH, anonymous)).toBeNull()
  })

  it('sends a signed-in rider mid-wizard to their resume step', () => {
    // The case that silently inverts if the route is added to PUBLIC_PATHS
    // alone: `needsOnboardingState` would answer false, `guardStateFrom` would
    // hand `resolveDestination` a bare `{ kind: 'session' }`, and this would be
    // null.
    expect(needsOnboardingState(RIDE_JOIN_PATH)).toBe(true)
    expect(resolveDestination(RIDE_JOIN_PATH, rider({ onboarding_completed_at: null }))).toBe(
      '/onboarding/username'
    )
    // Consent first, per 023: a rider with neither stamp goes to the prompt,
    // not to the wizard's last step.
    expect(
      resolveDestination(
        RIDE_JOIN_PATH,
        rider({ terms_accepted_at: null, onboarding_completed_at: null })
      )
    ).toBe('/onboarding/terms')
  })

  it('leaves a fully onboarded rider on it, so they can read the preview and tap', () => {
    expect(resolveDestination(RIDE_JOIN_PATH, rider())).toBeNull()
  })
})
