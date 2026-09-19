'use client'

import { useRef, useState } from 'react'
import { PaperPlaneIcon } from '@/components/icons/generated'
import { PostcardActionButton } from '@/components/postcards/PostcardAction'
import { composeShareCard, type ShareCardSource } from '@/lib/postcards/shareCard'
import { routes } from '@/lib/routes'
import { shareAppLink, shareImageFile } from '@/lib/share'

const TITLE = 'A postcard on LetsRide'

/**
 * How long the tap will wait for the image before it shares the link instead.
 *
 * **`navigator.share` requires a transient user activation, and awaiting the
 * composition inside the handler spends it.** Chrome's window is about five
 * seconds; a cache-missed photo on a slow mobile link clears that routinely,
 * and then *both* share calls reject `NotAllowedError` — and so does the
 * clipboard on WebKit, which needs activation too. The rider ends on "Could
 * not share the link" where the old code opened the sheet at once. So the
 * budget is what keeps this file's own promise that the link path is never
 * worse than it was: well inside the window, leaving room for the share call
 * and, on failure, the fallback's own two attempts.
 */
const COMPOSE_BUDGET_MS = 1200

/** The composition, or `null` if it failed or did not arrive in time. Never
 * rejects: both are the same decision here — share the link. */
function composeWithin(work: Promise<Blob | null>, ms: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms)
    void work.then(
      (blob) => {
        window.clearTimeout(timer)
        resolve(blob)
      },
      () => {
        window.clearTimeout(timer)
        resolve(null)
      }
    )
  })
}

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
 * take a file, a browser with no canvas, and a composition that does not
 * arrive inside `COMPOSE_BUDGET_MS`. The three outcomes and the three labels
 * below are unchanged, so nothing about what the rider is told depends on
 * which path ran. That is deliberate: the image is better when it works and
 * the link is never worse than it was — which is a claim about the share
 * SHEET as much as about the outcome, and is why the budget above exists.
 *
 * **This is the half a session can verify.** The composition is unit-tested;
 * whether iOS's sheet accepts the file is device-only, the same verification
 * boundary the push epic has.
 */
export function ShareButton({ postcard }: { postcard: ShareCardSource & { id: string } }) {
  const [notice, setNotice] = useState<'copied' | 'unavailable' | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * The in-flight guard, and it must be a REF rather than the state above.
   *
   * Two taps inside one tick both read the same render's `busy`, because React
   * batches the update — so a state guard passes the second tap straight
   * through, which is the bug it was added to prevent. `busy` survives only to
   * drive `aria-busy`, where a batched update is exactly right.
   */
  const sharing = useRef(false)
  /** Composed once per card and kept, so a second tap is instant and a
   * cache-missed first tap is not paid twice. */
  const card = useRef<Promise<Blob | null> | null>(null)

  /**
   * Start composing before the tap lands.
   *
   * `pointerdown` precedes `click` by the length of the press, and the photo is
   * already in the browser's cache because the card above is rendering it — so
   * in the ordinary case the blob is ready before the handler runs and the
   * budget above is never reached. This is what makes the image path the
   * common one rather than the lucky one.
   *
   * **Safe inside the swipe deck**: `pointerdown` here does not preventDefault
   * or capture, and a gesture that becomes a drag is swallowed by the deck's
   * `onClickCapture` before `share` runs — the composition is then simply
   * unused, which costs one cached fetch.
   */
  function warm() {
    if (!card.current) card.current = composeShareCard(postcard).catch(() => null)
  }

  async function share() {
    // A second tap while the first is still working starts a second sheet:
    // `navigator.share` rejects `InvalidStateError`, which reads as a failure,
    // and the link path would then run behind the sheet already open.
    if (sharing.current) return
    sharing.current = true
    setBusy(true)
    try {
      warm()
      const blob = await composeWithin(card.current!, COMPOSE_BUDGET_MS)
      if (blob) {
        // The name is what several platforms show beside the attachment and
        // what a save-to-files lands as, so it is a filename rather than an id.
        const file = new File([blob], 'letsride-postcard.jpg', { type: 'image/jpeg' })
        if ((await shareImageFile(file, TITLE)) === 'shared') return
      }

      const outcome = await shareAppLink(routes.postcard(postcard.id), TITLE)
      // A native share is its own feedback and a dismissal is not a failure,
      // so only the two outcomes the rider cannot see for themselves say
      // anything. The menus raise a banner for these; this control has no
      // banner to raise and its label is the affordance, so it says it there —
      // the same two outcomes reported, in the idiom of the surface.
      if (outcome === 'shared') return
      setNotice(outcome)
      window.setTimeout(() => setNotice(null), 2000)
    } finally {
      sharing.current = false
      setBusy(false)
    }
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
      onPointerDown={warm}
      // A keyboard rider never fires `pointerdown`, so focus is their warm-up.
      onFocus={warm}
      aria-busy={busy}
      label={label}
      icon={<PaperPlaneIcon className="h-6 w-6" />}
    />
  )
}
