'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import {
  approveClubJoinRequest,
  declineClubJoinRequest,
} from '@/lib/actions/club-join-requests'
import { getClubJoinRequests } from '@/lib/data/club-join-requests'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

/**
 * Approve and Decline, under a `club_join_requested` notification row — `085`,
 * PD-325. `RideInviteActions`' shape, one domain over, and the reasoning
 * transfers whole.
 *
 * ## The enabled state is read from the live request, never from the row
 *
 * A notification records an event that happened. By the time an admin reads it
 * the request may have been answered by a co-admin, withdrawn by the rider, or
 * hidden by a block — and in every one of those cases `085`'s RPC refuses, so
 * offering the buttons would promise something the database will not do.
 * `getClubJoinRequests` is the source and it returns `pending` rows only.
 *
 * **When there is no live request this renders nothing at all.** Deliberate
 * rather than a disabled pair: a disabled control is a promise, and here it
 * would also be an oracle — "withdrawn", "answered by somebody else" and "the
 * rider is blocked with you" must stay indistinguishable, which they are only
 * while all three render the same nothing. It is also what the row shows to a
 * reader who is not an admin, since the same read returns them zero rows.
 *
 * ## Why it matches on the club and the actor rather than a request id
 *
 * `036`'s subject columns are four typed foreign keys and `club_join_requested`
 * carries `club_id` alone — there is no `request_id` column, and adding one for
 * a single type would be a fifth subject column on a table whose shape is fixed
 * per type by a CHECK. So the row asks "is there a live request from this rider
 * for this club", which is the question the buttons actually depend on and is
 * robust to the request having been withdrawn and made again.
 *
 * `actor_id` is the requester because `085`'s fan-out writes it from
 * `NEW.user_id` and never from `auth.uid()` — `036` trap (b).
 *
 * ## One fetch per club for the whole list
 *
 * Every mounted copy for the same club asks for
 * `queryKeys.clubs.joinRequests(clubId)`, and `useQuery` caches by key
 * regardless of which mount asked. So five requests to one club issue one
 * read, not five. Rows of any other type pass `null` as the key and issue none.
 */
export function ClubJoinRequestActions({
  clubId,
  actorId,
}: {
  clubId: string | undefined
  actorId: string | undefined
}) {
  const online = useOnlineStatus()
  const showBanner = useBanner()
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null)

  // `undefined` when the row's club did not resolve — `036` §3's policy is
  // supposed to make that unreachable for this type, so this degrades rather
  // than asserting.
  const requests = useQuery(
    clubId && actorId ? queryKeys.clubs.joinRequests(clubId) : null,
    () => getClubJoinRequests(clubId!)
  )
  const request = actorId ? requests.data?.find((row) => row.user_id === actorId) : undefined

  // `undefined` is "not answered yet" and a miss is "no live request"; both draw
  // nothing, because a control that appears a moment after the row is worse
  // than one that never did.
  if (!request || !clubId) return null

  async function answer(choice: 'approve' | 'decline') {
    if (!request || !clubId) return
    setPending(choice)
    const result =
      choice === 'approve'
        ? await approveClubJoinRequest(request.id, clubId)
        : await declineClubJoinRequest(request.id, clubId)
    setPending(null)

    if (result.error) {
      showBanner(result.error, 'error')
      return
    }
    // No navigation on either. Unlike an accepted invite there is nothing new
    // for the ADMIN to look at — the club they are already in gained a member —
    // and a decline is deliberately quiet.
    showBanner(choice === 'approve' ? 'Rider let in' : 'Request declined')
  }

  return (
    <div className="flex gap-2 px-4 pb-3">
      <Button
        size="sm"
        onClick={() => answer('approve')}
        loading={pending === 'approve'}
        // Offline disables rather than queues, for `RideInviteActions`' reason:
        // letting somebody into a club is a promise to the rest of it, and
        // `085`'s RPC is not a write to be optimistic about.
        disabled={!online || pending !== null}
      >
        Approve
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
