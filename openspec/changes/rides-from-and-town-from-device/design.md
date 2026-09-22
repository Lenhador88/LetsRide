# Design — rides_from, the consent gate, and the town from the device

## D1. A new column, not a looser old one

`profiles.location` has two writers (`setHomeTown`, `setRiderTown`) and both require a pick. It
also feeds `resolveFromProfile` → `getLocalityCentroid`. A new column is the only way to add the
attribute without giving a rider a way to erase their own position. **Rejected:** a `kind` flag on
`location`, or storing both in one column with a prefix. Either one makes every reader of
`location` learn a second shape, and the resolver is the reader that must not.

## D2. SELECT and UPDATE, no INSERT

`025` holds `profiles` to column allowlists and says every added column is invisible until it is
granted. `127` grants **SELECT** (the profile screens read it, and `columns.test.ts` requires
`OWN_PROFILE_COLUMNS` to equal the union of `grant select` lists) and **UPDATE** (the form writes
it). It does **not** grant INSERT. The row is created by the auth trigger, never by the client,
and no action upserts `profiles`, so an INSERT grant would widen a list without a caller. The
widths `096.1` pins move from 9/8/7 to **10/8/8**.

Each privilege gets its own statement, for `113` §4's reason: a column list attaches only to the
privilege immediately before it.

`columns.test.ts`'s `VIEWED_PROFILE_COLUMNS` subset check used to read `025` alone, which is the
same one-file blind spot the `OWN_PROFILE_COLUMNS` check had until `113`. It now checks against
`OWN_PROFILE_COLUMNS`, which the block above it proves equals the union of every grant.

## D3. The bound is `018`'s; the floor is stricter

`rides_from is null or (rides_from ~ '\S' and length(rides_from) <= 100)`. `018`'s floor is
`length(btrim(location)) >= 1`, and `btrim` with no second argument strips spaces only, so a tab
or a newline alone passes it. `\S` asks for one non-whitespace character of any kind.
`optionalText(100, …)` trims all whitespace and maps the empty result to `null`, so a form submit
never meets the floor. Zod owns the message and the CHECK owns the guarantee.

## D4. The display fallback is one function

`profileLocationLine({ rides_from, location })` returns `rides_from ?? location ?? null` and lives
in `src/lib/profile-line.ts`. Both profile screens call it. It is deliberately **not** under
`src/lib/location/`: that directory is the position machinery, and the test in D5 keeps
`rides_from` out of it.

## D5. "Nothing reads it for a position" is an allowlist test

`src/__tests__/rides-from-is-not-a-position.test.ts` walks `src/` (skipping tests), strips
comments, and asserts that the set of files mentioning `rides_from` equals a fixed list:
`types/index.ts`, `lib/data/columns.ts`, `lib/validation/profile.ts`, `lib/actions/profile.ts`,
`lib/profile-line.ts` and `components/profile/EditProfileForm.tsx`. A reader added anywhere else
turns it red, and the diff that adds the file to the list is where a reviewer asks why. The test
is verified both ways: it fails with a probe file under `lib/location/`.

## D6. `TownFromDevice`

```
tap → requestDeviceLocation()          the OS dialog, when permission reads `prompt`
    ├─ no fix → re-read permission     `granted` → "type your town instead"; anything else → hide
    └─ fix → invalidate(riderLocation), clearDismissal()
           → reverseGeocodePlace()     one search-places credit, `type=city`
           → toPlaceValue(result, LOCATION_MAX_LENGTH)
           → onFound(place)            only if the field was not touched since the tap
TOWN_FROM_DEVICE_CEILING_MS = 20_000   releases the control; the lookup keeps running
```

- **It wraps the field (`children`) rather than sitting beside it**, because the late-answer rule
  needs to see the rider's own answer. `PlaceSearchField` keeps typed text in an internal draft the
  parent never sees, so "is the field still empty" misses a rider mid-typing. The wrapper counts
  input, pointer-down and key-down events on the field; any of them since the tap drops the
  answer.
- **It renders only when permission reads `prompt` or `granted`.** `undefined` (not yet read),
  `denied` and `unavailable` draw nothing.
- **"Denied" is read defensively.** `deviceLocationPermission()` folds an unsupported Permissions
  API into `prompt`, and `getPositionOnce` turns a denial into `null`. So a null fix proves only a
  missing fix when the permission still reads `granted`, and otherwise the control goes for good.
- **A grant does `LocationQuestionRow`'s two cache jobs.** It invalidates
  `queryKeys.riderLocation()`, because the resolver's memo already moved. It also calls
  `clearDismissal()`, because the standing spec says a grant clears the Explore row's dismissal
  record outright.
- **The ceiling releases, it does not cancel.** The OS dialog is modal; a rider who reads it for
  longer than 20 s still gets their town when they allow it.
- **Failure is one muted `role="status"` line, never `text-danger`**, mounted before its content.
- **`type="button"`**: on the onboarding step the control sits inside the step's `<form>`.
- **`toPlaceValue` is exported from `PlaceSearchField`**, rather than copied, so a device pick and
  a typed pick produce the same `PlaceValue` (including `countryCode`, which the town step needs
  for `home_country`). This is the only edit to the shared primitive.

## D7. Two callers of the requesting API, pinned

`src/lib/location/__tests__/request-callers.test.ts` walks `src/`, strips comments, and asserts
that the identifier `requestDeviceLocation` appears in exactly `LocationQuestionRow.tsx` and
`TownFromDevice.tsx`, outside `rider-location.ts`, which defines it. It matches any mention rather
than a call, so an aliased import or a bare reference is caught too. It pins that
`LocationPrimingSheet.tsx`, which describes the call in a comment, does not count.

## D8. `128` — a consent gate for the one ledger the wizard writes

**Rejected:** a branch on `tg_table_name` inside `enforce_participation_gate`. That would edit a
body hung off twenty-four write paths to change one of them. **Rejected:** a terms-only variant
of `private.may_participate`. Every caller of that helper means participation.

**Chosen:** a separate `public.enforce_consent_gate()`: `security definer`, `search_path` pinned
empty, no EXECUTE for any client role, raising `23514` as the participation gate does, so
`search-places`' `forbidden` mapping is unchanged. It is hung on `place_search_attempts` in the
participation gate's place, keeping the `when (current_user = 'authenticated')` guard (`023` §2).
The participation-gate total moves from 24 to 23, and the twelve assertions that pin the total move
with it, each saying why.
