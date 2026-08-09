## Purpose

Who may see a ride's map tile and who must not; who may cause one to be rendered, since every
render is billable and every geocode transmits an address to a third party; and what the two
containers draw in each of the states they can be in — including the state that is normal for
every ride in the database today, which is *no tile at all*.

**Every access-control requirement below is a statement about a role and a resource, so each maps
onto an assertion in `supabase/tests/rls_test.sql`.** Two are named as not assertable there and
say why: anything about a *signed URL* is a property of Supabase Storage rather than of Postgres,
and the bucket's MIME allowlist runs above every policy.

## ADDED Requirements

### Requirement: A ride's map tile SHALL be readable by exactly the riders who can read the ride

A tile in `ride-maps/` SHALL be fetchable by a rider **if and only if** the `rides` row naming it
is visible to that rider under the `rides` SELECT policy. The audience SHALL be neither wider nor
narrower than the ride's own.

The tile depicts `meeting_point`, which `RideCard` and `RideMap` already render **as text** to
exactly this audience. Making the tile narrower would hide a picture of a string the same screen
is printing; making it wider would publish a private club's meeting point.

**This is the inherit-the-parent-exactly shape** — `postcard_comments` (`011`), `postcard_likes`
(`009`) and the `postcards` storage read policy (`010`) — and **not** `034`'s narrowing shape.
`private.is_ride_crew` SHALL NOT appear in this change.

#### Scenario: The organizer reads their own ride's tile
- **WHEN** the rider named in `rides.organizer_id` fetches either tile for that ride
- **THEN** the fetch SHALL succeed
- **AND** it SHALL succeed whether or not they hold a `ride_members` row

#### Scenario: A crew member reads the tile
- **WHEN** a rider holding a `ride_members` row of either `going` or `maybe` status fetches the
  tile for a ride they can see
- **THEN** the fetch SHALL succeed
- **AND** `maybe` SHALL be identical to `going`, because crew status is not part of this audience
  at all

#### Scenario: A signed-in rider who is not on the crew reads the tile of a ride they can see
- **WHEN** a signed-in rider with no `ride_members` row fetches the tile of a public ride with no
  club, or of a public club's public ride
- **THEN** the fetch SHALL succeed
- **AND** this SHALL be asserted explicitly, because it is the case an implementer copying `034`
  would break, and breaking it fails silently as a grey strip rather than as an error

#### Scenario: A non-member of a private club reads nothing
- **WHEN** a signed-in rider who is not a member of a private club fetches the tile of that club's
  ride
- **THEN** the fetch SHALL be refused
- **AND** it SHALL be refused even if they know the exact object path, because the path is
  guessable from a ride id and a uid and SHALL NOT be treated as a secret

#### Scenario: An ex-member of a private club stops reading the tile
- **WHEN** a rider leaves a private club, or is removed from it, while holding a `ride_members`
  row for one of its rides
- **THEN** the fetch SHALL be refused from that moment
- **AND** the surviving `ride_members` row SHALL NOT keep the tile reachable, which is precisely
  what a crew-based predicate would have done

#### Scenario: A club turning private takes its rides' tiles with it
- **WHEN** a public club is set private, and `propagate_club_privacy_to_rides` flips its rides to
  `is_public = false`
- **THEN** riders who are not members of that club SHALL stop reading those rides' tiles
- **AND** the tiles SHALL NOT be re-rendered, moved or deleted, because the audience narrowed and
  the meeting point did not change

#### Scenario: A blocked rider reads nothing, in either direction
- **WHEN** a rider has blocked the ride's organizer, or been blocked by them
- **THEN** the fetch SHALL be refused
- **AND** this SHALL be asserted with the two riders exchanged, because the `blocks` row is
  directional and the effect is symmetric
- **AND** the refusal SHALL come from the `EXISTS` against `rides` — which carries
  `NOT private.is_blocked(auth.uid(), organizer_id)` — rather than from any predicate this change
  writes, and the assertion SHALL demonstrate that by leaving every other condition satisfied

#### Scenario: A club owner or admin gains nothing extra
- **WHEN** a club's owner or a rider whose `club_members.role` is `admin` fetches the tile of a
  ride in that club
- **THEN** the fetch SHALL succeed on the strength of their **membership** and nothing else
- **AND** no role SHALL confer reach into a ride of a club they do not belong to, because
  `rides` SELECT tests membership and never role

#### Scenario: A signed-out visitor reaches nothing
- **WHEN** a request for an object under `ride-maps/` arrives with no session
- **THEN** it SHALL be refused, because `anon` holds no grant on `storage.objects` and the bucket
  is private
- **AND** this change SHALL add no `anon` grant and SHALL NOT make the bucket public, per
  decision #1

#### Scenario: A rider cannot reach another rider's object by pointing their own ride at it
- **WHEN** an organizer sets `map_card_path` or `map_detail_path` to an object outside
  `ride-maps/<their own uid>/`
- **THEN** the write SHALL be refused by a CHECK constraint on the row
- **AND** the constraint SHALL pin the path to the row's own `organizer_id`, matching the pinning
  `profiles` and `clubs` already use, so that a ride cannot be used as a laundering route to
  another rider's avatar, cover or postcard image

### Requirement: Tile visibility SHALL be enforced on `storage.objects` and SHALL NOT be assumed to follow from table RLS

The rule above SHALL be written as a SELECT policy on `storage.objects`. No requirement of it
SHALL be satisfied by a policy on `public.rides`, by a filter in `src/lib/data/`, or by the
component choosing not to render.

**`storage.objects` is a separate access-control surface.** A policy on `public.rides` governs who
can read the *path*; it says nothing about who can read the *object*, and Storage serves objects
over a route that never consults `public.rides` unless a policy makes it. Every existing folder
already does this correctly, and the shape is worth copying exactly rather than re-deriving.

**Note the asymmetry that makes it easy to get wrong** — measured 2026-08-09: this repo's five
INSERT and five DELETE policies check the folder prefix and the caller's uid **only**, while its
five SELECT policies additionally carry an `EXISTS` against the parent row. Copying an INSERT
policy into a SELECT position produces a folder any signed-in rider can read.

#### Scenario: The read policy joins the object to the ride under the caller's own RLS
- **WHEN** the SELECT policy for `ride-maps/` is written
- **THEN** it SHALL contain an `EXISTS` against `public.rides` matching the object's name against
  `map_card_path` or `map_detail_path`
- **AND** that `EXISTS` SHALL be evaluated under the caller's own row security, so blocking, the
  private-club arm and `022` are inherited rather than restated
- **AND** it SHALL additionally pin the object's second path segment to the ride's `organizer_id`,
  so that a row cannot make an object readable by naming it
- **AND** it SHALL be modelled on `Riders read postcard images their audience predicate allows`
  specifically rather than on "the existing folders" generally, because four of the five carry an
  `own-folder OR EXISTS(parent)` disjunction and only that one is the bare `EXISTS`

#### Scenario: The own-folder arm admits the organizer and widens the audience by nobody
- **WHEN** the policy's own-folder arm (`foldername[2] = auth.uid()::text`) is evaluated
- **THEN** it SHALL admit only the rider whose folder the object sits in
- **AND** that rider SHALL be the ride's `organizer_id` for every referenced object, by the CHECK
  pinning the path, so the arm returns nothing the `EXISTS` would not already have returned for a
  live tile
- **AND** its entire effect SHALL therefore be on **orphans**, which is why it is present

#### Scenario: No `security definer` helper stands in for the parent check
- **WHEN** the policy is written, reviewed or refactored
- **THEN** no `security definer` function SHALL be the condition that decides visibility
- **AND** `private.is_ride_crew` SHALL NOT be referenced, because it is both the wrong audience
  and the wrong mechanism

#### Scenario: The participation gate does not reach this folder, and that is recorded
- **WHEN** the policies are added
- **THEN** it SHALL be recorded that no `storage.objects` policy in this repo carries
  `enforce_participation_gate`, and that these three do not either
- **AND** the gate SHALL NOT be claimed as covering the upload, because the trigger is on tables
  and `storage.objects` is not one of the nine it is attached to

#### Scenario: An orphaned object stays reachable by its uploader and by nobody else
- **WHEN** an object exists under `ride-maps/` that no `rides` row names — an upload whose column
  write was refused, a tile superseded by an address edit, or a tile whose ride was deleted
- **THEN** the `EXISTS` against `rides` SHALL match nothing, so **no other rider** SHALL be able to
  fetch it under any circumstances
- **AND** the organizer whose folder it sits in SHALL still be able to list and delete it, through
  the policy's own-folder arm
- **AND** the reason SHALL be recorded: without that arm the object is invisible in a listing and
  its name is unrecoverable, so it can never be deleted by anyone — an unreadable object is not an
  erased one, and this change builds no privileged sweeper that could find it
- **AND** the arm SHALL be understood to grant nothing, because the folder is keyed to the
  organizer and every object in it renders a meeting point that same rider authored

#### Scenario: The bucket stays private
- **WHEN** the folder is added
- **THEN** the `media` bucket SHALL remain `public = false`
- **AND** no requirement of this change SHALL be met by making it public, which would make every
  avatar, cover, club image and postcard photo in the app world-readable

### Requirement: Only a ride's organizer SHALL be able to cause a render, and the number of renders SHALL be bounded

A render SHALL be caused only by the rider named in that ride's `organizer_id`. Every other caller
SHALL be refused. The number of renders one ride can cause SHALL have a ceiling the database
enforces.

Each render is a billable vendor call and each geocode transmits `meeting_point` — often a home
address — to a third party. Unbounded, an organizer editing in a loop is a charge on our account
with no rider-visible symptom.

#### Scenario: The organizer renders their own ride
- **WHEN** the ride's organizer calls the function with that ride's id
- **THEN** the render SHALL proceed

#### Scenario: The entitlement is decided by RLS, not by an `if`
- **WHEN** the function establishes that the caller may render
- **THEN** it SHALL read the ride using the **caller's own forwarded JWT** and compare
  `organizer_id` to the subject it verified from that JWT
- **AND** it SHALL NOT accept an organizer id, a club id or any other identifier from the request
  body, matching `delete-account`'s rule that the subject comes from the verified JWT and nowhere
  else

#### Scenario: The JWT is verified rather than decoded
- **WHEN** a request arrives bearing any token
- **THEN** the function SHALL verify it rather than trusting the gateway or decoding it
- **AND** a request bearing the **publishable key** SHALL be refused, because it is a valid JWT and
  sails past a decode-only check

#### Scenario: A crew member cannot render
- **WHEN** a rider holding a `ride_members` row for the ride calls the function
- **THEN** it SHALL be refused
- **AND** the refusal SHALL be indistinguishable from the refusal given to a stranger, disclosing
  nothing about whether the ride exists

#### Scenario: A club owner or admin cannot render another rider's ride
- **WHEN** the owner or an admin of the club a ride belongs to calls the function for a ride they
  do not organise
- **THEN** it SHALL be refused
- **AND** club role SHALL confer no render authority at all, because the cost lands on us rather
  than on the club

#### Scenario: A non-member and a blocked rider cannot render
- **WHEN** a rider who cannot see the ride calls the function with its id
- **THEN** it SHALL be refused by the ride read returning zero rows under their own RLS
- **AND** the response SHALL NOT distinguish "no such ride" from "not yours"

#### Scenario: An unauthenticated caller cannot render
- **WHEN** the function is called with no token, an expired token, or a token for a deleted account
- **THEN** it SHALL be refused before any vendor call is made
- **AND** the vendor SHALL NOT be contacted, because the cost is incurred at the vendor call and
  refusing after it defeats the point

#### Scenario: Renders per ride are capped by the database
- **WHEN** a ride has already caused the ceiling number of render **attempts** within the rolling
  window
- **THEN** further renders SHALL be refused
- **AND** the ceiling SHALL be enforced by the ledger's INSERT policy rather than by the function
  counting for itself, because the function is stateless and a client may call it concurrently
- **AND** the refusal SHALL leave any existing tile in place rather than clearing it

#### Scenario: The ledger counts ATTEMPTS, and is written before the outcome is known
- **WHEN** the function is about to issue a vendor call
- **THEN** it SHALL insert a `ride_map_render_attempts` row **first**, and SHALL abandon the render
  if that insert is refused
- **AND** the row SHALL NOT be conditional on the render succeeding, because the money is spent at
  the geocode and not at the path write
- **AND** a render that ends in an empty geocode, a sub-floor confidence, a rejected granularity, a
  vendor outage or a quota rejection SHALL be counted identically to one that produces a tile
- **AND** the reason SHALL be recorded: every one of those outcomes leaves the ride's columns NULL
  and issues **no `UPDATE` on `rides` at all**, so any counter that rises on a column write would
  count successes only and would miss the organizer editing an unresolvable address in a loop —
  the exact rider the ceiling exists to bound

#### Scenario: The count can only ever be raised by the role it bounds
- **WHEN** the ride's organizer attempts to lower their own count — deleting ledger rows, updating
  an `attempted_at`, or any equivalent
- **THEN** every such statement SHALL be refused, because `authenticated` holds **INSERT and SELECT
  only** on the ledger: no UPDATE grant, no UPDATE policy, no DELETE grant, no DELETE policy
- **AND** the asymmetry SHALL be recorded as the reason the design works — the organizer's own
  function call must be able to *raise* the count, so the table cannot be one they are locked out
  of, and the only operation they want is the one with no grant behind it
- **AND** raising their own count SHALL be recognised as self-harm rather than an attack, and SHALL
  therefore need no defence

#### Scenario: A client cannot backdate an attempt out of the window
- **WHEN** a caller inserts a ledger row naming `attempted_at` with any value
- **THEN** the stored value SHALL be server time, written by a `BEFORE INSERT` trigger
- **AND** a column DEFAULT SHALL NOT be treated as the enforcement, matching the ruling already
  made for a conversation's `created_at`: a DEFAULT applies only when the column is omitted
- **AND** the reason SHALL be recorded: a client that can backdate rows has no ceiling at all

#### Scenario: The window is genuinely rolling
- **WHEN** the ceiling is evaluated
- **THEN** it SHALL count ledger rows whose `attempted_at` falls inside a rolling window ending now
- **AND** it SHALL NOT be a fixed window reset on first use, so there SHALL be no boundary at which
  an organizer can spend the ceiling twice in quick succession
- **AND** this SHALL be recognised as a property the ledger gives for free, one row per attempt
  being exactly what a rolling window requires

#### Scenario: The ceiling refuses the ledger insert and never a ride write
- **WHEN** an organizer at their ceiling edits their ride's `meeting_point`
- **THEN** the `UPDATE` on `rides` SHALL succeed, the stale-tile trigger SHALL clear the tile
  columns, and the rider SHALL see the fallback with no error
- **AND** only the ledger insert SHALL be refused
- **AND** no spend control SHALL ever abort a statement against `rides`, because a `BEFORE UPDATE`
  trigger that raises takes the rider's whole edit down with it — including the columns it was
  never concerned with
- **AND** this SHALL be asserted, because "the organizer cannot edit their own ride for the rest of
  the day" is the failure it prevents and it is invisible from the ledger's own tests

#### Scenario: A refused render never fails the ride write
- **WHEN** a render is refused for any reason — entitlement, ceiling, or vendor failure
- **THEN** the ride SHALL still be created or updated
- **AND** the rider SHALL NOT see an error, because their ride saved and the map is an enrichment

### Requirement: The vendor SHALL NOT be contacted from a rider's device

No request to Geoapify SHALL originate from the app bundle. The API key SHALL exist only in the
Edge Function's secret store.

This is one decision answering four problems: the key cannot leak from a bundle it is not in, a
rider's IP is never disclosed to the vendor, the per-view cost becomes a per-ride cost, and the
tile is readable offline because it is an object we host.

#### Scenario: The key is absent from the bundle and from the repo
- **WHEN** the app is built
- **THEN** no Geoapify key SHALL appear in `src/`, in any `NEXT_PUBLIC_*` variable, in
  `.env.local.example`, in a fixture or in Vercel's environment
- **AND** a tripwire test SHALL assert its absence in the same shape as
  `src/__tests__/no-service-role-key.test.ts`, including that the detector still catches a real
  key, because a guard that has quietly stopped matching passes for ever

#### Scenario: The rendered tile is fetched from our own Storage
- **WHEN** either container draws a tile
- **THEN** the image SHALL be fetched from the `media` bucket
- **AND** no vendor hostname SHALL appear in any `src`, `href`, `srcset` or CSS URL

#### Scenario: A missing tile does not fall back to a live vendor call
- **WHEN** a ride has no tile
- **THEN** the screen SHALL render the text fallback
- **AND** it SHALL NOT call the vendor to fill the gap, which would reintroduce every problem the
  architecture exists to solve, one screen at a time

### Requirement: A geocode SHALL fail closed to the address, and every vendor failure SHALL have a defined end state

Where the meeting point cannot be resolved to a coordinate at or above the confidence floor, the
coordinate SHALL be left NULL and both screens SHALL render exactly what they render today.

`meeting_point` is free text and geocoding it is a guess. **A confident wrong guess is worse than
no map**: a rider who trusts a tile pointing at a city centre rides to the wrong place, whereas
today's screens show the rider's own words and are never wrong.

#### Scenario: An empty geocode result stores nothing
- **WHEN** the geocoder returns no candidate for the meeting point
- **THEN** `latitude`, `longitude`, `geocode_confidence` and both paths SHALL remain NULL
- **AND** the ride SHALL save normally

#### Scenario: A result below the numeric floor is discarded
- **WHEN** the best candidate's confidence is below the stated floor
- **THEN** it SHALL be discarded rather than stored with a caveat
- **AND** no tile SHALL be rendered, because rendering costs a call for an image that must not be
  shown

#### Scenario: A city-level match is rejected however confident it is
- **WHEN** the geocoder returns a match whose granularity is a city, district or region rather
  than a street, building or place
- **THEN** it SHALL be rejected regardless of its confidence score
- **AND** the reason SHALL be recorded: such a match is confident about the wrong question, and
  the numeric score cannot express that

#### Scenario: The granularity gate is a function-side rule and is not overclaimed
- **WHEN** the floor is documented
- **THEN** it SHALL be stated that the CHECK enforces the **coupling** — no coordinate without a
  confidence at or above the floor, no tile path without a coordinate — and that the granularity
  gate lives in the function
- **AND** it SHALL NOT be claimed that the database rejects a low-granularity match, because it
  cannot see the match type
- **AND** an organizer writing a coordinate that disagrees with their own address SHALL be
  accepted as within their authority, since they author the address

#### Scenario: A vendor outage is invisible to the rider
- **WHEN** the geocode or render request times out, returns 5xx, or fails to connect
- **THEN** the ride SHALL save, the columns SHALL remain NULL, and the screens SHALL render the
  fallback
- **AND** the rider SHALL NOT be shown a vendor error, a retry button for the map, or a partial
  success message

#### Scenario: Quota exhaustion behaves exactly like an outage for the rider
- **WHEN** the vendor returns a quota or rate-limit response
- **THEN** the rider-visible outcome SHALL be identical to an outage
- **AND** the absence of any alerting channel SHALL be recorded as a KNOWN GAP rather than solved
  by inventing one, because error tracking is deliberately undecided

#### Scenario: A render that succeeds and an upload that fails is a valid stored state
- **WHEN** the tiles render but the upload of one or both fails
- **THEN** the coordinate MAY be stored while the paths remain NULL
- **AND** the CHECK SHALL permit this, because a constraint requiring paths alongside coordinates
  would turn a partial failure into a write failure and lose the coordinate too

#### Scenario: An upload that succeeds and a column write that RLS refuses
- **WHEN** the uploads land but the `UPDATE` on `rides` is refused — the organizer left the club
  their ride belongs to, so the UPDATE policy's `WITH CHECK` arm
  `(club_id IS NULL) OR private.is_club_member(club_id)` no longer holds, and **nothing clears
  `rides.club_id` when a rider leaves a club**
- **THEN** the ride SHALL remain unchanged and the rider SHALL see the fallback with no error
- **AND** the function SHALL delete the objects it just uploaded, because that is the **only**
  moment at which their paths are still known
- **AND** the function SHALL check the club-membership condition **before** the geocode, so that
  this path normally costs nothing; the compensating delete covers only a membership change
  landing mid-flight
- **AND** if the compensating delete also fails, the objects SHALL remain listable and deletable
  by the organizer through the policy's own-folder arm, rather than becoming permanently
  unnameable
- **AND** this SHALL be asserted separately from the failed-upload case, because the upload did
  **not** fail and an assertion covering only that one would leave this path untested

#### Scenario: One tile succeeding and the other failing renders one map
- **WHEN** only one of the two uploads lands
- **THEN** the screen whose path is present SHALL draw its tile and the other SHALL draw its
  fallback
- **AND** neither SHALL wait for, or be suppressed by, the other

#### Scenario: A non-JPEG render is refused above the policy layer
- **WHEN** a render is requested in a format other than JPEG
- **THEN** the bucket SHALL refuse the upload, because `media` allows `image/jpeg` only
- **AND** the tile SHALL therefore be requested as JPEG rather than PNG
- **AND** this SHALL be recorded as a bucket-level rejection that no policy assertion would
  explain, since it happens above every policy

### Requirement: Changing the meeting point SHALL invalidate the tile, by trigger

When `rides.meeting_point` changes, `latitude`, `longitude`, `geocode_confidence`,
`map_card_path` and `map_detail_path` SHALL all be set to NULL in the same statement.

A tile drawn from a previous address is not a stale cache entry, it is **a picture of the wrong
place** shown beside the right one. The rule is a `BEFORE UPDATE` trigger and not a convention in
`src/lib/actions/` because the client owns the mutation path and can decline to run a convention.

#### Scenario: An address edit clears the coordinate and both paths
- **WHEN** an organizer updates `meeting_point` to a different value
- **THEN** all five columns SHALL be NULL after the statement
- **AND** both screens SHALL immediately render the fallback rather than the old tile

#### Scenario: The clearing wins over anything the same statement supplies
- **WHEN** a single UPDATE changes `meeting_point` **and** sets a path or a coordinate
- **THEN** the trigger SHALL overwrite what was supplied, leaving NULL
- **AND** it SHALL therefore be `BEFORE UPDATE` on the row rather than an `AFTER` trigger issuing
  a second statement, which a client could race

#### Scenario: An unrelated update leaves the tile alone
- **WHEN** a ride's title, description, departure time, club or `is_public` changes while
  `meeting_point` does not
- **THEN** the tile SHALL survive
- **AND** the trigger SHALL be scoped with `WHEN (old.meeting_point IS DISTINCT FROM
  new.meeting_point)`, because `propagate_club_privacy_to_rides` issues a bulk
  `update public.rides set is_public = false where club_id = … and is_public`, and an unscoped
  trigger would wipe every tile in a club at the moment it turned private

#### Scenario: Whitespace-only and case-only edits are treated as changes
- **WHEN** `meeting_point` changes in a way that may or may not move the location
- **THEN** the tile SHALL be cleared, because `IS DISTINCT FROM` is the whole test
- **AND** an over-eager clear SHALL be preferred to a comparison that tries to decide whether two
  strings mean the same place, which is the problem geocoding exists to solve

#### Scenario: Re-rendering after an edit is a fresh render subject to every rule
- **WHEN** the client calls the function again after an address edit
- **THEN** the entitlement check, the confidence floor and the render ceiling SHALL all apply
  again
- **AND** the ride SHALL be left with NULL columns and the fallback if any of them refuses

#### Scenario: The superseded object is deleted BEFORE the statement that forgets its name
- **WHEN** a new tile replaces an old one for the same ride
- **THEN** the old objects SHALL be deleted **before** the UPDATE that changes `meeting_point` is
  issued, because that UPDATE fires the clearing trigger and the row is the only place their names
  are recorded
- **AND** this SHALL match the ordering already required for ride deletion — objects first, then
  the row that names them — rather than being reasoned about separately
- **AND** an implementation that deletes afterwards SHALL be treated as a defect, because by then
  there is nothing left to name

#### Scenario: A failed pre-delete leaves a recoverable orphan, not a permanent one
- **WHEN** the pre-delete fails, or the client crashes between the delete and the update
- **THEN** the objects SHALL be unreadable by every rider except the organizer whose folder holds
  them
- **AND** they SHALL remain listable and deletable by that organizer through the policy's
  own-folder arm, so cleanup remains possible at any later time
- **AND** the ordering rule SHALL NOT be relied on alone, because it makes deletion best-effort by
  a client this change elsewhere refuses to trust
- **AND** the two together SHALL be recorded as the complete answer: ordering is the primary rule
  and the own-folder arm is the recovery path

### Requirement: Attribution SHALL render wherever a tile renders, and a tile that cannot carry it SHALL NOT render

Provider attribution is mandatory on the plan this app uses. It SHALL appear on both the 358×160
detail panel and the 80×148 card strip. Where it cannot be rendered legibly, the tile SHALL be
omitted and the fallback drawn instead.

**Omitting the tile is the correct failure**, not omitting the credit: a tile without its
attribution is a licence breach that ships silently on every ride card in the app.

#### Scenario: The detail panel carries the credit
- **WHEN** the 358×160 panel draws a tile
- **THEN** the attribution SHALL be present and legible
- **AND** it SHALL NOT be obscured by the `Open in Google Maps` button, which the design insets
  4px from the bottom-right

#### Scenario: The 80×148 strip carries the credit as part of its design
- **WHEN** the card strip draws a tile
- **THEN** the attribution SHALL be composed **into** the strip rather than added beside the card
- **AND** a single shared credit elsewhere on the screen SHALL NOT be accepted as covering the
  tiles, because a list is scrolled and a card is what a rider sees

#### Scenario: A credit that cannot fit means no tile
- **WHEN** the required attribution string cannot be rendered legibly within 80px at the
  smallest type token this design system has
- **THEN** the strip SHALL render the existing pin fallback and no tile
- **AND** the decision SHALL NOT be resolved by shrinking the text below the design system's
  smallest size, clipping it, or truncating the vendor's name

#### Scenario: The exact string is a blocking question, not an implementation detail
- **WHEN** the tile is built
- **THEN** the attribution text SHALL be taken from the provider's current terms rather than
  inferred from another provider's
- **AND** it SHALL be recorded that this repo already carries **one unresolved attribution
  question** for the `places` table, whose census names eight sources and zero OpenStreetMap
- **AND** neither obligation SHALL be treated as satisfying the other, because they come from
  different vendors covering different data

#### Scenario: Attribution is not defeated by the fallback path
- **WHEN** no tile is drawn
- **THEN** no attribution SHALL be drawn either
- **AND** the fallback SHALL remain exactly what ships today, since it contains no vendor data

### Requirement: Both containers SHALL define every state they can be in, including the one that is currently universal

`RideCard`'s strip and `RideMap`'s panel SHALL each define what they draw when the tile is absent,
loading, failed, forbidden, offline and stale — and absent SHALL be treated as an ordinary state
rather than as a failure.

**There is a fourth zero case here beyond the usual three.** Empty, loading and permission-denied
are the familiar ones; this adds *"the ride is visible, you are entitled to the tile, and no tile
exists"* — which is not an error, not a denial, and is the state of **every ride in the database
today**.

#### Scenario: No tile is the designed state, not a degraded one
- **WHEN** a ride has NULL paths
- **THEN** the strip SHALL render the pin container it renders today and the panel SHALL render
  the address and the `Get directions` chip it renders today
- **AND** neither SHALL show a spinner, a broken-image icon, a "map unavailable" message or an
  empty box

#### Scenario: Permission-denied is indistinguishable from absent, and that is correct here
- **WHEN** a rider cannot fetch a tile because the policy refuses them
- **THEN** the screen SHALL render the same fallback as for a ride with no tile
- **AND** it SHALL NOT say the tile exists but is not for them, because the rider cannot act on
  the difference and the disclosure would leak the ride's audience
- **AND** this SHALL be recorded as a deliberate departure from the usual rule that
  permission-denied and empty are told apart, which applies *where the rider can act on the
  difference*

#### Scenario: A failed image load falls back rather than breaking the row
- **WHEN** the signed URL resolves but the image fails to load
- **THEN** the container SHALL fall back to its no-tile rendering
- **AND** the rest of the card or panel SHALL be unaffected, because a list row must not be broken
  by one image

#### Scenario: Offline draws whatever the platform cached and never blocks the screen
- **WHEN** a rider opens either screen with no connectivity
- **THEN** the ride's own data SHALL render under the existing offline rules
- **AND** a tile SHALL render if the platform already holds it and SHALL fall back silently if not
- **AND** no tile fetch SHALL delay first paint of the ride's text

#### Scenario: A tile never gates the ride
- **WHEN** a tile is slow, missing, refused or broken
- **THEN** the ride SHALL still render in full
- **AND** the tile SHALL never be part of the data the screen gates on, per the standing rule that
  a screen gates on its data rather than on a loading flag

#### Scenario: The strip's size and zoom are not interchangeable
- **WHEN** the tiles are requested
- **THEN** the 80×148 strip SHALL be rendered at z13 and the 358×160 panel at approximately z15
- **AND** the panel's tile SHALL NOT be reused for the strip, because at 358×160's zoom an 80px
  crop shows one street and reads as texture rather than as a place

#### Scenario: A ride with a blank meeting point renders nothing new
- **WHEN** `meeting_point` is whitespace — which the app's own form rejects but the **database**
  does not: `rideSchema` trims and requires a non-empty meeting point at the action boundary, and
  `001` set no CHECK behind it, so any PostgREST writer can still store one
- **THEN** no geocode SHALL be attempted and no tile SHALL exist
- **AND** the panel SHALL continue to render nothing at all, as it does today
- **AND** the Zod rule SHALL NOT be treated as the guarantee, per the standing rule that a rule
  reaching only a schema is advisory once the client owns the mutation path

### Requirement: Tiles SHALL be destroyed with the ride and with the rider, and their retention SHALL be stated

A tile SHALL NOT outlive the ride it depicts or the account that created it. Storage objects have
no foreign key to `rides`, so the deletion SHALL be explicit.

A meeting point is location data about identified people. `openspec/specs` already requires that
any table holding personal data states its retention window when it is created; a rendered image
of where somebody will be is the same class of record.

#### Scenario: Deleting a ride deletes its tiles
- **WHEN** an organizer deletes a ride
- **THEN** both objects SHALL be deleted from Storage
- **AND** the objects SHALL be deleted **before** the row that names them, because once the row is
  gone no policy matches the object and nothing can reach it to delete it

#### Scenario: An orphaned object is unreachable by others but not gone, and stays sweepable
- **WHEN** a Storage delete fails while the row delete succeeds, or an address edit supersedes a
  tile whose pre-delete failed
- **THEN** the object SHALL be unreadable by every rider except the organizer whose folder holds it
- **AND** it SHALL be recorded that unreadable is **not** erased, and that the bytes remain until
  something sweeps them
- **AND** the organizer SHALL retain the ability to list and delete it, so that "until something
  sweeps them" names an actor that exists rather than describing a permanent condition

#### Scenario: Account deletion removes the rider's tiles
- **WHEN** a rider deletes their account
- **THEN** every object under `ride-maps/<their uid>/` SHALL be removed
- **AND** the deletion routine's Storage sweep SHALL be extended to this sixth prefix, which is a
  coordination point with the active account-deletion change rather than something it already
  covers

#### Scenario: Deleting the organizer's account destroys tiles for rides other riders were on
- **WHEN** a rider who organises rides deletes their account
- **THEN** `rides.organizer_id`'s `ON DELETE CASCADE` SHALL remove those rides and their tiles
- **AND** this SHALL be stated as a consequence of the existing cascade rather than as a new
  behaviour of this change

#### Scenario: There is no automatic expiry, and that is a decision
- **WHEN** this change ships
- **THEN** no scheduled deletion SHALL exist, so a tile lives as long as its ride
- **AND** because nothing deletes a past ride, retention SHALL be understood as indefinite
- **AND** this SHALL be an open question owned by the product owner with a stated default, not an
  omission

#### Scenario: The render ledger is readable only by the ride's organizer and dies with the ride
- **WHEN** any rider other than the ride's organizer reads `ride_map_render_attempts`
- **THEN** zero rows SHALL be returned, because the ledger records when an identified rider was
  editing a meeting point and is nobody else's business
- **AND** its `ride_id` SHALL cascade from `rides`, so the ledger dies with the ride and with the
  organizer's account
- **AND** rows older than the window SHALL be recorded as serving no further purpose, with the fact
  that **nothing prunes them today** stated rather than left implied

#### Scenario: Indefinite retention covers orphans too, and they are counted
- **WHEN** retention is stated
- **THEN** it SHALL cover **both** live tiles and orphaned objects, since each orphan is a rendered
  image of where an identified rider previously intended to be
- **AND** an orphan SHALL NOT be treated as outside the retention statement on the grounds that no
  row names it, because the bytes and their location data persist either way
- **AND** the count SHALL be knowable — a rider's orphans are listable within their own folder —
  rather than being an unbounded invisible set

#### Scenario: The address leaves our infrastructure and that is disclosed
- **WHEN** a meeting point is geocoded
- **THEN** it SHALL be recorded that the text is transmitted to a third-party processor
- **AND** the privacy policy SHALL name that processor before real riders geocode real addresses
- **AND** this SHALL be an owner action, blocking nothing in the build

### Requirement: Existing rides SHALL render the fallback and SHALL NOT be backfilled by this change

Every ride that exists when `042` applies SHALL have NULL coordinates and NULL paths, and SHALL
render exactly what it renders today. No backfill SHALL run.

There is no actor in this design entitled to render a ride it does not organise — which is the
same property that keeps the service-role key out of the function. A backfill would require
building that actor.

#### Scenario: Applying the migration changes nothing a rider sees
- **WHEN** `042` is applied
- **THEN** every existing ride SHALL render as before
- **AND** the migration SHALL be safe to apply before any code deploys and before the function is
  deployed at all

#### Scenario: An old ride gets a tile the next time its organizer edits it
- **WHEN** an organizer edits a pre-existing ride's meeting point after the function is live
- **THEN** a render SHALL be attempted under the ordinary rules
- **AND** no other event SHALL cause one, so a ride whose organizer never returns keeps its
  fallback indefinitely

#### Scenario: The absence of a backfill is a cost of the architecture, not an oversight
- **WHEN** the trade is reviewed
- **THEN** it SHALL be recorded that a backfill needs a privileged renderer this change declines
  to build
- **AND** reintroducing one SHALL be treated as reopening the service-role question rather than as
  a follow-up task
