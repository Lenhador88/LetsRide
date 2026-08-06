'use client'

import { useActionState, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { createRide } from '@/lib/actions/rides'
import { useActionRedirect } from '@/lib/actions/navigate'
import { emptyActionState } from '@/lib/actions/state'
import { APP_TIME_ZONE } from '@/lib/utils'
import {
  RIDE_DESCRIPTION_MAX,
  RIDE_MEETING_POINT_MAX,
  RIDE_ROUTE_MAX,
  RIDE_TITLE_MAX,
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
 * - **"Public seats"** as a number distinct from `max_riders` — and `max_riders`
 *   itself has never been enforced by anything since `001`.
 * - **A cover photo** ("Add photo"). `rides` has no image column; the list's
 *   80-wide strip is empty for the same reason.
 * - **Rider invitations** with an Admin role, the same unbuilt feature the
 *   Create club frame draws.
 *
 * What it *does* add beyond v1 is `club_id`. The column has existed since `001`
 * and no screen has ever set it, so a club's Rides sub-page could only ever be
 * empty — a hole the club detail made visible.
 */
export function CreateRideForm({ clubs }: { clubs: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createRide, emptyActionState)
  useActionRedirect(state)
  const formRef = useRef<HTMLFormElement>(null)
  const [ready, setReady] = useState(false)

  // Mirrors the `required` attributes below rather than adding a new rule —
  // rideSchema already refuses an empty title, meeting point or departure with
  // `.min(1, …)`. Without this, a rider who taps "Create ride" on an empty form
  // meets the browser's own "Please fill out this field" bubble: unstyleable,
  // positioned by the OS rather than the design, and the kind of native chrome
  // that renders inconsistently inside a webview. Disabling the submit control
  // makes that implicit-submission path unreachable instead.
  function updateReady() {
    const form = formRef.current
    if (!form) return
    const data = new FormData(form)
    const filled = (field: string) => String(data.get(field) ?? '').trim().length > 0
    setReady(filled('title') && filled('meeting_point') && filled('departure_at'))
  }

  return (
    <form ref={formRef} action={formAction} onChange={updateReady} className="flex flex-col gap-4">
      <Input name="title" label="Title" required maxLength={RIDE_TITLE_MAX} />

      <Textarea name="description" label="Description" rows={3} maxLength={RIDE_DESCRIPTION_MAX} />

      <Input
        name="meeting_point"
        label="Starting location"
        required
        maxLength={RIDE_MEETING_POINT_MAX}
      />

      <div className="flex flex-col gap-1.5">
        {/*
          `datetime-local` sends a zone-less string, which the action resolves as
          wall-clock in APP_TIME_ZONE — see wallClockToUtc. Sending an ISO string
          from here instead would put the browser's zone into the write, which is
          the write-side half of the bug #37 fixed on the read side.
        */}
        <Input name="departure_at" type="datetime-local" label="Departure" required />
        {/* One template literal rather than text interleaved with {expr}: JSX
            drops whitespace at a line boundary, so the moment a formatter wraps
            the mixed form it renders "Amsterdamtime" with no gap — observed
            here, and invisible in the source that causes it. */}
        <p className="px-1 text-xs text-muted">
          {`Times are in ${DEPARTURE_ZONE_LABEL} time, whatever zone you're riding in.`}
        </p>
      </div>

      <Textarea name="route_description" label="Route" rows={2} maxLength={RIDE_ROUTE_MAX} />

      <Input
        name="max_riders"
        type="number"
        inputMode="numeric"
        min={1}
        max={999}
        label="Maximum riders"
        placeholder="Leave blank for no limit"
      />

      {clubs.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted">Club</span>
          {/* A plain select: there is no v2 select in the library, and adding
              one to serve a single unbuilt screen would be inventing a
              component the design has not drawn. It inherits the Input
              treatment so it does not read as a different system. */}
          <select
            name="club_id"
            defaultValue=""
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
        <Checkbox name="is_public" label="Make this ride public" defaultChecked />
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

      <Button type="submit" size="lg" loading={pending} disabled={!ready}>
        {ready ? 'Create ride' : 'Fill in the required fields'}
      </Button>
    </form>
  )
}
