'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { acceptRideInvite, declineRideInvite } from '@/lib/actions/ride-invites'
import { getMyPendingInvites } from '@/lib/data/ride-invites'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/**
 * Accept and Decline, under a `ride_invited` notification row — `083`, PD-329.
 * The first notification in this app a rider can act on without leaving the
 * list.
 *
 * ## The enabled state is read from the live invite, never from the row
 *
 * A notification records an event that happened. By the time it is read the
 * invite may have been answered on another device, withdrawn by the organizer,
 * or hidden by a block — and in every one of those cases the RPC would refuse,
 * so offering the buttons would be promising something the database will not
 * do. `getMyPendingInvites` is the source, and it returns only invites that are
 * still `pending` *and* on rides the rider is not already crew on.
 *
 * **When there is no live invite this renders nothing at all**, leaving the row
 * as plain text. That is deliberate rather than a disabled pair: a disabled
 * control is a promise, and here it would also be an oracle — "withdrawn",
 * "answered elsewhere" and "the organizer blocked you" must stay
 * indistinguishable, which they are only while all three render the same
 * nothing.
 *
 * ## Why it matches on the ride rather than on an invite id
 *
 * `036`'s subject columns are four typed foreign keys and `ride_invited`
 * carries `ride_id` alone — there is no `invite_id` column and adding one for a
 * single type would be a fifth subject column on a table whose shape is fixed
 * per type by a CHECK. So the row asks "do I have a live invite to this ride",
 * which is the question the buttons actually depend on and is also robust to
 * the invite having been withdrawn and re-sent.
 *
 * ## One fetch for the whole list
 *
 * Every mounted copy asks for `queryKeys.invites.pending()`, and `useQuery`
 * caches by key regardless of which mount asked — the same property
 * `NotificationsPanel` relies on for its own two reads. So a list of twenty
 * rows issues one request, not twenty. Rows of any other type pass `null` as
 * the key and issue none.
 */
export function RideInviteActions({ rideId }: { rideId: string | undefined }) {
  const router = useRouter()
  const online = useOnlineStatus()
  const showBanner = useBanner()
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null)

  // `null` when the row's ride did not resolve — `036` §3's policy is supposed
  // to make that unreachable, so this degrades rather than asserting.
  const invites = useQuery(rideId ? queryKeys.invites.pending() : null, getMyPendingInvites)
  const invite = rideId ? invites.data?.find((row) => row.ride_id === rideId) : undefined

  // `undefined` is "not answered yet" and `null`-ish is "no live invite"; both
  // draw nothing, because a control that appears a moment after the row is
  // worse than one that never did.
  if (!invite) return null

  async function answer(choice: 'accept' | 'decline') {
    if (!invite) return
    setPending(choice)
    const result =
      choice === 'accept'
        ? await acceptRideInvite(invite.id)
        : await declineRideInvite(invite.id, invite.ride_id)
    setPending(null)

    if (result.error) {
      showBanner(result.error, 'error')
      return
    }
    // Accept takes the rider to the ride they have just joined; decline stays
    // put, because the ride is no longer theirs to open — a declined invite
    // grants nothing.
    if (choice === 'accept') router.push(routes.ride(invite.ride_id))
    else showBanner('Invite declined')
  }

  return (
    <div className="flex gap-2 px-4 pb-3">
      <Button
        size="sm"
        onClick={() => answer('accept')}
        loading={pending === 'accept'}
        // Offline disables rather than queues: an RSVP written from a stale
        // device is a promise to other riders, and `083`'s RPC is the one write
        // here that must never be optimistic.
        disabled={!online || pending !== null}
      >
        Accept
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => answer('decline')}
        loading={pending === 'decline'}
        disabled={!online || pending !== null}
      >
        Decline
      </Button>
    </div>
  )
}
