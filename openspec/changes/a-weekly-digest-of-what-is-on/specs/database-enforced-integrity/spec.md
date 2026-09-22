## MODIFIED Requirements

### Requirement: Consent and lifecycle timestamps SHALL NOT be readable by other riders

`profiles.terms_accepted_at`, `profiles.onboarding_completed_at`, `profiles.analytics_opt_out_at`,
`profiles.deletion_started_at` and `profiles.digest_opt_out_at` SHALL be readable on the caller's
own row only, and the restriction MUST be enforced by the database rather than by the projection a
query happens to request.

RLS is row-level, not column-level: the `profiles` SELECT policy admits every non-blocked rider
with a username, and therefore admits every column of that row. `PUBLIC_PROFILE_COLUMNS` narrows
the projection in application code, which is a convention the database does not enforce.

**Every consent stamp added after `096` joins this list by default, and a change adding one owes
the explicit statement rather than the inference.** `025`'s grant lists are an absolute allowlist,
so the correct implementation is to **issue no `grant` statement at all** — which means the failure
mode is not a forgotten revoke but a helpful addition to a list, made by somebody who noticed that
`location` is in it and assumed the new column belonged beside it.

#### Scenario: Another rider's consent record is not retrievable
- **WHEN** any signed-in rider selects all columns of another rider's profile
- **THEN** none of the five columns above SHALL be returned
- **AND** the rider's own row SHALL still return the two the route guard and the resume step read

#### Scenario: A blocked rider reaches nothing
- **WHEN** a blocked rider selects any column of the blocking rider's profile
- **THEN** zero rows SHALL be returned, unchanged

#### Scenario: A second projection does not satisfy this
- **WHEN** the restriction is implemented
- **THEN** `authenticated` MUST NOT retain column-level SELECT on any of the five on
  `public.profiles` itself
- **AND** an alternative object placed beside the table SHALL NOT count, because `public.profiles`
  stays published by PostgREST and the grant is what decides — verified against
  `information_schema.column_privileges`

#### Scenario: A new stamp is asserted by grant, not by projection
- **WHEN** a change adds a consent or lifecycle timestamp to `profiles`
- **THEN** the assertion SHALL be `has_column_privilege('authenticated', 'public.profiles', …,
  'select')` being false
- **AND** an assertion that the app's projection omits the column SHALL NOT be accepted in its
  place

## ADDED Requirements

### Requirement: A coordinate describing a RIDER SHALL be granted more narrowly than the place name it was derived from

Where a column holds a coordinate that locates a **person** rather than a place, it SHALL NOT
inherit the grants of the human-readable field it was derived from. Its grant decision SHALL be
made and stated on its own terms, and the default SHALL be **no client grant at all**, with an
own-row `security definer` accessor as the only reach.

**The two are not the same disclosure even when they describe the same spot.** A town name is a
field a rider fills in on a profile other riders read. A centroid is a machine-usable position
that sorts, joins and measures — it answers *"who lives within 5 km of this address"* for the whole
table in one statement, which the town name does not. That a rider consented to publishing the
first is not consent to the second.

The failure this closes is specific and is an **addition** rather than an omission: a column-level
allowlist makes an ungranted column invisible, so nothing leaks by being forgotten. It leaks when
an author notices the derived column's human-readable sibling in the allowlist and adds the new
one beside it, which reads as consistency and is the whole bug.

An accessor SHALL take no rider id, so a foreign read is unrepresentable rather than merely
refused.

#### Scenario: The coordinate is not added to the sibling's allowlist
- **WHEN** a rider-locating coordinate is added to a table whose grants are an absolute allowlist
- **THEN** the migration SHALL issue no `grant` statement on that table
- **AND** the assertion SHALL be grantee-scoped and per column

#### Scenario: A rider reads their own and nobody else's
- **WHEN** the accessor is called
- **THEN** it SHALL resolve its subject from `auth.uid()` alone and return at most the caller's own
  value

#### Scenario: The derived column's presence is not itself an oracle
- **WHEN** a rider attempts to learn whether another rider has a coordinate stored
- **THEN** no count, error, ordering or timing difference SHALL answer it
- **AND** a screen that sorts by distance SHALL do so on the caller's own side of the comparison

### Requirement: Personal data whose retention is "the row's own lifetime" SHALL say so, and SHALL say what it is NOT

A column holding personal data SHALL carry a retention window stated at creation. Where the answer
is *the parent row's lifetime with no sweep and no expiry*, that SHALL be recorded as the decision,
together with the mechanism that ends it and the reason a real expiry is not needed.

**And it SHALL state the neighbouring class it must not be extended to by analogy.** A stored
*current* town centroid is a fact the rider entered and can change or remove at any moment; a
location **track** is a record of where someone *was*, accumulates, and cannot be corrected by
editing a field. A future feature that stores the second SHALL NOT inherit the first's window by
resemblance, and the first's own record SHALL say so, at the site, so the inheritance is refused
where it would be attempted.

The rider SHALL be able to see the value and remove it, and removal SHALL be a single act rather
than two — clearing the human-readable field SHALL clear the derived one with it.

#### Scenario: The window names its mechanism
- **WHEN** the retention decision is recorded
- **THEN** it SHALL name what ends the data — a cascade, a trigger, a rider action — rather than
  stating a duration nothing enforces
- **AND** `036`'s standing lesson SHALL apply: a duration with no scheduler behind it is *"an
  unlabelled guess promoted to a fact in the one artifact a future session reads as
  authoritative"*

#### Scenario: Removing the visible field removes the derived one
- **WHEN** the rider clears the field the value was derived from
- **THEN** the derived value SHALL be NULL afterwards, by a trigger rather than by the caller
  remembering
- **AND** the statement SHALL succeed rather than raise, because it is a path the rider is
  already on

#### Scenario: The privacy copy is part of the mechanism
- **WHEN** the retention window is set or changed
- **THEN** `/legal/privacy` SHALL say the same thing in its own words, and the two SHALL move
  together

#### Scenario: The neighbouring class is named and refused
- **WHEN** a later change stores continuous or historical location data
- **THEN** it SHALL NOT cite this window
- **AND** this requirement's own record SHALL be what makes that citation visibly wrong rather
  than plausible
