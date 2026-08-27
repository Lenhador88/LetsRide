## ADDED Requirements

### Requirement: The type list and the subject shape SHALL be extended together, and every new type SHALL name its subject columns

`notifications_type_check` and `notifications_subject_shape` SHALL be altered in the same migration.
A type added to the first and missing from the second is admitted by the `case … else false`
expression only as a `false`, which is the intended failure — but the reverse omission, adding to
the type list while forgetting the shape arm, is what `036`'s own comment calls out: it *"would
silently admit a row with no subject at all"* if the `else false` were ever removed, and today it
refuses every such row on insert with `23514`, which is a fan-out that silently writes nothing.

`083` adds three types, each carrying **`ride_id` alone** — the same subject shape as `ride_joined`:

| Type | Recipient | Actor | Subject columns |
|---|---|---|---|
| `ride_invited` | the invitee | the inviter | `ride_id` |
| `ride_invite_accepted` | the inviter | the invitee | `ride_id` |
| `ride_invite_declined` | the inviter | the invitee | `ride_id` |

Because the shape matches an existing type exactly, the SELECT policy's **per-column** resolvability
conjuncts already cover them and SHALL NOT be rewritten. That is the property `036` chose the
per-column form for, and this change is its first test.

#### Scenario: Both constraints move together
- **WHEN** the migration is applied
- **THEN** `notifications_type_check` SHALL name eight types and `notifications_subject_shape` SHALL
  carry an arm for each, with `else false` intact
- **AND** an insert of each new type with a NULL `ride_id`, or with any of `postcard_id`,
  `comment_id` or `club_id` set, SHALL be refused with `23514`

#### Scenario: The read policy is unchanged and still drops an unresolvable subject
- **WHEN** a rider holds a `ride_invited` row whose ride they can no longer read
- **THEN** the row SHALL NOT be returned and SHALL NOT be counted, through the existing per-column
  `EXISTS`, with no new conjunct added
- **AND** this SHALL be asserted for a ride that became invisible **after** the row was written,
  because a fan-out-time check answers "is this visible now" and the row is read at a later now

#### Scenario: A rider still cannot write or forge one
- **WHEN** any client role attempts to insert any of the three new types
- **THEN** it SHALL be refused, because `authenticated` holds no INSERT grant on `notifications` and
  this change adds none

### Requirement: An actionable notification SHALL derive its actions from the live subject row, never from its own type

Where a notification row offers the reader an action — a button that performs a write — whether the
action is offered, enabled or disabled SHALL be decided by reading the subject's own row under the
reader's row security at render time. The notification's `type`, `created_at` or `read_at` SHALL NOT
be used as evidence that the action is still available.

This is `036` §2 applied to a control rather than to a string, and it binds harder: a stale string
misinforms, a stale control performs a write.

A notification whose action is no longer available SHALL still render as a legible record of what
happened, with the controls absent rather than disabled — a disabled control is a claim that the
action exists.

#### Scenario: Accept and Decline are drawn from the invite, not from the type
- **WHEN** the notification list renders a `ride_invited` row
- **THEN** the controls SHALL be shown only if a `ride_invites` row for that ride and reader is
  visible to them and is `pending`
- **AND** a row whose invite has been revoked, answered on another device, or hidden by a block
  SHALL render as text with no controls

#### Scenario: A stale submit is refused indistinguishably and refreshes
- **WHEN** the reader presses Accept against an invite that has since been revoked or answered
- **THEN** the RPC SHALL raise the same error a nonexistent invite raises
- **AND** the surface SHALL re-read the invite and re-render rather than reporting a failure the
  rider can act on

#### Scenario: The action never widens what the row discloses
- **WHEN** the invite is not visible to the reader
- **THEN** the notification SHALL disclose nothing the notification policy does not already permit,
  and SHALL NOT reveal that an invite exists

#### Scenario: Answering from the list moves the list
- **WHEN** the reader answers from the notification row
- **THEN** the invite list, the notification list, its unread count, the ride and the ride's crew
  SHALL all be invalidated, because the answer changes all five

### Requirement: Two notifications for one exchange SHALL be readable independently and SHALL NOT be collapsed

An invitation and its answer are two events with two recipients and SHALL be two rows. The answer
SHALL NOT retract, overwrite or mark-read the invitation, and the invitation's retraction (on a
revoke) SHALL NOT touch the answers.

Where a rider declines and later accepts, both answer notifications SHALL exist, because both
happened; the unique event key distinguishes them by `type`.

#### Scenario: Each party sees only their own side
- **WHEN** the exchange completes
- **THEN** the invitee SHALL hold the `ride_invited` row and the inviter SHALL hold the answer row
- **AND** neither SHALL be able to read the other's, because `notifications` SELECT is
  `user_id = auth.uid()` and admits no second party

#### Scenario: A block after the exchange hides both
- **WHEN** either rider blocks the other after the answer
- **THEN** neither row SHALL be returned to its recipient, through the read-time block conjunct
- **AND** both unread counts SHALL agree with their lists
