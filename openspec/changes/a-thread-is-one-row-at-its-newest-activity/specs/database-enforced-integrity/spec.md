## ADDED Requirements

### Requirement: A thread's activity timestamp SHALL be server-owned, monotonic, and written only by a trigger

`club_threads.last_activity_at` and `ride_threads.last_activity_at` SHALL be `not null`, SHALL
default to the thread's own `created_at`, and SHALL be written only by an `AFTER INSERT` trigger on
`club_messages` and `ride_thread_messages` respectively.

`authenticated` SHALL hold **no INSERT and no UPDATE grant** on either column, and neither table
SHALL gain an UPDATE policy. Both refusals SHALL exist independently: the column grant and the
absent policy each refuse the write on their own, and the RLS suite SHALL assert the grant scoped to
the `authenticated` grantee rather than by attempting a call, since the suite runs as the table owner
for whom no barrier exists.

The update SHALL be `greatest(last_activity_at, new.created_at)`, never a bare assignment. A message
row's `created_at` is a client-defaultable column, and a backdated or clock-skewed insert SHALL NOT
be able to pull a thread's position backwards. Monotonicity is also what makes the backfill and the
trigger order-independent.

The trigger SHALL fire `AFTER INSERT`, so that a message refused by the participation gate — a
`BEFORE` trigger that raises — records no activity.

**A rider SHALL NOT be able to move a thread other than by inserting a message they were already
entitled to insert.** This change SHALL add no write path, no RPC and no grant.

#### Scenario: A rider cannot write the column directly
- **WHEN** an `authenticated` rider attempts to INSERT or UPDATE `last_activity_at` on either table
- **THEN** the write SHALL be refused
- **AND** the suite SHALL assert the absent grant by grantee-scoped privilege inspection

#### Scenario: A backdated message does not move a thread backwards
- **WHEN** a message is inserted carrying a `created_at` older than the thread's current
  `last_activity_at`
- **THEN** the column SHALL be unchanged
- **AND** the thread SHALL keep its position

#### Scenario: A refused message records no activity
- **WHEN** the participation gate refuses a message insert
- **THEN** the thread's `last_activity_at` SHALL be unchanged
- **AND** the whole statement SHALL abort

### Requirement: A trigger writing a table with no UPDATE grant and no UPDATE policy SHALL be `security definer`

A trigger function runs as the calling role unless declared otherwise. Both thread tables carry a
table-level SELECT grant to `authenticated`, a column-scoped INSERT grant, and **no UPDATE grant and
no UPDATE policy at all** — so an `UPDATE` issued from a `security invoker` trigger would be refused
twice over.

That refusal is not a skipped bump. The `UPDATE` raises, the enclosing `INSERT` on the message table
aborts, and **every reply in the app stops working**. The failure is total, immediate, and invisible
to the RLS suite, which runs as the table owner.

The function SHALL therefore live in `private`, be `security definer`, be owned by `postgres`, and
carry a pinned `search_path` — matching `private.notify_club_thread_replied`, which already fires
`AFTER INSERT` on `club_messages` for the same structural reason.

Because the function bypasses RLS in its own body, it SHALL restate nothing about audience. It SHALL
address exactly one row, by the primary key taken from `new.thread_id`, and SHALL write exactly one
column. It SHALL make no decision a policy already owns.

#### Scenario: A reply succeeds under the caller's own privileges
- **WHEN** an `authenticated` crew member or club member inserts a message
- **THEN** the insert SHALL succeed and the thread's `last_activity_at` SHALL advance
- **AND** the rider SHALL have needed no grant on the thread table beyond SELECT

#### Scenario: The definer function widens nothing
- **WHEN** the trigger function runs
- **THEN** it SHALL update exactly one thread row, identified by `new.thread_id`
- **AND** it SHALL write only `last_activity_at`, and SHALL contain no audience predicate

#### Scenario: The advisor finding is accounted for
- **WHEN** the migration is applied to a hosted project
- **THEN** the security advisors SHALL be read
- **AND** a new `security definer` function in `private` SHALL be accounted for against the existing
  per-migration accounting rather than left unexplained

### Requirement: An existing thread's activity SHALL be backfilled in the migration that adds the column

The migration SHALL set `last_activity_at` for every existing thread on both tables from that
thread's newest message, falling back to the thread's own `created_at` where it has none.

Without the backfill, every thread already stored on both projects reads as having its creation
instant as its newest activity, so on the first render after the migration every live conversation
in the app collapses back to its start date — the exact defect the newest-activity decision was made
to prevent, applied to the entire existing corpus at once, and silently: the column would be
correctly typed, correctly defaulted, and wrong for every row.

The backfill SHALL be part of the same migration file as the column, so no deploy window exists in
which the column is present and unpopulated.

#### Scenario: An existing busy thread keeps its position through the migration
- **WHEN** `116` is applied to a project holding threads with messages
- **THEN** each thread's `last_activity_at` SHALL equal its newest message's `created_at`
- **AND** the timeline's first render after the migration SHALL show the same ordering a correct
  derived computation would have shown

#### Scenario: An existing thread with no messages is unmoved
- **WHEN** the migration is applied to a thread that has never been replied to
- **THEN** its `last_activity_at` SHALL equal its `created_at`

#### Scenario: The column is never observable as unpopulated
- **WHEN** the migration runs
- **THEN** the column, its default, its backfill and its constraint SHALL be in one file
- **AND** no client SHALL be able to read a `null` or a default-only value for an existing thread

### Requirement: An announcement thread SHALL be stamped uniformly, and its exclusion SHALL stay in the READ

The trigger SHALL NOT special-case `club_threads.introduces_user_id`. An announcement thread's
`last_activity_at` SHALL be maintained exactly like any other thread's, and simply never read for
ordering, because `getClubThreads` and `getClubThreadReplies` exclude the marker **in the query**
before ordering — PD-372's fix, which SHALL be preserved unchanged.

A trigger that skipped announcements would put a presentation rule in the database. It would also be
wrong the day `097`'s marker is NULLed when the subject leaves the club: the thread would become an
ordinary timeline thread carrying a `last_activity_at` frozen at its creation, sorting into a
position nothing in the schema explains.

The exclusion SHALL remain a presentation filter and SHALL NOT be read as an audience rule. A
non-member reads zero rows from `081` with or without it.

#### Scenario: An announcement thread is stamped but not listed
- **WHEN** a rider replies to a club introduction's announcement thread
- **THEN** that thread's `last_activity_at` SHALL advance
- **AND** it SHALL NOT appear as a thread entry on the club's timeline, because the read excludes it

#### Scenario: A former announcement sorts correctly if its marker is cleared
- **WHEN** `introduces_user_id` is NULLed on a thread that has been replied to
- **THEN** the thread SHALL appear at its newest activity
- **AND** SHALL NOT appear at its creation date, because the column was maintained all along

#### Scenario: The exclusion stays in the query
- **WHEN** the thread source is read
- **THEN** the marker filter SHALL be applied inside the query, before the bound and the ordering
- **AND** SHALL NOT be applied after the read, which would break the source's saturation signal

### Requirement: A deleted message SHALL NOT un-bump its thread

`last_activity_at` SHALL be maintained on INSERT only. No trigger SHALL recompute it on DELETE.

This is a decision, not an omission. Recomputing on delete costs a scan of the thread's messages per
moderation action, on the path a moderator uses, and the activity being erased **did happen** — the
thread's position records that the conversation was alive, not that a particular message survives.
A thread whose only reply is removed SHALL keep its bumped position until its next real message.

#### Scenario: A moderated message leaves the position standing
- **WHEN** a message is erased by its author or removed through the moderation RPC
- **THEN** the thread's `last_activity_at` SHALL be unchanged
- **AND** no scan of the thread's messages SHALL be performed

#### Scenario: A deleted thread takes its column with it
- **WHEN** a thread row is deleted
- **THEN** its `last_activity_at` SHALL go with it, by ordinary row deletion
- **AND** no orphaned activity record SHALL remain anywhere
