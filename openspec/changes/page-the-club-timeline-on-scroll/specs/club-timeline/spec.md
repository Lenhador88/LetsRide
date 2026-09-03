## MODIFIED Requirements

### Requirement: The stream SHALL be totally ordered and SHALL NOT extend past its coherence horizon

Entries SHALL be sorted by their timestamp descending, with the entry key as the tiebreak, giving
a total order — and with the club's own founding always last on a tie, since nothing can precede
the club existing. Timestamp alone is not a total order here: `complete_onboarding`
writes a default-club membership inside one transaction (`058`), so shared instants are ordinary
rather than an edge case, and a stream without a tiebreak reshuffles between loads for no reason
the rider can see.

Each source SHALL be read with its own bound. A source that returns **exactly** its bound is
saturated and is incomplete below its oldest returned row. The **coherence horizon** SHALL be the
**most recent** of the saturated sources' oldest timestamps, and the stream SHALL NOT include any
entry older than it. A source returning fewer rows than its bound SHALL impose no horizon,
because it is complete back to the club's beginning.

The stream SHALL then be capped for display.

**The following paragraph of this requirement is REPLACED by this change**, and the replacement is
its opposite. It previously read: *"Incomplete — a handoff row offering the four full lists. There
SHALL be no infinite scroll and no 'load more'."* It now reads:

> **Incomplete — the stream SHALL offer to extend itself**, by lowering the horizon and raising the
> display cap, until it is complete or a stated ceiling is reached. The handoff row SHALL remain
> the terminal state of a stream that stops short, and SHALL be drawn when — and only when — the
> stream cannot be extended any further.

The tail SHALL therefore be one of exactly three things:

- **Complete** — no horizon and no cap reached: the last entry SHALL be the club's own creation,
  and nothing further SHALL be drawn.
- **Extendable** — more entries are reachable: the stream SHALL offer to extend, and SHALL NOT
  draw the handoff row.
- **Terminal but incomplete** — extension has failed or reached its ceiling: the **handoff row**
  offering the full lists SHALL be drawn, exactly as before.

`complete` SHALL NOT be redefined by paging. It SHALL continue to mean that nothing was dropped at
either end — the horizon cut nothing **and** the display cap cut nothing — and SHALL NOT be
inferred from the entry count. What paging changes is that it becomes reachable on a club whose
sources saturate, because every source's horizon moves down until its window comes back short.

The club's creation entry SHALL be drawn **only** in the complete state. Under a truncated stream
it would assert an adjacency that is false, and that holds identically for a stream truncated
part-way through paging.

#### Scenario: The tail cannot claim an event that is missing
- **WHEN** one source saturates and another does not
- **THEN** the stream SHALL stop at the saturated source's oldest returned timestamp
- **AND** SHALL NOT contain an older entry from the unsaturated source, even though that entry
  was fetched

#### Scenario: An ordinary club reaches its own beginning
- **WHEN** no source saturates
- **THEN** there SHALL be no horizon, the stream SHALL run to the club's creation entry, and no
  handoff row SHALL be drawn

#### Scenario: Two events at one instant keep a stable order
- **WHEN** two entries share a timestamp
- **THEN** the entry key SHALL break the tie
- **AND** the order SHALL be identical across reloads, and across a page boundary that re-reads
  one of them

#### Scenario: The horizon is the most recent of the oldest, not the oldest
- **WHEN** two sources are saturated with different oldest timestamps
- **THEN** the horizon SHALL be the **later** of the two
- **AND** entries between the two SHALL be excluded, because at least one source is already
  truncated there

#### Scenario: A paged club reaches its founding rather than a wall
- **WHEN** a rider extends a stream whose sources all saturated on the first read
- **THEN** each source's horizon SHALL move down as its next window is read
- **AND** when every source's deepest window comes back short, `complete` SHALL be true, the
  `club-created` entry SHALL be appended, and the handoff row SHALL NOT be drawn

#### Scenario: The floor entry is withheld part-way through paging
- **WHEN** the stream has been extended once and a horizon still cuts it
- **THEN** `complete` SHALL be false
- **AND** the `club-created` entry SHALL NOT be drawn, because it would assert that nothing
  happened between the club's founding and the oldest entry on screen

#### Scenario: The merge rule is covered by a unit test rather than by inspection
- **WHEN** the horizon, the tiebreak, the saturation test and the three tail states are
  implemented
- **THEN** they SHALL live in pure functions with their own unit tests
- **AND** each of the behaviours above SHALL have a case, because no other gate in this repo can
  see a silently truncated stream

## ADDED Requirements

### Requirement: An accumulated source SHALL cover its interval contiguously, and a window SHALL declare the interval it covers

Paging SHALL be expressed as **lowering the horizon**, never as five independent cursors. Each
source SHALL be re-asked for the window below the point that source itself stopped at, and the
windows SHALL be accumulated into one source per kind.

An accumulated source SHALL satisfy: **it covers `[horizon, now]` contiguously** — every row of
that source in that interval that the rider may read is present in `rows`. A source with a gap in
its coverage SHALL NOT be passed to the merge, because the merge reads `horizon` as "complete
above this point" and a gap makes the whole stream a plausible, well-ordered, confidently wrong
answer.

Each window SHALL declare the interval it covers — its horizon, the instant it was bounded at, and
whether that instant is inside it. The declaration belongs to the **read**, for the same reason
`ClubTimelineSource.horizon` does: only the read knows what bound it used, and a caller deriving
it would be guessing.

Absorbing a window into an accumulated source SHALL obey one rule in both directions:

1. Inside the window's covered interval the window is authoritative; accumulated rows there that
   it did not return SHALL be dropped.
2. Outside that interval accumulated rows SHALL be kept unchanged.
3. The accumulated horizon SHALL be the older of the two, with "reaches the club's beginning"
   winning.

This SHALL be a pure function with its own unit test, because it is where this change's silent
failure lives.

**A source whose accumulated horizon is `null` is finished and SHALL NOT be asked for another
window.** The bound for a deeper window is that source's own horizon, and `null` denotes *now* —
the first window's bound — so re-asking a finished source does not fetch older rows, it silently
re-fetches page one on every subsequent step for ever. The per-source guard is therefore a
correctness rule and not an optimisation, and it SHALL be expressed per source: a stream-wide
verdict about which tail to draw cannot decide which reads to issue.

**A read that post-processes or re-filters its window SHALL declare its horizon from what it
fetched, not from what survived.** Two sources already do this — the joins read measures its
horizon before dropping riders it cannot name, and the reply read measures its window before the
collapse. A two-step read is the same case: where an accessor returns ids and a second query
re-reads those rows under the caller's own RLS, the second read may legitimately return fewer
rows, and saturation SHALL be taken from the first step. Taken from the second, a window that
saturated but lost one row to a policy reads as short, imposes no horizon, and lets the stream
declare itself `complete` — which draws the club's founding beneath rows it never saw.

#### Scenario: A deeper window extends coverage without a gap
- **WHEN** a source whose horizon is `h` is asked for the window below `h`
- **THEN** the accumulated source SHALL cover from the new window's horizon up to now
- **AND** the merge SHALL be free to draw entries between the two horizons

#### Scenario: A source that came back short is never asked again
- **WHEN** a source's window comes back short of its bound
- **THEN** it SHALL impose no horizon and SHALL NOT be re-read for a deeper window
- **AND** a further page SHALL cost only the reads of the sources that are still saturated

#### Scenario: A finished source is not re-read as if it were the first page
- **WHEN** every source but one has gone short and the rider asks for another page
- **THEN** only the saturated source's read SHALL be issued
- **AND** no read SHALL be issued with an absent upper bound, which would fetch the newest rows
  again rather than older ones

#### Scenario: A two-step read declares its saturation from the step that knows it
- **WHEN** an accessor returns a full page of ids and the RLS-filtered re-read returns fewer rows
- **THEN** the source SHALL be treated as saturated and SHALL impose a horizon
- **AND** the stream SHALL NOT report itself complete, and SHALL NOT draw the club's founding

#### Scenario: A refetched first window does not open a hole beneath itself
- **WHEN** the first window is refetched after new rows were added, so its own horizon moves
  **up**
- **THEN** the rows between the old and the new first-window horizon SHALL be retained from the
  accumulated source
- **AND** the accumulated horizon SHALL remain the deepest window's, because the coverage is still
  contiguous

#### Scenario: A gap is never papered over by keeping the deeper horizon
- **WHEN** an implementation replaces the first window's rows instead of absorbing them
- **THEN** the stream SHALL be wrong in exactly the way the horizon exists to prevent, and the
  unit test SHALL fail
- **AND** the accumulated source SHALL therefore be built by the absorb rule rather than by
  concatenation

### Requirement: No entry SHALL be drawn twice across a page boundary, and the postcard boundary's exception SHALL be stated

Every entry carries a stable key — `ride:`, `postcard:`, `thread:`, `reply:<message id>`,
`join:<user id>`, `club-created:`. Re-reading a boundary SHALL NOT produce two entries with one
key, and SHALL NOT lose a row that sits exactly on it.

Duplication SHALL be prevented structurally, by the absorb rule above, rather than by a
de-duplicating pass over the rendered list: rows at a shared boundary instant are dropped from the
accumulated source before the new window's copies are added. A rider who leaves and rejoins
between two windows SHALL produce one `join:` entry, not two, because a join's identity is the
rider rather than the row.

A deeper window SHALL be bounded **inclusively** (`<= until`) wherever the read can express one,
so that a `limit` slicing through rows that share an instant cannot drop the ones below the cut.

**One source cannot express it, and the consequence SHALL be stated rather than discovered.** The
club feed pages through `public.club_stamp_postcard_ids`, whose bound is `created_at < before` on
the timestamp alone (`086`). Its window SHALL declare itself exclusive, the absorb rule SHALL
honour that by keeping the accumulated rows at the boundary instant, and the residue — two
postcards in one club sharing a `created_at` to the microsecond and straddling a boundary lose the
one below it — SHALL be recorded as a bound this change chose, with its remedy (a keyset argument
on the accessor, which is a migration) named. It SHALL NOT be described as impossible: `044`
writes that column at transaction time, which makes it merely very unlikely.

#### Scenario: A boundary instant is read twice and drawn once
- **WHEN** the oldest rows of a window share an instant with the newest rows of the next
- **THEN** each row SHALL appear exactly once in the stream
- **AND** no React key SHALL be duplicated

#### Scenario: A rejoin across a boundary is one row
- **WHEN** a rider's `club_members` row is deleted and re-created between two windows
- **THEN** exactly one `join:` entry SHALL be drawn, at the current `joined_at`

#### Scenario: The exclusive postcard bound loses nothing that is already held
- **WHEN** the postcard window below `h` is fetched with a strictly-older bound
- **THEN** the accumulated postcards at exactly `h` SHALL be retained rather than dropped
- **AND** no postcard SHALL be drawn twice

### Requirement: The reply source's collapse SHALL stay per-window, and its activity SHALL accumulate by summing

`getClubThreadReplies` reads a window of messages and collapses it to the newest message per
thread, so its window is measured in messages, its output in threads and its horizon in time.
Paging SHALL treat a deeper reply window as "the next window of messages older than where we
stopped", and SHALL NOT require it to yield any particular number of rows.

**The collapse SHALL remain per-window and SHALL NOT become global.** A thread alive in two
windows SHALL produce one entry per window, at two different instants, because each is a true
statement about a different period, and because a global collapse would delete the only evidence
that a period had any conversation in it. The rule the collapse enforces — one club argument SHALL
NOT bury everything else — is a within-window rule and SHALL stay exactly as strong.

**A thread's accumulated activity SHALL be the sum of its per-window counts**, and its participants
the union in shallowest-window-first order. Summing is required rather than preferred: a
thread-creation entry renders its reply count as **exact**, and that is only true if the count
spans the whole of the reply source's contiguous coverage. The accumulated activity SHALL be
derived from the window list rather than incremented in place, so that a refetched first window
re-contributes instead of double-counting.

**Whether a count is exact or a floor SHALL be derived from that same coverage, and SHALL NOT be
accumulated.** A flag set true because some window saturated is monotonic — it never clears — so a
thread whose every message is demonstrably in hand would keep announcing a floor even after the
stream reached the club's founding, and the count would be governed by two contradictory rules at
once. One rule, which the exactness of a creation entry is the special case of:

> A thread's count is **exact** when the reply source's accumulated horizon is `null`, or when the
> thread was created at or after that horizon. Otherwise it is a **floor**.

A count SHALL therefore be able to *improve* as the rider pages: `12+` becomes `12` at the moment
the coverage can prove it.

#### Scenario: A floor becomes exact once the coverage proves it
- **WHEN** the rider pages until the reply source has read back to the club's beginning
- **THEN** every thread's reply count SHALL be rendered as exact
- **AND** no count SHALL still announce a floor because an earlier window happened to saturate

#### Scenario: A busy thread appears once per window, never as a transcript
- **WHEN** one thread carries the whole of two consecutive message windows
- **THEN** it SHALL produce exactly one entry per window
- **AND** SHALL NOT produce one entry per message

#### Scenario: A creation row's exact count survives paging
- **WHEN** a thread-creation entry is drawn above the deepest reply horizon
- **THEN** its reply count SHALL be the sum across every reply window
- **AND** it SHALL be rendered as exact rather than as a floor, because every one of that thread's
  messages lies inside the accumulated coverage

#### Scenario: A refetched first window does not double a count
- **WHEN** the first reply window is refetched
- **THEN** the accumulated counts SHALL be recomputed from the windows
- **AND** a thread's count SHALL NOT grow because the same messages were read twice

#### Scenario: The reply horizon is still measured before the collapse
- **WHEN** any reply window is read, at any depth
- **THEN** its horizon SHALL be the oldest row of the **window**, not of the survivors
- **AND** the floor flag SHALL be set from whether that window filled

### Requirement: The stream SHALL extend on scroll, SHALL raise its cap before it fetches, and SHALL stop at a stated ceiling

Extension SHALL be triggered by the rider approaching the end of the stream, not by a button on
this screen. Whether the two screens that page with a button today adopt the same mechanism is out
of this change's scope.

**A step SHALL raise the display cap first and fetch only when the cap is no longer what cuts.**
The first read of every source already returns far more rows than the display cap draws, so most
steps SHALL cost no round trip at all, and on a club where no source saturates the rider SHALL
reach the club's founding with no additional read.

Extension SHALL stop at a **stated ceiling** on how many windows one visit may fetch. The ceiling
SHALL be a named constant with its reasons recorded — client memory, the growth of the
decoration read's id list, and the total reads one screen may issue — and reaching it SHALL put
the tail in the terminal-but-incomplete state rather than leaving the rider on a spinner.

At most one extension SHALL be in flight at a time. An extension SHALL NOT be attempted while the
rider is offline, and a failed extension SHALL NOT be retried automatically.

**Declining to fetch is not the same as saying nothing.** An offline rider at the end of an
extendable stream SHALL be told the stream is paused, SHALL NOT be shown a loading treatment that
cannot resolve, and SHALL have the stream resume without a gesture when connectivity returns.

#### Scenario: Reaching the end asks for more without a tap
- **WHEN** the rider scrolls to within the sentinel's margin of the last entry
- **THEN** the stream SHALL extend
- **AND** the entries already on screen SHALL NOT move, because rows are appended below them

#### Scenario: A step that needs no read issues none
- **WHEN** the merged in-horizon stream holds more entries than the display cap draws
- **THEN** the step SHALL raise the cap and SHALL NOT issue any read

#### Scenario: An offline rider at the end of the stream is told, not spun
- **WHEN** the rider reaches the end of an extendable stream with no connectivity
- **THEN** the tail SHALL say the stream is paused and SHALL draw no loading treatment
- **AND** the stream SHALL resume on its own when connectivity returns

#### Scenario: The ceiling ends in the handoff, not in a spinner
- **WHEN** a visit has fetched the maximum number of windows and the stream is still incomplete
- **THEN** the handoff row SHALL be drawn
- **AND** no further fetch SHALL be attempted for that mount

#### Scenario: One extension at a time
- **WHEN** the sentinel fires repeatedly while a fetch is in flight
- **THEN** exactly one fetch SHALL be running
- **AND** no window SHALL be fetched twice for the same depth

### Requirement: Paging SHALL add no audience, no accessor and no way to enumerate

Every window at every depth SHALL be an ordinary read of the same table under the same SELECT
policy as the first, differing only by a time bound. The client SHALL NOT add a membership test, a
club-visibility test, a block test or a hide test at any depth, and SHALL NOT relax a filter the
first window carries — the announcement exclusion and the `!inner` thread embed included.

No `security definer` function SHALL be introduced to serve a page of the merged stream, now or
later.

**A rider who may not read the timeline SHALL NOT be able to page it.** For a non-member of a
public club the extension control SHALL NOT be rendered and the source reads SHALL stay disabled
by the null-key state, so the refusal continues to cost no round trip. For a non-member of a
private club the component is not mounted at all, and the reduced preview SHALL gain no read.

A blocked rider SHALL be absent from every window at every depth, by the four source policies and
by nothing the client adds.

#### Scenario: A non-member of a public club cannot trigger a page
- **WHEN** a non-member opens a public club that has hundreds of entries
- **THEN** no sentinel SHALL be rendered and no source read SHALL be issued
- **AND** the refusal sentence and the join affordance SHALL be what is drawn

#### Scenario: A deeper window is the same policy as the first
- **WHEN** any window beyond the first is read
- **THEN** its predicates SHALL name only the club, the ordering window and the time bound
- **AND** the rows returned SHALL be exactly those the rider could already have read by other
  means

#### Scenario: A blocked rider is absent at depth
- **WHEN** a rider blocked in either direction has content older than the first window
- **THEN** none of it SHALL appear in any deeper window
- **AND** the absence SHALL come from each table's own policy rather than from a client filter

#### Scenario: No merged-stream accessor is added for paging
- **WHEN** this change is complete
- **THEN** no function in `public` or `private` SHALL return rows of more than one club event kind
- **AND** no migration SHALL be part of this change

### Requirement: The return anchor SHALL hunt for its row within a bounded budget, and SHALL stay a no-op when it cannot be found

A rider returning from a thread carries a row key as a URL fragment. The screen SHALL extend the
stream, without a gesture, until that row exists — up to a stated budget of windows, smaller than
the extension ceiling because this runs unasked on load.

The hunt SHALL terminate on any of three conditions: the row appears, the stream is complete, or
the budget is spent. Its budget SHALL be drawn from the mount's own extension ceiling rather than
added to it, so that a mount's worst case is the ceiling and not the ceiling plus the hunt.

The scroll SHALL happen at most once per mount, and a hunt that ends without finding the row SHALL
leave the screen unable to scroll later — an arriving refetch that happens to make the row exist
SHALL NOT yank a rider who has started reading.

**Those are two states and SHALL be held as two.** "The hunt is over" and "the screen has already
scrolled" have different triggers — the first latches on an outcome that may be a failure, the
second on an action that may never occur — so a single flag cannot express both. A flag raised
when the rows first arrive, before any hunting fetch has been issued, SHALL NOT be used as the
guard: it ends the hunt before it starts, because every window the hunt fetches makes the rows
"ready" again.

**An unreachable anchor SHALL remain an ordinary no-op**, never a throw, an error state or a
report. Some anchors are unreachable in principle rather than merely deep: a `reply:<message id>`
names one message, and the collapse keeps only the newest message per thread per window, so a
newer message in that thread makes the anchored one unreachable for ever. A deleted row and a row
whose author has since been blocked are the same shape.

#### Scenario: A row past the first window is found and scrolled to
- **WHEN** a rider returns from a thread whose entry sits below the first window
- **THEN** the screen SHALL extend until that row exists, within the budget
- **AND** SHALL scroll to it once

#### Scenario: An unreachable anchor costs a bounded number of reads and nothing else
- **WHEN** the fragment names a row that no window can contain
- **THEN** the hunt SHALL stop at the budget or at completeness
- **AND** the screen SHALL render normally with no error, no report and no scroll

#### Scenario: A late refetch does not move a reading rider
- **WHEN** the hunt has already finished and a refetch later makes the anchored row exist
- **THEN** the screen SHALL NOT scroll

#### Scenario: The hunt survives its own fetches
- **WHEN** a hunted window lands and the rows become ready again
- **THEN** the hunt SHALL continue rather than being ended by the arrival of its own results
- **AND** the guard that prevents a second scroll SHALL NOT be what decides whether to keep
  hunting

#### Scenario: A hunt does not raise the mount's read ceiling
- **WHEN** a hunt spends part of the budget and the rider then scrolls
- **THEN** the windows the hunt fetched SHALL count against the same ceiling
- **AND** the total windows fetched in that mount SHALL NOT exceed it
