'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BlockAccountIcon, OptionsIcon } from '@/components/icons/generated'
import { useBanner } from '@/components/ui/Banner'
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu'
import { blockRider } from '@/lib/actions/blocks'

/**
 * The viewed-profile header's overflow control — `view-rider-profile` Q3:
 * block only, reusing the existing `blockRider` action rather than a second
 * write path onto the same table. No report row: `009`/`011` build reporting
 * for a *postcard*, and there is no analogue of it for a rider's identity in
 * this change.
 *
 * A successful block makes this very screen's own read return zero rows the
 * instant `blockRider`'s blanket `invalidate(EVERYTHING)` refetches it — the
 * same "about to 404" shape `PostcardMenu` already navigates away from rather
 * than leaving the rider on a screen mid-collapse, so this does too.
 */
export function ProfileDetailMenu({
  subjectId,
  subjectName,
}: {
  subjectId: string
  subjectName: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const showBanner = useBanner()
  const router = useRouter()

  function onBlock() {
    setOpen(false)
    startTransition(async () => {
      const result = await blockRider(subjectId)
      if (result.error) {
        showBanner(result.error, 'error')
        return
      }
      showBanner('Account blocked')
      router.replace('/postcards')
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Options for ${subjectName}`}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors active:bg-border"
      >
        <OptionsIcon className="h-6 w-6" />
      </button>

      <ContextMenu open={open} onClose={() => setOpen(false)} label={`Options for ${subjectName}`}>
        <ContextMenuItem
          icon={<BlockAccountIcon className="h-6 w-6" />}
          disabled={pending}
          onClick={onBlock}
        >
          Block account
        </ContextMenuItem>
      </ContextMenu>
    </>
  )
}
