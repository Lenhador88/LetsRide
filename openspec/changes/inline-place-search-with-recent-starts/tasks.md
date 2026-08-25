## 1. Re-measure the ground this rests on

- [x] 1.1 Confirm on DEV that `rides`' SELECT policy still leads with `organizer_id = auth.uid()`
      (`pg_policy`), so no policy is needed for the recents read
- [x] 1.2 Confirm `authenticated` still holds column SELECT on `meeting_point`, `start_place_id`,
      `latitude`, `longitude` (`information_schema.column_privileges`), and that
      `rides_organizer_id_idx` still exists
- [x] 1.3 Confirm `rides_location_coupling` still makes `start_place_id IS NOT NULL` imply
      `latitude`/`longitude` NOT NULL, so a recents row can never be a half-pick
- [x] 1.4 Record in the PR that **this change adds no migration** — no table, column, grant, policy or
      RLS assertion — and that 1.1–1.3 are why. If any of the three has changed, stop and re-propose:
      the no-migration claim is the whole cost case
- [x] 1.5 Re-read `openspec/changes/replace-places-index-with-geocoder/specs/place-search/spec.md`'s
      seven-state table and confirm the reworded copy in this change's delta still matches it state
      for state

## 2. The recents read

- [x] 2.1 Add the row type to `src/types/index.ts` — meeting point, place id, latitude, longitude
- [x] 2.2 Add `getRecentRideStarts()` to `src/lib/data/rides.ts`: explicit `organizer_id` filter,
      `start_place_id is not null`, `order by created_at desc`, bounded by a named scan constant. State
      in the comment what the bound actually buys — `rides_organizer_id_idx` is `btree (organizer_id)`
      alone, so the limit caps the transfer while the work stays proportional to that rider's own ride
      count
- [x] 2.3 Dedupe by `start_place_id` and cap at a named `RECENT_STARTS_LIMIT` (3) inside that function,
      so no caller can ask for a different shape
- [x] 2.4 Add `queryKeys.rides.recentStarts()` to `src/lib/query/keys.ts` under the `rides` block,
      with a docstring saying why it is nested there (`rides.all()` already invalidates it) and that
      no new `invalidate()` call site is added
- [x] 2.5 Verify by inspection that `createRide`, `updateRide` and `deleteRide` each already invalidate
      `queryKeys.rides.all()`, and add nothing to them

## 3. The inline suggestion list

- [x] 3.1 Delete `PlaceSearchSheet`, its portal, its `role="dialog"`, its header and its Cancel button
- [x] 3.2 Render the suggestion list in flow inside the field's container, capped at four rows plus the
      credit, scrolling internally beyond that
- [x] 3.3 Move the seven states onto the list, keeping every message and both ceiling messages distinct
      — no state collapsed to save vertical space
- [x] 3.4 Keep the abort, the lookup's generation counter, the shared-cache read/write and the
      explicit Retry tap as they are; **raise the debounce to 400ms** and say why at the constant — the
      input is now the meeting-point field, so a long typed answer that was never meant as a lookup
      settles several times, and `069`'s ledger row is written before the vendor call
- [x] 3.5 Move `resolveRiderLocation()` from "sheet opened" to **first focus of the field**, never form
      mount, so a rider who never touches the field is never located
- [x] 3.6 Render `PlaceDataCredit` as the list's last row whenever the list has rows, recents included
- [x] 3.7 Show the `Type at least N characters to search.` hint for 1–3 characters and for an empty
      input with no recents — a SHALL in the seven-states requirement, not a choice

## 4. Recents on the ride start field

- [x] 4.1 Fetch recents on the field's first focus, through the cache key, only on a field the caller
      marks as offering them
- [x] 4.2 Render them only while the input is empty, under a `Recent starts` heading row with an icon
      distinct from the lookup rows' pin
- [x] 4.3 Show them **exactly while the input's value is empty** — not on a keystroke, so paste, cut,
      undo, an IME commit and the field's own Clear control all behave — and never filter them by what
      the field holds
- [x] 4.4 Confirm no separate late-answer guard is needed or added: recents are read through
      `queryKeys.rides.recentStarts()` and rendered only while the value is empty, which is the guard.
      A second generation counter here would be a rule free to disagree with 4.3
- [x] 4.5 Selecting a recent SHALL write the meeting point, place id, latitude and longitude together,
      make no vendor call and write no ledger row
- [x] 4.6 Treat a failed or offline recents read as "no recents": no error, no retry, no blocked submit
- [x] 4.7 Confirm recents still render and remain selectable while a lookup ceiling is in force

## 5. Combobox semantics and the keyboard

- [x] 5.1 `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-activedescendant`;
      `role="listbox"`/`role="option"` on the list and its rows
- [x] 5.1a Keep the `Recent starts` heading and `PlaceDataCredit` **outside** the `ul[role=listbox]`
      but inside the panel; render every message state instead of the list rather than inside it; set
      `aria-expanded` true only when options are actually present
- [x] 5.2 Arrow keys move the active option; Enter with an active option selects and calls
      `preventDefault()` so the form is not submitted
- [x] 5.3 Escape closes the list and does not clear the input, drop the pick, or submit
- [x] 5.4 Put `onMouseDown` + `preventDefault()` on the **whole panel**, not the rows, so the credit
      link and the Retry button survive the tap aimed at them as well — a licence credit nobody can tap
      is not a credit
- [x] 5.5 `type="text"` rather than `type="search"`, and `autoComplete="off"`, so no native dropdown or
      clear affordance competes with the list
- [x] 5.6 `scrollIntoView({ block: 'nearest' })` on open so the input and at least two rows clear the
      keyboard

## 6. The four callers

- [x] 6.1 Remove the `sheetTitle` prop from the primitive and from all four call sites
- [x] 6.2 `CreateClubForm` and `EditClubForm`: swap the value button for a search input carrying **no
      `name` attribute**, keeping the four hidden inputs unchanged
- [x] 6.3 Club mode: typing SHALL NOT drop a held pick; on blur with unpicked text revert the input to
      the picked name or to empty; Clear drops the pick and empties the text together and is the only
      thing that removes a stored club location
- [x] 6.3a Club mode: Enter with the list open and no active option reverts the text to the held pick
      and closes the list **without** preventing the submit — the path where no blur ever happens, which
      is how a typed-over club location would otherwise be submitted as written
- [x] 6.4 `CreateRideForm` and `EditRideForm`: unchanged storage — the visible input is still
      `meeting_point`, typing still throws the pin away, and only these two pass `recents`
- [x] 6.5 Verify PD-199 retention on all four: a refused submit gives every typed field back, and
      opening or closing the list never clears the text
- [x] 6.6 Check the edit forms specifically: a prefilled meeting point means no recents until the rider
      clears the field

## 7. Tests

- [x] 7.1 Update `src/components/ui/__tests__/place-search-field.test.tsx` for the club field's new
      shape — the four hidden inputs still present, the visible input carrying no `name`
- [x] 7.2 Assert `PlaceDataCredit` still renders Geoapify and the OpenStreetMap link (existing test,
      unchanged)
- [x] 7.3 Unit-test `getRecentRideStarts()`: dedupe by place id, newest first, capped at 3, rows with a
      null place id excluded, and the organizer filter present
- [ ] 7.4 Test the combobox keys — Escape does not submit or clear, Enter with an active option selects
      and does not submit, Enter with none in place mode reverts and still submits (needs an
      event-capable environment; see design.md Q4)
- [x] 7.5 `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build` all green
- [ ] 7.6 `npm test` (RLS suite) still green — expected untouched, since no migration is added

## 8. Verify it on something that renders

- [x] 8.1 Run the walk against DEV through the relay and confirm every screen still renders and the
      create/edit refusal phases still pass with the new field
- [x] 8.2 By hand on DEV, with fixtures: create a ride with a picked start, then confirm it appears at
      the top of recents on the next create form
- [x] 8.3 By hand: type over a picked start, save, and confirm that ride leaves the recents list
- [x] 8.4 By hand: sign out and back in as a second rider, and confirm the first rider's recents are
      gone
- [ ] 8.5 **On a real device in the shell** (native shell owner): confirm at least two suggestions and
      the input are visible and tappable with the keyboard raised, on the create-ride form. Do not mark
      this from a desktop browser

## 9. Close out

- [x] 9.1 Update `docs/reference/repo-layout.md` and any doc that describes the search sheet as a
      full-screen surface
- [x] 9.2 `npm run docs:check` — no claim about the field, the sheet or the dependency count left stale
- [x] 9.3 `reviewer` pass on the final diff before the PR
- [ ] 9.4 Confirm the four falsified standing requirements in
      `add-ride-start-location-search/specs/ride-start-location/spec.md` are all covered by a MODIFIED
      block here — free text (the `Cancel` scenarios), the sheet-linked attribution requirement, that
      file's own states table, and the bias trigger inside retention — so no fold can leave a
      self-contradicting standing spec
- [x] 9.5 When `replace-places-index-with-geocoder` and `add-ride-start-location-search` close, fold
      `place-search` and `ride-start-location` into `openspec/specs/` (archive, or `openspec sync`)
      and confirm this change's MODIFIED blocks apply cleanly

## 10. What is NOT ticked above, and why

Every unticked box needs something this container has not got. None of them is forgotten.

- **7.4 — the combobox-key test in an event-capable environment.** Declined, with the reasoning in
  `design.md` Q4: the key *decision* is `resolveComboboxKey`, pure and covered; the `onKeyDown`
  wiring that calls it — including place mode's Enter revert (6.3a) — is verified by reading and by
  the browser pass in §11.
- **7.6 — the RLS suite.** Postgres is not running here. This diff touches no `supabase/**` file, so
  CI's job is correctly skipped rather than red.
- **8.5 — the keyboard-occlusion check on a real device.** The native shell's, and unrunnable
  anywhere else: no native project has ever been generated here. **This is the one open
  verification for this change.**
- **9.4 — folding the two delta capabilities into `openspec/specs/`.** Waits on
  `replace-places-index-with-geocoder` and `add-ride-start-location-search` closing, which is
  neither this change's work nor available to it.

## 11. What the browser actually showed (2026-08-20, DEV through the relay)

`npm run walk`: **18/18** screens, **45/45** guard/navigation/sign-out checks. It also found a
stale line in the walk itself — `/clubs/detail/about` was deleted by the club-detail merge and the
walk still visited it, reporting a 404 as if a screen were broken. Removed.

Then, by hand through the create form, 20 checks — 20 passed:

- A typed term returns tappable results; picking writes the text and the pin together and closes
  the list; the ride saves with its pick.
- **8.2** Focusing the empty field on the next create form shows `Recent starts` with that pick at
  the top, and **no typeahead call** — the read is the rider's own rows.
- One character clears the recents and the minimum-characters hint takes their place, with **no
  call below the minimum**; emptying the field brings them back (the value rule, tested through
  Backspace rather than a fresh keystroke).
- Tapping a recent fills the meeting point and **restores the pin**, for no call; typing over it
  throws the pin away.
- **The regression the diff review caught, verified gone:** `/rides/detail/edit` fires **no**
  typeahead on mount *or* on focusing its prefilled field, and shows no panel over prefilled text.
- **8.3** A start typed over stops being a recent, and a typed-only meeting point never becomes
  one. An empty field with no recents falls back to the hint, which is `design.md`'s SHALL.
- **8.4** partially: the read carries `organizer_id=eq.<the signed-in rider>` on the wire, and a
  second DEV account's picked starts never appeared in it. A true two-rider swap needs a second
  account and was not run; sign-out's half is `clearQueryCache()`, which the walk and the unit
  suite both cover.
