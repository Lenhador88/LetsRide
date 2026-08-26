'use client'

import { Header } from '@/components/layout/Header'
import { ClubCard } from '@/components/clubs/ClubCard'
import { ExploreClubsList } from '@/components/clubs/ExploreClubsList'
import { ExploreClubsStrip } from '@/components/clubs/ExploreClubsStrip'
import { NotificationsHeaderControl } from '@/components/notifications/NotificationsHeaderControl'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getExploreClubs, getYourClubs } from '@/lib/data/clubs'
import { getMyLocationText } from '@/lib/data/profile'
import { isNearby } from '@/lib/location/distance'
import { nearLabel, type NearLabel } from '@/lib/location/near-label'
import { UseMyLocationRow } from '@/components/location/UseMyLocationRow'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { useQuery, type UseQueryResult } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { ClubListItem } from '@/types'

/**
 * The Clubs tab — one screen (PD-258).
 *
 * `ClubPageMenu` is gone: the tab was two sub-pages behind a `Your clubs ⌄`
 * dropdown and the product owner's objection to it was the same one PD-254
 * acted on for the ride detail — the control hides the destination it exists to
 * offer. So the header is the plain 96px title again (no `subRow`, and no
 * `.pt-header-sub-extra` on top of the shell's `.pt-header`), and `Explore` is
 * reached from the strip instead.
 *
 * **The strip renders above the read gate, and that placement is the whole
 * point rather than a layout choice.** The dropdown it replaces lived on the
 * header, so Explore stayed one tap away even while this list was failing to
 * load. Rendered inside the gate — which is what the first version did — a
 * failed `getYourClubs` leaves a rider with a full-screen error, a retry for
 * the read that broke, and no route to the other screen at all. Caught in
 * review, and no gate here could have caught it: `scripts/walk.mjs` reaches
 * `/clubs/explore` by typing the URL, so the walk stays green with zero links
 * to it.
 *
 * **With no clubs joined, the explore list *is* this screen**, and that is the
 * one branch with no strip — the destination is already on screen. Rendered in
 * place, on this route, not a redirect to `/clubs/explore`: the decision reads
 * from data rather than session, so it cannot live in `lib/auth/guard.ts` and
 * would have to fire from an effect after the read lands — skeleton, then
 * empty, then a jump, then a second skeleton. It also reverses the moment a
 * rider leaves their last club, so the tab would start bouncing with nothing on
 * screen saying why. Same destination, one render, no history to reason about.
 *
 * That deletes the `You have no clubs, yet!` empty state rather than restyling
 * it. A screen whose whole content is a sentence telling a rider what they do
 * not have is the one this app most wants back.
 *
 * **Both reads issue on every load, and the explore one is not waste.** It is
 * the strip's count, and it has to be *this* read rather than a cheaper
 * `head: true` count: `getExploreClubs` excludes clubs you have joined in JS,
 * against the page it fetched, so no server-side count can reproduce the
 * predicate. A number derived any other way is PD-254's crew-count bug again —
 * a count that disagrees with the list one tap away. Same key as
 * `/clubs/explore` uses, so navigating there is a cache hit rather than a
 * second fetch.
 */
export default function ClubsPage() {
  const yours = useQuery(queryKeys.clubs.yours(), getYourClubs)
  // Where the rider is, for the Explore sort (PD-259). Its own query so the
  // screen re-renders when it lands; `resolveRiderLocation` memoises the answer
  // with a TTL, so `/clubs/explore` asking again costs nothing and — crucially
  // — gets the same numbers, which is what keeps both screens on one cache
  // entry. It never prompts: a rider who has not already granted location gets
  // the profile city, or nothing.
  const near = useQuery(queryKeys.riderLocation(), resolveRiderLocation)
  // The rider's own city, for the strip's `near …`. Its own read rather than
  // `getCurrentProfile`, which would sign an avatar and a cover to render one
  // word. Ungated like the count: no city simply drops the clause.
  const city = useQuery(queryKeys.profile.location(), getMyLocationText)

  // **Held with a `null` key until the position is DECIDED**, and that is the
  // fix for a real double fetch rather than tidiness. `near.data` is
  // `undefined` on the first render, so an ungated query ran the whole read —
  // rows, membership probe, two signing round trips — under the `unlocated`
  // key, and then ran it again under `52.09,5.12` the moment the position
  // landed, because that is a different cache entry with no data in it. The
  // rider saw the list load, blank back to a skeleton, and re-appear reordered.
  // `null` is `useQuery`'s disabled contract: no fetch, no subscription.
  // `|| !!near.error` for the reason `/rides` spells out at its own gate: a
  // rejected read leaves `data` undefined for ever, and gating on that alone
  // parks this list in the skeleton branch with no retry. `resolveRiderLocation`
  // catches its own chain, so nothing can reach it today — which is why it is
  // worth one line rather than resting on a never-rejects guarantee that lives
  // in another module and is asserted nowhere.
  const positionDecided = near.data !== undefined || !!near.error
  const position = near.data ?? null
  const explore = useQuery(
    positionDecided ? queryKeys.clubs.explore(position) : null,
    () => getExploreClubs(position)
  )

  // The name of the place the distances were measured FROM — never the profile
  // city beside a device-measured distance. `nearLabel` owns that rule.
  const label = nearLabel(position, city.data)

  // `[]` is a decided answer and the one branch that owns the whole screen;
  // `undefined` is "not yet", and gets the strip like every other state.
  const hasNoClubs = yours.data?.length === 0

  return (
    <>
      <Header title="Clubs" secondaryAction={<NotificationsHeaderControl />} />

      {/* `.pb-navbar-action-extra` on top of the shell's `.pb-navbar`, because
          the Navbar carries a sticky `Create club` on this route — without it
          the last card sits under the button. Same top-up `/rides` applies for
          `Create ride`. */}
      <div className="pb-navbar-action-extra">
        {hasNoClubs ? (
          <NoClubsYet explore={explore} near={label} />
        ) : (
          <>
            {/* Outside the gate below, and ungated on `explore` — the strip
                draws itself without a number until the count lands, and keeps
                the route reachable if either read fails outright.

                Its own padded wrapper rather than a shared one, because
                `SkeletonList` and `ErrorState` are both built at the list's
                `px-4` and would lay out 16px narrower nested inside it. */}
            {/* `pt-4` is the design's own 16px between the header and the
                first element — it came off with `.pt-header-sub-extra`, which
                used to supply 24px for the sub-row, and the strip sat against
                the hairline until the product owner spotted it. */}
            <div className="px-4 pt-4 pb-4">
              <ExploreClubsStrip
                count={explore.data?.length}
                nearCount={
                  label && explore.data
                    ? explore.data.filter((club) => isNearby(club.distance_km)).length
                    : undefined
                }
                near={label}
              />
              {/* Under the explore strip rather than beside it: the strip is
                  this screen's one destination and must keep its place. The
                  row only draws when the rider has no position at all, which
                  is exactly when the strip's `near …` clause has dropped out
                  and the sort below is arbitrary. `px-0` because this slot is
                  already inside a padded block — see the prop's own comment. */}
              <UseMyLocationRow position={near.data} className="px-0" />
            </div>

            {yours.error ? (
              <ErrorState onRetry={yours.refetch} />
            ) : !yours.data ? (
              // Gated on the data, never on `isLoading` — see `combineQueries`
              // for the first-render tick where `isLoading` is false and there
              // is still nothing to draw.
              <SkeletonList />
            ) : (
              <ul className="flex flex-col gap-2 px-4 motion-safe:animate-fade-in">
                {yours.data.map((club) => (
                  <li key={club.id}>
                    <ClubCard club={club} joined />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  )
}

/**
 * The screen a rider sees before they have joined anything: the clubs they
 * could join, under one line saying why they are looking at them.
 *
 * Its own gate rather than one `if` over both reads at the top — the rule
 * `combineQueries` states, and here it is what stops a rider *with* clubs
 * waiting on the explore read to see their own list.
 *
 * The heading says `Clubs to explore` rather than the mock's `Clubs near you`:
 * `getExploreClubs` has no geographic predicate and `clubs` has no location
 * column, so proximity is a claim nothing behind this screen can make. `PD-259`
 * is what makes it sayable.
 */
function NoClubsYet({
  explore,
  near,
}: {
  explore: UseQueryResult<ClubListItem[]>
  near: NearLabel
}) {
  if (explore.error) return <ErrorState onRetry={explore.refetch} />
  if (!explore.data) return <SkeletonList />

  // The screen's own title stays neutral — `ExploreClubsList` draws the
  // `Near <town>` heading over the clubs that actually are, so putting
  // proximity in the page title as well would either duplicate it or, when
  // nothing is near, claim it with nothing underneath.
  const heading = 'Clubs to explore'

  return (
    <div className="flex flex-col gap-4 px-4 pt-4 motion-safe:animate-fade-in">
      <div className="flex flex-col gap-0.5 px-2">
        <h2 className="text-xl font-semibold text-foreground">{heading}</h2>
        <p className="text-sm font-medium text-muted">You have not joined a club yet.</p>
      </div>

      {explore.data.length === 0 ? (
        // Both lists empty. The heading above already says what this screen is
        // for, so this is the one line that is left to say.
        <p className="py-8 text-center text-sm font-medium text-muted">
          There are no public clubs, yet!
        </p>
      ) : (
        <ExploreClubsList clubs={explore.data} near={near} />
      )}
    </div>
  )
}
