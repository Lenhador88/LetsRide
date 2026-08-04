'use client'

import { useState, useTransition } from 'react'
import { ButtonGroup } from '@/components/ui/ButtonGroup'
import { setRideAttendance } from '@/lib/actions/rides'
import { cn } from '@/lib/utils'
import type { RideAttendance } from '@/types'

/** `No` has no stored status — it clears the row. See lib/actions/rides.ts. */
const OPTIONS = [
  { value: 'going' as const, label: 'Yes!' },
  { value: 'maybe' as const, label: 'Maybe...' },
  { value: 'no' as const, label: 'No' },
]

type Choice = (typeof OPTIONS)[number]['value']

const toChoice = (attendance: RideAttendance): Choice | null =>
  attendance === null ? null : attendance

/**
 * `Content / Ride Details / Join Ride Selector` — the sticky bar above the nav
 * bar. Measured: 96 tall, padding 16/16/8, 12px gap, centred prompt, and the
 * button group is 358×40.
 *
 * Optimistic by hand rather than via `useOptimistic`: the value has to survive
 * the server round trip *and* stay put afterwards, since the action revalidates
 * and re-renders this component with the new prop. `useOptimistic` would be the
 * right tool if this were inside a form action; it is a three-way toggle with no
 * form, so a plain state seeded from the prop is less machinery for the same
 * result.
 *
 * On failure it rolls back to what the server last told us and shows why — a
 * silent revert would read as the tap not registering.
 */
export function RideAttendanceBar({
  rideId,
  attendance,
}: {
  rideId: string
  attendance: RideAttendance
}) {
  const [choice, setChoice] = useState<Choice | null>(toChoice(attendance))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onChange(next: Choice) {
    const previous = choice
    setChoice(next)
    setError(null)

    startTransition(async () => {
      const result = await setRideAttendance(rideId, next === 'no' ? null : next)
      if (result.error) {
        setChoice(previous)
        setError(result.error)
      }
    })
  }

  // Sits ON TOP of the nav bar, not inside its action slot — see the
  // `.bottom-navbar` note in globals.css. z-40 keeps it under the bar's z-50 so
  // the tabs stay reachable if the two ever overlap.
  return (
    <div className="bottom-navbar fixed right-0 left-0 z-40 border-t border-border bg-background px-4 pt-4 pb-2">
      <div className="mx-auto flex max-w-lg flex-col gap-3">
        <p
          className={cn(
            'text-center text-sm font-semibold',
            error ? 'text-danger' : 'text-foreground'
          )}
          // Unconditional, not `error ? 'status' : undefined`. A live region
          // created in the same commit as the text it should announce is the
          // one case assistive tech reliably misses — the region has to exist
          // *before* the content changes. Otherwise a failed RSVP rolls the
          // pill back and says nothing.
          role="status"
        >
          {error ?? 'Are you going?'}
        </p>
        <ButtonGroup
          label="Are you going?"
          options={OPTIONS}
          value={choice}
          onChange={onChange}
          disabled={pending}
        />
      </div>
    </div>
  )
}
