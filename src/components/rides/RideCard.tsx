'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LocationFilledIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { routes } from '@/lib/routes'
import { cn, formatRideDate, formatRideTime } from '@/lib/utils'
import type { RideAttendance, RideListItem } from '@/types'

/**
 * `v2 / Component / List / Ride`, measured from the committed snapshot.
 *
 * The component set has five variants, which are the product of two properties:
 * `is Upcoming` (True/False) and `Are you going?` (No/Maybe/Yes). Neither is
 * stored — upcoming is `departure_at` against now, and the RSVP is the viewer's
 * `ride_members` row — so this component derives both rather than taking a
 * variant name.
 *
 * Geometry, all read rather than chosen: card radius 8 on White/100 with
 * padding left 4, top 4, **right 16**, bottom 4 and a 16 gap — spelled out
 * because the shorthand "4/4/4/16" appeared here first and put the 16 on the
 * bottom, which would have had someone "fix" the correct `p-1 pr-4` to match
 * the prose; the image strip is 80 wide, radius 4; the
 * content column is 8-padded top and bottom with a 4 gap; the club chip is
 * Grey/5, radius 4, padding 8/3; avatars are 28 overlapping by 4.
 *
 * **The 80×148 strip draws the ride's static map tile when there is one, and the
 * design's container plus the pin when there is not.** `051` added
 * `rides.map_card_path` and the data layer signs it into `map_card_url`, so the
 * strip is the design's photo-carrying-a-pin once a tile exists — the tile is
 * the photo and the pin sits over it, exactly as the component set composes
 * them.
 *
 * **No tile is the ordinary state, not a degraded one, and it is the state of
 * every ride today**: nothing writes `map_card_path` until the render function
 * ships, and a ride whose address never resolved keeps a NULL path for ever.
 * The strip must therefore never draw a spinner, a broken-image icon or a "map
 * unavailable" message — the pin container it has always drawn is the answer,
 * and a tile that fails to load falls back to exactly that.
 *
 * **Attribution — PD-104 §6.2, and the credit this strip carries is the one
 * burned into the tile.** The Static Maps response arrives with map-style
 * attribution rendered into the image itself, bottom-right, which is *composed
 * into the strip* per tile and survives a scroll — exactly what the spec means by
 * refusing a single shared credit elsewhere on the screen. Two consequences for
 * this file, and both are load-bearing rather than tidy:
 *
 * - **Nothing suppresses it.** The render request passes no attribution,
 *   watermark or logo parameter, and `ride-geocode-gates.test.ts` asserts their
 *   absence. Suppressing the credit would not remove the obligation, it would
 *   move it onto 80px of width that cannot carry `© OpenStreetMap contributors`
 *   at this design system's smallest token.
 * - **`object-bottom`, so a crop cannot take it.** The tile is rendered at
 *   80×148, which is this strip in the ordinary 156-tall card. On the
 *   club-filtered screen the card is 128 tall and the strip is 120, and a centred
 *   `object-cover` would crop 14px off the bottom — precisely where the credit
 *   sits. Anchoring the bottom moves the whole crop to the top.
 *
 * `Powered by Geoapify` — the Free plan's separate, *service*-level obligation —
 * is not here. It has one legible home, on `RideMap`'s 358×160 panel; that string
 * is not the tile's data attribution, so the spec's rejection of a shared credit
 * does not reach it.
 *
 * **The open half, stated rather than assumed: whether the burned-in credit is
 * legible at 80×148.** If it is not, `specs/ride-map-tiles`' *A credit that cannot
 * fit means no tile* applies and this strip must render the pin fallback with no
 * tile — which is a specified outcome and not a failure, and is one condition on
 * `showsTile` below. It could not be measured when this was written:
 * `*.geoapify.com` is egress-blocked from the build container, so no tile existed
 * to look at. Task 8.4 answers it against a real one. Do not resolve it by
 * shrinking type below the system's floor, clipping, or truncating the vendor's
 * name.
 *
 * The pin gains a `White/100` disc **only** over a tile. Bare `Grey/100` on a
 * neutral `Grey/10%` container is 13.82:1 — `bg-border` is `#0000001A`, 10.196%
 * black, which over this card's opaque `bg-surface` composites to `#E5E5E5`.
 * NOT the warm `bg-track` `#E5DACF`, which is 12.65:1 and is what `RideMap`
 * cites; reading "warm" here and recomputing against that token is how this
 * figure gets called wrong. On an arbitrary map tile it is
 * whatever the tile happens to be; the disc makes it 17.4:1 whatever is behind
 * it, and reads as the map marker it is.
 */
type RideCardProps = {
  ride: RideListItem
  /**
   * The club chip. The design drops it on the club-filtered screen — the card
   * is 128 tall there rather than 156 — because every ride on that screen
   * belongs to the club already named by the selected tile.
   */
  showClub?: boolean
}

export function RideCard({ ride, showClub = true }: RideCardProps) {
  const overflow = ride.riders_count - ride.riders.length

  // A tile that 404s or whose signature has expired must cost this row its
  // picture, never its layout — one image cannot be allowed to break a list.
  // Keyed on the URL that failed, NOT a boolean latch. The row keeps its
  // component instance across a refetch — `key={ride.id}` — while the signed
  // URL is re-minted every SIGNED_URL_TTL_SECONDS, so a boolean would hide the
  // tile for the rest of the mount after one expiry, with a working URL in
  // hand. That is reachable in the native shell, where a list can stay mounted
  // for hours across a background/resume.
  const [failedTileUrl, setFailedTileUrl] = useState<string | null>(null)
  const showsTile = !!ride.map_card_url && ride.map_card_url !== failedTileUrl

  return (
    <Link
      href={routes.ride(ride.id)}
      className="flex gap-4 rounded-lg bg-surface p-1 pr-4 transition-colors active:bg-background"
    >
      <div className="relative w-20 shrink-0 self-stretch overflow-hidden rounded bg-border">
        {showsTile && (
          /* A signed URL that expires hourly, so next/image would key its
             optimiser cache on a URL that changes every hour — every render a
             miss, and the private bucket proxied for no benefit. Same reason
             PostcardCard and Avatar use a bare img. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ride.map_card_url ?? undefined}
            // Decorative: the meeting point this tile is centred on is the
            // third line of the card, in text, right beside it.
            alt=""
            // `object-bottom` — see the header. The vendor's credit is burned
            // into the bottom of the tile, and a centred crop removes it on the
            // 128-tall club-filtered card.
            className="absolute inset-0 h-full w-full object-cover object-bottom"
            onError={() => setFailedTileUrl(ride.map_card_url ?? null)}
            loading="lazy"
            draggable={false}
          />
        )}
        {showsTile ? (
          <span className="absolute inset-0 m-auto flex h-9 w-9 items-center justify-center rounded-full bg-surface">
            <LocationFilledIcon className="h-6 w-6 text-foreground" />
          </span>
        ) : (
          <LocationFilledIcon className="absolute inset-0 m-auto h-6 w-6 text-foreground" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
        {showClub && ride.club && (
          <span className="w-fit max-w-full truncate rounded bg-background px-2 py-[3px] text-xs font-semibold text-muted">
            {ride.club.name}
          </span>
        )}

        <div className="min-w-0 pb-2 pl-1">
          <p className="truncate text-base font-semibold text-foreground">{ride.title}</p>

          <p className="flex items-center gap-2 text-sm font-medium text-muted">
            <span>{formatRideDate(ride.departure_at)}</span>
            {/* A 3×3 rounded rectangle in the design, i.e. a dot. */}
            <span aria-hidden className="h-[3px] w-[3px] shrink-0 rounded-full bg-muted" />
            <span>{formatRideTime(ride.departure_at)}</span>
          </p>

          <p className="truncate text-sm font-medium text-muted">{ride.meeting_point}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <div className="flex -space-x-1">
              {ride.riders.map((rider, i) => (
                <Avatar
                  key={rider.id}
                  src={rider.avatar_url}
                  name={rider.username ?? 'Rider'}
                  size="xs"
                  className={cn(
                    'h-7 w-7 border-surface text-2xs',
                    // The organizer carries a brand ring drawn *outside* the
                    // photo, so it has to sit above the avatar overlapping it.
                    i === 0 &&
                      ride.organizer &&
                      'relative z-10 ring-2 ring-accent ring-offset-2 ring-offset-surface'
                  )}
                />
              ))}
            </div>
            {overflow > 0 && (
              <span className="text-xs font-semibold text-muted">+{overflow}</span>
            )}
          </div>

          <AttendancePill attendance={ride.attendance} isUpcoming={ride.is_upcoming} />
        </div>
      </div>
    </Link>
  )
}

/**
 * `Are you going?=No` draws no pill at all, which is why this returns null
 * rather than an "unanswered" state.
 *
 * Past + Yes reads "Went" — the one place the two properties interact.
 */
function AttendancePill({
  attendance,
  isUpcoming,
}: {
  attendance: RideAttendance
  isUpcoming: boolean
}) {
  if (!attendance) return null

  const going = attendance === 'going'

  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-[3px] text-xs font-semibold text-white',
        going ? 'bg-accent' : 'bg-maybe'
      )}
    >
      {going ? (isUpcoming ? 'Going' : 'Went') : 'Maybe'}
    </span>
  )
}
