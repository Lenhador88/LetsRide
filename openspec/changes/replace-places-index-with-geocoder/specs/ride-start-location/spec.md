## MODIFIED Requirements

### Requirement: The search SHALL be answered by a geocoder reached through our own proxy, and no keystroke SHALL reach the vendor from a rider's device

This requirement is the direct reversal of the one it replaces, and the reversal is the whole point
of this change — so it is restated here rather than left to be inferred from a capability that did
not exist when `add-ride-start-location-search` was written.

**Why it is being reversed.** The standing text requires the typeahead to read
`public.search_places()` against the self-hosted Overture extract, and asserts that a rider's
partial typing reaches no external service at any point. That index is Overture's **Places** theme —
businesses and amenities — so a residential street with no registered business on it has no row and
never will. Measured on PROD: `street ilike '%claijstraat%'` returns 0 rows nationally, and
`search_places('Willem Claijstraat Berkhout')` returns nothing for a street that exists in the
Dutch BAG. The requirement is satisfiable and the product is not.

The typeahead SHALL therefore read the vendor through the Edge Function proxy this change adds.

**The half of the old requirement that survives is the half about the device.** A rider's partial
typing SHALL NOT be sent to the vendor *from their device*, at any point, including as a prefetch,
a suggestion or an analytics event: the request SHALL originate from our infrastructure, so the
vendor receives the text and never a rider's IP, identity or session. The key SHALL remain
unreachable from the client bundle.

**What genuinely changes, and SHALL be stated to riders rather than absorbed:** the search term
itself now leaves our infrastructure. That is a rider-facing factual change, and `/legal/privacy`
SHALL be broadened to cover it in the same PR that ships the proxy — not in a follow-up.

#### Scenario: A partial term reaches the vendor only through our own infrastructure
- **WHEN** a rider types into the lookup field
- **THEN** the request SHALL be issued by the Edge Function proxy
- **AND** no request to the vendor SHALL originate from the rider's device
- **AND** the vendor SHALL receive no rider identity, session token or IP

#### Scenario: The search term is never retained on our side
- **WHEN** the proxy handles a lookup
- **THEN** the term SHALL NOT be written to the metering ledger, the function's logs, or analytics

### Requirement: Every signed-in rider MAY search, and the reach SHALL be stated against the proxy rather than against the index

The standing text grants every signed-in rider the right to call `search_places()` and to read the
public places index, on the reasoning that the index is reference data rather than rider data and
that `049` and `050` bound what one call can cost.

Both halves change with the table. There is no index to read, and the cost bound is no longer a
query planner's — it is a per-request bill against a shared daily quota. So the grant SHALL be
restated against the proxy: any signed-in rider who has accepted the terms MAY search, subject to
the per-rider and application-wide ceilings the `place-search` capability defines. Membership,
ownership and club role SHALL NOT change what a rider may search for or what they get back.

#### Scenario: A rider who has not accepted the terms cannot spend a credit
- **WHEN** an account created without accepting the terms calls the proxy
- **THEN** the metering row SHALL be refused by the participation gate
- **AND** no vendor call SHALL be made

### Requirement: The right to keep a coordinate SHALL be stated, and the attribution SHALL name the provider actually used

The standing text states the right to keep a coordinate under Overture's licence and requires the
search sheet to link to the attribution page. The right survives; the licence behind it does not.

Coordinates returned by the vendor SHALL be storable indefinitely, and the basis for that SHALL be
recorded rather than assumed — this change's `design.md` §Open Questions carries it as Q1, and it
SHALL be answered before the proxy serves PROD traffic. The Overture credit SHALL be removed from
`/legal/attributions` in the same PR that drops the table, and the OpenStreetMap credit SHALL
remain and SHALL be broadened to cover search results rather than map tiles alone.

#### Scenario: The attribution page names no contributor that supplied nothing
- **WHEN** the places table is dropped
- **THEN** `/legal/attributions` SHALL no longer credit Overture
- **AND** it SHALL credit the vendor and OpenStreetMap for both tiles and search results

### Requirement: The search surface SHALL define every state it can be in

The standing requirement stands unchanged in intent and SHALL NOT be co-owned by two lists. Its
enumeration was written against a database-backed search and cannot describe a metered one — it has
no ceiling state and no vendor-outage state.

The authoritative enumeration SHALL be the `place-search` capability's, which this change adds and
which carries seven states including both rider ceilings and the application-wide one. This
requirement SHALL defer to it rather than restate it, so that a state added later is added in one
place.

#### Scenario: One enumeration governs the sheet
- **WHEN** a reader asks which states the lookup surface can be in
- **THEN** the `place-search` capability SHALL be the answer
- **AND** this capability SHALL NOT carry a second, divergent list

## REMOVED Requirements

### Requirement: The self-hosted index SHALL be the typeahead's source

**Reason:** `public.places`, `search_places()` and `locality_centroid()` are dropped by `070`. The
736,538-row Overture extract, its extractor, its load workflow and its monthly refresh all go with
them. Nothing can require a source that no longer exists.

**Migration:** the `place-search` capability replaces it in full. No stored data is lost — no
foreign key ever referenced `public.places` (`pg_constraint.confrelid` = 0 on both projects), and
the loose `place_id` text columns are provenance rather than join keys, which the standing
requirement "The stored place id SHALL be provenance and SHALL NOT be treated as a join key"
already established and which this change preserves.
