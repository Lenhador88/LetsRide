# database-enforced-integrity Specification

## Purpose
Every write rule that must still hold when the browser is the only caller. Today validity is
split between Zod schemas a Server Action parses and CHECK constraints in Postgres; once the
client owns the mutation path the constraint coverage is the entire story, and anything not
expressed as a CHECK, trigger or policy is advisory.
## Requirements
### Requirement: Text bounds on rider-authored columns SHALL be enforced by the database

**This is a live defect, not a risk the migration introduces.** The publishable key ships in
the bundle today and PostgREST accepts any rider's JWT, so a megabyte club name is one
hand-rolled request away right now. What the migration changes is that the app itself starts
issuing writes this way, so the gap stops being exotic.

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

**This is a live defect, not a risk the migration introduces.** `club_members` INSERT is
`auth.uid() = user_id AND (club is public OR club owner is caller)`. It constrains *who* the
row is for and says nothing about `role`; the only rule on `role` is the enum CHECK. `joinClub`
omits the column and relies on the `'member'` default — which is a convention in our code, not
a rule in the database, and PostgREST does not read our code. Any rider can already join any
public club as `admin` today. The migration is where this is fixed, not where it begins.

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

#### Scenario: A second projection does not satisfy this
- **WHEN** the restriction is implemented
- **THEN** `authenticated` MUST NOT retain column-level SELECT on `terms_accepted_at` or
  `onboarding_completed_at` on `public.profiles` itself
- **AND** an alternative object placed beside the table SHALL NOT count, because
  `public.profiles` stays published by PostgREST and the grant is what decides —
  verified against `information_schema.column_privileges`, where `authenticated` currently
  holds SELECT, INSERT and UPDATE on both columns

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
  `rides`, `club_members`, `ride_members`, `postcard_comments`, `postcard_likes` or
  `postcard_reports`
- **THEN** the database SHALL reject the write

#### Scenario: Per-viewer tables are deliberately excluded
- **WHEN** an un-onboarded rider inserts into `blocks`, `postcard_hides`, `feed_reads`,
  `profile_countries` or their own `profiles` row
- **THEN** the write SHALL succeed, because none of these produces content another rider can
  see and `profiles` is the row the wizard itself writes
- **AND** the exclusion SHALL be stated in the migration rather than left as silence: thirteen
  tables carry an INSERT policy and this gate names eight of them

#### Scenario: An un-onboarded rider cannot file moderation records
- **WHEN** a rider who has not completed onboarding reports a postcard
- **THEN** the write SHALL be refused
- **AND** this SHALL hold specifically because email confirmation is off (decision #6), so an
  account can be created with an address nobody controls and used to file reports that no
  admin role exists to triage

#### Scenario: Completing onboarding is still the only way through
- **WHEN** the same rider sets a username and location and receives the completion stamp
- **THEN** every write above SHALL succeed
- **AND** the stamp SHALL remain one-way and SHALL remain refused while either field is NULL,
  unchanged from `003`

#### Scenario: Reading is unaffected
- **WHEN** an un-onboarded rider reads any table
- **THEN** the existing policies SHALL apply unchanged, so this requirement adds no new read
  restriction and cannot strand a rider mid-wizard

### Requirement: Consent evidence SHALL exist before a rider participates

A rider MUST NOT be able to complete onboarding or create content with
`profiles.terms_accepted_at` NULL, and the requirement SHALL be enforced by the database rather
than by the signup action.

`CLAUDE.md` names three integrity rules the client must not own: username charset, the
onboarding completion stamp, and T&C acceptance. `003` delivers the first two. `012` makes the
consent stamp immutable and server-timed **once written**, but nothing anywhere ever *requires*
it to be written: `003`'s completion guard checks `username` and `location` only, and the
acceptance rule lives in `signUpSchema`'s `z.literal(true)` and in the `signUp` action. Once the
client owns signup, consent evidence stops existing.

This is an EU project and the column is evidence, which is `012`'s own framing.

**Measured on the live project 2026-08-05, and worse than the audit assumed: 4 of 4 profiles
have `terms_accepted_at` NULL, and 3 of those have completed onboarding.** No rider on this
database has a consent record today. That makes the rule correct and its rollout a product
decision rather than a migration detail — see the open question in `design.md`, because a
backfilled timestamp is a fabricated consent record and this requirement does not authorise
one.

#### Scenario: Onboarding cannot complete without consent
- **WHEN** a rider sets `onboarding_completed_at` while `terms_accepted_at` is NULL
- **THEN** the database SHALL refuse the stamp, in the same guard and with the same
  `check_violation` shape `003` uses for `username` and `location`

#### Scenario: The stamp remains server-owned
- **WHEN** a client sends its own timestamp on first acceptance
- **THEN** the value stored SHALL be server time, and thereafter immutable, unchanged from `012`

#### Scenario: Existing riders are not silently stamped
- **WHEN** this rule is applied to a database containing riders with NULL consent
- **THEN** no migration SHALL write a value into `terms_accepted_at` on their behalf
- **AND** they SHALL be routed through a re-consent step instead, or the rule SHALL be deferred
  until one exists

### Requirement: A private club's ride SHALL NOT be publicly visible

`rides.is_public` and `rides.club_id` are independently settable, so a ride attached to a
private club can carry `is_public = true` — and the `rides` SELECT policy's
`is_public OR club member` then makes it, and its crew through `ride_members`, readable by every
signed-in rider. `CreateRideForm` ships the checkbox `defaultChecked`, so the default path
produces exactly this.

The database SHALL refuse a ride whose `club_id` names a private club unless `is_public` is
false.

**Pre-flight measured on the live project 2026-08-05: 3 rides, 0 with a `club_id`, 0 private
clubs, 0 violating rows.** The constraint adds cleanly with no data migration. It will not stay
that way — `/rides/new` started offering `club_id` on 2026-08-05, so the window in which this is
free is short.

#### Scenario: A private club's ride cannot be marked public
- **WHEN** a member of a private club creates or updates a ride with that `club_id` and
  `is_public = true`
- **THEN** the write SHALL be rejected

#### Scenario: A club turning private takes its rides with it
- **WHEN** a club owner sets `is_public = false` on a club that has public rides
- **THEN** those rides SHALL cease to be publicly visible rather than being left behind as an
  orphaned exposure

### Requirement: Ride visibility SHALL be stated per role

Every role that can reach a ride SHALL have its access stated, so each line maps onto an
assertion. The policy exists and has never been written down role by role, which is what
allowed the private-club case above to go unnoticed.

#### Scenario: Organizer
- **WHEN** the organizer reads their own ride
- **THEN** it SHALL be returned regardless of `is_public`, `club_id` or club visibility

#### Scenario: Club member
- **WHEN** a member of the ride's club reads it
- **THEN** it SHALL be returned

#### Scenario: Non-member, public ride with no club
- **WHEN** any signed-in rider reads a ride with `club_id` NULL and `is_public = true`
- **THEN** it SHALL be returned, since decision #1 makes "public" mean "any signed-in rider"

#### Scenario: Non-member, private club's ride
- **WHEN** a signed-in rider who is not a member of the ride's private club reads it
- **THEN** zero rows SHALL be returned, and its crew SHALL be unreachable through
  `ride_members`

#### Scenario: Blocked rider
- **WHEN** a rider blocked by the organizer reads the ride, by any route including a club they
  both belong to
- **THEN** zero rows SHALL be returned

#### Scenario: Signed-out visitor
- **WHEN** a request arrives with no session
- **THEN** zero rows SHALL be returned, because `anon` holds no grant on `rides`

### Requirement: Blocking SHALL remain enforced in RLS and SHALL survive the client owning the queries

A blocked rider MUST remain unreachable in both directions, and no screen SHALL apply a block
filter of its own.

Decision #2 is unaffected by the render model: the policies do not know or care which process
issued the statement. This requirement exists so the migration's test pass asserts it rather
than assuming it.

**`clubs` deliberately carries no block predicate, and `rides` deliberately does.** Product
owner ruling, recorded here so the asymmetry is pinned by assertions rather than rediscovered
as a bug: a club is an organisation, not a person. A blocked rider keeps seeing the club in
Explore and on its page; what they do not see is the *person*, and `club_members` already
filters the roster so the blocker never appears in it. `rides` carries
`not private.is_blocked(auth.uid(), organizer_id)` because a ride has an organiser and that
organiser is a person.

#### Scenario: A blocked rider disappears symmetrically
- **WHEN** rider A blocks rider B, and B queries `postcards`, `postcard_comments`,
  `postcard_likes`, `club_members`, `ride_members`, `rides` or `profiles` for A's rows,
  directly from the client
- **THEN** zero rows SHALL be returned in each case
- **AND** the same SHALL hold with A and B exchanged, because the row is directional and the
  effect symmetric

#### Scenario: A blocked rider still sees the club itself
- **WHEN** rider A blocks rider B, and B loads Explore or a club page for a club A owns or
  belongs to
- **THEN** the club SHALL still be returned, because `clubs` carries no block predicate by
  decision
- **AND** A SHALL NOT appear in that club's roster, because `club_members` does carry one

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

