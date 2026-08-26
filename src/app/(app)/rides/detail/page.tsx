'use client'

import { Suspense } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, LocationOutlineIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { RideAttendanceBar } from '@/components/rides/RideAttendanceBar'
import { RideChatRow } from '@/components/rides/RideChatRow'
import { RideCrewRail } from '@/components/rides/RideCrewRail'
import { RideHeader } from '@/components/rides/RideHeader'
import { RideJournal } from '@/components/rides/RideJournal'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonDetail } from '@/components/ui/Skeleton'
import { RideMap } from '@/components/rides/RideMap'
import { getRide } from '@/lib/data/rides'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { DETAIL_ID_PARAM, routes } from '@/lib/routes'
import {
  cn,
  formatRelativeTime,
  formatRideDateLong,
  formatRideTime,
  googleMapsDirectionsUrl,
} from '@/lib/utils'
import type { RideDetail } from '@/types'

/**
 * The ride's plan — **one screen now, not the head of a set of four** (PD-254).
 *
 * `Ride - Ride plan (Details)` (`2375:8771`) is still the frame this is built
 * from, and it is no longer the whole specification: the drawn sub-page sheet is
 * deleted here, and Crew, Chat and Journal are sections on this page instead of
 * destinations behind a dropdown. That is a deviation from the Figma and it is
 * logged in docs/FIGMA-FIDELITY-TODO.md §Ride detail; the approved frames are
 * the seven-revision mock the product owner settled on 2026-08-17, carried in
 * Figma as `AI / Ride detail merged / 2026-08-17`.
 *
 * **What the merge deleted, and why each was a cost rather than a tidy-up:**
 *
 * - **`RidePageMenu`** hid its own options. A rider who cannot find a sheet
 *   cannot find anything in it, which is the whole of PD-125's measurement.
 *   Everything it listed is now a row you can see without opening anything, so
 *   the header drops to 96px and this screen stops paying `.pt-header-sub-extra`.
 * - **The body `<h2>{ride.title}</h2>`** was the title drawn twice — `RideHeader`
 *   already renders it 40px above, and the frame's 24/36 title predates the
 *   header carrying one.
 * - **The two 64px `DetailRow`s** became two 20px lines. 128px of hairlines and
 *   gutters for two facts, above the fold, on a screen whose job is to get a
 *   rider to the map and the crew.
 *
 * The 200px banner the frame draws is still omitted — the schema still cannot
 * fill it, and an empty fifth of the screen above the fold is worse than a
 * shorter page. Logged in the same place. The map panel has a column behind it
 * (`051`) and draws a tile whenever the ride has one, which today is never — see
 * `RideMap`, which owns both states.
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
  // The id is a query parameter, not a segment, so the static bundle needs one
  // document rather than one per ride — and `useSearchParams()` has to sit
  // inside a Suspense boundary or the whole route opts out of prerendering,
  // which `output: 'export'` refuses. See src/lib/routes.ts.
  return (
    <Suspense fallback={null}>
      <RideScreen />
    </Suspense>
  )
}

function RideScreen() {
  const id = useSearchParams().get(DETAIL_ID_PARAM) ?? ''
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
   * What gates the header's chat button, the labelled chat row and the Journal.
   *
   * `undefined` until the ride lands, so all three appear a moment late rather
   * than being drawn and then withdrawn. **Read, not re-derived** — this screen,
   * the crew page and the chat page each spelled out `private.is_ride_crew`'s
   * two arms by hand until 2026-08-07, and three copies of one database rule is
   * three places to miss when it narrows. `getRide` owns it now.
   */
  const isCrew = ride.data?.is_crew

  return (
    <>
      {/* Everything the chrome needs but the title comes out of the URL, so
          back works while the plan is still arriving. The title is the one part
          that cannot, so it goes in as `undefined` and `Header` draws a
          placeholder bar for it — an empty title reserves the header's space
          behind nothing, and a guessed one would be replaced in front of the
          rider. */}
      <RideHeader
        rideId={id}
        title={ride.data?.title}
        current="plan"
        isCrew={isCrew}
        isOrganizer={ride.data?.is_organizer}
      />

      {/* No `.pt-header-sub-extra` any more: the shell reserves the 96px header
          and, with the sub-page switcher gone, 96px is what this screen's header
          is. The bottom padding is owed only when the bar it clears is actually
          there. */}
      <div className={cn('flex flex-col gap-4 pt-4 pb-4', canRsvp && 'pb-rsvp-bar-extra')}>
        {ride.error ? (
          <ErrorState onRetry={ride.refetch} />
        ) : ride.data ? (
          <RidePlan ride={ride.data} isCrew={isCrew === true} />
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

function RidePlan({ ride, isCrew }: { ride: RideDetail; isCrew: boolean }) {
  // Description and route are one paragraph now rather than a blurb and a
  // `Route` heading 200px apart. They are two columns because they are two
  // things an organizer types, not two things a rider reads separately — and a
  // heading over one sentence was more furniture than content. Joined with a
  // space rather than a blank line because `ExpandableText` renders a single
  // `<p>` with no `whitespace-pre-line`, so a newline would collapse to exactly
  // this anyway and only the source would suggest otherwise.
  const blurb = [ride.description, ride.route_description].filter(Boolean).join(' ')

  return (
    // A `div` rather than the Fragment this used to be: the parent's own
    // `gap-4` used to apply directly between these elements once React
    // flattened the Fragment into it, so this carries the same `flex
    // flex-col gap-4` itself now that it is also the thing that needs to
    // fade in as one unit — `SkeletonDetail` is a different component, so
    // swapping to this is always a fresh mount and the animation always
    // fires exactly once, on arrival.
    <div className="flex flex-col gap-4 motion-safe:animate-fade-in">
      {ride.club && (
        // The club, not the rides list filtered to it (PD-289). A club name on a
        // ride names the club, and `PostcardCard`'s chip already resolves the
        // same tap the same way. The filtered list is not wrong to exist — it is
        // what `RideFilterBar`'s club tiles are for — it is just not what this
        // link means. Through `routes.club` rather than a literal: a hand-written
        // path skips `encodeURIComponent` and is invisible to a grep for the
        // shape, which is the defect `lib/routes.ts` exists to remove.
        <Link href={routes.club(ride.club.id)} className="flex items-center gap-1 px-6">
          <Avatar src={ride.club.avatar_url} name={ride.club.name} size="xs" className="h-5 w-5" />
          <span className="text-xs font-semibold text-foreground">{ride.club.name}</span>
        </Link>
      )}

      {/* Two lines where two 64px rows were. The icons are the same ones the
          rows carried, at 20px in a 20px gutter rather than 24 in 48. */}
      <div className="flex flex-col gap-1.5 px-6">
        <p className="flex items-center gap-2.5">
          <CalendarIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {formatRideDateLong(ride.departure_at, ride.timezone)},{' '}
            {formatRideTime(ride.departure_at, ride.timezone)}{' '}
            {/* The marker a calendar date does not carry: "Sunday, 24 Aug" is
                only useful to a rider who already knows what today is.
                `formatRelativeTime` rather than a formatter of this screen's
                own — the naming rule exists because each design draws a
                different *shape*, and this draws exactly the shape it already
                produces. It needs no timezone: it measures the distance between
                two instants, which is the same everywhere, so it is the one
                stamp on this screen that `rides.timezone` does not reach. */}
            <span className="font-medium text-muted">· {formatRelativeTime(ride.departure_at)}</span>
          </span>
        </p>

        <p className="flex items-center gap-2.5">
          <LocationOutlineIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          {/* The design splits this into a place name and a street address.
              `meeting_point` is one free-text column, so it renders as one line.
              Logged. */}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {ride.meeting_point}
          </span>
          {/* Past rides get no `Directions`, which the mock draws by omission
              and is worth stating: routing a rider to a meeting point that was
              used last Tuesday is an offer with nothing behind it. The map panel
              below stays a deeplink either way — it is the *map*, and looking at
              where a ride went is not the same act as being sent there. */}
          {ride.is_upcoming && (
            <a
              href={googleMapsDirectionsUrl(ride.meeting_point)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-semibold text-accent"
            >
              Directions
            </a>
          )}
        </p>
      </div>

      <RideMap meetingPoint={ride.meeting_point} tileUrl={ride.map_detail_url} />

      {blurb && <ExpandableText className="px-6">{blurb}</ExpandableText>}

      {/* Not crew-gated (PD-282). `ride_journal_postcard_ids` gates on
          `can_read_ride` and the postcard SELECT qual, and never on crew — so
          anyone who can open this ride can already be shown its photos, and
          hiding the section was the UI inventing a rule the policy does not
          have. `canAdd` carries the half that IS a database rule: tagging wants
          `private.is_ride_crew`, so only the crew is offered the tile. */}
      <section className="flex flex-col gap-2">
        <SectionHeader title="Journal" className="py-0" />
        <RideJournal rideId={ride.id} canAdd={isCrew} />
      </section>

      {/* The count this rail draws is the one that was removed from this screen
          once already, for counting `maybe` RSVPs under a "going" label and
          disagreeing with the roster one tap away. It is allowed back only
          because `RideCrewRail` reads `queryKeys.rides.crew(id)` — the crew
          page's own key, through the crew page's own function — and counts the
          array that page renders under `Going`. See that component. */}
      <section className="flex flex-col gap-2">
        <SectionHeader title={ride.is_upcoming ? 'Riding' : 'Rode'} className="py-0" />
        <RideCrewRail
          rideId={ride.id}
          organizerId={ride.organizer_id}
          organizer={ride.organizer}
          isUpcoming={ride.is_upcoming}
        />
      </section>

      {/* Last on the page, which reads wrong against the issue and is right
          against the artifact it approved. PD-254's body lists these Crew →
          Chat → Journal; the rev-7 mock the product owner settled draws
          Journal → Riding → Ride chat → RSVP, on both its frames, and the mock
          is what was approved. Checked against the artifact rather than
          remembered. It is worth knowing this is the one element the whole
          issue is about — a rider could not find the chat — so if it turns out
          to sit below the fold on a short device, moving it above the Journal
          is a change to this line and nothing else. */}
      {isCrew && <RideChatRow rideId={ride.id} />}
    </div>
  )
}
