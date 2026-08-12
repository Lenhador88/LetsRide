import { resolveSupabase, type DataClient } from '@/lib/supabase/resolve'
import { invalidate } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { MEDIA_BUCKET } from '@/lib/media/constants'
import { routes } from '@/lib/routes'
import { rideSchema } from '@/lib/validation/rides'
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
      // Swallowed on purpose. The function is not deployed yet (task 8.3 is an
      // owner action), so today every one of these is a 404 — and that must look
      // exactly like the vendor being down, which is to say like nothing at all.
    })
}

/**
 * Removes a ride's tile objects, best-effort.
 *
 * **Always called BEFORE the statement that stops naming them** — `051`'s
 * stale-tile trigger NULLs both path columns in the same UPDATE that changes
 * `meeting_point`, and the ride row is the only place those names were ever
 * recorded. Afterwards nothing knows them. Same ordering the ride-delete path
 * uses: objects first, then the row that names them.
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
 * gap. Logged in docs/HANDOFF.md §Known issues.
 *
 * `club_id` is offered here for the first time. The column has existed since
 * `001` and no screen has ever set it, which meant a club's Rides sub-page
 * could only ever be empty — a hole the club detail made visible.
 */
export async function createRide(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const rawMax = (formData.get('max_riders') as string)?.trim()
  const rawClub = (formData.get('club_id') as string)?.trim()

  const parsed = rideSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    meeting_point: formData.get('meeting_point'),
    route_description: formData.get('route_description'),
    departure_at: formData.get('departure_at'),
    max_riders: rawMax ? Number(rawMax) : null,
    is_public: formData.get('is_public') === 'on',
    club_id: rawClub || null,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to create a ride.' }

  const { departure_at, ...rest } = parsed.data

  const { data: ride, error } = await supabase
    .from('rides')
    .insert({
      ...rest,
      departure_at: wallClockToUtc(departure_at),
      organizer_id: user.id,
    })
    .select('id')
    .single()

  // 022 refuses a public ride in a private club. Reachable from the default
  // path — the audience checkbox ships ticked and the club picker cannot tell a
  // private club from a public one — so the generic message below would leave
  // the rider with no route to the fix.
  //
  // Matched on the message rather than on `23514` alone, because 018's text
  // bounds raise the same SQLSTATE and a title-too-long must not be reported as
  // an audience problem. The string is the one `enforce_ride_club_audience`
  // raises in 022; a named CHECK would read "violates check constraint ..."
  // instead, which is how the two stay distinguishable.
  if (error?.code === '23514' && error.message.includes('private club cannot be public')) {
    return { error: 'A ride in a private club cannot be public. Untick “Make this ride public”, or pick a public club.' }
  }
  if (error || !ride) return { error: 'That ride could not be created.' }

  const { error: crewError } = await supabase
    .from('ride_members')
    .insert({ ride_id: ride.id, user_id: user.id, status: 'going' })

  if (crewError) {
    // Same as createClub: an unchecked rollback lets the failure message
    // contradict the state it leaves behind.
    const { error: rollbackError } = await supabase.from('rides').delete().eq('id', ride.id)
    if (rollbackError) {
      return {
        error: 'That ride was only partly created. Check your rides before trying again.',
      }
    }
    return { error: 'That ride could not be created.' }
  }

  // PD-104 §5.1. After the crew row and not before it: a rollback above deletes
  // the ride, and a render already in flight against a deleted ride would spend
  // a ledger row on a ride that no longer exists.
  requestRideMapRender(supabase, ride.id)

  invalidate(queryKeys.rides.all())
  // A ride created into a club appears on that club's Rides sub-page, which
  // `revalidatePath('/rides')` never reached — `/rides/new` only began offering
  // `club_id` on 2026-08-05 and this claim was not extended with it.
  if (rest.club_id) invalidate(queryKeys.clubs.detail(rest.club_id))
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
 * **`max_riders` is not enforced, here or anywhere.** The column has existed
 * since 001 and nothing has ever checked it — not this action, not a policy,
 * not a trigger — so a ride can be over-subscribed. It is out of scope here
 * because the ride plan design does not draw capacity at all, and because the
 * correct place for it is a constraint the database owns rather than a
 * check-then-insert in application code, which races. Logged in
 * docs/FIGMA-FIDELITY-TODO.md §Ride detail rather than silently inherited.
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

  // A refusal is usually RLS deciding the ride is not visible, which from the
  // rider's side looks like the ride being gone rather than a permission
  // problem — so the message says that rather than accusing them.
  if (error) {
    return { error: 'Could not update your RSVP. The ride may no longer be available.' }
  }

  invalidateRide()
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
  const rawMax = (formData.get('max_riders') as string)?.trim()
  const rawClub = (formData.get('club_id') as string)?.trim()

  const parsed = rideSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    meeting_point: formData.get('meeting_point'),
    route_description: formData.get('route_description'),
    departure_at: formData.get('departure_at'),
    max_riders: rawMax ? Number(rawMax) : null,
    is_public: formData.get('is_public') === 'on',
    club_id: rawClub || null,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  // The zombie shape `029` names: neither public nor in a club is a ride only
  // its organizer could ever see again, with `ride_members` rows still
  // attached to it. `EditRideForm` disables Save on this combination already;
  // this is the guard for whatever reaches the action anyway.
  if (!parsed.data.club_id && !parsed.data.is_public) {
    return {
      error:
        'A ride needs to be public or belong to a club, or nobody but you could ever see it again. Make it public, or pick a club.',
    }
  }

  const supabase = await resolveSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Sign in to edit a ride.' }

  const { departure_at, title, description, route_description, meeting_point, max_riders, is_public, club_id } =
    parsed.data

  // PD-104 §5.1a. Read fresh rather than taking the paths off `getRideForEdit`'s
  // cached row: the cache can hold a path a later render has already superseded,
  // and deleting the wrong object is worse than deleting none. `updateClub` reads
  // its previous image paths the same way and for the same reason.
  const { data: previous } = await supabase
    .from('rides')
    .select('meeting_point, map_card_path, map_detail_path')
    .eq('id', rideId)
    .maybeSingle()

  // `IS DISTINCT FROM` is the whole comparison the trigger makes, so this is the
  // same test — a whitespace-only or case-only edit clears the tile, because
  // deciding whether two strings denote the same place is the problem geocoding
  // exists to solve and an over-eager clear costs one render.
  const addressChanged = !!previous && previous.meeting_point !== meeting_point

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
      description,
      route_description,
      meeting_point,
      departure_at: wallClockToUtc(departure_at),
      max_riders,
      is_public,
      club_id,
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
      error:
        'You’ve left this ride’s club, so changes can’t be saved while it stays linked. Delete the ride, or make it public and remove it from the club.',
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
  if (addressChanged) {
    await removeRideMapTiles(supabase, [previous!.map_card_path, previous!.map_detail_path])
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
