## MODIFIED Requirements

### Requirement: Consent and lifecycle timestamps SHALL NOT be readable by other riders

`profiles.terms_accepted_at`, `profiles.onboarding_completed_at`, `profiles.analytics_opt_out_at`
and `profiles.digest_opt_out_at` SHALL be readable for the caller's own row only. The database
MUST enforce this restriction, rather than the projection a query happens to request.

RLS is row-level, not column-level. The `profiles` SELECT policy admits every non-blocked rider
with a username, and so it admits every column of that row that `authenticated` holds a grant on.
`PUBLIC_PROFILE_COLUMNS` narrows the projection in application code, and the database does not
enforce that convention. The column grant is what decides.

**A stamp added after `096` joins this list, and the change that adds it SHALL say so
explicitly.** `025`'s grant lists are an absolute allowlist, so the correct implementation issues
**no `grant` statement at all**. The failure this guards against is therefore not a forgotten
revoke. It is a helpful addition to a list, by an author who assumed the new column belonged
beside `location`.

#### Scenario: Another rider's consent record is not retrievable
- **WHEN** any signed-in rider selects all columns of another rider's profile
- **THEN** none of the four columns above SHALL be returned
- **AND** the rider SHALL still reach their own stamps through their own-row accessors
  (`my_onboarding_state()`, `my_analytics_opt_out()`, `my_digest_opt_out()`), which take no rider
  id

#### Scenario: A blocked rider reaches nothing
- **WHEN** a blocked rider selects any column of the blocking rider's profile
- **THEN** zero rows SHALL be returned, as today

#### Scenario: A second projection does not satisfy this
- **WHEN** the restriction is implemented
- **THEN** `authenticated` MUST NOT hold column-level SELECT on any of the four on
  `public.profiles` itself
- **AND** an alternative object placed beside the table SHALL NOT count, because PostgREST still
  publishes `public.profiles` and the grant is what decides. This SHALL be verified against
  `information_schema.column_privileges`

#### Scenario: A new stamp is asserted by grant, not by projection
- **WHEN** a change adds a consent or preference timestamp to `profiles`
- **THEN** the assertion SHALL be that `has_column_privilege('authenticated', 'public.profiles',
  …, 'select')` is false, with the same check for insert and update
- **AND** the assertion SHALL also pin `025`'s allowlist widths, so a widening fails it
- **AND** an assertion that the app's projection omits the column SHALL NOT be accepted in its
  place
