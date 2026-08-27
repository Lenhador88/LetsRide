## ADDED Requirements

### Requirement: A mutation that crosses domains SHALL name every key it moves, in every domain

Where one write changes what more than one domain's screens show, the action SHALL invalidate every
affected key explicitly and SHALL NOT rely on a domain-wide prefix to reach the others.

Accepting an invite is the worked case: one RPC changes the invite list, the notification list, the
notification unread count, the ride, and the ride's crew. Four of those five are what the rider is
about to look at, and the fifth — the crew — is the one whose staleness is most visible, because the
rider lands on a ride they have just joined with themselves absent from it.

The key that is easiest to miss SHALL be named in the action's own comment: the **ride** key, which
is neither the key the mutation is "about" nor one under a notifications prefix, and which the
screen the rider is navigated to reads immediately.

#### Scenario: Accepting from the notification list moves all five keys
- **WHEN** `acceptRideInvite` succeeds
- **THEN** the invite list key, the notification list key, the notification unread key, the ride key
  and the ride crew key SHALL all be invalidated
- **AND** each SHALL be named through `keys.ts`, never written inline

#### Scenario: Declining moves three and not five
- **WHEN** `declineRideInvite` succeeds
- **THEN** the invite list, the notification list and its unread count SHALL be invalidated
- **AND** the ride and its crew SHALL NOT be, because nothing about either changed — and the ride
  SHALL become unreadable on the next fetch, which is a server-side outcome the cache SHALL NOT
  pre-empt by deleting the entry

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
