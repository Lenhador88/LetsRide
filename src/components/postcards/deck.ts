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
 * What releasing the card at `offset` does: `1` leaves to the right, `-1` to the
 * left, `null` returns to centre.
 *
 * **`offset` is the offset the card is *drawn* at, never a coordinate read off
 * the terminating event, and that is the fix rather than a style choice.** The
 * deck used to compute `event.clientX - startX` at release while rendering the
 * last `pointermove`; a terminating event whose coordinates disagree with that
 * move — which is exactly what `pointercancel` is permitted to deliver — sends
 * the card out the side it was never leaning towards. Deciding from the drawn
 * offset makes "it leaves the way you pushed it" true by construction.
 *
 * The finite check is load-bearing for the same reason: a user agent that
 * populates no coordinate yields `NaN`, and `NaN > 0` is `false`, so the
 * obvious `offset > 0 ? 1 : -1` resolves an *absent* coordinate to a confident
 * left swipe. Returning to centre is the only honest answer to "we do not know
 * where the finger was".
 */
export function resolveSwipe(offset: number): 1 | -1 | null {
  if (!Number.isFinite(offset) || Math.abs(offset) < SWIPE_THRESHOLD) return null
  return offset > 0 ? 1 : -1
}
