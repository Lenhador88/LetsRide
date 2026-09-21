## ADDED Requirements

### Requirement: A screen widening the projection of another rider's row SHALL name each added column

`025` grants `authenticated` SELECT on eight `profiles` columns, and that grant is **table-wide,
not row-scoped**: every column it names is readable on every row the SELECT policy admits. What
stops one rider learning another's bio today is therefore not a permission — it is the app's own
choice to project four columns (`PUBLIC_PROFILE_COLUMNS`) in shared contexts.

That makes widening the projection a **silent** change: adding a column to a select list needs no
migration, trips no policy, fails no assertion and raises no advisor. A change that widens what
one rider learns about another SHALL therefore name each added column and state why it is safe,
so the widening is reviewable at all.

This requirement adds a rule about *projections*. It does not alter *Every role's reach into a
rider's identity SHALL be stated*, whose scenarios continue to govern who may reach a row; a
dedicated profile screen is a fifth reach path alongside the club roster, ride crew, postcard
byline and Explore already named there.

#### Scenario: A new shared-context projection is a subset of the grant

- **WHEN** a column allowlist for reading another rider's row is introduced or extended
- **THEN** every column in it SHALL appear in `025`'s
  `grant select (...) on public.profiles to authenticated`
- **AND** a test SHALL enforce this by reading the migration, because a column named outside the
  grant returns `42501` for the whole row rather than omitting that column

#### Scenario: Consent and lifecycle stamps stay out of every projection

- **WHEN** any allowlist naming another rider's columns is written
- **THEN** it SHALL contain neither `terms_accepted_at`, `onboarding_completed_at` nor
  `terms_version`
- **AND** this SHALL hold by test rather than by comment, matching the existing guard on
  `PUBLIC_PROFILE_COLUMNS`

#### Scenario: The narrow allowlist stays narrow

- **WHEN** a screen needs more columns of another rider than the shared-context allowlist carries
- **THEN** it SHALL introduce a separate, named allowlist for that screen
- **AND** SHALL NOT widen the shared-context allowlist, which would ship the added columns to
  every member list, ride crew and byline that renders a rider

#### Scenario: A column added to `profiles` later

- **WHEN** a migration adds a column to `profiles` and grants it to `authenticated`
- **THEN** it SHALL NOT become visible to other riders merely by being added to a screen's select
  list without a stated decision
- **AND** the default SHALL be exclusion from every other-rider projection
