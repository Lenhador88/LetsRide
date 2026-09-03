# Design — page the club timeline on scroll

Seven questions, numbered as PD-375 numbers them. §D1–§D7 answer one each; §D0 is the model they
all rest on, and §Performance is the arithmetic §D7 asks for.

## D0. The model: a window is the unit, and the horizon is the cursor

**Rejected first, because it is the obvious design and it is the wrong one:** five cursors, one
per source, each advancing at its own rate. It reintroduces exactly what `mergeClubTimeline`'s
horizon exists to prevent — five positions that disagree, and a tail assembled from sources that
looked back to five different instants with nothing recording which. The issue's own steer is the
right one: **page by lowering the horizon.**

So the unit of paging is a **window**: what one read fetched, plus the interval it covers.

```ts
export type ClubTimelineWindow<T> = ClubTimelineSource<T> & {
  /** The newest instant this window was asked for. `null` = now — the first
   *  window of a source, which reaches the top of the stream. */
  until: string | null
  /** Whether `until` itself is inside the window. Four reads express `<=` and
   *  one cannot — see D3. The WINDOW declares this rather than the caller
   *  deriving it, for the reason `ClubTimelineSource.horizon` is declared: only
   *  the read knows what bound it actually used. */
  untilInclusive: boolean
}
```

`ClubTimelineSource<T>` is unchanged and keeps meaning what it means: `rows`, plus the `horizon`
below which this source's picture stops. What changes is that an **accumulated** source is built
from several windows, and its horizon is the deepest one's.

**The accumulated source obeys one invariant, and it is the whole change:**

> An accumulated source covers `[horizon, now]` **contiguously**. Every row of the source that
> exists in that interval and is readable by this rider is in `rows`.

Contiguity is what makes the accumulated source a legal input to `mergeClubTimeline` — the merge
takes `horizon` to mean "complete above this point", and a source with a hole in it would be a
plausible, well-ordered, confidently wrong stream of precisely the class this module exists to
refuse.

### `absorbClubTimelineWindow` — the one place the invariant can break

```ts
export function absorbClubTimelineWindow<T>(
  accumulated: ClubTimelineSource<T>,
  window: ClubTimelineWindow<T>,
  at: (row: T) => string,
  id: (row: T) => string
): { source: ClubTimelineSource<T>; removed: boolean }
```

One rule, covering both directions:

1. **The window's covered interval is `[window.horizon ?? -∞, window.until ?? +∞]`**, with the top
   edge open when `untilInclusive` is false.
2. **Inside that interval the window is authoritative.** Accumulated rows inside it that the
   window did not return are gone — deleted, hidden, or blocked away — and are dropped.
3. **Outside it the accumulated rows are kept**, untouched.
4. **The accumulated horizon is the older of the two**, with `null` meaning "reaches the club's
   beginning" and therefore winning.
5. **`removed` is true when step 2 dropped anything.** §D4 is what reads it.

Both paging directions fall out of that single rule, which is the reason it is written as one
function rather than as an `appendPage` and a `mergeRefetch`:

- **A deeper window** is fetched with `until = accumulated.horizon`. Its interval abuts the
  accumulated one exactly, so the union is contiguous, the horizon moves down, and rows at the
  shared boundary instant are supplied by whichever window covers it inclusively — never twice
  (they are dropped from the accumulated set by step 2 before the window's copies are added) and
  never zero times.
- **A refetch of the first window** arrives with `until = null` and a horizon that may have moved
  *up*, because new rows pushed the oldest row of a saturated window off the end. Its interval is
  `[h_new, +∞)`. The rows the rider has already paged past sit **below** `h_new`, so step 3 keeps
  them, and step 4 keeps the deep horizon. **There is no hole**, and this is the case a
  simpler "replace the first page" implementation gets silently wrong: the region between the old
  and the new first-window horizon would be covered by nothing while the stream went on claiming
  the deep horizon.

The reply source needs its own absorb, `absorbClubReplyWindow`, because it carries `activity`
alongside `rows` — see §D5.

## D1. Scroll-triggered: `IntersectionObserver` behind a sentinel

`git grep IntersectionObserver -- src/` is **0** today, so this decides it for the club timeline
and for nothing else (PD-375 puts `/clubs/detail/threads` and `/notifications` out of scope, and
they keep their buttons).

**`<ScrollSentinel onVisible rootMargin>`**, a new primitive in `src/components/ui/`. An empty
`div` observed by an `IntersectionObserver` created **in an effect** and disconnected on unmount.

- **In an effect, never during render**, and the reason is the standing one rather than a
  preference: a `'use client'` component is still executed by the prerender pass — the same pass
  that survives `output: 'export'` — where there is no `window`. This is `resolve.browser.ts`'s
  rule applied to a browser API instead of to a read.
- **`rootMargin: '600px'`** so the fetch starts before the rider reaches the end. Roughly two
  entry heights of runway on a phone; the number is a tuning constant with no correctness in it.
- **One fetch in flight at a time.** The sentinel can fire repeatedly while it is on screen; the
  handler is a no-op whenever a fetch is already running, whenever the tail is not `fetch-window`,
  and whenever the rider is offline.
- **No button on this screen** — the product owner asked for scroll loading. A control does come
  back in exactly one state: after a page fetch has **failed**, where an automatic retry would
  hammer a failing endpoint and an offline rider would spin for ever. That control says
  *Try again*, not *Load more*, and it is `ErrorState`'s existing idiom scoped to the tail.
- **It renders under `renderToStaticMarkup`**: the sentinel is an ordinary `div` and the observer
  simply never gets created, so the component tests stay in `environment: 'node'`.

**Rejected:** a scroll listener on `window` (fires on every frame, and the club detail is not the
scroll container in a native shell), and `scrollHeight` arithmetic (reads layout during render).

## D2. `complete`, the foot, and the floor entry

**`complete` is NOT redefined.** It still means *nothing was dropped at either end* — the horizon
cut nothing and the limit cut nothing. The issue asks that it come to mean *we have reached the
club's founding*; the finding here is that under paging **the existing definition converges on
exactly that** and needs no new condition:

- Every source that came back short imposes no horizon and has read to the club's beginning.
- Paging drives each saturated source's horizon down until its window comes back short.
- When the last one does, `horizon` is `null`, nothing is cut at the bottom; the display cap rises
  in step and nothing is cut at the top; `complete` is true; `mergeClubTimeline` appends the
  `club-created` floor entry, and the foot disappears because it reads `!complete`.

So `mergeClubTimeline` needs **no change at all** for D2. That is the strongest evidence the
window model is the right one, and it is why this design reuses the horizon rather than adding a
parallel notion of position.

What does change is the tail, which now has **three** states rather than two:

| State | Condition | What is drawn |
|---|---|---|
| **More coming** | `!complete`, budget remains | the sentinel, plus a three-row skeleton while a fetch is in flight |
| **Cannot get more** | a page fetch failed, or `CLUB_TIMELINE_MAX_WINDOWS` reached | today's *"Older activity lives in photos, rides, threads and members"* foot, plus *Try again* on the failure branch |
| **Nothing more exists** | `complete` | the `club-created` entry, and no foot |

The middle row is why the foot survives this change rather than being deleted with the wall: it is
still the honest end of a stream that stops short, and it is the terminal state at the depth cap.

**The floor entry keeps its one absolute rule** — it is drawn only when `complete`, because under
a cut stream it sits beneath an event from last Tuesday and asserts that nothing happened in
between. Paging does not soften that; it makes it reachable.

## D3. No duplicate rows across a boundary

Two independent mechanisms, because one of them has an exception:

**1. The absorb rule (§D0 step 2) makes a duplicate structurally impossible for four sources.**
Rows at the shared boundary instant are dropped from the accumulated set and re-supplied by the
new window. Identity is the row identity the key is built from — `id` for rides, postcards,
threads and messages, `user_id` for joins, which is what makes a leave-and-rejoin between two
fetches one row rather than two rows sharing a key.

**2. Deeper windows are fetched with an INCLUSIVE bound (`<= until`) wherever the read can express
one**, so that a `limit` slicing through a group of rows that share one instant cannot lose the
ones below the cut. `rides`, `club_threads`, `club_members` and `club_messages` are all ordinary
PostgREST reads and take `.lte(...)`.

**The exception, stated rather than smoothed over: the club feed's bound is exclusive.**
`getClubFeed` pages through `public.club_stamp_postcard_ids(club, before, page_size)`, whose body
is `p.created_at < before` — strictly older, on the timestamp alone, with no id tiebreak (`086`,
line 130). Making it inclusive means a new migration for a new signature, which this change does
not take (PD-375 scopes it client-side and the territory declares `migration: N`). So the postcard
window declares `untilInclusive: false`, the absorb rule honours it by keeping the accumulated
rows at the boundary instant, and the residual defect is precisely this:

> Two postcards in one club sharing a `created_at` to the microsecond, straddling a page boundary,
> lose the one below the cut.

`044` writes `postcards.created_at` at **transaction** time and there is one postcard insert per
transaction, so a tie requires two riders' inserts to begin in the same microsecond. It is not
impossible, it is not detectable from the client, and the cost of it is one missing photo deep in
a paged stream. **The fix, if it is ever wanted, is a keyset argument on the accessor** — a
migration adding `before_id uuid` and an `(created_at, id)` comparison, which is the same total
order `getClubThreads` already pages on. Recorded here rather than filed, because filing it as a
bug would misstate it: it is a bound this change chose.

## D4. What a refetch does to a rider who has paged

**The first window stays in the shared query cache; deeper windows are session-local state** —
`/clubs/detail/threads`' trade exactly, and adopted for its reason rather than by analogy. The
first window's five keys are *shared with other screens*
(`postcards.feed(filterSegment.club(id))` is the Postcards list's own key,
`clubs.threads(id)` is the Threads list's and `ClubThreadsRow`'s), and a paging scheme that moved
them into local state would break that sharing and let the two screens disagree.

So an invalidation — a new postcard, a wave, a join — refetches the **first window only**, and
that refetch is **absorbed** (§D0) rather than replacing anything. The rider keeps their depth.
This is the whole of point 4, and it works because the absorb rule was written for both
directions.

**The removal rule.** An absorb reports `removed` when the fresh first window failed to return a
row the accumulated set held *inside the interval it covers*. That distinguishes the two kinds of
refetch, which nothing else on the client can:

- **An addition or an update** — a new postcard, a like count, a wave — leaves the deeper windows
  alone. A rider forty entries down is not moved.
- **A removal** — a block, a hide, a delete, a leave — **discards the deeper windows** and returns
  the stream to its first page.

The removal branch exists because `client-cache-invalidation` requires a block to remove content
*"from every cached view the blocker holds, not only from the next fetch"*, and blocking is
reachable from this very screen without unmounting it: `PostcardCard` renders `PostcardMenu`,
which carries **Hide** and **Block**, and `blockRider` calls `invalidate(EVERYTHING)`. Without the
rule, a blocked rider's postcard sitting in a deeper window would stay on screen until the rider
navigated away. With it, the deeper windows go and are re-fetched from a clean first page.

**Yes, that snaps a paged rider back — and only in the case where correctness demands it.** They
have just blocked or hidden something; a stream that reshuffles under that action is expected,
where a stream that reshuffles because somebody posted a photo is the defect point 4 names.

**On the next visit the timeline starts at twenty again**, because deeper windows die with the
mount. That is the precedent's trade and it is acceptable here for a reason the precedent does not
have: the one navigation that would make it hurt — into a thread and back — is exactly what §D6
repairs.

## D5. The decorations, and what the collapse does to paging

### The wave and introduction reads

Both are scoped to *"the subject ids the timeline's own sources are already holding"* and gated on
`joins.data !== undefined` — because this cache has no notion of "refetch when an argument
changed, only the key", so a query activated before the ids existed would fetch once against an
empty list and never fetch again.

Paging changes the id set on every fetched window, so the key has to move with it: **the key gains
a depth segment** and the read covers the **whole accumulated join id set**, not the delta.

```ts
joinWaves: (clubId, depth?) => ['clubs','detail',clubId,'joinWaves', ...(depth === undefined ? [] : [String(depth)])]
```

Four properties, each load-bearing:

- **The race the gating prevents stays prevented**, by construction rather than by care: the key
  reaches depth *d* only once window *d*'s joins are in hand, so the fetcher it activates can only
  ever close over the id set that depth names.
- **`waveJoin`/`unwaveJoin`/`introduceToClub` need no edit.** They invalidate
  `queryKeys.clubs.joinWaves(clubId)` with no depth, and `invalidate` matches on a key **prefix**
  (`keyStartsWith`, `queryClient.ts`), so the depth-suffixed entry is reached by the call that
  already exists.
- **The whole accumulated set, not the delta**, so an invalidation refills a complete map. A
  per-page delta merged in component state would leave an earlier page's wave counts stale after
  exactly the invalidation that exists to refresh them.
- **Scoped to the source window rather than to the drawn rows**, which is what makes a display-cap
  bump free: the newly drawn join rows were already in the window whose depth the key names, so no
  decoration read fires for a step that fetched nothing.

They stay **outside** `combineQueries`: a decoration must not gate the rows it decorates, so a
failed or slow decoration read costs the wave controls and the introduction door and nothing else,
at any depth.

### The reply collapse — "one page older" is not a row count

`getClubThreadReplies` reads up to `CLUB_TIMELINE_REPLIES` (200) recent messages on listed threads
and collapses them to the newest per thread. Sixty messages in one argument yield one row. So the
reply source's window is measured in **messages**, its output in **threads**, and its horizon in
**time** — and time is the only one of the three the merge cares about, which is why the window
model works here at all: a deeper reply window is "the next 200 messages older than where we
stopped", exactly as before, with no need for it to yield any particular number of rows.

**The collapse stays per-window, and does not become global.** A thread alive in two windows
produces one entry per window, at two genuinely different instants.

- It is **true**: each row says *this conversation was alive then*, dated when it was.
- It is **bounded**: at most one row per thread per window, never a transcript. The rule the
  collapse exists to enforce — *a club argument must not bury everything else* — is a
  within-window rule and stays exactly as strong.
- A **global** collapse would delete the deeper row, which is frequently the only evidence that
  anything at all was happening in that period, and would leave the rider looking at a stretch of
  timeline that is short for no visible reason.

**`activity` accumulates by summing, and that is not optional.** The per-thread reply count is
derived from the window, so the accumulated count for a thread is the **sum** of its per-window
counts, its participants are the **union** in shallowest-window-first order (which preserves
newest-first), and `partial` is true if **any** contributing window was saturated.

Summing is what keeps `withExactCount` honest. A thread-creation row renders its count as exact
rather than as a floor, and the argument for that is the horizon: a creation row that survives the
cut was created *after* the deepest reply horizon, so every one of its messages lies inside the
reply source's coverage. Under paging that coverage is the union of the reply windows — contiguous
by §D0 — so the argument survives verbatim **provided the counts are summed**. Taking the newest
window's count instead would silently under-report an old thread's replies while labelling the
number exact, which is the worst of both.

The absorb for the reply source therefore replaces `activity` per window rather than accumulating
it incrementally: the accumulated map is derived from the window list, so a first-window refetch
re-contributes rather than double-counts.

## D6. The return anchor pages to find its row

PD-366 puts a row key on the URL as a fragment when a rider taps into a thread, and
`resolveClubTimelineScrollTarget` scrolls to it once the rows exist. Today it silently no-ops for
any row past entry twenty — which, after a rider has paged, is where they were.

**The screen hunts for the anchored row**: after the first merge, if the fragment names a row that
is not on the page, it fetches the next window and looks again, up to
`CLUB_TIMELINE_ANCHOR_WINDOWS` (3) windows. Then it scrolls once, or gives up as a no-op.

- **Appending never disturbs a reader**, which is what makes an automatic fetch safe here: rows
  are added below what is on screen, so nothing above moves. This is also why the sentinel's own
  paging needs no scroll-anchoring machinery.
- **The scroll still happens exactly once**, and `scrolledToAnchor` still guards it — a hunt that
  ends without finding the row must not leave the screen able to yank a rider later, when an
  arriving refetch happens to make the row exist.
- **The hunt terminates on three conditions**: the row appears, the stream is `complete`, or the
  budget runs out. The budget is smaller than `CLUB_TIMELINE_MAX_WINDOWS` because this runs
  unasked, on load, and three windows is already up to ~420 entries of hunting.
- **Some anchors are permanently unreachable and that is not a bug**, so the hunt must be bounded
  rather than "page until found". A `reply:<message id>` names one message, and the collapse keeps
  only the newest message per thread per window — so if a newer message arrives in that thread
  while the rider is inside it, the anchored message can never be a row again. A deleted row, and
  a row whose author the rider has since blocked, are the same shape. All of them end as today's
  no-op, and `resolveClubTimelineScrollTarget`'s existing contract — *an anchor naming no row is a
  no-op, never a throw or a report* — is what covers them.

## D7. Performance

**What one visit costs today**, re-derived rather than trusted
(`grep -c 'useQuery(' src/components/clubs/ClubTimeline.tsx 'src/app/(app)/clubs/detail/page.tsx'`):
13 `useQuery` call sites — 9 in `ClubTimeline`, 4 on the page — of which two share their key (and
so their request) with `ClubThreadsRow`, and one is only enabled for a club the rider cannot see.

**What a display-cap bump costs: nothing.** The first fetch already holds up to 30 rides +
30 postcards + 20 threads + 60 joins + the collapse of 200 messages, against a display cap of 20.
Every "more" step first raises the cap; only when the cap is no longer what cuts does a fetch
happen. On a quiet club — where no source saturates, so the horizon is `null` — the rider reaches
the club's founding with **zero** additional reads, and the floor entry appears.

**What a fetched window costs**: five reads, issued in parallel from one effect, plus one
decoration read when the join window advanced — so one round trip to `eu-west-1`, not five.
`club_thread_unread` and the viewer profile are not re-read: the first is a club-wide RPC whose
map already covers threads a deeper window brings in, and the second cannot change.

**Why it is acceptable**: the fetch happens on an explicit scroll gesture, 600px before it is
needed, against a screen that is already interactive and stays interactive — nothing unmounts,
nothing is replaced by a skeleton, and a failure costs the tail rather than the stream. The
alternative on offer is not "no reads", it is four separate screens.

**Two ceilings, both stated as decisions rather than defaults:**

- **`CLUB_TIMELINE_MAX_WINDOWS = 10`.** A visit may fetch ten windows — on the constants above,
  roughly 600 joins, 300 rides, 300 postcards, 200 threads and 2,000 messages deep. It bounds
  three things at once: client memory on a phone (every accumulated row is held in JS, postcards
  with their signed URLs among them), the growth of the decoration read's `.in()` list (~60 uuids
  per window ≈ 2.2 KB of query string per window, and PostgREST is reached through a gateway with
  a URL-length limit — at ten windows that list is ~22 KB and the ceiling is doing real work), and
  the total reads one screen can issue. At the cap the tail becomes the *cannot get more* state,
  which is the honest foot this screen already draws — a wall at several hundred entries rather
  than at twenty.
- **`CLUB_TIMELINE_ANCHOR_WINDOWS = 3`**, per §D6.

**The trigger for revisiting both**: the day the decoration read is chunked or moved to an RPC
taking a single club id, `MAX_WINDOWS` is bounded only by memory and can rise. Nothing forces that
today, and it is not in this change.

## What this change deliberately does not do

- **No migration**, no policy, no grant, no new table, no RPC. The one place the no-migration
  bound costs an exactness property is §D3's postcard boundary, and it is named there.
- **No `security definer` merged-stream accessor**, now or later — `club-timeline`'s standing
  prohibition, restated because "we need to page it" is exactly the argument that would be made
  for one.
- **No change to `/clubs/detail/threads` or `/notifications`.** They keep `Load more`. If the
  sentinel proves itself here, adopting it there is a separate change with its own reason.
- **No realtime.** The stream refreshes by invalidation, as it does today.
- **No scroll-position restoration across a navigation.** §D6's anchor is the answer to the one
  case that matters, and a general restoration scheme is a different piece of work.
