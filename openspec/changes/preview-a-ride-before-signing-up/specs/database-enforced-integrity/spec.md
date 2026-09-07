# database-enforced-integrity

## MODIFIED Requirements

### Requirement: Every role's reach into a rider's identity SHALL be stated

Every role's reach into another rider's identity SHALL be stated and asserted, including the roles
that reach nothing.

**The signed-out visitor's reach is no longer uniformly zero, and the requirement SHALL say so.**
`anon` holds no grant on `public.profiles` and never will — that half is unchanged and stays measured
— but since `115` (PD-430) a signed-out caller holding a ride invite token can obtain **one rider's
username**: the organiser of the ride that token names, through
`public.ride_invite_link_public_preview`. A requirement about *every role's reach into identity* that
omits the app's only anonymous read is wrong by omission, which is precisely the failure mode this
capability exists to prevent.

**The boundary SHALL be the projection.** No other column of `profiles` — not the id, not the avatar
path, not `location`, `home_country`, `terms_accepted_at`, `onboarding_completed_at` or
`analytics_opt_out_at` — SHALL be reachable anonymously by any route, and the anonymous function SHALL
select exactly one column from `profiles`.

**No role SHALL gain the ability to write, clear or edit another rider's identity**, and this change
adds no writer of any kind: the anonymous path performs no INSERT, UPDATE or DELETE.

#### Scenario: The rider themselves

- **WHEN** a rider reads or writes their own `profiles` row
- **THEN** they SHALL read every column their grants permit, SHALL set `username` while it is
  NULL, SHALL change it to another valid value while Q1 remains unanswered, and SHALL NOT return
  it to NULL

#### Scenario: Any other signed-in rider

- **WHEN** a signed-in rider updates a `profiles` row that is not their own, setting `username` to
  NULL or to anything else
- **THEN** zero rows SHALL be affected, because the UPDATE policy is `auth.uid() = id`
- **AND** this SHALL hold irrespective of the new rule, which never widens who may write

#### Scenario: A blocked rider

- **WHEN** rider A blocks rider B, and B reads A's `profiles` row by any route
- **THEN** zero rows SHALL be returned, unchanged, and the same SHALL hold with A and B exchanged
- **AND** this change SHALL open no new inference channel. **One pre-existing channel is stated
  rather than denied**: `profiles_username_lower_key` is a plain unique index, so B attempting to
  take A's name gets `23505` and learns it exists, while `isUsernameTaken` reads under the
  block-aware SELECT policy and reports it free. That asymmetry predates this change, is unaltered
  by it, and is the reason the mid-onboarding scenario above is worded against the index rather
  than against the availability check
- **AND** a **signed-out** blocked rider holding a ride invite token is the one case this change
  changes: they reach the organiser's username through the anonymous preview, because no identity is
  available to filter on. It is the accepted residual recorded in `anonymous-ride-preview`, and it
  SHALL NOT be extended to any other column or any other rider

#### Scenario: Club owner, admin, member and non-member

- **WHEN** a rider holding any `club_members.role` — `owner`, `admin` or `member` — or holding no
  membership at all, reaches another rider's profile through a club roster, a ride crew, a postcard
  byline or Explore
- **THEN** they SHALL read exactly the columns the `profiles` SELECT policy already admits and SHALL
  write nothing
- **AND** no role SHALL gain the ability to clear, set or edit another rider's username; club role
  confers no authority over another rider's identity, and `club_members` has no UPDATE policy to
  change a role with in any case

#### Scenario: Signed-out visitor

- **WHEN** a request arrives with no session and names `public.profiles` directly, by any statement
- **THEN** zero rows SHALL be returned and zero rows written, because `anon` holds no grant on
  `profiles` — measured, `has_table_privilege('anon','public.profiles','SELECT')` is `false`
- **AND** that measurement SHALL be unchanged by `115`, which grants EXECUTE on a function and no
  privilege on any table

#### Scenario: Signed-out visitor holding a ride invite token

- **WHEN** a signed-out caller passes a live token to `public.ride_invite_link_public_preview`
- **THEN** exactly one rider's `username` — the organiser's — SHALL be returned, and no other column
  of `profiles` and no other rider SHALL be
- **AND** the same caller SHALL reach nothing further: the organiser's other rides, their clubs,
  their postcards and their profile SHALL all return zero rows

#### Scenario: The anonymous projection selects one identity column

- **WHEN** the anonymous function's return signature and body are read from the catalogue
- **THEN** `username` SHALL be the only `profiles` column it names
- **AND** the assertion SHALL be a catalogue read rather than an inspection of a returned row, since a
  row whose other values happen to be NULL cannot distinguish "not selected" from "empty"

#### Scenario: The route guard is not the enforcement

- **WHEN** any rule above is tested
- **THEN** it SHALL be asserted against the database as the role in question, never against a
  redirect, and never as the table owner — for whom neither a policy nor a grant exists
