# Page the club timeline on scroll

## Why

The club detail is the screen a member opens most, and its timeline draws twenty entries and
stops. The foot hands off to four sub-lists — real, and no substitute: none of them interleaves,
so a club's own history is only readable by leaving the screen and reading four lists separately.
The product owner, 2026-09-02: *"So the timeline, should have a lazy loading/scroll loading. Add
wet scroll wet load more posts."*

**The wall is also load-bearing in a way it was not designed to be.** PD-374 was cancelled on the
strength of this change: a rider's club introduction is reachable only from their join row, so
once that row falls past entry twenty the introduction is unreachable by browsing, and `094`'s
moderation route — a takedown entered from the thread screen, which is entered from a list — goes
with it. This change is what closes that hole; nothing else does.

**The reason this is a proposal rather than a `feature` ticket is the merge, not the scroll.** The
timeline is five independently-bounded reads with five different rates, held honest by a
*coherence horizon*: a source that came back full may hide older rows nobody fetched, so the
stream is truthful only above the newest such point and is cut there. A naive "fetch the next page
of each and append" produces a tail that is not merely short but **wrong** — a club taking sixty
joins a week would show rides and postcards from before its join window with no joins beside them,
and a reader cannot tell *"nobody joined"* from *"we stopped looking"*. `tsc`, ESLint,
`next build`, the unit suite and the RLS suite are all green on that defect, and on any quiet club
the wrong implementation and the right one return exactly the same list.

## What Changes

- **The timeline pages by lowering its horizon, not by advancing five cursors.** Each source is
  re-asked for the window below the point *it* stopped at, and the windows are accumulated. The
  merge is unchanged: `mergeClubTimeline` still takes sources and a limit, and still cuts at the
  newest horizon. What changes is that a source's `horizon` now moves down as the rider reads.
- **Most "more" steps cost no reads at all.** The first fetch already holds up to ~140 entries
  (30 rides + 30 postcards + 20 threads + 60 joins + the collapsed reply rows) against a display
  cap of 20. Raising the cap is free; a fetch is issued only once the cap is no longer what cuts.
- **`complete` keeps its exact present meaning — *nothing was dropped at either end* — and paging
  makes it converge on the club's founding.** It is not redefined. The `club-created` floor entry
  and the *"Older activity lives in…"* foot keep reading off it and need no new condition.
- **Scroll-triggered, through the repo's first `IntersectionObserver`**, in a new
  `<ScrollSentinel>` UI primitive. No `Load more` button on this screen.
- **A new pure function, `absorbClubTimelineWindow`, owns the accumulation** — which rows a fresh
  window replaces, which it may not, and where the accumulated horizon lands. It is where this
  change's one silent-failure class lives, so it is pure and unit-tested, exactly as
  `collapseToNewestPerThread` and `boundedHorizon` are.
- **A refetch does not snap a paged rider back to twenty.** The first window stays in the shared
  query cache; deeper windows are session-local, and a refetch of the first window is absorbed
  into them rather than replacing them.
- **A refetch that REMOVES a row resets the deeper windows; one that only adds or updates does
  not.** This is what keeps blocking and hiding compliant with `client-cache-invalidation` without
  an epoch counter and without snapping a reading rider back on every new postcard.
- **The PD-366 return anchor pages to find its row**, within a fixed budget, instead of silently
  no-opping for any row past the first twenty.
- **The wave and introduction decorations gain a depth segment on their cache key** and re-read
  the accumulated join ids per fetched window — never per display-cap bump.
- **Two new bounds**: `CLUB_TIMELINE_MAX_WINDOWS` (how deep one visit may fetch) and
  `CLUB_TIMELINE_ANCHOR_WINDOWS` (how deep the anchor may hunt).
- **No migration, no schema change, no new policy, no new grant.** Every deeper window is the same
  policy-filtered read the first window already issues, with a time bound added.
- **Out of scope, deliberately**: `/clubs/detail/threads` and `/notifications` keep their
  `Load more` buttons. This change decides the mechanism for the club timeline only.

## Capabilities

### New Capabilities

None. Paging is a property of the stream that already has a capability.

### Modified Capabilities

- `club-timeline`: the stream may now extend below its first horizon; what `complete`, the floor
  entry and the foot mean under paging; the no-duplicate-row rule; how the reply source's
  collapse interacts with paging; what a page may and may not disclose.
- `client-render-shell`: a screen that grows has three tail states rather than two — more coming,
  cannot get more, nothing more exists — and each needs a defined loading, error and offline
  treatment that never displaces what the rider is reading.
- `client-cache-invalidation`: where a paged window lives, what survives an invalidation, and the
  removal rule that keeps a block from persisting in a deeper window.

`client-session-storage` and `database-enforced-integrity` are untouched, as are
`event-fanout-integrity`, `notifications`, `realtime-subscriptions` and `ride-chat`: this change
adds no write, no fan-out, no subscription and no stored value.

## Who must NOT see or do this

The paging surface adds no audience. Every deeper window is the same `from(...).select(...)` the
first window issues, under the same policy, with one extra time bound — so the rules below are the
ones `club-timeline` already carries, restated because a paging control is a new way to *ask*, and
an unstated negative becomes whatever the implementer assumed.

| Role | May reach the timeline | May page it | Notes |
|---|---|---|---|
| Club **owner** | full | yes | member for every rule here via the owner disjunct of `private.is_club_member_for` (`054`, split by `060`), roster row or not |
| Club **admin** (`club_members.role = 'admin'`) | full | yes | no source policy tests `role`; paging does not become the first thing that does |
| Club **member** | full | yes | |
| **Non-member of a PUBLIC club** | absent — a refusal sentence, not a partial stream | **no** — and no sentinel is rendered, so no page read can be triggered | their joins and public rides WOULD return rows; drawing them inverts the club's message |
| **Non-member of a PRIVATE club** | absent — `ClubPreviewScreen` (`085`) | **no** — the component is not mounted | the preview issues no query that could return zero rows, and this change adds none |
| **Blocked rider** (either direction) | never an actor in any entry, at any depth | n/a | four symmetric `private.is_blocked` conjuncts, one per source; the client adds no filter at any depth |
| **Signed-out visitor** | reaches the shell and no data | n/a | `anon` holds no grant on any source table and this change adds none (decision #1) |

Stated as prohibitions, because each is a thing an implementation could plausibly get wrong:

- **A non-member SHALL NOT be able to page.** The sentinel is inside the member branch, and the
  five reads stay disabled by `useQuery`'s null-key state rather than filtered after the fact — so
  the refusal still costs no round trip and cannot be defeated by reading a response.
- **Paging SHALL NOT widen what a member reads.** No deeper window may drop the announcement
  filter, relax `!inner`, or reach a table the first window does not.
- **No `security definer` accessor SHALL be introduced to serve a page**, now or later. A definer
  body would have to restate five audience predicates and four block arms in code
  `supabase/tests/` structurally cannot see, because the suite runs as the table owner.
- **A blocked rider SHALL NOT survive in a deeper window.** A block invalidates everything; the
  first window loses their rows on the refetch, and the removal that causes discards the deeper
  windows with it.
- **Paging SHALL NOT become a way to enumerate.** Every window stays bounded by its own existing
  constant, and one visit may fetch at most `CLUB_TIMELINE_MAX_WINDOWS` of them.

## Impact

**Code**

- `src/lib/data/club-timeline.ts` — `ClubTimelineWindow`, `absorbClubTimelineWindow`,
  `absorbClubReplyWindow`, `resolveClubTimelineAdvance`, the two new bounds, and a rewritten
  `CLUB_TIMELINE_LIMIT` docstring (it becomes a page rather than a wall; the "deliberately no
  `load more`" paragraph is what this change reverses, and the reasoning it records is what the
  design had to answer).
- `src/components/clubs/ClubTimeline.tsx` — the paging state, the sentinel, the three tail states,
  the anchor hunt, the depth-keyed decorations.
- `src/components/ui/ScrollSentinel.tsx` — new; the repo's only `IntersectionObserver`.
- `src/lib/data/rides.ts`, `src/lib/data/club-threads.ts`, `src/lib/data/postcards.ts` — an
  `until` bound on `getClubRideAnnouncements`, `getClubThreads` and the club feed's existing
  `before`. `getClubJoins` and `getClubThreadReplies` gain theirs in `club-timeline.ts`.
- `src/lib/query/keys.ts` — an optional depth segment on `clubs.joinWaves` and
  `clubs.joinIntroductions`. The actions' existing `invalidate(queryKeys.clubs.joinWaves(clubId))`
  reaches every depth unchanged, because `invalidate` matches on a key **prefix**
  (`keyStartsWith`, `queryClient.ts`).
- `src/lib/clubs/club-timeline-anchor.ts` — the anchor hunt's decision, kept pure for the reason
  the existing resolver is: `renderToStaticMarkup` runs no effect.

**Tests**

- `src/lib/data/__tests__/club-timeline.test.ts` — the absorb rules, the advance rule, and the
  paging cases of the horizon. This file already exists because no other gate in the repo can see
  a silently truncated stream; every new invariant here is in the same class.
- A component test for the tail states, and one for the anchor hunt's termination.

**Not affected**

- No migration, no policy, no grant, no advisor, no Edge Function, no `supabase/tests/`
  assertion — this change adds no schema object and changes no policy. `openspec/config.yaml`'s
  tasks rule (a migration must be paired with an RLS assertion) is therefore not triggered, and
  the absence is deliberate rather than an omission.
- `/clubs/detail/threads`, `/notifications`, `ClubThreadsRow`, `ClubPreviewScreen`.

**Cost**

One additional round trip of five parallel reads per fetched window — plus one decoration read
when the join window advanced — against `eu-west-1`. The club detail holds **13** `useQuery` call
sites on load today (9 in this component, 4 on the page; some conditional, and two sharing their
key with `ClubThreadsRow`) — re-derive rather than trust it:
`grep -c 'useQuery(' src/components/clubs/ClubTimeline.tsx 'src/app/(app)/clubs/detail/page.tsx'`.
See `design.md` §D7 for why the added cost is acceptable and what makes most "more" steps free.
