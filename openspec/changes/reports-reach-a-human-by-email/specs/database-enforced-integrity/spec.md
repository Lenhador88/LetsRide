# Spec Delta

> **Coordination.** `database-enforced-integrity` exists in `openspec/specs/` and carries
> *"A derived row SHALL NOT hold a copy of a visibility decision"*, which the still-active
> `deliver-push-notifications` change is **MODIFYING** in flight to permit a push payload under four
> conditions. This delta is **ADDED only** and does not touch that heading's text: it adds the
> sibling case, where the copy leaves the database's reach permanently because its recipient is a
> person's mailbox rather than a device. Re-derive with `ls openspec/specs/` and `ls openspec/changes/`.

## ADDED Requirements

### Requirement: A copy transmitted outside the database's reach SHALL be enumerated per column, and its permanence SHALL be stated

Where a privileged job transmits row contents to a destination no policy, cascade or deletion can
reach — an email, a webhook, a third-party API — the columns that may leave SHALL be enumerated in
**SQL**, per source, in the function that produces them, and the transmitting code SHALL be incapable
of widening them.

The enumeration is the access control. A privileged producer has no viewer whose row security could
be re-checked, so a predicate cannot do this work and an allowlist of columns is the only mechanism
left.

#### Scenario: The projection lives in SQL, not in the caller
- **WHEN** a privileged job assembles data for an external destination
- **THEN** the columns SHALL be fixed by the producing function's return type
- **AND** the caller SHALL pass no subject, table or column argument that could widen it
- **AND** the caller SHALL issue no direct table read

#### Scenario: Identity is excluded unless the destination is the subject
- **WHEN** the transmitted rows concern riders
- **THEN** no `profiles` or `auth.users` column SHALL be transmitted unless the recipient is that
  rider
- **AND** an identifier that joins to everything — a bare uuid of a person — SHALL count as identity
  for this rule

#### Scenario: A credential-like value is never transmitted
- **WHEN** a projection is designed
- **THEN** no signed URL, bearer token, session id or push token SHALL be included
- **AND** the reason SHALL be recorded where the projection is defined: such a value is validated by
  signature or possession rather than by policy, so it grants reach to whoever the message is
  forwarded to

#### Scenario: The permanence is written down where the copy is produced
- **WHEN** such a transmission is designed
- **THEN** the design SHALL state that no policy change, block, deletion or erasure request can
  withdraw what was sent
- **AND** it SHALL state that no withdrawal sweep will be attempted
- **AND** the minimised projection SHALL be recognised as the whole mitigation available in code

### Requirement: A table recording that a row was transmitted SHALL carry no copy of that row

A marker, outbox or delivery-log row SHALL carry references, bookkeeping timestamps and a state, and
SHALL NOT carry text from the row it describes, a rendered message, or a provider's error body.

#### Scenario: No payload column under any name
- **WHEN** a marker or outbox table is created
- **THEN** it SHALL have no column holding a body, note, caption, title, username or rendered message
- **AND** it SHALL have no `last_error` or equivalent, because a provider's error body can echo the
  payload it rejected

#### Scenario: The marker cannot outlive its subject
- **WHEN** the described row is deleted
- **THEN** the marker SHALL be removed by cascade
- **AND** exactly one foreign key SHALL identify the subject, enforced by a CHECK when the table
  serves several sources

#### Scenario: The marker is not a status the app can read
- **WHEN** any client role reads the marker table
- **THEN** it SHALL be refused, by RLS with no policy and by an explicit revoke naming
  `service_role`
- **AND** the marker SHALL NOT be interpretable as a moderation or workflow state
