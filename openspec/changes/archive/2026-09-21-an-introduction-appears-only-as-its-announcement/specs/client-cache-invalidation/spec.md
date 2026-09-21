## ADDED Requirements

### Requirement: A cache key whose last writer is removed SHALL be removed with it

When the only action that invalidated a key and the only read that filled it are both deleted, the
key SHALL be deleted too, along with any documentation naming it as a claim. A key nothing writes
and nothing reads is indistinguishable from a live one at the call site, and the next screen that
needs a club-scoped decoration will reach for it.

Removing it SHALL NOT change what any surviving invalidation reaches: the removed key was a sibling
under the club's detail prefix, so every wider invalidation that reached it also reached its
siblings, and those SHALL still be reached.

#### Scenario: The key and its claim go together
- **WHEN** the thread wave action and read are removed
- **THEN** the key they shared SHALL be removed
- **AND** the invalidation-claim table naming those writers SHALL be updated in the same change

#### Scenario: The surviving keys are unaffected
- **WHEN** a club-wide invalidation runs after the change
- **THEN** it SHALL reach exactly the keys it reached before, less the removed one

### Requirement: A narrowed read SHALL keep the key it already had, and SHALL NOT gain a second one

The reads that gain the announcement filter SHALL keep their existing cache keys. The filter is not a
parameter a caller chooses — it is part of what the read means — so it SHALL NOT become a key
segment, and no surface SHALL be able to ask for the unfiltered variant.

This matters because two of these keys are shared: the thread list key is read by both the Threads
list and the timeline, and the unread key by both the timeline and the club options menu. Sharing is
correct only while every reader wants the same rows, and after this change they do.

#### Scenario: One key, one meaning
- **WHEN** the Threads list and the timeline read the club's threads
- **THEN** they SHALL share one cache entry
- **AND** that entry SHALL hold listable threads only

#### Scenario: The unread map has one shape for all its readers
- **WHEN** the timeline and the club options menu read the unread map
- **THEN** they SHALL share one cache entry
- **AND** it SHALL answer for listable threads only

#### Scenario: Existing invalidations still cover these reads
- **WHEN** a thread is created, deleted or moderated, or a message is posted
- **THEN** the invalidations that reach these keys today SHALL still reach them
- **AND** no new invalidation SHALL be required by this change
