'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { DeleteRideControl } from '@/components/rides/DeleteRideControl'
import { updateRide } from '@/lib/actions/rides'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState, type ActionState } from '@/lib/actions/state'
import { useRestoreChecked, useRestoreSelection } from '@/lib/actions/retain'
import { APP_TIME_ZONE, formatRideDepartureInput } from '@/lib/utils'
import {
  RIDE_DESCRIPTION_MAX,
  RIDE_MEETING_POINT_MAX,
  RIDE_ROUTE_MAX,
  RIDE_TITLE_MAX,
  rideSchema,
} from '@/lib/validation/rides'
import type { RideForEdit } from '@/types'

const DEPARTURE_ZONE_LABEL = APP_TIME_ZONE.split('/').pop()?.replace(/_/g, ' ') ?? APP_TIME_ZONE

/**
 * `/rides/detail/edit` — PD-101. Composition-is-ours for the same reason
 * `CreateRideForm`'s is (that component's header has the full argument); this
 * shares its field set exactly, per `design.md` §D5.
 *
 * **Controlled, unlike the create forms, and that is a deliberate departure.**
 * `EditProfileForm`'s own header documents the trap: React resets an
 * uncontrolled field to its `defaultValue` the moment a `useActionState`
 * action settles, error or not, because nothing was thrown. On a *create*
 * form that reverts an empty field to empty — a papercut, recorded and left
 * there. On an *edit* form it would revert a rejected edit to the ride's OLD
 * value, silently discarding what the organizer just typed, which is exactly
 * what `ride-lifecycle`'s "SHALL keep the entered values" requirement rules
 * out. Controlled state sidesteps the reset instead of accepting it.
 *
 * `clubs`:
 * - an array — the organizer's own clubs loaded fine.
 * - `null` — the read failed; the picker renders disabled, showing the ride's
 *   own club rather than an empty list a save could turn into a real detach.
 * - `undefined` — still loading; treated the same as an empty array, because
 *   the ride itself must never gate on a read it does not need to render.
 */
export function EditRideForm({
  ride,
  clubs,
}: {
  ride: RideForEdit
  clubs: { id: string; name: string }[] | null | undefined
}) {
  const boundUpdateRide = useCallback(
    (prev: ActionState, formData: FormData) => updateRide(ride.id, prev, formData),
    [ride.id]
  )
  const [state, formAction, pending] = useActionState(boundUpdateRide, emptyActionState)
  useActionRedirect(state)

  const [title, setTitle] = useState(ride.title)
  const [description, setDescription] = useState(ride.description ?? '')
  const [meetingPoint, setMeetingPoint] = useState(ride.meeting_point)
  const [routeDescription, setRouteDescription] = useState(ride.route_description ?? '')
  const [departureAt, setDepartureAt] = useState(formatRideDepartureInput(ride.departure_at))
  const [maxRiders, setMaxRiders] = useState(
    ride.max_riders !== null ? String(ride.max_riders) : ''
  )
  const [isPublic, setIsPublic] = useState(ride.is_public)
  const [clubId, setClubId] = useState(ride.club_id ?? '')
  // **Controlled is not enough for either of these, and here it costs data
  // rather than typing.** React's post-action `form.reset()` puts the select
  // back on its first option — always "No club" — and the checkbox back on its
  // mount-time value, with no re-render to carry the real ones back. And
  // `updateRide` builds `club_id` and `is_public` from `FormData`, not from this
  // state, so the retry after any refusal silently detaches the ride from its
  // club and re-publishes it, and succeeds. Both measured by the walk's
  // `refused edit` phase — see lib/actions/retain.ts.
  const clubRef = useRef<HTMLSelectElement>(null)
  const publicRef = useRef<HTMLInputElement>(null)
  useRestoreSelection(clubRef, clubId, state)
  useRestoreChecked(publicRef, isPublic, state)

  // Moves focus to the schema-rejected field on error, off the same
  // `rideSchema` the action parses — reading controlled state directly rather
  // than a submitted-FormData snapshot, which the create forms need and this
  // one does not because nothing here resets out from under it.
  useEffect(() => {
    if (!state.error) return
    const rawMax = maxRiders.trim()
    const parsed = rideSchema.safeParse({
      title,
      description,
      meeting_point: meetingPoint,
      route_description: routeDescription,
      departure_at: departureAt,
      max_riders: rawMax ? Number(rawMax) : null,
      is_public: isPublic,
      club_id: clubId || null,
    })
    const field = parsed.success ? undefined : parsed.error.issues[0]?.path[0]
    if (typeof field === 'string') {
      document.getElementsByName(field)[0]?.focus()
    }
    // Only on a fresh error — not on every keystroke that follows one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const clubsUnavailable = clubs === null
  const knownClubs = clubs ?? []
  // The ride's own club can be absent from the organizer's own list two ways:
  // they left it (ride-lifecycle's ex-member case), or the read is still
  // loading. Either way it must stay a selectable, named option — dropping it
  // would make a save that touches nothing else silently detach the ride.
  const currentClubOption =
    clubId && !knownClubs.some((club) => club.id === clubId)
      ? { id: clubId, name: ride.club?.name ?? 'Current club' }
      : null
  const clubOptions = currentClubOption ? [currentClubOption, ...knownClubs] : knownClubs

  // The zombie shape ride-lifecycle names: neither public nor in a club is a
  // ride only the organizer could ever see again, with ride_members rows
  // still attached. Checked live so Save is refused before a round trip,
  // matching updateRide's own guard for whatever reaches the action anyway.
  const wouldStrand = !clubId && !isPublic

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <Input
          name="title"
          label="Title"
          required
          maxLength={RIDE_TITLE_MAX}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <Textarea
          name="description"
          label="Description"
          rows={3}
          maxLength={RIDE_DESCRIPTION_MAX}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <Input
          name="meeting_point"
          label="Starting location"
          required
          maxLength={RIDE_MEETING_POINT_MAX}
          value={meetingPoint}
          onChange={(event) => setMeetingPoint(event.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <Input
            name="departure_at"
            type="datetime-local"
            label="Departure"
            required
            value={departureAt}
            onChange={(event) => setDepartureAt(event.target.value)}
          />
          <p className="px-1 text-xs text-muted">
            {`Times are in ${DEPARTURE_ZONE_LABEL} time, whatever zone you're riding in.`}
          </p>
        </div>

        <Textarea
          name="route_description"
          label="Route"
          rows={2}
          maxLength={RIDE_ROUTE_MAX}
          value={routeDescription}
          onChange={(event) => setRouteDescription(event.target.value)}
        />

        <Input
          name="max_riders"
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          label="Maximum riders"
          placeholder="Leave blank for no limit"
          value={maxRiders}
          onChange={(event) => setMaxRiders(event.target.value)}
        />

        {clubsUnavailable ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">Club</span>
            <div className="flex h-12 items-center rounded-lg border-2 border-border-strong bg-surface px-4 text-base text-muted">
              {ride.club?.name ?? (clubId ? 'Current club' : 'No club')}
            </div>
            <input type="hidden" name="club_id" value={clubId} />
            <p className="px-1 text-xs text-muted">
              Your clubs could not be loaded, so this can’t be changed right now.
            </p>
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted">Club</span>
            <select
              ref={clubRef}
              name="club_id"
              value={clubId}
              onChange={(event) => setClubId(event.target.value)}
              className="h-12 rounded-lg border-2 border-border-strong bg-surface px-4 text-base text-foreground"
            >
              <option value="">No club</option>
              {clubOptions.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-col gap-1">
          <Checkbox
            ref={publicRef}
            name="is_public"
            label="Make this ride public"
            checked={isPublic}
            onChange={(event) => setIsPublic(event.target.checked)}
          />
          <p className="pl-8 text-xs font-medium text-muted">
            Anyone signed in can see and join a public ride. A private ride is visible to its
            club, or to you alone if it has no club.
          </p>
        </div>

        {wouldStrand && (
          <p role="alert" className="text-sm text-danger">
            A ride needs to be public or belong to a club, or nobody but you could see it. Make it
            public, or pick a club.
          </p>
        )}

        {state.error && (
          <p role="status" aria-live="polite" className="text-sm text-danger">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" loading={pending} disabled={wouldStrand}>
          Save changes
        </Button>
      </form>

      <DeleteRideControl rideId={ride.id} />
    </div>
  )
}
