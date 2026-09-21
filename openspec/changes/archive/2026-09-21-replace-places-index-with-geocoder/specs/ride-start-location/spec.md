<!--
RESTRUCTURED AT ARCHIVE (2026-09-21) to fit the standing spec, with nothing this change authored
dropped. As drafted, three of the four MODIFIED headers named requirements that do not stand:

- The index requirement is RENAMED to this change's geocoder header, and the block keeps the two
  standing scenarios it did not address (debounce, floor). Its first scenario replaces the standing
  `Nothing leaves our infrastructure while typing`.
- The attribution requirement is RENAMED to this change's provider-named header, carrying the
  standing scenarios; `inline-place-search-with-recent-starts` merges the two, as its own block
  instructs, when it archives next.
- `Every signed-in rider MAY search…` was a restatement of one bullet of the standing
  `Every role's reach…` requirement, not a requirement of its own. That bullet is rewritten from
  this block's text and its scenario is appended; the block as drafted is kept below.
- The states block keeps the two FIELD states (`A refused save keeps the pick`, `Typing over a pick
  drops it`); the two LOOKUP states (`null` and `[]`, results ordered by the index) move to
  `place-search`'s seven-state requirement, as this block says.

As drafted:

Requirement (as drafted): Every signed-in rider MAY search, and the reach SHALL be stated against the proxy rather than against the index

The standing text grants every signed-in rider the right to call `search_places()` and to read the
public places index, on the reasoning that the index is reference data rather than rider data and
that `049` and `050` bound what one call can cost.

Both halves change with the table. There is no index to read, and the cost bound is no longer a
query planner's — it is a per-request bill against a shared daily quota. So the grant SHALL be
restated against the proxy: any signed-in rider who has accepted the terms MAY search, subject to
the per-rider and application-wide ceilings the `place-search` capability defines. Membership,
ownership and club role SHALL NOT change what a rider may search for or what they get back.

Scenario (as drafted): A rider who has not accepted the terms cannot spend a credit
- **WHEN** an account created without accepting the terms calls the proxy
- **THEN** the metering row SHALL be refused by the participation gate
- **AND** no vendor call SHALL be made
-->

## RENAMED Requirements

- FROM: `### Requirement: The search SHALL be answered by our own index, and no keystroke SHALL reach a third party`
- TO: `### Requirement: The search SHALL be answered by a geocoder reached through our own proxy, and no keystroke SHALL reach the vendor from a rider's device`
- FROM: `### Requirement: The right to keep a coordinate SHALL be stated, and the search sheet SHALL link to the attribution page`
- TO: `### Requirement: The right to keep a coordinate SHALL be stated, and the attribution SHALL name the provider actually used`

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

#### Scenario: The search does not fire per keystroke
- **WHEN** a rider types continuously
- **THEN** requests SHALL be debounced and the in-flight request SHALL be aborted, so cost to the
  shared index is bounded and results cannot arrive out of order

#### Scenario: Nothing below the floor is sent at all
- **WHEN** the trimmed term is shorter than the client's minimum
- **THEN** no request SHALL be made, and the sheet SHALL say what the minimum is rather than showing
  "no results"

### Requirement: Every role's reach into a ride's start location SHALL be stated, and the new column SHALL need no policy of its own

Every role's reach into `start_place_id`, `latitude` and `longitude` SHALL be stated below, and this
change SHALL add no RLS policy for them.

These columns live on `rides`. `001`, `017` and `022` already decide
who may read a ride row, and RLS is row-level: a reader who gets the row gets every column they hold
a grant for. **Adding a policy for these columns would be the bug** — there is no narrower policy to
add, only a wider one, and a second predicate over the same row is how two predicates drift apart.

Stated as reach, positive and negative:

- **Organizer** — MAY set, change and clear the pick on their own ride, at creation and at edit.
- **Club admin** — MAY NOT. `club_members.role = 'admin'` grants nothing over a ride's location;
  `rides` UPDATE is `auth.uid() = organizer_id`, and this change adds no arm to it.
- **Club member (ride in their club)** — MAY read the coordinate exactly as they read the ride. MAY
  NOT set or change it.
- **Ride crew (`ride_members`, any status)** — reads the coordinate **only** if the `rides` SELECT
  policy already admits them; being on the crew confers nothing by itself, because that policy has no
  crew arm. A rider who RSVP'd to a public ride that later moved into a private club they do not
  belong to loses the coordinate with the rest of the row. MAY NOT set or change it.
- **Non-member, signed-in** — MAY read the coordinate of a ride they can already read (a public
  ride). MAY NOT read anything about a private club's ride, coordinate included, because the row
  itself is out of reach.
- **Blocked rider** — reaches neither the ride nor its coordinate, in both directions, because
  blocking is symmetric in RLS and applies to the row. No filtering happens in a screen.
- **Signed-out visitor** — reaches the shell and no data. `anon` holds zero grants and none is added
  here; decision #1 is untouched.
- **Any signed-in rider who has accepted the terms** — MAY search, through the proxy, subject to the
  per-rider and application-wide ceilings the `place-search` capability defines. Membership,
  ownership and club role SHALL NOT change what a rider may search for or what they get back. There
  is no index to read since `070`, and the cost bound is a per-request bill against a shared daily
  quota rather than a query planner's.

#### Scenario: A non-member cannot read a private club ride's coordinate
- **WHEN** a rider who is not a member of a private club selects that club's ride by id, asking for
  `start_place_id`, `latitude` and `longitude`
- **THEN** zero rows SHALL be returned — the same answer they get for every other column

#### Scenario: A club admin cannot move someone else's pick
- **WHEN** an `admin` of the club a ride belongs to updates that ride's `start_place_id`
- **THEN** zero rows SHALL be affected, silently, by the `USING` clause of the existing UPDATE policy

#### Scenario: A blocked rider sees no coordinate in either direction
- **WHEN** rider A has blocked rider B, and B organises a public ride
- **THEN** A SHALL NOT see the ride or its coordinate, and B SHALL NOT see A's rides or theirs

#### Scenario: Crew membership alone grants nothing
- **WHEN** a rider holds a `ride_members` row for a ride the `rides` SELECT policy does not admit
  them to
- **THEN** they SHALL read zero rows, coordinate included — the crew row SHALL NOT be an arm of that
  policy, and this change SHALL NOT add one

#### Scenario: The pick is writable at creation, not only at edit
- **WHEN** an organizer creates a ride with a place picked
- **THEN** the INSERT SHALL store `start_place_id`, `latitude` and `longitude` and SHALL NOT raise
  `42501`
- **AND** `geocode_confidence` SHALL carry no INSERT grant to `authenticated`, because no client ever
  produces one

#### Scenario: No grant reaches `anon`
- **WHEN** the column grants on `rides` are read for grantee `anon`
- **THEN** there SHALL be none, for any column, for any operation

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

#### Scenario: The sheet reaches the attribution page
- **WHEN** the search sheet is open
- **THEN** it SHALL offer a link to `/legal/attributions`
- **AND** no per-result or per-source credit line SHALL be rendered on a result row

#### Scenario: The link is on the shared control
- **WHEN** the link is added
- **THEN** it SHALL live in `src/components/ui/`, so the club picker gains it in the same change
- **AND** neither story SHALL ship a second copy

#### Scenario: A stored coordinate has no expiry
- **WHEN** a picked coordinate and GERS id are written to a ride
- **THEN** no deletion deadline, cache window or subscription condition SHALL apply to them
- **AND** the retention that governs them SHALL be the ride's own, per this spec's retention
  requirement

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

#### Scenario: A refused save keeps the pick
- **WHEN** a create or edit is refused — an audience violation, a length violation, a capacity rule —
  and the form re-renders
- **THEN** the picked place SHALL still be held by the form, alongside every other retained field
- **AND** resubmitting unchanged SHALL write the same coordinate

#### Scenario: Typing over a pick drops it
- **WHEN** a rider picks a place and then edits the text in the field
- **THEN** the pick SHALL be dropped as they type — decided by the product owner 2026-08-18,
  *"Lets throw away the pin if the rider types more"*
- **AND** the field SHALL stop showing a pick, so the screen never claims a pin the write will not
  store
- **AND** the resulting write SHALL carry the typed text with all three location columns NULL

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
