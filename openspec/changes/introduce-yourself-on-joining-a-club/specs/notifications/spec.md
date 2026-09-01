## ADDED Requirements

### Requirement: This change SHALL add no notification type, and the resulting silence SHALL be stated rather than discovered

No notification type is added, no fan-out trigger is hung, and neither notification CHECK constraint
is widened. Writing an introduction produces exactly the notifications the join already produced —
the club's owner and its admins learn that a rider joined, subject to the default club's existing
carve-out — and nothing more.

**Commenting on an introduction therefore notifies nobody, including the rider being welcomed.**
That is not a gap this change opens: no notification type in this schema fires on a message in a
club thread, so every reply to every thread is already silent. It SHALL be recorded here because an
introduction is the one thread whose author is waiting for an answer, and because the next reader
will otherwise treat the silence as a defect in this change rather than as the standing behaviour
of club threads.

#### Scenario: The type set is unchanged
- **WHEN** this change is applied
- **THEN** the set of permitted notification types SHALL be identical to the set before it
- **AND** the subject-shape constraint SHALL be unchanged

#### Scenario: An introduction adds no notification to a join
- **WHEN** a rider joins a club and then introduces themselves
- **THEN** the notifications written SHALL be exactly those the join wrote
- **AND** no recipient SHALL receive a second row

#### Scenario: Comments are silent, for everyone
- **WHEN** three members comment on a rider's introduction
- **THEN** no notification SHALL be written to the subject or to anybody else
- **AND** no push notification SHALL be sent

### Requirement: A future reply notification SHALL be designed as a fan-out, not bolted onto an introduction

Should a notification for comments be wanted, it SHALL be specified as a club-thread reply fan-out
and SHALL apply to every thread, not only to introductions. A rule that notifies the author of one
kind of thread and not another would be a visibility decision embedded in a copy string.

Such a change SHALL answer the recipient set, the collapse rule, the retraction on delete, the
block arm at fan-out as well as at read, and the ordering constraint a new type places on the
client's exhaustive switches — every one of which is an existing requirement of this capability and
of event fan-out integrity.

#### Scenario: An introduction is not privileged over other threads
- **WHEN** a reply notification is added in a later change
- **THEN** it SHALL treat an introduction as an ordinary thread
- **AND** no notification type SHALL exist that fires only for introductions
