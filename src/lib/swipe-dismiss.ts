/**
 * When a drag inside an open postcard means "close it" — PD-475.
 *
 * Every sheet on a phone answers a downward pull. `PostcardViewerDialog`
 * already closes on a tap that began on the scrim (PD-339), but nothing
 * answered a drag that began *inside* the panel, over the photo, the caption
 * or the comment thread.
 *
 * ## Where it starts and what the scroller is doing decide it, never where it ends
 *
 * PD-339 shipped `scrimArmed`, which reads a gesture's `pointerdown` rather
 * than its `pointerup` because the panel deliberately stops short of the top
 * and leaves a strip of scrim above it — a drag that starts inside the sheet
 * and lifts on that strip is not a scrim tap, and must not become one as a
 * side effect of this feature answering "closes from inside" for the first
 * time. This module changes nothing about that: the dismiss gesture below is
 * evaluated from where a *separate* pointer sequence begins, on the panel
 * itself, and a gesture beginning inside the panel that happens to end over
 * the scrim strip is still judged as a panel drag, never re-litigated as a
 * scrim tap.
 *
 * ## The scroller owns the gesture whenever it has anywhere to go
 *
 * The panel's body is `overflow-y-auto overscroll-contain`. A pull-down while
 * `scrollTop > 0` is the rider scrolling back up through the thread, and nothing
 * here may treat it as anything else, however far or fast it travels — that
 * check lives in the component, against the live DOM node, because it is a
 * property of an element's current scroll offset rather than of the gesture's
 * geometry. What lives here is everything that *is* geometry.
 *
 * ## Strength is three tests, exactly as `swipe-back.ts` argues for the
 * horizontal gesture — distance, dominance of the vertical axis, and the
 * release — with the same shape reused rather than a second vocabulary
 * invented beside it. **The edge-zone test is NOT reused**: `startsInEdgeZone`
 * answers "did this begin at the screen's own edge", which is what a back
 * gesture needs to avoid the strips it shares a screen with. A dismiss has no
 * such neighbour to avoid — the whole panel is fair game — so importing that
 * test would refuse a pull that starts in the middle of the photo, which is
 * exactly where a rider's thumb lands.
 *
 * Two decisions instead, each answering a question `isSwipeBack` does not
 * have to ask:
 *
 * - **Downward only.** An upward drag never dismisses, at any scroll
 *   position — there is nothing "up" to reveal past a sheet's own top, so an
 *   upward pull is either a scroll or nothing.
 * - **No `pointerType === 'mouse'` exclusion lives here.** `isSwipeBack`'s own
 *   hook excludes a mouse because a left-edge mouse drag is a text selection
 *   with a visible arrow standing by as the alternative; this gesture has no
 *   arrow, so `PostcardViewerDialog` decides that exclusion itself rather than
 *   this module hard-coding an input-device policy into a pure geometry test.
 *
 * ## No `preventDefault` and no opt-out attribute in this module
 *
 * Unlike `swipe-back.ts`, this module cannot promise "a declined gesture is a
 * gesture we say nothing about" all by itself, because the component *does*
 * call `preventDefault` and take pointer capture — but only after a gesture
 * has been armed by `armsSwipeDismiss`, and arming already requires the
 * scroller to have nowhere further to give. Nothing here decides that part;
 * this module is pure geometry over a sample and a control chain.
 */

/** A deliberate pull: far enough that nothing else on the sheet wanted it. */
export const SWIPE_DISMISS_DISTANCE_PX = 96

/** A flick: shorter, but only when it was fast. Never on its own. */
export const SWIPE_DISMISS_FLICK_PX = 48

/** Pixels per millisecond that make `SWIPE_DISMISS_FLICK_PX` count. */
export const SWIPE_DISMISS_FLICK_VELOCITY = 0.5

/**
 * Past this the gesture is discarded, however far it travelled — a finger
 * resting on the sheet and then moving is a rider who changed their mind, not
 * a pull.
 */
export const SWIPE_DISMISS_MAX_MS = 1200

/** How much more vertical than horizontal the travel has to be. */
export const SWIPE_DISMISS_AXIS_RATIO = 2

/**
 * How far a pointer must travel, once the scroller has nowhere further to
 * give, before the panel is drawn as following it. Below this a gesture is
 * still plainly a tap or a wobble — the same slop `DRAG_ARM_THRESHOLD` gives
 * the deck's own horizontal drag, reused here for the vertical one.
 */
export const SWIPE_DISMISS_ARM_PX = 8

export type SwipeDismissSample = {
  startX: number
  startY: number
  endX: number
  endY: number
  elapsedMs: number
}

/**
 * Has the drag travelled far enough, and in a plainly vertical-and-downward
 * direction, to be drawn as following the finger?
 *
 * This is the gate between "not yet a gesture this feature answers" and "the
 * panel is now tracking the pointer" — the caller still decides on release
 * whether tracking ends in a close or a spring-back, via `isSwipeDismiss`.
 * Takes raw deltas rather than a sample: unlike `isSwipeBack`'s one-shot
 * up-front-then-release shape, arming is re-evaluated on every `pointermove`
 * against a start point the component may keep sliding forward for as long as
 * the scroller still has room — see the module header.
 */
export function armsSwipeDismiss(dx: number, dy: number): boolean {
  if (dy <= 0) return false
  if (dy < SWIPE_DISMISS_ARM_PX) return false
  return dy >= SWIPE_DISMISS_AXIS_RATIO * Math.abs(dx)
}

/**
 * Does this released gesture close the postcard — far or fast, downward, and
 * vertical? Mirrors `isSwipeBack` exactly but for the opposite axis and
 * direction; see the module header for why the edge-zone test has no
 * counterpart here.
 */
export function isSwipeDismiss({
  startX,
  startY,
  endX,
  endY,
  elapsedMs,
}: SwipeDismissSample): boolean {
  const dx = endX - startX
  const dy = endY - startY

  if (dy <= 0) return false
  if (elapsedMs > SWIPE_DISMISS_MAX_MS) return false
  if (Math.abs(dy) < SWIPE_DISMISS_AXIS_RATIO * Math.abs(dx)) return false

  if (dy >= SWIPE_DISMISS_DISTANCE_PX) return true

  // `elapsedMs > 0` guards the division rather than the physics — see
  // `isSwipeBack`'s identical guard for why a zero-duration sample must not
  // qualify as an infinitely fast flick.
  return dy >= SWIPE_DISMISS_FLICK_PX && elapsedMs > 0 && dy / elapsedMs >= SWIPE_DISMISS_FLICK_VELOCITY
}

/**
 * One element on the path from the gesture's target to the panel, in the
 * terms this decision needs — the same structural-interface shape
 * `SwipeBackNode` uses, and for the same reason: keeping the decision over a
 * plain object rather than a DOM node keeps it out of jsdom.
 */
export type SwipeDismissNode = {
  /** Uppercase, as `Element.tagName` gives it. */
  tagName: string
  /** `HTMLElement.isContentEditable`. */
  isContentEditable: boolean
  parent: SwipeDismissNode | null
}

/**
 * Every element whose own gesture this dismissal must never take — a caret, a
 * selection, or an ordinary tap on a link or a button. Unlike
 * `declinesSwipeBack`, this carries no scroller test and no opt-out attribute:
 * the one scroller that matters here is the panel's own body, and the
 * component checks its `scrollTop` directly rather than walking to it, and
 * nothing on this sheet owns the vertical axis the way the club ride strip
 * owns the horizontal one.
 */
const DISMISS_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'])

export function declinesSwipeDismiss(target: SwipeDismissNode | null): boolean {
  for (let node = target; node; node = node.parent) {
    if (DISMISS_CONTROL_TAGS.has(node.tagName) || node.isContentEditable) return true
  }
  return false
}
