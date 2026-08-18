## ADDED Requirements

### Requirement: A coordinate SHALL name the writer that produced it, and a rider's own value SHALL outrank a derived one

Where two writers can produce the same column — a rider choosing a value, and a background process
deriving one — the schema SHALL make the two distinguishable, and the rider's value SHALL win.

The marker SHALL be structural: columns that are present only on one arm, tied together by a CHECK
that makes the arms mutually exclusive. It SHALL NOT be a separate source enum, which is a second
statement of the same fact and free to disagree with the columns it labels.

Precedence SHALL be enforced by a trigger or a policy in Postgres, and SHALL NOT rest on the derived
writer declining to write. This repo's derived writers are Edge Functions: `tsconfig.json` excludes
`supabase/functions`, deploying is an owner action with no CI path, and `031` is the standing lesson
that an assumption about what a non-client role can reach goes unnoticed because the RLS suite runs
as the table owner. A precedence rule living only in a function is a rule one unreviewed deploy can
remove, silently, in the direction that stores a plausible wrong value.

The enforcement SHALL clear or restore rather than raise, wherever the write it guards is an
enrichment on a path the rider is already on. A raise there aborts a write the rider asked for
because of a value they did not.

#### Scenario: The row says which writer produced its value
- **WHEN** any row carrying a derived-or-chosen value is read
- **THEN** the writer SHALL be determinable from the columns of that row alone
- **AND** a combination claiming both writers, or a value claiming neither, SHALL be refused by CHECK

#### Scenario: The derived writer cannot overwrite the chosen one
- **WHEN** the derived writer updates the value on a row that already carries a rider's chosen one
- **THEN** the stored value SHALL remain the rider's
- **AND** any artifact derived from the rejected value SHALL be cleared in the same statement
- **AND** the statement SHALL NOT raise

#### Scenario: The rule is asserted against a role, not against a function
- **WHEN** the RLS suite covers this
- **THEN** it SHALL assert the stored outcome of a write issued as the caller, not the behaviour of
  the function that would normally issue it

### Requirement: A trigger that clears a column SHALL NOT clear a value supplied by the same statement

A `BEFORE UPDATE` trigger that assigns `NEW.<column> := NULL` overwrites whatever the statement
supplied for that column. That is the correct behaviour for a value the statement could only be
carrying by accident — a stale derived path — and the wrong behaviour for a value the statement is
deliberately supplying in the same breath as the change that fires the trigger.

Any clearing trigger SHALL therefore state which of the two it means, and SHALL distinguish
"supplied by this statement" from "already on the row" using `OLD` and `NEW` only. It SHALL NOT
depend on the client sending every column of the group, because the client owns the mutation path
and a hand-rolled request that omits a column is indistinguishable from one that never had it.

**Measured, because the obvious verification misses it.** Reading the trigger definition says it
fires on a change to one column; it does not say that a value written for a *different* column in
the same statement is discarded. On DEV 2026-08-18, inside a rolled-back transaction, an UPDATE
setting `rides.meeting_point`, `latitude`, `longitude` and `geocode_confidence` together returned the
new meeting point and three NULLs. A test that writes the columns in two statements passes and proves
nothing, because it is the single-statement case that the feature needs.

#### Scenario: A fresh value survives the trigger that clears a stale one
- **WHEN** one statement changes the column the trigger watches and supplies a new value for the
  columns the trigger clears
- **THEN** the supplied values SHALL be stored
- **AND** anything derived from the superseded value SHALL still be cleared

#### Scenario: An omitted group is cleared, not kept
- **WHEN** one statement changes the watched column and omits the group entirely
- **THEN** the whole group SHALL be cleared, because `NEW` carries the old values and keeping them
  would preserve a value the row can no longer be said to hold

#### Scenario: The distinction is decided from OLD and NEW
- **WHEN** a hand-rolled client repeats the row's existing group values alongside a changed watched
  column
- **THEN** the group SHALL be cleared, since nothing distinguishes that from an omission and the safe
  direction is to clear

#### Scenario: The single-statement case is asserted
- **WHEN** the RLS suite covers a clearing trigger
- **THEN** at least one assertion SHALL write the watched column and the cleared group in the **same**
  statement
