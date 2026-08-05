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
