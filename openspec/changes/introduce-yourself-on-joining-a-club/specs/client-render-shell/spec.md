## ADDED Requirements

### Requirement: The introduction prompt SHALL define every state, and SHALL never be the only way out of a screen

The prompt is a sheet over the club it belongs to. Its states:

| State | Behaviour |
|---|---|
| **Not owed** | Absent. No flash, no placeholder, and no read issued for a rider the rule already excludes |
| **Deciding** | The read that decides whether one is owed has not answered. The sheet SHALL NOT open, and the club behind it SHALL render normally |
| **Open** | The welcome sentence, the input, a submit and a way out. Submit SHALL be inert until the rule for the chosen arm is satisfied |
| **Submitting** | Submit shows pending; the input SHALL NOT be cleared and SHALL NOT be disabled in a way that loses what was typed |
| **Failed** | The message stays in the input, the error is shown against it, and the sheet stays open so the rider can retry. The rider SHALL be told the **introduction** failed and SHALL NOT be told the join failed |
| **Offline** | Submit SHALL be refused with an offline message and the text SHALL be preserved. The write SHALL NOT be queued for later — there is no write queue in this app and inventing one here would post an introduction into a club minutes or hours after the rider stopped expecting it |
| **Done** | The sheet closes, the join row gains its count, and no confirmation screen is interposed |

**A rider SHALL always be able to reach the club behind the sheet.** Whatever is chosen for the
mandatory question, a rider who is already a member and cannot complete the write SHALL NOT be held
in a modal — a dropped connection would otherwise lock them out of a club they have joined.

#### Scenario: A failed introduction does not read as a failed join
- **WHEN** the introduction write fails
- **THEN** the message SHALL say the introduction was not posted
- **AND** it SHALL NOT suggest the rider is not a member

#### Scenario: The typed text survives every failure
- **WHEN** the write fails, or the rider is offline
- **THEN** the text SHALL still be in the input

#### Scenario: The sheet is never a trap
- **WHEN** the write cannot succeed for any reason
- **THEN** the rider SHALL be able to dismiss the sheet and use the club

### Requirement: A count that describes rows the viewer cannot read SHALL be absent, not zero

A join row's comment count summarises a thread. Where the viewer cannot read that thread — a
non-member of a public club, a rider blocked by the subject, a rider who has left — the count SHALL
be **absent** along with its icon and its link, and SHALL NOT be rendered as `0`.

Zero and not-allowed are identical from the client, and rendering the second as the first would
assert that a conversation with no comments exists to somebody who may not know it exists at all.
Absent is also what a genuine zero draws, so the two remain indistinguishable to the viewer — which
is the intended outcome, and different from telling them a number.

#### Scenario: Permission-denied is drawn as absent
- **WHEN** a viewer cannot read the introduction thread
- **THEN** the join row SHALL draw no comment icon, no number and no link

#### Scenario: A genuine zero draws the same
- **WHEN** an introduction exists that the viewer can read and nobody has commented
- **THEN** the row SHALL draw no count
- **AND** tapping the row SHALL still open the thread

#### Scenario: The decoration never gates the row
- **WHEN** the read that supplies introductions fails entirely
- **THEN** every join row SHALL still render its sentence, its time and its wave
- **AND** the failure SHALL cost the doors, not the rows
</content>
