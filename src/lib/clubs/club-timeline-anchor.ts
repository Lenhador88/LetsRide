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

/**
 * The PD-375 return anchor's HUNT — `design.md` §D6. Today's screen silently
 * no-ops for any row past the first window, which is exactly where a paged
 * rider's own row now sits. The hunt extends the stream, unasked, until the
 * fragment names a row on the page or one of three stop conditions fires.
 *
 * **A pure decision, for `resolveClubTimelineScrollTarget`'s own reason**:
 * `renderToStaticMarkup` runs no effect, so a decision wired straight into
 * one has no gate on it at all.
 *
 * **Kept separate from `resolveClubTimelineScrollTarget` rather than folded
 * into it**, because the two answer genuinely different questions with
 * different callers: that one decides whether TODAY's rows already contain
 * the anchor; this one decides whether it is worth extending the stream to
 * try to make that become true. `resolveClubTimelineScrollTarget` still runs
 * once found or given up, to actually resolve the id and scroll.
 *
 * `'found'` — the fragment names no anchor at all, or the row already exists.
 * A no-anchor fragment is `'found'` rather than `'give-up'` deliberately: both
 * end the hunt without a fetch, and the caller's own scroll step
 * (`resolveClubTimelineScrollTarget`) already treats an empty id as a no-op,
 * so nothing downstream needs a third outcome to tell them apart.
 * `'continue'` — extend the stream and ask again. `'give-up'` — the stream is
 * `complete` or the hunt's own budget is spent; some anchors are permanently
 * unreachable (a superseded `reply:`, a deleted row, a row whose author is now
 * blocked) and this is the same ordinary no-op as today's.
 */
export type ClubTimelineAnchorHuntStep = 'found' | 'continue' | 'give-up'

export function resolveClubTimelineAnchorHunt(
  hash: string,
  hasRow: (id: string) => boolean,
  complete: boolean,
  windowsSpent: number,
  maxWindows: number
): ClubTimelineAnchorHuntStep {
  const id = hash.startsWith('#') ? hash.slice(1) : hash
  if (!id || hasRow(id)) return 'found'
  if (complete || windowsSpent >= maxWindows) return 'give-up'
  return 'continue'
}
