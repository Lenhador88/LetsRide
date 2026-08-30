# database-enforced-integrity (delta)

## ADDED Requirements

### Requirement: A ride's audience SHALL NOT be expressible as "nobody"

`rides.is_public` and `rides.club_id` are independently settable and both are in `authenticated`'s
UPDATE grant list — measured on DEV 2026-08-27. The combination `club_id IS NULL AND is_public =
false` names a ride nobody but its organizer can reach.

> **⚠ THE JUSTIFICATION FOR THIS REQUIREMENT IS SPENT, AND IT IS THE OWNER'S CALL WHETHER THE
> REQUIREMENT SURVIVES IT.**
>
> This paragraph used to end *"…with no mechanism in the schema to admit anyone, because there is no
> invite flow and no membership row to write."* **There is one now.** `083` (PD-329, merged) makes a
> live `ride_invites` row a fourth audience arm of the `rides` SELECT policy and
> `private.join_ride_from_invite` the membership write, so a clubless, non-public ride is exactly
> the private ride an organizer invites four friends to — which PD-329's own body names as the
> reason its default flip is safe.
>
> **The clause is removed rather than the requirement**, because deleting another change's
> requirement is not this change's to do. Whoever applies
> `postcard-audience-follows-its-entry-point` decides between: dropping this requirement (a
> clubless private ride is now reachable and the CHECK would refuse a legitimate one), or keeping it
> for a different reason and stating that reason. **It must not be implemented on the strength of
> the sentence above**, which no longer says what it said when it was written.

The database SHALL refuse that combination, subject to the note above.

#### Scenario: Refused on INSERT
- **WHEN** any client, including a hand-rolled request under the publishable key, inserts a ride
  with `club_id` NULL and `is_public` false
- **THEN** the write SHALL be rejected by a CHECK constraint
- **AND** the rule SHALL NOT live only in a Zod schema or a form default, the client owning the
  mutation path

#### Scenario: Refused on UPDATE
- **WHEN** an organizer updates a ride so that `club_id` becomes NULL while `is_public` is false,
  or `is_public` becomes false while `club_id` is NULL
- **THEN** the write SHALL be rejected

#### Scenario: A single-table rule is a CHECK, not a trigger
- **WHEN** the rule is implemented
- **THEN** it SHALL be a CHECK constraint, both columns being on `rides`
- **AND** it SHALL bind every writer, not only `authenticated`

#### Scenario: It does not collide with `022`
- **WHEN** `enforce_ride_club_audience` refuses a public ride in a private club, or
  `propagate_club_privacy_to_rides` sets a club's rides non-public
- **THEN** neither SHALL be able to trip the new constraint, both writing rows that carry a
  `club_id`
- **AND** that SHALL be asserted rather than reasoned about, the two rules pulling in opposite
  directions

#### Scenario: The `ON DELETE SET NULL` path is settled before the constraint applies
- **WHEN** a club is deleted
- **THEN** every path that reaches `rides.club_id`'s `ON DELETE SET NULL` SHALL be enumerated and
  the outcome under the constraint stated for each — `delete_owned_club`,
  `private.transfer_owned_clubs`, and a bare `clubs` DELETE under the still-live
  `auth.uid() = owner_id` policy
- **AND** a private ride SHALL NOT be silently detached; if the deletion is refused, the refusal
  SHALL be an explained state pointing at the RPC

### Requirement: A postcard's audience SHALL be a stored column and SHALL NOT be derivable from its tag

`postcards.club_id` is the audience. `postcards.ride_id` is a tag. No policy, view, accessor or
generated column SHALL derive one from the other.

`rides.club_id` is `ON DELETE SET NULL` and is updatable by its organizer, so a chain walked at
read time would move the audience of postcards already written, retroactively and with no error.

#### Scenario: Moving a ride between clubs moves no postcard
- **WHEN** an organizer changes a ride's `club_id`
- **THEN** every postcard tagged to that ride SHALL keep the `club_id` it was written with
- **AND** no rider SHALL gain or lose read access to any existing postcard as a result

#### Scenario: Deleting a club does not republish anybody's postcards
- **WHEN** a club is deleted and its rides' `club_id` is set NULL
- **THEN** no postcard SHALL become app-wide as a result of that nulling
- **AND** the fate of postcards carrying that club as their **own** `club_id` SHALL be decided by
  the existing `ON DELETE CASCADE` on `postcards.club_id`, unchanged by this change

#### Scenario: No policy mentions `ride_id`
- **WHEN** the four policies on `postcards` are read back after this change
- **THEN** `ride_id` SHALL appear only in the INSERT policy's write gate
- **AND** it SHALL appear in no `USING` clause of any SELECT policy on any table

### Requirement: Removing a control SHALL NOT be mistaken for removing a check

The composer's club `<select>` and ride `<select>` are conveniences. The postcards INSERT policy's
`club_id is null or private.is_club_member(club_id)` conjunct and its
`ride_id is null or (exists … and private.is_ride_crew(ride_id))` conjunct are the enforcement, and
both SHALL be unmodified by this change.

No application-side audience filter SHALL be introduced, matching decision #2's rule for blocking.

#### Scenario: The INSERT policy is byte-identical afterwards
- **WHEN** the postcards INSERT policy is read back
- **THEN** its `with_check` SHALL be unchanged, including the `image_path` prefix conjunct

#### Scenario: A hand-rolled request cannot reach a club the author is not in
- **WHEN** a request under the publishable key inserts a postcard naming any club the author is not
  a member of
- **THEN** it SHALL be refused with `42501`
- **AND** the refusal SHALL come from the policy, not from a validator

#### Scenario: The crew helper is never a sole conjunct
- **WHEN** `private.is_ride_crew` is used anywhere
- **THEN** it SHALL be intersected with a visibility test evaluated under the caller's own RLS
- **AND** it SHALL NOT be used alone, being `security definer` with `search_path = ''` and
  therefore blind to blocks and to a private club the rider has left

## MODIFIED Requirements

### Requirement: A column the server owns SHALL NOT be writable by a client that can insert the row

Restated for the audience specifically. `authenticated` holds UPDATE on `postcards` over exactly
`caption`, `club_id` and `image_path` — measured on DEV 2026-08-27 and unmoved through `072`,
`073` and `074`.

**With the club field removed from the composer, `update (club_id)` is a grant with no screen
behind it**, and the `010` UPDATE `with check` permits moving a postcard to `club_id` NULL, which
**widens** its audience. `083` revokes it — settled 2026-08-27, and no longer an open
question. See `proposal.md` §The audience becomes insert-only.

#### Scenario: The audience is either insert-only or the widening is deliberate
- **WHEN** the column privileges are read back after this change
- **THEN** either `update (club_id)` SHALL have been revoked, making the audience insert-only like
  the tag and every location column, or the change SHALL record explicitly why a grant with no UI
  behind it is retained

#### Scenario: A narrowing UPDATE is still bounded by membership
- **WHEN** any UPDATE moves a postcard's `club_id`
- **THEN** the `with check` SHALL still require the author to be a member of the destination club
- **AND** `author_id` SHALL still be unwritable, per `046`

#### Scenario: No absolute re-grant reverts a shipped decision
- **WHEN** any migration in this change issues a grant list on `postcards`
- **THEN** `ride_id` SHALL be present on INSERT and absent from SELECT and UPDATE
- **AND** `taken_place_id` SHALL appear in no list, in no verb
