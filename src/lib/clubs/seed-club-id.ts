/**
 * Which club a create screen's `<select>` starts on, given the id the URL
 * carried (PD-283).
 *
 * Both composers want the identical rule and neither should own it: the ride
 * form and the postcard form are the writer and the reader of the same
 * convention, which is `keys.ts`'s argument for a single definition.
 *
 * **Unmatched ids fall back to no club, and that is a correctness rule rather
 * than caution.** A controlled `<select>` whose `value` matches no `<option>`
 * renders as the first option while still reporting the unmatched value — so an
 * id the rider has no club for would *show* one audience and *submit* another.
 * Falling back lands them in the same state as arriving from the tab.
 *
 * **It is not authorization and must never be read as any.** `017`'s rides
 * INSERT policy and the postcards audience rule decide what may be written; a
 * rider who edits the query parameter reaches those, not this. What this owns is
 * only whether the control tells the truth about what it will submit.
 */
export function seedClubId(
  clubs: readonly { id: string }[],
  initialClubId: string | null | undefined
): string {
  if (!initialClubId) return ''
  return clubs.some((club) => club.id === initialClubId) ? initialClubId : ''
}
