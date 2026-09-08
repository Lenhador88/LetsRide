## ADDED Requirements

### Requirement: Each timeline source SHALL keep its own cache key, and a write from the create bar SHALL invalidate every source it moves

The timeline is a merge of reads that other screens also make, so it SHALL NOT be given a cache
entry of its own holding the merged result. Two shapes under one key is the collision
`keys.ts`'s own header warns against, and here it would put a 40-entry merged stream and a
30-row postcard feed behind whichever screen loaded first.

The postcards source SHALL keep reading `postcards.feed(filterSegment.club(id))` and the rides
strip `rides.list(filterSegment.club(id))`, unchanged, so the club detail and
`/postcards?club=<id>` and `/clubs/detail/rides` stay in agreement about their contents. The two
new reads SHALL take new keys under `clubs.detail(clubId)` — the same nesting `members`,
`threads` and `joinRequests` use — so any invalidation of `clubs.all()` reaches them for free.

A write made from the create bar SHALL invalidate every key its rows appear under, including
the ones it did not previously have to name:

- creating a ride in the club → the club's rides list **and** the new recent-rides key
- posting a postcard to the club → the club's postcard feed key
- starting a thread → `clubs.detail(clubId).threads` **and** its unread child
- joining or leaving → the new recent-joins key **and** `clubs.detail(clubId).members`, which
  the Members rail reads

#### Scenario: A newly created ride appears in both places it is drawn
- **WHEN** a member creates a ride from the create bar
- **THEN** the upcoming-rides strip and the timeline SHALL both show it without a reload
- **AND** the two SHALL NOT disagree, because each reads its own key and both are invalidated

#### Scenario: The merged stream is not cached
- **WHEN** the timeline renders
- **THEN** no cache key SHALL hold the merged result
- **AND** the merge SHALL be recomputed from the source entries on each render, being a pure
  function of them

#### Scenario: A new key is reachable from the club prefix
- **WHEN** any club mutation invalidates `clubs.all()` or `clubs.detail(clubId)`
- **THEN** both new keys SHALL be reached, being children of `clubs.detail(clubId)`

### Requirement: A count that summarises a DIFFERENT predicate from the list it sits beside SHALL say so where it is defined

`client-cache-invalidation` already requires that a count and the list it summarises be
invalidated together and read through the same predicate. The club badge on `/clubs` and this
timeline are **not** that pair, and the difference SHALL be recorded rather than left to be read
as agreement.

Measured: `public.club_unread_counts` counts `postcards` created since the watermark whose
`author_id` is not the caller, plus `rides` created since the watermark. It counts **no threads
and no joins**, where the timeline draws all four. So a club whose only recent activity is three
new threads shows no badge and a timeline with three entries, and that is correct behaviour under
both definitions.

This change SHALL NOT alter the function — doing so is a migration, and a join is not news
addressed to a rider, while threads already carry a finer per-thread watermark the badge would
double-count. The divergence SHALL be stated at both `club_unread_counts` and the timeline's own
module so neither is read as the other's summary.

#### Scenario: The badge and the timeline are allowed to disagree, in writing
- **WHEN** three threads are started in a club and nothing else happens
- **THEN** the club's badge on `/clubs` SHALL remain absent
- **AND** the timeline SHALL show three entries
- **AND** both modules SHALL carry a comment naming the other's predicate

#### Scenario: The timeline does not spend the club watermark differently than today
- **WHEN** a member opens the club detail
- **THEN** `MarkClubSeen` SHALL advance `feed_reads.last_seen_at` exactly as it does today
- **AND** the timeline SHALL NOT read that watermark, draw a "new since" boundary, or depend on
  the order in which the mark and the reads complete
