'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { deleteRide } from '@/lib/actions/rides'
import { getRideCrew } from '@/lib/data/rides'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * The destructive control at the foot of `/rides/detail/edit` — PD-101,
 * `design.md` §D4. Deliberately not in the header's sub-page switcher, where an
 * irreversible action would have sat one tap from `Crew` on a glove-sized
 * target — that switcher is now deleted outright (PD-254), which retires the
 * argument rather than reversing it.
 *
 * **It is no longer the only way in (PD-280).** `RideOptionsMenu`'s `Delete
 * ride` row opens `DeleteRideSheet` below, which is this same confirmation in a
 * `ContextMenu` instead of a panel. Two entry points to one confirmation is the
 * shape the product owner asked for; two *implementations* of it would be the
 * defect, which is why `RideDeleteConfirmation` is extracted rather than copied
 * — the crew count, the chat warning and the offline rule have one home.
 *
 * Crew count is read only once the rider taps through to the confirmation,
 * because most visits to either surface never reach it and the ride plan has
 * usually already warmed this exact key anyway. The gate used to be
 * `confirming ? key : null`; it is now the confirmation not being mounted,
 * which is the same gate expressed by construction.
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
  const online = useOnlineStatus()

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
        <div className="rounded-lg bg-surface p-4">
          <RideDeleteConfirmation rideId={rideId} onCancel={() => setConfirming(false)} />
        </div>
      )}

      {/* Only while the trigger is what is showing — the confirmation draws its
          own copy of this line, and two of them stacked reads as a stutter. */}
      {!online && !confirming && (
        <p className="text-xs font-medium text-muted">
          You’re offline — reconnect to delete this ride.
        </p>
      )}
    </div>
  )
}

/**
 * The same confirmation, over whichever screen opened it — `RideOptionsMenu`'s
 * `Delete ride` row (PD-280).
 *
 * A sheet rather than a two-tap row: `PostcardMenu`'s `Tap again to delete` is
 * the precedent for a menu-row confirmation and it is the wrong one here,
 * because `ride-lifecycle` requires the confirmation to name the collateral —
 * the crew who lose the ride and the chat history that goes with it — and a
 * menu row has nowhere to say it. `ProfileMenu` → `DeleteAccountSheet` is the
 * precedent that fits: one `ContextMenu` swapped for another, over the same
 * canvas.
 */
export function DeleteRideSheet({
  rideId,
  open,
  onClose,
}: {
  rideId: string
  open: boolean
  onClose: () => void
}) {
  return (
    <ContextMenu open={open} onClose={onClose} label="Delete this ride">
      <div className="p-2">
        <RideDeleteConfirmation rideId={rideId} onCancel={onClose} />
      </div>
    </ContextMenu>
  )
}

/**
 * What both surfaces above draw: the blast radius, the two buttons, and the
 * error a refused delete returns.
 *
 * Mounted only while a rider is actually confirming, which is what gates the
 * crew read — see `DeleteRideControl`'s header.
 */
function RideDeleteConfirmation({ rideId, onCancel }: { rideId: string; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const online = useOnlineStatus()

  const crew = useQuery(queryKeys.rides.crew(rideId), () => getRideCrew(rideId))
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
    <div className="flex flex-col gap-3">
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
          onClick={onCancel}
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
