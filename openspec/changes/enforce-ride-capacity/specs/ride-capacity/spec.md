## Purpose

What `rides.max_riders` means once the database keeps it: which writes take a seat and which do
not, who is refused and who is never refused, what a refused rider sees, and what "full" is
allowed to disclose. The column has existed since `001` as a number nothing checked; this
capability is the contract that makes it a rule.

## ADDED Requirements

### Requirement: Ride capacity SHALL be enforced by the database and SHALL NOT be enforced by the client

The refusal SHALL come from a constraint, trigger or policy that runs inside the writing rider's
own transaction. No screen, action or schema in `src/` SHALL be the only thing standing between a
rider and a seat, and a client-side check SHALL NOT be added as the primary gate even as an
optimisation.

The publishable key ships in the bundle and PostgREST accepts any rider's JWT, so a rule the
client owns is a rule a rider can decline. `CLAUDE.md`: *"No new integrity rule may live only in a
Zod schema."*

#### Scenario: A hand-rolled request is refused exactly as the app is
- **WHEN** a signed-in rider POSTs a `ride_members` row to PostgREST directly, bypassing the app
  entirely, for a ride whose crew already fills its cap
- **THEN** the write SHALL be refused
- **AND** the refusal SHALL be identical to the one the app's own RSVP receives

#### Scenario: Two riders taking the last seat at the same instant
- **WHEN** two riders' joins for the last seat of a capped ride are in flight concurrently
- **THEN** exactly one SHALL land and the other SHALL be refused
- **AND** the outcome SHALL NOT depend on the two transactions having read the crew at different
  times

#### Scenario: The rule is not a client-side count
- **WHEN** any screen or action is reviewed for this rule
- **THEN** no count of `ride_members` compared against `max_riders` SHALL decide whether a write
  is attempted, because such a count is read before the write and is stale by the time it lands

### Requirement: The cap SHALL count every crew row of the ride, of either status

The number compared against `max_riders` SHALL be the count of `ride_members` rows for that ride,
with `status` in `going` and `maybe` counted alike, and with no row excluded for being invisible
to anybody.

*"On this ride"* already means *"holds a `ride_members` row of either status"* in
`private.is_ride_crew` (`034`), the ride-chat audience, `036`/`060`'s fan-out and `isRideCrew`.
Capacity SHALL NOT introduce a second definition.

#### Scenario: A `maybe` occupies a seat
- **WHEN** a ride capped at 2 holds one `going` row and one `maybe` row
- **THEN** a third rider's join SHALL be refused

#### Scenario: Switching Going → Maybe surrenders nothing
- **WHEN** a crew member of a full ride changes their status from `going` to `maybe`
- **THEN** the seat SHALL remain theirs
- **AND** no other rider SHALL become able to join as a result

#### Scenario: A blocked rider still occupies their seat
- **WHEN** rider A has blocked rider B, both hold crew rows on the same capped ride, and a third
  rider joins
- **THEN** B's row SHALL be counted, so the cap is reached at the same crew size for every rider
- **AND** the count SHALL NOT differ according to who is writing

#### Scenario: The organizer's own row occupies a seat
- **WHEN** a ride is capped at N and its organizer holds a crew row
- **THEN** that row SHALL count toward N, so the ride admits N − 1 further riders

#### Scenario: A NULL cap admits any number
- **WHEN** `max_riders` is NULL
- **THEN** no join SHALL ever be refused for capacity, at any crew size

### Requirement: Capacity SHALL be a join gate, and an over-subscribed ride SHALL be a legal state

The enforced rule SHALL be *"a new seat may not be taken on a ride whose crew already fills its
cap"*. It SHALL NOT be *"crew size ≤ `max_riders` at all times"*. Nothing — no CHECK, no
assertion, no repair job — SHALL assert the second, and a crew larger than the cap SHALL NOT be
treated as corruption.

#### Scenario: Lowering the cap below the crew evicts nobody
- **WHEN** an organizer edits a ride from `max_riders = 20` to `max_riders = 5` while 20 riders
  hold crew rows
- **THEN** the edit SHALL be accepted
- **AND** all 20 rows SHALL stand
- **AND** every one of those riders SHALL keep their seat, their chat access and their place on
  the roster

#### Scenario: An over-subscribed ride refuses new joins
- **WHEN** a rider with no crew row joins a ride holding 20 rows against a cap of 5
- **THEN** the join SHALL be refused

#### Scenario: An over-subscribed ride reopens only when the crew drops below the cap
- **WHEN** riders leave that ride until 4 crew rows remain against a cap of 5
- **THEN** the next rider's join SHALL be admitted

#### Scenario: No invariant is asserted over the row set
- **WHEN** the RLS suite or any migration is reviewed
- **THEN** no assertion of the form `count(ride_members) <= max_riders` SHALL exist, because it
  would fail on a legal state

### Requirement: Only a write that takes a NEW seat SHALL be gated

A write SHALL be gated when, and only when, it results in a `(ride_id, user_id)` pair that did not
exist before it. Every other write to `ride_members` SHALL pass the capacity gate untouched,
including on a ride that is full or over-subscribed.

This is not a refinement of the count — it is the difference between the rule working and a full
ride freezing every crew member's RSVP. `setRideAttendance` writes through an upsert whose
`ON CONFLICT DO UPDATE` SET list carries `ride_id`, `user_id` and `status` (which is why `048`
had to grant UPDATE on all three), so **every repeat RSVP arrives as an INSERT that resolves to an
UPDATE**.

#### Scenario: An existing crew member's RSVP change is never refused for capacity
- **WHEN** a rider who already holds a crew row on a full ride changes `going` → `maybe`, or
  `maybe` → `going`, or re-sends the status they already hold
- **THEN** the write SHALL be admitted

#### Scenario: The same holds on an over-subscribed ride
- **WHEN** the cap has been lowered below the current crew size and an existing crew member
  changes their status
- **THEN** the write SHALL be admitted
- **AND** a rule that merely excludes the writer's own row from the count SHALL NOT be considered
  to satisfy this requirement, because it refuses this case

#### Scenario: Moving a seat between rides is a new seat
- **WHEN** a rider holding a crew row on ride A updates that row's `ride_id` to ride B, which is
  full
- **THEN** the write SHALL be refused
- **AND** their row on ride A SHALL be unchanged

#### Scenario: A seat move into a ride with room is admitted and counted
- **WHEN** the same rider moves their row to a ride with room
- **THEN** the write SHALL be admitted
- **AND** the destination ride's crew SHALL count them from that moment

#### Scenario: Leaving is never gated
- **WHEN** a rider clears their RSVP on a full or over-subscribed ride
- **THEN** the row SHALL be deleted with no capacity check of any kind

### Requirement: The crew count SHALL be taken through a privileged path, never under the writing rider's row security

The count SHALL be evaluated where the `ride_members` SELECT policy does not apply. A count taken
under the writing rider's own row security SHALL NOT be considered to satisfy any requirement in
this capability.

`009` put `private.is_blocked` on the `ride_members` SELECT policy itself, so every crew member
the writer has blocked — or who has blocked them — is invisible to them. An unprivileged count is
therefore short by exactly the number of blocks, and the cap is exceeded by that many riders,
silently. Measured on the applied chain 2026-08-18, one block in place, same ride: **4 rows as the
table owner, 3 as the joining rider.**

#### Scenario: A blocked pair does not buy a seat
- **WHEN** a ride is capped at N, holds N crew rows, and a rider who has blocked one of them —
  or is blocked by one of them — attempts to join
- **THEN** the join SHALL be refused
- **AND** the refusal SHALL be attributable to the privileged count, asserted with the block in
  place under the joining rider's own role

#### Scenario: The privileged path stays a count and never a read
- **WHEN** the mechanism is reviewed
- **THEN** it SHALL return a decision or a number, never rows, so that no crew member's identity
  reaches a caller through it

### Requirement: A ride's organizer SHALL always be able to hold their own crew row

A `ride_members` row whose `user_id` is the ride's `organizer_id` SHALL be admitted whatever the
crew count and whatever the cap. This SHALL be an explicit rule, not a consequence of the
organizer's row happening to be written first.

A ride is created as two statements with no transaction — the ride, then the organizer's crew row
— and a ride whose organizer is not on its own crew renders an RSVP prompt to the person who
created it. The rule SHALL survive that ordering changing: `enforce-creator-membership` proposes
making creation one privileged statement, and the organizer's row must land under that shape too.

#### Scenario: Creating a ride capped at one
- **WHEN** a rider creates a ride with `max_riders = 1`
- **THEN** their own crew row SHALL be admitted
- **AND** the ride SHALL then be full for everybody else

#### Scenario: An organizer whose crew row is missing can restore it
- **WHEN** a ride's organizer holds no crew row — a failed rollback, a row deleted by hand — and
  the ride is already at or over its cap
- **THEN** the organizer's own row SHALL still be admitted
- **AND** the ride SHALL be permitted to hold one row more than its cap as a result, which
  decision 2 already makes legal

#### Scenario: The exemption is for the organizer's own row only
- **WHEN** a ride's organizer attempts to write a crew row for a different rider on a full ride
- **THEN** it SHALL be refused, by this gate or by the row-security policy that already refuses
  every row a rider writes for somebody else

#### Scenario: The displayed answer and the counted seat may disagree, and the count wins
- **WHEN** an organizer holding no crew row views their own ride
- **THEN** the screen MAY show them as `going` — it already does — while the cap counts no seat
  for them
- **AND** the cap SHALL be computed from rows, never from what a screen displays

### Requirement: A refused rider SHALL be told the ride is full, and SHALL be able to tell that from every other refusal

The refusal SHALL carry a machine-distinguishable identity that the client matches on, and the
rider SHALL see a message naming capacity rather than the generic "may no longer be available".

SQLSTATE alone SHALL NOT be the identity: `018`'s text bounds and `023`'s participation gate raise
`23514` on the same statement. The client SHALL match on SQLSTATE **and** message text, which is
the pattern `createRide` already uses for `022`. `42501` SHALL NOT be used, for `023`'s reason —
it is indistinguishable from an ordinary row-security denial, so an assertion accepting it passes
when the wrong rule fired.

#### Scenario: The rider sees a capacity message
- **WHEN** a rider's RSVP is refused for capacity
- **THEN** the RSVP surface SHALL show a message stating that the ride is full
- **AND** the rider's own control SHALL return to the answer the database last held for them,
  never to the answer they just attempted

#### Scenario: Every other refusal keeps the generic message
- **WHEN** an RSVP fails for any other reason — the ride is gone, row security refused it, the
  network failed, onboarding is incomplete
- **THEN** the rider SHALL NOT be told the ride is full

#### Scenario: An un-onboarded rider is told about onboarding, not about capacity
- **WHEN** a rider who has not accepted the terms attempts to join a full ride
- **THEN** the participation gate's refusal SHALL be the one that fires
- **AND** the capacity refusal SHALL NOT mask it

#### Scenario: The contract is asserted, not assumed
- **WHEN** the RLS suite asserts a capacity refusal
- **THEN** it SHALL assert the SQLSTATE and the message, so that a later migration changing either
  fails the suite rather than silently breaking the client's branch

### Requirement: A capacity refusal SHALL disclose no more than one bit, and that bit SHALL be stated

The refusal SHALL disclose only that the named ride is full. It SHALL NOT disclose the crew size,
the cap, any crew member's identity, or whether the rider was close to getting in.

**A BEFORE trigger runs ahead of the row-security `WITH CHECK`** — measured on Postgres 16 — so a
rider who cannot see a ride at all learns "full" rather than being refused by row security, for a
ride whose id they must already know. That is one bit about a ride they could once see, and it is
**accepted rather than overlooked**. It SHALL be recorded here so that a later reader does not
discover it as a bug, and the two ways to close it are in `design.md` §D6.

#### Scenario: A rider who cannot see the ride learns only that it is full
- **WHEN** a rider who has left the private club owning a ride, or who is blocked by its
  organizer, attempts to join it using an id they already have
- **THEN** they SHALL learn only whether it is full
- **AND** no row SHALL be written, because row security still refuses the insert

#### Scenario: No count is returned to a refused rider
- **WHEN** any refusal is rendered
- **THEN** it SHALL NOT contain a number of riders, a number of seats, or the cap itself

### Requirement: Every role's reach into a ride's capacity SHALL be stated

Each role's reach into a ride's capacity SHALL be stated here, as a statement about a role and a
resource, so that each maps onto an assertion in `supabase/tests/`.

#### Scenario: The organizer
- **WHEN** the ride's organizer acts
- **THEN** they SHALL be able to set and change `max_riders` at any time, to any value `018`
  permits, including below the current crew size
- **AND** their own crew row SHALL never be refused for capacity
- **AND** they SHALL NOT be able to evict a rider by lowering the cap, because nothing is evicted

#### Scenario: A crew member
- **WHEN** a rider already holding a crew row acts on a full ride
- **THEN** they SHALL be able to change status freely and to leave
- **AND** they SHALL NOT be able to change `max_riders`, because only the organizer can update
  the ride

#### Scenario: A club member who is not on the ride
- **WHEN** a member of the ride's club attempts to join a full ride
- **THEN** they SHALL be refused for capacity, with no club-derived exception of any kind

#### Scenario: A non-member
- **WHEN** a signed-in rider who is not in the ride's club attempts to join
- **THEN** a private club's ride SHALL refuse them by row security before capacity is reachable
- **AND** a public ride SHALL refuse them for capacity if it is full, on the same terms as
  everybody else

#### Scenario: A blocked rider
- **WHEN** a rider blocked by the organizer attempts to join
- **THEN** row security SHALL refuse them, because `rides` carries the block predicate and the
  `ride_members` INSERT policy delegates to it
- **AND** their existing crew row on a ride organised by somebody else SHALL keep counting toward
  that ride's cap, because a block hides a rider and does not free a seat

#### Scenario: A signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** it SHALL be refused before capacity is reached, because `anon` holds no grant on
  `ride_members` — decision #1
- **AND** no capacity rule SHALL be written that admits an anonymous role

#### Scenario: An unblock frees nothing and takes nothing
- **WHEN** two riders on the same ride unblock each other
- **THEN** the crew count SHALL be unchanged, because it never varied by viewer

### Requirement: The RSVP surface SHALL define every state it can be in

The surface is the ride plan's RSVP bar, which already exists. This change adds one outcome to it
and SHALL NOT add a control, a badge or a count.

#### Scenario: Empty
- **WHEN** a ride has no crew rows at all
- **THEN** the RSVP bar SHALL render exactly as it does today, with no capacity treatment, because
  an empty crew is the furthest thing from full

#### Scenario: Loading
- **WHEN** the ride or its crew has not yet resolved
- **THEN** the screen SHALL gate on the data rather than on a loading flag, as `CLAUDE.md`
  requires, and SHALL NOT render a speculative capacity state

#### Scenario: Error
- **WHEN** the RSVP write fails for capacity
- **THEN** the message SHALL appear in the existing live region, the control SHALL roll back, and
  the rider SHALL be able to retry with no reload

#### Scenario: Offline
- **WHEN** the rider has no connection and taps an answer
- **THEN** they SHALL see the generic failure, never the capacity message
- **AND** the RSVP SHALL NOT be queued for later, because a seat granted on reconnection would be
  a seat granted against a cap nobody checked at the time

#### Scenario: Permission denied versus empty
- **WHEN** row security refuses the write and the client receives zero rows or an authorization
  error
- **THEN** it SHALL be reported as the ride being unavailable, and SHALL NOT be reported as the
  ride being full

#### Scenario: Partial
- **WHEN** the ride resolves and its crew does not
- **THEN** the RSVP bar SHALL still be usable, because the answer comes from the database and
  never from the roster the screen holds

#### Scenario: Stale
- **WHEN** a rider's join is refused for capacity
- **THEN** the client SHALL invalidate the ride's cached data, because the refusal is proof that
  the crew changed elsewhere
- **AND** the rider SHALL NOT be shown a crew that contradicts the refusal after the next read

### Requirement: Capacity SHALL NOT be rendered, and any future affordance SHALL NOT be computed from a per-viewer roster

No screen SHALL show a seats-remaining count, a "Ride is full" state, or an RSVP control disabled
for capacity, because the design draws none of them. Verified against the committed snapshot:
`Ride - Ride plan (Details)` and `Ride - Crew (Riders)` contain `Going (7)`, `May be going (3)`
and no capacity string, with hidden layers included.

When such an affordance is designed, its number SHALL come from a privileged count. It SHALL NOT
be derived from the crew the client already holds: that roster is filtered by row security, so it
is short by the viewer's blocks and would tell one rider a ride has room while the database
refuses them.

#### Scenario: A rider learns the ride is full by trying
- **WHEN** a rider opens a full ride
- **THEN** the RSVP bar SHALL offer all three answers exactly as on any other ride
- **AND** the rider SHALL learn it is full only from the refusal

#### Scenario: A per-viewer count is not the cap
- **WHEN** any future screen wants to show remaining seats
- **THEN** it SHALL NOT compute them from the embedded roster
- **AND** the discrepancy SHALL be understood as blocks, not as a caching bug

### Requirement: A seat SHALL be freed only by the removal of its row

Nothing else SHALL free a seat: not a status change, not a block, not the ride's club changing,
not the rider's account being disabled short of deletion.

#### Scenario: Leaving frees the seat immediately
- **WHEN** a crew member of a full ride answers `No`, deleting their row
- **THEN** the next rider to attempt a join SHALL be admitted, with no further action by anyone

#### Scenario: Account deletion frees the seat
- **WHEN** a rider deletes their account
- **THEN** their crew rows SHALL be removed by the existing cascade and every ride they were on
  SHALL have one more seat

#### Scenario: Deleting the ride takes the whole question with it
- **WHEN** a ride is deleted
- **THEN** its crew rows SHALL cascade and no capacity state SHALL survive it

#### Scenario: A block does not free a seat
- **WHEN** a rider blocks a crew member of a ride they want to join
- **THEN** the crew count SHALL be unchanged and they SHALL still be refused

### Requirement: The capacity gate SHALL compose with the participation gate and SHALL NOT disturb it

`023`'s `enforce_participation_gate` is already a `BEFORE INSERT` trigger on `ride_members`. Both
SHALL fire, the participation gate SHALL be reached first, and this change SHALL neither drop,
replace nor re-create it.

#### Scenario: Both triggers exist after the migration
- **WHEN** the trigger set on `ride_members` is read after applying
- **THEN** `enforce_participation_gate` SHALL still be present with its original definition
- **AND** `notify_ride_joined` SHALL still be present and still fire only on INSERT

#### Scenario: Consent is answered before capacity
- **WHEN** a rider who has not accepted the terms attempts to join a full ride
- **THEN** the participation gate's refusal SHALL be the one returned

#### Scenario: A refused join notifies nobody
- **WHEN** a join is refused for capacity
- **THEN** no `ride_joined` notification SHALL be written, because the transaction that would have
  written it did not commit

### Requirement: This change SHALL create no record of a refused rider, and SHALL add no retention obligation

A refusal SHALL leave nothing behind: no waitlist row, no attempt log, no counter, no
notification. The organizer SHALL NOT learn that a particular rider tried to join and failed.

`max_riders` is not personal data and the crew rows this counts already have their retention set
by the ride and the rider, so this change adds no window to state.

#### Scenario: A refused join is not stored
- **WHEN** a join is refused for capacity
- **THEN** no row SHALL exist anywhere naming that rider and that ride

#### Scenario: The organizer is not told
- **WHEN** riders are refused for capacity, at any volume
- **THEN** the organizer SHALL receive no notification and see no count of them

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Each of the following is absent by decision, and SHALL NOT be part-implemented in passing.

#### Scenario: No waitlist
- **WHEN** a rider is refused for capacity
- **THEN** no queue, reservation or "notify me" affordance SHALL exist, because none is designed
  and none has a table

#### Scenario: No capacity on clubs
- **WHEN** this rule is generalised
- **THEN** it SHALL NOT be applied to `club_members`, which has no capacity column and no design
  that draws one

#### Scenario: A seat cannot be moved onto a ride the rider cannot see
- **WHEN** a rider issues `update ride_members set ride_id = <a ride they cannot see>`
- **THEN** the write SHALL be refused by row security with `42501`, not by the capacity gate
- **AND** that refusal SHALL come from the `ride_members` SELECT policy applied to the new row,
  not from the UPDATE policy's `with check`, which carries no `EXISTS` against `rides`
- **AND** the asymmetry SHALL NOT be "fixed" by restating the conjunct on the UPDATE policy,
  which would be a second copy of an enforced rule
- **AND** the refusal SHALL be asserted at `42501` specifically, so that relaxing the roster
  SELECT policy — as `002` once had it, `using (true)` — cannot open the gap silently
