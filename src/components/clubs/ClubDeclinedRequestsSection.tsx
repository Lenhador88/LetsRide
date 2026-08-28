'use client'

import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { clearClubJoinRequest } from '@/lib/actions/club-join-requests'
import { getDeclinedClubJoinRequests } from '@/lib/data/club-join-requests'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { ClubDetail } from '@/types'

/**
 * The refusals this club has issued, each with the one control that lifts it —
 * `088`, PD-326.
 *
 * ## Why a refused rider needs a screen at all
 *
 * `085` made a decline **terminal against the requester**: their DELETE arm is
 * scoped to `status = 'pending'`, there is no UPDATE grant for anyone, and the
 * unique `(club_id, user_id)` refuses a second ask with `23505`. *A no means
 * no, and it does not expire.* The one way back is an admin deleting the row,
 * which `085`'s DELETE policy already admits — and which had **no surface
 * anywhere** until this section. `087`'s header names that control as PD-326's.
 *
 * So this list is not a log. It is the only affordance in the product by which
 * a club can change its mind, and a refusal with no way to lift it is a
 * permanent ban nobody chose.
 *
 * ## Clearing is not approving
 *
 * `Allow to ask again` deletes the request and writes no membership row. The
 * rider is not let in; they are un-refused, and they have to ask again. The
 * label says that rather than `Clear`, which reads like tidying a list.
 *
 * Deleting the row also fires `089`'s retraction, so the rider's own
 * "declined" notification goes at the same moment they become able to ask
 * again — see `clearClubJoinRequest`.
 *
 * ## Absent rather than empty
 *
 * A club that has refused nobody draws nothing, on `ClubJoinRequestsSection`'s
 * recorded reason: a non-admin's read of this table returns zero rows for a
 * *different* reason, so an empty state here would be indistinguishable from
 * "you may not see these" — the conflation the render-shell rules refuse.
 */
export function ClubDeclinedRequestsSection({
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

  // `null` for everybody else, so a non-admin issues no request at all rather
  // than one that comes back empty.
  const declined = useQuery(isAdmin ? queryKeys.clubs.declinedRequests(clubId) : null, () =>
    getDeclinedClubJoinRequests(clubId)
  )

  // Gated on the data, never on `isLoading` — and a failed read draws nothing
  // rather than an error, because this section is additive to a screen that has
  // already rendered.
  if (!declined.data || declined.data.length === 0) return null

  async function clear(requestId: string, username: string) {
    setPending(requestId)
    const result = await clearClubJoinRequest(requestId, clubId)
    setPending(null)

    if (result.error) showBanner(result.error, 'error')
    else showBanner(`${username} can ask again`)
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Declined" className="px-4 py-0" />

      <ul className="flex flex-col gap-3 px-4">
        {declined.data.map((request) => {
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
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => clear(request.id, username)}
                loading={pending === request.id}
                disabled={!online || pending !== null}
              >
                Allow to ask again
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
