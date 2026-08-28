## ADDED Requirements

### Requirement: A mutation that crosses domains SHALL reach every key it moves, in every domain

Where one write changes what more than one domain's screens show, the action SHALL invalidate every
affected key — **through the narrowest claim that provably reaches all of them**, which is a
domain-wide prefix wherever a write is already in that domain's blast radius.

**This requirement was written as "name every key explicitly and SHALL NOT rely on a domain-wide
prefix", and the `reviewer` pass on the built code is what corrected it** — a rare case of the
implementation being right and the specification wrong, so it is recorded rather than quietly
reversed. Enumerating is only safer where the enumeration is complete, and here it was not:
accepting an invite writes a `ride_members` row, which is byte for byte the state change
`setRideAttendance` makes, and that action has always invalidated the whole `['rides']` prefix
because a joined ride is *"always in the blast radius"*. Naming `rides.detail(id)` and the crew key
instead left `rides.list(filter)` and `rides.explore(...)` untouched, so a rider who accepted from
the notification panel and returned to the Rides tab inside the stale window found the ride they had
just joined missing from `Your rides` and a public one still sitting in Explore.

The rule that survives, and it is the load-bearing half: **a claim SHALL be justified against
`keys.ts`'s stated prefix reach and never against intuition.** A domain-wide prefix is correct when
the write is in that domain; it is wrong when it merely looks adjacent — `invites.pending()` is not
under `['rides']` and must still be named.

#### Scenario: Accepting from the notification list reaches every affected key
- **WHEN** `acceptRideInvite` succeeds
- **THEN** the invite list key and the notifications keys SHALL be invalidated by name, being in
  neither the rides domain nor reachable from it
- **AND** the rides domain SHALL be claimed by its prefix, which reaches the ride, its crew, its
  invite list, the tab's own lists and Explore — the last two being what an enumeration missed
- **AND** every claim SHALL be named through `keys.ts`, never written inline

#### Scenario: Declining claims the ride, and no list
- **WHEN** `declineRideInvite` succeeds
- **THEN** the invite list, the notification list and its unread count SHALL be invalidated
- **AND** the **ride** key SHALL be invalidated, because a declined invite grants nothing and the
  cached ride the rider opened from the notification is an entry they can still read
- **AND** no rides **list** key is owed, because a pending invitee holds no `ride_members` row, so
  the ride was never in `Your rides` nor out of Explore

#### Scenario: Revoking moves the invitee's keys through the database, not the cache
- **WHEN** the organizer revokes an invite
- **THEN** the organizer's own invite list SHALL be invalidated
- **AND** the invitee's stale copy SHALL be corrected by the read policy on their next fetch, not by
  any client-side eviction, consistent with the standing requirement that a cached row whose subject
  the reader may no longer see is evicted by the database

### Requirement: An optimistic answer to an invite SHALL NOT be shown before the write lands

Accept and Decline SHALL NOT be rendered optimistically. The invite's status, the crew row and the
ride's readability are all decided by the database — an accept can be refused by a block, by the
participation gate, or by the ride having been deleted — so a locally-flipped status is a claim the
client is not entitled to make.

#### Scenario: The control shows pending until the server answers
- **WHEN** the rider presses Accept
- **THEN** the control SHALL show a pending state and SHALL NOT render the accepted outcome
- **AND** on failure the row SHALL return to its previous state with the invite re-read

#### Scenario: Offline, the controls do not queue
- **WHEN** the rider is offline
- **THEN** Accept and Decline SHALL be disabled with a reason and SHALL NOT be queued for replay,
  because a queued accept that is refused on reconnect leaves a rider believing they are on a ride
