## MODIFIED Requirements

### Requirement: The app SHALL NOT raise a permission sheet or a question sheet without a rider gesture

No timer, effect, route transition, mount or remount SHALL open the location priming sheet or the
town question sheet, or raise the OS location dialog. Every opening SHALL originate in a rider's
tap on a visible control.

This **reverses PD-419's** *"at Explore, once, automatically, ever"*, and the reversal is deliberate.
The accepted cost is fewer device grants: some riders granted only because a sheet appeared, and
those grants are given up in exchange for an app that never raises a permission sheet unasked. A
later change re-introducing an automatic open is making a new decision against this requirement, not
restoring an oversight.

What PD-419 built and this requirement KEEPS: the town rung itself, the `blocked` sheet's *Set your
town* primary, and the town question for a platform with no geolocation.

#### Scenario: A screen that draws the row opens nothing by itself
- **WHEN** a rider lands on any screen carrying the question row, in any state, and does not touch it
- **THEN** no sheet SHALL open, at any delay
- **AND** this SHALL hold across a remount, a tab change and a return to the screen

#### Scenario: No component may reach the OS dialog without a gesture
- **WHEN** the device permission dialog is raised
- **THEN** the call SHALL be traceable to a rider's tap on either the priming sheet's primary
  action or the town question's *Use my current location*
- **AND** no other module SHALL call the requesting API, which a test SHALL enforce by listing
  its callers

## ADDED Requirements

### Requirement: The town question SHALL offer to fill the town from the device, and a refusal SHALL cost nothing

Wherever the app asks for a town (the onboarding town step and `TownQuestionSheet`), it SHALL
offer a secondary *Use my current location* control beneath the typeahead. The typeahead SHALL stay
the primary path and SHALL stay sufficient on its own.

A tap SHALL request one device fix, reverse-geocode it to a town, and place that town in the field
as a pick the rider can still change. It SHALL NOT submit, save or write anything; Continue or Save
stays the rider's action.

#### Scenario: Granted, and the town resolves
- **WHEN** the rider taps the control, grants, and the reverse geocode names a town
- **THEN** the field SHALL show that town as a pick, carrying its country code
- **AND** nothing SHALL be written until the rider presses Continue or Save

#### Scenario: Denied, or anything that cannot be told apart from a denial
- **WHEN** the tap ends with no fix and the permission does not then read `granted`
- **THEN** the control SHALL disappear with no message and no suggestion to retry in-app
- **AND** the typeahead and the country fallback SHALL behave exactly as they did before the tap

#### Scenario: The fix or the name never arrives
- **WHEN** the permission reads `granted` but no fix arrives, the reverse geocode fails, or
  `search-places`' ceiling is spent
- **THEN** the control SHALL return to idle with one non-error status line inviting the rider to
  type the town
- **AND** a coordinate the app cannot name SHALL NOT be stored as a town

#### Scenario: Nothing answers at all
- **WHEN** 20 seconds pass after the tap with no outcome
- **THEN** the control SHALL be released to idle with the same status line
- **AND** a town that arrives later SHALL still be placed in the field, provided the rider has not
  touched the field since the tap

#### Scenario: The rider answers first
- **WHEN** the rider types, taps or picks in the field while the lookup is in flight
- **THEN** the lookup's late answer SHALL be dropped and SHALL NOT replace the rider's own answer

#### Scenario: A grant clears the dismissal, and the save refreshes the position
- **WHEN** the tap returns a fix
- **THEN** the question row's dismissal record SHALL be cleared, exactly as `LocationQuestionRow`'s
  own grant does
- **AND** the rider-location cache key SHALL NOT be invalidated by the tap. On Explore the sheet
  belongs to the question row, and a refresh answering from the new fix hides the row, and the
  sheet with it, before the town lands. The town's save invalidates it instead

#### Scenario: It never submits the step
- **WHEN** the control is tapped on the onboarding step, inside the step's form
- **THEN** the form SHALL NOT submit

#### Scenario: No geolocation, or already denied
- **WHEN** the device has no geolocation, or the permission already reads `denied`
- **THEN** the control SHALL NOT render

#### Scenario: The prerender pass and the walk
- **WHEN** the step is server-rendered, or walked by a headless browser that never taps the control
- **THEN** no permission read or request SHALL run during render
- **AND** the step SHALL complete by typing a town exactly as it did before
