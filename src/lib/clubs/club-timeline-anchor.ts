/**
 * Whether the club timeline should scroll to a row named by the URL's own
 * fragment, and which one — `097`'s follow-up, PD-366 (`design.md` §D9).
 *
 * Split out as a pure function for the reason `boundedHorizon` and
 * `resolveComboboxKey` are: the actual scroll runs inside a `useEffect`, which
 * `renderToStaticMarkup` never executes, so wiring `document.getElementById`
 * straight into the effect would leave the one property that matters — an
 * anchor naming no row on the page is a NO-OP, never a throw or a report —
 * with no gate on it at all.
 *
 * `hasRow` is `(id) => !!document.getElementById(id)` at the one call site,
 * injected so this needs no DOM to test: a version that scrolls regardless of
 * what `hasRow` answers fails the test asserting a missing anchor is a no-op,
 * and a version that reports or throws on a `false` answer fails it the other
 * way — see `club-timeline-anchor.test.ts`.
 *
 * Deleted, past the club's coherence horizon, or a row the viewer can no
 * longer read (a block landing between the link being drawn and the tap) are
 * all indistinguishable here, and all three are ordinary: `hasRow` answers
 * `false` for every one of them and this returns `null` for all three alike.
 */
export function resolveClubTimelineScrollTarget(
  hash: string,
  hasRow: (id: string) => boolean
): string | null {
  const id = hash.startsWith('#') ? hash.slice(1) : hash
  if (!id) return null
  return hasRow(id) ? id : null
}
