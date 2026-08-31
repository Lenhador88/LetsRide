'use client'

import { PaperPlaneIcon, ProfileIcon } from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenuItem } from '@/components/ui/ContextMenu'
import { routes } from '@/lib/routes'
import { shareAppLink } from '@/lib/share'
import type { ClubDetail } from '@/types'

/**
 * The one component that decides `Share club` versus `Invite riders` —
 * `093`, PD-360, `design.md` §The share row is one component with three
 * callers.
 *
 * ## The defect this exists to fix, in one line
 *
 * Both of its callers used to draw `shareAppLink(routes.club(clubId), …)`
 * unconditionally. `clubs` SELECT refuses that URL to the non-member it was
 * just sent to on a **private** club — a live bug, not a hypothetical one —
 * and a second call site (the club thread screen's own ⋯ menu) inherited it
 * knowingly rather than fix it twice. So the branch lives HERE, once, mounted
 * by both, rather than copied into either.
 *
 * ## The label is the safety property, not the copy
 *
 * `Share club` on a private club promises a URL the recipient's own session
 * cannot open. `Invite riders` promises something the database can actually
 * deliver — an admitted rider, in-app or through a tokened link. A future
 * edit that shortens either label back to a bare "Share" reinstates the
 * defect with nothing red anywhere; there is no test that can catch prose,
 * which is exactly why the SHAPE of the three states below is what is tested.
 *
 * ## Three states, and the third is the fix
 *
 * | Club | Viewer | The row |
 * |---|---|---|
 * | Public | anyone who can see the menu | `Share club`, plus `Invite a rider` for a member |
 * | Private | owner or admin | `Invite riders` |
 * | Private | member who is not an admin, or a non-member | **nothing** |
 *
 * A non-member of a PRIVATE club never reaches either caller in practice —
 * `clubs` SELECT refuses the row, so `ClubDetailHeader` never mounts
 * `ClubOptionsMenu` and the club page renders `ClubPreviewScreen` instead,
 * which mounts no options menu of its own. The row that actually disappears
 * here, day to day, is a private club's ORDINARY member reading a thread they
 * did not author — and that is the row this component's whole existence is
 * for: a share control that cannot deliver is worse than none.
 *
 * ## `isPublic === undefined` renders nothing, deliberately
 *
 * Neither caller mounts this before its own club read has resolved
 * (`ClubOptionsMenu` waits on `full`; the thread screen's menu waits on
 * `club.data`), so this is defensive rather than reachable today. It exists
 * because rendering the PUBLIC branch for a club whose visibility has not
 * loaded yet is exactly the class of bug this component was built to remove —
 * guessing "public" is the version of the old defect that would ship quietly.
 */
export function ClubShareOrInviteItem({
  clubId,
  isPublic,
  viewerRole,
  isOwner,
  onDone,
}: {
  clubId: string
  /** The club's visibility **right now**. `undefined` while the caller's own
   * club read has not resolved — renders no row rather than guessing. */
  isPublic: boolean | undefined
  viewerRole: ClubDetail['viewer_role']
  isOwner: boolean
  /** Closes the sheet this row sits in — `ContextMenu`'s own `setOpen(false)`. */
  onDone: () => void
}) {
  const showBanner = useBanner()

  if (isPublic === undefined) return null

  const isMember = viewerRole !== null
  // The same set `private.may_mint_club_link_for` admits — `085`'s admin
  // definition, decision 3's argument for why it must be exactly that set.
  const canManage = isOwner || viewerRole === 'admin'

  async function onShare() {
    onDone()
    const outcome = await shareAppLink(routes.club(clubId), 'A club on LetsRide')
    if (outcome === 'copied') showBanner('Link copied')
    if (outcome === 'unavailable') showBanner('This device would not share the link', 'error')
  }

  if (isPublic) {
    return (
      <>
        <ContextMenuItem icon={<PaperPlaneIcon className="h-6 w-6" />} onClick={onShare}>
          Share club
        </ContextMenuItem>
        {/* Decision 3: on a PUBLIC club the in-app invite is a pointer rather
            than a grant — the recipient could already open the club and join
            it — so any member may send one, not only an admin. */}
        {isMember && (
          <ContextMenuItem
            href={routes.clubInvite(clubId)}
            icon={<ProfileIcon className="h-6 w-6" />}
            onClick={onDone}
          >
            Invite a rider
          </ContextMenuItem>
        )}
      </>
    )
  }

  if (canManage) {
    return (
      <ContextMenuItem
        href={routes.clubInvite(clubId)}
        icon={<ProfileIcon className="h-6 w-6" />}
        onClick={onDone}
      >
        Invite riders
      </ContextMenuItem>
    )
  }

  return null
}
