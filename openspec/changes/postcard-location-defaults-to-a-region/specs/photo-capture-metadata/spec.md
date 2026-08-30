# photo-capture-metadata (delta)

## ADDED Requirements

### Requirement: The composer SHALL offer exactly three location modes — Country, Region, Precise

`Hide` SHALL be removed from the control, from `PhotoLocationMode` and from
`resolvePhotoLocation`'s branch table. `Region` SHALL be the mode the composer opens on, replacing
`DEFAULT_PHOTO_LOCATION_MODE = 'hide'`.

Removing the button SHALL NOT remove the all-NULL row: a photo carrying no fix, with a rider who
names nothing, SHALL still write no location at all, under any selected mode. See `design.md` D2.

#### Scenario: The composer opens on Region
- **WHEN** a rider opens the postcard composer and selects a photo
- **THEN** `Region` SHALL be the selected mode
- **AND** no mode SHALL be remembered from a previous upload
- **AND** swapping the photo SHALL return the control to `Region`, not to the mode the previous
  photo used

#### Scenario: There is no control that publishes nothing for a photo that carries a fix
- **WHEN** a rider selects a photo that carries an EXIF fix
- **THEN** the composer SHALL offer no affordance producing an all-NULL location row
- **AND** the copy under the control SHALL state, for the selected mode, exactly what will be
  stored

#### Scenario: A photo with no fix and no named place still stores nothing
- **WHEN** a rider selects a photo with no EXIF fix, leaves the place field empty, and posts
- **THEN** the row SHALL carry NULL in `taken_location_precision`, `taken_place_name`,
  `taken_country_code`, `taken_latitude` and `taken_longitude`
- **AND** this SHALL be true whichever of the three modes was selected
- **AND** the copy SHALL say nothing is being saved, rather than describing a value the row will
  not hold

#### Scenario: A viewer cannot tell a chosen absence from an unavailable one
- **WHEN** any viewer reads a postcard whose location columns are all NULL
- **THEN** nothing in the row, the API response or the rendered card SHALL distinguish "the rider
  declined" from "the photo knew nothing"
- **AND** no column, flag or marker SHALL be added that would make that distinction, because the
  distinction is itself a disclosure

### Requirement: An auto-filled place SHALL be town-level and SHALL be visible before it is published

The reverse lookup SHALL continue to request `type=city`, so a value the app fills in on the
rider's behalf can never be a street. The resolved place SHALL be rendered on the composer, in a
control the rider can edit or clear, **before** the postcard can be posted.

The location control SHALL NOT be placed behind a "more options" disclosure, an accordion, a
second screen, or any affordance a rider can post without opening.

#### Scenario: The prefilled value is on screen before Post is reachable
- **WHEN** the reverse lookup resolves a place for the selected photo
- **THEN** that place SHALL be rendered in the composer's own location field
- **AND** the rider SHALL be able to edit or clear it before posting
- **AND** the mode buttons and the resolved place SHALL be visible without expanding anything

#### Scenario: A street never reaches the field automatically
- **WHEN** the app fills the location field from the photo's coordinate
- **THEN** the request SHALL carry `type=city`
- **AND** no client-side step SHALL attempt to re-coarsen a name that comes back finer, because a
  name cannot be re-coarsened

#### Scenario: The rider still owns what is typed
- **WHEN** a rider types a place name and never picks one from the list
- **THEN** that name SHALL be stored with no coordinate, exactly as today
- **AND** the typeahead SHALL remain an accelerator rather than a gate

### Requirement: A photo carrying a fix SHALL be offered candidates, and the app SHALL NOT choose between them

When the photo carries an EXIF fix, the composer SHALL offer two or three candidate places — the
town, plus one or more nearby named natural features where the vendor returns them — and the rider
SHALL pick. The app SHALL NOT rank candidates by remarkability, prominence, popularity or any
vendor relevance signal, and SHALL NOT auto-select one.

The vendor's own ordering SHALL be the order presented, matching `search-places`' existing rule
that the proxy does not re-rank.

#### Scenario: Candidates are offered, not applied
- **WHEN** the reverse lookup returns more than one candidate for the photo's coordinate
- **THEN** the composer SHALL present them for the rider to choose between
- **AND** no candidate SHALL be written into the stored row until the rider selects it

#### Scenario: One candidate behaves as today
- **WHEN** the lookup returns exactly one candidate
- **THEN** it SHALL be presented in the editable field, as the prefill already is
- **AND** the rider SHALL still be able to clear or replace it

#### Scenario: Candidates cost one lookup
- **WHEN** the composer requests candidates for a photo
- **THEN** it SHALL issue at most one metered request per photo
- **AND** it SHALL NOT re-issue that request on a re-render, a remount, or a keystroke
- **AND** a rider action SHALL be required to ask again

### Requirement: A "Load current location" action SHALL read a device position and nothing else

An action SHALL sit beside the Location label. It SHALL assert nothing until tapped.

It SHALL read a **device** position only. It SHALL NOT fall through `resolveRiderLocation()`'s
best-available chain, whose second source is the rider's geocoded onboarding city — writing that
under a label promising the rider's current position would publish their home town. The existing
`requestDeviceLocation()` SHALL be the reader; no second device resolver SHALL be written.

#### Scenario: The home town is never published under this label
- **WHEN** a rider taps "Load current location" and the device returns no position
- **THEN** nothing SHALL be drawn and nothing SHALL be written
- **AND** the rider's `profiles.location`, its geocoded centroid, and any cached
  `RiderLocation` whose `source` is `'profile'` SHALL NOT reach the composer's location field

#### Scenario: It fires only on a tap
- **WHEN** the composer renders, mounts, receives a photo, or the upload settles
- **THEN** no device position SHALL be requested
- **AND** no OS permission dialog SHALL be capable of appearing as a result

#### Scenario: A tap may spend the one permission prompt
- **WHEN** a rider taps the action on a device whose permission state is `prompt`
- **THEN** the OS permission dialog MAY appear, because the tap is the rider asking
- **AND** the priming sheet's explanatory copy SHALL be shown first, this being the state
  `locationPrimingState`'s `ask` answer exists for

#### Scenario: A device that already refused routes to the denied copy
- **WHEN** a rider taps the action on a device whose permission state is `denied`
- **THEN** the priming sheet's **denied** copy SHALL be shown — what is lost, and where to switch
  it back on
- **AND** no call SHALL be made that depends on a prompt appearing, because on iOS the refusal is
  one-way from inside the app

#### Scenario: A device with no geolocation draws no action
- **WHEN** the platform reports `unavailable`
- **THEN** the action SHALL NOT be drawn, there being nothing to offer

#### Scenario: The action does not feed Precise
- **WHEN** a position loaded by this action is applied
- **THEN** it SHALL be applied under the `Country` or `Region` marker only
- **AND** it SHALL NOT be written under `'precise'`, because `requestDeviceLocation()` rounds to
  two decimal places and a ~1 km value stored under the exact marker is a coordinate the database
  calls exact and is not

#### Scenario: No recency gate
- **WHEN** the action succeeds
- **THEN** the value SHALL be accepted regardless of when the photo was taken
- **AND** the copy SHALL describe it as the rider's current location, never as where the photo was
  taken

### Requirement: A refused or unavailable lookup SHALL be a visible state, not a silent empty field

`reverseGeocodePlace` degrades every failure to `null` today, which was correct while the lookup
filled a field the rider had not asked for. Once the lookup runs on the default path, and once the
rider taps an action, a refusal SHALL be reported.

The states already distinguished for the place typeahead SHALL be distinguished here: a per-rider
hourly ceiling, a per-rider daily ceiling, the application-wide ceiling reading as *unavailable*
with a retry affordance, an offline device naming the device, and a below-minimum input.

#### Scenario: A ceiling refusal is explained
- **WHEN** a lookup is refused because the rider has spent their `069` allowance
- **THEN** the composer SHALL say so, and SHALL distinguish "wait an hour" from "wait until
  tomorrow"
- **AND** the rider SHALL still be able to type a place name, that path costing no lookup

#### Scenario: The application-wide ceiling is not the rider's fault
- **WHEN** the application-wide ceiling refuses the lookup
- **THEN** the message SHALL read as unavailable rather than as the rider's own limit
- **AND** a retry SHALL be an explicit tap, never armed on a timer

#### Scenario: A silent empty field is not an acceptable outcome of a tap
- **WHEN** a rider taps "Load current location" and the lookup fails for any reason
- **THEN** the composer SHALL report that it could not resolve a name
- **AND** SHALL NOT leave the field empty with no explanation

## MODIFIED Requirements

### Requirement: The composer's copy SHALL describe the row that will actually be written

`resolveLocationCopy` computes its sentence from `resolvePhotoLocation`'s own resolved
`precision`, so the hidden inputs and the sentence cannot disagree. That contract SHALL survive
this change and SHALL be extended to every new state, and the tripwire test SHALL cover each.

The states requiring their own sentence now include: `Country` with a country resolved; `Country`
with nothing resolved; `Region` with an empty field; `Region` with a typed name and no pin;
`Precise` with a photo fix; `Precise` with a picked place and no photo fix; `Precise` with
neither; and a position loaded by the "Load current location" action under each mode that accepts
one.

#### Scenario: A mode with nothing to store says so
- **WHEN** a mode is selected and the resolved location is empty
- **THEN** the copy SHALL say nothing is being saved yet
- **AND** SHALL NOT assert that a country, a place or an exact spot is stored

#### Scenario: Country copy does not promise a name
- **WHEN** `Country` is selected and a country is resolved
- **THEN** the copy SHALL describe a country and SHALL NOT describe a town, a region or a place
  name
- **AND** SHALL state the audience as the postcard's own, since RLS is row-level and every reader
  of the row reads it

#### Scenario: The copy is scoped to what LetsRide stores
- **WHEN** any mode's copy is rendered
- **THEN** it SHALL make a promise about what this app stores, never about what a third party
  logs, and never about the photo's capture time, which is uploaded whatever the location mode
  says

## REMOVED Requirements

### Requirement: The composer SHALL offer a Hide mode that stores no location

**Reason:** Product owner decision, 2026-08-27. The default becomes `Region` and the floor becomes
`Country`. The objection — that `Country` is unavailable for a fixless photo, and that the change
ends the property that no geocoder is contacted until the rider asks — was raised, reaffirmed and
is recorded once in `proposal.md`.

**Migration:** No data migration. The all-NULL row that `Hide` produced remains legal and remains
the outcome for a photo with no fix and no named place — `design.md` D2. No stored row changes and
nothing is backfilled.
