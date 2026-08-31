import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PENDING_INVITE_TOKEN_KEYS,
  adoptInviteTokenFromLocation,
  clearAllStashedInviteTokens,
  clearStashedInviteToken,
  getPendingInviteToken,
  readStashedInviteToken,
  resetPendingInviteTokenForTests,
  stashInviteToken,
  takeAnyStashedInviteToken,
  takeStashedInviteToken,
} from '@/lib/invites/pending-token'

/**
 * The stash — `091`, PD-330, generalised to two kinds by `093`, PD-360.
 *
 * `environment: 'node'`, so there is no `window`: these tests install a minimal
 * one, which is also what makes the **absent-window** case assertable at all.
 * That case is not hypothetical — `lib/actions/auth.ts` imports this module and
 * is in the SSR pass's module graph, so a `sessionStorage` read that throws
 * there takes a build down rather than a screen.
 */
const LIVE_RIDE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const LIVE_CLUB = 'b2c3d4e5f60718293a4b5c6d7e8f90a1'

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

describe('the pending invite token — one kind at a time', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    installWindow(storage)
  })

  it('round-trips a live token under its own kind’s key, and never the other kind’s', () => {
    stashInviteToken('ride', LIVE_RIDE)
    expect(storage[PENDING_INVITE_TOKEN_KEYS.ride]).toBe(LIVE_RIDE)
    expect(storage[PENDING_INVITE_TOKEN_KEYS.club]).toBeUndefined()
    expect(readStashedInviteToken('ride')).toBe(LIVE_RIDE)
    expect(readStashedInviteToken('club')).toBeNull()

    stashInviteToken('club', LIVE_CLUB)
    expect(storage[PENDING_INVITE_TOKEN_KEYS.club]).toBe(LIVE_CLUB)
    expect(readStashedInviteToken('club')).toBe(LIVE_CLUB)
    // The ride stash is untouched by stashing a club token.
    expect(readStashedInviteToken('ride')).toBe(LIVE_RIDE)
  })

  it('refuses to stash anything that is not that kind’s token', () => {
    for (const bad of ['', 'nope', LIVE_RIDE.slice(0, 31), LIVE_RIDE.toUpperCase(), `${LIVE_RIDE}0`]) {
      stashInviteToken('ride', bad)
      stashInviteToken('club', bad)
    }
    expect(storage[PENDING_INVITE_TOKEN_KEYS.ride]).toBeUndefined()
    expect(storage[PENDING_INVITE_TOKEN_KEYS.club]).toBeUndefined()
  })

  it('a token stashed under the wrong kind is refused, even though the shape is identical', () => {
    // Both schemas accept the same 32-lowercase-hex shape, so this is not about
    // format — it is `stashInviteToken`'s own contract that a club token is
    // never written to `readStashedInviteToken('ride')`'s key or vice versa.
    // Nothing here enforces that by shape; it is enforced by which key each
    // call names, which is exactly what this test pins.
    stashInviteToken('ride', LIVE_RIDE)
    expect(readStashedInviteToken('club')).toBeNull()
  })

  it('reads a corrupted stash as absent rather than handing it on', () => {
    storage[PENDING_INVITE_TOKEN_KEYS.ride] = 'not-a-token'
    expect(readStashedInviteToken('ride')).toBeNull()
  })

  it('clears one kind and leaves the other alone', () => {
    stashInviteToken('ride', LIVE_RIDE)
    stashInviteToken('club', LIVE_CLUB)
    clearStashedInviteToken('ride')
    expect(readStashedInviteToken('ride')).toBeNull()
    expect(PENDING_INVITE_TOKEN_KEYS.ride in storage).toBe(false)
    expect(readStashedInviteToken('club')).toBe(LIVE_CLUB)
  })

  it('takes the token and clears it in the same step', () => {
    // The two must not come apart: a read without the clear leaves a live
    // credential in the tab for whoever signs in next, which is the state the
    // always-a-tap rule exists to make unspendable.
    stashInviteToken('ride', LIVE_RIDE)
    expect(takeStashedInviteToken('ride')).toBe(LIVE_RIDE)
    expect(readStashedInviteToken('ride')).toBeNull()
    expect(takeStashedInviteToken('ride')).toBeNull()
  })
})

/**
 * **Sign-out's own call** (`093`, PD-360) — `clearAllStashedInviteTokens`
 * clears BOTH, because `client-session-storage`'s standing rule is that
 * sign-out destroys every local trace and one kind left behind is exactly
 * that trace.
 */
describe('clearing both stashes at once', () => {
  it('clears the ride and club stash together', () => {
    const storage: Record<string, string> = {}
    installWindow(storage)
    stashInviteToken('ride', LIVE_RIDE)
    stashInviteToken('club', LIVE_CLUB)

    clearAllStashedInviteTokens()

    expect(readStashedInviteToken('ride')).toBeNull()
    expect(readStashedInviteToken('club')).toBeNull()
    expect(PENDING_INVITE_TOKEN_KEYS.ride in storage).toBe(false)
    expect(PENDING_INVITE_TOKEN_KEYS.club in storage).toBe(false)
  })
})

/**
 * **`signIn` and `setUsername`'s own call** — neither knows in advance which
 * kind of link the rider arrived through, so `takeAnyStashedInviteToken`
 * checks both and clears whichever it finds.
 */
describe('taking whichever kind is stashed', () => {
  it('returns the ride kind when only a ride token is stashed', () => {
    const storage: Record<string, string> = {}
    installWindow(storage)
    stashInviteToken('ride', LIVE_RIDE)

    expect(takeAnyStashedInviteToken()).toEqual({ kind: 'ride', token: LIVE_RIDE })
    expect(readStashedInviteToken('ride')).toBeNull()
  })

  it('returns the club kind when only a club token is stashed', () => {
    const storage: Record<string, string> = {}
    installWindow(storage)
    stashInviteToken('club', LIVE_CLUB)

    expect(takeAnyStashedInviteToken()).toEqual({ kind: 'club', token: LIVE_CLUB })
    expect(readStashedInviteToken('club')).toBeNull()
  })

  it('returns null when neither is stashed', () => {
    installWindow({})
    expect(takeAnyStashedInviteToken()).toBeNull()
  })

  it('prefers the ride kind when both are stashed, and leaves the club one untouched', () => {
    const storage: Record<string, string> = {}
    installWindow(storage)
    stashInviteToken('ride', LIVE_RIDE)
    stashInviteToken('club', LIVE_CLUB)

    expect(takeAnyStashedInviteToken()).toEqual({ kind: 'ride', token: LIVE_RIDE })
    expect(readStashedInviteToken('ride')).toBeNull()
    // The untaken kind is still there for its own landing route to pick up.
    expect(readStashedInviteToken('club')).toBe(LIVE_CLUB)
  })
})

/**
 * The landing route's one side effect, and the two properties it owes —
 * `091`'s cases, run once per kind so a shared bug in the generalisation
 * cannot hide behind only the ride kind being exercised.
 *
 * **The token leaves the address bar** — `replaceState` to the bare path,
 * which reduces exposure rather than removing it: the string still reaches the
 * browser's history and the web host's access log, which is inherent to a
 * capability URL and bounded by expiry and revoke.
 *
 * **A URL with nothing usable in it falls back to the stash**, which is what a
 * rider returning from sign-in or from the onboarding wizard arrives with — the
 * whole reason the stash exists.
 */
describe.each([
  { kind: 'ride' as const, token: LIVE_RIDE, path: '/rides/join' },
  { kind: 'club' as const, token: LIVE_CLUB, path: '/clubs/join' },
])('adopting a $kind token from the address bar', ({ kind, token, path }) => {
  it('stashes it, publishes it and takes it out of the URL', () => {
    const replaced = installWindow({}, false, `?token=${token}`)
    adoptInviteTokenFromLocation(kind)

    expect(readStashedInviteToken(kind)).toBe(token)
    expect(getPendingInviteToken(kind)).toBe(token)
    expect(replaced).toEqual([path])
  })

  it('falls back to the stash when the URL carries nothing usable', () => {
    const storage = { [PENDING_INVITE_TOKEN_KEYS[kind]]: token }
    const replaced = installWindow(storage, false, '?token=nope')
    adoptInviteTokenFromLocation(kind)

    expect(getPendingInviteToken(kind)).toBe(token)
    // Nothing was taken out of the URL, because nothing usable was in it — and
    // the malformed value was never written over the good stash.
    expect(replaced).toEqual([])
    expect(storage[PENDING_INVITE_TOKEN_KEYS[kind]]).toBe(token)
  })

  it('publishes a decided null when there is no token anywhere', () => {
    // `undefined` is "not yet" and draws a skeleton; this is the answer that
    // draws the invalid-link message, so it must actually arrive.
    installWindow({}, false, '')
    expect(getPendingInviteToken(kind)).toBeUndefined()
    adoptInviteTokenFromLocation(kind)
    expect(getPendingInviteToken(kind)).toBeNull()
  })
})

/**
 * **The two kinds are the identical shape, and this module does NOT tell
 * them apart by content** — `design.md` §Where the credential lives is
 * explicit that cross-spending is refused at the DATABASE, never here: a
 * club token hitting `ride_invite_link_preview` simply matches no row, since
 * the two RPCs each read one table. This test pins that division of labour
 * rather than the tempting, wrong invariant — that the client itself refuses
 * a same-shaped token adopted under the "wrong" kind — because both schemas
 * accept exactly the same 32-lowercase-hex pattern and neither could ever
 * decide that from the string alone.
 *
 * What keeps a rider from landing here at all is `adoptInviteTokenFromLocation`
 * only ever being called with a **fixed** kind per route — `/rides/join`
 * passes `'ride'`, `/clubs/join` passes `'club'`, and neither page can call
 * the other's. A ride token pasted into `/clubs/join?token=…` is adopted as
 * a CLUB token by this module, and it is `claim_club_invite_link` — not this
 * file — that then answers "no longer valid" for it.
 */
describe('the two kinds are shape-identical, so the database is what refuses cross-spending', () => {
  it('adopts a well-formed RIDE token under the CLUB kind when club’s own page asks for it', () => {
    installWindow({}, false, `?token=${LIVE_RIDE}`)
    adoptInviteTokenFromLocation('club')

    // Stashed and published — this module has no way to know it "belongs" to
    // the other kind, and does not try to.
    expect(getPendingInviteToken('club')).toBe(LIVE_RIDE)
    expect(readStashedInviteToken('club')).toBe(LIVE_RIDE)
  })
})

describe('when there is nowhere to stash it', () => {
  it('says nothing rather than throwing, with no window at all', () => {
    // The SSR pass. `signOut` imports this module, so a throw here is a build
    // failure rather than a degraded screen.
    expect(() => stashInviteToken('ride', LIVE_RIDE)).not.toThrow()
    expect(readStashedInviteToken('ride')).toBeNull()
    expect(() => clearAllStashedInviteTokens()).not.toThrow()
  })

  it('adopts nothing rather than throwing with no window at all', () => {
    expect(() => adoptInviteTokenFromLocation('ride')).not.toThrow()
    expect(getPendingInviteToken('ride')).toBeUndefined()
  })

  it('says nothing rather than throwing when the store itself refuses', () => {
    // A Safari private window, or an iframe with third-party storage blocked. A
    // rider who cannot stash is a rider who re-taps their own WhatsApp message
    // — the URL is the durable copy, which is what makes this failure cheap.
    installWindow({}, true)
    expect(() => stashInviteToken('ride', LIVE_RIDE)).not.toThrow()
    expect(readStashedInviteToken('ride')).toBeNull()
    expect(() => clearAllStashedInviteTokens()).not.toThrow()
  })
})
