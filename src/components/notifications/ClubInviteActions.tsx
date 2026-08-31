'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { acceptClubInvite, declineClubInvite } from '@/lib/actions/club-invites'
import { getMyClubInvites } from '@/lib/data/club-invites'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'

/**
 * Accept and Decline, under a `club_invited` notification row — `093`,
 * PD-360. `RideInviteActions`' shape, one domain over, and the reasoning
 * transfers whole.
 *
 * ## The enabled state is read from the live invite, never from the row
 *
 * A notification records an event that happened. By the time it is read the
 * invite may have been answered on another device, withdrawn by the inviter,
 * or hidden by a block — and in every one of those cases the RPC would
 * refuse, so offering the buttons would be promising something the database
 * will not do. `getMyClubInvites` is the source, and it returns `pending`
 * **and** `declined` invites — `085`'s rule lets the invitee reopen their own
 * refusal through Accept, so a declined row still gets that one control.
 *
 * **Decline is offered only while `status` is `pending`.** `decline_club_invite`
 * is `pending`-only per its own policy, so drawing it for an already-declined
 * row would offer a control the database refuses — the disabled-control
 * trap one level down from the row's own presence.
 *
 * **When there is no live invite this renders nothing at all**, leaving the
 * row as plain text — `RideInviteActions`' exact reasoning: a disabled
 * control is a promise, and here it would also be an oracle, since
 * "withdrawn", "answered elsewhere" and "the inviter's authority ended" must
 * stay indistinguishable, which they are only while all three render the
 * same nothing.
 *
 * ## Why it matches on the club rather than on an invite id
 *
 * `036`'s subject columns are four typed foreign keys and `club_invited`
 * carries `club_id` alone — there is no `invite_id` column, and adding one
 * for a single type would be a fifth subject column on a table whose shape is
 * fixed per type by a CHECK. So the row asks "do I have a live invite to this
 * club", which is the question the buttons actually depend on and is robust
 * to the invite having been withdrawn and re-sent.
 *
 * ## One fetch for the whole list
 *
 * Every mounted copy asks for `queryKeys.clubInvites.pending()`, and
 * `useQuery` caches by key regardless of which mount asked — the same
 * property `RideInviteActions` relies on. Rows of any other type pass `null`
 * as the key and issue none.
 */
export function ClubInviteActions({ clubId }: { clubId: string | undefined }) {
  const router = useRouter()
  const online = useOnlineStatus()
  const showBanner = useBanner()
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null)

  // `undefined` when the row's club did not resolve — `036` §3's policy is
  // supposed to make that unreachable, so this degrades rather than asserting.
  const invites = useQuery(clubId ? queryKeys.clubInvites.pending() : null, getMyClubInvites)
  const invite = clubId ? invites.data?.find((row) => row.club_id === clubId) : undefined

  // `undefined` is "not answered yet" and a miss is "no live invite"; both
  // draw nothing, because a control that appears a moment after the row is
  // worse than one that never did.
  if (!invite) return null

  async function answer(choice: 'accept' | 'decline') {
    if (!invite) return
    setPending(choice)
    const result =
      choice === 'accept'
        ? await acceptClubInvite(invite.id, invite.club_id)
        : await declineClubInvite(invite.id)
    setPending(null)

    if (result.error) {
      showBanner(result.error, 'error')
      return
    }
    // Accept takes the rider to the club they have just joined; decline stays
    // put, because the club is no longer theirs to open — a declined invite
    // grants nothing, and this rider never had a read path to it in the first
    // place (`design.md` §The invitee needs no new read path).
    if (choice === 'accept') router.push(routes.club(invite.club_id))
    else showBanner('Invite declined')
  }

  return (
    <div className="flex gap-2 px-4 pb-3">
      <Button
        size="sm"
        onClick={() => answer('accept')}
        loading={pending === 'accept'}
        // Offline disables rather than queues: an admission is a promise to
        // the rest of the club, and `093`'s RPC is the one write here that
        // must never be optimistic.
        disabled={!online || pending !== null}
      >
        Accept
      </Button>
      {/* Absent rather than disabled on a `declined` row — see the header. */}
      {invite.status === 'pending' && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => answer('decline')}
          loading={pending === 'decline'}
          disabled={!online || pending !== null}
        >
          Decline
        </Button>
      )}
    </div>
  )
}
