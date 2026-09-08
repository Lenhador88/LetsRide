# database-enforced-integrity (delta)

## ADDED Requirements

### Requirement: A column that becomes nullable SHALL have its three-valued behaviour decided at every site that interpolates it

When an existing `NOT NULL` column is made nullable, every predicate that already interpolates it
goes three-valued. **The direction it fails in is decided by the KIND of expression, not by the
author's intent**, and the kinds disagree. Each site SHALL be enumerated from the catalogue and its
new behaviour SHALL be stated, not inferred.

The four behaviours, measured on DEV 2026-09-05 for `clubs.owner_id`:

- **An RLS `using` or `with check` clause fails CLOSED.** `auth.uid() = owner_id` is NULL, and a
  policy admits only TRUE.
- **A `WHERE` conjunct inside a helper fails CLOSED.** `c.owner_id <> candidate` is NULL, so the row
  is not returned.
- **A CHECK constraint fails OPEN.** `avatar_path LIKE 'club-avatars/' || owner_id || '/%'` is NULL,
  and a CHECK rejects only on FALSE.
- **A predicate wrapped in a total function fails OPEN.** `NOT private.is_blocked(x, owner_id)` is
  TRUE, because `is_blocked` is an `EXISTS` and returns `false` rather than NULL — the NULL is
  swallowed before the negation sees it.

The last is the dangerous one, because it looks identical to the second and behaves like the
opposite of it. A `security definer` helper has no policy beneath it, so a site that fails open there
is open everywhere.

#### Scenario: Every interpolating site is enumerated from the catalogue
- **WHEN** a migration makes an existing column nullable
- **THEN** the change SHALL enumerate every policy, function and constraint referencing that column,
  obtained by querying `pg_policy`, `pg_proc` and `pg_constraint`
- **AND** it SHALL NOT rely on a list recalled from prose or from a previous migration, because a
  site added since is invisible to both

#### Scenario: A site that fails open is closed explicitly
- **WHEN** a site's new behaviour admits a row it previously refused
- **THEN** the migration SHALL add an explicit `IS NOT NULL` conjunct at that site
- **AND** it SHALL NOT rely on a neighbouring conjunct that happens to refuse for an unrelated
  reason, because such a conjunct is one refactor from removal

#### Scenario: A site that fails closed is asserted, not assumed
- **WHEN** a site's safety depends on NULL propagation rather than on a written predicate
- **THEN** the RLS suite SHALL carry an assertion naming the role and the resource
- **AND** the assertion SHALL state that the guarantee rests on three-valued logic, so that a later
  author who rewrites the predicate learns what they are relying on

#### Scenario: A privileged read is checked separately from the policy
- **WHEN** the column gates a `security definer` accessor
- **THEN** that accessor SHALL be audited independently of the table's RLS policies
- **AND** narrowing a SELECT policy SHALL NOT be treated as narrowing any accessor, since a definer
  body has no policy beneath it
