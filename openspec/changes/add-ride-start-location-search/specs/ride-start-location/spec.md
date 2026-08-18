## Purpose

How a ride's starting point is set: that it stays free text with search layered on top, which of
the two writers owns a coordinate when both have an opinion, what happens to a pick when the text
changes underneath it, every role's reach into the new column, every state the search surface can
be in, retention and deletion, and the surfaces this change deliberately does not build.

`meeting_point` is what the organizer wrote and is what every screen renders. This capability is
about the coordinate beside it — where it came from, who is allowed to move it, and when it stops
being true.

## ADDED Requirements

### Requirement: The meeting point SHALL remain free text, and search SHALL be an accelerator rather than a gate

`rides.meeting_point` SHALL remain `NOT NULL` free text bounded at 120 characters by `018`, and a
ride SHALL NOT be refused, blocked or downgraded for having no picked place. Picking a place fills
that text; declining to pick changes nothing about whether a ride can be created or saved.

This is a requirement and not a preference. A large share of real meeting points are not
addressable — "the layby past the second roundabout", "my place", "the usual" — and a picker that
refuses them is worse than the bare field it replaces. The failure mode being forbidden is an
organizer who cannot create a ride because the index has never heard of where they meet.

#### Scenario: A ride saves with nothing picked
- **WHEN** an organizer types a meeting point and never opens the search sheet
- **THEN** the ride SHALL be created or saved exactly as it is today
- **AND** `start_place_id`, `latitude`, `longitude` and `geocode_confidence` SHALL all be NULL
- **AND** no validation message SHALL mention picking a place

#### Scenario: Cancel changes nothing
- **WHEN** an organizer opens the search sheet, types, sees results, and taps `Cancel`
- **THEN** the meeting point text SHALL be exactly what it was before the sheet opened
- **AND** any pick already held SHALL be unchanged — neither set nor cleared

#### Scenario: The search index is unreachable and the ride still saves
- **WHEN** `search_places()` cannot be reached at all — offline, RPC error, project paused
- **THEN** the sheet SHALL say so and SHALL offer no retry that blocks the form
- **AND** closing the sheet SHALL leave the typed meeting point intact
- **AND** the ride SHALL save, with no coordinate, on the ordinary path

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
- **Any signed-in rider** — MAY call `search_places()` and therefore MAY read the public places
  index. That is unchanged by this story: the index is reference data, not rider data, and `049`
  and `050` already bound what one call can cost.

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

### Requirement: The search SHALL be answered by our own index, and no keystroke SHALL reach a third party

The typeahead reads `public.search_places()` against the self-hosted Overture extract — 736,538 rows
on both projects. A rider's partial typing SHALL NOT be sent to any external service, at any point,
including as a prefetch, a suggestion or an analytics event.

The vendor is reachable from exactly one place, `resolve-ride-location`, which runs after a save,
holds the only copy of the key, and — once this change lands — is not called at all for a ride whose
location was picked.

#### Scenario: Nothing leaves our infrastructure while typing
- **WHEN** a rider types into the search sheet
- **THEN** every request SHALL be to our own Supabase project
- **AND** no request SHALL be issued to a geocoding, mapping, autocomplete or analytics vendor

#### Scenario: The search does not fire per keystroke
- **WHEN** a rider types continuously
- **THEN** requests SHALL be debounced and the in-flight request SHALL be aborted, so cost to the
  shared index is bounded and results cannot arrive out of order

#### Scenario: Nothing below the floor is sent at all
- **WHEN** the trimmed term is shorter than the client's minimum
- **THEN** no request SHALL be made, and the sheet SHALL say what the minimum is rather than showing
  "no results"

### Requirement: The right to keep a coordinate SHALL be stated, and the search sheet SHALL link to the attribution page

PD-114 names storage rights as load-bearing — *"'We may keep the lat/lng' is load-bearing for all
three payoffs, so verify it before the migration lands"* — and its body's answer (Google's 30-day
delete clause, Mapbox as the recommendation) is superseded. **The answer SHALL be written down here
rather than left to be inferred from a decision made on another issue.**

`public.places` is Overture's Places theme, published under **CDLA Permissive 2.0 and Apache 2.0** —
**not ODbL**. There is no share-alike, no deletion clause, no rights that lapse with a subscription,
and no per-result credit obligation: §3 of CDLA Permissive 2.0 exempts what an app renders
("Results") from carrying the licence text. So a GERS id and a coordinate copied out of that index
MAY be kept permanently, which is what makes a denormalised copy on `rides` lawful as well as
correct. Settled by the product owner on PD-191, 2026-08-18.

**The credit is paid once, on `/legal/attributions`, and the sheet SHALL link to it.** That is a
requirement carried by both PD-114 and PD-259, in the same words — *"the search sheet must link to
`/legal/attributions`… One link from the sheet, not a per-result credit and not a per-source line"* —
because the licence argument depends on that page being reachable, and today it is linked only from
Terms and Privacy, which a rider sees at signup and never again.

**Measured 2026-08-18: `PlaceSearchField` carries no such link** — `grep -rn "attributions" src/`
returns only `src/types/index.ts`, `legal/terms` and `legal/privacy`. PD-259 built the control first
and did not build this. It SHALL be added to the shared control, where both stories expect it, and
SHALL NOT be added twice.

Map tiles are a **different vendor and a different obligation**: Geoapify requires an unconditional
OpenStreetMap credit, discharged by the credit burned into the tile image and by its own line on that
page. This requirement SHALL NOT merge the two.

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

### Requirement: The search surface SHALL define every state it can be in

Search sits in a sheet over a form the rider is part-way through. Every state below SHALL be
designed, and **permission-denied and empty SHALL NOT be conflated** where a rider could act on the
difference.

| State | Required behaviour |
|---|---|
| Idle / below the minimum | The minimum is named. Not "no results". |
| Searching | A searching state distinct from "nothing matched". |
| Results | Rows with a label line and a locality/street meta line. |
| No matches | Says nothing matched, and the free text remains usable. |
| Error / offline | Says the search failed and can be retried; Cancel returns to the intact form. |
| Picked | The field shows the picked place and offers to clear it. |
| Typed over | Typing in the text drops the pick — **product owner, 2026-08-18: _"Lets throw away the pin if the rider types more."_** |
| Cleared | Text and pick cleared together; the field is back to its placeholder. |
| Refused save | The pick survives a refused create or edit, like every other field. |

#### Scenario: `null` and `[]` are told apart
- **WHEN** a search has been issued but has not returned
- **THEN** the sheet SHALL show its searching state and SHALL NOT show "no places match", which would
  otherwise flash on every successful search

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

#### Scenario: Results are bounded and ordered by the index
- **WHEN** a term matches many rows
- **THEN** the sheet SHALL show the bounded set `search_places()` returns, in the order it returns
  them, with no client-side re-ranking and no pagination — there is no "next page" to offer

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

**A rendered tile is a different artifact and SHALL NOT be described by that sentence.** `051` states
it in writing and this change SHALL NOT weaken it: a tile is *"a rendered image of where an
identified rider previously intended to be, and the bytes persist whether or not a row points at
them"*. Storage has no foreign key to Postgres, so an object survives the row that named it. Two
routes produce such an orphan here, both by design — the clearing trigger NULLs both path columns
whenever the meeting point changes, and the precedence trigger NULLs them when it rejects a
coordinate — and after either, **nothing in the database knows the object's name**. The organizer's
own `ride-maps/<uid>/` prefix is the only handle left.

**This change is what first makes that class exist, and that SHALL be stated rather than inherited.**
No ride in either project has ever carried a coordinate, so no tile has ever been rendered; the first
orphan possible is one produced by a *picked*, exact point rather than a geocoder's approximation.

Retention for the orphan SHALL therefore be stated as it actually is: **it lives until its
organizer's account is deleted**, at which point the account-deletion sweep removes the whole
`ride-maps/<uid>/` prefix. Nothing prunes it before then, and nothing SHALL claim otherwise.

**A ride's start location is not a rider's location.** It is a meeting point an organizer published
to the ride's audience. Nothing here writes to `profiles.location`, reads a rider's device position
into the ride, or infers one rider's whereabouts from another's ride.

#### Scenario: Deleting the ride deletes the columns
- **WHEN** a ride is deleted, by its organizer or through their account deletion
- **THEN** the coordinate and the place id SHALL go with the row, with no tombstone

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

#### Scenario: The device position is used for bias only
- **WHEN** the search sheet resolves the rider's own position to bias results toward them
- **THEN** that position SHALL NOT be stored on the ride, sent to any vendor, or persisted anywhere
  by this change
- **AND** it SHALL be resolved only when the sheet opens, never on form mount, so a rider who never
  searches is never located

### Requirement: One picker SHALL exist, and this change SHALL extend it rather than fork it

`src/components/ui/PlaceSearchField.tsx` is the picker, placed in `ui/` by PD-259 precisely so PD-114
would find it. A second picker SHALL NOT be written, and rides SHALL NOT get a divergent search
sheet.

What rides need on top, and nothing more: an **editable text input** in place of the read-only value
box, so the field is free text with search on top; a search affordance that opens the same sheet; and
the caller's own field names, length bound and required-ness. Clubs' behaviour SHALL be unchanged by
the extension.

#### Scenario: The clubs form is unaffected
- **WHEN** the extension lands
- **THEN** `CreateClubForm` and `EditClubForm` SHALL behave exactly as before, with the same four
  hidden fields under the same names

#### Scenario: Rides pass their own names and bound
- **WHEN** the field is used on a ride form
- **THEN** it SHALL write the ride's own column names and SHALL bound the label at
  `rides.meeting_point`'s 120 characters, not the club's 200

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
