'use client'

import { useState } from 'react'
import { PaperPlaneIcon } from '@/components/icons/generated'
import { PostcardActionButton } from '@/components/postcards/PostcardAction'
import { routes } from '@/lib/routes'
import { shareAppLink } from '@/lib/share'

/**
 * The design's third action (`Type=Share`, `Element / Icon / Paper Plane`).
 *
 * **This shares a link; it does not repost.** CLAUDE.md records shares as out of
 * scope precisely because "share" was undefined between a native share sheet and
 * a repost, and a repost is a feature with its own table and audience rules. The
 * sheet is the reading that needs no schema and stays reversible: nothing is
 * recorded, so choosing the other meaning later costs nothing here.
 *
 * That is also why no count is rendered. The design shows one, but a count needs
 * something recorded to count, and inventing a number would be worse than an
 * honest omission.
 *
 * **This stays a peer button rather than becoming a row in `PostcardMenu`**, and
 * it is the one deliberate exception to PD-280's ⋯ convention — settled by the
 * product owner on 2026-08-24. Every other surface puts its actions behind the
 * dots; a postcard's action row is a scrolling feed row rather than a detail
 * header, and share is worth one tap there. Do not "fix" the inconsistency.
 *
 * The mechanics — which origin, sheet or clipboard, what a dismissal means —
 * are `shareAppLink`'s, shared with the ride and club menus since PD-280. The
 * **path** is `/postcards/detail?id=…` since PD-142; the old shape survives as
 * a `redirects()` entry in `next.config.ts` for links already in people's
 * messages, so nothing here may keep generating it.
 */
export function ShareButton({ postcardId }: { postcardId: string }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const outcome = await shareAppLink(routes.postcard(postcardId), 'A postcard on LetsRide')
    if (outcome !== 'copied') return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <PostcardActionButton
      onClick={share}
      label={copied ? 'Link copied' : 'Share this postcard'}
      icon={<PaperPlaneIcon className="h-6 w-6" />}
    />
  )
}
