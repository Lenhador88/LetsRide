## Purpose

The rider-facing flow: who may start it, what they are told before it becomes irreversible, and
what every screen does when it does not go cleanly. The design draws three frames and marks the
epic **Done**; what follows is everything those frames cannot express.

## ADDED Requirements

### Requirement: Only the rider themselves SHALL be able to delete an account

Account deletion SHALL be initiated by the account's own holder, from an authenticated session,
and by no other party through any route.

There is no admin, moderator or support role in this system — `011_postcard_interactions.sql`
records that as a KNOWN GAP rather than a feature, which is why `postcard_reports` is write-only
in practice. This requirement is what stops the deletion path from being the place one gets
invented by accident.

#### Scenario: A rider deletes their own account
- **WHEN** a signed-in, onboarded rider completes the confirmation flow
- **THEN** their account SHALL be deleted
- **AND** the flow SHALL require no contact with support, no email, and no step outside the app,
  because App Store guideline 5.1.1(v) is about the absence of those steps

#### Scenario: No rider can delete another rider's account
- **WHEN** any signed-in rider attempts to delete an account that is not their own, by any route
  including a hand-rolled request to the deletion endpoint
- **THEN** the request SHALL be refused
- **AND** the refusal SHALL NOT depend on a comparison between a supplied id and the caller,
  because the deletion path SHALL accept no id at all

#### Scenario: A club owner cannot delete a member
- **WHEN** the owner or an admin of a club attempts to delete the account of one of its members
- **THEN** no such capability SHALL exist, in the UI or in the API
- **AND** removing a member from a club SHALL remain a `club_members` DELETE, which today only
  the member themselves can perform

#### Scenario: A signed-out visitor cannot delete anything
- **WHEN** a request reaches the deletion endpoint with no session, an expired session or an
  `anon` token
- **THEN** it SHALL be refused before any work is done
- **AND** no `anon` grant SHALL be added anywhere to support this feature, per decision #1

#### Scenario: A blocked rider cannot reach another rider's deletion
- **WHEN** rider A has blocked rider B, and B attempts any deletion action naming A
- **THEN** the attempt SHALL be refused on the same grounds as any other rider's — the deletion
  path knows only its caller
- **AND** blocking SHALL neither enable nor disable a deletion in either direction

### Requirement: The deletion SHALL be reachable in the app and from a web page requiring no install

Google Play's User Data policy requires both an in-app path and a route a person can reach on the
web without installing the app. Apple requires the in-app path.

The in-app path is the `Account options` sheet on `/profile`, whose last row the design draws as
`Delete account` in `Warning/100` with `Element / Icon / Trash` (`2303:8097`). The web route
SHALL be a page under the existing public `/legal/*` prefix.

#### Scenario: The sheet offers the row the design draws
- **WHEN** a signed-in rider opens the account options sheet on `/profile`
- **THEN** `Delete account` SHALL be present, in `Warning/100`, as the last row and in its own
  list group, matching the frame
- **AND** the sheet SHALL NOT ship a dead row: the entry SHALL either work or not be drawn

#### Scenario: The web route adds no anonymous data access
- **WHEN** anyone loads the public deletion page with no session
- **THEN** it SHALL render explanatory copy and a link into the app's authenticated flow
- **AND** it SHALL read no table, hold no personal data and require no `anon` grant, so
  decision #1 is unaffected
- **AND** it SHALL NOT accept a deletion request from an unauthenticated form, because a page
  that deletes an account on an emailed identifier is an account-deletion service for strangers

#### Scenario: The route survives the render migration
- **WHEN** the app becomes a client-rendered bundle inside a native shell
- **THEN** the public page SHALL remain reachable as a web URL, since a store reviewer follows a
  link rather than a deep link
- **AND** the in-app path SHALL NOT depend on server rendering, per `CLAUDE.md` §Technology
  Decisions

### Requirement: The confirmation SHALL state what will be destroyed before it is irreversible

The rider SHALL be shown, before the destructive call, what the deletion will do to things other
people can see. The design's `Confirm account deletion` frame (`2303:9370`) draws
**"Delete account?"**, **"This action cannot be undone."**, a `Warning` button and a `Cancel`;
that is the frame, and the counts below are an addition to it, not a redesign of it.

#### Scenario: The confirmation names the collateral
- **WHEN** the confirmation screen renders for a rider who owns clubs or organises upcoming rides
- **THEN** it SHALL state the number of clubs that will change hands, the number of upcoming
  rides that will be cancelled, and the number of riders currently RSVP'd to them
- **AND** the counts SHALL be read under the rider's own RLS session, not computed from a
  privileged view

#### Scenario: A rider with nothing to lose is not shown an empty table
- **WHEN** the rider owns no clubs and organises no upcoming rides
- **THEN** the screen SHALL render exactly the drawn frame with no impact section, rather than a
  section reading zero

#### Scenario: Cancel changes nothing
- **WHEN** the rider chooses `Cancel`, dismisses the sheet, backgrounds the app, or navigates
  away at any point before the destructive call returns
- **THEN** nothing SHALL have been deleted, in the database or in Storage
- **AND** no partial state SHALL be observable by any other rider

#### Scenario: The impact summary cannot be trusted as authorisation
- **WHEN** the counts on the confirmation screen disagree with the database at the moment the
  deletion runs — a rider joined a ride in between, a club was left
- **THEN** the deletion SHALL proceed against the state at execution time
- **AND** the summary SHALL be understood as information for the rider, never as a precondition
  the server checks

### Requirement: The rider SHALL re-authenticate before the destructive call

The deletion SHALL require proof of the account password (or an equivalent fresh authentication)
immediately before it runs.

The drawn frame does not include this field. It is added because an unlocked, unattended or
stolen phone is otherwise two taps from an unrecoverable loss, and because every failure this
prevents is permanent while every failure it causes is an inconvenience. See `design.md` Q7 — the
designer may draw it differently, but it SHALL exist.

#### Scenario: A wrong password does not delete
- **WHEN** the rider submits an incorrect password on the confirmation screen
- **THEN** nothing SHALL be deleted and the screen SHALL report a failed check without saying
  whether the account exists

#### Scenario: A live session is not sufficient on its own
- **WHEN** a request reaches the deletion endpoint carrying a valid session but no fresh
  authentication
- **THEN** it SHALL be refused
- **AND** the refusal SHALL come from the server, not from the client omitting the button, since
  the client is the untrusted half once the render model moves

#### Scenario: Repeated wrong attempts do not become an oracle
- **WHEN** a password is submitted incorrectly several times
- **THEN** the responses SHALL NOT distinguish "wrong password" from "no such account" to a
  caller who is not already holding that account's session

### Requirement: Deletion SHALL be immediate and final, with no grace period and no soft-delete state

There SHALL be no `deleted_at` flag on `profiles`, no reactivation window, no "recently deleted"
listing and no tombstone row standing in for the departed rider.

The drawn copy is "This action cannot be undone." Both stores accept immediate deletion. A grace
period would put a new visibility state into every SELECT policy in the schema, which is the
layer this project's access-control bugs come from.

#### Scenario: There is no undo
- **WHEN** the deletion returns success
- **THEN** no route, screen or support action SHALL restore the account or any of its content
- **AND** the confirmation copy SHALL have said so before the fact, not after

#### Scenario: No soft-deleted rider is visible to anyone
- **WHEN** the schema is inspected after this change
- **THEN** `profiles` SHALL carry no soft-delete column, and no SELECT policy SHALL gain a
  deleted-state predicate
- **AND** a rider SHALL never be in a state where they are hidden from others but their rows
  remain

#### Scenario: Signing up again is a new account, not a restoration
- **WHEN** the same person signs up again afterwards, with the same email address
- **THEN** they SHALL receive a new account with a new identifier and no prior content,
  memberships, RSVPs, likes or blocks
- **AND** nothing in the app SHALL indicate that a previous account existed

### Requirement: Every state of the deletion flow SHALL be defined, including the ones that are not success

The flow SHALL have a defined, designed treatment for in-flight, offline, failed,
already-deleted and cancelled, and it MUST NOT report success on any of them except
already-deleted.

#### Scenario: In flight
- **WHEN** the destructive call is running
- **THEN** the confirmation button SHALL show a pending state and SHALL NOT be re-submittable
- **AND** the rider SHALL NOT be navigated away until the call resolves, because a deletion that
  reports nothing is indistinguishable from one that failed

#### Scenario: Offline
- **WHEN** the device has no connectivity
- **THEN** the deletion SHALL be refused with a plain message and SHALL NOT be queued for later
  execution
- **AND** this SHALL hold even once an offline write queue exists, because an irreversible
  destructive action is the one mutation that must never be optimistic

#### Scenario: The call fails
- **WHEN** the deletion returns an error of any kind
- **THEN** the rider SHALL remain signed in with their account intact, SHALL see what failed in
  non-technical terms, and SHALL be able to retry
- **AND** the screen SHALL NOT claim success on a network error, which is the failure mode that
  produces a rider who believes their data is gone

#### Scenario: The account is already gone
- **WHEN** the deletion runs for a session whose account no longer exists — a second device, a
  double submission, a retry after an unseen success
- **THEN** the flow SHALL report success and sign the rider out
- **AND** it SHALL NOT report an error, which would strand a rider on a screen with no exit

#### Scenario: Success ends the session everywhere it can reach
- **WHEN** the deletion succeeds
- **THEN** the local session, cached query state, cached images and any device secure storage
  SHALL be cleared, and the rider SHALL land on `/auth/login`
- **AND** the local clear SHALL happen even if the sign-out network call fails, matching the
  rule the render migration sets for ordinary sign-out

#### Scenario: A second device is not silently left signed in forever
- **WHEN** the rider holds a live session on another device at the moment of deletion
- **THEN** its refresh SHALL fail and it SHALL land signed out
- **AND** the window in which its unexpired access token can still read SHALL be stated and
  bounded by the project's JWT lifetime, not assumed to be zero
