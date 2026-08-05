import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, LocationOutlineIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { RideAttendanceBar } from '@/components/rides/RideAttendanceBar'
import { RideHeader } from '@/components/rides/RideHeader'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { RideMap } from '@/components/rides/RideMap'
import { getRide } from '@/lib/data/rides'
import { cn, formatRideDateLong, formatRideTime } from '@/lib/utils'

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

  /**
   * Two cases the design does not draw, and neither can be "show it anyway":
   *
   * - **Past rides.** "Are you going?" about a ride that has already happened is
   *   nonsense, and answering it would silently edit history.
   * - **The organizer.** They cannot decline their own ride coherently: `No`
   *   deletes the `ride_members` row, but `withOrganizer` puts the host in
   *   `going` unconditionally, so the crew page would still list them as
   *   going. The control would be lying about what it did. The v1 page hid the
   *   join button from the organizer for the same reason.
   */
  const canRsvp = ride.is_upcoming && !ride.is_organizer

  return (
    <>
      <RideHeader rideId={ride.id} title={ride.title} current="plan" />

      {/* The shell reserves the 96px header; this screen's is the 120px variant,
          so it owes the 24px difference. Both paddings top up the shell's
          rather than replacing them — the numbers live in globals.css. The
          bottom one is owed only when the bar it clears is actually there. */}
      <div
        className={cn(
          'pt-header-sub-extra flex flex-col gap-4 pb-4',
          canRsvp && 'pb-rsvp-bar-extra'
        )}
      >
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

        {ride.description && <ExpandableText className="px-6">{ride.description}</ExpandableText>}

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

        {/* Carries no count. The number that used to sit here counted `maybe`
            RSVPs under a "going" label and disagreed with the crew page one tap
            away; the roster and its two counts belong to that page. The design
            draws no crew summary on this screen at all — the header's page
            switcher is the specified route to Crew, and this is a second, more
            obvious one. */}
        <Link
          href={`/rides/${ride.id}/crew`}
          className="px-6 text-sm font-semibold text-accent"
        >
          See who’s riding
        </Link>
      </div>

      {canRsvp && <RideAttendanceBar rideId={ride.id} attendance={ride.attendance} />}
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
