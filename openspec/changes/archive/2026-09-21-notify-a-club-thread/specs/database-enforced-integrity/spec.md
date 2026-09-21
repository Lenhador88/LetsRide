## ADDED Requirements

### Requirement: The shape of a notification's subject SHALL be a CHECK, and SHALL constrain every subject column for every type

`notifications_subject_shape` SHALL name **every** subject column in **every** arm — after this
change, sixteen arms each fixing five columns — with an `ELSE false` fallthrough.

**A CHECK that names only the columns a type uses is not a shape.** Adding `thread_id` and leaving
the fourteen existing arms untouched would let a `postcard_liked` row legally carry a `thread_id`,
placing it in a different equivalence class under the uniqueness index, breaking its own retraction's
four-column scope, and making it resolvable or not according to a thread nothing about it renders —
with nothing refusing it. The rule generalises: **a new subject column obliges every existing arm.**

This is the standing rule that no integrity rule may live only in client code, applied to a table no
client may write at all: the constraint is not defending against a rider, it is defending against the
next fan-out.

#### Scenario: Adding a subject column obliges every existing arm

- **WHEN** a migration adds a subject column to `notifications`
- **THEN** every existing arm of `notifications_subject_shape` SHALL be re-stated to require the new
  column NULL
- **AND** the constraint SHALL be dropped and re-added whole rather than patched, so that reading the
  file shows the complete shape

#### Scenario: The type list and the shape cannot silently disagree

- **WHEN** a type is added to `notifications_type_check` and forgotten in
  `notifications_subject_shape`
- **THEN** the insert SHALL be refused by the `ELSE false` arm
- **AND** the failure SHALL be loud at the first write of that type rather than silent for ever

### Requirement: A notification's uniqueness SHALL be `NULLS NOT DISTINCT` over every subject column

`notifications_event_key` SHALL cover the recipient, the type, the actor and **every** subject
column, with `NULLS NOT DISTINCT`. A subject column added without extending the key SHALL be treated
as a defect.

**A subject column outside the key collapses rows that name different things.** With `thread_id`
absent and `club_id` standing in, one rider's replies across every thread of one club collapse to a
single notification — the recipient is told once and never again, with no error, no log line and no
failing assertion. `NULLS NOT DISTINCT` is what makes the key fire at all, since most rows leave most
subject columns NULL; a plain UNIQUE treats two NULLs as different and the constraint would never
catch anything. That is `015`'s `feed_reads` lesson exactly.

#### Scenario: The key covers every subject column

- **WHEN** the index is derived after apply
- **THEN** the columns of `notifications_event_key` SHALL be exactly the recipient, the type, the
  actor and every subject column on the table
- **AND** this SHALL be derived from `pg_index` against `information_schema.columns` rather than read
  off a migration file

#### Scenario: Appending to the key preserves every existing collapse

- **WHEN** a column that is NULL on every existing row is appended to the key
- **THEN** no existing equivalence class SHALL split, because `NULLS NOT DISTINCT` compares those
  NULLs equal
- **AND** the rebuild SHALL therefore be provable from the data rather than argued from intent
- **AND** a failure of the `create unique index` SHALL be read as a pre-existing duplicate and
  investigated, never worked around by weakening the index

### Requirement: A trigger that must fire for every writer SHALL carry no `WHEN` clause, and one that must skip privileged writers SHALL keep its

`public.club_messages` and `public.club_thread_waves` SHALL each keep their
`enforce_participation_gate BEFORE INSERT … WHEN (CURRENT_USER = 'authenticated')` trigger unchanged.
The three fan-out and retraction triggers this change adds to the same two tables SHALL carry **no**
`WHEN` clause.

**Two triggers on one table with opposite clauses is the point, not an inconsistency.** The gate is a
rule about the client and must skip a privileged write; a fan-out is a rule about the data and must
fire for every writer, including the seed the RLS suite runs as. Copying either onto the other is a
silent defect in opposite directions: a gated fan-out never fires for a privileged write, and an
ungated participation gate refuses a `security definer` RPC.

**The participation-gate trigger count SHALL NOT move.** This change creates no table, and both
parent tables already carry the gate — measured at **22** on both projects on 2026-09-01. The count
SHALL be asserted rather than left inferred, following the precedent of asserting a count that stays
still.

#### Scenario: The gate still refuses an unconsented rider on both parent tables

- **WHEN** a rider with `terms_accepted_at` NULL attempts to post a club message or wave a thread
- **THEN** both SHALL be refused with `23514`
- **AND** zero notification rows SHALL exist afterwards, because an `AFTER` trigger never runs on a
  refused write

#### Scenario: The gate count is unchanged

- **WHEN** `select count(*) from pg_trigger where tgname = 'enforce_participation_gate' and not
  tgisinternal` is run after apply
- **THEN** it SHALL return the same number it returned before
- **AND** the assertion SHALL be present in the suite, because a table added later without a gate
  looks exactly like this count being right

#### Scenario: The fan-out fires for a write the gate skips

- **WHEN** a club message is inserted as the table owner, so the gate's `WHEN` clause is false
- **THEN** the gate SHALL not run and the fan-out SHALL still write its row
- **AND** this SHALL be asserted, because it is the exact case a copied `WHEN` clause would break and
  the case every assertion in the suite depends on
