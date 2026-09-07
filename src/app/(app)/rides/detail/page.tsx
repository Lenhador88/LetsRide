'use client'

import { Suspense, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, LocationOutlineIcon } from '@/components/icons/generated'
import { Avatar } from '@/components/ui/Avatar'
import { RideAttendanceBar } from '@/components/rides/RideAttendanceBar'
import { RideCreateAction } from '@/components/rides/RideCreateAction'
import { RideCrewRail } from '@/components/rides/RideCrewRail'
import { RideStatusChip } from '@/components/rides/RideStatusChip'
import { RideHeader } from '@/components/rides/RideHeader'
import { RideTimeline } from '@/components/rides/RideTimeline'
import { ErrorState } from '@/components/ui/ErrorState'
import { ExpandableText } from '@/components/ui/ExpandableText'
import { SkeletonDetail } from '@/components/ui/Skeleton'
import { MapAttribution } from '@/components/rides/MapAttribution'
import { RideMap } from '@/components/rides/RideMap'
import { getRide, isRideCrew } from '@/lib/data/rides'
import { distanceKm } from '@/lib/location/distance'
import type { RiderLocation } from '@/lib/location/rider-location'
import { useRiderPosition } from '@/lib/location/use-rider-position'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { resolveRideDetailActions } from '@/lib/rides/bottom-slot'
import { DETAIL_ID_PARAM, RETURN_ANCHOR_PARAM, routes } from '@/lib/routes'
import {
  cn,
  formatRelativeTime,
  formatRideDateLong,
  formatStartDistance,
  formatRideTime,
  googleMapsDirectionsUrl,
} from '@/lib/utils'
import type { RideAttendance, RideDetail } from '@/types'

/**
 * The ride — **a timeline with a header on it**, as of 2026-09-05 (PD-393); one
 * screen rather than the head of a set of four since PD-254.
 *
 * The product owner: *"Similar to the club list, we need to adopt a timeline.
 * So at the top we will keep a sort of header with relevant information about
 * the ride. But then, we will have the timeline with the postcards,
 * announcements (someone joins the ride, etc.). So similar layout and
 * characteristics to the club details."* Top to bottom the screen is now: what
 * the ride is, who is coming, what you can do, and what has happened.
 *
 * ## What PD-393 changed, and the two decisions inside it
 *
 * - **`RideJournal` is deleted.** Its postcards are entries on the timeline
 *   now, exactly as `ClubPostcardCarousel`'s were on the club's. A strip
 *   repeating what the stream says twenty pixels below it is the length that
 *   made the club screen confusing, and the same argument arrives here with
 *   the same shape. Its `Add` tile became the `(+)` on the timeline's own
 *   heading — the entrance PD-125 exists to protect, moved rather than dropped,
 *   and moved twice more since: into the sticky slot by PD-401 and into the
 *   floating action by PD-404, which is where it is now.
 *   **`PostcardStamp` went with it**, one commit later: the strip was
 *   its last surface, and the product owner chose deleting it over keeping the
 *   perforated tile for PD-257's unbuilt journal route. That story owes a tile
 *   of its own now; `docs/FIGMA-FIDELITY-TODO.md` §The stamp as a franked
 *   postal stamp keeps the measurements a rebuild would need.
 * - **The crew rail stays above the stream.** The rail answers *who is coming*
 *   and the stream answers *what has happened*; the club detail keeps its
 *   member rail above its timeline for the identical reason.
 *   **The labelled chat row stood beside it until PD-426 and is now gone**,
 *   along with the header's chat icon and the thread index both pointed at.
 *   PD-125's finding — that a rider could not find the chat — is not reopened
 *   by that: it argued against burying an entrance under a growing stream, and
 *   the threads are now rows *in* the stream rather than behind a link out of
 *   it.
 *
 * ## What PD-401 changed — the rail moves up, and the `(+)` becomes a bar
 *
 * Product owner, 2026-09-05: *"Lets have the create button instead of a plus on
 * timeline. Lets move the rider section above the map, we can drop the title."*
 * Both are the club detail's settled shape and the ride was the odd one out on
 * each.
 *
 * - **The crew rail sits above the map and has lost its `SectionHeader`.** Who
 *   is coming is what a rider checks before the map. The heading carried
 *   `Riding` / `Rode`, which the date line 40px above it already establishes,
 *   and the rail says what it is by being avatars and a count — the same
 *   treatment the club member rail got when PD-355 moved it to the top.
 * - **The `(+)` became a create bar in the sticky bottom slot** — option **B**
 *   from PD-401's collision table, with the timeline `(+)` kept as a fallback.
 *   **PD-404 has since superseded all of that**; see below.
 *
 * ## What PD-404 changed — the bar floats, and answering collapses the RSVP
 *
 * Product owner, 2026-09-06, answering the frame question PD-401 refused to
 * decide unattended, with a shape none of its four options offered: **the RSVP
 * bar and the create affordance are never both present**, because answering
 * replaces the bar. It collapses into a status chip on the first content line,
 * a floating action takes the corner, and tapping the chip brings the bar back.
 *
 * - **`RideCreateBar` is deleted**, replaced by `RideCreateAction`. Same sheet,
 *   same rows, same crew gate; only the trigger moved.
 * - **The timeline `(+)` is deleted too, and it was unreachable rather than
 *   unwanted** — `bottom-slot.ts` carries the proof and its test pins the
 *   identity that proof rests on.
 * - **PD-401's option D is no longer the open question it was.** D moved the
 *   RSVP into the page body to free the slot; the slot is freed here by hiding
 *   the bar once it has been answered, which is a *larger* departure from
 *   `2375:8771` than D would have been — that frame draws the bar permanently
 *   stacked. All three departures are logged in `docs/FIGMA-FIDELITY-TODO.md`
 *   §Ride detail.
 * - **The club detail is NOT converted.** `2043:10604` instances a variant 26
 *   other frames use, so that half of PD-404 is still open.
 *
 * `Ride - Ride plan (Details)` (`2375:8771`) is still the frame the header half
 * is built from, and it is not the whole specification: the drawn sub-page
 * sheet is deleted here, and Crew and Chat are sections on this page instead of
 * destinations behind a dropdown. `Ride - Journal (Postcards/Timeline)`
 * (`2226:4865`) draws a postcards-only feed and is the closest thing to the
 * stream below; the composition is ours. Both deviations are logged in
 * docs/FIGMA-FIDELITY-TODO.md §Ride detail; the approved frames for the merge
 * are the seven-revision mock the product owner settled on 2026-08-17, carried
 * in Figma as `AI / Ride detail merged / 2026-08-17`.
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
  const params = useSearchParams()
  const id = params.get(DETAIL_ID_PARAM) ?? ''
  // PD-378. Read raw and passed on unvalidated — `rideReturnTo` parses it with
  // `clubTimelineAnchorSchema` at the one point it is turned into a
  // destination, so a junk value falls back there rather than being screened
  // twice in two places that could drift apart.
  const returnAnchor = params.get(RETURN_ANCHOR_PARAM)
  const ride = useQuery(queryKeys.rides.detail(id), () => getRide(id))

  // For the location row's `12 km away` (PD-340). Its own read on the shared
  // key, and it gates nothing: the ride renders whether or not a position ever
  // lands, and the clause appears beside the meeting point when one does.
  const { position } = useRiderPosition()

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
  const rsvpApplies = !!ride.data && ride.data.is_upcoming && !ride.data.is_organizer

  /**
   * The rider tapped their status chip to change an answer they have already
   * given, so the RSVP bar comes back for as long as they leave it open
   * (PD-404).
   *
   * **Page state rather than a stored fact**, and it clears on a successful
   * write — `RideAttendanceBar`'s `onAnswered` — so the bar folds back into the
   * chip as soon as the new answer lands. It also clears on `No`, and it has to:
   * that deletes the row, so `attendance` returns to `null` and the bar is owed
   * again on its own terms rather than on this flag.
   */
  const [rsvpReopened, setRsvpReopened] = useState(false)

  /**
   * Bumped on every server-accepted answer, and passed to `RideStatusChip` so it
   * takes focus when the bar collapses out from under the rider.
   *
   * **Answering unmounts `RideAttendanceBar`, which destroys both the focused
   * button and the `role="status"` region inside it.** Without this a keyboard
   * rider is dropped to `document.body` and a screen-reader rider hears nothing,
   * at the one moment the chip becomes their only route back to the answer.
   *
   * **A counter rather than a boolean**, because the two transitions that need
   * it are not both mounts: the first answer mounts the chip, but answering
   * again from a reopened bar leaves the chip mounted and unmounts only the bar.
   */
  const [answerFocusToken, setAnswerFocusToken] = useState(0)

  /**
   * The answer the rider just gave, held until the read catches up.
   *
   * **`setRideAttendance` invalidates rather than writing through**, and
   * `invalidate` starts a background refetch it does not await — so for one
   * round trip after a successful answer, `ride.data.attendance` is still the
   * PREVIOUS value. Without this the bar collapses into a chip showing the
   * answer the rider just replaced, and the focus move announces it: *"You
   * answered Going"* at the moment they answered Maybe. On `No` it is worse —
   * the chip is drawn from the stale `going`, takes focus, and then unmounts
   * when the read lands, dropping focus to `document.body`, which is the whole
   * of the defect this focus handling exists to fix.
   *
   * `undefined` means *nothing pending*, which is why this cannot be a plain
   * `RideAttendance`: `null` is itself an answer here — the rider tapped `No`.
   * `RideAttendanceBar` holds the same value internally for the same round trip
   * and for the same reason; this is that decision at the one level up that
   * also owns the composition.
   */
  const [pendingAnswer, setPendingAnswer] = useState<RideAttendance | undefined>(undefined)

  // **Not cleared when the read catches up, and that is deliberate.** Clearing
  // it needs a `setState` inside an effect, which is a cascading render the lint
  // rule refuses — and it would buy nothing, because once the read agrees the
  // two values are equal and this expression returns the same answer either way.
  // What it costs is that a change made on ANOTHER device stays masked for the
  // life of this screen. **That is a longer window than `RideAttendanceBar`'s
  // own `choice`, and the two are not the same bargain**: `choice` dies with the
  // bar, and the bar unmounts on every answer that STORES one, so its masking
  // usually lasts a single open-and-answer cycle where this lasts the whole page
  // mount. (`No` is the exception, and it is the exception everywhere in this
  // change: it stores nothing, so the bar stays and `choice` survives with it.)
  // The cost is still small — it takes an external write to `ride_members` to
  // become visible at all — and every fresh mount reads the truth.
  const answer = pendingAnswer !== undefined ? pendingAnswer : (ride.data?.attendance ?? null)

  /**
   * What gates the header's chat button, the labelled chat row and the create
   * affordance.
   *
   * `undefined` until the ride lands, so all three appear a moment late rather
   * than being drawn and then withdrawn.
   *
   * **Through `getRide`'s own `isRideCrew`, never a hand-written copy of the
   * rule.** This screen, the crew page and the chat page each spelled out
   * `private.is_ride_crew`'s two arms by hand until 2026-08-07, and three copies
   * of one database rule is three places to miss when it narrows. `getRide`
   * still owns the rule; what is passed to it here is the answer this screen
   * has, which is not always the one the last read returned.
   *
   * **It must be derived from `answer` rather than read off `ride.data.is_crew`,
   * and the two disagree for exactly one round trip.** `is_crew` and
   * `attendance` come from the same `ride_members` row, so a rider's first `Yes!`
   * makes them crew at the same instant it stores their answer. Read the stale
   * `is_crew` beside the optimistic `answer` and the pair is momentarily
   * incoherent: `resolveRideDetailActions` sees an answered rider who may not
   * create, returns `bottomSlot: null`, and the sticky slot goes **empty** for a
   * round trip — the RSVP bar gone, the floating action not yet there, and the
   * page's padding stepping through three values so the timeline jumps twice.
   *
   * That pair is also what `bottom-slot.ts`'s whole `timelineAdd` proof rests
   * on — *for a non-organizer, crew ⟺ answered* — and the proof holds only for
   * values taken from one row. **So the two arguments move together or not at
   * all.**
   *
   * **`answer` is the FOLDED value, which `isRideCrew`'s own docstring tells
   * callers not to pass, and this is the exception with its condition
   * attached.** It is safe only because `isOrganizer ||` short-circuits before
   * the folded arm is read, so the two never both matter. **The day that stops
   * being true, this diverges silently**: drop the organizer arm from
   * `isRideCrew` — which its docstring names as a live possibility, going with
   * `enforce-creator-membership` — and `getRide` would compute `is_crew` from
   * the raw `null` while this computes from the folded `'going'`. One rule, two
   * answers, `tsc` green, and an organizer offered a create action `041`
   * refuses. **If that arm ever moves, pass the unfolded status here in the
   * same commit.**
   */
  const isCrew = ride.data ? isRideCrew(ride.data.is_organizer, answer) : undefined

  /**
   * Who may create, and which of the two affordances they get — PD-401.
   *
   * ## The collision, and which of the four ways out this takes
   *
   * `RideAttendanceBar` already owns the sticky bottom slot on every upcoming
   * ride the viewer does not organize, which is most riders on most rides. The
   * issue put four ways out and called the choice the decision rather than a
   * detail:
   *
   * - **A** stack the two bars — ~190px of chrome over the stream on a 390px
   *   screen, and the issue says not to ship it silently. Not taken.
   * - **B** create only when the RSVP bar is absent. Taken, with the fallback
   *   below.
   * - **C** put the create inside the RSVP bar — conflates *are you going* with
   *   *add a photo*. Not taken.
   * - **D** move the RSVP out of the sticky slot into the page body. The
   *   issue's own recommendation and **deliberately not taken here**, because
   *   `RideAttendanceBar`'s frame (`2375:8771`) draws it stacked ON the
   *   navigation bar: moving it into the body contradicts an approved v2 frame,
   *   and decision #4 says v2 is the only design. PD-404 is parked on exactly
   *   that class of decision — the frame problem is the owner's, not a build's,
   *   and taking D unattended would be making it by omission. D stays available
   *   and this change forecloses nothing: it is B *plus* one predicate.
   *
   * ## Nobody loses an entrance, and it is no longer the `(+)` that guarantees it
   *
   * PD-401's cost for option B was *"an upcoming ride's crew loses it"*, and it
   * kept the timeline `(+)` as the fallback that refused that cost. **PD-404
   * pays it differently**: the RSVP bar is not competing for the slot any more,
   * so a crew member gets the floating action in every state except the one
   * where they have deliberately reopened the bar with their own chip — which
   * is transient and closes with the same tap.
   *
   * `undefined` until the ride lands, so neither affordance is drawn and then
   * withdrawn. **Crew is the database's rule, not the UI's**: `041` requires
   * `private.is_ride_crew` to tag a postcard to a ride.
   *
   * The decision itself is `resolveRideDetailActions` — a pure function with
   * its own exhaustive test — because the answers constrain one another and
   * that property is what a later tidy-up would quietly break.
   */
  const { bottomSlot, statusChip, createOptions } = resolveRideDetailActions({
    rideId: id,
    rsvpApplies,
    attendance: answer,
    canCreate: isCrew === true,
    reopened: rsvpReopened,
  })

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
        isOrganizer={ride.data?.is_organizer}
        // PD-378 — the club timeline row this ride was opened from, and the
        // club it belongs to. The anchor comes out of the URL so it is there on
        // the first pass; the club comes off the ride, so the arrow answers
        // `/rides` until the read lands and then sharpens. `rideReturnTo` owns
        // that trade and prices the alternative.
        clubId={ride.data?.club_id}
        returnAnchor={returnAnchor}
      />

      {/* No `.pt-header-sub-extra` any more: the shell reserves the 96px header
          and, with the sub-page switcher gone, 96px is what this screen's header
          is. The bottom padding is owed only when the bar it clears is actually
          there. */}
      <div
        className={cn(
          'flex flex-col gap-4 pt-4 pb-4',
          // Whichever control has the slot, the page tops its own padding up by
          // that control's own clearance. Three different numbers are in play
          // and each belongs to one control, so this cannot be one shared
          // class: 96 for the RSVP bar, 80 for the floating action, and
          // `--navbar-action`'s 64 for the club detail's full-width create bar,
          // which this screen no longer has.
          //
          // **`.pb-navbar-action-extra` is the wrong one here**: its 64px is
          // the number derived for the 40px button in the bar PD-404 deleted,
          // and against the 56px floating control it leaves the last timeline
          // row 8px of gap instead of 24. Tight rather than buried, so no gate
          // can see it.
          //
          // **The floating action opts INTO clearance, which is not its
          // default** — it floats over content, which is the point of the
          // pattern. Here the thing underneath is a timeline, so without this
          // the last entry sits permanently under the button, which is one of
          // the negative cases PD-404's issue names by hand.
          bottomSlot === 'rsvp' && 'pb-rsvp-bar-extra',
          bottomSlot === 'create' && 'pb-floating-action-extra'
        )}
      >
        {ride.error ? (
          <ErrorState onRetry={ride.refetch} />
        ) : ride.data ? (
          <RidePlan
            ride={ride.data}
            statusChip={statusChip}
            rsvpOpen={bottomSlot === 'rsvp'}
            onToggleRsvp={() => setRsvpReopened((open) => !open)}
            answerFocusToken={answerFocusToken}
            near={position}
          />
        ) : (
          <SkeletonDetail />
        )}
      </div>

      {bottomSlot === 'rsvp' && ride.data && (
        <RideAttendanceBar
          rideId={ride.data.id}
          // **`answer`, not `ride.data.attendance`** — the bar seeds `choice`
          // from this prop ONCE, at mount, and it remounts on every reopen. Fed
          // the stored value it would paint `Yes!` selected under a chip
          // reading `Maybe` for any rider who reopens inside the round trip,
          // and `choice` is state, so nothing re-seeds it when the read lands.
          attendance={answer}
          // Collapses the bar back into the chip once a new answer has landed.
          // Only ever meaningful when the chip is what opened it; a rider
          // answering for the first time has no flag set, and the collapse there
          // comes from `attendance` itself leaving `null`.
          onAnswered={(next) => {
            // The answer the bar just landed, NOT `ride.data.attendance`, which
            // is still the previous value for one round trip — see
            // `pendingAnswer`. Taking it from the callback is what makes the
            // collapse and the focus announcement say the right thing.
            setPendingAnswer(next)
            setRsvpReopened(false)
            setAnswerFocusToken((n) => n + 1)
          }}
        />
      )}
      {bottomSlot === 'create' && ride.data && <RideCreateAction options={createOptions} />}
    </>
  )
}

function RidePlan({
  ride,
  statusChip,
  rsvpOpen,
  onToggleRsvp,
  answerFocusToken,
  near,
}: {
  ride: RideDetail
  /** The rider's own answer, drawn as a chip on the first content line, or
   *  `null` to draw none — `resolveRideDetailActions` decides which (PD-404).
   *  Not re-derived from `ride.attendance` here: the organizer reads `going`
   *  whatever is stored, and a chip whose tap does nothing is worse than none. */
  statusChip: RideAttendance
  /** Whether the RSVP bar is currently showing, so the chip can announce what
   *  its tap will do. Read off `bottomSlot` rather than from the reopened flag,
   *  because the bar is also drawn before any answer exists. */
  rsvpOpen: boolean
  onToggleRsvp: () => void
  /** Passed straight to the chip — see the page's `answerFocusToken`. */
  answerFocusToken: number
  near: RiderLocation | null
}) {
  // PD-340. `null` at every step is "nothing to say", never zero: the rider has
  // no position, the ride was never geocoded, or `distanceKm` refuses the pair.
  // The row then renders exactly as it did before this change — there is no
  // "distance unknown" state to draw, because that is most rides today.
  const start =
    ride.latitude !== null && ride.longitude !== null
      ? { lat: ride.latitude, lon: ride.longitude }
      : null
  const km = distanceKm(near, start)
  const distance = km === null ? null : formatStartDistance(km)

  // Description and route are one paragraph now rather than a blurb and a
  // `Route` heading 200px apart. They are two columns because they are two
  // things an organizer types, not two things a rider reads separately — and a
  // heading over one sentence was more furniture than content. Joined with a
  // space rather than a blank line because `ExpandableText` renders a single
  // `<p>` with no `whitespace-pre-line`, so a newline would collapse to exactly
  // this anyway and only the source would suggest otherwise.
  //
  // **`description` is read-only now (PD-320) and still read.** Both ride forms
  // dropped the field, so nothing writes the column any more — but the rows that
  // already carry text keep rendering it here, which is the decision that story
  // left to the build. Dropping the read too would silently delete prose riders
  // wrote and, with no field left, could never retype.
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
      {/* The ride's first content line, and since PD-404 it carries two things
          that are drawn independently: the club it belongs to, and the rider's
          own RSVP once they have given one.

          **A row rather than the bare club link it used to be**, so the chip has
          a home on a ride with no club — which is most of them. `justify-between`
          with the chip last puts it against the right margin in both cases
          rather than beside a club name whose length varies. The row renders at
          all only when it has something in it: an empty flex row would still
          consume the parent's `gap-4`. */}
      {(ride.club || statusChip) && (
        <div className="flex items-center justify-between gap-3 px-6">
          {ride.club ? (
            // The club, not the rides list filtered to it (PD-289). A club name
            // on a ride names the club, and `PostcardCard`'s chip already
            // resolves the same tap the same way. The filtered list is not wrong
            // to exist — it is what `RideFilterBar`'s club tiles are for — it is
            // just not what this link means. Through `routes.club` rather than a
            // literal: a hand-written path skips `encodeURIComponent` and is
            // invisible to a grep for the shape, which is the defect
            // `lib/routes.ts` exists to remove.
            <Link href={routes.club(ride.club.id)} className="flex min-w-0 items-center gap-1">
              <Avatar
                src={ride.club.avatar_url}
                name={ride.club.name}
                size="xs"
                className="h-5 w-5"
              />
              <span className="truncate text-xs font-semibold text-foreground">
                {ride.club.name}
              </span>
            </Link>
          ) : (
            // Holds the left half so the chip stays right-aligned without the
            // row changing justification depending on what is in it.
            <span />
          )}
          <RideStatusChip
            attendance={statusChip}
            open={rsvpOpen}
            onToggle={onToggleRsvp}
            focusToken={answerFocusToken}
          />
        </div>
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
            {/* How far the start is (PD-340), in the same slot and the muted
                weight the date row gives its relative clause — a qualifier on
                the place, not a second fact. It is inside the truncating span
                on purpose: a meeting point long enough to push this off the line
                has already told the rider more than the distance would, and the
                alternative is a distance that survives while the address it
                qualifies is cut to nothing. */}
            {distance && <span className="font-medium text-muted"> · {distance}</span>}
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

      {/* The count this rail draws is the one that was removed from this screen
          once already, for counting `maybe` RSVPs under a "going" label and
          disagreeing with the roster one tap away. It is allowed back only
          because `RideCrewRail` reads `queryKeys.rides.crew(id)` — the crew
          page's own key, through the crew page's own function — and counts the
          array that page renders under `Going`. See that component.

          **It stays, and the timeline below does not replace it** (PD-393).
          The rail answers *who is coming*, in the ride's own roster order, at a
          glance; the stream answers *what has happened*, newest first.

          **Above the map and with no `SectionHeader` (PD-401).** Who is coming
          is what a rider checks before the map, and the club member rail sits
          at the top of the club detail for the same reason (PD-355). The
          heading carried `Riding` / `Rode` — a tense the date line directly
          above already establishes, on a rail whose avatars and count say what
          it is without being labelled. This screen no longer imports
          `SectionHeader` at all — the only heading left on it is the
          timeline's, which `RideTimeline` draws itself. */}
      <RideCrewRail
        rideId={ride.id}
        organizerId={ride.organizer_id}
        organizer={ride.organizer}
        isUpcoming={ride.is_upcoming}
      />

      <RideMap meetingPoint={ride.meeting_point} tileUrl={ride.map_detail_url} />
      {/* Beneath the panel rather than in its corner — PD-236. The tile carries
          no burned-in credit any more (`ATTRIBUTION_MODE`), so this is what
          discharges the obligation, and it is page furniture rather than an
          overlay because the joined string is ~350px against a panel that is
          288 wide at 320px viewport. Keyed on the ride HAVING a tile, not on
          one currently drawing: `RideMap` falls back to the pin on an
          `onError`, and the credit is owed while the vendor's imagery is in the
          app rather than while a particular `<img>` is healthy. */}
      {!!ride.map_detail_url && <MapAttribution />}

      {blurb && <ExpandableText className="px-6">{blurb}</ExpandableText>}

      {/* `RideThreadsRow` was here — deleted with the index route it linked to,
          PD-426. What PD-254 measured (nobody finds the bare header bubble) is
          still true and is not what changed: the labelled row and the bubble
          were two entrances to a LIST, and threads are read on the timeline
          below now, so the row would be a third way to reach what the next
          element already shows. The header bubble went in the same change. */}
      {/* What has happened, last — the club detail's shape, PD-393. Not
          crew-gated (PD-282): `ride_journal_postcard_ids` gates on
          `can_read_ride` and the postcard SELECT qual and never on crew, and
          `102`'s roster policy follows ride visibility, so anyone who can open
          this ride can see both sources. The crew rule that used to gate this
          component's `(+)` did not go away with it — it moved to the bottom
          slot, where `canCreate` carries it: tagging wants
          `private.is_ride_crew`, so only the crew is offered the create
          affordance. */}
      <RideTimeline
        ride={{
          id: ride.id,
          created_at: ride.created_at,
          organizer_id: ride.organizer_id,
          organizer: ride.organizer,
        }}
      />
    </div>
  )
}
