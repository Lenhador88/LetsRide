/**
 * Where a back control goes on a screen that has more than one way in.
 *
 * `/notifications` is the case this exists for. It is reached from the mailbox
 * in the header of all four tab roots, so no single href is right — a static
 * `/postcards` strands a rider who arrived from `/rides` on a screen they were
 * never on. And it is not a tab itself, so `Navbar` lights none of its four
 * while the rider is there: without this control the screen has no way off it
 * but the browser's own chrome, which is what PD-209 reported.
 *
 * ## The origin is carried, not inferred
 *
 * The linking screen already knows where the rider is standing. `linkWithOrigin`
 * writes that into the URL and `resolveBackDestination` reads it back, so the
 * answer is knowledge rather than a guess, and the control **always navigates**.
 *
 * **The rejected design was `router.back()` behind a `window.history.length > 1`
 * test, and it is worth saying why, because it is the obvious one and it is
 * broken.** `history.length` counts the whole session entry list *including
 * forward entries*, so it cannot tell "an entry behind me" from "an entry ahead
 * of me". Reproduced in Chromium: cold-open `/notifications` (length 1), tap
 * through to a ride (length 2), then press the system back gesture — the rider
 * is at index 0 with a retained forward entry and length is still 2, so the test
 * says "go back" and `history.back()` does **nothing at all**. That sequence is
 * ordinary on the native shell, where a push notification opens this screen cold
 * and Android's hardware back is one gesture away, and it lands exactly the
 * defect this module exists to prevent: a back button that silently no-ops is
 * worse than the absent one PD-209 was filed about, because it reads as a broken
 * screen rather than a missing affordance.
 *
 * The signal that would actually answer it is the history *index*, and nothing
 * portable exposes one. `navigation.canGoBack` is Chromium-only and absent from
 * WKWebView, so it misses the iOS shell that motivates the fallback in the first
 * place. Owning a depth marker instead means stamping `history.state` on every
 * push and unwinding it on `popstate` — an app-wide navigation subsystem in the
 * root layout, resting on App Router internals this repo pins `next` exact
 * because they change silently. That is materially bigger than PD-209 and fails
 * in the same silent direction. Carrying the origin needs none of it.
 *
 * ## Reading it back is allowlisted, and that is not paranoia
 *
 * The parameter arrives from the URL, so it is rider-supplied: an unchecked
 * `?from=https://example.com` handed to `router.replace` is an open redirect,
 * and one on a signed-in screen. Only a pathname this app actually links *from*
 * resolves; everything else — absent, unknown, absolute, protocol-relative —
 * falls to `DEFAULT_BACK_HREF`. So the failure mode is "back goes Home", never a
 * dead arrow and never an off-site hop.
 */

/**
 * The screens that render `NotificationsHeaderControl`, and therefore the only
 * origins it can produce. A fifth entry point means a line here **and** a case
 * in the test — until then it resolves to `DEFAULT_BACK_HREF`, which is the safe
 * direction to be wrong in: a rider goes Home rather than nowhere.
 */
const BACK_ORIGINS: readonly string[] = ['/postcards', '/rides', '/clubs', '/profile']

/** Where back goes when the URL carries no usable origin — the cold deeplink. */
export const DEFAULT_BACK_HREF = '/postcards'

/** One definition, for the writer and the reader — same rule as `keys.ts`. */
export const BACK_ORIGIN_PARAM = 'from'

/**
 * `/notifications` → `/notifications?from=%2Frides`.
 *
 * Built through `URLSearchParams` rather than a template string so the origin is
 * encoded once and correctly, for the reason `routes.ts` gives about its own
 * eighteen hand-written link sites.
 */
export function linkWithOrigin(href: string, origin: string): string {
  if (!BACK_ORIGINS.includes(origin)) return href
  return `${href}?${new URLSearchParams({ [BACK_ORIGIN_PARAM]: origin })}`
}

/** The pure half: a rider-supplied parameter in, an app pathname out, always. */
export function resolveBackDestination(from: string | null | undefined): string {
  if (!from || !BACK_ORIGINS.includes(from)) return DEFAULT_BACK_HREF
  return from
}
