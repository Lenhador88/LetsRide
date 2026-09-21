<!--
COORDINATION — checked 2026-09-08:

    grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive

`One picker SHALL exist, and this change SHALL extend it rather than fork it` **IS claimed by another
active change** — `inline-place-search-with-recent-starts`, which holds its own MODIFIED block on it
and is unarchived. An earlier draft of this header said the opposite; the command above lists both.
The requirement lives in `ride-start-location` because PD-114 wrote it there, and it is a rule about
the shared `ui/` primitive rather than about rides — so a club change extending that primitive
modifies it here rather than restating it in a club capability.

**ARCHIVE ORDER IS LOAD-BEARING, and this is the failure it prevents.**
`inline-place-search-with-recent-starts` renames *The clubs form is unaffected* to *The clubs form
stores exactly what it stored before* and adds *There is one lookup surface in the app*. A MODIFIED
block replaces a requirement's scenarios wholesale, so if this change is written against
`openspec/specs/`'s two-scenario text and archived AFTER that one, it silently reverts both — a
rename and a whole scenario, with nothing failing anywhere.

**So this block is composed against `inline-place-search-with-recent-starts`'s version, not against
`openspec/specs/`**, and it carries all three of that change's scenarios forward.

**ONE ORDER IS SAFE, and an earlier draft of this paragraph claimed both were.** Measured: the
baseline in `openspec/specs/` holds 2 scenarios, `inline-place-search-with-recent-starts` holds 3,
this change holds 5.

- **`inline-place-search-with-recent-starts` FIRST, then this change** — safe. Its 3 land, then
  this block replaces them with the same 3 plus 2 more.
- **This change first** — **loses two scenarios.** The sibling's block would then replace wholesale
  with its 3, dropping *A third caller extends the picker* and *The seed is optional and its absence
  changes nothing*. It cannot "restate them itself": it was written before they existed.

Archive the sibling first, or fold this block's two added scenarios into it before archiving either.

**Scenario diff** (`docs/HANDOFF.md` — a stale MODIFIED block drops scenarios wholesale): 3 in from
`inline-place-search-with-recent-starts`, 5 out. All three kept under their **current** names —
*The clubs form stores exactly what it stored before*, *Rides pass their own names and bound*,
*There is one lookup surface in the app*. Two added: *A third caller extends the picker*, *The seed
is optional and its absence changes nothing*. Nothing dropped.

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

#### Scenario: The clubs form stores exactly what it stored before
- **WHEN** a club is created or edited after the change
- **THEN** its location SHALL be written from the same four hidden fields under the same names, all
  four together or all four NULL
- **AND** no typed text SHALL reach `clubs.location_name` without the pick that goes with it
- **AND** the seeded search term SHALL be no exception: it lands in the draft, which place mode never
  submits, so a rider who focuses the field and walks away SHALL store nothing

#### Scenario: Rides pass their own names and bound
- **WHEN** the field is used on a ride form
- **THEN** it SHALL write the ride's own column names and SHALL bound the label at
  `rides.meeting_point`'s 120 characters, not the club's 200

#### Scenario: There is one lookup surface in the app
- **WHEN** any form in the app needs a place
- **THEN** it SHALL use this field
- **AND** no second search surface, sheet or screen SHALL exist for places

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
