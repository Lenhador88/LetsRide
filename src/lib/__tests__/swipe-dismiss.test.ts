import { describe, expect, it } from 'vitest'
import {
  armsSwipeDismiss,
  declinesSwipeDismiss,
  isSwipeDismiss,
  SWIPE_DISMISS_ARM_PX,
  SWIPE_DISMISS_DISTANCE_PX,
  SWIPE_DISMISS_FLICK_PX,
  SWIPE_DISMISS_MAX_MS,
  type SwipeDismissNode,
} from '@/lib/swipe-dismiss'

/**
 * PD-475's whole decision, which is the half that can be tested at all: the
 * hook around it reads the panel's own scroll position and the DOM, neither
 * of which belongs in a `node`-environment test.
 */
const sample = (over: Partial<Parameters<typeof isSwipeDismiss>[0]> = {}) => ({
  startX: 4,
  startY: 300,
  endX: 4,
  endY: 300 + SWIPE_DISMISS_DISTANCE_PX,
  elapsedMs: 300,
  ...over,
})

describe('isSwipeDismiss — the two ways to qualify', () => {
  it('takes a long deliberate pull', () => {
    expect(isSwipeDismiss(sample())).toBe(true)
    expect(isSwipeDismiss(sample({ endY: 300 + SWIPE_DISMISS_DISTANCE_PX - 1 }))).toBe(false)
  })

  it('takes a short fast flick, and refuses the same distance taken slowly', () => {
    const short = 300 + SWIPE_DISMISS_FLICK_PX
    expect(isSwipeDismiss(sample({ endY: short, elapsedMs: 60 }))).toBe(true)
    // Same travel, ten times the time: a drift, not a flick.
    expect(isSwipeDismiss(sample({ endY: short, elapsedMs: 600 }))).toBe(false)
  })

  it('refuses a flick shorter than the flick floor however fast it was', () => {
    expect(
      isSwipeDismiss(sample({ endY: 300 + SWIPE_DISMISS_FLICK_PX - 1, elapsedMs: 8 }))
    ).toBe(false)
  })
})

describe('isSwipeDismiss — what it refuses', () => {
  // "An upward drag, at any scroll position, closes nothing" — the negative
  // case this pins is the direction test alone; the scroll-position half of
  // that sentence is the component's `scrollTop` guard, not this function's.
  it('refuses an upward drag', () => {
    expect(isSwipeDismiss(sample({ endY: 300 - SWIPE_DISMISS_DISTANCE_PX }))).toBe(false)
    expect(isSwipeDismiss(sample({ endY: 300 }))).toBe(false)
  })

  // "A drag starting on the PostcardCard ... a mostly-horizontal gesture must
  // not dismiss" — pinned here at the release test; `armsSwipeDismiss` refuses
  // the same shape before the panel ever starts following the finger.
  it('refuses a drag that is mostly horizontal, even a long deliberate one', () => {
    // `dy` alone clears the distance floor; `dx` is larger still, so the axis
    // test is what refuses it — a naive version testing distance alone would
    // pass this.
    expect(
      isSwipeDismiss(sample({ endX: 4 + SWIPE_DISMISS_DISTANCE_PX * 3, endY: 300 + SWIPE_DISMISS_DISTANCE_PX }))
    ).toBe(false)
    // A diagonal inside the ratio still counts — a thumb arcs.
    expect(
      isSwipeDismiss(sample({ endX: 4 + SWIPE_DISMISS_DISTANCE_PX / 4 }))
    ).toBe(true)
  })

  it('refuses a gesture the rider rested on', () => {
    expect(isSwipeDismiss(sample({ elapsedMs: SWIPE_DISMISS_MAX_MS + 1 }))).toBe(false)
  })

  // A zero-duration sample makes `dy / elapsed` Infinity, which would qualify
  // every synthetic pointer pair as a flick.
  it('does not treat a zero-duration sample as an infinitely fast flick', () => {
    expect(
      isSwipeDismiss(sample({ endY: 300 + SWIPE_DISMISS_FLICK_PX, elapsedMs: 0 }))
    ).toBe(false)
    // The long-pull route needs no clock, so it still passes at zero.
    expect(isSwipeDismiss(sample({ elapsedMs: 0 }))).toBe(true)
  })
})

describe('armsSwipeDismiss', () => {
  it('does not arm on a wobble under the slop', () => {
    expect(armsSwipeDismiss(0, SWIPE_DISMISS_ARM_PX - 1)).toBe(false)
  })

  it('arms once the slop is cleared, downward and vertical', () => {
    expect(armsSwipeDismiss(0, SWIPE_DISMISS_ARM_PX)).toBe(true)
    expect(armsSwipeDismiss(1, SWIPE_DISMISS_ARM_PX + 10)).toBe(true)
  })

  it('never arms on an upward move, of any size', () => {
    expect(armsSwipeDismiss(0, -50)).toBe(false)
    expect(armsSwipeDismiss(0, 0)).toBe(false)
  })

  it('never arms on a mostly-horizontal move', () => {
    expect(armsSwipeDismiss(40, SWIPE_DISMISS_ARM_PX)).toBe(false)
  })
})

/**
 * The ancestor chain, built root-last exactly as the component builds it:
 * `parent` walks *up*, so `node(...)` here reads target-first.
 */
const node = (over: Partial<SwipeDismissNode> = {}): SwipeDismissNode => ({
  tagName: 'DIV',
  isContentEditable: false,
  parent: null,
  ...over,
})

describe('declinesSwipeDismiss', () => {
  it('allows an ordinary drag over plain content', () => {
    expect(declinesSwipeDismiss(node({ parent: node() }))).toBe(false)
    expect(declinesSwipeDismiss(null)).toBe(false)
  })

  // CommentForm's own composer.
  it('declines inside anything that takes text, however deep', () => {
    expect(declinesSwipeDismiss(node({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(declinesSwipeDismiss(node({ tagName: 'INPUT' }))).toBe(true)
    expect(declinesSwipeDismiss(node({ tagName: 'SELECT' }))).toBe(true)
    expect(declinesSwipeDismiss(node({ isContentEditable: true }))).toBe(true)
    expect(declinesSwipeDismiss(node({ parent: node({ tagName: 'TEXTAREA' }) }))).toBe(true)
  })

  // Like, comment, share, the overflow menu trigger, and the byline/club links
  // — a tap or a drag on any of them keeps its own click rather than arming a
  // dismiss underneath it.
  it('declines on a button or a link, however deep', () => {
    expect(declinesSwipeDismiss(node({ tagName: 'BUTTON' }))).toBe(true)
    expect(declinesSwipeDismiss(node({ tagName: 'A' }))).toBe(true)
    expect(
      declinesSwipeDismiss(node({ parent: node({ tagName: 'BUTTON', parent: node() }) }))
    ).toBe(true)
  })
})
