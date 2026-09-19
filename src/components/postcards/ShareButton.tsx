'use client'

import { useState } from 'react'
import { PaperPlaneIcon } from '@/components/icons/generated'
import { PostcardActionButton } from '@/components/postcards/PostcardAction'
import { composeShareCard, type ShareCardSource } from '@/lib/postcards/shareCard'
import { routes } from '@/lib/routes'
import { shareAppLink, shareImageFile } from '@/lib/share'

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
 *
 * ## It shares an IMAGE first, and the link is the fallback (PD-451)
 *
 * A link is the thing a recipient cannot open: every path this app can share
 * is behind the auth gate (decision #1), so a friend without an account lands
 * on the login screen, and pasted into a chat app it unfurls with
 * `layout.tsx`'s generic `og:image` rather than the rider's photo. An image
 * needs neither an account nor a tap.
 *
 * **The fallback is the old behaviour exactly, and it is reached on every
 * failure** — a signed URL that expired, a device whose share sheet will not
 * take a file, a browser with no canvas. The three outcomes and the three
 * labels below are unchanged, so nothing about what the rider is told depends
 * on which path ran. That is deliberate: the image is better when it works and
 * the link is never worse than it was.
 *
 * **This is the half a session can verify.** The composition is unit-tested;
 * whether iOS's sheet accepts the file is device-only, the same verification
 * boundary the push epic has.
 */
export function ShareButton({ postcard }: { postcard: ShareCardSource & { id: string } }) {
  const [notice, setNotice] = useState<'copied' | 'unavailable' | null>(null)

  async function share() {
    try {
      const blob = await composeShareCard(postcard)
      // The name is what several platforms show beside the attachment and what
      // a save-to-files lands as, so it is a filename rather than an id.
      const file = new File([blob], 'letsride-postcard.jpg', { type: 'image/jpeg' })
      if ((await shareImageFile(file, 'A postcard on LetsRide')) === 'shared') return
    } catch {
      // Composing or fetching failed. There is nothing to tell the rider that
      // the link path is not about to handle, and a "could not build an image"
      // banner would report an implementation detail of a button whose job is
      // to share something.
    }

    const outcome = await shareAppLink(routes.postcard(postcard.id), 'A postcard on LetsRide')
    // A native share is its own feedback and a dismissal is not a failure, so
    // only the two outcomes the rider cannot see for themselves say anything.
    // The menus raise a banner for these; this control has no banner to raise
    // and its label is the affordance, so it says it there — the same two
    // outcomes reported, in the idiom of the surface.
    if (outcome === 'shared') return
    setNotice(outcome)
    window.setTimeout(() => setNotice(null), 2000)
  }

  const label =
    notice === 'copied'
      ? 'Link copied'
      : notice === 'unavailable'
        ? 'Could not share the link'
        : 'Share this postcard'

  return (
    <PostcardActionButton
      onClick={share}
      label={label}
      icon={<PaperPlaneIcon className="h-6 w-6" />}
    />
  )
}
