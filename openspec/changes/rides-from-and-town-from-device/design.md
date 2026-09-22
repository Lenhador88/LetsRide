# Design — rides_from, and the town from the device

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
and no action upserts `profiles`. So an INSERT grant would widen a list without a caller, which is
the direction `096.1`'s width assertions exist to catch. The widths move from 9/8/7 to
**10/8/8**, and the file says so.

Each privilege gets its own statement, for `113` §4's reason: a column list attaches only to the
privilege immediately before it.

## D3. The bound is `018`'s, and the empty string is NULL

The CHECK is `rides_from is null or (length(btrim(rides_from)) >= 1 and length(rides_from) <= 100)`,
character for character the shape of `profiles_location_length`. `optionalText(100, …)` maps a
cleared field to `null`, so the client never sends the trimmed-empty string the CHECK refuses.
Zod owns the message and the CHECK owns the guarantee.

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
(the resolver, `places.ts`, a "clubs near you" query) turns it red, and the diff that adds the
file to the list is where a reviewer asks why. The test is verified both ways: it fails with a
probe file that names the column.

## D6. `TownFromDeviceButton`

```
tap → requestDeviceLocation()            (the OS dialog, when permission reads `prompt`)
    → deviceLocationPermission()          (re-read; `denied` hides the control for good)
    → reverseGeocodePlace(lat, lon)       (one search-places credit, `type=city`)
    → toPlaceValue(result, LOCATION_MAX_LENGTH)
    → onFound(place)                      (the parent keeps its own answer if it has one)
all of it raced against TOWN_FROM_DEVICE_CEILING_MS = 20_000
```

- **It renders only when permission reads `prompt` or `granted`.** `undefined` (not yet read),
  `denied` and `unavailable` draw nothing. After a denial the control does not come back.
- **A granted fix also invalidates `queryKeys.riderLocation()`.** `requestDeviceLocation` has
  already overwritten the resolver's memo, and a screen holding the key (the profile's
  `LocationSetting`, under the sheet) would otherwise keep showing the old source.
- **A late answer is dropped.** The parent's `onFound` sets the place only if the field is still
  empty. This is the composer's *re-checked at landing* rule, for the same reason.
- **Failure is one muted `role="status"` line, never `text-danger`.** A tap that silently does
  nothing reads as a broken button; an error colour reads as the rider's fault.
- **`toPlaceValue` is exported from `PlaceSearchField`**, rather than copied, so a device pick and
  a typed pick produce the same `PlaceValue` (including `countryCode`, which the town step needs
  for `home_country`). This is the only edit to the shared primitive.

## D7. Two callers of the requesting API, pinned

`rider-position-question` said no module other than the priming sheet's path may call the
requesting API, and nothing enforced it. `src/lib/location/__tests__/request-callers.test.ts`
walks `src/` and asserts that `requestDeviceLocation(` appears in exactly
`components/location/LocationQuestionRow.tsx` and `components/location/TownFromDeviceButton.tsx`
(outside `rider-location.ts`, which defines it).
