'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { createRideInviteLink, revokeRideInviteLink } from '@/lib/actions/ride-invite-links'
import { getRideInviteLinks } from '@/lib/data/ride-invite-links'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { shareAppLink } from '@/lib/share'
import { formatRelativeTime } from '@/lib/utils'
import type { RideInviteLink } from '@/types'

/**
 * The organizer's invite links for one ride — `091`, PD-330, on the screen
 * PD-329 built.
 *
 * ## There is no v2 frame for this, and the promising hits are traps
 *
 * `npm run figma -- ls` returns three things that look like this feature and
 * none of them is (checked 2026-08-29): `Invite riders` and `Invite riders -
 * Filled` under `Design · Rides` are **OLD-stylesheet** frames — `Grey (OLD)/*`,
 * `Accent (OLD)/*` — drawing PD-329's rider *search*, and `Join ride without
 * account` sits under `Archive` and is out of scope under decision #1 anyway.
 * So the composition here is assembled from components this app has already
 * measured (`SectionHeader`, `Button`, the `bg-surface` row geometry
 * `DeleteRideControl`'s confirmation uses) and nothing is presented as read from
 * a design. The invented values are logged in the PR rather than called
 * measured.
 *
 * ## What each row says, and the one thing it must not
 *
 * **Revoke's confirmation must not imply it removes anybody**, and that is the
 * whole reason the copy is spelled out rather than left to a generic "Are you
 * sure". Revoking kills the token; the riders it already admitted keep their
 * `ride_members` row — and **nothing in this app can take that away**.
 * `ride_members`' only DELETE policy is `auth.uid() = user_id`, `083` leaves an
 * accepted invite unanswerable by the organizer, and `088`'s three RPCs are
 * club-scoped. A tooltip promising a removal that cannot happen is the one
 * defect this control exists to avoid.
 *
 * **The use count is not a ledger.** It is read under the organizer's own row
 * security through a block-dominated policy, so a rider who claimed and later
 * blocked them stops being visible and the number goes down. `N joined` is a
 * count of who is visible, which is the honest reading of it; anything phrased
 * as a total would be a claim the database does not make.
 *
 * ## Gated on the data, never on `isLoading`
 *
 * `useQuery` starts its fetch in an effect, so on the first pass there is no
 * data *and* no fetch in flight. `!links.data` is the skeleton, `[]` is the
 * empty state, and a thrown read is `ErrorState` with the retry — three
 * distinguishable answers, the same three `RideInviteList` beside it draws.
 */
export function RideInviteLinkSection({
  rideId,
  rideTitle,
}: {
  rideId: string
  /** `undefined` while the ride is still being read — only the share sheet's
   * own title uses it, so nothing waits on it. */
  rideTitle?: string
}) {
  const links = useQuery(queryKeys.rides.inviteLinks(rideId), () => getRideInviteLinks(rideId))
  const [creating, startCreating] = useTransition()
  const online = useOnlineStatus()
  const showBanner = useBanner()

  function create() {
    startCreating(async () => {
      const result = await createRideInviteLink(rideId)
      showBanner(result.error ?? 'Invite link created', result.error ? 'error' : undefined)
    })
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Invite by link" className="py-0" />

      <p className="px-4 text-sm text-muted">
        Anyone with the link can join this ride, so send it to people you mean to ride with. A link
        stops working when the ride departs, or after two weeks — whichever comes first.
      </p>

      {links.error ? (
        <ErrorState onRetry={links.refetch} />
      ) : !links.data ? (
        <SkeletonList rows={1} />
      ) : (
        <>
          {links.data.length > 0 && (
            <ul className="flex flex-col gap-2 px-4">
              {links.data.map((link) => (
                <li key={link.id}>
                  <InviteLinkRow link={link} rideId={rideId} rideTitle={rideTitle} />
                </li>
              ))}
            </ul>
          )}

          <div className="px-4 pt-1">
            <Button type="button" onClick={create} loading={creating} disabled={!online || creating}>
              {links.data.length === 0 ? 'Create an invite link' : 'Create another link'}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * One link: what it is worth right now, how many riders came in through it, and
 * the two controls.
 *
 * **Everything this row says about liveness is a display hint**, and none of it
 * is the authority: liveness is decided in `private.live_ride_invite_link` at
 * every use, against the ride's *current* departure. A link this row still calls
 * live can already be dead because the organizer moved the ride earlier — which
 * is the right way round, since the database is what refuses and the screen
 * never promises on its behalf.
 */
function InviteLinkRow({
  link,
  rideId,
  rideTitle,
}: {
  link: RideInviteLink
  rideId: string
  rideTitle?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startRevoking] = useTransition()
  const online = useOnlineStatus()
  const showBanner = useBanner()

  const revoked = link.revoked_at !== null
  // `is_expired` is resolved in the data layer, because a clock read during
  // render is not idempotent — see the field's own note for why it is a display
  // hint and never the authority.
  const dead = revoked || link.is_expired

  async function share() {
    const outcome = await shareAppLink(
      routes.joinRide(link.token),
      rideTitle ? `Join ${rideTitle} on LetsRide` : 'A ride on LetsRide'
    )
    if (outcome === 'copied') showBanner('Link copied')
    if (outcome === 'unavailable') showBanner('This device would not share the link', 'error')
  }

  function revoke() {
    startRevoking(async () => {
      const result = await revokeRideInviteLink(link.id, rideId)
      setConfirming(false)
      showBanner(result.error ?? 'Link revoked', result.error ? 'error' : undefined)
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface p-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">
            {revoked
              ? 'Revoked'
              : link.is_expired
                ? 'Expired'
                : `Expires ${formatRelativeTime(link.expires_at)}`}
          </span>
          <span className="text-xs font-medium text-muted">
            {/* A count of the riders still visible to this organizer — see the
                component header on why it is not phrased as a total. */}
            {link.uses_count === 0
              ? 'Nobody has joined through it'
              : `${link.uses_count} ${link.uses_count === 1 ? 'rider' : 'riders'} joined`}
          </span>
        </div>

        {/* Both controls are absent on a dead link rather than disabled: sharing
            one sends somebody a URL that cannot work, and revoking one is a
            statement the database has already made. A disabled control is a
            promise. */}
        {!dead && !confirming && (
          <>
            <Button size="sm" variant="secondary" onClick={share} disabled={!online}>
              Share
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          </>
        )}
      </div>

      {confirming && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground">
            {/* The sentence this control exists for. It says what revoking does
                and, in the same breath, what it does not — because there is no
                path in this app that removes a rider from a ride, and copy that
                implied one would be a lie the product cannot make true. */}
            This stops the link working, so nobody new can join with it. Riders who have already
            joined stay on the ride.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Keep link
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              onClick={revoke}
              loading={pending}
              disabled={!online}
            >
              Revoke link
            </Button>
          </div>
          {!online && (
            <p className="text-xs font-medium text-muted">
              You’re offline — reconnect to revoke this link.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
