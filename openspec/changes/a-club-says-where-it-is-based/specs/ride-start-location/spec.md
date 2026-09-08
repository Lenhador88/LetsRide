<!--
COORDINATION — checked 2026-09-08:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

`One picker SHALL exist, and this change SHALL extend it rather than fork it` is claimed by no active
change. It lives in `ride-start-location` because PD-114 wrote it there, and it is a rule about the
shared `ui/` primitive rather than about rides — so a club change extending that primitive modifies
it here rather than restating it in a club capability.

**Scenario diff, stated because a stale MODIFIED block drops scenarios wholesale**
(`docs/HANDOFF.md`): 2 scenarios in, 4 out. Both kept, verbatim in intent and unchanged in name:
*The clubs form is unaffected*, *Rides pass their own names and bound*. Two added: *A third caller
extends the picker*, *The seed is optional and its absence changes nothing*. Nothing dropped.

`onboarding-takes-a-town-and-its-country` (PD-445) is the sibling change in this slot and also uses
this picker — as a **fourth caller that adds no prop**. It is named in the added scenario so the two
changes cannot both claim to be the extension.
-->

## MODIFIED Requirements

### Requirement: One picker SHALL exist, and this change SHALL extend it rather than fork it

`src/components/ui/PlaceSearchField.tsx` is the picker, placed in `ui/` by PD-259 precisely so PD-114
would find it. A second picker SHALL NOT be written, and no caller SHALL get a divergent search
sheet.

What rides need on top, and nothing more: an **editable text input** in place of the read-only value
box, so the field is free text with search on top; a search affordance that opens the same sheet; and
the caller's own field names, length bound and required-ness. Clubs' behaviour SHALL be unchanged by
the extension.

**The rule is now symmetric, because the extension has gone the other way.** A caller extending the
picker for its own needs SHALL add optional, additive props whose absence leaves every other caller
byte-identical, and SHALL assert that rather than assume it. A prop that changes default behaviour is
a fork wearing a prop's clothes.

#### Scenario: The clubs form is unaffected
- **WHEN** the rides extension lands
- **THEN** `CreateClubForm` and `EditClubForm` SHALL behave exactly as before, with the same four
  hidden fields under the same names

#### Scenario: Rides pass their own names and bound
- **WHEN** the field is used on a ride form
- **THEN** it SHALL write the ride's own column names and SHALL bound the label at
  `rides.meeting_point`'s 120 characters, not the club's 200

#### Scenario: A third caller extends the picker
- **WHEN** the club form adds an initial-query prop and a handle on the visible input
- **THEN** both SHALL be optional, and every existing caller — both ride forms, the postcard composer,
  `TownQuestionSheet`, `EditClubForm` — SHALL be unchanged with them omitted
- **AND** the ride forms' free-text mode, their recents, their debounce and their abort behaviour
  SHALL be untouched
- **AND** no second picker, no divergent sheet and no club-specific copy of this component SHALL be
  written

#### Scenario: The seed is optional and its absence changes nothing
- **WHEN** the initial-query prop is omitted, or is an empty string, or the field already holds a
  value or a draft, or the field has already been focused once
- **THEN** the field SHALL behave exactly as it does today: no text, no lookup, no list until the
  rider types
- **AND** when the prop IS supplied, the seed SHALL be applied **once, on first focus** — never on
  mount — because a mount-time seed either spends a metered credit for a rider who never touches the
  field, or displays text that a submit would not store and that `onBlur` then erases
- **AND** a fourth caller may use this picker with no new prop at all: the onboarding town step
  (PD-445) does exactly that, in place mode with no `names` and no `freeText`, and SHALL NOT be
  understood as a second extension
