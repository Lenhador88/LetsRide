# database-enforced-integrity

## ADDED Requirements

### Requirement: A recorded bar SHALL be state that every contradicting path clears, and SHALL be distinguished from a recorded refusal that is history

Two kinds of row look identical and behave in opposite ways, and this schema now holds both. Which
one a table is SHALL be decided when it is created and stated at the table, because the failure in
each direction is silent.

**A BAR is state.** It says *this actor may not do this thing right now*. It SHALL be keyed on the
pair it constrains, SHALL be idempotent to write, and **SHALL be deleted by every path that
contradicts it** — a bar that outlives the condition it describes is a permanent refusal nobody
decided on, held in a row nobody can read.

**A REFUSAL is history.** It says *this was declined*, and it SHALL survive later events, because
the record of a decision is the point of it. A `declined` join request is the worked example: it
must **not** be cleared when the rider later joins by another route, because it is the club's
record of having said no once.

The consequences, each testable:

- A bar SHALL name no actor unless something reads the actor. An actor column with no reader is an
  audit trail that arrived without a decision, on the most sensitive fact in the row.
- A bar SHALL be readable by no client role unless a designed surface reads it. Refusing to grant it
  is cheaper than deciding, for every role, what seeing it would mean.
- A bar SHALL cascade from every entity it names, so that deleting either end erases it without a
  sweep or a scheduled job.
- A bar SHALL have a stated retention window at creation, expressed as the events that end it rather
  than as a duration, when nothing decays it on a clock.
- **The path that clears a bar SHALL observe the resulting state, not the route that produced it.**
  Clearing it inside each admission path leaves the next admission path to remember, and the one
  that forgets fails silently and permanently.

#### Scenario: A bar is cleared by every route that contradicts it
- **WHEN** an actor barred from a resource is subsequently granted that resource by any route,
  including one added later
- **THEN** the bar SHALL be gone
- **AND** the clearing SHALL be driven by the granted state itself, so a new route inherits it
  without being edited

#### Scenario: A refusal is not cleared by a later grant
- **WHEN** a rider whose join request was `declined` later joins the same club through another route
- **THEN** the declined row SHALL survive, because only the club may clear its own refusal

#### Scenario: A bar holds no actor and no client grant
- **WHEN** a bar table is read from the catalogue
- **THEN** it SHALL carry no column identifying who imposed it, unless a designed surface reads that
  column
- **AND** neither `anon` nor `authenticated` SHALL hold any grant on it, with the assertion scoped to
  those grantees rather than counting table-wide

#### Scenario: Both ends cascade
- **WHEN** either entity a bar names is deleted
- **THEN** the bar SHALL be gone, with no cleanup step added to any deletion path

#### Scenario: The kind is stated where the table is created
- **WHEN** a table holding a bar or a refusal is added
- **THEN** its migration SHALL state which of the two it is and what ends it
- **AND** a bar with no stated end SHALL be treated as a defect, because it is a permanent refusal
  that no one agreed to
