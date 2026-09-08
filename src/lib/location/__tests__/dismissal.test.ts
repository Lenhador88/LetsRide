// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QUIET_BASE_MS,
  QUIET_CAP_MS,
  clearDismissal,
  isQuiet,
  isQuestionQuiet,
  quietFor,
  readDismissal,
  recordAnswered,
  recordDismissal,
  resetDismissalForTests,
} from '@/lib/location/dismissal'

/**
 * The Explore question's dismissal ladder — PD-447, replacing `ask-once.ts`'s
 * once-ever boolean.
 *
 * **jsdom, and the reason is `localStorage` itself.** This module IS the store;
 * under `environment: 'node'` there is none, so every assertion below would
 * pass against an implementation that did nothing at all. It is the same reason
 * `ask-once.test.ts` carried the directive.
 *
 * **The ladder is a pure function of the count**, so every rung is asserted
 * without faking a clock; only the store's failure modes need a stub. Each case
 * names the defect it stops.
 *
 * **Verified both ways** (mutate, watch it go red, revert): making `readDismissal`
 * a bare `JSON.parse` in a `try` fails *the retired `'1'` is not a record*;
 * dropping the `now < at` guard fails *a clock that moved backwards*; starting
 * `recordDismissal` from `NaN` on a corrupt record fails *a corrupt record
 * restarts the ladder at one*.
 */

const KEY = 'letsride.location.dismissedQuestion'
const RETIRED = 'letsride.location.asked'
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0)

beforeEach(() => {
  resetDismissalForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetDismissalForTests()
})

describe('the interval ladder', () => {
  it.each([
    [0, 30],
    [1, 30],
    [2, 60],
    [3, 120],
    [4, 180],
    [5, 180],
    [40, 180],
  ])('n=%i keeps the question quiet for %i days', (n, days) => {
    // `n: 0` is the rider who ANSWERED and shares the base rung with the rider
    // who declined once — neither has earned more than a month of silence. The
    // cap is what stops a rider who taps `Not now` a dozen times from never
    // being asked again for the life of the install.
    expect(quietFor(n)).toBe(days * DAY)
  })

  it('never exceeds the cap, whatever arithmetic a huge count produces', () => {
    // `2 ** 1024` is `Infinity`, and `Math.min(Infinity, cap)` is the cap — so
    // an absurd stored count degrades to six months rather than to `NaN`, which
    // would compare false against everything and make the row draw for ever.
    expect(quietFor(Number.MAX_SAFE_INTEGER)).toBe(QUIET_CAP_MS)
    expect(QUIET_BASE_MS).toBe(30 * DAY)
  })
})

describe('isQuiet', () => {
  it('is false with no record at all', () => {
    expect(isQuiet(null, NOW)).toBe(false)
  })

  it('is true inside the interval and false the moment it runs out', () => {
    const record = { at: NOW, n: 1 }
    expect(isQuiet(record, NOW)).toBe(true)
    expect(isQuiet(record, NOW + 29 * DAY)).toBe(true)
    // Exactly at the boundary the question comes back — a half-open interval,
    // so no instant belongs to both.
    expect(isQuiet(record, NOW + 30 * DAY)).toBe(false)
    expect(isQuiet(record, NOW + 31 * DAY)).toBe(false)
  })

  it('treats a record stamped in the future as absent', () => {
    // A device clock that moved backwards. Without this the question is silent
    // until the clock catches up, which for a year-ahead clock is for ever,
    // with nothing on any screen to explain it.
    expect(isQuiet({ at: NOW + DAY, n: 1 }, NOW)).toBe(false)
  })
})

describe('what counts as a record', () => {
  it('reads back what it wrote', () => {
    recordDismissal(NOW)
    expect(readDismissal()).toEqual({ at: NOW, n: 1 })
  })

  it.each([
    ['the retired ask-once value', '1'],
    ['a bare string', '"x"'],
    ['a JSON null', 'null'],
    ['an array', '[]'],
    ['not JSON at all', '{oh no'],
    ['a missing count', '{"at":123}'],
    ['a missing stamp', '{"n":2}'],
    ['a non-numeric stamp', '{"at":"123","n":1}'],
    ['a non-finite stamp', '{"at":null,"n":1}'],
    ['a fractional count', '{"at":123,"n":1.5}'],
    ['a negative count', '{"at":123,"n":-1}'],
  ])('%s is not a record, and fails open', (_name, stored) => {
    // **`'1'` is the one that matters most**: it is the value `ask-once.ts`
    // left on every returning rider's device, and `JSON.parse('1')` SUCCEEDS
    // and returns a number. A guard that only wraps the parse accepts it and
    // then throws on a property read somewhere less obvious.
    globalThis.localStorage.setItem(KEY, stored)
    expect(readDismissal()).toBeNull()
    expect(isQuestionQuiet(NOW)).toBe(false)
  })

  it('fails open when the store throws on read', () => {
    // A private window, a browser set to block site data, some WebView
    // previews. The worst case is a rider being asked again; treating an
    // unreadable store as quiet would remove the question for that rider with
    // no signal anywhere that it happened.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
      removeItem: () => {},
    })
    expect(readDismissal()).toBeNull()
    expect(isQuestionQuiet(NOW)).toBe(false)
  })

  it('swallows a store that throws on write', () => {
    // Unavoidable: the question comes back next visit. The nuisance is priced;
    // a throw escaping here would take down the sheet's close handler with it.
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    })
    expect(() => recordDismissal(NOW)).not.toThrow()
    expect(() => recordAnswered(NOW)).not.toThrow()
    expect(() => clearDismissal()).not.toThrow()
  })
})

describe('climbing and resetting', () => {
  it('climbs one rung per consecutive dismissal', () => {
    recordDismissal(NOW)
    expect(isQuestionQuiet(NOW + 29 * DAY)).toBe(true)

    recordDismissal(NOW + 31 * DAY)
    expect(readDismissal()).toEqual({ at: NOW + 31 * DAY, n: 2 })
    // 60 days now, not 30 — the rider who keeps declining is asked least often.
    expect(isQuestionQuiet(NOW + 31 * DAY + 45 * DAY)).toBe(true)
  })

  it('restarts the ladder at one when the stored record is corrupt', () => {
    // Rather than at `NaN`, which would make every later comparison false and
    // put the question back on every screen for ever.
    globalThis.localStorage.setItem(KEY, '{"at":"nope"}')
    recordDismissal(NOW)
    expect(readDismissal()).toEqual({ at: NOW, n: 1 })
  })

  it('an answer puts the ladder back on its first rung', () => {
    recordDismissal(NOW)
    recordDismissal(NOW + 31 * DAY)
    recordDismissal(NOW + 100 * DAY)
    expect(readDismissal()?.n).toBe(3)

    recordAnswered(NOW + 101 * DAY)
    expect(readDismissal()).toEqual({ at: NOW + 101 * DAY, n: 0 })
    // Quiet for the base interval and no longer, so a rider whose town changes
    // again is asked at the ordinary cadence rather than in six months.
    expect(isQuestionQuiet(NOW + 101 * DAY + 29 * DAY)).toBe(true)
    expect(isQuestionQuiet(NOW + 101 * DAY + 31 * DAY)).toBe(false)
  })

  it('a clear removes the record outright, and the retired key with it', () => {
    // The retired key is removed rather than left: an unread
    // `letsride.location.asked === '1'` means "the automatic ask was spent",
    // and after PD-447 nothing may act on that.
    globalThis.localStorage.setItem(RETIRED, '1')
    recordDismissal(NOW)

    clearDismissal()

    expect(globalThis.localStorage.getItem(KEY)).toBeNull()
    expect(globalThis.localStorage.getItem(RETIRED)).toBeNull()
    expect(isQuestionQuiet(NOW)).toBe(false)
  })
})
