# Static map tiles for the rides list and the ride plan

> Linear **PD-104** — *"Rides list and ride detail show no map — the tile was never built"*. This
> file is the specification; the issue points at it and must not restate it. `CLAUDE.md` §The
> roadmap lives in Linear: *"A Linear issue that grows a specification is a bug."*

## Why

Two containers are drawn, built, and empty. `RideCard`'s 80×148 image strip renders a grey block
with a pin in it on every row of `/rides`; `RideMap`'s 358×160 panel renders the address and a
`Get directions` chip. Both components' doc comments say the same thing and say it correctly:
`rides` has **no latitude and no longitude**, only free-text `meeting_point`, so there has never
been anything to draw. Measured 2026-08-09 — `rides` has eleven columns and none of them is a
coordinate or an image.

The Google Maps deeplink half of decision #3 already works and this change does not touch it.
What is missing is the other half: *"a static thumbnail"*.

**The reason this needs a proposal rather than a ticket is that the tile is a Storage object, and
`storage.objects` policies are a separate access-control surface from table RLS.** A ride's
visibility is computed by a policy on `public.rides`. A tile's visibility is computed by a policy
on `storage.objects`, which knows nothing about that policy unless someone writes the link. Get it
wrong and a private club's meeting point is fetchable by any signed-in rider who can guess a path
— and nothing in CI would notice, because `openspec/` and `src/` are not where that rule lives.

**The second reason is that this change spends money on a third party and sends a rider's address
to it.** Every render is a billable call; every geocode transmits `meeting_point` — frequently
somebody's home address — outside our infrastructure. Both need a stated rule about who can cause
them.

## What Changes

Decided by the product owner 2026-08-09 and **not reopened here**: the provider is **Geoapify**,
chosen on its caching terms — the primary terms permit storing a rendered static map in our own
storage indefinitely, serving it to multiple end users, with no active-subscription tether. The
architecture is **render once, store in Supabase Storage, never call the vendor from a rider's
device**, which answers offline read, per-view cost, per-view IP leak and key exposure together.

- **Five new columns on `public.rides`** — `latitude double precision`,
  `longitude double precision`, `geocode_confidence real`, and the two Storage object paths
  `map_card_path text` / `map_detail_path text`. All nullable; NULL is the normal state and the
  designed fallback, not an error. **Count them from this list rather than from a total written in
  prose** — an earlier revision of this bullet said "four" above a list of five.
- **Three CHECK constraints**, and the middle one is deliberately one-directional. A coordinate may
  not exist without a confidence at or above the floor (§The confidence floor); a **tile path may
  not exist without a coordinate**, while a coordinate **may** exist without a tile path, because a
  successful geocode followed by a failed render or upload is a real end state and a constraint
  requiring both would turn a partial failure into a write failure and lose the coordinate too; and
  both path columns are pinned to `'ride-maps/' || organizer_id || '/%'`, the shape `profiles` and
  `clubs` already use.
- **One `BEFORE UPDATE` trigger on `rides`** that NULLs the five tile columns when `meeting_point`
  changes. This is the stale-tile rule, and it is a trigger rather than a convention in
  `lib/actions/` because the client owns the mutation path and can decline to run a convention.
  It is scoped with `WHEN (old.meeting_point IS DISTINCT FROM new.meeting_point)` — **measured
  2026-08-09**: `propagate_club_privacy_to_rides` issues
  `update public.rides set is_public = false where club_id = … and is_public`, so an unscoped
  trigger would wipe every tile in a club the moment that club went private.

  **The same trigger is why the caller must delete the superseded objects *before* it issues that
  UPDATE.** Clearing the columns destroys the only record of the old object names, and this
  change builds no privileged sweeper that could find them afterwards. See §Orphaned objects.
- **The spend control is an append-only ledger, `public.ride_map_render_attempts`** — one row per
  **attempted** vendor call, `ride_id` cascading from `rides`, and an `attempted_at` written by a
  `BEFORE INSERT` trigger rather than a DEFAULT, so a client cannot backdate a row out of the
  window. `authenticated` holds **INSERT and SELECT only**: no UPDATE grant, no UPDATE policy, no
  DELETE grant, no DELETE policy. The ceiling lives in the INSERT policy's `WITH CHECK`, counting
  the caller's rows inside a rolling window. See §Bounding the spend for why a counter column on
  `rides` cannot do this job.
- **A sixth Storage folder, `ride-maps/<organizer uid>/<uuid>.jpg`**, with three policies. INSERT
  and DELETE take the ordinary own-folder shape. **The SELECT policy is modelled on
  `Riders read postcard images their audience predicate allows` specifically, not on "the five
  folders" generally** — four of the five carry an `own-folder OR EXISTS(parent)` **disjunction**,
  and copying that blindly is a different policy from the one this change specifies. `ride-maps`
  carries the own-folder arm too, but for a stated reason rather than by imitation: see
  §Orphaned objects.
- **One Edge Function, `resolve-ride-location`** — geocode `meeting_point`, render both tiles,
  upload them, write the columns. It holds the Geoapify key in its secret store and **verifies the
  caller's JWT itself** rather than trusting the gateway, following
  `supabase/functions/delete-account/` rule 2: the publishable key is a valid JWT and sails past a
  decode-only check. Unlike `delete-account`, **it holds no service-role key** — see §The Storage
  write, which is the open question this proposal was asked to close.
- **Two zooms, from the owner's measurement at 52°N.** z13 for the 80×148 card strip (941 ×
  1741 m — reads as a place); ~z15 for the 358×160 detail panel (1.05 × 0.47 km). z15 on the strip
  shows one street and reads as texture rather than as a location.
- **`RideCard` fills its strip and `RideMap` fills its panel** when a path is present, and both
  render exactly what they render today when it is not. The `Get directions` anchor stays, and on
  the detail panel the tile goes *behind* it rather than replacing it.
- **`keys.ts`** gains nothing new. The paths arrive on the ride row through `rides.list` and
  `rides.detail`, which already exist — but the signed URL derived from a path is bounded by its
  own expiry, which is an ADDED requirement in `client-cache-invalidation`.

**Explicitly not in this change, each with its reason:**

| Out of scope | Why |
|---|---|
| **A backfill of the 5 existing rides**, and of every ride created before the function deploys | A consequence of §The Storage write, stated honestly there rather than buried: with no service-role credential there is no actor entitled to render another rider's ride. Existing rides get a tile the next time their organizer edits them, and until then they render exactly what they render today. A backfill needs either a privileged path this change declines to build, or the owner editing rides by hand |
| **The 390×200 ride detail banner** | A different missing column — a ride cover *photo*, not a map. `docs/FIGMA-FIDELITY-TODO.md` §Ride detail logs it separately and says to do both together; that was written when both were blocked on "a migration and Storage", which is no longer the same migration or the same audience question. A photo needs EXIF stripping and a moderation story; a map render needs neither |
| **A place picker** | **PD-114.** This change must not block on it and must not build a second coordinate column for it to use. **The two do NOT currently agree on the column names, and this line previously asserted that they did.** PD-114 step 3 specifies `meeting_point_lat` / `meeting_point_lng` / `meeting_point_place_id`; this change specifies `latitude` / `longitude`. If both land as written, `rides` ends up with **four** coordinate columns — the exact outcome this row says must not happen. One of the two documents has to move before PD-114 is built, and it is cheaper to move PD-114, which has no migration yet. Recorded here rather than silently reconciled, because this proposal is the one asserting an agreement that does not exist |
| **`ends_at`, the location row's two-line address, `max_riders` enforcement** | Three other things `docs/FIGMA-FIDELITY-TODO.md` logs on these two screens. None of them is a map |
| **Error tracking for vendor failures** | `CLAUDE.md` lists error tracking as *deliberately undecided*. This change states what the rider sees on every failure and declines to invent the alerting channel that would tell the owner. Recorded as a KNOWN GAP and as an open question below |
| **Route rendering, turn-by-turn, an interactive map** | Decision #3, unchanged. `docs/FIGMA-FIDELITY-TODO.md` rules out the `output=embed` iframe by name and gives three reasons; none has expired |

## The confidence floor

`meeting_point` is free text, so geocoding it is a guess, and **a confident wrong guess is worse
than no map at all.** "The usual spot" geocodes to a city centre with high confidence in being
that city; a rider who trusts the tile rides to the wrong place. Today's screens are never wrong,
because they show the rider's own words.

**The floor is three-part, and the numeric one matters least:**

1. **An ambiguity gate.** If more than one returned candidate ties at the highest `confidence`,
   nothing is stored. **Added 2026-08-11 against a measured response**, which is the only reason
   this proposal knows it is needed: `Stationsplein 1, Amsterdam` returns two buildings **12.2 km
   apart** — Amsterdam and Weesp, which joined the Amsterdam *municipality* in 2022 — and both come
   back `confidence: 1`, `full_match`. The other two gates pass both. Confidence says how sure the
   vendor is about *one* candidate and says nothing about how many there are.
2. **A granularity gate.** The match must be street-level or better, read from the result's own
   type. A city-or-district match is rejected **regardless of its confidence score**, because such
   a match is confident about the wrong question — it is sure it found the city, and a meeting
   point is not a city.
3. **A numeric floor of `0.70`** on the provider's `rank.confidence`, applied after both gates.

`0.70` is chosen rather than measured — a starting value the owner may move — but the **scale is
now measured**: `rank.confidence` is 0–1, so the number is on the right axis. The two gates above
it are the parts that should not be dropped. `design.md` §D3 §*What was measured* carries the
response and the two field-level corrections it forced.

**What the database can and cannot enforce here, stated rather than overclaimed.** The floor is a
*quality* rule about the geocoder's uncertainty, not a security rule about a hostile rider — the
organizer authors `meeting_point` and can already type a false address, so a coordinate that
disagrees with it is within their authority. What the CHECK enforces is the **coupling**: a row
may not carry a coordinate without also carrying a confidence at or above the floor, and may not
carry a tile path without a coordinate. That is an integrity rule, so it is a CHECK, per
`CLAUDE.md`'s rule that anything reaching only a Zod schema is advisory. The granularity gate has
no CHECK behind it and this proposal says so plainly rather than implying the database is holding
a line it is not.

**The ambiguity gate has no CHECK behind it either, and the measurement makes that understatement
sharper.** Both Weesp and Amsterdam satisfy the coupling perfectly — a coordinate, a confidence of
`1`, well above the floor. **The database cannot distinguish a right coordinate from a wrong one at
all here**, because the information that separates them (how many candidates came back) never
reaches the row. Two of the three gates live in the Edge Function, and after this correction the
CHECK bounds a smaller share of correctness than the paragraph above originally implied. Neither
gate belongs in the schema: one needs the whole vendor response and the other needs a vendor field,
and §D3's standing rule against hardcoding a vendor vocabulary covers both.

## The Storage write — the open question, and where it landed

**Landed on: the forwarded JWT. The function holds no service-role key.**

The function receives the caller's `Authorization` header, verifies the JWT itself, and then uses
a Supabase client constructed with **that token** for everything it touches: it reads the ride
under the caller's own RLS, uploads under the caller's own `storage.objects` INSERT policy, and
updates the ride row under the caller's own UPDATE policy. It is decision #8's second reading —
*"a separate service that forwards the user's JWT to Postgres rather than holding a service-role
key"* — and it is the strongest available property: if the function is ever confused about which
ride it is working on, it can do nothing the caller could not already do.

Three things had to be true for this to work, and all three were measured on 2026-08-09 rather
than assumed:

- **The upload is expressible as a policy.** The existing five folders' INSERT policies are
  `bucket_id = 'media' AND foldername[1] = '<folder>' AND foldername[2] = auth.uid()::text` plus a
  filename regex. `ride-maps` takes the identical shape, so the organizer writing their own tile
  needs no new kind of permission.
- **The column write needs no elevation — but it is not unconditional, and the second arm is the
  one that bites.** `rides` carries a **table-level** grant to `authenticated` — `relacl` is
  `arwdDxtm`, and `pg_attribute.attacl` is empty for every column — so the new columns arrive
  client-writable the moment `alter table` runs. The UPDATE policy
  `Organizers update their own rides, within their own clubs` is **two arms, not one**, and an
  earlier revision of this proposal quoted only the first:

  ```sql
  USING      (auth.uid() = organizer_id)
  WITH CHECK ((auth.uid() = organizer_id)
              AND ((club_id IS NULL) OR private.is_club_member(club_id)))
  ```

  `WITH CHECK` re-evaluates club membership on **every** update, including one that touches only
  the map columns — and **nothing clears `rides.club_id` when a rider leaves a club** (measured
  2026-08-09: `club_members` carries only `enforce_participation_gate` and `notify_club_joined`).
  So an organizer who left the club their ride sits in can still *read* and still *upload*, and
  their column write is refused. That is a live path, not a corner: leaving a club is an ordinary
  supported action. §Ordering inside the function is what keeps it from costing money and leaving
  litter.
- **The bucket does not refuse the write.** `media` is private with
  `allowed_mime_types = ['image/jpeg']` and a 5 MB ceiling. It refuses PNG. **The tile is
  therefore requested as JPEG**, not PNG — recorded because "store a rendered static-map PNG"
  is how the caching decision was phrased, and a PNG upload would fail at the bucket, above every
  policy, for a reason no policy assertion would explain.

**The cost of this choice, stated because it is real.** Leaving the table-level grant in place
means the organizer can write those columns directly through PostgREST — setting a coordinate that
disagrees with their own address, or pointing `map_card_path` at another object. The first is
within their authority as argued above. The second is closed by a CHECK pinning both paths to
`'ride-maps/' || organizer_id || '/%'`, which is the shape `postcards`, `profiles` and `clubs`
already use.

**That "within their authority" argument covers the tile columns and does NOT cover the spend
control, and the asymmetry is the reason the two decisions cannot share a rationale.** A
coordinate, a path and an address are the organizer's own data, and a rider corrupting their own
ride harms only their own ride. The **spend control** is not their data — it is a limit on **our**
vendor bill, and the organizer is the party it is aimed at. A control the adversary can reset is
not a control, which is why it does not live on `rides` at all. §Bounding the spend.

The alternative — revoking the table-level UPDATE and re-granting per column, the way
`025` did for `profiles` — buys protection against a rider vandalising their own ride and costs a
destructive migration plus the permanent inversion that every future column on `rides` arrives
with no UPDATE grant. Declined, and stated in the migration rather than left silent, which is what
`tag-postcards-to-rides`'s *"The default is stated for a table with no grant conversion"* scenario
asks for.

**And the cost that is not recoverable: there is no backfill.** No actor in this design is
entitled to render a ride it does not organise, which is exactly the property that keeps the
service-role key out. That is the right trade, and it is why §What Changes lists the backfill as
out of scope rather than as a later task.

## Ordering inside the function

Four steps, in this order, and each exists because of a specific failure:

1. **Pre-flight the club-membership arm before spending anything.** Having read the ride, the
   function checks `club_id IS NULL OR <caller holds a club_members row for it>` under the caller's
   own JWT. If that fails, it stops **before** the geocode. This is the whole remedy for the
   left-the-club path above: the money is spent at step 3, so the check belongs first.
   `private.is_club_member` is unreachable — PostgREST routes only to `public` — so the function
   reads `club_members` directly, which RLS already scopes correctly.
2. **Insert the ledger row.** Refused at the ceiling, and a refusal here costs nothing because
   nothing has been spent yet. Succeeding records the attempt *before* its outcome is known, which
   is the only ordering under which a failed geocode still counts.
3. **Geocode, render, upload.** The object names are generated by the function, so it holds them
   in memory from here on. That fact is load-bearing at step 4.
4. **Write the columns; on refusal, delete the objects it just uploaded.** A membership change
   landing between step 1 and step 4 still refuses the write, and this is the **one moment in the
   entire design when the orphan's path is still known**. The compensating delete is therefore
   mandatory rather than tidy-up.

**Steps 2 and 4 are deliberately on different tables.** The ceiling can refuse step 2 without ever
touching `rides`, so no ride write is ever aborted by a spend control.

Writing the columns *before* uploading was considered and rejected: it trades an orphaned object
for a row naming an object that does not exist, which renders as a broken image to every rider who
can see the ride, and the compensating action for *that* is a second write that can fail the same
way.

## Orphaned objects — one mechanism, two routes in

An object nobody can name is the shared end state of two different failures, and they are resolved
together rather than with two bolt-ons:

- **The address edit.** The stale-tile trigger NULLs the path columns, so the superseded object's
  name is gone from the row the instant the address changes.
- **The refused column write.** Step 3 above, when its compensating delete also fails.

The **primary** rule is ordering, matching the ride-deletion rule this proposal already got right:
**the caller deletes the old objects before issuing the UPDATE that clears them.** But that makes
cleanup depend on a client this change elsewhere refuses to trust, so it needs a recovery path, and
the recovery path is the mechanism:

> **The `ride-maps` SELECT policy carries an own-folder arm** — `foldername[2] = auth.uid()::text`
> **OR** the `EXISTS` against `rides`. An organizer can therefore list and delete anything in
> `ride-maps/<their own uid>/`, including objects no row names.

This grants nothing: the folder is keyed to the organizer, every object in it is a render of a
meeting point **they authored**, and no other rider gains a single byte. What it buys is that an
orphan stays *findable and deletable by exactly one accountable party* instead of becoming
permanently invisible litter — a rendered image of where an identified person previously intended
to be, retained indefinitely and uncounted.

An earlier revision of this proposal argued the opposite, that the own-folder arm should be
omitted so a deleted ride's tile stops being readable by its organizer. That reasoning was
backwards on the only axis that matters: without the arm the organizer cannot *delete* the object
either, so the tile survives anyway — unreadable, unlistable and permanent. The arm converts a
retention problem into a cleanup affordance.

**The sweep obligations that follow**, none of them a background job: the ride-edit action deletes
before it updates; the ride-delete action deletes before it deletes the row; the account-deletion
Edge Function sweeps the whole `ride-maps/<uid>/` prefix; and a rider's own orphans remain
reachable to all three.

## Who may cause a render

The function costs money and quota on every call, so this is an access-control rule, not a
politeness:

- **The ride's organizer, for a ride they organise** — and the check is *reading the ride under
  the caller's forwarded JWT and comparing `organizer_id` to the verified subject*, so RLS does
  the work rather than an `if` in the function.
- **Nobody else.** A crew member, a club admin, a club owner, a non-member, a blocked rider and a
  signed-out caller all get nothing. Enumerated per role in `specs/ride-map-tiles/spec.md`.
- **Bounded per ride, by a ledger the organizer can only ever add to.** See §Bounding the spend.

## Bounding the spend

An organizer editing `meeting_point` in a loop bills us on every pass, so the ceiling is aimed
squarely at the one role that *is* allowed to render. Two properties are required of it and they
pull in opposite directions, which is what makes the obvious design wrong:

1. **The organizer must not be able to lower it.** `rides` carries a table-level UPDATE grant this
   change deliberately keeps, so a counter column on `rides` would be client-writable — one
   `PATCH` setting it back to zero resets the ceiling that exists to bound the resetter.
2. **The organizer's own function call must be able to raise it.** The function runs as
   `authenticated` under the forwarded JWT. Anything `authenticated` cannot write, the function
   cannot write either.

A trigger owning a counter column satisfies (1) by discarding client-supplied values — and thereby
breaks (2), because it leaves no writer at all. **The only remaining writer is an `UPDATE` on
`rides`, and every failing render issues no `UPDATE`**: an empty geocode, a sub-floor confidence, a
city-level match, a vendor outage and a quota rejection all leave the columns NULL and save the
ride normally. So the count would rise only when a render *succeeded* — and the money is spent at
the geocode, not at the path write. The ceiling would bind exactly the organizers who were never
the threat, and miss the one who edits "the usual spot" ten times because the map will not appear.

**An append-only ledger satisfies both, and the reason is the direction of the adversary's
interest.** `authenticated` holds INSERT and SELECT on `ride_map_render_attempts` and nothing else.
The organizer can therefore only ever make the count go **up**, which is self-harm rather than an
attack; the operation they want — making it go down — has no grant and no policy behind it.

Three details carry the design:

- **The row is inserted *before* the vendor call.** A refused INSERT costs nothing, and a
  successful one has already recorded the attempt whether the geocode then returns a building, a
  city, or a 503. This is what makes it count **attempts**, not successes.
- **`attempted_at` is written by a `BEFORE INSERT` trigger, not a DEFAULT** — `034`'s ruling. A
  DEFAULT applies only when the column is omitted, and a client that can backdate rows outside the
  window has no ceiling.
- **The window is genuinely rolling**, because one row per attempt is exactly what a rolling window
  needs. An earlier revision stored a count and a window-start on `rides` and had to concede a
  worst case of 2× the ceiling across a boundary; the ledger removes that concession rather than
  documenting it.

**The ceiling refusal lands on the ledger's INSERT and never on the `rides` UPDATE.** That is not
incidental — it is what keeps the guarantee that a refused render never fails a ride write. An
organizer at their ceiling can still edit their own ride's address all day; they simply get no new
tile.

## Capabilities

### New Capabilities

- **`ride-map-tiles`** — the rider-facing contract. What each of the two containers renders in
  every state; who may see a tile and who must not; who may cause a render; what happens when the
  geocode is empty, unconfident, or the vendor is down; what attribution is required and what
  happens when it cannot fit; what an edit, a deletion and an account erasure do to a tile.
- **`stored-media-visibility`** — the cross-cutting contract for *reading* a stored object, and
  deliberately **not** folded into `ride-map-tiles`. Five folders already exist with a SELECT
  policy each and no written rule between them; the ride cover photo, the Journal's ride-scoped
  postcards and club media will each need the same answers. Two of its requirements have no home
  in the standing set today: that an object's read audience is its parent row's audience, computed
  under the caller's own RLS; and that a **signed URL is a bearer credential that outlives the
  policy which minted it**, which is true of every image this app already serves and is written
  down nowhere. This is `realtime-subscriptions`' reasoning applied to Storage.

### Modified Capabilities

- **`database-enforced-integrity`** — **`Storage object ownership SHALL remain database-enforced`**
  is MODIFIED. It states *"Fifteen `storage.objects` policies exist across five folders"*, which
  this change makes false — measured 2026-08-09, there are exactly 15 across `avatars`, `covers`,
  `club-avatars`, `club-covers` and `postcards`, and `ride-maps` is the sixth. A standing spec
  asserting a stale enumeration is worse than one asserting nothing. The delta also extends the
  requirement to cover an object whose folder is keyed to a rider but whose *audience* is decided
  by a row that rider does not solely control.

> **⚠ COORDINATION — this requirement is already modified by an active change, and OpenSpec will
> not warn you.** `add-account-deletion` carries a delta for
> `Storage object ownership SHALL remain database-enforced`. Archiving folds a delta in by
> replacing the requirement **wholesale**, so whichever change archives second silently discards
> the first one's edit. **Before archiving whichever of these goes second: re-read
> `openspec/specs/database-enforced-integrity/spec.md` as the first one left it and rewrite the
> delta against *that* text**, not against the version drafted here. The merged text is
> reconcilable — `add-account-deletion` extends the requirement toward deletion ordering and this
> one extends it toward read audience, and they touch different scenarios.

### Added, deliberately, rather than modified

- **`client-cache-invalidation`** gains one ADDED requirement — a cache entry holding a signed URL
  may not outlive the URL — and **modifies nothing**. `Stale data SHALL be bounded and visible`
  and `Counts SHALL stay per-viewer` are both already contested between `add-account-deletion` and
  the archived `add-ride-chat`, and making a third change fight over them buys a merge conflict
  and no clarity. Same call `add-ride-chat` made when it put its sign-out rule in
  `realtime-subscriptions` rather than in `client-session-storage`.

### Read and NOT modified — a claim, not an omission

- **`client-render-shell`** — both screens are bound by every one of its requirements and change
  none of them. `Every screen SHALL have a defined first-paint state` and
  `Every screen SHALL define its offline behaviour` are satisfied by `ride-map-tiles`' own state
  requirement, which has to enumerate more states than usual because a tile has a *fourth* zero
  case beyond the familiar three: the ride is visible, the rider is entitled to the tile, and the
  tile does not exist because the geocode failed. That is not an error, not a permission denial
  and not a loading state, and it is the normal state of every ride in the database today.
- **`database-enforced-integrity` / `A child table whose audience is NARROWER than its parent's`**
  — read, and deliberately **not** applied. See §The trap that is not this change's trap.
- **`tag-postcards-to-rides` / `Adding a column to a table with table-level grants SHALL be
  treated as granting it`** — this change is a textbook instance of it and **does not depend on
  it**. That requirement is not standing yet, and it also owns `041`. This change's migration states its grant level
  from `relacl` and `attacl` whether or not that change ever archives.

## The trap that is not this change's trap

`034` is the worked example of a child audience that is **narrower** than its parent's, and the
standing spec now carries the rule it produced: never let a `security definer` helper be the only
condition, because `private.is_ride_crew` steps past the block and private-club arms of the `rides`
policy and a `ride_members` row outlives both.

**A map tile is the opposite case, and applying `034`'s shape here would be a bug.** The tile
depicts `meeting_point`, which `RideCard` and `RideMap` already render **as text to everyone who
can see the ride**. So the tile's audience is exactly the ride's audience — no wider, no narrower
— and the audience-deciding condition is the plain `EXISTS` against `rides` under the caller's own
RLS that `postcard_comments`, `postcard_likes` and the `postcards` storage read policy all use.
Narrowing it to the crew would hide the tile from riders who are already reading the address it
draws, on a list screen where they can see every other field of the row.

(The policy also carries an own-folder arm, which admits **only** the organizer — a rider who can
already see the ride. It decides nothing about the audience and exists to keep orphans deletable;
see §Orphaned objects.)

The half of `034`'s lesson that **does** transfer is the mechanism, not the shape: the `EXISTS`
must run under the caller's own row security, and no `security definer` helper may stand in for
it. `private.is_ride_crew` must not appear anywhere in this change.

## Impact

**Database.** One migration. **Re-derive its number rather than reading one here** — an earlier revision of this line said `042`, which is now a different change's applied migration. Measured 2026-08-09 with `list_migrations` against
`ls supabase/migrations/`: **40 applied, 41 files** — `041_postcard_ride_tag.sql` is written and
unapplied and belongs to the active `tag-postcards-to-rides` change. **Do not read the next number
off `CLAUDE.md`**, which says 40 files and both projects at `040`; the file count moved when that
change wrote its migration and the applied count did not.

The migration is **purely additive**: **five nullable columns** on `rides`, **three CHECKs**, the
stale-tile trigger, **one new table** (`ride_map_render_attempts`) with its INSERT and SELECT
policies, its `attempted_at` trigger and its participation-gate trigger, three `storage.objects`
policies, and two indexes. Nothing is dropped, no existing policy is altered, no grant
is revoked. It is therefore safe to apply **before** the code that uses it deploys, and there is
no additive/destructive split to sequence — which is what makes §Deploy reality workable.

**Advisors.** Expect **eight, unchanged**, with `auth_leaked_password_protection` still the only
outstanding one. This change adds no `security definer` function at all: the render authority is
the caller's own JWT, and the stale-tile trigger runs as the table owner with EXECUTE revoked from
`public, anon, authenticated`, which is why `enforce_participation_gate` produces no finding
either. **A new WARN means a `revoke` did not land.**

**The participation gate.** `rides` already carries `enforce_participation_gate` (measured
2026-08-09 — `rides` has three non-internal triggers: the gate, `enforce_ride_club_audience`, and
`notify_ride_created_in_club`). The five new columns are covered by it on INSERT and UPDATE
through the existing trigger with no change. **`ride_map_render_attempts` joins the gate**, taking
it from nine tables to ten — it is a table `authenticated` can INSERT into, which is the gate's
whole criterion. The `storage.objects` policies are **not** covered —
per `CLAUDE.md`, no `storage.objects` policy carries the gate and all of them check the path
prefix only. That is stated in the spec as a known property rather than quietly inherited.

**Code.** New: `supabase/functions/resolve-ride-location/`, `src/lib/data/ride-map.ts` (or the
tile fields folded into the existing `RIDE_SELECT`), the signed-URL resolution beside
`signImagePaths`. Changed: `RideCard` (strip), `RideMap` (panel), `src/lib/actions/rides.ts`
(call the function after create and after an edit that moved `meeting_point`), `src/types/index.ts`.

**No new runtime dependency.** The render happens in Deno inside the Edge Function and the client
only fetches a JPEG. Nine runtime dependencies before, nine after — re-derive with
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**Tests.** The migration pairs with assertions in `supabase/tests/rls_test.sql` per
`openspec/config.yaml`. The whole audience rule is testable on plain Postgres, including the
`storage.objects` policies — the suite already asserts the five existing folders. **Two things are
not**, and are named as such rather than left to look covered: whether Supabase Storage honours
the SELECT policy on a *signed URL* after the policy stops matching (it does not — that is the
premise of the signed-URL requirement, and it needs the hosted project to demonstrate), and
whether the bucket's `allowed_mime_types` rejects a non-JPEG before any policy runs.

**Pre-flight — MEASURED 2026-08-09 against `zwprydcyryvudhurbnye`, service role via the Supabase
MCP, so these are true counts and not per-viewer ones:**

| Fact | Value |
|---|---|
| `rides` columns | 11 — **no latitude, no longitude, no image column**; `meeting_point text not null` |
| `rides` grant to `authenticated` | **table-level** `arwdDxtm` in `relacl`; `attacl` empty on every column |
| `profiles` grant to `authenticated` | `dDxtm` at table level + 8 per-column ACLs — the `025` precedent for revoke-and-regrant |
| Storage buckets | **one**, `media`, private, `allowed_mime_types = ['image/jpeg']`, 5 MB |
| `storage.objects` policies | **15** across 5 folders — 5 SELECT, 5 INSERT, 5 DELETE, all `authenticated`, **none UPDATE** |
| Shape of the 5 SELECT policies | **4 are `own-folder OR EXISTS(parent)` — a disjunction**; only `postcards` is the bare `EXISTS`. None is prefix-only |
| Shape of the 5 INSERT/DELETE policies | prefix and owner-folder only |
| `rides` non-internal triggers | `enforce_participation_gate`, `enforce_ride_club_audience`, `notify_ride_created_in_club` |
| `propagate_club_privacy_to_rides` body | `update public.rides set is_public = false where club_id = new.id and is_public` — touches `is_public` only |
| Migrations | **40 applied**, highest `040_locality_centroid`; **41 files**, highest `041_postcard_ride_tag.sql` (unapplied) |

**The fifth row corrects the brief this change was written from, and the correction is
load-bearing.** `CLAUDE.md` says `storage.objects` policies here *"check the path prefix only"*.
That is true of INSERT and DELETE and **false of SELECT**: all five read policies already carry an
`EXISTS` against the parent table, evaluated under the caller's RLS, which is exactly the
instrument this change needs. The pattern to copy already exists — the risk was never that it had
to be invented, it is that someone copies the *INSERT* shape into a SELECT policy and ships a
world-readable folder.

## Known gaps this change records rather than closes

- **A signed URL outlives the policy that minted it.** Every image in this app is already served
  this way; a rider who holds a URL keeps fetching the object until it expires, even after being
  blocked or after the club turns private. Bounded by a short TTL and stated as a requirement
  rather than fixed, because fixing it means abandoning signed URLs for every image surface.
- **A rider can forward a signed URL to someone with no account.** Inherent to the mechanism, not
  introduced here, and worth stating because a meeting point is location data about identified
  people.
- **`meeting_point` is transmitted to Geoapify.** A processor relationship and a privacy-policy
  change. It is an owner action and it blocks nothing in the build, but it must land before real
  riders geocode real addresses.
- **Attribution for `places` was settled by `PD-191`** (CDLA Permissive 2.0 + Apache 2.0,
  credited once on `/legal/attributions`), and this change carries a second obligation beside it.
  `CLAUDE.md` records that the Overture census names eight sources and zero OpenStreetMap, so the
  ODbL credit first assumed there is wrong. These are two different obligations from two different
  vendors and neither one satisfies the other — Geoapify's OpenStreetMap credit is unconditional,
  where Overture's is not ODbL at all.
- **No alerting when the vendor fails or quota runs out.** Error tracking is deliberately
  undecided; this change declines to invent it. The rider-visible behaviour is fully specified and
  the owner-visible behaviour is a function log nobody reads.
- **No rate limit beyond the per-ride render ledger.** Consistent with the rest of the app, which
  rate-limits nothing.
