import { seedClubId } from '@/lib/clubs/seed-club-id'

/**
 * `/rides/new`'s header, once a club-scoped entry decides whether it has
 * one — `PD-383`. A pure fold of the three states, extracted so they are one
 * thing to test rather than a ternary inside a page `useSearchParams` keeps a
 * node-environment suite from rendering at all.
 *
 * **`undefined` only while a club-scoped entry is still waiting on the
 * rider's clubs** — `Header` already draws a skeleton for that (see its own
 * `title === undefined` branch), which reads better than flashing the plain
 * title and replacing it a moment later. An UNSCOPED entry (`fromClub` null)
 * never waits: there is no club to name, so the plain title is already the
 * final answer.
 *
 * **Resolved through `seedClubId`, never a bare `find`** — the same rule
 * `CreateRideForm`'s own `seededClub` uses, so the heading and the hidden
 * picker can never name two different clubs for the same id. An id that is
 * not one of the rider's own clubs falls back to the plain, unscoped title —
 * the same state as arriving from the Rides tab.
 */
export function createRideHeaderTitle(
  fromClub: string | null,
  myClubs: { id: string; name: string }[] | undefined
): string | undefined {
  if (!fromClub) return 'Create ride'
  if (!myClubs) return undefined

  const seeded = seedClubId(myClubs, fromClub)
  const club = myClubs.find((c) => c.id === seeded)
  return club ? `Create ride in ${club.name}` : 'Create ride'
}
