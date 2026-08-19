## MODIFIED Requirements

<!-- This requirement currently lives in
     openspec/changes/add-ride-start-location-search/specs/ride-start-location/spec.md,
     which cannot be archived yet (34 open tasks), so `ride-start-location` is not
     in openspec/specs/. It is restated here IN FULL. -->

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

### Requirement: The right to keep a coordinate SHALL be stated, and the search sheet SHALL link to the attribution page

**This requirement is retained under its original name only so that its falsified text cannot survive
a fold.** Two of its three premises are gone: there is no sheet, and the licence argument it makes is
about a data set that no longer exists.

- **The Overture / CDLA Permissive 2.0 reasoning is retired with the data.** `070` dropped
  `public.places`. Nothing a rider picks today comes from Overture, so a right derived from Overture's
  licence governs nothing being written. The live statement of the licence basis is the
  provider-named version of this requirement introduced by the geocoder change, and its open question
  about what the provider requires of stored and listed results SHALL be answered before production
  traffic rather than assumed here.
- **Where the credit is discharged is now owned by `place-search`**, whose attribution requirement
  states it: on the surface that renders results — the inline list — whenever that list is open with
  rows in it. This requirement SHALL NOT carry a second, divergent answer.
- **What survives unchanged is the shape of the obligation**: one credit, on the shared control, never
  a per-result credit line, and a link that does not navigate a rider away from a half-filled form.

**A fold that leaves two attribution requirements standing SHALL merge them** under the
provider-named header, keeping this one's "one link, on the shared control, never per-result" rule and
discarding everything that names Overture or a sheet.

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
would find it. A second picker SHALL NOT be written, and rides SHALL NOT get a divergent search
surface.

**The picker is now the field itself.** The separate full-screen search surface is removed, and with
it the last place the two callers could diverge: both modes present an editable input with a
suggestion list attached, and the difference between them is what is *stored*, not what is drawn. A
ride's meeting point is free text with search on top and the input is the stored value; a club's
location is a picked place or nothing and the input is a search box whose text is never stored.

What each caller still supplies, and nothing more: its own field names, its own length bound, its own
required-ness, and — for the ride's start alone — recents. A club's **storage** behaviour SHALL be
unchanged by this: the same four hidden fields under the same names, written together or not at all.

#### Scenario: The clubs form stores exactly what it stored before
- **WHEN** a club is created or edited after the change
- **THEN** its location SHALL be written from the same four hidden fields under the same names, all
  four together or all four NULL
- **AND** no typed text SHALL reach `clubs.location_name` without the pick that goes with it

#### Scenario: Rides pass their own names and bound
- **WHEN** the field is used on a ride form
- **THEN** it SHALL write the ride's own column names and SHALL bound the label at
  `rides.meeting_point`'s 120 characters, not the club's 200

#### Scenario: There is one lookup surface in the app
- **WHEN** any form in the app needs a place
- **THEN** it SHALL use this field
- **AND** no second search surface, sheet or screen SHALL exist for places

## ADDED Requirements

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
