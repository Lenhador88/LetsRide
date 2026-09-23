'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRightIcon, LocationFilledIcon } from '@/components/icons/generated'
import { Header } from '@/components/layout/Header'
import { TownQuestionSheet } from '@/components/location/TownQuestionSheet'
import { MapAttribution } from '@/components/rides/MapAttribution'
import { RideCard } from '@/components/rides/RideCard'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState } from '@/components/ui/ErrorState'
import { OfflineState } from '@/components/ui/OfflineState'
import { LoadingRegion, SkeletonList } from '@/components/ui/Skeleton'
import { getWeekendDigest } from '@/lib/data/digest'
import { getMyLocationText } from '@/lib/data/profile'
import { nearSectionHeading } from '@/lib/location/explore-label'
import { nearLabel } from '@/lib/location/near-label'
import { resolveRiderLocation } from '@/lib/location/rider-location'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import type { WeekendDigestClub } from '@/types'

/**
 * `/rides/weekend` — PD-450, part 1. What is on this weekend near the rider,
 * plus what moved in their clubs. **No Figma frame exists for this** —
 * `npm run figma -- ls weekend` and `ls digest` both answer `0 of 451`
 * (`design.md` §Context) — so every geometry choice here is borrowed from
 * `/rides/explore`, the screen it is one tap from.
 *
 * ## The door is one static row, not this screen
 *
 * `/rides/explore` carries the only way in, directly under `LocationQuestionRow`
 * and outside its own list gate — `design.md` §D6 states why: the tab roots
 * keep their one-row strip slot (`one-question-row.test.ts`), and Explore is
 * where "near you" already lives, so arriving here is a cache hit on
 * `queryKeys.riderLocation()` rather than a second read.
 *
 * ## Two reads, one gate
 *
 * The position and the digest are two `useQuery` calls, but the screen is
 * gated on the digest alone — the same shape `/rides/explore` uses. The
 * digest's own key is held `null` until the position is DECIDED
 * (`near.data !== undefined || !!near.error`), so there is never a fetch under
 * `unlocated` immediately followed by a second one under a real coordinate.
 *
 * ## Why `digest.error` is the only error path
 *
 * `getWeekendDigest` throws on the reader RPC and on either hydration read
 * (`lib/data/digest.ts`'s own header), so one `error` covers all three per
 * `design.md`'s "An error is not emptiness" scenario. A failed `near` read is
 * not treated as a page error — `resolveRiderLocation` folds it into `null`,
 * exactly as `/rides/explore` already does, so it reads as "no position"
 * rather than as a broken screen.
 */
export default function WeekendDigestPage() {
  return (
    <>
      <Header title="This weekend" backHref="/rides/explore" />
      <div className="pb-4">
        <WeekendScreen />
      </div>
    </>
  )
}

function WeekendScreen() {
  const near = useQuery(queryKeys.riderLocation(), resolveRiderLocation)
  const city = useQuery(queryKeys.profile.location(), getMyLocationText)

  // `undefined` is "not yet"; `null` is a decided "nowhere" — see
  // `/rides/explore`'s identical gate for why the error half folds in here
  // rather than becoming a second failure path.
  const positionDecided = near.data !== undefined || !!near.error
  const position = near.data ?? null

  const digest = useQuery(
    positionDecided ? queryKeys.rides.weekend(position) : null,
    () => getWeekendDigest(position)
  )

  const [askingTown, setAskingTown] = useState(false)

  if (digest.error) {
    return (
      <>
        <LoadingRegion label={null} />
        <OfflineState />
        <ErrorState onRetry={digest.refetch} />
      </>
    )
  }

  // Gated on the data, never on `isLoading` — on the first render pass there
  // is no data AND no fetch in flight.
  if (!digest.data) {
    return (
      <>
        <LoadingRegion label="Loading this weekend" />
        <OfflineState />
        <div className="py-2">
          <SkeletonList />
        </div>
      </>
    )
  }

  const label = nearLabel(position, city.data)
  const noPosition = position === null
  const { rides, clubs } = digest.data
  const empty = !noPosition && rides.length === 0 && clubs.length === 0

  return (
    <>
      <LoadingRegion label={null} />
      <OfflineState />

      <div className="motion-safe:animate-fade-in flex flex-col gap-4 pt-2">
        {noPosition ? (
          <NoPositionRow onTap={() => setAskingTown(true)} />
        ) : empty ? (
          <p className="px-4 py-24 text-center text-sm font-medium text-muted">
            Nothing near you this weekend
          </p>
        ) : (
          rides.length > 0 && (
            <section className="flex flex-col gap-2 px-4">
              <h3 className="px-2 text-sm font-semibold text-foreground">
                {nearSectionHeading(label)}
              </h3>
              <ul className="flex flex-col gap-2">
                {rides.map((ride) => (
                  <li key={ride.id}>
                    <RideCard ride={ride} />
                  </li>
                ))}
              </ul>
            </section>
          )
        )}

        {/* Renders beneath the no-position row too, per `design.md`'s "Empty
            and no position are different screens" scenario — a rider with no
            position may still have clubs worth reading about. */}
        {clubs.length > 0 && (
          <section className="flex flex-col gap-2 px-4">
            <h3 className="px-2 text-sm font-semibold text-foreground">Your clubs</h3>
            <ul className="flex flex-col gap-2">
              {clubs.map((entry) => (
                <li key={entry.club.id}>
                  <WeekendClubRow entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* One credit for every tile on this screen — PD-236, keyed on any
            card HAVING a tile rather than one currently drawing, matching
            `/rides` and `/rides/explore`. */}
        {rides.some((ride) => !!ride.map_card_url) && <MapAttribution />}
      </div>

      <TownQuestionSheet
        open={askingTown}
        onClose={() => setAskingTown(false)}
        onSaved={() => setAskingTown(false)}
      />
    </>
  )
}

/**
 * The no-position state — distinct from empty, per `design.md`'s own
 * scenario. **A tap, never an automatic open**: this screen carries no
 * dismissal ladder of its own, unlike `LocationQuestionRow`, so the only way
 * `TownQuestionSheet` may appear is the rider's own tap on this row.
 */
function NoPositionRow({ onTap }: { onTap: () => void }) {
  return (
    <div className="px-4">
      <button
        type="button"
        onClick={onTap}
        aria-haspopup="dialog"
        className="flex h-14 w-full items-center gap-3 rounded-lg bg-surface px-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:bg-background"
      >
        <LocationFilledIcon className="h-6 w-6 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          Set where you ride from to see rides near you this weekend
        </span>
        <ChevronRightIcon className="h-6 w-6 shrink-0 text-muted" />
      </button>
    </div>
  )
}

/**
 * One club's row — an avatar, its name, and the two counts the reader
 * returned. **A zero half is omitted rather than drawn as "0"** — a club only
 * ever appears here with `new_rides + new_threads > 0` (`design.md` §D3), so
 * a rendered zero would be the ordinal side of a count that is never actually
 * nothing.
 */
function WeekendClubRow({ entry }: { entry: WeekendDigestClub }) {
  const { club, newRides, newThreads } = entry
  const parts: string[] = []
  if (newRides > 0) parts.push(`${newRides} new ride${newRides === 1 ? '' : 's'}`)
  if (newThreads > 0) parts.push(`${newThreads} new thread${newThreads === 1 ? '' : 's'}`)

  return (
    <Link
      href={routes.club(club.id)}
      className="flex items-center gap-3 rounded-lg bg-surface p-2 pr-4 transition-colors active:bg-background"
    >
      <Avatar src={club.avatar_url} name={club.name} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{club.name}</p>
        <p className="truncate text-xs font-medium text-muted">{parts.join(' · ')}</p>
      </div>
      <ChevronRightIcon className="h-6 w-6 shrink-0 text-muted" />
    </Link>
  )
}
