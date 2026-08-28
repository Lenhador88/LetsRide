'use client'

import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import {
  approveClubJoinRequest,
  declineClubJoinRequest,
} from '@/lib/actions/club-join-requests'
import { getClubJoinRequests } from '@/lib/data/club-join-requests'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { ClubDetail } from '@/types'

/**
 * The pending join requests for a club, with Approve and Decline — `085`,
 * PD-325.
 *
 * ## This is the minimum that makes a request answerable, and no more
 *
 * PD-325's issue is explicit that the admin surface belongs to **PD-326
 * (`Manage riders`)**, and equally explicit that *"neither may leave the other
 * half-built — a request with nobody able to accept it is worse than no
 * request."* So this ships the smallest thing that closes that: a list of
 * pending rows with a pair of controls. **No roster management, no role
 * promotion, no removal, no search, no history view, and no Clear control on a
 * declined row** — `085`'s DELETE policy already admits an admin clearing one,
 * so that button is one line of JSX in PD-326 rather than a second migration.
 *
 * **PD-326 should ABSORB this section rather than build a second one**: same
 * route, same `queryKeys.clubs.joinRequests(clubId)`, same
 * `getClubJoinRequests`. It sits on the club detail rather than behind its own
 * route because a `Requests` route with no entrance anywhere is precisely the
 * unreachable screen PD-125 shipped, and because a screen PD-326 then has to
 * delete is worse than a section it moves.
 *
 * ## The gate is `viewer_is_owner`, NOT `viewer_role === 'owner'`
 *
 * The difference is load-bearing (PD-280) and here it decides whether the
 * feature works at all. `viewer_role` is a `club_members` row; ownership is a
 * column on `clubs`, and the two diverge for an owner holding no roster row —
 * `createClub` does two un-transacted inserts, so a lost tab between them
 * leaves exactly that. Gating on the role alone would hide this section from
 * that owner — and since `019` makes `admin` claimable by no client, the owner
 * is the ONLY rider who can answer anything today, so the club's requests would
 * sit pending for ever with nobody able to see them. `private.is_club_admin_for`
 * has the matching owner arm, which is what makes the two agree.
 *
 * ## Absent rather than empty
 *
 * A club with no pending requests draws nothing at all. A to-do list that says
 * "no requests" is noise on every club detail an owner opens, and — because a
 * non-admin's read of this table returns zero rows for the same reason — an
 * empty state here would be indistinguishable from "you may not see these",
 * which is the conflation the render-shell rules exist to refuse.
 */
export function ClubJoinRequestsSection({
  clubId,
  club,
}: {
  clubId: string
  club: ClubDetail
}) {
  const online = useOnlineStatus()
  const showBanner = useBanner()
  const [pending, setPending] = useState<string | null>(null)

  const isAdmin = club.viewer_is_owner || club.viewer_role === 'admin'

  // The key is null for everybody else, so a member's club detail issues no
  // request at all rather than one that comes back empty.
  const requests = useQuery(isAdmin ? queryKeys.clubs.joinRequests(clubId) : null, () =>
    getClubJoinRequests(clubId)
  )

  // Gated on the data, never on `isLoading` — and a failed read draws nothing
  // rather than an error, because this section is additive to a screen that has
  // already rendered. An admin who cannot see the list has the notification
  // row's own Approve/Decline pair as the second route to the same RPC.
  if (!requests.data || requests.data.length === 0) return null

  async function answer(requestId: string, choice: 'approve' | 'decline') {
    setPending(requestId)
    const result =
      choice === 'approve'
        ? await approveClubJoinRequest(requestId, clubId)
        : await declineClubJoinRequest(requestId, clubId)
    setPending(null)

    if (result.error) showBanner(result.error, 'error')
    else showBanner(choice === 'approve' ? 'Rider let in' : 'Request declined')
  }

  return (
    <section className="flex flex-col gap-2">
      {/* `px-4` rather than the component's own `px-6`, matching every other
          header on this screen — see the club detail's own note. */}
      <SectionHeader title="Requests" className="px-4 py-0" />

      <ul className="flex flex-col gap-3 px-4">
        {requests.data.map((request) => {
          const username = request.requester?.username ?? 'Rider'
          return (
            <li key={request.id} className="flex items-center gap-3">
              <Avatar
                src={request.requester?.avatar_url}
                name={username}
                size="sm"
                className="h-10 w-10 shrink-0"
              />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {username}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  onClick={() => answer(request.id, 'approve')}
                  loading={pending === request.id}
                  // Offline disables rather than queues: letting somebody into
                  // a club is a promise to the rest of it, and `085`'s RPC is
                  // not a write to be optimistic about.
                  disabled={!online || pending !== null}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => answer(request.id, 'decline')}
                  disabled={!online || pending !== null}
                >
                  Decline
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
