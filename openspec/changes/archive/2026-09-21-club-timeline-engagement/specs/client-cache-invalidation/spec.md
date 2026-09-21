## ADDED Requirements

### Requirement: Wave state SHALL be cached with the entries it decorates, and a toggle SHALL invalidate every key it moves

The two wave reads SHALL take keys under `clubs.detail(clubId)` — the nesting `members`, `threads`,
`joins` and `threadReplies` already use — so an invalidation of `clubs.all()` or
`clubs.detail(clubId)` reaches them for free.

**No key SHALL hold a merged "entry plus its waves" shape.** Two shapes under one key is the
collision `keys.ts`'s header warns against, and here it would put a decorated timeline entry behind
the same key as the undecorated one the Threads list reads.

A wave toggle SHALL invalidate every key its row appears under:

- waving or un-waving a **thread** → the club's thread-wave key. It SHALL NOT invalidate
  `clubs.detail(clubId).threads`, whose rows have not changed, and SHALL NOT invalidate the unread
  map, which is a different fact about the same thread.
- waving or un-waving a **join** → the club's join-wave key **and** `notifications` for nobody, the
  fan-out being addressed to another rider whose client this one cannot invalidate.

**The optimistic toggle is the rider's own view and the invalidation is the correction.** The
local state moves first (`LikeButton`'s behaviour), the write answers, and a refused write rolls it
back — the cache is not the mechanism for the first two.

#### Scenario: A wave appears without a reload and without refetching the entry
- **WHEN** a member waves a thread on the timeline
- **THEN** the pressed state and the count SHALL move immediately
- **AND** the thread entry itself SHALL NOT be refetched, its row being unchanged

#### Scenario: The wave state is reachable from the club prefix
- **WHEN** any club mutation invalidates `clubs.all()` or `clubs.detail(clubId)`
- **THEN** both wave keys SHALL be reached, being children of `clubs.detail(clubId)`

#### Scenario: No key holds a decorated entry
- **WHEN** the timeline renders
- **THEN** each source's key SHALL hold its own undecorated rows
- **AND** the decoration SHALL be applied where the entries are assembled, not stored merged

### Requirement: A per-viewer count SHALL NOT be shared with a screen that reads a different predicate

The wave count on a timeline entry is computed under the caller's own RLS and is therefore specific
to that rider. It SHALL NOT be written into a cache entry another rider's session could read, and
it SHALL NOT be reused by a screen whose read applies a different predicate.

`client-cache-invalidation` already requires that a count and the list it summarises be invalidated
together and read through the same predicate. **The wave count and its entry satisfy that**, since
both come from reads issued in the same session under the same policies. What SHALL be recorded is
the negative: there is no aggregate wave count anywhere — no club total, no "most waved" — so
nothing exists that would need to agree with a list it does not summarise.

#### Scenario: No aggregate wave figure exists to disagree with anything
- **WHEN** the change is complete
- **THEN** no screen, badge, RPC or cache key SHALL hold a wave total spanning more than one entry
- **AND** the absence SHALL be recorded where the counts are defined, so a later "most waved
  threads" strip is understood to need its own predicate decision first

#### Scenario: A failed wave read leaves the entry cached and correct
- **WHEN** the wave read errors while the entry's own read succeeded
- **THEN** the entry SHALL remain cached under its own key, undecorated
- **AND** no partial or zeroed wave state SHALL be written into any cache entry
