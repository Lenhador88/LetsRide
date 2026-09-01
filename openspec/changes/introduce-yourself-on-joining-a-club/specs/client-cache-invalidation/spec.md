## ADDED Requirements

### Requirement: Posting an introduction SHALL invalidate every key it moves, and the join row SHALL NOT be one of them by accident

One write changes four things a rider can see: whether they still owe an introduction, the club's
thread list, the club's timeline, and the join row's comment count. Each SHALL be named at the call
site rather than covered by invalidating a prefix and hoping.

The keys the introduction decoration is held under SHALL be children of the club's detail key, so
they die with the club's other per-club state, and SHALL be separate from the wave keys beside them
— the two are read under different predicates and a screen holding one SHALL NOT be handed the
other's.

#### Scenario: A posted introduction moves all four
- **WHEN** an introduction is posted
- **THEN** the introduction decoration, the club's threads, the club's timeline sources and the
  rider's own "do I owe one" state SHALL each be invalidated
- **AND** the join row SHALL show its new count without a reload

#### Scenario: A deleted introduction moves the same four
- **WHEN** an introduction's thread is deleted by its author or taken down by an admin
- **THEN** the same keys SHALL be invalidated
- **AND** the join row SHALL lose its count and its link in the same pass

### Requirement: A comment count SHALL be invalidated with the message list it summarises

The count on a join row and the messages inside the thread are two readings of the same rows.
Posting or erasing a comment SHALL invalidate both, so that returning from a thread to the club
does not show a number that disagrees with what was just read.

#### Scenario: Commenting updates the count behind the screen
- **WHEN** a member posts a comment in an introduction's thread and navigates back to the club
- **THEN** the join row's count SHALL include it

#### Scenario: Erasing a comment updates the count
- **WHEN** a member erases their own comment in an introduction's thread
- **THEN** the join row's count SHALL fall by one for them
- **AND** SHALL be unchanged for a viewer who could not read that comment

### Requirement: A per-viewer count SHALL NOT be cached under a key shared with a different viewer or a different predicate

The count is an aggregate over the rows row security returns to the reader, so it is not a fact
about the thread. It SHALL NOT be stored in a cache entry that another screen reads under a
different predicate, and it SHALL NOT survive a change of session.

#### Scenario: Sign-out clears it
- **WHEN** a rider signs out
- **THEN** every cached introduction and count SHALL be discarded with the rest of the cache

#### Scenario: One key, one predicate
- **WHEN** two screens display a count for the same thread
- **THEN** they SHALL read it under the same key and the same predicate, or under two keys
- **AND** neither SHALL reuse the other's entry
