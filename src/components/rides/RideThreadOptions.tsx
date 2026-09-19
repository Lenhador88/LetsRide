'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DeleteIcon, OptionsIcon, ReportIcon } from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { moderateRideThread, reportRideThread } from '@/lib/actions/ride-threads'
import { routes } from '@/lib/routes'

/**
 * A ride thread's own ⋯ menu — `108`, PD-402, `ThreadOptions`'s shape one
 * domain over, with one row the club has that this one still does not.
 *
 * **No Edit row, and its absence is the enforcement rather than an omission.**
 * `108` grants no UPDATE and declares no UPDATE policy on either content table,
 * so a title cannot change; drawing an edit affordance would be a control that
 * always fails. The stated remedy for a thread a rider regrets is deletion and
 * re-creation, which the copy below says.
 *
 * **`Report thread` closes the deferral this component's header used to
 * name — `122`, PD-454.** `proposal.md` Q4 named the trigger for the
 * follow-up as App Store Review Guideline 1.2 wanting a report path on a new
 * UGC surface; that trigger is this change. Report is drawn for **every
 * viewer who is not the author**, which is also what makes the menu
 * structurally non-empty: `isAuthor` is a boolean, so either it is true — in
 * which case `Delete thread` (through one of `moderate_ride_thread`'s two
 * authority arms, below) always renders — or it is false — in which case
 * `Report thread` always renders. There is no third state, so no viewer this
 * component mounts for can see an empty sheet, and the caller's own mount
 * gate is gone with this change (`design.md` D11). The author never sees
 * `Report thread`: `122`'s policy would permit a self-report and the row
 * simply is not drawn for them — a menu row is a display hint, never an
 * authorization.
 *
 * **No share row.** `ClubShareOrInviteItem` exists because a club is a place a
 * rider can be invited into; a ride thread is not shareable to anyone who is not
 * already crew, so a share affordance would produce a link every recipient is
 * refused.
 *
 * ## One write behind `Delete thread`, with two authority arms
 *
 * Unlike the club — where an author deletes through `081`'s DELETE policy and a
 * moderator goes through an RPC — `108` gives `ride_threads` **no DELETE policy
 * and no DELETE grant at all**, so both paths are the one `security definer`
 * RPC. `public.moderate_ride_thread` re-checks `rides.organizer_id = auth.uid()
 * or ride_threads.author_id = auth.uid()` in its own body.
 *
 * That it is an RPC even for the author is the point rather than an
 * inefficiency: RLS filters a DELETE by what the caller may READ, so an
 * organizer who has blocked a thread's author cannot see that thread and a
 * policy-arm delete keyed on its id would match zero rows — silently, PostgREST
 * reporting success. `034` shipped exactly that gap and `102` deliberately left
 * its residual form open.
 *
 * **The authority is never `private.is_ride_crew`** (`design.md` D4): every
 * crew member being able to delete every other's thread is not moderation. Nor
 * is it the club's owner or admin — the resource is the ride, and a ride has no
 * admin role.
 *
 * **`Report thread` is a separate right the crew audience grants, never the
 * delete right in another shape.** `122`'s INSERT policy inherits the same
 * `rides` EXISTS + `private.is_ride_crew` + block conjunct `108`'s SELECT
 * carries, naming none of it again, so "may I report this" is "may I read
 * this" — and reporting a thread reaches nobody who can act on it in-app:
 * `private.ride_thread_report_queue` is revoked from every client role,
 * including `service_role` (`design.md` D5, the `076` question). One tap, a
 * banner, no confirm, no invalidation — reporting changes nothing the
 * reporter, the author or the organiser can read.
 */
export function RideThreadOptions({
  threadId,
  rideId,
  isAuthor,
  isOrganizer,
  onDeleted,
}: {
  threadId: string
  rideId: string
  isAuthor: boolean
  /** `rides.organizer_id === viewer` — the client half of
   *  `moderate_ride_thread`'s other authority arm. Passed rather than computed
   *  here so the expression is written once, at the call site that already
   *  holds the ride. */
  isOrganizer: boolean
  /**
   * Called once the RPC has actually succeeded, before the navigation away —
   * PD-381's shape. `moderateRideThread` invalidates this thread's own query
   * key as part of the same call, and that invalidation can refetch and resolve
   * to `null` for a screen that is, at that instant, still mounted. The
   * `router.replace` below is what is *supposed* to win that race by running
   * synchronously the moment this async callback resumes, but it is a race
   * rather than a guarantee, and the screen's `notFound()` on `null` turns a
   * lost one into a full error page over a delete that actually succeeded.
   */
  onDeleted?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const showBanner = useBanner()
  const router = useRouter()

  function openDeleteConfirm() {
    // Close the first sheet before opening the second: both render through one
    // fixed z-index stack and `ContextMenu`'s focus trap assumes it is the only
    // one open.
    setOpen(false)
    setDeleteError(null)
    setConfirmingDelete(true)
  }

  function onConfirmDelete() {
    startTransition(async () => {
      const result = await moderateRideThread(threadId, rideId)

      if (result.error) {
        setDeleteError(result.error)
        return
      }
      // Before the invalidation can be observed on this screen — see
      // `onDeleted`'s own header.
      onDeleted?.()
      setConfirmingDelete(false)
      showBanner('Thread deleted')
      // `replace`, not `push`: the thread this was invoked from no longer
      // exists, so Back must not return to a screen that now 404s.
      router.replace(routes.ride(rideId))
    })
  }

  function onReport() {
    setOpen(false)
    startTransition(async () => {
      const result = await reportRideThread(threadId)
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
        <RideThreadOptionsRows
          isAuthor={isAuthor}
          isOrganizer={isOrganizer}
          pending={pending}
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
          <RideThreadDeleteConfirmation
            isAuthor={isAuthor}
            isOrganizer={isOrganizer}
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
 * Whether this viewer may delete the thread — the display hint for the
 * `Delete thread` row, and (until this change) the caller's own mount gate
 * too.
 *
 * **It mirrors `moderate_ride_thread`'s two authority arms and must keep
 * mirroring them.** It is a display hint and never the authorization: the RPC
 * re-checks both arms in its own body, so a rider who reaches the call some
 * other way is still refused.
 *
 * **No longer the mount gate — `122`, PD-454, `design.md` D11.** With `Report
 * thread` drawn for every non-author, `RideThreadOptionsRows` is structurally
 * non-empty for every viewer (see that component's own header), so gating the
 * menu's mount on this expression would have kept a condition that is always
 * true for a reason the next reader could no longer see. `thread/page.tsx`
 * mounts `RideThreadOptions` once the thread, the ride and the viewer's
 * profile have all arrived, and nothing more; this expression's only job now
 * is deciding the delete row.
 */
export function canRemoveRideThread({
  isAuthor,
  isOrganizer,
}: {
  isAuthor: boolean
  isOrganizer: boolean
}): boolean {
  return isAuthor || isOrganizer
}

/**
 * The rows themselves, apart from the state and handlers so they can be
 * rendered — and tested — without the `<ContextMenu>` wrapper, which returns
 * `null` under `renderToStaticMarkup` (no `document`) whatever `open` is.
 * `ThreadOptionsRows` is the precedent for pulling a menu's rows out from behind
 * that sheet for exactly this reason.
 *
 * **This is the whole of the D11 viewer × row table**: `!isAuthor` draws
 * `Report thread`, `canRemoveRideThread({ isAuthor, isOrganizer })` draws
 * `Delete thread`, and because `isAuthor` is a boolean, at least one of the
 * two is always true — this component structurally cannot render nothing.
 */
export function RideThreadOptionsRows({
  isAuthor,
  isOrganizer,
  pending,
  onReport,
  onDeleteClick,
}: {
  isAuthor: boolean
  isOrganizer: boolean
  pending: boolean
  onReport: () => void
  onDeleteClick: () => void
}) {
  return (
    <>
      {!isAuthor && (
        <ContextMenuItem
          icon={<ReportIcon className="h-6 w-6" />}
          disabled={pending}
          onClick={onReport}
        >
          Report thread
        </ContextMenuItem>
      )}

      {canRemoveRideThread({ isAuthor, isOrganizer }) && (
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
 * The confirm sheet behind the delete row — `docs/reference/design-system.md`
 * §The ⋯ options menu: a delete whose confirmation must *name the collateral*
 * opens a second `ContextMenu` rather than a second tap in place.
 *
 * Different copy for the two arms, because removing your own thread and
 * removing somebody else's are different acts even though both destroy the same
 * collateral — every message in the thread, other riders' included, which the
 * spec requires be disclosed in the confirmation rather than discovered.
 *
 * **The author arm is checked first**, so an organizer deleting their own thread
 * reads the narrower sentence rather than being told they are moderating
 * themselves.
 */
function RideThreadDeleteConfirmation({
  isAuthor,
  isOrganizer,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  isAuthor: boolean
  isOrganizer: boolean
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">
        {isAuthor
          ? 'This deletes the thread and every message in it, including replies from other riders. This cannot be undone.'
          : isOrganizer
            ? "This deletes another rider's thread and every message in it. This cannot be undone."
            : 'This deletes the thread and every message in it. This cannot be undone.'}
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
