## ADDED Requirements

### Requirement: A shared metered resource SHALL be rationed by the database, and never by the client of the metered service

Where a third party meters a quota that every rider draws on, the ceiling SHALL be a policy in
Postgres, evaluated under the calling rider's own role, and SHALL NOT live in the code that calls the
vendor.

Three properties force this and none of them is a preference:

- **The caller cannot count.** Edge Functions are stateless and multi-instance, so an in-memory
  counter counts one instance's traffic and a rider issuing concurrent requests bypasses it entirely.
- **The caller holds no service-role key**, by decision #8 and by the account-deletion precedent, so
  it cannot be given a privileged side channel in which to keep score without giving it the thing
  the architecture exists to withhold.
- **Nothing type-checks or gates an Edge Function.** `tsconfig.json` excludes them, deploying is an
  owner action with no CI path, and `031` is the standing lesson that an assumption about what a
  non-client role can reach goes unnoticed because the RLS suite runs as the table owner. A ceiling
  living only in a function is a ceiling one unreviewed deploy can remove.

The count SHALL be recorded **before** the metered call, and SHALL count *attempts*, never successes.
A counter that rises on success alone misses the retry loop, which is the only traffic pattern that
can exhaust a quota.

The ceiling SHALL be enforced at two scopes — per subject and per application — because a per-subject
ceiling alone permits a hundred honest subjects to exhaust the same quota, and an application-wide
ceiling alone lets one subject spend everyone's share.

The counting function SHALL be `security definer`, SHALL live outside the schema PostgREST routes to,
and SHALL NOT be executable by any client role: a subject-taking counter that a rider can call is an
oracle for another rider's activity.

#### Scenario: The ceiling refuses at the boundary, under the rider's own role
- **WHEN** a subject at their ceiling attempts another metered operation
- **THEN** the row recording the attempt SHALL be refused by the INSERT policy
- **AND** the refusal SHALL happen before the vendor is contacted
- **AND** the same refusal SHALL occur whether the request arrives through the application, through
  PostgREST directly, or concurrently from several devices

#### Scenario: A subject cannot forge their own headroom
- **WHEN** a rider writes to the metering table by hand
- **THEN** the subject column SHALL be forced to `auth.uid()` by the policy
- **AND** the timestamp SHALL be server-owned, with no INSERT or UPDATE grant on it for any client role
- **AND** the table SHALL carry no UPDATE and no DELETE grant for any client role, so recorded spend
  cannot be erased

#### Scenario: The metered table is gated like every other participation surface
- **WHEN** an account that has not accepted the terms attempts a metered operation
- **THEN** the write SHALL be refused by the same participation gate that guards every other content
  table
- **AND** the count of tables carrying that gate SHALL be re-derived rather than read from prose, since
  a table added without one is indistinguishable from the list being right

#### Scenario: The ceiling is asserted by grantee, not by table
- **WHEN** the RLS suite covers the metering table
- **THEN** every grant assertion SHALL name its grantee, because `postgres` and `service_role` hold
  everything by Supabase default and a table-wide count reads a false pass
- **AND** at least one assertion SHALL prove the refusal is not vacuous by admitting a write below the
  ceiling and refusing the one that crosses it

### Requirement: An opaque third-party identifier SHALL be stored as provenance, namespaced, and never as a join key

A column holding an identifier issued by an outside system SHALL be documented, constrained and read
as *evidence of where a value came from*. It SHALL NOT be joined on, resolved, or relied upon to
still mean anything.

The identifier SHALL carry its source. An unnamespaced id is indistinguishable from the next
provider's, and the day a provider changes, every stored row silently claims to have come from the
new one.

There SHALL be no foreign key. A reference table that is loaded wholesale, or that can be retired
entirely, cannot carry one without either blocking every reload or destroying every referencing row
on one.

The column's length bound SHALL be set from a measured identifier. A bound that admits the previous
provider's format and refuses the next one turns every write into a constraint violation the rider
can neither see nor shorten.

#### Scenario: A dangling identifier is the designed state
- **WHEN** the system that issued a stored identifier is retired
- **THEN** rows carrying it SHALL be unchanged, unrewritten and unbackfilled
- **AND** every screen reading those rows SHALL render from the values stored beside the identifier
- **AND** nothing SHALL attempt to resolve it

#### Scenario: Provenance survives a provider change
- **WHEN** two providers have issued identifiers into the same column
- **THEN** a reader SHALL be able to tell which provider issued any given one from the row alone
- **AND** any CHECK or trigger keyed on "this value was chosen rather than derived" SHALL continue to
  hold for both

#### Scenario: The bound is raised before the first write that needs it
- **WHEN** a new provider's identifier is longer than the constraint admits
- **THEN** the constraint SHALL be widened in a migration that lands before the code that writes one
- **AND** the widened bound SHALL be recorded with the measurement that produced it, not with an
  estimate
