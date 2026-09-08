## ADDED Requirements

### Requirement: A mutation that moves a row's POSITION SHALL invalidate the source that owns that position

Posting or erasing a thread message invalidates the thread's own message list and the timeline's
reply key today, and that is complete only while the reply source carries the reply row.

This change moves the position onto the **thread** source, so the same mutation SHALL also
invalidate the thread source's key — `clubs.threads(clubId)` and `rides.threads(rideId)`. Without
it the reply count updates on a row that does not move, and the bump the rider was promised does not
appear until an unrelated refetch or the next mount.

The rule generalises and SHALL be stated as such: **a mutation SHALL invalidate every key whose
ORDER it changes, not only every key whose CONTENT it changes.** A write that reorders a list it does
not add a row to is the case this repo has no other way to catch — the list is not empty, not stale
in content, and simply in the wrong order.

Both the create path and the erase path SHALL be covered, since they share one helper in each
domain.

#### Scenario: A reply moves the thread to the top of the timeline
- **WHEN** a member posts a reply in a club thread
- **THEN** `clubs.threads(clubId)`, `clubs.threadReplies(clubId)` and
  `clubs.threadMessages(threadId)` SHALL all be invalidated
- **AND** the timeline SHALL redraw with that thread at its new position without a manual reload

#### Scenario: The ride domain is invalidated identically
- **WHEN** a crew member posts a reply in a ride thread
- **THEN** `rides.threads(rideId)`, `rides.threadReplies(rideId)` and
  `rides.threadMessages(threadId)` SHALL all be invalidated

#### Scenario: The erase path invalidates what the create path does
- **WHEN** a rider erases their own message
- **THEN** the same keys SHALL be invalidated
- **AND** the thread SHALL keep its position, because a deletion does not un-bump — the invalidation
  is for the count and the participant faces, which do change

#### Scenario: The claim is asserted rather than reviewed
- **WHEN** this change is complete
- **THEN** the existing action-module test that reads each writer's cache claim SHALL cover the
  thread-source key
- **AND** a writer that moves a thread's position without claiming that key SHALL fail it

### Requirement: A cached window SHALL NOT be able to hold one row at two positions

The club timeline accumulates windows across paging steps, and each window holds its rows as they
were at its own fetch. With a mutable position, two windows can disagree about where one thread
belongs.

The accumulated source SHALL be de-duplicated by row identity, so that a thread present in more than
one window resolves to exactly one row. The stream SHALL NOT be able to render two entries with one
key, and the de-duplication SHALL be structural — in the fold — rather than a pass over the rendered
list.

A refetched first window SHALL be authoritative for the rows it returns, at whatever position it
returns them, and SHALL replace those rows wherever a deeper window is still holding them.

#### Scenario: A refetch does not duplicate a bumped thread
- **WHEN** a thread held in a deep window is bumped and the first window refetches
- **THEN** the accumulated source SHALL hold one row for that thread, at its new position
- **AND** the deep window's stale copy SHALL be dropped

#### Scenario: Stale positions do not accumulate across steps
- **WHEN** a rider pages several times while other members are replying
- **THEN** each thread SHALL appear exactly once in the merged stream
- **AND** the number of rows SHALL NOT grow with the number of refetches
