/**
 * Which ride the postcard composer's `<select>` starts on, given the id the
 * URL carried (PD-256) — `seedClubId`'s exact rule, one column later.
 *
 * **Unmatched ids fall back to no ride, for the same correctness reason
 * `seedClubId` gives.** A controlled `<select>` whose `value` matches no
 * `<option>` renders as the first option while still reporting the unmatched
 * value — so an id the rider is not crew of would *show* one ride and
 * *submit* another. Falling back lands them in the same state as arriving
 * from the Home tab's create button.
 *
 * **It is not authorization and must never be read as any.** `041`'s INSERT
 * policy decides whether the tag is actually written; a rider who edits the
 * query parameter reaches that, not this. What this owns is only whether the
 * control tells the truth about what it will submit.
 */
export function seedRideId(
  rides: readonly { id: string }[],
  initialRideId: string | null | undefined
): string {
  if (!initialRideId) return ''
  return rides.some((ride) => ride.id === initialRideId) ? initialRideId : ''
}
