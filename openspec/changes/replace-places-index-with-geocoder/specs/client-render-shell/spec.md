## ADDED Requirements

### Requirement: A surface backed by a third party SHALL distinguish refusal, exhaustion and outage from emptiness

The standing rules already separate *failed* from *empty*, and *offline* from *generic error*. A
metered third-party dependency adds two states neither of those covers, and both look exactly like
zero rows from the client:

- **This rider has been refused for now** — they have used their share, the app has not failed, and
  waiting fixes it.
- **The application has been refused for now** — nothing about this rider's behaviour is relevant, and
  waiting fixes it for reasons they cannot influence.

The two SHALL NOT be collapsed into each other, because one is a fact about the rider and the other is
not, and a message blaming a rider for the application's spending is a message they will act on
wrongly. The second SHALL be presented as unavailability.

Neither SHALL be presented as "nothing matched", which sends the rider to correct a spelling that was
already correct.

A screen carrying such a surface SHALL remain usable in every one of these states: the surface is an
accelerator on a form, and a form SHALL never be blocked by a third party's availability or by a
budget.

#### Scenario: Five zero-row causes render as five different screens
- **WHEN** the surface has nothing to show
- **THEN** it SHALL render the state matching the cause: below the minimum, searching, nothing matched,
  unavailable, or this rider has searched a lot just now
- **AND** the offline case SHALL be reported as offline, per the standing requirement, rather than as
  any of the other four

#### Scenario: The vendor is never named in an error a rider reads
- **WHEN** any of these states renders
- **THEN** it SHALL NOT contain a vendor name, a status code, a quota number, or a retry-after value
- **AND** it SHALL say what the rider can do instead, which is always "type it yourself" where the field
  accepts text

#### Scenario: The form outlives the surface
- **WHEN** the third-party surface is in any failure state
- **THEN** the form it sits on SHALL still submit
- **AND** everything already typed SHALL survive opening, failing and closing the surface
