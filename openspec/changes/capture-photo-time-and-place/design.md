# Design — capturing a photo's time and place

## Context

See `proposal.md` §Why for the motivation and the decisions the product owner settled before this
file was written. What this file adds is the mechanism, the rejected alternatives, and the
measurements — and it exists because **three of the wrong implementations here are silent**: the
"store precise, hide in the UI" model discloses nothing until the day it discloses everything, an
EXIF read placed one line too late returns nulls for ever with nothing red, and a grant list
rewritten from a document instead of the database silently reinstates a privilege `046` removed.

Everything below marked *measured* was exercised against the **full applied migration chain** on
Postgres 16 — `supabase/tests/harness.sql` plus all 63 files on a scratch database, 2026-08-18 —
rather than reasoned about.

The state that shapes the design:

| Fact | Where it comes from | Measured value |
|---|---|---|
| `postcards` INSERT is **column-level** | `044` §1 | `author_id, caption, club_id, id, image_path, ride_id` |
| `postcards` UPDATE is **column-level** | `046` | `caption, club_id, image_path` |
| `postcards` SELECT is **column-level** | `062` | `id, author_id, club_id, image_path, caption, created_at, updated_at` |
| DELETE is still **table-level** | `009`/`044` | `has_table_privilege(authenticated, …, delete) = t` |
| `anon` holds **nothing** on `postcards`, any verb, any column | `007`, decision #1 | 0 rows in `column_privileges` |
| A **new** column therefore arrives with **no grant at all** | the three above, together | `select=f insert=f update=f` on a probe column |
| The SELECT policy is `author OR (NOT blocked AND (club_id IS NULL OR member) AND NOT hidden)` | `009`, `011` | captured verbatim below |
| Two triggers on the table | `023`, `009` | `enforce_participation_gate`, `postcards_set_updated_at` |
| `compressImage` destroys the EXIF block | `compress.ts`, verified in Chromium | no `Exif` marker in the output blob |
| `rides` already carries a bounds-plus-coupling CHECK on `latitude`/`longitude` | `051` | `rides_geocode_coupling` |

## Goals / Non-Goals

**Goals**

- The rider's choice decides what reaches the server, verifiably — not what a screen chooses to
  draw.
- A `taken_at` the Journal can sort on, bounded by the database against the one direction that
  costs other riders something.
- A read of four EXIF tags with no new dependency and no way to fail loudly enough to cost a
  rider their post.
- Every column's audience stated per role, so `supabase/tests/` can assert it.

**Non-Goals**

- Rendering any of it. No place name, no map, no distance, no Journal screen.
- Verifying that a coordinate is where the photo was actually taken. It cannot be done and must
  not be implied — see D12.
- Touching the home feed's sort key or cursor. `044` stands.
- Touching `src/lib/utils.ts`. PD-262 owns that file this session; the zone resolution lives in
  `exif.ts` instead (D7).

## Decisions

### D1 — The mode decides what is UPLOADED, not what is displayed

The rejected alternative is the one every implementer reaches for first: store
`taken_latitude`/`taken_longitude` at full precision plus a `location_visibility` column, and have
the UI respect it.

It loses on a property of the system rather than on taste. **RLS is row-level.** A policy that
returns the postcard row returns every column on it that the reader holds a grant for, and there
is no column-level RLS in Postgres — `062` had to revoke a *grant* to close `ride_id`, and a grant
is all-or-nothing per role, not per row. So `location_visibility` could never be enforced by a
policy; it could only ever be honoured by a screen. The consequences, each concrete:

- Every rider's exact home coordinate would sit on the server, for every outdoor photo, for ever.
- One widened projection — a `select('*')`, a new screen, a debugging query, an export — is a
  disclosure of home addresses, and none of those things is reviewed as a privacy change.
- A future admin or moderation surface inherits the whole set with no decision having been made.
- Nothing in `supabase/tests/` could assert the rule, because it would not be a database rule.
  `openspec/config.yaml` names exactly this failure: a visibility rule that is not in the database
  *"silently becomes whatever the migration author assumed."*

Reducing on the device inverts all four: **there is nothing to disclose.** The cost is that the
choice is irreversible without deleting the postcard (D6), and that cost is accepted.

### D2 — Region is 2 decimal places, and the cell is not square

The design's own hint settles the number — *"Rounded to about a kilometre"* — and 3 decimals
(~110 m) is still a street and, on a rural road, still a house.

**What 2 decimals actually buys, stated because "about a kilometre" is an approximation in one
axis and an over-statement in the other.** One hundredth of a degree of latitude is ~1.11 km
everywhere. One hundredth of a degree of longitude is ~1.11 km at the equator and shrinks with
the cosine of latitude — ~680 m at Amsterdam's 52°N, ~560 m at 60°N. So the rounding is **never
worse than ~1.1 km on either axis and is tighter the further north the rider is**. The hint is an
upper bound, which is the safe direction for a privacy string; a hint claiming a *smaller* number
would be the unsafe one.

**Rounding, not truncation**, and `Number(value.toFixed(2))` rather than
`Math.round(value * 100) / 100`. The latter can leave a residual float artefact
(`52.38000000000001`), which is harmless in a `double precision` column and is exactly the kind of
thing that later gets rendered.

**Two residual disclosures, stated rather than discovered:**

- **Region is coarsening, not anonymity.** A rider who posts many photos from home publishes the
  same cell repeatedly, and the modal cell of a rider's postcards is their home to ~1 km. This is
  a real limit of the middle option, it is why `Hide` is the default, and it is why the Region
  hint says *"Enough to place it on the ride"* rather than promising privacy.
- **Rounding creates equality classes.** Two riders in the same cell store identical values, which
  is provable co-location to anyone who can see both postcards. That is what Region *means*; it is
  noted so nobody reads it as a bug.

**And the database enforces it, so `Region` is a guarantee rather than a claim.** The row marked
`region` carries a CHECK requiring the stored value to *be* at two decimal places:

```sql
taken_location_precision <> 'region'
  or (taken_latitude  = round(taken_latitude::numeric,  2)::float8
  and taken_longitude = round(taken_longitude::numeric, 2)::float8)
```

**Measured on DEV (`fpmrimzxadewsaiwpsel`) 2026-08-18 rather than reasoned about**, across
`52.37, 4.895, -0.01, 0, 52.3702, 179.99, -89.99, 1.005, 123.456789`: it accepts a value already
at two decimal places, rejects anything else, and is idempotent.

**The obvious worry about it is the wrong one, and that is why this is written down.** The
predicate asks whether the stored value **is at two decimal places** — not whether it equals
Postgres's own rounding of some original, which the database has never seen. So JS and Postgres
disagreeing on a halfway case cannot fail it: `Number((4.895).toFixed(2))` is `4.89` and
`round(4.895::numeric, 2)` is `4.90`, and **both satisfy the CHECK**, because each is already at
two places. Any `integer / 100` satisfies it. A reviewer who reads the constraint as "the client
must round the way Postgres would" will try to make the two agree, and there is nothing to make
agree.

What it buys is the property the hint promises: a row marked `region` **discloses at most two
decimal places of information**, and that is now a database fact rather than a client's word.
What it cannot buy — and no constraint could — is that the rounded value is the rounding of the
rider's *actual* location, or that a value marked `precise` is genuinely precise. Those remain
claims (D12). The bound on the disclosure is the part that matters, and the bound is enforced.

### D3 — The design strings are owner-supplied, and the snapshot does not carry them

`CLAUDE.md` §Design System is absolute: design questions are answered from the committed `design/`
snapshot, never the Figma API. So this section records what the snapshot actually says, because
the honest answer is "not this".

```
npm run figma -- ls "postcard"                   # two Create postcard frames
npm run figma -- text 1918:16843 --all           # Create postcard, Cancel, Post, Add photo, Club, What's on your mind?
npm run figma -- text 1918:17056 --all           # Cancel, Post, What's up?, Add photo
grep -ril "Precise" design/                      # (nothing)
```

**Neither frame contains a Location block, a segmented control, or any of the three hint strings.**
The strings in `proposal.md` are taken verbatim from the brief as **owner-supplied**, from a mock
that is not in the snapshot. That is a labelled inference, per `CLAUDE.md` §Working Principles —
*never let an inferred value pass silently as a known one* — and it changes nothing about the
work, because the owner's strings are decided either way. What it changes is what the next
`figma:pull` means: if the Figma file has moved ahead of the snapshot, the refresh reconciles
this; if the mock lives outside the file, the snapshot will still not carry it and this paragraph
is the only record of why.

**The icon and the geometry follow the app rather than the mock**, for the same reason.
`LocationOutlineIcon` at `h-5 w-5 text-muted` is what `src/app/(app)/rides/detail/page.tsx:203`
already draws for a ride's meeting-point line, so the two location rows in the app match.
`ButtonGroup` is used unmodified — its own header records that it was measured from the ride
plan's frame and that the unselected label is a known 4.17:1 contrast deviation, already logged.
This change adds no new colour pairing.

### D4 — `now()` in a CHECK is legal here, and legal *here* is not the same as legal in general

Postgres does not reject a non-immutable function in a CHECK, and the usual advice against one is
about a predicate that can go from true to false while a row sits still — which makes
`ALTER TABLE … VALIDATE CONSTRAINT`, `pg_dump`/`pg_restore` and a partition attach fail on data
that was legal when it was written.

`taken_at <= now()` has the opposite shape: it can only ever become **more** true as time passes.
A row that passed at insert passes for ever. Measured, on a probe table on the applied chain:

```
create table probe_t (…, check (taken_at is null or (taken_at >= '1900-01-01' and taken_at <= now())));
CREATE TABLE                                          -- accepted
insert … now() + interval '1 day'  -> ERROR 23514     -- the ceiling fires
alter table probe_t validate constraint probe_taken_at_sane;   -- ALTER TABLE
alter table … drop constraint …; alter table … add constraint … ;  -- ALTER TABLE, revalidates clean
```

**A CHECK rather than a BEFORE trigger that clamps**, and `044`'s header gives the reason in as
many words: *"A grant fails the write at the door with 42501, which is a bug report; a trigger
accepts the request and quietly discards half of it, which is a support ticket nobody can
reproduce."* The same choice, one verb over. A trigger silently rewriting `taken_at` to `now()`
would produce exactly the Journal this change exists to fix, and no error anywhere.

**The client is what keeps the CHECK from ever firing on an honest rider** — `exif.ts` returns
`null` for anything out of bounds rather than sending it (D7). The CHECK is the guarantee against
a client that skipped validation, which is the only client the rule is written for.

### D5 — The floor is `1995-01-01`, and `1900-01-01` does not do the job it was given

**Settled, and it was a correction: `1900-01-01` was wrong and is not the floor.** The coordinating
session proposed it, the measurement below refused it, and the correction was accepted on
2026-08-18 — `Q2` is closed, not open. The floor exists to catch EXIF garbage, and the two named
examples are epoch-0 and 1904 Mac dates. Against a `1900-01-01` floor, on the probe table above:

```
insert … timestamptz '1970-01-01'   -> INSERT 0 1     -- epoch-0 admitted
insert … timestamptz '1904-01-01'   -> INSERT 0 1     -- 1904 Mac date admitted
```

Both are after 1900. The floor as briefed catches neither of the two values it was written for; it
catches only year-0001 (a zeroed `0000:00:00 00:00:00` field, which is real and common) and
underflow.

**`1995-01-01` is a principled line rather than a guess: `DateTimeOriginal` was introduced with
EXIF 1.0 in October 1995.** A file claiming a capture time that predates the tag's own
specification did not get that value from a camera writing it honestly.

**What it costs, stated:** a genuinely old photo — a 1980s scan hand-tagged in Lightroom — loses
its `taken_at` and posts with none. It never costs the rider the *post*, because the client maps a
below-floor value to `null` rather than sending it, so the CHECK never fires for an app user.

**The floor and the clamp must be the same constant**, exported from `exif.ts` and restated in
`064`'s header, or a rider gets a raw `23514` from a value Zod let through. That is the one way
this pair can go wrong and it is a task.

**Why it is not left as a question.** The alternatives are a different arbitrary year (1990 buys
nothing 1995 does not, and has no reasoning behind it) or no floor at all — which is defensible on
the grounds that a too-old value sorts harmlessly to one end of a journal, and is rejected because
`0001-01-01` from a zeroed field is not a date, it is an absence wearing a date's shape, and a
column that admits it makes every consumer handle it.

### D6 — Insert-only, no UPDATE grant — and it is free, which is the finding

Measured, in a rolled-back transaction on the applied chain:

```sql
alter table public.postcards add column probe_col timestamptz null;
-- authenticated: no rows in information_schema.column_privileges for probe_col
-- has_column_privilege: select=false insert=false update=false
```

`044`, `046` and `062` made all three verbs column-level, so **a column added to `postcards` today
arrives with nothing.** `tag-postcards-to-rides` predicted this and called it *"a surprise to
remove"* rather than a problem — it is now the load-bearing mechanism of this change:

> **Insert-only requires no statement at all. The migration must NOT issue a `revoke update` /
> `grant update` pair.**

Issuing one walks straight into `docs/reference/migrations.md` §The ordering chain: `044` and
`046` both issue **absolute** UPDATE lists, and re-issuing one from a stale document reinstates
`id` and
`author_id` — an authorship transfer capability — **with no error and nothing red**. The existing
assertion at `rls_test.sql:8949` (UPDATE is exactly `caption,club_id,image_path`) is what catches
it, and it is listed in `tasks.md` as *must stay green* rather than as a thing to update.

**The remedy question, decided.** A rider who realises they published their driveway can delete
the postcard and nothing else. Accepted:

- It is **honest**. The coordinate lives in exactly one place — the row — because
  `compressImage` already stripped it from the object. Deleting the row destroys it. There is no
  cached copy, no derived place name and no notification carrying it.
- The screen exists. `deletePostcard` is shipped, DELETE is table-level, and the policy is
  `author_id = auth.uid()`.
- The alternative is not one grant. A "widen or clear, never sharpen" affordance needs a BEFORE
  UPDATE trigger comparing `old.taken_location_precision` to `new` (`precise` → `region` → NULL,
  never back), a grant on three columns, an edit screen that does not exist
  (`grep updatePostcard\|editPostcard src/` → nothing), and a refusal contract for the sharpen
  case. That is its own change with its own negative cases, and **relaxing a grant later is one
  statement while retracting one riders have used is not**.

Named as follow-up in `tasks.md` §7 so it is filed rather than forgotten.

### D7 — Turning `DateTimeOriginal` into an instant: the fallback AND a stored offset

**`Q1` is closed. Both halves are taken, and they compose rather than compete.** This is an
**assumption made by the coordinating session on 2026-08-18**, not a decision the product owner
handed down — recorded that way so a later reader knows which kind of authority it carries. What
closed it: `src/lib/media/exif.ts` shipped in `e4d8cab` resolving the fallback through
`wallClockToUtc` (`APP_TIME_ZONE`), and **this proposal adds a bound that reader was written
before** — `taken_at <= now()` — against which that fallback fails for a whole region of Europe,
silently.

`DateTimeOriginal` is `YYYY:MM:DD HH:MM:SS`, **zone-less**. `OffsetTimeOriginal`, where the camera
writes it, is the honest answer and wins under every option below. The question was only ever
about the fallback, and about whether the offset survives.

**A — the device's own zone.** `new Date('2026-08-18T14:00:00')`, the JS default for a zone-less
string, resolves in the runtime's zone. For a photo the rider just took, that is the photo's zone.

**B — `APP_TIME_ZONE`, via `wallClockToUtc`.** What shipped. Its argument, from the file's own
header and restated fairly: it is the one that **round-trips** — the Journal renders through
formatters pinned to the same zone, so a camera that recorded 12:15 draws 12:15, and the rider
sees the time they remember. It also rejects A on a real ground: the device's zone at *upload*
need not be its zone at *capture*, so the stored instant depends on where the rider was standing
when they got signal.

**C — store the offset alongside the instant.** A fifth column,
`taken_at_offset_minutes smallint null`, recording the offset actually used, whichever of the two
it came from. The Journal then renders wall-clock-at-the-photo, correctly, from anywhere. This is
`CLAUDE.md`'s own stated correct model for ride times — *"wall-clock at the meeting point, which
needs a zone column on `rides`"* — applied to a photo instead of a meeting point.

**What decides the fallback: B produces a value the CHECK refuses, and the clamp then makes that
silent.**

> A rider in Helsinki photographs at 12:00 EEST — 09:00 UTC. Resolved as Amsterdam wall clock that
> is 10:00 UTC, **one hour in the future**. The insert is refused `23514`; and because the reader
> clamps an out-of-bounds instant to `null` rather than letting the rider be refused, the actual
> outcome is that **`taken_at` is silently NULL** and the photo drops out of the Journal's timed
> group. Every zone east of `Europe/Amsterdam` has this, in proportion to its offset — Finland,
> Greece, Romania, Bulgaria, Turkey by one hour; Tokyo by seven — for the whole window between
> taking a photo and that offset elapsing, which is exactly the window in which riders post.

A's exposure to the same bound is much smaller and needs travel to produce: the resolved instant
is only in the future if the *upload* zone is west of the *capture* zone by more than the elapsed
time. Uploading where you photographed — the overwhelming case — gives the exact instant and never
a future one.

**And the reason `APP_TIME_ZONE` exists does not reach this case.** `CLAUDE.md` pins it because an
unpinned **formatter** renders the server's zone into the prerendered HTML and the rider's zone on
hydration — a hydration mismatch. This is an event handler on a picked file, producing an absolute
instant that is stored once and never re-resolved. There is no render, no hydration and no second
reader of the wall-clock string. So B was a choice made on the round-trip merit alone, not an
application of the standing convention.

**Why A and C together rather than either alone**, which is the part worth carrying:

- **A alone** makes the *instant* right in the common case — the phone that shot it is the phone
  uploading it — but leaves the wall clock **unrecoverable**. A Journal pinned to `APP_TIME_ZONE`
  still draws 11:00 for the Helsinki rider's 12:00 photo. The rider does not see the time they
  remember, which is the whole of B's argument and it survives A.
- **C alone** does not fix the instant. An offset recorded beside a wrong instant records the
  wrongness precisely.
- **Together the instant is right and the camera's own reading is recoverable exactly**, by any
  renderer, for ever — and `taken_at <= now()` becomes *structurally* safe rather than nearly
  safe. The device's clock and its offset are self-consistent with `now()`, so the bound stops
  firing on honest riders in **every** zone rather than only in one. That is a stronger claim than
  "A's exposure is smaller".

**Why the column cannot wait for a later migration, which is what makes it a fifth column now
rather than a follow-up.** Two arguments, and the second is the decisive one:

- Adding it later is a **second revoke-and-regrant of `postcards`' INSERT and SELECT lists** — the
  exact pair of absolute rewrites `044` and `046` already cost this repo once, on this table.
- **An offset is unrecoverable after the fact, in precisely the way this whole issue rests on.**
  Every row written before the column exists has *no signal to backfill from*: the instant is
  stored in UTC, the EXIF is gone the moment `compressImage` ran, and nothing anywhere remembers
  what zone the phone was in. Deferring the column does not postpone the cost — **it discards the
  data**, permanently, for every postcard posted in the interval. That is the same argument as
  reading EXIF before the strip, one layer up.

**The constraints that go with it:**

- **`check (taken_at_offset_minutes between -1440 and 1440)` — permissive on purpose.**
  `OffsetTimeOriginal` is `±HH:MM`, so a camera with a wrong setting can legitimately write
  `+23:00`. A CHECK tight to the real world (`-720 … 840`) would refuse a rider's post over a
  camera setting they cannot see and did not know about. The **clamp** is what keeps garbage out;
  the CHECK's job here is to bound the column, not to police the world's timezones.
- **Coupled to `taken_at`: `(taken_at is null) = (taken_at_offset_minutes is null)`.** There is
  exactly one writer and it always knows an offset, so the coupled shape is free — and it means
  no reader ever has to guess what a bare instant's wall clock was. Same idiom as the coordinate
  triple, same `051` shape (`rides_geocode_coupling`).
- **The clamp is now total, and it drops the pair.** If the resolved instant is in the future or
  below the `1995-01-01` floor, `exif.ts` returns `null` for **both** `taken_at` and the offset.
  Returning one without the other is refused by the coupling CHECK, so a half-drop would turn a
  garbage tag back into a refused post — the exact outcome the clamp exists to prevent.

**Two implementation traps this shape creates**, stated because both are silent:

- **The offset is the device's offset AT THE CAPTURE DATE, not today's.** A photo taken in July
  and uploaded in December must record `+120`, not `+60`. That means deriving it from a `Date`
  built on the capture wall clock, never from `new Date().getTimezoneOffset()`.
- **`Date.prototype.getTimezoneOffset()` returns minutes BEHIND UTC** — Amsterdam in summer
  answers `-120` for UTC+2 — so it must be negated to store what this column means. Getting the
  sign wrong is invisible until a renderer draws a time four hours out.

A third case is benign and is noted so nobody "fixes" it: on the two DST days a year a wall clock
can be **ambiguous** (the repeated hour) or **nonexistent** (the skipped one). JS resolves each to
one particular instant; whichever it picks, the offset recorded is the offset of *that* instant,
so **the stored pair is always self-consistent** and re-rendering it round-trips. This is the
problem `wallClockToUtc` handles in two passes because it must produce one canonical answer; here
there is nothing to be canonical about, because the pair travels together.

`wallClockToUtc` stays correct for what it is for — a `datetime-local` an organizer types, which
must mean one instant for every rider — and **`src/lib/utils.ts` is not edited by this change**
(PD-262 owns it this session).

### D8 — No EXIF location: replace the control, do not disable it

Most photos will carry no location. Screenshots and saved images never did; a phone with location
services off for the camera does not write a GPS IFD; anything through another app's share sheet
has usually been stripped; and **HEIC — the iPhone default — is an ISOBMFF box structure this
reader does not parse at all**, so it returns nulls for one.

The rejected option is a disabled `ButtonGroup`. It still draws three labels and a selected pill,
which reads as *a choice the rider made* about a photo that has no location to choose about, and
`role="radiogroup"` with every option disabled is a worse answer for a screen reader than a
sentence. The adopted shape keeps the block's position and height stable — the pin and the
**Location** label stay — and replaces control-plus-hint with one line in the hint's own slot and
typography:

> **This photo has no location.**

No bold lead clause, because there is no second clause and the bold in the other three exists to
separate *what happens* from *why*. Nothing invites the rider to fix it: telling them to turn on
camera location services is advice this app has no business giving, and it would read as pressure
toward the least private option.

**Time and location are independent and each is answered on its own.** A photo with a time and no
location gets the line above and still captures `taken_at`; a photo with a location and no time
gets the full control and a NULL `taken_at`. There is no combined "no metadata" state, because
`taken_at` has no control to disable.

### D9 — The mode is not remembered, and the argument is where it would live

Every upload starts at `Hide`. Beyond the issue's own reason — *"a remembered Precise is the one
setting that could surprise someone later"* — two things make it decisive:

- **Nothing in this change renders a coordinate.** A remembered `Precise` misfiring is invisible
  when it happens and stays invisible. A default whose failure mode cannot be observed is not a
  default.
- **It would need somewhere to live**, and that place is governed. `localStorage` on web and the
  secure store in the native shell are both reached by the standing `client-session-storage`
  requirement *Sign-out SHALL destroy every local trace of the rider*. A privacy setting that
  survives sign-out on a shared device is a strictly worse outcome than one extra tap; one that
  does not survive sign-out is not "remembered" in any sense a rider would recognise.

The cost is one tap per photo for the rider who always wants `Precise`. That is the right side to
err on.

### D10 — The precise value never enters the DOM

The composer holds the EXIF result in component state. The form's hidden inputs carry the
**reduced** value for the currently-selected mode, recomputed whenever the mode changes:

| Mode | `takenLatitude` / `takenLongitude` hidden inputs | `takenLocationPrecision` |
|---|---|---|
| Hide | not rendered | not rendered |
| Region | `Number(v.toFixed(2))` | `region` |
| Precise | the full value | `precise` |

This is what makes *"the mode decides what is uploaded"* checkable rather than asserted: with
`Hide` selected there is no input in the document carrying a coordinate, so nothing a form
serialiser, an autofill extension or a screenshot of the DOM can reach. Writing the precise value
into a hidden input and reducing it inside `createPostcard` would be the same feature with the
precise value one `document.querySelector` away and one refactor away from being sent.

**`createPostcard` reduces nothing.** It parses what it is given. A second rounding step in the
action would be a second copy of the rule, free to drift from the one in the composer — and would
imply the precise value had already travelled.

### D11 — `062`'s reasoning arrives INVERTED, and that is why the upload-time choice is load-bearing

**This is the section to read if you are deciding whether D1 is really necessary.**

`041` shipped `ride_id` inside a `select('*')` and called it harmless — *"a UUID"*. PD-165 and
`062` had to undo it, because **the value is comparable**: it grouped postcards for a viewer who
could resolve neither the ride nor its crew. The repo's answer there was to **revoke the grant**,
and it worked because nobody was supposed to see the column at all.

> **A coordinate is strictly worse than that id — it is comparable AND externally resolvable — and
> the instrument `062` used is unavailable, because here the rider CHOSE to publish it.**

A viewer holding two postcards with the same `taken_latitude`/`taken_longitude` knows they are the
same place; a viewer holding one knows where it is, in the real world, without asking anyone
anything. No revoke can help: the whole point of `Region` and `Precise` is that the audience sees
the value. **So the only place the exposure can be bounded is before the value is sent** — which is
D1, and this is the argument for it that does not depend on any hypothetical future policy
mistake. The mitigation is the upload-time reduction plus `Hide` as the default, and there is no
second line of defence behind it.

**The narrower decision that follows: granted, and deliberately not projected.**
`POSTCARD_SELECT` does **not** gain the columns, and `Postcard` in `src/types/index.ts` gains no
field.

**The SELECT grant is still issued**, and both reasons are decisions:

- A rider must be able to see what they published. A column that is stored and unreadable is the
  dead-column trap, and it makes the choice unverifiable end to end.
- The Journal's `ORDER BY taken_at` needs the column privilege. Postgres privilege-checks a column
  reference in an `ORDER BY` exactly as in a target list — `062` measured the same thing for a
  predicate and `rls_test.sql` §062.4 asserts it with a control.

### D12 — A coordinate is a claim, not evidence

The client owns the mutation path, so a rider can insert any coordinate they like, including one
where the photo was not taken. Nothing in the schema can check a coordinate against an image, and
nothing should try.

The consequence that matters is downstream: **a location must never be rendered as evidence.** A
moderation flow deciding a `postcard_reports` case on "the photo says it was taken there", or a
future badge, streak or leaderboard keyed on where a photo was taken, is trusting a value its
author typed. Stated here so the first screen that wants to does not have to rediscover it.

The same holds, more weakly, for `taken_at`: it is the Journal's sort key and its author can
choose it, so a rider can place their photo anywhere in their own ride's timeline. That is
tolerable because the Journal's audience is that ride's crew and the ordering is cosmetic within
it — and because the one direction that costs *other* riders something, a future timestamp
pinning a photo to the top for ever, is exactly what the CHECK forbids. `created_at` remains
server-owned and is the honest fallback for any question about *when this was posted*.

### D13 — `Hide` covers place, not time

The design offers one control and it is about location. `taken_at` is uploaded whenever the file
carries it, with no rider choice — and a rider who selects `Hide` may reasonably read *"the
photo's location never leaves your phone"* as covering the photo's context generally.

It does not, and the composition is worth stating: a `taken_at` to the second, on a postcard
tagged to a ride whose meeting point and start time are published, is a fair approximation of
where the rider was. Two riders' postcards sharing a `taken_at` to the second is evidence they
were together.

**Recommended default: send it, unchanged.** The capture time *is* the feature; the postcard
already discloses a time (`created_at`, drawn as "2h ago"); and the audience is identical in both
cases. Recorded as **Q3** because it is a product judgement and the honest alternative — a fourth
mode, or rounding `taken_at` to the hour when `Hide` is selected — is cheap while nothing renders
it and expensive afterwards.

### D14 — Where each rule lives

| Rule | Database | Zod | Component |
|---|---|---|---|
| `taken_at` not in the future | **CHECK** | message | clamped to `null` |
| `taken_at` not before 1995 | **CHECK** | message | clamped to `null` |
| latitude/longitude bounds | **CHECK** | message | — |
| offset within `[-1440, 1440]` | **CHECK** | message | — |
| `taken_at` and its offset arrive together | **CHECK** | message | dropped together by the clamp |
| all-three-or-none coordinate pairing | **CHECK** | message | enforced by construction (D10) |
| precision is `region` or `precise` | **CHECK** | enum message | the three buttons |
| a `region` row is really at 2 decimal places | **CHECK** | — | `Number(v.toFixed(2))` |
| the reduced value is the one that is *sent* | — | — | **the only place it can be** |
| who may read the columns | **RLS + grants** | — | — |
| who may write them | **grants** (INSERT yes, UPDATE never) | — | — |

**One row has no database entry, and it is a smaller gap than it was.** The `region` CHECK means
the database *does* bound the disclosure — a row marked `region` carries at most two decimal
places, enforced (D2). What no constraint can check is whether the value is the rounding of the
rider's actual position, or whether a `precise` row is genuinely precise: those are the rider's
claims about their own data (D12), and the columns the database does own — the marker, the bounds,
the pairing, the rounding — are what make the claim legible.

## Risks / Trade-offs

- **A rider cannot take back a `Precise` coordinate except by deleting the postcard.** → D6,
  accepted and stated in the spec as a requirement rather than left as a gap. Follow-up filed.
- **`Region` is coarsening, not anonymity** — a repeated cell is a home. → D2, and it is why
  `Hide` is the default and why the hint claims placement rather than privacy.
- **The five columns are granted before anything reads them.** → D11; not projected into
  `POSTCARD_SELECT`, so the exposure is a grant rather than a payload, and the next screen makes
  the projection decision deliberately.
- **The offset must be the device's offset at the CAPTURE date and must be sign-flipped.** → D7's
  two traps. `new Date().getTimezoneOffset()` is the wrong date, and the value it returns is
  minutes *behind* UTC. Both are silent until a renderer draws a time hours out; both are unit
  tests in `tasks.md` §9.
- **The clamp must drop `taken_at` and its offset TOGETHER.** → The coupling CHECK refuses a half
  pair, so a clamp that drops only the instant turns a garbage tag back into a refused post — the
  exact outcome the clamp exists to prevent.
- **The EXIF read is one line away from silently always returning null.** → It must run on the
  original `File` before `compressImage`. `tasks.md` §3 requires a unit test that fails if the
  order inverts — feed `compressImage`'s output back into `readExifCapture` and assert nulls,
  which is the same assertion read in the other direction.
- **The migration's two absolute grant lists are the `044`/`046` trap.** → `tasks.md` §1 requires
  both read off `information_schema.column_privileges` scoped to `authenticated` at write time,
  and requires UPDATE not be mentioned at all.
- **`taken_at` is a client-supplied sort key.** → D12; bounded in the direction that costs others,
  cosmetic in the direction that does not, and `created_at` stays server-owned.
- **HEIC returns nothing**, which is most iPhone photos. → D8; it fails to the safe answer and the
  composer says so. A real gap, named rather than hidden.

## Migration Plan

1. Write `064_postcards_capture_time_and_place.sql` — **five** columns, six CHECKs, two absolute
   grant statements, five column comments. Re-derive the number from `ls supabase/migrations/`
   against `list_migrations` on both projects; it is the one pre-flight check still open at write
   time.
2. Build the two re-grant lists from the grant lists **measured on DEV 2026-08-18** (`tasks.md`
   §2.2) — re-read them if any time has passed. **Do not mention UPDATE.** **PROD's SELECT list
   still carries `ride_id` because `062` is unpromoted; that is DEV-ahead, not drift, and `064`'s
   list must NOT reinstate it.**
3. Run the RLS suite locally with the new section (`PGPASSWORD=postgres npm test`), and confirm
   `rls_test.sql:8949` (UPDATE list) is still green and `9818` (INSERT list) has been rewritten.
4. Apply to DEV. Check `get_advisors(security)` is unchanged — this file adds no function.
5. Verify the footer queries against DEV: the two grant lists, the six CHECKs by name, the four
   policy quals' md5 unchanged, `anon` still zero.
6. Deploy the code, then promote `064` to PROD in filename order with the rest of the gap, per
   `docs/ENVIRONMENTS.md` §Migrations. Order is not a gate — the migration is additive and inert,
   and a deployed client that does not yet send the columns simply leaves them NULL.

**Rollback is four statements** and loses only the captured values:

```sql
alter table public.postcards
  drop column if exists taken_at,
  drop column if exists taken_at_offset_minutes,
  drop column if exists taken_latitude,
  drop column if exists taken_longitude,
  drop column if exists taken_location_precision;
-- then re-issue 044's INSERT list and 062's SELECT list, absolutely, from the database
```

The second line is the part that is easy to forget and is why the rollback is written down: a bare
`drop column` leaves the two re-granted lists naming columns that no longer exist, which Postgres
prunes silently — correct, but it means the recorded lists and the file that wrote them disagree
for ever.

## Verification — what was measured where, and what is left

Named rather than left implied, per `CLAUDE.md` §Working Principles.

- **Where each measurement came from.** Everything marked *measured on the applied chain* was
  exercised on a local Postgres 16 with `harness.sql` plus all 63 migration files — the same SQL,
  blind to role grants as Supabase configures them, to PostgREST, and to advisors. **Everything
  marked *measured on DEV* was run against `fpmrimzxadewsaiwpsel` by the coordinating session**:
  the three live grant lists, PROD's `ride_id` difference, and the `region` rounding CHECK across
  nine values (D2). Both projects are reachable; `tasks.md` §2 holds what is still to run there,
  and only the migration number is genuinely open until write time.
- **The Figma mock.** D3: the strings are owner-supplied and are not in the committed snapshot.
- **The composer in a browser.** Nothing here was rendered; Chromium in this container cannot
  reach Supabase (`CLAUDE.md` §Technology Decisions), and the walk is the gate that would answer it.
- **Real EXIF from a real phone.** The unit tests use byte fixtures. A photo off an actual iPhone
  and an actual Android camera, through the real composer, is `tasks.md` §6 and is a gate on the
  claim that this works at all.

## Questions — two answered, three open

**Answered on 2026-08-18 by the coordinating session, not by the product owner.** Recorded that
way deliberately: they are assumptions the build proceeds under and the owner may still overturn
either, which is a different kind of authority from a decision handed down.

**Q1 — Which zone resolves a `DateTimeOriginal` with no `OffsetTimeOriginal`?** (D7.)
**ANSWERED: both A and C — they compose rather than compete.** The fallback becomes the device's
own UTC offset **at the capture date**, and `taken_at_offset_minutes smallint null` becomes a real
fifth column recording whichever offset was used. A alone fixes the instant and leaves the wall
clock unrecoverable; C alone records a wrong instant precisely. Together the instant is right, the
camera's own reading round-trips for any renderer, and `taken_at <= now()` becomes structurally
safe in every zone rather than nearly safe in one. The column cannot wait for a later migration:
an offset is **unrecoverable after the fact**, so deferring discards the data rather than
postponing the cost (D7).

**Q2 — Is `1995-01-01` the right floor for `taken_at`?** (D5.) **ANSWERED: yes, and the briefed
`1900-01-01` was wrong** — measured, it admits both epoch-0 and 1904 Mac dates, which are the two
values a floor was wanted for. 1995 is the year `DateTimeOriginal` was specified, so anything
earlier is garbage by construction. The floor and the reader's clamp are one exported constant.

---

**Still open. Q3 and Q5 are the product owner's; Q4 is not this change's at all.** All three are
restated in `proposal.md` §Open questions for the owner, phrased to be lifted into a PR body or a
Linear comment verbatim.

**Q3 — Should `Hide` also withhold or coarsen `taken_at`?** (D13.) *Recommended default: no —
send the capture time unchanged; it is the feature, the audience is identical, and the postcard
already shows a time.* Blocking: **no** — the model the owner decided is explicitly *three buttons
for location*, and the issue scopes `taken_at` and the coordinate as two separate things. **The
cheap half of the protection is taken now**: the `Hide` hint says the photo's *location* never
leaves the phone, which stays true with `taken_at` uploaded, and a requirement in
`photo-capture-metadata` forbids rewording it to a broader claim until this is answered.
Answerable by: the product owner alone — a privacy-expectation judgement, not a build question.

**ANSWERED 2026-08-18 — no.** Product owner, verbatim: *"Hide does not hide capture time."* The recommended default stands. The reasoning above is kept as the record of the question rather than rewritten to match its answer, and the requirement forbidding a wider `Hide` string is now permanent rather than pending. PD-265.

**Q4 — Should the Journal sort ascending or descending?** (`proposal.md` §Journal ordering.)
*Recommended default: ascending — a timeline of a day reads forwards* — but
`tag-postcards-to-rides` currently specifies `created_at desc` for the Journal, so the two must be
settled together. Blocking: **no**, and it is **not this change's** — PD-257 owns the screen. Named
so it is inherited rather than re-decided. Answerable by: the designer and the product owner.

**Q5 — Does a rider need to see the location on their own postcard before PD-257 lands?**
*Recommended default: no — file it, do not build it.* Nothing renders it in this change, so a
rider chooses `Precise` and gets no feedback that anything was stored. That is uncomfortable and
it is bounded: the next screen is the Journal. Blocking: **no**. Answerable by: the product owner,
if the gap between this change and PD-257 turns out to be long.
