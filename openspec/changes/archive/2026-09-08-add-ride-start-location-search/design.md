## Context

See `proposal.md` for motivation. What shapes the approach, all of it measured today rather than
read off a document:

- **`051` owns the ride coordinate already.** `rides` carries `latitude`, `longitude`,
  `geocode_confidence`, `map_card_path`, `map_detail_path`, a coupling CHECK requiring confidence
  alongside any coordinate, a one-directional path CHECK, an organizer-pinned path CHECK, and the
  `clear_ride_map_tiles` BEFORE UPDATE trigger.
- **The grants are asymmetric.** Measured on DEV: `authenticated` holds UPDATE on
  `latitude, longitude, geocode_confidence, map_card_path, map_detail_path` and **INSERT on none of
  them**. So a pick supplied at ride creation raises `42501` today.
- **The stale-tile trigger discards same-statement values.** Measured on DEV in a rolled-back
  transaction: `update rides set meeting_point = …, latitude = 51.885, longitude = 4.372,
  geocode_confidence = 0.95` stored the text and three NULLs.
- **No ride anywhere has a coordinate.** All five newest DEV rides are NULL across the board, and
  `ride_map_render_attempts` holds two refused attempts from 2026-08-17. So there is no data to
  migrate and no rider whose behaviour changes on day one.
- **The picker exists.** `PlaceSearchField` (441 lines, `ui/`) already covers the sheet, the debounce,
  the abort, the proximity bias, the five sheet states, the label composition and the length bound —
  and its own header says PD-114's free-text need is "a `required`/free-text prop added here, not a
  second component".
- **`066` is the pattern for the schema half** — denormalised copy, no FK to `places`, coupling and
  length CHECKs, additive grants, no index, no policy.

## Goals / Non-Goals

**Goals:**

- One reusable picker, extended once, serving both clubs and rides.
- Provenance and precedence expressed as CHECKs and triggers, so neither depends on the client or on
  an undeployable function.
- The create path and the edit path both able to store a pick, in one statement each.
- Free text preserved end to end, including offline and when the index has never heard of the place.

**Non-Goals:**

- Any mapping SDK, map render, route drawing or turn-by-turn — decision #3.
- Any new runtime dependency.
- A distance filter, "rides near me", or an index on the ride coordinate.
- Reopening the geocoding provider.
- Backfilling existing rides.
- The inline ghost-text autocomplete drawn in `1918:15967`.

## Decisions

### D1. One new column, not four

Clubs needed four (`location_name`, `location_place_id`, `latitude`, `longitude`) because a club had
no text field for a location at all. A ride already has `meeting_point`, which is `NOT NULL`, bounded,
required, and the thing every screen renders. **Picking fills that text**, so a separate
`start_place_name` would be a copy of `meeting_point` that is equal to it in every stored row.

Only `start_place_id` is added, alongside `051`'s existing `latitude` and `longitude`.

*Alternative considered — `start_place_name` as a witness of "what the text was when the pin was
set", with a CHECK `start_place_id is null or meeting_point = start_place_name`.* Rejected on two
grounds. First, D3's rule decides the same question from `OLD`/`NEW` without it. Second, the CHECK
would make "pin plus a note" — picking `Shell Pernis Werk, Rotterdam` and then writing
`Shell Pernis Werk, Rotterdam — by the pumps` — impossible at the database level, which is a product
decision the schema has no business taking. **The owner has since closed that question in the UI**
(typing throws the pin away), which strengthens rather than weakens the argument: a UI rule is
reversible in an afternoon, a CHECK is a migration and a backfill. Recorded because it is a genuinely
reasonable design and will be proposed again.

### D2. Provenance by mutual exclusion, not by a source enum

`051`'s `rides_geocode_coupling` requires `geocode_confidence` to be present and ≥ 0.70 whenever a
coordinate is. A picked place has no vendor confidence, so that constraint has to be replaced, and
the replacement is where provenance gets encoded:

```sql
alter table public.rides drop constraint rides_geocode_coupling;

alter table public.rides add constraint rides_location_coupling check (
  (latitude is null and longitude is null and geocode_confidence is null and start_place_id is null)
  or (start_place_id is not null                       -- picked
      and latitude is not null and longitude is not null
      and geocode_confidence is null
      and latitude >= -90 and latitude <= 90
      and longitude >= -180 and longitude <= 180)
  or (start_place_id is null                           -- geocoded
      and latitude is not null and longitude is not null
      and geocode_confidence is not null
      and latitude >= -90 and latitude <= 90
      and longitude >= -180 and longitude <= 180
      and geocode_confidence >= 0.70::real and geocode_confidence <= 1.0::real)
);
```

**`0.70::real` keeps its cast, and dropping it is the trap.** `051` measured it on this database:
`0.70::real >= 0.70` is **false**, because the bare literal is `numeric`, Postgres widens the `real`,
and a candidate whose confidence is exactly the floor then violates its own constraint — as a write
error on a path no scenario covers. Retyping the constraint is exactly the moment that cast gets
lost.

Dropping and re-adding a constraint is not editing an applied migration; `067` is a new file and
`rides_geocode_coupling` is gone by name after it, which anything grepping for that name (`051`'s
footer, the RLS suite) must be updated for.

*Alternatives considered, and both are the ones PD-114's 2026-08-12 comment offers this story by
name.* That comment establishes the problem correctly — confidence saturates, the measured Geoapify
geocode of `Stationsplein 1, Amsterdam` returned exactly `1`, which is also what a picker would
naturally write — and proposes "either a `location_source` column, or a CHECK-admitted sentinel
confidence value reserved for picks". Neither is taken. The **enum** is a second statement of a fact
the columns already carry, free to disagree with them, and a CHECK tying it to them would be this
same constraint plus a column. The **sentinel** abuses a column whose name says it holds a vendor
score, and any later reader who has not been told the convention reads it as one. Presence of
`start_place_id` costs the same column the story needed anyway and cannot disagree with itself.

*What this does not buy.* `authenticated` holds `update (geocode_confidence)` from `051`, so the
geocoded arm can be hand-written. See D5.

### D3. The clearing rule, decided from `OLD` and `NEW` alone

`clear_ride_map_tiles()` is rewritten so a pick supplied by the same statement survives:

```sql
if new.start_place_id is not null
   and new.start_place_id is distinct from old.start_place_id then
  new.geocode_confidence := null;      -- a pick carries none, per D2
  new.map_card_path      := null;      -- rendered for the previous point
  new.map_detail_path    := null;
else
  new.start_place_id := null; new.latitude := null; new.longitude := null;
  new.geocode_confidence := null; new.map_card_path := null; new.map_detail_path := null;
end if;
```

with the WHEN widened to
`old.meeting_point is distinct from new.meeting_point or old.start_place_id is distinct from new.start_place_id`.

**Why `IS DISTINCT FROM` on the place id is the right test, case by case.** Text edited with the
columns omitted: `NEW` carries the old id, not distinct, everything clears — correct, and it does not
depend on the client sending anything. A new pick: distinct, kept. A rider who picks, saves, edits
the text (pick cleared to NULL), then re-picks the same place: `OLD` is NULL and `NEW` is the id, so
distinct, kept. A hand-rolled client repeating the stored id beside new text: not distinct, cleared —
the safe direction.

**The bulk-update hazard `051` documents stays closed.** `propagate_club_privacy_to_rides` touches
neither `meeting_point` nor `start_place_id`, so neither arm of the WHEN is true and no ride in the
club loses its location.

### D4. Precedence as a second trigger, keyed on the coordinate actually moving

```sql
create trigger protect_picked_ride_location
  before update on public.rides
  for each row when (
    old.start_place_id is not null
    and new.start_place_id is not distinct from old.start_place_id
    and (new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.geocode_confidence is distinct from old.geocode_confidence))
  execute function public.protect_picked_ride_location();
```

The function restores `old.latitude`/`old.longitude`, forces `geocode_confidence` to NULL, and NULLs
both tile paths — the paths because a tile rendered for the coordinate just rejected is a picture of
the wrong place, and `rides_map_paths_need_a_coordinate` would happily keep it.

Two properties worth stating because they are not obvious:

- **Ordering with D3 is safe and does not depend on luck.** Postgres fires BEFORE row triggers in
  name order, so `clear_ride_map_tiles` runs first, and a BEFORE trigger's WHEN is evaluated against
  `NEW` **as modified by the triggers before it**. Both halves measured on DEV 2026-08-18 in a
  rolled-back transaction with a two-trigger probe: the earlier trigger nulled a column the statement
  supplied, and the later trigger's `when (new.a is not null)` did **not** fire — so it saw the
  modified `NEW`, not the statement's. Do not take that second half on trust when re-checking; it is
  the half that decides whether these two triggers can be reasoned about independently. On a
  text-only edit of a picked ride, `clear` sets
  `new.start_place_id` to NULL, so `protect`'s `is not distinct from` arm is false and it does not
  fire. On a new pick, the ids differ and it does not fire either.
- **A tile rendered *for the stored pick* is accepted.** Its UPDATE leaves the coordinates equal, so
  the WHEN never fires. That is precisely what makes D6's redeployed function work without a further
  exception.

### D5. Grants — additive, per operation

```sql
grant insert (start_place_id, latitude, longitude) on public.rides to authenticated;
grant update (start_place_id)                      on public.rides to authenticated;
```

`051` already granted UPDATE on the coordinate pair. `geocode_confidence` gets **no** INSERT grant:
no client ever produces one, and under D2 a client that could would be writing the geocoded arm.
Additive statements only — `044`/`046` are this repo's worked example of two absolute grant lists
silently reinstating each other's revokes.

**The UPDATE grant on `geocode_confidence` stays, and removing it here would take the geocoder down.**
This was raised in review as a one-line hardening on the premise that `resolve-ride-location` runs as
`service_role` and so bypasses column grants. **It does not.** `index.ts` builds its writing client as
`createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + token } } })`
and issues the step-8 `update` through it — its own §Rule 1 is "the caller's own token on every
statement from here down", and CLAUDE.md records that `delete-account` is the **only** place a
service-role key exists. So the function writes as `authenticated`, on the rider's JWT, and a revoke
would raise `42501` on every geocode. It would do so **invisibly**: the function is fail-open, so it
would return `rendered: false` after paying for a geocode, two renders and two uploads, and every
ride would quietly stop getting a tile with nothing red anywhere.

The goal behind the finding is right, and it is met in the direction that matters: a pick cannot be
forged over, because D4 restores it. What remains is a rider hand-writing the geocoded arm onto a
ride with no pick — self-misrepresentation on their own row, reaching no one else's data. Closing it
needs a `security definer` `record_ride_geocode(...)` for the function to call, **then** the revoke,
in that order and across two migrations (`021`/`025`'s rule). Filed as an unbuilt surface, with the
ordering, rather than done half-way here.

### D6. The Edge Function skips a picked ride — spend, not correctness

`resolve-ride-location` gains one branch after it reads the ride: `start_place_id is not null` →
skip the geocode and its three gates, render both tiles from the stored coordinate, write only the
two path columns. Correctness does not depend on this landing (D4 already holds the line); what it
buys is that a picked ride gets its map, and that no vendor call is paid for a coordinate we already
have.

**Deploying is an owner action** — no `supabase` CLI in the container, `deploy_edge_function` on the
`deny` list — so this is drift from the moment it merges. The interim is stated rather than assumed:
a picked ride has an exact coordinate and no tile, and both containers draw the pin fallback they
draw for every ride on DEV today.

`requestRideMapRender` in `src/lib/actions/rides.ts` SHALL NOT be called when the write carried a
pick. That removes the *common* case of the interim's cost: today's deployed function would geocode,
render, and upload two objects whose column write D4 then overrides — leaving two orphaned JPEGs,
because the function's compensating delete only runs when the UPDATE *errors*, and D4 succeeds
silently.

**That condition does not cover the race, and the race is the harder half.** "The write carried a
pick" is evaluated in the action; it says nothing about a render already in flight when the pick
arrives:

1. organizer creates a ride with free text → `requestRideMapRender` fires, legitimately;
2. before the function's step 8 lands, the organizer edits and picks a place;
3. the function completes: it uploads two JPEGs and issues its UPDATE;
4. `clear_ride_map_tiles` does **not** fire — that statement touches neither `meeting_point` nor
   `start_place_id`; `protect_picked_ride_location` **does**, and NULLs the path columns;
5. the UPDATE **succeeds**, so `writeError` is null and `written` is a row — the function's
   compensating delete never runs, and two JPEGs of the wrong place are orphaned with nothing naming
   them.

Same mechanism, arriving by a route the condition cannot see. The fix belongs in the function,
because that is the only party still holding the object names (`051`'s own point), and it is one
clause: **guard the UPDATE with `.is('start_place_id', null)`**. A pick that arrived mid-flight makes
the statement match zero rows, which the function already treats as the refused-write path — so its
existing compensating delete runs, unchanged, and `noTile('column_write_refused')` is returned. The
`maybeSingle()` + `!written` branch already handles it; what changes is that the branch becomes
reachable for this case instead of the UPDATE silently succeeding.

**Both halves are function changes, so both wait on the same owner deploy**, and until then the race
orphans two objects — bounded by how often an organizer picks a place within a few seconds of
creating the ride with free text. Stated rather than mitigated away; the retention requirement says
where those bytes then live and for how long.

### D7. The picker extension, precisely

`PlaceSearchField` gains a free-text mode and nothing else. What it does **not** need: the sheet,
the debounce, the abort, the bias, the five states, `placeLabel`, `boundName`, the portal, the
`Escape` handler, the hidden-input contract — all present and all correct for this use.

What to add:

- A `freeText` mode in which the field renders an editable `<input name={names.name}>` carrying the
  text, instead of the read-only value button. The three remaining hidden inputs (place id, lat, lon)
  stay hidden. Clubs keep four hidden inputs and are untouched.
- A search affordance inside the field that opens the same sheet — the frame draws a search icon and
  a `Search location` placeholder.
- Typing in the input clears the three hidden fields. **Decided by the product owner, 2026-08-18:
  *"Lets throw away the pin if the rider types more."*** The database still permits text and pin to
  disagree — a statement may carry any text with any picked place — and the UI chooses not to, so the
  screen never shows a pin the write will not store.
- **A link to `/legal/attributions`, in the sheet.** Required by PD-114 and PD-259 in the same words,
  and **not built by PD-259**: `grep -rn "attributions" src/` finds it only in `types/index.ts`,
  `legal/terms` and `legal/privacy`. It goes on the shared control, so clubs gain it in the same
  change. One link — not a per-result credit and not a per-source line, which is the whole point of
  paying the credit once (CDLA Permissive 2.0 §3).
- `required` passed through, since `meeting_point` is `NOT NULL` and 1–120 characters.
- `sheetTitle="Set start location"` and `placeholder="Search location"`, both read from the frames.

The frames' remaining v1 styling is not transcribed (31 `(OLD)` refs, zero v2 greys); the sheet's
composition — header, title, Cancel, search field, 72px rows with a pin, a Label and a Meta line — is
what `PlaceSearchField` already builds.

### D8. Retention and visibility need no new mechanism, and that is the answer

The coordinate is three columns on `rides`. `001`/`017`/`022` decide who reads the row; RLS is
row-level, so they decide the columns too. There is no narrower policy available and a wider one
would be a defect. No SELECT grant is needed either: `rides` is `authenticated=rdm`, table-level,
unlike `postcards` (`d` only), which is why `062` had to revoke a column grant there and nothing
equivalent is needed here. Deleting the ride deletes the columns. Nothing new stores a rider's own
position: the sheet's proximity bias is resolved when the sheet opens, held in a ref, never
persisted, never sent anywhere but our own RPC.

**The columns are not the whole retention story, and the earlier draft of this section was wrong to
imply they were.** A rendered tile is a separate artifact in Storage with no foreign key back to
Postgres, and `051` says so in writing: it is *"a rendered image of where an identified rider
previously intended to be, and the bytes persist whether or not a row points at them."* Both new
triggers NULL the path columns, and after either, nothing in the database knows the object's name.
Its retention is the organizer's account — `ride-maps` is in `delete-account`'s `PREFIXES` list
(verified in `supabase/functions/delete-account/index.ts`, added by PD-104 §4), and that list is the
only thing that reaches the folder. **This change is what makes the orphan class real**: no ride has
ever carried a coordinate, so no tile has ever been rendered, and the first orphan possible will be
one rendered for an exact picked point.

## Risks / Trade-offs

- **`067` rewrites a shipped trigger on a live write path.** → `036`'s lesson applies: exercise
  create, edit, text-only edit, pick, re-pick and clear by hand on DEV in rolled-back transactions
  before applying, and never apply to PROD ahead of the code deploy. The trigger cannot raise, so the
  worst case is a cleared location rather than a refused ride write.
- **PROD is at `059` and DEV at `066`.** → `067` promotes behind six other files. Promote everything
  in the gap in filename order per `docs/ENVIRONMENTS.md` §Migrations; re-derive the gap with
  `list_migrations` against `ls supabase/migrations/` rather than off any written number.
- **Dropping `rides_geocode_coupling` by name breaks anything grepping for it.** → `051`'s footer and
  the RLS suite reference it; both are updated in the same change.
- **The Edge Function is drift until the owner deploys.** → stated in the spec as a named unbuilt
  surface, and `requestRideMapRender` is skipped for picked rides so nothing is spent or orphaned in
  the meantime.
- **Editing a picked meeting point silently loses the pin.** → deliberate, inherited from `051`'s
  reasoning, and the only alternative is deciding whether two strings denote the same place. The UI
  should make the loss visible (the pin indicator disappears as they type) rather than surprising.
- **`boundName` truncation bites harder on rides than clubs** — 120 characters against clubs' 200. 93
  of 736,538 place labels exceed 120, so roughly one label in 8,000 arrives ellipsised. → Accepted;
  the rider can edit the text, at the cost of the pin.
- **The picker cannot be reached from a keyboard-only or screen-reader path if the search affordance
  is icon-only.** → It carries an accessible name, like the existing clear button.

## Decided while this was being written

**Typing over a pick throws the pick away.** Product owner, 2026-08-18: *"Lets throw away the pin if
the rider types more."* This was Open Question 1 and is now a decision — see D7 for where it lands in
the control, and the spec's sheet-state table and its own scenario. The database still permits text
and pin to disagree; the UI does not, so the screen never shows a pin the write will not store. The
alternative that was on the table — a `Pinned: <place> · change / remove` line letting a rider
annotate without losing the pin — is closed, not deferred.

## Open Questions

Each has a recommended default so the build is never blocked on an answer.

**1. Should `Get directions` deeplink the coordinate when the location was picked? (non-blocking —
product owner)** Today it deeplinks the `meeting_point` text, so a picked exact point is handed back
to Google as a fuzzy search. **Recommended default: unchanged in this change**, raised as a
follow-up; it is a one-line change with its own testing question (a coordinate deeplink with a label
reads differently in the Maps app) and does not belong bundled with a schema change.

**2. Should a rider be able to pick a place for a ride they are not organising? (non-blocking —
already answered by the schema, recorded so nobody re-opens it)** No. `rides` UPDATE is
`auth.uid() = organizer_id` and no arm is added, so a club admin cannot. **Recommended default:
leave it that way** — a location an admin can move on someone else's ride is a ride whose crew
arrives somewhere the organizer never chose.

**3. Does the sheet need a "use my current location" row? (non-blocking — product owner)** The bias
already resolves the rider's position when the sheet opens, so the data is there. **Recommended
default: no.** A meeting point is a place riders converge on, not where the organizer is standing
while creating the ride, and the row would invite exactly that mistake — the same error `066` calls
out for clubs ("the club location is not the location of the rider who created it").
