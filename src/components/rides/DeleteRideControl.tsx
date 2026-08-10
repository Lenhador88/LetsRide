'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { deleteRide } from '@/lib/actions/rides'
import { getRideCrew } from '@/lib/data/rides'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * The destructive control at the foot of `/rides/[id]/edit` — PD-101,
 * `design.md` §D4. Deliberately not in `RidePageMenu`: that is the header's
 * sub-page switcher, and an irreversible action does not belong one tap from
 * `Crew` on a glove-sized target. `PostcardMenu`'s two-tap shape is the
 * precedent for the confirmation; this one needs room for the crew count and
 * the chat warning `ride-lifecycle` requires, so it is a panel rather than a
 * context-menu row.
 *
 * Crew count is read only once the rider taps through to the confirmation —
 * `confirming ? queryKeys.rides.crew(rideId) : null` — because most visits to
 * this screen never reach it, and the ride plan page has usually already
 * warmed this exact key anyway.
 *
 * **Invalidate-then-navigate, not the reverse.** `deleteRide` invalidates
 * `rides.all()` before this component ever sees the result, which would
 * refetch this still-mounted screen's own `rides.edit(rideId)` key — but that
 * key resolves to `null` only once the async refetch's response lands, and
 * `router.replace` below runs synchronously the instant the awaited call
 * settles, long before a network round trip can. `PostcardMenu` takes the
 * same order for the same reason, at the point its own header names the race.
 */
export function DeleteRideControl({ rideId }: { rideId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const online = useOnlineStatus()

  const crew = useQuery(confirming ? queryKeys.rides.crew(rideId) : null, () =>
    getRideCrew(rideId)
  )
  const crewCount = crew.data ? crew.data.going.length + crew.data.maybe.length : undefined

  function onConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await deleteRide(rideId)
      if (result.error) {
        setError(result.error)
        return
      }
      router.replace('/rides')
    })
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      {!confirming ? (
        <Button
          type="button"
          variant="danger"
          size="lg"
          disabled={!online}
          onClick={() => setConfirming(true)}
        >
          Delete ride
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
          <p className="text-sm text-foreground">
            {crewCount === undefined
              ? 'This cancels the ride for everyone on it and deletes its chat history. This cannot be undone.'
              : `This cancels the ride for ${crewCount} ${crewCount === 1 ? 'rider' : 'riders'} and deletes its entire chat history. This cannot be undone.`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Keep ride
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              onClick={onConfirm}
              loading={pending}
              disabled={!online}
            >
              Delete ride
            </Button>
          </div>
        </div>
      )}

      {!online && (
        <p className="text-xs font-medium text-muted">
          You’re offline — reconnect to delete this ride.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
