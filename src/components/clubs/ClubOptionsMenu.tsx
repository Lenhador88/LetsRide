'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChatBubbleIcon,
  DeleteIcon,
  EditIcon,
  LogOutIcon,
  OptionsIcon,
  ProfileIcon,
} from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { NotificationDot } from '@/components/ui/NotificationDot'
import { DeleteClubSheet } from '@/components/clubs/DeleteClubControl'
import { ClubShareOrInviteItem } from '@/components/clubs/ClubShareOrInviteItem'
import {
  CLUB_NEEDS_ANOTHER_ADMIN_MESSAGE,
  leaveClub,
  leaveOwnedClub,
} from '@/lib/actions/clubs'
import { getClubThreadUnread } from '@/lib/data/club-threads'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'
import { routes } from '@/lib/routes'
import type { ClubDetail } from '@/types'

/**
 * `design.md` Q4(a)/(c)'s default, product owner's own words — the reason
 * shown on `DeleteClubSheet` when the roster the owner can already see holds
 * nobody else. UI copy, not a database message, so it lives here rather than
 * beside `leave_owned_club`'s own strings in `lib/actions/clubs.ts`.
 */
const CLUB_ONLY_RIDER_LEAVE_REASON = 'You are the only rider here — leaving deletes this club.'

/**
 * The club detail header's dots menu — `AI / Club detail merged / 2026-08-17`,
 * frames `4181:6897` (owner, Options open) and `4181:6930` (member, Options
 * open). Product owner, 2026-08-17: *"If owner we show the pencil, that also
 * goes to an option udner \[sic] the dots."* Replaces `ClubDetailPageMenu`'s
 * sub-page switcher in the header's `action` slot — the same move `RideHeader`
 * made when its own switcher was deleted (PD-254).
 *
 * `ClubShareOrInviteItem` for everyone who can open it (`093`, PD-360), then
 * one branch by viewer role:
 *
 * - **`Share club` / `Invite riders`** (PD-280, split by visibility in `093`) —
 *   `ClubShareOrInviteItem` owns the branch: a public club gets `Share club`
 *   plus `Invite a rider` for a member, a private club's owner or admin gets
 *   `Invite riders`, and a private club's ordinary member gets neither. See
 *   that component's own docstring for why the row used to be a live defect
 *   on a private club and why the branch could not live here a second time.
 * - **Owner** → `Edit club`, into `routes.clubEdit`. What used to be the
 *   header's standalone pencil `Link`, now inside this sheet instead of beside
 *   it — plus `Delete club` below it.
 * - **Member** → `Threads`, into `routes.clubThreads`. **This is the club's
 *   only reliable entrance to its own thread list**, and it is here rather than
 *   on the page because the product owner removed the row that used to carry it
 *   (2026-08-31). The timeline's foot link is not a substitute: it renders only
 *   when the stream is cut, so a club whose whole timeline fits on screen would
 *   have no entrance at all — PD-125's defect, which the deleted row existed to
 *   close. A member-only row for the same reason `ClubCreateBar` is
 *   member-only: `081` admits nobody else to a club's threads.
 * - **Owner or admin** → `Manage riders` (`088`, PD-326), into
 *   `routes.clubManage`. **This is the only entrance to that screen**, which is
 *   why the row is gated on the same disjunction the screen and
 *   `private.is_club_admin_for` both use — `viewer_is_owner || viewer_role ===
 *   'admin'`, never the role alone. PD-125 shipped a screen nobody could reach;
 *   an entrance drawn for the wrong set is the same defect one step down.
 * - **Member, not owner** (an `admin` also gets `Manage riders` above) →
 *   `Leave club`, warning tone.
 *   This is where leaving lives now that `/clubs/detail/about` dissolves; it
 *   calls `leaveClub` directly rather than mounting `ClubMembershipButton`
 *   (a full-width `Button`, not a menu row) — the reused part is the *action*,
 *   not the component.
 * - **Owner** also gets `Leave club`, beside `Delete club` in the same
 *   destructive group (`095`, PD-194). **The database decides which of the
 *   three arms applies; this component only picks which affordance to try
 *   first, from a roster count that is a FLOOR under RLS** (`design.md` §D7)
 *   — `membersCount - (viewerRole !== null ? 1 : 0)`, the `-1` only when the
 *   owner holds their own roster row, since an ownerless owner (`054`,
 *   PD-128) does not. If that count sees nobody else, the sheet opens
 *   directly with the product owner's own words; otherwise `leaveOwnedClub`
 *   is called and the sheet is the fallback if it refuses. **The client
 *   never tries to tell arm 2 (no other members) from arm 3 (members, no
 *   admin) apart** — the database collapses both into one message
 *   (`CLUB_NEEDS_ANOTHER_ADMIN_MESSAGE`) precisely so an owner blocked with
 *   their club's only member cannot infer that a member exists whom they
 *   cannot see, and inventing a second, more specific string here would
 *   reopen exactly that leak. See `onOwnerLeave` below.
 *
 * - **Non-member of a PUBLIC club** → `Share club` and nothing else. This used
 *   to be no menu at all, because every other row was a member's and an empty
 *   sheet behind a dots icon is worse than the icon's absence. `Share club` is
 *   precisely the row a non-member wants, so the sheet is no longer empty for
 *   them — and `Leave club` must not be offered to somebody who is not in the
 *   club, which is why this takes `viewerRole` rather than the `isOwner`
 *   boolean it used to: a two-state prop cannot tell a member from a stranger,
 *   and the false branch would have offered them Leave.
 * - **Non-member of a PRIVATE club never mounts this menu at all** — `clubs`
 *   SELECT refuses the row, so `ClubDetailHeader` never draws the dots for
 *   them and the club page renders `ClubPreviewScreen` instead. The state
 *   `ClubShareOrInviteItem` renders nothing for in practice is a private
 *   club's ordinary MEMBER, who does reach this menu.
 *
 * **`Delete club` is BUILT as of PD-280, reversing this file's own deliberate
 * omission** — `docs/FIGMA-FIDELITY-TODO.md` §Club detail carries what was
 * argued and what the owner decided. The row opens `DeleteClubSheet` rather
 * than deleting, which is the general rule in
 * `docs/reference/design-system.md` §The ⋯ options menu.
 *
 * **Join is not here either.** A non-member sees `ClubMembershipButton`
 * inline on the page instead — a constructive action stays visible, only the
 * destructive one is tucked away.
 */
export function ClubOptionsMenu({
  clubId,
  isPublic,
  viewerRole,
  isOwner,
  membersCount,
}: {
  clubId: string
  /** `ClubDetail.is_public` — `093`, PD-360. Decides `ClubShareOrInviteItem`'s
   * branch and nothing else here. */
  isPublic: boolean
  /** The viewer's own `club_members.role`, or null for a non-member. */
  viewerRole: ClubDetail['viewer_role']
  /**
   * `ClubDetail.viewer_is_owner` — `clubs.owner_id`, NOT `viewer_role ===
   * 'owner'`. Two props for what looks like one question because the two
   * answers can differ: `043`'s `delete_owned_club` gates on the column, and an
   * owner who holds no roster row is a state `enforce-creator-membership` calls
   * reachable on demand. Gating the destructive row on the role would hide it
   * from the one owner who most needs it.
   */
  isOwner: boolean
  /**
   * `ClubDetail.members_count` — `095`, PD-194. The whole roster, including
   * the viewer's own row if they hold one. Used **only** to pick which
   * affordance the owner's `Leave club` row tries first — never to decide
   * which of the three arms applies, which is the database's call alone
   * (`design.md` §D7: every roster count a client can hold is a floor under
   * `009`'s block predicate, so it can undercount and must never be trusted
   * to overcount).
   */
  membersCount: number
}) {
  const isMember = viewerRole !== null
  // The same disjunction `ClubManageRidersPage` and `private.is_club_admin_for`
  // use. `viewer_is_owner` is the column on `clubs`, not the roster row, so an
  // owner holding no `club_members` row still gets the entrance (PD-280).
  const canManage = isOwner || viewerRole === 'admin'
  // A floor, not a fact (see the prop's own comment). Subtracts the owner's
  // OWN roster row only when they hold one — an ownerless owner (`054`,
  // PD-128) has none, so `membersCount` already excludes them.
  const otherMembersCount = membersCount - (viewerRole !== null ? 1 : 0)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteReason, setDeleteReason] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()
  const showBanner = useBanner()
  const router = useRouter()

  /**
   * The aggregate unread mark, read **only while the sheet is open**.
   *
   * This menu is in `ClubDetailHeader`, which every club sub-page mounts — so
   * an always-on read would cost `/clubs/detail/rides`, `/members` and
   * `/manage` a round trip apiece for a dot nobody is looking at. Gated on
   * `open`, it is free on the club detail (`ClubTimeline` already holds this
   * exact key, so the cache answers) and one read elsewhere, at the moment the
   * rider asks.
   *
   * It fails to nothing: `getClubThreadUnread` resolves to `{}` on a failure,
   * so the row is an entrance before it is a summary.
   *
   * **The expression below is unchanged by PD-372; its INPUT narrowed.** The
   * map now answers only for threads the Threads list can show, so this dot
   * clears by visiting where it points — an unread comment on a club
   * introduction is drawn on the announcement's own join row on the timeline,
   * not here. This is the only aggregate unread dot left in the app, which is
   * what made the narrowing that function's business rather than this one's.
   */
  const unread = useQuery(open && isMember ? queryKeys.clubs.threadsUnread(clubId) : null, () =>
    getClubThreadUnread(clubId)
  )
  const hasUnread = Object.values(unread.data ?? {}).some(Boolean)

  function onLeave() {
    setOpen(false)
    startTransition(async () => {
      const result = await leaveClub(clubId)
      if (result.error) {
        showBanner(result.error, 'error')
        return
      }
      showBanner('Left the club')
      // Leaving is the one action that can take the screen it was invoked from
      // away: the clubs SELECT policy is `is_public OR owner_id = auth.uid() OR
      // is_club_member(id)`, so for a private club the invalidated refetch
      // answers null and the page's `notFound()` fires — a success banner over
      // a Not Found. `replace` rather than `push`, so back does not return to
      // the club that just became unreadable.
      router.replace('/clubs')
    })
  }

  /**
   * The OWNER's own `Leave club` — `095`, PD-194. Two branches, and the
   * database always has the final word:
   *
   * 1. **The roster this screen already holds sees nobody else.** A floor,
   *    per `membersCount`'s own comment — it can undercount (a blocked admin
   *    is invisible to it) but never overcount, so acting on "zero others
   *    visible" never sends a rider who genuinely has a successor to the
   *    delete sheet: `leave_owned_club` would have transferred for them just
   *    the same, this only skips a round trip that would have refused.
   * 2. **`leaveOwnedClub` is called, and it refuses.** `design.md` §D1: the
   *    database found no successor. The self-correcting path is the SAME
   *    `DeleteClubSheet`, carrying the RPC's own
   *    `CLUB_NEEDS_ANOTHER_ADMIN_MESSAGE` — never a client-invented "arm 2"
   *    or "arm 3" string, because the database already collapsed both into
   *    one message so that an owner blocked with their club's only member
   *    cannot infer a hidden member exists (§D7). **This is also why this
   *    function does not, and must not, try to tell those two refusals
   *    apart from the RPC's response** — there is nothing in the response
   *    that safely lets it, and asking the database directly (a privileged,
   *    unfiltered roster count) is the exact leak §D7 refuses to build.
   *    The `is_default` refusal is the one this club can never leave by any
   *    route, so it only banners.
   */
  function onOwnerLeave() {
    setOpen(false)

    if (otherMembersCount <= 0) {
      setDeleteReason(CLUB_ONLY_RIDER_LEAVE_REASON)
      setDeleting(true)
      return
    }

    startTransition(async () => {
      const result = await leaveOwnedClub(clubId)
      if (result.error) {
        if (result.error === CLUB_NEEDS_ANOTHER_ADMIN_MESSAGE) {
          setDeleteReason(result.error)
          setDeleting(true)
          return
        }
        showBanner(result.error, 'error')
        return
      }
      showBanner('Left the club')
      // Same reasoning as the member's own `onLeave` above, restated because
      // a successful TRANSFER also makes a private club unreadable to the
      // rider who just handed it off.
      router.replace('/clubs')
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Club options"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-6 w-6" />
      </button>

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Club options">
        <ClubShareOrInviteItem
          clubId={clubId}
          isPublic={isPublic}
          viewerRole={viewerRole}
          isOwner={isOwner}
          onDone={() => setOpen(false)}
        />

        {isMember && (
          <ContextMenuItem
            href={routes.clubThreads(clubId)}
            icon={<ChatBubbleIcon className="h-6 w-6" />}
            // The dot is `aria-hidden` by construction, so the unread state
            // reaches a screen reader only if it is in words — the same rule
            // the deleted `ClubThreadsRow` carried.
            aria-label={hasUnread ? 'Threads, unread messages' : undefined}
            onClick={() => setOpen(false)}
          >
            {/* No count. `getClubThreads` returns a PAGE of 20, so a club with
                forty-five threads would render "Threads · 20" as a fact. The
                list one tap away has the pagination to be honest about it. */}
            Threads
            {hasUnread && <NotificationDot className="ml-2 inline-block align-middle" />}
          </ContextMenuItem>
        )}

        {canManage && (
          <ContextMenuItem
            href={routes.clubManage(clubId)}
            icon={<ProfileIcon className="h-6 w-6" />}
            onClick={() => setOpen(false)}
          >
            Manage riders
          </ContextMenuItem>
        )}

        <ClubDestructiveRows
          clubId={clubId}
          isOwner={isOwner}
          isMember={isMember}
          pending={pending}
          onEditClick={() => setOpen(false)}
          onOwnerLeave={onOwnerLeave}
          onLeave={onLeave}
          onDeleteClick={() => {
            // Closed before the next opens — see `RideOptionsMenu` for why two
            // `ContextMenu`s must not be open at once.
            setOpen(false)
            setDeleteReason(undefined)
            setDeleting(true)
          }}
        />
      </ContextMenu>

      <DeleteClubSheet
        clubId={clubId}
        open={deleting}
        onClose={() => {
          setDeleting(false)
          setDeleteReason(undefined)
        }}
        reason={deleteReason}
      />
    </>
  )
}

/**
 * The owner's `Edit club` / `Leave club` / `Delete club` group, and the
 * non-owner member's `Leave club`, apart from `ClubOptionsMenu`'s state so
 * they can be rendered — and tested — without the `<ContextMenu>` wrapper,
 * which returns `null` under `renderToStaticMarkup` (no `document`) whatever
 * `open` is. `ThreadOptionsRows` and `ClubShareOrInviteItem` are the
 * precedent for pulling a menu's rows out from behind that sheet for exactly
 * this reason.
 */
export function ClubDestructiveRows({
  clubId,
  isOwner,
  isMember,
  pending,
  onEditClick,
  onOwnerLeave,
  onLeave,
  onDeleteClick,
}: {
  clubId: string
  isOwner: boolean
  isMember: boolean
  pending: boolean
  onEditClick: () => void
  onOwnerLeave: () => void
  onLeave: () => void
  onDeleteClick: () => void
}) {
  return isOwner ? (
    <>
      <ContextMenuItem
        href={routes.clubEdit(clubId)}
        icon={<EditIcon className="h-6 w-6" />}
        onClick={onEditClick}
      >
        Edit club
      </ContextMenuItem>

      {/* Its own group, as `ProfileMenu` separates Delete account from
          Sign out — a destructive row should not read as the next item in a
          list of ordinary ones. `Leave club` joins it here (`095`, PD-194):
          both rows in this group can end with the owner no longer holding
          the club, so both wear the warning tone. */}
      <div className="mt-2 border-t border-border pt-2">
        <ContextMenuItem
          icon={<LogOutIcon className="h-6 w-6" />}
          variant="warning"
          disabled={pending}
          onClick={onOwnerLeave}
        >
          Leave club
        </ContextMenuItem>
        <ContextMenuItem
          icon={<DeleteIcon className="h-6 w-6" />}
          variant="warning"
          onClick={onDeleteClick}
        >
          Delete club
        </ContextMenuItem>
      </div>
    </>
  ) : (
    isMember && (
      <ContextMenuItem
        icon={<LogOutIcon className="h-6 w-6" />}
        variant="warning"
        disabled={pending}
        onClick={onLeave}
      >
        Leave club
      </ContextMenuItem>
    )
  )
}
