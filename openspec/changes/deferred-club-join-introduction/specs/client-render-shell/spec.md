## ADDED Requirements

### Requirement: The deferred-join sheet SHALL have a defined state for every point at which it can fail

The sheet writes two things in sequence and either can fail, so it has more states than a form
with one write. Each SHALL be drawn, and none SHALL be inferred from another.

| State | What the rider sees |
|---|---|
| Open, nothing typed | The field with its suggested wording as a placeholder, `Post` inert, the deferral control live |
| Working | Both writes in flight as one action; `Post` shows progress; the sheet cannot be dismissed until it resolves |
| Join failed | An error naming the join; the rider is not a member; the sheet stays open and `Post` may be pressed again |
| Introduction failed after the join landed | A message saying the rider **has joined** and that the introduction did not post; the second control now declines the introduction alone |
| Posted | The sheet closes; the club reads as joined and the introduction exists |
| Deferred | The sheet closes; every screen is exactly as it was before the Join control was tapped |

**Permission-denied and empty are not confusable here**, because the sheet issues no read whose
emptiness would have to be interpreted. It renders from the club data its opener already holds, so
this change adds no screen on which "not allowed" and "nothing there" look the same.

#### Scenario: The working state is drawn
- **WHEN** `Post` is pressed
- **THEN** progress SHALL be shown on the control that was pressed
- **AND** the sheet SHALL NOT close until both writes resolve or one fails

#### Scenario: A join failure is told as a join failure
- **WHEN** the membership write fails
- **THEN** the message SHALL be about joining, not about the introduction
- **AND** the sheet SHALL NOT report success of any kind

#### Scenario: A half-succeeded Post says which half
- **WHEN** the membership write succeeds and the introduction write fails
- **THEN** the rider SHALL be told they joined and that the introduction did not post
- **AND** the two facts SHALL be in one message, so neither can be read alone

### Requirement: Declining a deferred join SHALL leave the screen it was opened from unchanged

Deferring writes nothing, so nothing SHALL move. The list the Join control sits in SHALL NOT
reorder, refetch or re-section; the control SHALL return to its idle label; no error, banner, toast
or empty state SHALL be shown; and no navigation SHALL occur.

#### Scenario: The list does not move
- **WHEN** a rider defers a join from a list of clubs
- **THEN** the club SHALL remain in the same list, in the same section, with its Join control live
- **AND** no refetch SHALL be triggered by the deferral

#### Scenario: The club screen does not change state
- **WHEN** a rider defers a join from a club's own screen
- **THEN** the screen SHALL continue to render as it does for a non-member
- **AND** the Join control SHALL be live again

### Requirement: The deferred-join sheet SHALL define its offline behaviour

Riders lose signal constantly, and this sheet is the one place in the product where losing it
mid-action can leave two writes half-done.

An offline or failed `Post` SHALL be reported as a failure and SHALL NOT be queued, retried
silently, or optimistically shown as success. The sheet SHALL NOT write the membership optimistically:
a join drawn before it is confirmed would show a rider as a member of a club they are not in, on a
screen whose next read contradicts it.

Where the join succeeded and the connection was lost before the introduction resolved, the rider
SHALL be treated as the "joined, no introduction" case: the membership stands and the state-driven
prompt asks again on the next visit.

#### Scenario: Offline is a failure, not a queue
- **WHEN** `Post` is pressed with no connection
- **THEN** the failure SHALL be shown
- **AND** nothing SHALL be queued for later submission

#### Scenario: No optimistic membership
- **WHEN** the membership write has not resolved
- **THEN** no screen SHALL render the rider as a member of that club
