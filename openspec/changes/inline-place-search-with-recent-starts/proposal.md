## Why

**The lookup is a whole screen for a two-word answer.** Setting a ride's start today is tap the
field → a full-screen sheet covers the half-filled form → type → tap a row → the sheet closes.
The field is the third control on `/rides/new`, and the sheet is the only control in the app that
takes over the screen to fill in one field. The product owner's call, 2026-08-19, is that the
suggestions belong on the field itself and the sheet goes away.

**Two controls do one job, and the second one is where the divergence lives.**
`src/components/ui/PlaceSearchField.tsx` is a primitive with two shapes — a club's location is a
value *button*, a ride's meeting point is an editable input — and both shapes hand off to the same
sheet to actually search. Moving the list onto the input collapses the two shapes into one and
deletes ~200 lines of sheet, its portal, its `role="dialog"`, and its own second search input.

**The rider's own last starts are the best accelerator in the app and they cost nothing.** An
organizer meets their crew at the same café, layby or petrol station repeatedly. Those starts are
already on `rides` and already readable — **measured on DEV (`fpmrimzxadewsaiwpsel`) 2026-08-19,
not inherited**:

- `rides` carries `meeting_point`, `start_place_id`, `latitude`, `longitude`.
- The SELECT policy's **first arm** is `organizer_id = auth.uid()`, unconditional — before the
  block check, before the club check. A rider can always read the rides they organized.
- `authenticated` holds column SELECT on all four (`information_schema.column_privileges`).
- `rides_organizer_id_idx` on `(organizer_id)` already exists.
- `rides_location_coupling` (`067`) makes the read **total**: `start_place_id IS NOT NULL` implies
  `latitude` and `longitude` are `NOT NULL` and `geocode_confidence` is NULL. A recents row can
  never be a half-pick.

So: **no migration, no new table, no new grant, no new policy, no RLS assertion** — and a tapped
recent spends no vendor credit and writes no `place_search_attempts` row (`069`), which also makes
recents the one thing that still works for a rider who has hit a ceiling.

## What Changes

- **`PlaceSearchSheet` is deleted.** Search becomes a suggestion list attached to the field's own
  input, on **all four callers**: `CreateRideForm`, `EditRideForm`, `CreateClubForm`,
  `EditClubForm`. **BREAKING (internal API):** the `sheetTitle` prop goes; four call sites change.
- **The club field becomes an input too**, so the primitive ends with one shape instead of two.
  A club's location is still a pick or nothing — the visible input is a *search box* and the four
  hidden inputs stay the only thing submitted, so typed-and-not-picked text can never read as a
  stored location.
- **A ride's meeting point keeps its free text.** "The layby past the second roundabout" stays a
  legal meeting point; search is an accelerator, never a gate. Typing throws the pin away
  (unchanged, owner 2026-08-18).
- **On focus with an empty input, the ride start field shows the rider's last 3 start locations** —
  their own organized rides where `start_place_id is not null`, deduped by `start_place_id`, newest
  ride first.
- **Recents clear the moment there is anything in the field, and are never filtered by it.** Owner: *"I
  dont think anyone would be typing to filter a 3 option dropdown. Also more clear to the user the
  api call is about to be requested."* The 1–3 character state is the existing
  `Type at least 4 characters to search.` hint, and that visible gap is deliberate — it is the
  signal a lookup is about to fire.
- **The seven lookup states are reworded onto the inline list, not weakened.** All seven still have
  to be tellable apart with no sheet to put them in.
- **The Geoapify / OpenStreetMap credit moves onto the inline list**, rendered whenever the list is
  open with rows in it, recents included.
- **The list gets combobox semantics** — roles, arrow keys, Escape that closes without clearing or
  submitting, Enter that selects without submitting. The sheet got focus handling free from
  `role="dialog"`; an inline list gets none of it.
- **Recents get a cache key in `src/lib/query/keys.ts`**, nested under `rides`, so
  `createRide`/`updateRide`/`deleteRide`'s existing `invalidate(queryKeys.rides.all())` reaches it
  with no new invalidation call site.

**Three assumptions the product owner already resolved. They are decisions, not open questions:**

1. **Recents are PICKED places only** — never a meeting point the rider merely typed. A row that
   restores no pin looks identical to one that does and behaves differently, and `067`'s
   `rides_location_coupling` refuses a coordinate that is neither picked nor geocoded, so a
   text-only "recent" could only ever write text.
2. **Recents are for the ride start field only.** A club's location is a town, a ride's start is a
   spot, and a rider creates roughly one club — "recent club locations" has no content. The club
   field gets the inline list and no recents.
3. **Recents show only while the input is empty**, so a prefilled edit form shows none until the
   rider clears the field.

## Capabilities

### New Capabilities

None. Everything here is a change to behaviour that two existing capabilities already own, and a
fourth delta-only capability would be one more thing waiting to be folded into `openspec/specs/`.

### Modified Capabilities

- `place-search`: the lookup **surface** — its seven states reworded off "the sheet" onto an inline
  list, the attribution scenario, the deferred-surfaces list (which deferred "saved or recent
  places" and must now say precisely which half of that is being built), plus the new inline
  requirements: focus behaviour, clearing on the first keystroke, combobox semantics, operating
  under a raised keyboard, and a tapped recent costing no credit.
- `ride-start-location`: the recents **read** — its source, the rule for every role that can reach
  it, the negatives, its retention (it introduces no new store), and the one-picker requirement, whose
  picker is now the field itself. **Plus four standing requirements this change falsifies and must not
  leave standing**: the free-text requirement's `Cancel` scenarios, the sheet-linked attribution
  requirement (which also still argues from the Overture licence `070` retired), that capability's own
  copy of the states table, and the bias trigger inside the retention requirement, which moves from
  "when the sheet opens" to first focus. Each gets a MODIFIED block, because the moment either parent
  change archives they would otherwise fold into a standing spec that contradicts itself.
- `client-cache-invalidation`: the recents cache key, its lifetime, what invalidates it, and its
  destruction at sign-out on a shared device.

**Housekeeping, stated rather than hidden:** `place-search` and `ride-start-location` are **not** in
`openspec/specs/`. They exist only as deltas inside `replace-places-index-with-geocoder` (46 tasks
open) and `add-ride-start-location-search` (34 open), neither of which can be archived, and archive
is what folds a delta into a standing spec. This change therefore writes its deltas against those
capability names in place — the same thing `replace-places-index-with-geocoder` did when it wrote
`## MODIFIED Requirements` against `ride-start-location`, which was already delta-only. Each MODIFIED
requirement below restates the requirement in full and names the file it currently lives in, so
folding is mechanical whenever those two changes close. `client-cache-invalidation` is a standing
spec and its delta is ordinary.

## Impact

**Code**

- `src/components/ui/PlaceSearchField.tsx` — the sheet is deleted; the list, the recents, the
  combobox behaviour and `PlaceDataCredit`'s placement all land here.
- `src/components/rides/CreateRideForm.tsx`, `EditRideForm.tsx`,
  `src/components/clubs/CreateClubForm.tsx`, `EditClubForm.tsx` — the `sheetTitle` prop goes; the
  club forms lose the value button.
- `src/lib/data/rides.ts` — one new read for the recents, with its own bound.
- `src/lib/query/keys.ts` — one new key under `rides`. No new `invalidate()` call site.
- `src/types/index.ts` — the recents row type.
- `src/components/ui/__tests__/place-search-field.test.tsx` — the form-shape assertions change
  shape with the club field; `PlaceDataCredit` keeps its own test.
- `src/lib/data/__tests__/` — a unit test for the recents read's dedupe and ordering.

**Not touched**

- **`supabase/` — nothing.** No migration, no policy, no grant, no new RLS assertion, because the
  read adds no reachable data. The existing `rides` SELECT assertions already cover it.
- The `search-places` Edge Function and `069`'s ledger — recents never reach either.
- `/legal/attributions` and `/legal/privacy` — the credit moves surface, and the obligation, the
  vendor and the disclosure are all unchanged. A recent is a row this app already stored.
