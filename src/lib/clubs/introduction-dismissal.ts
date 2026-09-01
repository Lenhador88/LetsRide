/**
 * Per-(rider, club) dismissal of the introduction prompt — `design.md` §D7,
 * PD-365.
 *
 * **Once per membership, not once per visit.** The prompt's own state rule
 * (`owesIntroduction` in `lib/data/club-introductions.ts`) is satisfied for
 * ever once an introduction exists, but a rider who taps `Not now` has not
 * written one — so without this, the very next navigation to the same club
 * would ask again. This is what makes a dismissal stick for the rest of the
 * visit, and no longer.
 *
 * **A dismissal is not a fact about the club, so it does not live in the
 * schema** — `design.md` §D7 is explicit that it "belongs in the session
 * store rather than the schema". `sessionStorage`, never `localStorage`, on
 * `pending-token.ts`'s exact reasoning one feature over: a dismissal is a
 * trace of THIS rider's session, and a shared laptop must not carry rider A's
 * "not now" into rider B's visit to the same club. `signOut` clears it
 * (`clearIntroductionDismissals`), which is the correct behaviour per
 * `client-session-storage`'s standing rule — signing out and back in is not a
 * state the app preserves opinions across.
 *
 * **Fails silently, like every function in `pending-token.ts`.**
 * `sessionStorage` throws in a Safari private window and in an iframe with
 * third-party storage blocked; a rider who cannot stash a dismissal is a
 * rider who is asked again next visit, which is a worse experience and never
 * a broken one.
 *
 * ## Read through `useSyncExternalStore`, not `useState` plus an effect
 *
 * The obvious shape — `useState(false)` seeded by `isIntroductionDismissed`
 * inside a mount effect — is exactly the pattern
 * `react-hooks/set-state-in-effect` refuses: calling `setState` synchronously
 * as the only thing an effect does is a cascading render React's own lint
 * rule flags. `pending-token.ts` already solved the identical problem (a
 * value that lives outside React and cannot be read during the SSR pass) with
 * a module-level publish/subscribe pair read through `useSyncExternalStore`,
 * and this reuses that shape rather than reinventing a worse one.
 */
const STORAGE_KEY = 'letsride.dismissedIntroductions'

function store(): Storage | null {
  // `typeof window` rather than a browser check inside a try — this module is
  // reachable from the SSR pass's module graph even though nothing calls it
  // there, matching `pending-token.ts`'s `store()`.
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function readDismissedIds(): Set<string> {
  try {
    const raw = store()?.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

/**
 * The synchronous answer, for a caller that already knows it is in an event
 * handler or an effect. `useIntroductionDismissed` below is what a component
 * should call instead — this is exported because `dismissIntroductionPrompt`
 * and the store's own listeners both need the bare check.
 */
export function isIntroductionDismissed(clubId: string): boolean {
  return readDismissedIds().has(clubId)
}

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function dismissIntroductionPrompt(clubId: string): void {
  const ids = readDismissedIds()
  ids.add(clubId)
  try {
    store()?.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // Quota or a blocked store — the safe direction is that the prompt may
    // reappear next visit, never that it becomes permanently unreachable.
  }
  notify()
}

/** `signOut`'s sweep, alongside `clearAllStashedInviteTokens` and
 *  `clearRiderLocation`. */
export function clearIntroductionDismissals(): void {
  try {
    store()?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do, and nothing worth failing a sign-out over.
  }
  notify()
}

/** `useSyncExternalStore`'s subscribe half. */
export function subscribeIntroductionDismissal(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** What the SSR pass and the first hydration render both see — `sessionStorage`
 *  does not exist there, so "not dismissed" is the only answer that cannot be
 *  wrong; the prompt's other, slower reads already gate it from opening before
 *  real data has landed. */
export function getServerIntroductionDismissed(): false {
  return false
}
