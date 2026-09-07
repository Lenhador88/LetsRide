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

/**
 * Did the rider dismiss the share sheet, or did sharing actually fail?
 *
 * **The Web Share API answers this and the old code did not ask** (PD-344). Per
 * spec a cancelled share rejects with `AbortError`; every other rejection is a
 * real failure — `NotAllowedError` outside a transient user activation or under
 * a permissions policy, `TypeError` or `DataError` on data the platform will
 * not take, `NotSupportedError` where the sheet is not actually available. So
 * the two are distinguishable after all, and the choice the issue framed as
 * unavoidable — a false "could not share" on some dismissals, or silence on
 * every failure — is only forced if the rejection is read as opaque.
 *
 * **Where it is genuinely ambiguous it resolves as a dismissal**, which is the
 * safe end: some engines have been known to raise `AbortError` for
 * non-dismissal cases too, and reading those as dismissals reproduces exactly
 * today's behaviour for that subset while fixing every other case. This
 * function can therefore only ever improve on the old unconditional `'shared'`,
 * never regress it.
 */
function isDismissal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

export async function shareAppLink(path: string, title: string): Promise<ShareOutcome> {
  const url = `${canonicalOrigin()}${path}`

  if (navigator.share) {
    try {
      await navigator.share({ url, title })
      return 'shared'
    } catch (error) {
      // Dismissing the sheet rejects, and a dismissal is not a failure. It must
      // not fall through to silently copying instead: the rider decided not to
      // share, and a "Link copied" banner would be the app doing it anyway.
      if (isDismissal(error)) return 'shared'

      // Anything else IS a failure, and reporting it as `'shared'` is what left
      // the rider with no feedback at all — every caller treats `'shared'` as
      // "the sheet was its own feedback" and says nothing. Fall through to the
      // clipboard, which is the same thing this function does on a platform
      // with no sheet at all, and tell the caller what actually happened.
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
