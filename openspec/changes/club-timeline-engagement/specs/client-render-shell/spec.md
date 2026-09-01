## ADDED Requirements

### Requirement: A decoration on a list SHALL NOT gate the list, and its failure SHALL cost marks rather than rows

Where a screen enriches rows it has already fetched with a second, smaller read — a wave count, an
unread map, a like state — the enrichment SHALL be a decoration and SHALL NOT become a
prerequisite:

| State | Behaviour |
|---|---|
| Empty | zero decorations render as **absence**, never as `0`. A row of zeroes on every entry is noise that makes the first real value harder to see |
| Loading | the rows render immediately with the decoration's control disabled and no value. The list SHALL NOT be gated on the decoration read, nor on `isLoading` |
| Error | **marks, not rows** — the rows render undecorated and no error state is shown for the list. `getClubThreadUnread`'s existing behaviour of resolving to `{}` is the model |
| Offline | the decoration renders from cache when there is one and is absent when there is not. A **write** to it SHALL NOT be queued: a reaction is an expression at a moment, and replaying it on reconnect makes the app act for the rider later, possibly after they have blocked its subject |
| Permission denied | the control SHALL be **absent**, not disabled and not erroring. The write policy's predicate is the read policy's, so a row the rider can see is one they can act on and the case is empty by construction. A refusal SHALL NOT be rendered as a message naming a block |
| Partial | one decoration read failing SHALL NOT affect another. Two kinds of subject decorate independently |
| Stale | read on load, no subscription. The rider's own toggle is optimistic and locally authoritative until the write answers; another rider's arrives on the next load |

#### Scenario: A failed decoration read never blanks the list
- **WHEN** the decoration read errors and the list read succeeded
- **THEN** every row SHALL render
- **AND** no error state, retry affordance or skeleton SHALL replace the list

#### Scenario: The list is not gated on the decoration
- **WHEN** the list read has resolved and the decoration read has not
- **THEN** the rows SHALL be on screen
- **AND** the decoration's control SHALL be present and disabled rather than absent, so the row's
  height does not change when the value arrives

#### Scenario: A zero decoration draws nothing
- **WHEN** a row has no reactions
- **THEN** no numeral SHALL be drawn
- **AND** the arrival of the first one SHALL NOT shift the controls beside it under a rider's thumb

### Requirement: An optimistic control SHALL state what it is, and SHALL NOT be queued when the write fails

A two-state reaction toggle SHALL follow `LikeButton`'s established rules rather than being
re-derived:

- **`aria-pressed` is the non-visual signal**, and the accessible name is therefore **constant** —
  it states what the control is, never what the next tap does. A control that both reports
  `pressed` and renames itself to the undo action announces "Unwave, 5 waves, pressed": a control
  named for undoing, reported as done.
- **A refused write rolls the local state back and surfaces its message without reflowing the
  row**, so a failed tap cannot move the controls beside it.
- **Nothing is retried or queued.**

Where the same behaviour is now needed on more than one surface it SHALL be **extracted**, not
copied. Two optimistic toggles with two copies of the rollback and the `aria-pressed` rule is two
places for the accessibility rule to be dropped from, and the second copy is always the one written
in a hurry.

#### Scenario: The accessible name does not flip
- **WHEN** a rider waves and un-waves
- **THEN** the control's accessible name SHALL be unchanged in both states
- **AND** `aria-pressed` SHALL be the only thing that moves

#### Scenario: A refused write does not move the row
- **WHEN** a wave write is refused
- **THEN** the toggle SHALL revert and a message SHALL appear without changing the row's height
- **AND** no retry SHALL be scheduled

#### Scenario: The toggle exists once
- **WHEN** the change is complete
- **THEN** the postcard's and the timeline's toggles SHALL share one implementation
- **AND** the rollback and `aria-pressed` rules SHALL exist in exactly one place
