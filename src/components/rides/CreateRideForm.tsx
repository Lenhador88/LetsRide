'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { PlaceSearchField, type PlaceValue } from '@/components/ui/PlaceSearchField'
import { Textarea } from '@/components/ui/Textarea'
import { createRide } from '@/lib/actions/rides'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { retaining, seedRetained, useRestoreSelection, wasChecked } from '@/lib/actions/retain'
import { APP_TIME_ZONE, defaultRideDepartureInput } from '@/lib/utils'
import {
  RIDE_DESCRIPTION_MAX,
  RIDE_LOCATION_FIELD_NAMES,
  RIDE_MEETING_POINT_MAX,
  RIDE_ROUTE_MAX,
  RIDE_TITLE_MAX,
  readRideLocation,
  rideSchema,
} from '@/lib/validation/rides'

// "Europe/Amsterdam" -> "Amsterdam", so the hint can never name a different
// city than the zone `wallClockToUtc` actually resolves against.
const DEPARTURE_ZONE_LABEL = APP_TIME_ZONE.split('/').pop()?.replace(/_/g, ' ') ?? APP_TIME_ZONE

/**
 * `Create ride`.
 *
 * **The composition is ours**, for the same reason `CreateClubForm`'s is: the
 * design's frame (`1918:15850`) is drawn entirely in the OLD stylesheet — 58
 * `Grey (OLD)/*` references — and its epic cover reads **To do**. This applies
 * the settled v2 primitives to the columns `001` actually has, rather than
 * inventing a v2 layout and presenting it as measured.
 *
 * Five things the v1 frame draws that are **not** built, all for the same
 * reason — the schema has no column and the epic is not designed:
 *
 * - **An end time.** The frame draws a second date and time; `rides` has
 *   `departure_at` and nothing else. The ride detail draws only a start too.
 * - **Distance in km** and **"Includes offroad"**, neither of which exists.
 * - **"Public seats"** as a number distinct from `max_riders`. `max_riders`
 *   itself is real and, since `063`, enforced — what has no column is a
 *   *second* number beside it.
 * - **A cover photo** ("Add photo"). `rides` has no image column; the list's
 *   80-wide strip is empty for the same reason.
 * - **Rider invitations** with an Admin role, the same unbuilt feature the
 *   Create club frame draws.
 *
 * What it *does* add beyond v1 is `club_id`. The column has existed since `001`
 * and no screen has ever set it, so a club's Rides sub-page could only ever be
 * empty — a hole the club detail made visible.
 */
// Every field on the form. This is the screen with the most to lose: seven
// answers and two defaults, all of which React's post-action `form.reset()`
// used to erase on any refusal. See lib/actions/retain.ts.
const RIDE_FIELDS = [
  'title',
  'description',
  'meeting_point',
  'departure_at',
  'route_description',
  'max_riders',
  'is_public',
] as const

const retainRide = retaining(createRide, RIDE_FIELDS)
const initialState = seedRetained(emptyActionState)

export function CreateRideForm({ clubs }: { clubs: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(retainRide, initialState)
  // **A `<select>` is the one control `retaining` cannot serve, and it is
  // controlled for that reason rather than by preference.** `defaultValue` on a
  // select sets `option.selected`; `form.reset()` restores each option from its
  // `defaultSelected` — the `selected` *attribute* — which React never writes.
  // So the reset drops the choice back to the first option however carefully the
  // submitted value is fed back. Measured by the walk's own retention phase:
  // every other field on this form passed while this one read "".
  //
  // Component state has no such problem, and none of the autofill exposure that
  // makes a controlled *text* input the wrong fix (see lib/actions/retain.ts):
  // the reset touches the DOM, not React, and no password manager fills a club
  // picker.
  const [clubId, setClubId] = useState('')
  // The meeting point is controlled now that it shares a field with the place
  // picker, so it survives a refused submit the way `CreateClubForm`'s name and
  // location do — component state, not `retaining`. `retaining` restores a
  // string into an uncontrolled `defaultValue`, which a controlled input
  // ignores, so `RIDE_FIELDS` keeping `meeting_point` is belt to this braces
  // rather than the mechanism. The action returns its error without
  // navigating, so nothing here unmounts.
  const [meetingPoint, setMeetingPoint] = useState('')
  const [startPlace, setStartPlace] = useState<PlaceValue | null>(null)
  const clubRef = useRef<HTMLSelectElement>(null)
  useRestoreSelection(clubRef, clubId, state)
  useActionRedirect(state)
  const formRef = useRef<HTMLFormElement>(null)
  // What was actually on the form at submission, not what is on it now. React
  // resets every uncontrolled field to its `defaultValue` (here, empty) once a
  // form action settles — including on an error return, since nothing was
  // thrown — so re-reading the live DOM in the effect below would find an
  // empty form regardless of what was actually submitted.
  const submittedData = useRef<FormData | null>(null)

  // Seed the departure with tomorrow 10:00 (PD-197). **In an effect and onto
  // the DOM node, rather than as a `defaultValue`** — `/rides/new` is
  // prerendered at build time, so computing "tomorrow" during render would bake
  // the build date into the static HTML and every rider would open the form on
  // a default as stale as the deploy. `defaultRideDepartureInput` carries the
  // rest, including why tomorrow is Amsterdam's rather than the rider's.
  //
  // Guarded on the field being empty, and mount-only, so it can never overwrite
  // what the rider typed: after a refused submit React restores every
  // uncontrolled field to its `defaultValue`, which `retaining` has already set
  // to the submitted value.
  useEffect(() => {
    const el = formRef.current?.elements.namedItem('departure_at')
    if (el instanceof HTMLInputElement && !el.value) el.value = defaultRideDepartureInput()
  }, [])

  // A disabled submit was tried here first and reverted by review: it left the
  // control out of the tab order on first paint of an untouched form (WCAG
  // 1.4.3's inactive-control exemption covers a *transient* disabled state, not
  // a resting one), and its label named no field. `noValidate` below turns off
  // the browser's own bubble — same reason, still unstyleable and inconsistent
  // in a webview — so this effect replaces what that bubble did for free:
  // moving focus to the field the rider needs to fix. It re-parses the same
  // `rideSchema` the action itself does, from the same FormData shape
  // (`lib/actions/rides.ts`'s `rawMax`/`rawClub` handling), so the field this
  // focuses and the message `state.error` shows below can never name two
  // different fields — both come from one parse of one schema.
  useEffect(() => {
    if (!state.error) return
    const data = submittedData.current
    const form = formRef.current
    if (!data || !form) return
    const rawMax = (data.get('max_riders') as string)?.trim()
    const rawClub = (data.get('club_id') as string)?.trim()
    const parsed = rideSchema.safeParse({
      title: data.get('title'),
      description: data.get('description'),
      meeting_point: data.get('meeting_point'),
      route_description: data.get('route_description'),
      departure_at: data.get('departure_at'),
      max_riders: rawMax ? Number(rawMax) : null,
      is_public: data.get('is_public') === 'on',
      club_id: rawClub || null,
      location: readRideLocation(data),
    })
    const field = parsed.success ? undefined : parsed.error.issues[0]?.path[0]
    if (typeof field === 'string') {
      const el = form.elements.namedItem(field)
      if (el instanceof HTMLElement) el.focus()
    }
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        submittedData.current = new FormData(event.currentTarget)
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <Input
        name="title"
        label="Title"
        required
        maxLength={RIDE_TITLE_MAX}
        defaultValue={state.retained.title}
      />

      <Textarea
        name="description"
        label="Description"
        rows={3}
        maxLength={RIDE_DESCRIPTION_MAX}
        defaultValue={state.retained.description}
      />

      {/* Free text with search on top, never search instead of free text —
          "the layby past the second roundabout" is a real meeting point and a
          picker that refuses it is worse than the bare field it replaced.
          Picking is the fast path; typing throws the pin away. */}
      <div className="flex flex-col gap-1.5">
        <PlaceSearchField
          label="Starting location"
          sheetTitle="Set start location"
          value={startPlace}
          onChange={setStartPlace}
          names={RIDE_LOCATION_FIELD_NAMES}
          maxNameLength={RIDE_MEETING_POINT_MAX}
          freeText={{ text: meetingPoint, onTextChange: setMeetingPoint, required: true }}
          disabled={pending}
        />
        {/* place-search's own requirement: a ride SHALL remain creatable while
            lookup is unavailable, and nothing on screen said a typed meeting
            point was fine before this line. */}
        <p className="px-1 text-xs text-muted">
          Typing a meeting point is fine — search just adds a map and a pin.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {/*
          `datetime-local` sends a zone-less string, which the action resolves as
          wall-clock in APP_TIME_ZONE — see wallClockToUtc. Sending an ISO string
          from here instead would put the browser's zone into the write, which is
          the write-side half of the bug #37 fixed on the read side.
        */}
        <Input
          name="departure_at"
          type="datetime-local"
          label="Departure"
          required
          defaultValue={state.retained.departure_at}
        />
        {/* One template literal rather than text interleaved with {expr}. JSX
            drops whitespace at a line boundary, so if a formatter ever wraps
            the expression onto its own line the hint renders "Amsterdamtime"
            with no gap — a defect invisible in the source that causes it.
            The mixed form is *not* broken today, at this line width: the
            identical shape on /auth/signup renders its space correctly. This
            is the cheaper of two ways to write the same string, not a fix for
            a live bug. */}
        <p className="px-1 text-xs text-muted">
          {`Times are in ${DEPARTURE_ZONE_LABEL} time, whatever zone you're riding in.`}
        </p>
      </div>

      <Textarea
        name="route_description"
        label="Route"
        rows={2}
        maxLength={RIDE_ROUTE_MAX}
        defaultValue={state.retained.route_description}
      />

      <Input
        name="max_riders"
        type="number"
        inputMode="numeric"
        min={1}
        max={999}
        label="Maximum riders"
        placeholder="Leave blank for no limit"
        defaultValue={state.retained.max_riders}
      />

      {clubs.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted">Club</span>
          {/* A plain select: there is no v2 select in the library, and adding
              one to serve a single unbuilt screen would be inventing a
              component the design has not drawn. It inherits the Input
              treatment so it does not read as a different system. */}
          <select
            ref={clubRef}
            name="club_id"
            value={clubId}
            onChange={(event) => setClubId(event.target.value)}
            className="h-12 rounded-lg border-2 border-border-strong bg-surface px-4 text-base text-foreground"
          >
            <option value="">No club</option>
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Public by default, matching 001's column default and the v1 form. */}
      <div className="flex flex-col gap-1">
        {/* `wasChecked` and not `defaultChecked` alone: an unticked box sends
            nothing, so restoring the literal default would silently re-publish
            a ride the rider had just made private. */}
        <Checkbox
          name="is_public"
          label="Make this ride public"
          defaultChecked={wasChecked(state.retained, 'is_public', true)}
        />
        <p className="pl-8 text-xs font-medium text-muted">
          Anyone signed in can see and join a public ride. A private ride is visible to its club,
          or to you alone if it has no club.
        </p>
      </div>

      {state.error && (
        <p role="status" aria-live="polite" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" loading={pending}>
        Create ride
      </Button>
    </form>
  )
}
