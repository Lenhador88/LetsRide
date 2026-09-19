# Spec Delta

> **Coordination.** `content-moderation` exists in `openspec/specs/` (folded out of
> `act-on-postcard-reports`) and describes the postcard triage surface. This delta is **ADDED only**
> and shares no heading with it, nor with the active `moderate-and-report-club-threads` or
> `report-ride-threads-and-postcard-comments` changes, which add report *subjects* to the same
> capability. This one adds how a filed report reaches a person. Re-derive with `ls openspec/specs/`
> and `ls openspec/changes/`.

## ADDED Requirements

### Requirement: A filed report SHALL be pushed to the operator, and the push SHALL be a pointer rather than a triage surface

The `private` queue views SHALL remain the reader of record. The mail SHALL carry what decides
**whether to open the queue now** — kind, subject id, reason, the reporter's note and two report
counts — and SHALL NOT carry what decides the outcome, which is the reported content itself.

#### Scenario: The operator learns of a report without opening the dashboard
- **WHEN** a report of any kind is filed
- **THEN** the next digest SHALL name it
- **AND** acting on it SHALL still be done in the `private` queue view as the database owner

#### Scenario: The mail cannot replace the queue
- **WHEN** the operator reads a digest
- **THEN** it SHALL contain no reported content — no caption, image path, thread title, message or
  comment text
- **AND** the take-down functions SHALL remain callable only by the owner at the dashboard,
  unmodified by this change

#### Scenario: A queue view is not modified to serve the mail
- **WHEN** the digest's projection is implemented
- **THEN** it SHALL be a separate, narrower projection in the claim function
- **AND** no existing queue view SHALL gain, lose or rename a column for the mail's benefit

### Requirement: The reporter SHALL NOT be identifiable from anything that leaves the database

`076` §3b revoked `service_role` from `postcard_reports` so that the one credential bypassing RLS
could not enumerate who accused whom; `094`, `122` and `123` applied the same judgement at creation.
A mail at a third-party provider is a weaker container than a table with no grants, so the reporter's
identity SHALL NOT leave at all.

#### Scenario: The reporter's id does not leave, in any form
- **WHEN** any report is mailed
- **THEN** `reporter_id` SHALL NOT appear in the mail, including as a bare uuid
- **AND** no join to `profiles` for the reporter SHALL exist in the digest's projection

#### Scenario: The reported rider is not named either
- **WHEN** any report is mailed
- **THEN** the mail SHALL carry the subject's id and the two counts, and no username or id of the
  reported rider
- **AND** repeat-offender triage SHALL be served by a `reports_on_author` count, named unqualified
  like the queue views' own because no `resolved_at` exists to make "open" mean anything, and whose
  documented under-count (`076` §1 — reports cascade with their subject) applies unchanged

#### Scenario: A reply to the digest cannot reach a rider
- **WHEN** the operator replies to a digest mail
- **THEN** the reply SHALL reach the sender or nothing
- **AND** no reporter or feedback author SHALL be reachable as a `Reply-To`, `To` or `Cc` value

### Requirement: A mailed report SHALL NOT become moderation state

Recording that a row was mailed SHALL NOT add a workflow to the report tables. The marker SHALL live
in its own table, and no report table SHALL gain a column, a policy or an UPDATE grant.

#### Scenario: The report tables are untouched
- **WHEN** this change applies
- **THEN** no report table SHALL gain a column, and none SHALL gain an UPDATE or DELETE policy or
  grant for any role
- **AND** `a report is not editable and not withdrawable` SHALL remain true in both directions

#### Scenario: The marker says mailed, never handled
- **WHEN** an entry is marked sent
- **THEN** it SHALL assert only that a mail was accepted by the provider
- **AND** no `resolved_at`, status, assignee or moderation outcome SHALL exist anywhere in this
  change

#### Scenario: Ignoring a report remains free
- **WHEN** the operator reads a digest and takes no action
- **THEN** no state SHALL change anywhere
- **AND** the report SHALL remain in its queue exactly as `076` designed
