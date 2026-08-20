# Design — a postcard's location is a place the rider names

## Context

`064` (`capture-photo-time-and-place`, PD-255) is the file this change amends and its reasoning is
adopted whole. Read it first — `supabase/migrations/064_postcards_capture_time_and_place.sql` and
`openspec/changes/capture-photo-time-and-place/design.md` — because everything below either
extends one of its decisions or names the single one it overturns.

What `064` established, unchanged here:

- **The mode decides what is UPLOADED, not what is displayed.** RLS is row-level, so a reader of
  the postcard reads every granted column on it and a "do not show" flag could never be a privacy
  control. The reduction happens on the device, before the request is built.
- **NULL means Hide *and* "the photo carried nothing", indistinguishable on purpose.**
- **Insert-only.** No UPDATE grant reaches these columns; the one remedy for a regretted
  disclosure is deleting the postcard.
- **A coordinate is a claim, not evidence.** It comes from the rider's own file.

What this change overturns: **`Region` was a reduction of the photo's coordinate, and it becomes a
place the rider names.** Every consequence below follows from that one move.

Measured on both projects 2026-08-20, before anything here was written:

```
postcards, grantee 'authenticated' — IDENTICAL on DEV (fpmrimzxadewsaiwpsel) and PROD (zwprydcyryvudhurbnye)
  INSERT  author_id,caption,club_id,id,image_path,ride_id,taken_at,taken_at_offset_minutes,
          taken_latitude,taken_location_precision,taken_longitude
  SELECT  author_id,caption,club_id,created_at,id,image_path,taken_at,taken_at_offset_minutes,
          taken_latitude,taken_location_precision,taken_longitude,updated_at
  UPDATE  caption,club_id,image_path
```

`064`'s own header warns that PROD's SELECT list still carried `ride_id`. **It does not any more**
— `062` promoted with `070` on 2026-08-19 — so the two projects agree for the first time since
that file was written, and §1.2 of `tasks.md` re-measures anyway rather than trusting this
paragraph.

Row population, same date: PROD `precise` **1**, NULL **8**; DEV `region` **1**, NULL **6**. The
entire population carrying the old middle-mode meaning is one test row on DEV.

## Goals / Non-Goals

**Goals**

- A rider can say where a postcard was taken **whether or not the photo knows**.
- The middle mode names a place instead of quoting a distance, and its hint is true for every
  postcard — club, app-wide, ride-tagged or not.
- `Hide` keeps meaning that nothing is stored, *including* a town the rider typed by hand.
- The database can still tell a coarse location from a precise one, without trusting the client.

**Non-Goals**

- **Displaying a postcard's location.** Nothing renders these columns today and nothing here
  starts. This change makes a display possible for the first time; building one is a separate
  proposal, because it raises map-tile spend, deeplink and per-audience questions this one does
  not answer.
- **Editing a location after posting.** `064`'s insert-only decision stands; the remedy is
  delete, and `grep -rn "updatePostcard\|editPostcard" src/` still returns nothing.
- **A ride tag on the composer.** The false hint is fixed by rewriting the string, not by
  building the ride picker whose absence made it false.
- **Backfilling the grandfathered `region` rows.** §D9.

## Decisions

### D1 — The wording: `Town`, and a hint that names no distance and no ride

> **SUPERSEDED 2026-08-20, in three places — the label, the control's shape, and the strings.**
> The label is `Region` (see the note under *Rejected labels*), the control is always three
> segments (D2's note), and the table below is a snapshot of what this change proposed rather than
> what shipped: the two saving modes' sentences are **conditional on what would actually be
> stored**, because a mode selected with an empty field was telling riders a place was saved when
> none was. The strings and that logic live in `src/components/postcards/locationCopy.ts`, with
> `resolveLocationCopy`'s tests holding them. What survives below unchanged is the *reasoning* —
> no distance, no ride, and `Precise` written to make a rider hesitate.

The label is **`Town`**. The three-segment control reads **Hide · Town · Precise**, and where the
photo carries no fix it reads **Hide · Town**.

| Mode | Lead (bold) | Hint |
|---|---|---|
| `Hide` | **Nothing is saved.** | No location is stored with this postcard. |
| `Town` | **Only the town is saved.** | Whoever can see this postcard sees the town, never the exact spot. |
| `Precise` | **Saved exactly.** | Anyone who can see this photo can see where you took it. |

`Precise`'s pair is `064`'s, unchanged and deliberately so — it is the one string in the block
whose job is to make a rider hesitate.

**`Hide`'s hint changed, and `Q1` is ANSWERED.** Product owner, 2026-08-20: fire the lookup only
once the rider taps `Town`, and reword the hint anyway. The shipped string is
*"LetsRide never stores the location of this photo."*

**It is scoped to LetsRide rather than to the world, and that is a correction rather than a
hedge.** The owner asked for *"The photo's location is never stored anywhere"*; a rider who taps
`Town`, is shown a lookup and comes back to `Hide` has had a ~1 km cell reach a geocoder, so
*anywhere* would be a promise about somebody else's logs. What this app stores is a promise this
app can keep.

**The rule about not widening it is recorded in `src/components/postcards/CreatePostcardForm.tsx`,
not in `CLAUDE.md`** — an earlier revision of this file cited the wrong place, which costs a reader
who greps `CLAUDE.md`, finds nothing, and concludes the constraint is imaginary. The recorded rule
is also narrower than it was used for here: *widened* there means broadening `Hide`'s **subject**
beyond the location, which is what PD-265 settled on 2026-08-18 when it decided `Hide` must not
also cover the capture time.

> **SUPERSEDED 2026-08-20 — the label is `Region` after all, and the marker is still `place`.**
> The owner shipped `Town`, then hit the case this section did not consider: a rider in the
> Pyrenees names a mountain range, and *"maybe region is better?"* `Region` was rejected here as
> "the word the owner asked to replace", which was true of `Region` **meaning a ~1 km cell** and is
> not true of it meaning a place a rider names; the other four rejections stand. **This note is
> scoped to the label** — D1, D2 and D3 carry their own supersession notes. The stored marker deliberately did NOT follow the label back: `'region'` is
> still live in `taken_location_precision` under `064`'s meaning (arm 5 of `073`'s coupling, one
> DEV row), so reusing the string would give one word two meanings in one column. Label `Region`,
> marker `place`, and `CreatePostcardForm`'s `LOCATION_MODES` carries the note.

**Rejected labels.** `Region` — the word the owner asked to replace. `Place` — collides with the
picker's own vocabulary, and reads too close to `Precise` at a glance in a three-across control.
`Nearby` — says how far, not what. `Area` — a unit again, which is the failure being fixed.
`Town or city` — accurate and too wide for a segment; the *hint* can carry "or city", the button
cannot.

**`Town` is the default and not a restriction, and the hint has to survive that.** The typeahead
is the geocoder's autocomplete and it returns streets and buildings, not only localities — that is
precisely why `070` retired the Overture index. A rider can therefore name their own street in a
field labelled `Town`. Two ways out, and `Q2` puts the choice:

- **Filter the field to locality-class results** (the recommended one), which makes the label and
  the hint literally true, at the cost of one optional field on the proxy request.
- **Or soften both strings** — *"Only the place named above is saved."* / *"…sees that place,
  never the exact spot."* — which is true whatever the rider names and needs no proxy change.

Either way **the coordinate stored under `Town` is rounded** (§D4), so a rider naming their street
discloses the street's *name* and never better than a ~1 km cell of its position. The name is the
rider's own words about their own postcard; the coordinate is the thing the schema has to bound.

**Provenance of the strings, labelled rather than assumed.** The committed snapshot's two Create
postcard frames (`1918:16843`, `1918:17056`) contain no Location block, no input and none of these
strings — re-verified offline 2026-08-20 with `npm run figma -- text <id> --all`, which returns
six and four strings respectively, all of them the caption/club/photo furniture. `064` recorded
the same. These are **owner-supplied wording proposed by this change**, not read from the design.

### D2 — The input renders always; `Precise` does not

> **SUPERSEDED 2026-08-20 — `Precise` renders always too.** The reasoning below is sound and its
> premise stopped holding the same week: it assumed the only exact coordinate on the screen comes
> from the camera. Every HEIC reached the composer with no fix at all — `exif.ts` read JPEG only —
> so the button was absent for every photo the product owner tried, with nothing on screen saying
> why, and it read as a feature that had been taken away. `resolvePhotoLocation` now has a second
> exact source, a place the rider **picked**, stored unrounded; a **typed** place still cannot
> become a precise location, which is the half of the argument below that was load-bearing. The
> refusal of a *disabled* segment is untouched — the control is live in every state, and where
> neither source exists it resolves to `hide`'s answer and says so.

Product owner: *"Location fields always show regardless if there is a photo there or not."* So the
`Location` block — icon, label, input, buttons — mounts unconditionally, where today the whole
block is gated on `upload.status === 'done'`.

**`Precise` is a different question and gets a different answer.** It means *the exact spot this
photo was taken*, and with no EXIF fix there is no such spot. A picked town's centroid stored
under `'precise'` would be a lie told by the schema about the rider's own privacy choice — the
exact failure `064`'s single `resolvePhotoLocation` function exists to make unrepresentable.

So: **no photo fix, no `Precise` button.** Not disabled — removed. This is `064` §D8's rule
("replace the control, do not disable it") applied one level down: a disabled segment still draws
a label and still reads as a choice somebody made, and a radiogroup with a dead option is worse
for a screen reader than one that never offered it.

The submit button stays gated on the photo (`disabled={!ready}`), so a named town can never be
submitted without one.

### D3 — One coordinate pair, and the marker says whose it is

The tempting shape is four columns: the photo's pair and the town's pair. **It is the "stored but
hidden" state under a new name.** A row would carry the precise fix for every postcard whose
rider chose the town, RLS is row-level, and `064`'s whole argument is that there is no narrower
audience available for a column than the row it sits on.

So there is one pair, and `taken_location_precision` says what it is:

| marker | `taken_place_name` | `taken_latitude/longitude` |
|---|---|---|
| NULL | NULL | NULL |
| `'place'` | **required** | the place's centroid, **rounded**, or NULL |
| `'precise'` | optional | an exact fix, unrounded — the photo's own, or a **picked** place's where the photo carries none (2026-08-20) |
| `'region'` | NULL | a rounded photo fix — **legacy, §D9** |

**There is no provider-id column**; see the proposal's own note. It looked like free provenance and
it is a pointer back to exact geometry, which is the one thing a deliberately rounded coordinate
must not sit beside.

Three things this table decides, each of which would otherwise be decided by whoever wrote the
migration:

- **`'place'` with no coordinate is legal** — the rider typed a town and never picked one, so
  there is a name and no pin. This is `PlaceSearchField`'s free-text case, which the ride form
  already relies on, and refusing it would make the typeahead a gate rather than an accelerator.
- **`'precise'` carries no `place_id`.** The id is provenance *for the stored coordinate*, and
  under `precise` that coordinate came from the camera. An id naming a town beside a coordinate
  that is not the town's would make one column mean two things.
- **`'precise'` may carry a name, and the name may disagree with the coordinate.** §D5.

### D4 — The rounding CHECK is kept, renamed, and is doing MORE work than before

`postcards_region_location_is_rounded` currently reads: a `'region'` row's coordinates must equal
themselves rounded to 2 decimal places. The obvious reading of this change is that the constraint
has lost its subject, because a town centroid is not a rounded photo fix.

**Invert it.** The constraint never checked *provenance*; it checked *coarseness*, and coarseness
is exactly the property the middle mode still needs. Concretely, without it:

> A patched client sends `taken_place_name = 'Utrecht'`, `taken_location_precision = 'place'`, and
> the author's own front door as the coordinate. The database accepts it. The postcard's audience
> is shown a house and told it is a city.

That is a worse outcome than the one the constraint was written for, because it now comes with a
label that actively misdirects. So:

- **The town's centroid is rounded to 2dp in the browser before it is sent**, exactly as the
  photo's coordinate used to be, through the same `roundToCoarseGrid` helper.
- **The constraint is renamed `postcards_coarse_location_is_rounded`** and covers both coarse
  markers: `taken_location_precision not in ('region','place')` or the coordinates are at 2dp.
  A NULL coordinate passes, which is the `'place'`-with-no-pin arm.

**Renaming means dropping and re-adding in a new file**, which is not editing an applied
migration — `067` set that precedent explicitly when it replaced `rides_geocode_coupling`. The
rename is deliberate rather than cosmetic: the old name says `region`, the live coarse marker is
`place`, and a constraint whose name contradicts its predicate is how the next reader concludes it
is dead.

**Rounding a centroid costs nothing.** A locality centroid is already an arbitrary point inside a
polygon kilometres across; moving it by up to ~1.1 km of latitude changes which pixel a future map
draws and nothing else, and `taken_place_name` carries what the rider actually meant regardless. `roundToCoarseGrid` uses `Math.round(v*100)/100`, and `064` measured that any
`integer/100` satisfies the Postgres predicate, so the JS/Postgres halfway-case disagreement
(4.895 → 4.89 vs 4.90) still cannot fail this.

**The rejected alternative — drop the constraint.** It would leave the middle mode's coarseness
resting entirely on `roundToCoarseGrid` running in a browser this app does not control, which
`CLAUDE.md` names as advisory in as many words: *"a rider can simply not run your validation."*
The client owns the mutation path here; the CHECK is the only thing that is not a suggestion.

### D5 — When the rider's town contradicts the photo: which wins, and can they disagree

Three states, and each has one answer:

**Under `Town`, the rider's place wins completely.** The photo's coordinate is not sent, in any
form, at any precision. The name and the stored coordinate describe the same place *by
construction*, because only one of them exists — there is nothing to disagree with. A rider who
photographs their driveway and names `Amsterdam` publishes Amsterdam, and that is the feature.

**Under `Precise`, the photo wins for the coordinate.** The exact fix is what is stored, whatever
the input says. The name, if the input holds one, is stored beside it **and may disagree**.

**That disagreement is deliberate and it is cosmetic.** Two candidate rules were weighed:

- *Store the name only when it is the one the app resolved from this photo's own coordinate.*
  Enforceable in the client by identity, unenforceable in the database, and it silently discards
  a name the rider is looking at — the failure `PlaceSearchField` calls "showing a value the write
  will not store", in the direction that loses the rider's work.
- *Store whatever the input holds.* Adopted. The name cannot reduce what `Precise` already
  discloses, so there is no privacy consequence; a rider mislabelling their own postcard is the
  same class of act as writing a wrong caption, and `CLAUDE.md` is explicit that a guarantee which
  can only ever reach a Zod schema is not a guarantee.

**The direction that must be impossible is the other one**, and it is: a rider who chose `Town`
cannot have the photo's fix stored. That is enforced twice — the composer never puts it in the
DOM, and §D4's CHECK refuses a `'place'` row whose coordinate is not coarse.

### D6 — The `reverse` mode, and what the composer does without it

`ProxyRequest` grows `mode: 'search' | 'locality' | 'reverse'`, carrying `at: {lat, lon}` instead
of `text`, and answering `{ place: PlaceResult | null }`. It is metered on the same ledger, in the
same order — verify the JWT, refuse an anonymous session, parse, **insert the ledger row, then
call the vendor** — because a reverse lookup spends exactly the credit a search does.

**The composer must work without it, and the current build makes that cheap.** Read the deployed
handler: `parseRequest` runs *before* `caller.from(LEDGER).insert(...)`, and it returns `null` for
any mode it does not recognise, which the handler answers as `400 {"error":"bad_request"}`. So
against today's deployed build a `reverse` request:

1. writes **no** ledger row and spends **no** credit, and
2. returns a code — `bad_request` — that no other failure on this path produces.

So the client can tell "this build has no reverse mode" from "the lookup failed", and the required
behaviour follows: **remember it for the page load and stop asking.** No retry, no per-photo
re-probe, no message. The input is empty and the rider types, which is precisely the state the
owner already specified for "if not possible".

**Degradation is silent for the prefill and loud for the rider's own search.** A lookup the rider
did not ask for must never produce an error they have to read — `getLocalityCentroid` already
takes exactly this line ("degrades to `null` on ANY error"), for the same reason. A search the
rider *did* ask for keeps `PlaceSearchField`'s existing four messages unchanged.

**Deploy state, measured 2026-08-20 by reading the repo against the two projects rather than this
paragraph.** `search-places` was first deployed 2026-08-19 at 15:51Z/15:52Z against `71053cd`, and
`#274`, `#275` and `#276` are undeployed on both — so the deployed build is already stale before
this change adds to it. That is the ordinary state for `supabase/functions/`, it is why PD-267
exists, and it is the whole reason the client half above is a *requirement* rather than a nicety.

### D7 — What the prefill sends, and the promise it collides with

**Only the 2dp-rounded coordinate is ever sent for a prefill.** Not the fix. A town-level reverse
lookup does not need better than ~1 km, so this costs nothing in answer quality and it keeps the
precise value on the device for every mode except the one where the rider asked for it to leave.

The rule, stated so it can be tested: **the unrounded coordinate leaves the device only as part of
a `precise` write the rider explicitly chose.** Nothing else — not a lookup, not a bias, not a
log — may carry it.

**As written that is prose, not a gate**, and the review pass is right that this repo's idiom for a
universal negative is a tripwire that fails the build — `src/__tests__/no-service-role-key.test.ts`,
`src/lib/data/__tests__/isomorphic.test.ts`, `src/__tests__/use-server-exports.test.ts`. The
tripwire this wants asserts that the only reader of `ExifCapture.latitude`/`longitude` outside
`resolvePhotoLocation` is the rounding helper. Filed rather than built here.

**It still collides with `Hide`'s shipped hint**, because the prefill fires while the mode reads
`Hide`, and *"The photo's location never leaves your phone"* admits no rounded exception. That is
`Q1`, and it is the most dangerous thing in this change: the failure mode is not a bug report, it
is an app that quietly stopped keeping a promise it still prints on the screen.

### D8 — The spend arithmetic, and the memo that keeps it survivable

`069` gives each rider **20 lookups an hour** and 60 a day, and the ledger row is written before
the vendor call, so an aborted request still spent it. A prefill is one lookup **per composed
postcard**, unasked for.

Twenty postcards in an hour exhausts the hourly ceiling on prefills alone, and the rider then
cannot search for anything — including the town the prefill failed to find. Six stops on a ride,
the case this feature is actually for, costs six.

Three rules keep it bounded, and none of them adds a ceiling:

- **No fix, no call.** A photo with no EXIF coordinate triggers nothing.
- **One call per composer, at most.** The prefill fires on upload completion, never on a
  keystroke, and never twice for the same file.
- **Memoised for the page load on the rounded coordinate.** Six photos from one stop cost one
  lookup, because their 2dp cells are equal. This is free — the rounding already happened.

Where a ceiling *is* hit during a prefill, the input stays empty and nothing is said (§D6). Where
it is hit during the rider's own typing, `PlaceSearchField` shows `069`'s existing hourly/daily
message, which already ends *"or type the location in"* — which is now literally true here,
because a typed name is a first-class stored value (§D3).

### D9 — The grandfathered `'region'` rows: nothing happens to them, deliberately

Measured: **one row, on DEV, and none on PROD.** More rows may exist by the time `072` applies,
because the current build is live on both projects.

**They are left exactly as they are.** No backfill, no rewrite, no deletion.

- **A backfill would spend vendor credits to attach a town to a coordinate the rider never asked
  us to name**, and it would attach it to somebody else's postcard. That is a new disclosure
  performed on a rider's behalf, which is the one move `064`'s architecture is built to prevent.
- **Nothing reads the column.** There is no display consumer, so a `'region'` row and a `'place'`
  row are indistinguishable to every screen in the app — because both are invisible.
- **`'region'` stays in the CHECK's domain**, so those rows stay legal, and the coupling arm for
  them keeps `taken_place_name` NULL, which is what they actually hold.

**The client stops writing `'region'` and the database does not enforce that**, which is a stated
gap rather than an oversight. A dated CHECK (`precision <> 'region' or created_at < '<apply
date>'`) *would* be safe — `created_at` is server-owned since `044` and an already-stored row
cannot later fail it — and it is rejected because it buys nothing: a stray `'region'` row from a
patched client is a correctly-shaped, correctly-rounded coarse location that no screen renders.
The value at stake is zero and the cost is a hardcoded date in the schema that nobody can read the
intent of in a year. Once the grandfathered rows are gone, `'region'` can be dropped from the
domain by a one-line migration.

### D10 — `Hide` clears everything, including what the rider typed

`Hide` means **nothing is stored** — not "nothing from the photo is stored". A rider who types
`Utrecht`, reads the hint, and taps `Hide` has said no.

Mechanically: under `Hide` the composer renders **no location hidden inputs at all**. Not empty
ones — none. `064` §D10 already requires that the precise coordinate never enter the DOM, and this
extends the same rule to the name and the id, for the same reason: a form serialiser, an
extension or a captured DOM reaches anything that is in the document, and an empty-valued field is
still a field whose presence says something.

**This is why `PlaceSearchField`'s `names` had to become optional.** With `names` passed, the
field writes four hidden inputs of its own from the pick, unconditionally — so a picked town would
be submitted under `Hide` by a control that has no idea the mode exists. The composer therefore
uses the field as a pure controlled input (`value`/`onChange`) and renders its own hidden inputs
from a single resolver, exactly as it does today for the coordinate. **One writer, one place where
the marker and the values are produced together or not at all** — which is `src/lib/media/
location.ts`'s founding rule and the reason `resolvePhotoLocation` is one function rather than a
branch at the call site.

The working tree already carries that `names?:` change, with a doc block naming this composer as
the reason.

### D11 — Swapping the photo clears the location, all of it

`onFileChange` already resets the mode to `Hide`, because *"a rider who picked Precise for a shot
of the coast road and then swapped in one taken at home must not inherit the first photo's
answer."* The same argument reaches the name: a town resolved from photo A is a false statement
about photo B.

A name the rider *typed themselves* is arguably theirs to keep, and keeping it would mean holding
"where this name came from" as state and treating the two differently. **Clear everything.** The
cost is retyping a town on a photo swap; the cost of the other choice is a wrong location attached
to a photo, silently, which is the failure class this whole block exists to prevent. `Q3`.

### D12 — No recents on this field

`PlaceSearchField` takes an optional `recents` loader and the ride forms pass
`getRecentRideStarts`. The postcard composer passes **nothing**.

A rider's recent *ride starts* are meeting points — car parks, laybys, cafés — and offering them
as answers to "where was this photo taken" would put a specific, previously-typed location one tap
away from a field whose whole purpose is to be coarse. A recents list of recent *postcard towns*
is defensible and is not built here; it needs its own read, its own cache key and its own answer
to "does a recent list leak where you have been to a shoulder-surfer", which is a real question
for a control that opens on focus.

### D13 — Who can see the location: nobody new, and no policy changes

Stated explicitly rather than left to the migration author, because `openspec/config.yaml` says an
unstated visibility rule *"silently becomes whatever the migration author assumed."*

**The two new columns ride on the postcard's own audience and add no reach whatsoever.**
`postcards`' SELECT policy is untouched by this change; the columns sit on `postcards`; RLS is
row-level; so exactly the set of riders who can already read the row can read the name and the id,
and nobody else. Every role, spelled out:

| Role | Reach |
|---|---|
| **The author** | Reads their own postcard and therefore its location. This is why `064` granted SELECT at all — a rider must be able to read back what they published |
| **A club member**, where `club_id` is set | Reads it exactly as they read the caption |
| **A club ADMIN** (`club_members.role = 'admin'`, which `001` has had all along) | Reads exactly as a member does, and no more. `private.is_club_member` does not discriminate on role, so the role confers no extra reach on this table and no moderation over it — `postcards` UPDATE stays `author_id`-keyed. Stated because `openspec/config.yaml` names admin in the roles a proposal must enumerate, and an earlier revision of this table omitted it: the unstated role is the one that gets assumed |
| **A non-member**, where `club_id` is set | Reads nothing — the row is invisible, so the columns are |
| **Any signed-in rider**, where `club_id` is NULL | Reads it. `club_id IS NULL` **is** the app-wide audience, and a rider choosing that audience is publishing the town to every rider on LetsRide |
| **A blocked rider** (either direction) | Reads nothing. `009`'s policy carries the `private.is_blocked` conjunct and blocking is symmetric; the row does not exist for them, so neither do these columns |
| **A rider who hid the postcard** (`postcard_hides`) | Does not see the row in their feed, so does not see the location |
| **`anon`** | Nothing, on any column, in any verb. Decision #1, and `072` issues no grant to it |
| **The club owner holding no `club_members` row** | Reads it, via `054`'s owner arm on `private.is_club_member` — same as any member, and stated because it is the case a spec forgets |

**No new policy is needed and none is added.** A `WITH CHECK` addition would be the only candidate
— to refuse a name on a postcard whose club the author is not in — and it is unnecessary: the
existing INSERT policy already refuses the whole row in that case, so there is no row for a column
to hang off.

**The participation gate is already on this table**, so an account that never accepted the terms
cannot write these columns any more than it can write a caption.

### D14 — Where each rule lives

| Rule | Enforced by | Reachable by a patched client? |
|---|---|---|
| A coarse location is coarse | `postcards_coarse_location_is_rounded` | No |
| Name/coordinate/marker arrive in a legal combination | `postcards_taken_location_coupling` | No |
| The marker is one of three known values | same | No |
| A name fits its column | `postcards_taken_place_name_length` (200) | No |
| Nothing is writable after insert | the absent UPDATE grant | No |
| The location is only as visible as the postcard | `postcards` SELECT policy + per-column grant | No |
| `Hide` sends nothing | the composer | **Yes — and it costs the rider only their own privacy, never anyone else's** |
| The name describes the coordinate under `precise` | nothing | **Yes — cosmetic, §D5** |
| `'region'` is not written any more | nothing | **Yes — inert, §D9** |
| Only a rounded coordinate is sent to the vendor | the client | **Yes — same shape as `Hide`: self-inflicted** |

The pattern is `064`'s and it is worth restating: **every rule whose violation could affect
another rider is in the database; every rule whose violation can only hurt the rider who broke it
is in the client.** A row of this table that says "Yes" and involves a third party would be a
defect in this design.

## Risks / Trade-offs

- **The prefill weakens a shipped promise.** §D7, `Q1`. Highest-consequence item here.
- **The proxy will be ahead of both deploys.** Mitigated by design, not by hope: the composer's
  behaviour without the mode is a *specified state* with its own scenarios, and the undeployed
  path costs zero credits.
- **`Town` is a label on a field that can hold a street.** §D1, `Q2`.
- **Two grant lists get rewritten.** This is the third absolute rewrite of `postcards`' lists
  (`044`, `046`, `062`, `064`), and `044`/`046` are this repo's worked example of a list written
  from a document silently reinstating what a previous file removed. §1.2 of `tasks.md` is a gate,
  not a step.
- **The composer's Location block grows from a static three-button control to a metered network
  read.** It is the first place in the app where *opening a form* can spend a rider's ceiling.
  §D8 bounds it; a future "postcards near me" feature would need to revisit the arithmetic.

## Migration Plan

`072` is **additive plus two constraint replacements**, touches no policy and adds no trigger, so
`036`'s hand-exercise gate does not apply and it may be applied before the code that writes the
new columns deploys. Order within the file: columns → bounds → replace coupling → replace rounding
→ INSERT grant → SELECT grant → comments. **No UPDATE statement of any kind**, which is `064`'s
mechanism for insert-only and is the single easiest thing in this file to break by being helpful.

DEV first, then PROD after the promotion build is confirmed serving — but note that unlike `070`
nothing here is destructive to a running client: an old client that never sends the new columns
writes rows that satisfy every arm of the new coupling, because they are the `'region'`, `'precise'`
and all-NULL arms. So the ordering constraint is the ordinary one, not `069`/`070`'s.

## Verification — measured, inferred, and outstanding

**Measured** (2026-08-20, against the live projects, commands in `tasks.md`): both grant lists on
both projects; the six existing CHECK definitions on `postcards`; the row population by marker on
both projects; that `071` is the highest migration file and no in-flight change claims `072`;
that both Create postcard frames carry no Location strings; that neither the composer nor
`createPostcard` handles a `rideId`.

**Inferred, and labelled as such** — the geocoding vendor's reverse endpoint shape. `shape.ts`'s
own header records that `*.geoapify.com` is egress-blocked from this container, so the reverse
response type will be **written from documentation, not from a measured payload**, exactly as
`AutocompleteFeature` was. `tasks.md` carries the task that replaces it with a real payload, and
until that runs it is the single most likely thing in the directory to be wrong.

**Outstanding** — whether the vendor's reverse endpoint can be constrained to locality-class
results in one call (`Q2`), and every question below.

## Questions

Each carries a recommended default so nothing stalls, per `CLAUDE.md`. **`Q1` is the only blocking
one and it is the product owner's alone.**

### Q1 — BLOCKING, owner only. May a prefill send a rounded coordinate off the device while the mode still says `Hide`?

`Hide`'s shipped hint says *"The photo's location never leaves your phone."* A prefill makes that
false, even at 2dp.

**ANSWERED 2026-08-20 — fire the lookup only when the rider taps `Town`, and reword the hint
anyway.** Product owner's call. Tapping `Town` IS the rider asking where they were, so the delay
this was thought to cost is not a delay past the useful moment; it lands on it.

**The question as first put rested on a false premise, found by the review pass**, and it is
recorded rather than deleted because the same premise is easy to re-derive. Firing later does
**not** on its own keep *"The photo's location never leaves your phone"* intact: the place field
mounts unconditionally and `PlaceSearchField` resolves `resolveRiderLocation()` on first focus,
sending the rider's **current** position to the vendor as a proximity bias — 2dp-rounded, never
prompting, and never mentioned by any spec file here. That is a different and often more sensitive
datum than the photo's. The shipped hint survives it only because it is scoped to what LetsRide
**stores**, and a bias is not stored. Whether that bias belongs on this screen at all is filed
rather than settled.

### Q2 — Non-blocking, owner or designer. Should the field offer only towns and cities?

**Recommended default: yes** — add an optional locality filter to the proxy's `search` mode,
defaulting to today's behaviour so the ride form is untouched. It makes the label `Town` and its
hint literally true. If declined, take §D1's softened strings instead; the change ships either way
and the difference is two strings and one optional request field.

### Q3 — Non-blocking, build decision. Does swapping the photo clear a town the rider typed by hand?

**Recommended default: yes, clear everything** (§D11). The alternative holds provenance state to
treat typed and resolved names differently, for the sake of saving one retype.

### Q4 — Non-blocking, designer. Two labels, or one?

The block header says `Location`; the input inside it needs its own accessible label. Proposed
`Town or city`, with placeholder *"Search for a town or city"*.

**Recommended default: two visible labels** — the section names the concept, the field names what
to type. A visually-hidden field label is the alternative and reads as one label in a screen
reader, which is arguably worse.

### Q5 — Non-blocking, follow-up. Should anything display a postcard's location?

Out of scope here and worth filing: after this change the app stores a human-readable place name
for the first time, and still renders it nowhere.

**Recommended default: file it, do not build it.** A display raises map-tile spend, deeplink and
per-audience questions that belong in their own proposal.
