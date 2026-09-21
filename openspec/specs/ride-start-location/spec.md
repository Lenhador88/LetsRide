# ride-start-location Specification

## Purpose
How a ride's starting point is set: that it stays free text with search layered on top, which of
the two writers owns a coordinate when both have an opinion, what happens to a pick when the text
changes underneath it, every role's reach into the new column, every state the search surface can
be in, retention and deletion, and the surfaces this change deliberately does not build.

`meeting_point` is what the organizer wrote and is what every screen renders. This capability is
about the coordinate beside it — where it came from, who is allowed to move it, and when it stops
being true.
## Requirements
### Requirement: The meeting point SHALL remain free text, and search SHALL be an accelerator rather than a gate

`rides.meeting_point` SHALL remain `NOT NULL` free text bounded at 120 characters by `018`, and a
ride SHALL NOT be refused, blocked or downgraded for having no picked place. Picking a place fills
that text; declining to pick changes nothing about whether a ride can be created or saved.

This is a requirement and not a preference. A large share of real meeting points are not
addressable — "the layby past the second roundabout", "my place", "the usual" — and a picker that
refuses them is worse than the bare field it replaces. The failure mode being forbidden is an
organizer who cannot create a ride because the lookup has never heard of where they meet.

**Only the surface changes.** The scenarios below were written against a full-screen sheet with a
`Cancel` button; there is no sheet and no Cancel. The guarantees they bought SHALL be carried by the
inline list unchanged: dismissing the suggestions is not an edit, and nothing about the lookup can
alter what the rider typed.

#### Scenario: A ride saves with nothing picked
- **WHEN** an organizer types a meeting point and never uses the suggestions
- **THEN** the ride SHALL be created or saved exactly as it is today
- **AND** `start_place_id`, `latitude`, `longitude` and `geocode_confidence` SHALL all be NULL
- **AND** no validation message SHALL mention picking a place

#### Scenario: Dismissing the suggestions changes nothing
- **WHEN** an organizer types, sees suggestions, and dismisses them — Escape, moving focus away, or
  simply carrying on with the form
- **THEN** the meeting point text SHALL be exactly what it was before the list opened
- **AND** any pick already held SHALL be unchanged — neither set nor cleared

#### Scenario: The lookup is unreachable and the ride still saves
- **WHEN** the lookup cannot be reached at all — offline, proxy error, vendor outage, ceiling reached
- **THEN** the list SHALL say so and SHALL offer no retry that blocks the form
- **AND** closing the list SHALL leave the typed meeting point intact

#### Scenario: A picked label longer than the column is shortened, not refused
- **WHEN** a rider picks a place whose label exceeds `rides.meeting_point`'s 120-character bound
- **THEN** the value written into the text SHALL be truncated with an ellipsis, client-side
- **AND** the write SHALL NOT be refused by `rides_meeting_point_length`
- **AND** the rider SHALL be able to edit the shortened text afterwards, accepting that editing it
  drops the pick per the requirement below

### Requirement: A picked coordinate SHALL be distinguishable from a geocoded one, by the schema

A ride's coordinate has two possible writers: the rider, who picks a row from `public.places`, and
`resolve-ride-location`, which geocodes the free text through a vendor. A reader — a screen, a
policy, a later migration, a future distance filter — SHALL be able to tell which one produced the
value without consulting anything outside the row.

The marker SHALL be the columns themselves and SHALL NOT be a separate source enum. `start_place_id
IS NOT NULL` means picked; `geocode_confidence IS NOT NULL` means geocoded; a CHECK SHALL make the
two arms mutually exclusive. An enum column would be a second statement of the same fact, free to
disagree with the columns it describes, and would need a CHECK tying it to them anyway.

A picked coordinate therefore carries **no** `geocode_confidence`, and that is correct rather than
missing: confidence is the vendor's evidence for a guess, and a rider choosing a row from an index
is not a guess with a score.

This answers the question PD-114's own 2026-08-12 comment assigns to this story — *"the confidence
column cannot record provenance… either a `location_source` column, or a CHECK-admitted sentinel
confidence value reserved for picks"* — and it takes **neither** of those two options. The comment is
right that confidence saturates, so a maximally-confident geocode and a pick are indistinguishable
*within that column*; the answer is not to overload it or to duplicate it in an enum, but to let the
**presence of `start_place_id`** carry the fact and a CHECK make the arms exclusive. It is also right
that this must be decided before the first coordinate is written, and no ride carries one yet.

**One half of provenance is enforced and the other half is a claim, and the difference SHALL be
stated.** `authenticated` holds UPDATE on `geocode_confidence` from `051`, and
`resolve-ride-location` writes **as the caller** — the anon key plus the rider's own
`Authorization` header, never `service_role` — so the grant cannot simply be revoked without taking
the geocoder down with it. The consequence: a rider cannot forge over a pick (the precedence trigger
restores it), but a rider *can* hand-write the geocoded arm onto a ride that has no pick, making the
row claim a vendor produced a value no vendor touched. The harm is an organizer misrepresenting the
provenance of their own ride's coordinate; it reaches no other rider's data. Closing it is a
follow-up whose ordering is fixed, and which is named under the unbuilt surfaces below.

#### Scenario: The three states are the only three states
- **WHEN** any row in `public.rides` is read
- **THEN** it SHALL be in exactly one of: nothing known (all four NULL); picked (`start_place_id`,
  `latitude`, `longitude` present, `geocode_confidence` NULL); geocoded (`latitude`, `longitude`,
  `geocode_confidence` present and within `051`'s floor and ceiling, `start_place_id` NULL)
- **AND** any other combination SHALL be refused by CHECK with `23514`, for every role including the
  table owner

#### Scenario: A half-written location is refused
- **WHEN** any client writes `start_place_id` with no coordinate, or a coordinate with no
  `start_place_id` and no `geocode_confidence`, or a latitude outside ±90 or a longitude outside ±180
- **THEN** the write SHALL be refused by CHECK, not by Zod, and not by a screen

#### Scenario: Both writers at once is refused
- **WHEN** a write would leave both `start_place_id` and `geocode_confidence` non-NULL on the same row
- **THEN** it SHALL be refused

#### Scenario: The geocoded arm is self-asserted until the grant moves
- **WHEN** an organizer hand-writes `latitude`, `longitude` and a valid `geocode_confidence` onto
  their own ride that carries no pick
- **THEN** it SHALL be accepted, because `authenticated` holds that grant and the geocoder needs it
- **AND** this spec SHALL record that as a stated gap, so no later change reads "provenance" as
  meaning the geocoded arm was proven

### Requirement: The geocoder SHALL NOT overwrite a rider's pick, and the database SHALL be what stops it

`resolve-ride-location` is fired from `createRide` and `updateRide` and writes `latitude`,
`longitude` and `geocode_confidence` on the ride it was given. On a ride whose location the rider
picked, an exact coordinate would be replaced by a vendor's approximation of the same words — a
silent downgrade with nothing to see afterwards, since both states look identical from a screen.

Precedence SHALL be enforced in Postgres, by a trigger, and SHALL NOT rest on the Edge Function
declining to write. Nothing in CI type-checks `index.ts`, only the owner can deploy it, and the
function is therefore the least-guarded code in the repo; a precedence rule living only there is a
rule one unreviewed deploy can remove.

The Edge Function SHALL *also* be changed to skip a picked ride — that is the fix for wasted vendor
spend, not the fix for correctness, and the two SHALL NOT be conflated.

#### Scenario: A later geocode cannot move a pick
- **WHEN** any UPDATE sets `latitude`, `longitude` or `geocode_confidence` on a ride that carries a
  `start_place_id`, without that statement changing `start_place_id`
- **THEN** the stored coordinate SHALL remain the picked one
- **AND** `geocode_confidence` SHALL remain NULL
- **AND** both tile path columns SHALL be NULL, because a tile rendered for the rejected coordinate
  is a picture of the wrong place
- **AND** the statement SHALL NOT raise, so no ride write is ever aborted by this rule

#### Scenario: The organizer may still clear it
- **WHEN** an organizer's own write sets `start_place_id`, `latitude` and `longitude` all to NULL in
  one statement
- **THEN** it SHALL be accepted — precedence protects a pick from being *moved*, never from being
  deliberately removed by its owner

#### Scenario: A tile rendered for the picked coordinate is accepted
- **WHEN** an UPDATE writes tile paths on a picked ride while leaving `latitude` and `longitude`
  exactly as stored
- **THEN** the paths SHALL be accepted, since they were rendered for the coordinate the row holds
- **AND** `051`'s path-pinning CHECK SHALL still require the organizer's own folder

### Requirement: Changing the meeting point SHALL drop the pick unless the same statement supplies a new one

`051`'s `clear_ride_map_tiles` already NULLs the coordinate and both tiles whenever `meeting_point`
changes, on the stated reasoning that deciding whether two strings denote the same place is the
problem geocoding exists to solve, and that an over-eager clear costs one render. That reasoning is
adopted unchanged for the pick: **text edited without a new pick means the pin is no longer known to
describe it, so the pin goes.**

**The trigger as it stands today makes the picked path impossible, and this is measured rather than
predicted.** It is `BEFORE UPDATE ... FOR EACH ROW WHEN (old.meeting_point IS DISTINCT FROM
new.meeting_point)` and it NULLs all five columns unconditionally, so a single statement carrying
both the new text and the picked coordinate loses the coordinate. Run on DEV inside a rolled-back
transaction 2026-08-18: an UPDATE setting `meeting_point`, `latitude`, `longitude` and
`geocode_confidence` together stored the new text and three NULLs. A BEFORE trigger that clears a
column overrides a value supplied by the same statement — which is exactly the property `051`
*wanted* against a stale path and must not have against a fresh pick.

The corrected rule SHALL be decidable from `OLD` and `NEW` alone and SHALL NOT depend on the client
sending every column: a statement that supplies a *newly picked* place keeps it, and every other
statement that touches the text clears everything.

#### Scenario: Text edited on a picked ride, no new pick
- **WHEN** an organizer changes `meeting_point` and the statement carries the same `start_place_id`
  the row already had, or omits the location columns entirely
- **THEN** `start_place_id`, `latitude`, `longitude`, `geocode_confidence` and both tile paths SHALL
  all be NULL on the stored row

#### Scenario: A new pick replaces the text and survives
- **WHEN** an organizer picks a place, so the statement carries the new text and a `start_place_id`
  different from the row's
- **THEN** the picked coordinate SHALL be stored
- **AND** `geocode_confidence` SHALL be NULL
- **AND** both tile paths SHALL be NULL, because they were rendered for the previous point

#### Scenario: A bulk update elsewhere SHALL NOT clear anything
- **WHEN** `propagate_club_privacy_to_rides` sets `is_public = false` across every ride in a club
- **THEN** no ride's location or tiles SHALL be cleared, because neither the meeting point nor the
  place id changed in that statement

#### Scenario: Clearing the pick without touching the text
- **WHEN** an organizer clears the pick and leaves the text as typed
- **THEN** the coordinate, the place id and both tile paths SHALL be NULL
- **AND** the meeting point text SHALL be unchanged

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

### Requirement: The search surface SHALL define every state it can be in

The **lookup** states are not enumerated here. The authoritative enumeration is `place-search`'s
seven-state requirement, which this requirement defers to in full so that a state added later is
added in one place. Any earlier copy of that table in this capability — one written against a
database-backed search inside a sheet, with no ceiling state and no vendor-outage state — is
superseded and SHALL NOT be re-adopted.

What this capability keeps is the set of states belonging to the **field** rather than to the lookup,
because they are about what is stored:

| State | Required behaviour |
|---|---|
| Picked | The field shows the picked place and offers to clear it. |
| Typed over, free-text mode | Typing in a ride's meeting point drops the pick — **product owner, 2026-08-18: _"Lets throw away the pin if the rider types more."_** The text IS the stored value, so a pin that no longer matches it must not survive. |
| Typed over, place mode | Typing in a club's location search box does **NOT** drop the pick. The text is not stored, so there is nothing for the pin to disagree with, and dropping it would let a stray keystroke silently delete a club's stored location. |
| Cleared | The field's Clear control drops the pick and empties the text together, in both modes. This is the only thing that removes a club's location. |
| Refused save | The pick survives a refused create or edit, like every other field. |

#### Scenario: One enumeration governs the lookup states
- **WHEN** a reader asks which states the lookup surface can be in
- **THEN** `place-search` SHALL be the answer
- **AND** this capability SHALL NOT carry a second, divergent list

#### Scenario: Typing over a pick drops it on a ride
- **WHEN** a rider picks a place for a ride's start and then edits the meeting-point text
- **THEN** the pick SHALL be dropped as they type
- **AND** the resulting write SHALL carry the typed text with all three location columns NULL

#### Scenario: Typing over a pick does not drop it on a club
- **WHEN** a rider types into the location field of a club that already has one, and picks nothing
- **THEN** the pick SHALL stand, and the field SHALL show it again once focus leaves
- **AND** the club's stored location SHALL be unchanged by that typing

#### Scenario: A refused save keeps the pick
- **WHEN** a create or edit is refused — an audience violation, a length violation, a capacity rule —
  and the form re-renders
- **THEN** the picked place SHALL still be held by the form, alongside every other retained field
- **AND** resubmitting unchanged SHALL write the same coordinate

### Requirement: The stored place id SHALL be provenance and SHALL NOT be treated as a join key

`start_place_id` SHALL carry no foreign key to `public.places`, and no screen or query SHALL join a
ride to that table to render or resolve its meeting point.

It holds the Overture GERS id of the picked row, as `text`, with **no foreign key** to
`public.places`, for the reason `066` states for `clubs`: the index is reloaded wholesale by
`scripts/places/load.sql`, so `restrict` would make the index unrefreshable the moment one ride
referenced a row, and `cascade`/`set null` would silently wipe the location of every ride whose place
did not survive a re-cut.

The coordinate is a **denormalised copy** and that is the point, not a shortcut: a ride's start point
is what it was when somebody chose it, and must not move because a data vendor redrew a polygon.

#### Scenario: A dangling id is a normal state
- **WHEN** the places index is reloaded and a stored `start_place_id` no longer exists
- **THEN** the ride SHALL be unaffected, its coordinate SHALL be unchanged, and nothing SHALL report
  an error
- **AND** no screen SHALL join a ride to `places` to render its meeting point

#### Scenario: The id is bounded
- **WHEN** a client writes an arbitrarily long `start_place_id`
- **THEN** a CHECK SHALL refuse anything past 100 characters, matching `066`

### Requirement: A ride's start location SHALL have a stated retention, and the artifact that outlives it SHALL be named

The **columns** SHALL be held only on the ride row and SHALL be destroyed with it: three columns, no
history table, no audit row, no separate location store, and no per-rider location record created by
this change. Deleting the ride deletes them, with no tombstone.

**The recents list does not weaken this** and SHALL NOT be read as a second store: it is a derived
view of the rider's own ride rows, computed per session, written nowhere.

**A rendered tile is a different artifact and SHALL NOT be described by that sentence.** `051` states
it in writing and this change SHALL NOT weaken it: a tile is *"a rendered image of where an
identified rider previously intended to be, and the bytes persist whether or not a row points at
them"*. Storage has no foreign key to Postgres, so an object survives the row that named it. Two
routes produce such an orphan, both by design — the clearing trigger NULLs both path columns whenever
the meeting point changes, and the precedence trigger NULLs them when it rejects a coordinate — and
after either, **nothing in the database knows the object's name**. The organizer's own
`ride-maps/<uid>/` prefix is the only handle left.

Retention for the orphan SHALL therefore be stated as it actually is: **it lives until its
organizer's account is deleted**, at which point the account-deletion sweep removes the whole
`ride-maps/<uid>/` prefix. Nothing prunes it before then, and nothing SHALL claim otherwise.

**A ride's start location is not a rider's location.** It is a meeting point an organizer published
to the ride's audience. Nothing here writes to `profiles.location`, reads a rider's device position
into the ride, or infers one rider's whereabouts from another's ride.

#### Scenario: Deleting the ride deletes the columns
- **WHEN** a ride is deleted, by its organizer or through their account deletion
- **THEN** the coordinate and the place id SHALL go with the row, with no tombstone
- **AND** the start SHALL leave the organizer's recents with it

#### Scenario: An orphaned tile outlives the row that named it
- **WHEN** a picked or geocoded coordinate is cleared or rejected and the path columns are NULLed
- **THEN** any object already uploaded SHALL remain in Storage, unnamed by any row
- **AND** the change SHALL NOT claim it was deleted
- **AND** it SHALL remain reachable only under the organizer's own prefix, by the organizer and by
  the account-deletion sweep

#### Scenario: Account deletion removes the prefix
- **WHEN** a rider deletes their account
- **THEN** `ride-maps/<uid>/` SHALL be swept, orphans included, because it is in the deletion
  function's prefix list
- **AND** that membership SHALL be verified rather than assumed, since the list is the only thing
  that reaches the folder

#### Scenario: The device position is used for bias only, and is resolved no earlier than first focus
- **WHEN** the rider's own position is resolved to bias lookup results toward them
- **THEN** it SHALL NOT be stored on the ride, sent to any vendor, or persisted anywhere
- **AND** it SHALL be resolved on the rider's **first focus of the field**, never on form mount, so a
  rider who opens a create form and never touches the location field is never located
- **AND** the removal of the sheet SHALL NOT be allowed to move this trigger earlier, which is the one
  way this guarantee could be lost without anything appearing to change

### Requirement: One picker SHALL exist, and this change SHALL extend it rather than fork it

`src/components/ui/PlaceSearchField.tsx` is the picker, placed in `ui/` by PD-259 precisely so PD-114
would find it. A second picker SHALL NOT be written, and no caller SHALL get a divergent search
surface.

**The picker is now the field itself.** The separate full-screen search surface is removed, and with
it the last place the two callers could diverge: both modes present an editable input with a
suggestion list attached, and the difference between them is what is *stored*, not what is drawn. A
ride's meeting point is free text with search on top and the input is the stored value; a club's
location is a picked place or nothing and the input is a search box whose text is never stored.

What each caller still supplies, and nothing more: its own field names, its own length bound, its own
required-ness, and — for the ride's start alone — recents. A club's **storage** behaviour SHALL be
unchanged by this: the same four hidden fields under the same names, written together or not at all.

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

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Each surface below SHALL be left unbuilt and named, and SHALL NOT be half-built in passing.

- **The frame's inline ghost-text autocomplete is not built.** `1918:15967` draws a completion
  suggested inside the input. It is the one element that cannot degrade — a half-working completion
  rewrites what the rider typed — and PD-259 already left it out for that reason. The field is
  complete without it.
- **The v1 styling of both frames is not transcribed.** `1918:15964` and `1918:15967` carry 31
  `(OLD)` style references and zero v2 greys. The *interaction* is taken as measured; the styling
  comes from v2 primitives, per decision #4.
- **A map tile for a picked ride does not exist until `resolve-ride-location` is redeployed.**
  Deploying is an owner action. Between merge and deploy, a picked ride SHALL carry an exact
  coordinate and no tile, and both containers SHALL draw their existing pin fallback — which is the
  state every ride on DEV is in today anyway. This SHALL be stated in the change, not discovered.
- **The Google Maps deeplink still uses the text**, not the coordinate. Changing it is a separate,
  cheap improvement and is deliberately not bundled here.
- **No distance filter, no "rides near me", no index on the coordinate.** Adding an index before a
  SQL-side distance predicate exists would be a write cost the planner never reads, per `066` §4.
- **The geocoded arm is not made unforgeable here, and the fix has a fixed order.** It needs a
  `security definer` RPC the Edge Function calls to record a geocode, and only then a revoke of
  `update (geocode_confidence)` from `authenticated`. **Revoking before that function is deployed
  takes every tile down**, silently and fail-open, because the geocoder writes as the caller. So it
  is additive-first / deploy / destructive-last across two migrations, per `021`/`025`, and it does
  not belong inside this one.
- **No orphan sweep for tiles whose paths were NULLed.** Their retention is the organizer's account,
  as stated above; a pruning job is a separate decision with a separate owner.

#### Scenario: A picked ride between merge and deploy
- **WHEN** a rider picks a place before `resolve-ride-location` has been redeployed
- **THEN** the ride SHALL store the exact coordinate
- **AND** both tile path columns SHALL be NULL
- **AND** `RideCard` and `RideMap` SHALL draw their existing pin fallback, with no error and no
  retry affordance

#### Scenario: Nothing half-builds the autocomplete
- **WHEN** the search sheet is implemented
- **THEN** no inline completion SHALL be written into the input the rider is typing in

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

### Requirement: The right to keep a coordinate SHALL be stated, and the attribution SHALL name the provider actually used

The standing text states the right to keep a coordinate under Overture's licence and requires the
search sheet to link to the attribution page. The right survives; the licence behind it does not.

Coordinates returned by the vendor SHALL be storable indefinitely, and the basis for that SHALL be
recorded rather than assumed — this change's `design.md` §Open Questions carries it as Q1, and it
SHALL be answered before the proxy serves PROD traffic. The Overture credit SHALL be removed from
`/legal/attributions` in the same PR that drops the table, and the OpenStreetMap credit SHALL
remain and SHALL be broadened to cover search results rather than map tiles alone.

**Where the credit is discharged is owned by `place-search`**, whose attribution requirement states
it: on the surface that renders results — the inline list — whenever that list is open with rows in
it. This requirement SHALL NOT carry a second, divergent answer.

**What survives unchanged is the shape of the obligation**: one credit, on the shared control, never
a per-result credit line, and a link that does not navigate a rider away from a half-filled form.

#### Scenario: The credit is reachable from the surface that renders results
- **WHEN** the suggestion list is open with rows in it
- **THEN** it SHALL offer the link to `/legal/attributions`
- **AND** no per-result or per-source credit line SHALL be rendered on a result row

#### Scenario: The link is on the shared control
- **WHEN** the link is rendered
- **THEN** it SHALL live in the shared field in `src/components/ui/`, so both callers gain it once
- **AND** neither caller SHALL ship a second copy

#### Scenario: A stored coordinate has no expiry
- **WHEN** a picked coordinate and place id are written to a ride
- **THEN** no deletion deadline, cache window or subscription condition SHALL apply to them
- **AND** the retention that governs them SHALL be the ride's own, per this spec's retention
  requirement
- **AND** the basis for that SHALL be the provider's own terms as recorded by the geocoder change,
  marked inferred until read, rather than the retired data set's licence

#### Scenario: The attribution page names no contributor that supplied nothing
- **WHEN** the places table is dropped
- **THEN** `/legal/attributions` SHALL no longer credit Overture
- **AND** it SHALL credit the vendor and OpenStreetMap for both tiles and search results

### Requirement: A rider's recent starts SHALL be their own organized rides and nothing else

The recents list SHALL be derived from rows of `rides` where the reader is the **organizer**
(`organizer_id = auth.uid()`) and `start_place_id` is not null. It SHALL add no table, no column, no
grant and no policy: the existing SELECT policy's first arm already admits a rider to every ride they
organized, unconditionally, and `authenticated` already holds column SELECT on `meeting_point`,
`start_place_id`, `latitude` and `longitude`.

**The negative cases, stated per role.** The list is a read of the reader's own rows, so most roles
resolve to "nothing at all" — which is the point of writing them down rather than assuming it:

| Whose rides can appear in a rider's recents | May appear |
|---|---|
| Rides this rider organized | **Yes**, and only these |
| Rides this rider only **joined** — RSVP'd, crewed, or was invited to | **No.** Attendance is not authorship; another organizer's meeting point is not this rider's history and SHALL never be offered back to them as one |
| Rides in a club this rider **owns** or **administers**, organized by someone else | **No.** A club role grants reach into the club's rides; it does not make their meeting points the admin's own recents |
| Rides in a club this rider is a **member** of, organized by someone else | **No** |
| Rides of a rider this reader has **blocked**, or who has blocked them | **No**, and vacuously so — see below |
| A **non-member**'s or a stranger's rides, public or private | **No** |
| A **signed-out** visitor | **No.** There is no session, so there is no `auth.uid()` and no route to the field; decision #1, and `anon` holds no grant on `rides` |
| Another rider reading **this** rider's recents | **Impossible.** The list is not a resource, has no id, and is computed per session from the reader's own rows |

**Blocking is vacuous here and SHALL be left that way.** Every row in a rider's recents is a row that
rider wrote, so no block in either direction can add or remove one. A block SHALL NOT change what a
rider sees in their own recents, and the list SHALL NOT be given a block predicate — a list that
shortened when someone blocked you would disclose the block.

#### Scenario: A joined ride is not a recent
- **WHEN** a rider has RSVP'd to five rides organized by other riders, each with a picked start, and
  has organized none
- **THEN** their recents list SHALL be empty
- **AND** the field SHALL show the minimum-characters state, with no error

#### Scenario: A club admin gets no reach into other organizers' starts
- **WHEN** a club owner or admin whose club holds many picked rides organized by others focuses the
  field
- **THEN** only rides they organized themselves SHALL appear
- **AND** their role in the club SHALL make no difference to the list

#### Scenario: A block changes nothing
- **WHEN** a rider blocks another rider, or is blocked by one
- **THEN** their own recents list SHALL be identical before and after
- **AND** no row SHALL be added or removed by the block in either direction

### Requirement: A recent SHALL be a pick that restores completely, or SHALL NOT be offered

Only a ride whose `start_place_id` is not null SHALL become a recent. A meeting point the rider
merely typed SHALL NOT, and neither SHALL a geocoded one: `067`'s `rides_location_coupling` admits a
coordinate only when it is picked (`start_place_id` not null, `geocode_confidence` NULL) or geocoded
(the reverse), and a rider cannot write a geocoded coordinate at all — the geocoder does. A "recent"
that restored text and no pin would look identical to one that restored a pin and behave differently,
which is the failure this rule exists to prevent.

Because of that same constraint the read is **total**: any row with a `start_place_id` necessarily
carries a latitude and a longitude, so every offered recent restores a complete pick. A row that
cannot restore one SHALL NOT be offered, and the surface SHALL NOT render a recent it cannot fully
apply.

Selecting a recent SHALL set the meeting-point text, the place id and the coordinate to exactly what
that ride stores — no re-lookup, no re-verification, no vendor call. A ride whose organizer later
typed over its meeting point has, by the same rule that throws the pin away on typing, no pick to
offer; it SHALL therefore not appear.

#### Scenario: A typed meeting point never becomes a recent
- **WHEN** a rider has organized rides whose meeting points were typed rather than picked
- **THEN** none of them SHALL appear in the recents list
- **AND** the list SHALL be shorter, or empty, rather than padded with text-only rows

#### Scenario: A recent restores the whole pick
- **WHEN** a rider taps a recent
- **THEN** the meeting point, place id, latitude and longitude SHALL be set together from the stored
  row
- **AND** the resulting ride SHALL be indistinguishable from one where the rider searched and picked
  the same place again

#### Scenario: A pick that was typed over is gone
- **WHEN** a ride's meeting point was edited to free text, dropping its pick
- **THEN** that ride SHALL NOT appear in the recents list
- **AND** its earlier picked value SHALL NOT be recoverable from anywhere, because nothing stores a
  history of it

### Requirement: Recents SHALL be offered on the ride's start field alone

The club location field SHALL have no recents, and this is a decision rather than an omission. A
club's location is a town and a rider creates roughly one club, so a "recent club locations" list has
no content to show; a ride's start is a specific spot an organizer returns to, which is the whole
reason the list is worth building. Offering an empty or single-row list on the club form would add a
surface with nothing in it.

No other field in the app SHALL gain recents without a new proposal, and in particular a rider's
starts SHALL NOT be offered as suggestions on any surface that is not a form that rider is filling in
themselves.

#### Scenario: The club field offers no recents
- **WHEN** a rider focuses a club's location field with the input empty
- **THEN** no recents SHALL be shown, whether or not they have picked ride starts
- **AND** the field SHALL show the minimum-characters state

#### Scenario: One rider's starts are never another rider's suggestions
- **WHEN** any rider fills any form in the app
- **THEN** the only starts ever suggested to them SHALL be from rides they organized
- **AND** no aggregate, popular or nearby "other riders often start here" list SHALL exist

### Requirement: Recents SHALL introduce no new store, and SHALL inherit the ride's own retention

This list is a **view** of rows the app already holds. It SHALL create no recents table, no per-rider
history, no ranking counter, no "last used" timestamp of its own, and SHALL write nothing anywhere
when a rider focuses a field, scrolls the list, or taps a row.

It follows that retention needs no new window and SHALL NOT be given one: a start disappears from
recents when the ride carrying it is deleted, and every ride goes with its organizer's account under
the existing deletion cascade. Nothing new outlives the ride.

**Recents SHALL NOT be persisted to the device.** They SHALL live only in the client's in-memory
query cache for the session, so that a shared device cannot show the next rider where the previous
one meets their crew — the cache is destroyed at sign-out, and this list SHALL be destroyed with it
rather than being written to local storage, a keychain, or any store that survives the session.

#### Scenario: Deleting a ride removes it from recents
- **WHEN** a rider deletes a ride whose start was picked
- **THEN** that start SHALL stop appearing in their recents
- **AND** nothing SHALL retain it, because no copy was ever made

#### Scenario: Account deletion needs no new step
- **WHEN** a rider deletes their account
- **THEN** the recents list SHALL cease to exist with the rides it was derived from
- **AND** the deletion function SHALL need no new table, prefix or sweep for it

#### Scenario: The next rider on a shared device sees nothing
- **WHEN** a rider signs out and another signs in on the same device
- **THEN** the first rider's recents SHALL NOT be readable or renderable by the second
- **AND** they SHALL NOT be recoverable from any on-device store, because none was written

### Requirement: The recents list SHALL be three deduplicated rows, newest first, from a bounded read

The list SHALL hold at most **three** rows. Rows SHALL be deduplicated by `start_place_id`, so a
rider who has met at the same café four times sees it once and still sees three distinct places. The
order SHALL be most recent ride first, so the place a rider used last is the first thing they can
tap.

**The read SHALL be bounded in what it transfers, and honest about what it scans.** It SHALL request
a fixed, small number of the rider's most recent picked rides and reduce them to three, and that bound
SHALL be a named constant rather than an inline number. The index available is `rides_organizer_id_idx`
— `btree (organizer_id)` alone, with no `created_at` and no partial predicate — so the limit bounds the
rows returned, while the work is proportional to **that rider's own** ride count, which the ordering
must be applied across. That is a per-rider cost, not a table scan, and it SHALL NOT be described as
one. Making it independent of the rider's history would take a composite or partial index, which is a
migration, and this change deliberately adds none.

Fewer than three SHALL be an ordinary state: a rider with one picked start sees one row, and a rider
with none sees no list at all rather than an empty box.

#### Scenario: The same place is offered once
- **WHEN** a rider's four most recent picked rides start at the same place
- **THEN** that place SHALL appear once
- **AND** the next distinct places SHALL fill the remaining rows, up to three

#### Scenario: A long history transfers no more than a short one
- **WHEN** a rider who has organized hundreds of rides focuses the field
- **THEN** the rows transferred SHALL be capped by the stated limit, whatever the history's size
- **AND** the work SHALL be confined to that rider's own rides by the organizer index, and SHALL NOT
  touch another rider's
- **AND** no claim SHALL be made that the cost is independent of how many rides that rider has
  organized, because with the index that exists today it is not

#### Scenario: One recent is a list of one
- **WHEN** a rider has exactly one picked start
- **THEN** one row SHALL be offered
- **AND** no placeholder, empty row or "no more recents" message SHALL be rendered beside it

