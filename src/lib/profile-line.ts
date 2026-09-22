/**
 * The one line under a rider's avatar on `/profile` and `/profile/detail` —
 * PD-476.
 *
 * The rider's own words (`rides_from`) when they have written some, and the
 * placed town otherwise, so no profile lost its line the day `127` shipped.
 * `null` when there is neither, which draws nothing.
 *
 * **Display only.** This file is deliberately not under `src/lib/location/`:
 * `rides_from` is never a position, and `rides-from-is-not-a-position.test.ts`
 * keeps it out of every module that is.
 */
export function profileLocationLine(profile: {
  rides_from: string | null
  location: string | null
}): string | null {
  return profile.rides_from ?? profile.location ?? null
}
