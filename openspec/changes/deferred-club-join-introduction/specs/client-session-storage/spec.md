## ADDED Requirements

### Requirement: A session dismissal SHALL record only a declined introduction, never a declined join

The per-(rider, club) introduction dismissal held in session storage SHALL mean exactly one thing:
*this rider holds a membership of this club and is not introducing themselves right now*. It SHALL
NOT be widened to record that a rider declined to join.

A prompt that can only be opened by an explicit tap SHALL NOT write a dismissal, because it cannot
reappear unbidden and the store exists solely to stop a state-driven prompt reappearing on every
navigation.

No second store, no second key and no dismissal kind SHALL be added for a declined join. A refusal
to join is not a rider preference the app keeps; it is the absence of an action.

**This requirement is the single home of that rule.** What it means for the prompt is
`club-introductions`' *The prompt SHALL NOT be suppressed by anything the rider did while not a
member*, which points here rather than restating this.

The rule SHALL be applied at **every** call site that records a dismissal, not only at the one
whose screen prompted the change. A dismissal is written by each screen that mounts the prompt, so
one unfixed call site reproduces the whole defect on that screen.

#### Scenario: Declining a join stores nothing
- **WHEN** a rider declines a prompt at a moment when they hold no membership of the club
- **THEN** nothing SHALL be written to session storage
- **AND** reading the store afterwards SHALL give the same answer it gave before

#### Scenario: Declining an introduction stores the dismissal
- **WHEN** a rider who holds a membership declines the prompt
- **THEN** the dismissal SHALL be recorded for that rider and club, as it is today
- **AND** it SHALL be cleared on sign-out with every other local trace

#### Scenario: A stored dismissal never suppresses a prompt the rider was not asked
- **WHEN** a rider declines a join and later becomes a member of the same club in the same session
- **THEN** the introduction prompt SHALL be shown
- **AND** no earlier interaction SHALL suppress it
