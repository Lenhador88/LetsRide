# Tasks — rides_from, and the town from the device

Specs: `specs/rider-profile-viewing/spec.md`, `specs/rider-position-question/spec.md`. The
mechanism and the rejected alternatives are in `design.md`.

**Order matters in one place:** §1 applies to DEV before the branch's bundle can serve, and to PROD
before the promotion merges. The client writes the column, so the wrong order gives `PGRST204` on
every profile save.

## 1. `127` — the additive migration

- [ ] 1.1 Re-derive the number off `schema_migrations` on DEV at the moment the file is written
- [ ] 1.2 `add column rides_from text`, nullable, no default, no backfill; a column comment
      stating that it is never a position and never pre-filled
- [ ] 1.3 `profiles_rides_from_length` CHECK, `018`'s shape at 100 characters
- [ ] 1.4 `grant select (rides_from)` and `grant update (rides_from)` to `authenticated`, as two
      statements; no INSERT and no `anon`
- [ ] 1.5 RLS suite: `127.*` assertions (the column stores and clears; the CHECK reports by name
      at both edges; another rider's update changes nothing; a blocked rider reads no row; the grant
      shape per privilege and per role), plus `096.1`'s widths moved to 10/8/8
- [ ] 1.6 Exercise it on DEV in a rolled-back transaction as `authenticated`, then apply it to
      DEV; read the security advisors afterwards

## 2. The attribute

- [ ] 2.1 `Profile.rides_from`, `ViewedProfile.rides_from`; `OWN_PROFILE_COLUMNS` and
      `VIEWED_PROFILE_COLUMNS` gain it
- [ ] 2.2 `ridesFromSchema` (`optionalText(100, …)`), a member of `profileEditSchema`;
      `updateProfile` parses it; `retaining(updateProfile, [..., 'rides_from'])`
- [ ] 2.3 `EditProfileForm`: a "Where you ride from" `<Input>`, and the focus effect's
      `safeParse` gains the member
- [ ] 2.4 `profileLocationLine` in `src/lib/profile-line.ts`, used by `/profile` and
      `/profile/detail`, with unit tests (set, cleared, both NULL)
- [ ] 2.5 `LocationSetting` headed "Distances measured from"; `TownQuestionSheet`'s label
      "Your town"
- [ ] 2.6 `src/__tests__/rides-from-is-not-a-position.test.ts`, verified both ways

## 3. The town from the device

- [ ] 3.1 Export `toPlaceValue` from `PlaceSearchField`
- [ ] 3.2 `TownFromDeviceButton` in `src/components/location/`, with the 20 s ceiling, the
      denial hide, the non-error status line, and `invalidate(queryKeys.riderLocation())` on a
      granted fix
- [ ] 3.3 Wire it into the onboarding town step and `TownQuestionSheet`; each parent keeps its
      own answer if the lookup lands late
- [ ] 3.4 jsdom test for the button: every outcome in `proposal.md`'s table, each verified both
      ways
- [ ] 3.5 `src/lib/location/__tests__/request-callers.test.ts`: exactly two callers of
      `requestDeviceLocation`

## 4. Gates and docs

- [ ] 4.1 `tsc`, lint, `test:unit`, `docs:check`; the RLS suite in CI
- [ ] 4.2 `docs/reference/schema.md` §profiles and `docs/reference/migrations.md` §Applied state
      record `127`; any count in `CLAUDE.md` that moved is updated
