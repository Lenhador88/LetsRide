## Purpose

Every write rule that must still hold when the browser is the only caller. Today validity is
split between Zod schemas a Server Action parses and CHECK constraints in Postgres; once the
client owns the mutation path the constraint coverage is the entire story, and anything not
expressed as a CHECK, trigger or policy is advisory.

## ADDED Requirements

### Requirement: Text bounds on rider-authored columns SHALL be enforced by the database

Ten columns carry a length or presence rule that exists only in `src/lib/validation/`.
Verified against `pg_constraint` on the live project 2026-08-05: no CHECK exists for
`profiles.bio`, `profiles.bike_model`, `profiles.location`, `clubs.name`, `clubs.description`,
`rides.title`, `rides.description`, `rides.meeting_point`, `rides.route_description`, or
`rides.max_riders`. Each SHALL gain a CHECK matching its Zod schema exactly.

The bounds themselves are not new decisions. `clubs` and `rides` bounds were chosen rather
than measured (their Figma frames are OLD-stylesheet and marked To do) and the migration
adopts them as written rather than reopening them.

#### Scenario: A rider cannot store a value no screen can render
- **WHEN** any signed-in rider writes `clubs.name` longer than 60 characters, by any route
- **THEN** the database SHALL reject the write with a check violation
- **AND** the club list, Explore and every club detail sub-page SHALL be unaffected, including
  for non-members who reach the club through Explore

#### Scenario: An empty required field is refused
- **WHEN** a rider writes `rides.title` or `rides.meeting_point` as an empty or
  whitespace-only string
- **THEN** the database SHALL reject the write
- **AND** the trimmed-floor / raw-ceiling asymmetry SHALL match
  `postcard_comments_body_length`, so padding cannot smuggle a longer value past a trimmed
  check

#### Scenario: Optional text distinguishes cleared from never-set
- **WHEN** a rider clears their bio
- **THEN** the stored value SHALL be NULL rather than the empty string, and the constraint
  SHALL permit NULL

### Requirement: Club membership role SHALL NOT be self-assignable

The database SHALL refuse any `club_members` row whose `role` is `owner` or `admin`, except the
row a club's own `owner_id` creates for themselves.

`club_members` INSERT is `auth.uid() = user_id AND (club is public OR club owner is caller)`.
It constrains *who* the row is for and says nothing about `role`; the only rule on `role` is
the enum CHECK. Today `joinClub` omits the column and relies on the `'member'` default. That
reliance is an application convention, not a database rule, and it ends the day the client
writes the row.

The roster screen renders the value — `/clubs/[id]/members` labels `owner` and `admin` and
draws an owner ring — so a forged role is visible to every member of the club.

#### Scenario: A non-member joining a public club cannot arrive as owner or admin
- **WHEN** a signed-in rider who is not a member inserts a `club_members` row for a public club
  with `role` set to `owner` or `admin`
- **THEN** the database SHALL reject the write

#### Scenario: The creator's own owner row is still permitted
- **WHEN** the rider named in `clubs.owner_id` inserts their own membership row with
  `role = 'owner'`
- **THEN** the write SHALL succeed

#### Scenario: Nobody can promote an existing member
- **WHEN** any rider — including the club owner — attempts to UPDATE `club_members.role`
- **THEN** the write SHALL be refused, because no UPDATE policy on `club_members` exists
- **AND** this SHALL remain true until the invitations feature ships its own policy, so that
  the absence is a recorded gap rather than an accident

### Requirement: A rider SHALL NOT be able to make other riders' clients fetch a URL they control

No column a rider can write MUST ever be used as an image source, link target or fetch URL in
another rider's client.

`profiles.avatar_url` is unconstrained `text`, the `profiles` UPDATE policy is `auth.uid() = id`
with no column scoping, and `resolveAvatarUrls` uses the column as the fallback whenever
`avatar_path` is NULL. It is also in `PUBLIC_PROFILE_COLUMNS`, so it ships to every member
list, postcard byline, comment row and ride crew.

CLAUDE.md records that nothing has ever *written* the column. That is a statement about the
application, not about PostgREST, and the client-rendered app makes the difference moot.

#### Scenario: An arbitrary URL cannot reach another rider's image tag
- **WHEN** a rider sets their own `profiles.avatar_url` to a URL on a host they control
- **THEN** either the database SHALL reject the write, or no other rider's client SHALL ever
  use the column as an image source
- **AND** a blocked rider SHALL in no case learn the IP address or user agent of the rider who
  blocked them by this route

#### Scenario: Existing rows survive the decision
- **WHEN** the column is constrained or dropped
- **THEN** any non-NULL value present beforehand SHALL be reported before the change, since
  `014` preserved the column precisely because nobody could prove it was empty

### Requirement: Consent and lifecycle timestamps SHALL NOT be readable by other riders

`profiles.terms_accepted_at` and `profiles.onboarding_completed_at` SHALL be readable on the
caller's own row only, and the restriction MUST be enforced by the database rather than by the
projection a query happens to request.

RLS is row-level, not column-level: the `profiles` SELECT policy admits every non-blocked
rider with a username, and therefore admits every column of that row, including
`terms_accepted_at` and `onboarding_completed_at`. `PUBLIC_PROFILE_COLUMNS` narrows the
projection in application code, which is a convention the database does not enforce.

#### Scenario: Another rider's consent record is not retrievable
- **WHEN** any signed-in rider selects all columns of another rider's profile
- **THEN** `terms_accepted_at` and `onboarding_completed_at` SHALL NOT be returned
- **AND** the rider's own row SHALL still return them, because the onboarding resume step and
  the route guard both read the caller's own completion stamp

#### Scenario: A blocked rider reaches nothing
- **WHEN** a blocked rider selects any column of the blocking rider's profile
- **THEN** zero rows SHALL be returned, unchanged from today

### Requirement: Country codes SHALL be a known country

`profile_countries.country_code` SHALL be an assigned ISO 3166-1 alpha-2 code, not merely two
uppercase letters.

`profile_countries.country_code` has a CHECK of `^[A-Z]{2}$` only. Membership of the ISO
3166-1 list lives in `COUNTRY_CODES` and is checked by Zod alone, so `ZZ` stores successfully
today and renders as a blank flag beside its own code forever.

#### Scenario: An unassigned code is refused
- **WHEN** a rider adds `ZZ`, `XX` or any other well-formed but unassigned code
- **THEN** the database SHALL reject the write

#### Scenario: The picker's list stays the client's
- **WHEN** the constraint is added
- **THEN** it SHALL NOT introduce a `countries` reference table, since nothing joins against
  one and `014` deliberately declined to create it

### Requirement: Onboarding completion SHALL gate participation, not only navigation

A rider whose `profiles.onboarding_completed_at` is NULL MUST NOT be able to create content or
join anything, and the refusal SHALL come from the database rather than from a redirect.

Decision #5 states onboarding is required and not skippable, and today `proxy.ts` is its
**only** enforcement. No policy prevents a rider whose `onboarding_completed_at` is NULL from
inserting a postcard, creating a club or a ride, or joining anything; `003`'s trigger guards
the *stamp*, not the participation. Demoting the route guard to a UX affordance therefore
removes the only thing holding decision #5.

An un-onboarded rider also has a NULL `username`, which the `profiles` SELECT policy uses to
hide them from other riders — so their content would appear to everyone else with an
unresolvable author.

#### Scenario: An un-onboarded rider cannot create content
- **WHEN** a rider whose `onboarding_completed_at` is NULL inserts into `postcards`, `clubs`,
  `rides`, `club_members`, `ride_members`, `postcard_comments` or `postcard_likes`
- **THEN** the database SHALL reject the write

#### Scenario: Completing onboarding is still the only way through
- **WHEN** the same rider sets a username and location and receives the completion stamp
- **THEN** every write above SHALL succeed
- **AND** the stamp SHALL remain one-way and SHALL remain refused while either field is NULL,
  unchanged from `003`

#### Scenario: Reading is unaffected
- **WHEN** an un-onboarded rider reads any table
- **THEN** the existing policies SHALL apply unchanged, so this requirement adds no new read
  restriction and cannot strand a rider mid-wizard

### Requirement: Blocking SHALL remain enforced in RLS and SHALL survive the client owning the queries

A blocked rider MUST remain unreachable in both directions, and no screen SHALL apply a block
filter of its own.

Decision #2 is unaffected by the render model: the policies do not know or care which process
issued the statement. This requirement exists so the migration's test pass asserts it rather
than assuming it.

#### Scenario: A blocked rider disappears symmetrically
- **WHEN** rider A blocks rider B, and B queries `postcards`, `postcard_comments`,
  `postcard_likes`, `club_members`, `ride_members` or `profiles` for A's rows, directly from
  the client
- **THEN** zero rows SHALL be returned in each case
- **AND** the same SHALL hold with A and B exchanged, because the row is directional and the
  effect symmetric

#### Scenario: No client-side filtering is introduced
- **WHEN** any screen renders a list that could contain a blocked rider
- **THEN** it SHALL NOT apply a block filter of its own, so that the policy remains the single
  place the rule lives

### Requirement: Storage object ownership SHALL remain database-enforced

A rider MUST NOT be able to upload outside their own folder, nor reference an object in another
rider's folder from a row they author.

Every upload surface binds its path to the uploader in SQL: `postcards` through the INSERT
policy's `image_path like 'postcards/' || auth.uid() || '/%'`, and `profiles` and `clubs`
through CHECK constraints on the row. Fifteen `storage.objects` policies exist across five
folders, none granted to anything but `authenticated`, and none of them UPDATE.

#### Scenario: A rider cannot claim another rider's object
- **WHEN** a rider inserts a `postcards` row whose `image_path` sits in another rider's folder
- **THEN** the write SHALL be rejected by the INSERT policy

#### Scenario: A rider cannot upload outside their own folder
- **WHEN** a rider uploads to `avatars/<another uid>/…`, `covers/`, `club-avatars/` or
  `club-covers/` outside their own folder
- **THEN** Storage SHALL refuse the upload

#### Scenario: Unenforced capacity is recorded, not silently assumed
- **WHEN** `rides.max_riders` is set
- **THEN** nothing SHALL claim it is enforced: no policy, trigger or constraint limits
  `ride_members` by it, and this migration does not add one
