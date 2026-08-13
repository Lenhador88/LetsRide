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
