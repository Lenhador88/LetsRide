# database-enforced-integrity (delta)

> **This delta ADDS requirements and MODIFIES none, deliberately.** Two active changes
> (`add-account-deletion`, `enforce-creator-membership`) already collide on this spec's
> `Club membership role SHALL NOT be self-assignable`, and a third on
> `Storage object ownership SHALL remain database-enforced`; each carries a coordination banner
> because `openspec archive` folds a delta in by replacing a requirement **wholesale**, so
> whichever change archives second discards the first one's edit silently. Every requirement
> below is new, touches no existing requirement's text, and therefore joins none of that.
>
> If a future revision of this delta needs to modify an existing requirement, add the banner
> first and re-read the standing spec as the previous change left it.

## ADDED Requirements

### Requirement: A privileged object SHALL NOT be created in `public` and revoked afterwards

Any database object whose audience is the project owner alone SHALL be created in the `private`
schema. It SHALL NOT be created in `public` and then have its privileges revoked.

The two are not equivalent, and the difference is measurable rather than stylistic. Measured on
DEV 2026-08-24 in a rolled-back transaction: a view created in `public` by a migration running
as `postgres` is born with
`{postgres=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}`, because
`pg_default_acl` carries two default-privilege entries for that schema. The same view created in
`private` is born with `relacl = NULL` — the owner and nobody else, because `pg_default_acl`
holds no entry for `private` at all. `anon` and `authenticated` additionally hold no USAGE on
`private`, and PostgREST routes only to `public`.

So a `public` object is published the instant it is created and unpublished only if someone
remembers the revoke, in the right migration, before it merges; a `private` object is
unreachable by construction. The failure mode of the first is silent, ships green, and is
invisible to CI, the RLS suite and the OpenSpec workflow alike.

The explicit `revoke all … from anon, authenticated, service_role` SHALL still be written on
every such object, as the second independent layer — the one that survives a future change to
default privileges on `private`.

#### Scenario: An owner-only view is unreachable by every client role
- **WHEN** a view intended for the project owner is created
- **THEN** it SHALL be in `private`
- **AND** `anon`, `authenticated` and `service_role` SHALL each hold no SELECT privilege on it
- **AND** no PostgREST route SHALL resolve to it

#### Scenario: The revoke is written even where the grant never existed
- **WHEN** an owner-only object is created in `private`
- **THEN** the migration SHALL still name `revoke all … from anon, authenticated, service_role`
- **AND** the redundancy SHALL be explained in the migration rather than left to look like an
  oversight

#### Scenario: `service_role` is named explicitly wherever an object is locked down
- **WHEN** a migration revokes privileges to make an object owner-only
- **THEN** the revoke SHALL name `service_role` alongside `anon` and `authenticated`
- **AND** the migration SHALL NOT assume Supabase's defaults exclude it, because they do not

### Requirement: A `security definer` function SHALL be justified by a caller who cannot do the work themselves

`security definer` SHALL be used only where the calling role genuinely cannot perform the
operation under its own privileges — the shape `private.is_blocked` and
`public.moderate_comment` both have, where a rider must act on a row RLS forbids them to read.

A function whose only caller is the database owner SHALL be `security invoker`. The owner
already holds `BYPASSRLS` and owns the tables, so `security definer` there buys nothing and
leaves a standing escalation that becomes live the moment its EXECUTE grant widens.

This is also what keeps the security-advisor surface honest:
`authenticated_security_definer_function_executable` fires on a `security definer` function
executable by `authenticated`, and the eight existing WARNs are each a deliberate instance of
the justified shape. A ninth with no rider caller would be noise in the one list a session uses
to tell an expected advisor from a new one.

#### Scenario: An owner-only privileged operation adds no advisor
- **WHEN** a function reachable only by the database owner is added
- **THEN** it SHALL be `security invoker`
- **AND** the change SHALL add no `authenticated_security_definer_function_executable` advisor
- **AND** the advisor count SHALL be re-derived with `get_advisors(security)` after applying,
  never read off a document

#### Scenario: A narrow privileged removal names one table and one row
- **WHEN** a function exists to remove a single row on the owner's behalf
- **THEN** it SHALL accept an identifier and no predicate
- **AND** it SHALL name exactly one table in its `delete`
- **AND** rows removed alongside it SHALL be removed by declared cascades, not by further
  statements in the function body

### Requirement: A revoke SHALL be verified where its ground truth actually lives

`supabase/tests/` runs on plain Postgres as the table owner, and `harness.sql` deliberately
grants `service_role` no table privileges — so `has_table_privilege('service_role', …)` reads
`false` locally by construction and `true` on the hosted project. An assertion made there passes
for an environment reason rather than the intended one, which is the same class of defect as
`031`'s uncallable function passing a suite that ran as the owner.

Every privilege claim in a migration SHALL therefore be assigned to the layer that can actually
falsify it: `anon` and `authenticated` claims to the local suite, `service_role` and PostgREST
claims to a verification step run against the hosted project after applying.

Where the local suite asserts the *absence* of a privilege, it SHALL also prove the harness
would have granted it — the anti-vacuity probe `047` introduced.

#### Scenario: An `authenticated` refusal is asserted locally and provably non-vacuous
- **WHEN** the suite asserts that `authenticated` cannot read a new object
- **THEN** it SHALL also create a throwaway object of the same kind in `public`, assert that
  `authenticated` inherits the privilege on it from the reproduced Supabase default, and drop it
- **AND** without that probe the refusal assertion SHALL be treated as unproven

#### Scenario: A `service_role` refusal is verified against the hosted project
- **WHEN** a migration revokes or withholds a privilege from `service_role`
- **THEN** the migration SHALL carry a verification step naming the query to run against the
  hosted project
- **AND** the local suite SHALL NOT assert it, and SHALL say why in a comment

#### Scenario: A referential cascade is proven not to depend on the revoked grant
- **WHEN** a grant is revoked from a role that a cascade path passes through
- **THEN** the suite SHALL exercise the cascade end to end after the revoke
- **AND** SHALL NOT reason about referential actions in a comment instead
