import { canonicalOrigin } from '@/lib/origin'

/**
 * Hand a link to whatever the device offers, and say what happened.
 *
 * Extracted from `ShareButton` when rides and clubs gained a `Share` row of
 * their own (PD-280). Three surfaces now share one answer to the same four
 * questions — which origin, native sheet or clipboard, what a dismissal means,
 * and what to do when neither is available — and those are exactly the four a
 * second copy would get subtly wrong.
 *
 * **The origin is `canonicalOrigin()`, never the runtime one.** This URL leaves
 * the device, and inside the native shell `window.location.origin` is
 * `https://localhost`, which is a link to nothing for whoever receives it. On
 * the web the two are identical (`src/lib/origin.ts`).
 *
 * **Every path the app can share is behind the auth gate** (decision #1), so a
 * recipient who is not signed in lands on the login screen rather than the
 * content. That is intended, not a defect — there is no anonymous access
 * anywhere in this app.
 */
export type ShareOutcome = 'shared' | 'copied' | 'unavailable'

export async function shareAppLink(path: string, title: string): Promise<ShareOutcome> {
  const url = `${canonicalOrigin()}${path}`

  if (navigator.share) {
    try {
      await navigator.share({ url, title })
      return 'shared'
    } catch {
      // Dismissing the sheet rejects, and a dismissal is not a failure. It must
      // not fall through to silently copying instead: the rider decided not to
      // share, and a "Link copied" banner would be the app doing it anyway.
      return 'shared'
    }
  }

  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    // No share sheet and no clipboard permission leaves nothing to do that the
    // rider cannot already do from the address bar. The caller says so rather
    // than pretending it worked.
    return 'unavailable'
  }
}
