import { describe, expect, it } from 'vitest'
import {
  declinesSwipeBack,
  isSwipeBack,
  startsInEdgeZone,
  SWIPE_BACK_DISTANCE_PX,
  SWIPE_BACK_EDGE_PX,
  SWIPE_BACK_FLICK_PX,
  SWIPE_BACK_MAX_MS,
  SWIPE_BACK_OPT_OUT,
  type SwipeBackNode,
} from '@/lib/swipe-back'

/**
 * PD-341's whole decision, which is the half that can be tested at all: the
 * hook around it is three window listeners and a DOM walk.
 *
 * The cases are written against the exported constants rather than against
 * literals wherever the boundary is what is being asserted, so retuning a
 * threshold does not silently retune the test with it — but the *shape* claims
 * (a flick under the distance still counts, a slow drag past the clock does
 * not) use arithmetic on those constants so they stay true whatever the numbers
 * become.
 */
const swipe = (over: Partial<Parameters<typeof isSwipeBack>[0]> = {}) => ({
  startX: 4,
  startY: 300,
  endX: 4 + SWIPE_BACK_DISTANCE_PX,
  endY: 300,
  elapsedMs: 300,
  ...over,
})

describe('startsInEdgeZone', () => {
  it('is the left strip and nothing else', () => {
    expect(startsInEdgeZone(0)).toBe(true)
    expect(startsInEdgeZone(SWIPE_BACK_EDGE_PX)).toBe(true)
    expect(startsInEdgeZone(SWIPE_BACK_EDGE_PX + 1)).toBe(false)
    // Mid-screen is where every horizontal strip is dragged from.
    expect(startsInEdgeZone(180)).toBe(false)
  })

  // A negative clientX arrives from a pointer that began outside the viewport.
  it('refuses a start outside the viewport', () => {
    expect(startsInEdgeZone(-1)).toBe(false)
  })
})

describe('isSwipeBack — the two ways to qualify', () => {
  it('takes a long deliberate drag', () => {
    expect(isSwipeBack(swipe())).toBe(true)
    expect(isSwipeBack(swipe({ endX: 4 + SWIPE_BACK_DISTANCE_PX - 1 }))).toBe(false)
  })

  it('takes a short fast flick, and refuses the same distance taken slowly', () => {
    const short = 4 + SWIPE_BACK_FLICK_PX
    expect(isSwipeBack(swipe({ endX: short, elapsedMs: 60 }))).toBe(true)
    // Same travel, ten times the time: a drift, not a flick.
    expect(isSwipeBack(swipe({ endX: short, elapsedMs: 600 }))).toBe(false)
  })

  it('refuses a flick shorter than the flick floor however fast it was', () => {
    expect(isSwipeBack(swipe({ endX: 4 + SWIPE_BACK_FLICK_PX - 1, elapsedMs: 8 }))).toBe(false)
  })
})

describe('isSwipeBack — what it refuses', () => {
  it('refuses a leftward drag', () => {
    expect(isSwipeBack(swipe({ endX: 4 - SWIPE_BACK_DISTANCE_PX }))).toBe(false)
  })

  it('refuses a drag that is mostly vertical', () => {
    // Far enough to pass the distance test, and a scroll.
    expect(isSwipeBack(swipe({ endY: 300 + SWIPE_BACK_DISTANCE_PX }))).toBe(false)
    // A diagonal inside the ratio still counts — a thumb arcs.
    expect(isSwipeBack(swipe({ endY: 300 + SWIPE_BACK_DISTANCE_PX / 4 }))).toBe(true)
  })

  it('refuses a gesture the rider rested on', () => {
    expect(isSwipeBack(swipe({ elapsedMs: SWIPE_BACK_MAX_MS + 1 }))).toBe(false)
  })

  // A zero-duration sample makes `dx / elapsed` Infinity, which would qualify
  // every synthetic pointer pair as a flick.
  it('does not treat a zero-duration sample as an infinitely fast flick', () => {
    expect(isSwipeBack(swipe({ endX: 4 + SWIPE_BACK_FLICK_PX, elapsedMs: 0 }))).toBe(false)
    // The long-drag route needs no clock, so it still passes at zero.
    expect(isSwipeBack(swipe({ elapsedMs: 0 }))).toBe(true)
  })
})

/**
 * The ancestor chain, built root-last exactly as the hook builds it: `parent`
 * walks *up*, so `node(...)` here reads target-first.
 */
const node = (over: Partial<SwipeBackNode> = {}): SwipeBackNode => ({
  scrollWidth: 100,
  clientWidth: 100,
  overflowX: 'visible',
  optOut: null,
  tagName: 'DIV',
  isContentEditable: false,
  parent: null,
  ...over,
})

const scroller = (parent: SwipeBackNode | null = null) =>
  node({ scrollWidth: 900, clientWidth: 390, overflowX: 'auto', parent })

describe('declinesSwipeBack', () => {
  it('allows an ordinary page', () => {
    expect(declinesSwipeBack(node({ parent: node() }))).toBe(false)
    expect(declinesSwipeBack(null)).toBe(false)
  })

  // `ExploreRidesStrip`'s tiles, the club's ride strip — all
  // full-bleed, so an edge-origin gesture genuinely lands inside one. This is
  // the test the edge zone cannot do on its own.
  it('declines inside a horizontal scroller, however deep', () => {
    expect(declinesSwipeBack(node({ parent: scroller() }))).toBe(true)
    expect(declinesSwipeBack(node({ parent: node({ parent: scroller() }) }))).toBe(true)
  })

  // A strip scrolled to its left end still owns the axis: the rider is dragging
  // a strip with nowhere to go, not asking to leave. Recognising it by *whether
  // it can scroll right now* would make the gesture fire only on the strips the
  // rider had already scrolled, which is the worst kind of intermittent.
  it('declines on a scroller regardless of where it is scrolled', () => {
    expect(declinesSwipeBack(scroller())).toBe(true)
  })

  it('allows content that merely overflows without scrolling', () => {
    expect(
      declinesSwipeBack(node({ scrollWidth: 900, clientWidth: 390, overflowX: 'visible' }))
    ).toBe(false)
    // A vertical scroller is not this gesture's business.
    expect(declinesSwipeBack(node({ scrollWidth: 390, clientWidth: 390, overflowX: 'auto' }))).toBe(
      false
    )
  })

  it('declines where a component claimed the axis by hand', () => {
    expect(declinesSwipeBack(node({ parent: node({ optOut: 'off' }) }))).toBe(true)
    // Only the documented value opts out, so an unrelated attribute value
    // cannot silently disable the gesture across a screen.
    expect(declinesSwipeBack(node({ optOut: 'on' }))).toBe(false)
    expect(SWIPE_BACK_OPT_OUT).toBe('data-swipe-back')
  })

  it('declines inside anything that takes text', () => {
    // The postcard thread's comment box and the ride chat's composer.
    expect(declinesSwipeBack(node({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(declinesSwipeBack(node({ tagName: 'INPUT' }))).toBe(true)
    expect(declinesSwipeBack(node({ isContentEditable: true }))).toBe(true)
  })
})
