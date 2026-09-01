import { rideInviteTokenSchema } from '@/lib/validation/rides'
import { clubInviteTokenSchema } from '@/lib/validation/clubs'
import { CLUB_JOIN_PATH, INVITE_TOKEN_PARAM, RIDE_JOIN_PATH } from '@/lib/routes'

/**
 * Where an invite token lives between opening the link and tapping Join —
 * `091`, PD-330, generalised by `093` (PD-360) to hold **two** kinds.
 *
 * ## The URL is the durable copy; this is the convenience
 *
 * The token rides in the WhatsApp message permanently, so re-tapping it is a
 * recovery path that needs no engineering. This exists for one case only: a
 * rider who has to sign in or sign up *in this tab* before they can be shown
 * anything, and who must land back on the ride or club they were looking at
 * rather than on `/postcards`.
 *
 * ## Two kinds, one key each, and the two must never spend each other
 *
 * A club token is a second capability of the identical 32-hex shape a ride
 * token has (`design.md` §Where the credential lives). Cross-spending is
 * already impossible at the database — a club token handed to
 * `ride_invite_link_preview` simply matches no row, since the two RPCs each
 * read one table — but sending the *rider* to the wrong landing screen is a
 * correctness bug in the product rather than in the schema, which is why every
 * function here takes a `kind` rather than assuming one.
 *
 * ## `sessionStorage`, never `localStorage`
 *
 * A credential whose whole security is possession must not outlive its tab. On
 * a shared laptop a `localStorage` stash left by an abandoned sign-up is a live
 * grant sitting on somebody else's device, with an expiry only the server knows
 * about. `sessionStorage` dies with the tab, which is the whole reason it is the
 * choice — and it still survives the three or four screens of the onboarding
 * wizard, which is the one thing the stash has to do.
 *
 * **Sign-out clears BOTH** (`signOut` calls `clearAllStashedInviteTokens`),
 * because a token is both a trace of the rider and a credential, and
 * `client-session-storage`'s standing rule is that sign-out destroys every
 * local trace — one kind left behind would be exactly that trace.
 *
 * ## It is spent by a tap and by nothing else
 *
 * Nothing here claims anything. No effect, no route-guard branch and no
 * `onAuthStateChange` listener may turn a stashed token into a `ride_members`
 * or `club_members` row: rider A opens a link, abandons sign-up, rider B signs
 * in in the same tab, and an automatic claim would join **rider B** to a
 * private ride or club they were never told about — a claim that is perfectly
 * valid at the database layer, where the caller is authenticated, onboarded and
 * unblocked and the token is live. No policy, trigger or RLS assertion can see
 * that; only the client contract can. `RideInviteJoin` and `ClubInviteJoin` are
 * where each is held, and their tests are what keep it.
 *
 * ## Every function fails silently
 *
 * `sessionStorage` throws in a Safari private window and in an iframe with
 * third-party storage blocked, and a rider who cannot stash is a rider who has
 * to re-tap their own WhatsApp message — a worse experience, never a broken one.
 * Throwing would take down a public screen for a convenience.
 *
 * ## Why there is a subscribable snapshot as well as the store
 *
 * The landing screen cannot read `sessionStorage` during render — there is none
 * in the prerender pass, and a value read there would be a hydration mismatch —
 * so the resolution happens in an effect. An effect that then calls `setState`
 * is what `react-hooks`' cascading-render rule refuses, and rightly: the answer
 * is the shape `guard-cache.ts` and `lib/query/connectivity.ts` already use here
 * — a module-level snapshot with listeners, read through
 * `useSyncExternalStore`, published from the effect. It has a second benefit
 * that is not incidental: the token is resolved **once per page load** rather
 * than once per mount, so navigating away and back does not re-run the adopt.
 */
export type InviteTokenKind = 'ride' | 'club'

/** One storage key per kind — never `localStorage`, see the header. */
export const PENDING_INVITE_TOKEN_KEYS: Record<InviteTokenKind, string> = {
  ride: 'letsride.pendingInviteToken',
  club: 'letsride.pendingClubInviteToken',
}

const TOKEN_SCHEMAS: Record<InviteTokenKind, { safeParse: (value: string) => { success: boolean } }> = {
  ride: rideInviteTokenSchema,
  club: clubInviteTokenSchema,
}

const JOIN_PATHS: Record<InviteTokenKind, string> = {
  ride: RIDE_JOIN_PATH,
  club: CLUB_JOIN_PATH,
}

function isWellFormed(kind: InviteTokenKind, value: string): boolean {
  return TOKEN_SCHEMAS[kind].safeParse(value).success
}

function store(): Storage | null {
  // `typeof window` rather than a browser check inside a try: this module is
  // imported by `lib/actions/auth.ts`, which is reachable from the SSR pass's
  // module graph even though nothing calls it there.
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Hold the token the landing route was opened with.
 *
 * **Parsed before it is written**, so a hand-edited URL cannot put a string in
 * the stash that is later handed back to the RPC. The schema owns the message
 * and the database owns the guarantee, as everywhere else — this is the cheap
 * half, refusing a value that could only ever come back as a dead link.
 */
export function stashInviteToken(kind: InviteTokenKind, token: string): void {
  if (!isWellFormed(kind, token)) return
  try {
    store()?.setItem(PENDING_INVITE_TOKEN_KEYS[kind], token)
  } catch {
    // Quota or a blocked store. See the header: the URL is the durable copy.
  }
  // Published even when the write failed, deliberately: the token came from
  // this rider's own address bar, and a browser that refuses storage should
  // cost them the round trip through sign-in, not this page load.
  publish(kind, token)
}

/** The stashed token, or `null`. A stored value that no longer parses is `null`. */
export function readStashedInviteToken(kind: InviteTokenKind): string | null {
  let value: string | null = null
  try {
    value = store()?.getItem(PENDING_INVITE_TOKEN_KEYS[kind]) ?? null
  } catch {
    return null
  }
  return value && isWellFormed(kind, value) ? value : null
}

/** Clears one kind. `clearAllStashedInviteTokens` below is what `signOut` calls. */
export function clearStashedInviteToken(kind: InviteTokenKind): void {
  try {
    store()?.removeItem(PENDING_INVITE_TOKEN_KEYS[kind])
  } catch {
    // Nothing to do, and nothing worth failing a sign-out over.
  }
  publish(kind, null)
}

/**
 * Clears **both** stashes — what `signOut` calls (`093`, PD-360).
 *
 * A single call rather than the caller enumerating `InviteTokenKind`'s two
 * values itself: `client-session-storage`'s standing rule is that sign-out
 * destroys every local trace, and a third kind added here later must not need
 * a matching edit at every call site that only meant "clear the module".
 */
export function clearAllStashedInviteTokens(): void {
  clearStashedInviteToken('ride')
  clearStashedInviteToken('club')
}

/**
 * Read it and clear it in one step — what the end of onboarding and a
 * successful sign-in do.
 *
 * A separate function rather than two calls at the call site, because the two
 * must not come apart: a read without the clear leaves a live token in the tab
 * for whoever signs in next, and that is precisely the state the always-a-tap
 * rule exists to make unspendable.
 *
 * **Clearing here is safe because the URL is the durable copy.** The rider is
 * sent straight back to the landing route, which stashes it again — so the
 * stash is re-established by the screen that needs it rather than held open
 * across a navigation nothing is reading it during.
 */
export function takeStashedInviteToken(kind: InviteTokenKind): string | null {
  const token = readStashedInviteToken(kind)
  if (token) clearStashedInviteToken(kind)
  return token
}

/**
 * Whichever kind is actually stashed, read and cleared in one step — what
 * `signIn` and `setUsername` call, neither of which knows in advance whether
 * the rider arrived through a ride link or a club link.
 *
 * **Ride is checked first, arbitrarily.** Two live stashes at once would mean
 * the rider opened both kinds of link in the same tab without ever finishing
 * either detour, which is not a state either landing screen is built to
 * recover from — the ordering only decides which one wins, and it costs the
 * rider nothing: the other stash is untouched and still answers on its own
 * `/rides/join` or `/clubs/join` reload.
 */
export function takeAnyStashedInviteToken(): { kind: InviteTokenKind; token: string } | null {
  const ride = takeStashedInviteToken('ride')
  if (ride) return { kind: 'ride', token: ride }
  const club = takeStashedInviteToken('club')
  if (club) return { kind: 'club', token: club }
  return null
}

/**
 * `undefined` until something has resolved this kind's token this page load,
 * then the token or `null`.
 *
 * The three-way answer is the same one `useQuery` gives and it means the same
 * thing: `undefined` is *not yet* and draws a skeleton, `null` is *decided* and
 * draws the invalid-link message.
 */
const snapshot: Record<InviteTokenKind, string | null | undefined> = {
  ride: undefined,
  club: undefined,
}
const listeners = new Set<() => void>()

function publish(kind: InviteTokenKind, next: string | null): void {
  if (snapshot[kind] === next) return
  snapshot[kind] = next
  for (const listener of listeners) listener()
}

export function getPendingInviteToken(kind: InviteTokenKind): string | null | undefined {
  return snapshot[kind]
}

/** What the prerender pass and the hydration render both see — nothing resolved. */
export function getServerPendingInviteToken(): undefined {
  return undefined
}

/**
 * Kind-agnostic, matching `useSyncExternalStore`'s single-argument contract —
 * both hooks share one listener set and each re-reads only its own kind's
 * snapshot, so a club token resolving does not cost a ride-token subscriber a
 * value change.
 */
export function subscribePendingInviteToken(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Resolve the token from the address bar, stash it, and take it out of the
 * visible URL — the landing route's one side effect, run from its mount effect.
 *
 * **`history.replaceState` reduces exposure and does not remove it.** The token
 * still reaches the browser's history and — since the web build runs a server on
 * Vercel, whatever `output: 'export'` in the *Capacitor* config suggests — that
 * server's access log. Inherent to a capability URL and bounded by expiry and
 * revoke rather than by secrecy. What it does buy is that the string is not
 * sitting on a shared screen or riding a `Referer` for the rest of the visit.
 *
 * A URL with no usable token falls back to the stash, which is what a rider
 * coming back from sign-in or from the onboarding wizard arrives with.
 */
export function adoptInviteTokenFromLocation(kind: InviteTokenKind): void {
  if (typeof window === 'undefined') return

  const fromUrl = new URLSearchParams(window.location.search).get(INVITE_TOKEN_PARAM)
  if (fromUrl && isWellFormed(kind, fromUrl)) {
    stashInviteToken(kind, fromUrl)
    // The address bar and nothing else: `replaceState` leaves the React tree and
    // the Next router alone, which is what makes it safe to call from a screen
    // that is not navigating anywhere.
    window.history.replaceState(window.history.state, '', JOIN_PATHS[kind])
    return
  }

  publish(kind, readStashedInviteToken(kind))
}

/** Test-only: the snapshot is module state and outlives a single `it`. */
export function resetPendingInviteTokenForTests(): void {
  snapshot.ride = undefined
  snapshot.club = undefined
  listeners.clear()
}
