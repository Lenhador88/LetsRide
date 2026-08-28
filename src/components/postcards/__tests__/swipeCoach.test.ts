import { describe, expect, it } from 'vitest'
import { SWIPE_COACH_KEY, claimSwipeCoach } from '@/components/postcards/swipeCoach'

/**
 * The deck's coach mark shows **once per device** (PD-324), and "once" is the
 * whole contract: *"a coach mark that returns is worse than none."* Everything
 * below is that sentence, including the three ways a store can refuse to hold
 * the flag — in each of them the honest answer is not to show it, because a
 * flag that cannot be written means showing it on every mount of the deck.
 *
 * `claimSwipeCoach` takes the store as an argument rather than reaching for
 * `window`, which is what lets this run under `vitest.config.ts`'s
 * `environment: 'node'` with no DOM.
 */

function fakeStore(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

describe('claimSwipeCoach', () => {
  it('coaches the first sight and never a second one', () => {
    const store = fakeStore()

    expect(claimSwipeCoach(store)).toBe(true)
    expect(claimSwipeCoach(store)).toBe(false)
    expect(claimSwipeCoach(store)).toBe(false)
  })

  it('spends the flag at first sight rather than at dismissal', () => {
    // The reason this is asserted separately from the call above: a rider who
    // leaves the screen before dismissing — a navigation, a reload, a
    // backgrounded app — must still not meet the coach mark again, and the only
    // thing that can guarantee it is the write having already happened by the
    // time `true` is returned.
    const store = fakeStore()

    expect(claimSwipeCoach(store)).toBe(true)
    expect(store.getItem(SWIPE_COACH_KEY)).not.toBeNull()
  })

  it('stays silent for a device that was already coached', () => {
    expect(claimSwipeCoach(fakeStore({ [SWIPE_COACH_KEY]: '1' }))).toBe(false)
  })

  it('keys itself under `letsride:` so signing out does not re-arm it', () => {
    // `clearSessionStore()` sweeps localStorage on sign-out and removes only
    // the Supabase-prefixed keys — `session-store.test.ts` asserts a
    // `letsride:`-prefixed key survives. The coach mark is a fact about the
    // device, not about the session, so it has to be on the surviving side.
    expect(SWIPE_COACH_KEY.startsWith('letsride:')).toBe(true)
    expect(SWIPE_COACH_KEY.startsWith('sb-')).toBe(false)
  })

  it('shows nothing when there is no store at all', () => {
    // The SSR/prerender pass, and Safari with site data blocked, where reading
    // `window.localStorage` throws before there is anything to call.
    expect(claimSwipeCoach(null)).toBe(false)
  })

  it('shows nothing when the store refuses the read', () => {
    const store = fakeStore()
    store.getItem = () => {
      throw new Error('site data disabled')
    }

    expect(claimSwipeCoach(store)).toBe(false)
  })

  it('shows nothing when the store accepts the read and refuses the write', () => {
    // Private mode and a full quota both land here, and this is the case the
    // fail-safe direction exists for: answering `true` would put the pill up on
    // every mount of the deck for ever, since nothing recorded that it ran.
    const store = fakeStore()
    store.setItem = () => {
      throw new Error('quota exceeded')
    }

    expect(claimSwipeCoach(store)).toBe(false)
  })
})
