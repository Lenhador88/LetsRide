## ADDED Requirements

### Requirement: This change SHALL add no notification type, and the fan-out it makes necessary SHALL be a named successor rather than a silence

No notification type is added by this change, no fan-out trigger is hung, and neither notification
CHECK constraint is widened. Writing an introduction produces exactly the notifications the join
already produced — the club's owner and its admins learn that a rider joined, subject to the default
club's existing carve-out — and nothing more.

**Comments and waves on club threads SHALL be notified, and by a separate change.** That was
decided on 2026-09-01 and it is not this change's work: it needs a thread reference on
`notifications`, a rebuild of the collapse index, two new types, two fan-outs, a retraction and both
exhaustive client switches, and its migration's safe deploy order is the **opposite** of this one's.
Until it lands, a rider who introduces themselves and receives replies is told nothing — which is
how every club thread already behaves, and is a scheduled gap rather than an accepted one.

#### Scenario: The type set is unchanged by this change
- **WHEN** this change is applied
- **THEN** the set of permitted notification types SHALL be identical to the set before it
- **AND** the subject-shape constraint SHALL be unchanged
- **AND** no trigger SHALL be hung on `club_messages` or on any wave table

#### Scenario: An introduction adds no notification to a join
- **WHEN** a rider joins a club and then introduces themselves
- **THEN** the notifications written SHALL be exactly those the join wrote
- **AND** no recipient SHALL receive a second row

#### Scenario: The successor is named, not merely awaited
- **WHEN** this change's artifacts are read
- **THEN** they SHALL name the change that closes the gap and the migration it takes
- **AND** the gap SHALL NOT be described as a permanent property of club threads

### Requirement: A reply or wave notification SHALL be designed as a fan-out over ALL club threads, and SHALL NOT be bolted onto an introduction

The successor SHALL treat an introduction as an ordinary thread. No notification type SHALL exist
that fires only for introductions: a rule that notifies the author of one kind of thread and not
another is a visibility decision embedded in a copy string, and a rider cannot tell which kind of
thread they are looking at.

It SHALL answer the recipient set, the collapse rule, the retraction on delete and on un-wave, the
block arm at fan-out as well as at read, the bound on the recipient set, and the ordering constraint
a new type places on the client's exhaustive switches — every one of which is an existing
requirement of this capability or of event fan-out integrity.

#### Scenario: An introduction is not privileged over other threads
- **WHEN** the reply and wave notifications are added
- **THEN** they SHALL fire for every club thread on the same terms
- **AND** no notification type SHALL exist that fires only for introductions

### Requirement: A notification carrying a thread as its subject SHALL identify that thread, and SHALL NOT be collapsed by club alone

A notification whose subject is a conversation SHALL carry a reference to that conversation. It
SHALL NOT reuse the club reference as a stand-in.

**This is a correctness requirement, not a modelling preference, and it fails silently.** The
collapse index is unique over the recipient, the type, the actor and every subject column together,
with NULLs treated as equal. A thread-subject notification carrying only a club therefore collapses
per `(recipient, type, actor, club)`: the same actor replying in a **second** thread of the same club
produces a conflict, the fan-out's conflict clause discards it, and the recipient is never told —
with no error raised anywhere. Such a notification also cannot address the conversation, so opening
it lands the rider on the club instead of on the thread.

Adding the reference means rebuilding the collapse index. That rebuild SHALL leave every existing
type's collapse unchanged — existing rows hold NULL in the new column and NULLs compare equal — and
SHALL be performed as one statement block so no window exists in which the uniqueness is absent.
Every cascade path into notifications SHALL remain indexed, so the new reference SHALL carry its own
partial index.

#### Scenario: Two threads, one actor, one recipient, two notifications
- **WHEN** one rider replies in two different threads of the same club and both notify the same
  recipient
- **THEN** the recipient SHALL receive two notifications, one per thread

#### Scenario: The rebuild does not change any existing collapse
- **WHEN** the collapse index is rebuilt to include the thread reference
- **THEN** every existing notification type SHALL collapse exactly as it did before
- **AND** no window SHALL exist in which the uniqueness constraint is absent

#### Scenario: The new cascade path is indexed
- **WHEN** the thread reference is added
- **THEN** it SHALL carry an index, like every other cascade path into notifications
