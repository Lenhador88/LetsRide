'use client'

import { useState } from 'react'
import { PaperPlaneIcon } from '@/components/icons/generated'
import { PostcardActionButton } from '@/components/postcards/PostcardAction'
import { routes } from '@/lib/routes'

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
 * The postcard route is behind the auth gate (decision #1), so a recipient who
 * is not signed in lands on the login screen rather than the card. That is the
 * intended behaviour, not a bug — there is no anonymous access anywhere.
 */
export function ShareButton({ postcardId }: { postcardId: string }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    // `window.location.origin` is still the origin, and in the native shell that
    // is `https://localhost` — a link that is dead the moment it is shared. That
    // is `design.md` §D7's separate problem and a separate change; PD-142 only
    // moved the **path**, which is now `/postcards/detail?id=…`. The old shape
    // survives as a `redirects()` entry in `next.config.ts` for links already in
    // people's messages, so nothing here may keep generating it.
    const url = `${window.location.origin}${routes.postcard(postcardId)}`

    if (navigator.share) {
      try {
        await navigator.share({ url, title: 'A postcard on LetsRide' })
        return
      } catch {
        // Dismissing the sheet rejects. That is not a failure worth reporting,
        // and it must not fall through to silently copying instead.
        return
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // No share sheet and no clipboard permission leaves nothing to do that the
      // rider cannot do themselves from the address bar.
    }
  }

  return (
    <PostcardActionButton
      onClick={share}
      label={copied ? 'Link copied' : 'Share this postcard'}
      icon={<PaperPlaneIcon className="h-6 w-6" />}
    />
  )
}
