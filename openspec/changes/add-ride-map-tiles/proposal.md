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

- **Four new columns on `public.rides`** — `latitude double precision`,
  `longitude double precision`, `geocode_confidence real`, and the two Storage object paths
  `map_card_path text` / `map_detail_path text`. All nullable; NULL is the normal state and the
  designed fallback, not an error.
- **Three CHECK constraints**, and the middle one is deliberately one-directional. A coordinate may
  not exist without a confidence at or above the floor (§The confidence floor); a **tile path may
  not exist without a coordinate**, while a coordinate **may** exist without a tile path, because a
  successful geocode followed by a failed render or upload is a real end state and a constraint
  requiring both would turn a partial failure into a write failure and lose the coordinate too; and
  both path columns are pinned to `'ride-maps/' || organizer_id || '/%'`, the shape `profiles` and
  `clubs` already use.
- **One `BEFORE UPDATE` trigger on `rides`** that NULLs all five columns when `meeting_point`
  changes. This is the stale-tile rule, and it is a trigger rather than a convention in
  `lib/actions/` because the client owns the mutation path and can decline to run a convention.
  It is scoped with `WHEN (old.meeting_point IS DISTINCT FROM new.meeting_point)` — **measured
  2026-08-09**: `propagate_club_privacy_to_rides` issues
  `update public.rides set is_public = false where club_id = … and is_public`, so an unscoped
  trigger would wipe every tile in a club the moment that club went private.
- **A sixth Storage folder, `ride-maps/<organizer uid>/<uuid>.jpg`**, with three policies matching
  the shape of the five folders that already exist — INSERT and DELETE pinned to the caller's own
  folder, SELECT joined to the parent row.
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
| **A place picker** | **PD-114.** When it lands it writes the same `latitude`/`longitude` columns with a known-good coordinate and the geocode guess is simply overwritten. This change must not block on it and must not build a second coordinate column for it to use |
| **`ends_at`, the location row's two-line address, `max_riders` enforcement** | Three other things `docs/FIGMA-FIDELITY-TODO.md` logs on these two screens. None of them is a map |
| **Error tracking for vendor failures** | `CLAUDE.md` lists error tracking as *deliberately undecided*. This change states what the rider sees on every failure and declines to invent the alerting channel that would tell the owner. Recorded as a KNOWN GAP and as an open question below |
| **Route rendering, turn-by-turn, an interactive map** | Decision #3, unchanged. `docs/FIGMA-FIDELITY-TODO.md` rules out the `output=embed` iframe by name and gives three reasons; none has expired |

## The confidence floor

`meeting_point` is free text, so geocoding it is a guess, and **a confident wrong guess is worse
than no map at all.** "The usual spot" geocodes to a city centre with high confidence in being
that city; a rider who trusts the tile rides to the wrong place. Today's screens are never wrong,
because they show the rider's own words.

**The floor is two-part, and the second half is the one that matters:**

1. **A granularity gate.** The match must be street-level or better. A city-or-district match is
   rejected **regardless of its confidence score**, because such a match is confident about the
   wrong question — it is sure it found the city, and a meeting point is not a city.
2. **A numeric floor of `0.70`** on the provider's `rank.confidence`, applied after the gate.

Chosen, not measured, and the reasoning is in `design.md` §D3. `0.70` is a starting value the
owner may move; the granularity gate is the part that should not be dropped.

**What the database can and cannot enforce here, stated rather than overclaimed.** The floor is a
*quality* rule about the geocoder's uncertainty, not a security rule about a hostile rider — the
organizer authors `meeting_point` and can already type a false address, so a coordinate that
disagrees with it is within their authority. What the CHECK enforces is the **coupling**: a row
may not carry a coordinate without also carrying a confidence at or above the floor, and may not
carry a tile path without a coordinate. That is an integrity rule, so it is a CHECK, per
`CLAUDE.md`'s rule that anything reaching only a Zod schema is advisory. The granularity gate has
no CHECK behind it and this proposal says so plainly rather than implying the database is holding
a line it is not.

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
- **The column write needs no elevation.** `rides` carries a **table-level** grant to
  `authenticated` — `relacl` is `arwdDxtm`, and `pg_attribute.attacl` is empty for every column —
  so the four new columns arrive client-writable the moment `alter table` runs, and the existing
  UPDATE policy (`auth.uid() = organizer_id`) already scopes them to the organizer.
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
already use. The alternative — revoking the table-level UPDATE and re-granting per column, the way
`025` did for `profiles` — buys protection against a rider vandalising their own ride and costs a
destructive migration plus the permanent inversion that every future column on `rides` arrives
with no UPDATE grant. Declined, and stated in the migration rather than left silent, which is what
`tag-postcards-to-rides`'s *"The default is stated for a table with no grant conversion"* scenario
asks for.

**And the cost that is not recoverable: there is no backfill.** No actor in this design is
entitled to render a ride it does not organise, which is exactly the property that keeps the
service-role key out. That is the right trade, and it is why §What Changes lists the backfill as
out of scope rather than as a later task.

## Who may cause a render

The function costs money and quota on every call, so this is an access-control rule, not a
politeness:

- **The ride's organizer, for a ride they organise** — and the check is *reading the ride under
  the caller's forwarded JWT and comparing `organizer_id` to the verified subject*, so RLS does
  the work rather than an `if` in the function.
- **Nobody else.** A crew member, a club admin, a club owner, a non-member, a blocked rider and a
  signed-out caller all get nothing. Enumerated per role in `specs/ride-map-tiles/spec.md`.
- **Bounded per ride.** An organizer editing `meeting_point` in a loop bills us on every pass.
  A stored render counter with a ceiling makes the limit database-enforced rather than a comment.

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
  it**. That requirement is not standing yet, and it also owns `041`. `042` states its grant level
  from `relacl` and `attacl` whether or not that change ever archives.

## The trap that is not this change's trap

`034` is the worked example of a child audience that is **narrower** than its parent's, and the
standing spec now carries the rule it produced: never let a `security definer` helper be the only
condition, because `private.is_ride_crew` steps past the block and private-club arms of the `rides`
policy and a `ride_members` row outlives both.

**A map tile is the opposite case, and applying `034`'s shape here would be a bug.** The tile
depicts `meeting_point`, which `RideCard` and `RideMap` already render **as text to everyone who
can see the ride**. So the tile's audience is exactly the ride's audience — no wider, no narrower
— and the correct policy is the bare `EXISTS` against `rides` under the caller's own RLS that
`postcard_comments`, `postcard_likes` and the `postcards` storage read policy all use. Narrowing
it to the crew would hide the tile from riders who are already reading the address it draws, on a
list screen where they can see every other field of the row.

The half of `034`'s lesson that **does** transfer is the mechanism, not the shape: the `EXISTS`
must run under the caller's own row security, and no `security definer` helper may stand in for
it. `private.is_ride_crew` must not appear anywhere in this change.

## Impact

**Database.** One migration, **`042`**. Measured 2026-08-09 with `list_migrations` against
`ls supabase/migrations/`: **40 applied, 41 files** — `041_postcard_ride_tag.sql` is written and
unapplied and belongs to the active `tag-postcards-to-rides` change. **Do not read the next number
off `CLAUDE.md`**, which says 40 files and both projects at `040`; the file count moved when that
change wrote its migration and the applied count did not.

The migration is **purely additive**: four nullable columns, one CHECK, one trigger, three
`storage.objects` policies, one index. Nothing is dropped, no existing policy is altered, no grant
is revoked. It is therefore safe to apply **before** the code that uses it deploys, and there is
no additive/destructive split to sequence — which is what makes §Deploy reality workable.

**Advisors.** Expect **eight, unchanged**, with `auth_leaked_password_protection` still the only
outstanding one. This change adds no `security definer` function at all: the render authority is
the caller's own JWT, and the stale-tile trigger runs as the table owner with EXECUTE revoked from
`public, anon, authenticated`, which is why `enforce_participation_gate` produces no finding
either. **A new WARN means a `revoke` did not land.**

**The participation gate.** `rides` already carries `enforce_participation_gate` (measured
2026-08-09 — `rides` has three non-internal triggers: the gate, `enforce_ride_club_audience`, and
`notify_ride_created_in_club`). The four new columns are covered by it on INSERT and UPDATE
through the existing trigger with no change. The `storage.objects` policies are **not** covered —
per `CLAUDE.md`, no `storage.objects` policy carries the gate and all of them check the path
prefix only. That is stated in the spec as a known property rather than quietly inherited.

**Code.** New: `supabase/functions/resolve-ride-location/`, `src/lib/data/ride-map.ts` (or the
tile fields folded into the existing `RIDE_SELECT`), the signed-URL resolution beside
`signImagePaths`. Changed: `RideCard` (strip), `RideMap` (panel), `src/lib/actions/rides.ts`
(call the function after create and after an edit that moved `meeting_point`), `src/types/index.ts`.

**No new runtime dependency.** The render happens in Deno inside the Edge Function and the client
only fetches a JPEG. Nine runtime dependencies before, nine after — re-derive with
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**Tests.** `042` pairs with assertions in `supabase/tests/rls_test.sql` per
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
| Shape of the 5 SELECT policies | folder pin **plus** an `EXISTS` against the parent row joined on path equality — *not* prefix-only |
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
- **Attribution for `places` is still unresolved**, and this change adds a second attribution
  obligation beside it. `CLAUDE.md` records that the Overture census names eight sources and zero
  OpenStreetMap, so the ODbL credit first assumed there is wrong and the commercial terms are
  unread. These are two different obligations from two different vendors and neither one satisfies
  the other.
- **No alerting when the vendor fails or quota runs out.** Error tracking is deliberately
  undecided; this change declines to invent it. The rider-visible behaviour is fully specified and
  the owner-visible behaviour is a function log nobody reads.
- **No rate limit beyond the per-ride render counter.** Consistent with the rest of the app, which
  rate-limits nothing.
