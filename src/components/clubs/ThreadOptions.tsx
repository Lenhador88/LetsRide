'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DeleteIcon, OptionsIcon, ReportIcon } from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { ClubShareOrInviteItem } from '@/components/clubs/ClubShareOrInviteItem'
import {
  deleteClubThread,
  moderateClubThread,
  reportClubThread,
} from '@/lib/actions/club-threads'
import { routes } from '@/lib/routes'
import type { ClubDetail } from '@/types'

/**
 * The thread's own ⋯ menu — `ClubShareOrInviteItem`, moderation and reporting
 * for who may, extracted out of `thread/page.tsx` (`094`, PD-348) so it can be
 * tested the way every other options menu in this app is (`ClubOptionsMenu`,
 * `RideOptionsMenu`, `PostcardMenu`), rather than as an unexported function a
 * test can only reach by importing a route module.
 *
 * **No Edit row, and its absence is the enforcement rather than an omission.**
 * `081` grants no UPDATE and declares no UPDATE policy on either content table,
 * so a title cannot change; drawing an edit affordance would be a control that
 * always fails. The stated remedy for a thread a rider regrets is deletion and
 * re-creation.
 *
 * **`Report thread` closes a hole `093` opened.** `ClubShareOrInviteItem`
 * renders nothing for a private club's ordinary member — before this change
 * that left exactly that viewer's ⋯ menu with nothing in it at all, an empty
 * sheet behind a dots icon, which this component's own convention says is
 * worse than the icon's absence. Report is drawn for **every viewer who is
 * not the author**, which is also what makes the menu structurally
 * non-empty: `isAuthor` is a boolean, so either it is true — in which case
 * `Delete thread` (the author's own, through `081`'s policy) always renders —
 * or it is false — in which case `Report thread` always renders. There is no
 * third state, so no viewer this component mounts for can see an empty sheet.
 * The author never sees `Report thread`: the policy would permit a
 * self-report (`design.md` D11) and the row simply is not drawn for them —
 * a menu row is a display hint, never an authorization.
 *
 * **Two different writes behind `Delete thread`**, because they are two
 * different rights: an author deletes through `081`'s DELETE policy, while
 * the **club owner or admin** goes through `moderate_club_thread` — a
 * `security definer` RPC, because RLS filters a DELETE by what the caller may
 * READ and a moderator who blocked the author cannot see the row, so a
 * policy-arm delete would match zero rows and report success. `canModerate`
 * is `viewer_is_owner || viewer_role === 'admin'` (`094`, widening
 * `moderate_club_thread` to `private.is_club_admin_for`) — **not**
 * `viewer_role === 'owner' || …`, which would drop an owner holding no
 * roster row (`design.md` D2, the same trap `ClubOptionsMenu`'s own
 * `canManage` avoids).
 *
 * **Both delete rows share one confirm sheet** (`design.md` Q4, default yes):
 * today's single-tap-no-confirmation delete took every message in the thread
 * with it and said nothing about it first. `DeleteRideSheet` /
 * `DeleteClubSheet` are the models — close the first `ContextMenu` before
 * opening the second (`docs/reference/design-system.md` §The ⋯ options menu).
 * `Report thread` does not confirm: it is not destructive, and follows
 * `PostcardMenu.onReport` — one tap, a banner, no navigation, because
 * reporting changes nothing the reporter can see.
 */
export function ThreadOptions({
  threadId,
  clubId,
  isAuthor,
  isPublic,
  viewerRole,
  isOwner,
  canModerate,
}: {
  threadId: string
  clubId: string
  isAuthor: boolean
  isPublic: boolean
  viewerRole: ClubDetail['viewer_role']
  isOwner: boolean
  /**
   * `viewer_is_owner || viewer_role === 'admin'` — the client half of
   * `private.is_club_admin_for`, the predicate `094` widens
   * `moderate_club_thread` to. Passed rather than computed here so the one
   * expression is written once, at the call site that already holds both
   * halves of it.
   */
  canModerate: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const showBanner = useBanner()
  const router = useRouter()

  function openDeleteConfirm() {
    // Close the first sheet before opening the second: both render through
    // one fixed z-index stack and `ContextMenu`'s focus trap assumes it is
    // the only one open.
    setOpen(false)
    setDeleteError(null)
    setConfirmingDelete(true)
  }

  function onConfirmDelete() {
    startTransition(async () => {
      // The author's own delete first: it is the narrower right, and an owner
      // or admin who also authored the thread reaches the same outcome
      // through it. `moderate_club_thread` is the moderator's path to
      // somebody ELSE's thread, and it must not be the path to their own — a
      // definer function is the wider hammer, so the policy is used wherever
      // it suffices.
      const result = isAuthor
        ? await deleteClubThread(threadId, clubId)
        : await moderateClubThread(threadId, clubId)

      if (result.error) {
        setDeleteError(result.error)
        return
      }
      setConfirmingDelete(false)
      showBanner('Thread deleted')
      // `replace`, not `push`: the thread this was invoked from no longer
      // exists, so Back must not return to a screen that now 404s.
      router.replace(routes.clubThreads(clubId))
    })
  }

  function onReport() {
    setOpen(false)
    startTransition(async () => {
      const result = await reportClubThread(threadId)
      if (result.error) {
        showBanner(result.error, 'error')
        return
      }
      showBanner('Thread reported')
      // No navigation: reporting leaves the thread exactly where it was and
      // changes nothing the reporter can see, matching `PostcardMenu.onReport`.
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Thread options"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-6 w-6" />
      </button>

      <ContextMenu open={open} onClose={() => setOpen(false)} label="Thread options">
        <ThreadOptionsRows
          clubId={clubId}
          isPublic={isPublic}
          viewerRole={viewerRole}
          isOwner={isOwner}
          isAuthor={isAuthor}
          canModerate={canModerate}
          pending={pending}
          onShareDone={() => setOpen(false)}
          onReport={onReport}
          onDeleteClick={openDeleteConfirm}
        />
      </ContextMenu>

      <ContextMenu
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        label="Delete this thread"
      >
        <div className="p-2">
          <ThreadDeleteConfirmation
            isAuthor={isAuthor}
            pending={pending}
            error={deleteError}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={onConfirmDelete}
          />
        </div>
      </ContextMenu>
    </>
  )
}

/**
 * The rows themselves, apart from `ThreadOptions`'s state and handlers so
 * they can be rendered — and tested — without the `<ContextMenu>` wrapper,
 * which returns `null` under `renderToStaticMarkup` (no `document`) whatever
 * `open` is. `ClubShareOrInviteItem.test.tsx` is the precedent for pulling a
 * menu's rows out from behind that sheet for exactly this reason.
 *
 * **This is the whole of the D10 viewer × row table**: `!isAuthor` draws
 * `Report thread`, `isAuthor || canModerate` draws `Delete thread`, and
 * because `isAuthor` is a boolean, at least one of the two is always true —
 * this component structurally cannot render nothing.
 */
export function ThreadOptionsRows({
  clubId,
  isPublic,
  viewerRole,
  isOwner,
  isAuthor,
  canModerate,
  pending,
  onShareDone,
  onReport,
  onDeleteClick,
}: {
  clubId: string
  isPublic: boolean
  viewerRole: ClubDetail['viewer_role']
  isOwner: boolean
  isAuthor: boolean
  canModerate: boolean
  pending: boolean
  onShareDone: () => void
  onReport: () => void
  onDeleteClick: () => void
}) {
  return (
    <>
      <ClubShareOrInviteItem
        clubId={clubId}
        isPublic={isPublic}
        viewerRole={viewerRole}
        isOwner={isOwner}
        onDone={onShareDone}
      />

      {!isAuthor && (
        <ContextMenuItem
          icon={<ReportIcon className="h-6 w-6" />}
          disabled={pending}
          onClick={onReport}
        >
          Report thread
        </ContextMenuItem>
      )}

      {(isAuthor || canModerate) && (
        <ContextMenuItem
          icon={<DeleteIcon className="h-6 w-6" />}
          variant="warning"
          disabled={pending}
          onClick={onDeleteClick}
        >
          Delete thread
        </ContextMenuItem>
      )}
    </>
  )
}

/**
 * The confirm sheet behind BOTH delete rows — `docs/reference/design-system.md`
 * §The ⋯ options menu: a delete whose confirmation must *name the collateral*
 * opens a second `ContextMenu` rather than a second tap in place. Different
 * copy for the two callers (`design.md` Q4), because deleting your own thread
 * and moderating somebody else's are different acts even though both destroy
 * the same collateral — every message in the thread, and the reports filed
 * against it.
 */
function ThreadDeleteConfirmation({
  isAuthor,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  isAuthor: boolean
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">
        {isAuthor
          ? 'This deletes the thread and every message in it. This cannot be undone.'
          : 'This deletes the thread, every message in it, and any reports filed against it. This cannot be undone.'}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={onCancel}
          disabled={pending}
        >
          Keep thread
        </Button>
        <Button
          type="button"
          variant="danger"
          className="flex-1"
          onClick={onConfirm}
          loading={pending}
        >
          Delete thread
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
