## ADDED Requirements

### Requirement: A deferred join SHALL invalidate nothing, and Post SHALL inherit both writes' claims in order

Deferring writes nothing, so it SHALL make no cache claim: no key SHALL be invalidated, no query
SHALL be refetched, and no cached row SHALL be set by it. An invalidation on a path that wrote
nothing is a round trip spent to confirm that nothing happened.

`Post` performs two writes and SHALL carry **both** existing claims, each after its own write
succeeds and in the order the writes are issued — the membership claim first, then the
introduction's. The claims SHALL NOT be merged into one, deferred to the end, or issued for a write
that failed: a membership claim issued after a failed join would refetch the club lists to prove
nothing changed, and an introduction claim issued after a failed introduction would drop a cached
answer that is still correct.

#### Scenario: Deferring makes no claim
- **WHEN** a rider defers the pre-join sheet
- **THEN** no cache key SHALL be invalidated
- **AND** no query SHALL refetch as a result of the deferral

#### Scenario: Each claim follows its own write
- **WHEN** the membership write succeeds and the introduction write then fails
- **THEN** the membership's invalidations SHALL have been issued
- **AND** the introduction's SHALL NOT

#### Scenario: The claims are the existing ones
- **WHEN** `Post` succeeds
- **THEN** the keys invalidated SHALL be exactly those the membership write and the introduction
  write already claim today
- **AND** this change SHALL add no new key

### Requirement: A sheet SHALL outlive the invalidation that removes the control which opened it

The membership write invalidates the club lists, so the list row carrying the Join control is
removed and unmounted while the introduction write is still in flight. Any component holding a
rider's composed text SHALL therefore be mounted above the row it was opened from, on a screen the
invalidation does not unmount.

This is a property of the ownership, not of the queue that happens to implement it, and it SHALL
hold however the opening is modelled.

#### Scenario: The row leaves and the sheet stays
- **WHEN** the membership write's invalidation removes the joined club from the list it was joined
  from
- **THEN** the sheet SHALL remain mounted with its composed text
- **AND** the introduction write SHALL complete against the club it was composed for

#### Scenario: A refetch does not reset a draft
- **WHEN** any query the screen holds refetches while the sheet is open
- **THEN** the sheet SHALL NOT be remounted and its text SHALL NOT be cleared
