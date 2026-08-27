# ride-journal (delta)

## ADDED Requirements

### Requirement: A ride's journal SHALL be narrower than the ride, and that SHALL be stated rather than fixed

A public ride belonging to a club is visible to every signed-in rider. Its journal is not: each
postcard carries the club as its audience, so a non-member reads zero of them.

`ride_journal_postcard_ids(ride uuid)` returns **ids and never rows**, so RLS still decides every
postcard that renders. The asymmetry SHALL be stated in the spec and SHALL NOT be closed by
widening the postcards SELECT policy, which would publish a club's journal to everyone who can see
one of its rides.

#### Scenario: A non-member sees the ride and not its journal
- **WHEN** a signed-in rider who is not a member of a public ride's club opens that ride
- **THEN** the ride and its crew SHALL be visible
- **AND** the journal SHALL contain only the postcards they are entitled to read, which for a club
  ride is none but their own

#### Scenario: The accessor does not become a read path
- **WHEN** `ride_journal_postcard_ids` is called for any ride
- **THEN** it SHALL return ids only
- **AND** every postcard rendered from those ids SHALL be fetched under the caller's own RLS

#### Scenario: No inverse accessor is added
- **WHEN** a surface needs to name the ride a postcard belongs to
- **THEN** it SHALL NOT be served by inverting `ride_journal_postcard_ids`
- **AND** any such need SHALL be treated as absent rather than awkward, `062` having removed
  `ride_id` from the SELECT grant deliberately

#### Scenario: An empty journal is not an error
- **WHEN** a journal resolves to zero visible postcards
- **THEN** the screen SHALL draw a designed empty state
- **AND** it SHALL NOT distinguish "nobody has posted" from "you may not read what was posted",
  those being identical from the client and both correctly answered by the same empty state

### Requirement: A postcard SHALL be tagged to a ride only at insert, and the tag SHALL be permanent

`authenticated` holds INSERT on `ride_id` and no UPDATE on it. A postcard therefore joins a ride's
journal at the moment it is written or never.

This SHALL be stated in the composer's own copy wherever a rider could reasonably expect to attach
one later, and SHALL NOT be worked around by deleting and reposting on the rider's behalf.

#### Scenario: No later attachment
- **WHEN** a rider posts from Home and later wishes the postcard were on a ride
- **THEN** no path in the app SHALL attach it
- **AND** `has_column_privilege('authenticated', 'public.postcards', 'ride_id', 'UPDATE')` SHALL
  be false

#### Scenario: A refused rider loses that journal permanently
- **WHEN** a rider is refused from a club ride's journal for not being a member of the club
- **THEN** they SHALL have no route to that journal for that photo, then or later
- **AND** the copy SHALL NOT suggest otherwise

#### Scenario: The tag survives what the ride does not
- **WHEN** the ride a postcard is tagged to is deleted
- **THEN** `ride_id` SHALL be set to NULL by the existing `ON DELETE SET NULL`
- **AND** the postcard's audience SHALL be unchanged, `club_id` being the audience and `ride_id`
  the tag
