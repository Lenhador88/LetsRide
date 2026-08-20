## Purpose

**Delta note.** `photo-capture-metadata` is not yet a standing capability: it exists at
`openspec/changes/capture-photo-time-and-place/specs/photo-capture-metadata/spec.md`, whose change
is shipped (`064` applied to both projects) and unarchived. Every `MODIFIED` requirement below
names the requirement it replaces in that file. Nothing in `064`'s spec that is not named here is
touched — in particular the capture-time requirements, the read-before-compression ordering, and
"the mode decides what is UPLOADED, not what is displayed" all stand unchanged.

## MODIFIED Requirements

### Requirement: The composer SHALL offer a location control whether or not the photo carries one

*Replaces "A photo with no location SHALL say so, and SHALL NOT present a disabled control."*

The `Location` block SHALL render on the composer at all times — its label, a location input, and
the mode control — regardless of whether a photo has been chosen and regardless of whether that
photo carried a coordinate.

The input SHALL be prefilled from the photo's own location where that is possible, and SHALL
otherwise be empty and typeable, with the same place lookup the ride composer uses.

A photo with no coordinate is the ordinary case, not the edge — HEIC, screenshots and anything
through another app's share sheet carry nothing — and under the previous requirement those riders
were shown the sentence "This photo has no location" and given no way to say where they were.

#### Scenario: No photo chosen yet
- **WHEN** the composer first renders, before any file is picked
- **THEN** the `Location` label, the location input and the mode control SHALL all be present
- **AND** the input SHALL be empty and typeable
- **AND** the submit control SHALL remain disabled, because a postcard still requires a photo

#### Scenario: A photo with no coordinate
- **WHEN** the chosen photo carried no GPS EXIF
- **THEN** the input SHALL be empty and typeable
- **AND** no sentence SHALL be shown telling the rider the photo has no location, because the
  rider can now supply one

#### Scenario: A rider names a place with no photo and cannot post
- **WHEN** a rider types a place and has chosen no photo
- **THEN** the form SHALL NOT be submittable, so no postcard can exist carrying a location and no
  image

### Requirement: The middle mode SHALL be a named place, and its stored coordinate SHALL be coarse

*Replaces "Region SHALL round the photo's coordinate to 2 decimal places in the browser."*

The middle mode SHALL store the place the rider has named — its name, and where one is available
its coordinate — and SHALL NOT store any coordinate derived from the photo, nor any provider
identifier for the place. A provider id resolves back to the picked feature's exact geometry, so it
would return the precision the rounding below exists to remove.

The coordinate stored under the middle mode SHALL be rounded to 2 decimal places before the
request is built, whatever its origin.

Rounding is retained for a reason that has changed rather than for continuity: it is what allows
the database to refuse a precise coordinate wearing a coarse marker, and under the new model that
coordinate would arrive carrying a place name that actively misdescribes it.

#### Scenario: The named place is what is stored
- **WHEN** a rider selects the middle mode with a place named in the input
- **THEN** the request SHALL carry that place's name
- **AND** SHALL carry its coordinate rounded to 2 decimal places, where the place was picked or
  resolved rather than typed
- **AND** SHALL carry no provider identifier, whatever produced the place
- **AND** SHALL carry the marker for a named place

#### Scenario: The photo's coordinate does not travel under the middle mode
- **WHEN** the middle mode is selected and the photo carried a coordinate
- **THEN** no value derived from that coordinate SHALL appear in the request, at any precision,
  in any field, other than a place name resolved from its rounded form

#### Scenario: A typed place with no pin
- **WHEN** a rider types a place name and never picks a suggestion
- **THEN** the request SHALL carry the name and the marker, with no coordinate
- **AND** the postcard SHALL be created successfully

#### Scenario: A picked place more specific than a town
- **WHEN** a rider picks a suggestion that is a street or a building rather than a locality
- **THEN** the stored coordinate SHALL still be rounded to 2 decimal places
- **AND** the stored name SHALL be the name the rider picked, because it is their own statement
  about their own postcard

### Requirement: The mode hints SHALL name no distance and no ride

*Replaces the three hint strings in "The composer's Location block SHALL state what each mode
does."*

The hint under the mode control SHALL be a single set of strings, independent of the postcard's
audience and of whether it is tagged to a ride.

The previous middle hint — "Enough to place it on the ride." — is false for every postcard this
composer creates: the composer has no ride field and the action reads no ride id, so `ride_id` is
NULL on every row it writes. A hint that tracked the audience select would be a second source of
truth for a value the rider can change after the hint has rendered.

#### Scenario: The strings
- **WHEN** each mode is selected
- **THEN** the hint SHALL carry a lead clause, emphasised, and a sentence naming what a reader of
  the postcard would learn:
  - Hide — that nothing is stored
  - the named-place mode — that the words are the rider's own and the exact spot is not stored
  - Precise — that a reader can see where the photo was taken, or, where the coordinate came from
    a picked place rather than the photo, that the place is exact and the photo's own spot is not
    what was stored

> **AMENDED 2026-08-20 — properties, not transcriptions.** This scenario pinned three exact
> strings and two of them were already stale against the shipped screen when review read it. A
> spec that transcribes copy drifts on the first wording change and reports it as a violation,
> which trains the next reader to ignore it. The strings live in
> `src/components/postcards/locationCopy.ts` and `resolveLocationCopy`'s tests are what hold them;
> what belongs here is the claim each one must make.

#### Scenario: A mode that would store nothing SHALL NOT claim a save
- **WHEN** a saving mode is selected and the request it would build carries no location
- **THEN** the lead clause SHALL state that nothing is saved yet

#### Scenario: The hint does not change with the audience
- **WHEN** the rider switches the audience between the app-wide feed and a club
- **THEN** the hint strings SHALL NOT change

#### Scenario: The middle label
- **WHEN** the mode control renders
- **THEN** the middle segment SHALL NOT be labelled with a unit of distance

> **AMENDED 2026-08-20.** This originally read *SHALL NOT be labelled "Region"*, and the shipped
> label is now `Region`. The requirement was aimed at the WORD standing for a ~1 km cell — the
> thing the rider was being asked to reason about — and `Town` failed the owner's own test within
> a day: a rider in the Pyrenees names a mountain range. `Region` as the name of a place a rider
> chooses is not the rejected reading. The **stored marker** is unaffected and remains `place`;
> `'region'` still means `064`'s rounded coordinate in the column.

## ADDED Requirements

### Requirement: The precise mode SHALL carry an exact coordinate or none

The precise mode SHALL be presented in every state, and the request it builds SHALL carry the
precise marker only alongside a coordinate that is exact for what the rider named.

**Two sources are exact and they are ordered.** The photo's own fix is the first, and where it
exists it is what precise means. Where it does not, a place the rider **picked** from the
typeahead is the second, stored unrounded: the rider named a spot and asked for it exactly.

**A TYPED place is not a source.** It carries no coordinate at all, so a request marking it
precise would assert an exact spot the row does not hold.

Where neither source exists the mode SHALL resolve to the same empty answer as hide, and the
control SHALL say so rather than implying a save.

> **REPLACES, 2026-08-20, the requirement that the precise mode SHALL NOT be offered for a photo
> with no coordinate.** That requirement was written when the only exact coordinate on the screen
> came from the camera, and it removed the control rather than disabling it — sound reasoning
> whose premise stopped holding the moment the product owner posted from an iPad. Every HEIC
> carried no fix (`exif.ts` read JPEG only), so the option was absent for every photo and nothing
> said why; the owner read it as a lost feature and asked for it back. The rejection of a
> *disabled* segment still stands and is untouched. What changed is that there is now a second
> exact source, so the mode has a referent in states where it previously had none.

#### Scenario: Three buttons, always
- **WHEN** the mode control renders, whatever the photo carries
- **THEN** it SHALL present the hide, named-place and precise modes

#### Scenario: A PICKED place may become a precise location
- **WHEN** a rider picks a place from the typeahead for a photo that carried no coordinate, and
  selects precise
- **THEN** the request SHALL carry that place's coordinate unrounded under the precise marker

#### Scenario: A TYPED place cannot become a precise location
- **WHEN** a rider types a name without picking a suggestion, for a photo that carried no
  coordinate, and selects precise
- **THEN** no request SHALL be constructible that carries the precise marker

#### Scenario: Precise with nothing to be precise about
- **WHEN** precise is selected and neither a photo fix nor a picked place exists
- **THEN** the request SHALL carry no location, and the control SHALL state that nothing is saved
  yet and name a mode that would store the rider's text

#### Scenario: The photo's own coordinate is what precise means
- **WHEN** the photo carries a coordinate and the rider selects precise
- **THEN** the request SHALL carry that coordinate unrounded, and the precise marker

### Requirement: Hide SHALL mean nothing is stored, including a place the rider named by hand

Selecting hide SHALL result in a request carrying no location value of any kind — no coordinate,
no place name, no provider id and no marker — even where the rider has typed or picked a place
before selecting it.

Hide means *nothing is stored*, not *nothing from the photo is stored*. A rider who types a town,
reads the hint and then taps hide has declined.

The values SHALL NOT be present in the document as empty fields either. A hidden input is part of
the request whatever its value, and its presence is reachable by a form serialiser, an extension
or a captured DOM — which is the same rule the previous spec applied to the unreduced coordinate,
extended to the name and the id.

#### Scenario: A typed town is not sent under hide
- **WHEN** a rider types a place name and then selects hide
- **THEN** the request SHALL carry no place name, no provider id, no coordinate and no marker
- **AND** the stored row SHALL have all of those columns NULL

#### Scenario: A picked place is not sent under hide
- **WHEN** a rider picks a suggestion and then selects hide
- **THEN** the request SHALL carry none of that place's values

#### Scenario: The fields are absent, not empty
- **WHEN** hide is selected
- **THEN** no form field for a place name, coordinate or marker SHALL exist in the
  composer's document

#### Scenario: The lookup control does not submit on its own
- **WHEN** the location input is used
- **THEN** it SHALL write no form field of its own, and the composer SHALL be the only writer of
  what the request carries, so that the marker and the values it implies are always produced
  together

### Requirement: A location resolved from one photo SHALL NOT survive onto another

Replacing the chosen photo SHALL reset the mode to hide and SHALL clear the location input,
including a name the rider typed themselves.

The existing rule — that a mode chosen for one photo must not be inherited by the next — has the
same force for the location itself: a place resolved from the first photo is a false statement
about the second. A typed name is arguably the rider's to keep, and treating it differently would
require holding "where this name came from" as state; the cost of clearing it is one retype, and
the cost of the alternative is a wrong location silently attached to a photo.

#### Scenario: Swapping the photo clears the location
- **WHEN** a rider chooses a second file after naming a place for the first
- **THEN** the mode SHALL return to hide
- **AND** the location input SHALL be empty

#### Scenario: A failed replacement does not leave a stale location
- **WHEN** the replacement file is refused by validation or its upload fails
- **THEN** the location SHALL still be cleared, because the postcard that would carry it no
  longer exists

### Requirement: A lookup the rider did not ask for SHALL fail silently

Where the composer looks a place up on the rider's behalf — the prefill from a photo — a failure
SHALL leave the input empty and SHALL NOT present an error, a retry affordance or an explanation.

Every failure state is a state in which the rider can simply type the place, which is a
first-class stored value. An error message for an action the rider did not initiate spends their
attention on something they neither asked for nor need.

A lookup the rider *did* initiate — typing in the input — keeps its existing distinct messages for
offline, ceiling and unavailable.

#### Scenario: The prefill cannot reach the lookup
- **WHEN** the device is offline, the lookup is unavailable, the rider's ceiling is spent, or the
  proxy does not support the reverse mode
- **THEN** the input SHALL be empty and typeable
- **AND** no message SHALL be shown about the prefill

#### Scenario: The rider's own search still speaks
- **WHEN** the rider types in the input and that lookup fails
- **THEN** the existing per-state message SHALL be shown, unchanged

#### Scenario: The prefill does not retry
- **WHEN** a prefill has failed for a given photo
- **THEN** it SHALL NOT be retried automatically

### Requirement: Only a coarse coordinate SHALL leave the device for a lookup

The unrounded coordinate read from a photo SHALL leave the device only as part of a write the
rider explicitly chose by selecting the precise mode. No lookup, no search bias, no log and no
diagnostic SHALL carry it.

Where the composer resolves a place from the photo, it SHALL send the coordinate rounded to 2
decimal places.

A town-level answer does not need better than that, so the reduction costs nothing in quality —
and the prefill happens while the mode still reads hide, which is the one state whose whole
meaning is that the rider has not agreed to disclose anything.

#### Scenario: The prefill sends a rounded coordinate
- **WHEN** the composer resolves a place from the photo's coordinate
- **THEN** the value sent SHALL be rounded to 2 decimal places

#### Scenario: Precise does not widen the lookup
- **WHEN** the rider selects the precise mode
- **THEN** the coordinate sent to any lookup SHALL still be the rounded one; only the write
  carries the fix

### Requirement: A prefill SHALL cost at most one lookup per photo

The composer SHALL make at most one place lookup per chosen file, SHALL make none at all for a
photo carrying no coordinate, and SHALL reuse an answer already resolved for the same rounded
coordinate during the same page load.

The rider's allowance is 20 lookups an hour and the ledger row is written before the vendor is
called, so an unasked-for lookup per composed postcard is spendable in a way the rider cannot see.
Twenty postcards in an hour would exhaust the allowance on prefills alone and then refuse the
rider's own typing — including the typing that the failed prefill made necessary.

#### Scenario: No coordinate, no lookup
- **WHEN** the chosen photo carries no coordinate
- **THEN** no lookup SHALL be made

#### Scenario: Several photos from one place cost one lookup
- **WHEN** a rider composes several postcards in one page load from photos whose coordinates round
  to the same 2-decimal-place cell
- **THEN** at most one lookup SHALL be made

#### Scenario: The prefill is not keystroke-driven
- **WHEN** the rider types in the location input
- **THEN** the prefill SHALL NOT fire again, and only the rider's own search SHALL
