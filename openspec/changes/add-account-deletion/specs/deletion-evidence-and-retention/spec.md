## Purpose

Erasure and evidence pull in opposite directions, and this is where that is settled rather than
discovered. `012` argues that `terms_accepted_at` is legal evidence and that "evidence a party can
rewrite is not evidence". GDPR Art. 17 gives the subject a right to have it erased. Art. 17(3)(e)
preserves what is needed to defend legal claims. All three are true at once.

This capability also carries the rule that stops the next table from repeating the problem: a
retention window is stated when personal data is first stored, not when someone asks for it back.

## ADDED Requirements

### Requirement: The consent record SHALL be erased with the rider, with at most a de-identified trace retained

`profiles.terms_accepted_at` SHALL be destroyed with the `profiles` row. If any trace is retained
for the defence of legal claims, it SHALL NOT identify the subject by inspection.

#### Scenario: The identifiable consent record does not survive
- **WHEN** a rider deletes their account
- **THEN** `terms_accepted_at`, `onboarding_completed_at` and every other column of their
  `profiles` row SHALL be gone
- **AND** no copy of them keyed to an email, a username or a raw uuid SHALL remain anywhere

#### Scenario: A retained trace carries no identifier
- **WHEN** a `consent_records` row is retained
- **THEN** it SHALL hold a salted one-way hash of the subject's uuid, the terms version and the
  server timestamp, and nothing else
- **AND** it SHALL hold no email, username, IP address, device identifier or free text
- **AND** the salt SHALL live with the Edge Function, never in the database or the repository

#### Scenario: No rider can read the retained trace
- **WHEN** any signed-in rider queries for consent records, their own included
- **THEN** zero rows SHALL be returned
- **AND** `authenticated` SHALL hold no grant on the table and the table SHALL have RLS enabled
  with no policy, so the refusal does not depend on a policy being written correctly

#### Scenario: The trace cannot be used to re-identify by enumeration
- **WHEN** someone holding the table attempts to match rows to riders
- **THEN** the salt SHALL make that infeasible without the function's secret
- **AND** the table SHALL NOT be joined to any other table, in a query or a view

#### Scenario: Retaining nothing is a supported outcome
- **WHEN** the product owner decides no trace is needed
- **THEN** the table SHALL simply not exist and the flow SHALL be unchanged
- **AND** nothing in the deletion path SHALL depend on it having been written

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

#### Scenario: No audit row identifies the departed rider
- **WHEN** a deletion completes
- **THEN** no table SHALL gain a row naming the deleted account, its email, its username or its
  uuid
- **AND** an audit trail of the people who asked to have no record is itself a record of them

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
