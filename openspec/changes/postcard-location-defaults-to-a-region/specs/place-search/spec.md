# place-search (delta)

## ADDED Requirements

### Requirement: The two callers SHALL ask the vendor different questions from one proxy

`buildAutocompleteUrl` sends no `type` parameter at all today, so a ride's meeting point and a
postcard's Region receive the same undifferentiated result list. The request SHALL carry a
**criteria** discriminator naming which caller is asking, and the proxy SHALL translate it into
the vendor's own parameters.

The **component, the proxy, the `place_search_attempts` ledger and all three of `069`'s ceilings
SHALL be reused unchanged.** Only the query differs. No second Edge Function, no second ledger, no
second rate limit, and no second `PlaceSearchField`.

#### Scenario: A ride meeting point stays findable and specific
- **WHEN** a ride organizer searches for a meeting point
- **THEN** the request SHALL admit specific features — a café, a car park, a street address
- **AND** nothing findable before this change SHALL stop being findable

#### Scenario: A postcard Region asks for something coarse
- **WHEN** a rider searches in the postcard composer's location field
- **THEN** the request SHALL ask for coarse, evocative places — a range, a valley, a pass, a
  river, a town — rather than an address
- **AND** the coordinate carried by whatever is picked SHALL still be rounded to two decimal
  places before it leaves the device

#### Scenario: No caller narrows by country
- **WHEN** either caller issues a search
- **THEN** the request SHALL carry no `countrycode` filter
- **AND** proximity SHALL be applied as a bias only, which reorders rather than excludes, so a
  ride into Belgium or Germany is not answered with "no matches"

#### Scenario: An unknown criteria value fails safe
- **WHEN** the proxy receives a criteria value it does not recognise
- **THEN** it SHALL refuse the request before writing a ledger row, so probing costs no credit
- **AND** the refusal SHALL be distinguishable by the client from a ceiling refusal and from an
  outage

#### Scenario: The ledger still records that a rider searched and never what for
- **WHEN** any search is issued under either criteria
- **THEN** `place_search_attempts` SHALL record one row carrying the rider and a server-stamped
  time and no search term
- **AND** the criteria discriminator SHALL NOT be stored, since it narrows what a rider was
  looking for

#### Scenario: One ceiling covers both callers
- **WHEN** a rider spends lookups across the ride composer and the postcard composer
- **THEN** both SHALL count against the same per-rider hourly and daily ceilings and the same
  application-wide ceiling
- **AND** a refusal in either surface SHALL render the ceiling states the surface already
  distinguishes

### Requirement: The postcard criteria value SHALL NOT be chosen without a measurement

Whether natural features — mountain ranges, rivers, valleys, passes — are reachable through a
`type` or filter on the vendor's geocoding autocomplete, or require the separate Places endpoint
with categories, is **UNVERIFIED**. `*.geoapify.com` is egress-blocked from the build container,
so no session has issued the request that would settle it.

The split SHALL therefore ship as structure. The ride caller's value SHALL reproduce today's
request exactly. The postcard caller's value SHALL be filled in from a measurement taken outside
this container.

#### Scenario: The ride path is a no-op until the measurement lands
- **WHEN** the criteria split is implemented and the research task is still open
- **THEN** the ride caller's request SHALL be byte-identical to the request it issues today
- **AND** any regression in ride search SHALL therefore be attributable to something other than
  this change

#### Scenario: An unmeasured filter is not shipped to riders
- **WHEN** a candidate postcard criteria value has not been exercised against the live vendor
- **THEN** it SHALL NOT be enabled on a path riders reach
- **AND** the constant expressing it SHALL be labelled measured, documentation-derived or assumed,
  matching every other constant in `shape.ts`

### Requirement: The reverse endpoint's coarseness SHALL be treated as unconfirmed until it is measured

`type=city` is asked for on the reverse endpoint and has never been observed being honoured. A
`type` the vendor ignores returns a well-shaped feature whose label is the nearest **address**,
which the composer would write into its field.

While the middle mode was opt-in, the mitigations were that the value is visible before posting
and that the mode is not the default. **The second mitigation is removed by this change.** The
parameter SHALL be confirmed by content against a redeployed function, and until it is, the
visibility guarantee in `photo-capture-metadata` is the only thing standing.

#### Scenario: The rider can always see and override an auto-filled value
- **WHEN** the reverse lookup returns a label of any granularity
- **THEN** it SHALL be rendered in an editable field before the postcard can be posted
- **AND** clearing it SHALL leave the row with no place name

#### Scenario: The confirmation is by content, not by a moved hash
- **WHEN** `search-places` is redeployed
- **THEN** the reverse mode SHALL be exercised against a known coordinate and the returned
  granularity recorded
- **AND** an equal or moved `ezbr_sha256` SHALL NOT by itself be read as confirmation
