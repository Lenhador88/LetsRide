## MODIFIED Requirements

### Requirement: The timeline SHALL be derived from live rows, and what that omits SHALL be stated

The timeline holds no **event** rows of its own. Every entry is a live row in one of the sources,
so the stream is a view of the club's **current** state rather than a history of it. Five
consequences SHALL be treated as designed behaviour rather than defects, and SHALL be stated
wherever the timeline is described:

- **A rider who leaves erases their own join entry**, because the `club_members` row is deleted.
  A club that twenty riders joined and left shows a timeline claiming nothing happened.
- **A rider who leaves and rejoins appears to join for the first time**, at their new `joined_at`.
- **A deleted postcard, ride or thread removes its entry**, with no tombstone.
- **A wave dies with the entry it decorates**, from `club-timeline-engagement`.
  `club_join_waves` cascades from `club_members (club_id, user_id)` and `club_thread_waves` from
  `club_threads(id)`, so a leave, a thread deletion or an account deletion removes the reactions
  along with the row — and a rejoin starts at zero waves rather than inheriting the old ones.
- **An introduction does NOT die with the membership it decorates**, which is new in this change
  and is the one deliberate asymmetry with the wave beside it. A wave is a reaction to an event; an
  introduction is words, and the comments under it are other riders' words. So a leave clears the
  marker and leaves the thread standing as an ordinary thread, and the join entry it decorated has
  gone anyway. A rejoin therefore starts with **no** introduction and does not inherit the old
  thread.

There SHALL be no "a rider left" entry, in this change or in any successor built on this design: a
leave is a DELETE and there is no row to read.

**The timeline DOES now hold rows of its own in one narrow sense, and the distinction is the
point.** It holds *reaction* rows — `club_thread_waves` and `club_join_waves` — which are not
entries and never appear in the merged output. An introduction is **not** one of those: it is a
`club_threads` row, so it is an entry in its own right on the thread source *and* a decoration on a
join entry, and it SHALL appear once as each. That double appearance is designed and SHALL NOT be
suppressed on either side.

#### Scenario: A leave takes its own join entry and its waves with it
- **WHEN** a rider leaves the club
- **THEN** their join entry SHALL disappear from every member's timeline
- **AND** every wave placed on that join SHALL be deleted by cascade
- **AND** no "left the club" entry SHALL appear

#### Scenario: A leave does NOT take the introduction with it
- **WHEN** a rider who had introduced themselves leaves the club
- **THEN** the introduction's thread SHALL remain on the timeline as an ordinary thread entry
- **AND** every comment written in it SHALL survive

#### Scenario: A rejoin is indistinguishable from a first join, waves and introduction included
- **WHEN** a rider leaves and rejoins
- **THEN** a join entry SHALL appear at the new `joined_at` carrying **zero** waves
- **AND** no wave placed before the departure SHALL reappear
- **AND** the new join entry SHALL carry no introduction, no comment icon and no count

#### Scenario: `joined_at` cannot be forged
- **WHEN** a rider attempts to write `club_members.joined_at`
- **THEN** the write SHALL be refused, because `048` grants `authenticated` only
  `insert (club_id, role, user_id)` and `update (club_id, role, user_id)`
- **AND** a rider SHALL therefore be unable to place themselves, or a wave addressed to them,
  anywhere in another club's timeline

## ADDED Requirements

### Requirement: A count on a timeline row SHALL be per-viewer, and a windowed one SHALL say so

Two counts now appear on the timeline and they are computed differently. The distinction SHALL be
preserved rather than harmonised, because only one of them is bounded by a read window.

- The **introduction's comment count** on a join row SHALL be an unbounded aggregate over the rows
  row security returns for that thread. It SHALL NOT carry a "more than this" mark, because there
  is no window to overflow.
- The **thread row's count** SHALL continue to be derived from the club-wide message window, and
  SHALL continue to mark that it is a floor **on exactly the rows that already carry the mark
  today, and on no others**. Replacing the words `N replies` with an icon and a number SHALL
  change only the rendering: a row marked as a floor before the change SHALL be marked after it,
  and a row not marked before SHALL NOT become marked.

  **A full window is necessary and NOT sufficient**, and this is the half that inverts if the rule
  is restated from the window alone. A thread's **creation** row that survives the stream's
  coherence cut was created after the reply window's oldest message, so every one of its replies is
  inside that window and its count is exact — the floor mark is cleared on those rows deliberately,
  and carrying it renders `2+` on a thread that has exactly two. The mark is earned on a **reply**
  row, where an older thread's earlier messages can genuinely fall outside.

Neither count SHALL be presented as a fact about the club, and neither SHALL order any list.

#### Scenario: The windowed count keeps its floor mark where it had one
- **WHEN** a reply row's count is derived from a full message window
- **THEN** the number SHALL be rendered as a floor and SHALL NOT be rendered as an exact total

#### Scenario: A creation row does NOT gain a floor mark from a full window
- **WHEN** a thread-creation row inside the coherence horizon has its count derived from a full
  message window
- **THEN** the number SHALL be rendered exactly, with no floor mark
- **AND** a thread with two replies SHALL render `2` and never `2+`

#### Scenario: The introduction count carries no floor mark
- **WHEN** a join row draws its introduction's comment count
- **THEN** the number SHALL be exact for that viewer
- **AND** it SHALL NOT be marked as a floor, because it is not read through a window

### Requirement: The timeline SHALL gain no source, and the condition under which that changes SHALL be stated

An introduction contributes no event, no ordering key and no new source: it decorates a join entry
that is already on the stream and appears in its own right only as the thread entry it already was.
The stream's coherence horizon SHALL therefore be unchanged.

This SHALL stop being true the moment an introduction produces an entry of its own — *"Ana
introduced themselves"* as a row — which would be a source and would owe a horizon like every other.

#### Scenario: No horizon changes
- **WHEN** this change is applied
- **THEN** the set of sources merged into the stream SHALL be unchanged
- **AND** the horizon SHALL be computed from exactly the sources it was computed from before

#### Scenario: Reads for the decoration are scoped to what is on screen
- **WHEN** the screen reads introductions for its join entries
- **THEN** it SHALL read only for the subjects already on the stream
- **AND** it SHALL NOT read every introduction the club has ever held
