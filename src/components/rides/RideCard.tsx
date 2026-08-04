import Link from 'next/link'
import { LocationFilledIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
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
 * **The 80×148 image strip has no data behind it.** The design fills it with a
 * photo carrying a location pin — almost certainly the static map thumbnail
 * decision #3 calls for — but `rides` has neither an image column nor
 * coordinates, and `meeting_point` is free text. It renders as the design's
 * container plus the pin, which is the honest subset. Recorded in
 * docs/FIGMA-FIDELITY-TODO.md; it needs schema and a tile provider, not design.
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

  return (
    <Link
      href={`/rides/${ride.id}`}
      className="flex gap-4 rounded-lg bg-surface p-1 pr-4 transition-colors active:bg-background"
    >
      <div className="relative w-20 shrink-0 self-stretch overflow-hidden rounded bg-border">
        <LocationFilledIcon className="absolute inset-0 m-auto h-6 w-6 text-foreground" />
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
