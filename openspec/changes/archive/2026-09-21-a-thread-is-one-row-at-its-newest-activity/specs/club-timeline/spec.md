## ADDED Requirements

### Requirement: A thread SHALL contribute exactly one entry to the stream, positioned at its newest activity

The stream SHALL carry **one** entry per thread, never one for the thread's creation and a second
for its newest reply. That entry SHALL be positioned at the thread's `last_activity_at` — the
instant of its newest message, or its own `created_at` when it has none.

The `reply` event kind SHALL be removed from `ClubTimelineEvent`. The reply **source** SHALL remain,
as a decoration source: it SHALL supply each thread's reply count, that count's `partial` flag and
the thread's participant faces, and it SHALL contribute no entry to the stream.

The thread entry SHALL carry the comment glyph, the reply count and the participants — everything
the removed reply entry conveyed — so that removing the second row removes no information.

A thread SHALL be readable at exactly one position at a time. Two entries bearing one thread's key
SHALL NOT be produced under any read, refetch or paging sequence.

#### Scenario: A thread that has been replied to draws one row
- **WHEN** a member opens a club whose thread was created in March and replied to this morning
- **THEN** the timeline SHALL draw exactly one entry for that thread
- **AND** it SHALL sit at this morning's reply, not in March
- **AND** it SHALL carry the reply count and the participant faces

#### Scenario: A thread with no replies keeps the position it has today
- **WHEN** a thread has been created and never replied to
- **THEN** it SHALL appear at its own `created_at`, exactly where it appears before this change
- **AND** its count SHALL be zero rather than absent

#### Scenario: The reply source draws nothing
- **WHEN** the timeline is merged
- **THEN** no entry SHALL be built from the reply source
- **AND** the reply source SHALL still be read, because the count, the `partial` flag and the faces
  come from it

### Requirement: The thread source SHALL be ordered, bounded and horizoned in the SAME dimension it is positioned in

The thread read SHALL order by `last_activity_at` descending with `id` as the tiebreak, SHALL apply
its paging bound (`until`) to `last_activity_at`, and SHALL declare its horizon from
`last_activity_at`.

Ordering on one column while measuring the horizon or the paging bound on another SHALL NOT be done.
A source that orders by activity and reports a horizon in creation time makes the timeline foot's
*"the stream is cut here"* a claim about a boundary that does not exist, and lets rows be dropped or
repeated at every page edge.

The stream's coherence horizon SHALL therefore continue to mean what it means — the newest of the
saturated sources' oldest returned positions — with the thread source's contribution now expressed
in activity time. An entry whose thread was created long before the horizon SHALL be drawn when its
activity is above it; that is the change's intent and not a leak past the horizon.

#### Scenario: A revived thread survives the cut
- **WHEN** the stream's horizon is at yesterday and a thread created in March was replied to this
  morning
- **THEN** that thread's entry SHALL be inside the horizon and SHALL be drawn
- **AND** the foot SHALL make the same claim it makes today about what lies below the cut

#### Scenario: The paging bound and the horizon name one column
- **WHEN** a deeper window of threads is requested
- **THEN** the bound SHALL be `last_activity_at <= h`, where `h` is the thread source's own
  accumulated horizon in the same dimension
- **AND** no window SHALL be bounded on `created_at`

#### Scenario: A thread source that came back short imposes no horizon
- **WHEN** the thread window returns fewer rows than its bound
- **THEN** it SHALL impose no horizon, exactly as before
- **AND** the change of ordering column SHALL NOT alter the saturation test

### Requirement: The reply source's horizon SHALL leave the merge's horizon list, and SHALL still decide exactness

A source that contributes no entry SHALL NOT cut the stream. The reply source's horizon SHALL be
removed from the set the merge reduces to the coherence horizon, and `complete` SHALL be derived
from the remaining four.

This SHALL NOT be described as a relaxation. The reply source's horizon exists to say how far back
the *message* window reached; with no reply entry on the stream there is no row it can withhold, so
including it would withhold the club's founding entry and mark a stream incomplete for rows that
were never going to be drawn.

The reply horizon SHALL continue to govern whether a thread's reply count is exact or a floor, by
the rule that already exists: a count is exact when the reply source's accumulated horizon is `null`
**or** when the thread was created at or after that horizon.

**That comparison SHALL use the thread's `created_at`, never its `last_activity_at`.** Exactness
asks whether every one of a thread's messages lies inside the reply source's coverage, which depends
on when the thread started. A thread that has just bumped has `last_activity_at` above the horizon
while older messages of its own sit below it, so comparing the entry's own position would render a
floor as an exact total — a wrong number presented as a right one. The thread's `created_at` SHALL
therefore remain on the entry after the ordering column changes.

#### Scenario: A busy conversation no longer marks the stream incomplete
- **WHEN** the reply window saturates but every other source comes back short
- **THEN** the coherence horizon SHALL be `null`, `complete` SHALL be true and the club's founding
  entry SHALL be drawn
- **AND** the thread counts SHALL still be rendered as floors where the reply coverage cannot prove
  them exact

#### Scenario: A bumped old thread does not claim an exact count
- **WHEN** a thread created before the reply horizon is bumped to the top of the stream
- **THEN** its count SHALL be rendered as a floor
- **AND** the exactness comparison SHALL be made against the thread's creation, not its position

#### Scenario: A thread created inside the reply coverage claims its count exactly
- **WHEN** a thread was created at or after the reply source's accumulated horizon
- **THEN** its count SHALL be exact
- **AND** paging deeper SHALL be able to turn a floor into an exact count, never the reverse

### Requirement: An accumulated source SHALL be de-duplicated by row identity, because one row type's position is now mutable

`absorbClubTimelineWindow` keeps accumulated rows that fall outside the incoming window's covered
interval **without consulting their id**, and then concatenates the window's rows. That is correct
only while a row's position is immutable. A bumping thread makes it wrong in both directions, and
neither failure is visible to any automated gate in this repo.

The absorb rule SHALL therefore drop any accumulated row whose identity the incoming window supplies,
**regardless of interval**, before the window's rows are added. No accumulated source SHALL hold two
rows with one identity, and the merge SHALL NOT be able to emit two entries with one key.

A row whose position moved **above** an already-fetched window SHALL NOT be lost. Where the absorb
rule alone cannot guarantee this — the row was below the first window when it was read and above it
when it bumped — the first window's refetch SHALL be what restores it, and the reply mutation SHALL
invalidate the thread source so that refetch happens.

#### Scenario: A bumped thread is not drawn twice
- **GIVEN** a thread held in a deep accumulated window at its old position
- **WHEN** a reply bumps it above the first window's horizon and the first window refetches
- **THEN** the accumulated source SHALL hold exactly one row for that thread, at its new position
- **AND** no two entries SHALL share the key `thread:<id>`

#### Scenario: A thread that bumps between two window fetches is not lost
- **GIVEN** a thread below the first window's horizon when that window was read
- **WHEN** it is bumped above that horizon and a deeper window is then fetched
- **THEN** the thread SHALL be present in the stream once the first window has been refetched
- **AND** it SHALL NOT be silently absent from every window at once

#### Scenario: The de-duplication is a pure function with its own test
- **WHEN** the absorb rule is implemented
- **THEN** its identity rule SHALL be covered by a unit test asserting both the duplicate and the
  loss
- **AND** the test SHALL fail against the interval-only rule that exists today

### Requirement: A thread SHALL have ONE anchor key, and the return trip SHALL still land

A rider returning from a thread carries a row key as a URL fragment (PD-366). The two event kinds
carry two different keys today — `thread:<thread id>` and `reply:<message id>` — and one row per
thread means one key.

The surviving key SHALL be `thread:<thread id>`. `clubThreadFromTimeline` SHALL round-trip it, the
row SHALL render it as its `id`, and the anchor hunt SHALL extend the stream looking for it under
the same bounded budget it uses today.

**A `reply:<message id>` fragment SHALL become permanently unreachable, and SHALL remain an ordinary
no-op.** Such a fragment can only arrive from a link built before this change; it SHALL NOT throw,
SHALL NOT produce an error state, SHALL NOT be reported, and SHALL leave the screen rendered
normally with no scroll. The existing rule already covers this — an anchor unreachable in principle
is a no-op — and this change SHALL NOT narrow it.

The anchor hunt SHALL terminate on the same three conditions as today: the row appears, the stream is
complete, or the budget is spent. A bumping row SHALL NOT be able to make the hunt non-terminating:
the hunt SHALL stop at its budget whether the row moved or was never there.

#### Scenario: Back from a thread lands on that thread's row
- **WHEN** a rider opens a thread from the timeline and presses Back
- **THEN** the screen SHALL scroll to that thread's single row
- **AND** it SHALL do so whether the row sits at the thread's creation or at its newest reply

#### Scenario: A stale reply anchor is a no-op
- **WHEN** the fragment names `reply:<message id>`
- **THEN** the hunt SHALL end at completeness or at its budget
- **AND** the screen SHALL render normally, with no error and no scroll

#### Scenario: The anchor survives the row moving under the hunt
- **WHEN** the anchored thread is bumped while the hunt is fetching windows
- **THEN** the hunt SHALL still terminate within its budget
- **AND** SHALL scroll at most once for the mount

### Requirement: The thread entry's position SHALL be read from the database and SHALL NOT be derived from a fetched message window

The entry's position SHALL come from a stored column on the thread row. It SHALL NOT be computed by
scanning a bounded window of messages and taking the newest per thread.

A derived position is wrong exactly where this change matters: on a paging club, a thread whose
newest reply falls outside the fetched message window has no known position, so it would be placed
at its creation date — sinking the quiet-then-revived thread that the newest-activity decision
exists to surface. A stored column also makes the position indexable, so the thread source can be
ordered and bounded in the database rather than in the client.

#### Scenario: A thread whose newest reply is outside the message window still sorts correctly
- **WHEN** a thread's newest reply is older than every message in the reply source's window
- **THEN** the thread's entry SHALL still be positioned at that reply
- **AND** its position SHALL NOT fall back to its creation date

#### Scenario: The ordering is served by an index
- **WHEN** the thread source is read for a club
- **THEN** the read SHALL be served by an index on `(club_id, last_activity_at desc, id desc)`
- **AND** no client-side re-sort SHALL be required to establish the stream's order

### Requirement: The single entry SHALL keep the unread signal, and SHALL carry it once

The unread dot is carried by both event kinds today, read from one per-thread map. One entry per
thread SHALL carry it once, from that same map, and the dot SHALL mean what it means now: this
thread holds messages newer than the reader's watermark.

Collapsing two entries into one SHALL NOT change when the dot appears, when it clears, or which
threads it counts. The watermark, its RPC and its cache key SHALL be untouched by this change.

#### Scenario: An unread thread shows one dot
- **WHEN** a thread holds messages newer than the reader's watermark
- **THEN** exactly one entry SHALL be marked unread
- **AND** opening the thread SHALL clear it exactly as it does today

### Requirement: Position SHALL NOT become an audience signal, and no role's reach SHALL change

`last_activity_at` is a sort key. It SHALL NOT appear in any policy, in any audience predicate, or in
any decision about what a rider may read.

`081`'s SELECT policy on `club_threads` SHALL be untouched. A non-member of a public club SHALL read
zero thread rows, a non-member of a private club SHALL reach no timeline at all, a blocked rider
SHALL be absent in both directions by `private.is_blocked`, and a signed-out visitor SHALL reach
nothing — no `anon` grant on `club_threads` and no policy naming `anon`.

A rider SHALL NOT be able to move their own thread, or any other rider's, other than by posting a
message they were already entitled to post.

#### Scenario: A non-member of a public club sees no thread and no position
- **WHEN** a non-member opens a public club whose threads are busy
- **THEN** the timeline SHALL be refused entire, as it is today
- **AND** no thread position SHALL be observable by any means

#### Scenario: A blocked rider's reply does not surface their identity
- **WHEN** a rider blocked in either direction replies in a thread the reader can see
- **THEN** the thread's position MAY move
- **AND** the reader SHALL learn no author, no body and no change in the reply count, because every
  reply read is block-filtered by the same policies

#### Scenario: A rider cannot bump a thread directly
- **WHEN** a rider attempts to write `last_activity_at` on any thread row
- **THEN** the write SHALL be refused
- **AND** the refusal SHALL come from the absence of both a column grant and an UPDATE policy, not
  from client-side validation
