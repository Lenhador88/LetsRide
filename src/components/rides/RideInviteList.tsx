'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListUser } from '@/components/ui/ListUser'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { revokeRideInvite } from '@/lib/actions/ride-invites'
import { getRideInvites } from '@/lib/data/ride-invites'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { RideInviteListItem } from '@/types'

/**
 * Who the organizer has already asked — `083`, PD-329.
 *
 * ## Two rules this list exists to hold
 *
 * **The trailing note is read from the live crew, never from `status`.**
 * `getRideInvites` joins `ride_members` for exactly this, because the two
 * answer different questions and disagree in both directions: a rider who
 * RSVPs without ever answering is riding with a `pending` invite, and one who
 * accepts and later leaves is not riding with an `accepted` one. Rendering
 * "Joined" off the invite would be wrong in both cases and look right in the
 * common one.
 *
 * **A declined invite is shown, named, and has no re-send affordance.** It is
 * shown because the organizer chose that rider by name and a list that hid the
 * answer would be unactionable (`design.md` §Questions Closed Q5); it has no
 * Withdraw because `083`'s DELETE policy is scoped to `status = 'pending'`, so
 * the button would be a control the database refuses. Decline is terminal
 * against the inviter and the absent button is what says so.
 */
export function RideInviteList({ rideId }: { rideId: string }) {
  const invites = useQuery(queryKeys.rides.invites(rideId), () => getRideInvites(rideId))

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Invited" className="py-0" />
      {invites.error ? (
        <ErrorState onRetry={invites.refetch} />
      ) : !invites.data ? (
        <SkeletonList rows={2} />
      ) : invites.data.length === 0 ? (
        <p className="px-4 text-sm text-muted">Nobody invited yet.</p>
      ) : (
        <ul>
          {invites.data.map((invite) => (
            <li key={invite.id}>
              <InviteRow invite={invite} rideId={rideId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function InviteRow({ invite, rideId }: { invite: RideInviteListItem; rideId: string }) {
  const [pending, setPending] = useState(false)
  const online = useOnlineStatus()
  const showBanner = useBanner()

  async function revoke() {
    setPending(true)
    const result = await revokeRideInvite(invite.id, rideId)
    setPending(false)
    showBanner(result.error ?? 'Invite withdrawn', result.error ? 'error' : undefined)
  }

  return (
    <div className="flex items-center gap-2 pr-4">
      <ListUser
        name={invite.invitee?.username ?? 'Rider'}
        avatarUrl={invite.invitee?.avatar_url}
        // Live crew first, because it is the fact the organizer is actually
        // looking for. `Declined` next, because it is the one answer that ends
        // the exchange. `Invited` is the default rather than "Pending": the
        // rider was invited, and what they have or have not done about it is
        // the absence of the other two labels.
        note={invite.is_crew ? 'Riding' : invite.status === 'declined' ? 'Declined' : 'Invited'}
        className="min-w-0 flex-1"
      />
      {/* Only a pending invite is withdrawable — `083`'s DELETE policy says so,
          and drawing the button for the other two would offer a control the
          database refuses. An invite whose rider has since joined is not
          pending in any useful sense either, but it may still literally be
          `pending`, and withdrawing it there is legitimate: it takes back the
          invitation, not the membership. */}
      {invite.status === 'pending' && (
        <Button
          size="sm"
          variant="secondary"
          onClick={revoke}
          loading={pending}
          disabled={!online || pending}
        >
          Withdraw
        </Button>
      )}
    </div>
  )
}
