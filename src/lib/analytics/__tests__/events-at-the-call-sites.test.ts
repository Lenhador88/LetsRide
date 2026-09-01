import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnalyticsEvent } from '@/lib/analytics/events'

/**
 * PD-353 requires this file by name: *"Vitest then asserts that each of the
 * four actions calls it with the right event name and properties, which is the
 * half that actually breaks."*
 *
 * It is the whole gate on the call sites. PostHog runs on **PRODUCTION ONLY** —
 * the free tier allows one project, so the key is on Vercel's Production scope
 * alone and unset everywhere else — which means `npm run walk` runs against DEV
 * and cannot exercise one line of this, and no preview can either. The transport
 * gets one hand-verification on PROD after the promotion; everything else is
 * here.
 *
 * ## What each case is really guarding
 *
 * Two failures, and neither is visible without a test. **A `capture` on the
 * error path** inflates every number in the funnel and looks exactly like
 * success — nothing throws, the count is simply wrong. And **an event that
 * fires for the wrong state**: `ride_joined` on `maybe` or on a withdrawal
 * counts two non-joins as joins, and `maybe` is a state the Crew design draws
 * separately precisely because it is not a commitment.
 *
 * So every case below pairs the positive with its negative — the event fires
 * for this input AND does not fire for the neighbouring one.
 */

const captured: AnalyticsEvent[] = []

vi.mock('@/lib/analytics/client', () => ({
  capture: (event: AnalyticsEvent) => {
    captured.push(event)
  },
  // The action modules import these too; they must exist or the mock replaces
  // the module with holes and the import throws somewhere unrelated.
  analyticsSessionId: () => null,
  applyAnalyticsPreference: () => {},
  identifyAnalyticsRider: () => {},
  MASK_CLASS: 'ph-mask',
}))

/**
 * One chainable fake standing in for the client `resolveSupabase` returns.
 *
 * `rpc` and the query builder both resolve to whatever `outcome` says, so a
 * case flips between "the write succeeded" and "RLS refused it" by changing one
 * value — which is what makes the error-path assertions cheap enough to write
 * for every call site rather than for the one somebody remembered.
 */
let outcome: { data: unknown; error: { code?: string; message: string } | null } = {
  data: null,
  error: null,
}

const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'rider-1' } } }) },
  rpc: async () => outcome,
  from: () => builder(),
  storage: { from: () => ({ remove: async () => ({ error: null }) }) },
}

function builder() {
  const chain: Record<string, unknown> = {}
  const step = () => chain
  for (const name of ['select', 'eq', 'in', 'order', 'limit', 'update']) chain[name] = step
  for (const name of ['insert', 'upsert', 'delete']) {
    chain[name] = () => ({ ...chain, ...thenable() })
  }
  chain.single = async () => outcome
  chain.maybeSingle = async () => outcome
  Object.assign(chain, thenable())
  return chain
}

function thenable() {
  return {
    // PostgREST builders are thenables, so an un-awaited `.select()` chain and
    // an awaited one are the same object.
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(outcome).then(resolve),
    select: () => builder(),
    eq: () => builder(),
    single: async () => outcome,
    maybeSingle: async () => outcome,
  }
}

vi.mock('@/lib/supabase/resolve', () => ({ resolveSupabase: async () => supabase }))
vi.mock('@/lib/query', () => ({ invalidate: () => {}, clearQueryCache: () => {} }))

beforeEach(() => {
  captured.length = 0
  outcome = { data: null, error: null }
})

afterEach(() => {
  vi.resetModules()
})

describe('ride_joined', () => {
  it('fires for an RSVP of going', async () => {
    const { setRideAttendance } = await import('@/lib/actions/rides')
    await setRideAttendance('ride-1', 'going')
    expect(captured).toEqual([{ name: 'ride_joined', properties: { via: 'rsvp' } }])
  })

  it('does NOT fire for maybe', async () => {
    // The reversal that is invisible without this: `maybe` is a separate state
    // in the Crew design and a rider who says maybe has committed to nothing.
    // An event on every RSVP counts it as a join and the number simply reads
    // high, with nothing red anywhere.
    const { setRideAttendance } = await import('@/lib/actions/rides')
    await setRideAttendance('ride-1', 'maybe')
    expect(captured).toEqual([])
  })

  it('does NOT fire for a withdrawal', async () => {
    const { setRideAttendance } = await import('@/lib/actions/rides')
    await setRideAttendance('ride-1', null)
    expect(captured).toEqual([])
  })

  it('does NOT fire when the write is refused', async () => {
    outcome = { data: null, error: { code: '42501', message: 'refused' } }
    const { setRideAttendance } = await import('@/lib/actions/rides')
    const result = await setRideAttendance('ride-1', 'going')
    expect(result.error).toBeTruthy()
    expect(captured).toEqual([])
  })

  it('distinguishes the invite door from the link door', async () => {
    outcome = { data: 'ride-1', error: null }
    const { acceptRideInvite } = await import('@/lib/actions/ride-invites')
    const { claimRideInviteLink } = await import('@/lib/actions/ride-invite-links')

    await acceptRideInvite('11111111-1111-4111-8111-111111111111')
    await claimRideInviteLink('a'.repeat(32))

    expect(captured.map((event) => event.properties)).toEqual([{ via: 'invite' }, { via: 'link' }])
  })
})

describe('club_joined', () => {
  it('fires for a browse join', async () => {
    const { joinClub } = await import('@/lib/actions/clubs')
    await joinClub('club-1')
    expect(captured).toEqual([{ name: 'club_joined', properties: { via: 'browse' } }])
  })

  it('does NOT fire when the write is refused', async () => {
    outcome = { data: null, error: { message: 'refused' } }
    const { joinClub } = await import('@/lib/actions/clubs')
    await joinClub('club-1')
    expect(captured).toEqual([])
  })

  it('does NOT fire when a rider LEAVES', async () => {
    // The mirror of the withdrawal case above, and the same defect: `leaveClub`
    // shares `invalidateClubMembership` with `joinClub`, so a `capture` written
    // beside that call rather than beside the write reaches both.
    const { leaveClub } = await import('@/lib/actions/clubs')
    await leaveClub('club-1')
    expect(captured).toEqual([])
  })

  it('distinguishes the invite door from the link door', async () => {
    outcome = { data: 'club-1', error: null }
    const { acceptClubInvite } = await import('@/lib/actions/club-invites')
    const { claimClubInviteLink } = await import('@/lib/actions/club-invite-links')

    await acceptClubInvite('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    await claimClubInviteLink('a'.repeat(32))

    expect(captured.map((event) => event.properties)).toEqual([{ via: 'invite' }, { via: 'link' }])
  })

  it('does NOT fire when a rider DECLINES an invite', async () => {
    const { declineClubInvite } = await import('@/lib/actions/club-invites')
    await declineClubInvite('11111111-1111-4111-8111-111111111111')
    expect(captured).toEqual([])
  })
})

describe('onboarding_step — PD-353 question 3, the one SQL cannot reach', () => {
  it('records a taken username as a rejection, without the name', async () => {
    outcome = { data: null, error: { code: '23505', message: 'duplicate key' } }
    const { setUsername } = await import('@/lib/actions/onboarding')

    const form = new FormData()
    form.set('username', 'pedro')
    await setUsername({ error: null }, form)

    expect(captured).toEqual([
      { name: 'onboarding_step', properties: { step: 'username', status: 'rejected', reason: 'taken' } },
    ])
    // The assertion this section exists for. A rider who tries three usernames
    // and closes the tab has written nothing to `profiles`, so this event is
    // the only record — and it must never carry the name that was refused,
    // which is the rider's chosen identity. `place_search_attempts` is the same
    // rule: record that it happened, never what was typed.
    expect(JSON.stringify(captured)).not.toContain('pedro')
  })

  it('records the terms step as completed', async () => {
    outcome = { data: true, error: null }
    const { acceptTerms } = await import('@/lib/actions/onboarding')

    const form = new FormData()
    form.set('acceptedTerms', 'on')
    await acceptTerms({ error: null }, form)

    expect(captured).toContainEqual({
      name: 'onboarding_step',
      properties: { step: 'terms', status: 'completed' },
    })
  })

  it('records a refused consent write as a rejection rather than a completion', async () => {
    outcome = { data: null, error: { message: 'nope' } }
    const { acceptTerms } = await import('@/lib/actions/onboarding')

    const form = new FormData()
    form.set('acceptedTerms', 'on')
    await acceptTerms({ error: null }, form)

    expect(captured).toEqual([
      { name: 'onboarding_step', properties: { step: 'terms', status: 'rejected', reason: 'failed' } },
    ])
  })
})

/**
 * `createRide` and `createPostcard` are asserted on their source rather than
 * driven, and the reason is worth stating rather than leaving as a gap.
 *
 * Both parse a full `FormData` through Zod and then chain an insert with a
 * `.select().single()`; standing a fake up for each buys a test of this file's
 * own fixture more than of the app. What the compiler already guarantees is the
 * half that would otherwise be worth testing — `AnalyticsEvent` is a closed
 * union, so a wrong event name or a wrong property key is a build error, not a
 * silent second event in PostHog.
 *
 * What is left is *placement*, which is what these two cases pin: the call sits
 * after the error return, so it cannot fire on a refused write.
 */
describe('the two composers, asserted on placement', () => {
  const ROOT = path.resolve(__dirname, '../../../..')

  function source(relativePath: string): string {
    // Comment-stripped, the trap this repo has now sprung four times: both of
    // these files carry prose about their own capture call, and an un-stripped
    // read finds the description instead of the code.
    return readFileSync(path.join(ROOT, relativePath), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  it('createRide captures after its last error return', () => {
    const text = source('src/lib/actions/rides.ts')
    expect(text.indexOf("name: 'ride_created'")).toBeGreaterThan(
      text.lastIndexOf("Could not create that ride")
    )
  })

  it('createPostcard captures after the storage-cleanup error return', () => {
    const text = source('src/lib/actions/postcards.ts')
    expect(text.indexOf("name: 'postcard_posted'")).toBeGreaterThan(
      text.indexOf("Could not post that. Try again.")
    )
  })
})

describe('one doorway', () => {
  it('nothing outside src/lib/analytics imports posthog-js', () => {
    // Same rule as `lib/data/`, `lib/actions/` and `lib/observability/`. The
    // privacy posture in `client.ts` — autocapture off, no `?id=` in a URL, the
    // opt-out honoured before the first event — is a property of that file, and
    // only while every event goes through it.
    const ROOT = path.resolve(__dirname, '../../../..')
    const analytics = path.join('src', 'lib', 'analytics')
    const offenders: string[] = []

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        const rel = path.relative(ROOT, full)
        if (rel.startsWith(analytics)) continue
        const text = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        if (/from 'posthog-js'/.test(text)) offenders.push(rel)
      }
    }

    walk(path.join(ROOT, 'src'))
    expect(offenders).toEqual([])
  })
})

