# club-owner-authority (delta)

## ADDED Requirements

### Requirement: A club's owner SHALL reach their own club exactly as a member does

The rider named by `clubs.owner_id` SHALL have, in that club and in no other, every read and
write reach that a rider holding a `club_members` row for it has. The rule SHALL hold whether or
not that membership row exists, and SHALL be expressed **once**, in the predicate every club
policy already shares, rather than restated per policy.

This capability exists because the concept was expressed ten times and got it right once:
`clubs` SELECT carried an `owner_id = auth.uid()` arm while the nine other policies resolving
club membership did not, so the club was visible and its rides, postcards and roster were not.
A rule written per policy is free to drift again; a rule written in the shared predicate cannot.

#### Scenario: The reach is defined by ownership, not by the membership row
- **WHEN** any policy decides whether a rider may act as a member of a club
- **THEN** it SHALL resolve that through the single shared predicate
- **AND** that predicate SHALL be true for a rider holding a `club_members` row for the club
  **or** named by that club's `owner_id`
- **AND** no policy SHALL add its own ownership arm at policy level

#### Scenario: An owner who holds no membership row is not locked out
- **WHEN** the owner of a private club holds no `club_members` row for it
- **THEN** they SHALL read that club's rides, postcards and roster, create a ride in it, and post
  a postcard to it
- **AND** none of those SHALL be refused with the empty result that a non-member receives

#### Scenario: Ownership of one club grants nothing in another
- **WHEN** the owner of club A reads a private club B they neither own nor belong to
- **THEN** zero rows SHALL be returned for B's rides, postcards, roster and feed

#### Scenario: A signed-out request gains nothing
- **WHEN** a request arrives with no session
- **THEN** the shared predicate SHALL be false, because it resolves through `auth.uid()`
- **AND** `anon` SHALL hold no grant on any table the predicate guards

### Requirement: An ownership arm SHALL NOT step past a block

Widening a membership test SHALL NOT widen what a blocked rider can see or be seen doing.
Decision #2 makes blocking an RLS concern, and it SHALL dominate ownership in both directions.

The structural rule that guarantees it: `private.is_blocked` SHALL remain a conjunct at the top
level of each policy's predicate, with the membership test beneath it — the shape
`NOT is_blocked(…) AND (member OR owner)`, never `(NOT is_blocked(…) AND member) OR owner`.

#### Scenario: An owner does not see a ride organized by a rider they have blocked
- **WHEN** a club's owner reads a ride in their own club whose organizer is blocked in either
  direction
- **THEN** zero rows SHALL be returned

#### Scenario: An owner does not see a blocked rider's postcards, comments or likes
- **WHEN** a club's owner reads postcards posted into their own club by a rider blocked in either
  direction, or the comments and likes on them
- **THEN** zero rows SHALL be returned for that rider's content

#### Scenario: Blocked members stay off the roster an owner can read
- **WHEN** a club's owner reads their private club's `club_members` roster
- **THEN** rows for riders blocked in either direction SHALL be absent
- **AND** the owner's own row, if it exists, SHALL always be returned

### Requirement: Reaching a club SHALL NOT confer moderation power over its content

An owner's member-equivalent reach SHALL grant no authority over rows authored by other riders.
Ownership answers "may I see and participate", never "may I edit, delete or evict".

#### Scenario: An owner cannot edit or delete another rider's ride
- **WHEN** a club's owner attempts to update or delete a ride in their club organized by someone
  else
- **THEN** the write SHALL be refused, ride writes being keyed on `organizer_id`

#### Scenario: An owner cannot edit another rider's postcard
- **WHEN** a club's owner attempts to update a postcard in their club authored by someone else
- **THEN** the write SHALL be refused, postcard updates being keyed on `author_id`

#### Scenario: An owner cannot remove another member
- **WHEN** a club's owner attempts to delete another rider's `club_members` row
- **THEN** the write SHALL be refused, membership deletion being keyed on `auth.uid() = user_id`
- **AND** no UPDATE policy SHALL exist on `club_members`, so no role may be changed by any client

#### Scenario: Seeing a ride does not confer its chat
- **WHEN** a club's owner reads a ride in their club of whose crew they are not a member
- **THEN** the ride SHALL be returned and its `ride_messages` SHALL NOT be
- **AND** chat visibility SHALL remain the intersection of ride visibility and crew membership

### Requirement: A caller-relative helper SHALL NOT be used to compute a fan-out recipient set

The shared ownership-or-membership predicate resolves through `auth.uid()` and therefore answers
a question about the *caller*, not about the club. It SHALL NOT be called from a notification
trigger, whose recipient set SHALL be computed by direct query.

The consequence SHALL be stated rather than assumed fixed: an owner holding no `club_members` row
receives no fan-out for their own club, and that gap is closed by the owner-membership row
existing, not by this predicate.

#### Scenario: The club ride fan-out reads the membership table directly
- **WHEN** a ride is created in a club
- **THEN** the recipient set SHALL be read from `club_members` by direct query
- **AND** an owner holding no membership row SHALL receive no notification, this being a known
  gap owned by the creator-membership invariant rather than by club visibility
