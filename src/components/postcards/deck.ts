/**
 * The deck's window, as a pure function of the feed and what the rider has
 * already swiped past.
 *
 * **This replaces a numeric index, and the change is a correctness fix rather
 * than a refactor.** The deck used to hold `index` and render
 * `postcards.slice(index)`. That is only correct while the list is append-only,
 * and it is not: blocking a rider removes *every* card they authored, including
 * ones before the current position, so the window jumped forward by that many
 * and the skipped cards were never shown. Hiding and deleting have the same
 * shape, one card at a time.
 *
 * Identifying the boundary by *which cards are done* rather than *how many*
 * makes that class of bug unrepresentable: a card removed server-side simply
 * stops appearing, and every card the rider has not dismissed is still in the
 * window wherever it sits.
 *
 * The bug was latent until 2026-08-05 — nothing in the UI could block anyone
 * until the postcard overflow menu shipped, so the list could not shrink from
 * the middle. It is fixed in the session that made it reachable.
 *
 * A plain module rather than a helper inside `PostcardDeck.tsx` so it can be
 * tested without mounting React or pulling `next/link` into a node test.
 */
export function remainingPostcards<T extends { id: string }>(
  postcards: readonly T[],
  dismissed: ReadonlySet<string>
): T[] {
  return postcards.filter((postcard) => !dismissed.has(postcard.id))
}

/** How far the card must travel before releasing it advances the deck. */
export const SWIPE_THRESHOLD = 56

/**
 * How far a pointer must travel before the deck claims the gesture as a swipe.
 *
 * Deliberately much smaller than `SWIPE_THRESHOLD`, because the two answer
 * different questions: this one is *is the rider dragging or tapping*, and that
 * one is *has the drag gone far enough to advance*. Between them the card
 * follows the finger and springs back on release, which is the normal
 * below-threshold drag.
 *
 * 8px is the usual slop for distinguishing a tap from a drag — under a finger's
 * own jitter on a tap, and reached within a frame or two of a real swipe.
 */
export const DRAG_ARM_THRESHOLD = 8

/**
 * Whether a gesture has moved far enough to be a swipe rather than a tap.
 *
 * **This is what lets a swipe start anywhere on the card**, including on the
 * like, comment, share and overflow controls. The deck used to refuse a gesture
 * outright when it began on a control — `closest('button, a')` at `pointerdown`
 * — because `setPointerCapture` retargets every later event to the card and the
 * browser then never delivers the control's `click`. Bailing kept the buttons
 * working and made the bottom of the card dead to swiping, which is the half
 * the rider notices: the action row and the controls in it are a wide strip
 * across a card whose photo is under half its height.
 *
 * Arming on distance keeps both. Capture is not taken at `pointerdown` at all,
 * so a tap is never retargeted and the control's click arrives untouched; once
 * the pointer has travelled this far the gesture is plainly not a tap, the deck
 * captures, and the click that would have followed is suppressed.
 *
 * **It measures TOTAL distance, and the vertical half is not a nicety — an
 * x-only threshold is a bug.** Capture is also what stops the browser claiming
 * the gesture for a scroll and firing `pointercancel`, which PD-221 correctly
 * made abort the swipe. A rider who swipes with any upward or downward lean
 * moves vertically first, so under an x-only rule the deck is still unarmed and
 * uncaptured through exactly the frames where the browser decides whose gesture
 * this is — it takes it, cancels, and the card slides back to centre. That is
 * the "swipe gently up or down and it goes back to place" report, and arming on
 * horizontal travel alone would have caused it rather than fixed it.
 *
 * So any real movement arms, in any direction, and the deck holds the pointer
 * from then on. Which way the card LEAVES is still decided by horizontal travel
 * alone — see `resolveSwipe`. Arming and committing are different questions and
 * only the second one is about direction.
 */
export function armsDrag(dx: number, dy: number = 0): boolean {
  return Math.hypot(dx, dy) >= DRAG_ARM_THRESHOLD
}

/**
 * What releasing the card does: `1` leaves to the right, `-1` to the left,
 * `null` returns to centre.
 *
 * `offset` is where the card is **drawn** — the last `pointermove`. `released`
 * is the coordinate the terminating event carried. They are separate arguments
 * because they answer different halves, and collapsing them either way is a
 * bug this deck has now had in both directions:
 *
 * **Direction comes from `offset`.** The deck used to take both from the
 * terminating event, and a coordinate disagreeing with what was drawn sends
 * the card out the side it was never leaning towards. `clientX` is an IDL
 * `double` on every pointer event, so a user agent cannot deliver an *absent*
 * coordinate — only a **wrong** one, and the reachable wrong value is the
 * pointerdown position or `0`. For any card touched right of `SWIPE_THRESHOLD`
 * that is a large *negative* travel, which is why the reported symptom was a
 * right swipe exiting left and why it was always that way round.
 *
 * **Magnitude may take `released`, but only to extend the travel.** A genuine
 * lift carries an authoritative coordinate up to one frame of travel ahead of
 * the last `pointermove` — ~25px at a brisk flick — so judging on `offset`
 * alone reads a fast short flick under the threshold and springs it back. A
 * `released` that disagrees in *sign* is discarded rather than averaged: the
 * rider saw the card leaning one way, and no release coordinate should be able
 * to argue them out of it.
 */
export function resolveSwipe(offset: number, released: number = offset): 1 | -1 | null {
  const travelled =
    Math.sign(released) === Math.sign(offset) && Math.abs(released) > Math.abs(offset)
      ? released
      : offset

  if (Math.abs(travelled) < SWIPE_THRESHOLD) return null
  return travelled > 0 ? 1 : -1
}
