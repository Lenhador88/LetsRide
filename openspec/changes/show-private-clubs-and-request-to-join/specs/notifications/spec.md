## ADDED Requirements

### Requirement: The type list and the subject shape SHALL be extended together, and neither new type SHALL need a new resolvability conjunct

`notifications_type_check` and `notifications_subject_shape` SHALL be altered in the same migration.
`085` adds **two** types, taking the first from eight strings to ten and adding two arms to the
second, each carrying **`club_id` alone** — the same subject shape `club_joined` already has.

| Type | Recipient | Actor | Subject columns |
|---|---|---|---|
| `club_join_requested` | the club's owner and its admins | the requester | `club_id` |
| `club_join_request_approved` | the requester | the approving admin | `club_id` |

Because the shape matches an existing type exactly, the SELECT policy's **per-column** resolvability
conjuncts already cover them and SHALL NOT be rewritten. That is the property `036` chose the
per-column form for.

#### Scenario: Both constraints move together
- **WHEN** the migration is applied
- **THEN** `notifications_type_check` SHALL name ten types and `notifications_subject_shape` SHALL
  carry an arm for each, with `else false` intact
- **AND** an insert of either new type with a NULL `club_id`, or with any of `postcard_id`,
  `comment_id` or `ride_id` set, SHALL be refused with `23514`

#### Scenario: The read policy is unchanged
- **WHEN** the SELECT policy is compared before and after
- **THEN** its qual SHALL be identical, asserted by equality
- **AND** no conjunct SHALL be added for either new type

#### Scenario: A rider still cannot write or forge one
- **WHEN** any client role attempts to insert either new type
- **THEN** it SHALL be refused, because `authenticated` holds no INSERT grant on `notifications`
  and this change adds none

### Requirement: A notification whose recipient cannot resolve its subject SHALL NOT be written, and the case where that forecloses a notification entirely SHALL be recorded rather than worked around

The standing requirement *"A rider SHALL NOT learn a private club's name … from a notification"*
means a `club_id`-carrying row addressed to a non-member of a private club is **written and never
returned**: `036` §3's conjunct is
`club_id is null or exists (select 1 from public.clubs scl where scl.id = notifications.club_id)`,
evaluated under the reader's own row security.

Therefore **there SHALL be no `club_join_request_declined` type.** A declined requester holds no
membership, the club does not resolve, and the row would be invisible — not erroring, not counted,
simply absent. The refusal SHALL be recorded on the `club_join_requests` row and surfaced from
there.

This requirement SHALL also bind the general case: a fan-out that cannot deliver to its intended
recipient SHALL be **omitted with its reason written down**, and SHALL NOT be shipped as a row
nobody reads.

#### Scenario: The decline writes no notification at all
- **WHEN** `decline_club_join_request` succeeds
- **THEN** **zero** `notifications` rows SHALL be written
- **AND** this SHALL be asserted, because a fan-out that writes an unreadable row passes every
  other test in the suite

#### Scenario: The approval's notification resolves, and only because of statement order
- **WHEN** `approve_club_join_request` succeeds
- **THEN** the `club_members` row SHALL be written **before** the notification, so that
  `private.can_read_club(requester, club)` is true at fan-out time and the SELECT policy's `EXISTS`
  is true at read time
- **AND** the ordering SHALL be asserted by reversing it in a scratch copy and observing the
  notification vanish from the requester's read, not merely by reading the function

#### Scenario: The requester's other notifications are unaffected
- **WHEN** the requester holds notifications for other clubs and rides
- **THEN** none SHALL be affected by their request being declined

### Requirement: A notification SHALL NOT be the only record of an event whose recipient may lose the ability to read it

Where an event has a durable row of its own — a request, an invite, a membership — the notification
SHALL be an **alert** and the row SHALL be the **record**. A surface SHALL be able to state the
event's current status from the row alone, with every notification for it deleted.

#### Scenario: The rider learns their request's outcome from the request
- **WHEN** a rider's request is declined and no notification exists
- **THEN** their own `club_join_requests` row SHALL still say `declined` with its `responded_at`
- **AND** their Explore list SHALL stop offering the club, which is the observable outcome

#### Scenario: An approval's record is the membership, not the notification
- **WHEN** the approval notification is later evicted — the rider leaves the club, so the club stops
  resolving for them
- **THEN** the fact that they were once a member SHALL not have depended on that row

### Requirement: An actionable notification SHALL derive its actions from the live subject row, never from its own type

`club_join_requested` is the second actionable notification type in this app, after `ride_invited`.
Whether Approve and Decline are offered on the row SHALL be decided by reading the live
`club_join_requests` row under the reader's own row security at render time — never from the
notification's `type`, `created_at` or `read_at`.

A notification whose action is no longer available SHALL still render as a legible record of what
happened, with the controls **absent rather than disabled** — a disabled control is a claim that
the action exists.

#### Scenario: Controls are drawn from the request
- **WHEN** the notification list renders a `club_join_requested` row
- **THEN** the controls SHALL be shown only if a `club_join_requests` row for that club and reader
  is visible to them and is `pending`
- **AND** a row whose request has been withdrawn, answered on another device or hidden by a block
  SHALL render as text with no controls

#### Scenario: A stale submit is refused indistinguishably and refreshes
- **WHEN** the reader presses Approve against a request that has since been withdrawn or answered
- **THEN** the RPC SHALL raise the same error a nonexistent request id raises
- **AND** the surface SHALL re-read and re-render rather than reporting a failure the rider can act
  on

#### Scenario: The action never widens what the row discloses
- **WHEN** the request is not visible to the reader
- **THEN** the notification SHALL disclose nothing the notification policy does not already permit

### Requirement: The retraction SHALL delete exactly the row its matching fan-out would have written

Deleting a `club_join_requests` row — a withdrawal by the requester, a clear by an admin, or the
delete that approval performs — SHALL retract the `club_join_requested` notification, matched on the
full event key including `type`, on `retract_postcard_liked`'s shape.

It SHALL NOT touch a `club_join_request_approved` row.

#### Scenario: A withdrawal takes its alert with it
- **WHEN** a requester withdraws a pending request
- **THEN** every admin's `club_join_requested` row for that pair SHALL be deleted
- **AND** their unread counts SHALL fall with their lists in the same instant

#### Scenario: An approval retracts the request alert and leaves the join alert
- **WHEN** an approval deletes the request row
- **THEN** the `club_join_requested` rows SHALL be retracted
- **AND** the `club_joined` rows written by the existing `notify_club_joined` trigger SHALL remain
- **AND** the requester's `club_join_request_approved` row SHALL remain

#### Scenario: The retraction is scoped by type
- **WHEN** the retraction runs
- **THEN** it SHALL match on `type = 'club_join_requested'` explicitly, so a future type sharing
  the same `club_id` cannot be collected by it
