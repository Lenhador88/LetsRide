## 0. Before anything is written

- [x] 0.1 Re-derive the next migration number: `ls supabase/migrations/` against
      `list_migrations` on **both** refs. `066` is the tip on files and on DEV (`fpmrimzxadewsaiwpsel`);
      PROD (`zwprydcyryvudhurbnye`) is behind. Do not trust `067` from this file.
- [x] 0.2 Re-measure the two facts `067` is built on, on DEV, rather than trusting `design.md`:
      the `authenticated` column grants on `rides` scoped to that grantee, and the same-statement
      trigger collision inside a rolled-back transaction (`update rides set meeting_point = …,
      latitude = …, longitude = …, geocode_confidence = …` returning three NULLs).
- [x] 0.3 Read `supabase/migrations/051_ride_map_tiles.sql` end to end, and `066_clubs_carry_a_location.sql`
      for the pattern. `067` replaces two of `051`'s objects.

## 1. Migration `067` — the schema

- [x] 1.1 `alter table public.rides add column start_place_id text;` with a column comment saying it
      is the Overture GERS id, provenance and never a join key, `text` because GERS ids are opaque.
- [x] 1.2 `drop constraint rides_geocode_coupling` and add `rides_location_coupling` with the three
      arms from `design.md` §D2. **Keep the `0.70::real` and `1.0::real` casts** — uncast, a
      confidence exactly at the floor violates its own constraint (`051` measured it).
- [x] 1.3 Add `rides_start_place_id_length` (≤ 100), mirroring `066`.
- [x] 1.4 Rewrite `public.clear_ride_map_tiles()` per §D3 and re-create its trigger with the widened
      WHEN (`meeting_point` **or** `start_place_id` distinct). Update the function comment, including
      why the WHEN scope is not optional (`propagate_club_privacy_to_rides`).
- [x] 1.5 Add `public.protect_picked_ride_location()` and its trigger per §D4 — restore the picked
      coordinate, force `geocode_confidence` NULL, NULL both tile paths, never raise. `security
      invoker`, `set search_path = ''`, and `revoke all ... from public, anon, authenticated`.
- [x] 1.6 Additive grants: `insert (start_place_id, latitude, longitude)` and
      `update (start_place_id)` to `authenticated`. No `anon` grant of any kind. No INSERT grant on
      `geocode_confidence`.
- [x] 1.7 No index and no RLS policy on the new column — record both as decisions in the file header,
      with `066` §4's trigger for adding an index later (a SQL-side distance predicate).
- [x] 1.8 Write the verification block into the file footer: grants **scoped to grantee**
      (`015`'s lesson — a table-wide count reads wrong), each CHECK arm refused/accepted, and the
      same-statement pick surviving.

## 2. Migration `067` — apply and verify

- [x] 2.1 Hand-exercise every affected write path on DEV in rolled-back transactions **before**
      applying: create with a pick, create without, edit text only, edit with a new pick, re-pick the
      same place, clear the pick, and a geocode-shaped UPDATE against a picked ride.
- [x] 2.2 Apply to DEV. Re-run 1.8's verification against the live project.
- [x] 2.3 `get_advisors(security)` on DEV — the expected set is the ten in `CLAUDE.md`; a new WARN
      means a revoke did not land. `protect_picked_ride_location` is `security invoker` and should add
      none.
- [ ] 2.4 Do **not** apply to PROD ahead of the code deploy. `067` is additive, so it is safe to
      promote with or shortly after the code; promote the whole `060`–`067` gap in filename order per
      `docs/ENVIRONMENTS.md`.

## 3. RLS assertions (`supabase/tests/rls_test.sql`)

- [x] 3.1 Update every reference to `rides_geocode_coupling` — it no longer exists by that name.
- [x] 3.2 Coupling: each of the three arms accepted; each mixed combination refused with `23514`
      (place id with no coordinate; coordinate with neither confidence nor place id; both markers at
      once; out-of-range lat/lon; confidence below the floor / above the ceiling).
- [x] 3.3 **The same-statement case**, written as one statement: text + pick together survives; text
      alone clears everything; text + the row's existing place id clears everything.
- [x] 3.4 Precedence: a geocode-shaped UPDATE on a picked ride leaves the picked coordinate, NULL
      confidence and NULL paths, and does **not** raise. A path-only UPDATE with unchanged
      coordinates is accepted.
- [x] 3.5 Grants, scoped to `authenticated` — INSERT reaches `start_place_id`, `latitude`,
      `longitude` and **not** `geocode_confidence`; `anon` holds none.
- [x] 3.6 Reach, one assertion per role: organizer writes; club admin's UPDATE affects zero rows;
      member reads; non-member of a private club's ride reads zero rows; blocked rider reads zero
      rows in both directions; `anon` reaches nothing.
- [x] 3.7 The bulk-update case: `propagate_club_privacy_to_rides` across a club leaves every ride's
      location and tiles intact.
- [x] 3.8 `PGPASSWORD=postgres npm test` green, and compare **label sets** against the previous run,
      not counts — a count cannot tell a rename from a loss.

## 4. The picker extension

- [ ] 4.1 Add the free-text mode to `src/components/ui/PlaceSearchField.tsx` per §D7: an editable
      input carrying the text under `names.name`, three hidden inputs for the rest, a search
      affordance opening the existing sheet, `required` passed through. **Do not write a second
      picker.**
- [ ] 4.2 Typing in the input clears the pick (the three hidden fields empty). The clear control
      clears text and pick together.
- [ ] 4.3 The search affordance carries an accessible name; the sheet keeps its `role="dialog"`,
      `aria-modal` and `Escape` handling.
- [ ] 4.4 **Typing clears the pick** — product owner, 2026-08-18, *"Lets throw away the pin if the
      rider types more."* Not a preference to re-litigate; the field must stop showing a pin the write
      will not store.
- [ ] 4.5 **Add the `/legal/attributions` link to the sheet.** Required by PD-114 **and** PD-259 in
      the same words, and **not built by PD-259** — `grep -rn "attributions" src/` finds it only in
      `types/index.ts`, `legal/terms` and `legal/privacy`. One link in the sheet, on the shared
      control so clubs gain it too. Not a per-result credit and not a per-source line.
- [ ] 4.6 Extend `src/components/ui/__tests__/place-search-field.test.ts`: free-text mode renders an
      input, typing clears the hidden fields, picking fills all four, the attributions link is
      present, clubs' four-hidden-input shape is unchanged.
- [ ] 4.7 Confirm `CreateClubForm` and `EditClubForm` are untouched behaviourally and still pass —
      they gain the attribution link and nothing else.

## 5. Ride forms, validation and actions

- [ ] 5.1 `src/lib/validation/rides.ts`: `RIDE_LOCATION_FIELD_NAMES`, a `readRideLocation(formData)`
      mirroring `readClubLocation` (all-or-nothing, finite numbers), and a nullable location on
      `rideSchema`. Zod owns the **message**; `067` owns the guarantee.
- [ ] 5.2 `CreateRideForm`: swap the `meeting_point` `<Input>` for the field in free-text mode,
      `sheetTitle="Set start location"`, `placeholder="Search location"`, `maxNameLength={RIDE_MEETING_POINT_MAX}`.
- [ ] 5.3 **Retention across a refusal.** `retaining(...)`/`RIDE_FIELDS` must carry the three location
      fields, or a refused create loses the pick — PD-199's defect shape, and the walk has a phase
      that measures exactly this.
- [ ] 5.4 `EditRideForm`: same field, seeded from the ride's stored pick so an unchanged save does not
      drop it.
- [ ] 5.5 `createRide`: destructure `location` out of the parsed data (a `location` key posted to
      PostgREST answers `PGRST204`) and insert the three columns, exactly as `createClub` does.
- [ ] 5.6 `updateRide`: send all three location columns on every update — present on a pick, NULL when
      cleared — so "the rider cleared it" is a real edit. Note the tile-object delete ordering already
      documented there is unchanged.
- [ ] 5.7 `requestRideMapRender` is **not** called when the write carried a pick (§D6), so no vendor
      call is paid and no object is orphaned by D4's silent override.
- [ ] 5.8 Types: add `start_place_id`, `latitude`, `longitude` where the ride shapes need them in
      `src/types/index.ts`, and to `getRideForEdit`'s select so the edit form can seed. Do **not** add
      them to `RIDE_SELECT` unless a list screen renders them.
- [ ] 5.9 Cache: the write path already invalidates `rides.all()` and the detail key; add nothing new
      and add no key that is not in `src/lib/query/keys.ts`.

## 6. The Edge Function (owner deploy)

- [ ] 6.1 `supabase/functions/resolve-ride-location/index.ts`: read `start_place_id` with the ride,
      and when it is present skip the geocode and the three gates, render both tiles from the stored
      coordinate, and write **only** the two path columns.
- [ ] 6.1a **Guard the step-8 UPDATE with `.is('start_place_id', null)`** on the geocoded path. 6.1
      cannot cover the race: a pick that arrives *after* the ride was read but *before* the UPDATE
      lands makes `protect_picked_ride_location` NULL the path columns while the statement still
      **succeeds**, so the compensating delete never runs and two JPEGs of the wrong place are
      orphaned. The guard turns that into a zero-row result, which the existing `!written` branch
      already handles — delete the uploads, return `noTile('column_write_refused')`. Add the case to
      the function's own §8 comment.
- [ ] 6.2 Keep every decision in `gates.ts`, where `src/__tests__/ride-geocode-gates.test.ts` can
      reach it — a decision that moves into `index.ts` leaves the test suite.
- [ ] 6.3 Add a test for the skip branch alongside the existing gate tests.
- [ ] 6.5 **Reinstate `requestRideMapRender` for picked writes, in the same PR as the deploy.**
      5.7 suppresses the call because the *currently deployed* build would orphan two objects on a
      picked ride — the condition is about which build is live, not about picks. Once 6.1 is
      deployed that build is the only thing that ever renders a picked ride's tile, and nothing else
      invokes the function, so leaving 5.7's guard in place ships a map that silently never appears
      for exactly the rides carrying the best coordinates. Found while building 5.7; the gap was
      between 5.7 and 6.1 rather than inside either.
- [ ] 6.4 **Ask the owner to deploy**, and say plainly in the PR that until they do, a picked ride
      carries an exact coordinate and no tile. Do not claim the function is current; verify with
      `list_edge_functions` against both refs and the `updated_at`-vs-commit-date check.

## 7. Coordination and documentation — do not let these land silently

- [ ] 7.1 **The orphaned-tile class, and its retention.** Both new triggers NULL the path columns, and
      after either, nothing in the database knows the object's name. Verify — do not assume — that
      `'ride-maps'` is still in `PREFIXES` in `supabase/functions/delete-account/index.ts` (it is,
      added by PD-104 §4, and that list is the only thing reaching the folder), and record in the PR
      that **this change is what first makes the orphan class real**: no ride has ever carried a
      coordinate, so no tile has ever been rendered. This is the counterpart to
      `add-ride-map-tiles` 7.1 and it exists for the same reason — the code half being done is not
      the specification half being done.
- [ ] 7.2 **Update `docs/reference/schema.md`'s `rides` row.** `067` falsifies it in three places: the
      `insert` list goes from ten columns to 13, the `update` list gains `start_place_id`, and *"a
      coordinate needs a confidence at or above the floor"* stops being true — a picked coordinate
      carries none. `Three CHECKs` becomes four, and `rides_geocode_coupling` no longer exists by
      name. `066` updated that file for clubs; same precedent, same file.
- [ ] 7.3 Note in the PR that PD-114's *"the coordinates may not be landing"* suspicion is now traced:
      the function fires and **refuses** at the granularity gate — `ride_map_render_attempts` holds
      two rows for the two rides created 2026-08-17, both free text, both leaving the columns NULL.
      PD-260 depends on the same answer.

## 8. Provenance hardening — AFTER the Edge Function deploy, never before

- [ ] 8.1 **Do not start this until 6.1 is deployed.** The order is fixed by `021`/`025`: additive
      first, deploy, destructive last. `resolve-ride-location` writes as the **caller**
      (`authenticated`), not `service_role`, so revoking `update (geocode_confidence)` ahead of the
      deploy raises `42501` on every geocode — fail-open, so every ride silently stops getting a tile
      with nothing red anywhere.
- [ ] 8.2 Add a `security definer` `record_ride_geocode(ride_id, lat, lon, confidence)` that checks
      `organizer_id = auth.uid()` and writes the geocoded arm. Narrow on purpose — it takes no other
      column — and it adds a ninth `authenticated_security_definer_function_executable` advisor,
      which is expected rather than new.
- [ ] 8.3 Switch the function to call it, deploy, verify, **then** a separate migration revoking
      `update (geocode_confidence)` from `authenticated`.
- [ ] 8.4 Assert it against the **role** — `has_column_privilege('authenticated', 'public.rides',
      'geocode_confidence', 'UPDATE')` false — rather than by calling the function, which is `031`'s
      lesson: the RLS suite runs as the table owner, for whom no grant barrier exists.

## 9. Gates and wrap-up

- [ ] 9.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 9.2 `npm run walk` with `WALK_FIXTURES=1` against DEV via the relay — its create/edit phases
      assert that every field and choice survives a refusal, which is what covers 5.3.
- [ ] 9.3 `npm run docs:check` if any claim in `CLAUDE.md` or `docs/` moved (the ride trigger count on
      `rides` goes from four to five).
- [ ] 9.4 `reviewer` on the diff before the PR. Point it at `067` and at the same-statement trigger
      case specifically.
