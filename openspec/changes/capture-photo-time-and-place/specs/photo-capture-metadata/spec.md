## Purpose

What a postcard discloses about **when and where its photo was taken**: what may be captured and
in what window it can be captured at all, the three modes and what each one puts on the server,
every role's reach into the five new columns, what a photo with no metadata offers, the composer's
states, retention and deletion, the ordering rule the Journal inherits, and the surfaces this
change deliberately does not build.

`postcards.created_at` is when a postcard was **posted** and `044` made it server-owned so it can
never be anything else. This capability is about the other two facts, which come from the rider's
file, exist for one moment before `compressImage` destroys them, and are the rider's to withhold.

Two of the five columns are the capture time and the UTC offset it was resolved in; three are the
coordinate pair and the marker saying how precise it is.

## ADDED Requirements

### Requirement: The rider's choice SHALL decide what is UPLOADED, not what is displayed

Where a rider may decline to disclose a value, the reduction SHALL happen on the device, before
the request is built. The server SHALL NOT hold a value the rider chose not to publish, and no
column, flag or policy SHALL be introduced whose purpose is to hold a precise coordinate while
instructing readers not to show it.

RLS is row-level. A policy that returns the postcard row returns every column on it that the
reader holds a grant for, and Postgres has no column-level row security — `062` had to revoke a
**grant** to close `ride_id`, and a grant is per role, not per row. So a "do not show" flag could
never be enforced by a policy and could only ever be honoured by a screen, which makes it a
deferred disclosure rather than a privacy control.

#### Scenario: Hide sends nothing
- **WHEN** a rider composes a postcard from a photo carrying GPS EXIF and leaves the Location
  control at `Hide`
- **THEN** the request that creates the postcard SHALL carry no latitude, no longitude and no
  precision marker
- **AND** the three columns SHALL be NULL on the stored row
- **AND** no coordinate derived from that photo SHALL exist anywhere on the server

#### Scenario: Region sends only the rounded value
- **WHEN** a rider selects `Region`
- **THEN** the coordinate in the request SHALL already be rounded to 2 decimal places
- **AND** the unrounded value SHALL NOT appear in the request, in any field, at any precision

#### Scenario: The precise value is not in the document
- **WHEN** `Hide` or `Region` is selected
- **THEN** no element in the composer's DOM SHALL carry the unreduced coordinate, so that a form
  serialiser, an extension or a captured DOM cannot reach it

#### Scenario: The action does not reduce
- **WHEN** `createPostcard` receives a coordinate
- **THEN** it SHALL validate and insert what it was given and SHALL NOT round, truncate or
  otherwise reduce it, because a reduction there implies the precise value already travelled

#### Scenario: The uploaded image carries nothing either
- **WHEN** any postcard image is uploaded
- **THEN** the object in Storage SHALL carry no EXIF and therefore no location, so the columns are
  the only server-side copy and `Hide` means there is none

### Requirement: Capture metadata SHALL be read from the original file, before compression

The EXIF read SHALL run on the `File` the rider picked, before `compressImage`. It SHALL return
`null` for every value it cannot read and SHALL NOT throw for any input.

`compressImage` destroys the EXIF block as a side effect of the canvas re-encode — canvas has no
metadata channel — so after it there is nothing left to read, for ever. A read placed after it
returns nulls silently: no error, no failing build, and a composer that truthfully reports the
photo has no location.

#### Scenario: The order is asserted, not assumed
- **WHEN** the compressed output of a photo that carried EXIF is fed back into the reader
- **THEN** it SHALL return nulls, which is the same assertion read in the other direction and is
  what fails if the two calls are ever swapped

#### Scenario: A malformed file costs the rider nothing
- **WHEN** the picked file is truncated, hostile, not a JPEG, or carries a corrupt Exif segment
- **THEN** the reader SHALL return nulls
- **AND** the rider SHALL still be able to post the photo

#### Scenario: No new dependency
- **WHEN** this capability is implemented
- **THEN** the runtime dependency count SHALL be unchanged, and the reader SHALL parse only the
  APP1/Exif segment, the TIFF header and the two IFDs it needs

### Requirement: A capture time SHALL be stored with the offset it was resolved in, and SHALL NOT be pinned to `APP_TIME_ZONE`

`DateTimeOriginal` carries no zone. The instant SHALL be derived from `OffsetTimeOriginal` when
the file carries it, and otherwise by resolving the wall clock in the **device's own offset at the
capture date**. Whichever offset was used SHALL be stored alongside the instant, so the camera's
own wall clock is recoverable by any renderer without re-deriving anything.

Pinning the fallback to `APP_TIME_ZONE` is forbidden because it produces an instant the
capture-time bound refuses: a Helsinki photo's 12:00 resolved as Amsterdam wall clock is one hour
in the future, and the reader's clamp then turns that refusal into a silently NULL `taken_at` for
every rider east of Amsterdam posting promptly. `APP_TIME_ZONE` exists to stop an unpinned
**formatter** rendering one zone during the prerender pass and another on hydration; this is an
event handler producing an absolute instant, with no render and no second reader, so that reason
does not reach it.

Storing the offset is what makes the pair right in both directions at once — the instant is
correct *and* the wall clock round-trips — and it cannot be deferred to a later change: an offset
is **unrecoverable after the fact**, so every row written without it has no signal to backfill
from.

#### Scenario: A rider east of Amsterdam posts immediately
- **WHEN** a rider in a zone ahead of `Europe/Amsterdam` posts a photo taken minutes ago, from
  where they took it, whose file carries no `OffsetTimeOriginal`
- **THEN** the postcard SHALL carry a non-NULL `taken_at`
- **AND** that instant SHALL NOT be in the future

#### Scenario: An explicit offset wins
- **WHEN** the file carries `OffsetTimeOriginal`
- **THEN** that offset SHALL decide the instant, no fallback SHALL be consulted, and that offset
  SHALL be the one stored

#### Scenario: The camera's own wall clock is recoverable
- **WHEN** any renderer holds a stored capture time and its offset
- **THEN** it SHALL be able to reproduce the wall clock the camera recorded, exactly, without
  knowing where the photo was taken or where the reader is

#### Scenario: The offset is the one at the capture date
- **WHEN** a photo taken in one DST period is uploaded in another
- **THEN** the stored offset SHALL be the device's offset **on the capture date**, not on the
  upload date

#### Scenario: An impossible time is dropped, never sent
- **WHEN** the resolved instant is in the future or before the floor the database enforces
- **THEN** the reader SHALL return `null` for the capture time **and for its offset, together**
- **AND** the rider SHALL NOT be refused, because nothing out of bounds is sent

#### Scenario: Neither half of the pair travels alone
- **WHEN** a file carries an offset but no readable capture time, or the clamp drops the instant
- **THEN** neither value SHALL be sent, because the database refuses a half pair and a half-drop
  would turn a garbage tag back into a refused post

#### Scenario: The clamp is a backstop, not the ordinary path
- **WHEN** the resolution is implemented
- **THEN** the clamp SHALL fire only on a wrong clock, an unset camera clock or a hostile file,
  and SHALL NOT be the ordinary outcome for any region of riders

#### Scenario: `wallClockToUtc` is unchanged
- **WHEN** this capability is implemented
- **THEN** `src/lib/utils.ts` SHALL NOT be edited, and `wallClockToUtc` SHALL keep pinning ride
  times to `APP_TIME_ZONE`, which is a different problem with a different correct answer

### Requirement: The database SHALL bound every captured value, and Zod SHALL NOT be the only place a bound lives

Each of the following SHALL be a CHECK constraint on `public.postcards`. A Zod rule MAY carry the
message; it SHALL NOT be the guarantee.

- `taken_at` no later than `now()`.
- `taken_at` no earlier than the floor (`1995-01-01`, the year `DateTimeOriginal` was specified).
- The capture time and its offset present or absent together.
- The offset within `[-1440, 1440]` — deliberately permissive, because a camera with a wrong
  setting can legitimately write `+23:00` and a rider must not lose a post over a setting they
  cannot see.
- Latitude within `[-90, 90]`, longitude within `[-180, 180]`.
- The three location columns all present or all absent — the precision marker present exactly when
  the coordinates are.
- The precision marker one of `region` or `precise`.
- **A row marked `region` really at two decimal places**, so that the middle mode's promise is a
  database fact rather than the client's word.

The client owns the mutation path and the publishable key ships in the bundle, so a rule only Zod
enforces is a rule a rider can decline. The bounds-plus-coupling constraint copies
`rides_geocode_coupling` (`051`), which is the same rule on the same two column names one table
over.

#### Scenario: A future capture time is refused
- **WHEN** any client inserts a postcard whose `taken_at` is later than `now()`
- **THEN** the write SHALL be refused by the database, whatever the client validated

#### Scenario: A half-populated location is refused
- **WHEN** a row arrives with a latitude and no longitude, with coordinates and no precision
  marker, or with a precision marker and no coordinates
- **THEN** the write SHALL be refused

#### Scenario: An out-of-range coordinate is refused
- **WHEN** a row arrives with a latitude outside `[-90, 90]` or a longitude outside `[-180, 180]`
- **THEN** the write SHALL be refused

#### Scenario: An unknown precision marker is refused
- **WHEN** a row arrives with a precision marker other than `region` or `precise`
- **THEN** the write SHALL be refused

#### Scenario: A capture time without its offset is refused
- **WHEN** a row arrives with a capture time and no offset, or an offset and no capture time
- **THEN** the write SHALL be refused

#### Scenario: A `region` row carrying more than two decimal places is refused
- **WHEN** a row is marked `region` and either coordinate is not at two decimal places
- **THEN** the write SHALL be refused, so that a row marked `region` discloses **at most** two
  decimal places whatever client wrote it

#### Scenario: The `region` rule is not a rounding-parity rule
- **WHEN** the constraint is read or asserted
- **THEN** it SHALL be understood as asking whether the stored value **is** at two decimal places,
  never whether it equals the database's own rounding of an original the database never saw
- **AND** a value at two decimal places SHALL be admitted regardless of which implementation
  produced it, so a client and the database disagreeing on a halfway case cannot refuse a post

#### Scenario: The `region` rule does not reach a `precise` row
- **WHEN** a row is marked `precise`
- **THEN** its coordinates SHALL be admitted at any precision, including two decimal places

#### Scenario: The client floor and the database floor are the same value
- **WHEN** the floor changes
- **THEN** it SHALL change in the migration and in the reader together, because a client floor
  looser than the CHECK turns a garbage tag into a refused post

### Requirement: The captured columns SHALL be insert-only, and no UPDATE grant SHALL be issued

`authenticated` SHALL hold INSERT and SELECT on the five columns and SHALL NOT hold UPDATE on any
of them. The migration SHALL NOT issue a `revoke update` / `grant update` pair on `postcards` at
all.

INSERT, UPDATE and SELECT on `postcards` are all column-level after `044`, `046` and `062`, so a
new column arrives with no grant of any kind — the insert-only outcome costs no statement. Issuing
an absolute UPDATE list written from a document rather than the database is how `044`'s list
silently reinstates `id` and `author_id`, an authorship-transfer capability, with nothing red.

#### Scenario: The capture cannot be edited afterwards
- **WHEN** any rider, including the author, attempts to update `taken_at`, its offset, either
  coordinate or the precision marker on an existing postcard
- **THEN** the write SHALL be refused by the column privilege, not by a policy and not by the
  absence of a screen

#### Scenario: The existing UPDATE grant list is unchanged
- **WHEN** the migration has applied
- **THEN** `authenticated`'s UPDATE grant on `postcards` SHALL still be exactly
  `caption, club_id, image_path`

#### Scenario: Deleting the postcard is the whole remedy, and it works
- **WHEN** a rider realises they published a precise location they did not intend to
- **THEN** deleting the postcard SHALL destroy the only copy of that coordinate, because the
  uploaded object carries no EXIF and nothing derived from it is stored elsewhere
- **AND** no other remedy SHALL be implied by any screen or string

#### Scenario: The grant assertions name their grantee
- **WHEN** these grants are asserted in `supabase/tests/`
- **THEN** each assertion SHALL name `authenticated` (or use `has_column_privilege`) rather than
  counting rows table-wide, because `postgres` and `service_role` hold everything by Supabase
  default

### Requirement: The audience of the captured columns SHALL be exactly the audience of the postcard, stated per role

There is no narrower audience available and none SHALL be invented. The `postcards` SELECT policy
is unchanged by this capability and decides every read:

```
author_id = auth.uid()
OR (NOT private.is_blocked(auth.uid(), author_id)
    AND (club_id IS NULL OR private.is_club_member(club_id))
    AND NOT EXISTS (postcard_hides h WHERE h.postcard_id = id AND h.user_id = auth.uid()))
```

#### Scenario: The author reads their own, always
- **WHEN** the author reads their own postcard
- **THEN** they SHALL see `taken_at`, both coordinates and the precision marker, unconditionally,
  including for a postcard in a club they have since left

#### Scenario: A member of the postcard's club reads it
- **WHEN** a rider who is a member of the postcard's club — with role `member`, `admin` or
  `owner`, which the policy does not distinguish — reads it and is not blocked and has not hidden
  it
- **THEN** they SHALL see every captured column that is set

#### Scenario: A non-member SHALL see nothing of a club postcard
- **WHEN** a rider who is not a member of the postcard's club attempts to read it
- **THEN** they SHALL receive no row, and therefore no coordinate and no capture time

#### Scenario: A blocked rider SHALL see nothing, in either direction
- **WHEN** a `blocks` row exists between the author and the reader, in either direction
- **THEN** the reader SHALL receive no row, and therefore no capture metadata — blocking is
  symmetric even though the row is directional

#### Scenario: A rider who hid the postcard SHALL see nothing of it
- **WHEN** a rider holds a `postcard_hides` row for the postcard
- **THEN** they SHALL receive no row, and the captured columns go with it

#### Scenario: A club admin gains no extra reach
- **WHEN** a club owner or admin reads a postcard in their club
- **THEN** they SHALL see exactly what a `member` sees — `club_members.role` does not appear in
  the `postcards` SELECT policy and SHALL NOT be added to it by this capability

#### Scenario: A signed-out visitor SHALL reach nothing
- **WHEN** a request arrives with no session, or as the `anon` role
- **THEN** it SHALL be refused, because `anon` holds zero grants on `postcards` in any verb on any
  column and decision #1 grants none
- **AND** no grant to `anon` SHALL be issued for any of the five columns

#### Scenario: No Edge Function gains reach
- **WHEN** this capability is implemented
- **THEN** neither `delete-account` nor `resolve-ride-location` SHALL be given any new reach into
  these columns, and no new privileged accessor SHALL be added to read them

#### Scenario: A rider who leaves the club loses the location with the postcard
- **WHEN** a rider leaves a club whose postcards they could previously read
- **THEN** they SHALL lose the rows and every captured column on them, with no separate rule

### Requirement: A captured coordinate SHALL be treated as a claim, never as evidence

Nothing in the schema can verify that a coordinate is where a photo was taken, because the client
owns the mutation path. No screen, moderation decision, badge, streak, leaderboard or automated
action SHALL treat a captured location or capture time as proof of the rider's whereabouts.

#### Scenario: A moderation flow does not rely on it
- **WHEN** a `postcard_reports` case is considered
- **THEN** the captured location SHALL NOT be presented or used as evidence of where the photo was
  taken

#### Scenario: `created_at` remains the answer to "when was this posted"
- **WHEN** any screen needs a trustworthy timestamp for a postcard
- **THEN** it SHALL use `created_at`, which is server-owned, and SHALL NOT substitute `taken_at`

### Requirement: The composer SHALL define every state of the Location block

Every state below SHALL have a defined rendering, and the strings SHALL be treated as contract
rather than as copy: they are the only thing telling a rider what each mode does, and a reworded
hint is a changed promise. The block SHALL NOT hold up the composer — a slow or failed EXIF read
SHALL resolve to the no-location state rather than to a spinner.

#### Scenario: A photo with a location, before a choice is made
- **WHEN** a picked photo carries a GPS location
- **THEN** the block SHALL render the location icon, the label `Location`, the three-segment
  control with `Hide` selected, and the `Hide` hint

#### Scenario: The three hints are contract
- **WHEN** each mode is selected
- **THEN** the hint SHALL read, with the lead clause emphasised:
  - `Hide` — "**Nothing is saved.** The photo's location never leaves your phone."
  - `Region` — "**Rounded to about a kilometre.** Enough to place it on the ride."
  - `Precise` — "**Saved exactly.** Anyone who can see this photo can see where you took it."

#### Scenario: A photo with no location
- **WHEN** the picked photo carries no GPS location — no EXIF at all, a screenshot, a HEIC file,
  location services off for the camera, or metadata already stripped by another app
- **THEN** the icon and the `Location` label SHALL remain
- **AND** the control and hint SHALL be replaced by the single line "This photo has no location."
- **AND** a disabled three-segment control SHALL NOT be rendered, because it reads as a choice the
  rider made about a photo that has no location to choose about

#### Scenario: Time and location are independent
- **WHEN** a photo carries a capture time but no location, or a location but no capture time
- **THEN** each SHALL be handled on its own — the capture time is still captured in the first
  case, and the control renders normally in the second

#### Scenario: No photo chosen yet
- **WHEN** no photo has been picked
- **THEN** no Location block SHALL be rendered at all

#### Scenario: A photo being replaced
- **WHEN** the rider picks a different photo
- **THEN** the mode SHALL reset to `Hide` and the previous photo's metadata SHALL be discarded

#### Scenario: The upload fails
- **WHEN** the image upload fails and the rider retries with the same photo
- **THEN** the captured metadata and the chosen mode SHALL survive the retry, because they are
  read from the file rather than from the upload

#### Scenario: Offline
- **WHEN** the rider is offline
- **THEN** the EXIF read and the mode choice SHALL still work, because both are local
- **AND** nothing SHALL leave the device, because the upload and the insert both fail

#### Scenario: The composer never blocks on the read
- **WHEN** the EXIF read is slow or fails
- **THEN** the rider SHALL still be able to pick, upload and post, with the block resolving to the
  no-location state

### Requirement: The three modes SHALL govern location only, and the `Hide` string SHALL NOT be widened to claim more

The control decides what happens to the photo's **place**. `taken_at` and its offset are uploaded
whenever the file carries them, under every mode including `Hide`, and no mode SHALL be
represented as covering them.

**Settled by the product owner, 2026-08-18: *"Hide does not hide capture time."*** This scoping
shipped as the deliberate reading rather than by omission, and it is now the decided one. The
capture time is the ride Journal's ordering key — it is what makes a Journal order on the riding
rather than the telling — so covering it would cost the Journal outright.

**The residual below is accepted, not denied.** The decision does not rest on the composition
being harmless; it rests on the cost of removing it being higher than the exposure. Do not cite
this requirement as evidence that a capture time reveals nothing about place.

**The string does not over-claim, and that is what makes the narrow scope honest.** "The photo's
**location** never leaves your phone" stays true with a capture time uploaded. A rewording to
"nothing about this photo leaves your phone", or any other formulation covering the photo
generally, would be false, and is forbidden.

The composition worth being explicit about: a capture time to the second, on a postcard tagged to
a ride whose meeting point and start time are published, is a fair approximation of where the
rider was — and two riders' postcards sharing a capture time to the second is evidence they were
together.

#### Scenario: `Hide` withholds the place and nothing else
- **WHEN** a rider selects `Hide` on a photo carrying both a location and a capture time
- **THEN** no coordinate SHALL be sent
- **AND** the capture time and its offset SHALL be sent

#### Scenario: The hint may not be widened
- **WHEN** the `Hide` hint is edited
- **THEN** it SHALL continue to scope its promise to the photo's **location**, and SHALL NOT be
  reworded to a claim about the photo generally

#### Scenario: No mode is described as covering time
- **WHEN** any label, hint or help text for the control is written
- **THEN** none of them SHALL imply that a mode affects whether the capture time is uploaded

### Requirement: The mode SHALL NOT be remembered between uploads

Every compose SHALL start at `Hide`. The chosen mode SHALL NOT be persisted to `localStorage`,
secure storage, the rider's profile or any other store that outlives the compose.

Nothing in this change renders a coordinate, so a remembered `Precise` misfiring is invisible when
it happens and stays invisible. And any store it could live in is reached by the standing
requirement *Sign-out SHALL destroy every local trace of the rider*, so a remembered privacy
setting either survives sign-out on a shared device — strictly worse than one extra tap — or does
not survive it, in which case it is not remembered in any sense a rider would recognise.

#### Scenario: The second upload starts at Hide
- **WHEN** a rider posts one photo with `Precise` and immediately composes another
- **THEN** the second composer SHALL open at `Hide`

#### Scenario: Nothing persists it
- **WHEN** the implementation is reviewed
- **THEN** no write of the selected mode to any persistent store SHALL exist

### Requirement: Nothing in this change SHALL render a captured location, and the columns SHALL NOT be projected

No screen SHALL draw a coordinate, place name, city, flag, map thumbnail or distance from these
columns, and the five columns SHALL NOT be added to `POSTCARD_SELECT` or to the `Postcard` type.

The grant is issued ahead of its reader deliberately — a rider must be able to see what they
published, and the Journal's ordering needs the column privilege because Postgres privilege-checks
a column reference in an `ORDER BY` exactly as in a target list. Keeping the columns out of the
projection means the exposure is a grant rather than a payload, and makes the next screen's
projection a decision rather than an inheritance.

#### Scenario: No feed payload grows
- **WHEN** the home feed or the postcard detail is read
- **THEN** the response SHALL NOT contain any of the five columns

#### Scenario: The next screen decides its own projection
- **WHEN** a later change renders a location
- **THEN** it SHALL add the columns to a projection deliberately, and SHALL state which screens
  receive them

### Requirement: The Journal SHALL sort on the capture time and SHALL NOT interleave photos that have none

A Journal SHALL order postcards that carry a capture time by `taken_at`, and postcards that carry
none SHALL form a separate group ordered by `created_at` rather than being interleaved. The home
feed SHALL be unaffected and SHALL continue to order and page on `created_at`.

Stated here so the Journal inherits it rather than re-deciding it. **No Journal screen is built by
this change**; the screen is PD-257's and the tag it reads is `tag-postcards-to-rides`'.

#### Scenario: Photos with a capture time sort by it
- **WHEN** a Journal renders postcards that carry `taken_at`
- **THEN** they SHALL be ordered by `taken_at`, not by `created_at`

#### Scenario: Photos with no capture time form their own group
- **WHEN** a Journal renders postcards with no `taken_at`
- **THEN** they SHALL appear as a separate group ordered by `created_at`, and SHALL NOT be
  interleaved with the timed ones — showing them as added later is honest, placing them mid-ride
  is not

#### Scenario: The direction is one decision for both groups
- **WHEN** the Journal's sort direction is chosen
- **THEN** it SHALL be the same for both groups

#### Scenario: The home feed is untouched
- **WHEN** the home feed is read
- **THEN** it SHALL still order and page on `created_at`, and `taken_at` SHALL play no part in the
  feed's sort key or cursor

### Requirement: Captured metadata SHALL have a stated retention, and SHALL die with the postcard and the account

The five columns SHALL have the same lifetime as the postcard row and no separate retention
window. Their absence from any expiry schedule SHALL be a decision recorded here rather than an
omission.

#### Scenario: Deleting the postcard destroys the location
- **WHEN** a rider deletes their postcard
- **THEN** the row and its five columns SHALL go with it, and no derived copy SHALL survive

#### Scenario: Account deletion reaches them through the existing cascade
- **WHEN** a rider deletes their account
- **THEN** every postcard they authored SHALL be removed by `postcards.author_id`'s
  `ON DELETE CASCADE` from `profiles`, and the five columns SHALL go with the rows — they are
  columns on `postcards` and need no new deletion step

#### Scenario: No new personal data lands anywhere else
- **WHEN** this capability is implemented
- **THEN** no location or capture time SHALL be written to any other table, to a notification, to
  a log, or to a Storage object

#### Scenario: A future retention window is a decision, not a default
- **WHEN** anyone proposes expiring captured locations after a period
- **THEN** it SHALL be a stated change with its own reasoning, because riders who chose `Precise`
  did so understanding the postcard's own lifetime

### Requirement: The surfaces this change does not build SHALL be named rather than half-built

Each absence below SHALL be traceable to a decision recorded in `proposal.md` or `design.md`, and
SHALL NOT be partially implemented — a half-drawn location display, a dead grant or an edit
affordance that refuses is worse than the stated gap, because the next session reads it as
finished.

#### Scenario: Nothing partially implements a location display
- **WHEN** this change is reviewed
- **THEN** there SHALL be no reverse geocoding, no place name, no map thumbnail, no Google Maps
  deeplink, no distance and no Journal screen

#### Scenario: Editing after posting is absent by decision
- **WHEN** a rider looks for a way to change or clear a location after posting
- **THEN** there SHALL be none, and the absence SHALL be traceable to the insert-only grant rather
  than to an unfinished screen

#### Scenario: A rider-level location preference is absent by decision
- **WHEN** a rider looks for a global "never send location" setting
- **THEN** there SHALL be none, because the per-photo default is already `Hide` and a preference
  is a second place the rule would live
