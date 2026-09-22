# Tasks — rides_from, the consent gate, and the town from the device

Specs: `specs/rider-profile-viewing/spec.md`, `specs/rider-position-question/spec.md`,
`specs/place-search/spec.md`. The mechanism and the rejected alternatives are in `design.md`.

**Order matters in one place:** `127` applies to DEV before the branch's bundle can serve, and to
PROD before the promotion merges. The bundle reads and writes the column. `128` has no order.

## 1. `127` — the additive migration

- [x] 1.1 Take the number off DEV's `schema_migrations` at the moment the file is written (126 was
      the last row at 12:50Z and again at apply time)
- [x] 1.2 `add column rides_from text`: nullable, no default, no backfill, and a column comment
      saying it is never a position and never pre-filled
- [x] 1.3 `profiles_rides_from_length`: at most 100 characters, and `~ '\S'` so a tab or newline
      alone is refused
- [x] 1.4 `grant select (rides_from)` and `grant update (rides_from)` to `authenticated`, as two
      statements; no INSERT and no `anon`
- [x] 1.5 RLS suite `127.0`–`127.5`; `096.1`'s widths move to 10/8/8
- [x] 1.6 Exercised on DEV as `authenticated` in a rolled-back transaction (own write, another
      rider's write = 0 rows, clear to NULL), then applied to DEV; advisors unchanged

## 2. `128` — the consent gate on the search ledger

- [x] 2.1 Measure the defect on DEV as `authenticated`: a consented, un-onboarded rider → `23514`
- [x] 2.2 `public.enforce_consent_gate()`: definer, `search_path` pinned empty, EXECUTE revoked
      from `public`, `anon` and `authenticated`; swap it onto `place_search_attempts` with the
      `current_user` WHEN guard; restamp `enforce_participation_gate`'s comment to twenty-three
- [x] 2.3 RLS suite `128.1`–`128.3`, plus the twelve participation-gate totals moved from 24 to 23
- [x] 2.4 Exercised on DEV in a rolled-back transaction (the consented rider is allowed; 23
      remain), then applied to DEV; advisors unchanged

## 3. The attribute

- [x] 3.1 `Profile.rides_from`, `ViewedProfile.rides_from`; `OWN_PROFILE_COLUMNS` and
      `VIEWED_PROFILE_COLUMNS`; `columns.test.ts`'s viewed check reads the full grant union
- [x] 3.2 `ridesFromSchema`, a member of `profileEditSchema`; `updateProfile` parses it;
      `retaining(updateProfile, [..., 'rides_from'])`
- [x] 3.3 `EditProfileForm`: a "Where you ride from" `<Input>`, and the focus effect's
      `safeParse` gains the member
- [x] 3.4 `profileLocationLine` in `src/lib/profile-line.ts`, used by `/profile` and
      `/profile/detail`, with unit tests
- [x] 3.5 `LocationSetting` headed "Distances measured from"; `TownQuestionSheet`'s label "Your
      town"
- [x] 3.6 `src/__tests__/rides-from-is-not-a-position.test.ts`, verified both ways with a probe
      reader under `lib/location/`

## 4. The town from the device

- [x] 4.1 Export `toPlaceValue` from `PlaceSearchField`
- [x] 4.2 `TownFromDevice`: `type="button"`, the releasing ceiling, the defensive denial read,
      `clearDismissal` on a fix (and no `riderLocation` refresh; the save does it), the touched
      counter, the non-error status line
- [x] 4.3 Wired into the onboarding town step and `TownQuestionSheet`
- [x] 4.4 jsdom test for every outcome; the type, dismissal, denial and touched guards each
      verified to fail with the guard removed
- [x] 4.5 `src/lib/location/__tests__/request-callers.test.ts`: exactly two callers,
      comment-stripped, any mention
- [x] 4.6 Reverse geocoding verified by content on DEV: city names, never a street
- [x] 4.7 The comments this falsified: `LocationQuestionRow` ("its only caller"),
      `LocationSetting` ("the one control that may prompt"), `TownQuestionSheet` ("anything the
      rider did not type")

## 5. Gates and docs

- [x] 5.1 `tsc`, lint, `test:unit`, `docs:check`; the RLS suite in CI
- [x] 5.2 `docs/reference/schema.md` (the `profiles` row, the participation gate, the ledger row)
      and `docs/reference/migrations.md` (applied state) record `127` and `128`; every count in
      `CLAUDE.md` that moved is updated
