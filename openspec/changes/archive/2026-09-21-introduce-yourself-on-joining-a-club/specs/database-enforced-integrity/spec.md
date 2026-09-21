## ADDED Requirements

### Requirement: A foreign key whose SET NULL would null a NOT NULL column SHALL name its column list

A composite foreign key declared `ON DELETE SET NULL` nulls **every** referencing column. Where any
of them is `NOT NULL`, the referenced delete fails at runtime with a not-null violation — and the
constraint is accepted at DDL time, so the migration is green, the assertions pass, and the failure
arrives the first time a rider performs the ordinary action the key was hung off.

Any such foreign key SHALL therefore declare the column list — `ON DELETE SET NULL (<column>)` —
and the assertion beside it SHALL delete a referenced row that is **actually referenced**, because
a delete of an unreferenced row succeeds under both spellings and proves nothing.

#### Scenario: The bare form is refused by the test, not by the DDL
- **WHEN** a composite `ON DELETE SET NULL` key is declared over a column list including a
  `NOT NULL` column, without a column list
- **THEN** the DDL SHALL be accepted
- **AND** deleting a referenced parent row SHALL fail with a not-null violation
- **AND** an assertion SHALL exist that performs exactly that delete

#### Scenario: The scoped form leaves the row standing
- **WHEN** the key names its column list and a referenced parent row is deleted
- **THEN** the delete SHALL succeed
- **AND** the child row SHALL survive with only the named column nulled

### Requirement: A CHECK spanning a column that a foreign key nulls SHALL be one-directional

A foreign key's `SET NULL` action is an UPDATE, so every CHECK on the child row is re-evaluated
with that column already nulled. A CHECK asserting that two columns are *both set or both null* is
therefore violated by the very action the key exists to perform, and refuses the parent delete —
the same failure as the requirement above, one SQLSTATE further on and from a different constraint.

A pairing CHECK across such a column SHALL be written in the direction that survives the nulling:
it may require that a **set** marker implies its companion, and SHALL NOT require that a set
companion implies the marker.

#### Scenario: A biconditional pairing refuses the parent delete
- **WHEN** two columns are constrained to be both set or both null and one is nulled by a foreign
  key action
- **THEN** the parent delete SHALL fail with a check-constraint violation

#### Scenario: The surviving direction still forbids the half-state that matters
- **WHEN** the pairing is written as "a set marker implies its companion is set"
- **THEN** the parent delete SHALL succeed
- **AND** a write setting the marker without its companion SHALL still be refused

### Requirement: `club_members` SHALL carry no UPDATE policy, and adding one SHALL be treated as a role-escalation change

`authenticated` holds a column-level `UPDATE (club_id, role, user_id)` grant on `club_members` and
the table carries **no UPDATE policy**, which is the only reason that grant is inert. Row security
with no matching policy refuses every UPDATE; the grant is a survival from before the role column
had a designed writer.

Consequently, **adding any UPDATE policy to `club_members` re-arms that grant**, and the obvious
own-row policy lets an ordinary member set their own `role` to `admin` — measured on DEV, in a
rolled-back transaction. That defeats the standing requirement that a club membership role SHALL
NOT be self-assignable, and it defeats it silently: the policy that causes it reads correct, names
no role, and is two lines long.

No feature SHALL add an UPDATE policy to `club_members` in order to give a client a writable column
there. A column a client must write SHALL go on a table whose UPDATE surface is already designed,
or be written by a `security definer` function that needs no policy at all. An assertion SHALL pin
the policy count so a later change cannot add one quietly.

#### Scenario: The UPDATE policy count is zero and asserted
- **WHEN** the policies on `club_members` are enumerated
- **THEN** exactly zero SHALL be for UPDATE
- **AND** an assertion SHALL fail if that number changes

#### Scenario: A member cannot promote themselves
- **WHEN** an ordinary member attempts to update their own membership row's role
- **THEN** the write SHALL be refused, by the absence of a policy rather than by any predicate

### Requirement: A `security definer` writer SHALL restate the participation gate, and a trigger SHALL NOT be counted as covering it

Every `enforce_participation_gate` trigger carries `when (current_user = 'authenticated')`, and
`current_user` inside a `security definer` body is the function's owner. A content write performed
inside such a function is therefore **ungated by the trigger on its own table**, whatever the
trigger count says.

Such a function SHALL test the calling rider's consent stamp itself, against the subject taken from
the session. Adding a trigger instead SHALL NOT be treated as a remedy: it would raise the coverage
count while gating nothing, which is the precise failure an existing assertion already exists to
prevent elsewhere.

Where a change adds no table, its participation-gate trigger count SHALL be claimed as **unchanged**
rather than incremented, and the gate's coverage SHALL be claimed against the function.

#### Scenario: The function refuses an un-onboarded caller
- **WHEN** a rider whose consent stamp is NULL calls the writing function
- **THEN** it SHALL refuse
- **AND** the refusal SHALL come from the function body, the trigger being unable to fire

#### Scenario: No trigger is added to launder the count
- **WHEN** this change is applied
- **THEN** the participation-gate trigger count SHALL be unchanged
- **AND** no trigger SHALL be added to a table solely to make coverage read complete

### Requirement: A new content column SHALL carry its bounds as a CHECK, matching the sibling column it may be compared with

Rider-authored text added to an existing table SHALL carry a non-blank and a maximum-length CHECK
in the same migration that adds the column. A schema in the client MAY mirror the bound for the
message and the live counter and SHALL NOT be the only place it exists.

Where the new text sits beside an existing rider-authored column that readers will compare it with,
the bound SHALL be the same one, so that neither can be longer than the other for reasons nobody
decided.

#### Scenario: The bound is enforced without the client
- **WHEN** a write bypassing the client supplies whitespace only, or more than the maximum
- **THEN** the database SHALL refuse it with a check-constraint violation

#### Scenario: The bound matches its sibling
- **WHEN** the new column's maximum is compared with the message body's
- **THEN** they SHALL be equal, and the equality SHALL be stated where the column is defined
