import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PENDING_INVITE_TOKEN_KEY,
  adoptInviteTokenFromLocation,
  clearStashedInviteToken,
  getPendingInviteToken,
  readStashedInviteToken,
  resetPendingInviteTokenForTests,
  stashInviteToken,
  takeStashedInviteToken,
} from '@/lib/invites/pending-token'

/**
 * The stash — `091`, PD-330.
 *
 * `environment: 'node'`, so there is no `window`: these tests install a minimal
 * one, which is also what makes the **absent-window** case assertable at all.
 * That case is not hypothetical — `lib/actions/auth.ts` imports this module and
 * is in the SSR pass's module graph, so a `sessionStorage` read that throws
 * there takes a build down rather than a screen.
 */
const LIVE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

function installWindow(storage: Record<string, string>, broken = false, search = '') {
  const replaced: string[] = []
  const store = {
    getItem: (key: string) => {
      if (broken) throw new Error('storage is blocked')
      return key in storage ? storage[key] : null
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error('storage is blocked')
      storage[key] = value
    },
    removeItem: (key: string) => {
      if (broken) throw new Error('storage is blocked')
      delete storage[key]
    },
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    sessionStorage: store,
    location: { search },
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
  }
  return replaced
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window
  resetPendingInviteTokenForTests()
})

describe('the pending invite token', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    installWindow(storage)
  })

  it('round-trips a live token under one named key', () => {
    stashInviteToken(LIVE)
    expect(storage[PENDING_INVITE_TOKEN_KEY]).toBe(LIVE)
    expect(readStashedInviteToken()).toBe(LIVE)
  })

  it('refuses to stash anything that is not a token', () => {
    // A hand-edited URL, a truncated paste, an uppercased one — the column
    // stores lowercase and the RPCs compare exactly, so an uppercased token is
    // not the same token and stashing it would hand the rider "no longer valid"
    // for a link that is alive.
    for (const bad of ['', 'nope', LIVE.slice(0, 31), LIVE.toUpperCase(), `${LIVE}0`]) {
      stashInviteToken(bad)
    }
    expect(storage[PENDING_INVITE_TOKEN_KEY]).toBeUndefined()
  })

  it('reads a corrupted stash as absent rather than handing it on', () => {
    storage[PENDING_INVITE_TOKEN_KEY] = 'not-a-token'
    expect(readStashedInviteToken()).toBeNull()
  })

  it('clears, which is what sign-out relies on', () => {
    stashInviteToken(LIVE)
    clearStashedInviteToken()
    expect(readStashedInviteToken()).toBeNull()
    expect(PENDING_INVITE_TOKEN_KEY in storage).toBe(false)
  })

  it('takes the token and clears it in the same step', () => {
    // The two must not come apart: a read without the clear leaves a live
    // credential in the tab for whoever signs in next, which is the state the
    // always-a-tap rule exists to make unspendable.
    stashInviteToken(LIVE)
    expect(takeStashedInviteToken()).toBe(LIVE)
    expect(readStashedInviteToken()).toBeNull()
    expect(takeStashedInviteToken()).toBeNull()
  })
})

/**
 * The landing route's one side effect, and the two properties it owes.
 *
 * **The token leaves the address bar** — `replaceState` to the bare path — which
 * reduces exposure rather than removing it: the string still reaches the
 * browser's history and the web host's access log, which is inherent to a
 * capability URL and bounded by expiry and revoke.
 *
 * **A URL with nothing usable in it falls back to the stash**, which is what a
 * rider returning from sign-in or from the onboarding wizard arrives with — the
 * whole reason the stash exists.
 */
describe('adopting the token from the address bar', () => {
  it('stashes it, publishes it and takes it out of the URL', () => {
    const replaced = installWindow({}, false, `?token=${LIVE}`)
    adoptInviteTokenFromLocation()

    expect(readStashedInviteToken()).toBe(LIVE)
    expect(getPendingInviteToken()).toBe(LIVE)
    expect(replaced).toEqual(['/rides/join'])
  })

  it('falls back to the stash when the URL carries nothing usable', () => {
    const storage = { [PENDING_INVITE_TOKEN_KEY]: LIVE }
    const replaced = installWindow(storage, false, '?token=nope')
    adoptInviteTokenFromLocation()

    expect(getPendingInviteToken()).toBe(LIVE)
    // Nothing was taken out of the URL, because nothing usable was in it — and
    // the malformed value was never written over the good stash.
    expect(replaced).toEqual([])
    expect(storage[PENDING_INVITE_TOKEN_KEY]).toBe(LIVE)
  })

  it('publishes a decided null when there is no token anywhere', () => {
    // `undefined` is "not yet" and draws a skeleton; this is the answer that
    // draws the invalid-link message, so it must actually arrive.
    installWindow({}, false, '')
    expect(getPendingInviteToken()).toBeUndefined()
    adoptInviteTokenFromLocation()
    expect(getPendingInviteToken()).toBeNull()
  })
})

describe('when there is nowhere to stash it', () => {
  it('says nothing rather than throwing, with no window at all', () => {
    // The SSR pass. `signOut` imports this module, so a throw here is a build
    // failure rather than a degraded screen.
    expect(() => stashInviteToken(LIVE)).not.toThrow()
    expect(readStashedInviteToken()).toBeNull()
    expect(() => clearStashedInviteToken()).not.toThrow()
  })

  it('adopts nothing rather than throwing with no window at all', () => {
    expect(() => adoptInviteTokenFromLocation()).not.toThrow()
    expect(getPendingInviteToken()).toBeUndefined()
  })

  it('says nothing rather than throwing when the store itself refuses', () => {
    // A Safari private window, or an iframe with third-party storage blocked. A
    // rider who cannot stash is a rider who re-taps their own WhatsApp message
    // — the URL is the durable copy, which is what makes this failure cheap.
    installWindow({}, true)
    expect(() => stashInviteToken(LIVE)).not.toThrow()
    expect(readStashedInviteToken()).toBeNull()
    expect(() => clearStashedInviteToken()).not.toThrow()
  })
})
