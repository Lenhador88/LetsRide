import type { NearLabel } from '@/lib/location/near-label'

/**
 * The Explore sentence, in one place — PD-427.
 *
 * ## Why this is a module and not two template literals
 *
 * `nearLabel` already decides *what to call the place a distance was measured
 * from*, and it was already right. What was wrong was the sentence each screen
 * wrapped around it: the rides strip said `Explore public rides near Hoorn`
 * and the clubs strip said `Explore clubs near Utrecht`, over identical logic.
 * Product owner, 2026-09-06: *"The label on top club list and ride list should
 * be the same mindset… we just need 1 option/label on top"*.
 *
 * Two copies of a sentence is how they drifted apart the first time, so the
 * fix is not "edit both to match" — it is to leave one copy. Both strips and
 * both Explore lists read this module, so a future edit reaches all four or
 * none.
 *
 * ## `public` came out of the rides label
 *
 * It read `Explore public rides` on the strip while `/rides/explore` — the
 * screen the strip is a door to — titled itself `Explore rides`. So the app
 * was already using the shorter form at the destination, and the strip was the
 * odd one out rather than the accurate one. Dropping it costs the word that
 * distinguished these from club-only rides; the destination has said `Explore
 * rides` since it shipped and nothing was reported, and a label that differs
 * from the screen it opens is the more expensive of the two.
 *
 * ## What this module deliberately does NOT do
 *
 * **It does not name a country**, and that is a decision rather than an
 * omission. `113` gives every new rider a home country, and PD-428 proposes
 * `Explore rides in the Netherlands` as a fourth state here. But `Explore
 * rides in <country>` is a **scoping claim**, and no query in this app is
 * scoped to a country: `getExploreRides` filters on `is_public` and orders by
 * `departure_at`, and neither `src/lib/data/rides.ts` nor `clubs.ts` mentions
 * a country at all. Drawing that sentence over a globally-unscoped list would
 * be a promise the build cannot keep — so the country earns its clause on the
 * day the query reads it, and not before.
 */
export type ExploreSubject = 'rides' | 'clubs'

/**
 * The strip's label: `Explore rides near you`, `Explore clubs near Utrecht`,
 * or the bare `Explore rides` when no proximity claim is earned.
 *
 * **The clause is earned twice over, and both halves matter.** There must be a
 * place to name (`near`) AND at least one row behind the strip actually within
 * `NEARBY_RADIUS_KM` of it (`nearCount`). `Explore rides near Hoorn` over a
 * screen with nothing near Hoorn is a claim the rider cannot check until they
 * tap — PD-258's trap, which both strips already guarded and now guard through
 * one line instead of two.
 *
 * `nearCount` `undefined` is **"no answer yet"** and is not zero: the position
 * has not resolved, or the list read has not landed. Both withhold the clause,
 * so they collapse here — they would not in a component that drew a count.
 */
export function exploreLabel(
  subject: ExploreSubject,
  // `undefined` as well as `NearLabel`, because `ExploreClubsStrip` declares
  // the prop optional where `ExploreRidesStrip` requires it. Both mean "no
  // place to name" and both must reach the same branch — narrowing this to
  // `NearLabel` would push a `!` or a `?? null` into one call site and leave
  // the two strips written differently again, which is the defect this module
  // exists to remove.
  near: NearLabel | undefined,
  nearCount: number | undefined
): string {
  const sayNear = !!near && nearCount !== undefined && nearCount > 0
  return sayNear ? `Explore ${subject} near ${near!.name}` : `Explore ${subject}`
}

/**
 * The section heading the Explore lists draw over exactly the rows the strip
 * counted: `Near Utrecht`.
 *
 * It lives here rather than in the two list components because it is the same
 * sentence as `exploreLabel`'s second half — the number a rider taps and the
 * heading they land on have to name the same place, which is PD-258's second
 * trap. One module means the word and the name cannot drift from the strip's.
 */
export function nearSectionHeading(near: NearLabel | undefined): string {
  return `Near ${near?.name ?? 'you'}`
}
