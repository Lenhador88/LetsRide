# Tasks — Page the club timeline on scroll

**No migration.** Every window at every depth is the same policy-filtered read the first window
already issues, with a time bound added, so this change adds no table, column, policy, grant or
function. `openspec/config.yaml`'s rule pairing a migration with new assertions in
`supabase/tests/rls_test.sql` is satisfied by there being no migration — **not** by skipping
assertions for one. If an implementer concludes a migration is required, **stop and say so** rather
than writing `101`: the one place this change knowingly pays for that constraint is the postcard
boundary (`design.md` §D3), and it is a stated bound rather than an oversight.

**The defect this whole change can produce is invisible to every gate in this repo.** A stream
assembled from windows with a hole in it is still a well-ordered array of valid events; `tsc`,
ESLint, `next build`, the RLS suite and the walk are all green on it, and on any club whose sources
do not saturate the wrong implementation and the right one return exactly the same list. That is
why §1 comes before any component work and why each of its functions is pure.

## 0. Pre-flight

- [ ] 0.1 Read `design.md` §D0 before writing anything. The absorb rule is the change; everything
      else follows from it.
- [ ] 0.2 Re-read `CLUB_TIMELINE_LIMIT`'s current docstring in `src/lib/data/club-timeline.ts`.
      Its "deliberately no `load more`" paragraph is the decision this change reverses, and its
      inertness argument ("the horizon is live for one source and inert for the other four") is
      about the FIRST window only — under paging every source's horizon becomes live, which is the
      one sentence in that docstring that must not survive unedited.
- [ ] 0.3 Confirm the repo still has no `IntersectionObserver`, so the primitive added in §4 is
      genuinely the first: `git grep -n IntersectionObserver -- src/` (expect 0 matches).
- [ ] 0.4 Confirm `invalidate` still matches on a key **prefix**, because §3 depends on it:
      `grep -n "keyStartsWith" src/lib/query/queryClient.ts`.

## 1. The window model — pure functions and their tests, before any UI

- [ ] 1.1 Add `ClubTimelineWindow<T>` to `src/lib/data/club-timeline.ts`: `ClubTimelineSource<T>`
      plus `until: string | null` and `untilInclusive: boolean`. Document that the **window**
      declares its own covered interval for the same reason `ClubTimelineSource.horizon` is
      declared by the read — only the read knows what bound it used.
- [ ] 1.2 Implement `absorbClubTimelineWindow<T>(accumulated, window, at, id)` returning
      `{ source, removed }`, per `design.md` §D0: authoritative inside the covered interval, keeps
      everything outside it, horizon is the older of the two with `null` winning, `removed` true
      when an accumulated row inside the interval was not returned.
- [ ] 1.3 Implement `absorbClubReplyWindow(windows: ClubReplySource[])` — or the equivalent
      derivation from the window list — producing the accumulated `rows`, `horizon` and
      `activity`, with counts **summed**, participants unioned shallowest-window-first, and
      `partial` true if any contributing window saturated.
- [ ] 1.4 Implement `resolveClubTimelineAdvance(timeline, limit, windowsFetched, maxWindows)`
      returning `'complete' | 'draw-more' | 'fetch-window' | 'capped'`: complete wins; then
      `events.length >= limit` means the cap is what cut, so raise it and fetch nothing; otherwise
      the horizon cut, so fetch unless the ceiling is reached.
- [ ] 1.5 Add `CLUB_TIMELINE_MAX_WINDOWS = 10` and `CLUB_TIMELINE_ANCHOR_WINDOWS = 3`, each with
      the reasons `design.md` §D7 and §D6 record — memory, the decoration read's id-list growth,
      and that the anchor hunt runs unasked on load.
- [ ] 1.6 Rewrite `CLUB_TIMELINE_LIMIT`'s docstring: it is now a **page**, not a wall. Keep the
      inertness argument but scope it explicitly to the first window, and replace the "deliberately
      no `load more`" paragraph with what replaced it and why (the horizon is the cursor).
- [ ] 1.7 Tests in `src/lib/data/__tests__/club-timeline.test.ts` for 1.2 — deeper window extends
      coverage; short window imposes no horizon and needs no further read; **a refetched first
      window whose horizon moved up keeps the rows beneath it and keeps the deep horizon**; a row
      missing from the covered interval is dropped and sets `removed`; a row outside the interval
      is kept and does not set `removed`; an exclusive `until` retains the accumulated rows at the
      boundary instant while an inclusive one replaces them.
- [ ] 1.8 Tests for 1.3 — two windows of one thread sum their counts; participants stay
      newest-first across windows; a re-absorbed first window does not double a count; a creation
      row above the deepest reply horizon still renders exact.
- [ ] 1.9 Tests for 1.4 — a limit-cut stream advances with no fetch; a horizon-cut stream asks for
      a window; the ceiling returns `capped`; a complete stream returns `complete`.
- [ ] 1.10 **Verify each new test both ways**, as this repo's standing rule requires: break the
      absorb rule to concatenation and confirm the hole case in 1.7 fails; take the newest window's
      count
      instead of the sum and confirm 1.8 fails. Record in the test file's header what each
      inversion breaks, as the existing headers there do.

## 2. The reads gain a bound

- [ ] 2.1 `getClubJoins(clubId, limit, until?)` — `.lte('joined_at', until)`, returning a
      `ClubTimelineWindow` with `untilInclusive: true`. The horizon stays measured on the raw rows
      **before** the username filter.
- [ ] 2.2 `getClubThreadReplies(clubId, limit, until?)` — `.lte('created_at', until)`, window
      inclusive. The announcement exclusion and `!inner` stay exactly as they are; the horizon and
      `partial` stay measured on the window **before** the collapse.
- [ ] 2.3 `getClubRideAnnouncements(clubId, limit, until?)` in `src/lib/data/rides.ts` —
      `.lte('created_at', until)`, inclusive.
- [ ] 2.4 `getClubThreads(clubId, cursor?, limit, until?)` in `src/lib/data/club-threads.ts` —
      `.lte('created_at', until)`, inclusive, **beside** the existing keyset cursor rather than
      replacing it: `/clubs/detail/threads` keeps paging on the cursor and must not change
      behaviour.
- [ ] 2.5 The club feed keeps its existing `before` (`getClubFeed(clubId, { before, limit })`).
      Its window declares `untilInclusive: false`, because `club_stamp_postcard_ids` compares
      `created_at < before` (`086`). Write the reason at the call site, not only here.
- [ ] 2.6 Confirm no read gained a predicate that is not the club, the ordering window or the time
      bound: `git diff` on `src/lib/data/` should show no membership, block, visibility or hide
      term anywhere. A term like that in this diff is a review failure, not a detail.

## 3. Cache keys and decorations

- [ ] 3.1 `queryKeys.clubs.joinWaves(clubId, depth?)` and `.joinIntroductions(clubId, depth?)` —
      the depth appended as an optional trailing segment. Document that the actions keep calling
      the depth-less form and reach every depth by prefix, so `waveJoin`, `unwaveJoin` and
      `introduceToClub` need no edit.
- [ ] 3.2 Verify that claim rather than assuming it — a unit test asserting
      `keyStartsWith(joinWaves(id, 3), joinWaves(id))`.
- [ ] 3.3 In `ClubTimeline`, key both decoration reads on the fetched-window depth and pass the
      **whole accumulated** join id set. Keep the existing gate (`joins.data !== undefined`,
      widened to "the window at this depth has resolved") so the key still flips from `null` to
      real only once the ids exist — that gate is what makes the scoping true rather than a race.
- [ ] 3.4 Confirm a display-cap step that fetched nothing leaves both decoration keys unchanged, so
      it issues no read.

## 4. The scroll trigger

- [ ] 4.1 `src/components/ui/ScrollSentinel.tsx` — an empty `div` plus an `IntersectionObserver`
      created **in an effect** and disconnected in its cleanup; props `onVisible` and
      `rootMargin` (default `'600px'`). No observer during render, none under
      `renderToStaticMarkup`, and the element renders regardless.
- [ ] 4.2 A component test rendering it through `renderToStaticMarkup` under
      `environment: 'node'`: it produces markup and constructs no observer. This is what pins the
      prerender rule; jsdom is not the answer here.
- [ ] 4.3 State in its docstring that it has exactly one caller today and that
      `/clubs/detail/threads` and `/notifications` keeping their buttons is a decision (PD-375),
      not an oversight.

## 5. Wiring the timeline

- [ ] 5.1 Hold the fetched windows in component state — the first window from the existing
      `useQuery` keys, deeper ones local — and derive the accumulated five sources by absorbing in
      order. Keep the first window's five keys **unchanged**: three are shared with other screens.
- [ ] 5.2 Merge with a display cap of `CLUB_TIMELINE_LIMIT × steps`, and drive each step through
      `resolveClubTimelineAdvance`: raise the cap first, fetch only when the cap is no longer what
      cuts.
- [ ] 5.3 Issue a window's five reads in **one** effect, in parallel, so a page costs one round
      trip rather than five. One fetch in flight at a time; none while `useOnlineStatus()` is
      false; none after a failure until the rider asks.
- [ ] 5.4 The three tail states of `design.md` §D2: sentinel + skeleton while extendable; the
      existing *"Older activity lives in…"* foot when capped or failed, with an `ErrorState`-style
      *Try again* on the failure branch only; the `club-created` entry and no foot when complete.
- [ ] 5.5 Absorb a refetched first window rather than replacing it, and **discard the deeper
      windows when the absorb reports `removed`** — the block/hide rule. Verify by hand on DEV:
      block from a postcard's menu on a paged timeline and confirm that rider's rows are gone from
      the whole stream, not only from the top.
- [ ] 5.6 Keep `combineQueries` gating on the first window only. A deeper window's failure must
      never blank the stream, and the decorations stay outside the gate at every depth.
- [ ] 5.7 Confirm the non-member branch is untouched: no sentinel, no reads, the same refusal
      sentence. A non-member being able to trigger a page is the one failure in this change that is
      a visibility bug rather than a correctness one.

## 6. The return anchor

- [ ] 6.1 Extend the anchor effect to hunt: while the fragment names no row on the page, extend —
      up to `CLUB_TIMELINE_ANCHOR_WINDOWS` fetched windows — then scroll once, or give up.
- [ ] 6.2 Terminate on all three conditions (found, `complete`, budget spent), and keep
      `scrolledToAnchor` as the "only once" guard so a later refetch cannot yank a reading rider.
- [ ] 6.3 Keep the decision in a pure function beside `resolveClubTimelineScrollTarget`, for its
      stated reason: `renderToStaticMarkup` runs no effect, so a decision wired straight into the
      effect has no gate on it at all.
- [ ] 6.4 Tests: a row found on the second window scrolls once; an anchor no window can contain
      stops at the budget, renders normally and reports nothing; a `reply:` anchor superseded by a
      newer message in its thread is the same ordinary no-op.

## 7. Gates and records

- [ ] 7.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`.
- [ ] 7.2 `npm run walk` against DEV with the relay running (`scripts/supabase-relay.mjs`'s header
      first). The walk renders the club detail; a timeline that throws on mount or spins for ever
      is exactly what it exists to catch, and no other gate renders this screen.
- [ ] 7.3 Exercise a club whose sources actually saturate. A fixture club with fewer than 20
      entries proves nothing here — the wrong implementation and the right one agree on it. Either
      seed enough rows on DEV or drive the merge from the unit tests with bounds lowered, and say
      in the PR which was done.
- [ ] 7.4 Add the invented affordances to `docs/FIGMA-FIDELITY-TODO.md` beside its existing
      "There is no 'Load more' affordance in the design" entry: the scroll sentinel, the
      loading skeleton at the tail, and the retry copy are all ours, and that file's note that this
      app's bounded-list screens "none of which auto-load either" stops being true with this change.
- [ ] 7.5 The handoff's bullet beginning *"The announcement row is a WINDOW"* says the timeline
      does not paginate and that an introduction can fall out of every browse surface. Both become
      false here, and PD-374 was cancelled on that basis. **Agents do not write
      `docs/HANDOFF.md`** — the main thread owns it, so surface this in the report rather than
      editing the file.
- [ ] 7.6 `npm run docs:check` before the PR, and `reviewer` on the final diff.
