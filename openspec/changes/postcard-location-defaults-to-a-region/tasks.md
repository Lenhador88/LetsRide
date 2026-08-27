# Tasks — postcard location defaults to a Region

**Read `design.md` before touching any of this.** Three measurements in it change the obvious
implementation: the deployed proxy returns no `country_code` (D1), dropping `Hide` does not remove
the hidden state (D2), and the existing device reader already rounds to 2dp so it cannot feed
`Precise` (D6).

**This change does not touch the audience.** The club field, the ride field and who sees the
postcard belong to `postcard-audience-follows-its-entry-point`. If a task here starts editing
`club_id` or `ride_id`, stop — it has crossed into the other change.

## 0. The deploy dependency — OWNER ACTION, blocking for the Country mode

- [ ] 0.1 **Redeploy `search-places` to DEV and PROD.** Both are stale against `shape.ts` since
      PD-279 added `country_code`, so `taken_country_code` stores NULL on every postcard today
      (DEV: 1 named place, 0 countries). Deploying is an owner action — no CLI in the container,
      and `deploy_edge_function` is on the `deny` list.
- [ ] 0.2 **Confirm by content, not by a moved hash.** Exercise `mode: 'reverse'` against a known
      coordinate and record what `country_code` and what granularity come back.
- [ ] 0.3 **Settle question F with 0.2's answer** — is `type=city` honoured on the reverse
      endpoint? `shape.ts` has never had this measured.
- [ ] 0.4 **Question C's research** (see `design.md` D5): are natural features reachable through a
      `type`/filter on the autocomplete endpoint, or do they need the Places endpoint with
      categories, and what does that cost? `*.geoapify.com` is egress-blocked from this container.
      **Do not guess a value into `shape.ts`.**

## 1. Migration `081_postcard_location_floor_is_a_country.sql`

- [ ] 1.1 Replace `postcards_taken_location_coupling` with a `'country'`-aware shape. Restructure
      rather than append a sixth `or` arm — D3 argues why, and `073`'s NULL-swallowing defect is
      the precedent.
- [ ] 1.2 **`is not distinct from`, never a bare `=`, against `taken_location_precision`.** Every
      arm. This is the single most likely regression in the file.
- [ ] 1.3 Carry `064`'s range bounds into every arm that admits a coordinate.
- [ ] 1.4 Keep the legacy `'region'` arm. One DEV row depends on it, and there is no backfill.
- [ ] 1.5 Drop `postcards_taken_country_code_needs_a_place`. Record in the header that its
      *argument* is replaced by task 2.1 rather than discarded.
- [ ] 1.6 Name `'country'` in `postcards_coarse_location_is_rounded`, or state in the header why
      the coupling makes it unreachable. Not neither.
- [ ] 1.7 Re-issue the column comment on `taken_location_precision` — four legal values now, and
      what each one means. A stale comment is `028`/`033`'s lesson.
- [ ] 1.8 Re-issue the column comment on `taken_country_code`: it may now stand alone.
- [ ] 1.9 **No UPDATE statement of any kind on `postcards`.** `044`/`046`'s trap, on this exact
      table. Grants for the INSERT/SELECT lists are unchanged — no column is added, so no grant is
      needed at all; prefer issuing none over issuing an absolute list.
- [ ] 1.10 §Verification footer: all three grant lists scoped to `authenticated`, `anon` at zero,
      both replaced constraints as `pg_get_constraintdef` returns them, the row counts before and
      after (nothing rewritten), and `get_advisors(security)` unchanged at thirteen.

## 2. Assertions — `supabase/tests/rls_test.sql`

- [ ] 2.1 Every scenario in `specs/database-enforced-integrity/spec.md`, additions only.
- [ ] 2.2 The four refusals specifically: `'country'` + coordinate, `'country'` + place name,
      `'country'` + NULL country code, and a coordinate with a NULL marker (`073`'s regression).
- [ ] 2.3 `has_column_privilege('authenticated', …, 'UPDATE')` false for every location column,
      and the UPDATE list still exactly `caption, club_id, image_path`.
- [ ] 2.4 `anon` holds zero column privileges on `postcards`, named by role rather than counted
      table-wide — `015`'s footer got that wrong on its first pass.
- [ ] 2.5 Compare **label sets** against the previous run, not counts. A count cannot tell a
      rename from a loss.

## 3. `src/lib/media/location.ts`

- [ ] 3.1 `PhotoLocationMode` becomes `'country' | 'place' | 'precise'`.
- [ ] 3.2 `DEFAULT_PHOTO_LOCATION_MODE` becomes `'place'` (the `Region` label).
- [ ] 3.3 `PhotoLocation` gains nothing — `placeCountryCode` already exists and is the column.
- [ ] 3.4 `resolvePhotoLocation` gains the `country` branch and loses the `hide` branch, keeping
      its one-function-many-shapes contract: the marker and the value are produced together or not
      at all.
- [ ] 3.5 **The all-NULL answer stays reachable from every mode.** `NO_PHOTO_LOCATION` is what a
      fixless photo with no named place resolves to under `country`, `place` and `precise` alike.
- [ ] 3.6 Unit tests for every shape the function can emit, and an assertion that it cannot emit a
      shape `081`'s coupling refuses.

## 4. `src/components/postcards/locationCopy.ts`

- [ ] 4.1 `LOCATION_MODES` becomes three entries: `Country`, `Region`, `Precise`.
- [ ] 4.2 `resolveLocationCopy` gains the `country`-with-nothing-stored branch (question B's
      recommended default) and loses the `hide` early return.
- [ ] 4.3 A sentence for a position loaded by the new action, under each mode that accepts one.
- [ ] 4.4 Extend the existing tripwire test to every state in the list in
      `specs/photo-capture-metadata/spec.md`. This module is a module *because* a wrong sentence is
      the one defect on this screen that cannot be seen by looking at it.
- [ ] 4.5 Delete the `Hide` paragraphs from the header and replace them — do not annotate them.
      `CLAUDE.md`: write a claim beside its command, not beside its history.

## 5. `src/components/postcards/CreatePostcardForm.tsx`

- [ ] 5.1 Three buttons, `Region` selected on mount and on every photo swap.
- [ ] 5.2 The reverse lookup fires once per photo, on upload settling rather than on a mode tap —
      D7. Guarded on the upload path, so a photo swap mid-flight cannot land a value for the wrong
      photo (the existing guard).
- [ ] 5.3 Never overwrite what the rider has already typed.
- [ ] 5.4 Candidate list when the lookup returns more than one — presented in the vendor's order,
      never re-ranked, never auto-selected.
- [ ] 5.5 The location block renders above the fold, with no disclosure wrapper.
- [ ] 5.6 Ceiling, offline and unavailable states surfaced rather than degraded to an empty field.

## 6. `src/lib/data/places.ts`

- [ ] 6.1 `reverseGeocodePlace` gains a candidate-returning shape (question D: one request, raised
      `limit`, no second request).
- [ ] 6.2 It stops flattening a ceiling refusal to `null`. The `bad_request` latch stays — that
      one genuinely means asking again cannot help.
- [ ] 6.3 Keep sending the **rounded** coordinate. This is the composer's whole privacy rule and it
      matters more now the lookup fires without a tap.

## 7. "Load current location"

- [ ] 7.1 Calls the existing `requestDeviceLocation()`. **Write no second device resolver** — D6.
- [ ] 7.2 Never `resolveRiderLocation()`. A `RiderLocation` whose `source` is `'profile'` must not
      reach this field.
- [ ] 7.3 Priming sheet on `prompt`; the sheet's **denied** copy on `denied`; not drawn at all on
      `unavailable`.
- [ ] 7.4 Do **not** reuse `locationPrimingState`'s `hidden` arm to decide whether to draw the
      button — that arm exists so an ambient row does not nag, and this is an explicit action.
- [ ] 7.5 Reverse-lookup the returned coordinate for a name, through the same metered path.
- [ ] 7.6 Applies under `Country`/`Region` only, per question E.

## 8. `src/components/postcards/PostcardCard.tsx`

- [ ] 8.1 Draw the flag when there is no `taken_place_name`. Ships **with** `081`, not after —
      D4.
- [ ] 8.2 Keep the accessible name on the decorative glyph.

## 9. The place-search split

- [ ] 9.1 A `criteria` discriminator on the proxy request, in `shape.ts` so `tsc` and Vitest see
      it. A decision that migrates into `index.ts` leaves the test suite silently.
- [ ] 9.2 The **ride** value reproduces today's request byte-for-byte.
- [ ] 9.3 The **postcard** value stays unset until 0.4 answers. Do not enable an unmeasured filter
      on a rider path.
- [ ] 9.4 Unrecognised criteria refused before the ledger row is written, so probing costs no
      credit.
- [ ] 9.5 No `countrycode` filter on either. Bias only.
- [ ] 9.6 Extend `src/__tests__/place-search-shape.test.ts`.
- [ ] 9.7 **This needs the redeploy in group 0 to reach riders.** An edit under
      `supabase/functions/` is drift from the moment it merges and CI has no path that notices.

## 10. Gates

- [ ] 10.1 `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`.
- [ ] 10.2 `PGPASSWORD=postgres npm test` — the RLS suite, additions only, 0 failures.
- [ ] 10.3 Apply `081` to DEV, then re-read the constraints and the grants off the database.
      Unapplied migrations are drift.
- [ ] 10.4 `get_advisors(security)` on DEV — thirteen, unchanged. This change adds no function and
      nothing `security definer`, so a new advisor means something landed the files do not
      describe.
- [ ] 10.5 `npm run walk` against DEV — the only gate that renders anything.
- [ ] 10.6 `npm run docs:check` if any numeric claim in `CLAUDE.md` or `docs/` moved.
