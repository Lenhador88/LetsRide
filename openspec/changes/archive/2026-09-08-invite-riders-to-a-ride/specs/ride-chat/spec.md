## MODIFIED Requirements

### Requirement: Chat visibility SHALL be the intersection of ride visibility and crew membership, never crew membership alone

The SELECT policy SHALL require **both** that the caller can see the ride under their own row
security **and** that they are on its crew. The crew helper alone SHALL NOT be sufficient.

`private.is_ride_crew` is `security definer`, so RLS does not apply inside it — which is the
point of the instrument and here is the hazard. `rides` SELECT carries
`NOT private.is_blocked(auth.uid(), organizer_id)` and a private-club predicate; a definer helper
asking only "do I hold a crew row" sees neither. A `ride_members` row survives every event that
takes the ride away, so "holds a crew row" and "can see the ride" are **independent**.

**`private.is_club_member` has the same shape and no such gap**, because `clubs` deliberately
carries no block predicate. Copying that shape verbatim is therefore the specific trap this
requirement exists to close.

**Since `083` the intersection is non-trivial in the OTHER direction too, and that is new.** Until
now every rider who could see a private ride was either its organizer or a member of its club, so
"can see the ride and is not on the crew" was an edge case reached by leaving. An **invitee** is
that state by design and from the first moment: the ride conjunct passes for them and the crew
conjunct does not. The requirement's two halves are therefore both load-bearing for the first time,
and the visible consequence — a rider who can open a ride and cannot open its chat — reads like an
inconsistency to anyone who did not write this.

**`private.is_ride_crew` SHALL NOT gain an invite arm.** It is what keeps an invitee out of the
chat, and it is used by two other surfaces that would open silently with it: `ride_reads`' write
predicate (`061`) and postcard ride-tagging (`041`). Its body SHALL be pinned by **equality** in the
RLS suite, mentioning `ride_invites` nowhere, and the assertion's message SHALL name those two other
surfaces, so the next session reads what the arm would cost before adding it.

`034`'s own sentence is the answer to the apparent inconsistency and SHALL be the one quoted:
*"seeing a ride is not being on it."*

#### Scenario: An invitee sees the ride and not the chat
- **WHEN** a rider holding a `pending` invite to a private ride reads `ride_messages`
- **THEN** zero rows SHALL be returned and an insert SHALL be refused
- **AND** the refusal SHALL come from the **crew** conjunct, asserted in isolation, because the ride
  conjunct now passes for them — the mirror image of the blocked-crew-member case below

#### Scenario: The crew helper is pinned against an invite arm
- **WHEN** the RLS suite reads `private.is_ride_crew`'s `prosrc`
- **THEN** it SHALL equal its current body exactly, matched by equality and never by `like`
- **AND** the failure message SHALL name `ride_reads` and postcard ride-tagging as the surfaces an
  invite arm would also open

#### Scenario: A crew member who blocks the organizer loses the chat
- **WHEN** a crew member blocks the ride's organizer, in either direction, and their
  `ride_members` row is untouched
- **THEN** zero `ride_messages` rows SHALL be returned to them
- **AND** an insert SHALL be refused
- **AND** the refusal SHALL come from the ride-visibility conjunct, which SHALL be asserted in
  isolation, because the crew conjunct alone would admit them

#### Scenario: A crew member who leaves a private club loses the chat
- **WHEN** a rider holding a `ride_members` row for a private club's ride leaves that club
- **THEN** zero `ride_messages` rows SHALL be returned to them, because `022` forces a private
  club's ride to `is_public = false` and `rides` SELECT then admits club members only
- **AND** this SHALL be asserted separately from the blocking case, because a single assertion
  cannot say which conjunct did the work and a later edit could remove one while the suite stays
  green
- **AND** it SHALL be asserted that an invite to that rider would restore the **ride** and not the
  chat, because the two conjuncts answer independently

#### Scenario: A club turning private takes its rides' chats with it
- **WHEN** a public club is set private and its rides therefore cease to be public
- **THEN** crew members who are not members of that club SHALL stop reading the chat
- **AND** their existing messages SHALL remain readable to the club's own members, per the
  leaving rule below

#### Scenario: The ride-visibility conjunct is not simplified away
- **WHEN** the SELECT policy is reviewed, refactored or replaced
- **THEN** the `EXISTS` against `rides` SHALL remain, and SHALL carry a policy comment saying why
- **AND** removing it SHALL fail at least two assertions rather than passing quietly
