/**
 * Where a back control goes on a screen that has more than one way in.
 *
 * `/notifications` is the case this exists for. It is reached from the mailbox
 * in the header of all four tab roots, so no single href is right — a static
 * `/postcards` strands a rider who arrived from `/rides` on a screen they were
 * never on. Popping the history is right, which is why `Header` grew a callback
 * slot beside `backHref` rather than every such caller picking a destination and
 * being wrong three times in four.
 *
 * **The fallback is not a nicety, it is the native shell's case.** A push
 * notification opens this screen cold, and `history.back()` on the first entry
 * of a fresh webview does nothing at all — a back button that silently no-ops is
 * worse than the absent one PD-209 was filed about, because it looks like a
 * broken screen rather than a missing affordance. So the pop is conditional and
 * the fallback is a real navigation.
 *
 * `historyLength` is `window.history.length`, read by the caller inside its
 * event handler. Two things it deliberately does not try to be:
 *
 * - **It counts the tab, not the app.** On the web, a rider who reached this
 *   document from another site has a length above 1, so back leaves the app.
 *   That is exactly what the browser's own back button does from the same
 *   screen, and inside the native shell the webview only ever holds this app's
 *   documents, so the count is exact in the one place it is load-bearing.
 * - **It cannot see a `replace`.** That is the property being relied on rather
 *   than a limitation: the route guard redirects with `router.replace`
 *   specifically so its hops do not stack, so a guarded entry still reads as the
 *   single entry it is.
 */
export type BackDestination = { kind: 'history' } | { kind: 'replace'; href: string }

export function resolveBackDestination(
  historyLength: number,
  fallbackHref: string
): BackDestination {
  return historyLength > 1 ? { kind: 'history' } : { kind: 'replace', href: fallbackHref }
}
