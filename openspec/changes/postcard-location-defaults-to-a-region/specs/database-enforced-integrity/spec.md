# database-enforced-integrity (delta)

## ADDED Requirements

### Requirement: A `'country'` location SHALL be a legal, coordinate-free shape and SHALL be enforced as one

`taken_location_precision` SHALL admit `'country'` alongside `'place'`, `'precise'` and the legacy
`'region'`. `postcards_taken_location_coupling` SHALL express the shape rather than leave it to the
client, because the client owns the mutation path and a rule that only reaches a Zod schema is
advisory.

The `'country'` shape is: the marker set, `taken_country_code` set, `taken_place_name` NULL,
`taken_latitude` NULL and `taken_longitude` NULL.

#### Scenario: A country with no name is accepted
- **WHEN** a rider inserts a postcard with `taken_location_precision = 'country'` and a valid
  `taken_country_code`, and no place name and no coordinate
- **THEN** the insert SHALL succeed

#### Scenario: A country marker with a coordinate is refused
- **WHEN** any client inserts a row with `taken_location_precision = 'country'` and a non-NULL
  latitude or longitude
- **THEN** the write SHALL be rejected by a CHECK constraint
- **AND** the rejection SHALL come from the database, not from a client-side validator

#### Scenario: A country marker with a place name is refused
- **WHEN** any client inserts a row with `taken_location_precision = 'country'` and a non-NULL
  `taken_place_name`
- **THEN** the write SHALL be rejected, because a named place is the `'place'` shape and one row
  SHALL NOT carry two disclosure levels

#### Scenario: A country marker with no country code is refused
- **WHEN** any client inserts a row with `taken_location_precision = 'country'` and
  `taken_country_code` NULL
- **THEN** the write SHALL be rejected, because the marker would name a disclosure the row does
  not carry

#### Scenario: The coupling remains NULL-safe
- **WHEN** any arm of the coupling tests `taken_location_precision`
- **THEN** it SHALL use `is not distinct from` rather than `=`
- **AND** a row whose marker is NULL and whose coordinate is set SHALL be refused, this being the
  defect `073` corrected and the one a rewritten constraint most easily reintroduces

#### Scenario: Range bounds survive the rewrite
- **WHEN** any arm of the coupling admits a coordinate
- **THEN** it SHALL carry latitude within [-90, 90] and longitude within [-180, 180]

#### Scenario: The legacy marker keeps its arm
- **WHEN** a row carrying `taken_location_precision = 'region'` is read or updated
- **THEN** it SHALL remain legal
- **AND** no statement in this change SHALL rewrite, backfill or delete such a row

### Requirement: The coarseness rule SHALL name every marker it does not cover

`postcards_coarse_location_is_rounded` enforces two-decimal-place storage for `'region'` and
`'place'` and deliberately exempts `'precise'`. A marker mentioned in neither list escapes the
rule silently.

`'country'` SHALL either be named by the rounding constraint or be proven coordinate-free by the
coupling. It SHALL NOT be absent from both.

#### Scenario: No marker escapes both constraints
- **WHEN** the constraint set is read back after this change
- **THEN** every value legal in `taken_location_precision` SHALL be reachable in exactly one of:
  named by the rounding constraint, exempted by it deliberately, or forbidden a coordinate by the
  coupling

#### Scenario: A patched client cannot publish a front door labelled as a region
- **WHEN** a hand-rolled request sends an unrounded coordinate under `'place'` or `'region'`
- **THEN** the write SHALL be rejected
- **AND** the predicate SHALL continue to ask whether the stored value *is* at two decimal places,
  never whether it equals the database's own rounding of some original, because the two languages
  disagree on halfway cases

### Requirement: No new write verb SHALL reach a postcard's location

`authenticated` holds UPDATE on `postcards` over exactly `caption`, `club_id` and `image_path` —
measured on DEV 2026-08-27, unmoved through `072`, `073` and `074`, each of which re-issued the
INSERT and SELECT lists. The remedy for a mis-published location is deleting the postcard.

No migration in this change SHALL issue an UPDATE grant or revoke on `postcards`.

#### Scenario: The location columns stay insert-only
- **WHEN** the column privileges are read back after this change
- **THEN** `has_column_privilege('authenticated', 'public.postcards', <any location column>,
  'UPDATE')` SHALL be false for every one of them
- **AND** the UPDATE list SHALL still read exactly `caption, club_id, image_path`

#### Scenario: A re-grant does not silently revert a shipped decision
- **WHEN** any absolute INSERT or SELECT grant list is issued
- **THEN** `ride_id` SHALL be present on INSERT and absent from SELECT, per `062`
- **AND** `taken_place_id` SHALL appear in no list in any verb, per `073`

#### Scenario: `anon` reaches nothing
- **WHEN** the privileges are read back
- **THEN** `anon` SHALL hold zero column privileges on `postcards` in any verb
- **AND** no policy on the table SHALL target `anon` or `PUBLIC`

### Requirement: A country-only postcard SHALL be renderable, or the constraint that forbade it SHALL stay

`postcards_taken_country_code_needs_a_place` exists because `PostcardCard` draws the flag
immediately before the town and never on its own, so a country with no name is a value nothing can
render. Dropping it without changing the card reintroduces that state instead of removing it.

The migration dropping the constraint and the client change drawing a flag alone SHALL ship
together.

#### Scenario: A flag draws without a town
- **WHEN** a postcard carries `taken_country_code` and no `taken_place_name`
- **THEN** the card SHALL draw the country
- **AND** the decorative glyph SHALL carry the same accessible-name treatment the flag has today,
  so a screen reader announces the country rather than nothing

#### Scenario: The country code format rule survives
- **WHEN** any client writes `taken_country_code`
- **THEN** it SHALL match `^[A-Z]{2}$` or be NULL
- **AND** the uppercase rule SHALL continue to be enforced by the database rather than by the
  client that produces it

## MODIFIED Requirements

### Requirement: A postcard's location SHALL disclose no more than its marker claims

`064`'s central property, restated because a `Country` mode is precisely where somebody reaches
for "store the precise value and hide it". There SHALL be exactly **one** coordinate pair on
`postcards`, and `taken_location_precision` SHALL say whose it is.

A second pair — the photo's beside the place's — SHALL NOT be added. RLS is row-level, so any
reader of the row reads every column of it, and a "do not show this one" flag would put the exact
spot on the server for every postcard whose rider chose a coarser mode.

A device position obtained from an explicit rider action SHALL NOT be written under `'precise'`,
because that reader rounds to two decimal places before returning and the exact marker would then
name a value that is not exact.

#### Scenario: One coordinate pair, always
- **WHEN** the table definition is read back after this change
- **THEN** `postcards` SHALL carry exactly one latitude column and one longitude column
- **AND** no column SHALL exist whose purpose is to hold a finer value than the marker admits

#### Scenario: A blunted position is never stored as exact
- **WHEN** a coordinate that has been rounded before reaching the composer is applied
- **THEN** it SHALL be written under a coarse marker
- **AND** SHALL NOT be written under `'precise'`, whose contract is the camera's own fix with
  every digit kept

#### Scenario: No provider id returns
- **WHEN** any place — picked, reverse-geocoded or offered as a landmark candidate — is stored
- **THEN** no provider identifier SHALL be written to `postcards`
- **AND** no foreign key to any place table SHALL be added, there being no such table since `070`
