/**
 * When a drag across a detail screen means "go back" — PD-341.
 *
 * Product owner, 2026-08-28: *"Can we do on details pages, where a strong swipe
 * right goes back to the previous page?"*
 *
 * ## Where it goes is decided elsewhere, and never by the history
 *
 * This module answers *is this a back gesture*. **Where back goes is
 * `back-navigation.ts`'s question**, and the gesture resolves it exactly as the
 * header's arrow does: the same `backHref` on the screens that have one, and
 * `resolveBackDestination` on `/notifications`, which has four ways in.
 *
 * `router.back()` is refused for the reason that file measured: `history.back()`
 * silently no-ops on the native shell when a screen was opened cold, and a
 * gesture that does nothing is worse than one that does not exist, because the
 * rider reads it as a broken screen rather than as a missing affordance. That
 * argument is *stronger* here than it was for the arrow — an arrow that no-ops
 * is at least visible, and a dead gesture leaves the rider swiping repeatedly
 * with nothing on screen acknowledging them.
 *
 * ## "Strong" is three tests, and none of them is sufficient alone
 *
 * The axis is already claimed on several of these screens — `PostcardDeck` owns
 * left/right on its front card, and two scrollers sit on screens the gesture
 * reaches: `RideJournal` on the ride detail, and the club's own ride strip on
 * the club detail. (It was three until the club timeline dissolved the club's
 * postcard strip on 2026-08-31 — its postcards are cards in the stream now, and
 * a card does not scroll sideways.) So the gesture has to be one nobody performs
 * by accident on those.
 *
 * **`ExploreRidesStrip` is NOT one of them, and PD-341's own body says it is.**
 * It is a single 56px link row with no `overflow-x` at all — it stopped being a
 * filter and became a door (`CLAUDE.md`'s test roster records the change), and
 * the strip that does scroll beside it on `/rides` is `FilterTile`. Neither
 * matters to this gesture either way, because `/rides` is a tab root with no
 * back control. Corrected here rather than left, because the argument below is
 * that geometry beats a list of names — and a wrong name in the paragraph
 * making that argument is the failure it describes.
 *
 * Re-derive rather than trust the three:
 * `grep -rn "overflow-x-auto" src/components src/app --include=*.tsx`.
 *
 * 1. **It starts at the left edge** (`startsInEdgeZone`). This is the test doing
 *    most of the work: an edge-origin drag is what every native back gesture
 *    uses, and it is not how anybody starts scrolling a strip in the middle of a
 *    screen.
 * 2. **It is horizontal** — `SWIPE_BACK_AXIS_RATIO`. A diagonal drag that is
 *    mostly vertical is a scroll the finger wandered on.
 * 3. **It is far, or fast** — a long deliberate drag, or a short flick. Two
 *    routes rather than one distance, because they are the two ways a rider
 *    actually performs this: the thumb either travels or snaps, and a single
 *    threshold set for one feels broken for the other.
 *
 * **The edge test alone is not enough, which is the trap worth naming.** Those
 * scrollers are full-bleed — `RideJournal` and the club's ride strip carry
 * their padding *inside* the scrolling element, so the element itself starts at
 * x0 and an edge-origin drag lands inside one. `declinesSwipeBack` is what
 * closes that, and it is a separate test rather than a tuning of this one.
 *
 * ## No `preventDefault`, anywhere
 *
 * Nothing here cancels a browser gesture or sets `touch-action`. A declined
 * swipe is simply a swipe this module says nothing about, so the scroller,
 * the deck and the page keep behaving exactly as they did. That is what makes
 * adding the gesture safe on a screen whose axis is already spoken for: the
 * failure mode is "back did not happen", never "the strip stopped scrolling".
 */

/**
 * How far from the left edge a gesture may start — CSS pixels.
 *
 * 32 rather than the ~20 iOS uses: this app is used in gloves, which is the
 * same reasoning behind every other target size here, and the cost of being
 * generous is bounded by the two tests that follow rather than by this one.
 */
export const SWIPE_BACK_EDGE_PX = 32

/** A deliberate drag: far enough that nothing else on screen wanted it. */
export const SWIPE_BACK_DISTANCE_PX = 96

/** A flick: shorter, but only when it was fast. Never on its own. */
export const SWIPE_BACK_FLICK_PX = 48

/** Pixels per millisecond that make `SWIPE_BACK_FLICK_PX` count. */
export const SWIPE_BACK_FLICK_VELOCITY = 0.5

/**
 * Past this the gesture is discarded, however far it travelled.
 *
 * A finger resting on the screen for two seconds and then moving is a rider
 * who changed their mind mid-scroll, or a long-press that drifted. Without this
 * the two look identical to a distance test.
 */
export const SWIPE_BACK_MAX_MS = 1200

/** How much more horizontal than vertical the travel has to be. */
export const SWIPE_BACK_AXIS_RATIO = 2

export type SwipeBackSample = {
  startX: number
  startY: number
  endX: number
  endY: number
  elapsedMs: number
}

/** Did this gesture begin in the left-edge strip the back swipe owns? */
export function startsInEdgeZone(startX: number): boolean {
  return startX >= 0 && startX <= SWIPE_BACK_EDGE_PX
}

/**
 * Is this travel a back swipe — far or fast, rightward, and horizontal?
 *
 * Takes the whole sample rather than a distance so the flick route can see the
 * clock. Deliberately says nothing about *where* the gesture started: that is
 * `startsInEdgeZone`'s question and it is asked first, at `pointerdown`, so a
 * gesture beginning mid-screen is never even tracked.
 */
export function isSwipeBack({ startX, startY, endX, endY, elapsedMs }: SwipeBackSample): boolean {
  const dx = endX - startX
  const dy = endY - startY

  // Rightward only. A leftward drag from the left edge is a rider pushing
  // something back onto the screen, and there is no "forward" to go to.
  if (dx <= 0) return false
  if (elapsedMs > SWIPE_BACK_MAX_MS) return false
  if (Math.abs(dx) < SWIPE_BACK_AXIS_RATIO * Math.abs(dy)) return false

  if (dx >= SWIPE_BACK_DISTANCE_PX) return true

  // `elapsedMs > 0` guards the division rather than the physics: a synthetic
  // pointer pair can share a timestamp, and `dx / 0` is Infinity, which would
  // make every zero-duration gesture a flick.
  return dx >= SWIPE_BACK_FLICK_PX && elapsedMs > 0 && dx / elapsedMs >= SWIPE_BACK_FLICK_VELOCITY
}

/**
 * The attribute a component sets to keep the horizontal axis for itself.
 *
 * For a component that owns left/right without *scrolling* — `PostcardDeck`,
 * whose front card follows the finger through pointer handlers, so it has no
 * overflow for `declinesSwipeBack` to notice. A scroller needs nothing: it is
 * detected by its own geometry, which cannot go stale the way an attribute
 * someone forgot to add can.
 */
export const SWIPE_BACK_OPT_OUT = 'data-swipe-back'

/**
 * One element on the path from the gesture's target to the document root, in
 * the terms this decision needs.
 *
 * **A structural interface rather than an `Element`, for the reason `guard.ts`
 * is a pure function over a state object**: the decision below is the part with
 * real content, and expressing it over DOM nodes would put it behind jsdom —
 * `vitest.config.ts` is `environment: 'node'`, and the repo's rule is that
 * jsdom is the answer only when something needs a layout or an event. The hook
 * that calls this builds the chain from real elements and does nothing else.
 */
export type SwipeBackNode = {
  /** `scrollWidth` and `clientWidth`, so a scroller is recognised by geometry. */
  scrollWidth: number
  clientWidth: number
  /** The computed `overflow-x`. An element wider than its box is not a scroller
   *  unless it actually scrolls — `overflow-x: visible` content overflows and
   *  the axis stays the page's. */
  overflowX: string
  /** Whatever `SWIPE_BACK_OPT_OUT` holds on this element, or null. */
  optOut: string | null
  /** Uppercase, as `Element.tagName` gives it. */
  tagName: string
  /** `HTMLElement.isContentEditable`. */
  isContentEditable: boolean
  parent: SwipeBackNode | null
}

/** Where a gesture must never be read as "go back", whatever its geometry. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Does anything between the gesture's target and the root claim this axis?
 *
 * Three reasons, and each covers a case the others cannot see:
 *
 * - **It scrolls horizontally.** `RideJournal`, the club's ride strip, the
 *   club detail's ride strip, `FilterTile` — and anything added later, which is
 *   the point of testing the geometry rather than keeping a list of component
 *   names that goes stale silently. This list had gone stale before it was
 *   written: see the header. A scroller already at its left end still
 *   declines: the rider is dragging a strip that has nowhere further to go, not
 *   asking to leave the screen, and reading "it cannot scroll right now" as
 *   permission would make the gesture fire only on the strips the rider had
 *   already scrolled.
 * - **It opted out** — `SWIPE_BACK_OPT_OUT`, for a component that owns the axis
 *   through pointer handlers and has no overflow to notice.
 * - **It takes text.** A drag across an input is a selection or a caret, and
 *   both are gestures the rider aimed at the field.
 */
export function declinesSwipeBack(target: SwipeBackNode | null): boolean {
  for (let node = target; node; node = node.parent) {
    if (node.optOut === 'off') return true
    if (TEXT_ENTRY_TAGS.has(node.tagName) || node.isContentEditable) return true
    if (
      node.scrollWidth > node.clientWidth &&
      (node.overflowX === 'auto' || node.overflowX === 'scroll')
    ) {
      return true
    }
  }
  return false
}
