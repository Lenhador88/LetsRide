# ride-lifecycle (delta)

## ADDED Requirements

### Requirement: A ride created inside a club SHALL default to club-only

`CreateRideForm` ships the public checkbox `defaultChecked`, matching `001`'s column default. When
a club is the ride's context, the default SHALL invert: the ride is for the club unless the
organizer says otherwise.

The default is a **form** rule. The organizer SHALL remain able to make a club ride public, subject
to `022` — a private club's ride can never be public, whatever the checkbox says.

#### Scenario: The club default
- **WHEN** an organizer creates a ride with a `club_id` set and does not touch the visibility
  control
- **THEN** `is_public` SHALL be false
- **AND** the ride SHALL be readable by the club's members and its organizer, and by nobody else

#### Scenario: The organizer can still open it up
- **WHEN** an organizer of a ride in a **public** club sets the ride public
- **THEN** the write SHALL succeed and every signed-in rider SHALL be able to read it

#### Scenario: A private club still refuses a public ride
- **WHEN** an organizer sets `is_public = true` on a ride whose club is private
- **THEN** the write SHALL be rejected by `enforce_ride_club_audience`
- **AND** the refusal SHALL be an explained state in the form, not a raw error

#### Scenario: A club turning private still takes its rides with it
- **WHEN** a club owner sets `is_public = false` on a club with public rides
- **THEN** those rides SHALL cease to be publicly visible
- **AND** the new clubless coupling SHALL NOT interfere, those rides carrying a `club_id`

### Requirement: A ride with no club SHALL be public, enforced by the database

There is **no invite flow** — `Invite riders` is a design frame with no schema behind it — so a
private clubless ride is reachable by its organizer alone, for ever, with no way to admit anybody.

The coupling `club_id IS NOT NULL OR is_public` SHALL be enforced in Postgres, not only in the
form. `authenticated` holds UPDATE on both `club_id` and `is_public` on `rides`, so a form default
is not an invariant and an organizer editing a ride can reach the state directly.

#### Scenario: A private clubless ride cannot be created
- **WHEN** any client inserts a ride with `club_id` NULL and `is_public` false
- **THEN** the write SHALL be rejected by the database
- **AND** the rejection SHALL reach the form as an explained state

#### Scenario: A private clubless ride cannot be created by editing
- **WHEN** an organizer removes the club from a private ride, or makes a clubless ride private
- **THEN** the write SHALL be rejected
- **AND** the form SHALL explain that a ride with no club has no audience other than everyone

#### Scenario: Pre-flight
- **WHEN** the constraint is applied
- **THEN** the count of violating rows SHALL be measured against each project immediately before
  applying, not read from a proposal
- **AND** DEV measured 15 rides, 8 with a club and 0 private clubless rides on 2026-08-27

#### Scenario: A club deletion does not silently orphan a private ride
- **WHEN** a club with private rides is deleted
- **THEN** either those rides SHALL be deleted with the club, as `delete_owned_club` and
  `transfer_owned_clubs` already do, or the deletion SHALL be refused
- **AND** a private ride SHALL NOT be left with `club_id` NULL and `is_public` false, which is the
  state this requirement exists to make unrepresentable

#### Scenario: The organizer's own reach is unchanged
- **WHEN** an organizer reads their own ride
- **THEN** it SHALL be returned regardless of `is_public`, `club_id` or club visibility, exactly as
  today

## MODIFIED Requirements

### Requirement: Ride visibility SHALL be stated per role

Restated in full against the live policy, because the standing statement predates `022` in the
form it is usually quoted. The predicate is:

```
organizer_id = auth.uid()
or ( not private.is_blocked(auth.uid(), organizer_id)
     and ( (is_public and (club_id is null or private.is_club_public(club_id)))
           or (club_id is not null and private.is_club_member(club_id)) ) )
```

The roles are unchanged by this change. What changes is that the "private clubless ride" row stops
being reachable.

#### Scenario: Organizer
- **WHEN** the organizer reads their own ride
- **THEN** it SHALL be returned regardless of `is_public`, `club_id` or club visibility

#### Scenario: Club member
- **WHEN** a member of the ride's club reads it
- **THEN** it SHALL be returned, including when the ride is not public
- **AND** a club owner holding no `club_members` row SHALL count as a member, per `054`

#### Scenario: Club admin
- **WHEN** a rider whose `club_members.role` is `admin` reads a ride in that club
- **THEN** it SHALL be returned exactly as for a member, the role conferring no extra reach and no
  write over somebody else's ride

#### Scenario: Non-member, public ride with no club
- **WHEN** any signed-in rider reads a ride with `club_id` NULL and `is_public` true
- **THEN** it SHALL be returned, decision #1 making "public" mean "any signed-in rider"

#### Scenario: Non-member, private club's ride
- **WHEN** a signed-in rider who is not a member of the ride's private club reads it
- **THEN** zero rows SHALL be returned, and its crew SHALL be unreachable through `ride_members`

#### Scenario: Non-member, public club's non-public ride
- **WHEN** a signed-in rider who is not a member of a public club reads that club's non-public
  ride — the new default for a club ride
- **THEN** zero rows SHALL be returned
- **AND** its crew, its chat and its journal SHALL be unreachable with it

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they both
  belong to
- **THEN** zero rows SHALL be returned

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides`

#### Scenario: Private clubless ride
- **WHEN** any client attempts to produce a ride with `club_id` NULL and `is_public` false
- **THEN** the write SHALL be refused
- **AND** no such row SHALL exist for a visibility rule to be stated about
