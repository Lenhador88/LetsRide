# A club says where it is based — required at the creation gate, and nowhere else

> Linear **PD-446**. This file is the specification; the issue points at it and must not restate it
> (`CLAUDE.md` §The roadmap lives in Linear).
>
> **The issue body AND its comments were read.** The only comment is the territory marker
> (`slot: 1`, `migration: N`, `primitive: Y`) and it adds no correction. Its `primitive: Y` is spent
> here: §3 adds one prop to `src/components/ui/PlaceSearchField.tsx`.
>
> **The issue asks for its numbers to be re-measured rather than quoted, and they were** (§Why).
> **One thing the issue asks for is not buildable as described** and is resolved rather than left
> open: §The pre-fill.

## Why

`ExploreClubsStrip`'s near count, the distance split on `/clubs/explore` and PD-259's whole premise
read `clubs.location_name` / `latitude` / `longitude`, and the field was optional by a decision both
`clubSchema` and `CreateClubForm` record in as many words: *"Create club is the app's shortest
creation flow and a required field is a new wall in front of it. A club with no location still
appears on Explore; it just cannot be sorted by distance."*

**Re-measured 2026-09-08, as the issue instructs:**

```sql
select count(*) as clubs, count(location_name) as with_location from public.clubs;
```

| | clubs | with a location |
|---|---|---|
| DEV `fpmrimzxadewsaiwpsel` | 15 | 15 |
| PROD `zwprydcyryvudhurbnye` | 2 | 2 |

**The evidence is gone and the cause is not**, exactly as the issue predicted. Both databases were
filled by hand after the defect was found — PROD by the product owner, DEV set to Amsterdam across
all fifteen — so the 1-in-15 measurement cannot be reproduced. What can be reproduced is the
mechanism: an optional field on the shortest creation flow in the app, feeding three surfaces that
are useless without it. Every club created between now and a gate is another row that can never
appear in a near-you list, and only its owner can fix it.

**The rider-visible outcome is that "clubs near you" stops being a header over an arbitrary sort.**

## Shape — and the sentence a later reader must not misread

**Required at the creation gate. The column stays permanently nullable, every read tolerates NULL
for ever, and existing clubs are untouched.** No `NOT NULL`, no backfill, no migration.
`clubs_location_coupling` (`066`) already requires the four columns to move together or all stay
null, so the CHECK needs nothing.

**This is therefore NOT an integrity rule, and the distinction is the most important sentence in
this proposal.** `CLAUDE.md` is explicit that a rule living only in a Zod schema is advisory,
because the client owns the mutation path — and that is *correct here rather than a violation*,
because the rule is not about what a value may be. The database's statement about a club's location
is unchanged: it may be absent, for ever. What changes is what one screen refuses to submit.

Two consequences follow and both are specified:

- A rider who defeats the client gate creates a locationless club and **is not refused by anything**.
  That is accepted, not a hole, because such a club is indistinguishable from the 17 that already
  exist.
- **Nothing downstream may start assuming a non-null location.** No non-null type, no `!`, no
  `location_name` read without a null branch, no distance sort that treats absence as zero. The
  existing readers already do this correctly — `src/lib/data/clubs.ts` carries
  `if (!near || item.latitude === null || item.longitude === null) return item` — and this change
  must not tempt anyone out of it.

## What changes

### 1. The schema splits in two, and that is the whole trap

`clubSchema` is parsed by **both** `createClub` and `updateClub` in `src/lib/actions/clubs.ts`.
Making `clubSchema.location` non-nullable would gate **editing** too: a club owner could not change
their club's name, description, avatar or privacy until they added a location — for the 17 clubs
that exist today, and for every club created before this ships. The issue excludes exactly that
(*"Clubs that already exist are untouched by a creation gate"*), so a single shared schema cannot
express it.

- **`clubCreateSchema`** — `clubSchema` with `location` required. Used by `createClub`, and by
  `CreateClubForm`'s focus-the-rejected-field effect, which parses the same schema so the two cannot
  disagree.
- **`clubSchema`** — unchanged, `location` still nullable. Used by `updateClub` and `EditClubForm`.

The two SHALL share one body and differ in one field, rather than being two hand-maintained copies.

### 2. The form gates on the pick, and does NOT disable its submit

The label drops `(optional)`; the helper text — *"Riders looking for a club near them will find
yours. This is the club's own location, not yours."* — stays, unchanged and already correct.

**The submit stays `disabled={busy}` and is not gated on the location**, and this is a deliberate
departure from the onboarding step's pattern rather than an oversight. `CreateClubForm`'s own header
records why: *"a disabled submit here read as the resting state of an untouched form and left the tab
order early, so this moves focus to the schema-rejected field instead."* That decision was made for
this form, with six controls on it. The onboarding town step has one control and one question, where
a disabled submit reads as *answer this* rather than as *this form is inert* — so the two screens
correctly do different things.

The refusal is therefore `clubCreateSchema`'s, the message is a field message, and the existing
effect moves focus to the field. **The focus move must actually reach the visible search input**
(§The pre-fill, last paragraph) — today it would not, and that is a defect this change has to fix
rather than inherit.

### 3. The pre-fill

The issue asks for the field to arrive *"pre-filled with the rider's own resolved position"*.
**That is not buildable as described**, and the reason is measured rather than argued:

- `resolveRiderLocation()` returns `{ lat, lon, source }` — `RiderLocation` in
  `src/lib/location/rider-location.ts` has exactly three fields.
- `getLocalityCentroid(text)` returns `{ lat, lon }`.
- A `PlaceValue` needs `name` **and** `placeId` **and** `lat` **and** `lon`, and
  `clubs_location_coupling` requires all four columns to arrive together.

So no device fix and no geocoded centroid can produce a valid pick. Seeding a *value* from a resolved
position cannot be built.

**Chosen: seed the SEARCH TERM, promoted on the field's FIRST FOCUS — never on mount.** The form
reads the rider's own town through `getMyLocationText()` (their `profiles.location`, already cached
under `queryKeys.profile.location()`), and passes it to `PlaceSearchField` as an initial query. On
the field's first focus, and only then, it becomes the input's draft and the lookup's term, so the
rider sees their own town's real geocoded suggestions and picks one. **The rider still picks.**

Three properties make this the right shape rather than a compromise, and each is a rule already in
the primitive:

- **No mount-time lookup.** `PlaceSearchField` deliberately separates `searchTerm` from the visible
  text precisely so the edit forms' seeded text cannot call a metered vendor 400 ms after render;
  `069`'s ledger row is written before the vendor call, so that spend cannot be taken back by
  aborting. Seeding on mount would reintroduce exactly that, on every Create-club screen open.
- **Focus is already the moment this component spends things.** Its header: *"Resolved on the
  field's FIRST FOCUS, not on mount — a form carrying this field must not locate a rider who never
  touches it."* The seed follows the same rule for the same reason.
- **No field that looks answered but is not.** The naive version — seed the draft at mount — is
  worse than useless: `onBlur` runs `if (!freeText) setDraft(null)`, so the seed **erases itself**
  the first time the rider blurs, and until then it displays text that a submit would not store. On
  first focus instead, a rider who never focuses the field sees it empty, which is the truth.

**Rejected: (b) auto-search and auto-pick the first result.** It stores a location the rider never
chose, on a row only its owner can fix, and spends a vendor credit on every Create-club screen open
whether or not the rider ever reaches the field. The gain over the chosen option is one tap; the cost
is a wrong club location that nobody will notice until a rider searches near them.

**Rejected: (c) no pre-fill at all.** It is the honest floor and it stays the fallback if the prop
turns out to cost more than it buys — but the cost measured is one optional prop and a `useQuery`
against a key that already exists, against a wall the code itself says it was avoiding.

**One defect found on the way in, and it is in scope.** `CreateClubForm`'s error effect focuses
`form.elements.namedItem(path[0])`. For a location refusal `path[0]` is `'location'`, and no element
has that name — in place mode the visible input carries no `name` and the hidden `location_name` is
not focusable. So today the message would appear and focus would silently not move, for the one field
this change makes required. The build must route that path to the visible input.

## Sequencing — there is none

No migration, no policy, no constraint, no arming file. One bundle, no deploy-order constraint and no
promotion gate. **Stated explicitly so a later reader does not go looking for a SQL file.**

## The negative cases

Eight. The full scenarios are in `specs/`; this is the index.

1. **Submit with no location.** Refused by `clubCreateSchema`, with a message naming the field:
   **"Pick where your club is based."** Chosen to match the four existing messages' voice
   (*"Give your club a name."*, *"Pick a place from the list."*) and to name the *action* — pick, not
   type — because typing is exactly what does not work here.
2. **A place name typed and never picked.** Still refused, nothing stored. The visible input carries
   no `name` in place mode, the draft reverts on blur, and the hidden inputs read through the pick —
   `PlaceSearchField`'s standing rule, restated here because this change is the first time a refusal
   depends on it.
3. **A club created before this change, edited afterwards.** The edit SHALL succeed with the location
   still NULL, and `updateClub` SHALL write all four columns as NULL exactly as it does today. This
   is the schema-split case and it is the reason there are two schemas.
4. **A club owner adding a location on edit.** Still works, unchanged, through the same field with
   the same four names.
5. **No `profiles.location` and no device grant.** The pre-fill does **nothing** — no seed, no
   lookup, no prompt — and the form works normally: focus, type, pick. The pre-fill SHALL NOT fall
   back to a device fix, because a device fix cannot produce a pick (§3) and because reaching for one
   here would raise an OS prompt on a screen that has not explained why.
6. **A partial set — three of four hidden fields.** `readClubLocation` already returns `null` for
   anything short of all four, so the create gate then refuses it with the same message as case 1.
   Correct, because a partial can only come from a form the rider never completed. Pinned so a later
   "helpful" partial-object return breaks a test rather than a club.
7. **`latitude` or `longitude` of exactly `0`.** `Number('')` is `0`, a real coordinate in the Gulf
   of Guinea, so `readClubLocation`'s emptiness test is on the **string** and never on the parsed
   number. Unchanged — and the new gate SHALL NOT be implemented as a truthiness test on a
   coordinate, which would refuse a genuine club on the equator or the prime meridian.
8. **The clubs that still carry NULL.** `/clubs/explore` and `ExploreClubsStrip` change in no way:
   they already return locationless clubs unsorted-by-distance rather than hiding them, and a club
   with no location is not a hidden club. Stated as a negative rather than left silent, because
   "required at creation" is one short step from "filter out the ones without it".

### Who may do this — every role, stated

Creating a club is unchanged by this proposal and is restated because `openspec/config.yaml` asks:
any signed-in, onboarded rider may create a club and becomes its owner (`054`, `104`). **An
un-onboarded rider is refused by `023`'s participation gate**, not by this form. **A signed-out
visitor reaches no part of this**: `/clubs/new` is not a public path, the guard sends them to
`/auth/login`, and `anon` holds no grant on `clubs`. **A blocked rider** is unaffected in either
direction — blocking governs visibility and membership, and this change touches neither.

**No role gains or loses a reach here.** A club **admin**, **member** or **non-member** still cannot
set or change a club's location; only the owner can, through `updateClub`, exactly as before.

## Out of scope, deliberately

- **Any migration.** No `NOT NULL`, no backfill, no CHECK change. `clubs_location_coupling` already
  says everything the database says about this.
- **Prompting existing club owners to add a location on their own club page.** The issue calls this
  undecided and deliberately excludes it, and this proposal does not want it: it is a different
  decision (who gets nagged, on what screen, how often, and what happens when they decline) with a
  different owner. Named here so the exclusion is a decision rather than an omission.
- **Filtering or hiding locationless clubs anywhere.** See negative case 8.
- **A distance predicate in SQL, or an index on the coordinate.** `066` §4's reasoning stands: an
  index before a SQL-side distance predicate is a write cost the planner never reads.
- **Making the ride forms' location required.** `rides.meeting_point` is free text with search as an
  accelerator by an explicit product decision (`ride-start-location`); nothing here reopens it.
- **Any change to what `PlaceSearchField` does for its ride callers.** §3's prop is optional and
  additive; the rides' behaviour is asserted unchanged.

## Impact

- **Affected specs:** `database-enforced-integrity` (ADDED ×1), `client-render-shell` (ADDED ×1),
  `ride-start-location` (MODIFIED ×1 — the *One picker SHALL exist* requirement, because this change
  is the third caller extending it).
- **Affected code:** `src/lib/validation/clubs.ts`, `src/lib/actions/clubs.ts`,
  `src/components/clubs/CreateClubForm.tsx`, `src/components/ui/PlaceSearchField.tsx` (one optional
  prop, plus the input handle the focus fix needs), and their tests.
- **Not affected, asserted as negatives rather than left as silence:** every SQL file;
  `clubs_location_coupling`; the `clubs` RLS policies and every role's reach into them;
  `readClubLocation`'s string-emptiness rule; `CLUB_LOCATION_FIELD_NAMES`; `updateClub` and
  `EditClubForm`; `/clubs/explore`, `ExploreClubsStrip` and every reader in `src/lib/data/clubs.ts`;
  the ride forms and `rides.meeting_point`; and the 17 clubs that exist today.
