'use client'

import { notFound, useParams } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, LocationOutlineIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { RideAttendanceBar } from '@/components/rides/RideAttendanceBar'
import { RideHeader } from '@/components/rides/RideHeader'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SkeletonDetail } from '@/components/ui/Skeleton'
import { RideMap } from '@/components/rides/RideMap'
import { getRide } from '@/lib/data/rides'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { cn, formatRideDateLong, formatRideTime } from '@/lib/utils'
import type { RideDetail } from '@/types'

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
 *
 * ## The three-way answer this screen needs, and why `null` is not `undefined`
 *
 * A `useQuery` result carries both, and conflating them turns a 404 into a flash
 * of one on every load. `undefined` is "the effect has not answered yet"; `null`
 * is "answered, and there is no such ride — or none you may see", which `getRide`
 * deliberately does not distinguish. Only the second is `notFound()`. Awaiting
 * the read left no state in which the answer had not arrived, so the server
 * version had no such distinction to make.
 */
export default function RidePage() {
  const { id } = useParams<{ id: string }>()
  const ride = useQuery(queryKeys.rides.detail(id), () => getRide(id))

  // Covers both "no such ride" and "not yours to see" — see getRide on why the
  // two must stay indistinguishable. A malformed segment lands here too:
  // `getRide` parses the id and returns null rather than letting `22P02` reach
  // the error boundary as a "Try again" on a URL that can never succeed.
  if (ride.data === null) notFound()

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
   *
   * False until the ride arrives, which is the one layout shift this screen
   * has: the bottom padding that clears the RSVP bar is owed only once we know
   * the bar is there, and guessing either way would be wrong half the time.
   */
  const canRsvp = !!ride.data && ride.data.is_upcoming && !ride.data.is_organizer

  /**
   * Whether this rider is on the ride, which is what gates the header's chat
   * button. Exactly `private.is_ride_crew`'s predicate (034), derived from data
   * this screen already holds rather than asked for again — an organizer is on
   * their own ride by construction, and any RSVP of either status is crew.
   *
   * `undefined` until the ride lands, so the button appears a moment late
   * rather than being drawn and then withdrawn.
   */
  const isCrew = ride.data ? ride.data.is_organizer || ride.data.attendance !== null : undefined

  return (
    <>
      {/* Everything the chrome needs but the title comes out of the URL, so it
          renders immediately: back and the sub-page switcher both work while
          the plan is still arriving. The title is the one part that cannot, so
          it goes in as `undefined` and `Header` draws a placeholder bar for it —
          an empty title reserves the header's space behind nothing, and a
          guessed one would be replaced in front of the rider. */}
      <RideHeader rideId={id} title={ride.data?.title} current="plan" isCrew={isCrew} />

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
        {ride.error ? (
          <ErrorState onRetry={ride.refetch} />
        ) : ride.data ? (
          <RidePlan ride={ride.data} />
        ) : (
          <SkeletonDetail />
        )}
      </div>

      {canRsvp && ride.data && (
        <RideAttendanceBar rideId={ride.data.id} attendance={ride.data.attendance} />
      )}
    </>
  )
}

function RidePlan({ ride }: { ride: RideDetail }) {
  return (
    <>
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
