'use client'

import { useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  BlockAccountIcon,
  DeleteIcon,
  HideIcon,
  OptionsIcon,
  ReportIcon,
} from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { blockRider } from '@/lib/actions/blocks'
import { hidePostcard, reportPostcard } from '@/lib/actions/moderation'
import { deletePostcard } from '@/lib/actions/postcards'
import { REPORT_REASON_WHEN_UNDRAWN } from '@/lib/validation/comments'

/**
 * The postcard overflow menu — `Content / Context Menu / Postcard`
 * (`2303:5963`), reached from the card and confirmed by the three banner frames.
 *
 * Every action behind it was written for `011` and `009` and had **no caller at
 * all** until this component; that is the gap it closes. RLS owns every
 * authorization rule here, so nothing below re-checks who may hide, block,
 * report or delete.
 *
 * Two deviations from the design, both deliberate and both logged in
 * docs/FIGMA-FIDELITY-TODO.md §Postcard overflow menu:
 *
 * 1. **The design has no reason picker.** `Home / Report post` is marked Done
 *    and contains four frames — feed, sheet, banner — with no reason step, so
 *    reporting is one tap. The schema disagrees: `postcard_reports.reason` is a
 *    CHECK constraint and a Zod enum of six values. Reporting therefore sends
 *    `other`, which is the only value that does not assert something the rider
 *    never said. **The consequence is that the reason column carries no signal**
 *    until the designer adds the step.
 * 2. **The Delete row is not in the design.** The sheet is drawn for someone
 *    else's postcard, where Hide/Block/Report all make sense; on your own they
 *    do not. Delete is the product owner's call, uses the component set's real
 *    `Type=Warning` variant so the tone is not invented, and asks for a second
 *    tap because the action is irreversible and takes the Storage object with
 *    it. That confirm step is ours.
 */
export function PostcardMenu({
  postcardId,
  authorId,
  authorName,
  isOwn,
}: {
  postcardId: string
  authorId: string
  authorName: string
  isOwn: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [pending, startTransition] = useTransition()
  const showBanner = useBanner()
  const router = useRouter()
  const pathname = usePathname()

  /**
   * Hiding, blocking and deleting all make this postcard unreadable to this
   * viewer, so the thread route it may be showing on is about to 404: the
   * actions revalidate, `getPostcard` returns null, and the page calls
   * `notFound()` with no `not-found.tsx` anywhere to catch it. On the feed the
   * card simply disappears, which is correct; on the thread the rider has to be
   * taken somewhere. `createPostcard` sets the precedent by redirecting.
   */
  const onThisPostcardsThread = pathname === `/postcards/${postcardId}`

  function run(
    action: () => Promise<{ error: string | null }>,
    confirmation: string,
    { leavesTheThread = true }: { leavesTheThread?: boolean } = {}
  ) {
    // Closed before the request rather than after it. Waiting left the sheet
    // open with every row disabled and no pending affordance, which reads as a
    // tap that did not register.
    setOpen(false)
    setConfirmingDelete(false)

    startTransition(async () => {
      const result = await action()
      if (result.error) {
        showBanner(result.error, 'error')
        return
      }
      showBanner(confirmation)
      if (leavesTheThread && onThisPostcardsThread) router.replace('/postcards')
    })
  }

  function onReport() {
    const formData = new FormData()
    formData.append('postcardId', postcardId)
    formData.append('reason', REPORT_REASON_WHEN_UNDRAWN)
    // Reporting leaves the postcard visible — `011` records the report and
    // changes nothing about what the reporter can see — so this is the one row
    // that must not navigate away.
    run(() => reportPostcard({ error: null }, formData), 'Post reported', {
      leavesTheThread: false,
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={isOwn ? 'Postcard options' : `Options for ${authorName}’s postcard`}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-6 w-6" />
      </button>

      <ContextMenu
        open={open}
        onClose={() => {
          setOpen(false)
          setConfirmingDelete(false)
        }}
        label="Postcard options"
      >
        {isOwn ? (
          <ContextMenuItem
            icon={<DeleteIcon className="h-6 w-6" />}
            variant="warning"
            disabled={pending}
            onClick={() =>
              confirmingDelete
                ? run(() => deletePostcard(postcardId), 'Postcard deleted')
                : setConfirmingDelete(true)
            }
          >
            {confirmingDelete ? 'Tap again to delete' : 'Delete postcard'}
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem
              icon={<HideIcon className="h-6 w-6" />}
              disabled={pending}
              onClick={() => run(() => hidePostcard(postcardId), 'Postcard hidden')}
            >
              Hide postcard for me
            </ContextMenuItem>
            <ContextMenuItem
              icon={<BlockAccountIcon className="h-6 w-6" />}
              disabled={pending}
              onClick={() => run(() => blockRider(authorId), 'Account blocked')}
            >
              Block account
            </ContextMenuItem>
            <ContextMenuItem
              icon={<ReportIcon className="h-6 w-6" />}
              disabled={pending}
              onClick={onReport}
            >
              Report post
            </ContextMenuItem>
          </>
        )}
      </ContextMenu>

    </>
  )
}
