# A postcard's location is a place the rider names, not a grid cell rounded off their photo

> **PD-275** is the issue, filed by the main thread while this was being written — so no id was
> available to the agent that wrote it, and everything attributed to the product owner here came
> through the spawning message rather than off the board. The owner has since answered `Q1`
> directly, in session, and that answer is recorded below and in `design.md` §Q1. Read this file
> against PD-275's comments rather than the other way round: the standing lesson is that a stale
> body gets corrected by a comment rather than a rewrite.

## Why

**`Region` describes the photo's coordinate, so it does not exist unless the photo has one.**
`064` shipped three modes — `Hide`, `Region`, `Precise` — all three of which are *reductions of an
EXIF GPS fix*. A photo without one gets no control at all: the composer renders the sentence
*"This photo has no location."* and the rider has no way to say where they were. That is the
common case, not the edge — HEIC, screenshots, and anything that has already been through another
app's share sheet carry nothing, which `064`'s own column comment says in as many words.

**The middle mode's hint is false for every postcard this composer has ever created.** It reads
*"Enough to place it on the ride."* — and `CreatePostcardForm` has no ride field, `createPostcard`
reads no `rideId` off its `FormData`, and `grep -rn "rideId" src/lib/actions/postcards.ts
src/components/postcards/CreatePostcardForm.tsx` returns nothing. So `postcards.ride_id` is NULL
on every row this form writes. The product owner reported the string as wrong *"when creating a
postcard from a club"*; it is wrong more broadly than that, and the fix is therefore one
context-free string rather than three conditional ones.

**"About a kilometre" is a unit, and a rider thinks in places.** The product owner:
*"'region' is no longer 1km. Change to nearest town or city. Maybe the word 'region' should be
something else too?"* A 2-decimal-place grid cell is a privacy mechanism described to the rider as
though it were a location. The town is the location; the rounding stays, but it becomes the
*mechanism* rather than the *promise* — see below, because that inversion is the most important
sentence in this file.

**Nothing displays a postcard's location today**, which is exactly why this is the moment to
change the model. `064` granted SELECT on the coordinate columns so a rider could read back what
they published, and no screen consumes them. Measured 2026-08-20: PROD holds **1** `precise` row
and 8 NULL; DEV holds **1** `region` row and 6 NULL. There is no display contract to break and no
meaningful backfill to argue about — the population of rows carrying the old `region` meaning is
one test row on DEV.

## What Changes

### The middle mode becomes a named place, and the composer gets an input

- **A location input renders between the `Location` label and the mode buttons**, always —
  whether or not a photo has been chosen and whether or not it carried EXIF. Product owner:
  *"Location fields always show regardless if there is a photo there or not."* It is
  `PlaceSearchField`, the control the ride composer already uses. (The working tree already
  carries the change that makes this possible: `names` became optional on 2026-08-20, so the
  field can be a pure controlled input that writes no form fields of its own.)
- **The input is prefilled from the photo** where it can be: a reverse lookup of the photo's EXIF
  coordinate, returning the nearest town or city. Where it cannot be — no EXIF, no connection, a
  spent ceiling, or the reverse mode not deployed — **the input is simply empty and the rider
  types**, with the same typeahead the ride form has. Product owner: *"We attempt to load the
  location from the photo, if not possible, the location input can be written with a location auto
  complete, just like we have in ride creation."*
- **`Region` is renamed `Town`** and its hint stops naming a distance or a ride. Proposed
  strings are in `design.md` §D1 and are contract, in the same way `064`'s three were.
- **`Precise` is offered only when the photo carried a coordinate.** A picked town's centroid is
  not a precise photo location and must never be stored under that marker. With no photo fix the
  control draws two buttons, not three greyed ones.

### One column on `public.postcards`, and one coordinate pair that keeps its meaning

| Column | Type | Meaning |
|---|---|---|
| `taken_place_name` | `text null` | The place the rider named — prefilled from the photo, typed, or picked |

**There is deliberately no provider-id column, and an earlier revision of this proposal specified
one.** The review pass caught what it costs: a `geoapify:` id is a pointer a place-details lookup
resolves back to the picked feature's **exact geometry**, so stored beside a deliberately
2dp-rounded coordinate it hands any reader of the row the precision the rounding exists to remove.
Arm 3 would have shipped a coordinate the CHECK calls coarse next to a pointer that is not. It was
also provenance bought for nothing at the time, nothing then rendering a postcard's location —
**that second clause expired on 2026-08-24 with PD-279 and the first is what the decision rests
on.**

**There is still exactly ONE coordinate pair, and `taken_location_precision` says whose it is.**
A second pair — the town's beside the photo's — would be the "stored but hidden" state `064`
forbids by construction: the precise value would sit on the server for every postcard whose rider
chose the town, and RLS is row-level, so any reader of the row reads it.

`taken_location_precision` gains `'place'`. `'region'` stays in the domain as **legacy** — it is
what the grandfathered rows carry and the client stops writing it. There is no backfill: naming
those coordinates would mean spending vendor credits to attach a town the rider never asked us to
attach, and nothing renders either value.

### The rounding CHECK survives, for a stronger reason than it was written for

`postcards_region_location_is_rounded` refuses anything not at 2 decimal places under a `region`
marker. The instinct on reading "the middle mode is a town now" is that the constraint has lost
its subject. **It has gained one.** A town centroid is rounded to 2dp before it is sent, and the
CHECK is then the only thing in the system that can tell the database *this coordinate is not
somebody's driveway*. Without it, a patched client could send a house's exact coordinate under the
`'place'` marker with the label `Utrecht`, and the postcard's audience would be looking at a house
that the app describes as a city. It is renamed `postcards_coarse_location_is_rounded` and
retargeted at both coarse markers. Full argument: `design.md` §D4.

### `search-places` gains a `reverse` mode, and the composer must not need it

The proxy has `search` and `locality`. Reverse geocoding a coordinate to a locality is a third
mode. **Deploying is an owner action and the deployed build on both projects is already behind the
repo**, so the composer is specified to treat the mode's absence as *"no prefill"* — never as an
error the rider has to read. The current build answers an unknown mode with `400 bad_request`
**before the ledger insert**, so an undeployed reverse mode costs zero credits and is
distinguishable from every other failure. `design.md` §D6.

### One shipped promise moves, and the owner decided how — `Q1`, ANSWERED 2026-08-20

The lookup fires **only when the rider taps `Town`**, never on upload: tapping it is the rider
asking where they were, which is the moment the request becomes one they made. Only the 2dp-rounded
coordinate is ever sent, so what leaves is a ~1 km cell rather than a fix.

`Hide`'s hint is reworded anyway, to *"LetsRide never stores the location of this photo."* —
**scoped to this app rather than to the world**, because a rider who taps `Town` and comes back has
had a rounded cell reach a geocoder, and "not stored anywhere" would be a promise about somebody
else's logs.

The rule that this copy must not be widened is recorded in
`src/components/postcards/CreatePostcardForm.tsx`, **not in `CLAUDE.md`** — an earlier revision of
this file said otherwise. `design.md` §Q1 carries the decision and the false premise the question
was first put on.

## Capabilities

### New Capabilities

None. Every requirement here belongs to a capability that already exists.

### Modified Capabilities

- `photo-capture-metadata`: the mode set, what each mode uploads, the composer's states, and
  which modes are offered for a photo with no fix.
- `database-enforced-integrity`: two columns, the absolute INSERT/SELECT grant lists, the
  replaced coupling constraint, the renamed rounding constraint, and the length bounds.
- `place-search`: a third proxy mode, its metering under the same ledger, and the rule that a
  lookup the rider did not ask for fails silently.

> **All three of these live only as deltas in unarchived changes, not in `openspec/specs/`.**
> `openspec/specs/` holds eight standing capabilities and `database-enforced-integrity` is the
> only one of the three among them. `photo-capture-metadata` exists at
> `openspec/changes/capture-photo-time-and-place/specs/`, whose `tasks.md` reads 3 of 81 boxes
> ticked while `064` is applied to **both** projects and the code has shipped; `place-search` is
> split across `replace-places-index-with-geocoder/` and `inline-place-search-with-recent-starts/`,
> both likewise shipped and unarchived. So the deltas below are written against text that is not
> yet standing. Each `MODIFIED` requirement names the file it modifies. **Archiving that backlog
> is a separate job and belongs to the main thread**, not to this change — but it is why an
> `openspec validate` on this change can look stranger than it is.

## Impact

**Schema** — `supabase/migrations/072_postcard_location_is_a_named_place.sql`. `071` is the
highest file, DEV is at `071` and PROD at `070` (measured 2026-08-20), and no in-flight proposal
claims `072`. Additive columns, one constraint replaced, one renamed, two absolute grant lists.
**No policy is touched and no trigger is added**, so `036`'s hand-exercise gate does not apply.

**Edge Function** — `supabase/functions/search-places/{index.ts,shape.ts}`. One new mode. The
repo will be ahead of both deploys the moment it merges, which is the ordinary state for this
directory and is why the client half is specified to work without it.

**Client** — `src/components/postcards/CreatePostcardForm.tsx`, `src/lib/media/location.ts`
(the resolver grows a third input), `src/lib/validation/postcards.ts`,
`src/lib/actions/postcards.ts`, `src/lib/data/places.ts` (a reverse read),
`src/components/ui/PlaceSearchField.tsx` (already carries the optional `names`).

**Tests** — `supabase/tests/rls_test.sql` (the grant-list pins and the constraint definitions
move, loudly, which is what they are for), `src/lib/validation/__tests__`,
`src/__tests__/place-search-shape.test.ts`, and the walk's create-postcard phase.

**Retention and deletion** — nothing new, stated because "the answer is obvious" is how an unstated
one gets inherited. Both columns live on `postcards`, whose `author_id` cascades from `profiles`, so
a rider deleting their account takes every place name they ever wrote with it, by the same path
`064`'s columns already take.

**Not in scope** — displaying a postcard's location anywhere. This change makes a display
*possible* for the first time and deliberately does not build one; a display is a separate
proposal with its own visibility questions about map tiles and deeplinks.
