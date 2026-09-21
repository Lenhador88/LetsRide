## ADDED Requirements

### Requirement: A screen for a resource the reader may not read SHALL be a separate render branch, not the full screen with every section empty

Where a route can be reached by a reader whose row security refuses most of what the route draws,
the route SHALL render a **distinct branch** that issues only the reads that can succeed, rather
than the full screen with each gated section falling to its empty state.

The reason is `client-render-shell`'s own standing requirement that permission-denied and empty be
told apart: a full screen with four empty sections asserts four false facts about the resource —
that it has no rides, no postcards, no threads and, by the roster's absence, no members — each of
which the reader is in no position to know.

The branch SHALL be selected on a **decided** answer, never on a falsy one. `null` from the primary
read is decided; `undefined` is "not yet".

#### Scenario: The private club preview renders no query that can return zero rows
- **WHEN** a rider who is not a member reaches a private club's detail route
- **THEN** the screen SHALL issue exactly two reads — the ordinary club read, which decides `null`,
  and the preview accessor — and no others
- **AND** `getClubFeed`, `getClubMembers`, `getRides` and the threads read SHALL NOT be called at all

#### Scenario: The 404 still exists and is still indistinguishable
- **WHEN** the id names no club, or a private club the reader may not discover
- **THEN** **both** reads SHALL answer `null` and the route SHALL `notFound()`
- **AND** a nonexistent club and an undiscoverable one SHALL reach the same screen, per decision #1

#### Scenario: Neither read's `undefined` triggers a 404
- **WHEN** either read is still in flight
- **THEN** the route SHALL render its skeleton and SHALL NOT call `notFound()`
- **AND** the preview read SHALL be disabled entirely until the primary read has decided, so it is
  never issued for a club the reader can see

#### Scenario: The branch states why it is empty
- **WHEN** the preview branch renders
- **THEN** it SHALL carry one sentence naming the club's privacy as the reason
- **AND** it SHALL NOT render any existing empty-state string, including "This club has not
  ridden, yet!" and "This club has not written a description, yet!"

#### Scenario: Membership-gated affordances are absent, not disabled
- **WHEN** the preview branch renders
- **THEN** the create-ride row, the add-postcard tile, the thread composer, the options menu and
  every `See all` SHALL be **absent**
- **AND** the reason SHALL be this screen's own recorded rule: a control that always fails RLS is
  worse than no control

#### Scenario: `viewer_role` gains no third value
- **WHEN** the two branches are compared
- **THEN** `isMember` SHALL be computed only on the full branch, from a real `ClubDetail`
- **AND** no existing gate on it SHALL change meaning

#### Scenario: The header works on both branches
- **WHEN** the preview branch renders its header
- **THEN** the club's name SHALL be shown from the preview and the avatar SHALL fall back to
  initials
- **AND** back SHALL return to the list the rider came from, as it does on the full branch

### Requirement: A list assembled from two reads SHALL NOT present one of them as the whole answer when the other fails

Where a screen merges two independent reads into one list, a failure of either SHALL be visible.
Rendering the surviving half alone is indistinguishable, to the rider, from there being nothing
more to find.

#### Scenario: The private half fails
- **WHEN** `discoverable_private_clubs` errors and the public page succeeds
- **THEN** the screen SHALL surface the failure with a retry rather than render the public clubs as
  a complete list

#### Scenario: The public half fails
- **WHEN** the reverse happens
- **THEN** the same rule SHALL apply

#### Scenario: The strip's claim stays true
- **WHEN** `ExploreClubsStrip` draws its `near <place>` clause
- **THEN** it SHALL be derived from the same merged array `/clubs/explore` renders under the same
  key, so the row and its destination cannot disagree — the property PD-258 and PD-254 both cost a
  defect to establish

#### Scenario: An unknown request status draws no control
- **WHEN** the per-rider request-status read has not resolved, or failed
- **THEN** the private card SHALL draw **no** trailing control, rather than `Request to join`
- **AND** the reason SHALL be that offering a control which turns out to be a duplicate is a
  promise the database will refuse with `23505`
