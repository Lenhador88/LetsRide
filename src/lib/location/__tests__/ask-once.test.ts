// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hasAskedForLocation,
  markAskedForLocation,
  resetAskedForLocationForTests,
} from '@/lib/location/ask-once'

/**
 * The one-shot that decides whether the app asks a rider where they are without
 * being tapped — PD-419.
 *
 * **jsdom rather than `environment: 'node'`, structurally.** This module IS
 * `localStorage`; under node there is no storage to read, so every assertion
 * would pass against an implementation that did nothing at all.
 *
 * The failing-open rule is the half worth pinning: an unreadable store must
 * read as *not yet asked*. The other reading silently removes the automatic ask
 * for every rider in a private window, with no signal anywhere that it
 * happened.
 */

afterEach(() => {
  vi.restoreAllMocks()
  resetAskedForLocationForTests()
})

describe('the flag persists, because the thing it spends is one-way', () => {
  it('reads false before anything has asked', () => {
    expect(hasAskedForLocation()).toBe(false)
  })

  it('reads true after the ask is marked, and stays true', () => {
    markAskedForLocation()
    expect(hasAskedForLocation()).toBe(true)
    // Read twice: a flag that clears on read would re-open the sheet on the
    // second screen the rider visits in the same session.
    expect(hasAskedForLocation()).toBe(true)
  })

  it('survives a fresh module read of the same store', () => {
    markAskedForLocation()
    // The store is what persists, not module state — so a value written by one
    // page load is visible to the next. Asserting against `localStorage`
    // directly is what distinguishes that from an in-memory variable, which
    // would pass every assertion above.
    expect(window.localStorage.getItem('letsride.location.asked')).toBe('1')
  })
})

describe('an unusable store fails OPEN, and that direction is the decision', () => {
  it('reads false when getItem throws', () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    // A private window, or a browser set to block site data. The rider sees the
    // sheet once per session, which is a nuisance; the other reading removes
    // the ask for them entirely and silently.
    expect(hasAskedForLocation()).toBe(false)
  })

  it('does not throw when setItem throws', () => {
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    // A throw here would propagate out of the effect that calls it and take the
    // whole screen down — over a flag whose failure mode is one extra sheet.
    expect(() => markAskedForLocation()).not.toThrow()
  })
})
