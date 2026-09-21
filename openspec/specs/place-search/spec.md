# place-search Specification

## Purpose
How a rider finds a place, once the search is a third party's metered API instead of a table we
own. This capability covers who may search and who must not, what the surface shows in each state
it can be in, what stops one rider draining a quota every rider shares, what the vendor is told and
what it is never told, what a stored place id means once nothing can resolve it, and what a rider
can still create while the search is unavailable.

The thing being specified is a **lookup**, not a location. Where a coordinate is *stored* and which
writer owns it belongs to `ride-start-location` and to the `clubs` location columns `066` added;
this capability stops at the moment a rider picks a row.
## Requirements
### Requirement: The vendor SHALL be reachable only through a proxy, and never from a rider's device

Place lookup SHALL be performed by an Edge Function that holds the vendor key in its own secret
store. The vendor's hostname, key, response shape and error vocabulary SHALL NOT appear in the
client bundle.

Four properties collapse together the moment either the key or the hostname reaches `src/`, and
they are the same four `add-ride-map-tiles` already bought for tiles: the key cannot leak from a
bundle it is not in; a rider's IP address is never disclosed to the vendor; spend becomes bounded by
something we control rather than by however many devices are typing; and the vendor can be replaced
without a client release.

The proxy SHALL return this repo's own result shape. A vendor field name reaching a component is a
vendor migration reaching a component.

#### Scenario: The bundle names no vendor
- **WHEN** the client bundle is scanned for the vendor hostname or a key-shaped literal
- **THEN** neither SHALL be found, in any file that ships
- **AND** the existing tripwire that asserts this SHALL cover the new function's directory the way it
  covers the existing one, including its self-check that the detector still catches a real instance

#### Scenario: The rider's address never reaches the vendor with the rider attached
- **WHEN** the proxy calls the vendor
- **THEN** it SHALL send the search text and nothing identifying the rider — no user id, no email, no
  session token, no device identifier, and no client IP
- **AND** the vendor SHALL observe only that *someone* using this application searched for that text

#### Scenario: A component cannot reach the vendor even by mistake
- **WHEN** any code under `src/` attempts a place lookup
- **THEN** it SHALL do so through the single named data function, which invokes the proxy
- **AND** no component SHALL construct a vendor URL, hold a vendor key, or read a vendor field name

### Requirement: The proxy SHALL verify its caller itself, and SHALL refuse every caller who is not an onboarded rider

The function SHALL verify the JWT against the auth server rather than trusting the gateway, exactly
as `delete-account` does and for the same reason: the publishable key is itself a valid JWT and
sails past a decode-only check. It SHALL hold no service-role key, and SHALL take no user id in its
request body — the subject comes from the verified token and from nowhere else.

**The negative cases, stated per role.** Nothing in place lookup is rider content, so most roles
resolve identically — which is the point of writing them down rather than assuming it:

| Caller | May search |
|---|---|
| Signed-out visitor | **No.** No session, no token, refused before any spend. Decision #1; `anon` holds no grant on the ledger either |
| A token that is not a user session (the publishable key) | **No.** Refused by verifying against the auth server rather than decoding |
| An anonymous Supabase user | **No.** Refused on `is_anonymous`, as `resolve-ride-location` already refuses |
| A rider with `terms_accepted_at` NULL | **No.** The participation gate refuses the metering row, and no metering row means no vendor call. This closes a real hole: an account created by calling `/auth/v1/signup` directly never accepts terms, and today such an account can still set a username and upload an avatar |
| Any onboarded rider | **Yes**, within the ceilings below. Searching is not a membership-gated act |
| A club owner, admin or member | **Yes**, and no more than any other rider. Lookup grants no elevated ceiling and no elevated results |
| A non-member of the club being created or edited | **Yes.** A rider searching for a place to attach to a club they are creating is not yet a member of it |
| A blocked rider, in either direction | **Yes**, unchanged. Place lookup returns reference data about the world and names no rider, so blocking has no surface here — and SHALL NOT be given one, because a lookup that behaved differently for a blocked pair would leak the existence of the block |

#### Scenario: A signed-out caller spends nothing
- **WHEN** the proxy is called with no token, an expired token, or the publishable key
- **THEN** it SHALL refuse with an unauthorized response
- **AND** it SHALL NOT call the vendor, SHALL NOT write a metering row, and SHALL NOT disclose which of
  the three it refused for

#### Scenario: An un-onboarded account cannot search
- **WHEN** a rider whose consent stamp is NULL calls the proxy with a valid session
- **THEN** the metering row SHALL be refused by the participation gate
- **AND** the proxy SHALL return the same exhausted-or-refused outcome it returns for a ceiling, without
  the vendor being called
- **AND** the rider SHALL NOT be told which gate refused them

#### Scenario: The request body carries no identity
- **WHEN** the proxy's request body is inspected
- **THEN** it SHALL contain the search text, the mode, and at most a coarse bias coordinate
- **AND** a user id, club id or ride id in that body SHALL be ignored if present rather than trusted

### Requirement: Every lookup SHALL be counted, and the ceiling SHALL be enforced by the database

The proxy is stateless and multi-instance, so it cannot count for itself; it holds no service-role
key, so it cannot be trusted to count for others either. The count SHALL therefore live in a table,
and **the ceiling SHALL live in that table's INSERT policy**, evaluated under the caller's own role.

The metering row SHALL be written **before** the vendor is called and SHALL count *attempts* rather
than successes. A vendor call that returns nothing still cost a credit, and a rider retrying a term
that never resolves is exactly the rider a ceiling exists to bound. This is `052`'s ordering, for
`052`'s reason.

Two ceilings SHALL be enforced, not one:

- **Per rider, per window** — what stops one signed-in rider draining the quota for everyone.
- **Per application, per day** — what stops a hundred honest riders doing the same thing accidentally.

A refused metering row SHALL stop the request. The refusal SHALL be reported to the rider as a
distinct state, not as an outage and not as an empty result.

#### Scenario: A rider past their own ceiling is refused before any spend
- **WHEN** a rider whose recent searches exceed the per-rider ceiling issues another
- **THEN** the INSERT SHALL be refused by policy
- **AND** the vendor SHALL NOT be called
- **AND** the rider SHALL be shown a message saying they have searched a lot and can try again later,
  distinct from "no places match" and from "search is unavailable"

#### Scenario: A rider cannot raise their own ceiling
- **WHEN** a rider writes directly to the metering table through PostgREST — inserting rows for another
  rider, back-dating a row, deleting their own rows, or updating one
- **THEN** every one of those SHALL be refused: the row's subject SHALL be forced to `auth.uid()`, the
  timestamp SHALL be server-owned with no client grant, and the table SHALL carry no UPDATE and no
  DELETE grant for any client role
- **AND** the ceiling function SHALL be unreadable and uncallable by client roles, so it cannot be used
  as an oracle for another rider's activity

#### Scenario: The ceiling is asserted against a role, not against a function call
- **WHEN** the RLS suite covers this table
- **THEN** it SHALL assert the grants **by grantee**, because `postgres` and `service_role` hold
  everything by Supabase default and a table-wide count reads a false pass
- **AND** it SHALL assert that the ceiling refuses at the boundary and admits below it, with a negative
  case proving the refusal is not vacuous

#### Scenario: One rider cannot read another rider's searching
- **WHEN** a rider selects from the metering table
- **THEN** they SHALL see their own rows and no others
- **AND** the row SHALL carry no search text, so even their own rows disclose only that they searched

### Requirement: The shared quota SHALL reserve capacity for the surfaces that fail silently

Search, geocoding and static map tiles draw on one quota. Search fails **loudly** — a rider sees a
message. `resolve-ride-location` fails **open** by design: every vendor failure returns
`rendered: false`, no map appears, and no rider is told anything. An unrationed typeahead therefore
does not degrade itself first; it degrades the thing nobody can see failing.

The application-wide ceiling on search SHALL be set **below** the vendor's daily quota, leaving a
stated floor for the map. The reserve SHALL be a named constant with its arithmetic written down,
not a round number.

#### Scenario: Search cannot consume the map's budget
- **WHEN** the application-wide search count reaches its ceiling for the day
- **THEN** further searches SHALL be refused
- **AND** a ride created or edited that day SHALL still be able to geocode and render its tiles

#### Scenario: The arithmetic is recorded where it can be re-derived
- **WHEN** the ceilings are read
- **THEN** they SHALL be accompanied by the per-operation credit cost, the vendor's daily quota, and the
  worst-case credits a single completed form costs
- **AND** the vendor's paid-tier numbers SHALL be recorded as **unknown** rather than estimated, until
  someone reads them

### Requirement: The lookup surface SHALL tell its seven states apart

Zero rows on this surface has six distinct causes and a seventh state that is not zero rows at all.
A rider's next action differs for every one, so the surface SHALL NOT collapse them.

**The surface is now the suggestion list attached to the field's own input**, not a full-screen
sheet. That is a change of where the states are drawn and of nothing else: an inline list has less
room than a sheet, and the temptation is to collapse two states into one line to save it. The
enumeration is unchanged and SHALL NOT be weakened.

| State | What the rider is told | What they should do |
|---|---|---|
| Below the minimum | The minimum, named as a number | Keep typing |
| Searching | That it is searching | Wait |
| No matches | That nothing matched **that search** | Try fewer words, or type it themselves |
| Unavailable | That search could not be reached | Retry, or type it themselves |
| Rider hourly ceiling | That they have searched a lot **just now** | Try again shortly, or type it themselves |
| Rider daily ceiling | That they have searched a lot **today** | Type it themselves; searching resumes tomorrow |
| Offline | That the device has no connection | Reconnect, or type it themselves |

**"Below the minimum" has two presentations and is still one state.** With an empty input on a
field that offers recents, the list SHALL show the recents; in every other case below the minimum —
an empty input with no recents to show, and any input of 1 to 3 characters — it SHALL show the
minimum named as a number. The gap between a recents list disappearing and a lookup firing is
deliberate: it is what tells the rider a request is about to be made.

**The two rider ceilings SHALL NOT share a message**, and this is the requirement above applied to
itself rather than a separate rule. `PER_RIDER_HOURLY` and `PER_RIDER_DAILY` are both enforced in
the same INSERT policy, and "wait" means an hour under one and until tomorrow under the other — a
24× difference in what the rider should do next. A single "you have searched a lot" message tells a
rider who could retry in ten minutes to give up, and tells a rider who is done for the day to keep
poking a surface that will refuse them all evening. The refusal SHALL therefore carry which ceiling
was hit; a reason code is enough, and no number, quota or vendor name reaches the rider.

"Not yet searched" and "searched and found nothing" SHALL remain distinguishable, as they are today:
a null result set is *not yet*, an empty one is *nothing matched*. Conflating them shows
"no places found" for a moment on every search that is about to succeed.

The application-wide ceiling SHALL be presented as **unavailable** rather than as the rider's own
ceiling. It is not the rider's fault and there is nothing about their own behaviour they can change.

#### Scenario: A failed lookup is not rendered as an empty one
- **WHEN** the proxy returns an error, times out, or the device is offline
- **THEN** the suggestion list SHALL show the matching message from the table above
- **AND** it SHALL NOT show "no places match that search"
- **AND** it SHALL NOT show the vendor's name, status code, or error text

#### Scenario: The rider's typing survives every failure state
- **WHEN** any of the failure states above occurs while a rider is filling a form
- **THEN** closing the list SHALL leave everything already typed in the form intact — including a
  meeting point typed before the list was opened
- **AND** no failure state SHALL clear a pick already made

#### Scenario: A retry costs a credit and says so by requiring a tap
- **WHEN** the surface offers a retry after an unavailable state
- **THEN** the retry SHALL be an explicit action rather than an automatic re-issue
- **AND** an automatic retry SHALL NOT be armed on a timer

#### Scenario: The states are drawn where the rider is looking
- **WHEN** any of the seven states is shown
- **THEN** it SHALL be rendered in the list attached to the field the rider is typing in
- **AND** no state SHALL be reported only by a control that is off screen, and none SHALL be
  collapsed into another to save vertical space

### Requirement: A ride and a club SHALL both remain creatable while lookup is unavailable

Neither form SHALL be blocked, refused or held by the state of a third party.

**A ride is safe by construction and SHALL stay that way.** `meeting_point` is free text with search
layered on top — "the layby past the second roundabout" is a real meeting point — so an unavailable
lookup costs the rider a coordinate and nothing else.

**A club is the case that needed deciding, and the premise is narrower than it looks.** The club
location field is **already optional** ("Where the club is based (optional)"), so a club is created
without a location, exactly as every club created before `066` was. What is lost is not the club: it
is the club's place in "near you" on Explore until someone edits it.

The decision is therefore: **the club form SHALL NOT gain a free-text fallback, and SHALL NOT
block.** A typed club location would be a second, unverifiable source for a column whose only
purpose is a distance calculation — a club "based in" free text cannot be sorted by distance, so the
field would look filled and do nothing. Instead:

- The form SHALL submit with no location and no warning that reads as an error.
- The helper copy SHALL say the location can be added later.
- Editing a club SHALL be able to add a location that creation could not, which the edit form already
  supports.

#### Scenario: A club is created during an outage
- **WHEN** a rider creates a club while lookup is unavailable or their ceiling is reached
- **THEN** the club SHALL be created with all four location columns NULL
- **AND** the rider SHALL be told they can add the location later, not that something failed
- **AND** the club SHALL be fully usable — visible, joinable, postable — exactly as a club with no
  location is today

#### Scenario: A ride is created during an outage
- **WHEN** a rider creates a ride while lookup is unavailable
- **THEN** the ride SHALL save with the typed meeting point and no coordinate
- **AND** no validation message SHALL mention picking a place
- **AND** the ride SHALL later be able to acquire a coordinate by the geocoding path that already
  exists, which is a different quota consumer and may itself be exhausted, which SHALL remain a
  silent no-map rather than an error

### Requirement: A search term SHALL NOT be logged, stored, or attributable to a rider

A search term on this surface is frequently a home address — the rider's own, or the address they
are inviting a crew to. It is the most sensitive free text this application handles.

The term SHALL NOT be written to the metering table, to the function's logs, to an error report, to
an analytics event, or to any durable store. The proxy's log lines SHALL carry an outcome and a
reason code and nothing else, following `resolve-ride-location`, which logs "no tile" and a reason
and never an address.

The vendor necessarily receives the term. That is the one disclosure this design makes, it SHALL be
named in `/legal/privacy` before real riders type real addresses, and it SHALL be described
accurately: the vendor receives the text and no rider identity, because the request comes from our
infrastructure rather than from the device.

**This is a change from today and the privacy page SHALL say so.** Under the self-hosted index no
keystroke left our infrastructure at all; `scripts/places/README.md` and the current privacy page
both say so in as many words, and both become false the day this ships.

#### Scenario: A term cannot be recovered from anything we keep
- **WHEN** the metering table, the function logs and the query cache are examined after a search
- **THEN** the durable stores SHALL hold a rider id and a timestamp and no text
- **AND** the term SHALL exist only in the rider's own device memory and in the vendor's logs

#### Scenario: The client cache holds terms and is destroyed at sign-out
- **WHEN** a rider signs out
- **THEN** every cached search term and result SHALL be destroyed with the rest of the client cache
- **AND** the next rider on that device SHALL NOT be able to read what the previous one searched for

#### Scenario: The privacy page is corrected in the same change
- **WHEN** this ships
- **THEN** `/legal/privacy` SHALL state that place searches are sent to a named third party
- **AND** it SHALL NOT continue to claim that searching is entirely local to our infrastructure

### Requirement: A stored place id SHALL be provenance only, and SHALL be namespaced by its source

`rides.start_place_id` and `clubs.location_place_id` are loose `text` with **no foreign key**, by
design — the index was reloaded wholesale and a FK would have blocked every reload or wiped every
row on one. Removing the index does not change what the column is; it removes the last thing that
could ever have resolved it.

A stored id SHALL therefore be treated as a marker meaning *a rider chose this point*, and never as
a key. No screen, query or migration SHALL attempt to resolve one.

New ids SHALL carry their source as a prefix. Ids already stored SHALL remain valid and SHALL NOT be
rewritten, deleted or backfilled: the coordinate beside them is the value, and it was chosen by a
rider and is still exactly right.

#### Scenario: An Overture id outlives the index that issued it
- **WHEN** a ride carrying an id from the retired index is opened after the index is dropped
- **THEN** it SHALL render exactly as it does today — the stored name, the stored coordinate, its map
  tile if it has one
- **AND** nothing SHALL attempt to look the id up
- **AND** the ride SHALL still count as *picked* rather than *geocoded*, so the coupling CHECK and the
  trigger protecting a picked coordinate SHALL continue to hold

#### Scenario: A new id is distinguishable from an old one
- **WHEN** a rider picks a place after this ships
- **THEN** the stored id SHALL carry a source prefix
- **AND** a reader SHALL be able to tell which provider issued any stored id without consulting
  anything outside the row

#### Scenario: The column bound admits what the new provider issues
- **WHEN** the new provider's identifier is longer than the retired provider's
- **THEN** the length CHECK and the client-side bound SHALL be raised **before** the first pick is
  attempted
- **AND** the bound SHALL be set from a measured identifier rather than an assumed one
- **AND** a pick SHALL never be refused by a constraint the rider cannot see or shorten

#### Scenario: The location's audience is the row's audience, unchanged
- **WHEN** any rider reads a club's or a ride's stored location
- **THEN** its visibility SHALL be exactly that of the row carrying it — a private club's location is
  visible to its members and its owner alone, a private ride's to those who can read the ride
- **AND** this change SHALL add no policy, because the columns are columns of rows whose policies
  already decide this

### Requirement: A rider's locality SHALL still resolve without a device fix

`resolveRiderLocation()` has two sources: a device position, which is only ever read when permission
has *already* been granted because the app deliberately never prompts, and the free-text
`profiles.location` resolved to a coarse centroid. The second is the only source most riders have.

It is not only a search bias. `/clubs` and `/clubs/explore` measure "near you" from the same
resolver, so removing the centroid removes distances and near-first ordering from a shipped screen
for every rider who has not granted location.

The centroid SHALL therefore continue to resolve after the index is dropped. It SHALL be metered
under the same ceilings as a search, because it is the same vendor and the same credit. It SHALL be
cached, because a rider's city does not move.

A centroid that cannot be resolved SHALL remain an ordinary state and SHALL NOT be an error: the
search runs without a bias and Explore renders without distances, which is exactly what happens
today for a rider whose typed city matches nothing.

#### Scenario: Explore still says "near you" for a rider with no device permission
- **WHEN** a rider who has typed a city into their profile and never granted device location opens
  Explore
- **THEN** clubs SHALL still be ordered and labelled by distance from that city
- **AND** the resolution SHALL cost at most one vendor call per rider per cached lifetime, not one per
  screen and not one per keystroke

#### Scenario: An unresolvable city degrades silently
- **WHEN** the profile location resolves to nothing, or the ceiling refuses the call
- **THEN** the search SHALL run unbiased and Explore SHALL render without distance labels
- **AND** no error SHALL be shown for either

### Requirement: The client SHALL bound what it spends before the request is made

Every guard the client holds today was justified by database cost. Each one SHALL be re-justified by
credit cost or removed — a guard kept for a reason that no longer exists is a guard nobody dares
change.

- **A minimum length SHALL survive.** Its reason changes from "keeps a query off a sequential scan"
  to "a two-character prefix is a credit spent on nothing".
- **A debounce SHALL survive and is no longer merely polite.** Every keystroke that fires is a
  credit, so the debounce is the difference between a credit per completed word and a credit per
  character.
- **Abort SHALL survive.** Out-of-order results still flicker the list, and an aborted request is
  still billed, which is a second reason rather than a replacement for the first.
- **The token cap and the token-normalising helper SHALL be removed.** Both exist to bound a
  per-token ANDed `ILIKE` and a Postgres tokenisation this change deletes. They SHALL be replaced by
  a plain character bound, which is what a URL and a vendor actually constrain.
- **Results SHALL be cached, which they are not today.** The cache key exists and has no caller, so
  retyping a term re-issues the search.

#### Scenario: A repeated term costs nothing
- **WHEN** a rider types a term, deletes a character, and retypes it within the cached lifetime
- **THEN** the second search SHALL be answered from cache
- **AND** no metering row and no vendor call SHALL result

#### Scenario: A pasted essay is bounded before it is sent
- **WHEN** a rider pastes a long string into the search field
- **THEN** the client SHALL bound it by character count before sending
- **AND** the proxy SHALL bound it again, because a client-side bound only reaches riders using our UI

### Requirement: Attribution SHALL be paid on the surface that renders results, and the retired credit SHALL be removed with the data

The surface rendering place results SHALL carry the answering provider's required credit, and the
retired data set's credit SHALL be removed in the same change that removes the data.

The retired index's credit is specific to that data set and becomes wrong the moment the data is
gone: it names contributors who supplied nothing to what the rider is now looking at.

The new provider's OpenStreetMap credit is **unconditional** and, unlike a map tile, a list of
search results carries no burned-in credit. The obligation therefore lands on the surface itself.

**The surface is the inline list, and the credit SHALL render whenever that list is open with any
rows in it — recents included.** A recent's visible label is not rider prose: it is the provider's
own label, chosen by the rider from a lookup and stored verbatim by the field. Crediting the live
list and not the recents list would make the obligation depend on how the same text got on screen.
A list showing only a message — the minimum-characters hint, searching, an error, a ceiling, no
matches — renders no provider-derived content and SHALL NOT be required to carry the credit; a
build that carries it in those states anyway is compliant and simpler, and either is acceptable.

#### Scenario: The list credits the provider that answered it
- **WHEN** the suggestion list is open with lookup results or recents in it
- **THEN** it SHALL carry the provider's required credit and the OpenStreetMap credit
- **AND** it SHALL NOT credit the retired data set
- **AND** the credit SHALL be a link that does not navigate away from a half-filled form

#### Scenario: The credit is reachable, not merely rendered
- **WHEN** a rider taps the credit link while the list is open
- **THEN** the link SHALL open, rather than being lost to the list closing under the tap
- **AND** the obligation SHALL be treated as discharged only by a credit a rider can actually follow

#### Scenario: The attributions page loses exactly what left
- **WHEN** the index is dropped
- **THEN** the retired provider's section SHALL be removed from `/legal/attributions` in the same change
- **AND** the existing tile credit SHALL be broadened to say it also covers search, rather than a second
  block being added that could drift from the first

#### Scenario: An obligation heavier than credit is resolved before riders are exposed to it
- **WHEN** the provider's terms are read for what they require of **stored** results and of results
  **shown in a list**
- **THEN** the answer SHALL be recorded, with its source, before this ships to production
- **AND** until it is read, the position SHALL be marked as inferred rather than settled — this repo has
  paid for an assumed data licence once already

### Requirement: Metering rows SHALL have a stated retention

A row naming a rider and a moment is personal data. A table of them with no expiry is a permanent
record of when each rider was using the app.

The retention SHALL be stated at creation, SHALL be enforced by a mechanism rather than by intent,
and the mechanism SHALL be bounded — a sweep whose cost grows with the whole table is a sweep that
eventually times out inside a rider's own write.

#### Scenario: A metering row expires
- **WHEN** a metering row is older than the stated retention
- **THEN** it SHALL be removed without anyone running anything by hand
- **AND** removing it SHALL NOT change any ceiling decision, because the retention SHALL exceed the
  longest counting window

#### Scenario: The sweep cannot grow into the rider's transaction
- **WHEN** the sweep runs
- **THEN** its work SHALL be bounded by an index rather than by the size of the table
- **AND** a failure of the sweep SHALL NOT fail the rider's search

### Requirement: The retired index SHALL NOT be dropped before the code that stops calling it is deployed

Dropping the table, its search function and its centroid function is **destructive** and irreversible
in a session: reloading is a 99 MB extract through a workflow only the owner can run, and the
workflow is deleted by this change.

The order SHALL be additive first, deploy, destructive last. A deployed client calling a function
that no longer exists shows every rider an error on a surface that was working.

#### Scenario: The drop waits for the deployment, not for the merge
- **WHEN** the destructive migration is considered
- **THEN** it SHALL be applied only after the proxy is deployed to that project **and** the client that
  calls it is live against that project
- **AND** "merged" SHALL NOT be read as "deployed", because the proxy's deployment is an owner action
  with no automation behind it

#### Scenario: The intermediate state is a working state
- **WHEN** the proxy is deployed but the destructive migration has not run
- **THEN** search SHALL work through the proxy and the retired index SHALL sit unused
- **AND** nothing SHALL depend on which of the two is answering

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Naming them is what stops the next session reading an absence as an oversight and building half of
one.

- **No inline ghost-text completion.** The frame draws it (`Rides / Add starting location - Filled`,
  `1918:15967`, the `Autocomplete` text node); it was already deferred; it is the one element that
  cannot degrade, because a half-working completion rewrites what the rider typed. **Moving the list
  onto the field does not revive it** — it makes it look closer to hand, which is exactly when it
  gets built by accident.
- **No structured address entry** — no separate street, number, postcode and city fields. The vendor
  takes one string.
- **No device-held recent *searches*.** The deferral this bullet used to carry read "no saved or
  recent places", on the grounds that a list of a rider's recent searches is a list of addresses they
  care about, held on the device, surviving the session, and therefore a separate privacy decision.
  That decision has been taken, and it was taken **narrowly**: what is built is a read of the rider's
  own past *ride starts*, from rows this app already stores under the rider's own RLS. A **search
  term** is still never stored, never held on the device, and never shown back to anyone — so a term
  a rider typed and abandoned SHALL NOT appear in any list, ever. The distinction is the whole of the
  privacy decision and SHALL NOT be blurred by a later "we already keep recents" argument.
- **No saved or favourite places**, and no naming, pinning, reordering or deleting of a recent. A
  recent is a derived view of the rider's own rides, not a record they curate.
- **No offline search.** There is no local index any more and there SHALL NOT be a partial one.
- **No reverse geocoding** — "use my current location" as a *pick* is a second endpoint, a second
  credit and a second permission prompt.
- **No alerting when the quota is exhausted.** Error tracking is deliberately undecided, so the
  application-wide ceiling being reached is visible only to whoever looks. This is a **stated gap**,
  not a solved problem.

#### Scenario: An unbuilt surface is recognisable as a decision
- **WHEN** a later session finds one of these missing
- **THEN** it SHALL find it named here with its reason
- **AND** building one SHALL be a new proposal rather than an extension of this one

#### Scenario: An abandoned search term is not a recent
- **WHEN** a rider types a term, sees results, and picks nothing
- **THEN** that term SHALL NOT be retained anywhere, and SHALL NOT appear the next time the field is
  focused
- **AND** the only thing that can become a recent is a place a rider picked **and** saved onto a ride

### Requirement: The lookup surface SHALL be the field's own input, and no second screen SHALL be presented

A rider filling a form SHALL never lose sight of it to search for a place. The suggestions SHALL be
rendered as a list attached to the field being filled, on **every** caller of the shared field —
creating and editing a ride, creating and editing a club — so that one control does this job and
there is no second path to keep in step with it.

The list SHALL NOT be a modal dialog: it SHALL NOT trap focus, SHALL NOT be announced as a dialog,
and dismissing it SHALL NOT be a navigation. A hardware or gesture Back while the list is open SHALL
be understood by the rider as leaving the form, not as closing the list, so the list SHALL NOT
depend on Back to close.

The rider SHALL be able to ignore the list entirely: on a field that accepts free text, typing an
answer and submitting SHALL work whether or not the list was ever opened.

#### Scenario: The form stays on screen while a rider searches
- **WHEN** a rider focuses the location field on any of the four forms and types
- **THEN** the suggestions SHALL appear attached to that field
- **AND** the form SHALL remain on screen behind or around them
- **AND** no full-screen surface SHALL be presented

#### Scenario: One control, four callers
- **WHEN** a rider searches for a place on any of the four forms
- **THEN** the surface SHALL be the same control with the same states, keyboard behaviour and credit
- **AND** no caller SHALL present a second, different lookup surface

#### Scenario: The list is not a dialog
- **WHEN** the list is open
- **THEN** focus SHALL remain in the rider's own input and SHALL NOT be trapped
- **AND** assistive technology SHALL announce a suggestion list rather than a dialog

### Requirement: The list SHALL behave as a combobox, and SHALL NOT submit the form by accident

The retired sheet inherited Escape, focus containment and an unambiguous "you are in a search now"
reading from `role="dialog"`. An inline list inherits none of that and SHALL state it explicitly.

- The input SHALL be marked as a combobox that controls the list, and each row SHALL be an option;
  which option is active SHALL be exposed to assistive technology rather than shown only by colour.
- Arrow keys SHALL move the active option; the list SHALL NOT wrap silently past its ends in a way
  that hides where the rider is.
- **Escape SHALL close the list and SHALL NOT clear the field, SHALL NOT discard a pick, and SHALL
  NOT submit the form.**
- **Enter with an active option SHALL select that option and SHALL NOT submit the form.** Enter with
  no active option SHALL do whatever the form does, unchanged.
- Moving focus out of the field SHALL close the list without changing the field's value.
- The browser's own autofill or history dropdown SHALL NOT be offered on top of this list.

#### Scenario: Escape leaves the rider where they were
- **WHEN** a rider presses Escape with the list open and text typed
- **THEN** the list SHALL close
- **AND** the typed text SHALL remain exactly as typed, a pick already made SHALL remain, and the form
  SHALL NOT be submitted

#### Scenario: Enter picks rather than submits
- **WHEN** a rider has moved to an option with the arrow keys and presses Enter
- **THEN** that option SHALL be selected into the field
- **AND** the form SHALL NOT be submitted by that keystroke

#### Scenario: A screen reader can tell what is happening
- **WHEN** the list opens, changes length, or an option becomes active
- **THEN** the change SHALL be conveyed through the combobox's own roles and state
- **AND** the number of suggestions SHALL be discoverable without sight

#### Scenario: Only options live in the option list
- **WHEN** the panel renders a heading, the provider credit, a retry control, or any message state
- **THEN** none of them SHALL be a child of the option list, and none SHALL be announced as an option
- **AND** the option list SHALL contain selectable places and nothing else
- **AND** a message state SHALL replace the option list rather than being rendered inside it

#### Scenario: The combobox claims to be expanded only when it is
- **WHEN** the panel is open showing a message, a hint, an error or a searching state with no options
- **THEN** the combobox SHALL NOT report itself as expanded, and SHALL name no active option
- **AND** it SHALL report itself as expanded exactly when selectable options are present

#### Scenario: Every control in the panel can actually be used
- **WHEN** the panel holds a control that is not a place row — the provider credit link or a retry
  action
- **THEN** it SHALL be reachable and operable by tap and by keyboard while the panel is open
- **AND** the panel closing on lost focus SHALL NOT be able to swallow the interaction that was aimed
  at it
- **AND** this SHALL hold for the credit link in particular, since an obligation discharged by a link
  nobody can reach is not discharged

### Requirement: A rider SHALL be able to see and tap the suggestions with the keyboard open

This surface is used almost exclusively on a phone with the on-screen keyboard raised — the design's
own frame draws it that way (`1918:15967`: a 349px keyboard on an 844px screen, 41% of the viewport),
and the field is the third control on the create-ride form, so the naive inline list opens into the
space the keyboard occupies.

The requirement is on the outcome, not the mechanism: with the keyboard raised, on the smallest
phone this app supports, a rider SHALL be able to **see at least two suggestions and tap any of them
without dismissing the keyboard first**, on every one of the four forms. Tapping a suggestion SHALL
NOT require scrolling a container the rider cannot see the edges of, and the list SHALL NOT render
underneath the keyboard with no indication that more rows exist.

The list SHALL also not push the rider's own input off screen: whatever it does to the layout, the
text being typed SHALL remain visible while the list is open.

#### Scenario: Suggestions are reachable on a phone
- **WHEN** a rider on a phone-sized viewport focuses the field and types enough to get results
- **THEN** at least two suggestions and the rider's own input SHALL be visible at once with the
  keyboard raised
- **AND** each visible suggestion SHALL be tappable at a glove-sized target without the keyboard
  being dismissed first

#### Scenario: The native shell is verified rather than assumed
- **WHEN** this ships toward the native build
- **THEN** the behaviour SHALL be checked on a real device in the shell, because the web viewport and
  the shell's keyboard resize behaviour are not the same thing
- **AND** if it cannot be satisfied without a native keyboard plugin, that SHALL be raised as a
  separate decision rather than added quietly, since every native plugin is a permission prompt, a
  review question and a supply-chain surface

### Requirement: Recents SHALL be shown exactly while the input is empty, and SHALL NOT be filtered

On a field that offers recents, the recents SHALL be shown **while the input's value is empty** and
SHALL NOT be shown while it holds anything. The trigger is the value, not a keystroke: paste, cut,
undo, an IME composition and the field's own Clear control all change the value without being one, and
a rule written on typing leaves recents on screen through the first four of those and removes them on
none of them.

The rider-visible behaviour is the one the product owner asked for, stated on the right quantity: the
moment there is anything in the field, the recents are gone, and they come back the moment there is
nothing in it again.

Recents SHALL NOT be filtered, ranked or narrowed by what the rider types. A three-row list is not
worth filtering, and the disappearance is doing a second job: it is what tells the rider the field
has stopped offering what it already knows and is about to ask the vendor.

Recents and lookup results SHALL NOT be shown at the same time, or merged into one list. A rider
SHALL always be able to tell which of the two they are looking at, because tapping one costs a
vendor credit's worth of provenance and the other does not.

Because visibility is derived from the current value, an answer that arrives late — recents resolving
after the rider has started typing — SHALL simply not be rendered. No separate discard rule is
needed, and none SHALL be added that could disagree with this one.

#### Scenario: Focus on an empty field offers the last three
- **WHEN** a rider focuses the ride's starting-location field with the input empty
- **THEN** up to three of their own most recent picked starts SHALL be offered
- **AND** no vendor call SHALL be made by focusing the field

#### Scenario: Anything in the field removes them
- **WHEN** the input's value becomes non-empty by any route — typing, pasting, an IME commit, or a
  restored value
- **THEN** the recents SHALL no longer be shown
- **AND** the surface SHALL show the minimum-characters state until the minimum is reached
- **AND** the recents SHALL NOT be filtered by that value at any point

#### Scenario: Emptying it by any route brings them back
- **WHEN** the value becomes empty again — deleting, cutting, undoing, or the field's Clear control
- **THEN** the recents SHALL be offered again
- **AND** the search results for the removed term SHALL NOT remain on screen beneath them

#### Scenario: A late answer never lands over typed text
- **WHEN** the recents read resolves after the rider has already put something in the field
- **THEN** they SHALL NOT be rendered, because the value is not empty
- **AND** a lookup response for a term the rider has since changed SHALL likewise not be rendered

### Requirement: Tapping a recent SHALL spend nothing, and recents SHALL survive the states in which lookup cannot

A recent is a row this application already stores, read under the rider's own session. Selecting one
SHALL make no vendor call, SHALL write no metering row, and SHALL count against neither the
per-rider nor the application-wide ceiling.

It follows that recents SHALL still be offered when lookup itself is refused or unreachable: a rider
at their hourly or daily ceiling, or one the application-wide ceiling has shut out, SHALL still be
offered their recents on an empty field and SHALL still be able to pick one. This is the strongest
argument for recents after the taps — the rider who most needs a start location without a lookup is
the one who cannot make a lookup.

**Offline is the honest exception and SHALL be stated rather than promised away.** Recents are a
database read, so with no connection they are available only if the client cache already holds them
from this session. When they cannot be read, the field SHALL behave as if the rider has none — no
error, no retry affordance, no blocked form — because a rider who has never picked a start has none
either and the field SHALL work identically for both.

#### Scenario: A recent costs no credit
- **WHEN** a rider taps one of their recent starts
- **THEN** no request to the vendor SHALL be made and no metering row SHALL be written
- **AND** the ride's meeting point, place id and coordinate SHALL be set exactly as a fresh pick sets
  them

#### Scenario: A rider at their ceiling can still set a start
- **WHEN** a rider whose hourly or daily lookup ceiling is reached focuses the empty field
- **THEN** their recents SHALL be offered and SHALL be selectable
- **AND** typing SHALL still produce the ceiling message from the states table, unchanged

#### Scenario: An unreadable recents list is not an error
- **WHEN** the recents read fails, times out, or the device is offline with nothing cached
- **THEN** the field SHALL show the minimum-characters state, exactly as it does for a rider with no
  recents
- **AND** no error message, retry control or blocked submit SHALL result

### Requirement: A club's location SHALL remain a pick or nothing, and the field SHALL never show what a submit would not store

The club fields become inputs so that one control has one shape. That introduces a hazard the value
button did not have: a rider can now type into a field whose column only accepts a picked place, and
typed text that is silently dropped looks exactly like a location that was saved.

**The rule for what typing does to a pick differs between the two modes, and the difference follows
from what is stored.**

- **Free-text mode (a ride's meeting point).** The visible input **is** the stored value, so typing
  SHALL drop the pick immediately — a coordinate that no longer matches the text is a pin the write
  will not store. Unchanged; product owner, 2026-08-18.
- **Place mode (a club's location).** The visible input is a **search box** whose text is never
  stored, so typing SHALL NOT drop a pick that is already held. The pick SHALL stand until the rider
  picks another or clears the field explicitly, and on blur the text SHALL revert to the held pick.

Clearing a pick in place mode SHALL therefore be an **explicit** act: the field's Clear control drops
the pick and empties the text together, and nothing else removes a stored club location. Typing must
not, because the revert would resolve to empty, the four hidden fields would submit as NULL, and — the
field being optional — the rider would be told nothing. A club that quietly lost its location because
its owner typed one character into a search box and tapped away is the defect this rule exists to
prevent.

A club SHALL remain creatable and editable with no location at all, with copy that reads as optional
rather than as an error, exactly as it is today.

#### Scenario: Typed club text is never stored as a location
- **WHEN** a rider types a town into a club's location field, picks nothing, and submits
- **THEN** the club SHALL be created or updated with no location written from that text
- **AND** the form SHALL NOT report an error, because the field is optional

#### Scenario: Typing does not remove a club's stored location
- **WHEN** the owner of a club that already has a location focuses the field, types a character, and
  moves focus away without picking
- **THEN** the stored location SHALL be unchanged
- **AND** the field SHALL show the held pick again, not the typed fragment
- **AND** a submit in that state SHALL write the same four values the club already had

#### Scenario: Clearing is the only way to remove it
- **WHEN** a rider uses the field's Clear control in place mode
- **THEN** the pick SHALL be dropped and the text SHALL be emptied together
- **AND** a submit in that state SHALL store no location, which is the rider asking for exactly that

#### Scenario: A submit from inside the focused field still shows the truth
- **WHEN** a rider types over a picked club location and submits directly from the field — Enter with
  the list open and no option active — so that no blur ever occurs
- **THEN** the field SHALL reconcile itself before the submit is read: the text SHALL revert to the
  held pick and the list SHALL close
- **AND** the submit SHALL NOT be prevented, because the rider asked to save
- **AND** what is written SHALL be what the field was showing, never the abandoned text

#### Scenario: A ride is not a club
- **WHEN** a rider types a meeting point on a ride form and picks nothing
- **THEN** the typed text SHALL be stored as the meeting point, unchanged
- **AND** no pick, coordinate or place id SHALL be stored with it

