import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, LocationOutlineIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { RideAttendanceBar } from '@/components/rides/RideAttendanceBar'
import { RideDescription } from '@/components/rides/RideDescription'
import { RideHeader } from '@/components/rides/RideHeader'
import { RideMap } from '@/components/rides/RideMap'
import { getRide } from '@/lib/data/rides'
import { formatRideDateLong, formatRideTime } from '@/lib/utils'

/**
 * `Ride - Ride plan (Details)` (`2375:8771`) — the ride's plan.
 *
 * Composition is measured, not inferred: banner 390×200 at the top, then the
 * club chip, the 24/36 title, the clamped blurb with `Show more`, the date and
 * location rows at 64 tall each with their `Grey/10` hairlines, and the 358×160
 * map. The RSVP bar is fixed above the nav bar rather than in it.
 *
 * Two things the design draws that the schema cannot fill — the 200px banner and
 * the map tile — are rendered as their containers and logged in
 * docs/FIGMA-FIDELITY-TODO.md §Ride detail, the same treatment the rides list
 * gave its image strip. The banner is omitted entirely rather than drawn as a
 * 200px grey slab, because unlike the map it carries no affordance at all: an
 * empty fifth of the screen above the fold is worse than a shorter page.
 */
export default async function RidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ride = await getRide(id)

  // Covers both "no such ride" and "not yours to see" — see getRide on why the
  // two must stay indistinguishable.
  if (!ride) notFound()

  return (
    <>
      <RideHeader rideId={ride.id} title={ride.title} current="plan" />

      {/* The shell reserves the 96px header; this screen's is the 120px variant,
          so it owes the 24px difference. Both paddings top up the shell's
          rather than replacing them — the numbers live in globals.css. */}
      <div className="pt-header-sub-extra pb-rsvp-bar-extra flex flex-col gap-4 pb-4">
        {ride.club && (
          <Link
            href={`/rides?club=${ride.club.id}`}
            className="flex items-center gap-1 px-6 pt-4"
          >
            <Avatar src={ride.club.avatar_url} name={ride.club.name} size="xs" className="h-5 w-5" />
            <span className="text-xs font-semibold text-foreground">{ride.club.name}</span>
          </Link>
        )}

        <h2 className="px-6 text-2xl font-semibold text-foreground">{ride.title}</h2>

        {ride.description && <RideDescription description={ride.description} />}

        <div className="flex flex-col">
          <DetailRow
            icon={<CalendarIcon className="h-6 w-6 text-muted" />}
            primary={formatRideDateLong(ride.departure_at)}
            secondary={formatRideTime(ride.departure_at)}
          />
          <DetailRow
            icon={<LocationOutlineIcon className="h-6 w-6 text-muted" />}
            primary={ride.meeting_point}
            // The design splits this into a place name and a street address.
            // `meeting_point` is one free-text column, so it renders as the
            // primary line and the second stays empty. Logged.
            secondary={null}
          />
        </div>

        <RideMap meetingPoint={ride.meeting_point} />

        {ride.route_description && (
          <div className="flex flex-col gap-1 px-6">
            <h3 className="text-sm font-semibold text-foreground">Route</h3>
            <p className="text-sm text-muted">{ride.route_description}</p>
          </div>
        )}

        <Link
          href={`/rides/${ride.id}/crew`}
          className="px-6 text-sm font-semibold text-accent"
        >
          {ride.riders_count} {ride.riders_count === 1 ? 'rider' : 'riders'} going
        </Link>
      </div>

      <RideAttendanceBar rideId={ride.id} attendance={ride.attendance} />
    </>
  )
}

/**
 * One 64px row — icon at 24px in a 48px gutter, two stacked lines, and a
 * hairline under it inset to the text's left edge rather than run full width.
 */
function DetailRow({
  icon,
  primary,
  secondary,
}: {
  icon: React.ReactNode
  primary: string
  secondary: string | null
}) {
  return (
    <div className="flex h-16 items-center gap-6 px-6">
      <span className="shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col self-stretch justify-center border-b border-track">
        <span className="truncate text-sm font-semibold text-foreground">{primary}</span>
        {secondary && <span className="truncate text-sm font-medium text-muted">{secondary}</span>}
      </span>
    </div>
  )
}
