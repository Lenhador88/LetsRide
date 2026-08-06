# atomic-resource-creation (delta)

## ADDED Requirements

### Requirement: A create SHALL be one statement, or it SHALL NOT have happened

Every action in `src/lib/actions/` that creates a resource SHALL issue exactly one write statement.
Where a resource needs more than one row, the additional rows SHALL be produced by the database in
the same statement, and the action SHALL NOT issue a second write to complete the resource.

The client owns the mutation path and cannot be trusted to finish a sequence: a rider closes a tab,
loses signal in a tunnel, or has the app killed by the OS between two round trips. Anything that
depends on the second request being made is a rule the rider can decline.

#### Scenario: Club and ride creation issue one write each
- **WHEN** `createClub` or `createRide` runs to completion
- **THEN** exactly one insert SHALL be issued
- **AND** the resource SHALL be complete when that insert returns

#### Scenario: An interrupted create leaves nothing
- **WHEN** the rider's browser is closed, backgrounded or disconnected at any point during a create
- **THEN** the database SHALL hold either a complete resource or none, and never a partial one

#### Scenario: No compensating delete in application code
- **WHEN** a create fails
- **THEN** the action SHALL NOT delete anything to clean up after itself
- **AND** any future create requiring more than one row SHALL push the additional rows into the
  database rather than reintroducing a hand-rolled rollback

### Requirement: A create SHALL NOT report an outcome the database contradicts

The message a rider is shown after a create SHALL match what the database holds. No error message
SHALL be reachable that asks the rider to go and inspect the state themselves.

`createClub` and `createRide` can currently return *"That club was only partly created. Check your
clubs before trying again."* — a message that exists because the compensating delete can itself
fail, and one that sends the rider to a screen (`Your clubs`) which reads membership and therefore
cannot show them the club it is telling them about.

#### Scenario: The partial-create message becomes unreachable and is removed
- **WHEN** the one-statement create ships
- **THEN** no code path SHALL be able to produce a "partly created" message
- **AND** the string SHALL be deleted rather than left as unreachable copy

#### Scenario: A refused create says why when the rider can act on it
- **WHEN** a create is refused for a reason the rider can fix — a validation bound, or a public
  ride in a private club
- **THEN** the message SHALL name the fix, as the `23514` audience case already does

#### Scenario: A refused create does not accuse the rider when it cannot
- **WHEN** a create is refused by a rule the rider cannot see — a policy denial, the participation
  gate, a network failure
- **THEN** the message SHALL describe the outcome rather than the cause, and SHALL offer a retry

### Requirement: A create SHALL define its offline, retry and duplicate-submit behaviour

Every create action SHALL state what happens when the rider is offline, when they retry after a
failure, and when the same submission is issued twice.

Riders lose signal constantly and this is the mutation with the largest cost when it goes wrong: a
duplicate club or ride is visible to other riders and there is no delete screen anywhere in the app
to remove one.

#### Scenario: Offline refuses rather than queues
- **WHEN** a rider submits a create with no connectivity
- **THEN** the action SHALL fail with a message saying the create did not happen, and SHALL NOT
  queue the write for later
- **AND** the form SHALL retain what the rider typed, so a retry costs nothing

#### Scenario: Retry after a failure creates one resource, not two
- **WHEN** a rider retries a create whose first attempt returned an error
- **THEN** at most one resource SHALL exist afterwards
- **AND** where the first attempt's outcome is genuinely unknown to the client — a timeout — the
  rider SHALL be told the outcome is unknown rather than shown a bare failure that invites a
  duplicate

#### Scenario: A double submit does not create two
- **WHEN** the submit control is activated twice before the first response arrives
- **THEN** one resource SHALL be created
- **AND** the pending state SHALL come from `useActionState` rather than a hand-rolled flag

#### Scenario: Success is distinguishable from never having submitted
- **WHEN** a create succeeds
- **THEN** the rider SHALL be navigated to the created resource, unchanged from today
- **AND** the navigation SHALL happen only after the single statement returns, so the destination
  is never a resource that does not exist

### Requirement: A creator SHALL NOT be shown a join affordance for a resource they created

No screen SHALL offer a rider the option to join, RSVP to, or become a member of a resource they
own or organise, and the reason SHALL be that the state cannot arise rather than that the control
is hidden.

Today `getExploreClubs` excludes by membership, so a public club whose owner has no membership row
appears in Explore **to its own owner** with a `Join club` button. Tapping it records them as
`role = 'member'` on the club they own, irreversibly — `club_members` has no UPDATE policy.
`ClubMembershipButton` and `RideAttendanceBar` do hide their controls from the owner and the
organizer, but they hide them on `viewer_role` and `is_organizer`, which are read from the very
rows that are missing.

#### Scenario: An owner never sees their own club on Explore
- **WHEN** a rider who owns a club loads `/clubs/explore`
- **THEN** that club SHALL NOT appear, because the owner-membership row always exists and Explore
  excludes by membership
- **AND** the exclusion SHALL continue to be computed against the page rather than against a capped
  membership list, unchanged from today

#### Scenario: The hidden control is not the enforcement
- **WHEN** the join or RSVP action is invoked directly, bypassing the hidden control
- **THEN** the database SHALL refuse the resulting state change
- **AND** no screen SHALL be relied on as the guard, per the standing rule that the route guard and
  the UI are affordances rather than access control

#### Scenario: An admin, member, non-member or blocked rider is unaffected
- **WHEN** any rider other than the owner or organizer loads the same screens
- **THEN** the join and RSVP affordances SHALL behave exactly as they do today, including that a
  blocked rider still sees the club itself
