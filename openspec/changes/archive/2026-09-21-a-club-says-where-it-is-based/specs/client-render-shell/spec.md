<!--
COORDINATION — checked 2026-09-08:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

The requirement below is ADDED and is claimed by nothing. `Every screen SHALL have a defined
first-paint state` is claimed by several active changes and is deliberately NOT modified here: this
requirement is about a form's *refusal and pre-fill* behaviour, which that one does not cover, and a
second MODIFIED block on a widely-claimed requirement is how scenarios get dropped.

`onboarding-takes-a-town-and-its-country` (PD-445) is the sibling change in this slot. The two touch
`PlaceSearchField` from opposite sides — that change adds no prop and this one adds one — and neither
blocks the other. The contrast between the two forms' submit-disabling is stated in both, because a
later session finding them different will otherwise "fix" one.
-->

## ADDED Requirements

### Requirement: A newly-required form field SHALL refuse in the shape the form already refuses, and its pre-fill SHALL NOT manufacture an answer

Where a change makes an existing optional field required, the refusal SHALL use the mechanism that
form already uses for its other required fields, and any pre-fill SHALL leave the rider's answer
unmade until the rider makes it.

`CreateClubForm`'s location field is the case, and both halves have a wrong-looking-correct
alternative.

**The refusal is schema-and-focus, not a disabled submit.** The form's header records the disabled
submit as tried and reverted — *"a disabled submit here read as the resting state of an untouched
form and left the tab order early"* — on a form with six controls. The onboarding town step does the
opposite, correctly, because it has one control and one question. Two screens in one change doing
opposite things is only safe if the reason is written down.

**The pre-fill is a search term, never a value.** A rider's resolved position cannot become a pick:
`RiderLocation` is `{ lat, lon, source }` and a `PlaceValue` needs a `name` and a `placeId` too, so
any seeded *value* would be fabricated. Seeding the *term* on first focus keeps the rider's pick the
rider's, spends no metered credit for a rider who never touches the field, and never displays text a
submit would not store.

#### Scenario: Submitting with no location
- **WHEN** the rider submits the create-club form having picked no place
- **THEN** the action SHALL refuse before any write, with the message **"Pick where your club is
  based."**, and no `clubs` row SHALL be inserted
- **AND** the submit button SHALL NOT have been disabled — it stays gated on `busy` alone, as it is
  today
- **AND** focus SHALL move to the **visible search input**, which requires the form to reach past the
  hidden `location_name` field; a refusal whose focus move silently does nothing SHALL be treated as
  a defect rather than as acceptable

#### Scenario: A place typed and never picked
- **WHEN** the rider types a place name, does not choose a suggestion, and submits
- **THEN** the submit SHALL be refused with the same message, and nothing SHALL be stored
- **AND** the four hidden fields SHALL be empty, because in place mode they read through the pick and
  the visible input carries no `name`
- **AND** the typed draft SHALL revert on blur, so the rider is never shown a location a submit would
  not store

#### Scenario: A partial set of hidden fields
- **WHEN** fewer than all four of `location_name`, `location_place_id`, `latitude` and `longitude`
  arrive
- **THEN** `readClubLocation` SHALL return `null` — not a partial object and not an error — and the
  create gate SHALL then refuse it with the same message
- **AND** the emptiness test SHALL stay on the **string**, never on the parsed number, because
  `Number('')` is `0` and `0` is a real coordinate
- **AND** the new gate SHALL NOT be implemented as a truthiness test on a coordinate, which would
  refuse a genuine club on the equator or the prime meridian

#### Scenario: The pre-fill when the rider has a town
- **WHEN** the rider's `profiles.location` holds a town and they focus the location field for the
  first time
- **THEN** that town SHALL become the input's text and the lookup's term, and the suggestion list
  SHALL open on real results the rider can pick from
- **AND** no lookup SHALL have been performed before that focus, because a lookup spends a metered
  credit whose ledger row is written before the vendor is called
- **AND** the rider SHALL still have to pick; no value SHALL be selected on their behalf

#### Scenario: The pre-fill when there is nothing to seed
- **WHEN** the rider has no `profiles.location`, or the read has not settled, or they have declined
  device location
- **THEN** the field SHALL behave exactly as it does today — empty, no seed, no lookup — and the form
  SHALL be fully usable
- **AND** the pre-fill SHALL NOT fall back to a device fix, SHALL NOT raise an OS permission prompt,
  and SHALL NOT perform an IP lookup

#### Scenario: The seed never becomes a stored answer
- **WHEN** a rider focuses the field, sees the seeded term, and blurs without picking
- **THEN** the field SHALL be empty, because the draft is dropped on blur — which is the truth about
  their answer rather than a loss of one
- **AND** the submit SHALL be refused if they then submit, exactly as if they had never focused it

#### Scenario: Editing a club is untouched
- **WHEN** a club owner edits a club that carries no location, changing only its name
- **THEN** the edit SHALL succeed, no location SHALL be required, and the field SHALL carry no
  refusal
- **AND** an owner adding a location on edit SHALL still be able to, through the same field and the
  same four names
