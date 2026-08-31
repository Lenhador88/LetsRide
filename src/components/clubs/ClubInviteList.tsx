'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListUser } from '@/components/ui/ListUser'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { withdrawClubInvite } from '@/lib/actions/club-invites'
import { getClubInvites } from '@/lib/data/club-invites'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { ClubInviteListItem } from '@/types'

/**
 * Who this club has already invited — `093`, PD-360, `RideInviteList`'s shape
 * one domain over, and simpler than it in the one way `ClubInviteListItem`
 * names: `085`'s rule means accepting DELETES the row, so there is no
 * `is_crew`-style cross-check against `club_members` to draw here — a
 * `pending` invite this list can see can never be stale about membership the
 * way a ride's surviving `accepted` invite can be.
 *
 * **A declined invite is shown, named, and has no re-send affordance from
 * here** — `RideInviteList`'s exact reasoning: the inviter chose that rider by
 * name and a list that hid the answer would be unactionable, and `093`'s
 * DELETE policy scopes the inviter's own withdraw right to `status =
 * 'pending'`. An admin may still clear a co-admin's declined invite and
 * re-send it (`design.md` §Questions closed) — that control is not built
 * here; it is one Invite tap away in the picker above this list, which the
 * unique key and the admissibility trigger both accept once the row is gone.
 */
export function ClubInviteList({ clubId }: { clubId: string }) {
  const invites = useQuery(queryKeys.clubs.inviteList(clubId), () => getClubInvites(clubId))

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
              <InviteRow invite={invite} clubId={clubId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function InviteRow({ invite, clubId }: { invite: ClubInviteListItem; clubId: string }) {
  const [pending, setPending] = useState(false)
  const online = useOnlineStatus()
  const showBanner = useBanner()

  async function withdraw() {
    setPending(true)
    const result = await withdrawClubInvite(invite.id, clubId)
    setPending(false)
    showBanner(result.error ?? 'Invite withdrawn', result.error ? 'error' : undefined)
  }

  return (
    <div className="flex items-center gap-2 pr-4">
      <ListUser
        name={invite.invitee?.username ?? 'Rider'}
        avatarUrl={invite.invitee?.avatar_url}
        note={invite.status === 'declined' ? 'Declined' : 'Invited'}
        className="min-w-0 flex-1"
      />
      {/* Only a pending invite is withdrawable — `093`'s DELETE policy scopes
          the inviter's own right to `status = 'pending'`, and drawing the
          button for a declined one would offer a control the database
          refuses for everyone but an admin. */}
      {invite.status === 'pending' && (
        <Button
          size="sm"
          variant="secondary"
          onClick={withdraw}
          loading={pending}
          disabled={!online || pending}
        >
          Withdraw
        </Button>
      )}
    </div>
  )
}
