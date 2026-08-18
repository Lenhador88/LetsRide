# Capture a photo's time and place at upload — and let the rider decide, once, what leaves the phone

> Linear **PD-255**. This file is the specification; the issue points at it and must not restate
> it. `CLAUDE.md` §The roadmap lives in Linear: *"A Linear issue that grows a specification is a
> bug."*

## Why

**`postcards.created_at` is when a postcard was POSTED, and `044` made sure it can never be
anything else.** That file is right and is not being reopened: the home feed sorts and pages on
`created_at`, so an author who could write it could pin themselves to the top of every feed
permanently. `authenticated` holds neither INSERT nor UPDATE on it — measured on the applied
chain below.

The consequence is a ride Journal that is a lie about the day. A rider who photographs six stops
between 09:00 and 17:00 and uploads them over dinner produces six postcards all stamped 21:xx, in
whatever order the uploads happened to finish. **The Journal is the one screen whose entire
content is "when did this happen"**, and the column it would have to sort on is the column `044`
deliberately took away from the rider.

**The real capture time exists, and so does the place, and both exist for exactly one moment.**
A JPEG off a phone carries `DateTimeOriginal` and a GPS IFD in its EXIF block.
`src/lib/media/compress.ts` destroys that block as a side effect of the canvas re-encode — canvas
has no metadata channel, so nothing survives `drawImage` + `toBlob`, which is the EXIF-stripping
guarantee this app already relies on. So the window is: **after the file is picked, before
`compressImage` runs.** After that there is nothing left to read, ever.

That stripping is not a problem to work around; it is the property that makes this change safe.
**The uploaded object carries no location at all**, so after this change the coordinate columns
are the *only* server-side copy of where a photo was taken — and when the rider chooses `Hide`,
there is no copy anywhere.

**Why this needs a proposal rather than a ticket**, in one sentence:

> **RLS is row-level. A policy that lets you read the postcard lets you read every granted column
> on it, so there is no way to show a photo and hide where it was taken — which means the only
> place the decision can be made is before the request is built.**

That is not a style preference. The obvious implementation — store the precise coordinate, add a
`show_location boolean`, respect it in the UI — puts every rider's driveway on the server and
makes one policy mistake, one widened projection or one future admin screen a disclosure of home
addresses. This change stores nothing it is not willing to publish to the postcard's audience.

## What Changes

### Five nullable columns on `public.postcards`

| Column | Type | Meaning |
|---|---|---|
| `taken_at` | `timestamptz null` | When the photo was taken, from `DateTimeOriginal` |
| `taken_at_offset_minutes` | `smallint null` | The UTC offset that reading was made in, so the camera's own wall clock is recoverable |
| `taken_latitude` | `double precision null` | Where, as the rider chose to disclose it |
| `taken_longitude` | `double precision null` | " |
| `taken_location_precision` | `text null` | `'region'` or `'precise'`. NULL is *Hide, or no location* |

**The offset column is the answer to `Q1`, which is now closed** — see the zone section below. It
is here rather than in a follow-up because **an offset is unrecoverable after the fact**: the
instant is stored in UTC, the EXIF is gone the moment `compressImage` ran, and nothing anywhere
remembers what zone the phone was in. Deferring it does not postpone the cost, it discards the
data — the same argument as reading EXIF before the strip, one layer up. It would also mean a
*second* revoke-and-regrant of this table's INSERT and SELECT lists, which is the pair `044` and
`046` already cost this repo once.

`double precision` and the `latitude`/`longitude` spelling follow `051_ride_map_tiles.sql`, which
added exactly those to `rides`. (`places` uses `lat`/`lon`; `rides` is the closer precedent and
the one followed.) The `taken_` prefix is load-bearing: **where the photo was taken is not where
the postcard was posted**, and a bare `latitude` on this table would be read as the second within
a year.

### Three modes, chosen per photo, and the mode decides what is UPLOADED

Settled by the product owner before this proposal was written. Restated with the reasoning
because the reasoning is what a later reader needs; not reopened here.

1. **`Hide` — the default.** No coordinate leaves the device. The three columns stay NULL.
2. **`Region`** — the coordinate is rounded **in the browser, before the request is built**, to
   **2 decimal places**, and the rounded value is what is sent. `taken_location_precision` is
   `'region'`.
3. **`Precise`** — the full value is sent. `taken_location_precision` is `'precise'`.

**The rounding happens on the device, not on the server**, and that is the whole decision. Storing
the precise value with a "do not show" flag would put the exact spot on the server for every photo
and make one policy mistake a disclosure. This way there is nothing to disclose.

**2 decimal places, and the design settles it**: the Region hint reads *"Rounded to about a
kilometre."* 3 decimals (~110 m) is still a street, and on a rural road still a house. The
rejected alternative and the measured cell size are in `design.md` §D2.

### The composer's Location block

`LocationOutlineIcon` + the label **Location**, then a three-segment control, then a hint line
whose lead clause is bold. The three hint strings are contract and are asserted as written:

- **Hide** — "**Nothing is saved.** The photo's location never leaves your phone."
- **Region** — "**Rounded to about a kilometre.** Enough to place it on the ride."
- **Precise** — "**Saved exactly.** Anyone who can see this photo can see where you took it."

**The existing `src/components/ui/ButtonGroup.tsx` IS the v2 segmented control and is reused.** No
new primitive, no new dependency.

**Provenance, labelled rather than assumed.** The committed `design/` snapshot's two Create
postcard frames (`1918:16843`, `1918:17056`) contain **no** Location block and none of these three
strings — verified offline, `npm run figma -- text <id> --all` and a grep of `design/` for
`Precise` returns nothing. The strings and the block above are **owner-supplied from a mock that
is not in the snapshot**. They are decided either way, so nothing is blocked; it is recorded so
that the next `figma:pull` reconciles rather than surprises, and so nobody reads "the design says"
as "the snapshot says". `design.md` §D3.

### The database owns every rule, because the client owns the mutation path

Six CHECK constraints, not six Zod rules. `CLAUDE.md`: *no new integrity rule may live only in a
Zod schema.* Zod carries the **message**; the CHECK carries the **guarantee**.

- **`taken_at <= now()`.** A future capture time is impossible and would pin a photo to the top of
  a journal. `now()` in a CHECK is accepted by Postgres and is safe **here specifically**: the
  predicate only ever becomes *more* true as time passes, so a dump/restore revalidation cannot
  fail on a row that once passed. Measured on Postgres 16 — `design.md` §D4.
- **`taken_at >= '1995-01-01'`**, not `1900-01-01`. **This is a correction, and it is measured:**
  a 1900 floor admits epoch-0 (`1970-01-01`) and 1904 Mac dates, which are the two garbage values
  the floor exists to catch. `DateTimeOriginal` was introduced with EXIF 1.0 in **October 1995**,
  so a value predating the tag's own specification is garbage by construction. `design.md` §D5;
  `Q2` is closed on that measurement.
- **Coordinate bounds and the pairing rule, in one CHECK, copying `051`'s shape exactly.** Both
  coordinates present or both absent, **and** the precision marker present exactly when the
  coordinates are, **and** the bounds — latitude in `[-90, 90]`, longitude in `[-180, 180]`.
  `rides_geocode_coupling` (`051`) is the same constraint on the same two column names one table
  over, coupling `latitude`/`longitude`/`geocode_confidence` and carrying the identical bounds; it
  was read off the applied chain rather than remembered, and this file copies it rather than
  inventing a second idiom. Three legal shapes and no others: all NULL (Hide, or no EXIF
  location), or all three set. Measured refusing each of the four half-states.
- **`taken_at` and its offset arrive together** — `(taken_at is null) = (taken_at_offset_minutes
  is null)`. There is exactly one writer and it always knows an offset, so the coupled shape is
  free, and it means no reader ever has to guess what a bare instant's wall clock was. Same idiom,
  same `051` shape.
- **The offset within `[-1440, 1440]`, deliberately permissive.** `OffsetTimeOriginal` is `±HH:MM`,
  so a camera with a wrong setting can legitimately write `+23:00`; a CHECK tight to the real world
  (`-720 … 840`) would refuse a rider's post over a camera setting they cannot see. The client's
  clamp keeps garbage out; this CHECK bounds the column.
- **A `region` row really is at two decimal places** —
  `taken_location_precision <> 'region' or (taken_latitude = round(taken_latitude::numeric, 2)::float8 and …)`.
  **Measured on DEV 2026-08-18** across nine values: it accepts anything already at two places,
  rejects anything else, and is idempotent. It is what turns `Region` from the rider's word into a
  database fact — a row marked `region` discloses **at most** two decimal places. The obvious worry
  is the wrong one and `design.md` §D2 says why: the predicate asks whether the value *is* at two
  places, never whether it equals Postgres's rounding of an original the database never saw, so
  JS's `4.89` and Postgres's `4.90` for `4.895` both pass and there is nothing to reconcile.
### Grants: insert-only, and it costs zero statements

**`authenticated` gets INSERT and SELECT on the five columns and no UPDATE, ever.**

The reason it is free is measured rather than argued. `044`, `046` and `062` between them made
**all three verbs column-level** on `postcards`, so a column added today arrives with **nothing** —
verified on the applied chain inside a rolled-back transaction:

```
alter table public.postcards add column probe_col timestamptz null;
-- authenticated: select=false insert=false update=false, no grant rows at all
```

So the migration issues an absolute `revoke insert` + `grant insert (…)` and an absolute
`revoke select` + `grant select (…)`, **and does not mention UPDATE at all**. Leaving UPDATE alone
is what produces the insert-only outcome; *touching* it is the `044`/`046` trap, where an absolute
re-grant list written from a document instead of the database silently reinstates `id` and
`author_id`. `tasks.md` §1 requires both lists be read off
`information_schema.column_privileges` at write time, scoped to grantee `authenticated`, and not
off this file — **and the two databases currently differ**: PROD's SELECT list still carries
`ride_id` because `062` is unpromoted, so a re-grant built from PROD would silently undo it.
`064`'s list is `062`'s seven columns plus the five new ones and **still no `ride_id`**; measured
on both refs 2026-08-18.

**The consequence, decided rather than discovered: a rider who realises they published their
driveway has exactly one remedy — delete the postcard.** That is accepted. It is honest, it is a
screen the app already has, DELETE is table-level and its policy is `author_id = auth.uid()`, and
deleting the row destroys the only copy of the coordinate. A narrow "widen or clear, never
sharpen" UPDATE affordance needs a trigger comparing old and new precision *plus* an edit screen
that does not exist — `grep updatePostcard\|editPostcard src/` returns nothing. Named as follow-up
in `tasks.md` §7, not built. `design.md` §D6.

### The EXIF read: hand-rolled, on the original File, before compression

A new `src/lib/media/exif.ts` parsing **only** the APP1/Exif segment of a JPEG for
`DateTimeOriginal`, `OffsetTimeOriginal`, and the GPS IFD's four tags, returning `null` for
everything it cannot read and **never throwing**. **No new runtime dependency** — nine before,
nine after. `CLAUDE.md`: *ask whether a thirty-line helper does the job.* `exif-js` and its
relatives parse maker notes, thumbnails, IPTC and XMP; this app wants four tags.

**The ordering is a requirement, not an implementation note.** `readExifCapture(file)` runs on the
**original `File`**, before `compressImage`. After compression there is nothing left to read, and
a reviewer who moves the call one line later produces a feature that silently always returns
nulls — with no error, no failing test that anyone thought to write, and a composer that
truthfully says the photo has no location.

### `DateTimeOriginal` is zone-less, and the answer is the offset AND the fallback

`DateTimeOriginal` is `YYYY:MM:DD HH:MM:SS` with **no zone**. `OffsetTimeOriginal`, when the
camera writes it, is the honest answer and wins.

**When it is absent the wall clock resolves in the DEVICE's own offset at the capture date — and
whichever of the two was used is stored, in `taken_at_offset_minutes`.** `Q1` asked which of those
two to do and the answer taken is **both**; they compose rather than compete.

`src/lib/media/exif.ts` shipped in `e4d8cab` resolving the fallback through `wallClockToUtc`
(`APP_TIME_ZONE`) with a real argument — it *round-trips*, because the Journal's formatters are
pinned to the same zone, so a camera that recorded 12:15 draws 12:15. **What this proposal adds is
the bound that argument was written before:**

> A rider in Helsinki photographs at 12:00 EEST (09:00 UTC). Resolved as Amsterdam wall clock that
> is 10:00 UTC — **one hour in the future** — so `taken_at <= now()` refuses it; and because the
> reader clamps an out-of-bounds value to `null` rather than letting a rider be refused, the real
> outcome is that **`taken_at` is silently NULL** and the photo falls out of the Journal's timed
> group. Every zone east of `Europe/Amsterdam` has this, in proportion to its offset, for exactly
> the window in which riders post.

**Why both halves rather than either.** The device offset alone makes the *instant* right in the
common case — the phone that shot it is the phone uploading it — but leaves the wall clock
unrecoverable, so a Journal pinned to `APP_TIME_ZONE` still draws 11:00 for that Helsinki rider's
12:00 photo, which is exactly the loss `wallClockToUtc` was chosen to avoid. The column alone
would record a wrong instant precisely. Together the instant is right, the camera's own reading
round-trips for any renderer for ever, and **`taken_at <= now()` becomes structurally safe rather
than nearly safe** — the device's clock and its offset are self-consistent with `now()`, so the
bound stops firing on honest riders in every zone rather than only in one.

`CLAUDE.md`'s reason for pinning `APP_TIME_ZONE` does not reach here: it exists because an
unpinned *formatter* renders one zone during the prerender pass and another on hydration. This is
an **event handler on a picked file**, producing an absolute instant immediately — no render, no
hydration, no second reader of the wall-clock string. `wallClockToUtc` stays exactly as it is and
**`src/lib/utils.ts` is not edited** (PD-262 owns that file this session); the resolution is a
function in `exif.ts`. This is also `CLAUDE.md`'s own stated correct model for ride times —
*"wall-clock at the meeting point, which needs a zone column on `rides`"* — applied to a photo.

**Two traps that come with it, both silent, both unit-tested:** the offset must be the device's
offset **at the capture date** (a July photo uploaded in December records `+120`, not `+60`), and
`getTimezoneOffset()` returns minutes *behind* UTC, so it must be negated. `design.md` §D7.

A clamp goes with all of it: if the computed instant is in the future or below the floor, `exif.ts`
returns `null` for **both** `taken_at` and the offset — together, because the coupling CHECK
refuses a half pair. The CHECK remains the guarantee; the clamp keeps a garbage tag from costing a
rider their photo, and under this answer it fires almost never rather than being the ordinary path
for a whole region.

### Photos with no EXIF are the common case, and the composer says so

Most photos will carry nothing: screenshots, saved images, cameras with location services off,
anything already through another app's share sheet — and **HEIC, which is what an iPhone shoots by
default** and whose metadata is in ISOBMFF boxes rather than a JPEG APP1 segment. All of them fail
to the safe answer.

**Decision: when there is no location, the three-segment control is not rendered at all.** The pin
and the **Location** label stay, and the control and hint are replaced by one quiet line:

> **This photo has no location.**

Not a disabled control. A disabled `ButtonGroup` still draws three labels and a selected pill,
which reads as *a choice the rider made* about a photo that has no location to choose about — and
`role="radiogroup"` with every option disabled is a worse answer for a screen reader than a
sentence. `design.md` §D8.

**Time and location are independent, and each is answered on its own.** Time with no location →
the line above, and `taken_at` is still captured. Location with no time → the control renders
normally, `taken_at` stays NULL.

### The mode is NOT remembered between uploads

Every upload starts at **Hide**. The issue names the risk exactly — *"a remembered Precise is the
one setting that could surprise someone later"* — and two things make it decisive:

- **Nothing in this change renders a coordinate**, so a remembered `Precise` misfiring is
  invisible at the moment it happens and stays invisible afterwards. A default whose failure mode
  cannot be seen is not a default, it is a trap.
- **Remembering it needs somewhere to live.** `localStorage` on web and secure storage in the
  native shell — and the standing `client-session-storage` requirement *Sign-out SHALL destroy
  every local trace of the rider* would then have to reach it. A privacy setting that survives
  sign-out on a shared device is a worse outcome than one extra tap.

### Nothing renders the coordinate, and that is stated rather than left implied

No screen in this change draws a location, a place name, a map or a distance. **The five columns
are not added to `POSTCARD_SELECT`**, so they reach no payload on any screen — the grant exists
ahead of its reader, which is exactly the state `041` left `ride_id` in and which PD-165 and `062`
had to undo. The grant is issued anyway, for two reasons that are decisions rather than habit: a
rider must be able to see what they published, and the Journal's `ORDER BY taken_at` needs the
column privilege (Postgres checks a column reference in an `ORDER BY` exactly as in a target list
— `062` §4 measured the same thing for a predicate).

So the next screen inherits whatever this change decides, and what it decides is: *the audience of
these columns is the audience of the postcard, there is no narrower one available, and the
narrowing already happened on the device.*

### Journal ordering — a rule PD-257 inherits, and no Journal screen here

**No Journal screen is built by this change.** The Journal is PD-257 and `tag-postcards-to-rides`
is still in flight. The ordering rule is stated here as a requirement so it is inherited rather
than re-decided:

- Postcards **with** a `taken_at` sort on it.
- Postcards **without** one sort on `created_at` and form a **separate group**, never interleaved.
  Showing them as "added later" is honest; placing them mid-ride is not.
- The direction is the same for both groups and is PD-257's to settle —
  `tag-postcards-to-rides` currently specifies `created_at desc` for the Journal, and a timeline
  of a day probably wants the other one. Not decided here.

**The home feed is untouched.** It still sorts and pages on `created_at desc`. Nothing about this
change moves a feed cursor.

### What is deliberately not built

| Out of scope | Why |
|---|---|
| Any rendering of the location — place name, city, flag, map thumbnail, distance | Undesigned here, and `docs/FIGMA-FIDELITY-TODO.md` already logs the Journal card's location line as blocked on schema. This change unblocks it; PD-257 draws it |
| Reverse geocoding to a place name | `resolve-ride-location` exists for rides and would be the shape, but a place name is a *different* disclosure with a third-party call attached, and `places` attribution is an open blocker (`CLAUDE.md` §Supabase Rules) |
| A Google Maps deeplink from a postcard | Decision #3's shape, but the deeplink sends the coordinate to Google at click time, which is a disclosure this proposal has not costed |
| Editing or clearing a location after posting | No UPDATE grant, by decision. Relaxing later is one `grant`; retracting one riders have used is not |
| A rider-level "never send location" preference | A preference is a second place the rule lives, and the per-photo default is already Hide. Revisit when a Settings screen exists |
| HEIC/HEIF parsing | A different container format and a real gap, stated in `exif.ts`'s header. It fails to the safe answer |
| Backfilling `taken_at` on existing postcards | There is no signal to derive it from. Every existing row stays NULL |
| Any change to the home feed's ordering or cursor | `created_at` remains both. `044` is not reopened |

## Capabilities

### New Capabilities

- **`photo-capture-metadata`** — the rider-facing contract: what is captured and when it can be
  captured at all, the three modes and what each one puts on the server, every role's reach into
  the five columns (author, another rider who can see the postcard, club owner / admin / member,
  non-member, blocked rider, a rider who hid the postcard, signed-out visitor), the composer's
  seven states, the pairing and bounds rules, what a photo with no EXIF offers, retention and
  deletion, the ordering rule PD-257 inherits, and the surfaces this change deliberately does not
  build.

  **Split from `ride-journal` (in flight, `tag-postcards-to-rides`) on purpose.** That capability
  is about *a postcard being tagged to a ride and who may read the tag*; this one is about *what a
  photo discloses about its author*, and it applies to every postcard including the untagged
  majority that will never appear in a Journal. They meet at one point — the ordering rule — which
  is stated here and inherited there.

### Modified Capabilities

- **`database-enforced-integrity`** — three requirements **ADDED**, none modified.
  - **ADDED: `A value the client must supply SHALL be BOUNDED by the database even where it cannot
    be OWNED by it`.** `044` closed `created_at` by taking the grant away, and that instrument is
    unavailable here: `taken_at` comes from the rider's file and nowhere else. The generalisation —
    *when server ownership is impossible, the column gets a CHECK and its consumers get told the
    value is a claim* — is not in the standing set and reaches every future client-supplied
    timestamp, coordinate and measurement.
  - **ADDED: `A disclosure the rider may decline SHALL be reduced before the request, never after
    it`.** Row-level RLS cannot hide a column from a reader of its row, so "store it and don't
    show it" is not a privacy control, it is a deferred disclosure. Nothing in the standing set
    says this, and it is the rule the whole change turns on.
  - **ADDED: `Columns that are meaningful only together SHALL be constrained to arrive together`.**
    Three nullable columns admit eight states of which five are nonsense — a latitude with no
    longitude, coordinates with no precision marker, a precision marker with no coordinates. A
    CHECK reduces it to three, and the alternative is every reader inventing its own guess about
    a half-populated row.

> **Collision check — clean, verified 2026-08-18.** No in-flight change claims any of the three
> requirement names above, and this change modifies no existing requirement, so it cannot
> supersede a sibling's scenario on archive. Re-derive rather than trust it:
> `grep -rn "^### Requirement:" openspec/changes/*/specs/ | grep -v archive`. Measured, the
> `database-enforced-integrity` claimants today are `add-account-deletion` (4),
> `add-ride-club-edit-delete` (4), `enforce-creator-membership` (6), `enforce-ride-capacity` (3),
> `tag-postcards-to-rides` (3), `add-ride-map-tiles` (2), `add-ride-chat-unread` (1),
> `align-fanout-recipients-with-readability` (1), `grant-club-owner-member-reach` (1),
> `view-rider-profile` (1) — and none of those names is one of ours.

### Read and NOT modified — a claim, not an omission

- **`client-render-shell`** — the composer is bound by *Every screen SHALL have a defined
  first-paint state* and *Ride times SHALL render identically on every device*, and changes
  neither. The Location block's seven states are stated inside `photo-capture-metadata` rather
  than as a delta here, because `add-account-deletion` and `add-static-export-bundle` both already
  claim requirements in this file and a third claimant buys a merge conflict and no clarity.
- **`client-cache-invalidation`** — no new cache key and no new invalidation. `createPostcard`
  already invalidates `postcards.all()` and the club detail; four extra columns on the row it
  writes change neither claim.
- **`client-session-storage`** — read in full, unchanged, and it is what decides the
  not-remembered question above rather than being modified by it. *Sign-out SHALL destroy every
  local trace of the rider* is a reason not to persist the mode, not a rule that moves.
- **`ride-journal`** (in flight) — the ordering rule is stated in `photo-capture-metadata` and
  inherited there. No requirement in that delta moves, and this change must not edit another
  change's files.
- **`event-fanout-integrity`** and **`notifications`** — untouched. No notification carries a
  coordinate and none is added; the deferred `postcard_on_ride` type is bound by
  *A rider SHALL NOT learn a private club's name, or a private ride's title, from a notification*,
  which this change gives it a new reason to obey and no new obligation.

## Impact

**Database.** One migration, **`064_postcards_capture_time_and_place.sql`**. `063` is the highest
file and no in-flight proposal claims `064` — verified 2026-08-18 with
`grep -rhno "0[0-9][0-9]_[a-z_]*\.sql" openspec/changes/*/` against `ls supabase/migrations/`.
Re-derive both, and `list_migrations` against the hosted projects, at write time; `CLAUDE.md`
warns this exact claim has been wrong in both directions.

**It is additive and inert.** Five columns, six CHECKs, two absolute grant statements, one column
comment each. **No policy is touched in any verb**, no trigger is added, no index is added, no
existing row is rewritten. Nothing hangs off an already-shipped write path, so `036`'s
hand-exercise gate does **not** apply — unlike `063`, which does. It may be applied before the code
that writes it deploys, and DEV-then-PROD is ordinary caution rather than a gate.

**`enforce_participation_gate` is already on `postcards`** — measured, alongside
`postcards_set_updated_at`. The consent gate needs no new trigger.

**No index.** `postcards_ride_id_idx` is `(ride_id, created_at desc) where ride_id is not null`
and already reduces a Journal to a handful of rows; sorting those on `taken_at` is a sort over
tens of rows, not a scan. An index on `(ride_id, taken_at)` would serve a query that does not
exist at a scale that does not exist. Stated so its absence reads as a decision.

**One existing assertion goes red and must be rewritten in the same change.**
`supabase/tests/rls_test.sql:9818` asserts the INSERT grant list is exactly
`author_id,caption,club_id,id,image_path,ride_id`. It becomes the eleven-column list. This is a real
behaviour change to a passing test, not a rename, and it is its own task rather than folded into
"update the suite".

**One existing assertion must stay green and is the proof of the insert-only decision.**
`rls_test.sql:8949` asserts UPDATE is exactly `caption,club_id,image_path`. If it goes red, the
migration touched UPDATE and has walked into `044`/`046`'s trap. The SELECT assertions at
`14330`–`14343` are per-column rather than an exact list, so adding four costs nothing there —
which is why four *new* per-column SELECT assertions are required instead.

**Advisors: expect no new one.** This file adds no function, no view and nothing
`security definer`. Re-derive with `get_advisors(security)` after applying; a new WARN means
something landed that this file did not describe.

**Code.** New: `src/lib/media/exif.ts` + its unit tests, exported from `src/lib/media/index.ts`.
Changed: `src/lib/media/upload.ts` (read EXIF off the original `File` and return it alongside the
path), `src/components/postcards/CreatePostcardForm.tsx` (the Location block, hidden inputs
carrying the **reduced** value, mode state), `src/lib/validation/postcards.ts` (four fields
mirroring the CHECKs), `src/lib/actions/postcards.ts` (`createPostcard` carries them),
`src/types/index.ts` (`PhotoLocationPrecision` and the capture input type — domain types live
there), `src/lib/data/columns.ts` (a comment: the five columns are granted and deliberately not
projected), `docs/reference/schema.md` (`postcards`' per-column grant table and audience
predicate), `docs/HANDOFF.md`.

**`Postcard` in `src/types/index.ts` gains no field**, and `src/lib/data/postcards.ts` gains no
read. That mirrors `tag-postcards-to-rides`' handling of `ride_id`: a type field for a column no
screen renders is how a payload grows before anyone decides it should.

**No new runtime dependency.** Nine before, nine after —
`node -p "Object.keys(require('./package.json').dependencies).length"`.

**Tests.** `064` pairs with a section in `supabase/tests/rls_test.sql` per `openspec/config.yaml`,
covering the two grant lists, the absent UPDATE, the six CHECKs and every role's reach. **Every
privilege assertion names the grantee** — a table-wide count reads 2 against a correct database
because `postgres` and `service_role` hold everything by Supabase default (`015`'s footer got this
wrong on its first pass). Vitest covers `exif.ts` against byte fixtures and the rounding, the
clamp and the zone resolution.

**Everything above marked *measured* was run, not reasoned about, and there are two places it was
run.** *Measured on the applied chain* means `supabase/tests/harness.sql` plus all 63 migration
files on a scratch Postgres 16 database, 2026-08-18 — the same SQL, blind to role grants as
Supabase configures them, to PostgREST and to advisors. *Measured on DEV* means against
`fpmrimzxadewsaiwpsel`: the three live grant lists, PROD's `ride_id` difference, and the region
rounding CHECK across nine values. `design.md` §Verification carries what is left, and only the
migration number is genuinely open until write time.

## Open questions for the owner

Three, none blocking, written to be lifted into the PR body or a Linear comment verbatim. Two
earlier questions — the timezone fallback and the `taken_at` floor — were **answered by the
coordinating session** and are recorded as assumptions in `design.md` §Questions rather than left
here; either may still be overturned.

**Q3 — Should `Hide` also withhold or coarsen `taken_at`?** The three buttons govern *place*. A
photo's capture time is uploaded whenever the file carries it, so a rider who picks `Hide` on a
postcard tagged to a ride with a published meeting point and start time has still disclosed a
fair approximation of where they were — and two riders sharing a `taken_at` to the second is
evidence they were together. *Recommended: no — send it unchanged.* The capture time **is** the
feature, the audience is identical either way, and the postcard already shows a time. **Not
blocking**: the model you decided is explicitly three buttons for location, and the issue scopes
`taken_at` and the coordinate as two separate things. **The cheap half of the protection is
already taken** — the `Hide` string says the photo's *location* never leaves the phone, which
stays true, and a requirement now forbids rewording it to "nothing about this photo leaves your
phone" until this is answered. Only you can answer it; it is a privacy-expectation judgement, not
a build question.

**Q5 — Does a rider need to see the location on their own postcard before PD-257 lands?** Nothing
in this change renders a coordinate, so a rider picks `Precise`, something is stored, and they get
no feedback that it was. *Recommended: no — filed, not built.* **Not blocking**: it is bounded by
the next screen, which is the Journal. Worth revisiting only if the gap between this change and
PD-257 turns out to be long.

**Q4 — Should the Journal sort ascending or descending?** *Recommended: ascending, a timeline of a
day reads forwards* — but `tag-postcards-to-rides` currently specifies `created_at desc` for the
Journal, so the two have to be settled together. **Not blocking and not this change's**: PD-257
owns the screen. Named here only so it is inherited rather than re-decided, and it is a question
for you and the designer.

## Adjacent holes: looked for, and none open — a claim, not an omission

A proposal that silently designs around a hole is how the hole gets inherited as covered, so the
neighbours were measured rather than assumed. All three on the applied chain, 2026-08-18:

- **`postcard_comments.created_at`** — `044`'s header files it as *"the identical exposure and a
  different story"*. **`048` closed it.** Measured: INSERT is column-level at
  `author_id, body, id, postcard_id`, and there is no UPDATE grant on the table at all. That
  sentence in `044` is now history rather than an open item, and this change inherits nothing
  from it.
- **`rides.latitude` / `longitude`** — `authenticated` holds SELECT **and UPDATE** on both.
  That is `051`'s decision, not a hole: the geocode is written back from the client after
  `resolve-ride-location` answers, and `rides_geocode_coupling` bounds what can land. Noted so
  that the asymmetry with `postcards` — where the equivalent columns get **no** UPDATE — reads as
  a decision in both places rather than an inconsistency. The difference is that a ride's meeting
  point is published by design and a photo's location is the rider's to withhold.
- **`postcards`' own policies** — SELECT, INSERT, UPDATE and DELETE quals captured before this
  proposal was written and unchanged by it. `tasks.md` §1 pins their md5 as a footer check, the
  way `044` §4 did.
