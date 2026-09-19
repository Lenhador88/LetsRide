## Purpose

Erasure and evidence pull in opposite directions, and this is where that is settled rather than
discovered. `012` argues that `terms_accepted_at` is legal evidence and that "evidence a party can
rewrite is not evidence". GDPR Art. 17 gives the subject a right to have it erased. Art. 17(3)(e)
preserves what is needed to defend legal claims. All three are true at once.

This capability also carries the rule that stops the next table from repeating the problem: a
retention window is stated when personal data is first stored, not when someone asks for it back.

**Settled 2026-09-18 (PD-458): a de-identified record is kept.** The app gates content writes on
the acceptance (`023`), so it is an assertion the product actively relies on and today's deletion
erases the only proof of it. What is kept carries **no subject identifier at all** — not a uuid
and not a hash of one, because the id space is enumerable from `auth.users` and a hash of an
enumerable identifier is the identifier. The cost of that choice is named in the requirement
rather than left to be discovered: the record can no longer answer one named claimant.

## ADDED Requirements

### Requirement: The consent record SHALL be erased with the rider, and what is retained SHALL carry no subject identifier

`profiles.terms_accepted_at` SHALL be destroyed with the `profiles` row. A de-identified trace
SHALL be retained for the defence of legal claims, and it SHALL hold nothing that identifies the
subject — including nothing derived from an identifier.

**Decided by the product owner 2026-09-18, against this capability's own earlier
recommendation.** That recommendation was a salted one-way hash of the subject's uuid, and it is
refused: the id space is enumerable from `auth.users`, so a hash of it is a lookup table away
from being the id.

#### Scenario: The identifiable consent record does not survive
- **WHEN** a rider deletes their account
- **THEN** `terms_accepted_at`, `onboarding_completed_at` and every other column of their
  `profiles` row SHALL be gone
- **AND** no copy of them keyed to an email, a username or a raw uuid SHALL remain anywhere

#### Scenario: A retained trace carries no identifier and no derivative of one
- **WHEN** a retention row is written
- **THEN** it SHALL hold the terms version and the acceptance date, and nothing else
- **AND** it SHALL hold no uuid, email, username, IP address, device identifier or free text
- **AND** it SHALL hold **no hash, salted or otherwise, of any of them** — a hash of an
  identifier drawn from an enumerable space SHALL be treated as the identifier
- **AND** it SHALL carry **no creation timestamp**, which is the trap: a `default now()` records
  the deletion moment at full precision under a name that reads like bookkeeping
- **AND** any key it carries SHALL carry no order — a random uuid is permitted, a sequence is
  another deletion clock

#### Scenario: The trace cannot answer a named claimant, and that is the accepted trade
- **WHEN** one person disputes that they accepted the terms
- **THEN** the retained rows SHALL NOT be able to confirm or refute their specific claim
- **AND** what the retention SHALL establish is that a consent to a stated version existed on a
  stated day
- **AND** this SHALL be recorded as a deliberate trade with its cost named, not as a property
  nobody noticed — it was the whole purpose of the identifier this requirement now refuses, and
  it is reversible by one migration that adds a column the existing rows simply do not have

#### Scenario: The retained count is not itself a re-identification path
- **WHEN** the retention rows are read alongside `auth.users` at small volumes
- **THEN** the acceptance time SHALL have been coarsened to a day, and no deletion time SHALL have
  been retained at all
- **AND** the reasoning SHALL be recorded with its residual: a day bucket holding one deletion is
  still a narrow bracket, so the coarsening is not what carries this — the absence of a deletion
  timestamp and of any reader is

#### Scenario: No client can read the retained trace
- **WHEN** any signed-in rider queries for retention rows, their own included
- **THEN** the read SHALL be refused
- **AND** `authenticated` and `anon` SHALL hold no grant of any kind on the table, asserted per
  grantee
- **AND** the table SHALL have RLS enabled **with no policy at all**, so the refusal does not
  depend on a policy being written correctly
- **AND** it SHALL appear in no view, no `security definer` accessor's projection and no join

#### Scenario: The bypass credential cannot enumerate the trace either
- **WHEN** `service_role` — the one credential that bypasses RLS — queries the table
- **THEN** the read SHALL be refused, and the decision SHALL be made explicitly rather than
  inherited from a default
- **AND** the judgement SHALL be recorded as being about the rows: their de-identification holds
  only while nobody can order them, and `xmin` and `ctid` are an insertion-order oracle for
  anyone holding SELECT, against which no coarsening of a stored date survives
- **AND** the refusal SHALL rest on the **absent table grant**, never on RLS or a policy, because
  that credential bypasses both
- **AND** where the table lives SHALL decide the mechanism and SHALL be stated either way: a
  table in `private` never receives the grants, since Supabase sets its default privileges on
  `public` — so it is outside `CLAUDE.md`'s keep-or-revoke rule rather than an exception to it —
  while a table in `public` needs an explicit revoke, becomes one more revoked table in that
  rule's count, and adds one INFO advisor that SHALL be recorded as chosen
- **AND** RLS SHALL be enabled in the same migration regardless, as belt and braces rather than
  as the barrier
- **AND** the refusal SHALL cost nothing operationally, because the writer is a database-owned
  trigger rather than the service-role credential and nothing in the app reads the table

#### Scenario: The row count is the one disclosure accepted
- **WHEN** someone who can reach the table counts its rows
- **THEN** they SHALL learn how many accounts have been deleted
- **AND** that SHALL be accepted as not being personal data about any of them, which is only true
  while no row carries a subject, an order or a time other than the acceptance day

#### Scenario: The trace is written by the deletion itself, not by a step that can be skipped
- **WHEN** a `profiles` row is deleted by the cascade from `auth.users`
- **THEN** a row-level `before delete` trigger on `public.profiles` SHALL write the retention row
  in the same transaction
- **AND** it SHALL NOT be a step in the Edge Function, so no deletion path can bypass it and the
  function's verified re-authentication proof is not disturbed
- **AND** it SHALL NOT be a foreign key from the retention row to `profiles` cleared on delete,
  because that leaves the subject id in the table for the whole life of the account

#### Scenario: The trigger SHALL NOT be able to cancel the deletion it records
- **WHEN** the trigger function runs, on any path including an early return
- **THEN** it SHALL return the old row
- **AND** returning NULL SHALL be understood to **cancel** the delete silently: the `auth.users`
  row is removed, the `profiles` row survives, nothing is raised, and the rider is told the
  deletion succeeded — which is `012` §KNOWN LIMIT's orphan state reached by a new route
- **AND** the verification SHALL assert that the `profiles` row is gone, not only that the
  retention row arrived, because the second passes while the first is false

#### Scenario: A rider who consented to nothing leaves no row
- **WHEN** a rider whose `terms_accepted_at` is NULL deletes their account
- **THEN** no retention row SHALL be written
- **AND** a row recording "unknown consent at an unknown time" SHALL NOT be written instead: it is
  a countable event with no evidentiary content, it inflates the count the date was coarsened to
  protect, and it is the fabricated record the no-backfill ruling already refuses

#### Scenario: A consent whose version is unknown still leaves a row
- **WHEN** a rider whose `terms_accepted_at` is set carries a NULL `terms_version` — the rows the
  version column was deliberately not backfilled onto
- **THEN** a retention row SHALL be written with a NULL version
- **AND** NULL SHALL keep the meaning it already has on the profile — the consent predates the
  column and its version is genuinely unknown — rather than being given a second meaning by
  omission

#### Scenario: The trigger fires on real deletions and on nothing else
- **WHEN** anything other than the deletion of a `profiles` row occurs — an update, an insert, a
  failed deletion, a rolled-back transaction
- **THEN** no retention row SHALL exist afterwards
- **AND** the one mechanism that removes rows without firing a row-level delete trigger,
  `TRUNCATE`, SHALL be out of every client's reach, asserted per grantee rather than cited
- **AND** direct deletion of a `profiles` row SHALL also be out of every client's reach, so the
  cascade is the only path into this trigger

#### Scenario: A retried deletion writes no second row
- **WHEN** a deletion is retried after it has already completed
- **THEN** exactly one retention row SHALL exist for it
- **AND** the reason SHALL be that the event is the deletion of the row and there is no row left
  to delete — not a dedupe key, since a table with no subject identifier has nothing to dedupe on

#### Scenario: The retention window is stated even though the rows are not personal data
- **WHEN** the table is created
- **THEN** its migration SHALL state how long the rows are kept and why, as this capability
  requires of every table
- **AND** "indefinitely, because the rows identify nobody and the retention exists to outlive the
  claim it may have to answer" SHALL be an acceptable window, while a blank field SHALL NOT

### Requirement: A consent record SHALL name the terms it consented to

`profiles` SHALL carry the version of the terms accepted, alongside the timestamp.

`012` made the *time* of consent immutable and server-owned and did not notice that nothing
records *what* was consented to. `/legal/terms` changes without leaving a trace, so today's
evidence is "this rider accepted something, at this time" — which is the weak evidence `012` set
out to prevent, one column across.

#### Scenario: The version is stored with the acceptance
- **WHEN** a rider accepts the terms
- **THEN** the stored record SHALL carry both the server timestamp and the version identifier of
  the document shown

#### Scenario: The version is not client-chosen
- **WHEN** a client submits a version string of its own
- **THEN** the stored value SHALL be the server's, in the same shape `012` already uses to discard
  a client-supplied timestamp
- **AND** the rule SHALL live in the database, not only in a Zod schema, per `CLAUDE.md`'s rule
  that no new integrity rule may live only in a Zod schema

#### Scenario: The version is immutable once written
- **WHEN** any rider attempts to change their own recorded version
- **THEN** the write SHALL be silently reverted, exactly as `012` treats the timestamp
- **AND** accepting a *new* version SHALL be a new acceptance, not an edit of the old one

#### Scenario: Riders with no consent record are not backfilled
- **WHEN** this column is added to a database whose riders have NULL consent stamps
- **THEN** no migration SHALL write a version or a timestamp on any rider's behalf
- **AND** this SHALL follow the ruling already recorded for `023`: a fabricated consent record is
  worse than a missing one

### Requirement: The username SHALL be released immediately and SHALL NOT be reserved

The departed rider's username SHALL become available to other riders at once, and no table MUST
retain it for a reservation, cooling-off period or tombstone byline.

`profiles.username` is UNIQUE. When the row goes, the name is free.

#### Scenario: The name becomes available at once
- **WHEN** a rider deletes their account
- **THEN** their username SHALL be immediately available to any other rider
- **AND** no reservation table, tombstone row or cooling-off period SHALL retain it, because that
  is retention of an identifier of an erased account

#### Scenario: Another rider taking the name inherits nothing
- **WHEN** a different rider claims the released username
- **THEN** they SHALL receive no content, memberships, RSVPs, likes or blocks from the previous
  holder
- **AND** no historical text SHALL be rewritten to point at them — captions and comments are plain
  text with no mention model, so a written `@name` refers to nobody

#### Scenario: The impersonation risk is stated rather than mitigated by retention
- **WHEN** a released username is claimed by someone else
- **THEN** other riders SHALL have no signal that the holder changed
- **AND** this SHALL be an accepted, recorded consequence of immediate release, revisited only if
  a mention or identity feature makes it material

### Requirement: Moderation records SHALL follow the rider who created them

A `postcard_reports` row SHALL be removed with the rider who filed it, and no report MUST be
retained naming an account that no longer exists.

#### Scenario: Reports the departing rider filed are removed
- **WHEN** a rider who had filed `postcard_reports` deletes their account
- **THEN** those reports SHALL be removed with them
- **AND** nothing SHALL be lost operationally, because no admin role exists to triage them —
  `011` records that as a KNOWN GAP

#### Scenario: Reports filed against the departing rider's content go with the content
- **WHEN** the postcards a rider authored are removed
- **THEN** the reports attached to them SHALL be removed by the existing cascade
- **AND** no report SHALL be retained naming an account that no longer exists

#### Scenario: A future moderation role does not silently change this
- **WHEN** an admin or moderator role is introduced
- **THEN** whether reports outlive their reporter SHALL be re-decided explicitly at that point
- **AND** the default until then SHALL remain removal, so that no evidence store accumulates that
  nobody has authorised

### Requirement: Any table holding personal data SHALL state its retention window when it is created

A retention window SHALL be part of the migration that introduces personal data, not a decision
deferred to the first erasure request.

This requirement exists because of one specific thing on the roadmap. Background location
tracking is the stated reason for the native build (`CLAUDE.md` §Technology Decisions), and a GPS
track with no expiry is a permanent record of where a person was, minute by minute.

#### Scenario: A location track table cannot be created without a window
- **WHEN** a migration introduces location tracks
- **THEN** it SHALL state a retention window in its header, SHALL implement expiry, and SHALL
  state what deletion does to tracks
- **AND** a track SHALL be removed by a rider's account deletion like any other personal data

#### Scenario: A track that has outlived its window is not merely hidden
- **WHEN** a track passes its retention window
- **THEN** its rows SHALL be removed, not filtered from a view
- **AND** the removal SHALL not depend on a policy predicate, because a hidden row is a retained
  row

#### Scenario: Deletion of a rider who shared a ride with others removes only their own track
- **WHEN** a rider whose track overlaps a group ride deletes their account
- **THEN** only their own track SHALL be removed
- **AND** no other rider's track SHALL be altered, even where the two records describe the same
  journey

#### Scenario: The rule applies to tables not yet imagined
- **WHEN** any future table stores anything about an identifiable rider — chat messages, push
  tokens, device identifiers, analytics events
- **THEN** its migration SHALL name its retention window and its behaviour under account deletion
- **AND** a migration that does neither SHALL be treated as incomplete

### Requirement: The deletion itself SHALL NOT create a record of who deleted their account

No table, log line or metric MUST identify a deleted account. Aggregate counts carrying no
subject SHALL be permitted.

**The consent retention row is the one row a deletion writes, and it is not an exception to
this.** It names nobody, carries nothing about the deletion — no time, no id, no key — and is
readable by no credential in the system. It is a record of a consent, which happens to survive a
deletion, rather than a record of a deletion. The distinction is load-bearing and the scenarios
below hold it: a second per-deletion row that carried an identifier or a deletion timestamp would
be the audit trail this requirement refuses, whatever it was called.

#### Scenario: No audit row identifies the departed rider
- **WHEN** a deletion completes
- **THEN** no table SHALL gain a row naming the deleted account, its email, its username or its
  uuid
- **AND** an audit trail of the people who asked to have no record is itself a record of them
- **AND** the consent retention row SHALL NOT be widened to carry a subject, a deletion time or a
  reason, since each of those turns it into exactly that trail

#### Scenario: Operational logging carries no subject
- **WHEN** the Edge Function logs the outcome of a deletion
- **THEN** the log line SHALL carry a correlation identifier and a result, and no account
  identifier
- **AND** the same SHALL hold for any error path, where an identifier is most likely to be
  included for debugging

#### Scenario: Counting deletions is permitted
- **WHEN** the product owner wants to know how many accounts were deleted
- **THEN** an aggregate with no subject SHALL be acceptable
- **AND** it SHALL NOT be derived from a per-deletion record retained for the purpose
- **AND** the consent retention rows SHALL NOT become that source by being counted: they are
  retained as evidence of consent, no credential in the system can read them, and reaching for
  them as a deletion metric is what would make their number matter
