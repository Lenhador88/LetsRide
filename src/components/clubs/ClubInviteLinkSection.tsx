'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { ErrorState } from '@/components/ui/ErrorState'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SkeletonList } from '@/components/ui/Skeleton'
import { createClubInviteLink, revokeClubInviteLink } from '@/lib/actions/club-invite-links'
import { getClubInviteLinks } from '@/lib/data/club-invite-links'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import { shareAppLink } from '@/lib/share'
import { formatRelativeTime } from '@/lib/utils'
import type { ClubInviteLink } from '@/types'

/**
 * The admin's invite links for one club — `093`, PD-360,
 * `RideInviteLinkSection`'s shape one domain over, with the one structural
 * difference `design.md` names: a club has no departure and therefore no
 * natural death, so **fourteen days is the whole ceiling** rather than
 * `least(departure, 14 days)`.
 *
 * ## There is no v2 frame for this, matching its ride counterpart
 *
 * Assembled from components this app has already measured (`SectionHeader`,
 * `Button`, the `bg-surface` row geometry) rather than presented as read from
 * a design.
 *
 * ## What each row says, and the one thing it must not
 *
 * **Revoke's confirmation must not imply it removes anybody.** Revoking kills
 * the token; the riders it already admitted keep their `club_members` row.
 * Unlike `RideInviteLinkSection`'s equivalent copy, this is NOT because
 * nothing in the schema can remove a rider — `088`'s `remove_club_member`
 * exists — it is because Revoke specifically does not call it, and the copy
 * says so rather than leaving an admin to assume revoking is also removing.
 * `design.md` §What removal does not do is the fuller argument, and PD-361 is
 * where "does a removed rider walk back in through a live link" gets decided.
 *
 * **The use count is not a ledger**, for `RideInviteLinkSection`'s own
 * reason: it is read under the admin's own row security through a
 * block-dominated policy, so a rider who claimed and later blocked them stops
 * being visible and the number goes down.
 */
export function ClubInviteLinkSection({
  clubId,
  clubName,
}: {
  clubId: string
  /** `undefined` while the club is still being read — only the share sheet's
   * own title uses it, so nothing waits on it. */
  clubName?: string
}) {
  const links = useQuery(queryKeys.clubs.inviteLinks(clubId), () => getClubInviteLinks(clubId))
  const [creating, startCreating] = useTransition()
  const online = useOnlineStatus()
  const showBanner = useBanner()

  function create() {
    startCreating(async () => {
      const result = await createClubInviteLink(clubId)
      showBanner(result.error ?? 'Invite link created', result.error ? 'error' : undefined)
    })
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Invite by link" className="py-0" />

      <p className="px-4 text-sm text-muted">
        Anyone with the link can join this club, so send it to people you mean to ride with. A
        link stops working after two weeks, or sooner if you revoke it.
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
                  <InviteLinkRow link={link} clubId={clubId} clubName={clubName} />
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

function InviteLinkRow({
  link,
  clubId,
  clubName,
}: {
  link: ClubInviteLink
  clubId: string
  clubName?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startRevoking] = useTransition()
  const online = useOnlineStatus()
  const showBanner = useBanner()

  const revoked = link.revoked_at !== null
  // `is_expired` is resolved in the data layer, because a clock read during
  // render is not idempotent — see the field's own note.
  const dead = revoked || link.is_expired

  async function share() {
    const outcome = await shareAppLink(
      routes.joinClub(link.token),
      clubName ? `Join ${clubName} on LetsRide` : 'A club on LetsRide'
    )
    if (outcome === 'copied') showBanner('Link copied')
    if (outcome === 'unavailable') showBanner('This device would not share the link', 'error')
  }

  function revoke() {
    startRevoking(async () => {
      const result = await revokeClubInviteLink(link.id, clubId)
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
            {link.uses_count === 0
              ? 'Nobody has joined through it'
              : `${link.uses_count} ${link.uses_count === 1 ? 'rider' : 'riders'} joined`}
          </span>
        </div>

        {/* Both controls are absent on a dead link rather than disabled —
            sharing one sends somebody a URL that cannot work, and revoking
            one is a statement the database has already made. */}
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
            This stops the link working, so nobody new can join with it. Riders who have already
            joined stay in the club.
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
