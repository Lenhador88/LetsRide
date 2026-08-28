'use client'

import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { useOnlineStatus } from '@/components/ui/OfflineState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import {
  demoteClubAdmin,
  promoteClubMember,
  removeClubMember,
} from '@/lib/actions/club-members'
import { getCurrentProfile } from '@/lib/data/profile'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import type { ClubDetail, ClubRosterMember } from '@/types'

export type ManageRidersRosterProps = {
  clubId: string
  club: ClubDetail
  members: ClubRosterMember[]
}

/**
 * The roster an owner or admin acts on — `088`, PD-326.
 *
 * ## What each row offers, and why it is not one rule
 *
 * `088`'s permission model reduces to one sentence — **an admin may act on
 * members; only the owner may act on admins** — and the controls have to say
 * the same thing, because a control the database refuses is worse than an
 * absent one: it promises something and then reports a `42501` the rider
 * cannot act on.
 *
 * | Row is | Owner sees | Admin sees |
 * |---|---|---|
 * | the club's owner | nothing | nothing |
 * | an `admin` | `Remove`, `Make member` | nothing, unless it is their own row |
 * | their own admin row | n/a | `Step down` |
 * | a `member` | `Remove`, `Make admin` | `Remove`, `Make admin` |
 *
 * **The owner's row is identified by `clubs.owner_id`, never by
 * `role === 'owner'`** — PD-280's distinction, and here it decides whether the
 * screen offers to remove the one rider nobody may remove. `054`'s ownerless
 * owner holds no roster row at all, and a club whose owner's row says `member`
 * is the state this guards against.
 *
 * ## Destructive actions confirm; constructive ones do not
 *
 * `Remove` opens a confirmation sheet naming the rider — the same `ContextMenu`
 * portal `DeleteClubSheet` uses, on the rule in
 * `docs/reference/design-system.md` §The ⋯ options menu. Promotion and
 * demotion do not: both are one tap to undo by the same person who made them,
 * and a confirmation on a reversible action trains riders to dismiss the ones
 * that matter.
 *
 * **The confirmation says what removal is NOT**, because the obvious reading is
 * wrong: removing a rider is not a ban. Their postcards stay in the club, and
 * they may rejoin a public club in one tap or ask again for a private one.
 * Blocking is the tool for a rider somebody wants gone for good.
 */
export function ManageRidersRoster({ clubId, club, members }: ManageRidersRosterProps) {
  const online = useOnlineStatus()
  const showBanner = useBanner()
  // `{ userId, action }` rather than the id alone, on `ClubJoinRequestsSection`'s
  // recorded reason: a row can offer two controls, so an id-only pending state
  // spins both and says nothing about which one was pressed.
  const [pending, setPending] = useState<{
    userId: string
    action: 'remove' | 'promote' | 'demote'
  } | null>(null)
  const [removing, setRemoving] = useState<ClubRosterMember | null>(null)
  // Which row is the viewer's own, for the `Step down` arm. `ClubDetail`
  // carries the viewer's ROLE but not their id, and `NotificationsPanel` reads
  // the same key for the same reason — so this shares its cache entry rather
  // than issuing a second read of the same row.
  const viewer = useQuery(queryKeys.profile.me(), getCurrentProfile)

  const viewerIsOwner = club.viewer_is_owner

  async function run(
    userId: string,
    action: 'remove' | 'promote' | 'demote',
    done: string
  ) {
    setPending({ userId, action })
    const result =
      action === 'remove'
        ? await removeClubMember(clubId, userId)
        : action === 'promote'
          ? await promoteClubMember(clubId, userId)
          : await demoteClubAdmin(clubId, userId)
    setPending(null)
    setRemoving(null)

    if (result.error) showBanner(result.error, 'error')
    else showBanner(done)
  }

  return (
    <section className="flex flex-col gap-2">
      {/* `px-4` rather than the component's own `px-6`, matching every other
          header on the club screens — see the club detail's own note. */}
      <SectionHeader title="Riders" className="px-4 py-0" />

      <ul className="flex flex-col gap-3 px-4">
        {members.map((member) => {
          const username = member.profile?.username ?? 'Rider'
          const isClubOwner = member.user_id === club.owner_id
          const isAdmin = member.role === 'admin'
          // `viewer.data?.id` is `undefined` until the profile lands, and
          // `undefined === undefined` must not make an anonymous row "self" —
          // `CommentList`'s `canDelete` guard, and the same reason.
          const isSelf = !!viewer.data && member.user_id === viewer.data.id
          // An admin may act on a MEMBER; only the owner may act on an admin.
          // The one exception is an admin's own row, where `Step down` takes
          // nothing from anybody else.
          const mayAct = !isClubOwner && (viewerIsOwner || !isAdmin)
          const mayStepDown = !isClubOwner && isAdmin && isSelf
          const busy = pending?.userId === member.user_id

          return (
            <li key={member.user_id} className="flex items-center gap-3">
              <Avatar
                src={member.profile?.avatar_url}
                name={username}
                size="sm"
                className={`h-10 w-10 shrink-0 ${isClubOwner ? 'border-accent' : ''}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{username}</p>
                {(isClubOwner || isAdmin) && (
                  <p className="text-xs font-medium text-accent-strong">
                    {isClubOwner ? 'Owner' : 'Admin'}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                {mayAct && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        isAdmin
                          ? run(member.user_id, 'demote', `${username} is a member again`)
                          : run(member.user_id, 'promote', `${username} is an admin`)
                      }
                      loading={busy && pending?.action !== 'remove'}
                      // Offline disables rather than queues: a role change is a
                      // promise to the rest of the club, and `088`'s RPCs are
                      // not writes to be optimistic about.
                      disabled={!online || pending !== null}
                    >
                      {isAdmin ? 'Make member' : 'Make admin'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setRemoving(member)}
                      loading={busy && pending?.action === 'remove'}
                      disabled={!online || pending !== null}
                    >
                      Remove
                    </Button>
                  </>
                )}
                {!mayAct && mayStepDown && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => run(member.user_id, 'demote', 'You are a member again')}
                    loading={busy}
                    disabled={!online || pending !== null}
                  >
                    Step down
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* A sheet rather than a two-tap row, on `DeleteClubSheet`'s shape and
          through the same `ContextMenu` portal — `PostcardDeck`'s transform is
          why that portal exists, and a roster row is no different. */}
      <ContextMenu
        open={removing !== null}
        onClose={() => setRemoving(null)}
        label="Remove this rider"
      >
        <div className="flex flex-col gap-3 p-2">
          <p className="text-base font-semibold text-foreground">
            Remove {removing?.profile?.username ?? 'this rider'}?
          </p>
          {/* Says what removal is NOT, because the obvious reading is wrong: it
              is not a ban, and nothing in `088` writes one. */}
          <p className="text-sm text-muted">
            They lose the club’s rides, threads and postcards. Anything they posted stays. They
            can rejoin a public club in one tap, or ask again for a private one — blocking is
            what stops someone coming back.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setRemoving(null)}
              disabled={pending !== null}
            >
              Keep rider
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              loading={pending?.action === 'remove'}
              disabled={!online || pending !== null}
              onClick={() =>
                removing &&
                run(
                  removing.user_id,
                  'remove',
                  `${removing.profile?.username ?? 'Rider'} was removed`
                )
              }
            >
              Remove
            </Button>
          </div>
        </div>
      </ContextMenu>
    </section>
  )
}
