import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachConnectivityListeners, detachConnectivityListeners, isOnline } from '@/lib/query/connectivity'
import { ensureFetch, subscribeKey } from '@/lib/query/queryClient'
import { flushMicrotasks } from '@/lib/query/__tests__/helpers'

/**
 * `connectivity.ts` is the one file in `lib/query/` allowed to touch
 * `window`/`document`/`navigator` — see its module doc. Vitest's `node`
 * environment (`vitest.config.ts`) provides none of the three, so these
 * tests stand up a minimal fake `EventTarget` rather than adding jsdom as a
 * dependency for one file — see this session's report for why that trade
 * was made rather than installed.
 */
class FakeEventTarget {
  private listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0
  }
}

let fakeDocument: FakeEventTarget & { visibilityState: 'visible' | 'hidden' }
let fakeWindow: FakeEventTarget

beforeEach(() => {
  fakeDocument = Object.assign(new FakeEventTarget(), { visibilityState: 'visible' as const })
  fakeWindow = new FakeEventTarget()
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('navigator', { onLine: true })
})

afterEach(() => {
  // Resets the module-level `attached` flag so the next test's `attach`
  // actually re-registers against its own fresh fake globals, rather than
  // silently no-op-ing because a previous test already flipped it.
  detachConnectivityListeners()
  vi.unstubAllGlobals()
})

describe('attachConnectivityListeners — registered once per module', () => {
  it('registers exactly one visibilitychange and one online listener no matter how many times it is called', () => {
    attachConnectivityListeners()
    attachConnectivityListeners()
    attachConnectivityListeners()

    expect(fakeDocument.listenerCount('visibilitychange')).toBe(1)
    expect(fakeWindow.listenerCount('online')).toBe(1)
  })

  it('is removable, and detaching lets a later attach re-register', () => {
    attachConnectivityListeners()
    detachConnectivityListeners()

    expect(fakeDocument.listenerCount('visibilitychange')).toBe(0)
    expect(fakeWindow.listenerCount('online')).toBe(0)

    attachConnectivityListeners()
    expect(fakeDocument.listenerCount('visibilitychange')).toBe(1)
  })
})

describe('what each event triggers', () => {
  it('visibilitychange refetches stale mounted queries only when the document becomes visible, not when it hides', async () => {
    const key = ['connectivity', 'visibility']
    const fetcher = vi.fn(async () => 'v')
    const unsubscribe = subscribeKey(key, () => {})
    ensureFetch(key, fetcher, 0) // stale the instant any time passes
    await flushMicrotasks()
    expect(fetcher).toHaveBeenCalledTimes(1)

    attachConnectivityListeners()

    fakeDocument.visibilityState = 'hidden'
    fakeDocument.dispatch('visibilitychange')
    expect(fetcher).toHaveBeenCalledTimes(1) // hiding the tab must not trigger a sweep

    fakeDocument.visibilityState = 'visible'
    fakeDocument.dispatch('visibilitychange')
    expect(fetcher).toHaveBeenCalledTimes(2)

    unsubscribe()
  })

  it('the online event refetches stale mounted queries', async () => {
    const key = ['connectivity', 'online']
    const fetcher = vi.fn(async () => 'v')
    const unsubscribe = subscribeKey(key, () => {})
    ensureFetch(key, fetcher, 0)
    await flushMicrotasks()
    expect(fetcher).toHaveBeenCalledTimes(1)

    attachConnectivityListeners()
    fakeWindow.dispatch('online')
    expect(fetcher).toHaveBeenCalledTimes(2)

    unsubscribe()
  })
})

describe('isOnline', () => {
  it('reads navigator.onLine when it exists', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isOnline()).toBe(false)
    vi.stubGlobal('navigator', { onLine: true })
    expect(isOnline()).toBe(true)
  })

  it('defaults true where navigator does not exist, matching SSR', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isOnline()).toBe(true)
  })
})
