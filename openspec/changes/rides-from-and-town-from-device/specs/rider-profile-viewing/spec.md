## RENAMED Requirements

- FROM: `### Requirement: The screen SHALL show exactly seven columns of the subject, and SHALL name them`
- TO: `### Requirement: The screen SHALL show exactly eight columns of the subject, and SHALL name them`

## MODIFIED Requirements

### Requirement: The screen SHALL show exactly eight columns of the subject, and SHALL name them

The screen SHALL read `id, username, avatar_path, cover_image_path, bio, location, rides_from,
created_at` and no others. `rides_from` is granted to `authenticated` by `127` and every other
column by `025`. The allowlist is a **projection** decision, not a permission one, and it is
written down because nothing in the database would refuse a wider one.

`terms_accepted_at`, `onboarding_completed_at` and `terms_version` SHALL NOT be read. They carry
no grant to `authenticated` at all, so naming one turns the whole read into a `42501` — the
allowlist is what keeps the screen working, as well as what keeps it honest.

#### Scenario: The projection is a subset of the grant

- **WHEN** the viewed-profile column allowlist is compared against the union of every migration's
  `grant select (...) on public.profiles to authenticated`
- **THEN** every column in the allowlist SHALL appear in the grant
- **AND** the check SHALL be a test that reads the migrations, not a comment asserting it

#### Scenario: Consent and lifecycle stamps are never shown

- **WHEN** the screen renders any "member since" or account-age affordance
- **THEN** it SHALL derive it from `created_at` only
- **AND** SHALL NOT read `onboarding_completed_at` or `terms_accepted_at`, which
  `database-enforced-integrity` requires stay unreadable by other riders

#### Scenario: The wider projection does not leak into shared contexts

- **WHEN** a member list, ride crew, postcard byline or filter tile renders a rider
- **THEN** it SHALL keep using the four-column `PUBLIC_PROFILE_COLUMNS`
- **AND** the eight-column allowlist SHALL be used only by this screen, so that a bio or a
  `rides_from` is not shipped to every list that draws a name

## ADDED Requirements

### Requirement: "Where you ride from" SHALL be the rider's own words, and SHALL NOT be a position

`profiles.rides_from` SHALL be free text the rider writes on their own profile, bounded like
`profiles.location` (`018`) and otherwise unvalidated. It SHALL start NULL, and nothing SHALL
pre-fill it: not onboarding, not a backfill, and not a copy of the placed town.

The profile header on `/profile` and `/profile/detail` SHALL show `rides_from` when it is set and
`location` otherwise, and nothing when both are NULL.

No module SHALL read `rides_from` to derive a coordinate, a distance, a proximity bias or a
"near" label. The placed town, `profiles.location`, SHALL remain the only stored position.

#### Scenario: A rider writes the line
- **WHEN** a rider saves "the wrong side of the Maas" in *Where you ride from*
- **THEN** `rides_from` SHALL store it, `location` SHALL be unchanged, and both profile screens
  SHALL show the new line
- **AND** every distance list SHALL still be measured from the placed town

#### Scenario: A rider clears the line
- **WHEN** a rider empties the field and saves
- **THEN** `rides_from` SHALL be NULL, not the empty string
- **AND** the profile header SHALL fall back to the placed town

#### Scenario: Another rider cannot write it
- **WHEN** rider B issues `update profiles set rides_from = … where id = <A>`
- **THEN** no row SHALL change

#### Scenario: A blocked rider cannot read it
- **WHEN** A has blocked B, in either direction
- **THEN** B's read of A's profile row, `rides_from` included, SHALL return nothing

#### Scenario: A signed-out visitor holds nothing on it
- **WHEN** the grants on `profiles.rides_from` are listed
- **THEN** `anon` SHALL hold no privilege on the column
- **AND** `authenticated` SHALL hold SELECT and UPDATE and SHALL NOT hold INSERT

#### Scenario: The CHECK binds every writer
- **WHEN** any writer stores a value with no non-whitespace character (spaces, tabs or newlines
  alike) or more than 100 characters
- **THEN** the write SHALL fail with `23514`, reported by `profiles_rides_from_length`

#### Scenario: Nothing reads it for a position
- **WHEN** the source files under `src/` that mention `rides_from` are listed, comments excluded
- **THEN** the list SHALL equal a fixed allowlist containing no module under `src/lib/location/`,
  no place-search module and no Explore query
