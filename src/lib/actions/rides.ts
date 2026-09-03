import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { capture } from '@/lib/analytics/client'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { MEDIA_BUCKET } from '@/lib/media/constants'
import { routes } from '@/lib/routes'
import { narrowsToNobody, RIDE_AUDIENCE_REFUSAL } from '@/lib/rides/audience'
import { readRideLocation, resolveDepartureZone, rideSchema } from '@/lib/validation/rides'
import { wallClockToUtc } from '@/lib/utils'
import type { ActionState } from '@/lib/actions/state'
import type { RideAttendance } from '@/types'

/**
 * The shared `emptyActionState` const lives in `lib/actions/state.ts` because
 * a `'use server'` module may export only async functions — see the note there,
 * and `src/__tests__/use-server-exports.test.ts`, which asserts the rule after
 * `postcards.ts` broke `/postcards/new` by violating it. This module no longer
 * carries the directive, so the rule no longer binds it; the split stays
 * because the constant is genuinely shared.
 */

/**
 * `rides.all()` is the prefix over the list, its filter tiles, the detail and
 * the crew — the three paths this replaces plus `filters`, which none of them
 * named. An RSVP moves the attendee collage the list draws, so the tiles were
 * always in the blast radius; `revalidatePath('/rides')` happened to cover them
 * because they render on that route.
 */
function invalidateRide() {
  invalidate(queryKeys.rides.all())
}

/**
 * Asks `resolve-ride-location` to geocode this ride's meeting point and render
 * its two tiles — PD-104 §5.1.
 *
 * **Fire-and-forget, and both halves of that are requirements rather than
 * style.** The ride is already saved by the time this runs; the map is an
 * enrichment. Awaiting it would put a geocode and two vendor renders — bounded
 * at 8s each inside the function — between the rider pressing Save and the
 * redirect they are waiting for, for a picture they have not asked about. And
 * there is no error to surface: the function answers 200 for every vendor
 * failure, and `specs/ride-map-tiles` requires that a refused render never
 * shows the rider anything.
 *
 * **The caller passes only a ride id.** No organizer id, no club id, no uid —
 * the function takes its subject from the JWT `invoke` forwards and decides
 * entitlement by reading the ride under that caller's own RLS. Sending an
 * identifier would be handing it something to get wrong.
 *
 * `rendered: true` is the only thing acted on, and it means at least one path
 * was written. `rides.all()` is a **prefix** over `rides.detail(id)`, so this one
 * call satisfies both claims task 5.2 names; no key is added, because the paths
 * ride on rows those keys already cover (5.3).
 *
 * **Nothing awaits the invalidation either**, so a rider who has already
 * navigated on simply gets the tile on their next read. The tab closing before
 * the round trip completes costs the tile and nothing else — the ride, its crew
 * row and the rider's redirect are all long since committed.
 */
function requestRideMapRender(supabase: DataClient, rideId: string): void {
  void supabase.functions
    .invoke<{ rendered?: boolean }>('resolve-ride-location', { body: { rideId } })
    .then(({ data }) => {
      if (data?.rendered) invalidate(queryKeys.rides.all())
    })
    .catch(() => {
      // Swallowed on purpose. A transport failure here — the vendor down, the
      // function cold, the tab closing mid-flight — must look like nothing at
      // all, because the ride is already saved and the rider asked for a ride
      // rather than a picture. There is deliberately nothing to distinguish it
      // from the function answering 200 with `rendered: false`.
    })
}

/**
 * Removes a ride's tile objects, best-effort.
 *
 * **Called after the write is CONFIRMED, not before it — and the earlier
 * "always before" rule was wrong in a way worth spelling out, because the
 * argument for it is genuinely persuasive and will be made again.**
 *
 * That argument: `051`'s stale-tile trigger NULLs both path columns in the same
 * UPDATE that changes `meeting_point`, and the ride row is the only place those
 * names were ever recorded, so afterwards nothing knows them. Every clause of
 * that is true **of the database** and false **of the caller**, which is holding
 * both names in a local across the statement. So the premise does not reach the
 * conclusion, and the ordering it recommends is strictly worse:
 *
 * **the UPDATE can be refused.** An organizer who has left the ride's club
 * raises 42501 on the WITH CHECK arm, on a save that need not have touched
 * `club_id` — `ride-lifecycle`'s ex-member case, reachable the moment
 * `leaveClub` runs. Delete first and both JPEGs are gone, `meeting_point` never
 * changed so the trigger never fired, both columns still name the deleted
 * objects, and the re-render is gated on the success that did not happen. Pin
 * fallback for ever, from a save that returned an error.
 *
 * Deleting after a confirmed write fails only into an orphaned object, which is
 * recoverable; the other order fails into a row naming objects that do not
 * exist, which is not.
 *
 * **`deleteRide` is the one caller where the old ordering is still correct**, and
 * that is why it keeps it rather than being an inconsistency: its DELETE policy
 * is `auth.uid() = organizer_id` with no WITH CHECK arm to fail, so it cannot be
 * refused past a test the caller already passed.
 *
 * Swallowed, and the failure it leaves is the recoverable one. If this refuses,
 * the row still names two objects that are about to become unnamed — the tile
 * 404s and `RideCard`/`RideMap` fall back to their pin rendering on the broken
 * load, which is exactly the state they were built for. The object itself stays
 * listable and deletable by its organizer through `051`'s own-folder read arm, so
 * ordering is the primary rule and that arm is the recovery path.
 */
async function removeRideMapTiles(
  supabase: DataClient,
  paths: (string | null | undefined)[]
): Promise<void> {
  const present = paths.filter((path): path is string => !!path)
  if (present.length === 0) return
  await supabase.storage.from(MEDIA_BUCKET).remove(present)
}

/**
 * Creates a ride and puts its organizer on the crew.
 *
 * Replaces the v1 page, which was the last `'use client'` screen in the app
 * writing through `supabase.from()`. That version set `organizer_id` from a
 * client-read user, enforced no length on four bare `text` columns, and passed
 * `new Date(value).toISOString()` — which resolves a zone-less
 * `datetime-local` string in the *browser's* zone, so the same input meant
 * different instants for different riders.
 *
 * **Two inserts and no transaction**, the same shape and the same caveat as
 * `createClub`: PostgREST has no multi-statement transaction, so the crew row is
 * a second round trip. A ride whose organizer is not on its own crew renders an
 * RSVP prompt to the person who created it, so the failure is rolled back by
 * hand rather than left. The real fix is a `security definer` function, and it
 * is a migration.
 *
 * **The rollback below stopped being a rollback when this module left the
 * server, and that is a real change rather than a restatement.** As a Server
 * Action, both inserts and the compensating delete ran inside one server request
 * that completed whether or not the tab survived. They run in the browser now,
 * so all three depend on it staying alive and cooperating — closing the tab
 * between the two inserts leaves a club with an owner and no membership row.
 * That state went from *reachable only on a Supabase error* to *reachable on
 * demand*.
 *
 * It is an integrity problem and not a confidentiality one: `019` means the
 * abandoner cannot forge a role on the way through, and `008`'s SELECT policy
 * has an `owner_id = auth.uid()` arm so the creator can still *see* the club —
 * it is `getYourClubs` reading membership that hides it, which makes this a UI
 * orphan rather than a database one. A public one shows on Explore to everyone
 * and is joinable.
 *
 * The fix is the same `security definer` function this comment has named since
 * it was written, doing both inserts in one statement. Nothing asserts "a club
 * has an owner-membership row" as a CHECK or trigger, and that is the actual
 * gap. Logged in docs/reference/known-issues.md §Known issues.
 *
 * `club_id` is offered here for the first time. The column has existed since
 * `001` and no screen has ever set it, which meant a club's Rides sub-page
 * could only ever be empty — a hole the club detail made visible.
 */
export async function createRide(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const rawClub = (formData.get('club_id') as string)?.trim()

  const parsed = rideSchema.safeParse({
    title: formData.get('title'),
    meeting_point: formData.get('meeting_point'),
    route_description: formData.get('route_description'),
    departure_at: formData.get('departure_at'),
    is_public: formData.get('is_public') === 'on',
    club_id: rawClub || null,
    location: readRideLocation(formData),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to create a ride.' }

  // `location` is destructured OUT rather than spread: it is a shape this
  // form invented, not a column, and PostgREST answers `PGRST204` for a key
  // that names no column. `createClub` does the same for the same reason.
  const { departure_at, location, ...rest } = parsed.data

  const { data: ride, error } = await supabase
    .from('rides')
    .insert({
      ...rest,
      ...(location ?? {}),
      // **The zone is known here for a PICKED start and not for a typed one,
      // and that asymmetry is the whole design** (`080`, PD-193). The client
      // holds the picked place's zone at submit, so the instant is resolved
      // against it at the only moment that matters and no correction is ever
      // needed. A typed start has no zone yet — it comes from the geocode, and
      // `resolve-ride-location` is fire-and-forget below — so it resolves
      // against `APP_TIME_ZONE` and `enforce_ride_timezone` shifts it to
      // preserve this wall-clock when the real zone lands.
      //
      // `null` as the stored zone because there is no ride yet to have one.
      departure_at: wallClockToUtc(departure_at, resolveDepartureZone(location, null)),
      organizer_id: user.id,
    })
    .select('id')
    .single()

  // 022 refuses a public ride in a private club. **No longer reachable from the
  // DEFAULT path — the audience checkbox ships clear since PD-320 — but still
  // reachable in one tap**, because the club picker cannot tell a private club
  // from a public one, so a rider who ticks the box has no way to see it coming
  // and the generic message below would leave them with no route to the fix.
  //
  // The flip narrows how often this fires; it does not retire the branch, and
  // deleting it on the strength of the new default would put that rider back in
  // front of "That ride could not be created.".
  //
  // Matched on the message rather than on `23514` alone, because 018's text
  // bounds raise the same SQLSTATE and a title-too-long must not be reported as
  // an audience problem. The string is the one `enforce_ride_club_audience`
  // raises in 022; a named CHECK would read "violates check constraint ..."
  // instead, which is how the two stay distinguishable.
  //
  // **Only "untick", never "pick a public club" (PD-383).** A club-scoped entry
  // hides the picker entirely (`CreateRideForm`'s `seededClub`), so a rider who
  // reached this action from `/rides/new?club=<id>` has no control on screen
  // that could act on the second half of that sentence — an instruction the
  // screen makes impossible is worse than a shorter, always-actionable one.
  if (error?.code === '23514' && error.message.includes('private club cannot be public')) {
    return { error: 'A ride in a private club cannot be public. Untick “Make this ride public”.' }
  }
  if (error || !ride) return { error: 'That ride could not be created.' }

  // ** ONE statement, and the organizer's crew row is the database's to write. **
  // `103`'s `establish_ride_organizer_membership` AFTER INSERT trigger writes
  // `(new.id, new.organizer_id, 'going')` with `joined_at` from the ride's own
  // `created_at`, so the second round trip and its compensating delete are gone.
  // The reasoning is `createClub`'s and is written out there; the short version
  // is that a two-round-trip create has a window the browser can lose the tab
  // in, and the fix is to leave that state unrepresentable rather than narrow.
  //
  // ** The old comment here claimed this left "a club with an owner and no
  // membership row" — a copy-paste from `createClub` that survived review. ** It
  // left a ride whose `organizer_id` held no `ride_members` row, which is the
  // worse half: `toRideListItem` draws the organizer "on the ride by
  // construction" while `getRideCrew` reads `ride_members`, so the card and
  // `/rides/detail/crew` disagreed about the same ride, and `RideAttendanceBar`
  // is hidden from the organizer (`!is_organizer`) so they had no way back on.
  //
  // ** `getRideCrew` is deliberately NOT changed to synthesise the organizer. **
  // After the trigger the rows agree with that reading by construction, and a
  // second copy of the rule in the read path would be free to drift.

  // PD-104 §5.1. This used to read "after the crew row and not before it",
  // because a rollback above deleted the ride and a render already in flight
  // against a deleted ride would spend a ledger row on a ride that no longer
  // exists. **`103` removed that rollback**, so the ordering no longer defends
  // anything — the ride is committed by the time this line runs. Kept here
  // rather than moved, because nothing argues for moving it either.
  //
  // **Unconditional, and it must stay that way — PD-267.** An `if (!location)`
  // guard stood here while the deployed build geocoded unconditionally: against
  // a picked ride that build spent a geocode and two renders, uploaded both
  // JPEGs, and had its column write silently overridden by
  // `protect_picked_ride_location` — succeeding, so its own compensating delete
  // never ran and two objects were orphaned with nothing naming them.
  //
  // The build this merges against skips the geocode for a picked ride and
  // renders from the stored coordinate. **Nothing else invokes this function**,
  // so restoring the guard gives exactly the rides carrying the best
  // coordinates no map at all — silently, with no error and no red gate.
  requestRideMapRender(supabase, ride.id)

  invalidate(queryKeys.rides.all())
  // A ride created into a club appears on that club's Rides sub-page, which
  // `revalidatePath('/rides')` never reached — `/rides/new` only began offering
  // `club_id` on 2026-08-05 and this claim was not extended with it.
  if (rest.club_id) invalidate(queryKeys.clubs.detail(rest.club_id))

  // PD-353's first moment. After the write and after the invalidations, so a
  // throw inside analytics could never cost the rider the ride they just made —
  // `capture` swallows its own errors for the same reason, belt and braces.
  //
  // Booleans only. Whether the ride is public, whether it went into a club and
  // whether a meeting point was set at all — never the club, never the ride,
  // and above all never the place, which `place_search_attempts` refuses to
  // store on the ground that it is frequently a home address.
  capture({
    name: 'ride_created',
    properties: {
      is_public: rest.is_public === true,
      in_club: Boolean(rest.club_id),
      has_meeting_point: Boolean(rest.meeting_point),
    },
  })
  return { error: null, redirectTo: routes.ride(ride.id) }
}

/**
 * Sets — or clears — this rider's RSVP.
 *
 * `null` is `No`, and it **deletes the row** rather than storing a third
 * status. `ride_members.status` is `check (status in ('going','maybe'))`, so
 * "declined" has no representation; the Crew design draws only `Going` and
 * `May be going`, which is the same shape from the other side. The cost is that
 * a decline and a non-answer are indistinguishable, recorded on `RideCrew`.
 *
 * `upsert` rather than insert-or-update, because the row is keyed
 * `(ride_id, user_id)` and a rider double-tapping `Yes!` would otherwise race
 * itself into a 23505.
 *
 * Nothing here checks whether the ride is visible or joinable: 008's INSERT
 * policy delegates both to the rides SELECT policy via EXISTS, so restating
 * them would be a second copy free to drift.
 *
 * **There is no capacity check here, and no cap anywhere** — `077` (PD-293)
 * dropped `rides.max_riders` and `063`'s `enforce_ride_capacity` together.
 * `063` was right about the race it fixed: a check-then-insert loses two
 * riders taking the last seat at once, which is why it was a trigger rather
 * than a branch in front of this upsert. What it could not fix is that the
 * design draws no capacity affordance ANYWHERE — no "Ride is full" state, no
 * seats-remaining count, no disabled pill — so the only way a rider learned a
 * ride was full was to tap Going and read an error. Product owner decision,
 * 2026-08-24: an enforced cap the rider cannot see coming is worse than no cap.
 *
 * **What that leaves unbounded is `ride_members`**, since nothing caps a crew
 * in the database any more. `RIDE_CREW_LIMIT` still caps what the crew rail
 * renders, so no screen breaks. Fine at this scale, and the thing to reopen if
 * one ride ever attracts thousands.
 */
export async function setRideAttendance(
  rideId: string,
  attendance: RideAttendance
): Promise<ActionState> {
  if (!rideId) return { error: 'That ride could not be found.' }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to RSVP.' }

  const { error } =
    attendance === null
      ? await supabase
          .from('ride_members')
          .delete()
          .eq('ride_id', rideId)
          .eq('user_id', user.id)
      : await supabase
          .from('ride_members')
          .upsert(
            { ride_id: rideId, user_id: user.id, status: attendance },
            { onConflict: 'ride_id,user_id' }
          )

  // `103`'s `protect_ride_organizer_membership` refuses the organizer's own crew
  // row. ** Match on the MESSAGE, not on `23514` alone ** — `018`'s text bounds
  // raise the same SQLSTATE, so a code-only branch would tell a rider who
  // overran a field that they organize the ride.
  //
  // Reachable only by a direct call: `RideAttendanceBar` is hidden from the
  // organizer (`!is_organizer`), so no screen offers this today. The invariant
  // is PRESENCE, not status — an organizer may still move themselves to
  // `maybe`, and only the withdrawal (`attendance === null`) is refused.
  if (error?.message?.includes('cannot leave its crew')) {
    return { error: 'You organize this ride, so you are always on its crew. You can set yourself to Maybe instead.' }
  }

  // A refusal is usually RLS deciding the ride is not visible, which from the
  // rider's side looks like the ride being gone rather than a permission
  // problem — so the message says that rather than accusing them.
  if (error) {
    return { error: 'Could not update your RSVP. The ride may no longer be available.' }
  }

  invalidateRide()

  // PD-353's second moment, and only for `going`. `maybe` is not a join — the
  // Crew design draws it as a separate state, and a rider who says maybe has
  // committed to nothing — and `null` is a WITHDRAWAL, which an event firing on
  // every RSVP would count as one more join.
  if (attendance === 'going') capture({ name: 'ride_joined', properties: { via: 'rsvp' } })

  return { error: null, sent: true }
}

/**
 * Saves an organizer's edit to their own ride — PD-101, `ride-lifecycle`.
 *
 * Bound to a specific `rideId` at the call site (`useActionState((prev, fd)
 * => updateRide(ride.id, prev, fd), …)`) rather than reading it out of
 * `formData`: the form has no field for it, the same way `deletePostcard`
 * takes its id as a plain argument rather than a hidden input.
 *
 * **The `.update()` payload is an explicit field list, never a spread of
 * `parsed.data`.** It was once the only thing keeping `created_at` and
 * `organizer_id` out of the statement, because `authenticated` held
 * table-level UPDATE on every column of `rides`.
 *
 * **`045` made that structural** (PD-163, 2026-08-10): UPDATE is granted over
 * these eight columns and no others, so `created_at`, `id` and `organizer_id`
 * are refused with `42501` whatever this function sends. The field list is now
 * belt to the grant's braces rather than the enforcement, which is the right
 * way round — CLAUDE.md's rule is that an integrity claim living only in
 * client code is advisory.
 *
 * Two consequences worth knowing here. **`createRide` above is a spread, not a
 * field list** — its safety comes from Zod stripping unknown keys, not from
 * the payload being written out, so this docstring's guarantee has never
 * covered it. And the `42501` branch below maps *any* insufficient-privilege
 * error to the club message; that is correct for the columns this function
 * actually sends, and would mislead if a field were ever added here without a
 * matching grant.
 */
export async function updateRide(
  rideId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const rawClub = (formData.get('club_id') as string)?.trim()

  const parsed = rideSchema.safeParse({
    title: formData.get('title'),
    meeting_point: formData.get('meeting_point'),
    route_description: formData.get('route_description'),
    departure_at: formData.get('departure_at'),
    is_public: formData.get('is_public') === 'on',
    club_id: rawClub || null,
    location: readRideLocation(formData),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit a ride.' }

  const { departure_at, title, route_description, meeting_point, is_public, club_id, location } =
    parsed.data

  // PD-104 §5.1a. Read fresh rather than taking the paths off `getRideForEdit`'s
  // cached row: the cache can hold a path a later render has already superseded,
  // and deleting the wrong object is worse than deleting none. `updateClub` reads
  // its previous image paths the same way and for the same reason.
  // `is_public, club_id` join this read for PD-338: the audience rule is about
  // the TRANSITION, so it cannot be answered from the submitted payload alone.
  const { data: previous } = await supabase
    .from('rides')
    .select(
      'meeting_point, start_place_id, map_card_path, map_detail_path, timezone, is_public, club_id'
    )
    .eq('id', rideId)
    .maybeSingle()

  // The rule `narrowsToNobody`'s header states, enforced again here for
  // whatever reaches the action without going through `EditRideForm`.
  //
  // **The stored pair comes from this read and never from a form field** — a
  // client that can post the payload can post a claim about the prior shape
  // with it, which would make this copy decorative.
  //
  // **A null `previous` neither refuses nor permits.** The ride is gone, or the
  // caller cannot see it; inventing a refusal would report an audience problem
  // for a ride that does not exist, so this falls through and lets the update
  // match zero rows, which the not-found path already reports.
  if (
    previous &&
    narrowsToNobody(previous, {
      club_id: parsed.data.club_id,
      is_public: parsed.data.is_public,
    })
  ) {
    return { error: RIDE_AUDIENCE_REFUSAL }
  }

  // `IS DISTINCT FROM` is the whole comparison the trigger makes, so this is the
  // same test — a whitespace-only or case-only edit clears the tile, because
  // deciding whether two strings denote the same place is the problem geocoding
  // exists to solve and an over-eager clear costs one render.
  const addressChanged = !!previous && previous.meeting_point !== meeting_point

  // **Whether the rider CLEARED a pick, which is not the same as not having
  // one — and conflating the two destroyed a geocoded ride's location.**
  //
  // `EditRideForm` seeds its pick from the picked arm only, deliberately:
  // re-posting a coordinate a geocoder guessed would relabel it as the rider's
  // own choice. So a *geocoded* ride posts `location = null` on every save,
  // including one that only renames it — and sending NULLs for that is not
  // "the rider cleared it", it is this action inventing an edit nobody made.
  //
  // What that cost, measured on DEV before the fix: a geocoded ride with tiles
  // could not be saved AT ALL — `rides_map_paths_need_a_coordinate` refuses a
  // path over a NULL coordinate, and no branch below matches `23514` with that
  // message, so the organizer got "That ride could not be saved." on every
  // edit, for ever. Without tiles it silently wiped the coordinate instead,
  // and `addressChanged` was false so nothing re-rendered.
  //
  // The row already read above answers it: a pick existed and is not being
  // resupplied, so the rider removed it.
  const pickCleared = !!previous && previous.start_place_id !== null && location === null

  // **A pick REPLACED by a different pick, with the text left identical.**
  // `addressChanged` compares `meeting_point` alone and `pickCleared` requires
  // `location === null`, so swapping pick A for pick B under the same label
  // satisfies neither — while `clear_ride_map_tiles` fires on the `start_place_id`
  // change regardless and NULLs both path columns.
  //
  // Reachable rather than theoretical: `PlaceSearchField` writes the chosen
  // place's name into the meeting-point input and `toPlaceValue` truncates it, so
  // two places whose labels truncate alike collide — as do genuine duplicates in
  // the geocoder's own results. Without this the ride keeps B's coordinate, loses
  // both tiles, orphans the two objects nothing now names, and can never
  // re-render short of an edit that happens to change the text.
  const pickChanged =
    !!previous && location !== null && location.start_place_id !== previous.start_place_id

  // Omitted, not NULLed, when there is nothing to say. An omitted column keeps
  // its value; a NULL erases it, and only one of those is what "the rider did
  // not touch the location" means.
  const locationColumns =
    location !== null
      ? {
          start_place_id: location.start_place_id,
          latitude: location.latitude,
          longitude: location.longitude,
          // A pick carries no vendor score, and `067`'s coupling CHECK refuses
          // a confidence beside one. NULLing it is what makes "the rider chose
          // this" and "a geocoder guessed it" different rows.
          geocode_confidence: null,
          timezone: location.timezone,
        }
      : pickCleared
        ? {
            start_place_id: null,
            latitude: null,
            longitude: null,
            geocode_confidence: null,
            // **`timezone` is deliberately NOT cleared here** (`080` §3). The
            // four columns above are provenance for a POINT; the ride still
            // meets at the place the TEXT names, and that place still has a
            // clock. Clearing it would also pull the zone out from under the
            // `departure_at` this same statement resolved against it — the
            // defect measured on DEV before `080` merged, where a save that
            // changed both the address and the time rendered an hour the rider
            // never typed.
          }
        : {}

  // **AFTER the UPDATE, and only once it is confirmed.** 5.1a asks for the
  // delete first, on the reasoning that the stale-tile trigger NULLs both path
  // columns inside the same statement so afterwards nothing knows the names.
  // That is true of the DATABASE and false of this function, which holds both
  // names in `previous` across the call — so the premise of the ordering does
  // not apply here, and deleting first is strictly worse:
  //
  // this UPDATE can be REFUSED. An organizer who has left the ride's club hits
  // the 42501 below on a save that need not have touched `club_id` at all —
  // the case documented a few lines down as "reachable the moment `leaveClub`
  // runs". Deleting first means both JPEGs are gone, `meeting_point` never
  // changed so the trigger never fired, both path columns still name the
  // deleted objects, and the re-render is gated on the same success that did
  // not happen. Pin fallback for ever, from a save that returned an error.
  //
  // Deleting after a confirmed write costs nothing and fails only into an
  // orphaned object, which is recoverable; the other order fails into a broken
  // row, which is not.
  const { data: ride, error } = await supabase
    .from('rides')
    .update({
      title,
      // **`description` is deliberately absent (PD-320), and its absence is
      // load-bearing rather than tidy-up.** The form no longer renders the
      // field, so `formData.get('description')` would be `null` — which the
      // schema's `optionalText` accepts — and naming the column here would
      // therefore write `null` over an existing description on the next save
      // that touched nothing but the title. Omitting it leaves what riders
      // already wrote, which the ride detail still renders.
      //
      // `045` still grants UPDATE on the column, so this is the client's
      // decision rather than the database's. Anything that ever writes it again
      // needs a field on the form in the same change.
      route_description,
      meeting_point,
      // **The zone the rider was LOOKING at, which is the stored one unless
      // this save carries a new pick** (`080`, PD-193). The edit form renders
      // the departure input as wall-clock in `ride.timezone`, so resolving the
      // string back against that same zone is what makes an untouched field
      // mean an unchanged instant.
      //
      // Read fresh above rather than taken from the form, and the race that
      // looks like a problem is not one: if `resolve-ride-location` landed a
      // zone mid-edit, `enforce_ride_timezone` shifted `departure_at` with it,
      // so the "09:00" on the rider's screen is still 09:00 in the NEW zone and
      // the fresh read is the one that reproduces it.
      //
      // Through `resolveDepartureZone` rather than inline, because
      // `EditRideForm` has to reach the same answer to LABEL the field and a
      // second copy of the rule is how the two drift. Read that function's
      // header before touching either side.
      departure_at: wallClockToUtc(
        departure_at,
        resolveDepartureZone(location, previous?.timezone ?? null)
      ),
      is_public,
      club_id,
      // In the SAME statement as `meeting_point` on purpose: `067`'s
      // `clear_ride_map_tiles` fires on a text change and clears the group, and
      // `protect_picked_ride_location` then restores whatever this statement
      // supplied — which is the whole reason that pair of triggers exists.
      ...locationColumns,
    })
    .eq('id', rideId)
    .select('id')
    .maybeSingle()

  // Same match `createRide` makes, and for the same reason: 022 fires on
  // UPDATE as much as on INSERT, and 018's length CHECKs raise the same
  // SQLSTATE, so the message is matched too rather than the code alone — a
  // title-too-long must not be reported as an audience problem.
  if (error?.code === '23514' && error.message.includes('private club cannot be public')) {
    return { error: 'A ride in a private club cannot be public. Untick “Make this ride public”, or pick a public club.' }
  }

  // The `WITH CHECK`, not the `USING` clause. `USING` passes for this rider —
  // they are still `organizer_id` — but the post-image fails
  // `private.is_club_member(club_id)`, which Postgres reports as an RLS
  // violation rather than a silent zero-row update. This is
  // `ride-lifecycle`'s "ex-member organizer" case: reachable the moment
  // `leaveClub` runs on a club whose ride this rider still organises, on a
  // save that may not have touched `club_id` at all.
  if (error?.code === '42501') {
    return {
      // **Names the STATE, not the act**, because two shipped routes reach it
      // and nothing records which one happened: `leaveClub`, and being ejected
      // by an admin through `removeClubMember` → `public.remove_club_member`
      // (`club_members` carries no admin DELETE policy, so a reader checking
      // policies alone misses the second). Telling an ejected organizer they
      // left is a refusal asserting something they know to be false — the same
      // defect class PD-338 removed from the audience message twelve lines of
      // spec away. `ride-lifecycle`'s ex-member requirement mandates this
      // wording.
      error:
        'You’re no longer a member of this ride’s club, so changes can’t be saved while it stays linked. Delete the ride, or make it public and remove it from the club.',
    }
  }

  if (error) return { error: 'That ride could not be saved.' }
  // Not the ex-member case above (that raises) and not a length violation
  // (that raises too) — zero rows with no error is a non-organizer's write,
  // which `USING` filters out silently rather than refusing loudly.
  if (!ride) return { error: 'That ride is not yours to edit.' }

  // PD-104 §5.1, the second of its two triggers. Only on an address change:
  // the trigger has just NULLed all five columns, so this is what puts a tile
  // back, and a title or time edit has nothing to re-render.
  //
  // The delete rides here rather than before the UPDATE — see the note above.
  // Awaited before the re-render is asked for, so the two cannot race over a
  // path the render is about to reuse.
  // **The LOCATION changed, not just the text.** Clearing the pin without
  // touching the meeting point is a real location change: `clear_ride_map_tiles`
  // fires on the `start_place_id` change and NULLs the coordinate and both
  // paths, so gating the re-render on the text alone left the ride with no map
  // and no route back to one short of editing the address into something
  // different.
  if (addressChanged || pickCleared || pickChanged) {
    await removeRideMapTiles(supabase, [previous!.map_card_path, previous!.map_detail_path])
    // Unconditional, for `createRide`'s reason and with the same warning
    // against reintroducing a pick guard. See the note there.
    requestRideMapRender(supabase, rideId)
  }

  // `rides.all()`, not `rides.detail(rideId)` alone: `club_id` and
  // `is_public` are both editable, and an edit can move the ride between
  // filter segments — narrower invalidation would leave it visible in a list
  // it no longer belongs to.
  invalidate(queryKeys.rides.all())
  // PD-177, and `list()` rather than `all()` on purpose: a notification embeds
  // `ride:rides(id, title)`, so a rename leaves the old title on every
  // `ride_joined` row this organizer holds — but no row appears or vanishes, so
  // the unread count cannot have moved. The audience is unchanged too: the
  // organizer arm of the `rides` SELECT policy (`022`) resolves this row for
  // this rider whatever `club_id` and `is_public` become.
  invalidate(queryKeys.notifications.list())
  return { error: null, redirectTo: routes.ride(rideId) }
}

/**
 * Cancels a ride — PD-101, `ride-lifecycle`. Needs no `security definer`
 * function, unlike a club delete: `ride_members`, `ride_messages` and
 * `notifications.ride_id` all cascade, and `postcards.ride_id` is `SET NULL`
 * on a column that is a tag rather than an audience, so nulling it changes a
 * tagged postcard's visibility by exactly nothing (`design.md` §D2).
 *
 * No `.eq('organizer_id', …)`: the DELETE policy is already
 * `auth.uid() = organizer_id`, and restating it here would be a second copy
 * of a rule RLS owns. `.select()` is what makes a refusal detectable —
 * PostgREST reports no error when a delete matches nothing.
 */
export async function deleteRide(rideId: string): Promise<ActionState> {
  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to do that.' }

  // PD-104 §5.1b. Objects first, then the row that names them — the same
  // ordering the address edit uses, and for a sharper version of the same
  // reason: once the row is gone `051`'s Storage SELECT policy matches nothing,
  // so no rider but the organizer can even *see* the object to delete it.
  //
  // The `organizer_id` test is not a re-filter of RLS. The `rides` SELECT policy
  // deliberately admits crew, club members and any signed-in rider on a public
  // ride, and the Storage DELETE policy is own-folder only — so a non-organizer
  // reaching here would issue a `remove()` that is guaranteed to be refused.
  // This skips a doomed round trip; it decides nothing.
  const { data: existing } = await supabase
    .from('rides')
    .select('organizer_id, map_card_path, map_detail_path')
    .eq('id', rideId)
    .maybeSingle()

  if (existing?.organizer_id === user.id) {
    await removeRideMapTiles(supabase, [existing.map_card_path, existing.map_detail_path])
  }

  const { data: deleted, error } = await supabase
    .from('rides')
    .delete()
    .eq('id', rideId)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Could not cancel that ride. Try again.' }
  if (!deleted) return { error: 'That ride is not yours to cancel.' }

  invalidate(queryKeys.rides.all())
  // postcards.ride_id is SET NULL by the cascade, so any postcard tagged to
  // this ride has changed even though this call never named one.
  invalidate(queryKeys.postcards.all())
  // PD-177. `notifications.ride_id` cascades (`036` §1), so every `ride_joined`
  // this organizer received for this ride is gone — a row leaving the list and
  // the unread count with it, which is why this is `all()` and `updateRide`'s
  // is `list()`.
  invalidate(queryKeys.notifications.all())
  return { error: null }
}
