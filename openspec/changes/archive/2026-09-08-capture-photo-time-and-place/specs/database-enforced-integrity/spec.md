<!--
COORDINATION — none, and that is measured rather than assumed.

This delta ADDS three requirements and MODIFIES none, so archiving it cannot supersede a
sibling's scenario: `openspec archive` folds a delta in by replacing a requirement WHOLESALE and
comparing scenario NAMES, which only bites when two changes claim the same requirement.

Verified 2026-08-18 that none of the three names below is claimed by any active change.
Re-derive rather than trust it:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

The `database-enforced-integrity` claimants at that time were `add-account-deletion` (4),
`add-ride-club-edit-delete` (4), `enforce-creator-membership` (6), `enforce-ride-capacity` (3),
`tag-postcards-to-rides` (3), `add-ride-map-tiles` (2), `add-ride-chat-unread` (1),
`align-fanout-recipients-with-readability` (1), `grant-club-owner-member-reach` (1) and
`view-rider-profile` (1). None of them names any of ours.

One neighbour is worth reading before archiving even so, because it is about the same table and
the same instrument: `tag-postcards-to-rides` ADDS *Adding a column to a table with table-level
grants SHALL be treated as granting it*. The first requirement below is that rule's inverse
arriving — on `postcards`, every verb is column-level now, so a new column arrives with NOTHING —
and the two are complementary rather than in conflict. Neither replaces the other.
-->

## ADDED Requirements

### Requirement: A value the client must supply SHALL be BOUNDED by the database even where it cannot be OWNED by it

`044` closed `postcards.created_at` by taking the grant away, and that is the strongest instrument
available: a column the client cannot write is a column the client cannot lie about. Where the
value can only come from the rider's own device — a capture time read out of a file, a coordinate,
a measurement — that instrument does not exist, and its absence SHALL NOT be read as permission to
leave the column unbounded.

Such a column SHALL carry a CHECK bounding it in every direction where an out-of-range value would
cost somebody something, and every consumer SHALL be told, in the column comment and in the spec,
that the value is a **claim** rather than a fact. A CHECK SHALL be preferred over a BEFORE trigger
that clamps, for `044`'s stated reason: a constraint fails the write at the door with a bug
report, while a trigger accepts the request and quietly discards half of it, producing a support
ticket nobody can reproduce.

`now()` in such a CHECK is permitted where the predicate can only ever become **more** true as
time passes — measured on Postgres 16: the constraint is accepted, the ceiling fires, and dropping
and re-adding it revalidates clean against rows that already passed. A predicate that could go
from true to false while a row sits still SHALL NOT use it, because `pg_restore` and
`VALIDATE CONSTRAINT` would then fail on data that was legal when it was written.

#### Scenario: An unownable column is still bounded
- **WHEN** a column's value can only be supplied by the client
- **THEN** it SHALL carry a CHECK constraint, and the absence of a grant-based defence SHALL NOT
  be treated as the absence of a defence

#### Scenario: The bound is asserted against the database, not against the schema that validates it
- **WHEN** the bound is tested
- **THEN** the assertion SHALL attempt the write and observe the database's refusal, not exercise
  the Zod schema, because a rider can decline to run the schema

#### Scenario: The client's own limit matches the constraint exactly
- **WHEN** the client filters an out-of-range value before sending it
- **THEN** its limit SHALL be the same value as the CHECK's, so the constraint never fires on an
  honest rider and never fails to fire on a dishonest one

#### Scenario: A claim is not promoted to evidence
- **WHEN** any screen, moderation decision or automated rule reads such a column
- **THEN** it SHALL NOT treat the value as proof of anything about the rider, and a server-owned
  column SHALL be preferred wherever one answers the question

### Requirement: A disclosure the rider may decline SHALL be reduced before the request, never after it

Where a rider is offered a choice about how much of a value to publish, the reduction SHALL happen
on the device, before the request is built. A precise value SHALL NOT be stored alongside a flag,
column or convention instructing readers to show less of it.

Row security is **row**-level. A policy that returns a row returns every column on it that the
reader holds a grant for, and Postgres has no per-row column security — `062` had to revoke a
grant to close one column, and a grant is per role, not per row. So a "stored but not shown" rule
can never be a database rule; it can only be honoured by a screen, which makes it a deferred
disclosure. `openspec/config.yaml`: a visibility rule that is not in the database *"silently
becomes whatever the migration author assumed."*

#### Scenario: The declined value never reaches the server
- **WHEN** a rider declines to disclose a value
- **THEN** no column, log, notification, Storage object or derived artefact on the server SHALL
  contain it or anything from which it can be recovered

#### Scenario: A visibility flag is not accepted as a control
- **WHEN** a design proposes storing a precise value with a flag governing its display
- **THEN** it SHALL be rejected, and the reduction SHALL be moved to the device instead

#### Scenario: The reduced value is what the document holds
- **WHEN** the reduction is implemented in a form
- **THEN** the reduced value SHALL be what the form carries, so the unreduced one is not one
  `querySelector` — or one refactor of the action — away from being sent

#### Scenario: The rule is stated per role, including the negative
- **WHEN** such a column is added
- **THEN** its audience SHALL be stated for every role that can reach the parent row, including
  the roles that reach nothing, and SHALL be asserted in `supabase/tests/`

#### Scenario: Where the reduction has an observable form, the database SHALL bound it
- **WHEN** a reduced value is recognisable from the value itself — a rounded coordinate, a
  truncated identifier, a bucketed count
- **THEN** a CHECK SHALL require that a row claiming to be reduced **is** reduced, so the bound on
  the disclosure is a database fact rather than the client's word

#### Scenario: That CHECK asks about the stored value, not about a reduction it never saw
- **WHEN** such a CHECK is written
- **THEN** it SHALL test a property of the value in the row, and SHALL NOT attempt to compare it
  against the database's own reduction of an original the database has never seen
- **AND** two implementations disagreeing on a boundary case SHALL both be admitted, because a
  parity test between a client and the database is unwinnable and would refuse honest writes

### Requirement: Columns that are meaningful only together SHALL be constrained to arrive together

Where two or more nullable columns are meaningless in isolation — a latitude without a longitude,
a coordinate without the marker saying how precise it is, a path without the value it was derived
from — a CHECK SHALL reduce the legal states to the meaningful ones. The alternative is every
reader inventing its own guess about a half-populated row, and those guesses drifting.

`rides_geocode_coupling` (`051`) is the standing instance: it couples `latitude`, `longitude` and
`geocode_confidence`, carries the bounds in the same constraint, and is joined by
`rides_map_paths_need_a_coordinate` for the derived paths. A second table adding coordinates SHALL
copy that shape rather than invent a second idiom.

#### Scenario: Every half-state is refused
- **WHEN** a row arrives with some of a coupled group set and others NULL
- **THEN** the write SHALL be refused, and each half-state SHALL have its own assertion rather
  than one assertion standing for the set

#### Scenario: Bounds travel with the coupling
- **WHEN** a coupled group has natural ranges
- **THEN** the ranges SHALL be expressed in the same constraint, so a reader sees the whole rule
  in one place

#### Scenario: The coupling is not delegated to the client
- **WHEN** the coupling is implemented
- **THEN** it SHALL NOT rely on the fact that the app's own form always sets the group together,
  because the client owns the mutation path and any client can send any subset

#### Scenario: A client that drops one member of a group drops all of them
- **WHEN** a client discards a value it would otherwise have sent — a clamp, a validation failure,
  a rider declining
- **THEN** it SHALL discard the whole coupled group, because dropping one member turns a value the
  client meant to suppress into a refused write

#### Scenario: An instant stored without its offset is a coupled group
- **WHEN** a timestamp is derived from a zone-less source
- **THEN** the offset it was resolved in SHALL be stored with it and coupled to it, because the
  wall clock is otherwise unrecoverable and no later migration can backfill it
