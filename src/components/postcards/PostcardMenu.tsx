'use client'

import { useState, useTransition } from 'react'
import {
  BlockAccountIcon,
  DeleteIcon,
  HideIcon,
  OptionsIcon,
  ReportIcon,
} from '@/components/icons/generated'
import { Banner } from '@/components/ui/Banner'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { blockRider } from '@/lib/actions/blocks'
import { hidePostcard, reportPostcard } from '@/lib/actions/moderation'
import { deletePostcard } from '@/lib/actions/postcards'
import { REPORT_REASON_WHEN_UNDRAWN } from '@/lib/validation/comments'

/**
 * The postcard overflow menu — `Content / Context Menu / Postcard`
 * (`2303:5676`), reached from the card and confirmed by the three banner frames.
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
  const [banner, setBanner] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ error: string | null }>, confirmation: string) {
    startTransition(async () => {
      const result = await action()
      setOpen(false)
      setConfirmingDelete(false)
      if (result.error) setError(result.error)
      else setBanner(confirmation)
    })
  }

  function onReport() {
    const formData = new FormData()
    formData.append('postcardId', postcardId)
    formData.append('reason', REPORT_REASON_WHEN_UNDRAWN)
    run(() => reportPostcard({ error: null }, formData), 'Post reported')
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

      {banner && <Banner message={banner} onDismiss={() => setBanner(null)} />}
      {/* A failure reuses the banner rather than adding a second component, but
          not its tone — the design draws no error state for this flow, and a
          refusal reported under a green tick would be worse than an undrawn
          one. Silently doing nothing is the only definitely-wrong outcome. */}
      {error && <Banner message={error} tone="error" onDismiss={() => setError(null)} />}
    </>
  )
}
